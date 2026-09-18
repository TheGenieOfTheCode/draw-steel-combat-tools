import { hasSightToToken, coveredInSquare, seenPlainlyInSquare, concealingRegions, getSetting } from '../helpers.mjs';
import { coverWithBurrow as hasCover } from './burrow.mjs';
import { isConcealed } from './stealth.mjs';

const GS = () => canvas.grid.size;

const pairKey = (a, b) => `${a}|${b}`;

const _lastSeen = new Map();
const _lastHarm = new Map();

export const gridOf = (token) => ({
  x: Math.floor(token.document.x / GS()),
  y: Math.floor(token.document.y / GS()),
  w: Math.max(1, Math.round(token.document.width)),
  h: Math.max(1, Math.round(token.document.height)),
});

export const seesClearly = (observer, target) =>
  !!observer && !!target
  && hasSightToToken(observer, target)
  && !isConcealed(target)
  && !hasCover(observer, target);

export const lastSeenOf = (observer, target) =>
  _lastSeen.get(pairKey(observer?.id, target?.id)) ?? null;

export const lastHarmOf = (attacker, victim) =>
  _lastHarm.get(pairKey(attacker?.id, victim?.id)) ?? null;

export function noteHarm(attacker, victim) {
  if (!attacker || !victim) return;
  _lastHarm.set(pairKey(attacker.id, victim.id), {
    at: gridOf(attacker),
    round: game.combat?.round ?? null,
    time: Date.now(),
  });
}

function _rolledTargetTokens(message) {
  const parts = Array.from(message?.system?.parts ?? []).map(p => (Array.isArray(p) ? p[1] : p));
  const out = new Map();
  for (const part of parts) {
    for (const roll of Array.from(part?.rolls ?? [])) {
      const uuid = roll?.options?.target;
      if (!uuid || out.has(uuid)) continue;
      const actor = fromUuidSync(uuid);
      if (actor?.documentName !== 'Actor') continue;
      const token = actor.getActiveTokens?.(true, false)?.[0]
        ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
      if (token) out.set(uuid, token);
    }
  }
  return [...out.values()];
}

function _noteHarmFromMessage(message) {
  if (!game.users.activeGM?.isSelf || !game.combat) return;
  const sourceToken = message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null;
  if (!sourceToken) return;

  for (const victim of _rolledTargetTokens(message)) {
    if (victim.id === sourceToken.id) continue;
    noteHarm(sourceToken, victim);
  }
}

export function clearObservationMemory() {
  _lastSeen.clear();
  _lastHarm.clear();
}

function _sampleAlongPath(target, options) {
  if (!target?.actor || !game.combat) return false;

  const movement = options?._movement?.[target.id];
  const passed = movement?.passed?.waypoints ?? [];
  if (!passed.length) return false;

  const walked = target.document.getCompleteMovementPath(passed);
  if (!walked.length) return false;

  const size = GS();
  const cellsW = Math.max(1, Math.round(target.document.width));
  const cellsH = Math.max(1, Math.round(target.document.height));
  const concealed = isConcealed(target);
  const disposition = target.document.disposition;
  const regions = concealingRegions();

  for (const observer of canvas.tokens.placeables) {
    if (observer.id === target.id || !observer.actor) continue;
    if (observer.document.disposition === disposition) continue;

    const key = pairKey(observer.id, target.id);
    let clearAt = null;
    if (!concealed) {
      for (const step of walked) {
        const gx = Math.floor(step.x / size);
        const gy = Math.floor(step.y / size);
        if (seenPlainlyInSquare(observer, gx, gy, cellsW, cellsH, regions)) clearAt = { x: gx, y: gy };
      }
    }

    if (clearAt) {
      const stillClear = seesClearly(observer, target);
      _lastSeen.set(key, { at: clearAt, round: game.combat?.round ?? null, clear: stillClear });
    } else {
      const prior = _lastSeen.get(key);
      if (prior?.clear) _lastSeen.set(key, { ...prior, clear: false });
    }
  }
  return true;
}

function _sampleAgainst(target) {
  if (!target?.actor || !game.combat) return;
  const disposition = target.document.disposition;

  for (const observer of canvas.tokens.placeables) {
    if (observer.id === target.id || !observer.actor) continue;
    if (observer.document.disposition === disposition) continue;

    const key = pairKey(observer.id, target.id);
    const clear = seesClearly(observer, target);
    if (clear) {
      _lastSeen.set(key, { at: gridOf(target), round: game.combat?.round ?? null, clear: true });
    } else {
      const prior = _lastSeen.get(key);
      if (prior?.clear) _lastSeen.set(key, { ...prior, clear: false });
    }
  }
}

function _sampleAll(skipId = null) {
  if (!game.combat) return;
  for (const token of canvas.tokens.placeables) {
    if (token.actor && token.id !== skipId) _sampleAgainst(token);
  }
}

const _cellKey = (gx, gy) => `${gx},${gy}`;

const _centreOf = (gx, gy) => {
  const size = GS();
  return { x: gx * size + size / 2, y: gy * size + size / 2 };
};

function _reachable(target, radius) {
  const { x, y, w, h } = gridOf(target);
  const backend = CONFIG?.Canvas?.polygonBackends?.move;
  const seen = new Set();
  const queue = [];

  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      seen.add(_cellKey(x + dx, y + dy));
      queue.push({ x: x + dx, y: y + dy, d: 0 });
    }
  }

  const out = [];
  while (queue.length) {
    const cell = queue.shift();
    if (cell.d >= radius) continue;

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        if (!ox && !oy) continue;
        const nx = cell.x + ox;
        const ny = cell.y + oy;
        const key = _cellKey(nx, ny);
        if (seen.has(key)) continue;

        const from = _centreOf(cell.x, cell.y);
        const to = _centreOf(nx, ny);
        if (!canvas.dimensions.sceneRect.contains(to.x, to.y)) { seen.add(key); continue; }
        if (backend?.testCollision(from, to, { type: 'move', mode: 'any' })) continue;

        seen.add(key);
        queue.push({ x: nx, y: ny, d: cell.d + 1 });
        out.push({ x: nx, y: ny });
      }
    }
  }
  return out;
}

export function obscuredNear(observer, target, radius = null) {
  const out = { total: 0, obscured: 0, squares: [] };
  if (!observer || !target) return out;

  const r = Number.isFinite(radius) ? radius : (Number(getSetting('observationRadius')) || 3);
  const cellsW = Math.max(1, Math.round(target.document.width));
  const cellsH = Math.max(1, Math.round(target.document.height));
  const regions = concealingRegions();
  for (const sq of _reachable(target, r)) {
    out.total++;
    if (!coveredInSquare(observer, sq.x, sq.y, cellsW, cellsH, regions)) continue;
    out.obscured++;
    out.squares.push(sq);
  }
  return out;
}

export function suggestObserving(observer, target) {
  const clear = seesClearly(observer, target);
  const sight = hasSightToToken(observer, target);
  const adjacent = obscuredNear(observer, target, 1);
  const near = obscuredNear(observer, target);
  const threshold = Number(getSetting('observationAdjacentThreshold'));
  const limit = Number.isFinite(threshold) ? threshold : 1;

  let observing = clear;
  let reason = clear ? 'clear' : (sight ? 'obscured' : 'blind');

  
  
  
  if (!observing && sight && adjacent.obscured === 0) {
    observing = true;
    reason = 'pinned';
  }

  if (observing && adjacent.obscured > limit) {
    observing = false;
    reason = 'surrounded';
  }

  return {
    observing,
    reason,
    clear,
    sight,
    concealed: isConcealed(target),
    cover: sight && hasCover(observer, target),
    adjacent,
    near,
    lastSeen: lastSeenOf(observer, target),
    lastHarm: lastHarmOf(target, observer),
  };
}

export function registerObservationMemory() {
  Hooks.on('updateToken', (doc, changed, options) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!('x' in changed) && !('y' in changed)) return;

    const moved = doc.object;
    const walked = moved ? _sampleAlongPath(moved, options) : false;
    _sampleAll(walked ? moved.id : null);
  });

  for (const hook of ['createActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, () => {
      if (game.users.activeGM?.isSelf) _sampleAll();
    });
  }

  Hooks.on('createChatMessage', (message) => {
    try { _noteHarmFromMessage(message); }
    catch (err) { console.warn('DSCT | observation | could not record harm:', err); }
  });

  Hooks.on('combatStart', clearObservationMemory);
  Hooks.on('deleteCombat', clearObservationMemory);
}
