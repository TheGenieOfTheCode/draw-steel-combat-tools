import { getSetting, tokFootprintDist, getItemRange, hasSightToToken, sightLinesToToken, isSelfAndSelf } from '../helpers.mjs';
import { chooseTargeting } from './choose-effect.mjs';
import { isHiddenFrom } from '../conditions/stealth.mjs';
import { burrowBlocksLineOfEffect } from '../conditions/burrow.mjs';
import {
  setRaisedDeadVisible,
  addPreviewToken,
  removePreviewToken,
  activateTokenLayer,
} from '../death-tracker/defeated-token-visibility.mjs';
import { peekSpaces, wallAdjacent, peekTo, peekEffect, isPeeking, unpeek } from '../conditions/peek.mjs';
import { beginPickerOverlay, setPickerArrow, setPickerTarget, removePickerArrow, removePickerTarget, clearPickerArrows } from './picker-overlay.mjs';

const M = 'draw-steel-combat-tools';


const _dsctPreTargeted = new Set();


const _repicked = new Set();

export const clearRepickStamp = (uuid) => { if (uuid) _repicked.delete(uuid); };


export const isTriggeredAbility = (ability) =>
  !!ds.CONFIG?.abilities?.types?.[ability?.system?.type]?.triggered;

const _hasAnySightTo = (casterToken, targetToken, shift = null) => hasSightToToken(casterToken, targetToken, { shift });

const _defeatedStatus = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
const _isDefeated     = (t) => t.actor?.statuses?.has(_defeatedStatus()) ?? false;
const _hidingDefeated = () => (game.user.getFlag(M, 'hideDefeated') ?? false) === true;




function _isSelfOnly(ability, view) {
  if (!isSelfAndSelf(ability, view)) return false;

  const keywords = view?.keywords ?? ability.system?.keywords;
  if (keywords?.has?.('strike') ?? Array.from(keywords ?? []).includes('strike')) return false;

  const powerEffects = ability.system?.power?.effects;
  const damage = powerEffects?.documentsByType?.damage
    ?? Array.from(powerEffects ?? []).filter(e => e?.type === 'damage');
  return !damage?.length;
}

const _cancelTriggeredUse = (ability) => game.modules.get('draw-steel-triggers')?.api?.noteUseCancelled?.(ability.uuid);


function _runTriggeredPicker(ability, view) {
  const casterToken = _getCasterToken(ability);
  if (!casterToken) return null;
  const target = view?.target ?? ability.system.target;
  const count  = Math.max(1, Number(target?.value) || 1);
  const range  = getItemRange(ability, view?.distance);
  const valid  = _getValidTargets(casterToken, target?.type ?? 'creature', range, { checkLOS: true });
  const validIds = new Set(valid.map(t => t.id));
  const chosen = [...game.user.targets];
  const exact = chosen.length === count && chosen.every(t => validIds.has(t.id));
  if (exact && !(getSetting('alwaysRepickTargets') && !_repicked.has(ability.uuid))) return null;
  _repicked.add(ability.uuid);
  if (!valid.length) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.targetPicker.noValidTargets'));
    _cancelTriggeredUse(ability);
    return 'block';
  }
  _runTargetPicker(ability, casterToken, { maxTargets: count }).then((selected) => {
    if (!selected?.length) { _cancelTriggeredUse(ability); return; }
    _dsctPreTargeted.add(ability.uuid);
    setFoundryTargets(selected);
    ds.helpers.macros.rollItemMacro(ability.uuid);
  }).catch((err) => {
    console.error('DSCT | target picker | triggered ability picker failed:', err);
    _cancelTriggeredUse(ability);
  });
  return 'block';
}

function _isPickerEligible(ability, view) {
  const target = view?.target ?? ability.system?.target;
  const keywords = view?.keywords ?? ability.system?.keywords;
  if (!target?.value) return false;
  if (target.type === 'self') return false;
  if (keywords?.has('area')) return false;
  return true;
}

function _getCasterToken(ability) {
  const actor = ability.actor ?? ability.parent;
  if (!actor) return null;
  return canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
      ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
}

export function _getValidTargets(casterToken, targetType, range, { excludeSelf = false, checkLOS = false, respectHidden = false, shift = null } = {}) {
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

    
    if (checkLOS && !isSelf(t) && !_hasAnySightTo(casterToken, t, shift)) return false;
    if (!isSelf(t) && burrowBlocksLineOfEffect(casterToken, t)) return false;

    
    if (respectHidden && !isSelf(t) && isHiddenFrom(t, casterToken)) return false;
    return true;
  });
}

const _undoAutoPeek = async (casterToken) => {
  if (!isPeeking(casterToken?.actor)) return;
  if (peekEffect(casterToken.actor)?.getFlag('draw-steel-combat-tools', 'peek')?.auto) await unpeek(casterToken);
};

const _peekOptions = (casterToken, opts) => {
  const spaces = peekSpaces(casterToken);
  if (!spaces.length) return [];

  const now = _getValidTargets(casterToken, opts.targetType, opts.range, opts.filter);
  const nowIds = new Set(now.map(t => t.id));

  const out = [];
  for (const space of spaces) {
    const after = _getValidTargets(casterToken, opts.targetType, opts.range, { ...opts.filter, shift: space.shift });
    const afterIds = new Set(after.map(t => t.id));
    const gained = after.filter(t => !nowIds.has(t.id));
    
    
    const lost = now.filter(t => !afterIds.has(t.id));
    if (gained.length) out.push({ space, gained, lost });
  }
  return out;
};

const _peekLine = (casterToken, target, shift) => {
  const lines = sightLinesToToken(casterToken, target, { shift });
  return lines.find(l => !l.blocked) ?? null;
};

async function _offerPeek(casterToken, opts) {
  if (!getSetting('peekHouseRule')) return false;
  if (isPeeking(casterToken.actor)) return false;
  if (!wallAdjacent(casterToken)) return false;

  
  
  if (getSetting('peekRequiresSpeed') && !(Number(casterToken.actor?.system?.movement?.value) > 0)) return false;

  const options = _peekOptions(casterToken, opts);
  if (!options.length) return false;

  const chosen = await _runPeekPicker(casterToken, options);
  if (!chosen) return false;

  await peekTo(casterToken, chosen.space, { auto: true });
  return true;
}

function _runPeekPicker(casterToken, options) {
  return new Promise((resolve) => {
    const GS = canvas.grid.size;
    const layer = new PIXI.Container();
    layer.eventMode = 'none';
    canvas.controls.addChild(layer);
    const g = new PIXI.Graphics();
    layer.addChild(g);

    const label = new PIXI.Text('', {
      fontFamily: 'Signika, sans-serif', fontSize: 15, fontWeight: 'bold',
      fill: 0xffffff, stroke: 0x000000, strokeThickness: 4,
    });
    label.anchor.set(0.5, 1);
    label.visible = false;
    layer.addChild(label);

    let hover = null;

    const outline = (token, colour) => {
      const w = Math.max(1, Math.round(token.document.width)) * GS;
      const h = Math.max(1, Math.round(token.document.height)) * GS;
      g.lineStyle(3, colour, 0.95);
      g.drawRoundedRect(token.document.x + 2, token.document.y + 2, w - 4, h - 4, 6);
    };

    const paint = () => {
      g.clear();
      for (const o of options) {
        const on = hover === o;
        g.lineStyle(on ? 3 : 2, on ? 0xffe066 : 0x66ccff, on ? 1 : 0.65);
        g.beginFill(on ? 0xffe066 : 0x66ccff, on ? 0.3 : 0.1);
        g.drawRoundedRect(o.space.x * GS + GS * 0.08, o.space.y * GS + GS * 0.08, GS * 0.84, GS * 0.84, 6);
        g.endFill();
      }
      label.visible = false;
      if (!hover) return;

      
      const from = {
        x: casterToken.document.x + (Math.max(1, Math.round(casterToken.document.width)) * GS) / 2 + hover.space.shift.x,
        y: casterToken.document.y + (Math.max(1, Math.round(casterToken.document.height)) * GS) / 2 + hover.space.shift.y,
      };
      g.lineStyle(0);
      g.beginFill(0xffe066, 0.9);
      g.drawCircle(from.x, from.y, GS * 0.09);
      g.endFill();

      for (const t of hover.gained) {
        outline(t, 0x44d07a);
        const line = _peekLine(casterToken, t, hover.space.shift);
        if (!line) continue;
        g.lineStyle(3, 0x44d07a, 0.95);
        g.moveTo(line.from.x, line.from.y);
        g.lineTo(line.to.x, line.to.y);
        g.lineStyle(0);
        g.beginFill(0x44d07a, 1);
        g.drawCircle(line.to.x, line.to.y, 4);
        g.endFill();
      }
      for (const t of hover.lost) outline(t, 0xd04444);

      const bits = [`+${hover.gained.map(t => t.name).join(', ')}`];
      if (hover.lost.length) bits.push(`loses ${hover.lost.map(t => t.name).join(', ')}`);
      label.text = bits.join('  ·  ');
      label.position.set(hover.space.x * GS + GS / 2, hover.space.y * GS - 4);
      label.visible = true;
    };

    const overlay = beginPickerOverlay({
      title: game.i18n.format('DSCT.dialog.peek.title', { name: casterToken.name }),
      status: game.i18n.localize('DSCT.dialog.peek.status'),
      detail: game.i18n.localize('DSCT.dialog.peek.detail'),
      holeRects: [
        { x: casterToken.document.x, y: casterToken.document.y,
          w: Math.max(1, Math.round(casterToken.document.width)) * GS,
          h: Math.max(1, Math.round(casterToken.document.height)) * GS },
        ...options.map(o => ({ x: o.space.x * GS, y: o.space.y * GS, w: GS, h: GS })),
        ...options.flatMap(o => [...o.gained, ...o.lost]).map(t => ({
          x: t.document.x, y: t.document.y,
          w: Math.max(1, Math.round(t.document.width)) * GS,
          h: Math.max(1, Math.round(t.document.height)) * GS,
        })),
      ],
      showConfirm: false,
      showCancel: true,
      onCancel: () => done(null),
    });

    const atEvent = (event) => {
      const pt = typeof event?.getLocalPosition === 'function' ? event.getLocalPosition(canvas.app.stage)
        : event?.data?.getLocalPosition ? event.data.getLocalPosition(canvas.app.stage)
        : canvas.app.renderer.events.pointer.getLocalPosition(canvas.app.stage);
      const o = canvas.grid.getOffset(pt);
      return options.find(c => c.space.x === o.j && c.space.y === o.i) ?? null;
    };

    const onMove = (event) => { hover = atEvent(event); paint(); };
    const onDown = (event) => {
      if (event.target?.closest?.('#dsct-picker-topbar')) return;
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        done(null);
        return;
      }
      if (event.button !== 0 || !hover) return;
      event.preventDefault();
      event.stopPropagation();
      done(hover);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      
      
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      done(null);
    };
    const onContext = (event) => event.preventDefault();

    function done(result) {
      canvas.stage.off('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onContext, true);
      layer.parent?.removeChild(layer);
      layer.destroy({ children: true });
      overlay.end();
      
      
      setTimeout(() => resolve(result), 0);
    }

    canvas.stage.on('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onContext, true);
    paint();
  });
}

async function _runTargetPicker(ability, casterToken, { maxTargets: maxOverride = null } = {}) {
  const view        = chooseTargeting(ability);
  const target      = view?.target ?? ability.system.target;
  const keywords    = view?.keywords ?? ability.system?.keywords;
  
  const maxTargets  = Number(target.value) || maxOverride || 1;
  const targetType  = target.type;
  const range       = getItemRange(ability, view?.distance);
  const isRangeEnforced = getSetting('enforceAbilityRange');
  const needsReveal = /object/i.test(targetType);
  const isStrike    = keywords?.has('strike') ?? false;
  const excludeSelf = isStrike || (keywords?.has('weapon') ?? false);
  const cDisp       = casterToken.document.disposition;

  if (needsReveal) { setRaisedDeadVisible(true); activateTokenLayer(); }

  
  
  const ranged = !(keywords?.has('melee') ?? false) || (keywords?.has('ranged') ?? false);
  if (ranged || isStrike) {
    await _offerPeek(casterToken, {
      targetType,
      range: isRangeEnforced ? range : 0,
      filter: { excludeSelf, checkLOS: true, respectHidden: !(keywords?.has('area') ?? false) },
    });
  }

  const respectHidden = !(keywords?.has('area') ?? false);
  const validTokens = _getValidTargets(casterToken, targetType, isRangeEnforced ? range : 0, { excludeSelf, checkLOS: true, respectHidden });
  const inRangeIds  = (!isRangeEnforced && range > 0)
    ? new Set(_getValidTargets(casterToken, targetType, range, { excludeSelf }).map(t => t.id))
    : null;

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
      const sel     = selectedTokens.has(t.id);
      const ally    = isAllyToken(t);
      const hover   = t.id === hoveredId && !sel;
      const inRange = !inRangeIds || inRangeIds.has(t.id);

      const color  = sel   ? (ally ? 0xFF4400 : (inRange ? 0x44CC44 : 0xCC9900))
                   : hover ? (ally ? 0xFFAA44 : (inRange ? 0x66AAFF : 0xBBAA00))
                   :          (ally ? 0xFF8800 : (inRange ? 0x4488FF : 0x886600));
      const border = sel   ? (ally ? 0xAA2200 : (inRange ? 0x228822 : 0x886600))
                   : hover ? (ally ? 0xCC6622 : (inRange ? 0x4477CC : 0x887700))
                   :          (ally ? 0xAA4400 : (inRange ? 0x2244AA : 0x554400));
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
    const overlay = beginPickerOverlay({
      title: ability.name,
      tokens: validTokens,
      onConfirm: () => tryConfirm(),
      onCancel: () => doCancel(),
    });
    const syncStatus = () => {
      overlay.setStatus(game.i18n.format('DSCT.picker.pickCount', { max: maxTargets, s: maxS, n: selectedTokens.size }));
      overlay.setReady(selectedTokens.size > 0);
    };
    syncStatus();

    const cleanup = () => {
      overlay.end();
      canvas.interface.grid.destroyHighlightLayer(hlName);
      _clearPickerReticles();
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
      if (needsReveal) { setRaisedDeadVisible(false); activateTokenLayer(); }
    };

    const doCancel = () => {
      cleanup();
      ui.notifications.info(game.i18n.localize('DSCT.notice.targetPicker.cancelled'));
      resolve(null);
    };

    const tryConfirm = () => {
      if (selectedTokens.size === 0) {
        overlay.flashWarning(game.i18n.localize('DSCT.notice.targetPicker.selectAtLeastOne'));
        return;
      }
      doConfirm();
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
      if (inRangeIds) {
        const outPicked = selected.filter(t => !inRangeIds.has(t.id));
        if (outPicked.length) {
          const names = outPicked.map(t => t.name).join(', ');
          const verb  = outPicked.length === 1 ? 'is' : 'are';
          ui.notifications.warn(game.i18n.format('DSCT.notice.targetPicker.outOfRangeWarning', { names, verb }));
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
        if (getSetting('cancelOnRightClick')) doCancel();
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
          overlay.flashWarning(game.i18n.format('DSCT.notice.targetPicker.maxTargets', { max: maxTargets, s: maxS }));
          return;
        }
        selectedTokens.add(clicked.id);
      }
      drawHighlights();
      syncStatus();
      _syncReticles(validTokens, selectedTokens, hoveredId);
      if (getSetting('autoConfirmSelection') && selectedTokens.size >= maxTargets) doConfirm();
    };

    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        tryConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        doCancel();
      }
    };

    const onContextMenu = (e) => {
      e.preventDefault();
      if (getSetting('cancelOnRightClick')) doCancel();
    };

    
    
    if (validTokens.length === 1 && maxTargets >= 1) {
      selectedTokens.add(validTokens[0].id);
      drawHighlights();
      syncStatus();
      _syncReticles(validTokens, selectedTokens, hoveredId);
    }

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
    const overlay = beginPickerOverlay({
      title: game.i18n.localize('DSCT.picker.titleSource'),
      status: game.i18n.localize('DSCT.notice.picker.chooseSource'),
      tokens: candidates,
      showConfirm: false,
      onCancel: () => { cleanup(); resolve(null); },
    });

    const cleanup = () => {
      overlay.end();
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
        if (prev) _removePickerReticle(prev);
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

    const onKey   = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve(null); } };
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
    const overlay = beginPickerOverlay({
      title: game.i18n.localize('DSCT.picker.titleTargets'),
      tokens,
      onConfirm: () => doConfirm(),
      onCancel: () => { cleanup(); resolve(null); },
    });
    const syncStatus = () => {
      const count = game.i18n.format('DSCT.picker.selectedCount', { n: selectedIds.size });
      overlay.setStatus(hint ? `${hint} · ${count}` : count);
      overlay.setReady(selectedIds.size > 0);
    };
    syncStatus();

    const cleanup = () => {
      overlay.end();
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
      syncStatus();
      _syncReticles(tokens, selectedIds, hoveredId);
      if (selectedIds.size >= maxTargets) doConfirm();
    };

    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        doConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
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




export function _addPickerReticle(token, color, alphaMult = 1) {
  setPickerArrow(token, color, alphaMult);
}

export function _removePickerReticle(token) {
  removePickerArrow(token);
}

export function _addPickerTarget(token, color, alphaMult = 1) {
  setPickerTarget(token, color, alphaMult);
}

export function _removePickerTarget(token) {
  removePickerTarget(token);
}

export function _clearPickerReticles() {
  clearPickerArrows();
}



function _syncReticles(tokens, selectedIds, hoveredId) {
  for (const t of tokens) {
    if (selectedIds?.has(t.id)) { setPickerTarget(t); removePickerArrow(t); }
    else if (t.id === hoveredId) { setPickerArrow(t); removePickerTarget(t); }
    else { removePickerArrow(t); removePickerTarget(t); }
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
    const overlay = beginPickerOverlay({
      title: game.i18n.localize('DSCT.picker.titleSource'),
      status: hint ?? '',
      tokens,
      showConfirm: false,
      onCancel: () => { cleanup(); resolve(null); },
    });

    const cleanup = () => {
      overlay.end();
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

    const onKey           = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve(null); } };
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

  if (!getSetting('abilityTargetingEnabled')) return null;

  
  
  
  
  const triggeredPicker = isTriggeredAbility(ability) && !!ability.getFlag?.('draw-steel-combat-tools', 'pickerForTriggered');
  if (isTriggeredAbility(ability) && !triggeredPicker) {
    if (game.modules.get('draw-steel-triggers')?.active) return null;
    if (game.user.targets.size > 0) return null;
  }

  const view = chooseTargeting(ability);
  if (triggeredPicker) return _runTriggeredPicker(ability, view);

  if (_isSelfOnly(ability, view)) {
    const self = _getCasterToken(ability);
    if (!self) return null;
    if (game.user.targets.size === 1 && game.user.targets.first()?.id === self.id) return null;
    _dsctPreTargeted.add(ability.uuid);
    setFoundryTargets([self]);
    ds.helpers.macros.rollItemMacro(ability.uuid);
    return 'block';
  }

  if (!_isPickerEligible(ability, view)) return null;

  const casterToken = _getCasterToken(ability);
  if (!casterToken) return null;

  const target   = view?.target ?? ability.system.target;
  const keywords = view?.keywords ?? ability.system?.keywords;
  const range    = getItemRange(ability, view?.distance);
  const isStrike    = keywords?.has('strike') ?? false;
  const excludeSelf = isStrike || (keywords?.has('weapon') ?? false);

  
  
  
  if (getSetting('alwaysRepickTargets') && game.user.targets.size > 0 && !_repicked.has(ability.uuid)) {
    _repicked.add(ability.uuid);
    setFoundryTargets([]);
  }

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

  const respectHidden = !(keywords?.has('area') ?? false);
  const validTokens = _getValidTargets(casterToken, target.type, range, { excludeSelf, checkLOS: true, respectHidden });

  const peekRescue = getSetting('peekHouseRule') && !isPeeking(casterToken.actor) && wallAdjacent(casterToken) && _peekOptions(casterToken, { targetType: target.type, range, filter: { excludeSelf, checkLOS: true, respectHidden } }).length > 0;

  if (!validTokens.length && !peekRescue) {
    if (getSetting('enforceAbilityRange') || !_getValidTargets(casterToken, target.type, 0, { excludeSelf, checkLOS: true }).length) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.targetPicker.noValidTargets'));
      return null;
    }
  }

  let autoFire = null;
  if (getSetting('autoConfirmSelection')) {
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
  }

  if (autoFire?.length) {
    _dsctPreTargeted.add(ability.uuid);
    setFoundryTargets(autoFire);
    ds.helpers.macros.rollItemMacro(ability.uuid);
    return 'block';
  }

  _runTargetPicker(ability, casterToken).then(async (selected) => {
    
    if (!selected?.length) { await _undoAutoPeek(casterToken); return; }
    _dsctPreTargeted.add(ability.uuid);
    setFoundryTargets(selected);
    ds.helpers.macros.rollItemMacro(ability.uuid);
  }).catch((err) => {
    
    console.error('DSCT | target picker | failed after the peek offer:', err);
    _undoAutoPeek(casterToken);
  });

  return 'block';
}
