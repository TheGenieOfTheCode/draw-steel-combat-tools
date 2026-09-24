import { getModuleApi } from '../helpers.mjs';
import { revealPickerUi } from '../ability-automation/picker-overlay.mjs';

const M = 'draw-steel-combat-tools';
const BODY_CLASS = 'dsct-picker-lock';

const KILLSWITCH_AFTER_MS = 15000;

const LOCKED = [
  '[data-dstd-action="applyDamage"]',
  '[data-dstd-action="undoDamage"]',
  '.dsct-dstd-global-row button',
  '[data-action="execute-dc"]',
  '.dsct-undo-death',
].join(', ');

let _depth = 0;
let _killswitchTimer = null;
let _killswitchMessageId = null;

export const isPickerLocked = () => _depth > 0;

const _paint = () => document.body?.classList.toggle(BODY_CLASS, _depth > 0);

const _onClickCapture = (event) => {
  if (_depth <= 0) return;
  if (!event.target?.closest?.(LOCKED)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.lockedByPicker'));
};

const _dropKillswitch = () => {
  clearTimeout(_killswitchTimer);
  _killswitchTimer = null;
  const id = _killswitchMessageId;
  _killswitchMessageId = null;
  if (id) game.messages.get(id)?.delete().catch(() => {});
};

export function setPickerLockLocal(active) {
  _depth = active ? _depth + 1 : Math.max(0, _depth - 1);
  _paint();
}

export function clearPickerLockLocal() {
  _depth = 0;
  _paint();
  _dropKillswitch();
}

const _broadcast = (active) => {
  const socket = getModuleApi(false)?.socket;
  socket?.executeForOthers('dsct.setPickerLock', active).catch(() => {});
};

async function _postKillswitch() {
  if (_killswitchMessageId || !game.user.isGM) return;
  
  revealPickerUi();
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const msg = await ChatMessage.create({
    content: `<p class="dsct-killswitch-note">${game.i18n.localize('DSCT.chat.dt.pickerStuckNote')}</p>`
      + `<div class="message-part-buttons"><button type="button" data-dsct-picker-killswitch>`
      + `<i class="fa-solid fa-hand"></i> ${game.i18n.localize('DSCT.button.releasePicker')}</button></div>`,
    whisper: gmIds,
    flags: { [M]: { pickerKillswitch: true } },
  }).catch(() => null);
  _killswitchMessageId = msg?.id ?? null;
}

export function beginPickerLock() {
  setPickerLockLocal(true);
  _broadcast(true);
  if (_depth === 1 && game.user.isGM) {
    clearTimeout(_killswitchTimer);
    _killswitchTimer = setTimeout(() => _postKillswitch(), KILLSWITCH_AFTER_MS);
  }
}

export function endPickerLock() {
  setPickerLockLocal(false);
  _broadcast(false);
  if (_depth === 0) _dropKillswitch();
}

export function releasePickerLock() {
  for (const target of [document, window]) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }
  clearPickerLockLocal();
  getModuleApi(false)?.socket?.executeForOthers('dsct.clearPickerLock').catch(() => {});
  _dropKillswitch();
  ui.notifications.info(game.i18n.localize('DSCT.notice.dt.pickerLockReleased'));
}

export function registerPickerLock() {
  document.addEventListener('click', _onClickCapture, { capture: true });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!msg.getFlag(M, 'pickerKillswitch')) return;
    el.querySelector('[data-dsct-picker-killswitch]')?.addEventListener('click', (e) => {
      e.preventDefault();
      releasePickerLock();
    });
  });

  
  Hooks.on('canvasReady', () => clearPickerLockLocal());
}
