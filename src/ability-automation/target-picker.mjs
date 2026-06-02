import { getSetting, tokFootprintDist, getItemRange } from '../helpers.mjs';
import {
  setRaisedDeadVisible,
  addPreviewToken,
  removePreviewToken,
  activateTokenLayer,
} from '../death-tracker/defeated-token-visibility.mjs';

const M = 'draw-steel-combat-tools';


const _dsctPreTargeted = new Set();

const _cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);

const _sightBlockedPoints = (from, to) => {
  for (const w of canvas.walls.placeables) {
    if (!w.document.sight) continue;
    const c = w.document.c;
    const d1 = _cross(c[0], c[1], c[2], c[3], from.x, from.y);
    const d2 = _cross(c[0], c[1], c[2], c[3], to.x,   to.y);
    const d3 = _cross(from.x, from.y, to.x, to.y, c[0], c[1]);
    const d4 = _cross(from.x, from.y, to.x, to.y, c[2], c[3]);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
};


const _CELL_SAMPLES = [
  [0.5, 0.5],
  [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9],
];


const _hasAnySightTo = (casterToken, targetToken) => {
  const GS   = canvas.grid.size;
  const w    = Math.max(1, Math.round(targetToken.document.width));
  const h    = Math.max(1, Math.round(targetToken.document.height));
  const from = casterToken.center;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const cellX = targetToken.x + dx * GS;
      const cellY = targetToken.y + dy * GS;
      for (const [fx, fy] of _CELL_SAMPLES) {
        if (!_sightBlockedPoints(from, { x: cellX + fx * GS, y: cellY + fy * GS })) return true;
      }
    }
  }
  return false;
};

const _defeatedStatus = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
const _isDefeated     = (t) => t.actor?.statuses?.has(_defeatedStatus()) ?? false;
const _hidingDefeated = () => (game.user.getFlag(M, 'hideDefeated') ?? false) === true;



function _isPickerEligible(ability) {
  const target = ability.system?.target;
  if (!target?.value) return false;
  if (target.type === 'self') return false;
  if (ability.system?.keywords?.has('area')) return false;
  return true;
}

function _getCasterToken(ability) {
  const actor = ability.actor ?? ability.parent;
  if (!actor) return null;
  return canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
      ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
}

export function _getValidTargets(casterToken, targetType, range, { excludeSelf = false, checkLOS = false } = {}) {
  const CGD      = canvas.grid.distance;
  const hasRange = range > 0 && !isNaN(range);
  const cDisp    = casterToken.document.disposition;

  const inRange  = (t) => !hasRange || tokFootprintDist(casterToken, t) < range * CGD;
  const alive    = (t) => !_isDefeated(t) && !t.document.hidden;
  const dead     = (t) => _isDefeated(t);
  const sameDisp = (t) => t.document.disposition === cDisp;
  const isSelf   = (t) => t.id === casterToken.id;

  return canvas.tokens.placeables.filter(t => {
    if (!inRange(t)) return false;
    if (excludeSelf && isSelf(t)) return false;

    let valid;
    switch (targetType) {
      case 'creature':       valid = alive(t); break;
      case 'ally':           valid = !isSelf(t) && alive(t) && sameDisp(t); break;
      case 'enemy':          valid = !isSelf(t) && alive(t) && !sameDisp(t); break;
      case 'object':         valid = dead(t); break;
      case 'creatureObject': valid = alive(t) || dead(t); break;
      case 'enemyObject':    valid = (!isSelf(t) && alive(t) && !sameDisp(t)) || dead(t); break;
      case 'selfOrAlly':     valid = isSelf(t) || (alive(t) && sameDisp(t)); break;
      case 'selfOrCreature': valid = isSelf(t) || alive(t); break;
      case 'selfAlly':       valid = isSelf(t) || (alive(t) && sameDisp(t)); break;
      default:               valid = alive(t); break;
    }
    if (!valid) return false;

    
    if (checkLOS && !isSelf(t) && !_hasAnySightTo(casterToken, t)) return false;
    return true;
  });
}

async function _runTargetPicker(ability, casterToken) {
  const target      = ability.system.target;
  const maxTargets  = target.value;
  const targetType  = target.type;
  const range       = getItemRange(ability);
  const needsReveal = /object/i.test(targetType);
  const isStrike    = ability.system?.keywords?.has('strike') ?? false;
  const excludeSelf = isStrike || (ability.system?.keywords?.has('weapon') ?? false);
  const cDisp       = casterToken.document.disposition;

  if (needsReveal) { setRaisedDeadVisible(true); activateTokenLayer(); }

  const validTokens = _getValidTargets(casterToken, targetType, range, { excludeSelf, checkLOS: true });

  if (!validTokens.length) {
    if (needsReveal) { setRaisedDeadVisible(false); activateTokenLayer(); }
    ui.notifications.warn(game.i18n.localize('DSCT.notice.targetPicker.noValidTargets'));
    return null;
  }

  const hlName = 'dsct-target-picker-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const selectedTokens = new Set();
  const maxS = maxTargets !== 1 ? 's' : '';

  const isAllyToken = (t) => isStrike && t.document.disposition === cDisp;

  let hoveredId = null;

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    if (range != null && range > 0) {
      const gs  = canvas.grid.size;
      const cw  = Math.max(1, Math.round(casterToken.document.width));
      const ch  = Math.max(1, Math.round(casterToken.document.height));
      const cx0 = Math.floor(casterToken.x / gs);
      const cy0 = Math.floor(casterToken.y / gs);
      for (let rx = cx0 - range; rx <= cx0 + cw - 1 + range; rx++) {
        for (let ry = cy0 - range; ry <= cy0 + ch - 1 + range; ry++) {
          if (rx >= cx0 && rx < cx0 + cw && ry >= cy0 && ry < cy0 + ch) continue;
          const dx = Math.max(0, cx0 - rx, rx - (cx0 + cw - 1));
          const dy = Math.max(0, cy0 - ry, ry - (cy0 + ch - 1));
          if (Math.max(dx, dy) > range) continue;
          canvas.interface.grid.highlightPosition(hlName, { x: rx * gs, y: ry * gs, color: 0x002211, border: 0x00CC66 });
        }
      }
    }
    for (const t of validTokens) {
      const sel   = selectedTokens.has(t.id);
      const ally  = isAllyToken(t);
      const hover = t.id === hoveredId && !sel;
      
      const color  = sel   ? (ally ? 0xFF4400 : 0x44CC44)
                   : hover ? (ally ? 0xFFAA44 : 0x66AAFF)
                   :          (ally ? 0xFF8800 : 0x4488FF);
      const border = sel   ? (ally ? 0xAA2200 : 0x228822)
                   : hover ? (ally ? 0xCC6622 : 0x4477CC)
                   :          (ally ? 0xAA4400 : 0x2244AA);
      const w = Math.max(1, Math.round(t.document.width));
      const h = Math.max(1, Math.round(t.document.height));
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          const gx = Math.floor(t.x / canvas.grid.size) * canvas.grid.size + dx * canvas.grid.size;
          const gy = Math.floor(t.y / canvas.grid.size) * canvas.grid.size + dy * canvas.grid.size;
          canvas.interface.grid.highlightPosition(hlName, { x: gx, y: gy, color, border });
        }
      }
    }
  };

  drawHighlights();

  return new Promise(resolve => {
    const notif = ui.notifications.info(
      game.i18n.format('DSCT.notice.targetPicker.instruction', { max: maxTargets, s: maxS }),
      { permanent: true },
    );

    if (getSetting('deathPickerDimAll')) _syncReticles(validTokens, selectedTokens, null);

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      _clearPickerReticles();
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
      if (needsReveal) { setRaisedDeadVisible(false); activateTokenLayer(); }
    };

    const doConfirm = () => {
      const selected   = validTokens.filter(t => selectedTokens.has(t.id));
      const deadPicked = needsReveal ? selected.filter(t => _isDefeated(t)) : [];
      cleanup();
      if (deadPicked.length) {
        deadPicked.forEach(t => addPreviewToken(t.id));
        activateTokenLayer();
        Hooks.once('closeAbilityConfigurationDialog', () => {
          deadPicked.forEach(t => removePreviewToken(t.id));
          activateTokenLayer();
        });
      }
      if (isStrike) {
        const allyPicked = selected.filter(t => isAllyToken(t));
        if (allyPicked.length) {
          const names = allyPicked.map(t => t.name).join(', ');
          const verb  = allyPicked.length === 1 ? 'is' : 'are';
          ui.notifications.warn(game.i18n.format('DSCT.notice.targetPicker.allyStrikeWarning', { names, verb }));
        }
      }
      resolve(selected);
    };

    const onMove = (event) => {
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = _hitToken(pos, validTokens);
      const newId = hit?.id ?? null;
      if (newId === hoveredId) return;
      hoveredId = newId;
      drawHighlights();
      _syncReticles(validTokens, selectedTokens, hoveredId);
    };

    const onClick = (event) => {
      if (event.data.originalEvent.button === 2) {
        if (getSetting('cancelOnRightClick')) {
          cleanup();
          ui.notifications.info(game.i18n.localize('DSCT.notice.targetPicker.cancelled'));
          resolve(null);
        }
        return;
      }
      if (event.data.originalEvent.button !== 0) return;

      const pos     = event.data.getLocalPosition(canvas.app.stage);
      const clicked = _hitToken(pos, validTokens);
      if (!clicked) {
        const now = Date.now();
        if (now - (onClick._lastEmptyClick ?? 0) < 400) { onClick._lastEmptyClick = 0; doConfirm(); }
        else onClick._lastEmptyClick = now;
        return;
      }

      if (selectedTokens.has(clicked.id)) {
        selectedTokens.delete(clicked.id);
      } else {
        if (selectedTokens.size >= maxTargets) {
          if (!onClick._warnCooldown) {
            ui.notifications.warn(game.i18n.format('DSCT.notice.targetPicker.maxTargets', { max: maxTargets, s: maxS }));
            onClick._warnCooldown = setTimeout(() => { delete onClick._warnCooldown; }, 3000);
          }
          return;
        }
        selectedTokens.add(clicked.id);
      }
      drawHighlights();
      _syncReticles(validTokens, selectedTokens, hoveredId);
      if (getSetting('autoConfirmSelection') && selectedTokens.size >= maxTargets) doConfirm();
    };

    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (selectedTokens.size === 0) {
          ui.notifications.warn(game.i18n.localize('DSCT.notice.targetPicker.selectAtLeastOne'));
          return;
        }
        doConfirm();
      } else if (event.key === 'Escape') {
        cleanup();
        ui.notifications.info(game.i18n.localize('DSCT.notice.targetPicker.cancelled'));
        resolve(null);
      }
    };

    const onContextMenu = (e) => {
      e.preventDefault();
      if (getSetting('cancelOnRightClick')) {
        cleanup();
        ui.notifications.info(game.i18n.localize('DSCT.notice.targetPicker.cancelled'));
        resolve(null);
      }
    };

    canvas.stage.on('mousedown', onClick);
    canvas.stage.on('mousemove', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContextMenu);
  });
}

export function setFoundryTargets(tokens) {
  [...game.user.targets].forEach(t => t.setTarget(false, { releaseOthers: false }));
  tokens.forEach(t => t.setTarget(true, { user: game.user, releaseOthers: false }));
}

function _drawTokenHighlights(hlName, tokens, selectedIds = null, hoverIds = null) {
  canvas.interface.grid.clearHighlightLayer(hlName);
  const GS = canvas.grid.size;
  for (const t of tokens) {
    const sel   = selectedIds ? selectedIds.has(t.id) : false;
    const hover = hoverIds    ? hoverIds.has(t.id)    : false;
    const color  = sel ? 0x44CC44 : (hover ? 0x22AAFF : 0x4488FF);
    const border = sel ? 0x228822 : (hover ? 0x1188CC : 0x2244AA);
    const w = Math.max(1, Math.round(t.document.width));
    const h = Math.max(1, Math.round(t.document.height));
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const gx = Math.floor(t.x / GS) * GS + dx * GS;
        const gy = Math.floor(t.y / GS) * GS + dy * GS;
        canvas.interface.grid.highlightPosition(hlName, { x: gx, y: gy, color, border });
      }
    }
  }
}

function _hitToken(pos, candidates) {
  const GS = canvas.grid.size;
  return candidates.find(t => {
    const tw = t.document.width  * GS;
    const th = t.document.height * GS;
    return pos.x >= t.x && pos.x <= t.x + tw && pos.y >= t.y && pos.y <= t.y + th;
  }) ?? null;
}

export async function runSourcePicker() {
  const hiding  = _hidingDefeated();
  const visible = canvas.tokens.placeables.filter(t => !t.document.hidden && !(hiding && _isDefeated(t)));
  const candidates = game.user.isGM ? visible : visible.filter(t => t.isOwner);
  if (!candidates.length) return null;
  if (candidates.length === 1) { candidates[0].control(); return candidates[0]; }

  const hlName = 'dsct-source-picker-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const hoverIds = new Set();
  _drawTokenHighlights(hlName, candidates, new Set(), hoverIds);

  return new Promise(resolve => {
    const notif = ui.notifications.info(
      game.i18n.localize('DSCT.notice.picker.chooseSource'), { permanent: true },
    );

    if (getSetting('deathPickerDimAll')) {
      for (const c of candidates) _addPickerReticle(c, c._getBorderColor(), 0.5);
    }

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      _clearPickerReticles();
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
    };

    const onMove = (event) => {
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = _hitToken(pos, candidates);
      const newId = hit?.id ?? null;
      const prevId = [...hoverIds][0] ?? null;
      if (newId === prevId) return;
      hoverIds.clear();
      if (hit) { hoverIds.add(hit.id); _addPickerReticle(hit, hit._getBorderColor(), 1.0); }
      if (prevId && prevId !== newId) {
        const prev = canvas.tokens.get(prevId);
        if (prev) {
          if (getSetting('deathPickerDimAll')) _addPickerReticle(prev, prev._getBorderColor(), 0.5);
          else _removePickerReticle(prev);
        }
      }
      _drawTokenHighlights(hlName, candidates, new Set(), hoverIds);
    };

    const onClick = (event) => {
      if (event.data.originalEvent.button === 2) {
        if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); }
        return;
      }
      if (event.data.originalEvent.button !== 0) return;
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = _hitToken(pos, candidates);
      if (!hit) return;
      cleanup();
      hit.control();
      resolve(hit);
    };

    const onKey   = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
    const onContextMenu = (e) => { e.preventDefault(); if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); } };

    canvas.stage.on('mousedown', onClick);
    canvas.stage.on('mousemove', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContextMenu);
  });
}

export async function runMultiTokenPicker({ candidates = null, hint = null, maxTargets = Infinity } = {}) {
  const hiding = _hidingDefeated();
  const tokens = candidates ?? canvas.tokens.placeables.filter(t => !t.document.hidden && !(hiding && _isDefeated(t)));
  if (!tokens.length) return null;

  const hlName = 'dsct-multi-picker-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const selectedIds = new Set();
  let hoveredId = null;
  _drawTokenHighlights(hlName, tokens, selectedIds);

  return new Promise(resolve => {
    const notif = ui.notifications.info(
      hint ?? game.i18n.localize('DSCT.notice.picker.chooseTargets'), { permanent: true },
    );

    if (getSetting('deathPickerDimAll')) {
      for (const t of tokens) _addPickerReticle(t, t._getBorderColor(), 0.5);
    }

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      _clearPickerReticles();
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
    };

    const doConfirm = () => { cleanup(); resolve(tokens.filter(t => selectedIds.has(t.id))); };

    const onMove = (event) => {
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = _hitToken(pos, tokens);
      const newId = hit?.id ?? null;
      if (newId === hoveredId) return;
      hoveredId = newId;
      _drawTokenHighlights(hlName, tokens, selectedIds, hoveredId ? new Set([hoveredId]) : new Set());
      _syncReticles(tokens, selectedIds, hoveredId);
    };

    const onClick = (event) => {
      if (event.data.originalEvent.button === 2) {
        if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); }
        return;
      }
      if (event.data.originalEvent.button !== 0) return;
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = _hitToken(pos, tokens);
      if (!hit) return;
      if (selectedIds.has(hit.id)) {
        selectedIds.delete(hit.id);
      } else {
        if (selectedIds.size >= maxTargets) selectedIds.clear();
        selectedIds.add(hit.id);
      }
      _drawTokenHighlights(hlName, tokens, selectedIds, hoveredId ? new Set([hoveredId]) : new Set());
      _syncReticles(tokens, selectedIds, hoveredId);
      if (selectedIds.size >= maxTargets) doConfirm();
    };

    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doConfirm();
      } else if (event.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    const onContextMenu = (e) => { e.preventDefault(); if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); } };

    canvas.stage.on('mousedown', onClick);
    canvas.stage.on('mousemove', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContextMenu);
  });
}



const _pickerReticles = new Map(); 
let   _pickerTickerFn = null;
let   _pickerTime     = 0;

export function _addPickerReticle(token, color, alphaMult = 1) {
  color ??= token._getBorderColor();
  const existing = _pickerReticles.get(token.id);
  if (existing) { existing.color = color; existing.alphaMult = alphaMult; return; }
  const was = token.targeted.has(game.user);
  if (!was) token.targeted.add(game.user);
  _pickerReticles.set(token.id, { token, color, alphaMult, was });
  if (!_pickerTickerFn) {
    _pickerTime     = 0;
    _pickerTickerFn = () => {
      _pickerTime += canvas.app.ticker.elapsedMS;
      const duration = 2000, pause = duration * 0.6, fade = (duration - pause) * 0.25;
      const t  = _pickerTime % duration;
      let   dt = Math.max(0, t - pause) / (duration - pause);
      dt = Math.sqrt(1 - Math.pow(Math.min(dt, 1) - 1, 2));
      const m  = t < pause ? 0.5 : 0.5 + 0.5 * dt;
      const ta = Math.max(0, t - duration + fade);
      const a  = 1 - ta / fade;
      const bw = 2 * canvas.dimensions.uiScale;
      for (const [, e] of _pickerReticles)
        e.token._drawTargetArrows({ margin: m, alpha: a * (e.alphaMult ?? 1), color: e.color, border: { width: bw } });
    };
    canvas.app.ticker.add(_pickerTickerFn);
  }
}

export function _removePickerReticle(token) {
  const entry = _pickerReticles.get(token.id);
  if (!entry) return;
  _pickerReticles.delete(token.id);
  if (!entry.was) {
    token.targeted.delete(game.user);
    token.targetArrows.clear();
  } else {
    token._drawTargetArrows();
  }
  if (_pickerReticles.size === 0 && _pickerTickerFn) {
    canvas.app.ticker.remove(_pickerTickerFn);
    _pickerTickerFn = null;
  }
}

export function _clearPickerReticles() {
  for (const [, { token, was }] of _pickerReticles) {
    if (!was) { token.targeted.delete(game.user); token.targetArrows.clear(); }
    else token._drawTargetArrows();
  }
  _pickerReticles.clear();
  if (_pickerTickerFn) { canvas.app.ticker.remove(_pickerTickerFn); _pickerTickerFn = null; }
}


function _syncReticles(tokens, selectedIds, hoveredId, colorFn = (t) => t._getBorderColor()) {
  for (const t of tokens) {
    const active = selectedIds.has(t.id) || t.id === hoveredId;
    if (active) _addPickerReticle(t, colorFn(t), 1.0);
    else if (getSetting('deathPickerDimAll')) _addPickerReticle(t, colorFn(t), 0.5);
    else _removePickerReticle(t);
  }
}



const _cssHexToNum = (css) => parseInt(css.slice(1), 16);

const _darkenHex = (hex) => {
  const r = Math.round(((hex >> 16) & 0xff) * 0.6);
  const g = Math.round(((hex >> 8)  & 0xff) * 0.6);
  const b = Math.round( (hex        & 0xff) * 0.6);
  return (r << 16) | (g << 8) | b;
};

const _brightenHex = (hex) => {
  const r = Math.min(255, ((hex >> 16) & 0xff) + 60);
  const g = Math.min(255, ((hex >> 8)  & 0xff) + 60);
  const b = Math.min(255,  (hex        & 0xff) + 60);
  return (r << 16) | (g << 8) | b;
};


export async function runColoredTokenPicker({ tokens, colorMap, hint }) {
  if (!tokens.length) return null;

  const hlName = 'dsct-colored-picker-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const GS = canvas.grid.size;
  const drawHighlights = (hoverId = null) => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const t of tokens) {
      const base   = _cssHexToNum(colorMap.get(t.id) ?? '#4488ff');
      const color  = t.id === hoverId ? _brightenHex(base) : base;
      const border = _darkenHex(base);
      const w = Math.max(1, Math.round(t.document.width));
      const h = Math.max(1, Math.round(t.document.height));
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          canvas.interface.grid.highlightPosition(hlName, {
            x: Math.floor(t.x / GS) * GS + dx * GS,
            y: Math.floor(t.y / GS) * GS + dy * GS,
            color, border,
          });
        }
      }
    }
  };

  drawHighlights();

  return new Promise(resolve => {
    const notif = ui.notifications.info(hint, { permanent: true });

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      _clearPickerReticles();
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
    };

    let hoverId = null;

    const onMove = (event) => {
      const pos    = event.data.getLocalPosition(canvas.app.stage);
      const hit    = _hitToken(pos, tokens);
      const newId  = hit?.id ?? null;
      if (newId === hoverId) return;
      if (hoverId) _removePickerReticle(canvas.tokens.get(hoverId));
      hoverId = newId;
      if (hit) _addPickerReticle(hit, _cssHexToNum(colorMap.get(hit.id) ?? '#ffffff'));
      drawHighlights(hoverId);
    };

    const onClick = (event) => {
      if (event.data.originalEvent.button === 2) {
        if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); }
        return;
      }
      if (event.data.originalEvent.button !== 0) return;
      const hit = _hitToken(event.data.getLocalPosition(canvas.app.stage), tokens);
      if (!hit) return;
      cleanup();
      resolve(hit);
    };

    const onKey           = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
    const onContextMenu   = (e) => { e.preventDefault(); if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); } };

    canvas.stage.on('mousedown', onClick);
    canvas.stage.on('mousemove', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContextMenu);
  });
}

export function checkAndRunTargetPicker(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return null;

  if (_dsctPreTargeted.has(ability.uuid)) {
    _dsctPreTargeted.delete(ability.uuid);
    return null;
  }

  if (!_isPickerEligible(ability)) return null;

  const casterToken = _getCasterToken(ability);
  if (!casterToken) return null;

  const target   = ability.system.target;
  const range    = getItemRange(ability);
  const isStrike    = ability.system?.keywords?.has('strike') ?? false;
  const excludeSelf = isStrike || (ability.system?.keywords?.has('weapon') ?? false);

  
  if (game.user.targets.size > 0) {
    if (game.user.targets.size < target.value) {
      const alreadyTargetedIds = new Set([...game.user.targets].map(t => t.id));
      const remaining = _getValidTargets(casterToken, target.type, range, { excludeSelf, checkLOS: true })
        .filter(t => !alreadyTargetedIds.has(t.id));
      if (remaining.length) {
        const rs = remaining.length !== 1 ? 's' : '';
        ui.notifications.info(game.i18n.format('DSCT.notice.targetPicker.couldTargetMore', {
          count: remaining.length, s: rs, max: target.value,
        }));
      }
    }
    return null;
  }

  const validTokens = _getValidTargets(casterToken, target.type, range, { excludeSelf, checkLOS: true });

  if (!validTokens.length) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.targetPicker.noValidTargets'));
    return null;
  }

  let autoFire = null;
  if (excludeSelf) {
    const cDisp   = casterToken.document.disposition;
    const isSelfT = (t) => t.id === casterToken.id;
    const enemies = validTokens.filter(t => !isSelfT(t) && t.document.disposition !== cDisp);
    const allies  = validTokens.filter(t => !isSelfT(t) && t.document.disposition === cDisp);
    const selves  = validTokens.filter(isSelfT);

    
    if (enemies.length > 0 && enemies.length <= target.value)  autoFire = enemies;
    else if (enemies.length === 0 && allies.length === 1)      autoFire = allies;
    else if (enemies.length === 0 && allies.length === 0)      autoFire = selves;
  } else if (validTokens.length <= target.value) {
    autoFire = validTokens;
  }

  if (autoFire?.length) {
    _dsctPreTargeted.add(ability.uuid);
    setFoundryTargets(autoFire);
    ds.helpers.macros.rollItemMacro(ability.uuid);
    return 'block';
  }

  _runTargetPicker(ability, casterToken).then(selected => {
    if (!selected?.length) return;
    _dsctPreTargeted.add(ability.uuid);
    setFoundryTargets(selected);
    ds.helpers.macros.rollItemMacro(ability.uuid);
  });

  return 'block';
}
