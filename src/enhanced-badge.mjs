import { ENHANCED_PACKS, enhancedKey } from './setup-macros.mjs';

const M = 'draw-steel-combat-tools';
const LOCK = 'enhancedLock';

export const BADGED_TYPES = new Set(['ability', 'feature', 'kit']);

let _dsids = null;

async function _loadIndex() {
  _dsids = new Set();
  for (const id of ENHANCED_PACKS) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ['system._dsid'] });
    for (const e of index) {
      const key = enhancedKey(e.type, e.system?._dsid);
      if (key) _dsids.add(key);
    }
  }
}

export const isEnhancedLocked = (item) => !!item?.getFlag?.(M, LOCK);

export function hasDsctEffects(item) {
  const special = item?.system?.effects?.contents ?? [];
  if (special.some(e => String(e?.type ?? '').startsWith('dsct'))) return true;
  const power = item?.system?.power?.effects?.contents ?? [];
  if (power.some(e => String(e?.type ?? '').startsWith('dsct'))) return true;
  
  
  
  for (const effect of (item?.effects ?? [])) {
    const changes = [...(effect.system?.changes ?? []), ...(effect.changes ?? [])];
    if (changes.some(c => String(c?.key ?? '').includes(M))) return true;
  }
  return false;
}

export function enhancedState(item) {
  if (isEnhancedLocked(item)) return 'ignored';
  if (item.getFlag(M, 'enhanced')) return 'enhanced';
  const key = enhancedKey(item.type, item.system?._dsid);
  if (key && _dsids?.has(key)) return 'available';
  if (hasDsctEffects(item)) return 'automated';
  return 'none';
}

const _ICONS = { enhanced: 'fa-toolbox', available: 'fa-wand-magic-sparkles', ignored: 'fa-lock', automated: 'fa-gears', none: 'fa-toolbox' };

const _TOGGLEABLE = new Set(['enhanced', 'available', 'ignored']);

function _badge(item) {
  const state = enhancedState(item);
  const L = (k) => game.i18n.localize(`DSCT.enhancedBadge.${k}`);
  const canToggle = _TOGGLEABLE.has(state) && item.isOwner;
  const a = document.createElement('a');
  a.className = `dsct-enh-bubble is-${state}${canToggle ? '' : ' is-static'}`;
  a.dataset.state = state;
  a.innerHTML = `<i class="fas ${_ICONS[state]}"></i>`;
  const click = canToggle ? ` ${L(state === 'ignored' ? 'unlockHint' : 'lockHint')}` : '';
  a.dataset.tooltip = `<strong>${L(`${state}.label`)}</strong><br>${L(`${state}.hint`)}${click}`;

  if (canToggle) {
    
    a.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    a.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (isEnhancedLocked(item)) await item.unsetFlag(M, LOCK);
      else await item.setFlag(M, LOCK, true);
    });
  }
  return a;
}

function _inject(app) {
  const item = app.document;
  if (item?.documentName !== 'Item' || !BADGED_TYPES.has(item.type)) return;
  const header = app.element?.querySelector?.('.window-header');
  if (!header) return;
  
  header.querySelector('.dsct-enh-bubble')?.remove();
  header.insertBefore(_badge(item), header.querySelector('.window-title'));
}

export function registerEnhancedBadge() {
  Hooks.once('ready', () => { _loadIndex().catch(() => { _dsids = new Set(); }); });
  Hooks.on('renderDrawSteelItemSheet', (app) => {
    try { _inject(app); }
    catch (err) { console.warn('DSCT | enhanced badge |', err); }
  });
}
