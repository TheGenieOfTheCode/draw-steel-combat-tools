const M = 'draw-steel-combat-tools';

let _ov = null;

const _holePad = () => Math.max(6, canvas.grid.size * 0.12);

function _redrawGrey() {
  if (!_ov) return;
  const d = canvas.dimensions;
  _ov.greyG.clear();
  _ov.greyG.beginFill(0x080810, 1);
  _ov.greyG.drawRect(d.rect.x, d.rect.y, d.rect.width, d.rect.height);
  _ov.greyG.endFill();

  _ov.holesG.clear();
  const pad = _holePad();
  const rects = [];
  for (const t of _ov.tokens) {
    if (!t?.document) continue;
    const w = t.document.width * canvas.grid.size;
    const h = t.document.height * canvas.grid.size;
    rects.push({ x: t.x - pad, y: t.y - pad, w: w + pad * 2, h: h + pad * 2 });
  }
  _ov.holesG.beginFill(0xffffff, 1);
  for (const r of rects) _ov.holesG.drawRoundedRect(r.x, r.y, r.w, r.h, pad);
  
  
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
      const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
      if (x1 > x0 && y1 > y0) _ov.holesG.drawRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  _ov.holesG.endFill();
}

export function beginPickerOverlay({ title, status = '', tokens = [], showConfirm = true, showCancel = true, onConfirm = null, onCancel = null } = {}) {
  endPickerOverlay();

  document.body.classList.add('dsct-prominent-picker');

  const bar = document.createElement('div');
  bar.id = 'dsct-picker-topbar';
  const confirmLabel = game.i18n.localize('DSCT.picker.confirm');
  const cancelLabel  = game.i18n.localize('DSCT.picker.cancel');
  bar.innerHTML = `
    <span class="dsct-picker-title"></span>
    <span class="dsct-picker-status"></span>
    <span class="dsct-picker-btns">
      <button type="button" class="dsct-picker-confirm" ${showConfirm ? '' : 'hidden'}><i class="fa-solid fa-check"></i> ${confirmLabel} <kbd>Enter</kbd></button>
      <button type="button" class="dsct-picker-cancel" ${showCancel ? '' : 'hidden'}><i class="fa-solid fa-xmark"></i> ${cancelLabel} <kbd>Esc</kbd></button>
    </span>`;
  bar.querySelector('.dsct-picker-title').textContent = title ?? '';
  bar.querySelector('.dsct-picker-status').textContent = status ?? '';
  bar.querySelector('.dsct-picker-confirm').addEventListener('click', (e) => { e.preventDefault(); _ov?.onConfirm?.(); });
  bar.querySelector('.dsct-picker-cancel').addEventListener('click', (e) => { e.preventDefault(); _ov?.onCancel?.(); });
  document.body.appendChild(bar);

  const container = new PIXI.Container();
  const greyG = new PIXI.Graphics();
  const holesG = new PIXI.Graphics();
  holesG.blendMode = PIXI.BLEND_MODES.ERASE;
  container.addChild(greyG, holesG);
  container.alpha = 0.7;
  container.filters = [new PIXI.AlphaFilter()];
  canvas.controls.addChild(container);

  _ov = {
    bar, container, greyG, holesG,
    statusEl: bar.querySelector('.dsct-picker-status'),
    tokens: [...tokens],
    lastStatus: status ?? '',
    warnTimer: null,
    onConfirm, onCancel,
  };
  _redrawGrey();

  return {
    setStatus(text) {
      if (!_ov) return;
      clearTimeout(_ov.warnTimer);
      _ov.warnTimer = null;
      _ov.lastStatus = text ?? '';
      _ov.statusEl.textContent = _ov.lastStatus;
      _ov.statusEl.classList.remove('dsct-warn');
    },
    flashWarning(text) {
      if (!_ov) { ui.notifications.warn(text); return; }
      clearTimeout(_ov.warnTimer);
      _ov.statusEl.textContent = text;
      _ov.statusEl.classList.add('dsct-warn');
      _ov.warnTimer = setTimeout(() => {
        if (!_ov) return;
        _ov.statusEl.textContent = _ov.lastStatus;
        _ov.statusEl.classList.remove('dsct-warn');
        _ov.warnTimer = null;
      }, 2500);
    },
    setTokens(list) {
      if (!_ov) return;
      _ov.tokens = [...list];
      _redrawGrey();
    },
    end() { endPickerOverlay(); },
  };
}

export function endPickerOverlay() {
  if (!_ov) return;
  clearTimeout(_ov.warnTimer);
  document.body.classList.remove('dsct-prominent-picker');
  _ov.bar.remove();
  _ov.container.parent?.removeChild(_ov.container);
  _ov.container.destroy({ children: true });
  _ov = null;
}

const _arrows = new Map();
let _arrowC = null;
let _arrowG = null;
let _arrowTickerFn = null;
let _arrowTime = 0;

function _ensureArrowLayer() {
  if (_arrowC && !_arrowC.destroyed) return;
  _arrowC = new PIXI.Container();
  _arrowG = new PIXI.Graphics();
  _arrowC.addChild(_arrowG);
  canvas.interface.addChild(_arrowC);
}

function _dispositionColor(token) {
  const dc = CONFIG.Canvas?.dispositionColors ?? {};
  switch (token.document?.disposition) {
    case CONST.TOKEN_DISPOSITIONS.FRIENDLY:
      return (token.actor?.hasPlayerOwner ? dc.PARTY : dc.FRIENDLY) ?? dc.FRIENDLY ?? 0x43dfdf;
    case CONST.TOKEN_DISPOSITIONS.HOSTILE:  return dc.HOSTILE ?? 0xe72124;
    case CONST.TOKEN_DISPOSITIONS.SECRET:   return dc.SECRET ?? 0xa612d4;
    default:                                return dc.NEUTRAL ?? 0xf1d836;
  }
}

function _drawArrowSet(g, token, color, alpha, m) {
  const GS = canvas.grid.size;
  const w = token.document.width * GS;
  const h = token.document.height * GS;
  const cx = token.x + w / 2;
  const cy = token.y + h / 2;
  const s    = GS * 0.3;
  const half = s * 0.4;
  const off  = 0.12 * m * GS;
  const lw   = 2 * (canvas.dimensions?.uiScale ?? 1);

  const tri = (tipX, tipY, dx, dy) => {
    const bx = tipX - dx * s;
    const by = tipY - dy * s;
    const px = -dy, py = dx;
    g.drawPolygon([tipX, tipY, bx + px * half, by + py * half, bx - px * half, by - py * half]);
  };

  g.lineStyle(lw, 0x000000, alpha);
  g.beginFill(color, alpha);
  tri(cx, token.y - off, 0, 1);
  tri(cx, token.y + h + off, 0, -1);
  tri(token.x - off, cy, 1, 0);
  tri(token.x + w + off, cy, -1, 0);
  g.endFill();
  g.lineStyle(0);
}

function _arrowTick() {
  _arrowTime += canvas.app.ticker.elapsedMS;
  const duration = 1400, pause = duration * 0.55, fade = (duration - pause) * 0.25;
  const t  = _arrowTime % duration;
  let   dt = Math.max(0, t - pause) / (duration - pause);
  dt = Math.sqrt(1 - Math.pow(Math.min(dt, 1) - 1, 2));
  const m  = t < pause ? 0.5 : 0.5 + 0.5 * dt;
  const ta = Math.max(0, t - duration + fade);
  const a  = 1 - ta / fade;
  if (!_arrowG || _arrowG.destroyed) return;
  _arrowG.clear();
  for (const [, e] of _arrows) {
    if (!e.token?.document || e.token.destroyed) continue;
    _drawArrowSet(_arrowG, e.token, _dispositionColor(e.token), Math.max(0, a) * (e.alphaMult ?? 1), m);
  }
}

export function setPickerArrow(token, color, alphaMult = 1) {
  color ??= token._getBorderColor?.() ?? 0xffffff;
  _ensureArrowLayer();
  const existing = _arrows.get(token.id);
  if (existing) { existing.color = color; existing.alphaMult = alphaMult; existing.token = token; return; }
  _arrows.set(token.id, { token, color, alphaMult });
  if (!_arrowTickerFn) {
    _arrowTime = 0;
    _arrowTickerFn = _arrowTick;
    canvas.app.ticker.add(_arrowTickerFn);
  }
}

export function removePickerArrow(token) {
  if (!token || !_arrows.has(token.id)) return;
  _arrows.delete(token.id);
  if (_arrows.size === 0) clearPickerArrows();
}

export function clearPickerArrows() {
  _arrows.clear();
  if (_arrowTickerFn) { canvas.app.ticker.remove(_arrowTickerFn); _arrowTickerFn = null; }
  if (_arrowC) {
    _arrowC.parent?.removeChild(_arrowC);
    _arrowC.destroy({ children: true });
    _arrowC = null;
    _arrowG = null;
  }
}
