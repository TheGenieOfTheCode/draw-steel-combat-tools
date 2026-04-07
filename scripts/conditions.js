import {
  safeCreateEmbedded, safeDelete, getSetting, toGrid, toCenter, getTokenById,
} from './helpers.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const M = 'draw-steel-combat-tools';

const FRIGHTENED_ORIGIN = 'dsct-frightened';
const TAUNTED_ORIGIN    = 'dsct-taunted';

const FRIGHTENED_EFFECT = (sourceActorId, sourceTokenId) => ({
  name: 'Frightened',
  img: 'icons/magic/fire/explosion-fireball-medium-purple-pink.webp',
  type: 'base',
  system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
  changes: [], disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0,
  flags: { [M]: { frightened: { sourceActorId, sourceTokenId } } },
  origin: FRIGHTENED_ORIGIN,
});

const TAUNTED_EFFECT = (sourceActorId, sourceTokenId) => ({
  name: 'Taunted',
  img: 'icons/skills/social/intimidation-impressing.webp',
  type: 'base',
  system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
  changes: [], disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0,
  flags: { [M]: { taunted: { sourceActorId, sourceTokenId } } },
  origin: TAUNTED_ORIGIN,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Check whether any sight-blocking wall lies between two token placeables. */
export const sightBlockedBetween = (tokA, tokB) => {
  if (!tokA || !tokB) return true;
  const from = { x: tokA.center.x, y: tokA.center.y };
  const to   = { x: tokB.center.x, y: tokB.center.y };
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  for (const w of canvas.walls.placeables) {
    if (!w.document.sight) continue; // only vision-blocking walls
    const c = w.document.c;
    const d1 = cross(c[0], c[1], c[2], c[3], from.x, from.y);
    const d2 = cross(c[0], c[1], c[2], c[3], to.x,   to.y  );
    const d3 = cross(from.x, from.y, to.x, to.y, c[0], c[1]);
    const d4 = cross(from.x, from.y, to.x, to.y, c[2], c[3]);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
};

/** Euclidean squared distance between two token placeables (for direction checks). */
const distSq = (tokA, tokB) => {
  const dx = tokA.center.x - tokB.center.x;
  const dy = tokA.center.y - tokB.center.y;
  return dx * dx + dy * dy;
};

// ── Get condition data from an actor's effects ────────────────────────────────

export const getFrightenedData = (actor) => {
  const effect = actor?.appliedEffects?.find(e => e.origin === FRIGHTENED_ORIGIN);
  return effect?.flags?.[M]?.frightened ?? null;
};

export const getTauntedData = (actor) => {
  const effect = actor?.appliedEffects?.find(e => e.origin === TAUNTED_ORIGIN);
  return effect?.flags?.[M]?.taunted ?? null;
};

// ── Apply / remove conditions ─────────────────────────────────────────────────

export const applyFrightened = async (targetToken, sourceActor, sourceTokenId) => {
  const actor = targetToken.actor;
  if (!actor) return;
  // Remove any existing DSCT frightened before applying new one
  const existing = actor.appliedEffects?.find(e => e.origin === FRIGHTENED_ORIGIN);
  if (existing) await safeDelete(existing);
  await safeCreateEmbedded(actor, 'ActiveEffect', [FRIGHTENED_EFFECT(sourceActor.id, sourceTokenId)]);
  if (getSetting('debugMode')) console.log(`DSCT | Frightened | Applied to ${targetToken.name} with source=${sourceActor.name}`);
};

export const applyTaunted = async (targetToken, sourceActor, sourceTokenId) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const existing = actor.appliedEffects?.find(e => e.origin === TAUNTED_ORIGIN);
  if (existing) await safeDelete(existing);
  await safeCreateEmbedded(actor, 'ActiveEffect', [TAUNTED_EFFECT(sourceActor.id, sourceTokenId)]);
  if (getSetting('debugMode')) console.log(`DSCT | Taunted | Applied to ${targetToken.name} with source=${sourceActor.name}`);
};

// ── Movement restriction hook ─────────────────────────────────────────────────

export const registerConditionHooks = () => {
  // Block frightened tokens from voluntarily moving closer to their fear source
  if (!window._dsctFrightenedHook) {
    window._dsctFrightenedHook = Hooks.on('preUpdateToken', (doc, changes) => {
      if (changes.x === undefined && changes.y === undefined) return;
      if (!getSetting('frightenedEnabled')) return;

      const token = doc.object;
      if (!token) return;

      const data = getFrightenedData(token.actor);
      if (!data) return;

      const sourceTok = getTokenById(data.sourceTokenId);
      if (!sourceTok) return;

      // If sight is blocked, creature doesn't know the location — allow movement
      if (sightBlockedBetween(token, sourceTok)) return;

      // Calculate whether proposed position is closer to source than current
      const gs = canvas.grid.size;
      const proposed = {
        center: {
          x: (changes.x ?? doc.x) + (doc.width  * gs) / 2,
          y: (changes.y ?? doc.y) + (doc.height * gs) / 2,
        }
      };
      const currentDist  = distSq(token,    sourceTok);
      const proposedDist = distSq(proposed, sourceTok);

      if (proposedDist < currentDist) {
        delete changes.x; delete changes.y;
        ui.notifications.warn(`${doc.name} is frightened of ${sourceTok.name} and cannot move closer!`);
      }
    });
  }
};
