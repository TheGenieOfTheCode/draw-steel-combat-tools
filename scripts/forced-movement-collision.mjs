import {
  hasTags, getTags, getByTag, addTags, removeTags,
  GRID as getGRID,
  toGrid,
  MATERIAL_RULES, MATERIAL_ICONS, WALL_RESTRICTIONS,
  getMaterialIcon, getMaterialAlpha, getMaterial,
  tokenAt, tileAt, wallBetween,
  applyDamage,
  canCurrentlyFly, getWallBlockTop,
  safeUpdate, safeDelete, safeCreateEmbedded, safeToggleStatusEffect,
  getSetting,
} from './helpers.mjs';
import { clipSegToBoxT, squaresForWall } from './wall-builder.mjs';

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

/**
 * Split a 'wall-converted' wall at grid square (gx, gy).
 *
 * The original wall's coordinates are shrunk to just the portion inside the
 * square. Any portions outside are created as new wall segments tagged with
 * their own block IDs (or set to move:0 if they cover no tile significantly).
 * Undo ops are pushed so this can be reversed as part of forced-movement undo.
 *
 * Returns the wall document (now representing only the inside portion).
 * If the wall doesn't pass through (gx, gy), or is already contained within
 * the square, the original wall is returned unchanged.
 */
const splitConvertedWall = async (wallDoc, gx, gy, undoOps) => {
  const GRID = getGRID();
  const [x1, y1, x2, y2] = wallDoc.c;
  const clip = clipSegToBoxT(x1, y1, x2, y2,
    gx * GRID, gy * GRID, (gx + 1) * GRID, (gy + 1) * GRID);
  if (!clip) return wallDoc;

  const [t0, t1] = clip;
  const EPS = 1e-4;
  if (t0 <= EPS && t1 >= 1 - EPS) return wallDoc; // whole wall is already in this square

  const dx  = x2 - x1, dy = y2 - y1;
  const ip0 = { x: Math.round(x1 + dx * t0), y: Math.round(y1 + dy * t0) };
  const ip1 = { x: Math.round(x1 + dx * t1), y: Math.round(y1 + dy * t1) };

  const allTags  = getTags(wallDoc);
  const baseData = {
    move: wallDoc.move, sight: wallDoc.sight, light: wallDoc.light, sound: wallDoc.sound,
    dir: wallDoc.dir ?? 0, door: wallDoc.door ?? 0,
    flags: foundry.utils.deepClone(wallDoc.flags ?? {}),
  };

  // Determine block ID that belongs to square (gx, gy) via the tile there
  const squareTile = canvas.tiles.placeables.find(t =>
    Math.floor(t.document.x / GRID) === gx &&
    Math.floor(t.document.y / GRID) === gy &&
    hasTags(t, 'obstacle')
  );
  const squareBlockId = squareTile
    ? allTags.find(tag => tag.startsWith('wall-block-') && hasTags(squareTile, tag))
    : null;

  // Shrink original wall to inside portion; record undo to restore full length
  undoOps.push({ op: 'update', uuid: wallDoc.uuid, data: { c: [x1, y1, x2, y2] } });
  await safeUpdate(wallDoc, { c: [ip0.x, ip0.y, ip1.x, ip1.y] });

  // Remove excess block IDs from inside wall (keep only this square's). GM only;
  // Tagger doesn't have a non-GM socket path, but block-tag removal failure is benign.
  const blockTagsToRemove = allTags.filter(t => t.startsWith('wall-block-') && t !== squareBlockId);
  if (blockTagsToRemove.length > 0 && game.user.isGM) {
    undoOps.push({ op: 'addTags', uuid: wallDoc.uuid, tags: blockTagsToRemove });
    await removeTags(wallDoc, blockTagsToRemove);
  }

  // Create a new segment for coords (cx1,cy1)?(cx2,cy2) outside this square
  const createOutsideSegment = async (cx1, cy1, cx2, cy2) => {
    const seg    = squaresForWall(cx1, cy1, cx2, cy2, GRID);
    const segIds = [];
    for (const [, { gx: sgx, gy: sgy, coverageRatio }] of seg) {
      if (coverageRatio < 0.5) continue;
      const sTile = canvas.tiles.placeables.find(t =>
        Math.floor(t.document.x / GRID) === sgx &&
        Math.floor(t.document.y / GRID) === sgy &&
        hasTags(t, 'obstacle')
      );
      if (sTile) {
        const sId = allTags.find(tag => tag.startsWith('wall-block-') && hasTags(sTile, tag));
        if (sId) segIds.push(sId);
      }
    }
    const taggerTags = segIds.length ? ['wall-converted', ...segIds] : [];
    const newWallData = {
      c: [cx1, cy1, cx2, cy2],
      ...baseData,
      flags: {
        ...baseData.flags,
        'draw-steel-combat-tools': { tags: taggerTags },
      },
      // Stubs with no significant coverage can't be moved through
      ...(segIds.length === 0 ? { move: 0 } : {}),
    };
    const created = await safeCreateEmbedded(canvas.scene, 'Wall', [newWallData]);
    if (created?.[0]) undoOps.push({ op: 'delete', uuid: embeddedUuid(canvas.scene, 'Wall', created[0]) });
  };

  if (t0 > EPS)     await createOutsideSegment(x1, y1, ip0.x, ip0.y);
  if (t1 < 1 - EPS) await createOutsideSegment(ip1.x, ip1.y, x2, y2);

  return wallDoc;
};

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
    const prevAlpha   = tile.document.alpha ?? getMaterialAlpha(mat);
    const brokenAlpha = (hasTags(tile, 'invisible') && getSetting('keepInvisibleWhenBroken')) ? 0 : 0.8;
    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: brokenAlpha });
    if (game.user.isGM) await addTags(tile, ['broken']);

    const restrict = WALL_RESTRICTIONS()[mat] ?? WALL_RESTRICTIONS().stone;
    for (const w of walls) {
      undoOps.push({ op: 'update', uuid: w.uuid, data: { ...restrict, 'flags.wall-height.top': tileTop, 'flags.wall-height.bottom': tileBottom } });
      undoOps.push({ op: 'removeTags', uuid: w.uuid, tags: ['broken'] });
    }
    undoOps.push({ op: 'update', uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(mat), alpha: prevAlpha } });
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

  const origIsInvisible = hasTags(tile, 'invisible');
  const topTileAllTags  = ['obstacle', 'breakable', topTag, mat, 'broken', ...(origIsInvisible ? ['invisible'] : [])];
  const splitBrokenAlpha = origIsInvisible && getSetting('keepInvisibleWhenBroken') ? 0 : 0.8;
  const createdTiles = await safeCreateEmbedded(canvas.scene, 'Tile', [{
    x: tg.x * GRID + GRID / 2, y: tg.y * GRID + GRID / 2,
    width: GRID, height: GRID,
    elevation: splitElev,
    texture: { src: MATERIAL_ICONS.broken },
    alpha: splitBrokenAlpha, hidden: false, locked: false,
    occlusion: { modes: [], alpha: 0 }, restrictions: { light: false, weather: false },
    video: { loop: false, autoplay: false, volume: 0 },
    flags: { 'draw-steel-combat-tools': { tags: topTileAllTags } },
  }]);

  const createdWalls = [];
  for (const [x1, y1, x2, y2] of edges) {
    const result = await safeCreateEmbedded(canvas.scene, 'Wall', [{
      c: [x1, y1, x2, y2], move: 0, sight: 0, light: 0, sound: 0,
      dir: 0, door: 0,
      flags: { 'wall-height': { bottom: splitElev, top: tileTop }, 'draw-steel-combat-tools': { tags: topTileAllTags } },
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

// Applies falling damage for a creature that was force-moved downward into an unbreakable surface.
// Uses the forced movement distance as the fall distance, with Agility treated as 0, per the rules.
// Called for the not-blocked vertical-downward case where the creature lands freely on the ground.
const applyForcedFallDamage = async (targetToken, forcedDist, finalElev, landingGrid, undoOps, collisionMsgs, noFallDamage = false) => {
  const GRID   = getGRID();
  const canFly = canCurrentlyFly(targetToken.actor);
  if (canFly) return finalElev;

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
  const landingSurface = topTile ? ((getWallBlockTop(topTile) ?? 1) - 1) : 0;
  const effectiveFall  = forcedDist; // Agility treated as 0

  if (noFallDamage) {
    await safeUpdate(targetToken.document, { elevation: landingSurface });
    collisionMsgs.push(`${targetToken.name} is slammed ${forcedDist} square${forcedDist !== 1 ? 's' : ''} downward but takes no fall damage.`);
    return landingSurface;
  }

  if (effectiveFall >= 2) {
    const fallDmg = Math.min(effectiveFall * 2, getSetting('fallDamageCap'));
    await applyDamage(targetToken.actor, fallDmg);
    collisionMsgs.push(`${targetToken.name} is slammed ${forcedDist} square${forcedDist !== 1 ? 's' : ''} downward into the ground and takes <strong>${fallDmg} damage</strong> (Agility treated as 0), landing prone.`);

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
        collisionMsgs.push(`${landedOn.name} is knocked prone.`);
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
  } else {
    await safeUpdate(targetToken.document, { elevation: landingSurface });
    if (effectiveFall > 0) collisionMsgs.push(`${targetToken.name} is slammed 1 square downward into the ground. Less than 2 squares, no fall damage.`);
    return landingSurface;
  }
};

const buildUndoLog = (targetToken, startPos, startElevSnap, movedSnap, undoOps) => [
  { op: 'update',  uuid: targetToken.document.uuid, data: { x: startPos.x, y: startPos.y, elevation: startElevSnap }, options: { animate: false, teleport: true } },
  { op: 'stamina', uuid: targetToken.actor.uuid, prevValue: movedSnap.prevValue, prevTemp: movedSnap.prevTemp, squadGroupUuid: movedSnap.squadGroup?.uuid ?? null, prevSquadHP: movedSnap.prevSquadHP, squadCombatantIds: movedSnap.squadCombatantIds, squadTokenIds: movedSnap.squadTokenIds ?? [] },
  ...undoOps,
];

// -- Size 2+ Collision Helpers -------------------------------------------------

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

// all tokens (excluding excludeId) that occupy at least one cell in the given set.
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
const doBreakObstacleWall = async (wall, stepElev, undoOps, collisionMsgs, step = null) => {
  // If this is a converted long-span wall, split it at the collision square first
  if (step && hasTags(wall, 'wall-converted')) {
    wall = await splitConvertedWall(wall, step.x, step.y, undoOps);
  }
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
      const prevAlpha    = tile ? (tile.document.alpha ?? getMaterialAlpha(origMat)) : getMaterialAlpha(origMat);
      const prevWallData = allWalls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
      for (const w of allWalls) {
        await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
        if (game.user.isGM) await addTags(w, ['broken']);
      }
      if (tile) {
        const dBrokenAlpha = (hasTags(tile, 'invisible') && getSetting('keepInvisibleWhenBroken')) ? 0 : 0.8;
        await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: dBrokenAlpha });
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
        occlusion: { modes: [], alpha: 0 },
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

const _fmDistCap = () => Math.min(50, Math.ceil(Math.max(canvas.dimensions.sceneWidth, canvas.dimensions.sceneHeight) / canvas.grid.size));
export {
  cornerCutsWall,
  parseType,
  embeddedUuid,
  splitConvertedWall,
  chooseFreeSquare,
  breakTileFromTop,
  splitTileAtElevation,
  applyFallDamage,
  applyForcedFallDamage,
  buildUndoLog,
  footprintCells,
  newlyEnteredCells,
  wallsAtStep,
  tokensAtCells,
  tilesAtCells,
  doBreakObstacleWall,
  destroyObjectToken,
  _fmDistCap,
};