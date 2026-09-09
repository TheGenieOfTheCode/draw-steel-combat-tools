let _layer = null;

const _ensureLayer = () => {
  if (_layer && !_layer.destroyed && _layer.parent) return _layer;
  _layer = new PIXI.Graphics();
  _layer.eventMode = 'none';
  canvas.controls.addChild(_layer);
  return _layer;
};

const _center = (token) => {
  const GS = canvas.grid.size;
  return {
    x: token.x + (token.document.width ?? 1) * GS * 0.5,
    y: token.y + (token.document.height ?? 1) * GS * 0.5,
  };
};

const _drawDashed = (g, from, to, color) => {
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

const _drawChecker = (g, from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const SEG = 18;
  let d = 0, flip = false;
  while (d < len) {
    const end = Math.min(d + SEG, len);
    g.lineStyle(5, flip ? 0xFFD700 : 0x1A1A1A, 0.95);
    g.moveTo(from.x + ux * d, from.y + uy * d);
    g.lineTo(from.x + ux * end, from.y + uy * end);
    d = end;
    flip = !flip;
  }
};

export const clearSourceLines = () => {
  if (_layer && !_layer.destroyed) _layer.clear();
};

export const drawSourceLines = (anchorToken, sourceTokens, style = 'dashed') => {
  if (!canvas?.ready || !anchorToken) return;
  const targets = (Array.isArray(sourceTokens) ? sourceTokens : [sourceTokens]).filter(Boolean);
  if (!targets.length) return;

  const g = _ensureLayer();
  g.clear();
  const from  = _center(anchorToken);
  const color = Number(game.user.color) || 0xffffff;
  for (const tok of targets) {
    if (tok.id === anchorToken.id) continue;
    if (!tok.visible) continue;
    const to = _center(tok);
    if (style === 'primary') _drawChecker(g, from, to);
    else _drawDashed(g, from, to, color);
  }
};

export const registerSourceLineHooks = () => {
  Hooks.on('canvasTearDown', () => { _layer = null; });
};
