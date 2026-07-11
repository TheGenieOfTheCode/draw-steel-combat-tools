import {
  hasTags, getTags, getByTag, addTags, removeTags,
  GRID as getGRID,
  toGrid, toWorld, gridEq, gridDist,
  MATERIAL_RULES, MATERIAL_ICONS,
  getMaterialIcon, getMaterialAlpha,
  getMaterial, tokenAt, tileAt, wallBetween,
  getSquadGroup, applyDamage, snapStamina,
  canCurrentlyFly, getWallBlockTileAt,
  sizeRank,
  safeUpdate, safeDelete, safeToggleStatusEffect,
  getSetting, getTokenById,
  confirmFriendlyFireCase1, confirmFriendlyFireCase2,
  tokFootprintDist,
} from '../helpers.mjs';
import { endGrab } from '../conditions/grab.mjs';
import {
  isTokenDead,
  cornerCutsWall, parseType, buildUndoLog,
  footprintCells, newlyEnteredCells, wallsAtStep,
  tokensAtCells, tilesAtCells, doBreakObstacleWall,
  applyFallDamage, applyForcedFallDamage, destroyObjectToken, _fmDistCap,
  splitConvertedWall, splitTileAtElevation,
} from './forced-movement-collision.mjs';
import { toggleForcedMovementPanel } from './forced-movement-panel.mjs';
import { VerticalDistancePopup } from './forced-movement-vertical-popup.mjs';
import { runMultiTokenPicker, setFoundryTargets } from '../ability-automation/target-picker.mjs';

const _runForcedMovement = async (type, distance, targetToken, sourceToken, bonusCreatureDmg = 0, bonusObjectDmg = 0, verticalHeight = 0, fallReduction = 0, noFallDamage = false, ignoreStability = false, noCollisionDamage = false, keywords = [], fastMove = false, suppressMessage = false, juggernaut = false, noMoverCollisionDamage = false, noObstacleCollisionDamage = false) => {
  const noMoverDmg    = noCollisionDamage || noMoverCollisionDamage;
  const noObstacleDmg = noCollisionDamage || noObstacleCollisionDamage;
  const grabState = window._activeGrabs?.get(targetToken.id);
  if (grabState) {
    const sourceIsGrabber = sourceToken && sourceToken.id === grabState.grabberTokenId;
    if (!sourceIsGrabber) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.grabbed'));
      return;
    }
  }

  if (targetToken.actor?.statuses?.has('restrained')) {
    if (!(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
      ui.notifications.warn(game.i18n.format('DSCT.notice.fm.restrained', { name: targetToken.name }));
      return;
    }
  }

  const GRID      = getGRID();
  const stability = ignoreStability ? 0 : (targetToken.actor?.system?.combat?.stability ?? 0);
  const tokenSize = targetToken.actor?.system?.combat?.size?.value ?? targetToken.document.width ?? 1;
  const isLargeToken = tokenSize >= 2;

  let effectiveDistance   = distance;
  let effectiveVertical   = verticalHeight;
  if (keywords.includes('melee') && sourceToken) {
    const attackerRank = sizeRank(sourceToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
    const targetRank   = sizeRank(targetToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
    if (attackerRank > targetRank) {
      effectiveDistance += 1;
      if (effectiveVertical !== 0) effectiveVertical += effectiveVertical > 0 ? 1 : -1;
      ui.notifications.info(game.i18n.format('DSCT.notice.fm.largerBonus', { type, source: sourceToken.name, target: targetToken.name }));
    }
  }

  let reduced       = Math.max(0, effectiveDistance - stability);
  const vertSign    = effectiveVertical >= 0 ? 1 : -1;
  let reducedVert = Math.max(0, Math.abs(effectiveVertical) - stability) * vertSign;
  let isVertical  = reducedVert !== 0;

  if (reduced === 0 && reducedVert === 0) {
    ui.notifications.info(game.i18n.format('DSCT.notice.fm.stabilityFullyResists', { name: targetToken.name }));
    return;
  }

  if (stability > 0) {
    const parts = [];
    if (distance > 0)                    parts.push(`push ${distance} to ${reduced}`);
    if (Math.abs(effectiveVertical) > 0) parts.push(`vertical ${Math.abs(effectiveVertical)} to ${Math.abs(reducedVert)}`);
    ui.notifications.info(game.i18n.format('DSCT.notice.fm.stabilityReduces', { name: targetToken.name, amount: stability, parts: parts.join(', ') }));
  }

  const startElev  = targetToken.document.elevation ?? 0;
  const agility      = targetToken.actor?.system?.characteristics?.agility?.value ?? 0;
  const canFly       = canCurrentlyFly(targetToken.actor);
  const targetIsDead = isTokenDead(targetToken);
  const sourceSize = sourceToken
    ? (sourceToken.actor?.system?.combat?.size?.value ?? sourceToken.document.width ?? 1)
    : 1;
  const sourceGrid = sourceToken ? {
    x: sourceToken.document.x / GRID + sourceSize / 2,
    y: sourceToken.document.y / GRID + sourceSize / 2,
  } : null;
  const sourceCells = sourceToken
    ? footprintCells(
        Math.round(sourceToken.document.x / GRID),
        Math.round(sourceToken.document.y / GRID),
        sourceSize
      )
    : [];
  const sourceCellSet = new Set(sourceCells.map(c => `${c.x},${c.y}`));
  const startGrid  = toGrid(targetToken.document);

  const buildSummary = () => {
    const flyingConversion = origReduced > 0 && reduced === 0;
    const parts = flyingConversion
      ? [`${type} ${Math.abs(reducedVert)} (vertical)`]
      : [`${type} ${reduced}`];
    if (!flyingConversion && isVertical) parts.push(`vertical ${reducedVert}`);
    if (bonusCreatureDmg)   parts.push(`+${bonusCreatureDmg} creature collision`);
    if (bonusObjectDmg)     parts.push(`+${bonusObjectDmg} object collision`);
    if (fallReduction)      parts.push(`+${fallReduction} fall reduction`);
    if (noFallDamage)       parts.push('no fall damage');
    if (noCollisionDamage)          parts.push('no collision damage');
    if (noMoverCollisionDamage)     parts.push('no mover collision damage');
    if (noObstacleCollisionDamage)   parts.push('no obstacle collision damage');
    if (ignoreStability)    parts.push('ignores stability');
    if (juggernaut)         parts.push('juggernaut mode');
    const summaryPrefix = juggernaut ? '<strong>UNSTOPPABLE.</strong> ' : '';
    let summary = `${summaryPrefix}<strong>${targetToken.name}</strong> forced: ${parts.join(', ')}.`;
    if (stability > 0 && !ignoreStability) {
      const stabParts = [];
      if (distance !== origReduced && origReduced > 0)                                        stabParts.push(`push ${distance} to ${origReduced}`);
      if (Math.abs(verticalHeight) !== Math.abs(reducedVert) && Math.abs(verticalHeight) > 0) stabParts.push(`vertical ${Math.abs(verticalHeight)} to ${Math.abs(reducedVert)}`);
      if (stabParts.length) summary += ` Stability reduced ${stabParts.join(', ')}.`;
    }
    if (friendlyFireNote) summary += ` ${friendlyFireNote}`;
    return summary;
  };

  
  const cornerCutMode = getSetting('cornerCutMode');

  const ncdNote  = (noMoverDmg && noObstacleDmg) ? ' (No Collision Damage)' : noMoverDmg ? ' (No Mover Damage)' : noObstacleDmg ? ' (No Obstacle Damage)' : '';
  let moverIsDefeated    = false;
  let friendlyFireNote   = null;
  const dmgStr        = (n) => `${noMoverDmg  ? 'would take' : 'takes'} <strong>${n} damage</strong>${ncdNote}`;
  const TakesStr      = (n) => `${noMoverDmg  ? 'Would take' : 'Takes'} <strong>${n} damage</strong>${ncdNote}`;
  const blockerDmgStr = (n) => `${noObstacleDmg ? 'would take' : 'takes'} <strong>${n} damage</strong>`;
  const moverAndTakes  = (n) => moverIsDefeated ? '' : ` and ${dmgStr(n)}`;
  const moverDealsNote = (n) => moverIsDefeated ? '' : `, deals <strong>${n} damage</strong>`;

  const hs = tokenSize / 2;
  const ctr = (g) => ({ x: g.x + hs, y: g.y + hs });

  
  const roundHalfFloor = (x) => {
    const frac = x - Math.floor(x);
    return frac === 0.5 ? Math.floor(x) : Math.round(x);
  };

  const isBurrowing  = targetToken.actor?.statuses?.has('burrow') ?? false;
  const isFlying     = targetToken.actor?.statuses?.has('fly')    ?? false;
  const statusMode   = getSetting('statusDrivesMovementType');
  const origReduced  = reduced;

  if (isFlying && (startElev > 0 || statusMode) && reduced > 0 && reducedVert === 0) {
    reducedVert = (type === 'Pull' ? -1 : 1) * reduced;
    reduced     = 0;
    isVertical  = true;
  }

  const checkStepCollisionAtElev = (from, to, elev) => {
    if (elev < 0 && (getSetting('negativeElevationIsBurrowing') || isBurrowing)) return true;
    if (isBurrowing && statusMode) return true;
    const w = wallBetween(from, to);
    if (w && !hasTags(w, 'broken')) {
      const wb = w.flags?.['wall-height']?.bottom ?? 0;
      const wt = w.flags?.['wall-height']?.top    ?? Infinity;
      if (!(elev >= wt || elev < wb)) return true;
    }
    if (cornerCutsWall(from, to, elev)) return true;
    const checkCells = isLargeToken ? footprintCells(to.x, to.y, tokenSize) : [to];
    for (const tile of tilesAtCells(checkCells)) {
      if (!hasTags(tile, 'obstacle') || hasTags(tile, 'broken')) continue;
      const bt      = getTags(tile).find(t => t.startsWith('wall-block-'));
      const tws     = bt ? getByTag(bt).filter(o => Array.isArray(o.c)) : [];
      const tBottom = tws[0]?.flags?.['wall-height']?.bottom ?? 0;
      const tTop    = tws[0]?.flags?.['wall-height']?.top    ?? Infinity;
      if (elev >= tBottom && elev < tTop) return true;
    }
    if (isLargeToken) {
      return tokensAtCells(footprintCells(to.x, to.y, tokenSize), targetToken.id, elev, tokenSize).length > 0;
    }
    const t = tokenAt(to.x, to.y, targetToken.id);
    if (!t || (isTokenDead(t) && !getSetting('corpsesBlock'))) return false;
    const bElev = t.document.elevation ?? 0;
    const bSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
    if (bElev >= elev && (bElev - elev) >= tokenSize) return false;
    if (bElev <  elev && (elev - bElev) >= bSize)     return false;
    return true;
  };

  let autoPath = null;
  if (fastMove && reduced > 0) {
      if (sourceToken && (type === 'Push' || type === 'Pull')) {
          let dx = targetToken.center.x - sourceToken.center.x;
          let dy = targetToken.center.y - sourceToken.center.y;

		if (dx !== 0 || dy !== 0) {
                let angle = Math.atan2(dy, dx);
                if (type === 'Pull') angle += Math.PI;

                const dirX = Math.cos(angle);
                const dirY = Math.sin(angle);

                if (getSetting('debugMode')) {
                  const dbgGfx = new PIXI.Graphics();
                  canvas.app.stage.addChild(dbgGfx);
                  const sc = sourceToken.center;
                  const tc = targetToken.center;
                  const lineLen = Math.sqrt(dx * dx + dy * dy) * 1.5;
                  dbgGfx.lineStyle(3, 0xff0000, 0.9);
                  dbgGfx.moveTo(sc.x, sc.y);
                  dbgGfx.lineTo(sc.x + dirX * lineLen, sc.y + dirY * lineLen);
                  dbgGfx.lineStyle(3, 0x00ffff, 0.9);
                  dbgGfx.moveTo(sc.x, sc.y);
                  dbgGfx.lineTo(tc.x, tc.y);
                  console.log(`DSCT | AutoPath debug | src center=(${sc.x.toFixed(1)},${sc.y.toFixed(1)}) tgt center=(${tc.x.toFixed(1)},${tc.y.toFixed(1)}) angle=${(angle*180/Math.PI).toFixed(1)} deg dirX=${dirX.toFixed(3)} dirY=${dirY.toFixed(3)}`);
                  setTimeout(() => { canvas.app.stage.removeChild(dbgGfx); dbgGfx.destroy(); }, 2000);
                }
              
              autoPath = [];
              let currGrid = { ...startGrid };
              
              for (let i = 0; i < reduced; i++) {
                  const adjacents = [
                      {x: currGrid.x - 1, y: currGrid.y - 1}, {x: currGrid.x, y: currGrid.y - 1}, {x: currGrid.x + 1, y: currGrid.y - 1},
                      {x: currGrid.x - 1, y: currGrid.y},                                         {x: currGrid.x + 1, y: currGrid.y},
                      {x: currGrid.x - 1, y: currGrid.y + 1}, {x: currGrid.x, y: currGrid.y + 1}, {x: currGrid.x + 1, y: currGrid.y + 1}
                  ];

                  let bestNext = null;
                  let bestScore = Infinity;

                  for (const adj of adjacents) {
                      if (type === 'Push' && sourceCellSet.has(`${adj.x},${adj.y}`)) continue;
                      if (cornerCutsWall(currGrid, adj) && cornerCutMode === 'block') continue;

                      let distSource = gridDist(ctr(adj), sourceGrid);
                      let currDistSource = gridDist(ctr(currGrid), sourceGrid);

                      if (type === 'Push' && distSource <= currDistSource) continue;
                      if (type === 'Pull' && distSource >= currDistSource && distSource !== 0) continue;

                      const adjCenterWorld = {
                          x: adj.x * GRID + tokenSize * GRID / 2,
                          y: adj.y * GRID + tokenSize * GRID / 2,
                      };
                      let vx = adjCenterWorld.x - targetToken.center.x;
                      let vy = adjCenterWorld.y - targetToken.center.y;

                      let dot = vx * dirX + vy * dirY;
                      if (dot <= 0.1) continue;

                      let cross = Math.abs(vx * dirY - vy * dirX);

                      let score = cross - dot * 0.001;

                      if (score < bestScore) {
                          bestScore = score;
                          bestNext = adj;
                      }
                  }
                  
                  if (!bestNext) break; 
                  autoPath.push(bestNext);
                  currGrid = bestNext;
              }
          } else {
              ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.autoPathFailed'));
          }
      } else if (type === 'Slide') {
          ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.fastMoveOnlyPushPull'));
      }
  }

  
  let destroyArrow     = () => {};
  let previewArrow     = null;
  let previewCollision = null;
  let lastArrowPts     = [];
  let lastVisiblePts   = [];
  let finalPath = autoPath;
  if (!finalPath) {
    finalPath = await new Promise((resolve) => {
      if (reduced === 0) { resolve([]); return; }

      const path         = [];
      const pathSegments = []; 
      const graphics           = new PIXI.Graphics();
      const arrowGraphics      = new PIXI.Graphics();
      const chevronGraphics    = new PIXI.Graphics();
      const maskGraphics       = new PIXI.Graphics();
      const chevronMaskGraphics = new PIXI.Graphics();
      canvas.app.stage.addChild(graphics);
      canvas.app.stage.addChild(arrowGraphics);
      canvas.app.stage.addChild(chevronGraphics);

      const drawArrowShaft = (pts, vVal) => {
        const ag = arrowGraphics;
        ag.clear();
        if (pts.length < 2) return;
        const start = pts[0];
        const last  = pts[pts.length - 1];
        const penul = pts[pts.length - 2];
        const adx = last.x - penul.x, ady = last.y - penul.y;
        const alen = Math.hypot(adx, ady);
        if (alen < 0.01) return;
        const ux = adx / alen, uy = ady / alen;
        const nx = -uy, ny = ux;
        const thin     = GRID * 0.08;
        const wideBase = GRID * 0.19;
        const vRatio   = reduced > 0 ? Math.max(-1, Math.min(1, vVal / reduced)) : Math.sign(vVal);
        
        
        const ease   = vRatio * vRatio;
        const wide   = vRatio >= 0
          ? wideBase + (GRID * 0.28 - wideBase) * ease   
          : wideBase - (wideBase - thin)         * ease;  
        const startW = vRatio <= 0
          ? thin     + (GRID * 0.32 - thin)      * ease   
          : thin;                                          
        const tipScale = wide / wideBase;
        const HW   = GRID * 0.33 * tipScale;
        const HL   = GRID * 0.46 * tipScale;
        const cr   = GRID * 0.35;
        const SO   = 3;
        const GLOW = [[GRID * 0.24, 0.07], [GRID * 0.15, 0.14], [GRID * 0.08, 0.30], [GRID * 0.03, 0.65]];
        const baseX = last.x - ux * HL, baseY = last.y - uy * HL;
        const shiftPoly = (p, ox, oy) => p.map((v, i) => v + (i % 2 === 0 ? ox : oy));
        const taperPoly = (t, w, hw, tipExt) => [
          start.x + nx * t,       start.y + ny * t,
          baseX   + nx * w,       baseY   + ny * w,
          baseX   + nx * hw,      baseY   + ny * hw,
          last.x  + ux * tipExt,  last.y  + uy * tipExt,
          baseX   - nx * hw,      baseY   - ny * hw,
          baseX   - nx * w,       baseY   - ny * w,
          start.x - nx * t,       start.y - ny * t,
        ];
        if (pts.length === 2) {
          const redP = taperPoly(startW, wide, HW, GRID * 0.3 * tipScale);
          ag.beginFill(0x000000, 0.22);
          ag.drawPolygon(shiftPoly(redP, SO, SO));
          ag.drawCircle(start.x + SO, start.y + SO, startW);
          ag.endFill();
          for (const [w, a] of GLOW) {
            ag.lineStyle(w, 0xffffff, a);
            ag.drawPolygon(redP);
            ag.drawCircle(start.x, start.y, startW);
            ag.lineStyle(0);
          }
          ag.beginFill(0xdd1111, 1.0);
          ag.drawPolygon(redP);
          ag.drawCircle(start.x, start.y, startW);
          ag.endFill();
        } else {
          const pts2 = [{ x: start.x, y: start.y }];
          for (let i = 1; i < pts.length - 1; i++) {
            const A = pts[i - 1], B = pts[i], C = pts[i + 1];
            const d1 = Math.hypot(B.x - A.x, B.y - A.y);
            const d2 = Math.hypot(C.x - B.x, C.y - B.y);
            if (d1 < 0.01 || d2 < 0.01) { pts2.push({ x: B.x, y: B.y }); continue; }
            const r = Math.min(cr, d1 / 2, d2 / 2);
            const t1x = B.x - (B.x - A.x) / d1 * r, t1y = B.y - (B.y - A.y) / d1 * r;
            const t2x = B.x + (C.x - B.x) / d2 * r, t2y = B.y + (C.y - B.y) / d2 * r;
            pts2.push({ x: t1x, y: t1y });
            for (let s = 1; s <= 8; s++) {
              const q = s / 8, mq = 1 - q;
              pts2.push({ x: mq*mq*t1x + 2*mq*q*B.x + q*q*t2x, y: mq*mq*t1y + 2*mq*q*B.y + q*q*t2y });
            }
          }
          pts2.push({ x: baseX, y: baseY });
          const arcs = [0];
          for (let i = 1; i < pts2.length; i++) arcs.push(arcs[i-1] + Math.hypot(pts2[i].x - pts2[i-1].x, pts2[i].y - pts2[i-1].y));
          const shaftLen = arcs[arcs.length - 1];
          const rE = [], lE = [];
          for (let i = 0; i < pts2.length; i++) {
            const t = shaftLen > 0 ? arcs[i] / shaftLen : 0;
            const w = startW + (wide - startW) * t;
            let tx, ty;
            if (i < pts2.length - 1) {
              const ddx = pts2[i+1].x - pts2[i].x, ddy = pts2[i+1].y - pts2[i].y;
              const dd = Math.hypot(ddx, ddy);
              tx = dd > 0.001 ? ddx/dd : ux; ty = dd > 0.001 ? ddy/dd : uy;
            } else { tx = ux; ty = uy; }
            const px = -ty, py = tx;
            rE.push(pts2[i].x + px * w, pts2[i].y + py * w);
            lE.push(pts2[i].x - px * w, pts2[i].y - py * w);
          }
          const revFlat = arr => { const r = []; for (let i = arr.length - 2; i >= 0; i -= 2) r.push(arr[i], arr[i+1]); return r; };
          const curvedP = [
            ...rE,
            baseX + nx * HW, baseY + ny * HW,
            last.x + ux * (GRID * 0.3 * tipScale), last.y + uy * (GRID * 0.3 * tipScale),
            baseX - nx * HW, baseY - ny * HW,
            ...revFlat(lE),
          ];
          ag.beginFill(0x000000, 0.22);
          ag.drawPolygon(shiftPoly(curvedP, SO, SO));
          ag.drawCircle(start.x + SO, start.y + SO, startW);
          ag.endFill();
          for (const [w, a] of GLOW) {
            ag.lineStyle(w, 0xffffff, a);
            ag.drawPolygon(curvedP);
            ag.drawCircle(start.x, start.y, startW);
            ag.lineStyle(0);
          }
          ag.beginFill(0xdd1111, 1.0);
          ag.drawPolygon(curvedP);
          ag.drawCircle(start.x, start.y, startW);
          ag.endFill();
        }
      };

      const colorRange    = 0xffff00;
      const colorPath     = 0x4488ff;
      const colorStart    = 0xffaa00;
      const colorValid    = 0x44cc44;
      const colorSuggest  = 0x88ffbb;
      const colorInvalid  = 0xcc4444;
      const colorCollision = 0xff7700;

      const allowSourceCells = (type === 'Pull' || type === 'Slide');

      const straightLineRequired = (type === 'Push' || type === 'Pull') && !getSetting('allowCrookedPushPull');
      let lockedDirX = null;
      let lockedDirY = null;

      if (straightLineRequired && type === 'Pull' && sourceGrid) {
        const dvx = sourceGrid.x - (startGrid.x + hs);
        const dvy = sourceGrid.y - (startGrid.y + hs);
        const len = Math.sqrt(dvx * dvx + dvy * dvy);
        if (len > 0) { lockedDirX = dvx / len; lockedDirY = dvy / len; }
      }

      const isOnLine = (g) => {
        if (lockedDirX === null) return true;
        const cx = (g.x + hs) - (startGrid.x + hs);
        const cy = (g.y + hs) - (startGrid.y + hs);
        const dot   = cx * lockedDirX + cy * lockedDirY;
        const cross = cx * lockedDirY - cy * lockedDirX;
        return dot > 0 && Math.abs(cross) < 0.71;
      };

      const computeRangeHighlight = (fromGrid, stepsRemaining) => {
        const pathSet   = new Set(path.map(p => `${p.x},${p.y}`));
        const reachable = new Set();
        const key = g => `${g.x},${g.y}`;
        const visited = new Map();
        visited.set(key(fromGrid), 0);
        const queue = [{ pos: fromGrid, steps: 0 }];
        const drawCap = _fmDistCap();
        while (queue.length) {
          const { pos, steps } = queue.shift();
          if (steps >= stepsRemaining || steps >= drawCap) continue;
          const neighbors = [
            { x: pos.x - 1, y: pos.y - 1 }, { x: pos.x, y: pos.y - 1 }, { x: pos.x + 1, y: pos.y - 1 },
            { x: pos.x - 1, y: pos.y },                                    { x: pos.x + 1, y: pos.y },
            { x: pos.x - 1, y: pos.y + 1 }, { x: pos.x, y: pos.y + 1 }, { x: pos.x + 1, y: pos.y + 1 },
          ];
          for (const nb of neighbors) {
            if (gridEq(nb, startGrid)) continue;
            if (pathSet.has(key(nb))) continue;
            if (!allowSourceCells && sourceCellSet.has(key(nb))) continue;
            if (type === 'Push' && sourceGrid && gridDist(ctr(nb), sourceGrid) <= gridDist(ctr(pos), sourceGrid)) continue;
            if (type === 'Pull' && sourceGrid && gridDist(ctr(nb), sourceGrid) >= gridDist(ctr(pos), sourceGrid)) continue;
            if (cornerCutsWall(pos, nb) && cornerCutMode === 'block') continue;
            const k = key(nb);
            if (!visited.has(k)) {
              visited.set(k, steps + 1);
              reachable.add(k);
              queue.push({ pos: nb, steps: steps + 1 });
            }
          }
        }
        const wallReachable = new Set();
        for (const k of reachable) {
          const [rx, ry] = k.split(',').map(Number);
          const pos = { x: rx, y: ry };
          for (const nb of [
            { x: pos.x - 1, y: pos.y }, { x: pos.x + 1, y: pos.y },
            { x: pos.x, y: pos.y - 1 }, { x: pos.x, y: pos.y + 1 },
          ]) {
            const nk = key(nb);
            if (!reachable.has(nk) && !gridEq(nb, startGrid) && !pathSet.has(nk) && (allowSourceCells || !sourceCellSet.has(nk))) {
              if (type === 'Push' && sourceGrid && gridDist(ctr(nb), sourceGrid) <= gridDist(ctr(pos), sourceGrid)) continue;
              if (type === 'Pull' && sourceGrid && gridDist(ctr(nb), sourceGrid) >= gridDist(ctr(pos), sourceGrid)) continue;
              wallReachable.add(nk);
            }
          }
        }
        return { reachable, wallReachable };
      };
      let { reachable: rangeHighlight, wallReachable } = computeRangeHighlight(startGrid, reduced);

      const recomputeRange = () => {
        const from      = path.length > 0 ? path[path.length - 1] : startGrid;
        const stepsLeft = reduced - path.length;
        const result    = computeRangeHighlight(from, stepsLeft);
        rangeHighlight  = result.reachable;
        wallReachable   = result.wallReachable;
      };

      const getLineFiltered = () => {
        if (lockedDirX === null) return { activeRange: rangeHighlight, activeWall: wallReachable };
        const activeRange = new Set([...rangeHighlight].filter(k => { const [x,y] = k.split(',').map(Number); return isOnLine({x,y}); }));
        const activeWall  = new Set([...wallReachable ].filter(k => { const [x,y] = k.split(',').map(Number); return isOnLine({x,y}); }));
        return { activeRange, activeWall };
      };

      const isValidStep = (from, to) => {
        if (gridDist(from, to) !== 1) return false;
        if (gridEq(to, startGrid)) return false;
        if (!allowSourceCells && sourceCellSet.has(`${to.x},${to.y}`)) return false;
        for (const p of path) if (gridEq(to, p)) return false;
        if (cornerCutsWall(from, to) && cornerCutMode === 'block') return false;
        if (type === 'Push' && sourceGrid && gridDist(ctr(to), sourceGrid) <= gridDist(ctr(from), sourceGrid)) return false;
        if (type === 'Pull' && sourceGrid && gridDist(ctr(to), sourceGrid) >= gridDist(ctr(from), sourceGrid)) return false;
        if (straightLineRequired && !isOnLine(to)) return false;
        return true;
      };

      const getSuggestedPath = (from, to) => {
        const remaining = reduced - path.length;

        if (type === 'Push' || type === 'Pull') {
          const fx = from.x + hs, fy = from.y + hs;
          const ldx = (to.x + hs) - fx, ldy = (to.y + hs) - fy;
          const llen = Math.sqrt(ldx * ldx + ldy * ldy);
          const steps = [];
          let curr = { ...from };
          while (!gridEq(curr, to)) {
            if (steps.length >= remaining) return null;
            const dx = Math.sign(to.x - curr.x);
            const dy = Math.sign(to.y - curr.y);
            const candidates = [];
            if (dx !== 0 && dy !== 0) candidates.push({ x: curr.x + dx, y: curr.y + dy });
            if (dx !== 0) candidates.push({ x: curr.x + dx, y: curr.y });
            if (dy !== 0) candidates.push({ x: curr.x, y: curr.y + dy });
            let best = null, bestDist = Infinity;
            for (const c of candidates) {
              if (!isValidStep(curr, c)) continue;
              const cx = (c.x + hs) - fx, cy = (c.y + hs) - fy;
              const cross = llen > 0 ? Math.abs(cx * ldy - cy * ldx) / llen : 0;
              if (cross < bestDist) { bestDist = cross; best = c; }
            }
            if (!best) return null;
            steps.push(best);
            curr = best;
          }
          return steps.length > 0 ? steps : null;
        }

        if (cornerCutMode === 'collide') {
          const steps = [];
          let curr = { ...from };
          while (!gridEq(curr, to)) {
            if (steps.length >= remaining) return null;
            const dx = Math.sign(to.x - curr.x);
            const dy = Math.sign(to.y - curr.y);
            const candidates = [];
            if (dx !== 0 && dy !== 0) candidates.push({ x: curr.x + dx, y: curr.y + dy });
            if (dx !== 0) candidates.push({ x: curr.x + dx, y: curr.y });
            if (dy !== 0) candidates.push({ x: curr.x, y: curr.y + dy });
            let chosen = null;
            for (const c of candidates) {
              if (gridEq(c, startGrid)) continue;
              if (!allowSourceCells && sourceCellSet.has(`${c.x},${c.y}`)) continue;
              if (path.some(p => gridEq(p, c)) || steps.some(s => gridEq(s, c))) continue;
              if (straightLineRequired && !isOnLine(c)) continue;
              chosen = c;
              break;
            }
            if (!chosen) return null;
            steps.push(chosen);
            curr = chosen;
          }
          return steps.length > 0 ? steps : null;
        }

        const key = g => `${g.x},${g.y}`;
        const parent = new Map();
        parent.set(key(from), null);
        const queue = [from];
        while (queue.length) {
          const curr = queue.shift();
          if (gridEq(curr, to)) {
            const steps = [];
            let k = key(to);
            while (parent.get(k) !== null) {
              const [x, y] = k.split(',').map(Number);
              steps.unshift({ x, y });
              k = parent.get(k);
            }
            return steps.length > 0 && steps.length <= remaining ? steps : null;
          }
          const neighbors = [
            { x: curr.x - 1, y: curr.y - 1 }, { x: curr.x, y: curr.y - 1 }, { x: curr.x + 1, y: curr.y - 1 },
            { x: curr.x - 1, y: curr.y },                                      { x: curr.x + 1, y: curr.y },
            { x: curr.x - 1, y: curr.y + 1 }, { x: curr.x, y: curr.y + 1 }, { x: curr.x + 1, y: curr.y + 1 },
          ];
          for (const nb of neighbors) {
            const k = key(nb);
            if (!parent.has(k) && isValidStep(curr, nb)) {
              parent.set(k, key(curr));
              queue.push(nb);
            }
          }
          if (parent.size > 10000) break;
        }
        return null;
      };

      const stepIsCollision = (from, to) => {
        if (wallReachable.has(`${to.x},${to.y}`) || cornerCutsWall(from, to)) return true;
        if (wallBetween(from, to)) return true;
        if (isLargeToken) return tokensAtCells(footprintCells(to.x, to.y, tokenSize), targetToken.id, startElev, tokenSize).length > 0;
        const t = tokenAt(to.x, to.y, targetToken.id);
        if (!t || (isTokenDead(t) && !getSetting('corpsesBlock'))) return false;
        const bElev = t.document.elevation ?? 0;
        const bSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
        if (bElev >= startElev && (bElev - startElev) >= tokenSize) return false;
        if (bElev <  startElev && (startElev - bElev) >= bSize)     return false;
        return true;
      };

      
      const cellHasWall = (gx, gy) => {
        const x0 = gx * GRID, y0 = gy * GRID;
        const x1 = x0 + GRID,  y1 = y0 + GRID;
        const seg = (ax, ay, bx, by, cx, cy, dx, dy) => {
          const cross = (ox, oy, px, py, qx, qy) => (px-ox)*(qy-oy) - (py-oy)*(qx-ox);
          const d1 = cross(cx,cy,dx,dy,ax,ay), d2 = cross(cx,cy,dx,dy,bx,by);
          const d3 = cross(ax,ay,bx,by,cx,cy), d4 = cross(ax,ay,bx,by,dx,dy);
          return (((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0)));
        };
        for (const w of canvas.walls.placeables) {
          const c = w.document.c;
          const [wx0,wy0,wx1,wy1] = c;
          if (wx0>=x0&&wx0<=x1&&wy0>=y0&&wy0<=y1) return true;
          if (wx1>=x0&&wx1<=x1&&wy1>=y0&&wy1<=y1) return true;
          if (seg(wx0,wy0,wx1,wy1, x0,y0,x1,y0)) return true; 
          if (seg(wx0,wy0,wx1,wy1, x1,y0,x1,y1)) return true; 
          if (seg(wx0,wy0,wx1,wy1, x1,y1,x0,y1)) return true; 
          if (seg(wx0,wy0,wx1,wy1, x0,y1,x0,y0)) return true; 
        }
        return false;
      };

      const cellIsObstacle = (gx, gy) => {
        if (cellHasWall(gx, gy)) return true;
        if (isLargeToken) return tokensAtCells(footprintCells(gx, gy, tokenSize), targetToken.id, startElev, tokenSize).length > 0;
        const t = tokenAt(gx, gy, targetToken.id);
        if (!t || (isTokenDead(t) && !getSetting('corpsesBlock'))) return false;
        const bElev = t.document.elevation ?? 0;
        const bSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
        if (bElev >= startElev && (bElev - startElev) >= tokenSize) return false;
        if (bElev <  startElev && (startElev - bElev) >= bSize) return false;
        return true;
      };

      
      
      
      const physicalCollision = (from, to) => {
        if (cornerCutsWall(from, to)) return true;
        if (wallBetween(from, to)) return true;
        if (isLargeToken) return tokensAtCells(footprintCells(to.x, to.y, tokenSize), targetToken.id, startElev, tokenSize).length > 0;
        const t = tokenAt(to.x, to.y, targetToken.id);
        if (!t || (isTokenDead(t) && !getSetting('corpsesBlock'))) return false;
        const bElev = t.document.elevation ?? 0;
        const bSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
        if (bElev >= startElev && (bElev - startElev) >= tokenSize) return false;
        if (bElev <  startElev && (startElev - bElev) >= bSize)     return false;
        return true;
      };

      const overlay = new PIXI.Container();
      overlay.interactive = true;
      overlay.hitArea     = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
      canvas.app.stage.addChild(overlay);
      let hoverGrid = null;
      let _debugLabels   = [];
      let _debugLastPath = '';

      overlay.addChild(maskGraphics);
      overlay.addChild(chevronMaskGraphics);

      const redraw = (hover, log = false) => {
        graphics.clear();
        arrowGraphics.clear();
        chevronGraphics.clear();
        maskGraphics.clear();
        chevronMaskGraphics.clear();
        _debugLabels.forEach(t => { overlay.removeChild(t); t.destroy(); });
        _debugLabels = [];
        const { activeRange, activeWall } = getLineFiltered();
        const lineActive = lockedDirX !== null && (type === 'Push' || type === 'Pull');

        
        
        const expandFootprint = (sourceSet, activeSet) => {
          const cells = new Map();
          for (const k of sourceSet) {
            const [gx, gy] = k.split(',').map(Number);
            const active = !lineActive || activeSet.has(k);
            for (let ix = 0; ix < tokenSize; ix++) {
              for (let iy = 0; iy < tokenSize; iy++) {
                const ck = `${gx + ix},${gy + iy}`;
                if (!cells.has(ck) || active) cells.set(ck, active);
              }
            }
          }
          return cells;
        };
        for (const [k, active] of expandFootprint(rangeHighlight, activeRange)) {
          const [gx, gy] = k.split(',').map(Number);
          const rw = toWorld({ x: gx, y: gy });
          graphics.beginFill(colorRange, active ? 0.18 : 0.05);
          graphics.drawRect(rw.x, rw.y, GRID, GRID);
          graphics.endFill();
        }
        for (const [k, active] of expandFootprint(wallReachable, activeWall)) {
          const [gx, gy] = k.split(',').map(Number);
          const rw = toWorld({ x: gx, y: gy });
          graphics.beginFill(colorCollision, active ? 0.15 : 0.04);
          graphics.drawRect(rw.x, rw.y, GRID, GRID);
          graphics.endFill();
        }

        const cellMap = new Map();
        const setCells = (gx, gy, color, alpha) => {
          for (let ix = 0; ix < tokenSize; ix++)
            for (let iy = 0; iy < tokenSize; iy++)
              cellMap.set(`${gx + ix},${gy + iy}`, { color, alpha });
        };

        setCells(startGrid.x, startGrid.y, colorStart, 0.35);

        const _debugMode       = getSetting('debugMode');
        const _obstacleArrow   = _debugMode && getSetting('experimentalObstacleArrow');
        const _pathKey         = _debugMode ? JSON.stringify(path) : '';
        const _doLog           = _debugMode && _pathKey !== _debugLastPath;
        if (_doLog) {
          _debugLastPath = _pathKey;
          console.group(`%c[DSCT FM] Committed path (${path.length} step${path.length !== 1 ? 's' : ''})`, 'color:#ff7700;font-weight:bold');
          console.log('startGrid:', startGrid);
        }

        const _orangeGridCells = new Set();
        for (let pi = 0; pi < path.length; pi++) {
          const p           = path[pi];
          const prev        = pi > 0 ? path[pi - 1] : startGrid;
          const _cwIn       = cornerCutsWall(prev, p);
          const _isObstacle = _cwIn || cellIsObstacle(p.x, p.y);
          if (_isObstacle) _orangeGridCells.add(`${p.x},${p.y}`);
          if (_doLog) {
            console.log(`step ${pi} (${p.x},${p.y}) → cellHasWall:${cellHasWall(p.x, p.y)} cornerCut:${_cwIn} isObstacle:${_isObstacle} → ${_isObstacle ? 'ORANGE' : 'BLUE'}`);
          }
          setCells(p.x, p.y, _isObstacle ? colorCollision : colorPath, 0.45);
        }

        if (_doLog) console.groupEnd();

        if (hover && path.length < reduced) {
          const prev = path.length ? path[path.length - 1] : startGrid;
          const hk   = `${hover.x},${hover.y}`;
          const inRange = activeRange.has(hk) || activeWall.has(hk);
          const destCollision = cornerCutsWall(prev, hover) || cellIsObstacle(hover.x, hover.y);

          if (isValidStep(prev, hover)) {
            setCells(hover.x, hover.y, destCollision ? colorCollision : colorValid, 0.45);
          } else if (inRange) {
            const suggestion = getSuggestedPath(prev, hover);
            if (suggestion) {
              let suggPrev = prev;
              for (const s of suggestion) {
                setCells(s.x, s.y, (cornerCutsWall(suggPrev, s) || cellIsObstacle(s.x, s.y)) ? colorCollision : colorSuggest, 0.45);
                suggPrev = s;
              }
            }
            setCells(hover.x, hover.y, destCollision ? colorCollision : colorValid, 0.45);
          } else {
            setCells(hover.x, hover.y, colorInvalid, 0.4);
          }
        }

        for (const [k, { color, alpha }] of cellMap) {
          const [gx, gy] = k.split(',').map(Number);
          const pw = toWorld({ x: gx, y: gy });
          graphics.beginFill(color, alpha);
          graphics.drawRect(pw.x, pw.y, GRID, GRID);
          graphics.endFill();
        }

        if (getSetting('debugMode') && sourceToken && hover) {
          const sc = sourceToken.center;
          const hw = toWorld(hover);
          const hcx = hw.x + (GRID * tokenSize) / 2;
          const hcy = hw.y + (GRID * tokenSize) / 2;
          graphics.lineStyle(2, 0xff0000, 0.85);
          graphics.moveTo(sc.x, sc.y);
          graphics.lineTo(hcx, hcy);
          graphics.lineStyle(0);
        }

        const tileCenter = g => { const w = toWorld(g); return { x: w.x + (GRID * tokenSize) / 2, y: w.y + (GRID * tokenSize) / 2 }; };
        const arrowPts = [tileCenter(startGrid)];
        
        const segIsCollision = [];
        if (straightLineRequired) {
          
          const hk = hover ? `${hover.x},${hover.y}` : null;
          const slrPrev = path.length ? path[path.length - 1] : startGrid;
          const hoverValid = hk && (activeRange.has(hk) || isValidStep(slrPrev, hover));
          if (hoverValid) { segIsCollision.push(stepIsCollision(slrPrev, hover)); arrowPts.push(tileCenter(hover)); }
          else if (path.length > 0) { segIsCollision.push(physicalCollision(startGrid, path[path.length - 1])); arrowPts.push(tileCenter(path[path.length - 1])); }
        } else {
          for (let pi = 0; pi < path.length; pi++) {
            const prev = pi > 0 ? path[pi - 1] : startGrid;
            segIsCollision.push(physicalCollision(prev, path[pi]));
            arrowPts.push(tileCenter(path[pi]));
          }
          if (hover && path.length < reduced) {
            const arrowPrev = path.length ? path[path.length - 1] : startGrid;
            const hk = `${hover.x},${hover.y}`;
            if (isValidStep(arrowPrev, hover)) {
              segIsCollision.push(stepIsCollision(arrowPrev, hover));
              arrowPts.push(tileCenter(hover));
            } else if (activeRange.has(hk)) {
              const sugg = getSuggestedPath(arrowPrev, hover);
              if (sugg) {
                let suggPrev = arrowPrev;
                for (const s of sugg) {
                  segIsCollision.push(stepIsCollision(suggPrev, s));
                  arrowPts.push(tileCenter(s));
                  suggPrev = s;
                }
              }
              
              const lastPt = arrowPts[arrowPts.length - 1];
              const hoverPt = tileCenter(hover);
              if (Math.hypot(lastPt.x - hoverPt.x, lastPt.y - hoverPt.y) > 0.5) {
                segIsCollision.push(stepIsCollision(arrowPrev, hover));
                arrowPts.push(hoverPt);
              }
            }
          }
        }
        let chevrons = [];
        let isDestCollision = false;
        if (arrowPts.length >= 2) {
          lastArrowPts = arrowPts;
          
          
          
          let visiblePts = arrowPts;
          const clipPts = (straightLineRequired && arrowPts.length === 2)
            ? (() => {
                const pathCells = path.length > 0
                  ? path
                  : (hover ? (getSuggestedPath(startGrid, hover) ?? []) : []);
                const pts = [arrowPts[0], ...pathCells.map(p => tileCenter(p))];
                const last = pts[pts.length - 1];
                if (Math.hypot(arrowPts[1].x - last.x, arrowPts[1].y - last.y) > 0.5) pts.push(arrowPts[1]);
                return pts;
              })()
            : arrowPts;
          
          
          const straightProject = (straightLineRequired && arrowPts.length === 2)
            ? (stopWorld) => {
                const a = arrowPts[0], b = arrowPts[1];
                const abx = b.x - a.x, aby = b.y - a.y;
                const len = Math.hypot(abx, aby);
                if (len < 0.01) return null;
                const t = Math.max(0, ((stopWorld.x - a.x) * abx + (stopWorld.y - a.y) * aby) / len);
                return [a, { x: a.x + abx / len * t, y: a.y + aby / len * t }];
              }
            : null;
          if (log && getSetting('debugMode')) {
            const orangeCells = [...cellMap.entries()].filter(([, v]) => v.color === colorCollision).map(([k]) => k);
            console.log(`[DSCT FM] Arrow clip: orange cells in map: [${orangeCells.join(', ')}]`);
            console.log(`[DSCT FM] Arrow clip: clipPts keys: [${clipPts.map(p => { const g = toGrid(p); return `${g.x},${g.y}`; }).join(', ')}]`);
          }
          outer: {
            let costSoFar = 0, totalStep = 0;
            for (let i = 1; i < clipPts.length; i++) {
              const gA = toGrid(clipPts[i - 1]), gB = toGrid(clipPts[i]);
              const ddx = gB.x - gA.x, ddy = gB.y - gA.y;
              const steps = Math.max(Math.abs(ddx), Math.abs(ddy));
              for (let s = 1; s <= steps; s++) {
                totalStep++;
                const gx = gA.x + Math.round(ddx * s / steps);
                const gy = gA.y + Math.round(ddy * s / steps);
                if (log && getSetting('debugMode')) console.log(`[DSCT FM] Arrow clip: seg${i} s${s} cell(${gx},${gy}) mapColor=${cellMap.get(`${gx},${gy}`)?.color?.toString(16) ?? 'none'}`);

                
                
                const remaining = reduced - (totalStep - 1) - costSoFar;

                
                if (remaining <= 0) {
                  const stopWorld = s > 1
                    ? tileCenter({ x: gA.x + Math.round(ddx * (s - 1) / steps), y: gA.y + Math.round(ddy * (s - 1) / steps) })
                    : (i > 1 ? clipPts[i - 1] : null);
                  if (straightProject && stopWorld) {
                    const proj = straightProject(stopWorld);
                    if (proj) visiblePts = proj;
                  } else {
                    const pts = stopWorld
                      ? [...clipPts.slice(0, i), stopWorld]
                      : clipPts.slice(0, i);
                    if (pts.length >= 2) visiblePts = pts;
                  }
                  if (log && getSetting('debugMode')) console.log(`[DSCT FM] Arrow exhausted at grid(${gx},${gy}) remaining=${remaining}`);
                  break outer;
                }

                if (cellMap.get(`${gx},${gy}`)?.color !== colorCollision) continue;

                
                const prevPts = s > 1
                  ? [...clipPts.slice(0, i), tileCenter({ x: gA.x + Math.round(ddx * (s - 1) / steps), y: gA.y + Math.round(ddy * (s - 1) / steps) })]
                  : clipPts.slice(0, i);
                const stopBefore = () => {
                  const obstaclePt = tileCenter({ x: gx, y: gy });
                  
                  const toBorder = (pt) => {
                    const bdx = obstaclePt.x - pt.x, bdy = obstaclePt.y - pt.y;
                    const bdlen = Math.hypot(bdx, bdy);
                    return bdlen > 0.01 ? { x: pt.x + bdx / bdlen * GRID * 0.5, y: pt.y + bdy / bdlen * GRID * 0.5 } : pt;
                  };
                  if (straightProject) {
                    const stopWorld = prevPts.length >= 2 ? prevPts[prevPts.length - 1] : null;
                    if (stopWorld) {
                      const proj = straightProject(stopWorld);
                      if (proj) {
                        const extended = toBorder(proj[1]);
                        const fullLen = Math.hypot(arrowPts[1].x - proj[0].x, arrowPts[1].y - proj[0].y);
                        const extLen  = Math.hypot(extended.x - proj[0].x, extended.y - proj[0].y);
                        visiblePts = [proj[0], extLen <= fullLen ? extended : arrowPts[1]];
                        return;
                      }
                    }
                    
                    const a = arrowPts[0], b = arrowPts[1];
                    const abx = b.x - a.x, aby = b.y - a.y;
                    const slen = Math.hypot(abx, aby);
                    if (slen > 0.01) visiblePts = [a, { x: a.x + abx / slen * GRID * 0.5, y: a.y + aby / slen * GRID * 0.5 }];
                  } else if (prevPts.length >= 2) {
                    const extended = toBorder(prevPts[prevPts.length - 1]);
                    visiblePts = [...prevPts.slice(0, -1), extended];
                  } else {
                    
                    const src = clipPts[0];
                    const dx = obstaclePt.x - src.x, dy = obstaclePt.y - src.y;
                    const len = Math.hypot(dx, dy);
                    if (len > 0.01) visiblePts = [src, { x: src.x + dx / len * GRID * 0.5, y: src.y + dy / len * GRID * 0.5 }];
                  }
                };

                const checkCells = isLargeToken ? footprintCells(gx, gy, tokenSize) : [{ x: gx, y: gy }];
                const hitTiles   = tilesAtCells(checkCells).filter(t => hasTags(t, 'obstacle') && !hasTags(t, 'broken'));

                if (hitTiles.length > 0) {
                  const hardTiles = hitTiles.filter(t => !hasTags(t, 'breakable'));
                  if (hardTiles.length > 0 && !juggernaut) {
                    stopBefore();
                    if (log && getSetting('debugMode')) console.log(`[DSCT FM] Arrow stopped: hard tile grid(${gx},${gy})`);
                    break outer;
                  }
                  const softTiles = juggernaut ? hitTiles.filter(t => hasTags(t, 'breakable')) : hitTiles;
                  const maxCost   = juggernaut ? 0 : softTiles.reduce((m, t) => Math.max(m, MATERIAL_RULES()[getMaterial(t)]?.cost ?? 99), 0);
                  if (juggernaut || remaining >= maxCost) {
                    
                    costSoFar += juggernaut ? 0 : (maxCost - 1);
                    if (log && getSetting('debugMode')) console.log(`[DSCT FM] Arrow breaking tile grid(${gx},${gy}) cost=${maxCost} remaining=${remaining}`);
                    continue;
                  } else {
                    stopBefore();
                    if (log && getSetting('debugMode')) console.log(`[DSCT FM] Arrow stopped: insufficient remaining (${remaining}<${maxCost}) grid(${gx},${gy})`);
                    break outer;
                  }
                }

                
                stopBefore();
                if (log && getSetting('debugMode')) console.log(`[DSCT FM] Arrow stopped: creature/wall grid(${gx},${gy})`);
                break outer;
              }
            }
          }
          lastVisiblePts = visiblePts;
          const start = visiblePts[0];
          const last  = visiblePts[visiblePts.length - 1];
          const _dg   = toGrid({ x: last.x, y: last.y });
          isDestCollision = cellMap.get(`${_dg.x},${_dg.y}`)?.color === colorCollision;
          const penul = visiblePts[visiblePts.length - 2];
          const adx = last.x - penul.x, ady = last.y - penul.y;
          const alen = Math.hypot(adx, ady);
          if (alen > 0.01) {
            
            drawArrowShaft(visiblePts, isVertical ? 0 : reducedVert);

            
            const SO   = 3;
            const GLOW = [[GRID * 0.24, 0.07], [GRID * 0.15, 0.14], [GRID * 0.08, 0.30], [GRID * 0.03, 0.65]];

            
            if (_obstacleArrow) {
              const cg = chevronGraphics;
            let chevTotalLen = 0;
            for (let i = 1; i < visiblePts.length; i++) chevTotalLen += Math.hypot(visiblePts[i].x - visiblePts[i-1].x, visiblePts[i].y - visiblePts[i-1].y);
            if (chevTotalLen > 0.01) {
              const cThin    = GRID * 0.14;
              const cWide    = GRID * 0.46;
              const cSpacing = GRID / 3;

              const _chevCollision  = (wx, wy) => cellMap.get(`${Math.floor(wx / GRID)},${Math.floor(wy / GRID)}`)?.color === colorCollision;
              
              
              const _segBothColl = (si) => {
                const ga = toGrid({ x: visiblePts[si-1].x, y: visiblePts[si-1].y });
                const gb = toGrid({ x: visiblePts[si].x,   y: visiblePts[si].y   });
                return cellMap.get(`${ga.x},${ga.y}`)?.color === colorCollision &&
                       cellMap.get(`${gb.x},${gb.y}`)?.color === colorCollision;
              };

              chevrons = [];
              let segStart = 0, emitAt = cSpacing * 0.5;
              for (let i = 1; i < visiblePts.length; i++) {
                const A = visiblePts[i-1], B = visiblePts[i];
                const segLen = Math.hypot(B.x - A.x, B.y - A.y);
                while (emitAt <= segStart + segLen) {
                  const tSeg = (emitAt - segStart) / segLen;
                  const px = A.x + (B.x - A.x) * tSeg, py = A.y + (B.y - A.y) * tSeg;
                  if (segIsCollision[i - 1] && (_segBothColl(i) || _chevCollision(px, py))) {
                    const cux = (B.x - A.x) / segLen, cuy = (B.y - A.y) / segLen;
                    const cnx = -cuy, cny = cux;
                    const t   = Math.min(1, emitAt / chevTotalLen);
                    const w   = cThin + (cWide - cThin) * t;
                    chevrons.push({ px, py, cux, cuy, cnx, cny, w });
                  }
                  emitAt += cSpacing;
                }
                segStart += segLen;
              }

              const chevPoly = ({ px, py, cux, cuy, cnx, cny, w }, scale = 1) => {
                const sw = w * scale;
                const tipD  = sw * 0.65, backD = sw * 0.52, notchD = backD * 0.38;
                return [
                  px + cux*tipD,                py + cuy*tipD,
                  px + cnx*(sw*0.5),            py + cny*(sw*0.5),
                  px + cnx*(sw*0.5) - cux*backD, py + cny*(sw*0.5) - cuy*backD,
                  px - cux*notchD,              py - cuy*notchD,
                  px - cnx*(sw*0.5) - cux*backD, py - cny*(sw*0.5) - cuy*backD,
                  px - cnx*(sw*0.5),            py - cny*(sw*0.5),
                ];
              };

              if (chevrons.length > 0) {
                const lc = chevrons[chevrons.length - 1];
                lc.px += lc.cux * cSpacing * 0.3;
                lc.py += lc.cuy * cSpacing * 0.3;
              }
              if (_doLog) {
                console.group(`%c[DSCT FM] Chevrons: ${chevrons.length} built, isDestCollision=${isDestCollision}`, 'color:#aa44ff;font-weight:bold');
                chevrons.forEach((c, ci) => {
                  const gc = toGrid({ x: c.px, y: c.py });
                  const cc = cellMap.get(`${gc.x},${gc.y}`)?.color;
                  console.log(`  [${ci}] world(${c.px.toFixed(0)},${c.py.toFixed(0)}) grid(${gc.x},${gc.y}) cellColor=${cc !== undefined ? '#'+cc.toString(16) : 'none'}`);
                });
                console.groupEnd();
              }
              const lastIdx = chevrons.length - 1;
              
              const chevScale = (i) => i === lastIdx && isDestCollision ? 1.2 : 1;
              cg.beginFill(0x000000, 0.22);
              chevrons.forEach((c, i) => { const p = chevPoly(c, chevScale(i)); cg.drawPolygon(p.map(v => v + SO)); });
              cg.endFill();
              for (const [gw, ga] of GLOW) {
                cg.lineStyle(gw, 0xffffff, ga);
                chevrons.forEach((c, i) => cg.drawPolygon(chevPoly(c, chevScale(i))));
                cg.lineStyle(0);
              }
              cg.beginFill(0xdd1111, 1.0);
              chevrons.forEach((c, i) => cg.drawPolygon(chevPoly(c, chevScale(i))));
              cg.endFill();
            }
            }
          }
        }

        
        if (_obstacleArrow && arrowPts.length >= 2) {
          const _collisionKeys = new Set();
          for (const [k, { color }] of cellMap) {
            if (color === colorCollision) _collisionKeys.add(k);
          }
          
          if (chevrons.length > 0 && isDestCollision) {
            const _lp = arrowPts[arrowPts.length - 1];
            const _ldg = toGrid({ x: _lp.x, y: _lp.y });
            _collisionKeys.add(`${_ldg.x},${_ldg.y}`);
          }

          
          
          
          const _chevVertCells = new Set();
          if (chevrons.length > 0) {
            const _lp2    = arrowPts[arrowPts.length - 1];
            const _destKey = `${toGrid({ x: _lp2.x, y: _lp2.y }).x},${toGrid({ x: _lp2.x, y: _lp2.y }).y}`;
            const _lci    = chevrons.length - 1;
            for (let ci = 0; ci < chevrons.length; ci++) {
              const c  = chevrons[ci];
              const sc = ci === _lci && isDestCollision ? 1.2 : 1;
              const sw = c.w * sc;
              const tipD = sw * 0.65, backD = sw * 0.52, hw = sw * 0.5;
              for (const [vx, vy] of [
                [c.px + c.cux * tipD,  c.py + c.cuy * tipD ],
                [c.px + c.cnx * hw,    c.py + c.cny * hw   ],
                [c.px - c.cnx * hw,    c.py - c.cny * hw   ],
                [c.px - c.cux * backD, c.py - c.cuy * backD],
              ]) {
                const g  = toGrid({ x: vx, y: vy });
                const gk = `${g.x},${g.y}`;
                if (gk === _destKey && !isDestCollision) continue;
                _chevVertCells.add(gk);
              }
            }
          }

          
          
          const _LEEWAY = GRID * 0.15;
          const _DIRS   = [[-1,0],[1,0],[0,-1],[0,1]];
          maskGraphics.beginFill(0xffffff, 1);
          const _addedToNormal = new Set();
          const _addNormal = (gx, gy, primary) => {
            const k = `${gx},${gy}`;
            if (_collisionKeys.has(k) || _addedToNormal.has(k)) return;
            if (!primary && _chevVertCells.has(k)) return; 
            _addedToNormal.add(k);
            const pw = toWorld({ x: gx, y: gy });
            if (primary && _chevVertCells.has(k)) {
              
              
              let rx = pw.x, ry = pw.y, rw = GRID, rh = GRID;
              for (const [ddx, ddy] of _DIRS) {
                if (!_collisionKeys.has(`${gx+ddx},${gy+ddy}`)) continue;
                if (ddx ===  1) rw -= _LEEWAY;
                if (ddx === -1) { rx += _LEEWAY; rw -= _LEEWAY; }
                if (ddy ===  1) rh -= _LEEWAY;
                if (ddy === -1) { ry += _LEEWAY; rh -= _LEEWAY; }
              }
              if (rw > 0 && rh > 0) maskGraphics.drawRect(rx, ry, rw, rh);
            } else {
              maskGraphics.drawRect(pw.x, pw.y, GRID, GRID);
            }
          };
          for (const [k, { color }] of cellMap) {
            const [gx, gy] = k.split(',').map(Number);
            if (color !== colorCollision) {
              _addNormal(gx, gy, true);
              for (let dx = -1; dx <= 1; dx++)
                for (let dy = -1; dy <= 1; dy++)
                  if (dx !== 0 || dy !== 0) _addNormal(gx + dx, gy + dy, false);
            }
          }
          maskGraphics.endFill();
          if (_doLog) {
            console.group('%c[DSCT FM] Normal mask', 'color:#aa44ff;font-weight:bold');
            console.log('collisionKeys:', [..._collisionKeys], 'chevVertCells:', [..._chevVertCells]);
            console.log('normalCells count:', _addedToNormal.size, 'chevrons:', chevrons.length, 'isDestCollision:', isDestCollision);
            console.groupEnd();
          }
          arrowGraphics.mask   = maskGraphics;
          chevronGraphics.mask = null;
        } else if (arrowPts.length < 2 && isVertical) {
          
          
          arrowGraphics.mask   = null;
          chevronGraphics.mask = null;
          const src = arrowPts[0];
          const ag  = arrowGraphics;
          ag.clear();
          const r  = GRID * 0.095;
          const SO = 3;
          const GLOW = [[GRID * 0.24, 0.07], [GRID * 0.15, 0.14], [GRID * 0.08, 0.30], [GRID * 0.03, 0.65]];
          ag.beginFill(0x000000, 0.22);
          ag.drawCircle(src.x + SO, src.y + SO, r);
          ag.endFill();
          for (const [w, a] of GLOW) { ag.lineStyle(w, 0xffffff, a); ag.drawCircle(src.x, src.y, r); ag.lineStyle(0); }
          ag.beginFill(0xdd1111, 1.0);
          ag.drawCircle(src.x, src.y, r);
          ag.endFill();
        } else {
          arrowGraphics.mask   = null;
          chevronGraphics.mask = null;
        }

        
        if (getSetting('debugMode') && path.length > 0) {
          const labelStyle = new PIXI.TextStyle({ fontSize: GRID * 0.28, fill: 0xffffff, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 });
          for (let pi = 0; pi < path.length; pi++) {
            const p  = path[pi];
            const pw = toWorld(p);
            const lbl = new PIXI.Text(String(pi), labelStyle);
            lbl.anchor.set(0.5, 0.5);
            lbl.x = pw.x + GRID * 0.2;
            lbl.y = pw.y + GRID * 0.2;
            overlay.addChild(lbl);
            _debugLabels.push(lbl);
          }
        }
      };

      const onMove = (e) => {
        hoverGrid = toGrid(e.data.getLocalPosition(canvas.app.stage));
        redraw(hoverGrid);
      };

      const onClick = (e) => {
        if ((e.button ?? e.data?.button ?? 0) !== 0) return;
        const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
        const prev = path.length ? path[path.length - 1] : startGrid;
        const gk   = `${gpos.x},${gpos.y}`;
        const { activeRange, activeWall } = getLineFiltered();

        if (path.length > 0 && (gridEq(gpos, startGrid) || path.some(p => gridEq(p, gpos)))) {
          cleanup(isVertical); resolve(path); return;
        }
        
        if (isVertical && path.length === 0 && gridEq(gpos, startGrid)) {
          cleanup(isVertical); resolve(path); return;
        }

        if (isValidStep(prev, gpos)) {
          path.push(gpos);
          pathSegments.push(1);
          if (straightLineRequired && type === 'Push' && path.length === 1 && lockedDirX === null) {
            const dvx = (gpos.x + hs) - (startGrid.x + hs);
            const dvy = (gpos.y + hs) - (startGrid.y + hs);
            const len = Math.sqrt(dvx * dvx + dvy * dvy);
            if (len > 0) { lockedDirX = dvx / len; lockedDirY = dvy / len; }
          }
          if (path.length === reduced) { cleanup(isVertical); resolve(path); return; }
          recomputeRange(); redraw(hoverGrid, true);
        } else if (activeRange.has(gk) || activeWall.has(gk)) {
          const suggestion = getSuggestedPath(prev, gpos);
          if (!suggestion) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.noValidPath')); return; }
          const before = path.length;
          for (const s of suggestion) path.push(s);
          if (!gridEq(path[path.length - 1], gpos)) path.push(gpos);
          pathSegments.push(path.length - before);
          if (straightLineRequired && type === 'Push' && before === 0 && lockedDirX === null) {
            const dvx = (gpos.x + hs) - (startGrid.x + hs);
            const dvy = (gpos.y + hs) - (startGrid.y + hs);
            const len = Math.sqrt(dvx * dvx + dvy * dvy);
            if (len > 0) { lockedDirX = dvx / len; lockedDirY = dvy / len; }
          }
          if (path.length >= reduced) { cleanup(isVertical); resolve(path); return; }
          recomputeRange(); redraw(hoverGrid, true);
        } else {
          ui.notifications.warn(game.i18n.format('DSCT.notice.fm.invalidStepForType', { type }));
        }
      };

      const onRightClick = () => {
        if (path.length > 0) {
          const count = pathSegments.pop() ?? 1;
          for (let i = 0; i < count; i++) path.pop();
          if (straightLineRequired && type === 'Push' && path.length === 0) { lockedDirX = null; lockedDirY = null; }
          recomputeRange(); redraw(hoverGrid, true);
        } else if (getSetting('cancelOnRightClick')) {
          cleanup(); resolve(null);
        }
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') { cleanup();              resolve(null); }
        if (e.key === 'Enter')  { cleanup(isVertical);   resolve(path); }
      };

      let fmPathNotif = null;
      const cleanup = (deferArrow = false) => {
        overlay.off('pointermove', onMove);
        overlay.off('pointerdown', onClick);
        overlay.off('rightdown',   onRightClick);
        document.removeEventListener('keydown', onKeyDown);
        canvas.app.stage.removeChild(overlay);
        canvas.app.stage.removeChild(graphics);
        graphics.destroy();
        maskGraphics.destroy();
        chevronMaskGraphics.destroy();
        overlay.destroy();
        if (fmPathNotif) { ui.notifications.remove(fmPathNotif); fmPathNotif = null; }
        if (deferArrow) {
          
          arrowGraphics.mask   = null;
          chevronGraphics.mask = null;

          const popupGraphics = new PIXI.Graphics();
          const elevLabels    = new PIXI.Container();
          canvas.app.stage.addChild(popupGraphics);
          canvas.app.stage.addChild(elevLabels);

          const drawPopupCells = (vertVal) => {
            popupGraphics.clear();
            elevLabels.removeChildren().forEach(c => c.destroy());
            popupGraphics.beginFill(colorStart, 0.35);
            for (let ix = 0; ix < tokenSize; ix++)
              for (let iy = 0; iy < tokenSize; iy++) {
                const rw = toWorld({ x: startGrid.x + ix, y: startGrid.y + iy });
                popupGraphics.drawRect(rw.x, rw.y, GRID, GRID);
              }
            popupGraphics.endFill();
            const labelStyle = getSetting('debugMode')
              ? new PIXI.TextStyle({ fontSize: GRID * 0.28, fill: 0xffffff, fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3 })
              : null;
            for (let pi = 0; pi < path.length; pi++) {
              const p        = path[pi];
              const prev     = pi > 0 ? path[pi - 1] : startGrid;
              const stepElev = startElev + roundHalfFloor(vertVal * (pi + 1) / path.length);
              const cells    = isLargeToken ? footprintCells(p.x, p.y, tokenSize) : [p];
              popupGraphics.beginFill(checkStepCollisionAtElev(prev, p, stepElev) ? colorCollision : colorPath, 0.45);
              for (const { x, y } of cells) {
                const rw = toWorld({ x, y });
                popupGraphics.drawRect(rw.x, rw.y, GRID, GRID);
              }
              popupGraphics.endFill();
              if (labelStyle) {
                const pw  = toWorld(p);
                const lbl = new PIXI.Text(`${pi} [${stepElev}]`, labelStyle);
                lbl.anchor.set(0.5, 0.5);
                lbl.x = pw.x + GRID * 0.5;
                lbl.y = pw.y + GRID * 0.5;
                elevLabels.addChild(lbl);
              }
            }
          };

          drawPopupCells(0);

          destroyArrow = () => {
            canvas.app.stage.removeChild(arrowGraphics);
            canvas.app.stage.removeChild(chevronGraphics);
            canvas.app.stage.removeChild(popupGraphics);
            canvas.app.stage.removeChild(elevLabels);
            arrowGraphics.destroy();
            chevronGraphics.destroy();
            popupGraphics.destroy();
            elevLabels.destroy({ children: true });
          };
          
          
          
          
          const getElevClippedPts = (vertVal) => {
            const tc = g => { const w = toWorld(g); return { x: w.x + GRID * tokenSize / 2, y: w.y + GRID * tokenSize / 2 }; };
            for (let pi = 0; pi < path.length; pi++) {
              const prev     = pi > 0 ? path[pi - 1] : startGrid;
              const stepElev = startElev + roundHalfFloor(vertVal * (pi + 1) / path.length);
              if (!checkStepCollisionAtElev(prev, path[pi], stepElev)) continue;
              const collPt = tc(path[pi]);
              if (pi === 0) {
                const src = tc(startGrid);
                const dx = collPt.x - src.x, dy = collPt.y - src.y;
                const len = Math.hypot(dx, dy);
                return len > 0.01 ? [src, { x: src.x + dx / len * GRID * 0.5, y: src.y + dy / len * GRID * 0.5 }] : null;
              }
              const stopPt = tc(path[pi - 1]);
              const dx = collPt.x - stopPt.x, dy = collPt.y - stopPt.y;
              const dlen = Math.hypot(dx, dy);
              const ext = dlen > 0.01 ? { x: stopPt.x + dx / dlen * GRID * 0.5, y: stopPt.y + dy / dlen * GRID * 0.5 } : stopPt;
              if (straightLineRequired) {
                
                const a = tc(startGrid), b = tc(path[path.length - 1]);
                const abx = b.x - a.x, aby = b.y - a.y;
                const abLen = Math.hypot(abx, aby);
                if (abLen < 0.01) return null;
                const t = Math.max(0, Math.min(abLen, ((ext.x - a.x) * abx + (ext.y - a.y) * aby) / abLen));
                return [a, { x: a.x + abx / abLen * t, y: a.y + aby / abLen * t }];
              }
              const allPts = [tc(startGrid), ...path.slice(0, pi).map(tc)];
              const result = [...allPts.slice(0, -1), ext];
              return result.length >= 2 ? result : null;
            }
            return straightLineRequired
              ? [tc(startGrid), tc(path[path.length - 1])]
              : [tc(startGrid), ...path.map(tc)];
          };

          previewArrow = (vertVal) => {
            if (path.length === 0) {
              
              const sw = toWorld(startGrid);
              const src = { x: sw.x + (GRID * tokenSize) / 2, y: sw.y + (GRID * tokenSize) / 2 };
              const dy = vertVal > 0 ? -GRID * 0.45 : vertVal < 0 ? GRID * 0.45 : 0;
              if (dy !== 0) {
                drawArrowShaft([src, { x: src.x, y: src.y + dy }], Math.abs(vertVal));
              } else {
                const ag = arrowGraphics;
                ag.clear();
                const r  = GRID * 0.095;
                const SO = 3;
                const GLOW = [[GRID * 0.24, 0.07], [GRID * 0.15, 0.14], [GRID * 0.08, 0.30], [GRID * 0.03, 0.65]];
                ag.beginFill(0x000000, 0.22);
                ag.drawCircle(src.x + SO, src.y + SO, r);
                ag.endFill();
                for (const [w, a] of GLOW) { ag.lineStyle(w, 0xffffff, a); ag.drawCircle(src.x, src.y, r); ag.lineStyle(0); }
                ag.beginFill(0xdd1111, 1.0);
                ag.drawCircle(src.x, src.y, r);
                ag.endFill();
              }
            } else {
              const pts = getElevClippedPts(vertVal);
              if (pts) drawArrowShaft(pts, vertVal);
              else arrowGraphics.clear();
            }
          };
          previewCollision = (vertVal) => drawPopupCells(vertVal);
        } else {
          canvas.app.stage.removeChild(arrowGraphics);
          canvas.app.stage.removeChild(chevronGraphics);
          arrowGraphics.destroy();
          chevronGraphics.destroy();
        }
      };

      overlay.on('pointermove', onMove);
      overlay.on('pointerdown', onClick);
      overlay.on('rightdown',   onRightClick);
      document.addEventListener('keydown', onKeyDown);
      redraw(null);
      const vertNote = isVertical ? ` vertical ${reducedVert}` : '';
      fmPathNotif = ui.notifications.info(game.i18n.format('DSCT.notice.fm.pathInstruction', { type, distance: reduced, vert: vertNote }), { permanent: true });
    });
  }

  const path = finalPath;
  if (!path || (path.length === 0 && !isVertical)) {
    ui.notifications.info(game.i18n.localize('DSCT.notice.fm.cancelled'));
    return;
  }

  if (isVertical) {
    const combinedPreview = (previewArrow || previewCollision)
      ? (v) => { previewArrow?.(v); previewCollision?.(v); }
      : null;

    let popupMax = Math.abs(reducedVert);
    let popupMin = null;

    if (type === 'Pull' && sourceToken) {
      const elevDiffSquares = ((sourceToken.document.elevation ?? 0) - startElev) / canvas.grid.distance;
      if (elevDiffSquares > 0) {
        popupMin = 0;
        popupMax = Math.min(popupMax, Math.round(elevDiffSquares));
      } else if (elevDiffSquares < 0) {
        popupMin = -Math.min(popupMax, Math.round(-elevDiffSquares));
        popupMax = 0;
      } else {
        popupMin = 0;
        popupMax = 0;
      }
      if (popupMin === 0 && popupMax === 0) {
        reducedVert = 0;
        isVertical  = false;
      }
    }

    const chosen = !isVertical ? 0 : await VerticalDistancePopup.open(0, popupMax, combinedPreview, popupMin);
    destroyArrow();
    if (chosen === null) {
      ui.notifications.info(game.i18n.localize('DSCT.notice.fm.cancelled'));
      return;
    }
    reducedVert = chosen;
    isVertical  = reducedVert !== 0;
    
    if (!isVertical && path.length === 0) {
      ui.notifications.info(game.i18n.localize('DSCT.notice.fm.cancelled'));
      return;
    }
  }

    if (path.length === 0 && isVertical) {
      const startPos      = { x: targetToken.document.x, y: targetToken.document.y };
      const undoOps       = [];
      const collisionMsgs = [];
      const movedSnap     = snapStamina(targetToken.actor);
      let finalElev       = startElev;
      let blocked         = false;

      const steps = Math.abs(reducedVert);
      const dir   = reducedVert >= 0 ? 1 : -1;

      for (let i = 0; i < steps; i++) {
        const stepElev  = startElev + dir * (i + 1);
        const remaining = steps - i;
        const vTile     = getWallBlockTileAt(startGrid.x, startGrid.y);

        if (vTile && !hasTags(vTile, 'broken')) {
          const blockTag   = getTags(vTile).find(t => t.startsWith('wall-block-'));
          const walls      = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
          const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
          const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? Infinity;
          if (stepElev >= tileBottom && stepElev < tileTop) {
            const dmg = 2 + remaining + bonusObjectDmg;
            if (!noMoverDmg && !targetIsDead) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is blocked by a wall and ${dmgStr(dmg)}.`);
            if (dir === -1) {
              const ffd = Math.abs(reducedVert);
              if (!noFallDamage && !targetIsDead && ffd >= 2) {
                const fallDmg = Math.min(ffd * 2, getSetting('fallDamageCap'));
                await applyDamage(targetToken.actor, fallDmg);
                collisionMsgs.push(`${targetToken.name} also takes <strong>${fallDmg} damage</strong> from being slammed into the surface (Agility treated as 0), landing prone.`);
                await safeToggleStatusEffect(targetToken.actor, 'prone', { active: true });
                undoOps.push({ op: 'status', uuid: targetToken.actor.uuid, effectId: 'prone', active: false });
              } else if (!noFallDamage && !targetIsDead && ffd === 1) {
                collisionMsgs.push(`${targetToken.name} is slammed 1 square downward into the surface. Less than 2 squares, no fall damage.`);
              }
            }
            blocked = true;
            break;
          }
        }

        const blocker = tokenAt(startGrid.x, startGrid.y, targetToken.id);
        const blockerIsDead = isTokenDead(blocker);
        if (blocker && (!blockerIsDead || getSetting('corpsesBlock')) && (blocker.document.elevation ?? 0) === stepElev) {
          if (blockerIsDead) {
            if (!noMoverDmg && !targetIsDead) await applyDamage(targetToken.actor, remaining + bonusCreatureDmg);
            collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} crashes into the corpse of ${blocker.name}${noMoverDmg || targetIsDead ? '.' : `. ${TakesStr(remaining + bonusCreatureDmg)}.`}`);
          } else {
            undoOps.push({ op: 'update', uuid: blocker.document.uuid, data: { x: blocker.document.x, y: blocker.document.y, elevation: blocker.document.elevation ?? 0 }, options: { isUndo: true } });
            if (!noMoverDmg && !targetIsDead) await applyDamage(targetToken.actor, remaining + bonusCreatureDmg);
            if (!noObstacleDmg) await applyDamage(blocker.actor, remaining + bonusCreatureDmg);
            const _vDmg  = remaining + bonusCreatureDmg;
            const _vSame = noMoverDmg === noObstacleDmg;
            const _vMsg  = _vSame ? `${noMoverDmg ? 'Would both take' : 'Both take'} <strong>${_vDmg} damage</strong>${ncdNote}` : `${targetToken.name} ${dmgStr(_vDmg)}; ${blocker.name} ${blockerDmgStr(_vDmg)}`;
            collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} hits ${blocker.name}. ${_vMsg}.`);
          }
          blocked = true;
          break;
        }

        finalElev = stepElev;
      }

      await safeUpdate(targetToken.document, { elevation: finalElev });
      const vertEffectiveNoFallDmg = noFallDamage || targetIsDead;
      const vertTargetElev = !blocked
        ? (dir === -1
          ? await applyForcedFallDamage(targetToken, Math.abs(reducedVert), finalElev, startGrid, undoOps, collisionMsgs, vertEffectiveNoFallDmg)
          : await applyFallDamage(targetToken, finalElev, startGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, vertEffectiveNoFallDmg))
        : finalElev;

      
      {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const live = canvas.scene.tokens.get(targetToken.id);
          if (!live || Math.abs((live.elevation ?? 0) - vertTargetElev) < 0.1) break;
          await new Promise(r => setTimeout(r, 50));
        }
      }
      if (getSetting('debugMode')) {
        const live = canvas.scene.tokens.get(targetToken.id);
        console.log(`DSCT | FM | Vert post-poll: live elev=${live?.elevation} | targetElev=${vertTargetElev}`);
      }

      
      
      const oldMoveId = targetToken.document.getFlag('draw-steel-combat-tools', 'lastFmMoveId');
      if (oldMoveId) {
        const oldMsg = game.messages.contents.find(m => m.getFlag('draw-steel-combat-tools', 'moveId') === oldMoveId);
        if (oldMsg) await safeUpdate(oldMsg, { 'flags.draw-steel-combat-tools.isExpired': true });
      }

      const moveId = foundry.utils.randomID();
      const fullUndoLog = buildUndoLog(targetToken, startPos, startElev, movedSnap, undoOps, targetIsDead);

      if (getSetting('debugMode')) {
        const liveSnapV = canvas.scene.tokens.get(targetToken.id);
        console.log(`DSCT | FM | Pre-message snapshot (vert) for ${targetToken.name}: doc.x=${targetToken.document.x}, doc.y=${targetToken.document.y}, doc.elev=${targetToken.document.elevation??0} | live.x=${liveSnapV?.x}, live.y=${liveSnapV?.y}, live.elev=${liveSnapV?.elevation??0} | finalPos will be (${startPos.x},${startPos.y},${vertTargetElev}) | doc===live: ${targetToken.document === liveSnapV}`);
      }

      await safeUpdate(targetToken.document, { 'flags.draw-steel-combat-tools.lastFmMoveId': moveId });

      if (getSetting('debugMode')) {
        console.log(`DSCT | FM | Assigned moveId=${moveId} to ${targetToken.name} (vert). Confirmed lastFmMoveId=${targetToken.document.getFlag('draw-steel-combat-tools','lastFmMoveId')}`);
      }

      const vertResultData = {
        content:       buildSummary() + (collisionMsgs.length ? '<br>' + collisionMsgs.join('<br>') : ''),
        undoLog:       fullUndoLog,
        moveId,
        targetTokenId: targetToken.id,
        targetSceneId: canvas.scene.id,
        finalPos:      { x: targetToken.document.x, y: targetToken.document.y, elevation: vertTargetElev },
        hadDamage:     collisionMsgs.length > 0,
      };
      if (suppressMessage) return vertResultData;
      await ChatMessage.create({
        content: vertResultData.content,
        flags: { 'draw-steel-combat-tools': { isFmUndo: true, isUndone: false, ...vertResultData } }
      });
      return;
    }

    const startPos      = { x: targetToken.document.x, y: targetToken.document.y };
    const startElevSnap = startElev;
    const undoOps       = [];
    const collisionMsgs = [];
    let landingIndex    = path.length - 1;
    let costConsumed    = 0;
    const movedSnap     = snapStamina(targetToken.actor);
    moverIsDefeated = false;

    let totalTargetDmg = 0;
    let case1Fired = false;
    const sameDisp = (a, b) => { const da = a?.document?.disposition; const db = b?.document?.disposition; return da != null && da === db; };
    const dmgTarget = async (dmg) => {
      if (!noMoverDmg && !targetIsDead && !moverIsDefeated && dmg > 0) { await applyDamage(targetToken.actor, dmg); totalTargetDmg += dmg; }
    };

    const moverWouldStop = (dmg) => {
      if (noMoverDmg || targetIsDead || moverIsDefeated) return false;
      const indivMax = targetToken.actor.system.stamina.max ?? Infinity;
      if (dmg >= indivMax) return true;
      return targetToken.actor.system.stamina.value <= 0;
    };

    const killMover = async (msg) => {
      moverIsDefeated = true;
      landingIndex = path.length - 1;
      collisionMsgs.push(msg);
      await safeToggleStatusEffect(targetToken.actor, 'dead', { active: true });
    };

    window._dsctFMActive = true;

    
    const terrainMap = (!isVertical && game.modules.get('ds-terrain-designer')?.active)
      ? (canvas.scene.getFlag('ds-terrain-designer', 'elevation-levels') ?? {})
      : null;
    let terrainRunningElev = startElev;

    for (let i = 0; i < path.length; i++) {
      const step      = path[i];
      const prev      = i > 0 ? path[i - 1] : startGrid;
      const remaining = reduced - i - costConsumed;

      
      if (remaining <= 0) {
        if (getSetting('debugMode')) console.log(`DSCT | FM | Step ${i}: movement exhausted (reduced=${reduced}, i=${i}, costConsumed=${costConsumed}). Stopping at step ${i - 1}.`);
        landingIndex = i - 1;
        break;
      }
      if (getSetting('debugMode')) console.log(`DSCT | FM | Step ${i}: remaining=${remaining}, costConsumed=${costConsumed}, pos=(${step.x},${step.y})`);

      const stepElev  = isVertical && path.length > 0
        ? startElev + roundHalfFloor(reducedVert * (i + 1) / path.length)
        : startElev;


      const burrowBlock = isBurrowing && statusMode;
      if (stepElev < 0 || (i === 0 && (startElev < 0 || burrowBlock))) {
        landingIndex = i - 1;
        if (startElev < 0) {

          const dmg = 2 + remaining + bonusObjectDmg;
          await dmgTarget(dmg);
          collisionMsgs.push(`${targetToken.name} cannot be force-moved while underground${moverAndTakes(dmg)}.`);
        } else if (burrowBlock) {
          const dmg = 2 + remaining + bonusObjectDmg;
          await dmgTarget(dmg);
          collisionMsgs.push(`${targetToken.name} cannot be force-moved while burrowing${moverAndTakes(dmg)}.`);
        }


        break;
      }

      
      
      
      
      if (terrainMap) {
        const toTE = terrainMap[`${step.x},${step.y}`] ?? 0;
        if (toTE > terrainRunningElev + 1) {
          landingIndex = i - 1;
          const dmg = 2 + remaining + bonusObjectDmg;
          await dmgTarget(dmg);
          collisionMsgs.push(`${targetToken.name} is blocked by a steep elevation change${moverAndTakes(dmg)}.`);
          break;
        }
        if (Math.abs(toTE - terrainRunningElev) === 1) terrainRunningElev = toTE;
      }

      if (isVertical) {
        const vTile = getWallBlockTileAt(step.x, step.y);
        if (vTile && !hasTags(vTile, 'broken')) {
          const blockTag   = getTags(vTile).find(t => t.startsWith('wall-block-'));
          const walls      = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
          const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
          const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? Infinity;
          if (stepElev >= tileBottom && stepElev < tileTop) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            collisionMsgs.push(`${targetToken.name} is blocked by a wall at elevation ${stepElev}${moverAndTakes(dmg)}.`);
            break;
          }
        }
      }

      const tileDesc = (tiles) => {
        const counts = {};
        for (const t of tiles) { const m = getMaterial(t); counts[m] = (counts[m] ?? 0) + 1; }
        return Object.entries(counts).map(([m, n]) => n > 1 ? `${n} ${m} objects` : `a ${m} object`).join(' and ');
      };

      const breakTile = async (tile) => {
        const origMat   = getMaterial(tile);
        const prevAlpha = tile.document.alpha ?? getMaterialAlpha(origMat);
        const blockTag  = getTags(tile).find(t => t.startsWith('wall-block-'));
        if (blockTag) {
          const tg = toGrid(tile.document);
          let walls = getByTag(blockTag).filter(o => Array.isArray(o.c));
          const splitWalls = [];
          for (const w of walls) {
            if (hasTags(w, 'wall-converted')) {
              splitWalls.push(await splitConvertedWall(w, tg.x, tg.y, undoOps));
            } else {
              splitWalls.push(w);
            }
          }
          walls = splitWalls;
          const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
          for (const wall of walls) {
            await safeUpdate(wall, { move: 0, sight: 0, light: 0, sound: 0 });
            if (game.user.isGM) await addTags(wall, ['broken']);
          }
          const ltBrokenAlpha = hasTags(tile, 'invisible') ? 0 : 0.8;
          await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: ltBrokenAlpha });
          if (game.user.isGM) await addTags(tile, ['broken']);
          undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: prevAlpha } });
          undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['broken'] });
          for (const { wall, restrict } of prevWallData) {
            undoOps.push({ op: 'update',     uuid: wall.uuid, data: restrict });
            undoOps.push({ op: 'removeTags', uuid: wall.uuid, tags: ['broken'] });
          }
        } else {
          await safeDelete(tile.document);
        }
      };

      const checkTileCollision = async (cells) => {
        const hitTiles = tilesAtCells(cells).filter(tile => {
          if (!hasTags(tile, 'obstacle') || hasTags(tile, 'broken')) return false;
          if (isVertical) {
            const bt     = getTags(tile).find(t => t.startsWith('wall-block-'));
            const tws    = bt ? getByTag(bt).filter(o => Array.isArray(o.c)) : [];
            const tBottom = tws[0]?.flags?.['wall-height']?.bottom ?? 0;
            const tTop    = tws[0]?.flags?.['wall-height']?.top    ?? Infinity;
            if (stepElev >= tTop || stepElev < tBottom) return false;
          }
          return true;
        });
        if (!hitTiles.length) return null;

        const hardTiles = hitTiles.filter(t => !hasTags(t, 'breakable'));
        if (hardTiles.length > 0 && !juggernaut) {
          landingIndex = i - 1;
          const dmg = 2 + remaining + bonusObjectDmg;
          await dmgTarget(dmg);
          collisionMsgs.push(`${targetToken.name} is stopped by an obstacle${moverAndTakes(dmg)}.`);
          return 'break';
        }

        const softTiles   = juggernaut ? hitTiles.filter(t => hasTags(t, 'breakable')) : hitTiles;
        const maxTileCost = juggernaut ? 0 : softTiles.reduce((m, t) => Math.max(m, MATERIAL_RULES()[getMaterial(t)]?.cost ?? 99), 0);
        const maxTileDmg  = juggernaut ? 0 : softTiles.reduce((m, t) => Math.max(m, MATERIAL_RULES()[getMaterial(t)]?.damage ?? 0), 0);
        if (juggernaut || remaining >= maxTileCost) {
          for (const tile of softTiles) await breakTile(tile);
          const tileDmg = maxTileDmg + bonusObjectDmg;
          if (softTiles.length > 0) collisionMsgs.push(`${targetToken.name} smashes through ${tileDesc(softTiles)} (costs ${maxTileCost}${moverDealsNote(tileDmg)}).`);
          await dmgTarget(tileDmg);
          if (juggernaut && softTiles.length > 0) costConsumed -= 1; else costConsumed += maxTileCost - 1;
          if (moverWouldStop(tileDmg)) { await killMover(`${targetToken.name} is killed by the impact; continuing as a corpse.`); return 'continue'; }
          return softTiles.length > 0 ? 'continue' : null;
        } else {
          const brokenTiles = softTiles.filter(t => remaining >= (MATERIAL_RULES()[getMaterial(t)]?.cost ?? 99));
          for (const tile of brokenTiles) await breakTile(tile);
          if (brokenTiles.length > 0) collisionMsgs.push(`${targetToken.name} smashes through ${tileDesc(brokenTiles)}.`);
          landingIndex = i - 1;
          const dmg = 2 + remaining + bonusObjectDmg;
          await dmgTarget(dmg);
          collisionMsgs.push(`${targetToken.name} is stopped by an obstacle (needs ${maxTileCost}, has ${remaining})${moverIsDefeated ? '.' : `. ${TakesStr(dmg)}.`}`);
          return 'break';
        }
      };

      if (isLargeToken) {
        const dx        = step.x - prev.x;
        const dy        = step.y - prev.y;
        const prevCells = footprintCells(prev.x, prev.y, tokenSize);
        const stepCells = footprintCells(step.x, step.y, tokenSize);
        const newCells  = newlyEnteredCells(prevCells, stepCells);

        const hitEntries = wallsAtStep(newCells, dx, dy, stepElev);
        if (hitEntries.length > 0) {
          const hardWalls = hitEntries.filter(({ wall: w }) => !hasTags(w, 'obstacle') || !hasTags(w, 'breakable'));
          if (hardWalls.length > 0 && !juggernaut) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token hit indestructible wall at step ${i}. dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} hits a wall${moverAndTakes(dmg)}.`);
            break;
          }
          
          const softEntries = juggernaut ? hitEntries.filter(({ wall: w }) => hasTags(w, 'obstacle') && hasTags(w, 'breakable')) : hitEntries;
          const maxCost    = juggernaut ? Math.min(1, softEntries.length) : softEntries.reduce((m, { wall: w }) => Math.max(m, MATERIAL_RULES()[getMaterial(w)]?.cost ?? 99), 0);
          const maxWallDmg = juggernaut ? 0 : softEntries.reduce((m, { wall: w }) => Math.max(m, MATERIAL_RULES()[getMaterial(w)]?.damage ?? 0), 0);
          const wallDesc = (walls) => {
            const counts = {};
            for (const w of walls) { const m = getMaterial(w); counts[m] = (counts[m] ?? 0) + 1; }
            return Object.entries(counts).map(([m, n]) => n > 1 ? `${n} ${m} walls` : `a ${m} wall`).join(' and ');
          };
          if (remaining >= maxCost) {
            for (const { wall, cell } of softEntries) await doBreakObstacleWall(wall, stepElev, undoOps, collisionMsgs, cell);
            const wallDmg = maxWallDmg + bonusObjectDmg;
            collisionMsgs.push(`${targetToken.name} smashes through ${wallDesc(softEntries.map(e => e.wall))} (costs ${maxCost}${moverDealsNote(wallDmg)}).`);
            await dmgTarget(wallDmg);
            if (juggernaut && softEntries.length > 0) costConsumed -= 1; else costConsumed += maxCost - 1;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token broke ${softEntries.length} wall(s). maxCost=${maxCost}, maxDmg=${maxWallDmg}`);
            if (moverWouldStop(wallDmg)) { await killMover(`${targetToken.name} is killed by the impact; continuing as a corpse.`); continue; }
            continue;
          } else {
            const brokenEntries = softEntries.filter(({ wall: w }) => remaining >= (MATERIAL_RULES()[getMaterial(w)]?.cost ?? 99));
            for (const { wall, cell } of brokenEntries) await doBreakObstacleWall(wall, stepElev, undoOps, collisionMsgs, cell);
            if (brokenEntries.length > 0) collisionMsgs.push(`${targetToken.name} smashes through ${wallDesc(brokenEntries.map(e => e.wall))}.`);
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token stopped (maxCost=${maxCost} > remaining=${remaining}). dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} is stopped by a wall it cannot break through (needs ${maxCost}, has ${remaining})${moverIsDefeated ? '.' : `. ${TakesStr(dmg)}.`}`);
            break;
          }
        }

        
        
        const detectCells      = juggernaut ? newCells : stepCells;
        const blockers         = tokensAtCells(detectCells, targetToken.id, stepElev, tokenSize);
        const corpseBlockers   = blockers.filter(b => isTokenDead(b));
        const objectBlockers   = blockers.filter(b => !isTokenDead(b) && b.actor?.type === 'object');
        let creatureBlockers = blockers.filter(b => !isTokenDead(b) && b.actor?.type !== 'object');

        if (objectBlockers.length > 0) {
          const maxObjCost = objectBlockers.reduce((m, b) => Math.max(m, b.actor?.system?.stamina?.value ?? 0), 0);
          const dealDmg    = remaining + bonusObjectDmg;
          if (dealDmg >= maxObjCost) {
            if (!window._dsctRubblePlaced) window._dsctRubblePlaced = new Set();
            for (const obj of objectBlockers) {
              window._dsctRubblePlaced.add(obj.id);
              setTimeout(() => window._dsctRubblePlaced?.delete(obj.id), 5000);
              const objPrev = noObstacleDmg ? null : await applyDamage(obj.actor, dealDmg);
              if (objPrev) undoOps.push({ op: 'stamina', uuid: obj.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
            }
            const moverDmg = maxObjCost + 2;
            const objNames = objectBlockers.map(o => o.name).join(', ');
            collisionMsgs.push(`${targetToken.name} smashes through ${objNames} (max ${maxObjCost} stamina)${moverIsDefeated ? '.' : `. ${TakesStr(moverDmg)}.`}`);
            await dmgTarget(moverDmg);
            for (const obj of objectBlockers) await destroyObjectToken(obj, undoOps);
            costConsumed += Math.max(0, maxObjCost - 1);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token smashed through ${objectBlockers.length} object(s). maxObjCost=${maxObjCost}`);
            if (moverWouldStop(moverDmg)) { await killMover(`${targetToken.name} is killed by the impact; continuing as a corpse.`); continue; }
          } else {
            const brokenObjects = objectBlockers.filter(o => dealDmg >= (o.actor?.system?.stamina?.value ?? 0));
            const survivingObjects = objectBlockers.filter(o => !brokenObjects.includes(o));
            for (const obj of brokenObjects) {
              const objPrev = noObstacleDmg ? null : await applyDamage(obj.actor, dealDmg);
              if (objPrev) undoOps.push({ op: 'stamina', uuid: obj.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
              await destroyObjectToken(obj, undoOps);
            }
            for (const obj of survivingObjects) {
              const objPrev = noObstacleDmg ? null : await applyDamage(obj.actor, dealDmg);
              if (objPrev) undoOps.push({ op: 'stamina', uuid: obj.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
            }
            landingIndex = i - 1;
            const stopDmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(stopDmg);
            collisionMsgs.push(`${targetToken.name} is stopped by ${survivingObjects.map(o => o.name).join(', ')} (needs ${maxObjCost} stamina, has ${remaining})${moverIsDefeated ? '.' : `. ${TakesStr(stopDmg)}.`}`);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token stopped by object(s) (maxObjCost=${maxObjCost} > remaining=${remaining}).`);
            break;
          }
        }

        if (corpseBlockers.length > 0) {
          const names    = corpseBlockers.map(b => b.name).join(', ');
          const plural   = corpseBlockers.length > 1;
          const stopDmg  = 2 + remaining;
          landingIndex   = i - 1;
          if (!moverIsDefeated) await dmgTarget(stopDmg);
          collisionMsgs.push(`${targetToken.name} is stopped by the corpse${plural ? 's' : ''} of ${names}${moverIsDefeated ? '.' : `. ${TakesStr(stopDmg)}.`}`);
          if (getSetting('debugMode')) console.log(`DSCT | FM | Large token stopped by corpse(s): ${names}`);
          break;
        }

        if (creatureBlockers.length > 0) {
          if (!juggernaut && sourceToken && getSetting('friendlyFireConfirmation')) {
            if (!case1Fired && sameDisp(sourceToken, targetToken)) {
              case1Fired = true;
              if (!noMoverDmg) {
                const stop = await confirmFriendlyFireCase1(sourceToken, targetToken);
                if (stop) { landingIndex = i - 1; friendlyFireNote = `Friendly fire reduced ${type} ${reduced} to ${i}.`; break; }
              }
            } else if (!noObstacleDmg) {
              const allyBlockers = creatureBlockers.filter(b => sameDisp(sourceToken, b));
              if (allyBlockers.length > 0) {
                const action = await confirmFriendlyFireCase2(sourceToken, targetToken, allyBlockers, remaining + bonusCreatureDmg);
                if (action === 'cancel') { landingIndex = i - 1; friendlyFireNote = `Friendly fire reduced ${type} ${reduced} to ${i}.`; break; }
                if (action === 'ignore') {
                  const targetRank = sizeRank(targetToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
                  creatureBlockers = creatureBlockers.filter(b =>
                    !sameDisp(sourceToken, b) || Math.abs(targetRank - sizeRank(b.actor?.system?.combat?.size ?? { value: 1, letter: 'M' })) < 2
                  );
                  if (creatureBlockers.length === 0) continue;
                }
              }
            }
          }
          if (!juggernaut) landingIndex = i - 1;
          const dmg             = juggernaut ? 99999 : remaining + bonusCreatureDmg;
          const movedSquadGroup = getSquadGroup(targetToken.actor);
          await dmgTarget(dmg);
          const squadGroupsSnapshotted = new Set();
          for (const blocker of creatureBlockers) {
            undoOps.push({ op: 'update', uuid: blocker.document.uuid, data: { x: blocker.document.x, y: blocker.document.y, elevation: blocker.document.elevation ?? 0 }, options: { isUndo: true } });
            const blockerSquadGroup = getSquadGroup(blocker.actor);
            const sharedGroup = movedSquadGroup && blockerSquadGroup && movedSquadGroup.id === blockerSquadGroup.id ? movedSquadGroup : null;
            const prevSharedHP = sharedGroup?.system?.staminaValue ?? null;
            const blockerDmg  = (juggernaut && blocker.actor.system.isMinion) ? (blocker.actor.system.stamina.max ?? 99999) : dmg;
            
            if (sharedGroup && !(noObstacleDmg && !juggernaut)) {
              if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
              window._lastSquadDamagedTokenIds.add(blocker.id);
              clearTimeout(window._lastSquadDamagedTokenIdsTimer);
              window._lastSquadDamagedTokenIdsTimer = setTimeout(() => { window._lastSquadDamagedTokenIds = null; }, 10000);
            }
            const blockerPrev = (noObstacleDmg && !juggernaut) ? null : await applyDamage(blocker.actor, blockerDmg, sharedGroup ? null : blockerSquadGroup);
            if (blockerPrev && sharedGroup && prevSharedHP !== null) {
              const sharedMembers = Array.from(sharedGroup.members || []).filter(m => m);
              blockerPrev.squadGroup        = sharedGroup;
              blockerPrev.squadCombatantIds = sharedMembers.map(m => m.id);
              blockerPrev.squadTokenIds     = sharedMembers.map(m => m.tokenId).filter(Boolean);
              if (!squadGroupsSnapshotted.has(sharedGroup.id)) {
                squadGroupsSnapshotted.add(sharedGroup.id);
                blockerPrev.prevSquadHP = prevSharedHP;
              } else {
                blockerPrev.prevSquadHP = null;
              }
            } else if (blockerPrev && blockerPrev.squadGroup) {
              const sgId = blockerPrev.squadGroup.id;
              if (squadGroupsSnapshotted.has(sgId)) {
                blockerPrev.prevSquadHP = null;
              } else {
                squadGroupsSnapshotted.add(sgId);
              }
            }
            if (blockerPrev) undoOps.push({ op: 'stamina', uuid: blocker.actor.uuid, prevValue: blockerPrev.prevValue, prevTemp: blockerPrev.prevTemp, squadGroupUuid: blockerPrev.squadGroup?.uuid ?? null, prevSquadHP: blockerPrev.prevSquadHP, squadCombatantIds: blockerPrev.squadCombatantIds, squadTokenIds: blockerPrev.squadTokenIds ?? [] });
          }
          const blockerNames = creatureBlockers.map(b => b.name).join(', ');
          const bonusNote    = bonusCreatureDmg ? ` (${remaining} + ${bonusCreatureDmg} bonus)` : '';
          if (juggernaut) {
            collisionMsgs.push(`<strong>Unstoppable!</strong> ${targetToken.name} obliterates ${blockerNames} and keeps going.`);
            continue;
          }
          const _ltPhrase = (noMoverDmg === noObstacleDmg) ? (noMoverDmg ? 'Would all take' : 'All take') : noMoverDmg ? `Obstacles take, ${targetToken.name} would take` : `${targetToken.name} takes, obstacles would take`;
          collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} crashes into ${blockerNames} with ${remaining} square${remaining !== 1 ? 's' : ''} remaining. ${_ltPhrase} <strong>${dmg} damage</strong>${bonusNote}${ncdNote}.`);
          break;
        }

        const tileResult = await checkTileCollision(stepCells);
        if (tileResult === 'break') break;
        if (tileResult === 'continue') continue;

        continue;
      }

      const singleTileResult = await checkTileCollision([step]);
      if (singleTileResult === 'break') break;
      if (singleTileResult === 'continue') continue;

      let wall = wallBetween(prev, step);
      if (!wall && prev.x !== step.x && prev.y !== step.y) {
        const cA = { x: step.x, y: prev.y };
        const cB = { x: prev.x, y: step.y };
        const activeWall = (w) => {
          if (!w || hasTags(w, 'broken')) return null;
          const wb = w.flags?.['wall-height']?.bottom ?? 0;
          const wt = w.flags?.['wall-height']?.top    ?? Infinity;
          return (stepElev >= wt || stepElev < wb) ? null : w;
        };
        const wVert  = activeWall(wallBetween(prev, cA)) ?? activeWall(wallBetween(step, cA));
        const wHoriz = activeWall(wallBetween(prev, cB)) ?? activeWall(wallBetween(step, cB));
        if (wVert && wHoriz) {
          wall = (hasTags(wVert, 'obstacle') && !hasTags(wVert, 'breakable'))   ? wVert
               : (hasTags(wHoriz, 'obstacle') && !hasTags(wHoriz, 'breakable')) ? wHoriz
               : hasTags(wVert, 'obstacle') ? wVert : wHoriz;
          if (getSetting('debugMode')) console.log(`DSCT | FM | Double corner collision at step ${i}: (${prev.x},${prev.y})?(${step.x},${step.y})`);
        } else if (wVert || wHoriz) {
          const cornerWall = wVert ?? wHoriz;
          if (getSetting('cornerCutMode') === 'collide') {
            wall = cornerWall;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Single corner collision at step ${i}: (${prev.x},${prev.y})?(${step.x},${step.y})`);
          } else {
            if (getSetting('debugMode')) console.log(`DSCT | FM | Single corner blocked at step ${i}: (${prev.x},${prev.y})?(${step.x},${step.y})`);
            landingIndex = i - 1;
            break;
          }
        }
      }
      if (wall && !hasTags(wall, 'broken')) {
        const wallBottom = wall.flags?.['wall-height']?.bottom ?? 0;
        const wallTop    = wall.flags?.['wall-height']?.top    ?? Infinity;
        if (!(stepElev >= wallTop || stepElev < wallBottom)) {
          
          
          if (!hasTags(wall, 'obstacle') && !juggernaut) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Hit indestructible wall (no 'obstacle' tag) at step ${i}. dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} hits a wall${moverAndTakes(dmg)}.`);
            break;
          }

          if (hasTags(wall, 'obstacle') || juggernaut) {
            if (hasTags(wall, 'wall-converted')) {
              wall = await splitConvertedWall(wall, step.x, step.y, undoOps);
            }

            const blockTag = getTags(wall).find(t => t.startsWith('wall-block-'));
            const isBreakable = hasTags(wall, 'breakable');

            if (!isBreakable && !juggernaut) {
              landingIndex = i - 1;
              const dmg = 2 + remaining + bonusObjectDmg;
              await dmgTarget(dmg);
              if (getSetting('debugMode')) console.log(`DSCT | FM | Stopped by non-breakable obstacle wall at step ${i}. dmg=${dmg}`);
              collisionMsgs.push(`${targetToken.name} hits a wall${moverAndTakes(dmg)}.`);
              break;
            }

            
            const mat  = juggernaut ? 'glass' : getMaterial(wall);
            const rule = juggernaut ? { cost: 1, damage: 0 } : MATERIAL_RULES()[mat];
            const dmg  = juggernaut ? 0 : (remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg);
            await dmgTarget(dmg);

            if (juggernaut || remaining >= rule.cost) {
              if (blockTag) {
                const allWalls    = getByTag(blockTag).filter(o => Array.isArray(o.c));
                const tile        = canvas.tiles.placeables.find(t => hasTags(t, blockTag));
                const isMidHeight = stepElev > wallBottom;
                const isStable    = tile && hasTags(tile, 'stable');

                if (isMidHeight && isStable) {
                  await splitTileAtElevation(tile, stepElev, undoOps, collisionMsgs);
                } else if (isMidHeight && !isStable) {
                  const prevTop    = wallTop;
                  for (const w of allWalls) await safeUpdate(w, { 'flags.wall-height.top': wallTop - 1 });
                  const prevDmgTag = tile ? getTags(tile).find(t => t.startsWith('damaged:')) : null;
                  const prevDmgN   = prevDmgTag ? parseInt(prevDmgTag.split(':')[1]) : 0;
                  if (tile && game.user.isGM) {
                    if (prevDmgTag) await removeTags(tile, [prevDmgTag]);
                    await addTags(tile, [`damaged:${prevDmgN + 1}`]);
                  }
                  for (const w of allWalls) {
                    undoOps.push({ op: 'update', uuid: w.uuid, data: { 'flags.wall-height.top': prevTop } });
                  }
                  if (tile) {
                    undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: [`damaged:${prevDmgN + 1}`] });
                    if (prevDmgTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDmgTag] });
                  }
                  collisionMsgs.push(`The top of the ${mat} object collapses into the gap (now ${wallTop - 1 - wallBottom} square${wallTop - 1 - wallBottom !== 1 ? 's' : ''} tall).`);
                } else {
                  const origMat      = tile ? getMaterial(tile) : 'stone';
                  const prevAlpha    = tile ? (tile.document.alpha ?? getMaterialAlpha(origMat)) : getMaterialAlpha(origMat);
                  const prevWallData = allWalls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
                  for (const w of allWalls) {
                    await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
                    if (game.user.isGM) await addTags(w, ['broken']);
                  }
                  if (tile) {
                    const swBrokenAlpha = hasTags(tile, 'invisible') ? 0 : 0.8;
                    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: swBrokenAlpha });
                    if (game.user.isGM) await addTags(tile, ['broken']);
                    undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: prevAlpha } });
                    undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['broken'] });
                  }
                  for (const { wall: w, restrict } of prevWallData) {
                    undoOps.push({ op: 'update',     uuid: w.uuid, data: restrict });
                    undoOps.push({ op: 'removeTags', uuid: w.uuid, tags: ['broken'] });
                  }
                }
              } else {
                await safeDelete(wall);
              }
              collisionMsgs.push(`${targetToken.name} smashes through ${mat} (costs ${rule.cost}${moverDealsNote(rule.damage)}).`);
              if (juggernaut) costConsumed -= 1; else costConsumed += rule.cost - 1;
              if (getSetting('debugMode')) console.log(`DSCT | FM | Broke wall (${mat}) at step ${i}. cost=${rule.cost}, costConsumed now=${costConsumed}, remaining after break=${remaining - rule.cost}`);
              if (moverWouldStop(dmg)) { await killMover(`${targetToken.name} is killed by the impact; continuing as a corpse.`); continue; }
              continue;
            }

            landingIndex = i - 1;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Blocked by ${mat} wall at step ${i} (needs ${rule.cost}, has ${remaining}). Landing at step ${i - 1}.`);
            collisionMsgs.push(`${targetToken.name} hits ${mat} but lacks the momentum to break through (needs ${rule.cost}, has ${remaining})${moverIsDefeated ? '.' : `. ${TakesStr(dmg)}.`}`);
            break;
          }
        }
      }

      const blocker = (() => {
        const t = tokenAt(step.x, step.y, targetToken.id);
        if (!t || (isTokenDead(t) && !getSetting('corpsesBlock'))) return null;
        const bElev = t.document.elevation ?? 0;
        const bSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
        if (bElev >= stepElev && (bElev - stepElev) >= tokenSize) return null;
        if (bElev <  stepElev && (stepElev - bElev) >= bSize)     return null;
        return t;
      })();
      if (blocker) {
        if (isTokenDead(blocker)) {
          landingIndex = i - 1;
          const stopDmg = remaining + bonusCreatureDmg;
          if (!moverIsDefeated && !noMoverDmg) await dmgTarget(stopDmg);
          collisionMsgs.push(`${targetToken.name} is stopped by the corpse of ${blocker.name}${moverIsDefeated || noMoverDmg ? '.' : `. ${TakesStr(stopDmg)}.`}`);
          break;
        }

        if (blocker.actor?.type === 'object') {
          if (sourceToken && !noMoverDmg && !case1Fired && getSetting('friendlyFireConfirmation') && sameDisp(sourceToken, targetToken)) {
            case1Fired = true;
            const stop = await confirmFriendlyFireCase1(sourceToken, targetToken);
            if (stop) { landingIndex = i - 1; friendlyFireNote = `Friendly fire reduced ${type} ${reduced} to ${i}.`; break; }
          }
          const objectHP  = blocker.actor?.system?.stamina?.value ?? 0;
          const dealDmg   = remaining + bonusObjectDmg;
          const objBreaks = dealDmg >= objectHP;
          const moverDmg  = Math.min(dealDmg, objectHP) + 2;

          if (objBreaks) {
            if (!window._dsctRubblePlaced) window._dsctRubblePlaced = new Set();
            window._dsctRubblePlaced.add(blocker.id);
            setTimeout(() => window._dsctRubblePlaced?.delete(blocker.id), 5000);
          }
          const objPrev = noObstacleDmg ? null : await applyDamage(blocker.actor, dealDmg);
          if (objPrev) undoOps.push({ op: 'stamina', uuid: blocker.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
          await dmgTarget(moverDmg);

          if (objBreaks) {
            collisionMsgs.push(`${targetToken.name} smashes through ${blocker.name} (${objectHP} stamina)${moverIsDefeated ? '.' : `. ${TakesStr(moverDmg)}.`}`);
            await destroyObjectToken(blocker, undoOps);
            costConsumed += Math.max(0, objectHP - 1);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Object ${blocker.name} destroyed (HP=${objectHP}, remaining=${remaining}). Movement continues.`);
            if (moverWouldStop(moverDmg)) { await killMover(`${targetToken.name} is killed by the impact; continuing as a corpse.`); continue; }
            continue;
          } else {
            landingIndex = i - 1;
            collisionMsgs.push(`${targetToken.name} crashes into ${blocker.name} but cannot destroy it (needs ${objectHP} stamina, has ${remaining})${moverIsDefeated ? `. ${blocker.name} ${dmgStr(dealDmg)}.` : `. ${TakesStr(moverDmg)}, ${blocker.name} ${dmgStr(dealDmg)}.`}`);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Object ${blocker.name} survived (HP=${objectHP}, remaining=${remaining}). Stopped.`);
            break;
          }
        }

        const savedLandingIndex = landingIndex;
        if (!juggernaut) landingIndex = i - 1;

        if (sourceToken && !juggernaut && getSetting('friendlyFireConfirmation')) {
          if (!case1Fired && sameDisp(sourceToken, targetToken)) {
            case1Fired = true;
            if (!noMoverDmg) {
              const stop = await confirmFriendlyFireCase1(sourceToken, targetToken);
              if (stop) { friendlyFireNote = `Friendly fire reduced ${type} ${reduced} to ${i}.`; break; }
            }
          } else if (!noObstacleDmg && sameDisp(sourceToken, blocker)) {
            const action = await confirmFriendlyFireCase2(sourceToken, targetToken, [blocker], remaining + bonusCreatureDmg);
            if (action === 'cancel') { friendlyFireNote = `Friendly fire reduced ${type} ${reduced} to ${i}.`; break; }
            if (action === 'ignore') { landingIndex = savedLandingIndex; continue; }
          }
        }

        undoOps.push({ op: 'update', uuid: blocker.document.uuid, data: { x: blocker.document.x, y: blocker.document.y, elevation: blocker.document.elevation ?? 0 }, options: { isUndo: true } });
        const movedSquadGroup   = getSquadGroup(targetToken.actor);
        const blockerSquadGroup = getSquadGroup(blocker.actor);
        const sharedGroup       = movedSquadGroup && blockerSquadGroup &&
          movedSquadGroup.id === blockerSquadGroup.id ? movedSquadGroup : null;
        const prevSharedHP      = sharedGroup?.system?.staminaValue ?? null;

        const creatureDmg = juggernaut ? ((blocker.actor.system.isMinion) ? (blocker.actor.system.stamina.max ?? 99999) : 99999) : remaining + bonusCreatureDmg;
        await dmgTarget(juggernaut ? 0 : creatureDmg);
        
        if (sharedGroup && !(noObstacleDmg && !juggernaut)) {
          if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
          window._lastSquadDamagedTokenIds.add(blocker.id);
          clearTimeout(window._lastSquadDamagedTokenIdsTimer);
          window._lastSquadDamagedTokenIdsTimer = setTimeout(() => { window._lastSquadDamagedTokenIds = null; }, 10000);
        }
        const blockerPrev = (noObstacleDmg && !juggernaut) ? null : await applyDamage(blocker.actor, creatureDmg, sharedGroup ? null : blockerSquadGroup);

        if (blockerPrev && sharedGroup && prevSharedHP !== null) {
          const sharedMembers = Array.from(sharedGroup.members || []).filter(m => m);
          blockerPrev.squadGroup        = sharedGroup;
          blockerPrev.prevSquadHP       = prevSharedHP;
          blockerPrev.squadCombatantIds = sharedMembers.map(m => m.id);
          blockerPrev.squadTokenIds     = sharedMembers.map(m => m.tokenId).filter(Boolean);
        }
        if (blockerPrev) {
          undoOps.push({ op: 'stamina', uuid: blocker.actor.uuid, prevValue: blockerPrev.prevValue, prevTemp: blockerPrev.prevTemp, squadGroupUuid: blockerPrev.squadGroup?.uuid ?? null, prevSquadHP: blockerPrev.prevSquadHP, squadCombatantIds: blockerPrev.squadCombatantIds, squadTokenIds: blockerPrev.squadTokenIds ?? [] });
        }

        const dmgTotal  = remaining + bonusCreatureDmg;
        const bonusNote = bonusCreatureDmg ? ` (${remaining} + ${bonusCreatureDmg} bonus)` : '';
        if (juggernaut) {
          collisionMsgs.push(`<strong>Unstoppable!</strong> ${targetToken.name} obliterates ${blocker.name} and keeps going.`);
          continue;
        }
        const _hcSame = noMoverDmg === noObstacleDmg;
        const _hcMsg  = _hcSame
          ? `${noMoverDmg ? 'Would both take' : 'Both take'} <strong>${dmgTotal} damage</strong>${bonusNote}${ncdNote}`
          : `${targetToken.name} ${dmgStr(dmgTotal)}; ${blocker.name} ${blockerDmgStr(dmgTotal)}${bonusNote}`;
        collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} crashes into ${blocker.name} with ${remaining} square${remaining !== 1 ? 's' : ''} remaining. ${_hcMsg}.`);
        break;
      }

      const tile = tileAt(step.x, step.y);
      if (tile && hasTags(tile, 'obstacle') && !hasTags(tile, 'broken')) {
        const blockTag   = getTags(tile).find(t => t.startsWith('wall-block-'));
        const tileWalls  = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
        const tileBottom = tileWalls[0]?.flags?.['wall-height']?.bottom ?? 0;
        const tileTop    = tileWalls[0]?.flags?.['wall-height']?.top    ?? Infinity;

        if (!(isVertical && (stepElev >= tileTop || stepElev < tileBottom))) {
          const isBreakable = hasTags(tile, 'breakable');

          if (!isBreakable) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            collisionMsgs.push(`${targetToken.name} is stopped by an obstacle${moverAndTakes(dmg)}.`);
            break;
          }

          const mat  = getMaterial(tile);
          const rule = MATERIAL_RULES()[mat];
          const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
          await dmgTarget(dmg);

          if (remaining >= rule.cost) {
            if (blockTag) {
              let walls = getByTag(blockTag).filter(o => Array.isArray(o.c));
              const splitWalls = [];
              for (const w of walls) {
                if (hasTags(w, 'wall-converted')) {
                  const inner = await splitConvertedWall(w, step.x, step.y, undoOps);
                  splitWalls.push(inner);
                } else {
                  splitWalls.push(w);
                }
              }
              walls = splitWalls;
              const origMat      = getMaterial(tile);
              const prevAlpha    = tile.document.alpha ?? getMaterialAlpha(origMat);
              const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
              for (const wall of walls) {
                await safeUpdate(wall, { move: 0, sight: 0, light: 0, sound: 0 });
                if (game.user.isGM) await addTags(wall, ['broken']);
              }
              const stBrokenAlpha = hasTags(tile, 'invisible') ? 0 : 0.8;
              await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: stBrokenAlpha });
              if (game.user.isGM) await addTags(tile, ['broken']);

              undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: prevAlpha } });
              undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['broken'] });
              for (const { wall, restrict } of prevWallData) {
                undoOps.push({ op: 'update',     uuid: wall.uuid, data: restrict });
                undoOps.push({ op: 'removeTags', uuid: wall.uuid, tags: ['broken'] });
              }
            } else {
              await safeDelete(tile.document);
            }
            collisionMsgs.push(`${targetToken.name} smashes through ${mat} (costs ${rule.cost}${moverDealsNote(rule.damage)}).`);
            costConsumed += rule.cost - 1;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Broke tile (${mat}) at step ${i}. cost=${rule.cost}, costConsumed now=${costConsumed}, remaining after break=${remaining - rule.cost}`);
            if (moverWouldStop(dmg)) { await killMover(`${targetToken.name} is killed by the impact; continuing as a corpse.`); continue; }
            continue;
          }

          landingIndex = i - 1;
          if (getSetting('debugMode')) console.log(`DSCT | FM | Blocked by ${mat} tile at step ${i} (needs ${rule.cost}, has ${remaining}). Landing at step ${i - 1}.`);
          collisionMsgs.push(`${targetToken.name} hits ${mat} but lacks the momentum to break through (needs ${rule.cost}, has ${remaining})${moverIsDefeated ? '.' : `. ${TakesStr(dmg)}.`}`);
          break;
        }
      }
    }
    if (getSetting('debugMode')) console.log(`DSCT | FM | Path loop done. landingIndex=${landingIndex}, path.length=${path.length}, costConsumed=${costConsumed}`);

    const landingGrid      = landingIndex >= 0 ? path[landingIndex] : startGrid;
    const landingStepIndex = landingIndex >= 0 ? landingIndex : -1;

    const stepsToAnimate = landingIndex >= 0 ? path.slice(0, landingIndex + 1) : [];

    const grabberGrabs = [...(window._activeGrabs?.entries() ?? [])].filter(([, g]) => g.grabberTokenId === targetToken.id);
    if (grabberGrabs.length > 0) {
      window._grabFMSuppressed ??= new Set();
      window._grabFMSuppressed.add(targetToken.id);
    }

    window._dsctFMBypassFrightened ??= new Set();
    window._dsctFMBypassFrightened.add(targetToken.id);
    let animTerrainElev = startElev;
    try {
      for (let s = 0; s < stepsToAnimate.length; s++) {
        const stepGrid  = stepsToAnimate[s];
        const stepWorld = toWorld(stepGrid);
        const stepElev  = isVertical && path.length > 0
          ? startElev + Math.round(reducedVert * (s + 1) / path.length)
          : startElev;

        if (isVertical && stepElev !== (targetToken.document.elevation ?? 0)) {
          await safeUpdate(targetToken.document, { elevation: stepElev });
        }
        const stepMoveData = { x: stepWorld.x, y: stepWorld.y, movementAction: 'forced' };
        if (terrainMap) {
          const te = terrainMap[`${stepGrid.x},${stepGrid.y}`] ?? 0;
          if (Math.abs(te - animTerrainElev) === 1) {
            stepMoveData.elevation = te;
            animTerrainElev = te;
          }
        }
        await safeUpdate(targetToken.document, stepMoveData, { dsMovement: true });
        await new Promise(r => setTimeout(r, getSetting('animationStepDelay')));
      }
    } finally {
      window._dsctFMBypassFrightened.delete(targetToken.id);
    }
    const finalElev = isVertical && path.length > 0
      ? startElev + Math.round(reducedVert * (landingStepIndex + 1) / path.length)
      : animTerrainElev;
    
    
    const horzEffectiveNoFallDmg = noFallDamage || targetIsDead || moverIsDefeated;
    const targetElev = (reducedVert < 0 && finalElev <= 0)
      ? await applyForcedFallDamage(targetToken, Math.abs(reducedVert), finalElev, landingGrid, undoOps, collisionMsgs, horzEffectiveNoFallDmg)
      : await applyFallDamage(targetToken, finalElev, landingGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, horzEffectiveNoFallDmg);
    if (getSetting('debugMode')) console.log(`DSCT | FM | finalElev=${finalElev}, targetElev=${targetElev} (after fall)`);

    
    
    
    
    const landingWorld = stepsToAnimate.length > 0
      ? { x: targetToken.document.x, y: targetToken.document.y }
      : startPos;

    {
      const destX = landingWorld.x;
      const destY = landingWorld.y;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const live = canvas.scene.tokens.get(targetToken.id);
        if (!live) break;
        const xOk    = stepsToAnimate.length === 0 || (Math.abs(live.x - destX) < 1 && Math.abs(live.y - destY) < 1);
        const elevOk = Math.abs((live.elevation ?? 0) - targetElev) < 0.1;
        if (xOk && elevOk) break;
        await new Promise(r => setTimeout(r, 50));
      }
    }
    if (getSetting('debugMode')) {
      const live = canvas.scene.tokens.get(targetToken.id);
      console.log(`DSCT | FM | Post-poll: live(${live?.x},${live?.y},elev=${live?.elevation}) | landing(${landingWorld.x},${landingWorld.y},elev=${targetElev})`);
    }

    const grabsEnded = [];
    if (grabberGrabs.length > 0) {
      window._grabFMSuppressed?.delete(targetToken.id);
      const grabberGrid = toGrid(targetToken.document);
      const grabberSize = targetToken.actor?.system?.combat?.size?.value ?? 1;
      for (const [grabbedId, grab] of grabberGrabs) {
        if (!window._activeGrabs?.has(grabbedId)) continue; 
        const grabbedTok = getTokenById(grabbedId);
        if (!grabbedTok) { await endGrab(grabbedId, { silent: true }); continue; }
        const grabbedGrid = toGrid(grabbedTok.document);
        const nearX = Math.max(grabberGrid.x, Math.min(grabbedGrid.x, grabberGrid.x + grabberSize - 1));
        const nearY = Math.max(grabberGrid.y, Math.min(grabbedGrid.y, grabberGrid.y + grabberSize - 1));
        const dist  = Math.max(Math.abs(grabbedGrid.x - nearX), Math.abs(grabbedGrid.y - nearY));
        if (dist <= 1) {
          const g  = window._activeGrabs.get(grabbedId);
          g.offsetX = grabbedTok.document.x - targetToken.document.x;
          g.offsetY = grabbedTok.document.y - targetToken.document.y;
        } else {
          grabsEnded.push({ grabberTokenId: targetToken.id, grabbedTokenId: grabbedId });
          await endGrab(grabbedId, { silent: false, customMsg: `${grab.grabberName} was force-moved out of reach and released ${grab.grabbedName}.` });
        }
      }
    }

    const oldMoveId = targetToken.document.getFlag('draw-steel-combat-tools', 'lastFmMoveId');
    if (oldMoveId) {
      const oldMsg = game.messages.contents.find(m => m.getFlag('draw-steel-combat-tools', 'moveId') === oldMoveId);
      if (oldMsg) await safeUpdate(oldMsg, { 'flags.draw-steel-combat-tools.isExpired': true });
    }

    const moveId = foundry.utils.randomID();
    const fullUndoLog = buildUndoLog(targetToken, startPos, startElevSnap, movedSnap, undoOps, targetIsDead);

    if (totalTargetDmg > 0) {
      collisionMsgs.push(`<strong>Total damage to ${targetToken.name}: ${totalTargetDmg}</strong>`);
    }

    if (getSetting('debugMode')) {
      const liveSnap = canvas.scene.tokens.get(targetToken.id);
      console.log(`DSCT | FM | Pre-message snapshot for ${targetToken.name}: doc.x=${targetToken.document.x}, doc.y=${targetToken.document.y}, doc.elev=${targetToken.document.elevation??0} | live.x=${liveSnap?.x}, live.y=${liveSnap?.y}, live.elev=${liveSnap?.elevation??0} | finalPos will be (${landingWorld.x},${landingWorld.y},${targetElev}) | doc===live: ${targetToken.document === liveSnap}`);
    }

    await safeUpdate(targetToken.document, { 'flags.draw-steel-combat-tools.lastFmMoveId': moveId });

    if (getSetting('debugMode')) {
      console.log(`DSCT | FM | Assigned moveId=${moveId} to ${targetToken.name}. Confirmed lastFmMoveId=${targetToken.document.getFlag('draw-steel-combat-tools','lastFmMoveId')}`);
    }

    const mainResultData = {
      content:        buildSummary() + (collisionMsgs.length ? '<br>' + collisionMsgs.join('<br>') : ''),
      undoLog:        fullUndoLog,
      moveId,
      targetTokenId:  targetToken.id,
      targetSceneId:  canvas.scene.id,
      finalPos:       { x: landingWorld.x, y: landingWorld.y, elevation: targetElev },
      hadDamage:      collisionMsgs.length > 0,
      grabsToRestore: grabsEnded,
    };
    if (suppressMessage) { window._dsctFMActive = false; return mainResultData; }
    await ChatMessage.create({
      content: mainResultData.content,
      flags: { 'draw-steel-combat-tools': { isFmUndo: true, isUndone: false, ...mainResultData } }
    });
    window._dsctFMActive = false;
};

const getTargetAndSource = () => {
  const targets    = [...game.user.targets];
  const controlled = canvas.tokens.controlled;
  const target     = targets.length === 1 ? targets[0] : (controlled.length === 1 ? controlled[0] : null);
  const source     = targets.length === 1 && controlled.length === 1 ? controlled[0] : null;
  return { target, source };
};

export const pickTarget = (remaining) => new Promise((resolve) => {
  if (remaining.length === 1) { resolve(remaining[0]); return; }

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const redraw = (hoverToken) => {
    graphics.clear();
    for (const t of remaining) {
      const isHover = hoverToken && t.id === hoverToken.id;
      graphics.beginFill(0xffaa00, isHover ? 0.6 : 0.35);
      graphics.drawRect(t.document.x, t.document.y, canvas.grid.size, canvas.grid.size);
      graphics.endFill();
    }
  };

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);
  let hoverToken = null;

  const onMove = (e) => {
    const pos = e.data.getLocalPosition(canvas.app.stage);
    hoverToken = remaining.find(t => {
      const d = t.document;
      return pos.x >= d.x && pos.x < d.x + canvas.grid.size && pos.y >= d.y && pos.y < d.y + canvas.grid.size;
    }) ?? null;
    redraw(hoverToken);
  };

  const onClick = (e) => {
    const pos     = e.data.getLocalPosition(canvas.app.stage);
    const clicked = remaining.find(t => {
      const d = t.document;
      return pos.x >= d.x && pos.x < d.x + canvas.grid.size && pos.y >= d.y && pos.y < d.y + canvas.grid.size;
    });
    if (!clicked) return;
    cleanup();
    resolve(clicked);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

  const cleanup = () => {
    overlay.off('pointermove', onMove);
    overlay.off('pointerdown', onClick);
    document.removeEventListener('keydown', onKeyDown);
    canvas.app.stage.removeChild(overlay);
    canvas.app.stage.removeChild(graphics);
    graphics.destroy();
    overlay.destroy();
  };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  redraw(null);
  ui.notifications.info(game.i18n.localize('DSCT.notice.fm.resolveInstruction'));
});

export async function runForcedMovement(macroArgs = []) {

  if (Array.isArray(macroArgs) && macroArgs.length >= 2) {
    const type              = parseType(macroArgs[0]);
    const distance          = parseInt(macroArgs[1]);
    const bonusCreatureDmg  = parseInt(macroArgs[2]) || 0;
    const bonusObjectDmg    = parseInt(macroArgs[3]) || 0;
    const verticalRaw       = macroArgs[4];
    const fallReduction     = parseInt(macroArgs[5]) || 0;
    const noFallDamage      = macroArgs[6] === 'true' || macroArgs[6] === true;
    const ignoreStability   = macroArgs[7] === 'true' || macroArgs[7] === true;
    const noCollisionDamage = macroArgs[8] === 'true' || macroArgs[8] === true;
    const keywords          = macroArgs[9] ? String(macroArgs[9]).split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];
    const range             = parseInt(macroArgs[10]) || 0;
    const fastMove          = macroArgs[11] === 'true' || macroArgs[11] === true;

    let verticalHeight = 0;
    if (verticalRaw !== undefined && verticalRaw !== '') {
      const parsed = parseInt(verticalRaw) || 0;
      const sign   = type === 'Pull' ? -1 : 1;
      verticalHeight = parsed < 0 ? parsed : parsed * sign;
    }
    if (!type)           { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.invalidType')); return; }
    if (isNaN(distance)) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.invalidDistance')); return; }

    const userTargets = [...game.user.targets];
    const controlled  = canvas.tokens.controlled;
    const source      = controlled.length === 1 ? controlled[0] : null;

    let targetsToProcess;
    if (userTargets.length >= 1) {
      targetsToProcess = userTargets.slice(0, 25);
    } else if (controlled.length === 1) {
      targetsToProcess = [controlled[0]];
    } else {
      if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.noTokenToMove')); return; }
      const picked = await runMultiTokenPicker();
      if (!picked?.length) return;
      setFoundryTargets(picked);
      targetsToProcess = picked;
    }

    if (range > 0 && getSetting('enforceAbilityRange') && !(game.user.isGM && getSetting('gmBypassRangeEnforcement')) && source) {
      targetsToProcess = targetsToProcess.filter(t => {
        const hDist   = tokFootprintDist(source, t);
        const vDist   = Math.abs((source.document.elevation ?? 0) - (t.document.elevation ?? 0));
        const adjDist = Math.max(hDist, vDist * canvas.grid.distance);
        if (adjDist >= range * canvas.grid.distance) {
          ui.notifications.warn(game.i18n.format('DSCT.notice.fm.notInRange', { name: t.name }));
          return false;
        }
        return true;
      });
      if (targetsToProcess.length === 0) return;
    }

    if (targetsToProcess.length === 1) {
      await _runForcedMovement(type, distance, targetsToProcess[0], source, bonusCreatureDmg, bonusObjectDmg, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, keywords, fastMove);
    } else {
      const results = [];
      if (fastMove) {
        for (const t of targetsToProcess) {
          const result = await _runForcedMovement(type, distance, t, source, bonusCreatureDmg, bonusObjectDmg, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, keywords, fastMove, true);
          if (result) results.push(result);
        }
      } else {
        let remaining = [...targetsToProcess];
        while (remaining.length > 0) {
          const picked = await pickTarget(remaining);
          if (!picked) break;
          remaining = remaining.filter(t => t.id !== picked.id);
          const result = await _runForcedMovement(type, distance, picked, source, bonusCreatureDmg, bonusObjectDmg, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, keywords, fastMove, true);
          if (result) results.push(result);
        }
      }
      if (results.length === 0) return;
      await ChatMessage.create({
        content: results.map(r => r.content).join('<hr style="margin: 4px 0;">'),
        flags: {
          'draw-steel-combat-tools': {
            isFmUndo:   true,
            isCombined: true,
            entries:    results.map(({ content, undoLog, moveId, targetTokenId, targetSceneId, finalPos, hadDamage, grabsToRestore }) =>
                          ({ content, undoLog, moveId, targetTokenId, targetSceneId, finalPos, hadDamage, grabsToRestore: grabsToRestore ?? [] })),
            isUndone:   false,
            hadDamage:  results.some(r => r.hadDamage),
          }
        }
      });
    }
  } 
  else if (typeof macroArgs === 'object' && !Array.isArray(macroArgs) && 'movement' in macroArgs) {
    
    const { movement, distance: distRaw, properties, verticalDistance = 0, fallReduction = 0, target: explicitTarget, source: explicitSource } = macroArgs;
    const type     = parseType(movement);
    const distance = parseInt(distRaw) || 0;
    const propSet  = properties instanceof Set ? properties : new Set(properties ?? []);

    const noCollisionDamage        = propSet.has('no-collision-damage');
    const noMoverCollisionDamage   = propSet.has('no-mover-collision-damage');
    const noObstacleCollisionDamage = propSet.has('no-obstacle-collision-damage');
    const ignoreStability          = propSet.has('ignore-stability');
    const fastMove          = propSet.has('fast-auto-path');

    if (!type)           { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.invalidMovementType')); return; }
    if (isNaN(distance)) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.invalidDistance')); return; }

    const userTargets = explicitTarget ? [explicitTarget] : [...game.user.targets];
    const controlled  = canvas.tokens.controlled;
    const source      = explicitSource ?? (controlled.length === 1 ? controlled[0] : null);

    let targetsToProcess;
    if (userTargets.length >= 1) {
      targetsToProcess = userTargets.slice(0, 25);
    } else if (controlled.length === 1) {
      targetsToProcess = [controlled[0]];
    } else {
      if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.noTokenToMove')); return; }
      const picked = await runMultiTokenPicker();
      if (!picked?.length) return;
      setFoundryTargets(picked);
      targetsToProcess = picked;
    }

    
    let verticalHeight = verticalDistance;
    if (type === 'Pull' && verticalHeight > 0) verticalHeight = -verticalHeight;

    if (targetsToProcess.length === 1) {
      await _runForcedMovement(type, distance, targetsToProcess[0], source, 0, 0, verticalHeight, fallReduction, false, ignoreStability, noCollisionDamage, [], fastMove, false, false, noMoverCollisionDamage, noObstacleCollisionDamage);
    } else {
      const results = [];
      if (fastMove) {
        for (const t of targetsToProcess) {
          const result = await _runForcedMovement(type, distance, t, source, 0, 0, verticalHeight, fallReduction, false, ignoreStability, noCollisionDamage, [], fastMove, true, false, noMoverCollisionDamage, noObstacleCollisionDamage);
          if (result) results.push(result);
        }
      } else {
        let remaining = [...targetsToProcess];
        while (remaining.length > 0) {
          const picked = await pickTarget(remaining);
          if (!picked) break;
          remaining = remaining.filter(t => t.id !== picked.id);
          const result = await _runForcedMovement(type, distance, picked, source, 0, 0, verticalHeight, fallReduction, false, ignoreStability, noCollisionDamage, [], fastMove, true, false, noMoverCollisionDamage, noObstacleCollisionDamage);
          if (result) results.push(result);
        }
      }
      if (results.length === 0) return;
      await ChatMessage.create({
        content: results.map(r => r.content).join('<hr style="margin: 4px 0;">'),
        flags: {
          'draw-steel-combat-tools': {
            isFmUndo:   true,
            isCombined: true,
            entries:    results.map(({ content, undoLog, moveId, targetTokenId, targetSceneId, finalPos, hadDamage, grabsToRestore }) =>
                          ({ content, undoLog, moveId, targetTokenId, targetSceneId, finalPos, hadDamage, grabsToRestore: grabsToRestore ?? [] })),
            isUndone:   false,
            hadDamage:  results.some(r => r.hadDamage),
          }
        }
      });
    }
  }
  else if (typeof macroArgs === 'object' && !Array.isArray(macroArgs) && Object.keys(macroArgs).length > 0) {
    const { type, distance, sourceId, targetId, verticalHeight, fallReduction, noFallDamage, noCollisionDamage, noMoverCollisionDamage = false, noObstacleCollisionDamage = false, ignoreStability, fastMove, suppressMessage, juggernaut } = macroArgs;
    const target = getTokenById(targetId);
    const source = sourceId ? getTokenById(sourceId) : null;
    if (!target) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.targetNotFound')); return; }
    return await _runForcedMovement(type, distance, target, source, 0, 0, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, [], fastMove, suppressMessage, juggernaut, noMoverCollisionDamage, noObstacleCollisionDamage);
  }
  else {
    toggleForcedMovementPanel();
  }
}