

const CORE = new Set(['dead', 'sleep', 'fly', 'burrow', 'blind', 'deaf', 'invisible']);

const DEALER = new Set(['burning', 'jolted', 'dazzled', 'delayed', 'captivated', 'soul-imprisoned']);

const ORDER = ['system', 'dsct', 'dealer', 'module', 'core'];

let _atInit = null;

const _statusIds = () => (Array.isArray(CONFIG.statusEffects)
  ? CONFIG.statusEffects.map(s => s?.id)
  : Object.keys(CONFIG.statusEffects ?? {})).filter(Boolean);

function _group(id) {
  if (id.startsWith('dsct')) return 'dsct';
  if (CORE.has(id)) return 'core';
  if (DEALER.has(id) && game.modules.get('draw-steel-dealer')?.active) return 'dealer';
  if (_atInit?.has(id)) return 'system';
  return 'module';
}

function _groupPalette(hud, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const pane = root?.querySelector('section.effect-pane');
  if (!pane || pane.dataset.dsctGrouped) return;

  const entries = [...pane.querySelectorAll('div.effect-group')];
  if (!entries.length) return;
  pane.dataset.dsctGrouped = '1';

  const buckets = new Map(ORDER.map(key => [key, []]));
  for (const entry of entries) buckets.get(_group(entry.dataset.statusId ?? '')).push(entry);

  pane.replaceChildren();
  for (const key of ORDER) {
    const items = buckets.get(key);
    if (!items.length) continue;
    const header = document.createElement('h4');
    header.className = 'dsct-status-header';
    header.textContent = game.i18n.localize(`DSCT.statusGroup.${key}`);
    pane.append(header, ...items);
  }
}

export function registerStatusPalette() {
  
  _atInit = new Set(_statusIds());
  Hooks.on('renderTokenHUD', _groupPalette);
}
