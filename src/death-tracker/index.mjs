import { registerDeathTrackerHooks, runRaiseDeadUI, reviveAll, runPowerWordKillUI, cleanupPixi, _runManualModePicker, _SQUAD_COLORS, _addDamagedToken, deathTrackerExcludedTypes, reviveTokens, mayUndoDeath } from './death-tracker.mjs';
import { registerDeferDeath, isDeathDeferred, DEFER_DEATH } from './defer-death.mjs';
import { registerDeathVisuals } from './death-visuals.mjs';
import { registerDefeatedTokenVisibility } from './defeated-token-visibility.mjs';
import { registerPickerLock, setPickerLockLocal, clearPickerLockLocal, releasePickerLock, isPickerLocked } from './picker-lock.mjs';
import { DT_ID, readFlag, writeFlag, setting } from './dt-core.mjs';
import { registerDeathTrackerDstd, queueDstdUndoRevival, markPendingRevival } from './dstd-death.mjs';

export { registerDeathTrackerHooks, registerPickerLock, registerDeferDeath, registerDeathVisuals, registerDefeatedTokenVisibility, registerDeathTrackerDstd };

export const deathTrackerApi = {
  deferDeath:    { status: DEFER_DEATH, isDeferred: isDeathDeferred },
  revive:        runRaiseDeadUI,
  raiseDead:     runRaiseDeadUI,
  reviveAll,
  powerWordKill: runPowerWordKillUI,
  cleanupPixi,
  releasePickerLock,
  deathTrackerExcludedTypes,
};

export const syncCedeDeathPicker = () => {
  if (!game.user.isGM) writeFlag(game.user, 'cedeDeathPickerToGM', game.settings.get(DT_ID, 'cedeDeathPickerToGM'));
};

export const registerDeathTrackerSockets = (socket) => {
  socket.register('dsct.openManualModePicker', async (serializedContexts, requestId) => {
    const contexts = serializedContexts.map((ctx, i) => ({
      ...ctx,
      color:          ctx.color ?? _SQUAD_COLORS[i % _SQUAD_COLORS.length],
      lockedIds:      new Set(ctx.lockedIds),
      preSelectedIds: new Set(ctx.preSelectedIds),
      poolTokenIds:   new Set(ctx.poolTokenIds),
    }));

    if (!game.settings.get(DT_ID, 'pickDeathsEnabled')) {
      const autoResult = [];
      for (const ctx of contexts) {
        for (const id of ctx.lockedIds)      autoResult.push(id);
        for (const id of ctx.preSelectedIds) autoResult.push(id);
      }
      socket.executeAsGM('dsct.manualModePickerResult', requestId, autoResult);
      return;
    }
    const picked = await _runManualModePicker(contexts);
    socket.executeAsGM('dsct.manualModePickerResult', requestId, picked ? [...picked] : null);
  });

  socket.register('dsct.manualModePickerResult', (requestId, pickedArray) => {
    const resolve = window._dsctPickerRequests?.get(requestId);
    if (!resolve) return;
    window._dsctPickerRequests.delete(requestId);
    resolve(pickedArray ? new Set(pickedArray) : null);
  });

  socket.register('dsct.reportDamagedToken', (tokenId, userId) => {
    if (setting('debugMode')) console.log(`DSCT | DT | reportDamagedToken received: ${tokenId} from user ${userId}`);
    _addDamagedToken(tokenId, userId);
  });

  socket.register('dsct.undoDeathMessage', async (messageId, userId, onlyIds = null) => {
    const msg = game.messages.get(messageId);
    if (!readFlag(msg, 'isDeathMessage')) return;
    const cause = readFlag(msg, 'cause') ?? {};
    const user = game.users.get(userId);
    if (!user || !mayUndoDeath(cause, user)) return;
    const named = readFlag(msg, 'deadTokenIds') ?? [];

    const ids = onlyIds?.length ? named.filter(id => onlyIds.includes(id)) : named;
    if (ids.length) await reviveTokens(ids);
  });

  socket.register('dsct.dstdUndoDeath',      (tokenUuid) => { queueDstdUndoRevival(tokenUuid); });
  socket.register('dsct.dstdPendingRevival', (tokenUuid) => { markPendingRevival(tokenUuid); });

  socket.register('dsct.setPickerLock',   (active) => setPickerLockLocal(active));
  socket.register('dsct.clearPickerLock', () => clearPickerLockLocal());
  socket.register('dsct.queryPickerLock', () => isPickerLocked());
};
