import { getSetting, getModuleApi, safeToggleStatusEffect, safeUpdate, getSquadGroup, MATERIAL_ICONS, safeCreateEmbedded, safeDelete, tokenAt, toGrid, chooseFreeSquare } from '../helpers.mjs';
import { setRaisedDeadVisible, activateTokenLayer, clearPreviewTokens, installRevivalHoverPreview } from './defeated-token-visibility.mjs';
import { renderDeathMessage, registerDeathCardRefresh } from './death-message.mjs';
import { beginPickerLock, endPickerLock, clearPickerLockLocal } from './picker-lock.mjs';
import { applySquadLabels } from '../squad-labels.mjs';
import { hasLiveCaptain } from '../squad-hud.mjs';
import { isDeathDeferred, isTokenDeathDeferred } from './defer-death.mjs';
import { animateDeathVisual, deathVisualSettled, syncDeathVisual, markDeathPending, clearDeathPending, deathSettlementPending } from './death-visuals.mjs';
import { beginPickerOverlay, endPickerOverlay, setPickerTarget, removePickerTarget, clearPickerArrows } from '../ability-automation/picker-overlay.mjs';

const M = 'draw-steel-combat-tools';

const _dropFlag = () => new foundry.data.operators.ForcedDeletion();

const CAUSE_TTL_MS = 8000;
let _damageCause = null;

const _latestDstdCardId = () => game.messages?.contents
  ?.slice(-25)
  .reverse()
  .find(m => m?.flags?.['draw-steel-target-damage']?.state?.targets?.length)?.id ?? null;

export const noteDamageCause = ({ dstd = false, userId = null, sourceActorUuid = null, messageId = null, stated = false } = {}) => {
  const now = Date.now();
  const fresh = _damageCause && now - _damageCause.at < CAUSE_TTL_MS ? _damageCause : null;
  
  const keepStated = fresh?.stated && !stated;
  _damageCause = {
    at: now,
    
    causeId: fresh?.causeId ?? foundry.utils.randomID(),
    dstd: dstd || !!fresh?.dstd,
    stated: stated || !!fresh?.stated,
    messageId: messageId ?? fresh?.messageId ?? null,
    userId: keepStated ? fresh.userId : (userId ?? fresh?.userId ?? null),
    sourceActorUuid: keepStated && fresh.sourceActorUuid
      ? fresh.sourceActorUuid
      : (sourceActorUuid ?? fresh?.sourceActorUuid ?? null),
  };
};

const CAUSE_MAX_MS = 5 * 60 * 1000;

const _stillSettling = () => (window._dsctDamageBatchDepth ?? 0) > 0
  || !!window._dsctManualKillAccumulator
  || (window._dsctPendingSquadTimers?.size ?? 0) > 0
  || window._dsctFlushBusy === true
  || window._dsctKillLockActive === true;

const _currentDamageCause = () => {
  if (_causeOverride) return _causeOverride;
  if (!_damageCause) return {};
  const age = Date.now() - _damageCause.at;
  if (age > CAUSE_MAX_MS || (age > CAUSE_TTL_MS && !_stillSettling())) return {};
  const { at, stated, ...cause } = _damageCause;
  return cause;
};

let _causeOverride = null;
const _withCause = async (cause, fn) => {
  if (!cause || !Object.keys(cause).length) return fn();
  const prev = _causeOverride;
  _causeOverride = cause;
  try { return await fn(); }
  finally { _causeOverride = prev; }
};

const _captainSeatOf = (combatant) => {
  if (!combatant) return null;
  for (const group of (game.combat?.groups ?? [])) {
    if (group.system?.captainId === combatant.id) return group.id;
  }
  return null;
};

const _groupNames = new Map();
const _noteGroupName = (groupId) => {
  if (!groupId) return;
  const name = game.combat?.groups?.get(groupId)?.name;
  if (name) _groupNames.set(groupId, name);
};
const _groupNameFor = (groupId) => !groupId ? null
  : (game.combat?.groups?.get(groupId)?.name ?? _groupNames.get(groupId) ?? null);

export const isDstdDeath = (message) => !!message?.getFlag(M, 'cause')?.dstd;

export const mayUndoDeath = (cause, user = game.user) => {
  if (user?.isGM) return true;
  if (!getSetting('playerCanUndoCausedDeaths')) return false;
  if (cause?.sourceActorUuid) {
    const source = fromUuidSync(cause.sourceActorUuid);
    if (source) return !!source.testUserPermission?.(user, 'OWNER');
  }
  return !!cause?.userId && cause.userId === user?.id;
};

export const deathGroupFor = (tokenId) => {
  const defeatedId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const stillDown = (id) => !!canvas?.tokens?.get(id)?.actor?.statuses?.has(defeatedId);
  if (!stillDown(tokenId)) return [];

  const group = window._dsctDeathGroups?.get(tokenId);
  if (group) {
    const ids = [...group].filter(stillDown);
    if (ids.length) return ids;
  }

  
  for (const msg of game.messages.contents.slice(-30).reverse()) {
    const flag = msg.flags?.[M];
    const ids = flag?.deadTokenIds;
    if (!ids?.includes(tokenId)) continue;
    const deaths = Array.isArray(flag.deaths) ? flag.deaths : null;
    const batch = deaths?.find(d => d.tokenId === tokenId)?.batch;
    const sameBatch = batch ? deaths.filter(d => d.batch === batch).map(d => d.tokenId) : ids;
    return sameBatch.filter(stillDown);
  }
  return [tokenId];
};

const TRANSITION = 'dsctTransition';
let _transitionSeq = 0;
export const beginTransition = (kind) => ({ [TRANSITION]: { kind, id: `${kind}-${++_transitionSeq}` } });
export const isOurTransition = (options) => !!options?.[TRANSITION];

const _updateTokens = async (updates, options = {}) => {
  if (!updates.length) return;
  if (canvas.scene?.canUserModify?.(game.user, 'update')) {
    return canvas.scene.updateEmbeddedDocuments('Token', updates, options).catch(() => {});
  }
  for (const { _id, ...data } of updates) {
    const doc = canvas.scene?.tokens?.get(_id);
    if (doc) await safeUpdate(doc, data, options).catch(() => {});
  }
};

const _emptyMinions = async (tokens) => {
  const list = [...tokens].filter(t => t?.actor?.system?.isMinion && (t.actor.system.stamina?.value ?? 0) > 0);
  if (!list.length) return;
  await _updateTokens(list.filter(t => !t.document.actorLink).map(t => ({ _id: t.id, 'delta.system.stamina.value': 0 })));
  for (const t of list.filter(t => t.document.actorLink)) {
    await safeUpdate(t.actor, { 'system.stamina.value': 0 }).catch(() => {});
  }
};

const _waitUntil = async (test, timeoutMs = 2000, stepMs = 25) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (test()) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
};

let _deathBatch = [];
let _deathBatchTimer = null;
const DEATH_BATCH_MS = 200;

const _processTokenDeath = async (token, actor, { batchEntries = null } = {}) => {
  if (!window._deathTrackerLocks) window._deathTrackerLocks = new Set();
  if (window._deathTrackerLocks.has(token.id)) {
    if (getSetting('debugMode')) console.log(`DSCT | DT | Lock already held for ${actor.name} (${token.id}), skipping.`);
    return;
  }
  window._deathTrackerLocks.add(token.id);
  if (getSetting('debugMode')) console.log(`DSCT | DT | Lock acquired for ${actor.name} (${token.id}).`);
  setTimeout(() => { window._deathTrackerLocks.delete(token.id); if (getSetting('debugMode')) console.log(`DSCT | DT | Lock released for ${actor.name} (${token.id}).`); }, 2000);

  if (window._activeGrabs) {
    for (const [gid, grab] of [...window._activeGrabs.entries()]) {
      if (grab.grabbedTokenId === token.id || grab.grabberTokenId === token.id) {
        const api = getModuleApi(false);
        if (api) await api.endGrab(gid, { silent: false, customMsg: `${actor.name} fell, ending the grab.` });
      }
    }
  }

  for (const t of canvas.tokens.placeables) {
    const a = t.actor;
    if (!a) continue;
    const frightenedEffect = a.appliedEffects?.find(e => e.getFlag(M, 'frightened')?.sourceTokenId === token.id);
    if (frightenedEffect) {
      await safeDelete(frightenedEffect);
      if (getSetting('debugMode')) console.log(`DSCT | DT | Removed Frightened from ${a.name} (source ${actor.name} died)`);
    }
    const tauntedEffect = a.appliedEffects?.find(e => e.getFlag(M, 'taunted')?.sourceTokenId === token.id);
    if (tauntedEffect) {
      await safeDelete(tauntedEffect);
      if (getSetting('debugMode')) console.log(`DSCT | DT | Removed Taunted from ${a.name} (source ${actor.name} died)`);
    }
  }

  const combatant = game.combat?.combatants.find(c => c.tokenId === token.id);
  const groupId   = combatant?._source?.group ?? null;
  const flagData = { savedDisplayBars: token.document.displayBars };
  if (groupId) flagData.savedGroupId = groupId;
  _noteGroupName(groupId);
  const captainOf = _captainSeatOf(combatant);
  if (captainOf) { flagData.savedCaptainOf = captainOf; _noteGroupName(captainOf); }
  await Promise.all([
    token.document.update({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE, flags: { [M]: flagData } }),
    combatant ? combatant.delete() : Promise.resolve(),
  ]);

  const isObject = actor.type === 'object';

  await deathVisualSettled(token);

  if (canvas.tokens.get(token.id)) {
    if (!isObject) {
      if (getSetting('deathMarkerEnabled')) {
        const markerSrc = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
        const gs = canvas.grid.size;
        const tw = Math.max(1, token.document.width) * gs;
        const th = Math.max(1, token.document.height) * gs;
        
        const [markerTile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
          x: token.document.x + tw / 2, y: token.document.y + th / 2,
          width: tw / 2, height: th / 2,
          texture: { src: markerSrc },
          overhead: false, locked: true, hidden: false,
          restrictions: { light: false, weather: false },
          video: { loop: false, autoplay: false, volume: 0 },
          flags: { [M]: { deathMarkerFor: token.id } },
        }]);
        if (markerTile) await token.document.setFlag(M, 'deathMarkerTileId', markerTile.id);
      }

      const localTarget = [...game.user.targets].find(t => t.id === token.id);
      if (localTarget) localTarget.setTarget(false, { releaseOthers: false });
    } else {
      if (getSetting('debugMode')) console.log(`DSCT | DT | object death: rubblePlaced=${window._dsctRubblePlaced?.has(token.id)}, tokenId=${token.id}`);

      if (!window._dsctRubblePlaced?.has(token.id)) {
        const gs   = canvas.grid.size;
        const sz   = Math.max(1, actor.system?.combat?.size?.value ?? token.document.width ?? 1);
        const tilePx = sz * gs;
        await safeCreateEmbedded(canvas.scene, 'Tile', [{
          x: token.document.x + tilePx / 2, y: token.document.y + tilePx / 2,
          width: tilePx, height: tilePx,
          texture: { src: MATERIAL_ICONS.broken, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
          alpha: 1, overhead: false, hidden: false, locked: false,
          occlusion: { modes: [], alpha: 0 },
          restrictions: { light: false, weather: false },
          video: { loop: false, autoplay: false, volume: 0 },
          flags: { 'draw-steel-combat-tools': { isObjectRubble: true, objectTokenId: token.id } },
        }]);
      }

      await token.document.update({ hidden: true });
      await token.document.setFlag('draw-steel-combat-tools', 'isDefeatedObject', true);
    }

    if (!isObject) await _emptyMinions([token]);

    const entry = { name: actor.name, tokenId: token.id, isObject, cause: _currentDamageCause() };
    if (batchEntries) {
      batchEntries.push(entry);
    } else {
      _deathBatch.push(entry);
      if (_deathBatchTimer) clearTimeout(_deathBatchTimer);
      _deathBatchTimer = setTimeout(() => {
        const batch = [..._deathBatch];
        _deathBatch = [];
        _deathBatchTimer = null;
        flushDeathBatch(batch);
      }, DEATH_BATCH_MS);
    }
  }
};

const _manualConfirm = (msg, step) => new Promise((resolve) => {
  
  const existing = msg.getFlag(M, 'manualDecision') ?? '';
  if (existing.endsWith(`-${step}`)) { resolve(existing.startsWith('confirm')); return; }

  let updateId, deleteId;
  const cleanup = () => {
    Hooks.off('updateChatMessage', updateId);
    Hooks.off('deleteChatMessage', deleteId);
  };
  updateId = Hooks.on('updateChatMessage', (updated, changes) => {
    if (updated.id !== msg.id) return;
    const d = foundry.utils.getProperty(changes, `flags.${M}.manualDecision`);
    if (!d || !d.endsWith(`-${step}`)) return;
    cleanup();
    resolve(d.startsWith('confirm'));
  });
  deleteId = Hooks.on('deleteChatMessage', (deleted) => {
    if (deleted.id !== msg.id) return;
    cleanup();
    resolve(false);
  });
});

const _manualDecision = (msg, step) => new Promise((resolve) => {
  const parse = (d) => {
    if (d.startsWith('confirm')) return 'confirm';
    if (d.startsWith('undo'))    return 'undo';
    return 'abort';
  };
  const existing = msg.getFlag(M, 'manualDecision') ?? '';
  if (existing.endsWith(`-${step}`)) { resolve(parse(existing)); return; }

  let updateId, deleteId;
  const cleanup = () => {
    Hooks.off('updateChatMessage', updateId);
    Hooks.off('deleteChatMessage', deleteId);
  };
  updateId = Hooks.on('updateChatMessage', (updated, changes) => {
    if (updated.id !== msg.id) return;
    const d = foundry.utils.getProperty(changes, `flags.${M}.manualDecision`);
    if (!d || !d.endsWith(`-${step}`)) return;
    cleanup();
    resolve(parse(d));
  });
  deleteId = Hooks.on('deleteChatMessage', (deleted) => {
    if (deleted.id !== msg.id) return;
    cleanup();
    resolve('abort');
  });
});

const _doKillV3 = async (tokenIds, { skipHpCorrection = false, showNotification = true } = {}) => {
  if (!window._dsctManualKillTokenIds) window._dsctManualKillTokenIds = new Set();
  const _myTokenIds = new Set(tokenIds);
  for (const id of _myTokenIds) window._dsctManualKillTokenIds.add(id);
  
  if (!window._dsctDeathGroups) window._dsctDeathGroups = new Map();
  for (const id of _myTokenIds) window._dsctDeathGroups.set(id, _myTokenIds);
  
  const _prevKillLock = window._dsctKillLockActive;
  window._dsctKillLockActive = true;
  try {
    
    const tokens = [...tokenIds].map(id => canvas.tokens.get(id)).filter(t => t?.actor);
    if (!tokens.length) return;

    const _dbgTime = getSetting('debugMode');
    const _t0 = _dbgTime ? performance.now() : 0;
    let _renderHtmlCount = 0;
    let _renderHtmlHookId = null;
    let _stopFrameMonitor = false;
    let _droppedFrames = 0;
    let _worstFrameMs = 0;
    const _droppedFrameLog = [];
    if (_dbgTime) {
      _renderHtmlHookId = Hooks.on('renderChatMessageHTML', () => _renderHtmlCount++);
      
      const _frameLoop = (prev) => {
        if (_stopFrameMonitor) return;
        requestAnimationFrame((now) => {
          const dt = now - prev;
          if (dt > 33.3) {
            _droppedFrames++;
            _worstFrameMs = Math.max(_worstFrameMs, dt);
            _droppedFrameLog.push(`+${(now - _t0).toFixed(0)}ms: ${dt.toFixed(1)}ms/frame`);
          }
          _frameLoop(now);
        });
      };
      requestAnimationFrame((now) => _frameLoop(now));
      console.log(`DSCT | DT | [TIMING] _doKillV3 start (${tokens.length} token(s))`);
    }
    const _tm = (label) => { if (_dbgTime) console.log(`DSCT | DT | [TIMING +${(performance.now()-_t0).toFixed(0)}ms] ${label}`); };

    
    

    
    for (const t of tokens) {
      if (!canvas.tokens.get(t.id)) continue;
      if (!t.actor.statuses?.has('dead')) {
        _tm(`step 2: toggleStatusEffect dead -- ${t.actor.name}`);
        await safeToggleStatusEffect(t.actor, 'dead', { active: true });
        _tm(`step 2: done -- ${t.actor.name}`);
      }
    }
    _tm('step 2 complete; waiting 300ms');
    await new Promise(r => setTimeout(r, 300));
    _tm('300ms pause done');

    
    const step3GroupHpDeltas = new Map();
    for (const t of tokens) {
      if (!canvas.tokens.get(t.id)) continue;
      if (window._activeGrabs) {
        for (const [gid, grab] of [...window._activeGrabs.entries()]) {
          if (grab.grabbedTokenId === t.id || grab.grabberTokenId === t.id) {
            const api = getModuleApi(false);
            if (api) await api.endGrab(gid, { silent: false, customMsg: `${t.actor.name} fell, ending the grab.` });
          }
        }
      }
      for (const other of canvas.tokens.placeables) {
        const a = other.actor;
        if (!a) continue;
        const fe = a.appliedEffects?.find(e => e.getFlag(M, 'frightened')?.sourceTokenId === t.id);
        if (fe) { _tm(`step 3: deleting Frightened on ${a.name}`); await safeDelete(fe); }
        const te = a.appliedEffects?.find(e => e.getFlag(M, 'taunted')?.sourceTokenId === t.id);
        if (te) { _tm(`step 3: deleting Taunted on ${a.name}`); await safeDelete(te); }
      }
      const combatant = game.combat?.combatants.find(c => c.tokenId === t.id);
      const groupId   = combatant?._source?.group ?? null;
      const flagData  = { savedDisplayBars: t.document.displayBars };
      if (groupId) flagData.savedGroupId = groupId;
      _noteGroupName(groupId);
      const captainOf = _captainSeatOf(combatant);
      if (captainOf) { flagData.savedCaptainOf = captainOf; _noteGroupName(captainOf); }
      _tm(`step 3: token flags + combatant.delete -- ${t.actor.name}`);
      await Promise.all([
        t.document.update({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE, flags: { [M]: flagData } }),
        combatant ? combatant.delete() : Promise.resolve(),
      ]);
      _tm(`step 3: done -- ${t.actor.name}`);
      if (!skipHpCorrection && getSetting('cleanOrphanedCombatants') && t.actor.system?.isMinion && groupId) {
        const hp = t.actor.system.stamina?.max ?? 0;
        if (hp > 0) step3GroupHpDeltas.set(groupId, (step3GroupHpDeltas.get(groupId) ?? 0) + hp);
      }
    }
    for (const [gid, delta] of step3GroupHpDeltas) {
      const group = game.combat?.groups.get(gid);
      if (group) {
        _tm(`step 3: HP correction for group ${gid} (-${delta})`);
        await group.update({ 'system.staminaValue': Math.max(0, (group.system.staminaValue ?? 0) - delta) });
        _tm('step 3: HP correction done');
      }
    }
    _tm('step 3 complete; waiting 200ms');
    await new Promise(r => setTimeout(r, 200));
    _tm('200ms pause done');

    
    
    
    const batchEntries = [];
    const animDuration = (getSetting('batchAnimationSafety') && tokens.length >= 8) ? 0 : getSetting('deathAnimationDuration');
    _tm(`step 4: starting visuals (animDuration=${animDuration}ms)`);
    await Promise.all(tokens.map(async (t) => {
      if (!canvas.tokens.get(t.id)) return;
      const isObject = t.actor.type === 'object';
      await animateDeathVisual(t, { duration: window._dsctFMActive ? 0 : animDuration });
      if (!canvas.tokens.get(t.id)) return;
      if (!isObject) {
        if (getSetting('deathMarkerEnabled')) {
          const markerSrc = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
          const gs = canvas.grid.size;
          const tw = Math.max(1, t.document.width)  * gs;
          const th = Math.max(1, t.document.height) * gs;
          const [markerTile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
            x: t.document.x + tw / 2, y: t.document.y + th / 2,
            width: tw / 2, height: th / 2,
            texture: { src: markerSrc },
            overhead: false, locked: true, hidden: false,
            restrictions: { light: false, weather: false },
            video: { loop: false, autoplay: false, volume: 0 },
            flags: { [M]: { deathMarkerFor: t.id } },
          }]);
          _tm(`step 4: skull tile -- ${t.actor.name}`);
          if (markerTile) await t.document.setFlag(M, 'deathMarkerTileId', markerTile.id);
          _tm(`step 4: done -- ${t.actor.name}`);
        }
        const localTarget = [...game.user.targets].find(t2 => t2.id === t.id);
        if (localTarget) localTarget.setTarget(false, { releaseOthers: false });
      } else {
        if (!window._dsctRubblePlaced?.has(t.id)) {
          const gs     = canvas.grid.size;
          const sz     = Math.max(1, t.actor.system?.combat?.size?.value ?? t.document.width ?? 1);
          const tilePx = sz * gs;
          await safeCreateEmbedded(canvas.scene, 'Tile', [{
            x: t.document.x + tilePx / 2, y: t.document.y + tilePx / 2,
            width: tilePx, height: tilePx,
            texture: { src: MATERIAL_ICONS.broken, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
            alpha: 1, overhead: false, hidden: false, locked: false,
            occlusion: { modes: [], alpha: 0 },
            restrictions: { light: false, weather: false },
            video: { loop: false, autoplay: false, volume: 0 },
            flags: { [M]: { isObjectRubble: true, objectTokenId: t.id } },
          }]);
        }
      }
      batchEntries.push({ name: t.actor.name, tokenId: t.id, isObject, cause: _currentDamageCause() });
    }));

    _tm('step 4 complete; flushing death batch');
    if (batchEntries.length) flushDeathBatch(batchEntries);
    _tm('death batch flushed');
    
    for (const { tokenId, isObject: obj } of batchEntries) {
      if (!obj) continue;
      const tok = canvas.tokens.get(tokenId);
      if (tok) {
        await tok.document.update({ hidden: true });
        await tok.document.setFlag(M, 'isDefeatedObject', true);
      }
    }
    await _emptyMinions(tokens);
    if (_dbgTime) {
      _stopFrameMonitor = true;
      setTimeout(() => {
        Hooks.off('renderChatMessageHTML', _renderHtmlHookId);
        console.log(`DSCT | DT | [TIMING +${(performance.now()-_t0).toFixed(0)}ms] _doKillV3 COMPLETE`);
        console.log(`DSCT | DT | [TIMING] renderChatMessageHTML fired ${_renderHtmlCount}x during death window`);
        console.log(`DSCT | DT | [TIMING] Dropped frames (>33ms): ${_droppedFrames}, worst: ${_worstFrameMs.toFixed(1)}ms`);
        if (_droppedFrameLog.length) console.log('DSCT | DT | [TIMING] Frame drops:', _droppedFrameLog.join(' | '));
      }, 500);
    }
    if (showNotification) ui.notifications.info(tokens.length > 1 ? 'MASS POWER WORD: KILL' : 'POWER WORD: KILL');
  } finally {
    for (const id of _myTokenIds) window._dsctManualKillTokenIds.delete(id);
    if (!_prevKillLock) setTimeout(() => { window._dsctKillLockActive = false; }, 1500);
  }
};

const _doKillManual = async ({ tokenIds, squadGroup, processQueue, step1Extra = '', label = 'DT Debug', skipHpCorrection = false }) => {
  if (!window._dsctManualKillTokenIds) window._dsctManualKillTokenIds = new Set();
  const _myTokenIds = new Set(tokenIds);
  for (const id of _myTokenIds) window._dsctManualKillTokenIds.add(id);
  try {

  const tokens = [...tokenIds]
    .map(id => canvas.tokens.get(id))
    .filter(t => t?.actor && !t.actor.statuses?.has('dead'));
  if (!tokens.length) { processQueue(); return; }

  const origState = tokens.map(t => ({
    token: t,
    tint:  t.document.texture.tint ?? '#ffffff',
    alpha: t.document.alpha ?? 1,
  }));
  const restoreTints = () => Promise.all(
    origState.map(({ token, tint, alpha }) =>
      canvas.tokens.get(token.id) ? token.document.update({ 'texture.tint': tint, alpha }) : Promise.resolve()
    )
  );

  const sections = [];
  const mkSection = (step, title, lines, hint, { extra = '', done = false } = {}) =>
    `<div class="dsct-step-section${done ? ' dsct-step-done' : ''}">
      <p><strong>${label} &mdash; Step ${step}/4: ${title}</strong>${done ? ' &#x2713;' : ''}</p>
      ${extra}
      <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      ${!done && hint ? `<p><em>${hint}</em></p>` : ''}
    </div>`;
  const mkBtns = (step, undoable = false) =>
    `<div class="message-part-buttons">
      <button type="button" data-dsct-manual="confirm" data-dsct-step="${step}">&#x2713; Confirm</button>
      <button type="button" data-dsct-manual="${undoable ? 'undo' : 'abort'}" data-dsct-step="${step}">${undoable ? '&#x21a9; Undo' : '&#x2715; Abort'}</button>
    </div>`;
  const buildContent = (currentBlock, footer = '') =>
    `<div class="dsct-manual-step">${sections.join('')}${currentBlock}${footer}</div>`;

  let msg          = null;
  let currentStep  = 1;
  let step2Applied = false;
  let step3Applied = false;
  let s2Lines      = null; 
  let s2Section    = null;
  
  let step3PreData        = null; 
  let step3GroupHpDeltas  = null; 

  while (true) {

    
    if (currentStep === 1) {
      await Promise.all(tokens.map(t => t.document.update({ 'texture.tint': '#44dd44' })));
      const s1 = mkSection(1, 'Confirm Targets', tokens.map(t => t.actor.name),
        'Tokens tinted green. Confirm to apply the dead status effect.', { extra: step1Extra });
      if (!msg) {
        msg = await ChatMessage.create({
          content: buildContent(s1, mkBtns(1)),
          flags: { [M]: { manualStep: true } },
        });
      } else {
        await msg.update({ content: buildContent(s1, mkBtns(1)) });
      }

      if (!await _manualConfirm(msg, 1)) {
        await msg.update({ content: buildContent(s1 + '<p><em>&#x2715; Aborted.</em></p>') });
        await restoreTints();
        processQueue();
        return;
      }
      sections.push(mkSection(1, 'Confirm Targets', tokens.map(t => t.actor.name), null, { extra: step1Extra, done: true }));
      currentStep = 2;
    }

    
    else if (currentStep === 2) {
      if (!step2Applied) {
        for (const t of tokens) {
          if (!canvas.tokens.get(t.id)) continue;
          await safeToggleStatusEffect(t.actor, 'dead', { active: true });
        }
        await new Promise(r => setTimeout(r, 300));
        step2Applied = true;
      }
      const deadChecks = tokens.map(t => ({
        t, ok: !!(t.actor.statuses?.has('dead') || t.actor.appliedEffects?.some(e => e.statuses?.has('dead'))),
      }));
      await Promise.all(tokens.map(t => canvas.tokens.get(t.id) ? t.document.update({ 'texture.tint': '#aa44ff' }) : Promise.resolve()));
      s2Lines   = deadChecks.map(({ t, ok }) =>
        `${ok ? '&#x2713;' : '&#x2717;'} ${t.actor.name} &mdash; ${ok ? 'status confirmed' : '<strong>status NOT found!</strong>'}`);
      s2Section = mkSection(2, 'Dead Status Applied', s2Lines,
        'Tokens tinted purple. Confirm to clear conditions and remove from combat.');
      await msg.update({ content: buildContent(s2Section, mkBtns(2, true)) });

      const d = await _manualDecision(msg, 2);
      if (d === 'confirm') {
        sections.push(mkSection(2, 'Dead Status Applied', s2Lines, null, { done: true }));
        currentStep = 3;
      } else { 
        for (const t of tokens) {
          if (!canvas.tokens.get(t.id)) continue;
          await safeToggleStatusEffect(t.actor, 'dead', { active: false });
        }
        step2Applied = false; s2Lines = null; s2Section = null;
        sections.pop(); 
        currentStep = 1;
      }
    }

    
    else if (currentStep === 3) {
      if (!step3Applied) {
        
        step3PreData = tokens.map(t => {
          const combatant = game.combat?.combatants.find(c => c.tokenId === t.id);
          return { t, groupId: combatant?._source?.group ?? null, hadCombatant: !!combatant };
        });

        for (const t of tokens) {
          if (!canvas.tokens.get(t.id)) continue;
          if (window._activeGrabs) {
            for (const [gid, grab] of [...window._activeGrabs.entries()]) {
              if (grab.grabbedTokenId === t.id || grab.grabberTokenId === t.id) {
                const api = getModuleApi(false);
                if (api) await api.endGrab(gid, { silent: false, customMsg: `${t.actor.name} fell, ending the grab.` });
              }
            }
          }
          for (const other of canvas.tokens.placeables) {
            const a = other.actor;
            if (!a) continue;
            const fe = a.appliedEffects?.find(e => e.getFlag(M, 'frightened')?.sourceTokenId === t.id);
            if (fe) await safeDelete(fe);
            const te = a.appliedEffects?.find(e => e.getFlag(M, 'taunted')?.sourceTokenId === t.id);
            if (te) await safeDelete(te);
          }
          const combatant = game.combat?.combatants.find(c => c.tokenId === t.id);
          const groupId   = combatant?._source?.group ?? null;
          const flagData  = { savedDisplayBars: t.document.displayBars };
if (groupId) flagData.savedGroupId = groupId;
_noteGroupName(groupId);
const captainOf = _captainSeatOf(combatant);
if (captainOf) { flagData.savedCaptainOf = captainOf; _noteGroupName(captainOf); }
          await Promise.all([
            t.document.update({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE, flags: { [M]: flagData } }),
            combatant ? combatant.delete() : Promise.resolve(),
          ]);
        }
        step3GroupHpDeltas = new Map();
        if (!squadGroup && !skipHpCorrection && getSetting('cleanOrphanedCombatants')) {
          for (const t of tokens) {
            if (!t.actor.system?.isMinion) continue;
            const gid = t.document.getFlag(M, 'savedGroupId');
            if (!gid) continue;
            const hp = t.actor.system.stamina?.max ?? 0;
            if (hp > 0) step3GroupHpDeltas.set(gid, (step3GroupHpDeltas.get(gid) ?? 0) + hp);
          }
          for (const [gid, delta] of step3GroupHpDeltas) {
            const group = game.combat?.groups.get(gid);
            if (group) await group.update({ 'system.staminaValue': Math.max(0, (group.system.staminaValue ?? 0) - delta) });
          }
        }
        await new Promise(r => setTimeout(r, 200));
        step3Applied = true;
      }

      const removeChecks = tokens.map(t => ({
        t, stillIn: !!game.combat?.combatants.find(c => c.tokenId === t.id),
      }));
      await Promise.all(tokens.map(t => canvas.tokens.get(t.id) ? t.document.update({ 'texture.tint': '#ffaa00' }) : Promise.resolve()));
      const s3Lines = removeChecks.map(({ t, stillIn }) =>
        `${stillIn ? '&#x2717;' : '&#x2713;'} ${t.actor.name} &mdash; ${stillIn ? '<strong>still in combat!</strong>' : 'removed'}`);
      const s3 = mkSection(3, 'Removed from Combat', s3Lines,
        'Conditions cleared, combatants deleted. Tinted orange. Confirm to apply visual death treatment.');
      await msg.update({ content: buildContent(s3, mkBtns(3, true)) });

      const d = await _manualDecision(msg, 3);
      if (d === 'confirm') {
        sections.push(mkSection(3, 'Removed from Combat', s3Lines, null, { done: true }));
        currentStep = 4;
      } else { 
        for (const [gid, delta] of (step3GroupHpDeltas ?? new Map())) {
          const group = game.combat?.groups.get(gid);
          if (group) await group.update({ 'system.staminaValue': (group.system.staminaValue ?? 0) + delta });
        }
        for (const { t, groupId, hadCombatant } of (step3PreData ?? [])) {
          if (!canvas.tokens.get(t.id)) continue;
          await t.document.update({ flags: { [M]: {
            savedDisplayBars: _dropFlag(),
            savedGroupId:     _dropFlag(),
          } } });
if (hadCombatant && game.combat && !game.combat.combatants.find(c => c.tokenId === t.id)) {
            const combatantData = { tokenId: t.id, sceneId: canvas.scene.id, actorId: t.document.actorId };
            if (groupId) combatantData.group = groupId;
            await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
          }
        }
        step3Applied = false; step3PreData = null; step3GroupHpDeltas = null;
        sections.pop(); 
        currentStep = 2;
      }
    }

    
    else if (currentStep === 4) {
      const batchEntries = [];
      const animDuration = (getSetting('batchAnimationSafety') && tokens.length >= 8) ? 0 : getSetting('deathAnimationDuration');

      await restoreTints();
      await Promise.all(tokens.map(async (t) => {
        if (!canvas.tokens.get(t.id)) return;
        const isObject = t.actor.type === 'object';
        await animateDeathVisual(t, { duration: window._dsctFMActive ? 0 : animDuration });
        if (!canvas.tokens.get(t.id)) return;
        if (!isObject) {
          if (getSetting('deathMarkerEnabled')) {
            const markerSrc = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
            const gs = canvas.grid.size;
            const tw = Math.max(1, t.document.width)  * gs;
            const th = Math.max(1, t.document.height) * gs;
            const [markerTile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
              x: t.document.x + tw / 2, y: t.document.y + th / 2,
              width: tw / 2, height: th / 2,
              texture: { src: markerSrc },
              overhead: false, locked: true, hidden: false,
              restrictions: { light: false, weather: false },
              video: { loop: false, autoplay: false, volume: 0 },
              flags: { [M]: { deathMarkerFor: t.id } },
            }]);
            if (markerTile) await t.document.setFlag(M, 'deathMarkerTileId', markerTile.id);
          }
const localTarget = [...game.user.targets].find(t2 => t2.id === t.id);
          if (localTarget) localTarget.setTarget(false, { releaseOthers: false });
        } else {
          if (!window._dsctRubblePlaced?.has(t.id)) {
            const gs     = canvas.grid.size;
            const sz     = Math.max(1, t.actor.system?.combat?.size?.value ?? t.document.width ?? 1);
            const tilePx = sz * gs;
            await safeCreateEmbedded(canvas.scene, 'Tile', [{
              x: t.document.x + tilePx / 2, y: t.document.y + tilePx / 2,
              width: tilePx, height: tilePx,
              texture: { src: MATERIAL_ICONS.broken, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 },
              alpha: 1, overhead: false, hidden: false, locked: false,
              occlusion: { modes: [], alpha: 0 },
              restrictions: { light: false, weather: false },
              video: { loop: false, autoplay: false, volume: 0 },
              flags: { [M]: { isObjectRubble: true, objectTokenId: t.id } },
            }]);
          }
        }
        batchEntries.push({ name: t.actor.name, tokenId: t.id, isObject, cause: _currentDamageCause() });
      }));

      const s4 = mkSection(4, 'Visual Treatment Complete',
        batchEntries.map(e => `&#x2713; ${e.name} &mdash; death visuals applied`), null, { done: true });
      await msg.update({ content: buildContent(s4) });

      if (batchEntries.length) flushDeathBatch(batchEntries);
      
      for (const { tokenId, isObject: obj } of batchEntries) {
        if (!obj) continue;
        const tok = canvas.tokens.get(tokenId);
        if (tok) {
          await tok.document.update({ hidden: true });
          await tok.document.setFlag(M, 'isDefeatedObject', true);
        }
      }
      await _emptyMinions(tokens);
      ui.notifications.info(tokens.length > 1 ? 'MASS POWER WORD: KILL' : 'POWER WORD: KILL');
      processQueue();
      break;
    }
  }

  } finally {
    for (const id of _myTokenIds) window._dsctManualKillTokenIds.delete(id);
  }
};

let _postReviveLabelTimer = null;
const _schedulePostReviveLabels = () => {
  if (_postReviveLabelTimer) clearTimeout(_postReviveLabelTimer);
  _postReviveLabelTimer = setTimeout(async () => {
    _postReviveLabelTimer = null;
    if (getSetting('autoSquadLabelsEnabled') && getSetting('squadLabelApplyEffects') && game.combat) await applySquadLabels();
  }, 600);
};

const _resolveReviveSpaceConflicts = async (tokens) => {
  const defeatedId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const tokenSet   = new Set(tokens.map(t => t.id));

  const trackedPos = new Map();
  for (const t of tokens) {
    if (canvas.tokens.get(t.id)) trackedPos.set(t.id, toGrid(t.document));
  }

  for (const t of tokens) {
    if (!canvas.tokens.get(t.id)) continue;
    const tg    = trackedPos.get(t.id);
    if (!tg) continue;
    const tSize = t.actor?.system?.combat?.size?.value ?? 1;

    let blocker = null;
    search: for (let dx = 0; dx < tSize && !blocker; dx++) {
      for (let dy = 0; dy < tSize && !blocker; dy++) {
        const cx = tg.x + dx, cy = tg.y + dy;
        for (const [otherId, otherTg] of trackedPos) {
          if (otherId === t.id) continue;
          const other = canvas.tokens.get(otherId);
          if (!other || other.actor?.statuses?.has(defeatedId)) continue;
          const os = other.actor?.system?.combat?.size?.value ?? 1;
          if (cx >= otherTg.x && cx < otherTg.x + os && cy >= otherTg.y && cy < otherTg.y + os) { blocker = other; break search; }
        }
        const c = tokenAt(cx, cy, t.id);
        if (c && !tokenSet.has(c.id) && !c.actor?.statuses?.has(defeatedId)) { blocker = c; break search; }
      }
    }

    if (!blocker) continue;
    const bs = blocker.actor?.system?.combat?.size?.value ?? 1;
    if (Math.abs(tSize - bs) >= 2) continue;

    const chosen = await chooseFreeSquare(t, blocker, { forceOnCancel: true });
    if (chosen) {
      trackedPos.set(t.id, chosen);
      await safeUpdate(t.document, { x: chosen.x * canvas.grid.size, y: chosen.y * canvas.grid.size });
    }
  }
};

const _doReviveV3 = async ({ tokenIds, skipGroupHpRestore = false }) => {
  const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const tokens = [...tokenIds]
    .map(id => canvas.tokens.get(id))
    .filter(t => t?.actor?.statuses?.has(defeatedStatusId));
  if (!tokens.length) return;

  window._dsctReviveActive = true;
  const txn = beginTransition('revive');

  const _dbgTime = getSetting('debugMode');
  const _t0 = _dbgTime ? performance.now() : 0;
  let _stopFrameMonitor = false;
  let _droppedFrames = 0;
  let _worstFrameMs = 0;
  const _droppedFrameLog = [];
  if (_dbgTime) {
    const _frameLoop = (prev) => {
      if (_stopFrameMonitor) return;
      requestAnimationFrame((now) => {
        const dt = now - prev;
        if (dt > 33.3) {
          _droppedFrames++;
          _worstFrameMs = Math.max(_worstFrameMs, dt);
          _droppedFrameLog.push(`+${(now - _t0).toFixed(0)}ms: ${dt.toFixed(1)}ms/frame`);
        }
        _frameLoop(now);
      });
    };
    requestAnimationFrame((now) => _frameLoop(now));
    console.log(`DSCT | DT | [REVIVE TIMING] _doReviveV3 start (${tokens.length} token(s))`);
  }
  const _tm = (label) => { if (_dbgTime) console.log(`DSCT | DT | [REVIVE +${(performance.now()-_t0).toFixed(0)}ms] ${label}`); };

  
  
  const woken = tokens
    .filter(t => canvas.tokens.get(t.id))
    .map(t => ({
      t,
      needsStamina: (t.actor.system.stamina?.value ?? 0) <= 0,
      staminaValue: t.actor.system?.isMinion ? (t.actor.system.stamina?.max ?? 1) : 1,
    }));

  
  _tm(`step 2: ${woken.length} status(es) in sequence`);
  for (const { t } of woken) {
    await safeToggleStatusEffect(t.actor, defeatedStatusId, { overlay: true, active: false });
  }

  
  const hungry = woken.filter(w => w.needsStamina);
  const deltaWrites = hungry
    .filter(({ t }) => !t.document.actorLink)
    .map(({ t, staminaValue }) => ({ _id: t.id, 'delta.system.stamina.value': staminaValue }));
  if (deltaWrites.length) {
    _tm(`step 2: ${deltaWrites.length} stamina restore(s) in one write`);
    await _updateTokens(deltaWrites, txn);
  }
  for (const { t, staminaValue } of hungry.filter(({ t }) => t.document.actorLink)) {
    await safeUpdate(t.actor, { 'system.stamina.value': staminaValue }, txn);

    if (!t.actor.isOwner) t.actor.updateSource({ 'system.stamina.value': staminaValue });
  }
  _tm('step 2: writes away');

  const _settled = await _waitUntil(() => woken.every(({ t, needsStamina, staminaValue }) =>
    !t.actor?.statuses?.has(defeatedStatusId)
    && (!needsStamina || (t.actor.system.stamina?.value ?? 0) >= staminaValue)));
  if (!_settled) console.warn('DSCT | DT | revival: the board did not catch up with step 2, carrying on anyway');
  _tm('step 2 complete');
  const plan = [];
  for (const t of tokens) {
    if (!canvas.tokens.get(t.id)) continue;
    const isMinion = t.actor.system?.isMinion ?? false;
    plan.push({
      t,
      isMinion,
      savedGroupId:     t.document.getFlag(M, 'savedGroupId'),
      savedCaptainOf:   t.document.getFlag(M, 'savedCaptainOf'),
      savedDisplayBars: t.document.getFlag(M, 'savedDisplayBars'),
      markerTileId:     t.document.getFlag(M, 'deathMarkerTileId'),
      minionMaxHP:      isMinion ? (t.actor.system.stamina?.max ?? 0) : 0,
      needsCombatant:   !!game.combat && !game.combat.combatants.find(c => c.tokenId === t.id),
    });
  }

  const tokenUpdates = plan.map(({ t, savedDisplayBars }) => {
    const data = {
      _id: t.id,
      flags: { [M]: {
        savedGroupId:      _dropFlag(),
        savedCaptainOf:    _dropFlag(),
        savedDisplayBars:  _dropFlag(),
        deathMarkerTileId: _dropFlag(),
      } },
    };
    if (savedDisplayBars !== undefined) data.displayBars = savedDisplayBars;
    return data;
  });
  if (tokenUpdates.length) {
    _tm(`step 3a: ${tokenUpdates.length} token(s) in one update`);
    await _updateTokens(tokenUpdates, txn);
    _tm('step 3a: done');
  }

  const newCombatants = plan.filter(p2 => p2.needsCombatant).map(({ t, savedGroupId }) => {
    const data = { tokenId: t.id, sceneId: canvas.scene.id, actorId: t.document.actorId };
    if (savedGroupId) data.group = savedGroupId;
    return data;
  });
  if (newCombatants.length) {
    _tm(`step 3b: ${newCombatants.length} combatant(s) in one create`);
    await game.combat.createEmbeddedDocuments('Combatant', newCombatants, txn);
    _tm('step 3b: combatants done');
  }

  for (const { t, savedCaptainOf } of plan) {
    if (!savedCaptainOf) continue;
    const group = game.combat?.groups?.get(savedCaptainOf);
    if (!group || hasLiveCaptain(savedCaptainOf)) continue;
    const combatant = game.combat?.combatants?.find(c => c.tokenId === t.id);
    if (!combatant) continue;
    _tm(`step 3b: ${t.actor?.name} takes the crown of ${group.name} back`);
    await group.update({ 'system.captainId': combatant.id }, txn);
  }

  if (!skipGroupHpRestore) {
    const poolDeltas = new Map();
    for (const p2 of plan) {
      if (!p2.needsCombatant || !p2.savedGroupId || !p2.isMinion || p2.minionMaxHP <= 0) continue;
      poolDeltas.set(p2.savedGroupId, (poolDeltas.get(p2.savedGroupId) ?? 0) + p2.minionMaxHP);
    }
    for (const [groupId, delta] of poolDeltas) {
      const group = game.combat?.groups.get(groupId);
      if (!group) continue;

      const living = Array.from(group.members ?? []).filter(m => m?.actor?.system?.isMinion && !m.defeated);
      const ceiling = living.length * (living[0]?.actor?.system?.stamina?.max ?? 0);
      let restored = Math.max(0, (group.system.staminaValue ?? 0) + delta);
      if (ceiling > 0) restored = Math.min(restored, ceiling);
      _tm(`step 3b: group pool +${delta} to ${restored} in one write`);
      await group.update({ 'system.staminaValue': restored }, txn);
      _tm('step 3b: group pool done');
    }
  }

  _tm('step 3c: back to life');
  await Promise.all(plan.map(({ t }) => animateDeathVisual(t)));
  _tm('step 3 complete');
  await _resolveReviveSpaceConflicts(tokens);

  const markerTileIds = plan.map(p2 => p2.markerTileId).filter(id => id && canvas.scene.tiles.get(id));
  if (markerTileIds.length) {
    _tm(`step 4: ${markerTileIds.length} skull tile(s) in one delete`);
    await canvas.scene.deleteEmbeddedDocuments('Tile', markerTileIds, txn).catch(() => {});
    _tm('step 4: skull tiles done');
  }

  if (getSetting('clearEffectsOnRevive')) {
    
    for (const { t } of plan) {
      const actor = canvas.tokens.get(t.id)?.actor;
      if (!actor) continue;
      const validEffectIds = actor.effects.filter(e => !e.id.endsWith('0000000000')).map(e => e.id);
      if (!validEffectIds.length) continue;
      _tm(`step 4: deleteEmbeddedDocuments ActiveEffect x${validEffectIds.length} -- ${actor.name}`);
      try { await actor.deleteEmbeddedDocuments('ActiveEffect', validEffectIds); }
      catch (e) { console.warn('DSCT | DT | Minor error clearing effects on revive:', e); }
    }
    _tm('step 4: effects done');
  }
  _tm('step 4 complete; deleteDeathMessages');
  if (tokens.length === 1) {
    ui.notifications.info(game.i18n.format('DSCT.notice.dt.revived', { name: tokens[0].actor.name }));
  } else if (tokens.length > 1) {
    ui.notifications.info(`Revived ${formatNames(tokens.map(t => t.actor.name))}.`);
  }
  await deleteDeathMessagesFor(tokens.map(t => t.id));

  window._dsctReviveActive = false;
  _schedulePostReviveLabels();

  if (_dbgTime) {
    _stopFrameMonitor = true;
    setTimeout(() => {
      console.log(`DSCT | DT | [REVIVE +${(performance.now()-_t0).toFixed(0)}ms] _doReviveV3 COMPLETE`);
      console.log(`DSCT | DT | [REVIVE] Dropped frames (>33ms): ${_droppedFrames}, worst: ${_worstFrameMs.toFixed(1)}ms`);
      if (_droppedFrameLog.length) console.log('DSCT | DT | [REVIVE] Frame drops:', _droppedFrameLog.join(' | '));
    }, 500);
  }
};

const _doReviveManual = async ({ tokenIds, label = 'DT Debug' }) => {
  if (!window._dsctManualReviveTokenIds) window._dsctManualReviveTokenIds = new Set();
  const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const tokens = [...tokenIds]
    .map(id => canvas.tokens.get(id))
    .filter(t => t?.actor?.statuses?.has(defeatedStatusId) && !window._dsctManualReviveTokenIds.has(t.id));
  if (!tokens.length) return;
  for (const t of tokens) window._dsctManualReviveTokenIds.add(t.id);

  try {

  
  const deathSnap = new Map(tokens.map(t => [t.id, {
    tint:  t.document.texture.tint ?? '#ffffff',
    alpha: t.document.alpha       ?? 1,
  }]));

  const sections = [];
  const mkSection = (step, title, lines, hint, { done = false } = {}) =>
    `<div class="dsct-step-section${done ? ' dsct-step-done' : ''}">
      <p><strong>${label} &mdash; Step ${step}/4: ${title}</strong>${done ? ' &#x2713;' : ''}</p>
      <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      ${!done && hint ? `<p><em>${hint}</em></p>` : ''}
    </div>`;
  const mkBtns = (step, undoable = false) =>
    `<div class="message-part-buttons">
      <button type="button" data-dsct-manual="confirm" data-dsct-step="${step}">&#x2713; Confirm</button>
      <button type="button" data-dsct-manual="${undoable ? 'undo' : 'abort'}" data-dsct-step="${step}">${undoable ? '&#x21a9; Undo' : '&#x2715; Abort'}</button>
    </div>`;
  const buildContent = (currentBlock, footer = '') =>
    `<div class="dsct-manual-step">${sections.join('')}${currentBlock}${footer}</div>`;

  let msg           = null;
  let currentStep   = 1;
  let step2Applied  = false;
  let step3Applied  = false;
  let step2Data     = null; 
  let step3Data     = null; 
  let s2Lines       = null; 
  let s2Section     = null;

  while (true) {

    
    if (currentStep === 1) {
      await Promise.all(tokens.map(t =>
        canvas.tokens.get(t.id) ? t.document.update({ 'texture.tint': '#44dd44' }) : Promise.resolve()
      ));
      const s1 = mkSection(1, 'Confirm Revival', tokens.map(t => t.actor.name),
        'Tokens tinted green. Confirm to remove dead status.');
      if (!msg) {
        msg = await ChatMessage.create({
          content: buildContent(s1, mkBtns(1)),
          flags: { [M]: { manualStep: true } },
        });
      } else {
        await msg.update({ content: buildContent(s1, mkBtns(1)) });
      }

      const d = await _manualDecision(msg, 1);
      if (d !== 'confirm') {
        
        await Promise.all(tokens.map(t => {
          const snap = deathSnap.get(t.id);
          return canvas.tokens.get(t.id)
            ? t.document.update({ 'texture.tint': snap?.tint ?? '#ffffff', alpha: snap?.alpha ?? 1 })
: Promise.resolve();
        }));
        await msg.update({ content: buildContent(s1 + '<p><em>&#x2715; Aborted.</em></p>') });
        return;
      }
      sections.push(mkSection(1, 'Confirm Revival', tokens.map(t => t.actor.name), null, { done: true }));
      currentStep = 2;
    }

    
    else if (currentStep === 2) {
      if (!step2Applied) {
        step2Data = [];
        for (const t of tokens) {
          if (!canvas.tokens.get(t.id)) continue;
          const prevStamina = t.actor.system.stamina?.value ?? 0;
          await safeToggleStatusEffect(t.actor, defeatedStatusId, { overlay: true, active: false });
          if ((t.actor.system.stamina?.value ?? 0) <= 0) {
            const _staminaRestoreVal = t.actor.system?.isMinion ? (t.actor.system.stamina?.max ?? 1) : 1;

            if (t.document.actorLink) await safeUpdate(t.actor, { 'system.stamina.value': _staminaRestoreVal });
            else await canvas.scene.updateEmbeddedDocuments('Token', [{ _id: t.id, 'delta.system.stamina.value': _staminaRestoreVal }]);
          }
          step2Data.push({ t, prevStamina });
        }
        await new Promise(r => setTimeout(r, 300));
        step2Applied = true;
      }
      const step2Checks = tokens.map(t => ({
        t,
        ok: !(t.actor.statuses?.has(defeatedStatusId) ||
              t.actor.appliedEffects?.some(e => e.statuses?.has(defeatedStatusId))),
      }));
      await Promise.all(tokens.map(t =>
        canvas.tokens.get(t.id) ? t.document.update({ 'texture.tint': '#aa44ff' }) : Promise.resolve()
      ));
      s2Lines   = step2Checks.map(({ t, ok }) =>
        `${ok ? '&#x2713;' : '&#x2717;'} ${t.actor.name} &mdash; ${ok ? 'dead status removed' : '<strong>status NOT removed!</strong>'}`);
      s2Section = mkSection(2, 'Dead Status Removed', s2Lines,
        'Tokens tinted purple. Confirm to restore combat position.');
      await msg.update({ content: buildContent(s2Section, mkBtns(2, true)) });

      const d = await _manualDecision(msg, 2);
      if (d === 'confirm') {
        sections.push(mkSection(2, 'Dead Status Removed', s2Lines, null, { done: true }));
        currentStep = 3;
      } else { 
        for (const { t, prevStamina } of step2Data) {
          if (!canvas.tokens.get(t.id)) continue;
          await safeToggleStatusEffect(t.actor, defeatedStatusId, { overlay: true, active: true });
          await safeUpdate(t.actor, { 'system.stamina.value': prevStamina });
        }
        step2Applied = false; step2Data = null; s2Lines = null; s2Section = null;
        sections.pop(); 
        currentStep = 1;
      }
    }

    
    else if (currentStep === 3) {
      if (!step3Applied) {
        step3Data = [];
        for (const t of tokens) {
          if (!canvas.tokens.get(t.id)) continue;
          const savedGroupId    = t.document.getFlag(M, 'savedGroupId');
          const savedCaptainOf  = t.document.getFlag(M, 'savedCaptainOf');
          const savedDisplayBars = t.document.getFlag(M, 'savedDisplayBars');
          const isMinion        = t.actor.system?.isMinion ?? false;
          const minionMaxHP     = isMinion ? (t.actor.system.stamina?.max ?? 0) : 0;

          const flagClear = { flags: { [M]: {
            savedGroupId:    _dropFlag(),
            savedCaptainOf:  _dropFlag(),
            savedDisplayBars: _dropFlag(),
          } } };
          if (savedDisplayBars !== undefined) flagClear.displayBars = savedDisplayBars;
          await t.document.update(flagClear);

          let newCombatantId = null;
          if (game.combat && !game.combat.combatants.find(c => c.tokenId === t.id)) {
            const combatantData = { tokenId: t.id, sceneId: canvas.scene.id, actorId: t.document.actorId };
            if (savedGroupId) combatantData.group = savedGroupId;
            const [newCombatant] = await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
            newCombatantId = newCombatant?.id ?? null;
            if (savedGroupId && isMinion && minionMaxHP > 0) {
              const group = game.combat.groups.get(savedGroupId);
              if (group) await group.update({ 'system.staminaValue': (group.system.staminaValue ?? 0) + minionMaxHP });
            }
          }

          if (newCombatantId && savedCaptainOf && !hasLiveCaptain(savedCaptainOf)) {
            const led = game.combat?.groups?.get(savedCaptainOf);
            if (led) await led.update({ 'system.captainId': newCombatantId });
          }
          step3Data.push({ t, newCombatantId, savedGroupId, savedCaptainOf, savedDisplayBars, isMinion, minionMaxHP });
        }
        await new Promise(r => setTimeout(r, 200));
        step3Applied = true;
      }
      const s3Checks = tokens.map(t => ({
        t, ok: !!(game.combat?.combatants.find(c => c.tokenId === t.id)),
      }));
      await Promise.all(tokens.map(t =>
        canvas.tokens.get(t.id) ? t.document.update({ 'texture.tint': '#ffaa00' }) : Promise.resolve()
      ));
      const s3Lines = s3Checks.map(({ t, ok }) =>
        `${ok ? '&#x2713;' : '&#x2717;'} ${t.actor.name} &mdash; ${ok ? 'added to combat' : 'not in combat (no active encounter?)'}`);
      const s3Section = mkSection(3, 'Restored to Combat', s3Lines,
        'Orange tint. Confirm to restore visual and clear effects.');
      await msg.update({ content: buildContent(s3Section, mkBtns(3, true)) });

      const d = await _manualDecision(msg, 3);
      if (d === 'confirm') {
        sections.push(mkSection(3, 'Restored to Combat', s3Lines, null, { done: true }));
        currentStep = 4;
      } else { 
        for (const { t, newCombatantId, savedGroupId, savedCaptainOf, savedDisplayBars, isMinion, minionMaxHP } of step3Data) {
          if (!canvas.tokens.get(t.id)) continue;
          if (newCombatantId) {
            const led = savedCaptainOf ? game.combat?.groups?.get(savedCaptainOf) : null;
            if (led && led.system?.captainId === newCombatantId) await led.update({ 'system.captainId': null });
            const comb = game.combat?.combatants.get(newCombatantId);
            if (comb) await safeDelete(comb);
          }
          if (savedGroupId && isMinion && minionMaxHP > 0) {
            const group = game.combat?.groups.get(savedGroupId);
            if (group) await group.update({ 'system.staminaValue': Math.max(0, (group.system.staminaValue ?? 0) - minionMaxHP) });
          }
          const flagRestore = {};
          if (savedGroupId) flagRestore.savedGroupId = savedGroupId;
          if (savedCaptainOf) flagRestore.savedCaptainOf = savedCaptainOf;
          if (savedDisplayBars !== undefined) flagRestore.savedDisplayBars = savedDisplayBars;
          if (Object.keys(flagRestore).length) await t.document.update({ flags: { [M]: flagRestore } });
        }
        step3Applied = false; step3Data = null;
        sections.pop(); 
        
        currentStep = 2;
      }
    }

    
    else if (currentStep === 4) {
      const s4Lines = [];
      for (const t of tokens) {
        if (!canvas.tokens.get(t.id)) continue;
        const markerTileId = t.document.getFlag(M, 'deathMarkerTileId');
        if (markerTileId) {
          const tile = canvas.scene.tiles.get(markerTileId);
          if (tile) await tile.delete().catch(() => {});
          await t.document.unsetFlag(M, 'deathMarkerTileId');
        }
        if (getSetting('clearEffectsOnRevive')) {
          const validEffectIds = t.actor.effects
            .filter(e => !e.id.endsWith('0000000000'))
            .map(e => e.id);
          if (validEffectIds.length) {
            try { await t.actor.deleteEmbeddedDocuments('ActiveEffect', validEffectIds); }
            catch (e) { console.warn('DSCT | DT | Minor error clearing effects on revive:', e); }
          }
        }
        await animateDeathVisual(t);
        s4Lines.push(`&#x2713; ${t.actor.name} &mdash; revival complete`);
      }
await _resolveReviveSpaceConflicts(tokens);
      if (s4Lines.length === 1) {
        ui.notifications.info(game.i18n.format('DSCT.notice.dt.revived', { name: tokens[0].actor.name }));
      } else if (s4Lines.length > 1) {
        ui.notifications.info(`Revived ${formatNames(tokens.map(t => t.actor.name))}.`);
      }
      sections.push(mkSection(4, 'Revival Complete', s4Lines, null, { done: true }));
      await msg.update({ content: buildContent('') });
      await deleteDeathMessagesFor(tokens.map(t => t.id));
      break;
    }
  }

  } finally {
    for (const t of tokens) window._dsctManualReviveTokenIds.delete(t.id);
  }
};

export const _SQUAD_COLORS = [0xFF4444, 0x4488FF, 0xAA44FF, 0xFFCC00, 0x00FFCC, 0xFF88AA];

export const _runManualModePicker = (contexts) => new Promise((resolve) => {
  
  
  const _defeated = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const _stillStanding = (id) => {
    const actor = canvas.tokens.get(id)?.actor;
    return !!actor && !actor.statuses?.has(_defeated);
  };
  const _worthAsking = contexts.some((ctx) => {
    const standing = [...ctx.poolTokenIds].filter(_stillStanding);
    return standing.length > 0 && Math.min(ctx.numToKill, standing.length) > 0;
  });
  if (!_worthAsking) {
    if (getSetting('debugMode')) console.log('DSCT | DT | picker had nothing left to ask, not opening');
    resolve(null);
    return;
  }

  
  const squads = contexts.map(ctx => ({
    ...ctx,
    pool:     [...ctx.poolTokenIds].map(id => canvas.tokens.get(id)).filter(Boolean),
    selected: new Set([...ctx.lockedIds, ...ctx.preSelectedIds].filter(id => ctx.poolTokenIds.has(id))),
    locked:   new Set([...ctx.lockedIds].filter(id => ctx.poolTokenIds.has(id))),
  }));

  
  const tokenToSquad = new Map();
  for (const squad of squads) for (const t of squad.pool) tokenToSquad.set(t.id, squad);

  const hlName = 'dsct-manual-pick-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  
  for (const orphan of window._dsctPickLayers ?? []) {
    orphan.parent?.removeChild(orphan);
    orphan.destroy({ children: true });
  }

  const xContainer = new PIXI.Container();
  canvas.controls.addChild(xContainer);

  const dimXContainer = new PIXI.Container();
  dimXContainer.alpha = 0.1;
  canvas.controls.addChild(dimXContainer);

  window._dsctPickLayers = [xContainer, dimXContainer];

  
  beginPickerLock();

  let _dpT = 0;
  const _dpTicker = () => {
    _dpT += canvas.app.ticker.elapsedMS;
    const dur = 2000, pause = dur * 0.6;
    const cycle = _dpT % dur;
    xContainer.alpha = cycle < pause
      ? 0.75
      : 0.75 + 0.15 * Math.sin(((cycle - pause) / (dur - pause)) * Math.PI);
  };
  canvas.app.ticker.add(_dpTicker);

  const drawXMarks = () => {
    for (const child of xContainer.removeChildren()) child.destroy({ texture: true, baseTexture: true });
    for (const squad of squads) {
      for (const t of squad.pool) {
        const isLocked   = squad.locked.has(t.id);
        const isSelected = squad.selected.has(t.id);
        if (!isSelected && !isLocked) continue; 
        const xColor      = isLocked ? 0x111111 : squad.color;
        const outlineColor = isLocked ? 0xFFFFFF : 0x000000; 
        const tw  = Math.ceil(t.document.width  * canvas.grid.size);
        const th  = Math.ceil(t.document.height * canvas.grid.size);
        const pad = Math.max(6, tw * 0.08);
        const lw  = Math.max(16, tw * 0.22);
        const olw = Math.round(lw * 1.5);
        const gfx = new PIXI.Graphics();
        
        gfx.lineStyle(olw, outlineColor, 1);
        gfx.moveTo(pad, pad); gfx.lineTo(tw - pad, th - pad);
        gfx.moveTo(tw - pad, pad); gfx.lineTo(pad, th - pad);
        gfx.lineStyle(lw, xColor, 1);
        gfx.moveTo(pad, pad); gfx.lineTo(tw - pad, th - pad);
        gfx.moveTo(tw - pad, pad); gfx.lineTo(pad, th - pad);
        const rt = PIXI.RenderTexture.create({ width: tw, height: th });
        canvas.app.renderer.render(gfx, { renderTexture: rt, clear: true });
        gfx.destroy();
        const sprite = new PIXI.Sprite(rt);
        sprite.x = t.x; sprite.y = t.y; sprite.alpha = isLocked ? 0.9 : 0.8;
        xContainer.addChild(sprite);
      }
    }
  };

  const drawDimXMarks = () => {
    for (const child of dimXContainer.removeChildren()) child.destroy({ texture: true, baseTexture: true });
    if (!getSetting('deathPickerDimAll')) return;
    for (const squad of squads) {
      for (const t of squad.pool) {
        if (squad.selected.has(t.id) || squad.locked.has(t.id)) continue;
        const tw  = Math.ceil(t.document.width  * canvas.grid.size);
        const th  = Math.ceil(t.document.height * canvas.grid.size);
        const pad = Math.max(6, tw * 0.08);
        const lw  = Math.max(16, tw * 0.22);
        const olw = Math.round(lw * 1.5);
        const gfx = new PIXI.Graphics();
        gfx.lineStyle(olw, 0x000000, 1);
        gfx.moveTo(pad, pad); gfx.lineTo(tw - pad, th - pad);
        gfx.moveTo(tw - pad, pad); gfx.lineTo(pad, th - pad);
        gfx.lineStyle(lw, squad.color, 1);
        gfx.moveTo(pad, pad); gfx.lineTo(tw - pad, th - pad);
        gfx.moveTo(tw - pad, pad); gfx.lineTo(pad, th - pad);
        const rt = PIXI.RenderTexture.create({ width: tw, height: th });
        canvas.app.renderer.render(gfx, { renderTexture: rt, clear: true });
        gfx.destroy();
        const sprite = new PIXI.Sprite(rt);
        sprite.x = t.x; sprite.y = t.y;
        dimXContainer.addChild(sprite);
      }
    }
  };

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const squad of squads) {
      for (const t of squad.pool) {
        const w = Math.max(1, Math.round(t.document.width));
        const h = Math.max(1, Math.round(t.document.height));
        let color, border;
        if (squad.locked.has(t.id))        { color = 0x00FF44; border = 0x00AA22; } 
        else if (!squad.selected.has(t.id)) { color = 0xFF8800; border = 0xAA4400; } 
        else continue;                                                                  
        for (let dx = 0; dx < w; dx++) {
          for (let dy = 0; dy < h; dy++) {
            canvas.interface.grid.highlightPosition(hlName, {
              x: Math.floor(t.x / canvas.grid.size) * canvas.grid.size + dx * canvas.grid.size,
              y: Math.floor(t.y / canvas.grid.size) * canvas.grid.size + dy * canvas.grid.size,
              color, border,
            });
          }
        }
      }
    }
    drawXMarks();
    drawDimXMarks();
  };

  const overlay = beginPickerOverlay({
    title: game.i18n.localize('DSCT.picker.titleDeath'),
    tokens: squads.flatMap(s => s.pool),
    uiToggle: true,
    onConfirm: () => tryConfirm(),
    onCancel: () => { finish(); resolve(null); },
  });
  const refreshNotif = () => {
    const summary = squads.map(s => `${s.groupName}: ${s.selected.size}/${s.numToKill}`).join(', ');
    overlay.setStatus(game.i18n.format('DSCT.notice.dt.pickDeathsInstruction', { summary }));
    overlay.setReady(squads.every(s => s.selected.size === s.numToKill));
  };
  refreshNotif();

  const tryConfirm = () => {
    const wrong = squads.filter(s => s.selected.size !== s.numToKill);
    if (wrong.length) {
      overlay.flashWarning(game.i18n.format('DSCT.notice.dt.pickerWrongCount', { summary: wrong.map(s => `${s.groupName}: ${s.selected.size}/${s.numToKill}`).join(', ') }));
      return;
    }
    finish();
    const result = new Set();
    for (const squad of squads) for (const id of squad.selected) result.add(id);
    resolve(result);
  };

  let _staleCheckTimer = null;
  let _released = false;
  const finish = () => {
    clearTimeout(_staleCheckTimer);
    if (!_released) { _released = true; endPickerLock(); }
    overlay.end();
    canvas.app.ticker.remove(_dpTicker);
    if (canvas.interface.grid.highlightLayers?.[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
    xContainer.parent?.removeChild(xContainer);
    xContainer.destroy({ children: true });
    dimXContainer.parent?.removeChild(dimXContainer);
    dimXContainer.destroy({ children: true });
    if (window._dsctPickLayers?.[0] === xContainer) window._dsctPickLayers = null;
    canvas.stage.off('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('contextmenu', onContextMenu);
  };

  let _lastEmptyClickTime = 0;
  const onClick = (event) => {
    if (event.data.originalEvent.button !== 0) return;
    const pos = event.data.getLocalPosition(canvas.app.stage);
    for (const squad of squads) {
      const t = squad.pool.find(t => {
        const w = t.document.width * canvas.grid.size;
        const h = t.document.height * canvas.grid.size;
        return pos.x >= t.x && pos.x <= t.x + w && pos.y >= t.y && pos.y <= t.y + h;
      });
      if (!t) continue;
      _lastEmptyClickTime = 0;
      if (squad.locked.has(t.id)) {
        overlay.flashWarning(game.i18n.format('DSCT.notice.dt.pickerMustDie', { name: t.actor?.name ?? 'That token' }));
        return;
      }
      if (squad.selected.has(t.id)) {
        squad.selected.delete(t.id);
      } else {
        if (squad.selected.size >= squad.numToKill) {
          overlay.flashWarning(game.i18n.format('DSCT.notice.dt.pickerAtLimit', { group: squad.groupName, count: squad.numToKill }));
          return;
        }
        squad.selected.add(t.id);
      }
      drawHighlights();
      refreshNotif();
      return;
    }

    const now = Date.now();
    if (now - _lastEmptyClickTime < 400) {
      _lastEmptyClickTime = 0;
      tryConfirm();
      return;
    }
    _lastEmptyClickTime = now;
  };

  const onKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      tryConfirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      resolve(null);
    }
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    if (getSetting('cancelOnRightClick')) { finish(); resolve(null); }
  };

  canvas.stage.on('mousedown', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('contextmenu', onContextMenu);
  drawHighlights();

  
  
  
  const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  _staleCheckTimer = setTimeout(() => {
    const anyDead = [...tokenToSquad.keys()].some(id => canvas.tokens.get(id)?.actor?.statuses?.has(defeatedStatus));
    if (!anyDead) return;
    finish();
    ui.notifications.error(game.i18n.localize('DSCT.notice.dt.pickerTokensAlreadyDead'));
    resolve(null);
  }, 3000);
});

const DSTD_MODULE = 'draw-steel-target-damage';

const DSTD_ROW_GRACE_MS = 2000;

export const dstdRowSignature = (message) => {
  const state = message?.flags?.[DSTD_MODULE]?.state;
  if (!state) return null;
  let applied = 0;
  let undone = 0;
  for (const [id, a] of Object.entries(state.applications ?? {})) {
    if (!a || !(a.kind === 'damage' || a.kind === 'healing' || /^(damage|healing)-/.test(id))) continue;
    if (a.status === 'applied') applied++;
    else if (a.status === 'undone') undone++;
  }
  return `${applied}/${undone}`;
};

const dstdStillApplying = () => {
  if (window._dsctDamageBatchDepth > 0) return 'damage still going out';
  const pending = window._dsctDstdRowPending;
  if (pending) {
    const stale = Date.now() - pending.at >= DSTD_ROW_GRACE_MS;
    const landed = dstdRowSignature(game.messages.get(pending.messageId)) !== pending.signature;
    if (stale || landed) window._dsctDstdRowPending = null;
    else return 'a row that has just been pressed';
  }

  for (const msg of game.messages.contents.slice(-25)) {
    const state = msg?.flags?.[DSTD_MODULE]?.state;
    const targets = state?.targets?.length ?? 0;
    if (!targets) continue;

    
    const rows = Object.entries(state.applications ?? {})
      .filter(([id, a]) => a && (a.kind === 'damage' || a.kind === 'healing' || /^(damage|healing)-/.test(id)))
      .map(([, a]) => a.status);
    if (!rows.length) continue;

    const applied = rows.filter(st => st === 'applied').length;
    const undone = rows.filter(st => st === 'undone').length;
    const midPass = (applied > 0 && undone > 0) || rows.length < targets;
    if (midPass) return `"${msg.flavor || 'a damage card'}" still applying (${applied}/${targets})`;
  }
  return null;
};

const livingTokensOf = (group) => Array.from(group?.members ?? [])
  .filter(m => m?.actor?.system?.isMinion && !m.actor.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead'))
  .map(m => m.token?.object)
  .filter(Boolean);

const squadOwesDeaths = (group) => {
  const living = livingTokensOf(group);
  if (!living.length) return 0;
  const indivHP = living[0].actor?.system?.stamina?.max || 1;
  const pool = Math.max(0, group?.system?.staminaValue ?? 0);
  return Math.max(0, living.length - Math.ceil(pool / indivHP));
};

const syncDeathPulse = (group) => {
  if (!group) return;
  
  
  const declinedAt = window._dsctDeclinedDeaths?.get(group.id);
  const declined = declinedAt !== undefined && declinedAt === (group.system?.staminaValue ?? null);
  if (!declined && squadOwesDeaths(group) > 0) markDeathPending(livingTokensOf(group));
  else clearDeathPending(livingTokensOf(group));
};

let _forceSettleNow = null;

export const resolveDeathsNow = () => _forceSettleNow?.() ?? false;

const _MANUAL_KILL_ACCUM_MS = 100;

const _liveContext = (ctx) => {
  const defeatedId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const standing = (id) => {
    const actor = canvas.tokens.get(id)?.actor;
    return !!actor && !actor.statuses?.has(defeatedId);
  };
  const poolTokenIds = new Set([...ctx.poolTokenIds].filter(standing));
  if (!poolTokenIds.size) return null;

  const group = ctx.groupId ? game.combat?.groups?.get(ctx.groupId) : null;
  let numToKill = ctx.numToKill;
  if (group) {
    const living = Array.from(group.members ?? [])
      .filter(m => m?.actor?.system?.isMinion && !m.actor.statuses?.has(defeatedId));
    const indivHP = living[0]?.actor?.system?.stamina?.max || 1;
    const pool = Math.max(0, group.system?.staminaValue ?? 0);
    numToKill = Math.max(0, living.length - Math.ceil(pool / indivHP));
  }
  numToKill = Math.min(numToKill, poolTokenIds.size);
  if (numToKill <= 0) return null;

  const lockedIds = new Set([...ctx.lockedIds].filter(id => poolTokenIds.has(id)));
  const preSelectedIds = new Set([...ctx.preSelectedIds].filter(id => poolTokenIds.has(id)));
  return { ...ctx, poolTokenIds, lockedIds, preSelectedIds, numToKill };
};

const FORCED_COLOR = 0xBBBBBB;

const _forcedContexts = (tokenIds, alreadyShown) => {
  const defeated = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const out = [];
  for (const id of tokenIds) {
    if (alreadyShown.has(id)) continue;
    
    const actor = canvas.tokens.get(id)?.actor;
    if (!actor || actor.statuses?.has(defeated)) continue;
    out.push({
      groupId: null,
      poolTokenIds: new Set([id]),
      lockedIds: new Set([id]),
      preSelectedIds: new Set(),
      numToKill: 1,
      forced: true,
    });
  }
  return out;
};

const _withForced = (liveContexts, tokenIds) => {
  const shown = new Set(liveContexts.flatMap(c => [...c.poolTokenIds]));
  const forced = _forcedContexts(tokenIds, shown);
  let n = 0;
  return [...liveContexts, ...forced].map(ctx => ({
    ...ctx,
    color: ctx.forced ? FORCED_COLOR : _SQUAD_COLORS[n++ % _SQUAD_COLORS.length],
  }));
};

const _announceForcedDeaths = (ids) => {
  const names = [...ids].map(id => canvas?.tokens?.get(id)?.name).filter(Boolean);
  if (!names.length) return;
  ui.notifications.info(game.i18n.format('DSCT.notice.dt.forcedDeathsAnyway', { names: names.join(', ') }));
};

const _settleKillFlush = async (a) => {
  const finalTokenIds = new Set(a.tokenIds);
  if (getSetting('deathTrackerManualMode')) {
    
    const liveContexts = a.pickerContexts.map(_liveContext).filter(Boolean);
    if (liveContexts.length > 0) {
      const contexts = _withForced(liveContexts, finalTokenIds);
      
      const pickerUserId  = resolvePickerUserId();
      let picked;
      if (pickerUserId === game.user.id) {
        picked = await _runManualModePicker(contexts);
      } else {
        const socket = getModuleApi(false)?.socket;
        if (!socket) {

          picked = await _runManualModePicker(contexts);
        } else {
          const requestId = foundry.utils.randomID();
          if (!window._dsctPickerRequests) window._dsctPickerRequests = new Map();
          
          const serialized = contexts.map(ctx => ({
            ...ctx,
            lockedIds:      [...ctx.lockedIds],
            preSelectedIds: [...ctx.preSelectedIds],
            poolTokenIds:   [...ctx.poolTokenIds],
          }));
          picked = await new Promise((resolve) => {
            window._dsctPickerRequests.set(requestId, resolve);
            socket.executeAsUser('dsct.openManualModePicker', pickerUserId, serialized, requestId);
            
            setTimeout(() => {
              if (window._dsctPickerRequests?.has(requestId)) {
                window._dsctPickerRequests.delete(requestId);
                resolve(null);
              }
            }, 5 * 60 * 1000);
          });
        }
      }
      if (!picked) {
        ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.pickDeathsCancelled'));
        _announceForcedDeaths(finalTokenIds);
      } else {
        for (const id of picked) finalTokenIds.add(id);
      }
    }
    if (!finalTokenIds.size) return;
    const _ver = game.modules.get(M)?.version ?? '?';
    await _withCause(a.cause, () => _doKillManual({
      tokenIds: finalTokenIds, squadGroup: null, processQueue: () => {},
      step1Extra: a.extraLines.join(''), label: `DT Debug v${_ver}`, skipHpCorrection: true,
    }));
  } else {
    
    
    
    
    const liveContexts = a.pickerContexts.map(_liveContext).filter(Boolean);
    if (getSetting('pickDeathsEnabled') && liveContexts.length > 0) {
      const contexts     = _withForced(liveContexts, finalTokenIds);
      const pickerUserId = resolvePickerUserId();
      let picked;
      if (pickerUserId === game.user.id) {
        picked = await _runManualModePicker(contexts);
      } else {
        const socket = getModuleApi(false)?.socket;
        if (!socket) {
          picked = await _runManualModePicker(contexts);
        } else {
          const requestId = foundry.utils.randomID();
          if (!window._dsctPickerRequests) window._dsctPickerRequests = new Map();
          const serialized = contexts.map(ctx => ({
            ...ctx,
            lockedIds:      [...ctx.lockedIds],
            preSelectedIds: [...ctx.preSelectedIds],
            poolTokenIds:   [...ctx.poolTokenIds],
          }));
          picked = await new Promise((resolve) => {
            window._dsctPickerRequests.set(requestId, resolve);
            socket.executeAsUser('dsct.openManualModePicker', pickerUserId, serialized, requestId);
            setTimeout(() => {
              if (window._dsctPickerRequests?.has(requestId)) {
                window._dsctPickerRequests.delete(requestId);
                resolve(null);
              }
            }, 5 * 60 * 1000);
          });
        }
      }
      if (!picked) {
        ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.pickDeathsCancelled'));
        if (!window._dsctDeclinedDeaths) window._dsctDeclinedDeaths = new Map();
        for (const id of [...window._dsctDeclinedDeaths.keys()]) {
          if (!game.combat?.groups?.get(id)) window._dsctDeclinedDeaths.delete(id);
        }
        for (const ctx of contexts) {
          const live = ctx.groupId ? game.combat?.groups?.get(ctx.groupId) : null;
          if (live) window._dsctDeclinedDeaths.set(ctx.groupId, live.system?.staminaValue ?? null);
        }

        _announceForcedDeaths(finalTokenIds);
      } else {
        for (const id of picked) finalTokenIds.add(id);
      }
    } else {
      for (const ctx of liveContexts) {
        for (const id of ctx.lockedIds)      finalTokenIds.add(id);
        for (const id of ctx.preSelectedIds) finalTokenIds.add(id);
      }
    }

    if (!finalTokenIds.size) return;
    await _withCause(a.cause, () => _doKillV3(finalTokenIds, { skipHpCorrection: true, showNotification: false }));
  }
};

const _runManualKillFlush = async () => {
  const a = window._dsctManualKillAccumulator;
  window._dsctManualKillAccumulator = null;
  if (!a) return;

  _keepCause(a);

  const asked = [...new Set(a.pickerContexts.map(c => c.groupId).filter(Boolean))];
  try {
    await _settleKillFlush(a);
  } finally {
    
    for (const id of asked) syncDeathPulse(game.combat?.groups?.get(id));
  }
};

const _FLUSH_MAX_HOLDS = 60;
let _flushHolds = 0;

const _flushManualKillAccumulator = async () => {
  const acc = window._dsctManualKillAccumulator;
  
  const asked = window._dsctSettleNow === true;
  
  const hasWork = !!(acc?.pickerContexts?.length || acc?.tokenIds?.size);
  const applying = (!asked && hasWork) ? dstdStillApplying() : null;

  
  const squadAboutToBeAsked = !asked && hasWork && !acc.pickerContexts.length && deathSettlementPending();

  const hold = window._dsctPendingSquadTimers?.size > 0 || window._dsctFlushBusy
    || ((applying || squadAboutToBeAsked) && ++_flushHolds <= _FLUSH_MAX_HOLDS);
  if (hold) {
    if (acc) { clearTimeout(acc.timer); acc.timer = setTimeout(_flushManualKillAccumulator, _MANUAL_KILL_ACCUM_MS); }
    return;
  }
  if (applying) console.warn(`DSCT | DT | kill flush stopped waiting on ${applying} and is asking now`);
  _flushHolds = 0;
  window._dsctSettleNow = false;
  window._dsctFlushBusy = true;
  try { await _runManualKillFlush(); }
  finally { window._dsctFlushBusy = false; }
};

const _newAccumulator = () => ({ tokenIds: new Set(), extraLines: [], pickerContexts: [], cause: {} });

const _keepCause = (acc) => {
  const live = _currentDamageCause();
  if (!Object.keys(live).length) return;
  const held = acc.cause ?? {};
  if (!Object.keys(held).length || held.causeId === live.causeId) acc.cause = live;
};

const _queueManualKillTargets = (tokenIds, extraLines) => {
  if (!window._dsctManualKillAccumulator) {
    window._dsctManualKillAccumulator = _newAccumulator();
  }
  const acc = window._dsctManualKillAccumulator;
  _keepCause(acc);
  for (const id of tokenIds) acc.tokenIds.add(id);
  acc.extraLines.push(...extraLines);
  if (acc.timer) clearTimeout(acc.timer);
  acc.timer = setTimeout(_flushManualKillAccumulator, _MANUAL_KILL_ACCUM_MS);
};

const _queueManualPickerContext = (ctx, extraLines) => {
  if (!window._dsctManualKillAccumulator) {
    window._dsctManualKillAccumulator = _newAccumulator();
  }
  const acc = window._dsctManualKillAccumulator;
  _keepCause(acc);

  
  if (ctx.groupId) {
    const at = acc.pickerContexts.findIndex(c => c.groupId === ctx.groupId);
    if (at >= 0) acc.pickerContexts.splice(at, 1);
  }
  acc.pickerContexts.push(ctx);
  acc.extraLines.push(...extraLines);
  if (acc.timer) clearTimeout(acc.timer);
  acc.timer = setTimeout(_flushManualKillAccumulator, _MANUAL_KILL_ACCUM_MS);
};

const oneMustDie = (eligibleDamaged, extraLines) => {
  _queueManualKillTargets(new Set(eligibleDamaged), extraLines);
};

export const _addDamagedToken = (tokenId, userId = null) => {
  if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
  window._lastSquadDamagedTokenIds.add(tokenId);
  if (userId) window._lastSquadDamageUserId = userId;
  clearTimeout(window._lastSquadDamagedTokenIdsTimer);
  window._lastSquadDamagedTokenIdsTimer = setTimeout(() => {
    window._lastSquadDamagedTokenIds = null;
    window._lastSquadDamageUserId    = null;
  }, window._dsctFMActive ? 10000 : 2000);
};

export const deathTrackerExcludedTypes = new Set();
const _isDTExcluded = (actor) => actor.type === 'hero' || actor.type === 'retainer' || deathTrackerExcludedTypes.has(actor.type);

function _suppressSystemMinionPrompt() {
  if (!getSetting('overrideMinionDefeat')) return;

  const apps = ds?.applications?.apps;
  if (!apps?.DefeatedMinionSelection) {
    console.warn('DSCT | DT | could not find the system\'s defeated minion prompt to suppress it, so the table may be asked twice who dies');
    return;
  }
  apps.DefeatedMinionSelection.create = async () => null;

  const _closeIfItGetsThrough = (app) => {
    if (!getSetting('overrideMinionDefeat')) return;
    if (!/DefeatedMinionSelection/.test(app?.constructor?.name ?? '')) return;
    console.warn('DSCT | DT | the system\'s defeated minion prompt opened despite being suppressed, closing it');
    app.close?.();
  };
  Hooks.on('renderApplicationV2', _closeIfItGetsThrough);
  Hooks.on('renderDefeatedMinionSelection', _closeIfItGetsThrough);
}

export function registerDeathTrackerHooks() {

  registerDeathCardRefresh();

  

  
  
  
  
  Hooks.on('preUpdateActor', (actor, changes) => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('overrideMinionDefeat')) return;
    if (!actor.system?.isMinion) return;
    const newStamina = changes.system?.stamina?.value;
    if (newStamina === undefined || newStamina >= (actor.system.stamina?.value ?? 0)) return;
    const squadGroup = getSquadGroup(actor);
    if (!squadGroup) return;
    const tokenId = actor.isToken
      ? actor.token?.id
      : canvas.tokens.placeables.find(t => t.actor?.id === actor.id)?.id;
    if (!tokenId) return;
    if (game.users.activeGM?.isSelf) {
      _addDamagedToken(tokenId);
    } else {
      getModuleApi(false)?.socket?.executeAsGM('dsct.reportDamagedToken', tokenId, game.user.id);
    }
  });

  Hooks.once('ready', () => {
    _suppressSystemMinionPrompt();
    cleanBaseNpcActors();
    if (getSetting('cleanOrphanedCombatants')) cleanOrphanedCombatants();

    
  });

  Hooks.on('preUpdateActor', (actor, changes, options, userId) => {
    const next = changes.system?.stamina?.value;
    if (next === undefined || next >= (actor.system?.stamina?.value ?? 0)) return;
    noteDamageCause({ dstd: options?.dstd?.source === 'draw-steel-target-damage', userId });
  });

  Hooks.on('combatRound', () => { cleanBaseNpcActors(); });

  Hooks.on('createActiveEffect', async (effect) => {
    if (!getSetting('deathTrackerEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;

    const statuses = [...(effect.statuses ?? [])];

    
    if (statuses.includes('dying') && !statuses.includes('dead')) {
      const actor = effect.parent;
      if (actor && !_isDTExcluded(actor) && !isDeathDeferred(actor)) {
        const token = actor.isToken ? actor.token.object : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
        if (token && !window._dsctManualKillTokenIds?.has(token.id)) {
          
          _queueManualKillTargets(
            new Set([token.id]),
            [`<p><em>${actor.name} reached 0 stamina (dying escalation).</em></p>`],
          );
        }
      }
      return;
    }

    if (!statuses.includes('dead')) return;

    const actor = effect.parent;
    if (!actor || _isDTExcluded(actor)) return;
    
    if (isDeathDeferred(actor)) {
      if (getSetting('debugMode')) console.log(`DSCT | DT | death deferred for ${actor.name}, not processing`);
      return;
    }

    const token = actor.isToken ? actor.token.object : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    if (!token) return;

    
    
    if (window._dsctKillLockActive) {
      if (getSetting('debugMode')) console.log(`DSCT | DT | createActiveEffect: kill lock active, skipping (${actor.name} ${token.id})`);
      if (!window._dsctKillLockSkipped) window._dsctKillLockSkipped = new Set();
      window._dsctKillLockSkipped.add(token.id);
      return;
    }

    
    if (window._dsctManualKillTokenIds?.has(token.id)) return;

    if (getSetting('debugMode')) console.log(`DSCT | DT | createActiveEffect: queuing dead-status trigger for ${actor.name} (${token.id})`);
    _queueManualKillTargets(
      new Set([token.id]),
      [],
    );
  });

  
  Hooks.on('preUpdateCombatantGroup', (group, changed) => {
    if (group.type !== 'squad') return;
    const newVal = changed?.system?.staminaValue;
    if (newVal === undefined) return;

    const alive = Array.from(group.members ?? []).filter(m => m?.actor?.system?.isMinion && !m.defeated);
    const indivHP = alive.length > 0 ? (alive[0].actor?.system?.stamina?.max ?? 1) : 1;
    const maxHP = alive.length * indivHP;
    const clamped = Math.min(Math.max(newVal, 0), maxHP);
    if (clamped === newVal) return;

    if (getSetting('debugMode')) console.log(`DSCT | DT | clamp guard | ${newVal} corrected to ${clamped} (alive=${alive.length} x ${indivHP})`);
    changed.system.staminaValue = clamped;
  });

  const _onSquadPoolChanged = async (group, changes, options) => {

    if (isOurTransition(options)) {
      if (getSetting('debugMode')) console.log(`DSCT | DT | updateCombatantGroup: ${options[TRANSITION].id}, this module's own write, standing down`);
      return;
    }
    const dbg = getSetting('debugMode');
    if (dbg) console.log('DSCT | DT | updateCombatantGroup fired', { groupType: group.type, isGM: game.users.activeGM?.isSelf, enabled: getSetting('deathTrackerEnabled'), override: getSetting('overrideMinionDefeat'), changes });
    if (!getSetting('deathTrackerEnabled') || !getSetting('overrideMinionDefeat') || !game.users.activeGM?.isSelf) return;

    
    
    
    const dstdOpts = options?.dstd;
    if (dstdOpts?.source === 'draw-steel-target-damage') {
      noteDamageCause({ dstd: true, messageId: _latestDstdCardId() });
      const ids = dstdOpts.minionDeathTargetIds?.length ? dstdOpts.minionDeathTargetIds
        : dstdOpts.primaryTargetId ? [dstdOpts.primaryTargetId] : [];
      for (const id of ids) if (id) _addDamagedToken(id);
      if (dbg) console.log(`DSCT | DT | DSTD damage detected, seeded damaged tokens: [${ids.join(',')}]`);
    }

    if (window._dsctKillLockActive) {
      deferSquadReconcile(group, 'the kill lock');
      return;
    }

    const applying = _impatient.has(group.id) ? null : dstdStillApplying();
    if (applying) {
      deferSquadReconcile(group, applying);
      return;
    }

    const newHp = changes.system?.staminaValue ?? changes.system?.stamina?.value;
    if (dbg) console.log('DSCT | DT | newHp', newHp, 'group.type', group.type);
    if (newHp === undefined) return;
    if (group.type !== 'squad') return;

    
    
    const declinedAt = window._dsctDeclinedDeaths?.get(group.id);
    if (declinedAt !== undefined) {
      const pool = group.system?.staminaValue ?? null;
      if (declinedAt === pool) {
        if (dbg) console.log(`DSCT | DT | "${group.name}" was left standing at ${pool}, not asking again`);
        clearDeathPending(livingTokensOf(group));
        return;
      }
      window._dsctDeclinedDeaths.delete(group.id);
    }

    if (!window._squadDeathLocks) window._squadDeathLocks = new Set();
    if (window._squadDeathLocks.has(group.id)) { deferSquadReconcile(group, 'its own squad lock'); return; }
    window._squadDeathLocks.add(group.id);

    clearSquadReconcileWaits(group);

    const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    const minions = Array.from(group.members ?? []).filter(m => m?.actor?.system?.isMinion);
    if (dbg) console.log('DSCT | DT | minions:', minions.map(m => ({ name: m?.actor?.name, isMinion: m?.actor?.system?.isMinion })));

    if (minions.length === 0) { window._squadDeathLocks.delete(group.id); return; }

    const indivHP = minions[0].actor?.system?.stamina?.max || 1;
    const numToKill = newHp <= 0 ? minions.length : (minions.length - Math.ceil(newHp / indivHP));

    if (numToKill <= 0) { window._squadDeathLocks.delete(group.id); return; }

    const processDeath = async () => {
      window._squadBreakpointPolls?.delete(group.id);
      
      
      await new Promise(r => setTimeout(r, 200));
      const damagedTokenIds = window._lastSquadDamagedTokenIds ? [...window._lastSquadDamagedTokenIds] : [];
      
      const liveMinions = minions.filter(m => m?.actor && !m.actor.statuses?.has(defeatedStatusId));
      if (liveMinions.length === 0) return;

      
      
      const activeKillIds = window._dsctManualKillTokenIds ?? new Set();
      if (liveMinions.some(m => m.tokenId && activeKillIds.has(m.tokenId))) return;

      
      
      const freshHp    = group.system?.staminaValue ?? newHp;
      const effectiveNumToKill = freshHp <= 0
        ? liveMinions.length
        : Math.max(0, liveMinions.length - Math.ceil(freshHp / indivHP));
      if (effectiveNumToKill <= 0) return;

      
      const pickable = liveMinions.filter(m => !isDeathDeferred(m.actor));
      const deferredCount = liveMinions.length - pickable.length;
      if (dbg) console.log(`DSCT | DT | DEFER | processDeath reached: live=${liveMinions.length} pickable=${pickable.length} deferred=${deferredCount} effectiveNumToKill=${effectiveNumToKill}`);
      if (pickable.length === 0) {
        if (dbg) console.log('DSCT | DT | DEFER | every living minion has its death deferred, nothing to do');
        return;
      }
      
      const killCount = Math.min(effectiveNumToKill, pickable.length);

      scheduleSquadReconcile(group, { delay: 1500 });

      if (dbg) console.log(`DSCT | DT | processDeath: origNumToKill=${numToKill} effectiveNumToKill=${effectiveNumToKill} killCount=${killCount} deferred=${deferredCount} freshHp=${freshHp} damagedTokenIds=[${damagedTokenIds.join(',')}]`);

      if (!getSetting('autoAssignDamagedMinion')) {
        
        if (freshHp <= 0) _queueManualKillTargets(new Set(pickable.map(m => m.tokenId).filter(Boolean)), []);
        return;
      }

      const eligibleDamaged = damagedTokenIds.filter(id => pickable.find(m => m.tokenId === id));
      const damagedNames = damagedTokenIds.map(id => canvas.tokens.get(id)?.actor?.name ?? id);
      const groupName = group.name ?? 'Squad';
      const extraLines = [
        `<p><em><strong>[${groupName}]</strong> Damage-caused: ${killCount} of ${liveMinions.length} minions must die.</em></p>`,
        `<p><em>Damaged tokens tracked: ${damagedNames.length ? damagedNames.join(', ') : '<strong>none identified</strong>'}</em></p>`,
      ];
      if (deferredCount) extraLines.push(`<p><em>${deferredCount} minion has its death deferred and is not a candidate.</em></p>`);
      if (freshHp <= 0) {
        _queueManualKillTargets(new Set(pickable.map(m => m.tokenId).filter(Boolean)), extraLines);
        return;
      }
      if (dbg) console.log(`DSCT | DT | DEFER | eligibleDamaged=${eligibleDamaged.length} killCount=${killCount}`);
      if (eligibleDamaged.length === killCount) {
        if (dbg) console.log('DSCT | DT | DEFER | branch: oneMustDie, the damaged are exactly the toll');
        oneMustDie(eligibleDamaged, extraLines);
        return;
      }
      
      const _sortCandidates = (tokenIds, lockedIds) => {
        const lockedTokens = [...lockedIds].map(id => canvas.tokens.get(id)).filter(Boolean);
        const center = (t) => ({ x: t.x + (t.document.width * canvas.grid.size) / 2, y: t.y + (t.document.height * canvas.grid.size) / 2 });
        const distToLocked = (t) => {
          if (!lockedTokens.length) return 0;
          const c = center(t);
          return Math.min(...lockedTokens.map(lt => { const lc = center(lt); return Math.hypot(c.x - lc.x, c.y - lc.y); }));
        };
        return [...tokenIds].sort((a, b) => {
          const ta = canvas.tokens.get(a), tb = canvas.tokens.get(b);
          if (!ta || !tb) return 0;
          const ea = ta.actor?.effects?.size ?? 0, eb = tb.actor?.effects?.size ?? 0;
          if (ea !== eb) return ea - eb;
          return distToLocked(ta) - distToLocked(tb);
        });
      };

      if (eligibleDamaged.length > killCount) {
        
        const sorted = _sortCandidates(eligibleDamaged, new Set());
        _queueManualPickerContext({
          lockedIds:      new Set(),
          preSelectedIds: new Set(sorted.slice(0, killCount)),
          poolTokenIds:   new Set(eligibleDamaged),
          numToKill:      killCount,
          groupName,
          groupId:        group.id,
        }, extraLines);
        return;
      }
      
      const undamaged = pickable
        .filter(m => m.tokenId && !eligibleDamaged.includes(m.tokenId))
        .map(m => m.tokenId);
      const sortedUndamaged = _sortCandidates(undamaged, new Set(eligibleDamaged));
      if (dbg) console.log(`DSCT | DT | DEFER | branch: picker, locked=${eligibleDamaged.length} undamagedCandidates=${undamaged.length} stillToFind=${killCount - eligibleDamaged.length}`);
      _queueManualPickerContext({
        lockedIds:      new Set(eligibleDamaged),
        preSelectedIds: new Set(sortedUndamaged.slice(0, killCount - eligibleDamaged.length)),
        poolTokenIds:   new Set(pickable.map(m => m.tokenId).filter(Boolean)),
        numToKill:      killCount,
        groupName,
        groupId:        group.id,
      }, extraLines);
    };

    
    
    
    
    if (!window._squadBreakpointPolls) window._squadBreakpointPolls = new Map();
    const prev = window._squadBreakpointPolls.get(group.id);
    if (prev) clearTimeout(prev);

    window._squadDeathLocks.delete(group.id);

    
    if (!window._dsctPendingSquadTimers) window._dsctPendingSquadTimers = new Set();
    window._dsctPendingSquadTimers.add(group.id);

    if (window._dsctFMActive) {
      const poll = setInterval(async () => {
        if (!window._dsctFMActive) {
          clearInterval(poll);
          await processDeath();
          window._dsctPendingSquadTimers?.delete(group.id);
        }
      }, 50);
      window._squadBreakpointPolls.set(group.id, poll);
    } else {
      
      
      window._squadBreakpointPolls.set(group.id, setTimeout(async () => {
        await processDeath();
        window._dsctPendingSquadTimers?.delete(group.id);
      }, 50));
    }
  };

  
  
  const RECONCILE_MS = 1100;
  const RECONCILE_MAX_WAITS = 30;
  const _reconcileTimers = new Map();
  const _reconcileWaits = new Map();

  const scheduleSquadReconcile = (group, { delay = RECONCILE_MS } = {}) => {
    if (!group?.id) return;
    syncDeathPulse(group);
    clearTimeout(_reconcileTimers.get(group.id));
    _reconcileTimers.set(group.id, setTimeout(() => {
      _reconcileTimers.delete(group.id);
      const live = game.combat?.groups?.get(group.id);
      if (!live) { _reconcileWaits.delete(group.id); clearDeathPending(livingTokensOf(group)); return; }
      _onSquadPoolChanged(live, { system: { staminaValue: live.system?.staminaValue } }, {});
    }, delay));
  };

  
  

  const _impatient = new Set();

  const _reconcileWhy = new Map();

  const deferSquadReconcile = (group, why) => {
    
    if (_reconcileWhy.get(group.id) !== why) {
      _reconcileWhy.set(group.id, why);
      _reconcileWaits.set(group.id, 0);
    }
    const waits = (_reconcileWaits.get(group.id) ?? 0) + 1;
    if (waits > RECONCILE_MAX_WAITS) {
      _reconcileWaits.delete(group.id);
      _impatient.add(group.id);
      console.warn(`DSCT | DT | squad reconcile stopped waiting on ${why} for "${group.name ?? group.id}" and is settling the toll from the pool as it stands`);
      scheduleSquadReconcile(group, { delay: 50 });
      return;
    }
    _reconcileWaits.set(group.id, waits);
    if (getSetting('debugMode')) console.log(`DSCT | DT | squad reconcile waiting on ${why} (${waits})`);
    scheduleSquadReconcile(group);
  };

  const clearSquadReconcileWaits = (group) => {
    _reconcileWaits.delete(group?.id);
    _reconcileWhy.delete(group?.id);
    _impatient.delete(group?.id);
    syncDeathPulse(group);
  };

  

  

  _forceSettleNow = () => {
    let stirred = false;
    window._dsctSettleNow = true;

    for (const [groupId, timer] of [..._reconcileTimers]) {
      clearTimeout(timer);
      _reconcileTimers.delete(groupId);
      const live = game.combat?.groups?.get(groupId);
      if (!live) continue;
      
      _impatient.add(groupId);
      _reconcileWaits.delete(groupId);
      stirred = true;
      _onSquadPoolChanged(live, { system: { staminaValue: live.system?.staminaValue } }, {});
    }

    const acc = window._dsctManualKillAccumulator;
    if (acc) { clearTimeout(acc.timer); stirred = true; _flushManualKillAccumulator(); }
    if (!stirred) window._dsctSettleNow = false;
    return stirred;
  };

  Hooks.on('updateCombatantGroup', (group, changes, options) => {
    if (isOurTransition(options)) return;
    if (group?.type !== 'squad') return;
    if (changes?.system?.staminaValue === undefined) return;
    
    _onSquadPoolChanged(group, changes, options);
  });

  Hooks.on('deleteActiveEffect', async (effect) => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('deathMarkerEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;
    if (![...(effect.statuses ?? [])].includes('dead')) return;
    const actor = effect.parent;
    if (!actor) return;
    const token = actor.isToken ? actor.token : canvas.scene?.tokens?.contents?.find(t => t.actor?.id === actor.id);
    if (!token) return;
    const tileId = token.getFlag(M, 'deathMarkerTileId');
    if (!tileId) return;
    canvas.scene.tiles.get(tileId)?.delete().catch(() => {});
    await token.unsetFlag(M, 'deathMarkerTileId');
  });

  Hooks.on('updateToken', async (doc, changes) => {
    if (!getSetting('deathMarkerEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;
    if (changes.x === undefined && changes.y === undefined) return;
    const tileId = doc.getFlag(M, 'deathMarkerTileId');
    if (!tileId) return;
    const gs = canvas.grid.size;
    const tw = Math.max(1, doc.width) * gs;
    const th = Math.max(1, doc.height) * gs;
    const newX = (changes.x ?? doc.x) + tw / 2;
    const newY = (changes.y ?? doc.y) + th / 2;
    canvas.scene.tiles.get(tileId)?.update({ x: newX, y: newY }).catch(() => {});
  });

  Hooks.on('canvasReady', async () => {
    if (!game.users.activeGM?.isSelf) return;
    
    for (const tile of [...canvas.tiles.placeables]) {
      const old = tile.document.getFlag(M, 'deathSkullFor');
      if (old !== undefined) {
        await tile.document.setFlag(M, 'deathMarkerFor', old);
        await tile.document.unsetFlag(M, 'deathSkullFor');
      }
    }
    for (const tokenDoc of [...(canvas.scene?.tokens?.contents ?? [])]) {
      const old = tokenDoc.getFlag(M, 'deathSkullTileId');
      if (old !== undefined) {
        await tokenDoc.setFlag(M, 'deathMarkerTileId', old);
        await tokenDoc.unsetFlag(M, 'deathSkullTileId');
      }
    }
    if (!getSetting('deathMarkerEnabled')) {
      for (const tile of [...canvas.tiles.placeables]) {
        if (tile.document.getFlag(M, 'deathMarkerFor')) tile.document.delete().catch(() => {});
      }
      for (const tokenDoc of [...(canvas.scene?.tokens?.contents ?? [])]) {
        if (tokenDoc.getFlag(M, 'deathMarkerTileId')) tokenDoc.unsetFlag(M, 'deathMarkerTileId').catch(() => {});
      }
      return;
    }
    const currentIcon = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
    for (const tile of [...canvas.tiles.placeables]) {
      const forTokenId = tile.document.getFlag(M, 'deathMarkerFor');
      if (!forTokenId) continue;
      const token = canvas.tokens.get(forTokenId);
      const isDead = token?.actor?.appliedEffects?.some(e => e.statuses?.has('dead'));
      if (!token || !isDead) { tile.document.delete().catch(() => {}); continue; }
      const gs = canvas.grid.size;
      const tw = Math.max(1, token.document.width)  * gs;
      const th = Math.max(1, token.document.height) * gs;
      const expectedX = token.document.x + tw / 2;
      const expectedY = token.document.y + th / 2;
      const updates = {};
      if (tile.document.x !== expectedX || tile.document.y !== expectedY) { updates.x = expectedX; updates.y = expectedY; }
      if (tile.document.texture?.src !== currentIcon) updates['texture.src'] = currentIcon;
      if (Object.keys(updates).length) await tile.document.update(updates);
    }
    for (const tokenDoc of [...(canvas.scene?.tokens?.contents ?? [])]) {
      const tileId = tokenDoc.getFlag(M, 'deathMarkerTileId');
      if (tileId && !canvas.scene.tiles.get(tileId)) await tokenDoc.unsetFlag(M, 'deathMarkerTileId');
    }
    
    
    const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    await _emptyMinions(canvas.tokens.placeables.filter(tok => tok.actor?.statuses?.has(defeatedStatusId)));
  });

  const _deletingCombatIds = new Set();

  Hooks.on('deleteToken', async (tokenDoc) => {
    if (!game.users.activeGM?.isSelf) return;
    const dbg = getSetting('debugMode');
    if (dbg) console.log(`DSCT | deleteToken | fired for token id=${tokenDoc.id} name=${tokenDoc.name}`);
    if (getSetting('cleanOrphanedCombatants')) {
      for (const combat of game.combats.contents) {
        if (_deletingCombatIds.has(combat.id)) continue;
        try {
          const orphaned = combat.combatants.filter(c => c.tokenId === tokenDoc.id);
          if (dbg) console.log(`DSCT | deleteToken | combat ${combat.id}: found ${orphaned.length} matching combatants`);
          const affectedGroupIds = new Set(orphaned.map(c => c._source?.group).filter(Boolean));
          if (orphaned.length) await combat.deleteEmbeddedDocuments('Combatant', orphaned.map(c => c.id));
          if (affectedGroupIds.size) {
            const emptyGroups = [...affectedGroupIds].filter(gid => !Array.from(combat.groups.get(gid)?.members ?? []).length);
            const indivHP = tokenDoc.actor?.system?.isMinion ? (tokenDoc.actor.system.stamina?.max ?? 0) : 0;
            if (indivHP > 0) {
              for (const gid of affectedGroupIds) {
                if (emptyGroups.includes(gid)) continue;
                const group = combat.groups.get(gid);
                if (group) await group.update({ 'system.staminaValue': Math.max(0, (group.system.staminaValue ?? 0) - indivHP) });
              }
            }
            if (dbg) console.log(`DSCT | deleteToken | empty groups after combatant removal: [${emptyGroups.join(', ') || 'none'}]`);
            if (emptyGroups.length) await combat.deleteEmbeddedDocuments('CombatantGroup', emptyGroups);
          }
        } catch (err) {
          if (dbg) console.warn(`DSCT | deleteToken | skipped stale combat ${combat.id}:`, err.message);
        }
      }
    }
    const markerId = tokenDoc.getFlag(M, 'deathMarkerTileId');
    if (markerId) canvas.scene.tiles.get(markerId)?.delete().catch(() => {});
    if (!tokenDoc.flags?.['draw-steel-combat-tools']?.isDefeatedObject) return;
    const rubble = canvas.scene?.tiles?.contents?.filter(t =>
      t.flags?.['draw-steel-combat-tools']?.objectTokenId === tokenDoc.id
    ) ?? [];
    for (const tile of rubble) tile.delete().catch(() => {});
    if (getSetting('debugMode') && rubble.length > 0) console.log(`DSCT | DT | Deleted ${rubble.length} rubble tile(s) for object token ${tokenDoc.id}.`);
  });

  Hooks.on('deleteActor', async (actor) => {
    if (!game.users.activeGM?.isSelf || !getSetting('cleanOrphanedCombatants')) return;
    const dbg = getSetting('debugMode');
    if (dbg) console.log(`DSCT | deleteActor | fired for actor name=${actor.name} id=${actor.id}`);
    for (const combat of game.combats.contents) {
      try {
        const orphaned = combat.combatants.filter(c => c.actorId === actor.id);
        if (dbg) console.log(`DSCT | deleteActor | combat ${combat.id}: found ${orphaned.length} matching combatants`);
        const affectedGroupIds = new Set(orphaned.map(c => c._source?.group).filter(Boolean));
        if (orphaned.length) await combat.deleteEmbeddedDocuments('Combatant', orphaned.map(c => c.id));
        if (affectedGroupIds.size) {
          const emptyGroups = [...affectedGroupIds].filter(gid => !Array.from(combat.groups.get(gid)?.members ?? []).length);
          if (actor.system?.isMinion) {
            const indivHP = actor.system.stamina?.max ?? 0;
            if (indivHP > 0) {
              const hpToSubtract = indivHP * orphaned.length;
              for (const gid of affectedGroupIds) {
                if (emptyGroups.includes(gid)) continue;
                const group = combat.groups.get(gid);
                if (group) await group.update({ 'system.staminaValue': Math.max(0, (group.system.staminaValue ?? 0) - hpToSubtract) });
              }
            }
          }
          if (dbg) console.log(`DSCT | deleteActor | empty groups after combatant removal: [${emptyGroups.join(', ') || 'none'}]`);
          if (emptyGroups.length) await combat.deleteEmbeddedDocuments('CombatantGroup', emptyGroups);
        }
      } catch (err) {
        if (dbg) console.warn(`DSCT | deleteActor | skipped stale combat ${combat.id}:`, err.message);
      }
    }
  });

  Hooks.on('deleteCombat', async (combat) => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('clearSkullsOnCombatEnd') || !game.users.activeGM?.isSelf) return;

    _deletingCombatIds.add(combat.id);
    try {
      const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
      const defeatedTokens = [...(canvas.scene?.tokens?.contents ?? [])].filter(t =>
        t.actor?.statuses?.has(defeatedStatusId) || t.flags?.[M]?.isDefeatedObject
      );
      const deletedIds = defeatedTokens.map(t => t.id);

      for (const tokenDoc of defeatedTokens) {
        await tokenDoc.delete().catch(() => {});
      }

      await deleteDeathMessagesFor(deletedIds);
      await game.settings.set(M, 'deathTrackerSkullIds', []);

      cleanBaseNpcActors();
    } finally {
      _deletingCombatIds.delete(combat.id);
    }
  });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!msg.getFlag(M, 'isDeathMessage')) return;

    const deadTokenIds = msg.getFlag(M, 'deadTokenIds') ??
      (msg.getFlag(M, 'deadTokenId') ? [msg.getFlag(M, 'deadTokenId')] : null);
    if (!deadTokenIds?.length) return;

    const cause = msg.getFlag(M, 'cause') ?? {};

    const stored = msg.getFlag(M, 'deaths');
    const deaths = Array.isArray(stored) && stored.length
      ? stored
      : deadTokenIds.map(id => ({
          tokenId: id,
          name: canvas?.tokens?.get(id)?.actor?.name ?? canvas?.tokens?.get(id)?.name ?? '?',
          img: canvas?.tokens?.get(id)?.document?.texture?.src ?? null,
          isObject: false, groupId: null, groupName: null,
        }));

    const revive = async (ids) => {
      if (!ids?.length) return;
      if (!game.users.activeGM?.isSelf) {
        getModuleApi(false)?.socket?.executeAsGM('dsct.undoDeathMessage', msg.id, game.userId, ids);
        return;
      }
      if (getSetting('deathTrackerManualMode')) await _doReviveManual({ tokenIds: new Set(ids) });
      else await _doReviveV3({ tokenIds: new Set(ids) });
    };

    const fromACard = !!cause.dstd || !!(cause.messageId && game.messages.get(cause.messageId));
    renderDeathMessage(msg, el, { deaths, cause, canRevive: !fromACard && mayUndoDeath(cause), revive });
  });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!msg.getFlag(M, 'manualStep')) return;
    el.querySelectorAll('[data-dsct-manual]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('[data-dsct-manual]').forEach(b => { b.disabled = true; });
        msg.setFlag(M, 'manualDecision', `${btn.dataset.dsctManual}-${btn.dataset.dsctStep}`);
      });
    });
  });
}

const formatNames = (names) => {
  if (names.length === 1) return `<strong>${names[0]}</strong>`;
  if (names.length === 2) return `<strong>${names[0]}</strong> and <strong>${names[1]}</strong>`;
  const last = names[names.length - 1];
  const rest = names.slice(0, -1).map(n => `<strong>${n}</strong>`).join(', ');
  return `${rest}, and <strong>${last}</strong>`;
};

const cleanOrphanedCombatants = async () => {
  if (!game.users.activeGM?.isSelf) return;
  const dbg = getSetting('debugMode');
  for (const combat of game.combats.contents) {
    if (dbg) {
      for (const c of combat.combatants) {
        console.log(`DSCT | orphan-check | combatant id=${c.id} name=${c.name} actorId=${c.actorId} tokenId=${c.tokenId} token=${c.token?.id ?? 'NULL'} actor=${c.actor?.name ?? 'NULL'}`);
      }
    }
    const orphaned = combat.combatants.filter(c => !c.token || !c.actor).map(c => c.id);
    if (dbg) console.log(`DSCT | orphan-check | orphaned combatants: [${orphaned.join(', ') || 'none'}]`);
    if (orphaned.length) await combat.deleteEmbeddedDocuments('Combatant', orphaned);
    const emptyGroups = combat.groups.contents.filter(g => !Array.from(g.members ?? []).length).map(g => g.id);
    if (dbg) console.log(`DSCT | orphan-check | empty groups: [${emptyGroups.join(', ') || 'none'}]`);
    if (emptyGroups.length) await combat.deleteEmbeddedDocuments('CombatantGroup', emptyGroups);
  }
};

const cleanBaseNpcActors = async () => {
  if (!game.users.activeGM?.isSelf) return;
  const actors = game.actors.filter(a =>
    !_isDTExcluded(a) &&
    !a.prototypeToken?.actorLink &&
    (a.statuses?.has('dead') || a.statuses?.has('dying'))
  );
  if (!actors.length) return;
  for (const actor of actors) {
    const max = actor.system.stamina?.max;
    if (max !== undefined && actor.system.stamina.value < max) {
      await actor.update({ 'system.stamina.value': max });
    }
  }
  await new Promise(r => setTimeout(r, 100));
  for (const actor of actors) {
    const fresh = game.actors.get(actor.id);
    if (!fresh) continue;
    if (fresh.statuses?.has('dead'))  await fresh.toggleStatusEffect('dead',  { active: false });
    if (fresh.statuses?.has('dying')) await fresh.toggleStatusEffect('dying', { active: false });
  }
};

const _deathRecords = (batch) => {
  const batchId = foundry.utils.randomID();
  return batch.map((b) => {
    const doc = canvas.tokens?.get(b.tokenId)?.document;
    const groupId = doc?.getFlag(M, 'savedGroupId')
      ?? game.combat?.combatants.find(c => c.tokenId === b.tokenId)?._source?.group
      ?? null;
    const captainOf = doc?.getFlag(M, 'savedCaptainOf') ?? null;
    return {
      tokenId:   b.tokenId,
      name:      b.name,
      img:       doc?.texture?.src ?? doc?.actor?.img ?? null,
      isObject:  !!b.isObject,
      isMinion:  !!doc?.actor?.system?.isMinion,
      batch:     batchId,
      captainOf,
      groupId,
      groupName: _groupNameFor(groupId) ?? _groupNameFor(captainOf),
    };
  });
};

const _deathMessageContent = (deaths) => {
  const creatures = deaths.filter(d => !d.isObject);
  const objects   = deaths.filter(d => d.isObject);
  if (deaths.length === 1) {
    return game.i18n.format(deaths[0].isObject ? 'DSCT.chat.dt.destroyed' : 'DSCT.chat.dt.fallen', { name: deaths[0].name });
  }
  const lines = [];
  if (creatures.length) lines.push(game.i18n.format('DSCT.chat.dt.fallenMultiple', { names: formatNames(creatures.map(d => d.name)) }));
  if (objects.length)   lines.push(game.i18n.format('DSCT.chat.dt.destroyedMultiple', { names: formatNames(objects.map(d => d.name)) }));
  return lines.join('<br>');
};

const DEATH_MESSAGE_APPEND_MS = 60000;

const _deletingDeathMessages = new Set();

const _deathMessageToGrow = (cause) => {
  const key  = cause?.causeId ?? null;
  const card = cause?.messageId ?? null;
  if (!key && !card) return null;
  const cutoff = Date.now() - DEATH_MESSAGE_APPEND_MS;
  for (const msg of game.messages.contents.slice(-30).reverse()) {
    if (msg.timestamp < cutoff) return null;
    const flag = msg?.flags?.[M];
    if (!flag?.isDeathMessage || _deletingDeathMessages.has(msg.id)) continue;
    const seen = flag.cause ?? {};
    if (key ? seen.causeId === key : seen.messageId === card) return msg;
  }
  return null;
};

const _bestCause = (held, next) => {
  if (!next || !Object.keys(next).length) return held ?? {};
  if (!held || !Object.keys(held).length) return next;
  if (held.causeId && next.causeId && held.causeId !== next.causeId) return held;
  const merged = {
    ...held,
    dstd:            !!held.dstd || !!next.dstd,
    messageId:       held.messageId ?? next.messageId ?? null,
    userId:          held.userId ?? next.userId ?? null,
    sourceActorUuid: held.sourceActorUuid ?? next.sourceActorUuid ?? null,
    causeId:         held.causeId ?? next.causeId ?? null,
  };
  const unchanged = Object.keys(merged).length === Object.keys(held).length
    && Object.keys(merged).every(k => merged[k] === held[k]);
  return unchanged ? held : merged;
};

const _existingDeaths = (msg) => {
  const flag = msg?.flags?.[M] ?? {};
  if (Array.isArray(flag.deaths)) return flag.deaths;
  const ids = Array.isArray(flag.deadTokenIds) ? flag.deadTokenIds : (flag.deadTokenId ? [flag.deadTokenId] : []);
  return ids.map(id => ({ tokenId: id, name: canvas.tokens?.get(id)?.name ?? '?', isObject: false, groupId: null, groupName: null }));
};

const flushDeathBatch = async (batch) => {
  if (!batch.length) return;

  const batchCause = batch.find(b => b?.cause && Object.keys(b.cause).length)?.cause ?? {};
  const cause = _bestCause(batchCause, _currentDamageCause());
  const deaths = _deathRecords(batch);

  const grow = _deathMessageToGrow(cause);
  if (grow) {
    const known = _existingDeaths(grow);
    const seen  = new Set(known.map(d => d.tokenId));
    const all   = [...known, ...deaths.filter(d => !seen.has(d.tokenId))];
    const update = {
      content: _deathMessageContent(all),
      [`flags.${M}.deaths`]: all,
      [`flags.${M}.deadTokenIds`]: all.map(d => d.tokenId),
    };

    const better = _bestCause(grow.flags?.[M]?.cause ?? {}, cause);
    if (better !== (grow.flags?.[M]?.cause ?? {})) update[`flags.${M}.cause`] = better;
    const ok = await grow.update(update).then(() => true).catch(() => false);
    if (ok) { cleanBaseNpcActors(); return; }

  }

  await ChatMessage.create({
    content: _deathMessageContent(deaths),
    speaker: { alias: game.i18n.localize('DSCT.chat.dt.speaker') },
    flags: { [M]: { isDeathMessage: true, deadTokenIds: deaths.map(d => d.tokenId), deaths, cause } },
  });
  cleanBaseNpcActors();
};

const deleteDeathMessagesFor = async (tokenIds) => {
  const idSet = new Set(tokenIds);
  const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const toDelete = game.messages.contents.filter(msg => {
    const flag = msg.flags?.[M];
    if (!flag?.isDeathMessage) return false;
    const msgIds = Array.isArray(flag.deadTokenIds) ? flag.deadTokenIds :
                   (flag.deadTokenId ? [flag.deadTokenId] : []);
    if (!msgIds.length) return false;
    
    
    return msgIds.every(id => {
      if (idSet.has(id)) return true;
      const token = canvas.tokens.get(id);
      return !token || !token.actor?.statuses?.has(defeatedStatus);
    });
  });
  for (const msg of toDelete) _deletingDeathMessages.add(msg.id);
  try {
    for (const msg of toDelete) {
      if (msg.isOwner || game.user.isGM) await msg.delete().catch(() => {});
    }
  } finally {
    for (const msg of toDelete) _deletingDeathMessages.delete(msg.id);
  }
};

const resolveBreakpointUser = () => {
  const combatant = game.combat?.combatant;
  if (combatant?.actor?.type === 'hero') {
    const owner = game.users.find(u => !u.isGM && u.active && combatant.actor.testUserPermission(u, 'OWNER'));
    if (owner) return owner.id;
  }
  const lastMsg = game.messages.contents[game.messages.contents.length - 1];
  if (lastMsg) {
    const author = game.users.get(lastMsg.author?.id ?? lastMsg.user?.id);
    if (author && !author.isGM && author.active) return author.id;
  }
  return game.users.activeGM?.id ?? game.user.id;
};

const resolvePickerUserId = () => {
  if (getSetting('gmControlsAllDeathPickers')) return game.users.activeGM?.id ?? game.user.id;
  const storedUserId = window._lastSquadDamageUserId;
  const storedUser   = storedUserId ? game.users.get(storedUserId) : null;
  const userId = (storedUser && !storedUser.isGM && storedUser.active)
    ? storedUserId
    : resolveBreakpointUser();
  const user = game.users.get(userId);
  if (user && !user.isGM && user.getFlag(M, 'cedeDeathPickerToGM')) {
    return game.users.activeGM?.id ?? game.user.id;
  }
  return userId;
};

export const runRaiseDeadUI = () => {
  if (!game.user.isGM) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.gmOnly')); return; }
  if (window._raiseDeadActive) return;

  
  setRaisedDeadVisible(true);
  activateTokenLayer();

  const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const defeated = canvas.tokens.placeables.filter(t =>
    t.actor?.statuses?.has(defeatedStatusId) && t.actor?.type !== 'object'
  );

  if (!defeated.length) {
    setRaisedDeadVisible(false);
    activateTokenLayer();
    ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.noDefeated'));
    return;
  }

  window._raiseDeadActive = true;

  const hlName = 'dsct-raise-dead-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const selected = new Set();

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const t of defeated) {
      const isSelected = selected.has(t.id);
      const w = Math.max(1, Math.round(t.document.width));
      const h = Math.max(1, Math.round(t.document.height));
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          canvas.interface.grid.highlightPosition(hlName, {
            x: Math.floor(t.x / canvas.grid.size) * canvas.grid.size + (dx * canvas.grid.size),
            y: Math.floor(t.y / canvas.grid.size) * canvas.grid.size + (dy * canvas.grid.size),
            color:  isSelected ? 0x00CCFF : 0x00FF00,
            border: isSelected ? 0x0088AA : 0x00AA00,
          });
        }
      }
      if (isSelected) setPickerTarget(t, 0x00CCFF, 1.0);
      else removePickerTarget(t);
    }
  };

  const overlay = beginPickerOverlay({
    title: game.i18n.localize('DSCT.picker.titleRaise'),
    tokens: defeated,
    onConfirm: () => doRevive(),
    onCancel: () => {
      finish();
      ui.notifications.info(game.i18n.localize('DSCT.notice.dt.raiseDeadCancelled'));
    },
  });
  const syncStatus = () => {
    overlay.setStatus(game.i18n.format('DSCT.picker.selectedCount', { n: selected.size }));
    overlay.setReady(selected.size > 0);
  };
  syncStatus();
  drawHighlights();

  const finish = () => {
    window._raiseDeadActive = false;
    setRaisedDeadVisible(false);
    activateTokenLayer();
    overlay.end();
    clearPickerArrows();
    canvas.interface.grid.destroyHighlightLayer(hlName);
    canvas.stage.off('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('contextmenu', onContextMenu);
  };

  const doRevive = async () => {
    finish();
    if (!selected.size) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.noSkullsSelected')); return; }
    if (getSetting('deathTrackerManualMode')) {
      await _doReviveManual({ tokenIds: new Set(selected) });
    } else {
      await _doReviveV3({ tokenIds: new Set(selected) });
    }
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    if (getSetting('cancelOnRightClick')) {
      finish();
      ui.notifications.info(game.i18n.localize('DSCT.notice.dt.raiseDeadCancelled'));
    }
  };

  const onClick = (event) => {
    if (event.data.originalEvent.button !== 0) return;

    const pos = event.data.getLocalPosition(canvas.app.stage);
    const clicked = defeated.filter(t => {
      const tw = t.document.width * canvas.grid.size;
      const th = t.document.height * canvas.grid.size;
      return pos.x >= t.x && pos.x <= t.x + tw && pos.y >= t.y && pos.y <= t.y + th;
    });
    if (!clicked.length) {
      const now = Date.now();
      if (now - (onClick._lastEmptyClick ?? 0) < 400) { onClick._lastEmptyClick = 0; doRevive(); }
      else onClick._lastEmptyClick = now;
      return;
    }

    const allSelected = clicked.every(t => selected.has(t.id));
    let added = false;
    for (const t of clicked) {
      if (allSelected) selected.delete(t.id);
      else { selected.add(t.id); added = true; }
    }
    drawHighlights();
    syncStatus();
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      doRevive();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      ui.notifications.info(game.i18n.localize('DSCT.notice.dt.raiseDeadCancelled'));
    }
  };

  canvas.stage.on('mousedown', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('contextmenu', onContextMenu);
};

export const reviveTokens = async (tokenIds, { skipGroupHpRestore = false } = {}) => {
  if (!game.users.activeGM?.isSelf) return;
  await _doReviveV3({ tokenIds: new Set(tokenIds), skipGroupHpRestore });
};

export const reviveAll = async () => {
  if (!game.user.isGM) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.gmOnly')); return; }
  const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const defeated = canvas.tokens.placeables.filter(t =>
    t.actor?.statuses?.has(defeatedStatusId) && t.actor?.type !== 'object'
  );
  if (!defeated.length) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.noSkulls')); return; }

  if (getSetting('deathTrackerManualMode')) {
    await _doReviveManual({ tokenIds: new Set(defeated.map(t => t.id)) });
    return;
  }

  await _doReviveV3({ tokenIds: new Set(defeated.map(t => t.id)) });
};

const executeRevival = async (tokenId, { skipGroupHpUpdate = false } = {}) => {
  const tokenDoc = canvas.scene.tokens.get(tokenId);

  if (!tokenDoc) {
    ui.notifications.error(game.i18n.localize('DSCT.notice.dt.tokenNotFound'));
    return;
  }

  

  const combatant = game.combat?.combatants.find(c => c.tokenId === tokenId);
  if (combatant?.defeated) await combatant.update({ defeated: false });

  const actor = tokenDoc.actor;
  const isMinion = actor?.system?.isMinion ?? false;
  if (actor) {
    const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    if (actor.statuses?.has(defeatedStatusId)) {
      await actor.toggleStatusEffect(defeatedStatusId, { overlay: true, active: false });
    }

    const currentStamina = actor.system.stamina?.value || 0;
    if (currentStamina <= 0) {
      await actor.update({ 'system.stamina.value': 1 });
    }

    await new Promise(r => setTimeout(r, 50));

    if (getSetting('clearEffectsOnRevive')) {
      

      const validEffectIds = actor.effects
        .filter(e => !e.id.endsWith('0000000000'))
        .map(e => e.id);

      if (validEffectIds.length > 0) {
        try {
          await actor.deleteEmbeddedDocuments("ActiveEffect", validEffectIds);
        } catch (e) {
          console.warn("DSCT | DT | Minor error clearing remaining effects: ", e);
        }
      }
    }
  }

  const savedDisplayBars = tokenDoc.getFlag('draw-steel-combat-tools', 'savedDisplayBars');
  const restoreUpdate = {
    flags: { [M]: { savedDisplayBars: _dropFlag() } },
  };
  if (savedDisplayBars !== undefined) restoreUpdate.displayBars = savedDisplayBars;
  await tokenDoc.update(restoreUpdate);
  if (tokenDoc.object) await animateDeathVisual(tokenDoc.object);

  if (game.combat && !game.combat.combatants.find(c => c.tokenId === tokenId)) {
    const savedGroupId = tokenDoc.getFlag('draw-steel-combat-tools', 'savedGroupId');
    const group = savedGroupId ? game.combat.groups.get(savedGroupId) : null;
    const combatantData = { tokenId, sceneId: canvas.scene.id, actorId: tokenDoc.actorId };
    if (group) combatantData.group = savedGroupId;
    await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
    if (!skipGroupHpUpdate && group && isMinion) {
      const minionMaxHP = tokenDoc.actor?.system?.stamina?.max ?? 0;
      if (minionMaxHP > 0) await group.update({ 'system.staminaValue': (group.system.staminaValue ?? 0) + minionMaxHP });
    }
    if (savedGroupId) await tokenDoc.unsetFlag('draw-steel-combat-tools', 'savedGroupId');
  }

  ui.notifications.info(game.i18n.format('DSCT.notice.dt.revived', { name: tokenDoc.name }));
};

export const cleanupPixi = () => {
  const layers = ['dsct-hover-preview-hl', 'dsct-raise-dead-hl', 'dsct-pwk-hl', 'dsct-fm-undo-hl', 'dsct-manual-pick-hl'];
  for (const name of layers) {
    if (canvas.interface.grid.highlightLayers?.[name]) canvas.interface.grid.clearHighlightLayer(name);
  }

  for (const container of [window._dsctPwkXContainer, ...(window._dsctPickLayers ?? [])]) {
    if (!container) continue;
    container.parent?.removeChild(container);
    container.destroy({ children: true });
  }
  window._dsctPwkXContainer = null;
  window._dsctPickLayers = null;

  if (window._dsctPwkNotif) { ui.notifications.remove(window._dsctPwkNotif); window._dsctPwkNotif = null; }
  if (window._dsctRaiseDeadNotif) { ui.notifications.remove(window._dsctRaiseDeadNotif); window._dsctRaiseDeadNotif = null; }
  endPickerOverlay();
  clearPickerArrows();

  window._pwkActive = false;
  window._dsctFlushBusy = false;
  clearPickerLockLocal();
  window._dsctDeclinedDeaths = null;
  window._pwkQueue = [];
  window._raiseDeadActive = false;
  setRaisedDeadVisible(false);

  clearPreviewTokens();
  activateTokenLayer();
};

export const runPowerWordKillUI = async (options = {}) => {
  if (!getSetting('deathTrackerEnabled')) return;

  if (window._pwkActive) {
    if (!window._pwkQueue) window._pwkQueue = [];
    window._pwkQueue.push(options);
    return;
  }

  const maxTargets = options.maxTargets || Infinity;
  const squadGroup = options.squadGroup || null;
  const minionCombatants = options.minions || [];
  const damagedTokenIds = options.damagedTokenIds || [];
  const autoAssign = squadGroup && getSetting('autoAssignDamagedMinion');

  window._pwkActive = true;
  const processQueue = () => { const next = window._pwkQueue?.shift(); if (next) runPowerWordKillUI(next); };

  const minionTokenIds = new Set(minionCombatants.map(m => m.tokenId));
  let npcs = squadGroup
    ? canvas.tokens.placeables.filter(t => minionTokenIds.has(t.id) && !t.document.hidden && !t.actor?.statuses?.has('dead') && !t.document.defeated)
    : canvas.tokens.placeables.filter(t => t.actor && !_isDTExcluded(t.actor) && !t.document.hidden && !t.actor.statuses?.has('dead') && (t.actor.system?.stamina?.value > 0));

  if (!npcs.length) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.noValidTargets'));
    window._pwkActive = false;
    processQueue();
    return;
  }

  const hlName = 'dsct-pwk-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const xContainer = new PIXI.Container();
  canvas.controls.addChild(xContainer);
  window._dsctPwkXContainer = xContainer;

  const hoverContainer = new PIXI.Container();
  canvas.controls.addChild(hoverContainer);

  const dimXContainerPwk = new PIXI.Container();
  dimXContainerPwk.alpha = 0.1;
  canvas.controls.addChild(dimXContainerPwk);

  let _pwkT = 0;
  const _pwkTicker = () => {
    _pwkT += canvas.app.ticker.elapsedMS;
    const _pwkDur = 2000, _pwkPause = _pwkDur * 0.6;
    const _pwkCycle = _pwkT % _pwkDur;
    const _pwkAlpha = _pwkCycle < _pwkPause
      ? 0.75
      : 0.75 + 0.15 * Math.sin(((_pwkCycle - _pwkPause) / (_pwkDur - _pwkPause)) * Math.PI);
    xContainer.alpha = _pwkAlpha;
    hoverContainer.alpha = _pwkAlpha * 0.35;
  };
  canvas.app.ticker.add(_pwkTicker);

  const lockedTokens = new Set();
  const selectedTokens = new Set();
  let hoveredNpcId = null;

  if (getSetting('debugMode')) console.log(`DSCT | DT | PWK start: autoAssign=${autoAssign} maxTargets=${maxTargets} damagedTokenIds=[${damagedTokenIds.join(',')}] npcs=[${npcs.map(t=>t.id).join(',')}]`);
  if (autoAssign && damagedTokenIds.length > 0) {
    const eligibleDamaged = damagedTokenIds.filter(id => npcs.find(t => t.id === id));
    if (getSetting('debugMode')) console.log(`DSCT | DT | PWK autoAssign: eligibleDamaged=[${eligibleDamaged.join(',')}] maxTargets=${maxTargets} willAutoKill=${eligibleDamaged.length === maxTargets}`);
    if (eligibleDamaged.length === maxTargets) {
      window._pwkActive = false;
      canvas.app.ticker.remove(_pwkTicker);
      xContainer.parent?.removeChild(xContainer);
      xContainer.destroy({ children: true });
      hoverContainer.parent?.removeChild(hoverContainer);
      hoverContainer.destroy({ children: true });
      dimXContainerPwk.parent?.removeChild(dimXContainerPwk);
      dimXContainerPwk.destroy({ children: true });
      canvas.interface.grid.destroyHighlightLayer(hlName);

      if (squadGroup) {
        const pending = window._squadBreakpointPolls?.get(squadGroup.id);
        if (pending) { clearTimeout(pending); window._squadBreakpointPolls.delete(squadGroup.id); }
      }
      window._dsctKillLockActive = true;
      window._dsctKillLockSkipped = new Set();
      if (getSetting('debugMode')) console.log(`DSCT | DT | Kill lock acquired (OMD, ${eligibleDamaged.length} targets)`);
      try {
        const batchEntries = [];
        const killedTokenIds = new Set();
        for (const id of eligibleDamaged) {
          const t = canvas.tokens.get(id);
          if (!t?.actor || t.actor.statuses?.has('dead')) continue;
          if (getSetting('debugMode')) console.log(`DSCT | DT | Kill lock: applying dead to ${t.actor.name} (${t.id})`);
          await safeToggleStatusEffect(t.actor, 'dead', { active: true });
          await _processTokenDeath(t, t.actor, { batchEntries });
          killedTokenIds.add(t.id);
        }
        
        const skipped = [...(window._dsctKillLockSkipped ?? [])].filter(id => !killedTokenIds.has(id));
        window._dsctKillLockSkipped = null;
        for (const tokenId of skipped) {
          const t = canvas.tokens.get(tokenId);
          if (!t?.actor) continue;
          if (getSetting('debugMode')) console.log(`DSCT | DT | Kill lock: processing DS-collateral kill ${t.actor.name} (${t.id})`);
          await _processTokenDeath(t, t.actor, { batchEntries });
        }
        if (batchEntries.length) flushDeathBatch(batchEntries);
        if (getSetting('debugMode')) await new Promise(r => setTimeout(r, 500));
      } finally {
        window._dsctKillLockActive = false;
        window._dsctKillLockSkipped = null;
        if (getSetting('debugMode')) console.log('DSCT | DT | Kill lock released (OMD)');
      }
      ui.notifications.info(eligibleDamaged.length > 1 ? 'MASS POWER WORD: KILL' : 'POWER WORD: KILL');
      processQueue();
      return;
    } else if (eligibleDamaged.length > maxTargets) {
      npcs = npcs.filter(t => eligibleDamaged.includes(t.id));
    } else {
      for (const id of eligibleDamaged) {
        lockedTokens.add(id);
        selectedTokens.add(id);
      }
    }
  }

  const _drawXSprite = (token, container) => {
    const tw  = Math.ceil(token.document.width  * canvas.grid.size);
    const th  = Math.ceil(token.document.height * canvas.grid.size);
    const pad = Math.max(6, tw * 0.08);
    const lw  = Math.max(16, tw * 0.22);
    const olw = Math.round(lw * 1.5);
    const gfx = new PIXI.Graphics();
    gfx.lineStyle(olw, 0x000000, 1);
    gfx.moveTo(pad,      pad); gfx.lineTo(tw - pad, th - pad);
    gfx.moveTo(tw - pad, pad); gfx.lineTo(pad,      th - pad);
    gfx.lineStyle(lw, 0xFF0000, 1);
    gfx.moveTo(pad,      pad); gfx.lineTo(tw - pad, th - pad);
    gfx.moveTo(tw - pad, pad); gfx.lineTo(pad,      th - pad);
    const rt = PIXI.RenderTexture.create({ width: tw, height: th });
    canvas.app.renderer.render(gfx, { renderTexture: rt, clear: true });
    gfx.destroy();
    const sprite = new PIXI.Sprite(rt);
    sprite.x = token.x;
    sprite.y = token.y;
    container.addChild(sprite);
  };

  const drawXMarks = () => {
    for (const child of xContainer.removeChildren()) child.destroy({ texture: true, baseTexture: true });
    for (const npc of npcs) {
      if (!selectedTokens.has(npc.id)) continue;
      _drawXSprite(npc, xContainer);
    }
  };

  const drawHoverX = (token) => {
    for (const child of hoverContainer.removeChildren()) child.destroy({ texture: true, baseTexture: true });
    if (token) _drawXSprite(token, hoverContainer);
  };

  const drawDimXPwk = () => {
    for (const child of dimXContainerPwk.removeChildren()) child.destroy({ texture: true, baseTexture: true });
    if (!getSetting('deathPickerDimAll')) return;
    for (const npc of npcs) {
      if (selectedTokens.has(npc.id)) continue;
      _drawXSprite(npc, dimXContainerPwk);
    }
  };

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const npc of npcs) {
      if (selectedTokens.has(npc.id)) continue;
      const isHovered = npc.id === hoveredNpcId;
      const color  = isHovered ? 0xFFCC44 : 0xFF8800;
      const border = isHovered ? 0xCC8800 : 0xAA4400;
      const w = Math.max(1, Math.round(npc.document.width));
      const h = Math.max(1, Math.round(npc.document.height));
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          const gx = Math.floor(npc.x / canvas.grid.size) * canvas.grid.size + (dx * canvas.grid.size);
          const gy = Math.floor(npc.y / canvas.grid.size) * canvas.grid.size + (dy * canvas.grid.size);
          canvas.interface.grid.highlightPosition(hlName, { x: gx, y: gy, color, border });
        }
      }
    }
    drawXMarks();
    drawDimXPwk();
    const hoveredToken = npcs.find(t => t.id === hoveredNpcId);
    drawHoverX(hoveredToken && !selectedTokens.has(hoveredToken.id) ? hoveredToken : null);
  };

  const overlay = beginPickerOverlay({
    title: game.i18n.localize('DSCT.picker.titleDeath'),
    tokens: npcs,
    onConfirm: () => doKill(),
    onCancel: () => doCancel(),
  });
  const syncStatus = () => {
    overlay.setStatus(
      Number.isFinite(maxTargets)
        ? game.i18n.format('DSCT.picker.pickCount', { max: maxTargets, s: maxTargets !== 1 ? 's' : '', n: selectedTokens.size })
        : game.i18n.format('DSCT.picker.selectedCount', { n: selectedTokens.size }),
    );
    overlay.setReady(Number.isFinite(maxTargets) ? selectedTokens.size >= maxTargets : selectedTokens.size > 0);
  };
  syncStatus();
  drawHighlights();

  const finish = () => {
    window._pwkActive = false;
    overlay.end();
    canvas.app.ticker.remove(_pwkTicker);
    canvas.interface.grid.destroyHighlightLayer(hlName);
    xContainer.parent?.removeChild(xContainer);
    xContainer.destroy({ children: true });
    window._dsctPwkXContainer = null;
    hoverContainer.parent?.removeChild(hoverContainer);
    hoverContainer.destroy({ children: true });
    dimXContainerPwk.parent?.removeChild(dimXContainerPwk);
    dimXContainerPwk.destroy({ children: true });
    canvas.stage.off('mousedown', onClick);
    canvas.stage.off('mousemove', onMove);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('contextmenu', onContextMenu);
  };

  const doKill = async () => {
    finish();
    canvas.tokens.releaseAll();
    [...game.user.targets].forEach(t => t.setTarget(false, { releaseOthers: false }));

    if (selectedTokens.size === 0) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.noTargetsSelected'));
      processQueue();
      return;
    }

    if (getSetting('deathTrackerManualMode')) {
      await _doKillManual({ tokenIds: selectedTokens, squadGroup, processQueue });
      return;
    }

    await _doKillV3(selectedTokens);
    processQueue();
  };

  const doCancel = () => {
    finish();
    ui.notifications.info(game.i18n.localize('DSCT.notice.dt.pwkCancelled'));
    processQueue();
  };

  const onClick = (event) => {
    if (event.data.originalEvent.button === 2) {
      if (getSetting('cancelOnRightClick')) doCancel();
      return;
    }

    if (event.data.originalEvent.button !== 0) return;

    const pos = event.data.getLocalPosition(canvas.app.stage);

    const clicked = npcs.filter(t => {
       const w = t.document.width * canvas.grid.size;
       const h = t.document.height * canvas.grid.size;
       return pos.x >= t.x && pos.x <= t.x + w && pos.y >= t.y && pos.y <= t.y + h;
    });

    if (!clicked.length) {
      const now = Date.now();
      if (now - (onClick._lastEmptyClick ?? 0) < 400) { onClick._lastEmptyClick = 0; doKill(); }
      else onClick._lastEmptyClick = now;
      return;
    }

    const targetId = clicked[0].id;
    if (selectedTokens.has(targetId)) {
        if (lockedTokens.has(targetId)) {
            overlay.flashWarning(game.i18n.format('DSCT.notice.dt.pwkCannotDeselect', { name: clicked[0].name }));
            return;
        }
        selectedTokens.delete(targetId);
    } else {
        if (selectedTokens.size >= maxTargets) {
            overlay.flashWarning(game.i18n.format('DSCT.notice.dt.pwkSelectExactly', { max: maxTargets, s: maxTargets !== 1 ? 's' : '' }));
            return;
        }
        selectedTokens.add(targetId);
    }

    drawHighlights();
    syncStatus();
    if (getSetting('autoConfirmSelection') && selectedTokens.size >= maxTargets) doKill();
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      doKill();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      ui.notifications.info(game.i18n.localize('DSCT.notice.dt.selectionCancelled'));
      processQueue();
    }
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    if (getSetting('cancelOnRightClick')) doCancel();
  };

  const onMove = (event) => {
    const pos = event.data.getLocalPosition(canvas.app.stage);
    const hit = npcs.find(t => {
      const w = t.document.width * canvas.grid.size;
      const h = t.document.height * canvas.grid.size;
      return pos.x >= t.x && pos.x <= t.x + w && pos.y >= t.y && pos.y <= t.y + h;
    });
    const newId = hit?.id ?? null;
    if (newId === hoveredNpcId) return;
    hoveredNpcId = newId;
    drawHighlights();
  };

  canvas.stage.on('mousedown', onClick);
  canvas.stage.on('mousemove', onMove);
  document.addEventListener('keydown', onKey);
  document.addEventListener('contextmenu', onContextMenu);
};

