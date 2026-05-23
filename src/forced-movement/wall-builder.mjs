import {
  MATERIAL_ICONS, WALL_RESTRICTIONS,
  BASE_MATERIALS, getCustomMaterials,
  getMaterial, getMaterialIcon, getMaterialAlpha, getAllMaterials,
  tileAt,
  hasTags, getTags, getByTag, addTags, removeTags,
  toGrid, toWorld, GRID as getGRID, getSetting,
} from '../helpers.mjs';

const BASE_MAT_COLORS = { glass: 0x88ddff, wood: 0xaa6622, stone: 0x888888, metal: 0x4488aa };
const MATERIAL_COLORS = BASE_MAT_COLORS;
const MODE_COLORS     = { build: 0x44cc44, destroy: 0xcc4444, fix: 0x44aacc, transmute: 0xcc8800, break: 0xff6600, inspect: 0xaaaaff };


const getBlockTag   = (obj) => getTags(obj).find(t => t.startsWith('wall-block-'));
const getBlockWalls = (blockTag) => blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];


const wallsTouch = (a, b) => {
  const [ax1, ay1, ax2, ay2] = a.c;
  const [bx1, by1, bx2, by2] = b.c;
  const rx = ax2 - ax1, ry = ay2 - ay1;
  const sx = bx2 - bx1, sy = by2 - by1;
  const rxs = rx * sy - ry * sx;
  if (Math.abs(rxs) < 1e-10) {
    return (ax1 === bx1 && ay1 === by1) || (ax1 === bx2 && ay1 === by2) ||
           (ax2 === bx1 && ay2 === by1) || (ax2 === bx2 && ay2 === by2);
  }
  const qpx = bx1 - ax1, qpy = by1 - ay1;
  const t = (qpx * sy - qpy * sx) / rxs;
  const u = (qpx * ry - qpy * rx) / rxs;
  const EPS = 1e-10;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
};

export const selectConnectedWalls = (addToSelection = false) => {
  const controlled = canvas.walls.controlled;
  if (!controlled.length) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.wb.selectWallFirst'));
    return;
  }

  const allWalls = canvas.scene.walls.contents;

  const adj = new Map();
  for (const w of allWalls) adj.set(w.id, new Set());
  for (let i = 0; i < allWalls.length; i++) {
    for (let j = i + 1; j < allWalls.length; j++) {
      if (wallsTouch(allWalls[i], allWalls[j])) {
        adj.get(allWalls[i].id).add(allWalls[j].id);
        adj.get(allWalls[j].id).add(allWalls[i].id);
      }
    }
  }

  const visited = new Set(controlled.map(w => w.id));
  const queue   = [...visited];
  while (queue.length) {
    const id = queue.shift();
    for (const neighborId of (adj.get(id) ?? [])) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      queue.push(neighborId);
    }
  }

  if (!addToSelection) canvas.walls.releaseAll();
  for (const placeable of canvas.walls.placeables) {
    if (visited.has(placeable.id) && !placeable.controlled)
      placeable.control({ releaseOthers: false });
  }

  ui.notifications.info(game.i18n.format('DSCT.notice.wb.connectedWalls', { count: visited.size, s: visited.size !== 1 ? 's' : '' }));
};

export const clipSegToBoxT = (x1, y1, x2, y2, bx1, by1, bx2, by2) => {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - bx1], [dx, bx2 - x1], [-dy, y1 - by1], [dy, by2 - y1]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else        { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t0 <= t1 + 1e-9 ? [t0, t1] : null;
};

export const squaresForWall = (x1, y1, x2, y2, GRID) => {
  const result = new Map();
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 0.5) return result;

  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const gxLo = Math.floor(minX / GRID), gxHi = Math.floor(maxX / GRID);
  const gyLo = Math.floor(minY / GRID), gyHi = Math.floor(maxY / GRID);

  for (let gx = gxLo; gx <= gxHi; gx++) {
    for (let gy = gyLo; gy <= gyHi; gy++) {
      const clip = clipSegToBoxT(x1, y1, x2, y2,
        gx * GRID, gy * GRID, (gx + 1) * GRID, (gy + 1) * GRID);
      if (!clip) continue;
      const [t0, t1] = clip;
      const segLen = (t1 - t0) * len;
      const coverageRatio = segLen / GRID;
      if (coverageRatio < 0.01) continue;
      result.set(`${gx},${gy}`, { gx, gy, t0, t1, coverageRatio });
    }
  }
  return result;
};

const wallEdges = (gx, gy) => {
  const GRID = getGRID();
  return [
    [gx * GRID,         gy * GRID,         (gx + 1) * GRID, gy * GRID        ],
    [gx * GRID,         (gy + 1) * GRID,   (gx + 1) * GRID, (gy + 1) * GRID  ],
    [gx * GRID,         gy * GRID,         gx * GRID,        (gy + 1) * GRID  ],
    [(gx + 1) * GRID,   gy * GRID,         (gx + 1) * GRID,  (gy + 1) * GRID  ],
  ];
};

const placeBlock = async (gx, gy, material, heightBottom = '', heightTop = '', isStable = false) => {
  const GRID    = getGRID();
  const blockId = `wall-block-${foundry.utils.randomID(8)}`;
  const tags    = ['obstacle', 'breakable', blockId, material];
  if (isStable) tags.push('stable');
  const restrict = WALL_RESTRICTIONS()[material];

  const tileElevation = heightBottom !== '' ? heightBottom - 1 : undefined;

  const [tile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
    x: gx * GRID + GRID / 2, y: gy * GRID + GRID / 2,
    width: GRID, height: GRID,
    elevation: tileElevation,
    texture: { src: getMaterialIcon(material) },
    alpha: getMaterialAlpha(material),
    hidden: false, locked: false,
    occlusion: { modes: [], alpha: 0 },
    restrictions: { light: false, weather: false },
    video: { loop: false, autoplay: false, volume: 0 },
  }]);
  await addTags(tile, tags);

  const heightFlags = {};
  if (heightBottom !== '') heightFlags['wall-height'] = { ...(heightFlags['wall-height'] ?? {}), bottom: heightBottom };
  if (heightTop    !== '') heightFlags['wall-height'] = { ...(heightFlags['wall-height'] ?? {}), top: heightTop };

  for (const [x1, y1, x2, y2] of wallEdges(gx, gy)) {
    const overlapping = canvas.scene.walls.contents.find(w =>
      (w.c[0] === x1 && w.c[1] === y1 && w.c[2] === x2 && w.c[3] === y2) ||
      (w.c[0] === x2 && w.c[1] === y2 && w.c[2] === x1 && w.c[3] === y1)
    );
    if (overlapping && overlapping.sight !== 0) await overlapping.update({ sight: 0 });
    const wallSight = overlapping ? 0 : restrict.sight;
    const [wall] = await canvas.scene.createEmbeddedDocuments('Wall', [{
      c: [x1, y1, x2, y2],
      move: restrict.move, sight: wallSight,
      light: restrict.light, sound: restrict.sound,
      dir: 0, door: 0,
      flags: Object.keys(heightFlags).length ? heightFlags : {},
    }]);
    await addTags(wall, tags);
  }

  return { tileId: tile.id, blockId };
};

const restoreOverlappingSight = async (wall) => {
  const [x1, y1, x2, y2] = wall.c;
  const partners = canvas.scene.walls.contents.filter(w =>
    w.id !== wall.id &&
    ((w.c[0] === x1 && w.c[1] === y1 && w.c[2] === x2 && w.c[3] === y2) ||
     (w.c[0] === x2 && w.c[1] === y2 && w.c[2] === x1 && w.c[3] === y1))
  );
  for (const pw of partners) {
    const pwMat = getTags(pw).find(t => getAllMaterials().includes(t));
    if (pwMat === 'glass') continue;
    const targetSight = WALL_RESTRICTIONS()[pwMat ?? 'stone']?.sight ?? 10;
    if (pw.sight !== targetSight) await pw.update({ sight: targetSight });
  }
};

const suppressOverlappingSight = async (wall) => {
  const wallMat = getTags(wall).find(t => getAllMaterials().includes(t));
  if (wallMat === 'glass') return;
  const [x1, y1, x2, y2] = wall.c;
  const partners = canvas.scene.walls.contents.filter(w =>
    w.id !== wall.id &&
    !hasTags(w, 'broken') &&
    ((w.c[0] === x1 && w.c[1] === y1 && w.c[2] === x2 && w.c[3] === y2) ||
     (w.c[0] === x2 && w.c[1] === y2 && w.c[2] === x1 && w.c[3] === y1))
  );
  if (partners.length === 0) return;
  if (wall.sight !== 0) await wall.update({ sight: 0 });
  for (const pw of partners) {
    const pwMat = getTags(pw).find(t => getAllMaterials().includes(t));
    if (pwMat === 'glass') continue;
    if (pw.sight !== 0) await pw.update({ sight: 0 });
  }
};


const wallsCollinear = (a, b) => {
  const [ax1, ay1, ax2, ay2] = a.c;
  const [bx1, by1, bx2, by2] = b.c;
  const dx = ax2 - ax1, dy = ay2 - ay1;
  if (dx * dx + dy * dy < 0.01) return false;
  const cross1 = (bx1 - ax1) * dy - (by1 - ay1) * dx;
  const cross2 = (bx2 - ax1) * dy - (by2 - ay1) * dx;
  return Math.abs(cross1) < 0.5 && Math.abs(cross2) < 0.5;
};

const collinearWallsTouch = (a, b) => {
  const [ax1, ay1, ax2, ay2] = a.c;
  const [bx1, by1, bx2, by2] = b.c;
  return (ax1 === bx1 && ay1 === by1) || (ax1 === bx2 && ay1 === by2) ||
         (ax2 === bx1 && ay2 === by1) || (ax2 === bx2 && ay2 === by2);
};

const mergeWallChain = async (walls) => {
  if (walls.length < 2) return;
  const [x1, y1, x2, y2] = walls[0].c;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len, uy = dy / len;
  const project = (x, y) => (x - x1) * ux + (y - y1) * uy;

  let minT = Infinity, maxT = -Infinity;
  for (const w of walls) {
    const [wx1, wy1, wx2, wy2] = w.c;
    const t0 = project(wx1, wy1), t1 = project(wx2, wy2);
    minT = Math.min(minT, t0, t1);
    maxT = Math.max(maxT, t0, t1);
  }

  const nx1 = Math.round(x1 + ux * minT), ny1 = Math.round(y1 + uy * minT);
  const nx2 = Math.round(x1 + ux * maxT), ny2 = Math.round(y1 + uy * maxT);
  const allTags = [...new Set(walls.flatMap(w => getTags(w)))];

  const [keeper, ...rest] = walls;
  const toAdd = allTags.filter(t => !getTags(keeper).includes(t));
  await keeper.update({ c: [nx1, ny1, nx2, ny2] });
  if (toAdd.length) await addTags(keeper, toAdd);
  for (const w of rest) await w.delete();
};

const mergeCollinearWalls = async (wallDocs) => {
  const used = new Set();
  const groups = [];
  for (let i = 0; i < wallDocs.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    const queue = [i];
    while (queue.length) {
      const cur = queue.shift();
      for (let j = 0; j < wallDocs.length; j++) {
        if (used.has(j)) continue;
        if (wallsCollinear(wallDocs[cur], wallDocs[j]) && collinearWallsTouch(wallDocs[cur], wallDocs[j])) {
          group.push(j); used.add(j); queue.push(j);
        }
      }
    }
    if (group.length > 1) groups.push(group.map(idx => wallDocs[idx]));
  }
  for (const group of groups) await mergeWallChain(group);
};

export const mergeSelectedWalls = async () => {
  const selected = canvas.walls.controlled.map(w => w.document ?? w);
  if (!selected.length) { ui.notifications.warn('No walls selected.'); return; }
  const before = selected.length;
  await mergeCollinearWalls(selected);
  ui.notifications.info(`Merged ${before} wall segments into fewer walls.`);
};

const splitBlockWallsAtTile = async (gx, gy, blockTag) => {
  const GRID = getGRID();
  const walls = getBlockWalls(blockTag);
  const created = [];

  for (const wall of walls) {
    if (!hasTags(wall, 'wall-converted')) continue;
    const [x1, y1, x2, y2] = wall.c;
    const clip = clipSegToBoxT(x1, y1, x2, y2,
      gx * GRID, gy * GRID, (gx + 1) * GRID, (gy + 1) * GRID);
    if (!clip) continue;
    const [t0, t1] = clip;
    const EPS = 1e-4;
    if (t0 <= EPS && t1 >= 1 - EPS) continue; 

    const dx = x2 - x1, dy = y2 - y1;
    const ip0 = { x: Math.round(x1 + dx * t0), y: Math.round(y1 + dy * t0) };
    const ip1 = { x: Math.round(x1 + dx * t1), y: Math.round(y1 + dy * t1) };
    const allTags = getTags(wall);
    const baseData = {
      move: wall.move, sight: wall.sight, light: wall.light, sound: wall.sound,
      dir: wall.dir ?? 0, door: wall.door ?? 0,
      flags: foundry.utils.deepClone(wall.flags ?? {}),
    };

    const otherBlockTags = allTags.filter(t => t.startsWith('wall-block-') && t !== blockTag);
    await wall.update({ c: [ip0.x, ip0.y, ip1.x, ip1.y] });
    if (otherBlockTags.length) await removeTags(wall, otherBlockTags);

    const makeOutside = async (cx1, cy1, cx2, cy2) => {
      const seg = squaresForWall(cx1, cy1, cx2, cy2, GRID);
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
      const newTags = segIds.length ? ['wall-converted', ...segIds] : [];
      const docs = await canvas.scene.createEmbeddedDocuments('Wall', [{
        c: [cx1, cy1, cx2, cy2],
        ...baseData,
        flags: { ...baseData.flags, 'draw-steel-combat-tools': { tags: newTags } },
        ...(segIds.length === 0 ? { move: 0 } : {}),
      }]);
      if (docs?.[0]) created.push(docs[0]);
    };

    if (t0 > EPS) await makeOutside(x1, y1, ip0.x, ip0.y);
    if (t1 < 1 - EPS) await makeOutside(ip1.x, ip1.y, x2, y2);
  }

  return created;
};

const breakBlock = async (tile) => {
  const blockTag = getBlockTag(tile);
  if (!blockTag) return;
  const walls = getBlockWalls(blockTag);
  for (const wall of walls) {
    await wall.update({ move: 0, sight: 0, light: 0, sound: 0 });
    await addTags(wall, ['broken']);
    await restoreOverlappingSight(wall);
  }
  const brokenAlpha = (getSetting('rubbleInvisible') || hasTags(tile, 'invisible')) ? 0 : 0.8;
  await tile.document.update({ 'texture.src': MATERIAL_ICONS.broken, alpha: brokenAlpha });
  await addTags(tile, ['broken']);
};

const fixBlock = async (tile) => {
  const blockTag    = getBlockTag(tile);
  if (!blockTag) return;
  const tags        = getTags(tile);
  const material    = tags.find(t => getAllMaterials().includes(t)) ?? 'stone';
  const restrict    = WALL_RESTRICTIONS()[material];
  const damagedTag  = tags.find(t => t.startsWith('damaged:'));
  const squaresBack = damagedTag ? parseInt(damagedTag.split(':')[1]) : 0;

  const walls = getBlockWalls(blockTag);
  for (const wall of walls) {
    const savedRestrict = wall.getFlag('draw-steel-combat-tools', 'originalRestrictions');
    const r = savedRestrict ?? restrict;
    await wall.update({ move: r.move, sight: r.sight, light: r.light, sound: r.sound });
    if (squaresBack > 0) {
      const currentTop = wall.flags?.['wall-height']?.top ?? 0;
      await wall.update({ 'flags.wall-height.top': currentTop + squaresBack });
    }
    await removeTags(wall, ['broken']);
    await suppressOverlappingSight(wall);
  }
  const fixedAlpha = (getSetting('rubbleInvisible') || hasTags(tile, 'invisible')) ? 0 : getMaterialAlpha(material);
  await tile.document.update({ 'texture.src': getMaterialIcon(material), alpha: fixedAlpha });
  await removeTags(tile, ['broken', 'partially-broken']);
  if (damagedTag) await removeTags(tile, [damagedTag]);

  
  
  if (walls.length > 0) {
    const fixedIds = new Set(walls.map(w => w.id));
    const candidates = canvas.scene.walls.contents.filter(w =>
      !fixedIds.has(w.id) && hasTags(w, 'wall-converted')
    );
    const wallsToMerge = [...walls];
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const cand of candidates) {
        if (wallsToMerge.some(w => w.id === cand.id)) continue;
        if (wallsToMerge.some(w => wallsCollinear(w, cand) && collinearWallsTouch(w, cand))) {
          wallsToMerge.push(cand);
          expanded = true;
        }
      }
    }
    if (wallsToMerge.length > walls.length) await mergeCollinearWalls(wallsToMerge);
  }
};

const destroyBlock = async (tile) => {
  const blockTag = getBlockTag(tile);
  if (blockTag) {
    const walls = getBlockWalls(blockTag);
    for (const wall of walls) {
      await restoreOverlappingSight(wall);
      await wall.delete();
    }
  }
  await tile.document.delete();
};

const transmuteBlock = async (tile, newMaterial) => {
  const blockTag = getBlockTag(tile);
  if (!blockTag) return;
  const oldTags  = getTags(tile);
  const oldMat   = oldTags.find(t => getAllMaterials().includes(t));
  const restrict = WALL_RESTRICTIONS()[newMaterial];

  if (oldMat) await removeTags(tile, [oldMat]);
  await addTags(tile, [newMaterial]);
  await tile.document.update({ 'texture.src': getMaterialIcon(newMaterial), alpha: getMaterialAlpha(newMaterial) });

  const walls = getBlockWalls(blockTag);
  for (const wall of walls) {
    if (oldMat) await removeTags(wall, [oldMat]);
    await addTags(wall, [newMaterial]);
    await wall.update({ move: restrict.move, sight: restrict.sight, light: restrict.light, sound: restrict.sound });
    const saved = wall.getFlag('draw-steel-combat-tools', 'originalRestrictions');
    if (saved !== undefined) {
      await wall.setFlag('draw-steel-combat-tools', 'originalRestrictions', { move: restrict.move, sight: restrict.sight, light: restrict.light, sound: restrict.sound });
    }
  }
};


export const convertWalls = async (material = 'stone', heightBottom = '', heightTop = '', invisible = true, stable = true, retainRestrictions = false) => {
  if (!game.user.isGM) { ui.notifications.warn(game.i18n.localize('DSCT.notice.wb.gmOnlyConvert')); return; }
  const GRID  = getGRID();
  const walls = [...(canvas.walls.controlled ?? [])].map(w => w.document ?? w);
  if (!walls.length) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.wb.noWallsSelected'));
    return;
  }

  const progressEl = document.createElement('div');
  progressEl.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;align-items:center;pointer-events:none;';
  progressEl.innerHTML = `
    <div style="background:var(--dsct-bg,#0e0c14);color:var(--dsct-text-active,#c0a8e8);padding:8px 20px 10px;border-radius:0 0 8px 8px;min-width:260px;text-align:center;border:1px solid var(--dsct-border-outer,#4a3870);border-top:none;box-shadow:0 4px 12px #0006;">
      <div id="_dsct_prog_label" style="font-size:13px;margin-bottom:6px;">Converting walls...</div>
      <div style="background:var(--dsct-border,#2a2040);border-radius:4px;height:5px;">
        <div id="_dsct_prog_fill" style="background:var(--dsct-accent,#7a50c0);height:5px;border-radius:4px;width:0%;transition:width 0.1s;"></div>
      </div>
    </div>`;
  document.body.appendChild(progressEl);

  const overlayGfx = new PIXI.Graphics();
  canvas.app.stage.addChild(overlayGfx);
  const redrawOverlay = () => {
    overlayGfx.clear();
    for (const t of canvas.tiles.placeables) {
      if (!hasTags(t, 'obstacle')) continue;
      const tg    = toGrid(t.document);
      const color = hasTags(t, 'broken') ? 0xcc4444 : 0xaaaaff;
      overlayGfx.beginFill(color, 0.12);
      overlayGfx.lineStyle(1, color, 0.45);
      overlayGfx.drawRect(tg.x * GRID, tg.y * GRID, GRID, GRID);
      overlayGfx.endFill();
      overlayGfx.lineStyle(0);
    }
  };

  const labelEl = progressEl.querySelector('#_dsct_prog_label');
  const fillEl  = progressEl.querySelector('#_dsct_prog_fill');
  const setProgress = (label, pct) => {
    if (labelEl) labelEl.textContent = label;
    if (fillEl)  fillEl.style.width  = `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
  };

  try {

  for (let i = 0; i < walls.length; i++) {
    setProgress(`Clearing tags... (${i + 1}/${walls.length})`, (i / walls.length) * 10);
    const existing = getTags(walls[i]);
    if (existing.length) await removeTags(walls[i], existing);
  }

  const squareTileMap = new Map();

  for (let i = 0; i < walls.length; i++) {
    setProgress(`Mapping squares... (${i + 1}/${walls.length})`, 10 + (i / walls.length) * 15);
    const wall = walls[i];
    const [x1, y1, x2, y2] = wall.c ?? [];
    const coverage = squaresForWall(x1, y1, x2, y2, GRID);
    for (const [key, { gx, gy, coverageRatio }] of coverage) {
      if (coverageRatio < 0.5) continue;
      if (squareTileMap.has(key)) continue;
      const existing = tileAt(gx, gy);
      if (existing && hasTags(existing, 'obstacle')) {
        const oldTags = getTags(existing);
        const blockId = oldTags.find(t => t.startsWith('wall-block-'));
        if (blockId) {
          if (oldTags.length) await removeTags(existing, oldTags);
          await existing.document.update({
            'texture.src': getMaterialIcon(material),
            alpha: invisible ? 0 : getMaterialAlpha(material),
          });
          await addTags(existing, ['obstacle', 'breakable', blockId, material, ...(stable ? ['stable'] : []), ...(invisible ? ['invisible'] : [])]);
          redrawOverlay();
          squareTileMap.set(key, { gx, gy, blockId });
          continue;
        }
      }
      squareTileMap.set(key, { gx, gy, blockId: null });
    }
  }

  const newTiles = [...squareTileMap.values()].filter(e => !e.blockId);
  for (let i = 0; i < newTiles.length; i++) {
    setProgress(`Creating tiles... (${i + 1}/${newTiles.length})`, 25 + (i / Math.max(newTiles.length, 1)) * 25);
    const entry = newTiles[i];
    const { gx, gy } = entry;
    const blockId = `wall-block-${foundry.utils.randomID(8)}`;
    const tileData = {
      x: gx * GRID + GRID / 2, y: gy * GRID + GRID / 2, width: GRID, height: GRID,
      texture: { src: getMaterialIcon(material) },
      alpha: invisible ? 0 : getMaterialAlpha(material),
      hidden: false, locked: false,
      occlusion: { modes: [], alpha: 0 },
      restrictions: { light: false, weather: false },
      video: { loop: false, autoplay: false, volume: 0 },
    };
    if (heightBottom !== '') tileData.elevation = heightBottom - 1;
    const [tile] = await canvas.scene.createEmbeddedDocuments('Tile', [tileData]);
    await addTags(tile, ['obstacle', 'breakable', blockId, material, ...(stable ? ['stable'] : []), ...(invisible ? ['invisible'] : [])]);
    redrawOverlay();
    if (heightBottom !== '' || heightTop !== '') {
      const hf = {};
      if (heightBottom !== '') hf.bottom = heightBottom;
      if (heightTop    !== '') hf.top    = heightTop;
      await tile.update({ 'flags.wall-height': hf });
    }
    entry.blockId = blockId;
  }

  let wallsConverted = 0, wallsStubbed = 0;
  const heightUpdate = {};
  if (heightBottom !== '' || heightTop !== '') {
    const hf = {};
    if (heightBottom !== '') hf.bottom = heightBottom;
    if (heightTop    !== '') hf.top    = heightTop;
    heightUpdate['flags.wall-height'] = hf;
  }

  for (let i = 0; i < walls.length; i++) {
    setProgress(`Converting walls... (${i + 1}/${walls.length})`, 50 + (i / walls.length) * 50);
    const wall = walls[i];
    const [x1, y1, x2, y2] = wall.c ?? [];
    const coverage = squaresForWall(x1, y1, x2, y2, GRID);
    const blockIds = [];
    for (const [key, { coverageRatio }] of coverage) {
      if (coverageRatio < 0.5) continue;
      const entry = squareTileMap.get(key);
      if (entry?.blockId) blockIds.push(entry.blockId);
    }

    if (blockIds.length > 0) {
      if (retainRestrictions) {
        await wall.setFlag('draw-steel-combat-tools', 'originalRestrictions', { move: wall.move, sight: wall.sight, light: wall.light, sound: wall.sound });
      } else {
        await wall.unsetFlag('draw-steel-combat-tools', 'originalRestrictions');
      }
      await addTags(wall, ['obstacle', 'breakable', material, 'wall-converted', ...new Set(blockIds)]);
      if (Object.keys(heightUpdate).length) await wall.update(heightUpdate);
      wallsConverted++;
    } else {
      let adjacentId = null;
      outer: for (const [, { gx, gy }] of coverage) {
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const adj = squareTileMap.get(`${gx+dx},${gy+dy}`);
          if (adj?.blockId) { adjacentId = adj.blockId; break outer; }
        }
      }
      if (adjacentId) await addTags(wall, ['wall-converted', adjacentId]);
      await wall.update({ move: 0, ...heightUpdate });
      wallsStubbed++;
    }
  }

  ui.notifications.info(game.i18n.format('DSCT.notice.wb.wallsConverted', {
    walls: walls.length, ws: walls.length !== 1 ? 's' : '',
    tiles: squareTileMap.size, ts: squareTileMap.size !== 1 ? 's' : '',
    stubs: wallsStubbed, ss: wallsStubbed !== 1 ? 's' : '',
  }));

  } finally {
    progressEl.remove();
    canvas.app.stage.removeChild(overlayGfx);
    overlayGfx.destroy();
  }
};

export class WallBuilderPanel extends ds.applications.api.DSApplication {
  constructor() {
    super();
    this._mode         = 'build';
    this._material     = getSetting('wbDefaultMaterial') || 'stone';
    this._heightBottom = getSetting('wbDefaultHeightBottom') ?? '';
    this._heightTop    = getSetting('wbDefaultHeightTop')    ?? '';
    this._stable              = true;
    this._invisible           = true;
    this._retainRestrictions  = true;
    this._stopInspect         = null;
  }

  static PARTS = { form: { template: 'modules/draw-steel-combat-tools/templates/panels/wall-builder.hbs' } };

  static DEFAULT_OPTIONS = {
    id: 'wall-builder-panel',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.WallBuilder', minimizable: false, resizable: true },
    position: { width: 288, height: 'auto' },
    actions: {
      'set-mode': WallBuilderPanel._onSetMode,
      'execute':  WallBuilderPanel._onExecute,
    },
  };

  static _onSetMode(_event, target) {
    this._mode = target.dataset.mode;
    this._refreshPanel();
  }

  static async _onExecute(_event, _target) {
    await this._execute();
  }

  async _selectSquares(highlightExisting = false) {
    return new Promise((resolve) => {
      const GRID      = getGRID();
      const selected  = [];
      const graphics  = new PIXI.Graphics();
      canvas.app.stage.addChild(graphics);

      const modeColor = MODE_COLORS[this._mode];
      const matColor  = MATERIAL_COLORS[this._material] ?? 0x888888;
      const fillColor = this._mode === 'build' ? matColor : modeColor;

      const redraw = (hoverGrid) => {
        graphics.clear();
        for (const g of selected) {
          graphics.beginFill(fillColor, 0.45);
          graphics.drawRect(g.x * GRID, g.y * GRID, GRID, GRID);
          graphics.endFill();
        }
        if (highlightExisting) {
          for (const tile of canvas.tiles.placeables) {
            if (!hasTags(tile, 'obstacle')) continue;
            const tg       = toGrid(tile.document);
            const isBroken        = hasTags(tile, 'broken');
            const isPartialBroken = hasTags(tile, 'partially-broken');
            const isFixable       = isBroken || isPartialBroken;
            const mat             = getTags(tile).find(t => getAllMaterials().includes(t));
            let color;
            if (this._mode === 'destroy')       color = 0xcc4444;
            else if (this._mode === 'fix')       color = isFixable ? (isPartialBroken && !isBroken ? 0x88ccff : 0x44aacc) : 0x334455;
            else if (this._mode === 'transmute') color = mat ? (MATERIAL_COLORS[mat] ?? 0x888888) : 0x888888;
            else if (this._mode === 'break')     color = isBroken ? 0x444444 : 0xff6600;
            else                                 color = isBroken ? 0xcc4444 : 0x44cc44;
            const alpha = isFixable ? 0.35 : 0.2;
            graphics.beginFill(color, alpha);
            graphics.lineStyle(1, color, 0.8);
            graphics.drawRect(tg.x * GRID, tg.y * GRID, GRID, GRID);
            graphics.endFill();
            graphics.lineStyle(0);
          }
        }
        if (hoverGrid) {
          const already = selected.some(g => g.x === hoverGrid.x && g.y === hoverGrid.y);
          graphics.beginFill(fillColor, already ? 0.2 : 0.5);
          graphics.drawRect(hoverGrid.x * GRID, hoverGrid.y * GRID, GRID, GRID);
          graphics.endFill();
        }
      };

      const overlay = new PIXI.Container();
      overlay.interactive = true;
      overlay.hitArea     = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
      canvas.app.stage.addChild(overlay);
      let hoverGrid = null;

      const onMove  = (e) => { hoverGrid = toGrid(e.data.getLocalPosition(canvas.app.stage)); redraw(hoverGrid); };
      const onClick = (e) => {
        if (e.data.button === 2) { if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); } return; }
        const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
        const idx  = selected.findIndex(g => g.x === gpos.x && g.y === gpos.y);
        if (idx >= 0) selected.splice(idx, 1); else selected.push(gpos);
        redraw(hoverGrid);
      };
      const onKeyDown = (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(null); }
        if (e.key === 'Enter')  { cleanup(); resolve(selected); }
      };
      const onContextMenu = (e) => { e.preventDefault(); };
      let wbNotif = null;
      const cleanup = () => {
        overlay.off('pointermove', onMove);
        overlay.off('pointerdown', onClick);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('contextmenu', onContextMenu);
        canvas.app.stage.removeChild(overlay);
        canvas.app.stage.removeChild(graphics);
        graphics.destroy();
        overlay.destroy();
        if (wbNotif) { ui.notifications.remove(wbNotif); wbNotif = null; }
      };

      overlay.on('pointermove', onMove);
      overlay.on('pointerdown', onClick);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('contextmenu', onContextMenu);
      redraw(null);
      wbNotif = ui.notifications.info(game.i18n.format('DSCT.notice.wb.squareSelectMode', { mode: this._mode }), { permanent: true });
    });
  }

  async _inspect() {
    const GRID = getGRID();
    const graphics = new PIXI.Graphics();
    canvas.app.stage.addChild(graphics);

    const tooltip = document.createElement('div');
    tooltip.className = 'dsct-inspect-tooltip';
    document.body.appendChild(tooltip);

    const overlay = new PIXI.Container();
    overlay.interactive = true;
    overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
    canvas.app.stage.addChild(overlay);

    const drawAll = (hoverGpos = null) => {
      graphics.clear();
      for (const t of canvas.tiles.placeables) {
        if (!hasTags(t, 'obstacle')) continue;
        const tg       = toGrid(t.document);
        const isBroken = hasTags(t, 'broken');
        const color    = isBroken ? 0xcc4444 : 0xaaaaff;
        graphics.beginFill(color, 0.12);
        graphics.lineStyle(1, color, 0.45);
        graphics.drawRect(tg.x * GRID, tg.y * GRID, GRID, GRID);
        graphics.endFill();
        graphics.lineStyle(0);
      }
      if (hoverGpos) {
        graphics.beginFill(0xaaaaff, 0.28);
        graphics.drawRect(hoverGpos.x * GRID, hoverGpos.y * GRID, GRID, GRID);
        graphics.endFill();
      }
    };

    const onMove = (e) => {
      const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
      drawAll(gpos);
      const tile = canvas.tiles.placeables.find(t => {
        if (!hasTags(t, 'obstacle')) return false;
        const tg = toGrid(t.document);
        return tg.x === gpos.x && tg.y === gpos.y;
      });
      if (tile) {
        const tags        = getTags(tile);
        const mat         = tags.find(t => getAllMaterials().includes(t)) ?? '(none)';
        const blockTag    = tags.find(t => t.startsWith('wall-block-')) ?? null;
        const walls       = blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];
        const bottom      = walls[0]?.flags?.['wall-height']?.bottom ?? '-';
        const top         = walls[0]?.flags?.['wall-height']?.top    ?? '-';
        const isBroken    = hasTags(tile, 'broken');
        const isPartial   = hasTags(tile, 'partially-broken');
        const isStable    = hasTags(tile, 'stable');
        const damagedTag  = tags.find(t => t.startsWith('damaged:'));
        const damagedN    = damagedTag ? parseInt(damagedTag.split(':')[1]) : 0;
        const status      = isBroken ? 'Broken' : isPartial ? `Partially Broken (${damagedN} sq off top)` : 'Intact';
        tooltip.textContent = `Material : ${mat}\nHeight   : ${bottom} � ${top}\nStatus   : ${status}\nStable   : ${isStable ? 'Yes' : 'No'}\nTag      : ${blockTag ?? '(none)'}`;
        tooltip.style.display = 'block';
      } else {
        tooltip.style.display = 'none';
      }
      const ev = e.data.originalEvent;
      if (ev) { tooltip.style.left = `${ev.clientX + 14}px`; tooltip.style.top = `${ev.clientY + 14}px`; }
    };

    return new Promise((resolve) => {
      const cleanup = () => {
        this._stopInspect = null;
        overlay.off('pointermove', onMove);
        overlay.off('pointerdown', onPointerDown);
        document.removeEventListener('keydown', onKeyDown);
        canvas.app.stage.removeChild(overlay);
        canvas.app.stage.removeChild(graphics);
        graphics.destroy();
        overlay.destroy();
        tooltip.remove();
        this._refreshPanel();
      };

      const onKeyDown    = (e) => { if (e.key === 'Escape') { cleanup(); resolve(); } };
      const onPointerDown = (e) => { if (e.data.button === 2 && getSetting('cancelOnRightClick')) { cleanup(); resolve(); } };

      this._stopInspect = () => { cleanup(); resolve(); };
      this._refreshPanel(); 

      overlay.on('pointermove', onMove);
      overlay.on('pointerdown', onPointerDown);
      document.addEventListener('keydown', onKeyDown);
      drawAll(); 
      ui.notifications.info(game.i18n.localize('DSCT.notice.wb.inspectMode'));
    });
  }

  async _execute() {
    if (this._mode === 'inspect') {
      if (this._stopInspect) { this._stopInspect(); return; }
      await this._inspect();
      return;
    }
    if (this._mode === 'convert') {
      await convertWalls(this._material, this._heightBottom, this._heightTop, this._invisible, true, this._retainRestrictions);
      return;
    }
    const squares = await this._selectSquares(this._mode !== 'build');
    if (!squares || squares.length === 0) { ui.notifications.info(game.i18n.localize('DSCT.notice.wb.cancelled')); return; }

    const undoOps = [];

    if (this._mode === 'build') {
      for (const { x, y } of squares) {
        const existing = tileAt(x, y);
        if (existing && hasTags(existing, 'obstacle')) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.squareAlreadyHasWall', { x, y })); continue; }
        const { tileId } = await placeBlock(x, y, this._material, this._heightBottom, this._heightTop, this._stable);
        undoOps.push(async () => { const tile = canvas.tiles.get(tileId); if (tile) await destroyBlock(tile); });
      }
      
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info(game.i18n.localize('DSCT.notice.wb.wallBuildUndone')); } : null;
      ui.notifications.info(game.i18n.format('DSCT.notice.wb.wallPlaced', { count: undoOps.length, s: undoOps.length !== 1 ? 's' : '' }));
    }

    else if (this._mode === 'destroy') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || !hasTags(tile, 'obstacle')) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.noWallAtSquare', { x, y })); continue; }
        await destroyBlock(tile);
      }
      ui.notifications.info(game.i18n.format('DSCT.notice.wb.wallDestroyed', { count: squares.length, s: squares.length !== 1 ? 's' : '' }));
    }

    else if (this._mode === 'fix') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || (!hasTags(tile, 'broken') && !hasTags(tile, 'partially-broken'))) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.noBrokenWallAtSquare', { x, y })); continue; }
        const blockTag     = getBlockTag(tile);
        const walls        = blockTag ? getBlockWalls(blockTag) : [];
        const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
        await fixBlock(tile);
        undoOps.push(async () => {
          await addTags(tile, ['broken']);
          for (const { wall, restrict } of prevWallData) { await wall.update(restrict); await addTags(wall, ['broken']); }
        });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info(game.i18n.localize('DSCT.notice.wb.wallFixUndone')); } : null;
      ui.notifications.info(game.i18n.format('DSCT.notice.wb.wallFixed', { count: undoOps.length, s: undoOps.length !== 1 ? 's' : '' }));
    }

    else if (this._mode === 'break') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || !hasTags(tile, 'obstacle')) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.noWallAtSquare', { x, y })); continue; }
        if (hasTags(tile, 'broken')) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.wallAlreadyBroken', { x, y })); continue; }
        const blockTag = getBlockTag(tile);

        const wallsBefore  = blockTag ? getBlockWalls(blockTag) : [];
        const wallsSaved   = wallsBefore.map(w => ({
          wall: w, c: [...w.c], tags: getTags(w),
          restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound },
        }));
        const prevSrc    = tile.document.texture.src;
        const prevAlpha  = tile.document.alpha;

        const outsideSegs = blockTag ? await splitBlockWallsAtTile(x, y, blockTag) : [];
        const outsideIds  = outsideSegs.map(s => s.id);

        await breakBlock(tile);

        undoOps.push(async () => {
          await removeTags(tile, ['broken']);
          await tile.document.update({ 'texture.src': prevSrc, alpha: prevAlpha });
          for (const id of outsideIds) {
            const w = canvas.scene.walls.get(id);
            if (w) await w.delete();
          }
          for (const { wall, c, tags, restrict } of wallsSaved) {
            const currentTags = getTags(wall);
            const toRemove = currentTags.filter(t => !tags.includes(t));
            const toAdd    = tags.filter(t => !currentTags.includes(t) && t !== 'broken');
            await wall.update({ c, ...restrict });
            if (toRemove.length) await removeTags(wall, toRemove);
            if (toAdd.length)    await addTags(wall, toAdd);
          }
        });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info(game.i18n.localize('DSCT.notice.wb.wallBreakUndone')); } : null;
      ui.notifications.info(game.i18n.format('DSCT.notice.wb.wallBroke', { count: undoOps.length, s: undoOps.length !== 1 ? 's' : '' }));
    }

    else if (this._mode === 'transmute') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || !hasTags(tile, 'obstacle')) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.noWallAtSquare', { x, y })); continue; }
        const oldMat = getTags(tile).find(t => getAllMaterials().includes(t)) ?? null;
        await transmuteBlock(tile, this._material);
        undoOps.push(async () => { if (oldMat) await transmuteBlock(tile, oldMat); });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info(game.i18n.localize('DSCT.notice.wb.wallTransmuteUndone')); } : null;
      ui.notifications.info(game.i18n.format('DSCT.notice.wb.wallTransmuted', { count: undoOps.length, s: undoOps.length !== 1 ? 's' : '' }));
    }
  }

  _refreshPanel() {
    if (!this.rendered) return;
    const modes = ['build', 'destroy', 'fix', 'transmute', 'break', 'inspect', 'convert'];
    for (const mode of modes) {
      const btn = this.element.querySelector(`#wb-mode-${mode}`);
      if (btn) btn.classList.toggle('active', this._mode === mode);
    }
    const showMat    = this._mode === 'build' || this._mode === 'transmute' || this._mode === 'convert';
    const showHeight = this._mode === 'build' && game.modules.get('wall-height')?.active;
    this.element.querySelector('#wb-material-row')?.classList.toggle('dsct-hidden', !showMat);
    this.element.querySelector('#wb-height-row')?.classList.toggle('dsct-hidden', !showHeight);
    const execBtn = this.element.querySelector('[data-action="execute"]');
    if (execBtn) {
      execBtn.textContent = this._mode === 'inspect' && this._stopInspect ? game.i18n.localize('DSCT.panel.wb.execStopInspect')
        : this._mode === 'inspect' ? game.i18n.localize('DSCT.panel.wb.execStartInspect')
        : this._mode === 'convert' ? game.i18n.localize('DSCT.panel.wb.execConvert')
        : game.i18n.localize('DSCT.panel.wb.execSelect');
    }
    this.element.querySelector('#wb-convert-row')?.classList.toggle('dsct-hidden', this._mode !== 'convert');
    const matSel = this.element.querySelector('#wb-material-select');
    if (matSel) matSel.value = this._material;
  }

  async _prepareContext(_options) {
    const showMat    = this._mode === 'build' || this._mode === 'transmute' || this._mode === 'convert';
    const showHeight = this._mode === 'build' && game.modules.get('wall-height')?.active;
    return {
      buildActive:        this._mode === 'build',
      destroyActive:      this._mode === 'destroy',
      fixActive:          this._mode === 'fix',
      transmuteActive:    this._mode === 'transmute',
      breakActive:        this._mode === 'break',
      inspectActive:      this._mode === 'inspect',
      convertActive:      this._mode === 'convert',
      showMat,
      showHeight,
      invisible:          this._invisible,
      retainRestrictions: this._retainRestrictions,
      stable:             this._stable,
      heightBottom:       this._heightBottom,
      heightTop:          this._heightTop,
      materialOptions:    getAllMaterials().map(mat => ({
        value: mat, label: mat.charAt(0).toUpperCase() + mat.slice(1), selected: this._material === mat,
      })),
      execLabel: this._mode === 'inspect' && this._stopInspect ? game.i18n.localize('DSCT.panel.wb.execStopInspect')
        : this._mode === 'inspect' ? game.i18n.localize('DSCT.panel.wb.execStartInspect')
        : this._mode === 'convert' ? game.i18n.localize('DSCT.panel.wb.execConvert')
        : game.i18n.localize('DSCT.panel.wb.execSelect'),
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);

    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    this.element.addEventListener('input', e => {
      if (e.target.matches('#wb-height-bottom')) { this._heightBottom = e.target.value === '' ? '' : parseFloat(e.target.value); }
      if (e.target.matches('#wb-height-top'))    { this._heightTop    = e.target.value === '' ? '' : parseFloat(e.target.value); }
    });
    this.element.addEventListener('change', e => {
      if (e.target.matches('#wb-stable'))              { this._stable             = e.target.checked; }
      if (e.target.matches('#wb-invisible'))           { this._invisible          = e.target.checked; }
      if (e.target.matches('#wb-retain-restrictions')) { this._retainRestrictions = e.target.checked; }
      if (e.target.matches('#wb-material-select'))     { this._material           = e.target.value; }
    });
  }

  async close(options = {}) {
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}


export const MATERIAL_RULE_DEFAULTS = {
  glass: { cost: 1, damage: 3,  alpha: 0.1 },
  wood:  { cost: 3, damage: 5,  alpha: 0.8 },
  stone: { cost: 6, damage: 8,  alpha: 0.8 },
  metal: { cost: 9, damage: 11, alpha: 0.8 },
};

export const WALL_RESTRICTION_DEFAULTS = {
  glass: { move: 20, sight: 0,  light: 0,  sound: 0 },
  wood:  { move: 20, sight: 10, light: 20, sound: 0 },
  stone: { move: 20, sight: 10, light: 20, sound: 0 },
  metal: { move: 20, sight: 10, light: 20, sound: 0 },
};

const CUSTOM_MATERIAL_DEFAULTS = { cost: 3, damage: 5, alpha: 0.8, move: 20, sight: 10, light: 20, sound: 0 };
const DEFAULT_ICON = 'icons/commodities/stone/paver-brick-brown.webp';

const RESTRICT_LABELS = { 0: 'None', 10: 'Limited', 20: 'Blocked' };
const M = 'draw-steel-combat-tools';

const restrictSelect = (fieldName, currentVal, values = [0, 10, 20]) =>
  `<select name="${fieldName}" class="dsct-wb-restrict-select">${
    values.map(v => `<option value="${v}" ${currentVal === v ? 'selected' : ''}>${RESTRICT_LABELS[v]}</option>`).join('')
  }</select>`;

const buildRow = (idx, origName, isBase, iconSrc, r, rs) => {
  const icon  = iconSrc || DEFAULT_ICON;
  const alpha = r.alpha ?? CUSTOM_MATERIAL_DEFAULTS.alpha;
  return `
    <tr>
      <td>
        <button type="button" class="dsct-wb-icon-pick" data-idx="${idx}" title="Click to change icon">
          <img src="${icon}" class="dsct-wb-icon-img">
        </button>
        <input type="hidden" name="icon-${idx}"     value="${icon}">
        <input type="hidden" name="origname-${idx}" value="${origName}">
        <input type="hidden" name="isbase-${idx}"   value="${isBase}">
      </td>
      <td>
        <input type="number" name="opacity-${idx}" value="${alpha}" min="0" max="1" step="0.05"
          class="dsct-wb-num-input">
      </td>
      <td>
        <input type="text" name="matname-${idx}" value="${origName}" placeholder="name" class="dsct-name-input">
      </td>
      <td>
        <input type="number" name="cost-${idx}"   value="${r.cost}"   min="1" max="20" class="dsct-wb-num-input">
      </td>
      <td>
        <input type="number" name="damage-${idx}" value="${r.damage}" min="1" max="30" class="dsct-wb-num-input">
      </td>
      <td>${restrictSelect(`move-${idx}`,  rs.move,  [0, 20])}</td>
      <td>${restrictSelect(`sight-${idx}`, rs.sight)}</td>
      <td>${restrictSelect(`light-${idx}`, rs.light)}</td>
      <td>${restrictSelect(`sound-${idx}`, rs.sound)}</td>
      <td>
        ${!isBase
          ? `<button type="button" class="dsct-delete-mat dsct-delete-btn" title="Remove material">
               <i class="fa-solid fa-trash-can"></i>
             </button>`
          : ''}
      </td>
    </tr>`;
};

export class WallBuilderSettingsMenu extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    id:       'dsct-wall-builder-settings',
    classes:  ['draw-steel'],
    window:   { title: 'Wall Builder Settings', minimizable: false, resizable: true },
    position: { width: 950, height: 'auto' },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/settings/wall-builder.hbs' },
  };

  async _prepareContext(_options) {
    const customs          = getCustomMaterials();
    const allMaterials     = [...BASE_MATERIALS, ...customs.map(m => m.name)];
    const rules            = game.settings.get(M, 'materialRules');
    const restrictions     = game.settings.get(M, 'wallRestrictions');
    const defaultMaterial  = game.settings.get(M, 'wbDefaultMaterial');
    const defaultHeightBot = game.settings.get(M, 'wbDefaultHeightBottom');
    const defaultHeightTop = game.settings.get(M, 'wbDefaultHeightTop');
    return {
      rowsHTML:   this._buildRows(allMaterials, customs, rules, restrictions),
      matOptions: allMaterials.map(m =>
        `<option value="${m}" ${defaultMaterial === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
      ).join(''),
      defaultMaterial,
      defaultHeightBot,
      defaultHeightTop,
      rubbleInvisible: game.settings.get(M, 'rubbleInvisible'),
      showScroll: allMaterials.length >= 6,
    };
  }

  _buildRows(allMaterials, customs, rules, restrictions) {
    return allMaterials.map((mat, idx) => {
      const isBase  = BASE_MATERIALS.includes(mat);
      const custom  = customs.find(m => m.name === mat);
      const iconSrc = isBase ? getMaterialIcon(mat) : (custom?.icon || '');
      const rBase   = rules[mat]        ?? MATERIAL_RULE_DEFAULTS.stone;
      const r       = { ...rBase, alpha: rBase.alpha ?? getMaterialAlpha(mat) };
      const rs      = restrictions[mat] ?? WALL_RESTRICTION_DEFAULTS.stone;
      return buildRow(idx, mat, isBase, iconSrc, r, rs);
    }).join('');
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
    const el = this.element;

    el.addEventListener('click', e => {
      const pickBtn = e.target.closest('.dsct-wb-icon-pick');
      if (pickBtn) {
        const idx = pickBtn.dataset.idx;
        new FilePicker({
          type:     'imagevideo',
          current:  el.querySelector(`[name="icon-${idx}"]`)?.value || '',
          callback: (path) => {
            el.querySelector(`[name="icon-${idx}"]`).value = path;
            pickBtn.querySelector('img').src = path;
          },
        }).browse();
        return;
      }

      const delBtn = e.target.closest('.dsct-delete-mat');
      if (delBtn) delBtn.closest('tr').remove();
    });

    el.querySelector('#dsct-wb-add-mat-btn')?.addEventListener('click', () => {
      const tbody = el.querySelector('#dsct-wb-mat-tbody');
      const rows  = [...tbody.querySelectorAll('tr')];
      const maxIdx = Math.max(-1, ...rows.map(tr => {
        const inp = tr.querySelector('[name^="origname-"]');
        return inp ? (parseInt(inp.name.replace('origname-', '')) || 0) : -1;
      }));
      tbody.innerHTML += buildRow(maxIdx + 1, '', false, DEFAULT_ICON, MATERIAL_RULE_DEFAULTS.stone, WALL_RESTRICTION_DEFAULTS.stone);
    });

    el.querySelector('#dsct-wb-reset-btn')?.addEventListener('click', async () => {
      await game.settings.set(M, 'materialRules',         foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS));
      await game.settings.set(M, 'wallRestrictions',      foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS));
      await game.settings.set(M, 'customMaterials',       []);
      await game.settings.set(M, 'wbDefaultMaterial',     'stone');
      await game.settings.set(M, 'wbDefaultHeightBottom', '');
      await game.settings.set(M, 'wbDefaultHeightTop',    '');
      await game.settings.set(M, 'rubbleInvisible',       false);
      ui.notifications.info(game.i18n.localize('DSCT.notice.wb.settingsReset'));
      this.render({ force: true });
    });

    el.querySelector('#dsct-wb-save-btn')?.addEventListener('click', async () => {
      await this._doSave();
      this.close();
    });
  }

  async _doSave() {
    const el    = this.element;
    const intOr = (v, def) => { const n = parseInt(v); return isNaN(n) ? def : n; };

    const indices = [];
    el.querySelectorAll('#dsct-wb-mat-tbody tr').forEach(tr => {
      const inp = tr.querySelector('[name^="origname-"]');
      if (inp) indices.push(parseInt(inp.name.replace('origname-', '')));
    });

    const newRules        = {};
    const newRestrictions = {};
    const newCustoms      = [];
    const seenNames       = new Set();

    for (const i of indices) {
      const origName = el.querySelector(`[name="origname-${i}"]`)?.value ?? '';
      const isBase   = el.querySelector(`[name="isbase-${i}"]`)?.value   === 'true';
      const rawName  = (el.querySelector(`[name="matname-${i}"]`)?.value ?? origName).trim();
      const name     = rawName || origName;
      if (!name) continue;
      if (seenNames.has(name)) { ui.notifications.warn(game.i18n.format('DSCT.notice.wb.duplicateMaterial', { name })); continue; }
      seenNames.add(name);

      const rawAlpha = parseFloat(el.querySelector(`[name="opacity-${i}"]`)?.value);
      newRules[name] = {
        cost:   intOr(el.querySelector(`[name="cost-${i}"]`)?.value,   MATERIAL_RULE_DEFAULTS.stone.cost),
        damage: intOr(el.querySelector(`[name="damage-${i}"]`)?.value, MATERIAL_RULE_DEFAULTS.stone.damage),
        alpha:  isNaN(rawAlpha) ? CUSTOM_MATERIAL_DEFAULTS.alpha : Math.min(1, Math.max(0, rawAlpha)),
      };
      newRestrictions[name] = {
        move:  intOr(el.querySelector(`[name="move-${i}"]`)?.value,  WALL_RESTRICTION_DEFAULTS.stone.move),
        sight: intOr(el.querySelector(`[name="sight-${i}"]`)?.value, WALL_RESTRICTION_DEFAULTS.stone.sight),
        light: intOr(el.querySelector(`[name="light-${i}"]`)?.value, WALL_RESTRICTION_DEFAULTS.stone.light),
        sound: intOr(el.querySelector(`[name="sound-${i}"]`)?.value, WALL_RESTRICTION_DEFAULTS.stone.sound),
      };
      if (!isBase) newCustoms.push({ name, icon: el.querySelector(`[name="icon-${i}"]`)?.value || '' });
    }

    await game.settings.set(M, 'materialRules',         newRules);
    await game.settings.set(M, 'wallRestrictions',      newRestrictions);
    await game.settings.set(M, 'customMaterials',       newCustoms);
    await game.settings.set(M, 'wbDefaultMaterial',     el.querySelector('[name="defaultMaterial"]')?.value  ?? 'stone');
    await game.settings.set(M, 'wbDefaultHeightBottom', el.querySelector('[name="defaultHeightBot"]')?.value ?? '');
    await game.settings.set(M, 'wbDefaultHeightTop',    el.querySelector('[name="defaultHeightTop"]')?.value ?? '');
    await game.settings.set(M, 'rubbleInvisible',       el.querySelector('[name="rubbleInvisible"]')?.checked ?? false);

    ui.notifications.info(game.i18n.localize('DSCT.notice.wb.settingsSaved'));
  }
}