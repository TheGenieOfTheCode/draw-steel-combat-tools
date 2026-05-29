import { getSetting, getModuleApi, safeToggleStatusEffect, safeUpdate, getSquadGroup, MATERIAL_ICONS, safeCreateEmbedded, safeDelete } from '../helpers.mjs';
import { setRaisedDeadVisible, addPreviewToken, removePreviewToken, activateTokenLayer, clearPreviewTokens } from './defeated-token-visibility.mjs';
import { applySquadLabels } from '../squad-labels.mjs';

const M = 'draw-steel-combat-tools';

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
  const _rawTintVal = token.document.texture?.tint;
  const preAlpha    = token.document.alpha ?? 1;
  
  
  let _tintNum = 0xFFFFFF;
  let preTint = '#ffffff';
  if (_rawTintVal != null) {
    if (typeof _rawTintVal === 'string' && _rawTintVal.startsWith('#')) {
      _tintNum = parseInt(_rawTintVal.slice(1), 16) || 0xFFFFFF;
      preTint  = _rawTintVal.toLowerCase();
    } else {
      const _n = Number(_rawTintVal?.valueOf?.() ?? _rawTintVal);
      if (isFinite(_n)) { _tintNum = _n >>> 0; preTint = `#${_tintNum.toString(16).padStart(6, '0')}`; }
    }
  }
  if (_tintNum === 0xFF0000 && preAlpha <= 0.6 && !actor.statuses?.has('dead')) { preTint = '#ffffff'; }

  
  const flagData = { savedDisplayBars: token.document.displayBars, preDeathTint: preTint, preDeathAlpha: preAlpha };
  if (groupId) flagData.savedGroupId = groupId;
  await Promise.all([
    token.document.update({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE, flags: { [M]: flagData } }),
    combatant ? combatant.delete() : Promise.resolve(),
  ]);

  const isObject = actor.type === 'object';
  const targetAlpha = isObject ? 0 : 0.5;

  
  const animDuration = window._dsctKillLockActive ? 0 : getSetting('deathAnimationDuration');
  if (animDuration > 0 && !window._dsctFMActive) {
    await token.document.update({ 'texture.tint': '#ff0000' });
    await new Promise(resolve => {
      const start = performance.now();
      const tick = (now) => {
        if (!canvas.tokens.get(token.id)) { resolve(); return; }
        const progress = Math.min(1, (now - start) / animDuration);
        if (token.mesh) token.mesh.alpha = preAlpha + (targetAlpha - preAlpha) * progress;
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  if (canvas.tokens.get(token.id)) {
    if (!isObject) {
      if (getSetting('deathMarkerEnabled')) {
        const markerSrc = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
        const gs = canvas.grid.size;
        const tw = Math.max(1, token.document.width) * gs;
        const th = Math.max(1, token.document.height) * gs;
        
        const [[markerTile]] = await Promise.all([
          canvas.scene.createEmbeddedDocuments('Tile', [{
            x: token.document.x + tw / 2, y: token.document.y + th / 2,
            width: tw / 2, height: th / 2,
            texture: { src: markerSrc },
            overhead: false, locked: true, hidden: false,
            restrictions: { light: false, weather: false },
            video: { loop: false, autoplay: false, volume: 0 },
            flags: { [M]: { deathMarkerFor: token.id } },
          }]),
          token.document.update({ 'texture.tint': '#ff0000', alpha: 0.5 }),
        ]);
        if (markerTile) await token.document.setFlag(M, 'deathMarkerTileId', markerTile.id);
      } else {
        await token.document.update({ 'texture.tint': '#ff0000', alpha: 0.5 });
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

      await token.document.update({ hidden: true, alpha: 1, 'texture.tint': '#ffffff' });
      await token.document.setFlag('draw-steel-combat-tools', 'isDefeatedObject', true);
    }

    if (!isObject && actor.system?.isMinion) actor.updateSource({ 'system.stamina.value': 0 });

    const entry = { name: actor.name, tokenId: token.id, isObject };
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

    
    
    const preDeathVisuals = new Map(tokens.map(t => [t.id, (() => {
      const rawTintVal = t.document.texture?.tint;  
      const rawAlpha   = t.document.alpha ?? 1;
      
      
      
      let tintNum = 0xFFFFFF;
      let tintHex = '#ffffff';
      if (rawTintVal != null) {
        if (typeof rawTintVal === 'string' && rawTintVal.startsWith('#')) {
          tintNum = parseInt(rawTintVal.slice(1), 16) || 0xFFFFFF;
          tintHex = rawTintVal.toLowerCase();
        } else {
          const n = Number(rawTintVal?.valueOf?.() ?? rawTintVal);
          if (isFinite(n)) {
            tintNum = n >>> 0;
            tintHex = `#${tintNum.toString(16).padStart(6, '0')}`;
          }
        }
      }
      
      
      const isDeadLooking = tintNum === 0xFF0000 && rawAlpha <= 0.6;
      const isActuallyDead = t.actor.statuses?.has('dead');
      if (_dbgTime && isDeadLooking && !isActuallyDead) console.log(`DSCT | DT | [TO-DBG2] broken-state detected on "${t.actor.name}" (tintHex=${tintHex}, alpha=${rawAlpha}), overriding to defaults`);
      return {
        tint:  (isDeadLooking && !isActuallyDead) ? '#ffffff' : tintHex,
        alpha: (isDeadLooking && !isActuallyDead) ? 1         : rawAlpha,
      };
    })()]));

    
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
    const step3AffectedGroups = new Set();
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
      const _vis      = preDeathVisuals.get(t.id) ?? {};
      const flagData  = {
        savedDisplayBars: t.document.displayBars,
        preDeathTint:     _vis.tint  ?? '#ffffff',
        preDeathAlpha:    _vis.alpha ?? 1,
      };
      if (groupId) flagData.savedGroupId = groupId;
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
      if (t.actor.system?.isMinion && groupId) step3AffectedGroups.add(groupId);
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

    
    
    
    if (step3AffectedGroups.size && game.combat) {
      const killedIds = new Set(tokens.map(t => t.id));
      const _dbg1 = getSetting('debugMode');
      if (_dbg1) console.log(`DSCT | DT | [TO-DBG1] affectedGroups=${[...step3AffectedGroups].join(',')}, killedIds=${[...killedIds].join(',')}, totalCombatants=${game.combat.combatants.size}`);
      for (const c of game.combat.combatants) {
        const cGroupId = c._source?.group ?? null;
        if (_dbg1) console.log(`DSCT | DT | [TO-DBG1]   combatant "${c.name}" tokenId=${c.tokenId} group=${cGroupId} isKilled=${killedIds.has(c.tokenId)}`);
        if (!cGroupId || !step3AffectedGroups.has(cGroupId) || killedIds.has(c.tokenId)) continue;
        const tok = canvas.tokens.get(c.tokenId);
        if (_dbg1) console.log(`DSCT | DT | [TO-DBG1]   → tick refresh on "${c.name}": tok=${!!tok}, hasBars=${!!tok?.bars}`);
        if (!tok?.bars) continue;
        const grp = game.combat.groups.get(cGroupId);
        const newCount = grp?.system?.minions?.size ?? 0;
        tok.bars._tickCount = newCount;
        
        
        delete tok._barWidth;
        Hooks.callAll('refreshToken', tok, { refreshBars: true });
      }
    }

    
    const batchEntries = [];
    const animDuration = (getSetting('batchAnimationSafety') && tokens.length >= 8) ? 0 : getSetting('deathAnimationDuration');
    _tm(`step 4: starting visuals (animDuration=${animDuration}ms)`);
    await Promise.all(tokens.map(async (t) => {
      if (!canvas.tokens.get(t.id)) return;
      const isObject = t.actor.type === 'object';
      const preAlpha = t.document.getFlag(M, 'preDeathAlpha') ?? 1;
      if (animDuration > 0 && !window._dsctFMActive) {
        await t.document.update({ 'texture.tint': '#ff0000' });
        const targetAlpha = isObject ? 0 : 0.5;
        await new Promise(resolve => {
          const start = performance.now();
          const tick = (now) => {
            if (!canvas.tokens.get(t.id)) { resolve(); return; }
            const progress = Math.min(1, (now - start) / animDuration);
            if (t.mesh) t.mesh.alpha = preAlpha + (targetAlpha - preAlpha) * progress;
            if (progress < 1) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
      }
      if (!canvas.tokens.get(t.id)) return;
      if (!isObject) {
        if (getSetting('deathMarkerEnabled')) {
          const markerSrc = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
          const gs = canvas.grid.size;
          const tw = Math.max(1, t.document.width)  * gs;
          const th = Math.max(1, t.document.height) * gs;
          const [[markerTile]] = await Promise.all([
            canvas.scene.createEmbeddedDocuments('Tile', [{
              x: t.document.x + tw / 2, y: t.document.y + th / 2,
              width: tw / 2, height: th / 2,
              texture: { src: markerSrc },
              overhead: false, locked: true, hidden: false,
              restrictions: { light: false, weather: false },
              video: { loop: false, autoplay: false, volume: 0 },
              flags: { [M]: { deathMarkerFor: t.id } },
            }]),
            t.document.update({ 'texture.tint': '#ff0000', alpha: 0.5 }),
          ]);
          _tm(`step 4: skull tile + tint -- ${t.actor.name}`);
          if (markerTile) await t.document.setFlag(M, 'deathMarkerTileId', markerTile.id);
          _tm(`step 4: done -- ${t.actor.name}`);
        } else {
          await t.document.update({ 'texture.tint': '#ff0000', alpha: 0.5 });
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
      batchEntries.push({ name: t.actor.name, tokenId: t.id, isObject });
    }));

    _tm('step 4 complete; flushing death batch');
    if (batchEntries.length) flushDeathBatch(batchEntries);
    _tm('death batch flushed');
    
    for (const { tokenId, isObject: obj } of batchEntries) {
      if (!obj) continue;
      const tok = canvas.tokens.get(tokenId);
      if (tok) {
        await tok.document.update({ hidden: true, alpha: 1, 'texture.tint': '#ffffff' });
        await tok.document.setFlag(M, 'isDefeatedObject', true);
      }
    }
    for (const t of tokens) {
      if (t.actor?.system?.isMinion) t.actor.updateSource({ 'system.stamina.value': 0 });
    }
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
          const _mrv = t.document.texture?.tint; const _mpa = t.document.alpha ?? 1;
          let _mtn = 0xFFFFFF; let _mth = '#ffffff';
          if (_mrv != null) {
            if (typeof _mrv === 'string' && _mrv.startsWith('#')) { _mtn = parseInt(_mrv.slice(1), 16) || 0xFFFFFF; _mth = _mrv.toLowerCase(); }
            else { const _mn = Number(_mrv?.valueOf?.() ?? _mrv); if (isFinite(_mn)) { _mtn = _mn >>> 0; _mth = `#${_mtn.toString(16).padStart(6, '0')}`; } }
          }
          if (_mtn === 0xFF0000 && _mpa <= 0.6 && !t.actor.statuses?.has('dead')) _mth = '#ffffff';
          const flagData  = {
            savedDisplayBars: t.document.displayBars,
            preDeathTint:     _mth,
            preDeathAlpha:    _mpa,
          };
          if (groupId) flagData.savedGroupId = groupId;
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
            preDeathTint:     foundry.data.operators.ForcedDeletion,
            preDeathAlpha:    foundry.data.operators.ForcedDeletion,
            savedDisplayBars: foundry.data.operators.ForcedDeletion,
            savedGroupId:     foundry.data.operators.ForcedDeletion,
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
      await Promise.all(tokens.map(async (t) => {
        if (!canvas.tokens.get(t.id)) return;
        const isObject = t.actor.type === 'object';
        const preAlpha = origState.find(s => s.token.id === t.id)?.alpha ?? 1;
        if (animDuration > 0 && !window._dsctFMActive) {
          await t.document.update({ 'texture.tint': '#ff0000' });
          const targetAlpha = isObject ? 0 : 0.5;
          await new Promise(resolve => {
            const start = performance.now();
            const tick = (now) => {
              if (!canvas.tokens.get(t.id)) { resolve(); return; }
              const progress = Math.min(1, (now - start) / animDuration);
              if (t.mesh) t.mesh.alpha = preAlpha + (targetAlpha - preAlpha) * progress;
              if (progress < 1) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
        }
        if (!canvas.tokens.get(t.id)) return;
        if (!isObject) {
          if (getSetting('deathMarkerEnabled')) {
            const markerSrc = getSetting('deathMarkerIcon') || 'icons/commodities/bones/skull-hollow-worn-blue.webp';
            const gs = canvas.grid.size;
            const tw = Math.max(1, t.document.width)  * gs;
            const th = Math.max(1, t.document.height) * gs;
            const [[markerTile]] = await Promise.all([
              canvas.scene.createEmbeddedDocuments('Tile', [{
                x: t.document.x + tw / 2, y: t.document.y + th / 2,
                width: tw / 2, height: th / 2,
                texture: { src: markerSrc },
                overhead: false, locked: true, hidden: false,
                restrictions: { light: false, weather: false },
                video: { loop: false, autoplay: false, volume: 0 },
                flags: { [M]: { deathMarkerFor: t.id } },
              }]),
              t.document.update({ 'texture.tint': '#ff0000', alpha: 0.5 }),
            ]);
            if (markerTile) await t.document.setFlag(M, 'deathMarkerTileId', markerTile.id);
          } else {
            await t.document.update({ 'texture.tint': '#ff0000', alpha: 0.5 });
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
        batchEntries.push({ name: t.actor.name, tokenId: t.id, isObject });
      }));

      const s4 = mkSection(4, 'Visual Treatment Complete',
        batchEntries.map(e => `&#x2713; ${e.name} &mdash; death visuals applied`), null, { done: true });
      await msg.update({ content: buildContent(s4) });

      if (batchEntries.length) flushDeathBatch(batchEntries);
      
      for (const { tokenId, isObject: obj } of batchEntries) {
        if (!obj) continue;
        const tok = canvas.tokens.get(tokenId);
        if (tok) {
          await tok.document.update({ hidden: true, alpha: 1, 'texture.tint': '#ffffff' });
          await tok.document.setFlag(M, 'isDefeatedObject', true);
        }
      }
      for (const t of tokens) {
        if (t.actor?.system?.isMinion) t.actor.updateSource({ 'system.stamina.value': 0 });
      }
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
    if (getSetting('autoSquadLabelsEnabled') && game.combat) await applySquadLabels();
  }, 600);
};

const _doReviveV3 = async ({ tokenIds, skipGroupHpRestore = false }) => {
  const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const tokens = [...tokenIds]
    .map(id => canvas.tokens.get(id))
    .filter(t => t?.actor?.statuses?.has(defeatedStatusId));
  if (!tokens.length) return;

  window._dsctReviveActive = true;

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

  
  for (const t of tokens) {
    if (!canvas.tokens.get(t.id)) continue;
    _tm(`step 2: toggleStatusEffect dead OFF -- ${t.actor.name}`);
    await safeToggleStatusEffect(t.actor, defeatedStatusId, { overlay: true, active: false });
    _tm(`step 2: done -- ${t.actor.name}`);
    if ((t.actor.system.stamina?.value ?? 0) <= 0) {
      _tm(`step 2: stamina restore -- ${t.actor.name}`);
      const _staminaRestoreVal = t.actor.system?.isMinion ? (t.actor.system.stamina?.max ?? 1) : 1;
      await safeUpdate(t.actor, { 'system.stamina.value': _staminaRestoreVal });
      t.actor.updateSource({ 'system.stamina.value': _staminaRestoreVal });
      _tm(`step 2: stamina done -- ${t.actor.name}`);
    }
  }
  _tm('step 2 complete; waiting 300ms');
  await new Promise(r => setTimeout(r, 300));
  _tm('300ms pause done');

  
  
  const _reviveTargets = new Map();
  for (const t of tokens) {
    if (!canvas.tokens.get(t.id)) continue;
    const savedGroupId     = t.document.getFlag(M, 'savedGroupId');
    const savedDisplayBars = t.document.getFlag(M, 'savedDisplayBars');
    const isMinion         = t.actor.system?.isMinion ?? false;
    const minionMaxHP      = isMinion ? (t.actor.system.stamina?.max ?? 0) : 0;
    const _flagTint = t.document.getFlag(M, 'preDeathTint');
    
    const preTint = _flagTint == null ? '#ffffff'
      : typeof _flagTint === 'string' ? _flagTint
      : typeof _flagTint === 'number' ? `#${(_flagTint >>> 0).toString(16).padStart(6, '0')}`
      : '#ffffff';
    const preAlpha = t.document.getFlag(M, 'preDeathAlpha') ?? 1;
    if (_dbgTime) console.log(`DSCT | DT | [TO-DBG2] revival preTint=${JSON.stringify(preTint)} (raw flag=${JSON.stringify(_flagTint)}, type=${typeof _flagTint}), preAlpha=${preAlpha}`);
    _reviveTargets.set(t.id, { preTint, preAlpha });
    
    
    
    
    
    const tokenUpdate3a = {
      flags: { [M]: {
        savedGroupId:     foundry.data.operators.ForcedDeletion,
        savedDisplayBars: foundry.data.operators.ForcedDeletion,
        preDeathTint:     foundry.data.operators.ForcedDeletion,
        preDeathAlpha:    foundry.data.operators.ForcedDeletion,
      } },
    };
    if (savedDisplayBars !== undefined) tokenUpdate3a.displayBars = savedDisplayBars;
    _tm(`step 3a: clear flags -- ${t.actor.name}`);
    await t.document.update(tokenUpdate3a);
    _tm(`step 3a: done -- ${t.actor.name}`);
    
    if (game.combat && !game.combat.combatants.find(c => c.tokenId === t.id)) {
      const combatantData = { tokenId: t.id, sceneId: canvas.scene.id, actorId: t.document.actorId };
      if (savedGroupId) combatantData.group = savedGroupId;
      _tm(`step 3b: createCombatant -- ${t.actor.name}`);
      await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
      _tm(`step 3b: combatant done -- ${t.actor.name}`);
      if (!skipGroupHpRestore && savedGroupId && isMinion && minionMaxHP > 0) {
        const group = game.combat.groups.get(savedGroupId);
        if (group) {
          _tm(`step 3b: group HP restore (+${minionMaxHP}) -- ${t.actor.name}`);
          await group.update({ 'system.staminaValue': (group.system.staminaValue ?? 0) + minionMaxHP });
          _tm(`step 3b: group HP done -- ${t.actor.name}`);
        }
      }
    }
    
    
    
    
    
    _tm(`step 3c: restore tint/alpha -- ${t.actor.name}`);
    if (_dbgTime) console.log(`DSCT | DT | [TO-DBG2] pre-tint-update: doc tint=${t.document.texture?.tint}, alpha=${t.document.alpha}, mesh alpha=${t.mesh?.alpha}`);
    await t.document.update({ 'texture.tint': preTint, alpha: preAlpha });
    if (_dbgTime) {
      const ad = t._getAnimationData?.();
      console.log(`DSCT | DT | [TO-DBG2] post-tint-update: doc tint=${t.document.texture?.tint}, alpha=${t.document.alpha}, animData alpha=${ad?.alpha}, animData tint=${ad?.texture?.tint ?? ad?.tint}`);
    }
    t.animate?.({ alpha: preAlpha, texture: { tint: preTint } }, { duration: 0 });
  }
  await new Promise(r => setTimeout(r, 100));
  for (const t of tokens) {
    if (!canvas.tokens.get(t.id)) continue;
    const { preTint, preAlpha } = _reviveTargets.get(t.id) ?? { preTint: '#ffffff', preAlpha: 1 };
    t.animate?.({ alpha: preAlpha, texture: { tint: preTint } }, { duration: 0 });
    if (_dbgTime) {
      const _tId = t.id; const _tName = t.actor.name;
      [200, 800].forEach(ms => setTimeout(() => {
        const tok = canvas.tokens.get(_tId);
        if (tok) console.log(`DSCT | DT | [TO-DBG2] +${ms}ms "${_tName}": mesh alpha=${tok.mesh?.alpha?.toFixed(3)}, tint=${tok.mesh?.tint}, doc alpha=${tok.document.alpha}, doc tint=${tok.document.texture?.tint}`);
      }, ms));
    }
  }
  _tm('step 3 complete');

  
  for (const t of tokens) {
    if (!canvas.tokens.get(t.id)) continue;
    const markerTileId = t.document.getFlag(M, 'deathMarkerTileId');
    if (markerTileId) {
      const tile = canvas.scene.tiles.get(markerTileId);
      if (tile) { _tm('step 4: delete skull tile'); await tile.delete().catch(() => {}); _tm('step 4: skull tile done'); }
      await t.document.unsetFlag(M, 'deathMarkerTileId');
    }
    if (getSetting('clearEffectsOnRevive')) {
      const validEffectIds = t.actor.effects
        .filter(e => !e.id.endsWith('0000000000'))
        .map(e => e.id);
      if (validEffectIds.length) {
        _tm(`step 4: deleteEmbeddedDocuments ActiveEffect x${validEffectIds.length} -- ${t.actor.name}`);
        try { await t.actor.deleteEmbeddedDocuments('ActiveEffect', validEffectIds); }
        catch (e) { console.warn('DSCT | DT | Minor error clearing effects on revive:', e); }
        _tm(`step 4: effects done -- ${t.actor.name}`);
      }
    }
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
    tint:  t.document.texture.tint ?? '#ff0000',
    alpha: t.document.alpha       ?? 0.5,
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
            ? t.document.update({ 'texture.tint': snap?.tint ?? '#ff0000', alpha: snap?.alpha ?? 0.5 })
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
            await safeUpdate(t.actor, { 'system.stamina.value': _staminaRestoreVal });
            t.actor.updateSource({ 'system.stamina.value': _staminaRestoreVal });
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
          const savedDisplayBars = t.document.getFlag(M, 'savedDisplayBars');
          const isMinion        = t.actor.system?.isMinion ?? false;
          const minionMaxHP     = isMinion ? (t.actor.system.stamina?.max ?? 0) : 0;

          const flagClear = { flags: { [M]: {
            savedGroupId:    foundry.data.operators.ForcedDeletion,
            savedDisplayBars: foundry.data.operators.ForcedDeletion,
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
          step3Data.push({ t, newCombatantId, savedGroupId, savedDisplayBars, isMinion, minionMaxHP });
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
        for (const { t, newCombatantId, savedGroupId, savedDisplayBars, isMinion, minionMaxHP } of step3Data) {
          if (!canvas.tokens.get(t.id)) continue;
          if (newCombatantId) {
            const comb = game.combat?.combatants.get(newCombatantId);
            if (comb) await safeDelete(comb);
          }
          if (savedGroupId && isMinion && minionMaxHP > 0) {
            const group = game.combat?.groups.get(savedGroupId);
            if (group) await group.update({ 'system.staminaValue': Math.max(0, (group.system.staminaValue ?? 0) - minionMaxHP) });
          }
          const flagRestore = {};
          if (savedGroupId) flagRestore.savedGroupId = savedGroupId;
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
      const _dbgManual = getSetting('debugMode');
      const _s4Targets = new Map();
      for (const t of tokens) {
        if (!canvas.tokens.get(t.id)) continue;
        const _s4FlagTint = t.document.getFlag(M, 'preDeathTint');
        const preTint = _s4FlagTint == null ? '#ffffff'
          : typeof _s4FlagTint === 'string' ? _s4FlagTint
          : typeof _s4FlagTint === 'number' ? `#${(_s4FlagTint >>> 0).toString(16).padStart(6, '0')}`
          : '#ffffff';
        const preAlpha = t.document.getFlag(M, 'preDeathAlpha') ?? 1;
        _s4Targets.set(t.id, { preTint, preAlpha });
        
        await t.document.update({
          flags: { [M]: {
            preDeathTint:  foundry.data.operators.ForcedDeletion,
            preDeathAlpha: foundry.data.operators.ForcedDeletion,
          } },
        });
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
        if (_dbgManual) console.log(`DSCT | DT | [TO-DBG2] manual step4 pre-tint-update: doc tint=${t.document.texture?.tint}, alpha=${t.document.alpha}, mesh alpha=${t.mesh?.alpha}`);
        await t.document.update({ 'texture.tint': preTint, alpha: preAlpha });
        if (_dbgManual) {
          const ad = t._getAnimationData?.();
          console.log(`DSCT | DT | [TO-DBG2] manual step4 post-tint-update: doc tint=${t.document.texture?.tint}, alpha=${t.document.alpha}, animData alpha=${ad?.alpha}`);
        }
        t.animate?.({ alpha: preAlpha, texture: { tint: preTint } }, { duration: 0 });
        s4Lines.push(`&#x2713; ${t.actor.name} &mdash; revival complete`);
      }
      await new Promise(r => setTimeout(r, 100));
      for (const t of tokens) {
        if (!canvas.tokens.get(t.id)) continue;
        const { preTint, preAlpha } = _s4Targets.get(t.id) ?? { preTint: '#ffffff', preAlpha: 1 };
        t.animate?.({ alpha: preAlpha, texture: { tint: preTint } }, { duration: 0 });
        if (_dbgManual) {
          const _tId = t.id; const _tName = t.actor.name;
          [200, 800].forEach(ms => setTimeout(() => {
            const tok = canvas.tokens.get(_tId);
            if (tok) console.log(`DSCT | DT | [TO-DBG2] manual +${ms}ms "${_tName}": mesh alpha=${tok.mesh?.alpha?.toFixed(3)}, tint=${tok.mesh?.tint}`);
          }, ms));
        }
      }
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
  const xContainer = new PIXI.Container();
  canvas.controls.addChild(xContainer);

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
        sprite.x = t.x; sprite.y = t.y; sprite.alpha = isLocked ? 0.85 : 0.5;
        xContainer.addChild(sprite);
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
  };

  let notif = null;
  const refreshNotif = () => {
    if (notif !== null) ui.notifications.remove(notif);
    const summary = squads.map(s => `${s.groupName}: ${s.selected.size}/${s.numToKill}`).join(', ');
    notif = ui.notifications.info(
      game.i18n.format('DSCT.notice.dt.pickDeathsInstruction', { summary }),
      { permanent: true },
    );
  };
  refreshNotif();

  let _staleCheckTimer = null;
  const finish = () => {
    clearTimeout(_staleCheckTimer);
    ui.notifications.remove(notif);
    if (canvas.interface.grid.highlightLayers?.[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
    xContainer.parent?.removeChild(xContainer);
    xContainer.destroy({ children: true });
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
        ui.notifications.warn(game.i18n.format('DSCT.notice.dt.pickerMustDie', { name: t.actor?.name ?? 'That token' }));
        return;
      }
      if (squad.selected.has(t.id)) {
        squad.selected.delete(t.id);
      } else {
        if (squad.selected.size >= squad.numToKill) {
          ui.notifications.warn(game.i18n.format('DSCT.notice.dt.pickerAtLimit', { group: squad.groupName, count: squad.numToKill }));
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
      const wrong = squads.filter(s => s.selected.size !== s.numToKill);
      if (wrong.length) {
        ui.notifications.warn(game.i18n.format('DSCT.notice.dt.pickerWrongCount', { summary: wrong.map(s => `${s.groupName}: ${s.selected.size}/${s.numToKill}`).join(', ') }));
        return;
      }
      finish();
      const result = new Set();
      for (const squad of squads) for (const id of squad.selected) result.add(id);
      resolve(result);
      return;
    }
    _lastEmptyClickTime = now;
  };

  const onKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const wrong = squads.filter(s => s.selected.size !== s.numToKill);
      if (wrong.length) {
        ui.notifications.warn(game.i18n.format('DSCT.notice.dt.pickerWrongCount', { summary: wrong.map(s => `${s.groupName}: ${s.selected.size}/${s.numToKill}`).join(', ') }));
        return;
      }
      finish();
      const result = new Set();
      for (const squad of squads) for (const id of squad.selected) result.add(id);
      resolve(result);
    } else if (event.key === 'Escape') {
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
    ui.notifications.error(game.i18n.localize('DSCT.notice.dt.pickerTokensAlreadyDead'));
    finish();
    resolve(null);
  }, 3000);
});


const _MANUAL_KILL_ACCUM_MS = 100;

const _flushManualKillAccumulator = async () => {
  
  
  if (window._dsctPendingSquadTimers?.size > 0) {
    const acc = window._dsctManualKillAccumulator;
    if (acc) { clearTimeout(acc.timer); acc.timer = setTimeout(_flushManualKillAccumulator, _MANUAL_KILL_ACCUM_MS); }
    return;
  }
  const a = window._dsctManualKillAccumulator;
  window._dsctManualKillAccumulator = null;
  if (!a) return;
  const finalTokenIds = new Set(a.tokenIds);
  if (getSetting('deathTrackerManualMode')) {
    
    if (a.pickerContexts.length > 0) {
      const contexts = a.pickerContexts.map((ctx, i) => ({ ...ctx, color: _SQUAD_COLORS[i % _SQUAD_COLORS.length] }));
      
      const storedUserId  = window._lastSquadDamageUserId;
      const storedUser    = storedUserId ? game.users.get(storedUserId) : null;
      const pickerUserId  = (storedUser && !storedUser.isGM && storedUser.active)
        ? storedUserId
        : resolveBreakpointUser();
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
      if (!picked) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dt.pickDeathsCancelled')); return; }
      for (const id of picked) finalTokenIds.add(id);
    }
    if (!finalTokenIds.size) return;
    const _ver = game.modules.get(M)?.version ?? '?';
    await _doKillManual({
      tokenIds: finalTokenIds, squadGroup: null, processQueue: () => {},
      step1Extra: a.extraLines.join(''), label: `DT Debug v${_ver}`, skipHpCorrection: true,
    });
  } else {
    
    if (getSetting('pickDeathsEnabled') && a.pickerContexts.length > 0) {
      const contexts     = a.pickerContexts.map((ctx, i) => ({ ...ctx, color: _SQUAD_COLORS[i % _SQUAD_COLORS.length] }));
      const storedUserId = window._lastSquadDamageUserId;
      const storedUser   = storedUserId ? game.users.get(storedUserId) : null;
      const pickerUserId = (storedUser && !storedUser.isGM && storedUser.active)
        ? storedUserId
        : resolveBreakpointUser();
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
        return;
      }
      for (const id of picked) finalTokenIds.add(id);
    } else {
      for (const ctx of a.pickerContexts) {
        for (const id of ctx.lockedIds)      finalTokenIds.add(id);
        for (const id of ctx.preSelectedIds) finalTokenIds.add(id);
      }
    }

    if (!finalTokenIds.size) return;
    await _doKillV3(finalTokenIds, { skipHpCorrection: true, showNotification: false });
  }
};


const _queueManualKillTargets = (tokenIds, extraLines) => {
  if (!window._dsctManualKillAccumulator) {
    window._dsctManualKillAccumulator = { tokenIds: new Set(), extraLines: [], pickerContexts: [] };
  }
  const acc = window._dsctManualKillAccumulator;
  for (const id of tokenIds) acc.tokenIds.add(id);
  acc.extraLines.push(...extraLines);
  if (acc.timer) clearTimeout(acc.timer);
  acc.timer = setTimeout(_flushManualKillAccumulator, _MANUAL_KILL_ACCUM_MS);
};


const _queueManualPickerContext = (ctx, extraLines) => {
  if (!window._dsctManualKillAccumulator) {
    window._dsctManualKillAccumulator = { tokenIds: new Set(), extraLines: [], pickerContexts: [] };
  }
  const acc = window._dsctManualKillAccumulator;
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

export function registerDeathTrackerHooks() {

  

  
  
  
  
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
    if (getSetting('overrideMinionDefeat') && ds?.applications?.apps?.DefeatedMinionSelection) {
      ds.applications.apps.DefeatedMinionSelection.create = async () => null;
    }
    cleanBaseNpcActors();
    if (getSetting('cleanOrphanedCombatants')) cleanOrphanedCombatants();

    
    Hooks.on('updateCombatantGroup', (group, changes, options, userId) => {
      if (!getSetting('debugMode')) return;
      const minions = group?.system?.minions;
      const minionEntries = [...(minions ?? [])].map(m => {
        const tok = m.token?.object;
        return `${m.name}(tokenId=${m.tokenId ?? m.token?.id ?? '?'}, hasObject=${!!tok})`;
      });
      console.log(`DSCT | DT | [TO-DBG1] updateCombatantGroup:`, {
        groupId: group.id,
        staminaMax: group.system?.staminaMax,
        staminaValue: group.system?.staminaValue,
        minionsSize: minions?.size,
        minions: minionEntries,
        changedKeys: Object.keys(changes),
      });
    });

    
    
    const _CombatantCls = CONFIG.Combatant?.documentClass;
    if (_CombatantCls) {
      const _origRefreshCombatant = _CombatantCls.prototype.refreshCombatant;
      _CombatantCls.prototype.refreshCombatant = function () {
        if (getSetting('debugMode') && this.actor?.system?.combatGroups?.size === 1) {
          const tok = this.token?.object;
          const animData = tok?._getAnimationData?.();
          console.log(`DSCT | DT | [TO-DBG2] refreshCombatant on "${this.actor?.name}":`, {
            animAlpha: animData?.alpha ?? '?',
            animTint: animData?.texture?.tint ?? animData?.tint ?? '?',
            docAlpha: this.token?.alpha ?? '?',
            docTint: this.token?.texture?.tint ?? '?',
            meshAlpha: tok?.mesh?.alpha ?? '?',
            stack: new Error().stack.split('\n').slice(2, 4).join(' | '),
          });
        }
        _origRefreshCombatant.call(this);
      };
    }
  });

  Hooks.on('combatRound', () => { cleanBaseNpcActors(); });

  Hooks.on('createActiveEffect', async (effect) => {
    if (!getSetting('deathTrackerEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;

    const statuses = [...(effect.statuses ?? [])];

    
    if (statuses.includes('dying') && !statuses.includes('dead')) {
      const actor = effect.parent;
      if (actor && actor.type !== 'hero' && actor.type !== 'retainer') {
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
    if (!actor || actor.type === 'hero' || actor.type === 'retainer') return;

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

  Hooks.on('updateCombatantGroup', async (group, changes, options) => {
    
    
    if (getSetting('squadStaminaClamp') && group.type === 'squad' && game.users.activeGM?.isSelf) {
      const newVal = changes.system?.staminaValue;
      if (newVal !== undefined) {
        const alive = Array.from(group.members ?? []).filter(m => m?.actor?.system?.isMinion && !m.defeated);
        const indivHP = alive.length > 0 ? (alive[0].actor?.system?.stamina?.max ?? 1) : 1;
        const maxHP = alive.length * indivHP;
        if (getSetting('debugMode')) console.log(`DSCT | DT | overclamp guard | newVal=${newVal} maxHP=${maxHP} alive=${alive.length} indivHP=${indivHP} correcting=${newVal > maxHP}`);
        if (newVal > maxHP) {
          group.update({ 'system.staminaValue': maxHP });
          return;
        }
      }
    }

    const dbg = getSetting('debugMode');
    if (dbg) console.log('DSCT | DT | updateCombatantGroup fired', { groupType: group.type, isGM: game.users.activeGM?.isSelf, enabled: getSetting('deathTrackerEnabled'), override: getSetting('overrideMinionDefeat'), changes });
    if (!getSetting('deathTrackerEnabled') || !getSetting('overrideMinionDefeat') || !game.users.activeGM?.isSelf) return;

    
    
    
    const dstdOpts = options?.dstd;
    if (dstdOpts?.source === 'draw-steel-target-damage') {
      const ids = dstdOpts.minionDeathTargetIds?.length ? dstdOpts.minionDeathTargetIds
        : dstdOpts.primaryTargetId ? [dstdOpts.primaryTargetId] : [];
      for (const id of ids) if (id) _addDamagedToken(id);
      if (dbg) console.log(`DSCT | DT | DSTD damage detected, seeded damaged tokens: [${ids.join(',')}]`);
    }

    if (window._dsctKillLockActive) {
      if (dbg) console.log('DSCT | DT | updateCombatantGroup: kill lock active, skipping processDeath');
      return;
    }

    const newHp = changes.system?.staminaValue ?? changes.system?.stamina?.value;
    if (dbg) console.log('DSCT | DT | newHp', newHp, 'group.type', group.type);
    if (newHp === undefined) return;
    if (group.type !== 'squad') return;

    if (!window._squadDeathLocks) window._squadDeathLocks = new Set();
    if (window._squadDeathLocks.has(group.id)) { if (dbg) console.log('DSCT | DT | squad lock held, skipping'); return; }
    window._squadDeathLocks.add(group.id);

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

      if (dbg) console.log(`DSCT | DT | processDeath: origNumToKill=${numToKill} effectiveNumToKill=${effectiveNumToKill} freshHp=${freshHp} damagedTokenIds=[${damagedTokenIds.join(',')}]`);

      if (!getSetting('autoAssignDamagedMinion')) {
        
        if (freshHp <= 0) _queueManualKillTargets(new Set(liveMinions.map(m => m.tokenId).filter(Boolean)), []);
        return;
      }

      const eligibleDamaged = damagedTokenIds.filter(id => liveMinions.find(m => m.tokenId === id));
      const damagedNames = damagedTokenIds.map(id => canvas.tokens.get(id)?.actor?.name ?? id);
      const groupName = group.name ?? 'Squad';
      const extraLines = [
        `<p><em><strong>[${groupName}]</strong> Damage-caused: ${effectiveNumToKill} of ${liveMinions.length} minions must die.</em></p>`,
        `<p><em>Damaged tokens tracked: ${damagedNames.length ? damagedNames.join(', ') : '<strong>none identified</strong>'}</em></p>`,
      ];
      if (freshHp <= 0) {
        _queueManualKillTargets(new Set(liveMinions.map(m => m.tokenId).filter(Boolean)), extraLines);
        return;
      }
      if (eligibleDamaged.length === effectiveNumToKill) {
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

      if (eligibleDamaged.length > effectiveNumToKill) {
        
        const sorted = _sortCandidates(eligibleDamaged, new Set());
        _queueManualPickerContext({
          lockedIds:      new Set(),
          preSelectedIds: new Set(sorted.slice(0, effectiveNumToKill)),
          poolTokenIds:   new Set(eligibleDamaged),
          numToKill:      effectiveNumToKill,
          groupName,
        }, extraLines);
        return;
      }
      
      const undamaged = liveMinions
        .filter(m => m.tokenId && !eligibleDamaged.includes(m.tokenId))
        .map(m => m.tokenId);
      const sortedUndamaged = _sortCandidates(undamaged, new Set(eligibleDamaged));
      _queueManualPickerContext({
        lockedIds:      new Set(eligibleDamaged),
        preSelectedIds: new Set(sortedUndamaged.slice(0, effectiveNumToKill - eligibleDamaged.length)),
        poolTokenIds:   new Set(liveMinions.map(m => m.tokenId).filter(Boolean)),
        numToKill:      effectiveNumToKill,
        groupName,
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
      }, 500));
    }
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
    for (const token of canvas.tokens.placeables) {
      if (!token.actor?.system?.isMinion) continue;
      if (!token.actor.statuses?.has(defeatedStatusId)) continue;
      if ((token.actor.system.stamina?.value ?? 0) > 0) {
        token.actor.updateSource({ 'system.stamina.value': 0 });
      }
    }
  });

  Hooks.on('deleteToken', async (tokenDoc) => {
    if (!game.users.activeGM?.isSelf) return;
    const dbg = getSetting('debugMode');
    if (dbg) console.log(`DSCT | deleteToken | fired for token id=${tokenDoc.id} name=${tokenDoc.name}`);
    if (getSetting('cleanOrphanedCombatants')) {
      for (const combat of game.combats.contents) {
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
    }
  });

  Hooks.on('deleteCombat', async () => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('clearSkullsOnCombatEnd') || !game.users.activeGM?.isSelf) return;

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
  });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!game.user.isGM) return;
    if (!msg.getFlag(M, 'isDeathMessage')) return;

    
    const deadTokenIds = msg.getFlag(M, 'deadTokenIds') ??
      (msg.getFlag(M, 'deadTokenId') ? [msg.getFlag(M, 'deadTokenId')] : null);
    if (!deadTokenIds?.length) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-undo-death';
    btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize('DSCT.button.undo')}`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (getSetting('deathTrackerManualMode')) {
        await _doReviveManual({ tokenIds: new Set(deadTokenIds) });
      } else {
        await _doReviveV3({ tokenIds: new Set(deadTokenIds) });
      }
    });

    const hlName = 'dsct-hover-preview-hl';
    btn.addEventListener('mouseenter', () => {
      for (const id of deadTokenIds) addPreviewToken(id);
      activateTokenLayer();
      if (!canvas.interface.grid.highlightLayers?.[hlName]) canvas.interface.grid.addHighlightLayer(hlName);
      canvas.interface.grid.clearHighlightLayer(hlName);
      for (const id of deadTokenIds) {
        const t = canvas.tokens.get(id);
        if (!t) continue;
        const w = Math.max(1, Math.round(t.document.width));
        const h = Math.max(1, Math.round(t.document.height));
        for (let dx = 0; dx < w; dx++) {
          for (let dy = 0; dy < h; dy++) {
            canvas.interface.grid.highlightPosition(hlName, {
              x: Math.floor(t.x / canvas.grid.size) * canvas.grid.size + (dx * canvas.grid.size),
              y: Math.floor(t.y / canvas.grid.size) * canvas.grid.size + (dy * canvas.grid.size),
              color: 0x00FF00, border: 0x00AA00,
            });
          }
        }
      }
    });
    btn.addEventListener('mouseleave', () => {
      for (const id of deadTokenIds) removePreviewToken(id);
      activateTokenLayer();
      if (canvas.interface.grid.highlightLayers?.[hlName]) canvas.interface.grid.clearHighlightLayer(hlName);
    });

    let btnArea = el.querySelector('.message-part-buttons');
    if (!btnArea) {
      btnArea = document.createElement('div');
      btnArea.className = 'message-part-buttons';
      (el.querySelector('.message-content') ?? el).appendChild(btnArea);
    }
    btnArea.appendChild(btn);
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
    a.type !== 'hero' && a.type !== 'retainer' &&
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

const flushDeathBatch = async (batch) => {
  if (!batch.length) return;
  if (batch.length === 1) {
    const { name, tokenId, isObject } = batch[0];
    await ChatMessage.create({
      content: game.i18n.format(isObject ? 'DSCT.chat.dt.destroyed' : 'DSCT.chat.dt.fallen', { name }),
      flags: { [M]: { isDeathMessage: true, deadTokenIds: [tokenId] } },
    });
  } else {
    const creatures = batch.filter(b => !b.isObject);
    const objects   = batch.filter(b => b.isObject);
    const lines = [];
    if (creatures.length) lines.push(game.i18n.format('DSCT.chat.dt.fallenMultiple', { names: formatNames(creatures.map(b => b.name)) }));
    if (objects.length)   lines.push(game.i18n.format('DSCT.chat.dt.destroyedMultiple', { names: formatNames(objects.map(b => b.name)) }));
    await ChatMessage.create({
      content: lines.join('<br>'),
      flags: { [M]: { isDeathMessage: true, deadTokenIds: batch.map(b => b.tokenId) } },
    });
  }
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
  for (const msg of toDelete) {
    if (msg.isOwner || game.user.isGM) await msg.delete().catch(() => {});
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
    }
  };

  drawHighlights();
  const rdNotif = ui.notifications.info(game.i18n.localize('DSCT.notice.dt.raiseDeadInstruction'), { permanent: true });
  window._dsctRaiseDeadNotif = rdNotif;

  const finish = () => {
    window._raiseDeadActive = false;
    setRaisedDeadVisible(false);
    activateTokenLayer();
    ui.notifications.remove(rdNotif);
    window._dsctRaiseDeadNotif = null;
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
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doRevive();
    } else if (event.key === 'Escape') {
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

  const preTint = tokenDoc.getFlag('draw-steel-combat-tools', 'preDeathTint') ?? '#ffffff';
  const preAlpha = tokenDoc.getFlag('draw-steel-combat-tools', 'preDeathAlpha') ?? 1;
  const savedDisplayBars = tokenDoc.getFlag('draw-steel-combat-tools', 'savedDisplayBars');
  const restoreUpdate = {
    'texture.tint': preTint, alpha: preAlpha,
    flags: { [M]: {
      preDeathTint: foundry.data.operators.ForcedDeletion,
      preDeathAlpha: foundry.data.operators.ForcedDeletion,
      savedDisplayBars: foundry.data.operators.ForcedDeletion,
    } },
  };
  if (savedDisplayBars !== undefined) restoreUpdate.displayBars = savedDisplayBars;
  await tokenDoc.update(restoreUpdate);

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
  const layers = ['dsct-hover-preview-hl', 'dsct-raise-dead-hl', 'dsct-pwk-hl', 'dsct-fm-undo-hl'];
  for (const name of layers) {
    if (canvas.interface.grid.highlightLayers?.[name]) canvas.interface.grid.clearHighlightLayer(name);
  }

  if (window._dsctPwkXContainer) {
    window._dsctPwkXContainer.parent?.removeChild(window._dsctPwkXContainer);
    window._dsctPwkXContainer.destroy({ children: true });
    window._dsctPwkXContainer = null;
  }

  if (window._dsctPwkNotif) { ui.notifications.remove(window._dsctPwkNotif); window._dsctPwkNotif = null; }
  if (window._dsctRaiseDeadNotif) { ui.notifications.remove(window._dsctRaiseDeadNotif); window._dsctRaiseDeadNotif = null; }

  window._pwkActive = false;
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
    : canvas.tokens.placeables.filter(t => t.actor && t.actor.type !== 'hero' && t.actor.type !== 'retainer' && !t.document.hidden && !t.actor.statuses?.has('dead') && (t.actor.system?.stamina?.value > 0));

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

  let _pwkT = 0;
  const _pwkTicker = () => {
    _pwkT += canvas.app.ticker.elapsedMS;
    const _pwkDur = 2000, _pwkPause = _pwkDur * 0.6;
    const _pwkCycle = _pwkT % _pwkDur;
    const _pwkAlpha = _pwkCycle < _pwkPause
      ? 0.4
      : 0.4 + 0.15 * Math.sin(((_pwkCycle - _pwkPause) / (_pwkDur - _pwkPause)) * Math.PI);
    xContainer.alpha = _pwkAlpha;
    hoverContainer.alpha = _pwkAlpha * 0.45;
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
    const hoveredToken = npcs.find(t => t.id === hoveredNpcId);
    drawHoverX(hoveredToken && !selectedTokens.has(hoveredToken.id) ? hoveredToken : null);
  };

  drawHighlights();
  const pwkNotif = ui.notifications.info(game.i18n.localize('DSCT.notice.dt.pwkInstruction'), { permanent: true });
  window._dsctPwkNotif = pwkNotif;

  const finish = () => {
    window._pwkActive = false;
    ui.notifications.remove(pwkNotif);
    window._dsctPwkNotif = null;
    canvas.app.ticker.remove(_pwkTicker);
    canvas.interface.grid.destroyHighlightLayer(hlName);
    xContainer.parent?.removeChild(xContainer);
    xContainer.destroy({ children: true });
    window._dsctPwkXContainer = null;
    hoverContainer.parent?.removeChild(hoverContainer);
    hoverContainer.destroy({ children: true });
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

  const onClick = (event) => {
    if (event.data.originalEvent.button === 2) {
      if (getSetting('cancelOnRightClick')) {
        finish();
        ui.notifications.info(game.i18n.localize('DSCT.notice.dt.pwkCancelled'));
        processQueue();
      }
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
            if (!onClick._warnCooldown) {
                ui.notifications.warn(game.i18n.format('DSCT.notice.dt.pwkCannotDeselect', { name: clicked[0].name }));
                onClick._warnCooldown = setTimeout(() => { delete onClick._warnCooldown; }, 3000);
            }
            return;
        }
        selectedTokens.delete(targetId);
    } else {
        if (selectedTokens.size >= maxTargets) {
            if (!onClick._warnCooldown) {
                ui.notifications.warn(game.i18n.format('DSCT.notice.dt.pwkSelectExactly', { max: maxTargets, s: maxTargets !== 1 ? 's' : '' }));
                onClick._warnCooldown = setTimeout(() => { delete onClick._warnCooldown; }, 3000);
            }
            return;
        }
        selectedTokens.add(targetId);
    }

    drawHighlights();
    if (getSetting('autoConfirmSelection') && selectedTokens.size >= maxTargets) doKill();
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doKill();
    } else if (event.key === 'Escape') {
      finish();
      ui.notifications.info(game.i18n.localize('DSCT.notice.dt.selectionCancelled'));
      processQueue();
    }
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    if (getSetting('cancelOnRightClick')) {
      finish();
      ui.notifications.info(game.i18n.localize('DSCT.notice.dt.pwkCancelled'));
      processQueue();
    }
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

