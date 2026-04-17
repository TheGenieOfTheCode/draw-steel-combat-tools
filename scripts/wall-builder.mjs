import {
  MATERIAL_ICONS, WALL_RESTRICTIONS,
  BASE_MATERIALS, getCustomMaterials,
  getMaterial, getMaterialIcon, getMaterialAlpha, getAllMaterials,
  tileAt,
  hasTags, getTags, getByTag, addTags, removeTags,
  toGrid, toWorld, GRID as getGRID, getSetting,
  s, palette, injectPanelChrome,
} from './helpers.mjs';

const { Application: ApplicationV2 } = foundry.applications.api;

const BASE_MAT_COLORS = { glass: 0x88ddff, wood: 0xaa6622, stone: 0x888888, metal: 0x4488aa };
const MATERIAL_COLORS = BASE_MAT_COLORS;
const MODE_COLORS     = { build: 0x44cc44, destroy: 0xcc4444, fix: 0x44aacc, transmute: 0xcc8800, break: 0xff6600, inspect: 0xaaaaff };


const getBlockTag   = (obj) => getTags(obj).find(t => t.startsWith('wall-block-'));
const getBlockWalls = (blockTag) => blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];

// -- Wall Converter Geometry --

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
    ui.notifications.warn('Select at least one wall first.');
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

  ui.notifications.info(`Selected ${visited.size} connected wall${visited.size !== 1 ? 's' : ''}.`);
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
    const pwMat = (pw.flags?.tagger?.tags ?? []).find(t => getAllMaterials().includes(t));
    if (pwMat === 'glass') continue;
    const targetSight = WALL_RESTRICTIONS()[pwMat ?? 'stone']?.sight ?? 10;
    if (pw.sight !== targetSight) await pw.update({ sight: targetSight });
  }
};

const suppressOverlappingSight = async (wall) => {
  const wallMat = (wall.flags?.tagger?.tags ?? []).find(t => getAllMaterials().includes(t));
  if (wallMat === 'glass') return;
  const [x1, y1, x2, y2] = wall.c;
  const partners = canvas.scene.walls.contents.filter(w =>
    w.id !== wall.id &&
    !(w.flags?.tagger?.tags ?? []).includes('broken') &&
    ((w.c[0] === x1 && w.c[1] === y1 && w.c[2] === x2 && w.c[3] === y2) ||
     (w.c[0] === x2 && w.c[1] === y2 && w.c[2] === x1 && w.c[3] === y1))
  );
  if (partners.length === 0) return;
  if (wall.sight !== 0) await wall.update({ sight: 0 });
  for (const pw of partners) {
    const pwMat = (pw.flags?.tagger?.tags ?? []).find(t => getAllMaterials().includes(t));
    if (pwMat === 'glass') continue;
    if (pw.sight !== 0) await pw.update({ sight: 0 });
  }
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
  const brokenAlpha = (hasTags(tile, 'invisible') && getSetting('keepInvisibleWhenBroken')) ? 0 : 0.8;
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
  const fixedAlpha = hasTags(tile, 'invisible') ? 0 : getMaterialAlpha(material);
  await tile.document.update({ 'texture.src': getMaterialIcon(material), alpha: fixedAlpha });
  await removeTags(tile, ['broken', 'partially-broken']);
  if (damagedTag) await removeTags(tile, [damagedTag]);
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
  }
};

// -- Wall Converter --

export const convertWalls = async (material = 'stone', heightBottom = '', heightTop = '', invisible = true, stable = true, retainRestrictions = false) => {
  if (!game.user.isGM) { ui.notifications.warn('Only the GM can convert walls.'); return; }
  const GRID  = getGRID();
  const walls = [...(canvas.walls.controlled ?? [])].map(w => w.document ?? w);
  if (!walls.length) {
    ui.notifications.warn('No walls selected. Switch to the Walls layer, select walls, then click Convert.');
    return;
  }

  for (const wall of walls) {
    const existing = getTags(wall);
    if (existing.length) await removeTags(wall, existing);
  }

  const squareTileMap = new Map();

  for (const wall of walls) {
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
          squareTileMap.set(key, { gx, gy, blockId });
          continue;
        }
      }
      squareTileMap.set(key, { gx, gy, blockId: null }); 
    }
  }

  for (const [, entry] of squareTileMap) {
    if (entry.blockId) continue;
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

  for (const wall of walls) {
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

  ui.notifications.info(
    `Converted ${walls.length} wall(s): ${squareTileMap.size} tile(s) created/linked, ${wallsStubbed} stub(s) disabled.`
  );
};

export class WallBuilderPanel extends ApplicationV2 {
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

  static DEFAULT_OPTIONS = {
    id: 'wall-builder-panel',
    classes: ['draw-steel'],
    window: { title: 'Wall Builder', minimizable: false, resizable: false },
    position: { width: s(240), height: 'auto' },
  };

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
        const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
        const idx  = selected.findIndex(g => g.x === gpos.x && g.y === gpos.y);
        if (idx >= 0) selected.splice(idx, 1); else selected.push(gpos);
        redraw(hoverGrid);
      };
      const onKeyDown = (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(null); }
        if (e.key === 'Enter')  { cleanup(); resolve(selected); }
      };
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
      ui.notifications.info(`Select squares for ${this._mode}. Click to toggle, Enter to confirm, Escape to cancel.`);
    });
  }

  async _inspect() {
    const GRID = getGRID();
    const p    = palette();
    const graphics = new PIXI.Graphics();
    canvas.app.stage.addChild(graphics);

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `position:fixed;pointer-events:none;z-index:9999;background:${p.bg};border:1px solid ${p.border};color:${p.text};font-family:Georgia,serif;font-size:${s(9)}px;padding:${s(6)}px ${s(8)}px;border-radius:${s(3)}px;white-space:pre;display:none;line-height:1.6;`;
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
      const onPointerDown = (e) => { if (e.data.button === 2) { cleanup(); resolve(); } };

      this._stopInspect = () => { cleanup(); resolve(); };
      this._refreshPanel(); 

      overlay.on('pointermove', onMove);
      overlay.on('pointerdown', onPointerDown);
      document.addEventListener('keydown', onKeyDown);
      drawAll(); 
      ui.notifications.info('Inspect: hover tiles to see info. Right-click, Escape, or Stop Inspecting to exit.');
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
    if (!squares || squares.length === 0) { ui.notifications.info('Cancelled.'); return; }

    const undoOps = [];

    if (this._mode === 'build') {
      for (const { x, y } of squares) {
        const existing = tileAt(x, y);
        if (existing && hasTags(existing, 'obstacle')) { ui.notifications.warn(`Square (${x},${y}) already has a wall block, skipping.`); continue; }
        const { tileId } = await placeBlock(x, y, this._material, this._heightBottom, this._heightTop, this._stable);
        undoOps.push(async () => { const tile = canvas.tiles.get(tileId); if (tile) await destroyBlock(tile); });
      }
      // Single-slot undo. Build twice and the first operation is gone forever. A real undo stack would be nice but 95% of the time you only want to undo the last thing.
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info('Wall build undone.'); } : null;
      ui.notifications.info(`Placed ${undoOps.length} wall block${undoOps.length !== 1 ? 's' : ''}.`);
    }

    else if (this._mode === 'destroy') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || !hasTags(tile, 'obstacle')) { ui.notifications.warn(`No wall block at (${x},${y}).`); continue; }
        await destroyBlock(tile);
      }
      ui.notifications.info(`Destroyed ${squares.length} wall block${squares.length !== 1 ? 's' : ''}.`);
    }

    else if (this._mode === 'fix') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || (!hasTags(tile, 'broken') && !hasTags(tile, 'partially-broken'))) { ui.notifications.warn(`No broken wall block at (${x},${y}).`); continue; }
        const blockTag     = getBlockTag(tile);
        const walls        = blockTag ? getBlockWalls(blockTag) : [];
        const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
        await fixBlock(tile);
        undoOps.push(async () => {
          await addTags(tile, ['broken']);
          for (const { wall, restrict } of prevWallData) { await wall.update(restrict); await addTags(wall, ['broken']); }
        });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info('Wall fix undone.'); } : null;
      ui.notifications.info(`Fixed ${undoOps.length} wall block${undoOps.length !== 1 ? 's' : ''}.`);
    }

    else if (this._mode === 'break') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || !hasTags(tile, 'obstacle')) { ui.notifications.warn(`No wall block at (${x},${y}).`); continue; }
        if (hasTags(tile, 'broken')) { ui.notifications.warn(`Wall at (${x},${y}) is already broken.`); continue; }
        const blockTag     = getBlockTag(tile);
        const walls        = blockTag ? getBlockWalls(blockTag) : [];
        const prevWallData = walls.map(w => ({ wall: w, restrict: { move: w.move, sight: w.sight, light: w.light, sound: w.sound } }));
        const prevSrc      = tile.document.texture.src;
        const prevAlpha    = tile.document.alpha;
        await breakBlock(tile);
        undoOps.push(async () => {
          await removeTags(tile, ['broken']);
          await tile.document.update({ 'texture.src': prevSrc, alpha: prevAlpha });
          for (const { wall, restrict } of prevWallData) { await wall.update(restrict); await removeTags(wall, ['broken']); }
        });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info('Wall break undone.'); } : null;
      ui.notifications.info(`Broke ${undoOps.length} wall block${undoOps.length !== 1 ? 's' : ''}.`);
    }

    else if (this._mode === 'transmute') {
      for (const { x, y } of squares) {
        const tile = tileAt(x, y);
        if (!tile || !hasTags(tile, 'obstacle')) { ui.notifications.warn(`No wall block at (${x},${y}).`); continue; }
        const oldMat = getTags(tile).find(t => getAllMaterials().includes(t)) ?? null;
        await transmuteBlock(tile, this._material);
        undoOps.push(async () => { if (oldMat) await transmuteBlock(tile, oldMat); });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info('Wall transmute undone.'); } : null;
      ui.notifications.info(`Transmuted ${undoOps.length} wall block${undoOps.length !== 1 ? 's' : ''}.`);
    }
  }

  _refreshPanel() {
    if (!this.rendered) return;
    const p = palette();
    const modes = ['build', 'destroy', 'fix', 'transmute', 'break', 'inspect', 'convert'];
    for (const mode of modes) {
      const btn = this.element.querySelector(`#wb-mode-${mode}`);
      if (btn) { btn.style.borderColor = this._mode === mode ? p.accent : p.border; btn.style.color = this._mode === mode ? p.accent : p.text; }
    }
    const showMat    = this._mode === 'build' || this._mode === 'transmute' || this._mode === 'convert';
    const showHeight = this._mode === 'build' && game.modules.get('wall-height')?.active;
    const matRow = this.element.querySelector('#wb-material-row');
    if (matRow) matRow.style.display = showMat ? 'flex' : 'none';
    const heightRow = this.element.querySelector('#wb-height-row');
    if (heightRow) heightRow.style.display = showHeight ? 'flex' : 'none';
    const execBtn = this.element.querySelector('[data-action="execute"]');
    if (execBtn) {
      execBtn.textContent = this._mode === 'inspect' && this._stopInspect ? 'Stop Inspecting'
        : this._mode === 'inspect' ? 'Start Inspect'
        : this._mode === 'convert' ? 'Convert Selected Walls'
        : 'Select Squares';
    }
    const convertRow = this.element.querySelector('#wb-convert-row');
    if (convertRow) convertRow.style.display = this._mode === 'convert' ? 'flex' : 'none';
    const matSel = this.element.querySelector('#wb-material-select');
    if (matSel) matSel.value = this._material;
  }

  async _renderHTML(_context, _options) {
    injectPanelChrome(this.options.id);
    const p = palette();

    return `
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;" id="wb-drag-handle">
        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Wall Builder</div>
          <button data-action="close-window" style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;margin-left:auto;background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;" onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;color:${p.textDim};margin-bottom:${s(4)}px;">Mode</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:${s(3)}px;margin-bottom:${s(8)}px;">
          <button id="wb-mode-build"     data-mode="build"     style="padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='build'?p.accent:p.border};color:${this._mode==='build'?p.accent:p.text};">Build</button>
          <button id="wb-mode-destroy"   data-mode="destroy"   style="padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='destroy'?p.accent:p.border};color:${this._mode==='destroy'?p.accent:p.text};">Destroy</button>
          <button id="wb-mode-fix"       data-mode="fix"       style="padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='fix'?p.accent:p.border};color:${this._mode==='fix'?p.accent:p.text};">Fix</button>
          <button id="wb-mode-transmute" data-mode="transmute" style="padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='transmute'?p.accent:p.border};color:${this._mode==='transmute'?p.accent:p.text};">Transmute</button>
          <button id="wb-mode-break"     data-mode="break"     style="padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='break'?p.accent:p.border};color:${this._mode==='break'?p.accent:p.text};">Break</button>
          <button id="wb-mode-inspect"   data-mode="inspect"   style="padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='inspect'?p.accent:p.border};color:${this._mode==='inspect'?p.accent:p.text};">Inspect</button>
          <button id="wb-mode-convert"   data-mode="convert"   style="grid-column:span 2;padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._mode==='convert'?p.accent:p.border};color:${this._mode==='convert'?p.accent:p.text};">Convert Walls</button>
        </div>

        <div id="wb-convert-row" style="display:${this._mode==='convert'?'flex':'none'};flex-direction:column;gap:${s(5)}px;margin-bottom:${s(8)}px;">
          <div style="display:flex;align-items:center;gap:${s(6)}px;">
            <input id="wb-invisible" type="checkbox" ${this._invisible ? 'checked' : ''} style="width:${s(12)}px;height:${s(12)}px;accent-color:${p.accent};cursor:pointer;">
            <label for="wb-invisible" style="font-size:${s(9)}px;color:${p.text};cursor:pointer;">Invisible tiles (alpha 0)</label>
          </div>
          <div style="display:flex;align-items:center;gap:${s(6)}px;">
            <input id="wb-retain-restrictions" type="checkbox" ${this._retainRestrictions ? 'checked' : ''} style="width:${s(12)}px;height:${s(12)}px;accent-color:${p.accent};cursor:pointer;">
            <label for="wb-retain-restrictions" style="font-size:${s(9)}px;color:${p.text};cursor:pointer;">Retain wall restrictions on fix</label>
          </div>
        </div>

        <div id="wb-material-row" style="display:${(this._mode==='build'||this._mode==='transmute')?'flex':'none'};flex-direction:column;gap:${s(4)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(8)}px;text-transform:uppercase;color:${p.textDim};">Material</div>
          <select id="wb-material-select" style="width:100%;padding:${s(4)}px;border-radius:${s(3)}px;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${p.border};color:${p.text};cursor:pointer;text-transform:capitalize;">
            ${getAllMaterials().map(mat => `<option value="${mat}" ${this._material===mat?'selected':''} style="text-transform:capitalize;">${mat.charAt(0).toUpperCase()+mat.slice(1)}</option>`).join('')}
          </select>
        </div>

        <div id="wb-height-row" style="display:${this._mode==='build' && game.modules.get('wall-height')?.active ?'flex':'none'};flex-direction:column;gap:${s(4)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(8)}px;text-transform:uppercase;color:${p.textDim};">Wall Height</div>
          <div style="display:flex;gap:${s(6)}px;align-items:center;">
            <div style="flex:1;">
              <div style="font-size:${s(7)}px;color:${p.textDim};margin-bottom:${s(2)}px;">Bottom</div>
              <input id="wb-height-bottom" type="number" value="${this._heightBottom}" style="width:100%;padding:${s(3)}px;border-radius:${s(2)}px;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${p.border};color:${p.text};box-sizing:border-box;" placeholder="default">
            </div>
            <div style="flex:1;">
              <div style="font-size:${s(7)}px;color:${p.textDim};margin-bottom:${s(2)}px;">Top</div>
              <input id="wb-height-top" type="number" value="${this._heightTop}" style="width:100%;padding:${s(3)}px;border-radius:${s(2)}px;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${p.border};color:${p.text};box-sizing:border-box;" placeholder="default">
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:${s(6)}px;">
            <input id="wb-stable" type="checkbox" ${this._stable ? 'checked' : ''} style="width:${s(12)}px;height:${s(12)}px;accent-color:${p.accent};cursor:pointer;">
            <label for="wb-stable" style="font-size:${s(9)}px;color:${p.text};cursor:pointer;">Stable (splits on mid-height collision)</label>
          </div>
        </div>

        <button data-action="execute" style="width:100%;padding:${s(6)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(10)}px;background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">Select Squares</button>
      </div>`;
  }

  _replaceHTML(result, content, _options) {
    content.innerHTML = result;
  }

  _onRender(_context, _options) {
    const saved = window._wallBuilderPanelPos;
    if (saved) this.setPosition({ left: saved.left, top: saved.top });
    else this.setPosition({ left: Math.round((window.innerWidth - s(240)) / 2), top: Math.round((window.innerHeight - s(400)) / 2) });

    const dragHandle = this.element.querySelector('#wb-drag-handle');
    if (dragHandle) {
      dragHandle.addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
        e.preventDefault();
        const startX = e.clientX - this.position.left;
        const startY = e.clientY - this.position.top;
        const onMove = ev => this.setPosition({ left: ev.clientX - startX, top: ev.clientY - startY });
        const onUp   = () => {
          window._wallBuilderPanelPos = { left: this.position.left, top: this.position.top };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

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
    this.element.addEventListener('click', async e => {
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn) { this._mode = modeBtn.dataset.mode; this._refreshPanel(); return; }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'close-window') { this.close(); return; }
      if (action === 'execute')      { await this._execute(); return; }
    });
  }

  async close(options = {}) {
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

// -- Wall Builder Settings --


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
  `<select name="${fieldName}" style="width:90px;">${
    values.map(v => `<option value="${v}" ${currentVal === v ? 'selected' : ''}>${RESTRICT_LABELS[v]}</option>`).join('')
  }</select>`;

const buildRow = (idx, origName, isBase, iconSrc, r, rs, p) => {
  const icon  = iconSrc || DEFAULT_ICON;
  const alpha = r.alpha ?? CUSTOM_MATERIAL_DEFAULTS.alpha;
  return `
    <tr>
      <td style="text-align:center;padding:4px 6px;">
        <button type="button" class="dsct-icon-pick" data-idx="${idx}" title="Click to change icon"
          style="width:34px;height:34px;padding:2px;border-radius:3px;cursor:pointer;
                 background:${p.bgBtn};border:1px solid ${p.border};
                 display:inline-flex;align-items:center;justify-content:center;">
          <img src="${icon}" style="width:28px;height:28px;object-fit:contain;pointer-events:none;border-radius:2px;">
        </button>
        <input type="hidden" name="icon-${idx}"     value="${icon}">
        <input type="hidden" name="origname-${idx}" value="${origName}">
        <input type="hidden" name="isbase-${idx}"   value="${isBase}">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="number" name="opacity-${idx}" value="${alpha}" min="0" max="1" step="0.05"
          style="width:52px;text-align:center;">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="text" name="matname-${idx}" value="${origName}" placeholder="name�"
          style="width:100%;box-sizing:border-box;text-align:center;background:${p.bgBtn};border:1px solid ${p.border};
                 color:${p.accent};font-weight:bold;border-radius:3px;padding:4px 6px;">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="number" name="cost-${idx}"   value="${r.cost}"   min="1" max="20" style="width:52px;text-align:center;">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="number" name="damage-${idx}" value="${r.damage}" min="1" max="30" style="width:52px;text-align:center;">
      </td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`move-${idx}`,  rs.move,  [0, 20])}</td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`sight-${idx}`, rs.sight)}</td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`light-${idx}`, rs.light)}</td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`sound-${idx}`, rs.sound)}</td>
      <td style="text-align:center;padding:4px 6px;">
        ${!isBase
          ? `<button type="button" class="dsct-delete-mat" title="Remove material"
               style="padding:3px 8px;border-radius:3px;cursor:pointer;background:${p.bgBtn};
                      border:1px solid ${p.border};color:${p.textDim};">
               <i class="fa-solid fa-trash-can"></i>
             </button>`
          : ''}
      </td>
    </tr>`;
};

export class WallBuilderSettingsMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:         'Wall Builder Settings',
      id:            'dsct-wall-builder-settings',
      width:         950,
      height:        'auto',
      closeOnSubmit: true,
    });
  }

  getData() {
    const customs = getCustomMaterials();
    return {
      allMaterials:    [...BASE_MATERIALS, ...customs.map(m => m.name)],
      customs,
      rules:           game.settings.get(M, 'materialRules'),
      restrictions:    game.settings.get(M, 'wallRestrictions'),
      defaultMaterial: game.settings.get(M, 'wbDefaultMaterial'),
      defaultHeightBot: game.settings.get(M, 'wbDefaultHeightBottom'),
      defaultHeightTop: game.settings.get(M, 'wbDefaultHeightTop'),
    };
  }

  async _renderInner(data) {
    const { allMaterials, customs, rules, restrictions, defaultMaterial, defaultHeightBot, defaultHeightTop } = data;
    const p = palette();

    const styleId = 'dsct-wbs-style';
    const styleEl = document.getElementById(styleId)
      ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    styleEl.textContent = `
      #dsct-wall-builder-settings .window-content { background:${p.bg}; color:${p.text}; font-family:Georgia,serif; }
      #dsct-wall-builder-settings { border:1px solid ${p.borderOuter}; box-shadow:0 0 14px rgba(0,0,0,0.45); }
      #dsct-wall-builder-settings .window-header { background:${p.bg}; border-bottom:1px solid ${p.border}; color:${p.accent}; }
      #dsct-wall-builder-settings .window-header a { color:${p.textDim}; }
      #dsct-wall-builder-settings .window-header a:hover { color:${p.text}; }
      #dsct-wall-builder-settings input[type="number"],
      #dsct-wall-builder-settings input[type="text"],
      #dsct-wall-builder-settings select {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text}; border-radius:3px; padding:4px 6px;
        font-family:Georgia,serif;
      }
      #dsct-wall-builder-settings input:focus,
      #dsct-wall-builder-settings select:focus { border-color:${p.accent}; outline:none; }
      #dsct-wall-builder-settings th {
        color:${p.textLabel}; text-transform:uppercase; font-size:0.75em; letter-spacing:0.6px;
        border-bottom:1px solid ${p.border}; padding:6px 8px; text-align:center; font-weight:bold;
        position:sticky; top:0; z-index:1; background:${p.bg};
      }
      #dsct-wall-builder-settings td { border-bottom:1px solid ${p.border}22; }
      #dsct-wall-builder-settings h3 {
        color:${p.accent}; border-bottom:1px solid ${p.border}; padding-bottom:5px;
        font-size:0.8em; text-transform:uppercase; letter-spacing:0.7px; margin-bottom:10px;
      }
      #dsct-wall-builder-settings .dsct-field-label {
        display:block; margin-bottom:4px; font-size:0.75em; text-transform:uppercase; letter-spacing:0.5px; color:${p.textLabel};
      }
      #dsct-wall-builder-settings button {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text};
        border-radius:3px; cursor:pointer; padding:5px 14px; font-family:Georgia,serif;
      }
      #dsct-wall-builder-settings button:hover { border-color:${p.accent}; color:${p.accent}; }
      #dsct-wall-builder-settings .dsct-delete-mat:hover { border-color:#cc4444 !important; color:#cc4444 !important; }
      #dsct-wall-builder-settings .dsct-icon-pick:hover { border-color:${p.accent} !important; }
      #dsct-wall-builder-settings #dsct-wb-save-btn { border-color:${p.accent}; color:${p.accent}; }
      #dsct-wall-builder-settings .dsct-table-scroll {
        ${allMaterials.length >= 6 ? 'max-height:270px; overflow-y:auto;' : ''}
      }
    `;

    const matRows = allMaterials.map((mat, idx) => {
      const isBase  = BASE_MATERIALS.includes(mat);
      const custom  = customs.find(m => m.name === mat);
      const iconSrc = isBase ? getMaterialIcon(mat) : (custom?.icon || '');
      const rBase   = rules[mat]        ?? MATERIAL_RULE_DEFAULTS.stone;
      const r       = { ...rBase, alpha: rBase.alpha ?? getMaterialAlpha(mat) };
      const rs      = restrictions[mat] ?? WALL_RESTRICTION_DEFAULTS.stone;
      return buildRow(idx, mat, isBase, iconSrc, r, rs, p);
    }).join('');

    const matOptions = allMaterials.map(m =>
      `<option value="${m}" ${defaultMaterial === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
    ).join('');

    return $(`<div style="padding:14px;">
      <div class="dsct-table-scroll">
        <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
          <thead>
            <tr>
              <th title="Icon shown on the canvas tile for this material.">Icon</th>
              <th title="Opacity of the canvas tile (0 = invisible, 1 = fully opaque).">Opacity</th>
              <th>Name</th>
              <th title="Squares of forced-movement momentum required to break through this material.">Break Cost</th>
              <th title="Damage dealt to a creature when they crash through this material.">Break Damage</th>
              <th title="Whether this material blocks physical movement through it.">Movement</th>
              <th title="Whether this material blocks line of sight for vision.">Vision</th>
              <th title="Whether this material blocks light from passing through.">Light</th>
              <th title="Whether this material blocks sound from passing through.">Sound</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="dsct-wb-mat-tbody">${matRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:20px;">Wall Builder Defaults</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:0.9em;">
        <div>
          <label class="dsct-field-label">Default Material</label>
          <select name="defaultMaterial" style="width:100%;">${matOptions}</select>
        </div>
        <div>
          <label class="dsct-field-label">Default Height Bottom</label>
          <input type="number" name="defaultHeightBot" value="${defaultHeightBot}" placeholder="(none)" style="width:100%;box-sizing:border-box;">
        </div>
        <div>
          <label class="dsct-field-label">Default Height Top</label>
          <input type="number" name="defaultHeightTop" value="${defaultHeightTop}" placeholder="(none)" style="width:100%;box-sizing:border-box;">
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px;">
        <button type="button" id="dsct-wb-add-mat-btn" style="flex:1;"><i class="fa-solid fa-plus"></i> Add Material</button>
        <button type="button" id="dsct-wb-reset-btn"   style="flex:1;"><i class="fa-solid fa-rotate-left"></i> Reset Defaults</button>
        <button type="button" id="dsct-wb-save-btn"    style="flex:1;"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.on('click', '.dsct-icon-pick', function () {
      const idx = $(this).data('idx');
      new FilePicker({
        type:     'imagevideo',
        current:  html.find(`[name="icon-${idx}"]`).val() || '',
        callback: (path) => {
          html.find(`[name="icon-${idx}"]`).val(path);
          $(this).find('img').attr('src', path);
        },
      }).browse();
    });

    html.on('click', '.dsct-delete-mat', function () {
      $(this).closest('tr').remove();
    });

    html.find('#dsct-wb-add-mat-btn').on('click', () => {
      const p = palette();
      const maxIdx = Math.max(-1, ...html.find('#dsct-wb-mat-tbody tr').map((_, tr) => {
        const inp = $(tr).find('[name^="origname-"]')[0];
        return inp ? (parseInt(inp.name.replace('origname-', '')) || 0) : -1;
      }).get());
      const idx = maxIdx + 1;
      const newRow = buildRow(idx, '', false, DEFAULT_ICON, MATERIAL_RULE_DEFAULTS.stone, WALL_RESTRICTION_DEFAULTS.stone, p);
      html.find('#dsct-wb-mat-tbody').append(newRow);
    });

    html.find('#dsct-wb-reset-btn').on('click', async () => {
      await game.settings.set(M, 'materialRules',         foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS));
      await game.settings.set(M, 'wallRestrictions',      foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS));
      await game.settings.set(M, 'customMaterials',       []);
      await game.settings.set(M, 'wbDefaultMaterial',     'stone');
      await game.settings.set(M, 'wbDefaultHeightBottom', '');
      await game.settings.set(M, 'wbDefaultHeightTop',    '');
      ui.notifications.info('Wall Builder settings reset to defaults.');
      this.render(true);
    });

    html.find('#dsct-wb-save-btn').on('click', async () => {
      await this._doSave(html);
      this.close();
    });
  }

  async _doSave(html) {
    const intOr = (v, def) => { const n = parseInt(v); return isNaN(n) ? def : n; };

    const indices = [];
    html.find('#dsct-wb-mat-tbody tr').each((_, tr) => {
      const inp = $(tr).find('[name^="origname-"]')[0];
      if (inp) indices.push(parseInt(inp.name.replace('origname-', '')));
    });

    const newRules        = {};
    const newRestrictions = {};
    const newCustoms      = [];
    const seenNames       = new Set();

    for (const i of indices) {
      const origName = html.find(`[name="origname-${i}"]`).val() ?? '';
      const isBase   = html.find(`[name="isbase-${i}"]`).val()   === 'true';
      const rawName  = (html.find(`[name="matname-${i}"]`).val() ?? origName).trim();
      const name     = rawName || origName;
      if (!name) continue;
      if (seenNames.has(name)) { ui.notifications.warn(`Duplicate material name "${name}" - skipping.`); continue; }
      seenNames.add(name);

      const rawAlpha = parseFloat(html.find(`[name="opacity-${i}"]`).val());
      newRules[name] = {
        cost:   intOr(html.find(`[name="cost-${i}"]`).val(),   MATERIAL_RULE_DEFAULTS.stone.cost),
        damage: intOr(html.find(`[name="damage-${i}"]`).val(), MATERIAL_RULE_DEFAULTS.stone.damage),
        alpha:  isNaN(rawAlpha) ? CUSTOM_MATERIAL_DEFAULTS.alpha : Math.min(1, Math.max(0, rawAlpha)),
      };
      newRestrictions[name] = {
        move:  intOr(html.find(`[name="move-${i}"]`).val(),  WALL_RESTRICTION_DEFAULTS.stone.move),
        sight: intOr(html.find(`[name="sight-${i}"]`).val(), WALL_RESTRICTION_DEFAULTS.stone.sight),
        light: intOr(html.find(`[name="light-${i}"]`).val(), WALL_RESTRICTION_DEFAULTS.stone.light),
        sound: intOr(html.find(`[name="sound-${i}"]`).val(), WALL_RESTRICTION_DEFAULTS.stone.sound),
      };
      if (!isBase) newCustoms.push({ name, icon: html.find(`[name="icon-${i}"]`).val() || '' });
    }

    await game.settings.set(M, 'materialRules',         newRules);
    await game.settings.set(M, 'wallRestrictions',      newRestrictions);
    await game.settings.set(M, 'customMaterials',       newCustoms);
    await game.settings.set(M, 'wbDefaultMaterial',     html.find('[name="defaultMaterial"]').val()  ?? 'stone');
    await game.settings.set(M, 'wbDefaultHeightBottom', html.find('[name="defaultHeightBot"]').val() ?? '');
    await game.settings.set(M, 'wbDefaultHeightTop',    html.find('[name="defaultHeightTop"]').val() ?? '');

    ui.notifications.info('Wall Builder settings saved.');
  }

  async _updateObject() {}
}