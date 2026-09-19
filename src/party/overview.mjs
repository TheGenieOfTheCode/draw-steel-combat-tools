import { getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'overview';
const PART = 'dsctOverview';
const TEMPLATE = `modules/${M}/templates/party-overview.hbs`;

export const L = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

const BOOK_LANGUAGES = {
  ancestry: ['anjali', 'axiomatic', 'caelian', 'filliaric', 'highKuric', 'hyrallic', 'illyvric',
    'kalliak', 'kethaic', 'khelt', 'khoursirian', 'lowKuric', 'mindspeech', 'protoCtholl', 'szetch',
    'theFirstLanguage', 'tholl', 'urollialic', 'variac', 'vastariax', 'vhoric', 'voll', 'yllyric',
    'zahariax', 'zaliac'],
  human: ['higaran', 'khemharic', 'oaxuatl', 'phaedran', 'riojan', 'uvalic', 'vaniric', 'vasloria'],
  dead: ['ananjali', 'highRhyvian', 'khamish', 'kheltivari', 'lowRhivian', 'oldVariac', 'phorialtic',
    'rallarian', 'ullorvic'],
};

const LANGUAGE_LABELS = {
  ancestry: 'DSCT.party.langAncestry',
  human: 'DSCT.party.langHuman',
  dead: 'DSCT.party.langDead',
};

const OTHER = 'dsctOther';

const _isDead = (key) => (ds.CONFIG.languages?.[key]?.group ?? _bookGroup(key)) === 'dead';

function _bookGroup(key) {
  for (const [id, keys] of Object.entries(BOOK_LANGUAGES)) if (keys.includes(key)) return id;
  return OTHER;
}

const _languageGroup = (key, cfg) => cfg?.group ?? _bookGroup(key);

const _marks = (party, kind) => party?.getFlag(M, FLAG)?.[kind] ?? {};

export function markFor(party, kind, key) {
  const stored = _marks(party, kind)[key];
  if (stored) return stored === 'none' ? null : stored;
  if (kind === 'languages' && _isDead(key) && getSetting('partyIgnoreDeadLanguages')) return 'ignored';
  return null;
}

export function partyMembers(party) {
  const out = [];
  for (const entry of party?.system?.members?.values?.() ?? []) {
    const actor = entry?.actor ?? entry;
    if (actor?.name) out.push(actor);
  }
  return out;
}

export function partyContributors(party) {
  const out = [];
  for (const actor of partyMembers(party)) {
    out.push({ id: actor.id, name: actor.name, doc: actor, isFollower: false });
    for (const item of actor.items ?? []) {
      if (item.type !== 'follower') continue;
      out.push({ id: item.id, name: item.name, doc: item, isFollower: true, owner: actor.name });
    }
  }
  return [...out.filter(c => !c.isFollower), ...out.filter(c => c.isFollower)];
}

const _holderName = (c) => (c.isFollower ? L('DSCT.party.followerOf', { name: c.name, owner: c.owner }) : c.name);

export function tallyHolders(contributors, path) {
  const map = new Map();
  for (const c of contributors) {
    for (const key of (foundry.utils.getProperty(c.doc, path) ?? [])) {
      map.set(key, [...(map.get(key) ?? []), _holderName(c)]);
    }
  }
  return map;
}

function _pill(party, kind, key, label, holders) {
  const mark = markFor(party, kind, key);
  return {
    key, kind, mark,
    label: game.i18n.has(label) ? L(label) : (label || key),
    count: holders?.length ?? 0,
    showCount: (holders?.length ?? 0) > 1,
    holders: holders?.join(', ') ?? '',
    isPreferred: mark === 'preferred',
    isIgnored: mark === 'ignored',
  };
}

const _sortPills = (pills) => pills.sort((a, b) =>
  (b.count > 0) - (a.count > 0) || a.label.localeCompare(b.label));

const _open = new Map();

const _groupOpen = (party, id) => !!_open.get(`${party?.id}:${id}`);

const GROUP_ICONS = {
  crafting: 'fa-hammer',
  exploration: 'fa-mountain-sun',
  interpersonal: 'fa-comments',
  intrigue: 'fa-user-secret',
  lore: 'fa-book',
  ancestry: 'fa-people-group',
  human: 'fa-city',
  dead: 'fa-skull',
};

const _iconFor = (id) => GROUP_ICONS[id] ?? 'fa-circle-question';

function _group(party, kind, id, label, entries, tally) {
  const pills = _sortPills(entries.map(([key, cfg]) =>
    _pill(party, kind, key, cfg?.label ?? key, tally.get(key))));
  return {
    id, label,
    icon: _iconFor(id),
    open: _groupOpen(party, id),
    pills,
    covered: pills.filter(p => p.count > 0).length,
    total: pills.length,
  };
}

function _bucket(party, kind, entries, tally, groupOf, labelOf, order) {
  const buckets = new Map();
  for (const [key, cfg] of entries) {
    const id = groupOf(key, cfg) ?? OTHER;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push([key, cfg]);
  }

  const known = order.filter(id => buckets.has(id));
  const extra = [...buckets.keys()].filter(id => !order.includes(id) && id !== OTHER).sort();
  const ids = [...known, ...extra, ...(buckets.has(OTHER) ? [OTHER] : [])];

  return ids.map(id => _group(party, kind, id, labelOf(id), buckets.get(id), tally));
}

function _skillGroups(party, members) {
  const tally = tallyHolders(members, 'system.skills.value');
  const groups = ds.CONFIG.skills?.groups ?? {};
  const label = (id) => (groups[id]?.label ? L(groups[id].label) : L('DSCT.party.otherGroup'));
  return _bucket(party, 'skills', Object.entries(ds.CONFIG.skills?.list ?? {}), tally,
    (key, cfg) => (groups[cfg?.group] ? cfg.group : OTHER), label, Object.keys(groups));
}

function _languageGroups(party, members) {
  const tally = tallyHolders(members, 'system.languages.value');
  const groups = ds.CONFIG.languages?.groups ?? {};
  const label = (id) => (LANGUAGE_LABELS[id] ? L(LANGUAGE_LABELS[id])
    : groups[id]?.label ? L(groups[id].label)
    : id === OTHER ? L('DSCT.party.otherGroup') : id);
  return _bucket(party, 'languages', Object.entries(ds.CONFIG.languages ?? {}).filter(([k]) => k !== 'groups'),
    tally, _languageGroup, label, Object.keys(LANGUAGE_LABELS));
}

function _characteristics(contributors) {
  const firstFollower = contributors.findIndex(c => c.isFollower);
  const sepAt = firstFollower > 0 ? firstFollower : -1;

  const heads = contributors.map((c, i) => ({ name: c.name, sep: i === sepAt, isFollower: c.isFollower }));
  const rows = Object.entries(ds.CONFIG.characteristics ?? {}).map(([key, cfg]) => {
    const values = contributors.map((c) => {
      const raw = c.doc.system?.characteristics?.[key]?.value;
      return Number.isFinite(raw) ? raw : null;
    });
    const real = values.filter(v => v !== null);
    const best = real.length ? Math.max(...real) : null;
    return {
      key,
      label: L(cfg.label),
      cells: values.map((v, i) => ({
        text: v === null ? '·' : (v >= 0 ? `+${v}` : String(v)),
        isBest: v !== null && v === best,
        sep: i === sepAt,
      })),
    };
  });
  return { heads, rows, any: heads.length > 0 };
}

export function overviewContext(party) {
  const contributors = partyContributors(party);
  return {
    isDirector: game.user.isGM,
    any: contributors.length > 0,
    memberCount: contributors.length,
    blocks: [
      { label: L('DSCT.party.skills'), groups: _skillGroups(party, contributors) },
      ...(getSetting('partyShowLanguages')
        ? [{ label: L('DSCT.party.languages'), groups: _languageGroups(party, contributors) }]
        : []),
    ],
    characteristics: _characteristics(contributors),
  };
}

async function _setMark(party, kind, key, value) {
  const next = { ...(_marks(party, kind)) , [key]: value };
  await party.setFlag(M, FLAG, { [kind]: next });
}

function _onPill(event, party) {
  const pill = event.target.closest('.dsct-po-pill');
  if (!pill) return;
  event.preventDefault();
  if (!game.user.isGM) return;

  const { kind, key } = pill.dataset;
  const current = markFor(party, kind, key);
  const wanted = event.type === 'contextmenu' ? 'ignored' : 'preferred';

  
  _setMark(party, kind, key, current === wanted ? 'none' : wanted)
    .catch(err => console.warn('DSCT | party overview |', err));
}

function _wire(app, root) {
  const tab = root.querySelector(`section[data-tab="${PART}"]`);
  if (!tab) return;

  const party = app.document;

  for (const group of tab.querySelectorAll('.dsct-po-group')) {
    const id = `${party.id}:${group.dataset.group}`;
    group.addEventListener('toggle', () => _open.set(id, group.open));
  }

  if (tab.dataset.dsctWired) return;
  tab.dataset.dsctWired = '1';
  tab.addEventListener('click', (event) => _onPill(event, party));
  tab.addEventListener('contextmenu', (event) => _onPill(event, party));
}

export function registerPartyOverview() {
  Hooks.on('renderDrawSteelPartySheet', (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (root) _wire(app, root);
  });

  
  Hooks.once('setup', () => {
    const Cls = globalThis.ds?.applications?.sheets?.DrawSteelPartySheet;
    if (!Cls) {
      console.warn('DSCT | party overview | the Draw Steel party sheet was not found, the tab is off');
      return;
    }
    if (Cls.PARTS[PART]) return;

    Cls.PARTS[PART] = { template: TEMPLATE, classes: ['tab'], scrollable: ['.contents'] };
    Cls.TABS.primary.tabs.push({ id: PART, label: 'DSCT.party.tab' });

    if (typeof libWrapper === 'undefined') return;
    libWrapper.register(M, 'ds.applications.sheets.DrawSteelPartySheet.prototype._prepareContext',
      async function (wrapped, ...args) {
        const context = await wrapped(...args);
        try { context.dsctOverview = overviewContext(this.document); }
        catch (err) { console.warn('DSCT | party overview |', err); }
        return context;
      }, 'WRAPPER');
  });
}
