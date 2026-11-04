import {
  hasTags, getTags, getByTag, addTags, removeTags,
  GRID as getGRID,
  toGrid,
  MATERIAL_RULES, MATERIAL_ICONS, WALL_RESTRICTIONS,
  getMaterialIcon, getMaterialAlpha, getMaterial,
  tokenAt, tileAt, wallBetween, tileIsOpenDoor,
  applyDamage,
  canCurrentlyFly, getWallBlockTop,
  safeUpdate, safeDelete, safeCreateEmbedded,
  getSetting, chooseFreeSquare, confirmFall, fallGate, stepOffCatcher, knockProne,
} from '../helpers.mjs';
import { clipSegToBoxT, squaresForWall } from './wall-builder.mjs';
import { wallHeight, SceneTerrain } from '../ctlib.mjs';

const L = (key, data = {}) => game.i18n.format(`DSCT.chat.fm.${key}`, data);
const pl = (n) => (n !== 1 ? 's' : '');

const wallSpan = (w) => {
  const { bottom, top } = wallHeight(w);
  const unit = w.parent?.grid?.distance || 1;
  return { bottom: Number.isFinite(bottom) ? bottom * unit : 0, top: Number.isFinite(top) ? top * unit : Infinity };
};

const sceneTerrain = () => new SceneTerrain();

const terrainTop = (terrain, grid, below, cap = Infinity) => {
  let top = null;
  for (const s of terrain.slabsAt(grid)) {
    if (s.tile || s.liquid) continue;
    const b = terrain.grid.toElevation(s.bottom);
    const t = terrain.grid.toElevation(s.top);
    if (b >= below || t > cap) continue;
    top = Math.max(top ?? -Infinity, t);
  }
  return top ?? 0;
};

const cornerCutsWall = (from, to, elev = 0) => {
  if (from.x === to.x || from.y === to.y) return false;
  const cA = { x: to.x,   y: from.y };
  const cB = { x: from.x, y: to.y   };
  const active = (w) => {
    if (!w || hasTags(w, 'broken')) return false;
    const { bottom: wb, top: wt } = wallSpan(w);
    return !(elev >= wt || elev < wb);
  };
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

const createdDoc = async (parent, type, doc) =>
  doc?.uuid ? doc : await fromUuid(embeddedUuid(parent, type, doc));

const splitConvertedWall = async (wallDoc, gx, gy, undoOps) => {
  const GRID = getGRID();
  const [x1, y1, x2, y2] = wallDoc.c;
  const clip = clipSegToBoxT(x1, y1, x2, y2,
    gx * GRID, gy * GRID, (gx + 1) * GRID, (gy + 1) * GRID);
  if (!clip) return wallDoc;

  const [t0, t1] = clip;
  const EPS = 1e-4;
  if (t0 <= EPS && t1 >= 1 - EPS) return wallDoc; 

  const dx  = x2 - x1, dy = y2 - y1;
  const ip0 = { x: Math.round(x1 + dx * t0), y: Math.round(y1 + dy * t0) };
  const ip1 = { x: Math.round(x1 + dx * t1), y: Math.round(y1 + dy * t1) };

  const allTags  = getTags(wallDoc);
  const baseData = {
    move: wallDoc.move, sight: wallDoc.sight, light: wallDoc.light, sound: wallDoc.sound,
    dir: wallDoc.dir ?? 0, door: wallDoc.door ?? 0,
    flags: foundry.utils.deepClone(wallDoc.flags ?? {}),
  };

  const squareTile = canvas.tiles.placeables.find(t =>
    Math.floor(t.document.x / GRID) === gx &&
    Math.floor(t.document.y / GRID) === gy &&
    hasTags(t, 'obstacle')
  );
  const squareBlockId = squareTile
    ? allTags.find(tag => tag.startsWith('wall-block-') && hasTags(squareTile, tag))
    : null;

  undoOps.push({ op: 'update', uuid: wallDoc.uuid, data: { c: [x1, y1, x2, y2] } });
  await safeUpdate(wallDoc, { c: [ip0.x, ip0.y, ip1.x, ip1.y] });

  const blockTagsToRemove = allTags.filter(t => t.startsWith('wall-block-') && t !== squareBlockId);
  if (blockTagsToRemove.length > 0) {
    undoOps.push({ op: 'addTags', uuid: wallDoc.uuid, tags: blockTagsToRemove });
    await removeTags(wallDoc, blockTagsToRemove);
  }

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
    const nonBlockTags = allTags.filter(t => !t.startsWith('wall-block-'));
    const taggerTags = segIds.length ? [...nonBlockTags, ...segIds] : [];
    const newWallData = {
      c: [cx1, cy1, cx2, cy2],
      ...baseData,
      flags: { ...baseData.flags },
      ...(segIds.length === 0 ? { move: 0 } : {}),
    };
    const created = await safeCreateEmbedded(canvas.scene, 'Wall', [newWallData]);
    if (created?.[0]) {
      undoOps.push({ op: 'delete', uuid: embeddedUuid(canvas.scene, 'Wall', created[0]) });
      const createdWall = taggerTags.length ? await createdDoc(canvas.scene, 'Wall', created[0]) : null;
      if (createdWall) await addTags(createdWall, taggerTags);
    }
  };

  if (t0 > EPS)     await createOutsideSegment(x1, y1, ip0.x, ip0.y);
  if (t1 < 1 - EPS) await createOutsideSegment(ip1.x, ip1.y, x2, y2);

  return wallDoc;
};

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
      await addTags(w, ['broken']);
    }
    const prevAlpha   = tile.document.alpha ?? getMaterialAlpha(mat);
    const brokenAlpha = hasTags(tile, 'invisible') ? 0 : 0.8;
    await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: brokenAlpha });
    await addTags(tile, ['broken']);

    const restrict = WALL_RESTRICTIONS()[mat] ?? WALL_RESTRICTIONS().stone;
    for (const w of walls) {
      undoOps.push({ op: 'update', uuid: w.uuid, data: { ...restrict, 'flags.wall-height.top': tileTop, 'flags.wall-height.bottom': tileBottom } });
      undoOps.push({ op: 'removeTags', uuid: w.uuid, tags: ['broken'] });
    }
    undoOps.push({ op: 'update', uuid: tile.document.uuid, data: { 'texture.src': getMaterialIcon(mat), alpha: prevAlpha } });
    undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['broken'] });
    if (prevDamagedTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDamagedTag] });

    collisionMsgs.push(L('crashThroughAll', { name: targetToken.name, material: mat, height: tileHeight, s: pl(tileHeight) }));
    return tileBottom;
  }

  const newTop = tileTop - squaresBroken;
  for (const w of walls) await safeUpdate(w, { 'flags.wall-height.top': newTop });
  if (prevDamagedTag) await removeTags(tile, [prevDamagedTag]);
  await addTags(tile, [`damaged:${newDamagedN}`, 'partially-broken']);

  for (const w of walls) {
    undoOps.push({ op: 'update', uuid: w.uuid, data: { 'flags.wall-height.top': tileTop } });
  }
  undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: [`damaged:${newDamagedN}`] });
  if (!prevDamagedTag) undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: ['partially-broken'] });
  if (prevDamagedTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDamagedTag] });

  collisionMsgs.push(L('breakOffTop', { name: targetToken.name, count: squaresBroken, s: pl(squaresBroken), material: mat, height: tileHeight, left: newTop - tileBottom }));
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
    await removeTags(w, [blockTag]);
    await addTags(w, [botTag, `damaged:${squaresLost}`]);
  }

  await removeTags(tile, [blockTag]);
  await addTags(tile, [botTag, 'partially-broken']);

  const tg = toGrid(tile.document);
  const edges = [
    [tg.x * GRID, tg.y * GRID,         (tg.x + 1) * GRID, tg.y * GRID],
    [tg.x * GRID, (tg.y + 1) * GRID,   (tg.x + 1) * GRID, (tg.y + 1) * GRID],
    [tg.x * GRID, tg.y * GRID,          tg.x * GRID,       (tg.y + 1) * GRID],
    [(tg.x + 1) * GRID, tg.y * GRID,   (tg.x + 1) * GRID, (tg.y + 1) * GRID],
  ];

  const origIsInvisible = hasTags(tile, 'invisible');
  const topTileAllTags  = ['obstacle', 'breakable', topTag, mat, 'broken', ...(origIsInvisible ? ['invisible'] : [])];
  const splitBrokenAlpha = origIsInvisible ? 0 : 0.8;
  const createdTiles = await safeCreateEmbedded(canvas.scene, 'Tile', [{
    x: tg.x * GRID + GRID / 2, y: tg.y * GRID + GRID / 2,
    width: GRID, height: GRID,
    elevation: splitElev,
    texture: { src: MATERIAL_ICONS.broken },
    alpha: splitBrokenAlpha, hidden: false, locked: false,
    occlusion: { modes: [], alpha: 0 }, restrictions: { light: false, weather: false },
    video: { loop: false, autoplay: false, volume: 0 },
    flags: {},
  }]);
  const createdTile = createdTiles?.[0] ? await createdDoc(canvas.scene, 'Tile', createdTiles[0]) : null;
  if (createdTile) await addTags(createdTile, topTileAllTags);

  const createdWalls = [];
  for (const [x1, y1, x2, y2] of edges) {
    const result = await safeCreateEmbedded(canvas.scene, 'Wall', [{
      c: [x1, y1, x2, y2], move: 0, sight: 0, light: 0, sound: 0,
      dir: 0, door: 0,
      flags: { 'wall-height': { bottom: splitElev, top: tileTop } },
    }]);
    if (result?.[0]) {
      createdWalls.push(result[0]);
      const createdWall = await createdDoc(canvas.scene, 'Wall', result[0]);
      if (createdWall) await addTags(createdWall, topTileAllTags);
    }
  }

  collisionMsgs.push(L('objectSplits', { material: mat, elevation: splitElev }));

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

const landOnCreature = async (targetToken, landingGrid, fallDmg, undoOps, collisionMsgs, spare = false) => {
  const raw = tokenAt(landingGrid.x, landingGrid.y, targetToken.id);
  const landedOn = (raw && !isTokenDead(raw)) ? raw : null;
  if (!landedOn) return;
  const GRID = getGRID();
  undoOps.push({ op: 'update', uuid: landedOn.document.uuid, data: { x: landedOn.document.x, y: landedOn.document.y, elevation: landedOn.document.elevation ?? 0 }, options: { isUndo: true } });
  if (!spare) {
    const prev = await applyDamage(landedOn.actor, fallDmg, undefined, { fall: true });
    if (prev) undoOps.push({ op: 'stamina', uuid: landedOn.actor.uuid, prevValue: prev.prevValue, prevTemp: prev.prevTemp, squadGroupUuid: prev.squadGroup?.uuid ?? null, prevSquadHP: prev.prevSquadHP, squadCombatantIds: prev.squadCombatantIds, squadTokenIds: prev.squadTokenIds ?? [] });
    collisionMsgs.push(L('impactDamage', { name: landedOn.name, dmg: fallDmg }));
    const fallerSize   = targetToken.actor?.system?.combat?.size?.value ?? 1;
    const blockerMight = landedOn.actor?.system?.characteristics?.might?.value ?? 0;
    if (fallerSize > blockerMight) {
      await knockProne(landedOn.actor, undoOps);
      collisionMsgs.push(L('knockedProne', { name: landedOn.name, faller: targetToken.name, size: fallerSize, might: blockerMight }));
    }
  }
  const fallerWouldDie  = (targetToken.actor.system.stamina?.value ?? 1) <= 0;
  const blockerWouldDie = (landedOn.actor.system.stamina?.value ?? 1) <= 0;
  if (getSetting('debugMode')) console.log(`DSCT | landOnCreature | faller=${targetToken.name} grid=(${toGrid(targetToken.document).x},${toGrid(targetToken.document).y}) landedOn=${landedOn.name} | fallerWouldDie=${fallerWouldDie} blockerWouldDie=${blockerWouldDie}`);
  if (fallerWouldDie && blockerWouldDie) {
    collisionMsgs.push(L('bothDefeated', { name: targetToken.name, other: landedOn.name }));
    return;
  }
  const chosen = await chooseFreeSquare(targetToken, landedOn);
  if (chosen) {
    await safeUpdate(targetToken.document, { x: chosen.x * GRID, y: chosen.y * GRID }, { dsMovement: true });
    collisionMsgs.push(L('landsNearby', { name: targetToken.name }));
  } else {
    collisionMsgs.push(L('noFreeSpace', { name: targetToken.name }));
  }
};

const fallNote = (rawFall, effectiveFall, agility, extra) => (extra > 0
  ? L('fallNoteReduced', { raw: rawFall, agility, extra })
  : L('fallNoteAgility', { effective: effectiveFall, agility }));

const landingSurfaceAt = (grid, elev, terrainBelow = Infinity, terrain = sceneTerrain()) => {
  const terrainSurface = terrainTop(terrain, grid, elev + 1, terrainBelow);
  const topTile = canvas.tiles.placeables
    .filter(t => {
      const tg = toGrid(t.document);
      if (tg.x !== grid.x || tg.y !== grid.y) return false;
      if (!hasTags(t, 'obstacle') || hasTags(t, 'broken') || tileIsOpenDoor(t)) return false;
      const top = getWallBlockTop(t) ?? 0;
      return (top - 1) < elev;
    })
    .sort((a, b) => (getWallBlockTop(b) ?? 0) - (getWallBlockTop(a) ?? 0))[0] ?? null;
  const tileSurface = topTile ? ((getWallBlockTop(topTile) ?? 1) - 1) : terrainSurface;
  return { surface: Math.max(tileSurface, terrainSurface), topTile };
};

const fallDamageFor = (height, agility, reduction = 0, { slam = false } = {}) => {
  const effective = Math.max(0, height - (slam ? 0 : Math.max(0, agility)) - reduction);
  return { effective, damage: effective >= 2 ? Math.min(effective * 2, getSetting('fallDamageCap')) : 0 };
};

const applyFallDamage = async (targetToken, finalElev, landingGrid, agility, canFly, undoOps, collisionMsgs, fallReduction = 0, noFallDamage = false, spareLandedOn = false) => {
  if (isNaN(finalElev)) return finalElev;

  const { surface: landingSurface, topTile } = landingSurfaceAt(landingGrid, finalElev);

  if (!canFly && finalElev > landingSurface) {
    const rawFall        = finalElev - landingSurface;
    const gate           = await fallGate(targetToken, rawFall);
    if (gate.cancel) {
      collisionMsgs.push(L('stopsFall', { name: targetToken.name }));
      return finalElev;
    }
    if (gate.safe) {
      await safeUpdate(targetToken.document, { elevation: landingSurface }, { dsMovement: true });
      await stepOffCatcher(targetToken);
      collisionMsgs.push(L('caughtSafely', { name: targetToken.name }));
      return landingSurface;
    }
    const { effective: effectiveFall, damage: fallDmg } = fallDamageFor(rawFall, agility, fallReduction + gate.reduction);

    if (rawFall > 0 && getSetting('fallConfirmation')) {
      const previewDmg = noFallDamage ? 0 : fallDmg;
      const confirmed = await confirmFall(targetToken, rawFall, effectiveFall, previewDmg, { noFallDamage });
      if (!confirmed) return finalElev;
    }

    if (noFallDamage) {
      await safeUpdate(targetToken.document, { elevation: landingSurface }, { dsMovement: true });
      collisionMsgs.push(L('fallNoDamage', { name: targetToken.name, dist: rawFall, s: pl(rawFall) }));
      if (fallDmg) await landOnCreature(targetToken, landingGrid, fallDmg, undoOps, collisionMsgs, spareLandedOn);
      return landingSurface;
    }

    if (fallDmg) {
      await applyDamage(targetToken.actor, fallDmg, undefined, { fall: true });
      collisionMsgs.push(L('fallDamage', { name: targetToken.name, dist: rawFall, s: pl(rawFall), note: fallNote(rawFall, effectiveFall, agility, fallReduction + gate.reduction), dmg: fallDmg }));

      let actualLanding = landingSurface;
      if (topTile) {
        const newTop = await breakTileFromTop(topTile, fallDmg, undoOps, collisionMsgs, targetToken);
        if (newTop !== null) actualLanding = newTop;
      }

      await safeUpdate(targetToken.document, { elevation: actualLanding }, { dsMovement: true });
      await knockProne(targetToken.actor, undoOps);
      await landOnCreature(targetToken, landingGrid, fallDmg, undoOps, collisionMsgs);
      return actualLanding;
    } else if (rawFall > 0) {
      await safeUpdate(targetToken.document, { elevation: landingSurface }, { dsMovement: true });
      collisionMsgs.push(L('fallTooShort', { name: targetToken.name, dist: rawFall, s: pl(rawFall), note: fallNote(rawFall, effectiveFall, agility, fallReduction + gate.reduction) }));
      return landingSurface;
    }
  } else if (canFly && finalElev > 0) {
    collisionMsgs.push(L('launchedFlying', { name: targetToken.name, elevation: finalElev }));
  }
  return finalElev;
};

const applyForcedFallDamage = async (targetToken, forcedDist, finalElev, landingGrid, undoOps, collisionMsgs, noFallDamage = false, spareLandedOn = false) => {
  const canFly = canCurrentlyFly(targetToken.actor);
  if (canFly) return finalElev;

  const { surface: landingSurface, topTile } = landingSurfaceAt(landingGrid, finalElev, finalElev + forcedDist);
  const gate           = await fallGate(targetToken, forcedDist);
  if (gate.cancel) {
    collisionMsgs.push(L('stopsFall', { name: targetToken.name }));
    return finalElev;
  }
  if (gate.safe) {
    await safeUpdate(targetToken.document, { elevation: landingSurface }, { dsMovement: true });
    await stepOffCatcher(targetToken);
    collisionMsgs.push(L('caughtSafely', { name: targetToken.name }));
    return landingSurface;
  }
  const { effective: effectiveFall, damage: fallDmg } = fallDamageFor(forcedDist, 0, gate.reduction, { slam: true });

  if (forcedDist > 0 && getSetting('fallConfirmation')) {
    const previewDmg = noFallDamage ? 0 : fallDmg;
    const confirmed = await confirmFall(targetToken, forcedDist, effectiveFall, previewDmg, { noFallDamage });
    if (!confirmed) return finalElev;
  }

  if (noFallDamage) {
    await safeUpdate(targetToken.document, { elevation: landingSurface }, { dsMovement: true });
    collisionMsgs.push(L('slammedNoDamage', { name: targetToken.name, dist: forcedDist, s: pl(forcedDist) }));
    if (fallDmg) await landOnCreature(targetToken, landingGrid, fallDmg, undoOps, collisionMsgs, spareLandedOn);
    return landingSurface;
  }

  if (fallDmg) {
    await applyDamage(targetToken.actor, fallDmg, undefined, { fall: true });
    collisionMsgs.push(L('slammedDamage', { name: targetToken.name, dist: forcedDist, s: pl(forcedDist), dmg: fallDmg }));

    let actualLanding = landingSurface;
    if (topTile) {
      const newTop = await breakTileFromTop(topTile, fallDmg, undoOps, collisionMsgs, targetToken);
      if (newTop !== null) actualLanding = newTop;
    }

    await safeUpdate(targetToken.document, { elevation: actualLanding }, { dsMovement: true });
    await knockProne(targetToken.actor, undoOps);
    await landOnCreature(targetToken, landingGrid, fallDmg, undoOps, collisionMsgs);
    return actualLanding;
  } else {
    await safeUpdate(targetToken.document, { elevation: landingSurface }, { dsMovement: true });
    if (effectiveFall > 0) collisionMsgs.push(L('slammedShort', { name: targetToken.name }));
    return landingSurface;
  }
};

const buildUndoLog = (targetToken, startPos, startElevSnap, movedSnap, undoOps, wasDeadBefore = false) => [
  { op: 'update',  uuid: targetToken.document.uuid, data: { x: startPos.x, y: startPos.y, elevation: startElevSnap }, options: { isUndo: true } },
  { op: 'stamina', uuid: targetToken.actor.uuid, prevValue: movedSnap.prevValue, prevTemp: movedSnap.prevTemp, squadGroupUuid: movedSnap.squadGroup?.uuid ?? null, prevSquadHP: movedSnap.prevSquadHP, squadCombatantIds: movedSnap.squadCombatantIds, squadTokenIds: movedSnap.squadTokenIds ?? [], wasDeadBefore },
  ...undoOps,
];

const footprintCells = (gx, gy, size) => {
  const cells = [];
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++)
      cells.push({ x: gx + dx, y: gy + dy });
  return cells;
};

const newlyEnteredCells = (srcCells, destCells) => {
  const srcSet = new Set(srcCells.map(c => `${c.x},${c.y}`));
  return destCells.filter(c => !srcSet.has(`${c.x},${c.y}`));
};

const wallsAtStep = (newCells, dx, dy, stepElev) => {
  const seen   = new Set();
  const result = [];
  for (const cell of newCells) {
    const w = wallBetween({ x: cell.x - dx, y: cell.y - dy }, cell);
    if (!w || seen.has(w.id) || hasTags(w, 'broken')) continue;
    const { bottom: wb, top: wt } = wallSpan(w);
    if (stepElev >= wt || stepElev < wb) continue;
    seen.add(w.id);
    result.push({ wall: w, cell });
  }
  return result;
};

export const isTokenDead = (t) =>
  t?.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead') ?? false;

const tokensAtCells = (cells, excludeId, stepElev = null, movedSize = 1) => {
  const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
  const found   = new Map();
  for (const t of canvas.tokens.placeables) {
    if (t.id === excludeId || found.has(t.id)) continue;
    if (isTokenDead(t) && !getSetting('corpsesBlock')) continue;
    const tg    = toGrid(t.document);
    const tSize = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
    if (stepElev !== null) {
      const bElev = t.document.elevation ?? 0;
      if (bElev >= stepElev && (bElev - stepElev) >= movedSize) continue;
      if (bElev <  stepElev && (stepElev - bElev) >= tSize)     continue;
    }
    outer: for (let dy = 0; dy < tSize; dy++) {
      for (let dx = 0; dx < tSize; dx++) {
        if (cellSet.has(`${tg.x + dx},${tg.y + dy}`)) { found.set(t.id, t); break outer; }
      }
    }
  }
  return [...found.values()];
};

const tilesAtCells = (cells) => {
  const seen   = new Set();
  const result = [];
  for (const { x, y } of cells) {
    const t = tileAt(x, y);
    if (t && !seen.has(t.id)) { seen.add(t.id); result.push(t); }
  }
  return result;
};

const doBreakObstacleWall = async (wall, stepElev, undoOps, collisionMsgs, step = null) => {
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
      if (tile) {
        if (prevDmgTag) await removeTags(tile, [prevDmgTag]);
        await addTags(tile, [`damaged:${prevDmgN + 1}`]);
      }
      for (const w of allWalls) undoOps.push({ op: 'update', uuid: w.uuid, data: { 'flags.wall-height.top': prevTop } });
      if (tile) {
        undoOps.push({ op: 'removeTags', uuid: tile.document.uuid, tags: [`damaged:${prevDmgN + 1}`] });
        if (prevDmgTag) undoOps.push({ op: 'addTags', uuid: tile.document.uuid, tags: [prevDmgTag] });
      }
      const mat = getMaterial(wall);
      collisionMsgs.push(L('topCollapses', { material: mat, height: wallTop - 1 - wallBottom, s: pl(wallTop - 1 - wallBottom) }));
    } else {
      const origMat      = tile ? getMaterial(tile) : 'stone';
      const prevAlpha    = tile ? (tile.document.alpha ?? getMaterialAlpha(origMat)) : getMaterialAlpha(origMat);
      const prevWallData = allWalls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
      for (const w of allWalls) {
        await safeUpdate(w, { move: 0, sight: 0, light: 0, sound: 0 });
        await addTags(w, ['broken']);
      }
      if (tile) {
        const dBrokenAlpha = hasTags(tile, 'invisible') ? 0 : 0.8;
        await safeUpdate(tile.document, { 'texture.src': MATERIAL_ICONS.broken, alpha: dBrokenAlpha });
        await addTags(tile, ['broken']);
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

const destroyObjectToken = async (objectToken, undoOps) => {
  const GRID   = getGRID();
  const blGrid = toGrid(objectToken.document);
  const blSize = objectToken.actor?.system?.combat?.size?.value ?? objectToken.document.width ?? 1;

  for (let ix = 0; ix < blSize; ix++) {
    for (let iy = 0; iy < blSize; iy++) {
      const created = await safeCreateEmbedded(canvas.scene, 'Tile', [{
        x: (blGrid.x + ix) * GRID + GRID / 2, y: (blGrid.y + iy) * GRID + GRID / 2,
        width: GRID, height: GRID,
        texture: { src: MATERIAL_ICONS.broken, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
        alpha: 1, overhead: false, hidden: false, locked: false,
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

  undoOps.push({ op: 'update', uuid: objectToken.document.uuid,
    data: { hidden: false, x: objectToken.document.x, y: objectToken.document.y, elevation: objectToken.document.elevation ?? 0 },
    options: { isUndo: true } });
};

const _fmDistCap = () => Math.min(50, Math.ceil(Math.max(canvas.dimensions.sceneWidth, canvas.dimensions.sceneHeight) / canvas.grid.size));
export {
  cornerCutsWall,
  parseType,
  embeddedUuid,
  splitConvertedWall,
  breakTileFromTop,
  splitTileAtElevation,
  wallSpan,
  sceneTerrain,
  terrainTop,
  landingSurfaceAt,
  fallDamageFor,
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