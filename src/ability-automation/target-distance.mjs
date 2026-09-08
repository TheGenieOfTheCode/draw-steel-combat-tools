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
    _drawDashedLine(g, from, to, color);
    const squares = Math.round(tokFootprintDist(src, t) / CGD) + 1;
    const label = new PIXI.Text(String(squares), {
      fontFamily: 'Signika, sans-serif', fontSize: 22, fontWeight: 'bold',
      fill: 0xffffff, stroke: 0x000000, strokeThickness: 5,
    });
    label.anchor.set(0.5);
    label.position.set((from.x + to.x) / 2, (from.y + to.y) / 2 - 12);
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
