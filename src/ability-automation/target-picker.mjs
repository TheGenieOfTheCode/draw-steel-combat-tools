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

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const t of validTokens) {
      const sel   = selectedTokens.has(t.id);
      const ally  = isAllyToken(t);
      
      const color  = sel ? (ally ? 0xFF4400 : 0x44CC44) : (ally ? 0xFF8800 : 0x4488FF);
      const border = sel ? (ally ? 0xAA2200 : 0x228822) : (ally ? 0xAA4400 : 0x2244AA);
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

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      canvas.stage.off('mousedown', onClick);
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
      const clicked = validTokens.find(t => {
        const tw = t.document.width  * canvas.grid.size;
        const th = t.document.height * canvas.grid.size;
        return pos.x >= t.x && pos.x <= t.x + tw && pos.y >= t.y && pos.y <= t.y + th;
      });
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

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
    };

    const onMove = (event) => {
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = _hitToken(pos, candidates);
      hoverIds.clear();
      if (hit) hoverIds.add(hit.id);
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
  _drawTokenHighlights(hlName, tokens, selectedIds);

  return new Promise(resolve => {
    const notif = ui.notifications.info(
      hint ?? game.i18n.localize('DSCT.notice.picker.chooseTargets'), { permanent: true },
    );

    const cleanup = () => {
      ui.notifications.remove(notif);
      canvas.interface.grid.destroyHighlightLayer(hlName);
      canvas.stage.off('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
    };

    const doConfirm = () => { cleanup(); resolve(tokens.filter(t => selectedIds.has(t.id))); };

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
      _drawTokenHighlights(hlName, tokens, selectedIds);
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
