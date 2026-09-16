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

export function enhancedState(item) {
  if (isEnhancedLocked(item)) return 'ignored';
  if (item.getFlag(M, 'enhanced')) return 'enhanced';
  const dsid = item.system?._dsid;
  if (dsid && _dsids?.has(dsid)) return 'available';
  return 'none';
}

function _badge(item) {
  const state = enhancedState(item);
  const L = (k) => game.i18n.localize(`DSCT.enhancedBadge.${k}`);
  const a = document.createElement('a');
  a.className = `dsct-enh-badge is-${state}`;
  a.dataset.state = state;
  const icon = { enhanced: 'fa-toolbox', available: 'fa-wand-magic-sparkles', ignored: 'fa-lock', none: 'fa-toolbox' }[state];
  a.innerHTML = `<i class="fas ${icon}"></i><span>${L(`${state}.label`)}</span>`;
  const hint = L(`${state}.hint`);
  const click = state !== 'none' && item.isOwner ? ` ${L(state === 'ignored' ? 'unlockHint' : 'lockHint')}` : '';
  a.dataset.tooltip = `${hint}${click}`;

  if (state !== 'none' && item.isOwner) {
    a.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if (isEnhancedLocked(item)) await item.unsetFlag(M, LOCK);
      else await item.setFlag(M, LOCK, true);
    });
  } else {
    a.classList.add('is-static');
  }
  return a;
}

function _inject(app, element) {
  const item = app.document;
  if (item?.documentName !== 'Item' || item.type !== 'ability') return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const host = root?.querySelector('.sheet-header .document-name');
  if (!host || host.querySelector('.dsct-enh-badge')) return;
  host.classList.add('dsct-has-enh-badge');
  host.append(_badge(item));
}

export function registerEnhancedBadge() {
  Hooks.once('ready', () => { _loadIndex().catch(() => { _dsids = new Set(); }); });
  Hooks.on('renderDrawSteelItemSheet', (app, element) => {
    try { _inject(app, element); }
    catch (err) { console.warn('DSCT | enhanced badge |', err); }
  });
}
