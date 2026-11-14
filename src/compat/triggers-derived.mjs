import { enhancedPackIds } from '../setup-macros.mjs';

const M = 'draw-steel-combat-tools';
const TRIGGERS = 'draw-steel-triggers';
const _entries = new Map();

async function loadEntries() {
  _entries.clear();
  for (const id of enhancedPackIds()) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: [`flags.${M}.derivedLine`] });
    for (const row of index) {
      const lines = row.flags?.[M]?.derivedLine;
      if (!lines) continue;
      const doc = await pack.getDocument(row._id);
      if (!doc) continue;
      for (const key of [lines].flat()) _entries.set(key, doc.toObject());
    }
  }
}

const FLAT_INLINE = /\[\[\/flat\s+[^\]]+]](?!])\{([^}]+)}/g;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


function placeInline(spec, entry) {
  const texts = Object.values(spec.system.effects ?? {}).filter((e) => e?.type === 'base' && e.description);
  for (const own of Object.values(entry.system?.effects ?? {})) {
    for (const m of String(own?.type === 'base' ? own.description ?? '' : '').matchAll(FLAT_INLINE)) {
      const rx = new RegExp(`(^|>|[^\\w\\]}])(${escapeRx(m[1])})(?![\\w}])`, 'i');
      const host = texts.find((e) => rx.test(e.description) && !e.description.includes(m[0]));
      if (host) host.description = host.description.replace(rx, (_, lead, phrase) => `${lead}${m[0].replace(/\{[^}]+}$/, `{${phrase}}`)}`);
    }
  }
}

function enhance(spec, { line }) {
  const entry = _entries.get(line?.key);
  if (!entry || game.settings.get(M, 'enhancedAutoAdd') === false) return;
  for (const [id, effect] of Object.entries(entry.system?.effects ?? {})) {
    if (String(effect?.type ?? '').startsWith('dsct')) spec.system.effects[id] = foundry.utils.deepClone(effect);
  }
  if (entry.system?.power?.roll?.enabled) spec.system.power = foundry.utils.deepClone(entry.system.power);
  if (entry.system?.distance?.type && entry.system.distance.type !== 'special') {
    spec.system.distance = foundry.utils.deepClone(entry.system.distance);
    spec.system.target = foundry.utils.deepClone(entry.system.target);
  }
  if (entry.effects?.length) spec.effects = foundry.utils.deepClone(entry.effects);
  placeInline(spec, entry);
  const { derivedLine, ...flags } = entry.flags?.[M] ?? {};
  spec.flags[M] = { ...flags, enhanced: true, enhancedDerived: true };
}

export function registerTriggersDerived() {
  Hooks.on('draw-steel-triggers.derivedSpec', enhance);
  Hooks.once('ready', async () => {
    await loadEntries();
    if (_entries.size) game.modules.get(TRIGGERS)?.api?.refreshDerived?.();
  });
}
