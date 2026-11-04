import { isPrimaryGM } from './ctlib.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'enhancedChoices';
const L = (key, data) => (data ? game.i18n.format(`DSCT.enhancedChoices.${key}`, data) : game.i18n.localize(`DSCT.enhancedChoices.${key}`));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

const granted = (item) => item?.parent?.items?.filter(i => i.getFlag('draw-steel', 'advancement')?.parentId === item.id) ?? [];

export const offersChoices = (doc) => !!doc?.flags?.[M]?.[FLAG];

export async function postEnhancedChoices(item) {
  const actor = item?.parent;
  if (actor?.documentName !== 'Actor' || !actor.items.has(item.id) || granted(item).length) return;
  const whisper = game.users.filter(u => u.isGM || actor.testUserPermission(u, 'OWNER')).map(u => u.id);
  const title = L('title', { name: item.name });
  await ds.documents.DrawSteelChatMessage.create({
    type: 'standard',
    title,
    content: `<p>${esc(L('body', { actor: actor.name, name: item.name }))}</p>`
      + `<footer class="message-part-buttons"><button type="button" class="dsct-enhanced-choose"><i class="fa-solid fa-list-check" inert></i> ${esc(L('choose'))}</button></footer>`,
    'system.parts': [{ type: 'content', flavor: title }],
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper,
    flags: { [M]: { [FLAG]: { itemUuid: item.uuid } } },
  });
}

function _settle(button, item) {
  if (!item) { button.disabled = true; button.textContent = L('gone'); return true; }
  if (granted(item).length) { button.disabled = true; button.textContent = L('chosen'); return true; }
  if (!item.isOwner) { button.disabled = true; return true; }
  return false;
}

export function registerEnhancedChoices() {
  Hooks.on('createItem', (item) => {
    const parentId = item.getFlag('draw-steel', 'advancement')?.parentId;
    const parent = parentId ? item.parent?.items?.get(parentId) : null;
    if (parent && offersChoices(parent)) {
      for (const message of game.messages.contents.slice(-50)) {
        if (message.getFlag(M, FLAG)?.itemUuid === parent.uuid) ui.chat.updateMessage(message);
      }
    }
    if (item.pack || !offersChoices(item) || item.parent?.documentName !== 'Actor' || !isPrimaryGM()) return;
    setTimeout(() => postEnhancedChoices(item).catch((err) => console.warn(`DSCT | enhanced choices | ${item.name}:`, err)), 1500);
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    const data = message.getFlag(M, FLAG);
    const button = data && html.querySelector('.dsct-enhanced-choose');
    if (!button) return;
    const item = fromUuidSync(data.itemUuid);
    if (_settle(button, item)) return;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      button.disabled = true;
      try { await item.system.applyAdvancements({ actor: item.parent }); }
      catch (err) { console.warn(`DSCT | enhanced choices | ${item.name}:`, err); }
      if (!_settle(button, item)) button.disabled = false;
    });
  });
}
