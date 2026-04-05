import {
  MATERIAL_ICONS, MATERIAL_ALPHA, WALL_RESTRICTIONS,
  getMaterial, tileAt,
  hasTags, getTags, getByTag, addTags, removeTags,
  toGrid, toWorld, GRID as getGRID, getSetting,
} from './helpers.js';

const SCALE = 1.2;
const s = n => Math.round(n * SCALE);

const MATERIALS       = ['glass', 'wood', 'stone', 'metal'];
const MATERIAL_COLORS = { glass: 0x88ddff, wood: 0xaa6622, stone: 0x888888, metal: 0x4488aa };
const MODE_COLORS     = { build: 0x44cc44, destroy: 0xcc4444, fix: 0x44aacc, transmute: 0xcc8800, break: 0xff6600, inspect: 0xaaaaff };

const palette = () => document.body.classList.contains('theme-dark') ? {
  bg: '#0e0c14', bgBtn: '#1a1628',
  border: '#2a2040', borderOuter: '#4a3870',
  text: '#8a88a0', textDim: '#3a3050', textLabel: '#4a3870',
  accent: '#7a50c0',
} : {
  bg: '#f0eef8', bgBtn: '#dbd8ec',
  border: '#b0a8cc', borderOuter: '#7060a8',
  text: '#3a3060', textDim: '#8880aa', textLabel: '#5040a0',
  accent: '#7a50c0',
};

const getBlockTag   = (obj) => getTags(obj).find(t => t.startsWith('wall-block-'));
const getBlockWalls = (blockTag) => blockTag ? getByTag(blockTag).filter(o => Array.isArray(o.c)) : [];

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
    x: gx * GRID, y: gy * GRID,
    width: GRID, height: GRID,
    elevation: tileElevation,
    texture: { src: MATERIAL_ICONS[material] },
    alpha: MATERIAL_ALPHA[material] ?? 0.8,
    hidden: false, locked: false,
    occlusion: { mode: 0, alpha: 0 },
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
    const pwMat = (pw.flags?.tagger?.tags ?? []).find(t => MATERIALS.includes(t));
    if (pwMat === 'glass') continue;
    const targetSight = WALL_RESTRICTIONS()[pwMat ?? 'stone']?.sight ?? 10;
    if (pw.sight !== targetSight) await pw.update({ sight: targetSight });
  }
};

const suppressOverlappingSight = async (wall) => {
  const wallMat = (wall.flags?.tagger?.tags ?? []).find(t => MATERIALS.includes(t));
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
    const pwMat = (pw.flags?.tagger?.tags ?? []).find(t => MATERIALS.includes(t));
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
  await tile.document.update({ 'texture.src': MATERIAL_ICONS.broken, alpha: 0.8 });
  await addTags(tile, ['broken']);
};

const fixBlock = async (tile) => {
  const blockTag    = getBlockTag(tile);
  if (!blockTag) return;
  const tags        = getTags(tile);
  const material    = tags.find(t => MATERIALS.includes(t)) ?? 'stone';
  const restrict    = WALL_RESTRICTIONS()[material];
  const damagedTag  = tags.find(t => t.startsWith('damaged:'));
  const squaresBack = damagedTag ? parseInt(damagedTag.split(':')[1]) : 0;

  const walls = getBlockWalls(blockTag);
  for (const wall of walls) {
    await wall.update({ move: restrict.move, sight: restrict.sight, light: restrict.light, sound: restrict.sound });
    if (squaresBack > 0) {
      const currentTop = wall.flags?.['wall-height']?.top ?? 0;
      await wall.update({ 'flags.wall-height.top': currentTop + squaresBack });
    }
    await removeTags(wall, ['broken']);
    await suppressOverlappingSight(wall);
  }
  await tile.document.update({ 'texture.src': MATERIAL_ICONS[material], alpha: MATERIAL_ALPHA[material] ?? 0.8 });
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
  const oldMat   = oldTags.find(t => MATERIALS.includes(t));
  const restrict = WALL_RESTRICTIONS()[newMaterial];

  if (oldMat) await removeTags(tile, [oldMat]);
  await addTags(tile, [newMaterial]);
  await tile.document.update({ 'texture.src': MATERIAL_ICONS[newMaterial], alpha: MATERIAL_ALPHA[newMaterial] ?? 0.8 });

  const walls = getBlockWalls(blockTag);
  for (const wall of walls) {
    if (oldMat) await removeTags(wall, [oldMat]);
    await addTags(wall, [newMaterial]);
    await wall.update({ move: restrict.move, sight: restrict.sight, light: restrict.light, sound: restrict.sound });
  }
};

export class WallBuilderPanel extends Application {
  constructor() {
    super();
    this._html         = null;
    this._mode         = 'build';
    this._material     = getSetting('wbDefaultMaterial') || 'stone';
    this._heightBottom = getSetting('wbDefaultHeightBottom') ?? '';
    this._heightTop    = getSetting('wbDefaultHeightTop')    ?? '';
    this._stable       = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'wall-builder-panel', title: 'Wall Builder', template: null,
      width: s(240), height: 'auto', resizable: false, minimizable: false,
    });
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
            const mat             = getTags(tile).find(t => MATERIALS.includes(t));
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

    const onMove = (e) => {
      const gpos = toGrid(e.data.getLocalPosition(canvas.app.stage));
      graphics.clear();
      const tile = canvas.tiles.placeables.find(t => {
        if (!hasTags(t, 'obstacle')) return false;
        const tg = toGrid(t.document);
        return tg.x === gpos.x && tg.y === gpos.y;
      });
      if (tile) {
        graphics.beginFill(0xaaaaff, 0.25);
        graphics.drawRect(gpos.x * GRID, gpos.y * GRID, GRID, GRID);
        graphics.endFill();
        const tags        = getTags(tile);
        const mat         = tags.find(t => MATERIALS.includes(t)) ?? '(none)';
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
        tooltip.textContent = `Material : ${mat}\nHeight   : ${bottom} – ${top}\nStatus   : ${status}\nStable   : ${isStable ? 'Yes' : 'No'}\nTag      : ${blockTag ?? '(none)'}`;
        tooltip.style.display = 'block';
      } else {
        tooltip.style.display = 'none';
      }
      const ev = e.data.originalEvent;
      if (ev) { tooltip.style.left = `${ev.clientX + 14}px`; tooltip.style.top = `${ev.clientY + 14}px`; }
    };

    return new Promise((resolve) => {
      const cleanup = () => {
        overlay.off('pointermove', onMove);
        document.removeEventListener('keydown', onKeyDown);
        canvas.app.stage.removeChild(overlay);
        canvas.app.stage.removeChild(graphics);
        graphics.destroy();
        overlay.destroy();
        tooltip.remove();
      };

      const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(); } };
      overlay.on('pointermove', onMove);
      document.addEventListener('keydown', onKeyDown);
      ui.notifications.info('Inspect: hover tiles to see info. Escape to exit.');
    });
  }

  async _execute() {
    if (this._mode === 'inspect') { await this._inspect(); return; }
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
      // single-slot undo. build twice and the first operation is gone forever.
      // a real undo stack would be nice but 95% of the time you only want to undo the last thing.
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
        const oldMat = getTags(tile).find(t => MATERIALS.includes(t)) ?? null;
        await transmuteBlock(tile, this._material);
        undoOps.push(async () => { if (oldMat) await transmuteBlock(tile, oldMat); });
      }
      window._wallBuilderUndo = undoOps.length ? async () => { for (const op of undoOps) await op(); ui.notifications.info('Wall transmute undone.'); } : null;
      ui.notifications.info(`Transmuted ${undoOps.length} wall block${undoOps.length !== 1 ? 's' : ''}.`);
    }
  }

  _refreshPanel() {
    if (!this._html) return;
    const p = palette();
    const modes = ['build', 'destroy', 'fix', 'transmute', 'break', 'inspect'];
    for (const mode of modes) {
      const btn = this._html.find(`#wb-mode-${mode}`)[0];
      if (btn) { btn.style.borderColor = this._mode === mode ? p.accent : p.border; btn.style.color = this._mode === mode ? p.accent : p.text; }
    }
    const matRow = this._html.find('#wb-material-row')[0];
    if (matRow) matRow.style.display = (this._mode === 'build' || this._mode === 'transmute') ? 'flex' : 'none';
    const execBtn = this._html.find('[data-action="execute"]')[0];
    if (execBtn) execBtn.textContent = this._mode === 'inspect' ? 'Start Inspect' : 'Select Squares';
    const heightRow = this._html.find('#wb-height-row')[0];
    if (heightRow) heightRow.style.display = this._mode === 'build' ? 'flex' : 'none';
    for (const mat of MATERIALS) {
      const btn = this._html.find(`#wb-mat-${mat}`)[0];
      if (btn) { btn.style.borderColor = this._material === mat ? p.accent : p.border; btn.style.color = this._material === mat ? p.accent : p.text; }
    }
  }

  async _renderInner(data) {
    const styleId = 'wall-builder-style';
    const styleEl = document.getElementById(styleId) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    const p = palette();
    styleEl.textContent = `
      #wall-builder-panel .window-content { padding:0; background:${p.bg}; }
      #wall-builder-panel { border:1px solid ${p.borderOuter}; border-radius:3px; box-shadow:0 0 12px rgba(0,0,0,0.4); }
      #wall-builder-panel .window-header { display:none !important; }
      #wall-builder-panel .window-content { border-radius:3px; }
      #wall-builder-panel button:hover { filter:brightness(1.15); }
    `;

    return $(`
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
        </div>

        <div id="wb-material-row" style="display:${(this._mode==='build'||this._mode==='transmute')?'flex':'none'};flex-direction:column;gap:${s(4)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(8)}px;text-transform:uppercase;color:${p.textDim};">Material</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:${s(3)}px;">
            ${MATERIALS.map(mat => `<button id="wb-mat-${mat}" data-material="${mat}" style="padding:${s(4)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._material===mat?p.accent:p.border};color:${this._material===mat?p.accent:p.text};text-transform:capitalize;">${mat}</button>`).join('')}
          </div>
        </div>

        <div id="wb-height-row" style="display:${this._mode==='build'?'flex':'none'};flex-direction:column;gap:${s(4)}px;margin-bottom:${s(8)}px;">
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
      </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._html = html;

    const appEl = html[0].closest('.app');
    if (appEl) {
      const saved = window._wallBuilderPanelPos;
      appEl.style.left = saved ? `${saved.left}px` : `${Math.round((window.innerWidth - (appEl.offsetWidth || s(240))) / 2)}px`;
      appEl.style.top  = saved ? `${saved.top}px`  : `${Math.round((window.innerHeight - (appEl.offsetHeight || s(400))) / 2)}px`;
      html[0].addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        e.preventDefault();
        const sx = e.clientX - appEl.offsetLeft, sy = e.clientY - appEl.offsetTop;
        const onMove = ev => { appEl.style.left = `${ev.clientX - sx}px`; appEl.style.top = `${ev.clientY - sy}px`; };
        const onUp   = () => {
          window._wallBuilderPanelPos = { left: parseInt(appEl.style.left), top: parseInt(appEl.style.top) };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    html.on('input',  '#wb-height-bottom', e => { this._heightBottom = e.target.value === '' ? '' : parseFloat(e.target.value); });
    html.on('input',  '#wb-height-top',    e => { this._heightTop    = e.target.value === '' ? '' : parseFloat(e.target.value); });
    html.on('change', '#wb-stable',        e => { this._stable = e.target.checked; });
    html.on('click',  '[data-mode]',       e => { this._mode = e.currentTarget.dataset.mode; this._refreshPanel(); });
    html.on('click',  '[data-material]',   e => { this._material = e.currentTarget.dataset.material; this._refreshPanel(); });
    html.on('click',  '[data-action]', async e => {
      const action = e.currentTarget.dataset.action;
      if (action === 'close-window') { this.close(); return; }
      if (action === 'execute')      { await this._execute(); return; }
    });
  }

  async close(options) {
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}
