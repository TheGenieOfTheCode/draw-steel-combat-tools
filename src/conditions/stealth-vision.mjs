import { hasSightToToken } from '../helpers.mjs';
import { beginPickerOverlay, endPickerOverlay } from '../ability-automation/picker-overlay.mjs';
import { coverWithBurrow as hasCover } from './burrow.mjs';
import { isConcealed, hiddenFrom } from './stealth.mjs';

const STATE = {
  hidden:  { color: 0x4a90d9, key: 'hidden' },
  blind:   { color: 0x3ec46d, key: 'blind' },
  covered: { color: 0xe0a020, key: 'covered' },
  seen:    { color: 0xd04040, key: 'seen' },
};

const EXEMPT = 'dsct-picker-exempt';
export const markPanelExempt = (on) =>
  document.getElementById('dsct-stealth-panel')?.classList.toggle(EXEMPT, !!on);

let _active = null;
let _layer = null;
const _tints = new Map();

function _ensureLayer() {
  if (_layer && !_layer.destroyed && _layer.parent) return _layer;
  _layer = new PIXI.Container();
  _layer.eventMode = 'none';
  canvas.controls.addChild(_layer);
  return _layer;
}

function _clearLayer() {
  if (!_layer || _layer.destroyed) return;
  for (const child of [..._layer.children]) child.destroy({ children: true });
}

function _drawTints() {
  const layer = _ensureLayer();
  _clearLayer();

  for (const [id, color] of _tints) {
    const token = canvas.tokens.get(id);
    if (!token || token.destroyed) continue;

    const g = new PIXI.Graphics();
    g.beginFill(color, 0.4);
    g.drawRoundedRect(token.x, token.y, token.w, token.h, 6);
    g.endFill();
    g.lineStyle(3, color, 0.95);
    g.drawRoundedRect(token.x, token.y, token.w, token.h, 6);
    layer.addChild(g);
  }
}

const _hex = (color) => '#' + color.toString(16).padStart(6, '0');

function _paintLegend() {
  const el = document.querySelector('#dsct-picker-topbar .dsct-picker-detail');
  if (!el) return;

  el.hidden = false;
  el.replaceChildren(...Object.values(STATE).map(state => {
    const span = document.createElement('span');
    span.className = 'dsct-stealth-key';
    span.style.color = _hex(state.color);
    span.textContent = game.i18n.localize(`DSCT.panel.stealth.legend.${state.key}`);
    return span;
  }));
}

function _classify(observer, token, alreadyHidden) {
  if (alreadyHidden.has(observer.id)) return STATE.hidden;
  if (!hasSightToToken(observer, token)) return STATE.blind;
  if (isConcealed(token) || hasCover(observer, token)) return STATE.covered;
  return STATE.seen;
}

function _paint() {
  if (!_active) return;
  const token = canvas.tokens.get(_active.tokenId);
  if (!token) return endStealthVision();

  const alreadyHidden = hiddenFrom(token);
  const counts = { hidden: 0, blind: 0, covered: 0, seen: 0 };
  const lit = [token];

  _tints.clear();
  for (const other of canvas.tokens.placeables) {
    if (other.id === token.id || !other.actor) continue;
    if (other.document.disposition === token.document.disposition) continue;

    const state = _classify(other, token, alreadyHidden);
    counts[state.key]++;
    _tints.set(other.id, state.color);
    lit.push(other);
  }

  
  _active.overlay?.setTokens?.(lit);
  _drawTints();

  _active.overlay?.setStatus?.(game.i18n.format('DSCT.panel.stealth.visionStatus', {
    seen: counts.seen,
    could: counts.blind + counts.covered,
    hidden: counts.hidden,
  }));
}

export function endStealthVision() {
  if (!_active) return;
  for (const [hook, fn] of _active.hooks) Hooks.off(hook, fn);
  _tints.clear();
  _clearLayer();
  if (_layer && !_layer.destroyed) _layer.destroy({ children: true });
  _layer = null;
  markPanelExempt(false);
  endPickerOverlay();
  _active = null;
}

export function beginStealthVision(token) {
  endStealthVision();
  if (!token) return;

  const overlay = beginPickerOverlay({
    title: game.i18n.format('DSCT.panel.stealth.visionTitle', { name: token.name }),
    detail: ' ',
    tokens: [token],
    hideUi: true,
    uiToggle: true,
    showConfirm: false,
    showCancel: true,
    frame: false,
    onCancel: endStealthVision,
  });

  
  const repaint = () => _paint();
  const hooks = [['refreshToken', repaint], ['updateToken', repaint], ['controlToken', repaint],
    ['createActiveEffect', repaint], ['deleteActiveEffect', repaint]];
  for (const [hook, fn] of hooks) Hooks.on(hook, fn);

  _active = { tokenId: token.id, overlay, hooks };
  markPanelExempt(true);
  _paintLegend();
  _paint();
}

export const stealthVisionActive = () => !!_active;

export const toggleStealthVision = (token) =>
  (_active ? endStealthVision() : beginStealthVision(token));
