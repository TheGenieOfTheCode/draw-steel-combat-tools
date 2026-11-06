import { getSetting, applyFall } from '../helpers.mjs';
import { safeSetFlag } from '../ctlib.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'systemFall';

const fallingParts = (message) => (message.system?.parts?.contents ?? []).filter((p) => p.type === 'falling');

async function takeSystemFall(message, part) {
  const doc = part.token;
  const token = doc?.object;
  if (!token) return;
  const surface = doc._findSupportingSurface();
  const result = await applyFall(token, surface?.elevation ?? 0, { skipConfirm: true });
  if (result?.cancelled || result?.fallDist > 0) await safeSetFlag(message, M, `${FLAG}.${part.id}`, true);
}

export function registerSystemFalls() {
  if (!globalThis.ds?.CONFIG?.MessagePart?.fall) return;
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!getSetting('forcedMovementEnabled')) return;
    for (const part of fallingParts(message)) {
      const section = html.querySelector(`section[data-message-part="${part.id}"]`);
      if (!section) continue;
      section.querySelectorAll('[data-action="applyDamage"], [data-action="resultPartContext"]').forEach((el) => el.remove());
      const button = section.querySelector('[data-action="fall"]');
      if (message.getFlag(M, `${FLAG}.${part.id}`)) {
        button?.remove();
        continue;
      }
      if (!button || section.dataset.dsctFall) continue;
      section.dataset.dsctFall = '1';
      section.addEventListener('click', (event) => {
        if (!event.target.closest('[data-action="fall"]')) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        takeSystemFall(message, part).catch((err) => console.error('DSCT | system fall', err));
      }, true);
    }
  });
}
