import { getSetting, rangeEnforced, safeDelete } from '../helpers.mjs';
import { chooseTargeting } from './choose-effect.mjs';
import { beginPickerOverlay } from './picker-overlay.mjs';
import {
  setFoundryTargets, checkAndRunBurstTargeting, casterTokenFor, areaCandidates, isTriggeredAbility,
  _addPickerTarget, _addPickerReticle, _clearPickerReticles,
} from './target-picker.mjs';
import { hitToken } from '../ctlib.mjs';
import { releaseAreaHold } from '../regions/template-lifetime.mjs';
import { setTip } from '../chat-tips.mjs';

const M = 'draw-steel-combat-tools';
const DS = 'draw-steel';
const SHAPES = new Set(['burst', 'cube', 'line']);
const EACH_TYPES = new Set(['creature', 'enemy', 'ally', 'object', 'creatureObject', 'enemyObject', 'selfAlly']);
const DOUBLE_CLICK_MS = 400;
const COLOR_IN = 0x44CC44;
const COLOR_OUT = 0xCC8844;
const RELEASE_WAIT_MS = 5000;
const DIALOG_WAIT_MS = 15000;

const _picked = new Map();
let _activeAreaCancel = null;

const L = (key, data) => (data ? game.i18n.format(`DSCT.areaPicker.${key}`, data) : game.i18n.localize(`DSCT.areaPicker.${key}`));
const H = (key) => `DSCT.picker.help.${key}`;

const gridSize = () => canvas.grid.size;
const squarePx = () => canvas.dimensions.distancePixels;

const footprint = (tok) => ({
  gx: Math.round(tok.document.x / gridSize()),
  gy: Math.round(tok.document.y / gridSize()),
  w: Math.max(1, Math.round(tok.document.width)),
  h: Math.max(1, Math.round(tok.document.height)),
});

const gapTo = (fp, sx, sy) => Math.max(0, fp.gx - sx, sx - (fp.gx + fp.w - 1), fp.gy - sy, sy - (fp.gy + fp.h - 1));

const unit = () => canvas.scene.grid.distance || 1;
const TILTS = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90];

function columnOf(tok) {
  const c = globalThis.ctlib?.tokenColumn?.(tok);
  if (c) return { z: c.z, d: c.d };
  const size = Number(tok.actor?.system?.combat?.size?.value) || 0;
  return { z: (tok.document.elevation ?? 0) / unit(), d: Math.max(1, size, Number(tok.document.depth) > 1 ? Number(tok.document.depth) : 1) };
}

const overlapsSpan = (col, span) => !!span && col.z < span.t - 1e-6 && col.z + col.d > span.b + 1e-6;
const gapZ = (col, span) => Math.max(0, Math.floor(span.b) - (Math.ceil(col.z + col.d) - 1), Math.floor(col.z) - (Math.ceil(span.t) - 1));
const elevationOf = (span) => ({ bottom: span.b * unit(), top: span.t * unit() });

function inArea(tok, probe, spanAt) {
  if (!tok.document.testInsideRegion(probe)) return false;
  const col = columnOf(tok);
  const fp = footprint(tok);
  for (let dx = 0; dx < fp.w; dx++) {
    for (let dy = 0; dy < fp.h; dy++) if (overlapsSpan(col, spanAt(fp.gx + dx, fp.gy + dy))) return true;
  }
  return false;
}

function areaOf(ability) {
  const view = chooseTargeting(ability);
  const dist = view?.distance ?? ability.system?.distance;
  const target = view?.target ?? ability.system?.target;
  if (!SHAPES.has(dist?.type) || target?.value != null || !EACH_TYPES.has(target?.type)) return null;
  const n = (k) => Number(dist?.[k]) || 0;
  if (dist.type === 'burst') return n('primary') ? { shape: 'burst', radius: n('primary'), range: 0, target } : null;
  if (dist.type === 'cube') return n('primary') ? { shape: 'cube', size: n('primary'), range: n('secondary'), target } : null;
  return n('primary') ? { shape: 'line', length: n('primary'), width: n('secondary') || 1, range: n('tertiary'), target } : null;
}

function regionData(ability, shape, mark = null, elevation = null) {
  const shapes = Array.isArray(shape) ? shape : [shape];
  return {
    ...(elevation ? { elevation } : {}),
    name: ability.name,
    color: game.user.color,
    levels: [canvas.level.id],
    restriction: { enabled: true, type: 'move' },
    displayMeasurements: true,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: 'coverage',
    ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: { [DS]: { abilitySource: ability.uuid }, ...(mark ? { [M]: { [LINE_FLAG]: mark } } : {}) },
    shapes,
  };
}

const testDoc = (shapes) => new CONFIG.Region.documentClass({ name: 'area-test', levels: [canvas.level.id], shapes }, { parent: canvas.scene });
const shapesOf = (doc) => doc.shapes.map(s => (typeof s.toObject === 'function' ? s.toObject() : s));
const asShapes = (source) => (Array.isArray(source) ? source : shapesOf(source));

const cubeShape = (area, gx, gy) => ({
  type: 'rectangle', gridBased: true, x: gx * gridSize(), y: gy * gridSize(),
  width: area.size * squarePx(), height: area.size * squarePx(), anchorX: 0, anchorY: 0,
});

const lineShape = (area, x, y, rotation) => ({
  type: 'line', gridBased: true, x, y,
  length: area.length * squarePx(), width: area.width * squarePx(), rotation,
});

const turnOf = (rotation) => ((Math.round(rotation) % 360) + 360) % 360;
const isDiagonal = (rotation) => turnOf(rotation) % 90 !== 0;

function nearestEdgeMidpoint(point) {
  const gs = gridSize();
  const a = { x: (Math.floor(point.x / gs) + 0.5) * gs, y: Math.round(point.y / gs) * gs };
  const b = { x: Math.round(point.x / gs) * gs, y: (Math.floor(point.y / gs) + 0.5) * gs };
  return Math.hypot(a.x - point.x, a.y - point.y) <= Math.hypot(b.x - point.x, b.y - point.y) ? a : b;
}

function snapLineOrigin(area, point, rotation) {
  const gs = gridSize();
  const across = (v) => (area.width % 2 ? (Math.floor(v / gs) + 0.5) : Math.round(v / gs)) * gs;
  const along = (v) => Math.round(v / gs) * gs;
  const turn = turnOf(rotation);
  if (turn === 0 || turn === 180) return { x: along(point.x), y: across(point.y) };
  if (turn === 90 || turn === 270) return { x: across(point.x), y: along(point.y) };
  return nearestEdgeMidpoint(point);
}

function diagonalSquares(area, origin, rotation) {
  const gs = gridSize();
  const rad = (turnOf(rotation) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const major = Math.max(Math.abs(dx), Math.abs(dy));
  const ux = dx / major;
  const uy = dy / major;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const fx = origin.x / gs;
  const fy = origin.y / gs;
  const onRow = Math.abs(fy - Math.round(fy)) < 1e-6;
  const cx = onRow ? Math.floor(fx) : (sx > 0 ? Math.round(fx) : Math.round(fx) - 1);
  const cy = onRow ? (sy > 0 ? Math.round(fy) : Math.round(fy) - 1) : Math.floor(fy);
  const out = [];
  for (let i = 0; i < area.length; i++) {
    const px = cx + Math.round(i * ux);
    const py = cy + Math.round(i * uy);
    for (let k = 0; k < area.width; k++) out.push([px - (onRow ? k * sx : 0), py - (onRow ? 0 : k * sy)]);
  }
  return out;
}

function straightSquares(area, at, rotation) {
  const gs = gridSize();
  const ax = Math.round(at.x / gs);
  const ay = Math.round(at.y / gs);
  const acrossX = Math.round(at.x / gs - area.width / 2);
  const acrossY = Math.round(at.y / gs - area.width / 2);
  const turn = turnOf(rotation);
  const out = [];
  for (let i = 0; i < area.length; i++) {
    for (let k = 0; k < area.width; k++) {
      if (turn === 0) out.push([ax + i, acrossY + k, i]);
      else if (turn === 180) out.push([ax - 1 - i, acrossY + k, i]);
      else if (turn === 90) out.push([acrossX + k, ay + i, i]);
      else out.push([acrossX + k, ay - 1 - i, i]);
    }
  }
  return out;
}

const lineLength2D = (area, tilt) => {
  const a = Math.abs(tilt);
  if (a <= 45) return area.length;
  if (a >= 90) return 1;
  return Math.round((area.length - 1) / Math.tan((a * Math.PI) / 180)) + 1;
};

function tiltedLine(area, at, rotation, tilt, z0) {
  const flat = { ...area, length: lineLength2D(area, tilt) };
  const cells = isDiagonal(rotation)
    ? diagonalSquares(flat, at, rotation).map(([sx, sy], n) => [sx, sy, Math.floor(n / flat.width)])
    : straightSquares(flat, at, rotation);
  const steep = Math.abs(tilt) > 45;
  const slope = Math.tan((tilt * Math.PI) / 180);
  const rise = new Map();
  for (let i = 0; i < area.length; i++) {
    const j = steep ? (Math.abs(tilt) >= 90 ? 0 : Math.round(i / Math.abs(slope))) : i;
    const off = steep ? i * Math.sign(tilt) : Math.round(i * slope);
    const r = rise.get(j);
    rise.set(j, r ? [Math.min(r[0], off), Math.max(r[1], off)] : [off, off]);
  }
  const spans = new Map();
  const squares = [];
  for (const [sx, sy, j] of cells) {
    const key = `${sx},${sy}`;
    const [lo, hi] = rise.get(j) ?? [0, 0];
    const old = spans.get(key);
    if (!old) squares.push([sx, sy]);
    spans.set(key, old ? { b: Math.min(old.b, z0 + lo), t: Math.max(old.t, z0 + hi + area.width) } : { b: z0 + lo, t: z0 + hi + area.width });
  }
  const all = [...spans.values()];
  const whole = { b: Math.min(...all.map((s) => s.b)), t: Math.max(...all.map((s) => s.t)) };
  const shaped = tilt || isDiagonal(rotation);
  return {
    shapes: shaped ? squareShapes(squares) : [lineShape(flat, at.x, at.y, rotation)],
    squares,
    whole,
    spanAt: tilt ? (sx, sy) => spans.get(`${sx},${sy}`) : () => whole,
  };
}

const TURN_STEPS = [5, 15, 30, 45, 90];
const defaultTurnStep = () => {
  const n = Number(getSetting('areaPickerTurnStep'));
  return TURN_STEPS.includes(n) ? n : 5;
};
let _turnStep = 5;
const rotationsFor = (step) => Array.from({ length: 360 / step }, (_, i) => i * step);

const squareShapes = (squares) => squares.map(([sx, sy]) => ({
  type: 'rectangle', gridBased: true, x: sx * gridSize(), y: sy * gridSize(),
  width: squarePx(), height: squarePx(), anchorX: 0, anchorY: 0,
}));

const LINE_FLAG = 'areaLine';
const lineMark = (area) => ({ length: area.length, width: area.width });

function diagonalMeasure(squares, mark, tree) {
  const gs = gridSize();
  const n = Math.max(1, Math.min(mark.width, squares.length));
  const corners = (list) => list.flatMap(s => [{ x: s.x, y: s.y }, { x: s.x + gs, y: s.y }, { x: s.x, y: s.y + gs }, { x: s.x + gs, y: s.y + gs }]);
  const head = squares.slice(0, n);
  const tail = squares.slice(-n);
  let A = null;
  let B = null;
  let far = -1;
  for (const p of corners(head)) for (const q of corners(tail)) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > far) { far = d; A = p; B = q; }
  }
  const alongX = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y);
  const xs = head.flatMap(s => [s.x, s.x + gs]);
  const ys = head.flatMap(s => [s.y, s.y + gs]);
  const edgeEnd = alongX
    ? { x: A.x, y: A.y === Math.min(...ys) ? Math.max(...ys) : Math.min(...ys) }
    : { x: A.x === Math.min(...xs) ? Math.max(...xs) : Math.min(...xs), y: A.y };
  const { Ray } = foundry.canvas.geometry;
  const unit = canvas.grid.distance;
  return {
    origin: A,
    measuredSegments: [
      { ray: new Ray(A, B), winding: 0, distance: mark.length * unit },
      { ray: new Ray(A, edgeEnd), winding: -1, distance: mark.width * unit },
    ],
    drawReferenceLines: () => {},
    drawShape: (g) => tree.drawShape(g),
  };
}

function measuredLine(region) {
  if (region._dsctSquares) return diagonalMeasure(region._dsctSquares, region._dsctLineMark, region.animationState.polygonTree);
  const mark = region.document.flags?.[M]?.[LINE_FLAG];
  const squares = region.animationState.shapes;
  if (!mark?.length || !squares.length) return null;
  return diagonalMeasure(squares, mark, region.animationState.polygonTree);
}

export function registerAreaLineRendering() {
  const measure = function (wrapped, ...args) {
    const shapes = wrapped(...args);
    if (!shapes.length) return shapes;
    const line = measuredLine(this);
    return line ? [line] : shapes;
  };
  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, 'CONFIG.Region.objectClass.prototype._getMeasuredShapes', measure, 'WRAPPER');
    return;
  }
  const cls = CONFIG.Region?.objectClass;
  const original = cls?.prototype?._getMeasuredShapes;
  if (original) cls.prototype._getMeasuredShapes = function (...args) { return measure.call(this, original.bind(this), ...args); };
}

const burstShape = (area, caster) => ({
  type: 'emanation', gridBased: true, radius: area.radius * squarePx(),
  base: {
    type: 'token', hole: true, x: caster.document.x, y: caster.document.y,
    width: caster.document.width, height: caster.document.height, shape: caster.document.shape,
  },
});

function areaSquares(source) {
  const doc = testDoc(asShapes(source));
  const gs = gridSize();
  const b = doc.bounds;
  if (!b) return [];
  const out = [];
  for (let sx = Math.floor(b.x / gs); sx < Math.ceil((b.x + b.width) / gs); sx++) {
    for (let sy = Math.floor(b.y / gs); sy < Math.ceil((b.y + b.height) / gs); sy++) {
      if (doc.polygonTree.testPoint({ x: (sx + 0.5) * gs, y: (sy + 0.5) * gs })) out.push([sx, sy]);
    }
  }
  return out;
}

const withinRange = (doc, fp, range, col, spanAt) => !range || areaSquares(doc).some(([sx, sy]) => {
  const span = spanAt(sx, sy);
  return Math.max(gapTo(fp, sx, sy), span ? gapZ(col, span) : 0) <= range;
});

function squareRects(squares) {
  const gs = gridSize();
  const rows = new Map();
  for (const [sx, sy] of squares) (rows.get(sy) ?? rows.set(sy, []).get(sy)).push(sx);
  const rects = [];
  for (const [sy, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === xs[i - 1] + 1) continue;
      rects.push({ x: start * gs, y: sy * gs, w: (xs[i - 1] - start + 1) * gs, h: gs });
      start = xs[i];
    }
  }
  return rects;
}

const rangeRect = (fp, range) => ({
  x: (fp.gx - range) * gridSize(), y: (fp.gy - range) * gridSize(),
  w: (fp.w + range * 2) * gridSize(), h: (fp.h + range * 2) * gridSize(),
});

function suggestShape(ability, area, caster, candidates) {
  const fp = footprint(caster);
  const R = area.range;
  const gs = gridSize();
  const me = columnOf(caster);
  const z0 = Math.floor(me.z);
  const cols = candidates.map(columnOf);
  const colOf = new Map(candidates.map((t, i) => [t.id, cols[i]]));
  const flat = cols.every((c) => Math.floor(c.z) === z0);
  let best = null;
  const better = (score, inRange, distance) => score > 0 && inRange > 0
    && !(best && (score < best.score || (score === best.score && (inRange < best.inRange || (inRange === best.inRange && distance >= best.distance)))));
  const rangeCount = (squares, spanAt) => (R ? squares.filter(([sx, sy]) => Math.max(gapTo(fp, sx, sy), gapZ(me, spanAt(sx, sy))) <= R).length : squares.length);
  const fromUser = (x, y) => Math.hypot(x / gs - (fp.gx + fp.w / 2), y / gs - (fp.gy + fp.h / 2));
  const Terrain = globalThis.ctlib?.SceneTerrain;
  const terrain = Terrain && !flat ? new Terrain({ scene: canvas.scene }) : null;
  const grounds = new Map();
  const groundAt = (sx, sy) => {
    const k = `${sx},${sy}`;
    if (!grounds.has(k)) grounds.set(k, terrain?.slabsAt({ x: sx, y: sy }).find((s) => s.bottom === -Infinity)?.top ?? -Infinity);
    return grounds.get(k);
  };
  const aboveGround = (squares, spanAt) => !terrain || squares.every(([sx, sy]) => spanAt(sx, sy).b >= groundAt(sx, sy) - 1e-6);

  if (area.shape === 'cube') {
    const n = area.size;
    const zs = [];
    if (flat) zs.push(z0);
    else {
      const lo = Math.min(...cols.map((c) => Math.floor(c.z))) - n + 1;
      const hi = Math.max(...cols.map((c) => Math.ceil(c.z + c.d) - 1));
      for (let z = lo; z <= hi; z++) if (!R || gapZ(me, { b: z, t: z + n }) <= R) zs.push(z);
    }
    for (let gx = fp.gx - R - n + 1; gx <= fp.gx + fp.w - 1 + R; gx++) {
      for (let gy = fp.gy - R - n + 1; gy <= fp.gy + fp.h - 1 + R; gy++) {
        const gap = Math.max(0, fp.gx - (gx + n - 1), gx - (fp.gx + fp.w - 1), fp.gy - (gy + n - 1), gy - (fp.gy + fp.h - 1));
        if (R && gap > R) continue;
        const shapes = [cubeShape(area, gx, gy)];
        const doc = testDoc(shapes);
        const across = candidates.filter(t => t.document.testInsideRegion(doc));
        if (!across.length) continue;
        let squares = null;
        for (const z of zs) {
          const span = { b: z, t: z + n };
          const score = across.filter(t => overlapsSpan(colOf.get(t.id), span)).length;
          if (!score || (best && score < best.score)) continue;
          squares ??= areaSquares(shapes);
          if (!aboveGround(squares, () => span)) continue;
          const distance = fromUser((gx + n / 2) * gs, (gy + n / 2) * gs) + Math.abs(z - z0) * 0.5;
          const inRange = rangeCount(squares, () => span);
          if (!better(score, inRange, distance)) continue;
          best = { shapes, score, inRange, distance, geo: { z } };
        }
      }
    }
  } else if (area.shape === 'line') {
    const occupants = new Map();
    candidates.forEach((t, i) => {
      const f = footprint(t);
      for (let dx = 0; dx < f.w; dx++) for (let dy = 0; dy < f.h; dy++) {
        const key = `${f.gx + dx},${f.gy + dy}`;
        (occupants.get(key) ?? occupants.set(key, []).get(key)).push(i);
      }
    });
    const starts = [];
    if (flat) starts.push(z0);
    else for (let z = z0 - R; z <= Math.ceil(me.z + me.d) - 1 + R; z++) starts.push(z);
    const tilts = flat ? [0] : TILTS;
    const seen = new Set();
    for (let vx = fp.gx - R; vx <= fp.gx + fp.w + R; vx++) {
      for (let vy = fp.gy - R; vy <= fp.gy + fp.h + R; vy++) {
        for (const point of [{ x: (vx + 0.5) * gs, y: vy * gs }, { x: vx * gs, y: (vy + 0.5) * gs }]) {
          for (const rotation of rotationsFor(flat ? _turnStep : Math.max(_turnStep, 15))) {
            const at = snapLineOrigin(area, point, rotation);
            const key = `${at.x},${at.y},${rotation}`;
            if (seen.has(key)) continue;
            seen.add(key);
            for (const tilt of tilts) {
              for (const z of starts) {
                const line = tiltedLine(area, at, rotation, tilt, z);
                const hit = new Set();
                for (const [sx, sy] of line.squares) {
                  const span = line.spanAt(sx, sy);
                  for (const i of occupants.get(`${sx},${sy}`) ?? []) if (overlapsSpan(cols[i], span)) hit.add(i);
                }
                if (!hit.size || (best && hit.size < best.score)) continue;
                if (!aboveGround(line.squares, line.spanAt)) continue;
                const distance = fromUser(at.x, at.y) + Math.abs(tilt) / 90 + Math.abs(z - z0) * 0.5;
                const inRange = rangeCount(line.squares, line.spanAt);
                if (!better(hit.size, inRange, distance)) continue;
                best = { shapes: line.shapes, mark: lineMark(area), score: hit.size, inRange, distance, geo: { z, tilt, line: { x: at.x, y: at.y, rotation } } };
              }
            }
          }
        }
      }
    }
  }
  return best;
}

async function createHeldRegion(ability, shape, mark = null, elevation = null) {
  const data = regionData(ability, shape, mark, elevation);
  delete data.flags[DS];
  const [doc] = await canvas.scene.createEmbeddedDocuments('Region', [data], { dsctAreaHold: true });
  if (doc) await doc.update({ [`flags.${DS}.abilitySource`]: ability.uuid });
  return doc ?? null;
}

function watchRelease(ability, regionUuid, { opened = false } = {}) {
  let done = false;
  const entry = { regionUuid, opened };
  _picked.set(ability.uuid, entry);
  const finish = async (keep) => {
    if (done) return;
    done = true;
    Hooks.off('createChatMessage', onMessage);
    Hooks.off('closeAbilityConfigurationDialog', onClose);
    _picked.delete(ability.uuid);
    const region = await fromUuid(regionUuid).catch(() => null);
    if (!region) return;
    if (keep) releaseAreaHold(region);
    else await safeDelete(region);
  };
  const onMessage = (message) => {
    if (message.system?.parts?.contents?.some(p => p.type === 'abilityUse' && p.abilityUuid === ability.uuid)) finish(true);
  };
  const onClose = (app) => {
    if (app.options?.ability?.uuid === ability.uuid) setTimeout(() => finish(false), RELEASE_WAIT_MS);
  };
  Hooks.on('createChatMessage', onMessage);
  Hooks.on('closeAbilityConfigurationDialog', onClose);
  setTimeout(() => { if (!entry.opened) finish(false); }, DIALOG_WAIT_MS);
}

async function runAreaPicker(ability, area, caster) {
  const candidates = areaCandidates(ability, caster, area.target.type);
  const filter = ability.getFlag?.(M, 'areaFilter') ?? {};
  const withSelf = area.target.type === 'selfAlly' || !!filter.includeSelf;
  const canExclude = game.user.isGM || getSetting('areaPickerPlayerExclude');
  const enforce = rangeEnforced();
  const fp = footprint(caster);
  const excluded = new Set();
  let region = null;
  let inside = [];
  let state = 'empty';
  let lastClickAt = 0;
  let pendingClick = null;
  let generation = 0;
  _turnStep = defaultTurnStep();
  const me = columnOf(caster);
  const vert = { z: Math.floor(me.z), tilt: 0, line: null };
  const burstSpan = { b: me.z - (area.radius ?? 0), t: me.z + me.d + (area.radius ?? 0) };
  let spanAt = () => burstSpan;
  let placing = null;

  const detail = area.shape === 'burst' ? L('detail.burst', { n: area.radius })
    : area.shape === 'cube' ? L('detail.cube', { n: area.size, range: area.range })
    : L('detail.line', { l: area.length, w: area.width, range: area.range });

  const previousTargets = [...game.user.targets];
  setFoundryTargets([]);
  _activeAreaCancel?.();
  canvas.tokens.interactiveChildren = false;
  
  const noEdgePan = () => {};
  canvas._onDragCanvasPan = noEdgePan;
  const casterRect = { x: fp.gx * gridSize(), y: fp.gy * gridSize(), w: fp.w * gridSize(), h: fp.h * gridSize() };
  const reach = area.range ? rangeRect(fp, area.range) : casterRect;

  return new Promise((resolve) => {
    const movable = area.shape !== 'burst';
    const tipCategory = game.i18n.localize('DSCT.tip.areaPicker.category');
    const overlay = beginPickerOverlay({
      title: ability.name,
      detail,
      tokens: candidates,
      holeRects: movable ? [reach] : [casterRect],
      onConfirm: () => tryConfirm(),
      onCancel: () => doCancel(),
      controls: [
        ...(movable ? [{ input: H('clickMap'), action: H('placeArea') }, { input: H('clickEmpty'), action: H('moveArea') }] : []),
        ...(area.shape === 'line' ? [{ input: H('shiftScroll'), action: H('turnLine') }, { input: H('rightClickTurn'), action: H('smallerStep') }] : []),
        ...(movable ? [{ input: H(area.shape === 'line' ? 'ctrlScroll' : 'turnScroll'), action: H('raiseArea') }, { input: H('pageKeys'), action: H('raiseArea') }] : []),
        ...(area.shape === 'line' ? [{ input: H('tiltKeys'), action: H('tiltLine') }] : []),
        ...(canExclude ? [{ input: H('clickInArea'), action: H('excludeTarget') }] : []),
      ],
      cancelOnRightClick: !!getSetting('cancelOnRightClick'),
      onRightClick: () => { if (getSetting('cancelOnRightClick')) doCancel(); },
      extraButtons: movable ? [{
        className: 'dsct-picker-suggest',
        icon: 'fa-solid fa-wand-magic-sparkles',
        label: L('suggest'),
        kbd: 'Double-click',
        tooltip: L('suggestTip'),
        tipCategory,
        onClick: () => suggest(),
      }, {
        icon: 'fa-solid fa-arrows-up-down-left-right',
        label: L('move'),
        tooltip: L('moveTip'),
        tipCategory,
        onClick: () => startPlacing(),
      }, ...(area.shape === 'line' ? [{
        className: 'dsct-area-turn',
        icon: 'fa-solid fa-rotate',
        label: L('turn', { n: _turnStep }),
        tooltip: L('turnTip'),
        tipCategory,
        onClick: () => cycleTurn(1),
      }] : []), {
        icon: 'fa-solid fa-arrow-up',
        label: L('raise'),
        tooltip: L('raiseTip'),
        tipCategory,
        onClick: () => shiftHeight(1),
      }, {
        icon: 'fa-solid fa-arrow-down',
        label: L('lower'),
        tooltip: L('raiseTip'),
        tipCategory,
        onClick: () => shiftHeight(-1),
      }, ...(area.shape === 'line' ? [{
        icon: 'fa-solid fa-arrow-trend-up',
        label: L('tiltUp'),
        tooltip: L('tiltTip'),
        tipCategory,
        onClick: () => shiftTilt(1),
      }, {
        icon: 'fa-solid fa-arrow-trend-down',
        label: L('tiltDown'),
        tooltip: L('tiltTip'),
        tipCategory,
        onClick: () => shiftTilt(-1),
      }] : [])] : [],
    });

    const turnButton = document.querySelector('#dsct-picker-topbar .dsct-area-turn');
    const cycleTurn = (dir) => {
      _turnStep = TURN_STEPS[(TURN_STEPS.indexOf(_turnStep) + dir + TURN_STEPS.length) % TURN_STEPS.length];
      if (!turnButton) return;
      turnButton.innerHTML = `<i class="fa-solid fa-rotate"></i> ${foundry.utils.escapeHTML(L('turn', { n: _turnStep }))}`;
      setTip(turnButton, { title: L('turn', { n: _turnStep }), category: tipCategory, body: L('turnTip') });
    };
    turnButton?.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cycleTurn(-1); });

    const included = () => inside.filter(t => !excluded.has(t.id));
    const finalTargets = () => {
      const list = included();
      if (withSelf && !list.some(t => t.id === caster.id)) list.unshift(caster);
      return list;
    };

    const heightNote = () => {
      if (!movable) return '';
      const parts = [L('height', { n: vert.z })];
      if (area.shape === 'line' && vert.tilt) parts.push(L('tilt', { n: Math.round(vert.tilt) }));
      return ` · ${parts.join(' · ')}`;
    };

    const draw = () => {
      _clearPickerReticles();
      for (const t of inside) {
        if (excluded.has(t.id)) _addPickerReticle(t, COLOR_OUT, 0.8);
        else _addPickerTarget(t, COLOR_IN);
      }
      if (state === 'placing' && !region) {
        overlay.setStatus(`${L(area.shape === 'line' ? 'placingLine' : 'placing')} · ${L('count', { n: inside.length, s: inside.length === 1 ? '' : 's' })}${heightNote()}`);
      } else if (state === 'empty') {
        overlay.setStatus(L('empty'));
      } else {
        const n = included().length;
        const base = excluded.size ? L('countExcluded', { n, s: n === 1 ? '' : 's', x: excluded.size }) : L('count', { n, s: n === 1 ? '' : 's' });
        overlay.setStatus(`${canExclude && inside.length ? `${base} · ${L('excludeHint')}` : base}${heightNote()}`);
      }
      overlay.setReady(state === 'placed');
    };

    const updateHoles = (shapes) => {
      const template = shapes ? squareRects(areaSquares(shapes)) : [];
      if (state === 'placing' || state === 'empty') overlay.setHoleRects([reach, ...template]);
      else overlay.setHoleRects(movable ? template : [casterRect, ...template]);
    };

    const announce = (shapes) => {
      const squares = shapes ? areaSquares(shapes) : [];
      Hooks.callAll('dsct.areaPreview', squares.length ? {
        caster, shape: area.shape, tilt: vert.tilt, bottom: vert.z, line: vert.line, size: area.size ?? area.width,
        squares: squares.map(([x, y]) => ({ x, y, ...(spanAt(x, y) ?? {}) })).filter((s) => s.b !== undefined),
        inside: inside.map((t) => t.id),
        excluded: [...excluded],
        setBottom: movable ? (z) => setHeight(z) : null,
        aimAt: area.shape === 'line' ? (cell) => aimAt(cell) : null,
      } : { caster, shape: area.shape, squares: [], inside: [], setBottom: movable ? (z) => setHeight(z) : null });
    };

    const scan = (source) => {
      const shapes = source ? asShapes(source) : null;
      const probe = shapes?.length ? testDoc(shapes) : null;
      inside = probe ? candidates.filter(t => inArea(t, probe, spanAt)) : [];
      for (const id of [...excluded]) if (!inside.some(t => t.id === id)) excluded.delete(id);
      updateHoles(shapes);
      draw();
      announce(shapes);
    };

    const cubeSpan = () => ({ b: vert.z, t: vert.z + area.size });
    const lineFrom = (shape) => ({ x: shape.x, y: shape.y, rotation: shape.rotation ?? 0 });
    const currentLine = () => tiltedLine(area, vert.line, vert.line.rotation, vert.tilt, vert.z);

    const covered = (doc) => {
      const list = shapesOf(doc);
      if (area.shape === 'cube') {
        const span = cubeSpan();
        spanAt = () => span;
        return { shapes: list, whole: span };
      }
      const last = list.at(-1);
      if (area.shape !== 'line' || !last || last.type !== 'line') {
        spanAt = () => burstSpan;
        return { shapes: list, whole: burstSpan };
      }
      vert.line = lineFrom(last);
      const line = currentLine();
      spanAt = line.spanAt;
      return { shapes: [...list.slice(0, -1), ...line.shapes], whole: line.whole, shaped: !!vert.tilt || isDiagonal(vert.line.rotation) };
    };

    
    const squarePreview = (preview, squares) => {
      if (!preview) return;
      if (!Object.hasOwn(preview, '_dsctSquareTree')) {
        const base = preview.animationState;
        const tree = () => preview._dsctSquareTree ?? base.polygonTree;
        const state = Object.create(base, {
          polygonTree: { get: tree },
          polygons: { get: () => tree().polygons },
          clipperPaths: { get: () => tree().clipperPaths },
          triangulation: { get: () => tree().triangulation },
          bounds: { get: () => tree().bounds },
          area: { get: () => tree().area },
        });
        Object.defineProperty(preview, 'animationState', { configurable: true, get: () => state });
      }
      preview._dsctSquares = squares;
      preview._dsctLineMark = lineMark(area);
      preview._dsctSquareTree = squares ? testDoc(squares).polygonTree : null;
      preview.renderFlags.set({ refreshGeometry: true });
    };

    const dropRegion = async () => {
      const old = region;
      region = null;
      if (old) await safeDelete(old);
    };

    const linkAbility = async (doc) => {
      if (doc) await doc.update({ [`flags.${DS}.abilitySource`]: ability.uuid });
      return doc;
    };

    const createRegion = async (shape, mark = null, elevation = null) => {
      await dropRegion();
      region = await createHeldRegion(ability, shape, mark, elevation);
      state = region ? 'placed' : 'empty';
      scan(region);
    };

    const updatePlacing = () => {
      if (!placing) return;
      const c = covered(placing.document);
      if (area.shape === 'line') squarePreview(placing.preview, c.shaped ? c.shapes : null);
      scan(c.shapes);
    };

    const rebuild = async () => {
      if (area.shape === 'cube') {
        const span = cubeSpan();
        spanAt = () => span;
        await region.update({ elevation: elevationOf(span) });
        scan(region);
        return;
      }
      if (!vert.line) return;
      const line = currentLine();
      spanAt = line.spanAt;
      const shaped = !!vert.tilt || isDiagonal(vert.line.rotation);
      await createRegion(line.shapes, shaped ? lineMark(area) : null, elevationOf(line.whole));
    };

    let queue = Promise.resolve();
    const refresh = () => {
      queue = queue.then(async () => {
        if (state === 'placing') updatePlacing();
        else if (state === 'placed' && region) await rebuild();
      }).catch((err) => console.warn('DSCT | area picker | height change failed:', err));
      return queue;
    };

    const setHeight = (z) => {
      if (!movable || !Number.isFinite(z)) return null;
      vert.z = Math.round(z);
      return refresh();
    };
    const shiftHeight = (dz) => setHeight(vert.z + dz);

    const shiftTilt = (dir) => {
      if (area.shape !== 'line') return null;
      const next = dir > 0 ? TILTS.find((t) => t > vert.tilt + 1e-6) : [...TILTS].reverse().find((t) => t < vert.tilt - 1e-6);
      if (next === undefined) return null;
      vert.tilt = next;
      return refresh();
    };

    const aimAt = ({ x, y, z }) => {
      if (area.shape !== 'line' || !vert.line || !Number.isFinite(z)) return null;
      const gs = gridSize();
      const rad = (turnOf(vert.line.rotation) * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const major = Math.max(Math.abs(dx), Math.abs(dy));
      const along = ((((x + 0.5) * gs - vert.line.x) * dx + ((y + 0.5) * gs - vert.line.y) * dy) / gs) * major;
      const run = Math.max(0, Math.floor(along));
      const rise = Math.round(z) - vert.z;
      vert.tilt = run === 0 ? (rise === 0 ? 0 : Math.sign(rise) * 90) : Math.max(-90, Math.min(90, (Math.atan2(rise, run) * 180) / Math.PI));
      return refresh();
    };

    const startPlacing = async () => {
      if (!movable || state === 'placing') return;
      const mine = ++generation;
      await dropRegion();
      excluded.clear();
      state = 'placing';
      scan(null);
      const placed = await ability.system.placeTemplate({
        createOptions: { dsctAreaHold: true },
        onMove: area.shape === 'cube' ? ({ shape, position }) => {
          const gs = gridSize();
          const n = area.size;
          const gx = Math.round(position.x / gs - n / 2);
          const gy = Math.round(position.y / gs - n / 2);
          shape.updateSource({ x: (gx + n * (shape.anchorX ?? 0)) * gs, y: (gy + n * (shape.anchorY ?? 0)) * gs });
          return false;
        } : area.shape === 'line' ? ({ shape, position }) => {
          shape.updateSource(snapLineOrigin(area, position, shape.rotation ?? 0));
          return false;
        } : undefined,
        onRotate: ({ shape, event, document, preview }) => {
          placing = { document, preview };
          const raising = area.shape === 'cube' || game.keyboard.isModifierActive('CONTROL');
          if (raising) {
            shiftHeight(-Math.sign(event.delta));
            return false;
          }
          const rotation = turnOf(Math.round(((shape.rotation ?? 0) + _turnStep * Math.sign(event.delta)) / _turnStep) * _turnStep);
          shape.updateSource({ rotation, ...snapLineOrigin(area, { x: shape.x, y: shape.y }, rotation) });
          return false;
        },
        onChange: ({ document, preview }) => {
          if (mine !== generation) return;
          placing = { document, preview };
          updatePlacing();
        },
        preConfirm: ({ document }) => {
          if (!enforce || withinRange(covered(document).shapes, fp, area.range, me, spanAt)) return true;
          overlay.flashWarning(L('outOfRange', { range: area.range }));
          return false;
        },
        preSkip: () => false,
        preCommit: (documents) => {
          for (const doc of documents) {
            const changes = { [`flags.${DS}.abilitySource`]: new foundry.data.operators.ForcedDeletion() };
            const c = covered(doc);
            changes.elevation = elevationOf(c.whole);
            if (c.shaped) Object.assign(changes, { shapes: c.shapes, _shapeConstraints: null, [`flags.${M}.${LINE_FLAG}`]: lineMark(area) });
            doc.updateSource(changes);
          }
        },
      }).catch((err) => { console.warn('DSCT | area picker | placement failed:', err); return null; });
      placing = null;
      if (mine !== generation) {
        if (placed) await safeDelete(placed);
        return;
      }
      region = await linkAbility(placed ?? null);
      state = region ? 'placed' : 'empty';
      scan(region);
    };

    const suggest = async () => {
      if (!movable) return;
      const best = suggestShape(ability, area, caster, candidates);
      if (!best) { overlay.flashWarning(L('noSuggestion')); return; }
      ++generation;
      if (state === 'placing') canvas.regions._cancelPlacement?.();
      excluded.clear();
      state = 'busy';
      vert.z = best.geo.z;
      let whole = { b: vert.z, t: vert.z + area.size };
      let mark = null;
      if (area.shape === 'line') {
        vert.tilt = best.geo.tilt;
        vert.line = best.geo.line;
        const line = currentLine();
        spanAt = line.spanAt;
        whole = line.whole;
        if (vert.tilt || isDiagonal(vert.line.rotation)) mark = lineMark(area);
      } else spanAt = () => whole;
      await createRegion(best.shapes, mark, elevationOf(whole));
    };

    const cleanup = () => {
      clearTimeout(pendingClick);
      clearInterval(watchdog);
      Hooks.off('canvasTearDown', onTearDown);
      if (_activeAreaCancel === quietCancel) _activeAreaCancel = null;
      if (canvas.tokens) canvas.tokens.interactiveChildren = true;
      if (canvas._onDragCanvasPan === noEdgePan) delete canvas._onDragCanvasPan;
      if (bar?.isConnected) {
        overlay.end();
        _clearPickerReticles();
      }
      canvas.stage.off('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      Hooks.callAll('dsct.areaPreview', null);
    };

    const doCancel = async ({ quiet = false } = {}) => {
      if (state === 'cancelled' || state === 'done') return;
      ++generation;
      if (state === 'placing') canvas.regions?._cancelPlacement?.();
      state = 'cancelled';
      cleanup();
      await dropRegion();
      setFoundryTargets(previousTargets.filter(t => t.scene));
      if (!quiet) ui.notifications.info(L('cancelled'));
      resolve(null);
    };
    const quietCancel = () => doCancel({ quiet: true });

    
    const bar = document.getElementById('dsct-picker-topbar');
    const watchdog = setInterval(() => { if (!bar?.isConnected) quietCancel(); }, 250);
    const onTearDown = () => quietCancel();
    Hooks.on('canvasTearDown', onTearDown);
    _activeAreaCancel = quietCancel;

    const tryConfirm = () => {
      if (state !== 'placed' || !region) { overlay.flashWarning(L('noArea')); return; }
      ++generation;
      const targets = finalTargets();
      const held = region;
      region = null;
      state = 'done';
      cleanup();
      resolve({ targets, region: held });
    };

    const onClick = (event) => {
      if (event.data.originalEvent.button !== 0) return;
      const now = Date.now();
      const isDouble = now - lastClickAt < DOUBLE_CLICK_MS;
      lastClickAt = now;
      if (state === 'placing') return;
      clearTimeout(pendingClick);
      if (isDouble) { lastClickAt = 0; suggest(); return; }
      const pos = event.data.getLocalPosition(canvas.app.stage);
      const hit = state === 'placed' ? hitToken(pos, inside) : null;
      if (hit) {
        if (!canExclude) return;
        if (excluded.has(hit.id)) excluded.delete(hit.id);
        else excluded.add(hit.id);
        draw();
        return;
      }
      if (movable) pendingClick = setTimeout(() => startPlacing(), DOUBLE_CLICK_MS);
    };

    const onKey = (event) => {
      const vertical = movable && { PageUp: () => shiftHeight(1), PageDown: () => shiftHeight(-1), ']': () => shiftTilt(1), '[': () => shiftTilt(-1) }[event.key];
      if (vertical && !event.target?.closest?.('input, textarea, [contenteditable]')) {
        event.preventDefault();
        event.stopPropagation();
        vertical();
        return;
      }
      if (event.key === 'Enter' && state !== 'placing') {
        event.preventDefault();
        event.stopPropagation();
        tryConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        doCancel();
      }
    };

    canvas.stage.on('mousedown', onClick);
    document.addEventListener('keydown', onKey);

    if (area.shape === 'burst') createRegion(burstShape(area, caster));
    else startPlacing();
  });
}

export async function pickAreaTargetsFor(ability) {
  if (!getSetting('areaPicker')) return undefined;
  const area = areaOf(ability);
  const caster = area ? casterTokenFor(ability) : null;
  if (!caster || isTriggeredAbility(ability) || ability.getFlag?.(M, 'areaFilter')?.carriers) return undefined;
  const result = await runAreaPicker(ability, area, caster);
  if (!result) return null;
  await releaseAreaHold(result.region);
  return result.targets;
}

export function checkAndRunAreaPicker(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return null;

  const picked = _picked.get(ability.uuid);
  if (picked && !picked.opened) {
    picked.opened = true;
    return null;
  }

  const area = getSetting('abilityTargetingEnabled') && getSetting('areaPicker') ? areaOf(ability) : null;
  const caster = area ? casterTokenFor(ability) : null;
  const silentBurst = area?.shape === 'burst' && getSetting('autoConfirmSelection');
  if (!area || !caster || silentBurst || isTriggeredAbility(ability) || ability.getFlag?.(M, 'areaFilter')?.carriers) {
    checkAndRunBurstTargeting(dialog);
    if (silentBurst && caster && !isTriggeredAbility(ability) && !ability.getFlag?.(M, 'areaFilter')?.carriers) {
      createHeldRegion(ability, burstShape(area, caster))
        .then((region) => { if (region) watchRelease(ability, region.uuid, { opened: true }); })
        .catch((err) => console.warn('DSCT | area picker | burst area failed:', err));
    }
    return null;
  }

  runAreaPicker(ability, area, caster).then((result) => {
    if (!result) return;
    watchRelease(ability, result.region.uuid);
    setFoundryTargets(result.targets);
    ds.helpers.macros.rollItemMacro(ability.uuid);
  }).catch((err) => console.error('DSCT | area picker | failed:', err));
  return 'block';
}
