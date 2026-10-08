import { ENHANCED_PACKS } from '../setup-macros.mjs';

const M = 'draw-steel-combat-tools';
const TRIGGERS = 'draw-steel-triggers';
const _entries = new Map();

async function loadEntries() {
  _entries.clear();
  for (const id of ENHANCED_PACKS) {
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

function enhance(spec, { line }) {
  const entry = _entries.get(line?.key);
  if (!entry || game.settings.get(M, 'enhancedAutoAdd') === false) return;
  for (const [id, effect] of Object.entries(entry.system?.effects ?? {})) {
    if (String(effect?.type ?? '').startsWith('dsct')) spec.system.effects[id] = foundry.utils.deepClone(effect);
  }
  if (entry.system?.power?.roll?.enabled) spec.system.power = foundry.utils.deepClone(entry.system.power);
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
