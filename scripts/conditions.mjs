import {
  safeCreateEmbedded, safeDelete, getSetting, getTokenById,
} from './helpers.mjs';

// -- constants --

const M = 'draw-steel-combat-tools';


const resolveEffectEnd = (endStr) => {
  if (!endStr || endStr === 'unlimited') return null;
  if (endStr === 'save') return { duration: { expiry: 'save' }, systemEnd: { roll: '1d10 + @combat.save.bonus' } };
  return { duration: { expiry: endStr }, systemEnd: null };
};

const FRIGHTENED_EFFECT = (sourceActorId, sourceTokenId, sourceName, endStr, sourceActorUuid) => {
  const end = resolveEffectEnd(endStr);
  return {
  name: `Frightened [${sourceName}]`,
  img: 'icons/svg/terror.svg',
  type: 'base',
  system: { ...(end?.systemEnd ? { end: end.systemEnd } : {}), source: sourceActorUuid ?? '' },
  duration: end?.duration ?? {},
  changes: [], disabled: false,
  description: '@Embed[Compendium.draw-steel.journals.JournalEntry.hDhdILCi65wpBgPZ.JournalEntryPage.bXiI9vUF3tF78qXg inline]',
  tint: '#ffffff', transfer: false, statuses: [], sort: 0,
  flags: { [M]: { frightened: { sourceActorId, sourceTokenId } } },
};};

const TAUNTED_EFFECT = (sourceActorId, sourceTokenId, sourceName, endStr, sourceActorUuid) => {
  const end = resolveEffectEnd(endStr);
  return {
  name: `Taunted [${sourceName}]`,
  img: 'systems/draw-steel/assets/icons/flag-banner-fold-fill.svg',
  type: 'base',
  system: { ...(end?.systemEnd ? { end: end.systemEnd } : {}), source: sourceActorUuid ?? '' },
  duration: end?.duration ?? {},
  changes: [], disabled: false,
  description: '@Embed[Compendium.draw-steel.journals.JournalEntry.hDhdILCi65wpBgPZ.JournalEntryPage.9zseFmXdcSw8MuKh inline]',
  tint: '#ffffff', transfer: false, statuses: [], sort: 0,
  flags: { [M]: { taunted: { sourceActorId, sourceTokenId } } },
};};


// -- helpers --

export const sightBlockedBetween = (tokA, tokB) => {
  if (!tokA || !tokB) return true;
  const from = { x: tokA.center.x, y: tokA.center.y };
  const to   = { x: tokB.center.x, y: tokB.center.y };
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  for (const w of canvas.walls.placeables) {
    if (!w.document.sight) continue; 
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

const distSq = (tokA, tokB) => {
  const dx = tokA.center.x - tokB.center.x;
  const dy = tokA.center.y - tokB.center.y;
  return dx * dx + dy * dy;
};


export const getFrightenedData = (actor) => {
  const effect = actor?.appliedEffects?.find(e => e.getFlag(M, 'frightened'));
  return effect?.flags?.[M]?.frightened ?? null;
};

export const getTauntedData = (actor) => {
  const effect = actor?.appliedEffects?.find(e => e.getFlag(M, 'taunted'));
  return effect?.flags?.[M]?.taunted ?? null;
};


export const applyFrightened = async (targetToken, sourceActor, sourceTokenId, endStr = null) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const existing = actor.appliedEffects?.find(e => e.getFlag(M, 'frightened'));
  if (existing) await safeDelete(existing);
  await safeCreateEmbedded(actor, 'ActiveEffect', [FRIGHTENED_EFFECT(sourceActor.id, sourceTokenId, sourceActor.name, endStr, sourceActor.uuid)]);
  if (getSetting('debugMode')) console.log(`DSCT | Frightened | Applied to ${targetToken.name} source=${sourceActor.name} end=${endStr}`);
};

export const applyTaunted = async (targetToken, sourceActor, sourceTokenId, endStr = null) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const existing = actor.appliedEffects?.find(e => e.getFlag(M, 'taunted'));
  if (existing) await safeDelete(existing);
  await safeCreateEmbedded(actor, 'ActiveEffect', [TAUNTED_EFFECT(sourceActor.id, sourceTokenId, sourceActor.name, endStr, sourceActor.uuid)]);
  if (getSetting('debugMode')) console.log(`DSCT | Taunted | Applied to ${targetToken.name} source=${sourceActor.name} end=${endStr}`);
};


export const registerConditionHooks = () => {
  if (!window._dsctFrightenedHook) {
    window._dsctFrightenedHook = Hooks.on('preUpdateToken', (doc, changes) => {
      if (changes.x === undefined && changes.y === undefined) return;
      if (!getSetting('frightenedEnabled')) return;

      const token = doc.object;
      if (!token) return;

      const data = getFrightenedData(token.actor);
      if (!data) return;

      if (window._dsctFMBypassFrightened?.has(doc.id)) return;

      const sourceTok = getTokenById(data.sourceTokenId);
      if (!sourceTok) return;

      if (sightBlockedBetween(token, sourceTok)) return;

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
        if (getSetting('allowIllegalMovement')) {
          ui.notifications.warn(`${doc.name} is frightened of ${sourceTok.name} and cannot willingly move closer.`);
        } else {
          delete changes.x; delete changes.y;
          ui.notifications.warn(`${doc.name} is frightened of ${sourceTok.name} and cannot move closer!`);
        }
      }
    });
  }
};
