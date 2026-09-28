import { setting, dtSocket } from './dt-core.mjs';
import { reviveTokens, deathGroupFor, resolveDeathsNow, reportSquadDamage } from './death-tracker.mjs';
import { installRevivalHoverPreview } from './defeated-token-visibility.mjs';
import { releasePickerLock } from './picker-lock.mjs';
import { DSTD, DSTD_PANEL, DSTD_ROW, applicationSignature, registerPanelDecorator, services } from '../ctlib.mjs';

function _rowTargetDefeated(el) {
  const key = el?.closest(DSTD_ROW)?.dataset?.targetKey;
  if (!key || key === 'selected-token') return false;
  const doc = fromUuidSync(key.replace(/__/g, '.'));
  return !!doc?.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead');
}
const REVIVE_CLASS = 'dsct-revives';
const REVIVE_BADGE = 'dsct-revives-badge';

function _undoWouldRevive(btn) {
  if (btn.disabled) return null;
  const key = btn.closest(DSTD_ROW)?.dataset?.targetKey;
  if (!key || key === 'selected-token') return null;
  const tokenId = fromUuidSync(key.replace(/__/g, '.'))?.id;
  if (!tokenId) return null;
  const ids = deathGroupFor(tokenId);
  return ids.length ? ids : null;
}

function _dressRevivingButton(btn, ids) {
  btn._dsctReviveIds = ids;

  if (!btn.classList.contains(REVIVE_CLASS)) {
    btn.classList.add(REVIVE_CLASS);
    btn._dsctPlainTooltip = btn.dataset.tooltip ?? '';

    const badge = document.createElement('span');
    badge.className = REVIVE_BADGE;
    btn.appendChild(badge);

    
    installRevivalHoverPreview(btn, () => btn._dsctReviveIds ?? []);
  }

  
  const tally = new Map();
  for (const id of ids) {
    const name = canvas?.tokens?.get(id)?.name;
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const names = [...tally].map(([name, n]) => (n > 1 ? `${name} x${n}` : name));
  btn.dataset.tooltip = names.length
    ? game.i18n.format('DSCT.tooltip.undoRevives', { names: names.join(', ') })
    : game.i18n.localize('DSCT.tooltip.undoRevivesUnknown');
}

function _undressRevivingButton(btn) {
  btn._dsctReviveIds = null;
  btn.classList.remove(REVIVE_CLASS);
  btn.querySelector(`.${REVIVE_BADGE}`)?.remove();
  if (btn._dsctPlainTooltip !== undefined) btn.dataset.tooltip = btn._dsctPlainTooltip;
}

function _markRevivingUndoButtons(panel) {
  const everyone = new Set();
  const perSquad = new Map();

  for (const btn of panel.querySelectorAll(`${DSTD_ROW} [data-dstd-action="undoDamage"]`)) {
    const ids = _undoWouldRevive(btn);
    if (ids) {
      for (const id of ids) everyone.add(id);

      const section = btn.closest('.dsct-dstd-squad');
      if (section) {
        if (!perSquad.has(section)) perSquad.set(section, new Set());
        for (const id of ids) perSquad.get(section).add(id);
      }
      _dressRevivingButton(btn, ids);
    } else if (btn.classList.contains(REVIVE_CLASS)) {
      _undressRevivingButton(btn);
    }
  }

  for (const section of panel.querySelectorAll('.dsct-dstd-squad')) {
    const btn = section.querySelector('.dsct-dstd-squad-undo');
    if (!btn) continue;
    const ids = perSquad.get(section);
    if (!btn.disabled && ids?.size) _dressRevivingButton(btn, [...ids]);
    else if (btn.classList.contains(REVIVE_CLASS)) _undressRevivingButton(btn);
  }

  const undoAll = panel.querySelector(`.dsct-dstd-global-row .${DSTD}-undo-button`);
  if (!undoAll) return;
  if (!undoAll.disabled && everyone.size) _dressRevivingButton(undoAll, [...everyone]);
  else if (undoAll.classList.contains(REVIVE_CLASS)) _undressRevivingButton(undoAll);
}

let _remarkTimer = null;

function remarkRevivingUndoButtons() {
  clearTimeout(_remarkTimer);
  _remarkTimer = setTimeout(() => {
    for (const panel of document.querySelectorAll(DSTD_PANEL)) _markRevivingUndoButtons(panel);
  }, 250);
}

const _dsctPendingRevival = new Set();

function _installUndoDeathHook(root) {
  if (root.dataset.dsctDmgUndoTracked) return;
  root.dataset.dsctDmgUndoTracked = '1';
  const dbg = setting('debugMode');

  root.addEventListener('click', (e) => {
    
    
    
    const rowBtn = e.target.closest('[data-dstd-action="applyDamage"], [data-dstd-action="undoDamage"]');
    if (rowBtn?.closest(DSTD_PANEL)) {
      const messageId = rowBtn.closest('li.chat-message')?.dataset?.messageId ?? null;
      const message = messageId ? game.messages.get(messageId) : null;
      if (message) {
        window._dsctDstdRowPending = { messageId, signature: applicationSignature(message), at: Date.now() };
      }
    }

    if (setting('deathTrackerEnabled') && setting('overrideMinionDefeat')) {
      const applyBtn = e.target.closest('[data-dstd-action="applyDamage"]');
      if (applyBtn?.closest(DSTD_PANEL)) {
        try {
          const tgt = JSON.parse(applyBtn.dataset.target ?? 'null');
          const tokenIds = [];
          if (tgt?.tokenId) {
            tokenIds.push(tgt.tokenId);
          } else if (tgt?.selectedToken) {
            for (const t of Array.from(canvas.tokens?.controlled ?? [])) {
              const id = t.document?.id ?? null;
              if (id) tokenIds.push(id);
            }
          }
          for (const tokenId of tokenIds) reportSquadDamage(tokenId);
        } catch {}
      }
    }

    const undoBtn = e.target.closest(`.${DSTD}-undo-button:not(.dsct-dstd-undo-btn)`);
    if (dbg) console.log(`DSCT | DSTD undo-death | click, btn=${undoBtn?.className ?? 'none'}`);
    if (!undoBtn?.closest(DSTD_PANEL)) return;
    const actionRow = undoBtn.closest(`.${DSTD}-action-row`);
    if (!actionRow || actionRow.classList.contains('dsct-dstd-fm-row')) return;
    const targetRow = undoBtn.closest(DSTD_ROW);
    if (!targetRow) return;
    const { targetKey } = targetRow.dataset;
    if (dbg) console.log(`DSCT | DSTD undo-death | targetKey=${targetKey}`);
    if (!targetKey || targetKey === 'selected-token') return;
    const tokenUuid = targetKey.replace(/__/g, '.');

    
    
    
    
    markPendingRevival(tokenUuid);
    const socket = dtSocket();
    socket?.executeForEveryone('dsct.dstdPendingRevival', tokenUuid);

    if (game.users.activeGM?.isSelf) {
      setTimeout(() => runDstdUndoRevival(tokenUuid), 500);
    } else {
      if (!setting('playerCanUndoCausedDeaths')) return;
      if (!socket) return;
      socket.executeAsGM('dsct.dstdUndoDeath', tokenUuid);
    }
  }, { capture: true });

  root.addEventListener('click', (e) => {
    if (game.users.activeGM?.isSelf || setting('playerCanUndoCausedDeaths')) return;
    const undoDmgBtn = e.target.closest('[data-dstd-action="undoDamage"]');
    if (!undoDmgBtn?.closest(DSTD_PANEL)) return;
    
    if (!_rowTargetDefeated(undoDmgBtn)) return;
    e.stopImmediatePropagation();
    ui.notifications.warn(game.i18n.localize('DSCT.notice.playerCannotUndoDamage'));
  }, { capture: true });
}

export function markPendingRevival(tokenUuid, ttl = 8000) {
  _dsctPendingRevival.add(tokenUuid);
  setTimeout(() => _dsctPendingRevival.delete(tokenUuid), ttl);
}

export function queueDstdUndoRevival(tokenUuid, delay = 500) {
  markPendingRevival(tokenUuid);
  setTimeout(() => runDstdUndoRevival(tokenUuid), delay);
}

export async function runDstdUndoRevival(tokenUuid) {
  const dbg = setting('debugMode');
  try {
    const tokenDoc = await fromUuid(tokenUuid).catch(() => null);
    const token = tokenDoc?.object;
    if (dbg) console.log(`DSCT | DSTD undo-death | token=${token?.name}, dead=${token?.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead')}`);
    if (!token?.actor) return;
    const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    if (!token.actor.statuses?.has(defeatedStatus)) return;
    const deathGroup = window._dsctDeathGroups?.get(token.id);
    const toRevive = deathGroup
      ? [...deathGroup].filter(id => canvas.tokens.get(id)?.actor?.statuses?.has(defeatedStatus))
      : [token.id];
    await reviveTokens(toRevive.length ? toRevive : [token.id]);
  } catch (e) {
    console.warn('DSCT | DSTD undo-death | revival error:', e);
  } finally {
    _dsctPendingRevival.delete(tokenUuid);
  }
}

function _installDirectorFooter(panel) {
  if (!game.user.isGM) return;
  panel.querySelector('.dsct-dt-footer')?.remove();

  const footer = document.createElement('div');
  footer.className = 'dsct-dt-footer';

  const settle = document.createElement('button');
  settle.type = 'button';
  settle.className = DSTD + '-action-button dsct-dt-settle';
  settle.append(_makeIcon('fa-solid fa-forward'));
  settle.appendChild(document.createTextNode(' ' + game.i18n.localize('DSCT.button.settleDeathsNow')));
  settle.dataset.tooltip = game.i18n.localize('DSCT.tooltip.settleDeathsNow');
  settle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!resolveDeathsNow()) ui.notifications.info(game.i18n.localize('DSCT.notice.dt.nothingToSettle'));
  });

  const release = document.createElement('button');
  release.type = 'button';
  release.className = DSTD + '-action-button dsct-dt-release';
  release.append(_makeIcon('fa-solid fa-hand'));
  release.appendChild(document.createTextNode(' ' + game.i18n.localize('DSCT.button.releasePicker')));
  release.dataset.tooltip = game.i18n.localize('DSCT.tooltip.releasePicker');
  release.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    releasePickerLock();
  });

  footer.append(settle, release);
  panel.appendChild(footer);
}

function _makeIcon(cls) {
  const i = document.createElement('i');
  i.className = cls;
  return i;
}

export const registerDeathTrackerDstd = () => {
  for (const hook of ['createActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, (effect) => {
      if (!effect?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead')) return;
      remarkRevivingUndoButtons();
    });
  }

  registerPanelDecorator({ id: 'death-tracker-early', priority: 30, decorate: async ({ root, panel }) => {
    if (!panel) return;
    _installUndoDeathHook(root);

    const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    for (const deadRow of panel.querySelectorAll(DSTD_ROW)) {
      const dk = deadRow.dataset.targetKey;
      if (!dk || dk === 'selected-token') continue;
      if (deadRow.querySelector('.is-applied')) continue;
      const tokenUuid = dk.replace(/__/g, '.');
      if (_dsctPendingRevival.has(tokenUuid)) continue;
      const deadDoc = await fromUuid(tokenUuid).catch(() => null);
      if (deadDoc?.actor?.statuses?.has(defeatedStatus)) {
        if (setting('debugMode')) console.log(`DSCT | DSTD compat | removing dead target row ${dk}`);
        deadRow.remove();
      }
    }
  } });

  registerPanelDecorator({ id: 'death-tracker-late', priority: 70, decorate: ({ panel }) => {
    if (!panel) return;
    _installDirectorFooter(panel);
    if (!game.users.activeGM?.isSelf && !setting('playerCanUndoCausedDeaths')) {
      for (const btn of panel.querySelectorAll('[data-dstd-action="undoDamage"]')) {
        if (_rowTargetDefeated(btn)) btn.disabled = true;
      }
    }
    _markRevivingUndoButtons(panel);
  } });
};

services.provide('markPendingRevival', markPendingRevival);
