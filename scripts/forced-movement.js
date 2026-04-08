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
} from './helpers.js';
import { endGrab, applyGrab } from './grab.js';


// Draw Steel rule: you can't move diagonally through the corner of a wall.
// a diagonal is blocked if there's an active wall on EITHER orthogonal boundary,
// not just when both sides are walled (that was the old "double corner" collision logic).
const cornerCutsWall = (from, to, elev = 0) => {
  if (from.x === to.x || from.y === to.y) return false; // not diagonal
  const cA = { x: to.x,   y: from.y }; // horizontal corner cell
  const cB = { x: from.x, y: to.y   }; // vertical corner cell
  const active = (w) => {
    if (!w || hasTags(w, 'broken')) return false;
    const wb = w.flags?.['wall-height']?.bottom ?? 0;
    const wt = w.flags?.['wall-height']?.top    ?? Infinity;
    return !(elev >= wt || elev < wb);
  };
  // check both ends of each boundary axis - walls on the destination side won't cross the center ray
  const hasVert  = active(wallBetween(from, cA)) || active(wallBetween(to, cA));
  const hasHoriz = active(wallBetween(from, cB)) || active(wallBetween(to, cB));
  return hasVert || hasHoriz;
};

const parseType = (raw) => {
  const t = (raw ?? '').toLowerCase();
  if (t === 'push')  return 'Push';
  if (t === 'pull')  return 'Pull';
  if (t === 'slide') return 'Slide';
  return null;
};

const embeddedUuid = (parent, type, doc) =>
  doc?.uuid ?? `${parent.uuid}.${type}.${doc?._id ?? doc?.id}`;

const chooseFreeSquare = (targetToken) => new Promise((resolve) => {
  const GRID = getGRID();
  const size = targetToken.actor?.system?.combat?.size?.value ?? 1;
  const tg   = toGrid(targetToken.document);

  const getAdjacentRing = (radius) => {
    const squares = [];
    const minX = tg.x - radius, maxX = tg.x + size - 1 + radius;
    const minY = tg.y - radius, maxY = tg.y + size - 1 + radius;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (x !== minX && x !== maxX && y !== minY && y !== maxY) continue;
        if (x >= tg.x && x < tg.x + size && y >= tg.y && y < tg.y + size) continue;
        squares.push({ x, y });
      }
    }
    return squares;
  };

  const isSquareFree = (gx, gy) => {
    if (tokenAt(gx, gy, targetToken.id)) return false;
    const t = tileAt(gx, gy);
    if (t && hasTags(t, 'obstacle') && !hasTags(t, 'broken')) return false;
    return true;
  };

  let candidates = [];
  for (let r = 1; r <= 10 && candidates.length === 0; r++) {
    candidates = getAdjacentRing(r).filter(g => isSquareFree(g.x, g.y));
  }

  if (candidates.length === 0) { resolve(null); return; }

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const redraw = (hoverGrid) => {
    graphics.clear();
    for (const g of candidates) {
      const isHover = hoverGrid && g.x === hoverGrid.x && g.y === hoverGrid.y;
      graphics.beginFill(0x44cc44, isHover ? 0.6 : 0.3);
      graphics.drawRect(g.x * GRID, g.y * GRID, GRID, GRID);
      graphics.endFill();
    }
  };

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);
  let hoverGrid = null;

  const onMove = (e) => {
    const pos  = e.data.getLocalPosition(canvas.app.stage);
    const gpos = toGrid(pos);
    hoverGrid  = candidates.find(g => g.x === gpos.x && g.y === gpos.y) ?? null;
    redraw(hoverGrid);
  };

  const onClick = (e) => {
    const pos    = e.data.getLocalPosition(canvas.app.stage);
    const gpos   = toGrid(pos);
    const chosen = candidates.find(g => g.x === gpos.x && g.y === gpos.y);
    if (!chosen) return;
    cleanup();
    resolve(chosen);
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
  ui.notifications.info(`Choose where ${targetToken.name} lands. Escape to skip.`);
});

const breakTileFromTop = async (tile, fallDmg, undoOps, collisionMsgs, targetToken) => {
  const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
  if (!blockTag) return null;
  const mat   = getMaterial(tile);
  const walls = getByTag(blockTag).filter(o => Array.isArray(o.c));
  const tileBottom    = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
  const tileTop       = walls[0]?.flags?.['wall-height']?.top    ?? 1;
  const tileHeight    = tileTop - tileBottom;
  const costPerSquare = MATERIAL_RULES()[mat]?.cost ?? 3;
  const squaresBroken = Math.min(Math.floor(fallDmg / costPerSquare), tileHeight);

  if (squaresBroken === 0) return tileTop - 1;

  const prevDamagedTag = getTags(tile).find(t => t.startsWith('damaged:'));
  const prevDamagedN   = prevDamagedTag ? parseInt(prevDamagedTag.split(':')[1]) : 0;
  const newDamagedN    = prevDamagedN + squaresBroken;

  if (squaresBroken >= tileHeight) {
    for (const w of walls) {
      await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
      if (game.user.isGM) await addTags(w, ['broken']);
    }
    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
    if (game.user.isGM) await addTags(tile, ['broken']);

    const restrict = WALL_RESTRICTIONS()[mat] ?? WALL_RESTRICTIONS().stone;
    for (const w of walls) {
      undoOps.push({ op: 'update', uuid: w.uuid, data: { ...restrict, 'flags.wall-height.top': tileTop, 'flags.wall-height.bottom': tileBottom } });
      undoOps.push({ op: 'removeTags', uuid: w.uuid, tags: ['broken'] });
    }
    undoOps.push({ op: 'update', uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(mat), alpha: getMaterialAlpha(mat) } });
    undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['broken'] });
    if (prevDamagedTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDamagedTag] });

    collisionMsgs.push(`${targetToken.name} crashes through the entire ${mat} object (${tileHeight} square${tileHeight !== 1 ? 's' : ''}).`);
    return tileBottom;
  }

  const newTop = tileTop - squaresBroken;
  for (const w of walls) await safeUpdate(w, { 'flags.wall-height.top': newTop });
  if (game.user.isGM) {
    if (prevDamagedTag) await removeTags(tile, [prevDamagedTag]);
    await addTags(tile, [`damaged:${newDamagedN}`, 'partially-broken']);
  }

  for (const w of walls) {
    undoOps.push({ op: 'update', uuid: w.uuid, data: { 'flags.wall-height.top': tileTop } });
  }
  undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: [`damaged:${newDamagedN}`] });
  if (!prevDamagedTag) undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['partially-broken'] });
  if (prevDamagedTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDamagedTag] });

  collisionMsgs.push(`${targetToken.name} breaks ${squaresBroken} square${squaresBroken !== 1 ? 's' : ''} off the top of the ${mat} object (${tileHeight} tall, now ${newTop - tileBottom} remain).`);
  return newTop - 1;
};

const splitTileAtElevation = async (tile, splitElev, undoOps, collisionMsgs) => {
  const GRID     = getGRID();
  const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
  if (!blockTag) return;
  const origId     = blockTag.replace('wall-block-', '');
  const mat        = getMaterial(tile);
  const walls      = getByTag(blockTag).filter(o => Array.isArray(o.c));
  const tileBottom = walls[0]?.flags?.['wall-height']?.bottom ?? 0;
  const tileTop    = walls[0]?.flags?.['wall-height']?.top    ?? 1;
  const restrict   = WALL_RESTRICTIONS()[mat] ?? WALL_RESTRICTIONS().stone;

  if (splitElev <= tileBottom || splitElev >= tileTop) return;

  const botTag = `wall-block-${origId}-bot`;
  const topTag = `wall-block-${origId}-top`;

  const squaresLost = tileTop - splitElev;
  for (const w of walls) {
    await safeUpdate(w, { 'flags.wall-height.top': splitElev });
    if (game.user.isGM) {
      await removeTags(w, [blockTag]);
      await addTags(w, [botTag, `damaged:${squaresLost}`]);
    }
  }

  if (game.user.isGM) {
    await removeTags(tile, [blockTag]);
    await addTags(tile, [botTag, 'partially-broken']);
  }

  const tg = toGrid(tile.document);
  const edges = [
    [tg.x * GRID, tg.y * GRID,         (tg.x + 1) * GRID, tg.y * GRID],
    [tg.x * GRID, (tg.y + 1) * GRID,   (tg.x + 1) * GRID, (tg.y + 1) * GRID],
    [tg.x * GRID, tg.y * GRID,          tg.x * GRID,       (tg.y + 1) * GRID],
    [(tg.x + 1) * GRID, tg.y * GRID,   (tg.x + 1) * GRID, (tg.y + 1) * GRID],
  ];

  const topTileAllTags = ['obstacle', 'breakable', topTag, mat, 'broken'];
  const createdTiles = await safeCreateEmbedded(canvas.scene, 'Tile', [{
    x: tg.x * GRID, y: tg.y * GRID,
    width: GRID, height: GRID,
    elevation: splitElev,
    texture: { src: MATERIAL_ICONS.broken },
    alpha: 0.8, hidden: false, locked: false,
    occlusion: { mode: 0, alpha: 0 }, restrictions: { light: false, weather: false },
    video: { loop: false, autoplay: false, volume: 0 },
    flags: { tagger: { tags: topTileAllTags } },
  }]);

  const createdWalls = [];
  for (const [x1, y1, x2, y2] of edges) {
    const result = await safeCreateEmbedded(canvas.scene, 'Wall', [{
      c: [x1, y1, x2, y2], move: 0, sight: 0, light: 0, sound: 0,
      dir: 0, door: 0,
      flags: { 'wall-height': { bottom: splitElev, top: tileTop }, tagger: { tags: topTileAllTags } },
    }]);
    if (result?.[0]) createdWalls.push(result[0]);
  }

  collisionMsgs.push(`The ${mat} object splits at elevation ${splitElev}.`);

  const createdTileUuid  = createdTiles?.[0] ? embeddedUuid(canvas.scene, 'Tile', createdTiles[0]) : null;
  const createdWallUuids = createdWalls.map(w => embeddedUuid(canvas.scene, 'Wall', w));

  for (const uuid of createdWallUuids) undoOps.push({ op: 'delete', uuid });
  if (createdTileUuid) undoOps.push({ op: 'delete', uuid: createdTileUuid });
  for (const w of walls) {
    undoOps.push({ op: 'update',     uuid: w.uuid, data: { 'flags.wall-height.top': tileTop, ...restrict } });
    undoOps.push({ op: 'removeTags', uuid: w.uuid, tags: [botTag, `damaged:${squaresLost}`] });
    undoOps.push({ op: 'addTags',    uuid: w.uuid, tags: [blockTag] });
  }
  undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: [botTag, 'partially-broken'] });
  undoOps.push({ op: 'addTags',    uuid: tile.document.uuid, tags: [blockTag] });
};


const applyFallDamage = async (targetToken, finalElev, landingGrid, agility, canFly, undoOps, collisionMsgs, fallReduction = 0, noFallDamage = false) => {
  if (!isNaN(finalElev) && !canFly && finalElev > 0) {
    const GRID = getGRID();
    const tilesBelow = canvas.tiles.placeables
      .filter(t => {
        const tg = toGrid(t.document);
        if (tg.x !== landingGrid.x || tg.y !== landingGrid.y) return false;
        if (!hasTags(t, 'obstacle') || hasTags(t, 'broken')) return false;
        const top = getWallBlockTop(t) ?? 0;
        return (top - 1) < finalElev;
      })
      .sort((a, b) => (getWallBlockTop(b) ?? 0) - (getWallBlockTop(a) ?? 0));

    const topTile        = tilesBelow[0] ?? null;
    const origTopValue   = topTile ? (getWallBlockTop(topTile) ?? 1) : 1;
    const landingSurface = topTile ? (origTopValue - 1) : 0;
    const rawFall        = finalElev - landingSurface;
    const effectiveFall  = Math.max(0, rawFall - Math.max(0, agility) - fallReduction);

    if (noFallDamage) {
      await safeUpdate(targetToken.document, { elevation: landingSurface });
      collisionMsgs.push(`${targetToken.name} falls ${rawFall} square${rawFall !== 1 ? 's' : ''} but takes no damage.`);
      return landingSurface;
    }

    if (effectiveFall >= 2) {
      const fallDmg = Math.min(effectiveFall * 2, getSetting('fallDamageCap'));
      await applyDamage(targetToken.actor, fallDmg);

      const reductionNote = fallReduction > 0
        ? ` (${rawFall} raw, reduced by Agility ${agility} + ${fallReduction})`
        : ` (${effectiveFall} effective after Agility ${agility})`;
      collisionMsgs.push(`${targetToken.name} falls ${rawFall} square${rawFall !== 1 ? 's' : ''}${reductionNote} and takes <strong>${fallDmg} damage</strong>, landing prone.`);

      let actualLanding = landingSurface;
      if (topTile) {
        const newTop = await breakTileFromTop(topTile, fallDmg, undoOps, collisionMsgs, targetToken);
        if (newTop !== null) actualLanding = newTop;
      }

      await safeUpdate(targetToken.document, { elevation: actualLanding });
      await safeToggleStatusEffect(targetToken.actor, 'prone', { active: true });
      undoOps.push({ op: 'status', uuid: targetToken.actor.uuid, effectId: 'prone', active: false });

      const landedOn = tokenAt(landingGrid.x, landingGrid.y, targetToken.id);
      if (landedOn) {
        undoOps.push({ op: 'update', uuid: landedOn.document.uuid, data: { x: landedOn.document.x, y: landedOn.document.y, elevation: landedOn.document.elevation ?? 0 }, options: { animate: false, teleport: true } });
        await applyDamage(landedOn.actor, fallDmg);
        collisionMsgs.push(`${landedOn.name} takes <strong>${fallDmg} damage</strong> from the impact.`);
        const fallerSize   = targetToken.actor?.system?.combat?.size?.value ?? 1;
        const blockerMight = landedOn.actor?.system?.characteristics?.might?.value ?? 0;
        if (fallerSize > blockerMight) {
          await safeToggleStatusEffect(landedOn.actor, 'prone', { active: true });
          undoOps.push({ op: 'status', uuid: landedOn.actor.uuid, effectId: 'prone', active: false });
          collisionMsgs.push(`${landedOn.name} is knocked prone (${targetToken.name}'s size ${fallerSize} exceeds their Might ${blockerMight}).`);
        }
        const chosen = await chooseFreeSquare(targetToken);
        if (chosen) {
          await safeUpdate(targetToken.document, { x: chosen.x * GRID, y: chosen.y * GRID });
          collisionMsgs.push(`${targetToken.name} lands in a nearby free space.`);
        } else {
          collisionMsgs.push(`${targetToken.name} could not find a free space to land.`);
        }
      }
      return actualLanding;
    } else if (rawFall > 0) {
      await safeUpdate(targetToken.document, { elevation: landingSurface });
      const reductionNote = fallReduction > 0
        ? ` (${rawFall} raw, reduced by Agility ${agility} + ${fallReduction})`
        : ` (${effectiveFall} effective after Agility ${agility})`;
      collisionMsgs.push(`${targetToken.name} falls ${rawFall} square${rawFall !== 1 ? 's' : ''}${reductionNote}. Less than 2 squares, no damage.`);
      return landingSurface;
    }
  } else if (!isNaN(finalElev) && canFly && finalElev > 0) {
    collisionMsgs.push(`${targetToken.name} is launched into the air (elevation ${finalElev}). No fall damage since they can fly.`);
  }
  return finalElev;
};

const buildUndoLog = (targetToken, startPos, startElevSnap, movedSnap, undoOps) => [
  { op: 'update',  uuid: targetToken.document.uuid, data: { x: startPos.x, y: startPos.y, elevation: startElevSnap }, options: { animate: false, teleport: true } },
  { op: 'stamina', uuid: targetToken.actor.uuid, prevValue: movedSnap.prevValue, prevTemp: movedSnap.prevTemp, squadGroupUuid: movedSnap.squadGroup?.uuid ?? null, prevSquadHP: movedSnap.prevSquadHP, squadCombatantIds: movedSnap.squadCombatantIds, squadTokenIds: movedSnap.squadTokenIds ?? [] },
  ...undoOps,
];

// ── Size 2+ Collision Helpers ─────────────────────────────────────────────────

/** All grid cells occupied by a token of the given size at top-left (gx, gy). */
const footprintCells = (gx, gy, size) => {
  const cells = [];
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++)
      cells.push({ x: gx + dx, y: gy + dy });
  return cells;
};

/** Cells in destCells that are not in srcCells (the cells newly entered on this step). */
const newlyEnteredCells = (srcCells, destCells) => {
  const srcSet = new Set(srcCells.map(c => `${c.x},${c.y}`));
  return destCells.filter(c => !srcSet.has(`${c.x},${c.y}`));
};

/**
 * Find all distinct, active, elevation-relevant walls crossed as the token's footprint
 * enters newCells from direction (dx, dy) at stepElev.
 */
const wallsAtStep = (newCells, dx, dy, stepElev) => {
  const seen   = new Set();
  const result = [];
  for (const cell of newCells) {
    const w = wallBetween({ x: cell.x - dx, y: cell.y - dy }, cell);
    if (!w || seen.has(w.id) || hasTags(w, 'broken')) continue;
    const wb = w.flags?.['wall-height']?.bottom ?? 0;
    const wt = w.flags?.['wall-height']?.top    ?? Infinity;
    if (stepElev >= wt || stepElev < wb) continue;
    seen.add(w.id);
    result.push(w);
  }
  return result;
};

/** Find all tokens (excluding excludeId) whose footprint overlaps any cell in the given set. */
const tokensAtCells = (cells, excludeId) => {
  const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
  const found   = new Map();
  for (const t of canvas.tokens.placeables) {
    if (t.id === excludeId || found.has(t.id)) continue;
    const tg    = toGrid(t.document);
    const tSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
    outer: for (let dy = 0; dy < tSize; dy++) {
      for (let dx = 0; dx < tSize; dx++) {
        if (cellSet.has(`${tg.x + dx},${tg.y + dy}`)) { found.set(t.id, t); break outer; }
      }
    }
  }
  return [...found.values()];
};

/** Find all distinct tiles whose top-left corner is at any of the given cells. */
const tilesAtCells = (cells) => {
  const seen   = new Set();
  const result = [];
  for (const { x, y } of cells) {
    const t = tileAt(x, y);
    if (t && !seen.has(t.id)) { seen.add(t.id); result.push(t); }
  }
  return result;
};

/**
 * Execute the physical breaking of a confirmed-breakable obstacle wall group.
 * Does NOT apply damage or push the "smashes through" message; the caller handles those.
 * Does push intermediate structural messages (mid-height collapse etc.) to collisionMsgs.
 */
const doBreakObstacleWall = async (wall, stepElev, undoOps, collisionMsgs) => {
  const blockTag  = getTags(wall).find(t => t.startsWith('wall-block-'));
  const wallBottom = wall.flags?.['wall-height']?.bottom ?? 0;
  const wallTop    = wall.flags?.['wall-height']?.top    ?? Infinity;
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
      for (const w of allWalls) undoOps.push({ op: 'update', uuid: w.uuid, data: { 'flags.wall-height.top': prevTop } });
      if (tile) {
        undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: [`damaged:${prevDmgN + 1}`] });
        if (prevDmgTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDmgTag] });
      }
      const mat = getMaterial(wall);
      collisionMsgs.push(`The top of the ${mat} object collapses into the gap (now ${wallTop - 1 - wallBottom} square${wallTop - 1 - wallBottom !== 1 ? 's' : ''} tall).`);
    } else {
      const origMat      = tile ? getMaterial(tile) : 'stone';
      const prevWallData = allWalls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
      for (const w of allWalls) {
        await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
        if (game.user.isGM) await addTags(w, ['broken']);
      }
      if (tile) {
        await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
        if (game.user.isGM) await addTags(tile, ['broken']);
        undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: getMaterialAlpha(origMat) } });
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
};

/**
 * Place rubble tiles (one per grid square) where a destroyed object token stood.
 * The death tracker handles the skull tile and token hiding independently.
 * Each rubble tile is flagged so the death tracker's deleteTile hook can cascade cleanup.
 */
const destroyObjectToken = async (objectToken, undoOps) => {
  const GRID   = getGRID();
  const blGrid = toGrid(objectToken.document);
  const blSize = objectToken.actor?.system?.combat?.size?.value ?? objectToken.document.width ?? 1;

  for (let ix = 0; ix < blSize; ix++) {
    for (let iy = 0; iy < blSize; iy++) {
      const created = await safeCreateEmbedded(canvas.scene, 'Tile', [{
        x: (blGrid.x + ix) * GRID, y: (blGrid.y + iy) * GRID,
        width: GRID, height: GRID,
        texture: { src: MATERIAL_ICONS.broken, scaleX: 1, scaleY: 1 },
        alpha: 1, hidden: false, locked: false,
        occlusion: { mode: 0, alpha: 0 },
        restrictions: { light: false, weather: false },
        video: { loop: false, autoplay: false, volume: 0 },
        flags: { 'draw-steel-combat-tools': { isObjectRubble: true, objectTokenId: objectToken.id } },
      }]);
      if (created?.[0]) {
        undoOps.push({ op: 'delete', uuid: embeddedUuid(canvas.scene, 'Tile', created[0]) });
      }
    }
  }

  // Undo: restore the token to its pre-death position and make it visible again.
  // The death tracker will have hidden and teleported it, so we need to reverse that.
  undoOps.push({ op: 'update', uuid: objectToken.document.uuid,
    data: { hidden: false, x: objectToken.document.x, y: objectToken.document.y, elevation: objectToken.document.elevation ?? 0 },
    options: { animate: false, teleport: true } });
};

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

  // Restrained creatures cannot be force moved (GM bypass uses same setting as size check).
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
  // For a size-2 token this is the grid intersection between its 4 cells;
  // for size-3 it is the center of the middle cell. Fractional values are
  // intentional and work correctly with gridDist (Chebyshev, no rounding).
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
                      if (sourceCellSet.has(`${adj.x},${adj.y}`)) continue;
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

    const colorRange   = 0xffff00;
    const colorPath      = 0x4488ff;
    const colorStart     = 0xffaa00;
    const colorValid     = 0x44cc44;
    const colorSuggest   = 0x88ffbb;
    const colorInvalid   = 0xcc4444;
    const colorCollision = 0xff7700; // orange - "you can go here but it'll hurt"

    const computeRangeHighlight = () => {
      const reachable = new Set();
      const key = g => `${g.x},${g.y}`;
      const visited = new Map();
      visited.set(key(startGrid), 0);
      const queue = [{ pos: startGrid, steps: 0 }];
      while (queue.length) {
        const { pos, steps } = queue.shift();
        if (steps >= reduced) continue;
        const neighbors = [
          { x: pos.x - 1, y: pos.y - 1 }, { x: pos.x, y: pos.y - 1 }, { x: pos.x + 1, y: pos.y - 1 },
          { x: pos.x - 1, y: pos.y },                                    { x: pos.x + 1, y: pos.y },
          { x: pos.x - 1, y: pos.y + 1 }, { x: pos.x, y: pos.y + 1 }, { x: pos.x + 1, y: pos.y + 1 },
        ];
        for (const nb of neighbors) {
          if (gridEq(nb, startGrid)) continue;
          if (sourceCellSet.has(key(nb))) continue;
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
      // cells blocked by a wall (orthogonally adjacent to reachable) - still selectable, will trigger collision
      const wallReachable = new Set();
      for (const k of reachable) {
        const [rx, ry] = k.split(',').map(Number);
        const pos = { x: rx, y: ry };
        for (const nb of [
          { x: pos.x - 1, y: pos.y }, { x: pos.x + 1, y: pos.y },
          { x: pos.x, y: pos.y - 1 }, { x: pos.x, y: pos.y + 1 },
        ]) {
          const nk = key(nb);
          if (!reachable.has(nk) && !gridEq(nb, startGrid) && !sourceCellSet.has(nk)) {
            if (type === 'Push' && sourceGrid && gridDist(ctr(nb), sourceGrid) <= gridDist(ctr(pos), sourceGrid)) continue;
            if (type === 'Pull' && sourceGrid && gridDist(ctr(nb), sourceGrid) >= gridDist(ctr(pos), sourceGrid)) continue;
            wallReachable.add(nk);
          }
        }
      }
      return { reachable, wallReachable };
    };
    const { reachable: rangeHighlight, wallReachable } = computeRangeHighlight();

    const isValidStep = (from, to) => {
      if (gridDist(from, to) !== 1) return false;
      if (gridEq(to, startGrid)) return false;
      if (sourceCellSet.has(`${to.x},${to.y}`)) return false;
      for (const p of path) if (gridEq(to, p)) return false;
      if (cornerCutsWall(from, to) && cornerCutMode === 'block') return false;
      if (type === 'Push' && sourceGrid) {
        if (gridDist(ctr(to), sourceGrid) <= gridDist(ctr(from), sourceGrid)) return false;
      }
      if (type === 'Pull' && sourceGrid) {
        if (gridDist(ctr(to), sourceGrid) >= gridDist(ctr(from), sourceGrid)) return false;
      }
      return true;
    };

    // in collide mode: greedy diagonal-first - shortest possible path, corner cuts allowed (they collide).
    // in block mode: BFS so it routes around corners rather than through them.
    const getSuggestedPath = (from, to) => {
      const remaining = reduced - path.length;
      if (cornerCutMode === 'collide') {
        const steps = [];
        let curr = { ...from };
        while (!gridEq(curr, to)) {
          if (steps.length >= remaining) return null;
          const dx = Math.sign(to.x - curr.x);
          const dy = Math.sign(to.y - curr.y);
          // prefer diagonal, then cardinal along each axis
          const candidates = [];
          if (dx !== 0 && dy !== 0) candidates.push({ x: curr.x + dx, y: curr.y + dy });
          if (dx !== 0) candidates.push({ x: curr.x + dx, y: curr.y });
          if (dy !== 0) candidates.push({ x: curr.x, y: curr.y + dy });
          let chosen = null;
          for (const c of candidates) {
            if (gridEq(c, startGrid)) continue;
            if (sourceCellSet.has(`${c.x},${c.y}`)) continue;
            if (path.some(p => gridEq(p, c)) || steps.some(s => gridEq(s, c))) continue;
            if (type === 'Push' && sourceGrid && gridDist(ctr(c), sourceGrid) <= gridDist(ctr(curr), sourceGrid)) continue;
            if (type === 'Pull' && sourceGrid && gridDist(ctr(c), sourceGrid) >= gridDist(ctr(curr), sourceGrid)) continue;
            chosen = c;
            break;
          }
          if (!chosen) return null;
          steps.push(chosen);
          curr = chosen;
        }
        return steps.length > 0 ? steps : null;
      }
      // block mode - BFS routing around corners
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

    // returns whether a step in the already-drawn path (or a hover step) will cause a collision
    const stepIsCollision = (from, to) => {
      if (wallReachable.has(`${to.x},${to.y}`) || cornerCutsWall(from, to)) return true;
      if (isLargeToken) {
        return tokensAtCells(footprintCells(to.x, to.y, tokenSize), targetToken.id).length > 0;
      }
      return !!tokenAt(to.x, to.y, targetToken.id);
    };

    // Size of the token footprint in world pixels (1x1 for normal tokens, NxN for large)
    const footW = GRID * tokenSize;
    const footH = GRID * tokenSize;

    const redraw = (hoverGrid) => {
      graphics.clear();

      // Range background -- always 1x1 cells (these mark reachable top-left positions)
      for (const k of rangeHighlight) {
        const [gx, gy] = k.split(',').map(Number);
        const rw = toWorld({ x: gx, y: gy });
        graphics.beginFill(colorRange, 0.18);
        graphics.drawRect(rw.x, rw.y, GRID, GRID);
        graphics.endFill();
      }
      for (const k of wallReachable) {
        const [gx, gy] = k.split(',').map(Number);
        const rw = toWorld({ x: gx, y: gy });
        graphics.beginFill(colorCollision, 0.15);
        graphics.drawRect(rw.x, rw.y, GRID, GRID);
        graphics.endFill();
      }

      // Collect all token-footprint cells into a map so overlapping footprints across
      // adjacent path steps don't stack transparent fills and create a gradient.
      // Priority: hover and suggestion overwrite placed steps, placed steps overwrite start.
      const cellMap = new Map();

      const setCells = (gx, gy, color, alpha) => {
        for (let ix = 0; ix < tokenSize; ix++) {
          for (let iy = 0; iy < tokenSize; iy++) {
            cellMap.set(`${gx + ix},${gy + iy}`, { color, alpha });
          }
        }
      };

      // Start position (lowest priority)
      setCells(startGrid.x, startGrid.y, colorStart, 0.35);

      // Placed path steps
      for (let pi = 0; pi < path.length; pi++) {
        const p    = path[pi];
        const prev = pi > 0 ? path[pi - 1] : startGrid;
        setCells(p.x, p.y, stepIsCollision(prev, p) ? colorCollision : colorPath, 0.45);
      }

      // Hover and suggestion (highest priority, overwrites placed cells)
      if (hoverGrid && path.length < reduced) {
        const prev = path.length ? path[path.length - 1] : startGrid;
        const hk   = `${hoverGrid.x},${hoverGrid.y}`;
        const inRange = rangeHighlight.has(hk) || wallReachable.has(hk);
        const destCollision = stepIsCollision(prev, hoverGrid);

        if (isValidStep(prev, hoverGrid)) {
          setCells(hoverGrid.x, hoverGrid.y, destCollision ? colorCollision : colorValid, 0.45);
        } else if (inRange) {
          const suggestion = getSuggestedPath(prev, hoverGrid);
          if (suggestion) {
            let suggPrev = prev;
            for (const s of suggestion) {
              setCells(s.x, s.y, stepIsCollision(suggPrev, s) ? colorCollision : colorSuggest, 0.45);
              suggPrev = s;
            }
          }
          setCells(hoverGrid.x, hoverGrid.y, destCollision ? colorCollision : colorValid, 0.45);
        } else {
          setCells(hoverGrid.x, hoverGrid.y, colorInvalid, 0.4);
        }
      }

      // Draw each cell exactly once
      for (const [key, { color, alpha }] of cellMap) {
        const [gx, gy] = key.split(',').map(Number);
        const pw = toWorld({ x: gx, y: gy });
        graphics.beginFill(color, alpha);
        graphics.drawRect(pw.x, pw.y, GRID, GRID);
        graphics.endFill();
      }
    };

    const overlay = new PIXI.Container();
    overlay.interactive = true;
    overlay.hitArea     = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
    canvas.app.stage.addChild(overlay);
    let hoverGrid = null;

    const onMove = (e) => {
      hoverGrid = toGrid(e.data.getLocalPosition(canvas.app.stage));
      redraw(hoverGrid);
    };

    const onClick = (e) => {
      const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
      const prev = path.length ? path[path.length - 1] : startGrid;
      const gk   = `${gpos.x},${gpos.y}`;
      if (isValidStep(prev, gpos)) {
        path.push(gpos);
        if (path.length === reduced) { cleanup(); resolve(path); return; }
        redraw(hoverGrid);
      } else if (rangeHighlight.has(gk) || wallReachable.has(gk)) {
        const suggestion = getSuggestedPath(prev, gpos);
        if (!suggestion) { ui.notifications.warn('No valid path to that square.'); return; }
        for (const s of suggestion) path.push(s);
        // for collision destinations the final cell must be included so the execution loop hits the wall
        if (!gridEq(path[path.length - 1], gpos)) path.push(gpos);
        cleanup(); resolve(path);
      } else {
        ui.notifications.warn('Invalid step for ' + type + '.');
      }
    };

    const onRightClick = () => { if (path.length > 0) { path.pop(); redraw(hoverGrid); } };

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
        ? await applyFallDamage(targetToken, finalElev, startGrid, agility, canFly, undoOps, collisionMsgs, fallReduction, noFallDamage)
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
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is blocked by a wall at elevation ${stepElev} and takes <strong>${dmg} damage</strong>.`);
            break;
          }
        }
      }

      // ── Size 2+ full-footprint collision ─────────────────────────────────────
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
            for (const wall of softWalls) await doBreakObstacleWall(wall, stepElev, undoOps, collisionMsgs);
            const wallDmg = maxWallDmg + bonusObjectDmg;
            collisionMsgs.push(`${targetToken.name} smashes through ${wallDesc(softWalls)} (costs ${maxCost}, deals <strong>${wallDmg} damage</strong>).`);
            await dmgTarget(wallDmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Large token broke ${softWalls.length} wall(s). maxCost=${maxCost}, maxDmg=${maxWallDmg}`);
            costConsumed += maxCost - 1;
            continue;
          } else {
            // Cannot break the hardest wall; break any affordable ones (they're demolished regardless), then stop
            const brokenWalls = softWalls.filter(w => remaining >= (MATERIAL_RULES()[getMaterial(w)]?.cost ?? 99));
            for (const wall of brokenWalls) await doBreakObstacleWall(wall, stepElev, undoOps, collisionMsgs);
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
            const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
            if (blockTag) {
              const walls        = getByTag(blockTag).filter(o => Array.isArray(o.c));
              const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
              for (const wall of walls) {
                await safeUpdate(wall, { move: 0, sight: 0, light: 0, sound: 0 });
                if (game.user.isGM) await addTags(wall, ['broken']);
              }
              await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
              if (game.user.isGM) await addTags(tile, ['broken']);
              undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: getMaterialAlpha(origMat) } });
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
          if (getSetting('debugMode')) console.log(`DSCT | FM | Double corner collision at step ${i}: (${prev.x},${prev.y})→(${step.x},${step.y})`);
        } else if (wVert || wHoriz) {
          const cornerWall = wVert ?? wHoriz;
          if (getSetting('cornerCutMode') === 'collide') {
            // single corner cut in collide mode - treat it as a collision with that wall
            wall = cornerWall;
            if (getSetting('debugMode')) console.log(`DSCT | FM | Single corner collision at step ${i}: (${prev.x},${prev.y})→(${step.x},${step.y})`);
          } else {
            // block mode - movement stops cleanly with no damage
            if (getSetting('debugMode')) console.log(`DSCT | FM | Single corner blocked at step ${i}: (${prev.x},${prev.y})→(${step.x},${step.y})`);
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
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            if (getSetting('debugMode')) console.log(`DSCT | FM | Hit indestructible wall (no 'obstacle' tag) at step ${i}. dmg=${dmg}`);
            collisionMsgs.push(`${targetToken.name} hits a wall and takes <strong>${dmg} damage</strong>.`);
            break;
          }

          if (hasTags(wall, 'obstacle')) {
            const blockTag = getTags(wall).find(t => t.startsWith('wall-block-'));
            const isBreakable = hasTags(wall, 'breakable');

            if (!isBreakable) {
              landingIndex = i - 1;
              const dmg = 2 + remaining + bonusObjectDmg;
              if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
              if (getSetting('debugMode')) console.log(`DSCT | FM | Stopped by non-breakable obstacle wall at step ${i}. dmg=${dmg}`);
              collisionMsgs.push(`${targetToken.name} hits a wall and takes <strong>${dmg} damage</strong>.`);
              break;
            }

            const mat  = getMaterial(wall);
            const rule = MATERIAL_RULES()[mat];
            const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);

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
                  const prevWallData = allWalls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
                  for (const w of allWalls) {
                    await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
                    if (game.user.isGM) await addTags(w, ['broken']);
                  }
                  if (tile) {
                    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
                    if (game.user.isGM) await addTags(tile, ['broken']);
                    undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: getMaterialAlpha(origMat) } });
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

        if (!noCollisionDamage) await applyDamage(targetToken.actor, remaining + bonusCreatureDmg);
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
            if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);
            collisionMsgs.push(`${targetToken.name} is stopped by an obstacle and takes <strong>${dmg} damage</strong>.`);
            break;
          }

          const mat  = getMaterial(tile);
          const rule = MATERIAL_RULES()[mat];
          const dmg  = remaining < rule.cost ? 2 + remaining + bonusObjectDmg : rule.damage + bonusObjectDmg;
          if (!noCollisionDamage) await applyDamage(targetToken.actor, dmg);

          if (remaining >= rule.cost) {
            if (blockTag) {
              const walls        = getByTag(blockTag).filter(o => Array.isArray(o.c));
              const origMat      = getMaterial(tile);
              const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
              for (const wall of walls) {
                await safeUpdate(wall, { move: 0, sight: 0, light: 0, sound: 0 });
                if (game.user.isGM) await addTags(wall, ['broken']);
              }
              await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
              if (game.user.isGM) await addTags(tile, ['broken']);

              undoOps.push({ op: 'update',     uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(origMat), alpha: getMaterialAlpha(origMat) } });
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
      // canvas.scene.tokens does not update synchronously after a safeUpdate call.
      // if we write the undo log before the position propagates we capture stale coords
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
        // Chebyshev distance from grabbed cell to nearest cell in grabber's footprint
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


const SCALE = 1.2;
const s = n => Math.round(n * SCALE);
const palette = () => document.body.classList.contains('theme-dark') ? {
  bg: '#0e0c14', bgInner: '#0a0810', bgBtn: '#1a1628',
  border: '#2a2040', borderOuter: '#4a3870',
  text: '#8a88a0', textDim: '#3a3050', textLabel: '#4a3870',
  accent: '#7a50c0', accentRed: '#802020', accentGreen: '#206040',
} : {
  bg: '#f0eef8', bgInner: '#e4e0f0', bgBtn: '#dbd8ec',
  border: '#b0a8cc', borderOuter: '#7060a8',
  text: '#3a3060', textDim: '#8880aa', textLabel: '#5040a0',
  accent: '#7a50c0', accentRed: '#a03030', accentGreen: '#206040',
};


export class ForcedMovementPanel extends Application {
  constructor() {
    super();
    this._html = null;
    this._sourceToken = null;
    this._targetToken = null;
    this._targetTokens = [];
    this._updatePreview();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'dsct-fm-panel', title: 'Forced Movement', template: null,
      width: s(260), height: 'auto', resizable: false, minimizable: false,
    });
  }

  _updatePreview() {
    const controlled  = canvas.tokens.controlled;
    const targets     = [...game.user.targets];
    this._sourceToken = controlled.length === 1 ? controlled[0] : null;
    this._targetTokens = targets;
    this._targetToken = targets.length > 0 ? targets[0] : null;
  }

  _buildTargetHTML(p) {
    const targets = this._targetTokens;
    const count   = targets.length;
    const cols    = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;
    const total   = s(66);
    const gap     = s(2);
    const cell    = Math.floor((total - gap * (cols - 1)) / cols);

    if (cols === 1) {
      const src   = targets[0]?.document.texture.src ?? 'icons/svg/mystery-man.svg';
      const label = targets[0]?.name ?? 'No Target';
      const color = targets[0] ? p.text : p.textDim;
      return `
        <img src="${src}" style="width:${total}px;height:${total}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
        <div style="font-size:${s(8)}px;color:${color};text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:${s(2)}px;">${label}</div>
      `;
    }

    const slots  = cols * cols;
    const filled = targets.slice(0, slots).map(t =>
      `<img src="${t.document.texture.src}" style="width:${cell}px;height:${cell}px;border-radius:2px;object-fit:cover;border:1px solid ${p.border};background:${p.bg};" title="${t.name}">`
    ).join('');
    const empty  = Array(Math.max(0, slots - Math.min(count, slots))).fill(
      `<div style="width:${cell}px;height:${cell}px;border-radius:2px;border:1px dashed ${p.borderOuter};"></div>`
    ).join('');
    const label  = count ? `${count} Target${count !== 1 ? 's' : ''}` : 'No Target';
    return `
      <div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:${gap}px;width:${total}px;height:${total}px;align-items:center;justify-items:center;">
        ${filled}${empty}
      </div>
      <div style="font-size:${s(8)}px;color:${count ? p.text : p.textDim};text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:${s(2)}px;">${label}</div>
    `;
  }

  _refreshPanel() {
    if (!this._html) return;
    this._updatePreview();
    const p = palette();

    const sourceImg  = this._html.find('#fm-source-img')[0];
    const sourceName = this._html.find('#fm-source-name')[0];
    if (sourceImg)  { sourceImg.src = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg'; sourceImg.style.width = `${s(66)}px`; sourceImg.style.height = `${s(66)}px`; }
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? 'No Source'; sourceName.style.color = this._sourceToken ? p.text : p.textDim; }

    const targetContainer = this._html.find('#fm-target-container')[0];
    if (targetContainer) targetContainer.innerHTML = this._buildTargetHTML(p);
  }

  async _renderInner(_data) {
    const styleId = 'fm-panel-style';
    const styleEl = document.getElementById(styleId) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    const p = palette();
    styleEl.textContent = `
      #dsct-fm-panel .window-content { padding:0; background:${p.bg}; overflow-y:auto; }
      #dsct-fm-panel { border:1px solid ${p.borderOuter}; border-radius:3px; box-shadow:0 0 12px rgba(0,0,0,0.4); }
      #dsct-fm-panel .window-header { display:none !important; }
      #dsct-fm-panel .window-content { border-radius:3px; }
      #dsct-fm-panel button:hover { filter:brightness(1.15); }
      #dsct-fm-panel input[type="number"], #dsct-fm-panel select { background:${p.bgBtn}; color:${p.text}; border:1px solid ${p.border}; border-radius:2px; font-size:${s(9)}px; padding:${s(2)}px; }
      #dsct-fm-panel input[type="number"]:focus, #dsct-fm-panel select:focus { outline:none; border-color:${p.accent}; }
      #dsct-fm-panel input[type="checkbox"] { accent-color:${p.accent}; margin:0; }
    `;

    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'No Source';
    
    
    return $(`
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;" id="fm-drag-handle">

        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Forced Movement</div>
          <button data-action="close-window"
            style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;margin-left:auto;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;
            display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
        </div>

        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;">
          <div style="display:flex;align-items:center;gap:${s(6)}px;">
            <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;">
              <img id="fm-source-img" src="${sourceSrc}" style="width:${s(66)}px;height:${s(66)}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
              <div id="fm-source-name" style="font-size:${s(8)}px;color:${this._sourceToken ? p.text : p.textDim};text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:${s(2)}px;">${sourceLabel}</div>
            </div>

            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">
              <div style="font-size:${s(12)}px;color:${p.textDim};">moves</div>
            </div>

            <div id="fm-target-container" style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;height:${s(80)}px;">
              ${this._buildTargetHTML(p)}
            </div>
          </div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Parameters</div>
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(4)}px;">

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Distance</div>
            <div style="display:flex;gap:${s(3)}px;">
              <select id="fm-type" style="width:${s(60)}px;">
                <option value="Push">Push</option><option value="Pull">Pull</option><option value="Slide">Slide</option>
              </select>
              <input type="number" id="fm-dist" value="1" min="1" step="1" style="width:${s(30)}px;text-align:center;" title="Squares">
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" id="fm-vert-check"> Vertical
            </label>
            <input type="number" id="fm-vert-dist" placeholder="Dist" step="1" style="width:${s(40)}px;text-align:center;" title="Leave blank to match horizontal distance">
          </div>

          <div style="width:100%;height:1px;background:${p.border};margin:${s(2)}px 0;"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Fall Reduction</div>
            <input type="number" id="fm-fall-red" value="0" min="0" step="1" style="width:${s(30)}px;text-align:center;" title="Bonus (Stacks with Agility)">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:${s(4)}px;margin-top:${s(2)}px;">
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-no-fall"> No Fall Damage</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-no-col"> No Collision Damage</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-ign-stab"> Ignore Stability</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-fast-move"> Fast Auto-Path</label>
          </div>
        </div>

        <button data-action="execute-fm" style="width:100%;padding:${s(6)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(10)}px;font-weight:bold;background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">
          <i class="fas fa-arrows-alt" style="margin-right:${s(4)}px;"></i> <span id="fm-exec-text">Execute Move</span>
        </button>

      </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._html = html;

    const appEl = html[0].closest('.app');
    if (appEl) {
      const saved = window._fmPanelPos;
      appEl.style.left = saved ? `${saved.left}px` : `${Math.round((window.innerWidth - (appEl.offsetWidth || s(260))) / 2)}px`;
      appEl.style.top  = saved ? `${saved.top}px`  : `${Math.round((window.innerHeight - (appEl.offsetHeight || s(300))) / 2)}px`;
      html[0].addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
        e.preventDefault();
        const sx = e.clientX - appEl.offsetLeft, sy = e.clientY - appEl.offsetTop;
        const onMove = ev => { appEl.style.left = `${ev.clientX - sx}px`; appEl.style.top = `${ev.clientY - sy}px`; };
        const onUp   = () => {
          window._fmPanelPos = { left: parseInt(appEl.style.left), top: parseInt(appEl.style.top) };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    if (this._hookControl) Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)  Hooks.off('targetToken',  this._hookTarget);
    this._hookControl = Hooks.on('controlToken', () => this._refreshPanel());
    this._hookTarget  = Hooks.on('targetToken',  () => this._refreshPanel());
    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    
    const updateExecButton = () => {
      const type = html.find('#fm-type').val() || 'Move';
      const dist = html.find('#fm-dist').val() || '1';
      const isVert = html.find('#fm-vert-check').is(':checked');
      html.find('#fm-exec-text').text(`Execute ${isVert ? 'Vertical ' : ''}${type} ${dist}`);
    };
    html.find('input, select').on('change input', updateExecButton);
    updateExecButton(); 

    html.on('click', '[data-action]', async e => {
      const action = e.currentTarget.dataset.action;
      
      if (action === 'close-window') { 
        this.close(); 
        return; 
      }
      
      if (action === 'execute-fm') {
        if (this._targetTokens.length === 0) { ui.notifications.warn("DSCT | You must target at least one token."); return; }

        const type = html.find('#fm-type').val();
        const distance = parseInt(html.find('#fm-dist').val()) || 1;
        const isVertical = html.find('#fm-vert-check').is(':checked');
        const rawVert = html.find('#fm-vert-dist').val();

        let verticalHeight = 0;
        if (isVertical) {
          const sign = type === 'Pull' ? -1 : 1;
          const parsedVert = rawVert === '' ? distance : parseInt(rawVert);
          verticalHeight = (isNaN(parsedVert) ? distance : parsedVert) * sign;
        }

        const fallReduction = parseInt(html.find('#fm-fall-red').val()) || 0;
        const noFallDamage = html.find('#fm-no-fall').is(':checked');
        const noCollisionDamage = html.find('#fm-no-col').is(':checked');
        const ignoreStability = html.find('#fm-ign-stab').is(':checked');
        const fastMove = html.find('#fm-fast-move').is(':checked');

        const api = getModuleApi(false);
        if (api && api.forcedMovement) {
          const targetsToProcess = this._targetTokens.slice(0, 25);
          const payload = { type, distance, sourceId: this._sourceToken?.id, verticalHeight, fallReduction, noFallDamage, noCollisionDamage, ignoreStability, fastMove };

          if (targetsToProcess.length === 1) {
            
            await api.forcedMovement({ ...payload, targetId: targetsToProcess[0].id });
          } else {
            
            const results = [];
            for (const t of targetsToProcess) {
              const result = await api.forcedMovement({ ...payload, targetId: t.id, suppressMessage: true });
              if (result) results.push(result); 
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
      }
    });
  }

  async close(options) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const toggleForcedMovementPanel = () => {
  const existing = getWindowById('dsct-fm-panel');
  if (existing) {
    existing.close();
  } else {
    new ForcedMovementPanel().render(true);
  }
};

/**
 * Reapply a list of grabs that were ended by forced movement, respecting multi-grab limits.
 * maxGrabs is derived from how many entries share the same grabberTokenId; this handles
 * creatures with whitelisted multi-grab abilities (e.g. claw-swing: 2, several-arms: 4).
 */
const restoreGrabs = async (grabsToRestore) => {
  if (!grabsToRestore?.length) return;
  const maxByGrabber = new Map();
  for (const { grabberTokenId } of grabsToRestore) {
    maxByGrabber.set(grabberTokenId, (maxByGrabber.get(grabberTokenId) ?? 0) + 1);
  }
  for (const { grabberTokenId, grabbedTokenId } of grabsToRestore) {
    const grabberTok = getTokenById(grabberTokenId);
    const grabbedTok = getTokenById(grabbedTokenId);
    if (grabberTok && grabbedTok) await applyGrab(grabberTok, grabbedTok, { maxGrabs: maxByGrabber.get(grabberTokenId) ?? 1 });
  }
};

const handleStaminaRevival = async (undoLog) => {
  const staminaOps   = undoLog.filter(op => op.op === 'stamina');
  const revivedNames = [];

  
  
  const tokensToRevive = new Map();

  for (const op of staminaOps) {
    
    const actor = await fromUuid(op.uuid);
    if (actor) {
      if (actor.isToken) {
        tokensToRevive.set(actor.token.id, actor.token);
      } else {
        const sceneTokens = canvas.scene.tokens.filter(t => t.actor?.id === actor.id);
        for (const st of sceneTokens) tokensToRevive.set(st.id, st);
      }
    }

    
    
    const tokenIds = Array.isArray(op.squadTokenIds) ? op.squadTokenIds : [];
    for (const tid of tokenIds) {
      if (!tokensToRevive.has(tid)) {
        const t = canvas.scene.tokens.get(tid);
        if (t) tokensToRevive.set(tid, t);
      }
    }
  }

  
  for (const tokenDoc of tokensToRevive.values()) {
    if (!tokenDoc || !tokenDoc.actor) continue;

    const skulls = canvas.scene.tiles.filter(t =>
      t.flags?.['draw-steel-combat-tools']?.deadTokenId === tokenDoc.id
    );
    const isDead  = tokenDoc.actor.statuses?.has('dead');
    const isDying = tokenDoc.actor.statuses?.has('dying');

    
    if (!isDead && !isDying && skulls.length === 0) continue;

    
    if (isDead)  await safeToggleStatusEffect(tokenDoc.actor, 'dead',  { active: false });
    if (isDying) await safeToggleStatusEffect(tokenDoc.actor, 'dying', { active: false });

    
    for (const skull of skulls) {
      const gx = Math.floor(skull.x / canvas.grid.size) * canvas.grid.size;
      const gy = Math.floor(skull.y / canvas.grid.size) * canvas.grid.size;

      await safeUpdate(tokenDoc, { x: gx, y: gy }, { animate: false, teleport: true });

      
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const live = canvas.scene.tokens.get(tokenDoc.id);
        if (live && Math.abs(live.x - gx) < 1 && Math.abs(live.y - gy) < 1) break;
        await new Promise(r => setTimeout(r, 50));
      }

      await safeDelete(skull);
    }

    if (tokenDoc.hidden) await safeUpdate(tokenDoc, { hidden: false });

    
    
    
    if (game.combat && !game.combat.combatants.find(c => c.tokenId === tokenDoc.id)) {
      const savedGroupId = tokenDoc.getFlag('draw-steel-combat-tools', 'savedGroupId');
      const combatantData = { tokenId: tokenDoc.id, sceneId: canvas.scene.id, actorId: tokenDoc.actorId };
      if (savedGroupId) combatantData.group = savedGroupId;
      await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
      if (savedGroupId) await tokenDoc.unsetFlag('draw-steel-combat-tools', 'savedGroupId');
    }

    
    const deathMsgs = game.messages.filter(m =>
      m.getFlag('draw-steel-combat-tools', 'isDeathMessage') &&
      m.getFlag('draw-steel-combat-tools', 'deadTokenId') === tokenDoc.id
    );
    for (const dm of deathMsgs) await safeDelete(dm);

    revivedNames.push(tokenDoc.name);
  }

  return revivedNames;
};


const isEntryExpired = (entry) => {
  if (canvas.scene?.id !== entry.targetSceneId) {
    if (getSetting('debugMode')) console.log(`DSCT | FM | EXPIRED (scene mismatch) targetScene=${entry.targetSceneId} currentScene=${canvas.scene?.id}`);
    return true;
  }
  const token = canvas.scene.tokens.get(entry.targetTokenId);
  if (!token) {
    if (getSetting('debugMode')) console.log(`DSCT | FM | EXPIRED (token deleted) targetTokenId=${entry.targetTokenId}`);
    return true;
  }
  const lastMoveId = token.getFlag('draw-steel-combat-tools', 'lastFmMoveId');
  if (lastMoveId && lastMoveId !== entry.moveId) {
    if (getSetting('debugMode')) console.log(`DSCT | FM | EXPIRED (moveId mismatch) msg=${entry.moveId} token=${lastMoveId} | target=${token.name}`);
    return true;
  }
  if (entry.finalPos) {
    const isDead = token.actor?.statuses?.has('dead') || token.hidden;
    if (!isDead) {
      const posMatch = token.x === entry.finalPos.x && token.y === entry.finalPos.y && (token.elevation ?? 0) === entry.finalPos.elevation;
      if (getSetting('debugMode')) console.log(`DSCT | FM | Position check for ${token.name}: token(${token.x},${token.y},${token.elevation??0}) vs finalPos(${entry.finalPos.x},${entry.finalPos.y},${entry.finalPos.elevation}) | match=${posMatch} | isDead=${isDead} | moveId=${entry.moveId}`);
      if (!posMatch) return true;
    } else {
      if (getSetting('debugMode')) console.log(`DSCT | FM | Skipping pos check for ${token.name}: isDead=${isDead} finalPos=${JSON.stringify(entry.finalPos)}`);
    }
  }
  return false;
};


export const registerForcedMovementHooks = () => {
  const STATUS_STYLE = 'text-align: center; color: var(--color-text-dark-secondary); font-style: italic; font-size: 11px; padding: 4px; border: 1px dashed var(--color-border-dark-4); border-radius: 3px;';

  Hooks.on('renderChatMessageHTML', (msg, htmlElement) => {
    const html = $(htmlElement);
    if (!msg.getFlag('draw-steel-combat-tools', 'isFmUndo')) return;

    const isUndone   = msg.getFlag('draw-steel-combat-tools', 'isUndone');
    const isCombined = msg.getFlag('draw-steel-combat-tools', 'isCombined');
    const hadDamage  = msg.getFlag('draw-steel-combat-tools', 'hadDamage');
    const container  = $('<div class="dsct-fm-undo-container" style="margin-top: 4px;"></div>');

    
    if (isCombined) {
      const entries   = msg.getFlag('draw-steel-combat-tools', 'entries') ?? [];
      let isExpired   = msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false;
      if (!isExpired) isExpired = entries.some(isEntryExpired);

      const undoneText = hadDamage ? '(Movements and Damage Undone)' : '(Movements Undone)';

      if (isUndone) {
        container.append(`<div style="${STATUS_STYLE}">${undoneText}</div>`);
      } else if (isExpired) {
        container.append(`<div style="${STATUS_STYLE}">(Undo Expired)</div>`);
      } else if (game.user.isGM || msg.isAuthor) {
        const btn = $(`<button type="button" class="dsct-undo-fm" style="cursor:pointer; font-size: 12px; line-height: 14px; margin-top: 2px;"><i class="fa-solid fa-rotate-left"></i> Undo All Movements</button>`);
        btn.on('click', async (e) => {
          e.preventDefault();
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isUndone': true });
          const allRevived = [];
          for (const entry of [...entries].reverse()) {
            if (entry.undoLog) {
              await replayUndo(entry.undoLog);
              allRevived.push(...await handleStaminaRevival(entry.undoLog));
            }
            await restoreGrabs(entry.grabsToRestore);
          }
          const unique = [...new Set(allRevived)];
          ui.notifications.info(unique.length > 0
            ? `Forced movement reversed. Revived: ${unique.join(', ')}.`
            : 'All forced movements undone.'
          );
        });
        container.append(btn);
      }

      html.find('.message-content').append(container);
      return;
    }

    
    let isExpired = msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false;
    if (!isExpired) {
      isExpired = isEntryExpired({
        moveId:        msg.getFlag('draw-steel-combat-tools', 'moveId'),
        targetTokenId: msg.getFlag('draw-steel-combat-tools', 'targetTokenId'),
        targetSceneId: msg.getFlag('draw-steel-combat-tools', 'targetSceneId'),
        finalPos:      msg.getFlag('draw-steel-combat-tools', 'finalPos'),
      });
    }

    const undoneText = hadDamage ? '(Movement and Damage Undone)' : '(Movement Undone)';

    if (isUndone) {
      container.append(`<div style="${STATUS_STYLE}">${undoneText}</div>`);
    } else if (isExpired) {
      container.append(`<div style="${STATUS_STYLE}">(Undo Expired)</div>`);
    } else if (game.user.isGM || msg.isAuthor) {
      const btn = $(`<button type="button" class="dsct-undo-fm" style="cursor:pointer; font-size: 12px; line-height: 14px; margin-top: 2px;"><i class="fa-solid fa-rotate-left"></i> Undo Movement</button>`);
      btn.on('click', async (e) => {
        e.preventDefault();
        const undoLog = msg.getFlag('draw-steel-combat-tools', 'undoLog');
        if (undoLog) {
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isUndone': true });
          await replayUndo(undoLog);
          const revivedNames = await handleStaminaRevival(undoLog);
          await restoreGrabs(msg.getFlag('draw-steel-combat-tools', 'grabsToRestore'));
          ui.notifications.info(revivedNames.length > 0
            ? `Forced movement reversed. Revived: ${[...new Set(revivedNames)].join(', ')}.`
            : 'Forced movement undone.'
          );
        }
      });
      container.append(btn);
    }

    html.find('.message-content').append(container);
  });
};