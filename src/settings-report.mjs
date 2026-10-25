import { setTip, tipFor } from './chat-tips.mjs';

const M = 'draw-steel-combat-tools';
const SEEN = 'settingsReportSeen';

export const DEFAULT_CHANGES = {
  '1.1.0':   ['fmModifyGmOnly'],
  '1.1.9.2': ['fallConfirmation', 'squadHudEnabled', 'autoConfirmSelection', 'rollDialogPillUI', 'revealCombatantPositions', 'enforceAbilityRange', 'gmBypassRangeEnforcement'],
  '1.1.9.3': ['minionHealthEstimate'],
};

const REPORTED_TYPES = new Set([Boolean, Number, String]);

const changedIn = (key) => {
  let found = null;
  for (const [version, keys] of Object.entries(DEFAULT_CHANGES)) {
    if (keys.includes(key) && (!found || foundry.utils.isNewerVersion(version, found))) found = version;
  }
  return found;
};

const changedSince = (seen) => [...new Set(Object.entries(DEFAULT_CHANGES)
  .filter(([version]) => foundry.utils.isNewerVersion(version, seen))
  .flatMap(([, keys]) => keys))];

const settingDef = (key) => game.settings.settings.get(`${M}.${key}`);

const visible = (def) => !!def && REPORTED_TYPES.has(def.type) && (game.user.isGM || def.scope !== 'world');

const differs = (key) => game.settings.get(M, key) !== settingDef(key).default;

const sections = (only) => {
  const out = [];
  const placed = new Set();
  const take = (key) => {
    if (typeof key !== 'string' || placed.has(key)) return null;
    const def = settingDef(key);
    if (!visible(def)) return null;
    placed.add(key);
    if (only && !only.includes(key)) return null;
    return differs(key) ? key : null;
  };

  for (const [id, menu] of game.settings.menus) {
    if (!id.startsWith(`${M}.`) || (menu.restricted && !game.user.isGM)) continue;
    let keys;
    try { keys = menu.type?.regularKeys; } catch { keys = null; }
    if (!Array.isArray(keys)) continue;
    const rows = keys.map(take).filter(Boolean);
    if (rows.length) out.push({ id, name: game.i18n.localize(menu.name), rows });
  }

  const general = [...game.settings.settings.values()]
    .filter((def) => def.namespace === M && def.config)
    .map((def) => take(def.key))
    .filter(Boolean);
  if (general.length) out.push({ id: 'general', name: game.i18n.localize('DSCT.settingsReport.general'), rows: general });
  return out;
};

const valueLabel = (def, value) => {
  if (def.type === Boolean) return game.i18n.localize(value ? 'DSCT.settingsReport.on' : 'DSCT.settingsReport.off');
  if (def.choices && value in def.choices) return game.i18n.localize(def.choices[value]);
  if (value === '' || value == null) return game.i18n.localize('DSCT.settingsReport.empty');
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};

const restore = async (keys) => {
  let reload = false;
  for (const key of keys) {
    const def = settingDef(key);
    if (!visible(def) || !differs(key)) continue;
    await game.settings.set(M, key, def.default);
    if (def.requiresReload) reload = true;
  }
  if (reload) foundry.applications.settings.SettingsConfig.reloadConfirm({ world: game.user.isGM });
};

const iconButton = (icon, tip, onClick) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dsct-report-btn';
  btn.innerHTML = `<i class="${icon}"></i>`;
  btn.setAttribute('aria-label', tip.title);
  setTip(btn, tip);
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    try { await onClick(); }
    finally { btn.disabled = false; }
  });
  return btn;
};

const buildRow = (key) => {
  const def = settingDef(key);
  const li = document.createElement('li');
  li.className = 'dsct-report-row';

  const name = document.createElement('span');
  name.className = 'dsct-report-name';
  name.textContent = game.i18n.localize(def.name);
  li.append(name);

  if (def.scope === 'client') {
    const here = document.createElement('i');
    here.className = 'fa-solid fa-desktop dsct-report-client';
    setTip(here, tipFor('reportClient'));
    name.append(here);
  }

  const version = changedIn(key);
  if (version) {
    const tag = document.createElement('span');
    tag.className = 'dsct-report-tag';
    tag.textContent = game.i18n.format('DSCT.settingsReport.changedIn', { version });
    setTip(tag, tipFor('reportChanged', { data: { version } }));
    li.append(tag);
  }

  const values = document.createElement('span');
  values.className = 'dsct-report-values';
  const mine = document.createElement('strong');
  mine.textContent = valueLabel(def, game.settings.get(M, key));
  values.append(mine, document.createTextNode(' '),
    document.createTextNode(game.i18n.format('DSCT.settingsReport.default', { value: valueLabel(def, def.default) })));
  li.append(values);

  li.append(iconButton('fa-solid fa-rotate-left', tipFor('reportReset'), () => restore([key])));
  return li;
};

const buildSection = (section, open) => {
  const box = document.createElement('details');
  box.className = 'dsct-report-section';
  box.dataset.section = section.id;
  box.open = open;

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.className = 'dsct-report-title';
  title.textContent = section.name;
  const count = document.createElement('span');
  count.className = 'dsct-report-count';
  count.textContent = section.rows.length;
  summary.append(title, count, iconButton('fa-solid fa-arrow-rotate-left', tipFor('reportRestore'), async () => {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DSCT.settingsReport.confirmTitle') },
      content: `<p>${game.i18n.format('DSCT.settingsReport.confirmBody', { section: section.name, count: section.rows.length })}</p>`,
      rejectClose: false,
    });
    if (ok) await restore(section.rows);
  }));
  box.append(summary);

  const list = document.createElement('ul');
  list.className = 'dsct-report-rows';
  list.append(...section.rows.map(buildRow));
  box.append(list);
  return box;
};

const fill = (root) => {
  const only = root.dataset.keys ? root.dataset.keys.split(',') : null;
  const open = new Set([...root.querySelectorAll('.dsct-report-section[open]')].map((d) => d.dataset.section));
  const found = sections(only);

  const head = document.createElement('div');
  head.className = 'dsct-startup-head';
  head.textContent = game.i18n.localize(only ? 'DSCT.settingsReport.titleChanged' : 'DSCT.settingsReport.title');

  const blurb = document.createElement('p');
  blurb.className = 'dsct-startup-blurb';
  blurb.textContent = game.i18n.localize(found.length
    ? (only ? 'DSCT.settingsReport.blurbChanged' : 'DSCT.settingsReport.blurb')
    : 'DSCT.settingsReport.none');

  root.replaceChildren(head, blurb, ...found.map((s) => buildSection(s, open.has(s.id))));
};

const refreshAll = () => {
  for (const root of document.querySelectorAll('.dsct-report[data-filled]')) fill(root);
};

const post = (keys) => ChatMessage.create({
  content: `<div class="dsct-startup dsct-report" data-keys="${keys?.join(',') ?? ''}">${game.i18n.localize('DSCT.settingsReport.title')}</div>`,
  whisper: [game.user.id],
  flags: { [M]: { settingsReport: true } },
});

const anyDiffer = (keys) => sections(keys).length > 0;

export const showSettingsReport = async () => {
  if (!anyDiffer(null)) {
    ui.notifications.info(game.i18n.localize('DSCT.settingsReport.none'));
    return null;
  }
  return post(null);
};

export class SettingsReportMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: 'Settings Report', template: null });
  }
  async _render() {
    await showSettingsReport();
  }
  async _updateObject() {}
}

export const registerSettingsReport = () => {
  Hooks.on('renderChatMessageHTML', (msg, html) => {
    if (!msg.getFlag(M, 'settingsReport')) return;
    const root = html.querySelector('.dsct-report');
    if (!root) return;
    root.dataset.filled = '1';
    fill(root);
  });

  for (const hook of ['updateSetting', 'createSetting', 'clientSettingChanged']) {
    Hooks.on(hook, (setting) => {
      const key = typeof setting === 'string' ? setting : setting?.key;
      if (key?.startsWith(`${M}.`)) refreshAll();
    });
  }

  Hooks.once('ready', async () => {
    const seen = game.settings.get(M, SEEN);
    const version = game.modules.get(M).version;
    if (seen === version) return;
    const keys = seen ? changedSince(seen) : null;
    await game.settings.set(M, SEEN, version);
    if (keys && !keys.length) return;
    if (!anyDiffer(keys)) return;
    try { await post(keys); }
    catch (err) { console.warn('DSCT | settings report | could not post:', err); }
  });
};
