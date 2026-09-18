import { beginPickerOverlay, endPickerOverlay } from '../ability-automation/picker-overlay.mjs';
import { sightLinesToToken } from '../helpers.mjs';
import { suggestObserving } from './observation.mjs';
import { setFoundryTargets } from '../ability-automation/target-picker.mjs';
import { suppressHealthEstimate } from '../compat/health-estimate-compat.mjs';
import { hideCandidates, hideTraitsOf } from './stealth.mjs';
import { forbiddenToHide } from './stealth-traits.mjs';

const M = 'draw-steel-combat-tools';

const OBSERVING = 0x3ec46d;
const BLIND = 0xd04444;
const GROUND = 0xe0a020;
const MEMORY = 0x9a6fd0;
const HARM = 0xd07a2a;

const L = (k, data) => (data ? game.i18n.format(`DSCT.observation.${k}`, data) : game.i18n.localize(`DSCT.observation.${k}`));

let _active = null;

let _legendAt = null;

const LEGEND_ROWS = [
  ['observing', 'ring', OBSERVING],
  ['notObserving', 'ring', BLIND],
  ['ground', 'square', GROUND],
  ['lastSeen', 'square', MEMORY],
  ['lastHarm', 'square', HARM],
  ['sightClear', 'line', OBSERVING],
  ['sightBlocked', 'line', BLIND],
];

const _hex = (color) => `#${color.toString(16).padStart(6, '0')}`;

function _tokenScreenRects() {
  const view = canvas.app?.view?.getBoundingClientRect?.();
  const tf = canvas.stage?.worldTransform;
  if (!view || !tf) return [];

  const out = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.visible) continue;
    const tl = tf.apply({ x: token.x, y: token.y });
    const br = tf.apply({ x: token.x + token.w, y: token.y + token.h });
    out.push({
      left: view.left + tl.x, top: view.top + tl.y,
      right: view.left + br.x, bottom: view.top + br.y,
    });
  }
  return out;
}

const _overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function _legendCovers(el) {
  const box = el.getBoundingClientRect();
  return _tokenScreenRects().some(r => _overlaps(box, r));
}

function _placeLegend(el) {
  const box = el.getBoundingClientRect();
  const w = box.width || 220;
  const h = box.height || 200;
  const rects = _tokenScreenRects();

  const xs = [0.18, 0.68, 0.06, 0.8];
  const ys = [0.3, 0.5, 0.15, 0.68];
  let fallback = null;

  for (const fx of xs) {
    for (const fy of ys) {
      const left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, window.innerWidth * fx)));
      const top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, window.innerHeight * fy)));
      const spot = { left, top, right: left + w, bottom: top + h };
      fallback ??= { left, top };
      if (!rects.some(r => _overlaps(spot, r))) return { left, top };
    }
  }
  return fallback ?? { left: 12, top: 120 };
}

function _buildLegend() {
  const el = document.createElement('div');

  el.className = 'dsct-obs-legend dsct-picker-exempt';
  el.innerHTML = `<div class="dsct-obs-legend-head"><i class="fa-solid fa-grip-lines"></i> ${L('legend.title')}</div>`;

  const body = document.createElement('div');
  body.className = 'dsct-obs-legend-body';
  for (const [key, shape, color] of LEGEND_ROWS) {
    const row = document.createElement('div');
    row.className = 'dsct-obs-legend-row';
    const swatch = document.createElement('span');
    swatch.className = `dsct-obs-swatch dsct-obs-swatch--${shape}`;
    swatch.style.setProperty('--dsct-obs-color', _hex(color));
    const text = document.createElement('span');
    text.textContent = L(`legend.${key}`);
    row.append(swatch, text);
    body.appendChild(row);
  }
  el.appendChild(body);

  const head = el.querySelector('.dsct-obs-legend-head');
  let drag = null;
  head.addEventListener('pointerdown', (event) => {
    const box = el.getBoundingClientRect();
    drag = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    head.setPointerCapture(event.pointerId);
    event.stopPropagation();
  });
  head.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const left = Math.max(0, Math.min(window.innerWidth - 60, event.clientX - drag.dx));
    const top = Math.max(0, Math.min(window.innerHeight - 40, event.clientY - drag.dy));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    _legendAt = { left, top };
    el.classList.toggle('is-over-tokens', _legendCovers(el));
  });
  const stop = (event) => { drag = null; head.releasePointerCapture?.(event.pointerId); };
  head.addEventListener('pointerup', stop);
  head.addEventListener('pointercancel', stop);

  document.body.appendChild(el);

  const at = _legendAt ?? _placeLegend(el);
  el.style.left = `${at.left}px`;
  el.style.top = `${at.top}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.classList.toggle('is-over-tokens', _legendCovers(el));
  return el;
}

function _layer() {
  if (_active.layer && !_active.layer.destroyed) return _active.layer;
  const layer = new PIXI.Container();
  layer.eventMode = 'none';
  canvas.controls.addChild(layer);
  _active.layer = layer;
  return layer;
}

function _clear() {
  const layer = _active?.layer;
  if (!layer || layer.destroyed) return;
  for (const child of [...layer.children]) child.destroy({ children: true });
}

function _ring(layer, token, color) {
  const g = new PIXI.Graphics();
  g.beginFill(color, 0.14);
  g.drawRoundedRect(token.x, token.y, token.w, token.h, 6);
  g.endFill();
  g.lineStyle(3, color, 0.95);
  g.drawRoundedRect(token.x, token.y, token.w, token.h, 6);
  layer.addChild(g);
}

function _square(layer, gx, gy, color, alpha, inset = 2) {
  const GS = canvas.grid.size;
  const g = new PIXI.Graphics();
  g.beginFill(color, alpha);
  g.drawRoundedRect(gx * GS + inset, gy * GS + inset, GS - inset * 2, GS - inset * 2, 4);
  g.endFill();
  layer.addChild(g);
}

function _drawDetail(layer, observer, hider) {
  const view = _active.views.get(observer.id);
  if (!view) return;

  for (const sq of view.near.squares) _square(layer, sq.x, sq.y, GROUND, 0.3);

  if (view.lastSeen) {
    _square(layer, view.lastSeen.at.x, view.lastSeen.at.y, MEMORY, 0.5, 6);
  }
  if (view.lastHarm) {
    _square(layer, view.lastHarm.at.x, view.lastHarm.at.y, HARM, 0.5, 6);
  }

  for (const line of sightLinesToToken(observer, hider)) {
    const g = new PIXI.Graphics();
    g.lineStyle(1.5, line.blocked ? BLIND : OBSERVING, line.blocked ? 0.25 : 0.7);
    g.moveTo(line.from.x, line.from.y);
    const end = (line.blocked && line.hit) ? line.hit : line.to;
    g.lineTo(end.x, end.y);
    layer.addChild(g);
  }
}

function _detailLines(observer) {
  const view = _active.views.get(observer.id);
  if (!view) return [];
  const lines = [L(`reason.${view.reason}`), L('detailCover', { covered: view.near.obscured, total: view.near.total })];
  if (view.lastSeen && !view.lastSeen.clear) lines.push(L('detailLastSeen', { round: view.lastSeen.round ?? '?' }));
  if (view.lastHarm) lines.push(L('detailHarm', { round: view.lastHarm.round ?? '?' }));
  return lines;
}

function _hoverLabel(layer, observer) {
  const observing = _active.observing.has(observer.id);
  const color = observing ? OBSERVING : BLIND;
  const heading = `${observer.name} — ${L(observing ? 'legend.observing' : 'legend.notObserving')}`;

  const text = new PIXI.Text([heading, ..._detailLines(observer)].join('\n'), new PIXI.TextStyle({
    fontFamily: 'Signika, sans-serif',
    fontSize: 15,
    fill: 0xffffff,
    align: 'center',
    lineHeight: 19,
  }));
  text.anchor.set(0.5, 1);

  const padX = 8;
  const padY = 5;
  const box = new PIXI.Graphics();
  box.beginFill(0x11131a, 0.88);
  box.lineStyle(2, color, 0.95);
  box.drawRoundedRect(
    -text.width / 2 - padX, -text.height - padY * 2,
    text.width + padX * 2, text.height + padY * 2, 5);
  box.endFill();

  const group = new PIXI.Container();
  group.addChild(box, text);
  text.position.set(0, -padY);
  group.position.set(observer.center.x, observer.y - 6);

  const scale = 1 / (canvas.stage?.scale?.x || 1);
  if (scale > 1) group.scale.set(Math.min(scale, 2.5));

  layer.addChild(group);
}

function _paint() {
  if (!_active) return;
  const hider = canvas.tokens.get(_active.hiderId);
  if (!hider) return close(null);

  const layer = _layer();
  _clear();

  for (const observer of _active.observers) {
    _ring(layer, observer, _active.observing.has(observer.id) ? OBSERVING : BLIND);
  }

  const hovered = _active.hoverId ? canvas.tokens.get(_active.hoverId) : null;
  if (hovered) _drawDetail(layer, hovered, hider);

  const g = new PIXI.Graphics();
  g.lineStyle(2, 0xffffff, 0.8);
  g.drawRoundedRect(hider.x, hider.y, hider.w, hider.h, 6);
  layer.addChild(g);

  const observing = _active.observing.size;
  _active.overlay?.setStatus?.(L('status', {
    observing, hidden: _active.observers.length - observing,
  }));
  if (hovered) _hoverLabel(layer, hovered);
}

function _toggle(token) {
  if (!_active || !_active.observers.includes(token)) return;
  if (_active.observing.has(token.id)) _active.observing.delete(token.id);
  else _active.observing.add(token.id);
  _paint();
}

function _restoreSelection(saved) {
  if (!saved) return;
  try {
    canvas.tokens?.releaseAll?.();
    for (const id of saved.controlled) canvas.tokens.get(id)?.control({ releaseOthers: false });
    setFoundryTargets(saved.targets.map(id => canvas.tokens.get(id)).filter(Boolean));
  } catch (err) {
    console.warn('DSCT | observation | could not restore the selection:', err);
  }
}

function close(result) {
  if (!_active) return;
  const { resolve, hooks, listeners } = _active;
  for (const [hook, fn] of hooks) Hooks.off(hook, fn);
  for (const [el, type, fn, opts] of listeners) el.removeEventListener(type, fn, opts);
  if (_active.layer && !_active.layer.destroyed) _active.layer.destroy({ children: true });
  _active.legend?.remove();
  const saved = _active.saved;
  _active = null;
  suppressHealthEstimate(false);
  _restoreSelection(saved);
  endPickerOverlay();
  resolve(result);
}

export const observationPickerActive = () => !!_active;

export function runObservationPicker(hider, observers) {
  if (_active) close(null);
  if (!hider || !observers?.length) return Promise.resolve(new Set());

  return new Promise((resolve) => {
    const views = new Map();
    const observing = new Set();
    for (const observer of observers) {
      const view = suggestObserving(observer, hider);
      views.set(observer.id, view);
      if (view.observing) observing.add(observer.id);
    }

    const overlay = beginPickerOverlay({
      title: L('title', { name: hider.name }),
      detail: L('hint'),
      tokens: [hider, ...observers],
      hideUi: true,
      uiToggle: true,
      showConfirm: true,
      showCancel: true,
      onConfirm: () => close(new Set(_active.observing)),
      onCancel: () => close(null),
    });

    const onHover = (token, hovered) => {
      if (!_active) return;
      const id = hovered ? token.id : null;
      if (hovered && !_active.observers.includes(token)) return;
      if (!hovered && _active.hoverId !== token.id) return;
      _active.hoverId = id;
      _paint();
    };

    const onClick = (event) => {
      if (!_active) return;
      
      if (event.target?.closest?.('#dsct-picker-topbar, .dsct-obs-legend')) return;
      const token = canvas.tokens.placeables.find(t => t.hover && _active.observers.includes(t));
      if (!token) return;
      event.preventDefault();
      event.stopPropagation();
      _toggle(token);
    };

    const onPan = () => {
      if (_active?.legend) _active.legend.classList.toggle('is-over-tokens', _legendCovers(_active.legend));
    };
    const hooks = [['hoverToken', onHover], ['refreshToken', () => _paint()], ['canvasPan', onPan]];
    for (const [hook, fn] of hooks) Hooks.on(hook, fn);

    const listeners = [[window, 'pointerdown', onClick, true]];
    for (const [el, type, fn, opts] of listeners) el.addEventListener(type, fn, opts);

    const saved = {
      controlled: (canvas.tokens?.controlled ?? []).map(t => t.id),
      targets: [...(game.user.targets ?? [])].map(t => t.id),
    };
    canvas.tokens?.releaseAll?.();
    setFoundryTargets([]);

    suppressHealthEstimate(true);
    _active = { hiderId: hider.id, observers, views, observing, hoverId: null, overlay, hooks, listeners, resolve, layer: null, saved, legend: _buildLegend() };
    _paint();
  });
}

export async function askObservation(hider, observers) {
  if (game.user.isGM) {
    const result = await runObservationPicker(hider, observers);
    return result ? [...result] : null;
  }

  const socket = game.modules.get(M)?.api?.socket;
  if (!socket || !game.users.activeGM) {
    ui.notifications.info(L('noDirector'));
    return null;
  }

  ui.notifications.info(L('askDirector', { name: hider.name }));
  return socket.executeAsGM('dsct.askObservation', hider.id, observers.map(o => o.id));
}

export async function handleObservationRequest(hiderId, observerIds) {
  const hider = canvas.tokens.get(hiderId);
  const observers = observerIds.map(id => canvas.tokens.get(id)).filter(Boolean);
  if (!hider || !observers.length) return null;
  const result = await runObservationPicker(hider, observers);
  return result ? [...result] : null;
}

export async function proposeHideAsked(token, opts = {}) {
  
  if (forbiddenToHide(token)) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.stealth.cannotHide'));
    return null;
  }
  const traits = hideTraitsOf(token, opts);
  const candidates = hideCandidates(token);
  if (!candidates.length) return [];
  
  if (traits.hideWhileObserved) return candidates.map(t => t.id);

  const observing = await askObservation(token, candidates);
  if (observing === null) return null;

  const watching = new Set(observing);
  return candidates.filter(t => !watching.has(t.id)).map(t => t.id);
}
