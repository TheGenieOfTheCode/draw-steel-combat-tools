import {
  safeCreateEmbedded, safeDelete, getSetting, getTokenById, footprintDistFromBounds,
} from '../helpers.mjs';

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
  img: getSetting('frightenedEffectIcon') || 'icons/svg/terror.svg',
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
  img: getSetting('tauntedEffectIcon') || 'systems/draw-steel/assets/icons/flag-banner-fold-fill.svg',
  type: 'base',
  system: { ...(end?.systemEnd ? { end: end.systemEnd } : {}), source: sourceActorUuid ?? '' },
  duration: end?.duration ?? {},
  changes: [], disabled: false,
  description: '@Embed[Compendium.draw-steel.journals.JournalEntry.hDhdILCi65wpBgPZ.JournalEntryPage.9zseFmXdcSw8MuKh inline]',
  tint: '#ffffff', transfer: false, statuses: [], sort: 0,
  flags: { [M]: { taunted: { sourceActorId, sourceTokenId } } },
};};

const _cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);

const _segBlocked = (from, to) => {
  for (const w of canvas.walls.placeables) {
    if (!w.document.sight) continue;
    const c = w.document.c;
    const d1 = _cross(c[0], c[1], c[2], c[3], from.x, from.y);
    const d2 = _cross(c[0], c[1], c[2], c[3], to.x,   to.y);
    const d3 = _cross(from.x, from.y, to.x, to.y, c[0], c[1]);
    const d4 = _cross(from.x, from.y, to.x, to.y, c[2], c[3]);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
};


export const sightBlockedBetween = (tokA, tokB) => {
  if (!tokA || !tokB) return true;
  return _segBlocked({ x: tokA.center.x, y: tokA.center.y }, { x: tokB.center.x, y: tokB.center.y });
};

const _SIGHT_SAMPLES = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];


export const sightBlockedBetweenTokens = (tokA, tokB) => {
  if (!tokA || !tokB) return true;
  const GS   = canvas.grid.size;
  const w    = Math.max(1, Math.round(tokB.document.width));
  const h    = Math.max(1, Math.round(tokB.document.height));
  const from = { x: tokA.center.x, y: tokA.center.y };
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const cellX = tokB.x + dx * GS;
      const cellY = tokB.y + dy * GS;
      for (const [fx, fy] of _SIGHT_SAMPLES) {
        if (!_segBlocked(from, { x: cellX + fx * GS, y: cellY + fy * GS })) return false;
      }
    }
  }
  return true;
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
  if (!getSetting('conditionsEnabled')) return;
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

      if (sightBlockedBetweenTokens(token, sourceTok)) return;

      const sx = sourceTok.document.x, sy = sourceTok.document.y;
      const sw = sourceTok.document.width, sh = sourceTok.document.height;
      const currentDist  = footprintDistFromBounds(doc.x, doc.y, doc.width, doc.height, sx, sy, sw, sh);
      const proposedDist = footprintDistFromBounds(changes.x ?? doc.x, changes.y ?? doc.y, doc.width, doc.height, sx, sy, sw, sh);

      if (proposedDist < currentDist) {
        canvas.ping(sourceTok.center);
        if (getSetting('allowIllegalMovement')) {
          ui.notifications.warn(game.i18n.format('DSCT.notice.conditions.frightenedCannotMove', { name: doc.name, source: sourceTok.name }));
        } else {
          delete changes.x; delete changes.y;
          ui.notifications.warn(game.i18n.format('DSCT.notice.conditions.frightenedBlocked', { name: doc.name, source: sourceTok.name }));
        }
      }
    });
  }
};
