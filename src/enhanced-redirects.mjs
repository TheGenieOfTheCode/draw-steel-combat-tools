import { ENHANCED_PACKS, enhancedDocKey, findEnhanced } from './setup-macros.mjs';

const M = 'draw-steel-combat-tools';
const GATES = new Set([`${M}.enhancedAutoAdd`, `${M}.enhancedSwapMode`]);

let _map = null;
let _applied = {};
let _targets = new Set();

const wanted = () => game.settings.get(M, 'enhancedAutoAdd') && game.settings.get(M, 'enhancedSwapMode') === 'always';

async function buildMap() {
  const index = new Map();
  for (const id of ENHANCED_PACKS) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    for (const e of await pack.getIndex({ fields: ['system._dsid', `flags.${M}.enhancedByName`, `flags.${M}.enhancedEffectsOnly`] })) {
      const key = enhancedDocKey(e);
      if (key && !e.flags?.[M]?.enhancedEffectsOnly) index.set(key, e);
    }
  }
  const map = {};
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== 'system' || pack.metadata.packageName !== game.system.id || pack.documentName !== 'Item') continue;
    for (const e of await pack.getIndex({ fields: ['system._dsid'] })) {
      const doc = findEnhanced(index, e);
      if (doc) map[e.uuid] = doc.uuid;
    }
  }
  return map;
}

function rebuildTree() {
  if (!game.compendiumUUIDRedirects) return;
  const tree = new foundry.utils.StringTree();
  for (const [prefix, replacement] of Object.entries(CONFIG.compendium.uuidRedirects)) {
    if (prefix.startsWith('Compendium.')) tree.addLeaf(prefix.split('.'), replacement.split('.'));
  }
  game.compendiumUUIDRedirects = tree;
}

async function refresh() {
  _map ??= await buildMap();
  const cfg = CONFIG.compendium.uuidRedirects;
  for (const [from, to] of Object.entries(_applied)) if (cfg[from] === to) delete cfg[from];
  _applied = {};
  if (wanted()) {
    for (const [from, to] of Object.entries(_map)) {
      if (from in cfg) continue;
      cfg[from] = to;
      _applied[from] = to;
    }
  }
  _targets = new Set(Object.values(_applied));
  rebuildTree();
  console.log(`DSCT | enhanced | ${Object.keys(_applied).length} system UUIDs point at their Enhanced versions.`);
}

const run = () => refresh().catch((err) => console.warn('DSCT | enhanced | could not set up UUID redirects:', err));

export const enhancedRedirects = () => ({ ..._applied });

export function registerEnhancedRedirects() {
  Hooks.once('ready', run);
  for (const hook of ['createSetting', 'updateSetting']) {
    Hooks.on(hook, (setting) => { if (GATES.has(setting.key)) run(); });
  }
  Hooks.on('preCreateItem', (item) => {
    if (item.pack || !_targets.has(item._stats?.compendiumSource)) return;
    item.updateSource({ [`flags.${M}.enhancedSwapped`]: true });
  });
}
