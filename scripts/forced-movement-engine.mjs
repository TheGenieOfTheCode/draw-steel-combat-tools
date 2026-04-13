import {
  hasTags, getTags, getByTag, addTags, removeTags,
  GRID as getGRID,
  toGrid, toWorld, toCenter, gridEq, gridDist,
  MATERIAL_RULES, MATERIAL_ICONS, MATERIAL_ALPHA, WALL_RESTRICTIONS,
  getMaterialIcon, getMaterialAlpha, getAllMaterials,
  getMaterial, tokenAt, tileAt, wallBetween,
  getSquadGroup, applyDamage, snapStamina,
  canCurrentlyFly, getWallBlockTileAt, getWallBlockTop,
  sizeRank,
  safeUpdate, safeDelete, safeCreateEmbedded, safeToggleStatusEffect,
  replayUndo, getSetting, getTokenById, getWindowById, getModuleApi,
} from './helpers.mjs';
import { endGrab, applyGrab } from './grab.mjs';
import {
  cornerCutsWall, parseType, buildUndoLog,
  footprintCells, newlyEnteredCells, wallsAtStep,
  tokensAtCells, tilesAtCells, doBreakObstacleWall,
  applyFallDamage, applyForcedFallDamage, destroyObjectToken, _fmDistCap,
  splitConvertedWall, splitTileAtElevation,
} from './forced-movement-collision.mjs';
import { toggleForcedMovementPanel } from './forced-movement-panel.mjs';

const _runForcedMovement = async (type, distance, targetToken, sourceToken, bonusCreatureDmg = 0, bonusObjectDmg = 0, verticalHeight = 0, fallReduction = 0, noFallDamage = false, ignoreStability = false, noCollisionDamage = false, keywords = [], fastMove = false, suppressMessage = false) => {
  // Grabbed creatures can only be force moved by their grabber.
  const grabState = window._activeGrabs?.get(targetToken.id);
  if (grabState) {
    const sourceIsGrabber = sourceToken && sourceToken.id === grabState.grabberTokenId;
    if (!sourceIsGrabber) {
      ui.notifications.warn(`A grabbed creature can't be force moved except by a creature, object, or effect that has them grabbed.`);
      return;
    }
  }

  // Restrained creatures cannot be force moved (GM can bypass using the same setting as size check).
  if (targetToken.actor?.statuses?.has('restrained')) {
    if (!(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
      ui.notifications.warn(`${targetToken.name} is restrained and cannot be force moved.`);
      return;
    }
  }

  const GRID      = getGRID();
  const stability = ignoreStability ? 0 : (targetToken.actor?.system?.combat?.stability ?? 0);
  const tokenSize = targetToken.actor?.system?.combat?.size?.value ?? targetToken.document.width ?? 1;
  const isLargeToken = !getSetting('legacySingleCellCollisions') && tokenSize >= 2;

  let effectiveDistance   = distance;
  let effectiveVertical   = verticalHeight;
  if (keywords.includes('melee') && sourceToken) {
    const attackerRank = sizeRank(sourceToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
    const targetRank   = sizeRank(targetToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
    if (attackerRank > targetRank) {
      effectiveDistance += 1;
      if (effectiveVertical !== 0) effectiveVertical += effectiveVertical > 0 ? 1 : -1;
      ui.notifications.info(`+1 ${type} ${sourceToken.name} is larger than ${targetToken.name}.`);
    }
  }

  const reduced     = Math.max(0, effectiveDistance - stability);
  const vertSign    = effectiveVertical >= 0 ? 1 : -1;
  const reducedVert = Math.max(0, Math.abs(effectiveVertical) - stability) * vertSign;
  const isVertical  = reducedVert !== 0;

  if (reduced === 0 && reducedVert === 0) {
    ui.notifications.info(`${targetToken.name}'s stability fully resists the forced movement.`);
    return;
  }

  if (stability > 0) {
    const parts = [];
    if (distance > 0)                    parts.push(`push ${distance} to ${reduced}`);
    if (Math.abs(effectiveVertical) > 0) parts.push(`vertical ${Math.abs(effectiveVertical)} to ${Math.abs(reducedVert)}`);
    ui.notifications.info(`${targetToken.name}'s stability reduces forced movement by ${stability} (${parts.join(', ')}).`);
  }

  const startElev  = targetToken.document.elevation ?? 0;
  const agility    = targetToken.actor?.system?.characteristics?.agility?.value ?? 0;
  const canFly     = canCurrentlyFly(targetToken.actor);
  // Use the center of the source token's footprint for distance calculations.
  // For even-sized tokens (size 2, 4) this is the grid intersection between their inner cells; for odd-sized tokens (size 3, 5) it is the center of the middle cell. Fractional values are intentional and work correctly with gridDist (diagonals count as 1, same as DS movement).
  const sourceSize = sourceToken
    ? (sourceToken.actor?.system?.combat?.size?.value ?? sourceToken.document.width ?? 1)
    : 1;
  const sourceGrid = sourceToken ? {
    x: sourceToken.document.x / GRID + sourceSize / 2,
    y: sourceToken.document.y / GRID + sourceSize / 2,
  } : null;
  // Cells occupied by the source token, used to exclude them from the range highlight.
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
    const parts = [`${type} ${reduced}`];
    if (isVertical)         parts.push(`vertical ${reducedVert}`);
    if (bonusCreatureDmg)   parts.push(`+${bonusCreatureDmg} creature collision`);
    if (bonusObjectDmg)     parts.push(`+${bonusObjectDmg} object collision`);
    if (fallReduction)      parts.push(`+${fallReduction} fall reduction`);
    if (noFallDamage)       parts.push('no fall damage');
    if (noCollisionDamage)  parts.push('no collision damage');
    if (ignoreStability)    parts.push('ignores stability');
    let summary = `<strong>${targetToken.name}</strong> forced: ${parts.join(', ')}.`;
    if (stability > 0 && !ignoreStability) {
      const stabParts = [];
      if (distance !== reduced)                                stabParts.push(`push ${distance} to ${reduced}`);
      if (Math.abs(verticalHeight) !== Math.abs(reducedVert)) stabParts.push(`vertical ${Math.abs(verticalHeight)} to ${Math.abs(reducedVert)}`);
      if (stabParts.length) summary += ` Stability reduced ${stabParts.join(', ')}.`;
    }
    return summary;
  };

  
  const cornerCutMode = getSetting('cornerCutMode');

  // Half-size offset converts a token top-left grid position to its footprint center.
  // Used in all Push/Pull distance comparisons for center-to-center distances.
  const hs = tokenSize / 2;
  const ctr = (g) => ({ x: g.x + hs, y: g.y + hs });

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

                // Debug: draw the direction line on the canvas for 2 seconds.
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

                      // Compare footprint centers (top-left + half-size) to avoid diagonal
                      // bias when source or target is larger than size 1.
                      let distSource = gridDist(ctr(adj), sourceGrid);
                      let currDistSource = gridDist(ctr(currGrid), sourceGrid);

                      if (type === 'Push' && distSource <= currDistSource) continue;
                      if (type === 'Pull' && distSource >= currDistSource && distSource !== 0) continue;

                      // Direction score: use the footprint center of the candidate position,
                      // not just the center of its top-left cell, so large tokens score correctly.
                      const adjCenterWorld = {
                          x: adj.x * GRID + tokenSize * GRID / 2,
                          y: adj.y * GRID + tokenSize * GRID / 2,
                      };
                      let vx = adjCenterWorld.x - targetToken.center.x;
                      let vy = adjCenterWorld.y - targetToken.center.y;

                      let dot = vx * dirX + vy * dirY;
                      if (dot <= 0.1) continue;

                      let cross = Math.abs(vx * dirY - vy * dirX);

                      // 0.001 is a tiebreaker. without it, candidates with the same perpendicular
                      // distance take turns winning and the auto-path zig-zags like it's lost.
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
              ui.notifications.warn("DSCT | Auto-Path failed: Source and Target are in the exact same spot.");
          }
      } else if (type === 'Slide') {
          ui.notifications.warn(`DSCT | Fast Move is only available for Push and Pull. Falling back to manual pathing.`);
      }
  }

  
  let finalPath = autoPath;
  if (!finalPath) {
    finalPath = await new Promise((resolve) => {
      if (reduced === 0) { resolve([]); return; }

      const path     = [];
      const graphics = new PIXI.Graphics();
      canvas.app.stage.addChild(graphics);

      const colorRange    = 0xffff00;
      const colorPath     = 0x4488ff;
      const colorStart    = 0xffaa00;
      const colorValid    = 0x44cc44;
      const colorSuggest  = 0x88ffbb;
      const colorInvalid  = 0xcc4444;
      const colorCollision = 0xff7700;

      // Pull and Slide allow moving the target into the source's space.
      const allowSourceCells = (type === 'Pull' || type === 'Slide');

      // Push and Pull must travel in a straight line (unless the houserule setting is on).
      // Pull: direction locked immediately toward the source (if sourceGrid is known).
      // Push: direction locks after the first step is placed; resets when path is emptied.
      // Slide: no direction constraint.
      const straightLineRequired = (type === 'Push' || type === 'Pull') && !getSetting('allowCrookedPushPull');
      let lockedDirX = null;
      let lockedDirY = null;

      if (straightLineRequired && type === 'Pull' && sourceGrid) {
        const dvx = sourceGrid.x - (startGrid.x + hs);
        const dvy = sourceGrid.y - (startGrid.y + hs);
        const len = Math.sqrt(dvx * dvx + dvy * dvy);
        if (len > 0) { lockedDirX = dvx / len; lockedDirY = dvy / len; }
      }

      // Returns true if cell g (grid top-left) lies on the locked direction line.
      // Cells whose center is within 0.71 grid units perpendicularly are included,
      // which keeps both options available on shallow-angle diagonals.
      const isOnLine = (g) => {
        if (lockedDirX === null) return true;
        const cx = (g.x + hs) - (startGrid.x + hs);
        const cy = (g.y + hs) - (startGrid.y + hs);
        const dot   = cx * lockedDirX + cy * lockedDirY;
        const cross = cx * lockedDirY - cy * lockedDirX;
        return dot > 0 && Math.abs(cross) < 0.71;
      };

      const computeRangeHighlight = () => {
        const reachable = new Set();
        const key = g => `${g.x},${g.y}`;
        const visited = new Map();
        visited.set(key(startGrid), 0);
        const queue = [{ pos: startGrid, steps: 0 }];
        const drawCap = _fmDistCap();
        while (queue.length) {
          const { pos, steps } = queue.shift();
          if (steps >= reduced || steps >= drawCap) continue;
          const neighbors = [
            { x: pos.x - 1, y: pos.y - 1 }, { x: pos.x, y: pos.y - 1 }, { x: pos.x + 1, y: pos.y - 1 },
            { x: pos.x - 1, y: pos.y },                                    { x: pos.x + 1, y: pos.y },
            { x: pos.x - 1, y: pos.y + 1 }, { x: pos.x, y: pos.y + 1 }, { x: pos.x + 1, y: pos.y + 1 },
          ];
          for (const nb of neighbors) {
            if (gridEq(nb, startGrid)) continue;
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
            if (!reachable.has(nk) && !gridEq(nb, startGrid) && (allowSourceCells || !sourceCellSet.has(nk))) {
              if (type === 'Push' && sourceGrid && gridDist(ctr(nb), sourceGrid) <= gridDist(ctr(pos), sourceGrid)) continue;
              if (type === 'Pull' && sourceGrid && gridDist(ctr(nb), sourceGrid) >= gridDist(ctr(pos), sourceGrid)) continue;
              wallReachable.add(nk);
            }
          }
        }
        return { reachable, wallReachable };
      };
      const { reachable: rangeHighlight, wallReachable } = computeRangeHighlight();

      // For Push/Pull with a locked direction, filter highlights to cells on the line.
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

      // In collide mode: greedy diagonal-first - shortest possible path, corner cuts allowed (they collide).
      // In block mode: flood-fills outward to find a path around corners instead of through them.
      const getSuggestedPath = (from, to) => {
        const remaining = reduced - path.length;
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
              if (type === 'Push' && sourceGrid && gridDist(ctr(c), sourceGrid) <= gridDist(ctr(curr), sourceGrid)) continue;
              if (type === 'Pull' && sourceGrid && gridDist(ctr(c), sourceGrid) >= gridDist(ctr(curr), sourceGrid)) continue;
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
        if (isLargeToken) return tokensAtCells(footprintCells(to.x, to.y, tokenSize), targetToken.id).length > 0;
        return !!tokenAt(to.x, to.y, targetToken.id);
      };

      const overlay = new PIXI.Container();
      overlay.interactive = true;
      overlay.hitArea     = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
      canvas.app.stage.addChild(overlay);
      let hoverGrid = null;

      const redraw = (hover) => {
        graphics.clear();
        const { activeRange, activeWall } = getLineFiltered();
        const lineActive = lockedDirX !== null && (type === 'Push' || type === 'Pull');

        for (const k of rangeHighlight) {
          const [gx, gy] = k.split(',').map(Number);
          const rw = toWorld({ x: gx, y: gy });
          graphics.beginFill(colorRange, lineActive && !activeRange.has(k) ? 0.05 : 0.18);
          graphics.drawRect(rw.x, rw.y, GRID, GRID);
          graphics.endFill();
        }
        for (const k of wallReachable) {
          const [gx, gy] = k.split(',').map(Number);
          const rw = toWorld({ x: gx, y: gy });
          graphics.beginFill(colorCollision, lineActive && !activeWall.has(k) ? 0.04 : 0.15);
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

        for (let pi = 0; pi < path.length; pi++) {
          const p    = path[pi];
          const prev = pi > 0 ? path[pi - 1] : startGrid;
          setCells(p.x, p.y, stepIsCollision(prev, p) ? colorCollision : colorPath, 0.45);
        }

        if (hover && path.length < reduced) {
          const prev = path.length ? path[path.length - 1] : startGrid;
          const hk   = `${hover.x},${hover.y}`;
          const inRange = activeRange.has(hk) || activeWall.has(hk);
          const destCollision = stepIsCollision(prev, hover);

          if (isValidStep(prev, hover)) {
            setCells(hover.x, hover.y, destCollision ? colorCollision : colorValid, 0.45);
          } else if (inRange) {
            const suggestion = getSuggestedPath(prev, hover);
            if (suggestion) {
              let suggPrev = prev;
              for (const s of suggestion) {
                setCells(s.x, s.y, stepIsCollision(suggPrev, s) ? colorCollision : colorSuggest, 0.45);
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
      };

      const onMove = (e) => {
        hoverGrid = toGrid(e.data.getLocalPosition(canvas.app.stage));
        redraw(hoverGrid);
      };

      const onClick = (e) => {
        const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
        const prev = path.length ? path[path.length - 1] : startGrid;
        const gk   = `${gpos.x},${gpos.y}`;
        const { activeRange, activeWall } = getLineFiltered();

        // Lock Push direction on first step (only when straight lines are required).
        if (straightLineRequired && type === 'Push' && path.length === 0 && lockedDirX === null && !gridEq(gpos, startGrid)) {
          const dvx = (gpos.x + hs) - (startGrid.x + hs);
          const dvy = (gpos.y + hs) - (startGrid.y + hs);
          const len = Math.sqrt(dvx * dvx + dvy * dvy);
          if (len > 0) { lockedDirX = dvx / len; lockedDirY = dvy / len; }
        }

        if (isValidStep(prev, gpos)) {
          path.push(gpos);
          if (path.length === reduced) { cleanup(); resolve(path); return; }
          redraw(hoverGrid);
        } else if (activeRange.has(gk) || activeWall.has(gk)) {
          const suggestion = getSuggestedPath(prev, gpos);
          if (!suggestion) { ui.notifications.warn('No valid path to that square.'); return; }
          for (const s of suggestion) path.push(s);
          if (!gridEq(path[path.length - 1], gpos)) path.push(gpos);
          cleanup(); resolve(path);
        } else {
          ui.notifications.warn('Invalid step for ' + type + '.');
        }
      };

      const onRightClick = () => {
        if (path.length > 0) {
          path.pop();
          if (straightLineRequired && type === 'Push' && path.length === 0) { lockedDirX = null; lockedDirY = null; }
          redraw(hoverGrid);
        }
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(null); }
        if (e.key === 'Enter')  { cleanup(); resolve(path); }
      };

      const cleanup = () => {
        overlay.off('pointermove', onMove);
        overlay.off('pointerdown', onClick);
        overlay.off('rightdown',   onRightClick);
        document.removeEventListener('keydown', onKeyDown);
        canvas.app.stage.removeChild(overlay);
        canvas.app.stage.removeChild(graphics);
        graphics.destroy();
        overlay.destroy();
      };

      overlay.on('pointermove', onMove);
      overlay.on('pointerdown', onClick);
      overlay.on('rightdown',   onRightClick);
      document.addEventListener('keydown', onKeyDown);
      redraw(null);
      const vertNote = isVertical ? ` vertical ${reducedVert}` : '';
      ui.notifications.info(`${type} ${reduced}${vertNote}: click squares to trace path. Right-click to undo. Enter to confirm. Escape to cancel.`);
    });
  }

  const path = finalPath;
  if (!path || (path.length === 0 && !isVertical)) {
    ui.notifications.info('Forced movement cancelled.');
    return;
  }

    if (path.length === 0 && isVertical) {
      const startPos      = { x: targetToken.document.x, y: targetToken.document.y };
      const undoOps       = [];
      const collisionMsgs = [];
      const movedSnap     = snapStamina(targetToken.actor);
      let finalElev       = startElev;
      let blocked         = false;

      const steps = reduced > 0 ? reduced : Math.abs(reducedVert);
      const dir   = reducedVert >= 0 ? 1 : -1;

      for (let i = 0; i < steps; i++) {
        const stepElev  = startElev + dir * (reduced > 0 ? Math.round(Math.abs(reducedVert) * (i + 1) / steps) : (i + 1));
        const remaining = (reduced > 0 ? reduced : Math.abs(reducedVert)) - i;
        const vTile     = getWallBlockTileAt(startGrid.x, startGrid.y);

        if (vTile && !hasTags(vTile, 'broken')) {
          const blockTag   = getTags(vTile).find(t => t.startsWith('wall-block-'));
          const walls      = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
          const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
          const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? Infinity;
          if (stepElev >= tileBottom && stepElev < tileTop) {
            const dmg = 2 + remaining + bonusObjectDmg;
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is blocked by a wall and takes <strong>${dmg} damage</strong>.`);
            if (dir === -1) {
              const ffd = Math.abs(reducedVert);
              if (!noFallDamage && ffd >= 2) {
                const fallDmg = Math.min(ffd * 2, getSetting('fallDamageCap'));
                await applyDamage(targetToken.actor, fallDmg);
                collisionMsgs.push(`${targetToken.name} also takes <strong>${fallDmg} damage</strong> from being slammed into the surface (Agility treated as 0), landing prone.`);
                await safeToggleStatusEffect(targetToken.actor, 'prone', { active: true });
                undoOps.push({ op: 'status', uuid: targetToken.actor.uuid, effectId: 'prone', active: false });
              } else if (!noFallDamage && ffd === 1) {
                collisionMsgs.push(`${targetToken.name} is slammed 1 square downward into the surface. Less than 2 squares, no fall damage.`);
              }
            }
            blocked = true;
            break;
          }
        }

        const blocker = tokenAt(startGrid.x, startGrid.y, targetToken.id);
        if (blocker && (blocker.document.elevation ?? 0) === stepElev) {
          
          undoOps.push({ op: 'update', uuid: blocker.document.uuid, data: { x: blocker.document.x, y: blocker.document.y, elevation: blocker.document.elevation ?? 0 }, options: { animate: false, teleport: true } });
          if (!noCollisionDamage) await applyDamage(targetToken.actor, remaining + bonusCreatureDmg);
          if (!noCollisionDamage) await applyDamage(blocker.actor, remaining + bonusCreatureDmg);
          collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} hits ${blocker.name}. Both take <strong>${remaining + bonusCreatureDmg} damage</strong>.`);
          blocked = true;
          break;
        }

        finalElev = stepElev;
      }

      await safeUpdate(targetToken.document, { elevation: finalElev });
      const vertTargetElev = !blocked
        ? (dir === -1
          ? await applyForcedFallDamage(targetToken, Math.abs(reducedVert), finalElev, startGrid, undoOps, collisionMsgs, noFallDamage)
          : await applyFallDamage(targetToken, finalElev, startGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, noFallDamage))
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
      const fullUndoLog = buildUndoLog(targetToken, startPos, startElev, movedSnap, undoOps);

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
        finalPos:      { x: startPos.x, y: startPos.y, elevation: vertTargetElev },
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

    // Tracks total damage dealt to the moving token across all collision events this move.
    let totalTargetDmg = 0;
    const dmgTarget = async (dmg) => {
      if (!noCollisionDamage && dmg > 0) { await applyDamage(targetToken.actor, dmg); totalTargetDmg += dmg; }
    };

    // Returns true if the mover would die from this collision hit and movement should stop.
    // For minions, live HP is tracked in squadGroup.system.staminaValue, NOT actor.system.stamina.value,
    // so we can't rely on post-damage stamina.value to detect death. Instead we compare the hit
    // directly to actor.system.stamina.max (confirmed as per-minion HP by the death-tracker).
    // For regular tokens we additionally fall back to stamina.value <= 0 for partially-wounded actors.
    const moverWouldStop = (dmg) => {
      if (noCollisionDamage) return false;
      const indivMax = targetToken.actor.system.stamina.max ?? Infinity;
      if (dmg >= indivMax) return true;
      return targetToken.actor.system.stamina.value <= 0;
    };

    // Signal to the death-tracker that FM animation is in progress so that any
    // breakpoint UI triggered by collision damage is deferred until the token
    // has finished moving and is at its final position.
    window._dsctFMActive = true;

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

      const stepElev  = isVertical && reduced > 0
        ? startElev + Math.round(reducedVert * (i + 1) / reduced)
        : startElev;

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
            collisionMsgs.push(`${targetToken.name} is blocked by a wall at elevation ${stepElev} and takes <strong>${dmg} damage</strong>.`);
            break;
          }
        }
      }

      // -- Size 2+ full-footprint collision -------------------------------------
      if (isLargeToken) {
        const dx        = step.x - prev.x;
        const dy        = step.y - prev.y;
        const prevCells = footprintCells(prev.x, prev.y, tokenSize);
        const stepCells = footprintCells(step.x, step.y, tokenSize);
        const newCells  = newlyEnteredCells(prevCells, stepCells);

        // Wall collision: check every leading edge of the footprint
        const hitWalls = wallsAtStep(newCells, dx, dy, stepElev);
        if (hitWalls.length > 0) {
          // Any wall without 'obstacle' tag, or non-breakable obstacle, stops movement outright
          const hardWalls = hitWalls.filter(w => !hasTags(w, 'obstacle') || !hasTags(w, 'breakable'));
          if (hardWalls.length > 0) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token hit indestructible wall at step ${i}. dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} hits a wall and takes <strong>${dmg} damage</strong>.`);
            break;
          }
          // All walls are breakable.
          // Forced movement is applied to every wall simultaneously; cost = max of all costs,
          // not the sum (RAW: the momentum check is against each wall independently).
          const softWalls  = hitWalls;
          const maxCost    = softWalls.reduce((m, w) => Math.max(m, MATERIAL_RULES()[getMaterial(w)]?.cost ?? 99), 0);
          const maxWallDmg = softWalls.reduce((m, w) => Math.max(m, MATERIAL_RULES()[getMaterial(w)]?.damage ?? 0), 0);
          const wallDesc = (walls) => {
            const counts = {};
            for (const w of walls) { const m = getMaterial(w); counts[m] = (counts[m] ?? 0) + 1; }
            return Object.entries(counts).map(([m, n]) => n > 1 ? `${n} ${m} walls` : `a ${m} wall`).join(' and ');
          };
          if (remaining >= maxCost) {
            // Break ALL walls; one momentum check covers all of them
            for (const wall of softWalls) await doBreakObstacleWall(wall, stepElev, undoOps, collisionMsgs, step);
            const wallDmg = maxWallDmg + bonusObjectDmg;
            collisionMsgs.push(`${targetToken.name} smashes through ${wallDesc(softWalls)} (costs ${maxCost}, deals <strong>${wallDmg} damage</strong>).`);
            await dmgTarget(wallDmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token broke ${softWalls.length} wall(s). maxCost=${maxCost}, maxDmg=${maxWallDmg}`);
            if (moverWouldStop(wallDmg)) { collisionMsgs.push(`${targetToken.name} is killed by the impact; movement stops.`); landingIndex = i; break; }
            costConsumed += maxCost - 1;
            continue;
          } else {
            // Cannot break the hardest wall; break any affordable ones (they're demolished regardless), then stop
            const brokenWalls = softWalls.filter(w => remaining >= (MATERIAL_RULES()[getMaterial(w)]?.cost ?? 99));
            for (const wall of brokenWalls) await doBreakObstacleWall(wall, stepElev, undoOps, collisionMsgs, step);
            if (brokenWalls.length > 0) collisionMsgs.push(`${targetToken.name} smashes through ${wallDesc(brokenWalls)}.`);
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token stopped (maxCost=${maxCost} > remaining=${remaining}). dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} is stopped by a wall it cannot break through (needs ${maxCost}, has ${remaining}). Takes <strong>${dmg} damage</strong>.`);
            break;
          }
        }

        // Token collision: check the full destination footprint
        const blockers         = tokensAtCells(stepCells, targetToken.id);
        const objectBlockers   = blockers.filter(b => b.actor?.type === 'object');
        const creatureBlockers = blockers.filter(b => b.actor?.type !== 'object');

        // Object token collision: like breakable tiles; cost = max current stamina across all objects
        if (objectBlockers.length > 0) {
          const maxObjCost = objectBlockers.reduce((m, b) => Math.max(m, b.actor?.system?.stamina?.value ?? 0), 0);
          const dealDmg    = remaining + bonusObjectDmg;
          if (dealDmg >= maxObjCost) {
            // All objects destroyed; movement continues (fall through to creature check)
            for (const obj of objectBlockers) {
              const objPrev = noCollisionDamage ? null : await applyDamage(obj.actor, dealDmg);
              if (objPrev) undoOps.push({ op: 'stamina', uuid: obj.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
            }
            const moverDmg = maxObjCost + 2;
            const objNames = objectBlockers.map(o => o.name).join(', ');
            collisionMsgs.push(`${targetToken.name} smashes through ${objNames} (max ${maxObjCost} stamina). Takes <strong>${moverDmg} damage</strong>.`);
            await dmgTarget(moverDmg);
            for (const obj of objectBlockers) await destroyObjectToken(obj, undoOps);
            costConsumed += Math.max(0, maxObjCost - 1);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token smashed through ${objectBlockers.length} object(s). maxObjCost=${maxObjCost}`);
            if (moverWouldStop(moverDmg)) { collisionMsgs.push(`${targetToken.name} is killed by the impact; movement stops.`); landingIndex = i; break; }
            // Fall through: check creature blockers below
          } else {
            // Cannot destroy the hardest object; break affordable ones and stop
            const brokenObjects = objectBlockers.filter(o => dealDmg >= (o.actor?.system?.stamina?.value ?? 0));
            const survivingObjects = objectBlockers.filter(o => !brokenObjects.includes(o));
            for (const obj of brokenObjects) {
              const objPrev = noCollisionDamage ? null : await applyDamage(obj.actor, dealDmg);
              if (objPrev) undoOps.push({ op: 'stamina', uuid: obj.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
              await destroyObjectToken(obj, undoOps);
            }
            for (const obj of survivingObjects) {
              const objPrev = noCollisionDamage ? null : await applyDamage(obj.actor, dealDmg);
              if (objPrev) undoOps.push({ op: 'stamina', uuid: obj.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
            }
            landingIndex = i - 1;
            const stopDmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(stopDmg);
            collisionMsgs.push(`${targetToken.name} is stopped by ${survivingObjects.map(o => o.name).join(', ')} (needs ${maxObjCost} stamina, has ${remaining}). Takes <strong>${stopDmg} damage</strong>.`);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token stopped by object(s) (maxObjCost=${maxObjCost} > remaining=${remaining}).`);
            break;
          }
        }

        if (creatureBlockers.length > 0) {
          landingIndex = i - 1;
          const dmg             = remaining + bonusCreatureDmg;
          const movedSquadGroup = getSquadGroup(targetToken.actor);
          // Mover takes damage once regardless of how many creatures are hit (RAW)
          await dmgTarget(dmg);
          // Track squad groups already snapshotted so that only the FIRST blocker in a
          // shared squad records the pre-damage squad HP. Subsequent blockers in the same
          // squad must use prevSquadHP=null, otherwise each undo op overwrites the restored
          // value with a stale intermediate snapshot.
          const squadGroupsSnapshotted = new Set();
          for (const blocker of creatureBlockers) {
            undoOps.push({ op: 'update', uuid: blocker.document.uuid, data: { x: blocker.document.x, y: blocker.document.y, elevation: blocker.document.elevation ?? 0 }, options: { animate: false, teleport: true } });
            const blockerSquadGroup = getSquadGroup(blocker.actor);
            const sharedGroup = movedSquadGroup && blockerSquadGroup && movedSquadGroup.id === blockerSquadGroup.id ? movedSquadGroup : null;
            const prevSharedHP = sharedGroup?.system?.staminaValue ?? null;
            const blockerPrev = noCollisionDamage ? null : await applyDamage(blocker.actor, dmg, sharedGroup ? null : blockerSquadGroup);
            if (blockerPrev && sharedGroup && prevSharedHP !== null) {
              const sharedMembers = Array.from(sharedGroup.members || []).filter(m => m);
              blockerPrev.squadGroup        = sharedGroup;
              blockerPrev.squadCombatantIds = sharedMembers.map(m => m.id);
              blockerPrev.squadTokenIds     = sharedMembers.map(m => m.tokenId).filter(Boolean);
              // Only the first blocker from this squad gets the HP snapshot; later ones get null.
              if (!squadGroupsSnapshotted.has(sharedGroup.id)) {
                squadGroupsSnapshotted.add(sharedGroup.id);
                blockerPrev.prevSquadHP = prevSharedHP;
              } else {
                blockerPrev.prevSquadHP = null;
              }
            } else if (blockerPrev && blockerPrev.squadGroup) {
              // No sharedGroup (blocker's squad doesn't match mover's squad), but blocker
              // itself may be in a squad. Same dedup applies if two blockers share a squad.
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
          collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} crashes into ${blockerNames} with ${remaining} square${remaining !== 1 ? 's' : ''} remaining. All take <strong>${dmg} damage</strong>${bonusNote}.`);
          break;
        }

        // Tile collision: check all obstacle tiles in the destination footprint
        const hitTiles = tilesAtCells(stepCells).filter(tile => {
          if (!hasTags(tile, 'obstacle') || hasTags(tile, 'broken')) return false;
          if (isVertical) {
            const bt  = getTags(tile).find(t => t.startsWith('wall-block-'));
            const tws = bt ? getByTag(bt).filter(o => Array.isArray(o.c)) : [];
            const tBottom = tws[0]?.flags?.['wall-height']?.bottom ?? 0;
            const tTop    = tws[0]?.flags?.['wall-height']?.top    ?? Infinity;
            if (stepElev >= tTop || stepElev < tBottom) return false;
          }
          return true;
        });
        if (hitTiles.length > 0) {
          const tileDesc = (tiles) => {
            const counts = {};
            for (const t of tiles) { const m = getMaterial(t); counts[m] = (counts[m] ?? 0) + 1; }
            return Object.entries(counts).map(([m, n]) => n > 1 ? `${n} ${m} objects` : `a ${m} object`).join(' and ');
          };
          const hardTiles = hitTiles.filter(t => !hasTags(t, 'breakable'));
          if (hardTiles.length > 0) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            collisionMsgs.push(`${targetToken.name} is stopped by an obstacle and takes <strong>${dmg} damage</strong>.`);
            break;
          }
          // Same parallel-cost logic as walls: cost = max, not sum
          const softTiles   = hitTiles;
          const maxTileCost = softTiles.reduce((m, t) => Math.max(m, MATERIAL_RULES()[getMaterial(t)]?.cost ?? 99), 0);
          const maxTileDmg  = softTiles.reduce((m, t) => Math.max(m, MATERIAL_RULES()[getMaterial(t)]?.damage ?? 0), 0);
          const breakTile = async (tile) => {
            const origMat  = getMaterial(tile);
            const prevAlpha = tile.document.alpha ?? getMaterialAlpha(origMat);
            const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
            if (blockTag) {
              const walls        = getByTag(blockTag).filter(o => Array.isArray(o.c));
              const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
              for (const wall of walls) {
                await safeUpdate(wall, { move: 0, sight: 0, light: 0, sound: 0 });
                if (game.user.isGM) await addTags(wall, ['broken']);
              }
              const ltBrokenAlpha = (hasTags(tile, 'invisible') && getSetting('keepInvisibleWhenBroken')) ? 0 : 0.8;
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
          if (remaining >= maxTileCost) {
            for (const tile of softTiles) await breakTile(tile);
            const tileDmg = maxTileDmg + bonusObjectDmg;
            collisionMsgs.push(`${targetToken.name} smashes through ${tileDesc(softTiles)} (costs ${maxTileCost}, deals <strong>${tileDmg} damage</strong>).`);
            await dmgTarget(tileDmg);
            if (moverWouldStop(tileDmg)) { collisionMsgs.push(`${targetToken.name} is killed by the impact; movement stops.`); landingIndex = i; break; }
            costConsumed += maxTileCost - 1;
            continue;
          } else {
            // Break affordable tiles, stop at the hardest
            const brokenTiles = softTiles.filter(t => remaining >= (MATERIAL_RULES()[getMaterial(t)]?.cost ?? 99));
            for (const tile of brokenTiles) await breakTile(tile);
            if (brokenTiles.length > 0) collisionMsgs.push(`${targetToken.name} smashes through ${tileDesc(brokenTiles)}.`);
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            collisionMsgs.push(`${targetToken.name} is stopped by an obstacle (needs ${maxTileCost}, has ${remaining}). Takes <strong>${dmg} damage</strong>.`);
            break;
          }
        }

        continue; // no collision; skip the single-cell checks below
      }

      let wall = wallBetween(prev, step);
      // corner-cut blocking - enforced at path-gen time, but re-checked here for externally supplied paths.
      // when both orthogonal boundaries are walled (double corner) we pick the nastier wall and let the
      // normal collision handler below deal damage; a single-wall corner just stops movement cleanly.
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
          // double corner - pick the most dangerous wall and collide with it regardless of mode
          wall = (hasTags(wVert, 'obstacle') && !hasTags(wVert, 'breakable'))   ? wVert
               : (hasTags(wHoriz, 'obstacle') && !hasTags(wHoriz, 'breakable')) ? wHoriz
               : hasTags(wVert, 'obstacle') ? wVert : wHoriz;
          if (getSetting('debugMode')) console.log(`DSCT | FM | Double corner collision at step ${i}: (${prev.x},${prev.y})?(${step.x},${step.y})`);
        } else if (wVert || wHoriz) {
          const cornerWall = wVert ?? wHoriz;
          if (getSetting('cornerCutMode') === 'collide') {
            // single corner cut in collide mode - treat it as a collision with that wall
            wall = cornerWall;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Single corner collision at step ${i}: (${prev.x},${prev.y})?(${step.x},${step.y})`);
          } else {
            // block mode - movement stops cleanly with no damage
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
          
          
          if (!hasTags(wall, 'obstacle')) {
            landingIndex = i - 1;
            const dmg = 2 + remaining + bonusObjectDmg;
            await dmgTarget(dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Hit indestructible wall (no 'obstacle' tag) at step ${i}. dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} hits a wall and takes <strong>${dmg} damage</strong>.`);
            break;
          }

          if (hasTags(wall, 'obstacle')) {
            // Split converted long-span walls at this square before any further processing,
            // so blockTag and allWalls correctly reference only the inside segment.
            if (hasTags(wall, 'wall-converted')) {
              wall = await splitConvertedWall(wall, step.x, step.y, undoOps);
            }

            const blockTag = getTags(wall).find(t => t.startsWith('wall-block-'));
            const isBreakable = hasTags(wall, 'breakable');

            if (!isBreakable) {
              landingIndex = i - 1;
              const dmg = 2 + remaining + bonusObjectDmg;
              await dmgTarget(dmg);
              if (getSetting('debugMode')) console.log(`DSCT | FM | Stopped by non-breakable obstacle wall at step ${i}. dmg=${dmg}`);
              collisionMsgs.push(`${targetToken.name} hits a wall and takes <strong>${dmg} damage</strong>.`);
              break;
            }

            const mat  = getMaterial(wall);
            const rule = MATERIAL_RULES()[mat];
            const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
            await dmgTarget(dmg);

            if (remaining >= rule.cost) {
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
                    const swBrokenAlpha = (hasTags(tile, 'invisible') && getSetting('keepInvisibleWhenBroken')) ? 0 : 0.8;
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
              collisionMsgs.push(`${targetToken.name} smashes through ${mat} (costs ${rule.cost}, deals ${rule.damage} damage).`);
              costConsumed += rule.cost - 1;
              if (getSetting('debugMode')) console.log(`DSCT | FM | Broke wall (${mat}) at step ${i}. cost=${rule.cost}, costConsumed now=${costConsumed}, remaining after break=${remaining - rule.cost}`);
              if (moverWouldStop(dmg)) { collisionMsgs.push(`${targetToken.name} is killed by the impact; movement stops.`); landingIndex = i; break; }
              continue;
            }

            landingIndex = i - 1;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Blocked by ${mat} wall at step ${i} (needs ${rule.cost}, has ${remaining}). Landing at step ${i - 1}.`);
            collisionMsgs.push(`${targetToken.name} hits ${mat} but lacks the momentum to break through (needs ${rule.cost}, has ${remaining}). Takes <strong>${dmg} damage</strong>.`);
            break;
          }
        }
      }

      const blocker = tokenAt(step.x, step.y, targetToken.id);
      if (blocker) {
        // Object tokens behave like breakable obstacles: cost = current stamina, deal (cost+2) to mover
        if (blocker.actor?.type === 'object') {
          const objectHP  = blocker.actor?.system?.stamina?.value ?? 0;
          const dealDmg   = remaining + bonusObjectDmg;
          const objBreaks = dealDmg >= objectHP;
          const moverDmg  = Math.min(dealDmg, objectHP) + 2;

          const objPrev = noCollisionDamage ? null : await applyDamage(blocker.actor, dealDmg);
          if (objPrev) undoOps.push({ op: 'stamina', uuid: blocker.actor.uuid, prevValue: objPrev.prevValue, prevTemp: objPrev.prevTemp, squadGroupUuid: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] });
          await dmgTarget(moverDmg);

          if (objBreaks) {
            collisionMsgs.push(`${targetToken.name} smashes through ${blocker.name} (${objectHP} stamina). Takes <strong>${moverDmg} damage</strong>.`);
            await destroyObjectToken(blocker, undoOps);
            costConsumed += Math.max(0, objectHP - 1);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Object ${blocker.name} destroyed (HP=${objectHP}, remaining=${remaining}). Movement continues.`);
            if (moverWouldStop(moverDmg)) { collisionMsgs.push(`${targetToken.name} is killed by the impact; movement stops.`); landingIndex = i; break; }
            continue;
          } else {
            landingIndex = i - 1;
            collisionMsgs.push(`${targetToken.name} crashes into ${blocker.name} but cannot destroy it (needs ${objectHP} stamina, has ${remaining}). Takes <strong>${moverDmg} damage</strong>, ${blocker.name} takes <strong>${dealDmg} damage</strong>.`);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Object ${blocker.name} survived (HP=${objectHP}, remaining=${remaining}). Stopped.`);
            break;
          }
        }

        landingIndex = i - 1;

        undoOps.push({ op: 'update', uuid: blocker.document.uuid, data: { x: blocker.document.x, y: blocker.document.y, elevation: blocker.document.elevation ?? 0 }, options: { animate: false, teleport: true } });
        const movedSquadGroup   = getSquadGroup(targetToken.actor);
        const blockerSquadGroup = getSquadGroup(blocker.actor);
        const sharedGroup       = movedSquadGroup && blockerSquadGroup &&
          movedSquadGroup.id === blockerSquadGroup.id ? movedSquadGroup : null;
        const prevSharedHP      = sharedGroup?.system?.staminaValue ?? null;

        await dmgTarget(remaining + bonusCreatureDmg);
        const blockerPrev = noCollisionDamage ? null : await applyDamage(blocker.actor, remaining + bonusCreatureDmg, sharedGroup ? null : blockerSquadGroup);

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
        collisionMsgs.push(`<strong>Collision!</strong> ${targetToken.name} crashes into ${blocker.name} with ${remaining} square${remaining !== 1 ? 's' : ''} remaining. Both take <strong>${dmgTotal} damage</strong>${bonusNote}.`);
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
            collisionMsgs.push(`${targetToken.name} is stopped by an obstacle and takes <strong>${dmg} damage</strong>.`);
            break;
          }

          const mat  = getMaterial(tile);
          const rule = MATERIAL_RULES()[mat];
          const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
          await dmgTarget(dmg);

          if (remaining >= rule.cost) {
            if (blockTag) {
              // Split any converted multi-span walls at this square before marking broken,
              // so only the inside segment is destroyed and the outside segments are preserved.
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
              const stBrokenAlpha = (hasTags(tile, 'invisible') && getSetting('keepInvisibleWhenBroken')) ? 0 : 0.8;
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
            collisionMsgs.push(`${targetToken.name} smashes through ${mat} (costs ${rule.cost}, deals ${rule.damage} damage).`);
            costConsumed += rule.cost - 1;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Broke tile (${mat}) at step ${i}. cost=${rule.cost}, costConsumed now=${costConsumed}, remaining after break=${remaining - rule.cost}`);
            if (moverWouldStop(dmg)) { collisionMsgs.push(`${targetToken.name} is killed by the impact; movement stops.`); landingIndex = i; break; }
            continue;
          }

          landingIndex = i - 1;
          if (getSetting('debugMode')) console.log(`DSCT | FM | Blocked by ${mat} tile at step ${i} (needs ${rule.cost}, has ${remaining}). Landing at step ${i - 1}.`);
          collisionMsgs.push(`${targetToken.name} hits ${mat} but lacks the momentum to break through (needs ${rule.cost}, has ${remaining}). Takes <strong>${dmg} damage</strong>.`);
          break;
        }
      }
    }
    if (getSetting('debugMode')) console.log(`DSCT | FM | Path loop done. landingIndex=${landingIndex}, path.length=${path.length}, costConsumed=${costConsumed}`);

    const landingGrid      = landingIndex >= 0 ? path[landingIndex] : startGrid;
    const landingStepIndex = landingIndex >= 0 ? landingIndex : -1;

    const stepsToAnimate = landingIndex >= 0 ? path.slice(0, landingIndex + 1) : [];

    // If the target is a grabber, suppress grab-follow so the grabbed creature stays in place.
    const grabberGrabs = [...(window._activeGrabs?.entries() ?? [])].filter(([, g]) => g.grabberTokenId === targetToken.id);
    if (grabberGrabs.length > 0) {
      window._grabFMSuppressed ??= new Set();
      window._grabFMSuppressed.add(targetToken.id);
    }

    // Suspend the frightened movement restriction for the duration of the animation;
    // forced movement is involuntary repositioning, not voluntary approach.
    window._dsctFMBypassFrightened ??= new Set();
    window._dsctFMBypassFrightened.add(targetToken.id);
    try {
      for (let s = 0; s < stepsToAnimate.length; s++) {
        const stepGrid  = stepsToAnimate[s];
        const stepWorld = toWorld(stepGrid);
        const stepElev  = isVertical && reduced > 0
          ? startElev + Math.round(reducedVert * (s + 1) / reduced)
          : startElev;

        if (isVertical && stepElev !== (targetToken.document.elevation ?? 0)) {
          await safeUpdate(targetToken.document, { elevation: stepElev });
        }
        await safeUpdate(targetToken.document, { x: stepWorld.x, y: stepWorld.y });
        await new Promise(r => setTimeout(r, getSetting('animationStepDelay')));
      }
    } finally {
      window._dsctFMBypassFrightened.delete(targetToken.id);
    }
    const finalElev = isVertical && reduced > 0
      ? startElev + Math.round(reducedVert * (landingStepIndex + 1) / reduced)
      : startElev;
    
    
    const targetElev = await applyFallDamage(targetToken, finalElev, landingGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, noFallDamage);
    if (getSetting('debugMode')) console.log(`DSCT | FM | finalElev=${finalElev}, targetElev=${targetElev} (after fall)`);

    
    
    const landingWorld = stepsToAnimate.length > 0 ? toWorld(landingGrid) : startPos;

    
    
    {
      // canvas.scene.tokens doesn't reflect a position update immediately after safeUpdate.
      // if we write the undo log before the new position is readable we capture the old coords
      // and the undo button sends the token back to where it already was. very confusing.
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

    // Token is now at its final position; allow deferred breakpoint UIs to open.
    window._dsctFMActive = false;

    // Resolve grabs where this token is the grabber: end or reposition based on adjacency.
    const grabsEnded = [];
    if (grabberGrabs.length > 0) {
      window._grabFMSuppressed?.delete(targetToken.id);
      const grabberGrid = toGrid(targetToken.document);
      const grabberSize = targetToken.actor?.system?.combat?.size?.value ?? 1;
      for (const [grabbedId, grab] of grabberGrabs) {
        if (!window._activeGrabs?.has(grabbedId)) continue; // already ended during move
        const grabbedTok = getTokenById(grabbedId);
        if (!grabbedTok) { await endGrab(grabbedId, { silent: true }); continue; }
        const grabbedGrid = toGrid(grabbedTok.document);
        // grid distance (diagonals = 1) from the grabbed token to the nearest cell of the grabber
        const nearX = Math.max(grabberGrid.x, Math.min(grabbedGrid.x, grabberGrid.x + grabberSize - 1));
        const nearY = Math.max(grabberGrid.y, Math.min(grabbedGrid.y, grabberGrid.y + grabberSize - 1));
        const dist  = Math.max(Math.abs(grabbedGrid.x - nearX), Math.abs(grabbedGrid.y - nearY));
        if (dist <= 1) {
          // Still adjacent - update offset to new relative position.
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
    const fullUndoLog = buildUndoLog(targetToken, startPos, startElevSnap, movedSnap, undoOps);

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
    if (suppressMessage) return mainResultData;
    await ChatMessage.create({
      content: mainResultData.content,
      flags: { 'draw-steel-combat-tools': { isFmUndo: true, isUndone: false, ...mainResultData } }
    });
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
  ui.notifications.info('Click a highlighted target to resolve their forced movement. Escape to cancel.');
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
      const sign = type === 'Pull' ? -1 : 1;
      verticalHeight = Math.abs(parseInt(verticalRaw) || 0) * sign;
    }
    if (!type)           { ui.notifications.warn('Invalid type. Use Push, Pull, or Slide.'); return; }
    if (isNaN(distance)) { ui.notifications.warn('Invalid distance.'); return; }

    const { target, source } = getTargetAndSource();
    if (!target) { ui.notifications.warn('Target or select the creature to move.'); return; }

    if (range > 0 && !(game.user.isGM && getSetting('gmBypassesRangeCheck')) && source) {
      const hDist   = canvas.grid.measurePath([
        { x: source.center.x, y: source.center.y },
        { x: target.center.x, y: target.center.y },
      ]).distance;
      const vDist   = Math.abs((source.document.elevation ?? 0) - (target.document.elevation ?? 0));
      const adjDist = Math.max(hDist, vDist * canvas.grid.distance);
      if (adjDist > range * canvas.grid.distance) {
        ui.notifications.warn(`${target.name} is not within range.`);
        return;
      }
    }

    await _runForcedMovement(type, distance, target, source, bonusCreatureDmg, bonusObjectDmg, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, keywords, fastMove);
  } 
  else if (typeof macroArgs === 'object' && !Array.isArray(macroArgs) && Object.keys(macroArgs).length > 0) {
    const { type, distance, sourceId, targetId, verticalHeight, fallReduction, noFallDamage, noCollisionDamage, ignoreStability, fastMove, suppressMessage } = macroArgs;
    const target = getTokenById(targetId);
    const source = sourceId ? getTokenById(sourceId) : null;
    if (!target) { ui.notifications.warn('DSCT | Target token not found on canvas.'); return; }
    return await _runForcedMovement(type, distance, target, source, 0, 0, verticalHeight, fallReduction, noFallDamage, ignoreStability, noCollisionDamage, [], fastMove, suppressMessage);
  } 
  else {
    toggleForcedMovementPanel();
  }
}