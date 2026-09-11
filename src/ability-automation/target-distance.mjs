import { getSetting, tokFootprintDist } from '../helpers.mjs';

let _layer = null;
let _raf = 0;

const _clearLayer = () => {
  if (_layer && !_layer.destroyed) {
    for (const c of [..._layer.children]) c.destroy({ children: true });
  }
};

const _ensureLayer = () => {
  if (_layer && !_layer.destroyed && _layer.parent) return _layer;
  _layer = new PIXI.Container();
  _layer.eventMode = 'none';
  canvas.controls.addChild(_layer);
  return _layer;
};

const _rayExit = (rect, from, dx, dy) => {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (!(rx > 0) || !(ry > 0)) return 0;

  const ox = (from.x - (rect.x + rx)) / rx;
  const oy = (from.y - (rect.y + ry)) / ry;
  const ux = dx / rx;
  const uy = dy / ry;

  const a = ux * ux + uy * uy;
  const b = 2 * (ox * ux + oy * uy);
  const c = ox * ox + oy * oy - 1;
  if (a <= 0) return 0;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;

  const t = (-b + Math.sqrt(disc)) / (2 * a);
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
};

const _drawDashedLine = (g, from, to, color) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  g.lineStyle(6, 0x000000, 0.55);
  g.moveTo(from.x, from.y);
  g.lineTo(to.x, to.y);
  const dash = 18, gap = 12;
  g.lineStyle(3.5, color, 0.95);
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(d + dash, len);
    g.moveTo(from.x + ux * d, from.y + uy * d);
    g.lineTo(from.x + ux * e, from.y + uy * e);
  }
};

const _redraw = () => {
  _clearLayer();
  if (!canvas?.ready) return;
  if (!getSetting('targetDistanceLines')) return;
  if (canvas.tokens.controlled.length !== 1) return;
  const src = canvas.tokens.controlled[0];
  const targets = [...game.user.targets].filter(t => t !== src && t.visible && !t.destroyed);
  if (!targets.length) return;

  const layer = _ensureLayer();
  const CGD   = canvas.grid.distance || 1;
  const color = Number(game.user.color) || 0xffffff;
  for (const t of targets) {
    const g = new PIXI.Graphics();
    const from = src.center;
    const to   = t.center;
    const dx   = to.x - from.x;
    const dy   = to.y - from.y;

    const tStart = _rayExit(src.bounds, from, dx, dy);
    const tEnd   = 1 - _rayExit(t.bounds, to, -dx, -dy);
    const start  = { x: from.x + dx * tStart, y: from.y + dy * tStart };
    const end    = { x: from.x + dx * tEnd,   y: from.y + dy * tEnd };

    
    if (tEnd > tStart) _drawDashedLine(g, start, end, color);

    const squares = Math.round(tokFootprintDist(src, t) / CGD) + 1;
    const label = new PIXI.Text(String(squares), {
      fontFamily: 'Signika, sans-serif', fontSize: 22, fontWeight: 'bold',
      fill: 0xffffff, stroke: 0x000000, strokeThickness: 5,
    });
    label.anchor.set(0.5);
    label.position.set((start.x + end.x) / 2, (start.y + end.y) / 2 - 12);
    layer.addChild(g, label);
  }
};

const _queueRedraw = () => {
  if (_raf) return;
  _raf = requestAnimationFrame(() => { _raf = 0; _redraw(); });
};

export const registerTargetDistance = () => {
  Hooks.on('targetToken', _queueRedraw);
  Hooks.on('controlToken', _queueRedraw);
  Hooks.on('refreshToken', (token) => {
    if (!getSetting('targetDistanceLines')) return;
    if (!token.controlled && !token.isTargeted) return;
    _queueRedraw();
  });
  Hooks.on('canvasReady', () => { _layer = null; _queueRedraw(); });
  Hooks.on('canvasTearDown', () => { _layer = null; });
};
