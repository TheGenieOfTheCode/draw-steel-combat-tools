import { getSetting } from './helpers.mjs';

const M = 'draw-steel-combat-tools';

const BAR_W  = 112;
const BAR_H  = 10;
const PAD    = 6;
const NAME_H = 15;
const NUM_H  = 13;
const HUD_W  = BAR_W + PAD * 2;
const HUD_H  = PAD * 2 + NAME_H + 4 + BAR_H + 4 + NUM_H;

const GROUP_TINTS = {
  1: 0xff4444, 2: 0x4488ff, 3: 0x44dd44,  4: 0xffcc00,
  5: 0xff44ff, 6: 0x44ffff, 7: 0xff8800,  8: 0xaa44ff,
  9: 0x00ff88, 10: 0xff88aa,
};


const _squadHuds = new Map();
let _hudTicker   = null;
let _moveHandler = null;
let _upHandler   = null;
let _drag        = null; 

let _drawBarFromHud  = false;
let _stickbugTime    = 0;    
let _stickbugAnim         = null; 
let _lastStickbugTrigger  = 0;   

const ARRANGE_DUR     = 2000;  
const DANCE_DUR       = 7200;  
const STICKBUG_COOLDOWN = 60000; 



const _hudScale = () => getSetting('squadHudScale') || 1;

function _dims() {
  const f    = (canvas?.grid?.size ?? 100) / 100 * _hudScale();
  const barW = Math.round(BAR_W  * f);
  const barH = Math.round(BAR_H  * f);
  const pad  = Math.round(PAD    * f);
  const nameH = Math.round(NAME_H * f);
  const numH  = Math.round(NUM_H  * f);
  const hudW  = barW + pad * 2;
  const hudH  = pad * 2 + nameH + 4 + barH + 4 + numH;
  return { barW, barH, pad, nameH, numH, hudW, hudH, f };
}

function _squadDataList() {
  if (!game.combat || !canvas?.tokens) return [];
  const out = [];
  for (const group of game.combat.groups?.contents ?? []) {
    if (group.type !== 'squad') continue;
    const allMinions = [...group.members].filter(c => c.actor?.system?.isMinion);
    if (!allMinions.length) continue;
    const living = allMinions.filter(c => !c.defeated);
    if (!living.length) continue;
    const tokens = living
      .map(c => canvas.tokens.placeables.find(t => t.id === c.tokenId))
      .filter(Boolean);
    if (!tokens.length) continue;

    const num      = parseInt(group.name.match(/^Group (\d+)/i)?.[1]) || 1;
    const indivMax = living[0]?.actor?.system?.stamina?.max ?? 0;
    const maxHP    = allMinions.length * indivMax;
    const currHP   = group.system?.staminaValue ?? (living.length * indivMax);

    out.push({
      groupId: group.id,
      name:    group.name,
      total:   allMinions.length,
      living:  living.length,
      currHP,
      maxHP,
      tokens,
      tint:   GROUP_TINTS[num] ?? 0xffffff,
      hidden: group.hidden ?? false,
    });
  }
  return out;
}

function _centroid(tokens) {
  if (!tokens?.length) return null;
  const gs = canvas.grid.size;
  let sx = 0, sy = 0;
  for (const t of tokens) {
    sx += t.x + (t.document.width  ?? 1) * gs / 2;
    sy += t.y + (t.document.height ?? 1) * gs / 2;
  }
  return { x: sx / tokens.length, y: sy / tokens.length };
}


function _hudTargetPos(tokens) {
  if (!tokens?.length) return null;
  const gs  = canvas.grid.size;
  const gap = 10;

  let sx = 0, sy = 0;
  for (const t of tokens) {
    sx += t.x + (t.document.width  ?? 1) * gs / 2;
    sy += t.y + (t.document.height ?? 1) * gs / 2;
  }
  const { hudW, hudH } = _dims();
  let hx = Math.round(sx / tokens.length - hudW / 2);
  let hy = Math.round(sy / tokens.length - hudH / 2);

  for (let pass = 0; pass < 2; pass++) {
    for (const t of tokens) {
      const tw = (t.document.width  ?? 1) * gs;
      const th = (t.document.height ?? 1) * gs;
      if (t.x + tw <= hx || t.x >= hx + hudW) continue;
      if (t.y + th <= hy || t.y >= hy + hudH) continue;
      hy = Math.min(hy, Math.round(t.y - hudH - gap));
    }
  }

  const rect = canvas.dimensions?.rect;
  if (rect) {
    hx = Math.max(rect.x, Math.min(hx, rect.x + rect.width  - hudW));
    hy = Math.max(rect.y, Math.min(hy, rect.y + rect.height - hudH));
  }

  return { x: hx, y: hy };
}



function _txt(str, style) {
  const t = new PIXI.Text(str, style);
  t.resolution = (window.devicePixelRatio || 1) * 4;
  return t;
}


const _easeInOutCosine = t => (1 - Math.cos(Math.PI * t)) / 2;


function _effectivePlayerVis(tokens) {
  if (game.user.isGM) return 'all';
  const override = tokens.some(t =>
    t.document.isOwner || t.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
  );
  return override ? 'all' : getSetting('squadHudPlayerVisibility');
}

function _lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, abl = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bbl = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16)
       | (Math.round(ag + (bg - ag) * t) << 8)
       |  Math.round(abl + (bbl - abl) * t);
}


function _drawBarGfx(barGfx, repToken, hp, maxHP, total, nativeW, nativeH) {
  if (!repToken || !barGfx || maxHP <= 0) return;
  _drawBarFromHud = true;
  try { repToken._drawBar(0, barGfx, { attribute: 'stamina', value: hp, max: maxHP }); }
  finally { _drawBarFromHud = false; }
  
  
  barGfx.position.set(0, 0);
  const dsto = game.modules.get('ds-token-override');
  if (dsto?.active && total > 1) {
    let ticksEnabled = true, tickColor = 0x000000;
    try {
      ticksEnabled = game.settings.get('ds-token-override', 'enableHealthbarTicks') ?? true;
      const hex = game.settings.get('ds-token-override', 'tickColor') ?? '#000000';
      tickColor = parseInt(hex.replace('#', ''), 16);
    } catch {  }
    if (ticksEnabled) {
      barGfx.lineStyle({ color: tickColor, width: 2 });
      const spacing = nativeW / total;
      for (let i = 1; i < total; i++) {
        barGfx.moveTo(spacing * i, 0);
        barGfx.lineTo(spacing * i, nativeH);
      }
    }
  }
}

function _openHudEditor(entry) {
  if (!game.user.isGM) return;
  const group = game.combat?.groups?.get(entry.groupId);
  if (!group) return;

  document.getElementById('dsct-squad-hp-editor')?.remove();

  
  const { hudW, hudH } = _dims();
  const pixiPt = canvas.controls.toGlobal({
    x: entry.container.x + hudW / 2,
    y: entry.container.y + hudH + 6,
  });
  const cr   = canvas.app.view.getBoundingClientRect();
  const left = Math.round(cr.left + pixiPt.x);
  const top  = Math.round(cr.top  + pixiPt.y);

  const wrap = document.createElement('div');
  wrap.id = 'dsct-squad-hp-editor';
  wrap.style.cssText = [
    'position:fixed', `left:${left - 40}px`, `top:${top}px`,
    'width:80px', 'background:#1a1a1a', 'border:1px solid #666',
    'border-radius:4px', 'padding:2px 4px', 'z-index:10000',
    'box-shadow:0 2px 6px rgba(0,0,0,.6)',
  ].join(';');

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = `${entry.currHP ?? 0}`;
  input.title = 'Enter value or delta (+3, -2)';
  input.style.cssText = 'width:100%;background:transparent;color:#fff;border:none;outline:none;font-size:15px;text-align:center;';
  wrap.appendChild(input);
  document.body.appendChild(wrap);
  input.focus();

  const commit = async () => {
    const raw = input.value.trim();
    wrap.remove();
    if (!raw) return;
    let newHP;
    if (raw.startsWith('+') || raw.startsWith('-')) {
      const delta = parseInt(raw, 10);
      if (!isNaN(delta)) newHP = Math.max(0, Math.min((entry.currHP ?? 0) + delta, entry.maxHP));
    } else {
      const abs = parseInt(raw, 10);
      if (!isNaN(abs)) newHP = Math.max(0, Math.min(abs, entry.maxHP));
    }
    if (newHP !== undefined && newHP !== entry.currHP) {
      await group.update({ 'system.staminaValue': newHP });
    }
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); wrap.remove(); }
    e.stopPropagation();
  });
  
  setTimeout(() => {
    const handler = (e) => { if (!wrap.contains(e.target)) { wrap.remove(); document.removeEventListener('pointerdown', handler); } };
    document.addEventListener('pointerdown', handler);
  }, 50);
}

function _buildContainer(data, entry, vis = 'all') {
  const { name, total, living, currHP, maxHP, tokens } = data;
  const { barW, barH, pad, nameH, hudW, hudH, f } = _dims();
  const iconSz  = Math.round(13 * f);
  const iconPad = Math.round(3  * f);
  const barY    = pad + nameH + 4;

  const c = new PIXI.Container();
  c.eventMode = 'static';
  c.interactiveChildren = true;

  const bg = new PIXI.Graphics();
  bg.beginFill(0x0e0e0e, 0.88);
  bg.lineStyle(1, 0x555555, 0.8);
  bg.drawRoundedRect(0, 0, hudW, hudH, Math.round(6 * f));
  bg.endFill();
  c.addChild(bg);

  const nameTx = _txt(name, {
    fontSize: Math.round(11 * f), fill: data.tint, fontWeight: 'bold',
    stroke: 0x000000, strokeThickness: 2,
  });
  nameTx.x = Math.round(hudW / 2 - nameTx.width / 2);
  nameTx.y = pad;
  c.addChild(nameTx);

  const repToken = tokens[0];
  const barGfx   = new PIXI.Graphics();
  const nativeW  = repToken?.w ?? canvas.grid.size;
  const nativeH  = 8 * (canvas.dimensions?.uiScale ?? 1) * ((repToken?.document?.height ?? 1) >= 2 ? 1.5 : 1);
  barGfx.scale.set(barW / nativeW, barH / nativeH);
  _drawBarGfx(barGfx, repToken, currHP, maxHP, total, nativeW, nativeH);
  barGfx.x = pad;
  barGfx.y = barY;
  c.addChild(barGfx);

  const hpStr = maxHP > 0 ? `${currHP} / ${maxHP}` : `${living} / ${total}`;
  const hpTx  = _txt(hpStr, { fontSize: Math.round(10 * f), fill: 0xdddddd });
  hpTx.x = Math.round(hudW / 2 - hpTx.width / 2);
  hpTx.y = barY + barH + 4;
  if (vis !== 'bar') c.addChild(hpTx);

  const lockSvg = new PIXI.SVGResource('icons/svg/padlock.svg', { scale: (window.devicePixelRatio || 1) * 4 });
  const lockGfx = new PIXI.Sprite(new PIXI.Texture(new PIXI.BaseTexture(lockSvg)));
  lockGfx.width   = iconSz;
  lockGfx.height  = iconSz;
  lockGfx.tint    = 0xcccccc;
  lockGfx.x = hudW - iconSz - iconPad;
  lockGfx.y = iconPad;
  lockGfx.visible = false;
  c.addChild(lockGfx);

  if (game.user.isGM) {
    const visSvg = new PIXI.SVGResource('icons/svg/blind.svg', { scale: (window.devicePixelRatio || 1) * 4 });
    const visGfx = new PIXI.Sprite(new PIXI.Texture(new PIXI.BaseTexture(visSvg)));
    visGfx.name   = 'vis-toggle';
    visGfx.width  = iconSz;
    visGfx.height = iconSz;
    visGfx.tint   = 0xffffff;
    visGfx.alpha  = data.hidden ? 1.0 : 0.3;
    visGfx.x      = iconPad;
    visGfx.y      = iconPad;
    c.addChild(visGfx);
  }

  if (data.hidden) {
    for (const child of c.children) {
      if (child.name !== 'vis-toggle') child.alpha = 0.4;
    }
  }


  let _lastTap = 0;
  c.on('pointerdown', (ev) => {
    
    if (ev.button === 2) {
      ev.stopPropagation();
      _openHudEditor(entry);
      return;
    }
    if (ev.button !== 0) return;

    
    const now = Date.now();
    if (now - _lastTap < 300) {
      ev.stopPropagation();
      _drag = null;
      _openHudEditor(entry);
      _lastTap = 0;
      return;
    }
    _lastTap = now;

    const local = ev.getLocalPosition(c);

    const { iconSz: _isz, iconPad: _ip, hudW: _hw } = (() => { const { hudW, f } = _dims(); return { iconSz: Math.round(18*f), iconPad: Math.round(4*f), hudW }; })();
    if (game.user.isGM && local.x >= _ip && local.x <= _ip + _isz && local.y >= _ip && local.y <= _ip + _isz) {
      ev.stopPropagation();
      const _group = game.combat?.groups?.get(entry.groupId);
      if (_group) {
        const _hidden  = !entry.hidden;
        const _updates = [..._group.members].map(m => ({ _id: m.id, hidden: _hidden }));
        if (_updates.length) _group.parent.updateEmbeddedDocuments('Combatant', _updates);
      }
      return;
    }

    if (entry.locked && local.x >= _hw - _ip - _isz && local.x <= _hw - _ip && local.y >= _ip && local.y <= _ip + _isz) {
      entry.locked  = false;
      entry.gliding = true;
      lockGfx.visible = false;
      if (game.user.isGM) {
        game.combat?.groups?.get(entry.groupId)?.unsetFlag(M, 'hudLock');
      }
      ev.stopPropagation();
      return;
    }
    const world = ev.data.getLocalPosition(canvas.app.stage);
    _drag = {
      entry,
      startWorld:     { x: world.x, y: world.y },
      startContainer: { x: c.x,     y: c.y     },
      moved: false,
    };
    ev.stopPropagation();
  });

  return { container: c, lockGfx, barGfx, repToken, nativeW, nativeH };
}


function _lineExitBox(px, py, dx, dy, bx, by, bw, bh) {
  let tBest = Infinity;
  const tryEdge = (t, ix, iy) => {
    if (t > 1e-9 && t < tBest &&
        ix >= bx - 0.5 && ix <= bx + bw + 0.5 &&
        iy >= by - 0.5 && iy <= by + bh + 0.5) tBest = t;
  };
  if (Math.abs(dx) > 1e-9) {
    let t; t = (bx       - px) / dx; tryEdge(t, bx,      py + t * dy);
            t = (bx + bw - px) / dx; tryEdge(t, bx + bw, py + t * dy);
  }
  if (Math.abs(dy) > 1e-9) {
    let t; t = (by       - py) / dy; tryEdge(t, px + t * dx, by);
            t = (by + bh - py) / dy; tryEdge(t, px + t * dx, by + bh);
  }
  if (!isFinite(tBest)) return { x: px, y: py };
  return { x: px + tBest * dx, y: py + tBest * dy };
}

function _redrawLines(lineGfx, container, tokens, tint, kneeScale = 1) {
  lineGfx.clear();
  if (!tokens.length) return;

  const isStickbug  = getSetting('stickbugMode') || (_stickbugAnim !== null);
  const isInArrange = _stickbugAnim !== null && _stickbugAnim.elapsed < ARRANGE_DUR;
  const lineColor   = isStickbug ? _lerpColor(tint ?? 0xffffff, 0x88ff88, kneeScale) : (tint ?? 0xffffff);
  
  const outlineAlpha = isStickbug ? (isInArrange ? (1 - kneeScale) * 0.75 : 0) : 0.75;
  const gs  = canvas.grid.size;
  const { hudW, hudH } = _dims();
  const hcx = container.x + hudW / 2;
  const hcy = container.y + hudH / 2;

  
  
  const paths = [];
  let visibleIdx = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t   = tokens[i];
    if (!t.visible) continue;
    const tw  = (t.document.width  ?? 1) * gs;
    const th  = (t.document.height ?? 1) * gs;
    const tcx = t.x + tw / 2;
    const tcy = t.y + th / 2;
    const dx  = hcx - tcx;
    const dy  = hcy - tcy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) { visibleIdx++; continue; }
    const r    = Math.min(tw, th) / 2;
    const from = { x: tcx + (dx / len) * r, y: tcy + (dy / len) * r };
    const to   = _lineExitBox(hcx, hcy, -dx, -dy, container.x, container.y, hudW, hudH);
    let knee = null;
    if (isStickbug) {
      const amp = Math.min(len * 0.2, 38);
      const px  = -dy / len;
      const py  =  dx / len;
      
      const dir = (visibleIdx % 2 === 0) ? 1 : -1;
      let kneeOff;
      if (isInArrange) {
        kneeOff = dir * amp * kneeScale;
      } else {
        const phase = (visibleIdx % 2 === 0) ? 0 : Math.PI;
        kneeOff = Math.tanh(Math.sin(_stickbugTime * 12.5 + phase) * 2.5) * amp * kneeScale;
      }
      knee = { x: (from.x + to.x) / 2 + px * kneeOff, y: (from.y + to.y) / 2 + py * kneeOff };
    }
    paths.push({ from, knee, to });
    visibleIdx++;
  }

  const drawPaths = () => {
    for (const { from, knee, to } of paths) {
      lineGfx.moveTo(from.x, from.y);
      if (knee) lineGfx.lineTo(knee.x, knee.y);
      lineGfx.lineTo(to.x, to.y);
    }
  };

  
  if (outlineAlpha > 0.01) {
    lineGfx.lineStyle(4.5, 0x000000, outlineAlpha);
    drawPaths();
  }

  
  lineGfx.lineStyle(2.5, lineColor, 0.9);
  drawPaths();
}



function _destroyEntry(entry) {
  if (entry.container?.parent) entry.container.parent.removeChild(entry.container);
  if (entry.lineGfx?.parent)   entry.lineGfx.parent.removeChild(entry.lineGfx);
  
  entry.container?.destroy({ children: true, texture: true, baseTexture: true });
  entry.lineGfx?.destroy();
}

export function clearSquadHuds() {
  for (const entry of _squadHuds.values()) _destroyEntry(entry);
  _squadHuds.clear();
  if (_hudTicker && canvas?.app) canvas.app.ticker.remove(_hudTicker);
  _hudTicker = null;
  _unregisterHandlers();
  _drag = null;
  _stickbugAnim = null;
}

function _restoreTokenBars(prevIds, newIds) {
  for (const id of prevIds) {
    if (newIds.has(id)) continue;
    const token = canvas.tokens.get(id);
    if (token?.destroyed) continue;
    if (token?.bars) token.bars.visible = true;
    token?.renderFlags?.set?.({ refreshBars: true });
  }
}

export function rebuildSquadHuds() {
  if (!canvas?.controls) return;

  
  const prevTokenIds = new Set();
  for (const entry of _squadHuds.values()) {
    for (const t of entry.tokens) prevTokenIds.add(t.id);
  }

  
  const savedLocks = new Map();
  for (const [id, e] of _squadHuds) {
    if (e.locked) savedLocks.set(id, { x: e.container.x, y: e.container.y });
  }

  for (const entry of _squadHuds.values()) _destroyEntry(entry);
  _squadHuds.clear();
  if (_hudTicker && canvas?.app) canvas.app.ticker.remove(_hudTicker);
  _hudTicker = null;
  _unregisterHandlers();
  _drag = null;

  if (!getSetting('squadHudEnabled')) {
    _restoreTokenBars(prevTokenIds, new Set());
    return;
  }
  for (const data of _squadDataList()) {
    const vis = _effectivePlayerVis(data.tokens);
    if (vis === 'none') continue;

    const isOwnerOrGM = game.user.isGM || data.tokens.some(t => t.document.isOwner);
    if (data.hidden && !isOwnerOrGM) continue;

    const hudPos = _hudTargetPos(data.tokens);
    if (!hudPos) continue;
    const { x, y } = hudPos;

    
    const lineGfx = new PIXI.Graphics();
    lineGfx.alpha = 0;
    canvas.controls.addChild(lineGfx);

    const entry = {
      groupId:   data.groupId,
      container: null,
      lineGfx,
      lockGfx:   null,
      barGfx:    null,
      repToken:  null,
      nativeW:   0,
      nativeH:   0,
      tokens:    data.tokens,
      tint:      data.tint,
      maxHP:     data.maxHP,
      currHP:    data.currHP,
      total:     data.total,
      hidden:    data.hidden,
      lineAlpha: 0,
      hovering:  false,
      locked:    false,
      gliding:   false,
      animFrom:  data.currHP,
      animTo:    data.currHP,
      animT:     1,
      animDur:   1000,
      swayPhase: Math.random() * Math.PI * 2,
      _sbSwayX:  0,
      _sbSwayY:  0,
    };

    const { container, lockGfx, barGfx, repToken, nativeW, nativeH } = _buildContainer(data, entry, vis);
    entry.container = container;
    entry.lockGfx   = lockGfx;
    entry.barGfx    = barGfx;
    entry.repToken  = repToken;
    entry.nativeW   = nativeW;
    entry.nativeH   = nativeH;
    container.x = x;
    container.y = y;
    canvas.controls.addChild(container);

    _redrawLines(lineGfx, container, data.tokens, data.tint);
    _squadHuds.set(data.groupId, entry);
  }

  
  const newTokenIds = new Set();
  for (const entry of _squadHuds.values()) {
    for (const t of entry.tokens) newTokenIds.add(t.id);
  }
  _restoreTokenBars(prevTokenIds, newTokenIds);

  
  for (const [id, entry] of _squadHuds) {
    const session = savedLocks.get(id);
    const group   = game.combat?.groups?.get(id);
    const stored  = session ?? group?.getFlag(M, 'hudLock') ?? null;
    if (!stored) continue;
    entry.locked = true;
    entry.container.x = stored.x;
    entry.container.y = stored.y;
    entry.lockGfx.visible = true;
    _redrawLines(entry.lineGfx, entry.container, entry.tokens, entry.tint);
  }

  if (_squadHuds.size) {
    _hudTicker = () => _tickHuds();
    canvas.app.ticker.add(_hudTicker);
    _registerHandlers();
  }
}

function _tickHuds() {
  const dt        = canvas.app.ticker.deltaMS;
  _stickbugTime  += dt / 1000;
  const lineStep  = dt / 150;
  const glideRate = dt / 200;

  
  let animKneeScale = 1;
  let isAnimActive  = false;
  if (_stickbugAnim !== null) {
    _stickbugAnim.elapsed += dt;
    const total = _stickbugAnim.elapsed;
    if (total < ARRANGE_DUR + DANCE_DUR) {
      isAnimActive  = true;
      
      animKneeScale = total < ARRANGE_DUR ? _easeInOutCosine(total / ARRANGE_DUR) : 1;
    } else {
      
      _stickbugAnim = null;
      for (const e of _squadHuds.values()) {
        e.container.rotation = 0;
        e.container.x -= e._sbSwayX;
        e.container.y -= e._sbSwayY;
        e._sbSwayX = 0;
        e._sbSwayY = 0;
        _redrawLines(e.lineGfx, e.container, e.tokens, e.tint);
        e.lineAlpha = 1; 
      }
    }
  }

  const stickbug    = getSetting('stickbugMode') || isAnimActive;
  
  const isInArrange = isAnimActive && _stickbugAnim !== null && _stickbugAnim.elapsed < ARRANGE_DUR;

  for (const entry of _squadHuds.values()) {
    
    if (entry.animT < 1) {
      entry.animT = Math.min(1, entry.animT + dt / entry.animDur);
      const eased = _easeInOutCosine(entry.animT);
      const animHP = entry.animFrom + (entry.animTo - entry.animFrom) * eased;
      _drawBarGfx(entry.barGfx, entry.repToken, animHP, entry.maxHP, entry.total, entry.nativeW, entry.nativeH);
      
      const { pad: _p, nameH: _nH } = _dims();
      entry.barGfx.x = _p;
      entry.barGfx.y = _p + _nH + 4;
    }

    if (stickbug) {
      
      entry.lineGfx.alpha = 1;
      entry.lineAlpha = 1;
      _redrawLines(entry.lineGfx, entry.container, entry.tokens, entry.tint, animKneeScale);
      
      const bodyRaw  = Math.tanh(Math.sin(_stickbugTime * 12.5 + entry.swayPhase) * 2);
      const newSwayX = isInArrange ? 0 : bodyRaw * 14;
      const newSwayY = isInArrange ? 0 : Math.tanh(Math.cos(_stickbugTime * 12.5 + entry.swayPhase) * 2) * 7;
      if (!entry.gliding) {
        entry.container.x += newSwayX - entry._sbSwayX;
        entry.container.y += newSwayY - entry._sbSwayY;
      }
      entry._sbSwayX = newSwayX;
      entry._sbSwayY = newSwayY;
      entry.container.rotation = isInArrange ? 0 : bodyRaw * 0.05;
    } else {
      
      if (entry._sbSwayX || entry._sbSwayY) {
        entry.container.x -= entry._sbSwayX;
        entry.container.y -= entry._sbSwayY;
        entry._sbSwayX = 0;
        entry._sbSwayY = 0;
      }
      entry.container.rotation = 0;
      
      const isHovered = entry.hovering
        || entry.tokens.some(t => t.controlled || game.user.targets.has(t));
      const lineTarget = isHovered ? (entry.hidden ? 0.4 : 1) : 0;
      if (entry.lineAlpha !== lineTarget) {
        const dir = lineTarget > entry.lineAlpha ? 1 : -1;
        entry.lineAlpha = Math.max(0, Math.min(1, entry.lineAlpha + dir * lineStep));
        entry.lineGfx.alpha = entry.lineAlpha;
      }
    }

    
    if (entry.gliding) {
      const pos = _hudTargetPos(entry.tokens);
      if (!pos) { entry.gliding = false; continue; }
      const tx = pos.x;
      const ty = pos.y;
      const dx = tx - entry.container.x;
      const dy = ty - entry.container.y;
      if (!isFinite(dx) || !isFinite(dy)) { entry.gliding = false; continue; }
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        entry.container.x = tx;
        entry.container.y = ty;
        entry.gliding = false;
      } else {
        const rate = Math.min(1, glideRate);
        entry.container.x += dx * rate;
        entry.container.y += dy * rate;
      }
      _redrawLines(entry.lineGfx, entry.container, entry.tokens, entry.tint);
    }
  }
}

export function nudgeSquadHud(tokenId) {
  if (!getSetting('squadHudEnabled')) return;
  for (const entry of _squadHuds.values()) {
    if (!entry.tokens.some(t => t.id === tokenId)) continue;
    if (!entry.locked && !entry.gliding) {
      const pos = _hudTargetPos(entry.tokens);
      if (!pos) continue;
      entry.container.x = pos.x;
      entry.container.y = pos.y;
    }
    
    if (!entry.gliding) _redrawLines(entry.lineGfx, entry.container, entry.tokens, entry.tint);
  }
}



function _registerHandlers() {
  _moveHandler = (event) => {
    const pos = event.data.getLocalPosition(canvas.app.stage);

    if (_drag) {
      const dx = pos.x - _drag.startWorld.x;
      const dy = pos.y - _drag.startWorld.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _drag.moved = true;
      _drag.entry.container.x = Math.round(_drag.startContainer.x + dx);
      _drag.entry.container.y = Math.round(_drag.startContainer.y + dy);
      _redrawLines(_drag.entry.lineGfx, _drag.entry.container, _drag.entry.tokens, _drag.entry.tint);
      return;
    }

    const gs = canvas.grid.size;
    for (const entry of _squadHuds.values()) {
      const cx = entry.container.x, cy = entry.container.y;
      const { hudW, hudH } = _dims();
      let hit = pos.x >= cx && pos.x <= cx + hudW && pos.y >= cy && pos.y <= cy + hudH;
      if (!hit) {
        for (const t of entry.tokens) {
          const tw = (t.document.width  ?? 1) * gs;
          const th = (t.document.height ?? 1) * gs;
          if (pos.x >= t.x && pos.x <= t.x + tw && pos.y >= t.y && pos.y <= t.y + th) {
            hit = true; break;
          }
        }
      }
      entry.hovering = hit;
    }
  };

  _upHandler = () => {
    if (_drag?.moved) {
      const e = _drag.entry;
      e.locked = true;
      e.lockGfx.visible = true;
      
      if (game.user.isGM) {
        game.combat?.groups?.get(e.groupId)?.setFlag(M, 'hudLock', { x: e.container.x, y: e.container.y });
      }
    }
    _drag = null;
  };

  canvas.stage.on('mousemove', _moveHandler);
  canvas.stage.on('pointerup', _upHandler);
}

function _unregisterHandlers() {
  if (_moveHandler) canvas.stage.off('mousemove', _moveHandler);
  if (_upHandler)   canvas.stage.off('pointerup', _upHandler);
  _moveHandler = null;
  _upHandler   = null;
}

export function getStickBugged() {
  if (!getSetting('squadHudEnabled') || _squadHuds.size === 0) {
    ui.notifications?.warn('No active squads with Squad HUD enabled.');
    return;
  }
  _stickbugAnim = { elapsed: 0 };
  
  for (const entry of _squadHuds.values()) {
    entry.lineAlpha = 1;
    entry.lineGfx.alpha = 1;
  }
  
  if (!_hudTicker && canvas?.app) {
    _hudTicker = () => _tickHuds();
    canvas.app.ticker.add(_hudTicker);
  }
  foundry.audio.AudioHelper.play({ src: 'modules/draw-steel-combat-tools/assets/Audio/Stickbug.mp3', volume: 0.8, loop: false }, false);
}



export function registerSquadHudHooks() {
  Hooks.on('canvasReady',    () => rebuildSquadHuds());
  Hooks.on('canvasTearDown', () => { clearSquadHuds(); document.getElementById('dsct-squad-hp-editor')?.remove(); });

  
  
  Hooks.on('renderDrawSteelTokenHUD', (app, html) => {
    if (!getSetting('squadHudEnabled')) return;
    const token = app.object;
    if (!token?.actor?.system?.isMinion) return;
    if (!game.combat) return;
    const combatant = game.combat.combatants.find(c => c.tokenId === token.id);
    if (combatant?.group?.type !== 'squad') return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root) return;
    
    
    root.querySelector('div.attribute.bar1')?.remove();
  });

  Hooks.on('refreshToken', (token) => {
    nudgeSquadHud(token.id);
    if (!getSetting('squadHudEnabled')) return;
    if (!game.user.isGM && getSetting('squadHudPlayerVisibility') === 'none') {
      if (!token.document.isOwner && token.document.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) return;
    }
    if (!token.actor?.system?.isMinion) return;
    if (!game.combat) return;
    const combatant = game.combat.combatants.find(c => c.tokenId === token.id);
    if (combatant?.group?.type === 'squad' && token.bars) token.bars.visible = false;
  });

  const _rebuild = foundry.utils.debounce(() => rebuildSquadHuds(), 150);
  Hooks.on('updateCombatant',      _rebuild);
  Hooks.on('deleteCombatant',      _rebuild);
  Hooks.on('createCombatant',      _rebuild);
  Hooks.on('deleteCombatantGroup', _rebuild);
  Hooks.on('createCombat',         _rebuild);
  Hooks.on('deleteCombat',         _rebuild);

  
  Hooks.on('updateCombatantGroup', (group, changes) => {
    const newHP = changes.system?.staminaValue;
    if (newHP !== undefined) {
      const entry = _squadHuds.get(group.id);
      if (entry) {
        const oldHP = entry.currHP ?? entry.maxHP;
        const pctChange = entry.maxHP > 0 ? Math.abs(newHP - oldHP) / entry.maxHP : 0;
        entry.animFrom = oldHP;
        entry.animTo   = newHP;
        entry.animT    = 0;
        entry.animDur  = Math.max(800, pctChange * 1500);
        entry.currHP   = newHP;
        
        const onlyHP = Object.keys(changes.system ?? {}).length === 1;
        if (onlyHP) return;
      }
    }
    _rebuild();
  });

  
  libWrapper.register(M, 'CONFIG.Token.objectClass.prototype._drawBar',
    function(wrapped, number, bar, data) {
      if (_drawBarFromHud) return wrapped(number, bar, data);
      if (!getSetting('squadHudEnabled')) return wrapped(number, bar, data);
      if (!game.user.isGM && getSetting('squadHudPlayerVisibility') === 'none') {
        if (!this.document.isOwner && this.document.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY)
          return wrapped(number, bar, data);
      }
      if (!this.actor?.system?.isMinion)  return wrapped(number, bar, data);
      if (!game.combat) return wrapped(number, bar, data);
      const combatant = game.combat.combatants.find(c => c.tokenId === this.id);
      if (combatant?.group?.type !== 'squad') return wrapped(number, bar, data);
      if (bar?.clear) bar.clear();
    }, 'MIXED');

  
  libWrapper.register(M, 'ds.data.CombatantGroup.SquadModel.prototype.displayMinionStaminaChange',
    function(wrapped, diff, damageType) {
      if (!getSetting('squadHudEnabled')) return wrapped(diff, damageType);
      const entry = _squadHuds.get(this.parent?.id ?? this.id);
      if (!entry) return wrapped(diff, damageType);
      if (!canvas.scene) return;
      const damageColor = ds.CONFIG?.damageTypes?.[damageType]?.color ?? null;
      const amount      = -1 * diff;
      const text        = (amount >= 0 ? `+${amount}` : `${amount}`);
      const fill        = damageColor ?? (diff < 0 ? 'lightgreen' : 'white');
      canvas.interface.createScrollingText(
        { x: entry.container.x + HUD_W / 2, y: entry.container.y },
        text,
        { fill, fontSize: 32, stroke: 0x000000, strokeThickness: 4 }
      );
    }, 'MIXED');

  
  
  if (game.modules.get('ds-token-override')?.active) {
    Hooks.on('hoverToken', (token, hovered) => {
      if (!hovered || !getSetting('squadHudEnabled')) return;
      if (!token.actor?.system?.isMinion) return;
      const inSquad = [..._squadHuds.values()].some(e => e.tokens.some(t => t.id === token.id));
      if (!inSquad) return;
      setTimeout(() => {
        const label = token.getChildByName?.('ds-health-labels');
        if (label) { label.visible = false; label.renderable = false; }
      }, 0);
    });
  }

  
  Hooks.on('createChatMessage', (message) => {
    if (!getSetting('stickbugChatTrigger')) return;
    if (!getSetting('squadHudEnabled') || _squadHuds.size === 0) return;
    const text = message.content.replace(/<[^>]+>/g, '').toLowerCase();
    if (!text.includes('lol get stick bugged')) return;
    const now = Date.now();
    if (now - _lastStickbugTrigger < STICKBUG_COOLDOWN) return;
    _lastStickbugTrigger = now;
    getStickBugged();
  });
}
