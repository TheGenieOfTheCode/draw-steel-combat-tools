import { getSetting, tokFootprintDist } from '../helpers.mjs';
import { _getValidTargets, setFoundryTargets, _addPickerReticle, _removePickerReticle, _clearPickerReticles } from './target-picker.mjs';
import { getStrikeType } from './class-shadow/crossfade.mjs';
import { _recomputeAndSync, _injectPillUI } from './roll-dialog-hooks.mjs';

const M = 'draw-steel-combat-tools';

const _squadTargeted = new Set();

export let _pendingSquadMap = null;

export function consumePendingSquadMap() {
  const map = _pendingSquadMap;
  _pendingSquadMap = null;
  return map;
}

function _getAbilityRange(ability) {
  const dist = ability.system?.distance;
  if (!dist) return 5;
  const p = parseInt(dist.primary)   || 0;
  const s = parseInt(dist.secondary) || 0;
  const raw = dist.type === 'meleeRanged' ? Math.max(p, s) : (p || 1);
  return Math.max(5, raw);
}

function _getAbilityRangeRaw(ability) {
  const dist = ability.system?.distance;
  if (!dist) return 1;
  const p = parseInt(dist.primary)   || 0;
  const s = parseInt(dist.secondary) || 0;
  return dist.type === 'meleeRanged' ? Math.max(p, s) : (p || 1);
}

function _isAdjacentToEnemy(token) {
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const disp = token.document.disposition;
  return canvas.tokens.placeables.some(t => {
    if (!t.actor || t.id === token.id) return false;
    if (t.actor.statuses?.has(dead)) return false;
    const d = t.document.disposition;
    return d !== CONST.TOKEN_DISPOSITIONS.NEUTRAL
      && disp !== CONST.TOKEN_DISPOSITIONS.NEUTRAL
      && d !== disp
      && typeof token.isAdjacentTo === 'function' && token.isAdjacentTo(t);
  });
}

function _findAdjacentEnemy(token) {
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const disp = token.document.disposition;
  return canvas.tokens.placeables.find(t => {
    if (!t.actor || t.id === token.id) return false;
    if (t.actor.statuses?.has(dead)) return false;
    const d = t.document.disposition;
    return d !== CONST.TOKEN_DISPOSITIONS.NEUTRAL
      && disp !== CONST.TOKEN_DISPOSITIONS.NEUTRAL
      && d !== disp
      && typeof token.isAdjacentTo === 'function' && token.isAdjacentTo(t);
  }) ?? null;
}

function _getSquadMinions(actor) {
  if (!game.combat) return [];
  const controlledTok   = canvas.tokens?.controlled.find(t => t.actor?.id === actor.id);
  const activeCombatant = game.combat.combatant?.actorId === actor.id ? game.combat.combatant : null;
  const sourceToken     = controlledTok ?? activeCombatant?.token?.object ?? null;
  if (!sourceToken) return [];
  const combatant = game.combat.combatants.find(c => c.tokenId === sourceToken.id);
  if (!combatant) return [];
  const group = game.combat.groups?.contents.find(
    g => [...g.members].some(c => c.id === combatant.id)
  );
  if (!group) return [];
  return [...group.members]
    .filter(c => c.actor?.system?.isMinion)
    .map(c => canvas.tokens.placeables.find(t => t.id === c.tokenId))
    .filter(Boolean);
}

function _getTargetStamina(token) {
  return token?.actor?.system?.stamina?.value ?? 0;
}

function _autoAssign(minionTokens, candidates, isRanged = false, range = 5, initialRange = range) {
  const staminaPriority = getSetting('squadAutoAssignStaminaPriority') ?? 'high';
  const CGD         = canvas.grid?.distance ?? 5;
  const rangeDist   = range * CGD;
  const initialDist = initialRange * CGD;

  const minionDisp = minionTokens[0]?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
  const enemies = minionDisp === CONST.TOKEN_DISPOSITIONS.NEUTRAL
    ? []
    : candidates.filter(t =>
        t.document.disposition !== CONST.TOKEN_DISPOSITIONS.NEUTRAL &&
        t.document.disposition !== minionDisp
      );
  if (!enemies.length) return new Map();

  const enemyById = new Map(enemies.map(t => [t.id, t]));

  
  const pairs = [];
  for (const m of minionTokens) {
    for (const t of enemies) {
      const dist = tokFootprintDist(m, t);
      if (dist >= rangeDist) continue;
      pairs.push({ minionId: m.id, targetId: t.id, dist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  
  const initialPairs = initialDist >= rangeDist ? pairs : pairs.filter(p => p.dist < initialDist);

  const assignments = new Map();
  const cap         = new Map();

  if (isRanged) {
    const adjacentSet = new Set(
      minionTokens.filter(m => _isAdjacentToEnemy(m)).map(m => m.id)
    );
    
    for (const { minionId, targetId } of initialPairs) {
      if (adjacentSet.has(minionId)) continue;
      if (assignments.has(minionId)) continue;
      if ((cap.get(targetId) ?? 0) >= 1) continue;
      assignments.set(minionId, targetId);
      cap.set(targetId, (cap.get(targetId) ?? 0) + 1);
    }
  }

  
  for (const { minionId, targetId } of initialPairs) {
    if (assignments.has(minionId)) continue;
    if ((cap.get(targetId) ?? 0) !== 0) continue;
    assignments.set(minionId, targetId);
    cap.set(targetId, 1);
  }

  
  if (staminaPriority === 'none') {
    const unassignedIds = new Set(pairs.filter(p => !assignments.has(p.minionId)).map(p => p.minionId));
    const minionOrder   = [...unassignedIds].sort((a, b) => {
      const minA = Math.min(...pairs.filter(p => p.minionId === a).map(p => p.dist));
      const minB = Math.min(...pairs.filter(p => p.minionId === b).map(p => p.dist));
      return minA - minB;
    });
    for (const minionId of minionOrder) {
      const pick = pairs
        .filter(p => p.minionId === minionId && (cap.get(p.targetId) ?? 0) >= 1 && (cap.get(p.targetId) ?? 0) < 3)
        .sort((a, b) => (cap.get(a.targetId) ?? 0) - (cap.get(b.targetId) ?? 0) || a.dist - b.dist)[0];
      if (!pick) continue;
      assignments.set(pick.minionId, pick.targetId);
      cap.set(pick.targetId, (cap.get(pick.targetId) ?? 0) + 1);
    }
  } else {
    const extraPairs = [...pairs].sort((a, b) => {
      const staA = _getTargetStamina(enemyById.get(a.targetId));
      const staB = _getTargetStamina(enemyById.get(b.targetId));
      const staCmp = staminaPriority === 'high' ? staB - staA : staA - staB;
      return staCmp !== 0 ? staCmp : a.dist - b.dist;
    });
    for (const { minionId, targetId } of extraPairs) {
      if (assignments.has(minionId)) continue;
      const curCap = cap.get(targetId) ?? 0;
      if (curCap === 0 || curCap >= 3) continue;
      assignments.set(minionId, targetId);
      cap.set(targetId, curCap + 1);
    }
  }
  return assignments;
}

function _drawCheckerLine(g, x1, y1, x2, y2, alpha = 0.9) {
  const SEG = 18;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  let d = 0, flip = false;
  while (d < len) {
    const end = Math.min(d + SEG, len);
    g.lineStyle(3, flip ? 0xFFFFFF : 0xFF8800, alpha);
    g.moveTo(x1 + ux * d,   y1 + uy * d);
    g.lineTo(x1 + ux * end, y1 + uy * end);
    d    = end;
    flip = !flip;
  }
}

function _tokenCenter(token) {
  const GS = canvas.grid.size;
  return {
    x: token.x + token.document.width  * GS * 0.5,
    y: token.y + token.document.height * GS * 0.5,
  };
}

function _getMinionNetEdges(token, ability, rangedOnly) {
  const actor      = token.actor;
  const abilityKws = ability.system?.keywords ?? new Set();
  let edges = 0;
  let banes = 0;
  for (const effect of (actor?.effects ?? [])) {
    if (effect.disabled) continue;
    const filterKws = effect.system?.filters?.keywords ?? [];
    if (filterKws.length && !filterKws.some(kw => abilityKws.has(kw))) continue;
    for (const ch of effect.changes ?? []) {
      if (ch.mode !== 2) continue;
      const val = parseInt(ch.value) || 0;
      if (ch.key === 'power.roll.edges') edges += val;
      else if (ch.key === 'power.roll.banes') banes += val;
    }
  }
  if (rangedOnly && _isAdjacentToEnemy(token)) banes++;
  return Math.min(edges, 2) - Math.min(banes, 2);
}

function _buildTargetMap(assignments, minionTokens, ability) {
  const rangedOnly = getStrikeType(ability) === 'ranged';
  const byTarget   = new Map();
  for (const [minionId, targetId] of assignments) {
    if (!byTarget.has(targetId)) byTarget.set(targetId, []);
    byTarget.get(targetId).push(minionId);
  }
  const result = new Map();
  for (const [targetId, minionIds] of byTarget) {
    let primaryId  = minionIds[0];
    let bestNet    = -Infinity;
    for (const minionId of minionIds) {
      const tok = minionTokens.find(t => t.id === minionId);
      const net = tok ? _getMinionNetEdges(tok, ability, rangedOnly) : 0;
      if (net > bestNet) { bestNet = net; primaryId = minionId; }
    }
    result.set(targetId, {
      minionCount:     minionIds.length,
      extraMinions:    minionIds.length - 1,
      primaryMinionId: primaryId,
      primaryNetEdges: bestNet,
      minionIds,
    });
  }
  return result;
}

async function _runSquadTargetingUI(eligibleMinions, allTargets, range, isRanged = false, initialRange = range) {
  const GS  = canvas.grid.size;
  const CGD = canvas.grid.distance;

  let texture;
  const iconPath = getSetting('squadTargetingIcon') || 'icons/svg/dice-target.svg';
  try   { texture = await PIXI.Assets.load(iconPath); }
  catch { texture = PIXI.Texture.WHITE; }

  const container = new PIXI.Container();
  container.zIndex = 900;
  canvas.stage.addChild(container);
  window._dsctSquadTargetingContainer = container;

  const lines       = new PIXI.Graphics();
  container.addChild(lines);

  const assignments  = new Map();
  const targetCap    = new Map();
  let   activeMinionId  = null;
  let   hoveredTargetId = null;

  const iconSize = GS * 0.55;
  const icons    = new Map();

  const onMinionClick = (minionId) => {
    activeMinionId = activeMinionId === minionId ? null : minionId;
    hoveredTargetId = null;
    refreshNotif();
    redraw();
    syncReticles();
  };

  for (const token of eligibleMinions) {
    const sprite   = new PIXI.Sprite(texture);
    sprite.width   = iconSize;
    sprite.height  = iconSize;
    sprite.anchor.set(0.5, 0.5);
    sprite.x          = token.x + token.document.width  * GS * 0.5;
    sprite.y          = token.y + token.document.height * GS * 0.5;
    sprite.interactive = true;
    sprite.cursor      = 'pointer';
    sprite.on('pointerdown', (e) => { e.stopPropagation(); onMinionClick(token.id); });
    container.addChild(sprite);
    icons.set(token.id, sprite);
  }

  const hlName = 'dsct-squad-targeting-hl';
  if (!canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.addHighlightLayer(hlName);

  let notif = null;

  const refreshNotif = () => {
    if (notif) ui.notifications.remove(notif);
    if (activeMinionId) {
      const mTok = eligibleMinions.find(t => t.id === activeMinionId);
      notif = ui.notifications.info(
        `Squad Action | Selecting target for ${mTok?.name ?? 'minion'}. Right-click to deselect. Escape to cancel.`,
        { permanent: true },
      );
    } else {
      const done     = assignments.size;
      const total    = eligibleMinions.length;
      const rcCancel = getSetting('cancelOnRightClick') ? ' Right-click: cancel.' : '';
      notif = ui.notifications.info(
        `Squad Action | Click a minion icon to assign its target (${done}/${total} assigned). Double-click empty space: auto-assign and confirm. Enter: confirm. Escape: cancel.${rcCancel}`,
        { permanent: true },
      );
    }
  };

  const redrawLines = () => {
    lines.clear();
    for (const [minionId, targetId] of assignments) {
      const m = eligibleMinions.find(t => t.id === minionId);
      const t = allTargets.find(t => t.id === targetId);
      if (!m || !t) continue;
      const mc = _tokenCenter(m);
      const tc = _tokenCenter(t);
      _drawCheckerLine(lines, mc.x, mc.y, tc.x, tc.y);
    }
    if (activeMinionId && hoveredTargetId && hoveredTargetId !== assignments.get(activeMinionId)) {
      const m = eligibleMinions.find(t => t.id === activeMinionId);
      const t = allTargets.find(t => t.id === hoveredTargetId);
      if (m && t) {
        const mc = _tokenCenter(m);
        const tc = _tokenCenter(t);
        _drawCheckerLine(lines, mc.x, mc.y, tc.x, tc.y, 0.3);
      }
    }
  };

  const redrawIcons = () => {
    for (const [minionId, sprite] of icons) {
      const assigned = assignments.has(minionId);
      const active   = activeMinionId === minionId;
      sprite.tint  = active ? 0x44AAFF : assigned ? 0x999999 : 0xFFFFFF;
      sprite.alpha = active ? 1.0 : assigned ? 0.55 : 1.0;
    }
  };

  const _highlightRangeCells = (token, r) => {
    const cx0 = Math.floor(token.x / GS);
    const cy0 = Math.floor(token.y / GS);
    const cw  = Math.max(1, Math.round(token.document.width));
    const ch  = Math.max(1, Math.round(token.document.height));
    for (let rx = cx0 - r; rx <= cx0 + cw - 1 + r; rx++) {
      for (let ry = cy0 - r; ry <= cy0 + ch - 1 + r; ry++) {
        if (rx >= cx0 && rx < cx0 + cw && ry >= cy0 && ry < cy0 + ch) continue;
        const dx = Math.max(0, cx0 - rx, rx - (cx0 + cw - 1));
        const dy = Math.max(0, cy0 - ry, ry - (cy0 + ch - 1));
        if (Math.max(dx, dy) > r) continue;
        canvas.interface.grid.highlightPosition(hlName, { x: rx * GS, y: ry * GS, color: 0x002211, border: 0x00CC66 });
      }
    }
  };

  const redrawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);

    const activeTok = activeMinionId ? eligibleMinions.find(t => t.id === activeMinionId) : null;

    
    for (const token of (activeTok ? [activeTok] : eligibleMinions)) _highlightRangeCells(token, initialRange);

    if (!activeTok) return;

    
    for (const t of allTargets) {
      const curCap  = targetCap.get(t.id) ?? 0;
      const maxDist = curCap === 0 ? initialRange * CGD : range * CGD;
      const dist    = tokFootprintDist(activeTok, t);
      if (dist >= maxDist) continue;
      const atCap  = curCap >= 3;
      const color  = atCap ? 0x880000 : 0x4488FF;
      const border = atCap ? 0x440000 : 0x2244AA;
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

  const syncReticles = () => {
    for (const t of allTargets) {
      const assigned = (targetCap.get(t.id) ?? 0) > 0;
      const hovered  = t.id === hoveredTargetId;
      if (assigned) _addPickerReticle(t, 0x44CC44, 1.0);
      else if (hovered) _addPickerReticle(t, 0x66AAFF, 1.0);
      else _removePickerReticle(t);
    }
  };

  const redraw = () => { redrawLines(); redrawIcons(); redrawHighlights(); };

  return new Promise((resolve) => {
    refreshNotif();
    redraw();
    syncReticles();

    const cleanup = () => {
      if (notif) { ui.notifications.remove(notif); notif = null; }
      canvas.interface.grid.clearHighlightLayer(hlName);
      if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
      _clearPickerReticles();
      canvas.stage.off('mousedown', onClick);
      canvas.stage.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onContextMenu);
      if (container.parent) container.parent.removeChild(container);
      container.destroy({ children: true });
      window._dsctSquadTargetingContainer = null;
    };

    const assignTarget = (minionId, targetId) => {
      const mTok = eligibleMinions.find(t => t.id === minionId);
      const tTok = allTargets.find(t => t.id === targetId);
      if (!mTok || !tTok) return;

      const prevTarget   = assignments.get(minionId) ?? null;
      const capBefore    = targetCap.get(targetId) ?? 0;
      const effectiveCap = prevTarget === targetId ? capBefore - 1 : capBefore;
      const maxDist      = effectiveCap === 0 ? initialRange * CGD : range * CGD;

      if (tokFootprintDist(mTok, tTok) >= maxDist) {
        ui.notifications.warn(effectiveCap === 0
          ? `${tTok.name} is out of initial strike range.`
          : `${mTok.name} is too far to reinforce ${tTok.name}.`);
        return;
      }
      if (effectiveCap >= 3) {
        ui.notifications.warn('Maximum 3 minions can target the same creature.');
        return;
      }

      if (prevTarget) {
        const c = targetCap.get(prevTarget) ?? 0;
        if (c <= 1) targetCap.delete(prevTarget); else targetCap.set(prevTarget, c - 1);
      }
      assignments.set(minionId, targetId);
      targetCap.set(targetId, (targetCap.get(targetId) ?? 0) + 1);
    };

    const hitTarget = (pos) => allTargets.find(t => {
      const tw = t.document.width  * GS;
      const th = t.document.height * GS;
      return pos.x >= t.x && pos.x <= t.x + tw && pos.y >= t.y && pos.y <= t.y + th;
    }) ?? null;

    const onClick = (event) => {
      if (event.data.originalEvent.button !== 0) return;
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = hitTarget(pos);

      if (!activeMinionId) {
        if (!hit) {
          const now = Date.now();
          if (now - (onClick._lastEmptyClick ?? 0) < 400) {
            onClick._lastEmptyClick = 0;
            assignments.clear();
            targetCap.clear();
            for (const [m, t] of _autoAssign(eligibleMinions, allTargets, isRanged, range, initialRange)) {
              assignments.set(m, t);
              targetCap.set(t, (targetCap.get(t) ?? 0) + 1);
            }
            if (!assignments.size) { ui.notifications.warn('No enemy targets in range to auto-assign.'); return; }
            cleanup();
            resolve(new Map(assignments));
          } else {
            onClick._lastEmptyClick = now;
          }
        }
        return;
      }

      if (!hit) return;
      assignTarget(activeMinionId, hit.id);
      activeMinionId  = null;
      hoveredTargetId = null;
      refreshNotif();
      redraw();
      syncReticles();
    };

    const onMove = (event) => {
      if (!activeMinionId) return;
      const hit   = hitTarget(event.data.getLocalPosition(canvas.app.stage));
      const newId = hit?.id ?? null;
      if (newId === hoveredTargetId) return;
      hoveredTargetId = newId;
      redrawLines();
      redrawHighlights();
      syncReticles();
    };

    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!assignments.size) { ui.notifications.warn('Assign at least one minion before confirming.'); return; }
        cleanup();
        resolve(new Map(assignments));
      } else if (event.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    const onContextMenu = (e) => {
      e.preventDefault();
      if (activeMinionId) {
        activeMinionId  = null;
        hoveredTargetId = null;
        refreshNotif();
        redraw();
        syncReticles();
      } else if (getSetting('cancelOnRightClick')) {
        cleanup();
        resolve(null);
      }
    };

    canvas.stage.on('mousedown', onClick);
    canvas.stage.on('mousemove', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('contextmenu', onContextMenu);
  });
}

export function registerSquadTargetingHooks() {
  Hooks.on('renderAbilityConfigurationDialog', (app) => {
    const pendingMap = _pendingSquadMap;
    if (!pendingMap) return;
    if (!app._dsctSources) return;

    const ability = app.options.ability;
    const actor   = ability?.actor ?? ability?.parent;
    if (!actor?.system?.isMinion || ability?.system?.category !== 'signature') return;
    if (getStrikeType(ability) !== 'ranged') return;

    app._dsctSources = app._dsctSources.filter(
      s => !(s.reason === 'Adjacent Enemy' && s.scope === 'global')
    );

    for (const [tokenId, entry] of pendingMap) {
      const pillId = `dsct-sq-adj-${tokenId}`;
      if (app._dsctSources.some(s => s.id === pillId)) continue;
      const primaryTok = canvas.tokens.get(entry.primaryMinionId);
      if (!primaryTok) continue;
      const nearbyEnemy = _findAdjacentEnemy(primaryTok);
      if (!nearbyEnemy) continue;
      app._dsctSources.push({
        id:        pillId,
        kind:      'bane',
        amount:    1,
        reason:    'Adjacent Enemy',
        src:       nearbyEnemy.name,
        scope:     tokenId,
        dsNative:  false,
        custom:    false,
        enabled:   true,
        srcTokenId: nearbyEnemy.id,
      });
    }

    _recomputeAndSync(app);
    _injectPillUI(app);
  });
}

export function checkAndRunSquadTargeting(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return null;

  if (_squadTargeted.has(ability.uuid)) {
    _squadTargeted.delete(ability.uuid);
    return null;
  }

  if (!getSetting('abilityAutomationEnabled')) return null;
  if (!getSetting('groupActionsEnabled')) return null;
  if (!game.modules.get('draw-steel-target-damage')?.active) return null;

  const actor = ability.actor ?? ability.parent;
  if (!actor?.system?.isMinion) return null;
  if (ability.system?.category !== 'signature') return null;

  const minionTokens = _getSquadMinions(actor);
  if (!minionTokens.length) return null;

  const squadIds   = new Set(minionTokens.map(t => t.id));
  const range        = _getAbilityRange(ability);
  const initialRange = _getAbilityRangeRaw(ability);
  const targetType   = ability.system?.target?.type ?? 'enemy';
  const CGD          = canvas.grid.distance;

  const allTargetIds = new Set();
  const allTargets   = [];
  for (const token of minionTokens) {
    for (const t of _getValidTargets(token, targetType, range, { excludeSelf: true })) {
      if (!allTargetIds.has(t.id) && !squadIds.has(t.id)) {
        allTargetIds.add(t.id);
        allTargets.push(t);
      }
    }
  }

  const eligibleMinions = minionTokens.filter(m =>
    allTargets.some(t => tokFootprintDist(m, t) < range * CGD)
  );

  if (!eligibleMinions.length || !allTargets.length) return null;

  const isRanged = getStrikeType(ability) === 'ranged';
  _runSquadTargetingUI(eligibleMinions, allTargets, range, isRanged, initialRange).then(assignments => {
    if (!assignments?.size) return;
    const targetMap    = _buildTargetMap(assignments, eligibleMinions, ability);
    const targetTokens = [...new Set(assignments.values())]
      .map(id => canvas.tokens.get(id))
      .filter(Boolean);
    setFoundryTargets(targetTokens);
    _squadTargeted.add(ability.uuid);
    _pendingSquadMap = targetMap;
    ability.system.use();
  });

  return 'block';
}
