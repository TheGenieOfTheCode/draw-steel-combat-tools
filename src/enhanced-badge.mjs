import { ENHANCED_PACK } from './setup-macros.mjs';

const M = 'draw-steel-combat-tools';
const LOCK = 'enhancedLock';

let _dsids = null;

async function _loadIndex() {
  const pack = game.packs.get(ENHANCED_PACK);
  if (!pack) { _dsids = new Set(); return; }
  const index = await pack.getIndex({ fields: ['system._dsid'] });
  _dsids = new Set(index.map(e => e.system?._dsid).filter(Boolean));
}

export const isEnhancedLocked = (item) => !!item?.getFlag?.(M, LOCK);

export function hasDsctEffects(item) {
  const special = item?.system?.effects?.contents ?? [];
  if (special.some(e => String(e?.type ?? '').startsWith('dsct'))) return true;
  const power = item?.system?.power?.effects?.contents ?? [];
  return power.some(e => String(e?.type ?? '').startsWith('dsct'));
}

export function enhancedState(item) {
  if (isEnhancedLocked(item)) return 'ignored';
  if (item.getFlag(M, 'enhanced')) return 'enhanced';
  const dsid = item.system?._dsid;
  if (dsid && _dsids?.has(dsid)) return 'available';
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
  if (item?.documentName !== 'Item' || item.type !== 'ability') return;
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
