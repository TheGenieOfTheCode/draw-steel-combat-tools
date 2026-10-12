import { getSetting, footprintDistFromBounds, segmentBlocksSight, hasSightToToken } from '../helpers.mjs';
import { applyStatus, statusSourceData, statusSourceTokens } from './statuses.mjs';

export const sightBlockedBetween = (tokA, tokB) => {
  if (!tokA || !tokB) return true;
  return segmentBlocksSight(tokA.center, tokB.center);
};


export const sightBlockedBetweenTokens = (tokA, tokB) => {
  if (!tokA || !tokB) return true;
  return !hasSightToToken(tokA, tokB);
};


export const getFrightenedData = (actor) => statusSourceData(actor, 'frightened');
export const getTauntedData = (actor) => statusSourceData(actor, 'taunted');

const sourceFor = (sourceActor, sourceTokenId) => (sourceTokenId ? canvas.tokens?.get(sourceTokenId)?.actor : null) ?? sourceActor ?? null;

export const applyFrightened = (targetToken, sourceActor, sourceTokenId, endStr = null) =>
  applyStatus(targetToken, 'frightened', { source: sourceFor(sourceActor, sourceTokenId), end: endStr });

export const applyTaunted = (targetToken, sourceActor, sourceTokenId, endStr = null) =>
  applyStatus(targetToken, 'taunted', { source: sourceFor(sourceActor, sourceTokenId), end: endStr });


export const registerConditionHooks = () => {
  if (!getSetting('conditionsEnabled')) return;
  if (!window._dsctFrightenedHook) {
    window._dsctFrightenedHook = Hooks.on('preUpdateToken', (doc, changes) => {
      if (changes.x === undefined && changes.y === undefined) return;
      if (!getSetting('frightenedEnabled')) return;

      const token = doc.object;
      if (!token) return;

      if (!token.actor?.statuses?.has('frightened')) return;
      if (window._dsctFMBypassFrightened?.has(doc.id)) return;

      const sourceTok = statusSourceTokens(token.actor, 'frightened')[0];
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
