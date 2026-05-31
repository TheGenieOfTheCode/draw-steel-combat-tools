import { runForcedMovement, toggleForcedMovementPanel, registerForcedMovementHooks } from './forced-movement/forced-movement.mjs';
import { WallBuilderPanel, convertWalls, mergeSelectedWalls } from './forced-movement/wall-builder.mjs';
import { registerChatHooks, refreshChatInjections } from './chat-integration.mjs';
import { runGrab, toggleGrabPanel, endGrab, registerGrabHooks, registerKnockbackGuard } from './conditions/grab.mjs';
import { applyFall, getSetting, initPalette, parsePowerRollState, applyRollMod, getWindowById, monsterFilter } from './helpers.mjs';
import { applyJudgement, applyMark, applyAidAttack, registerTacticalHooks } from './ability-automation/tactical-effects.mjs';
import { registerDeathTrackerHooks, runRaiseDeadUI, reviveAll, runPowerWordKillUI, cleanupPixi, _runManualModePicker, _SQUAD_COLORS, _addDamagedToken } from './death-tracker/death-tracker.mjs';
import { applySquadLabels, autoRenameGroups, registerSquadLabelHooks } from './squad-labels.mjs';
import { registerSquadHudHooks, getStickBugged } from './squad-hud.mjs';
import { registerSquadTurnHooks } from './squad-turns.mjs';
import { applyTriggeredActions, registerTriggeredActionHooks } from './triggered-actions.mjs';
import { registerModuleButtons } from './module-buttons.mjs';
import { installMacros, distributeAbilities } from './setup-macros.mjs';
import { toggleTeleportPanel, registerTeleportHooks, runTeleport, runBurstTeleport } from './teleport.mjs';
import { toggleDamageConditionsPanel } from './conditions/damage-conditions.mjs';
import { applyFrightened, applyTaunted, registerConditionHooks } from './conditions/conditions.mjs';
import { openImNoThreatPanel } from './ability-automation/ability-automation.mjs';
import { openTransformPicker, runTransform } from './ability-automation/transformation.mjs';
import { triggerAbyssalEvolution, registerMaliceInjectors } from './ability-automation/malice-features.mjs';
import { registerCrossfadeHooks } from './ability-automation/crossfade.mjs';
import { executeHIWTurn, registerHIWHooks } from './ability-automation/hesitation.mjs';
import { registerDefeatedTokenVisibility } from './death-tracker/defeated-token-visibility.mjs';
import { registerSettings, registerCompatibilityChecks } from './settings/register-settings.mjs';
import { registerSystemPatches } from './system-patches.mjs';
import { registerRollDialogPillHooks, setBaneDialogLockWithOverlay, injectJudgementBanePill } from './ability-automation/roll-dialog-hooks.mjs';
import { registerDstdCompat, runDstdUndoRevival } from './compat/dstd-compat.mjs';
import { registerHealthEstimateCompat } from './compat/health-estimate-compat.mjs';
import { registerCombatLogHooks } from './combat-logs.mjs';

const api = {
  forcedMovement:   runForcedMovement,
  grab:             runGrab,
  wallBuilder: () => { const existing = getWindowById('wall-builder-panel'); if (existing) existing.close(); else new WallBuilderPanel().render(true); },
  convertWalls: convertWalls,
  mergeWalls:   mergeSelectedWalls,
  grabPanel:        toggleGrabPanel,
  endGrab:          endGrab,
  revive:           runRaiseDeadUI,
  raiseDead:        runRaiseDeadUI,
  reviveAll:        reviveAll,
  powerWordKill:    runPowerWordKillUI,
  judgement:        applyJudgement,
  mark:             applyMark,
  aidAttack:        applyAidAttack,
  forcedMovementUI: toggleForcedMovementPanel,
  squadLabels:      applySquadLabels,
  renameSquads:     autoRenameGroups,
  triggeredActions: applyTriggeredActions,
  teleport:         runTeleport,
  burstTeleport:    runBurstTeleport,
  teleportUI:       toggleTeleportPanel,
  installMacros:        installMacros,
  distributeAbilities:  distributeAbilities,
  fall:                 applyFall,
  parsePowerRollState:  parsePowerRollState,
  applyRollMod:         applyRollMod,
  applyFrightened:      applyFrightened,
  applyTaunted:         applyTaunted,
  disguisePanel:            openImNoThreatPanel,
  abyssalEvolution:         triggerAbyssalEvolution,
  transform:                runTransform,
  transformPicker:          openTransformPicker,
  monsterFilter,
  damageConditionsUI:   toggleDamageConditionsPanel,
  cleanupPixi:          cleanupPixi,
  setRollDialogLock:         setBaneDialogLockWithOverlay,
  getStickBugged:   getStickBugged,
  isFMActive:       () => !!window._dsctFMActive,
  socket:           null,
};

Hooks.once('init', () => {
  game.modules.get('draw-steel-combat-tools').api = api;

  initPalette();
  new MutationObserver(initPalette).observe(document.body, { attributeFilter: ['class'] });

  registerSettings();
  registerCompatibilityChecks();
  registerChatHooks();
  registerGrabHooks();
  registerKnockbackGuard();
  registerConditionHooks();
  registerTacticalHooks();
  registerDeathTrackerHooks();
  registerSquadLabelHooks();
  registerSquadHudHooks();
  registerSquadTurnHooks();
  registerTriggeredActionHooks();
  registerModuleButtons();
  registerForcedMovementHooks();
  registerTeleportHooks();
  registerCrossfadeHooks();
  registerHIWHooks();
  registerCombatLogHooks();
  registerSystemPatches();
  registerDefeatedTokenVisibility();
  registerRollDialogPillHooks();
  registerMaliceInjectors();
  registerDstdCompat();
  registerHealthEstimateCompat();
  console.log('DSCT | Initialized');

  game.keybindings.register('draw-steel-combat-tools', 'refreshChatInjections', {
    name: 'Refresh Chat Forced Movement Buttons', hint: 'Re-injects Execute buttons into any chat messages that have forced movement data.',
    editable: [{ key: 'KeyR', modifiers: ['Shift'] }],
    onDown: () => { refreshChatInjections(); return true; },
  });
});


Hooks.once('setup', () => {
  const CHAR_ROLLKEYS = { r: 'R', m: 'M', a: 'A', i: 'I', p: 'P', v: 'V' };

  const patchDsEnricher = (id) => {
    const idx = CONFIG.TextEditor.enrichers.findIndex(e => e.id === id);
    if (idx === -1) return;
    const cfg = CONFIG.TextEditor.enrichers[idx];
    const origEnricher = cfg.enricher;
    const origOnRender = cfg.onRender;

    CONFIG.TextEditor.enrichers[idx] = {
      ...cfg,
      enricher: async function(match, options) {
        const el = await origEnricher.call(this, match, options);
        if (!el || !match.groups?.label) return el;
        const rollData = options.rollData ?? options.relativeTo?.getRollData?.() ?? {};
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!/@[rmaiPv]/i.test(node.textContent)) continue;
          node.textContent = node.textContent.replace(/@([rmaiPv])/gi, (_, ch) => {
            const key = CHAR_ROLLKEYS[ch.toLowerCase()];
            return (key && rollData[key] != null) ? String(rollData[key]) : `@${ch}`;
          });
        }
        return el;
      },
      onRender: async function(element) {
        await origOnRender.call(this, element);
        let spent = null;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!/@spend/i.test(node.textContent)) continue;
          if (spent === null) {
            const msgEl = element.closest('[data-message-id]');
            const msg   = msgEl ? game.messages.get(msgEl.dataset.messageId) : null;
            const m     = msg?.flavor?.match(/^Spent (\d+)/i);
            spent = m ? parseInt(m[1]) : 0;
          }
          node.textContent = node.textContent
            .replace(/@spend/gi, String(spent))
            .replace(/(\d+)\s*\+\s*(\d+)/g, (_, a, b) => String(parseInt(a) + parseInt(b)));
        }
      },
    };
  };

  ['ds.roll', 'ds.apply'].forEach(patchDsEnricher);

  const lookupIdx = CONFIG.TextEditor.enrichers.findIndex(e => e.id === 'ds.lookup');
  if (lookupIdx !== -1) {
    const lCfg            = CONFIG.TextEditor.enrichers[lookupIdx];
    const origLookup      = lCfg.enricher;
    const origLookupRender = lCfg.onRender;
    CONFIG.TextEditor.enrichers[lookupIdx] = {
      ...lCfg,
      enricher: async function(match, options) {
        if (!/@spend/i.test(match.groups?.config ?? '')) return origLookup.call(this, match, options);
        const span = document.createElement('span');
        span.classList.add('lookup-value');
        span.dataset.spendLookup = 'true';
        span.innerText = match.groups?.label?.trim() ?? '0';
        return span;
      },
      onRender: async function(element) {
        await origLookupRender.call(this, element);
        const span = element.querySelector('[data-spend-lookup]');
        if (!span) return;
        const msgEl = element.closest('[data-message-id]');
        const msg   = msgEl ? game.messages.get(msgEl.dataset.messageId) : null;
        const m     = msg?.flavor?.match(/^Spent (\d+)/i);
        span.innerText = String(m ? parseInt(m[1]) : 0);
      },
    };
  }
});

Hooks.once('ready', () => {
  if (!game.user.isGM) {
    const M = 'draw-steel-combat-tools';
    game.user.setFlag(M, 'cedeDeathPickerToGM', game.settings.get(M, 'cedeDeathPickerToGM'));
  }
});

Hooks.once('ready', async () => {
  if (!game.user.isGM) return;

  const M              = 'draw-steel-combat-tools';
  const currentVersion = game.modules.get(M).version ?? '';
  const promptMode     = game.settings.get(M, 'macroPromptMode');
  const seenVersion    = game.settings.get(M, 'macroPromptSeenVersion') ?? '';
  const autoImport     = game.settings.get(M, 'macroAutoImport') ?? false;

  if (promptMode === 'never') { if (autoImport) await installMacros({ silent: true }); return; }

  if (promptMode === 'skip-update' && seenVersion === currentVersion) {
    if (autoImport) await installMacros({ silent: true });
    return;
  }

  const content = `
    ${game.i18n.localize('DSCT.dialog.sampleMacros.body')}
    <div class="form-group" style="margin-top:12px;">
      <label style="flex:0 0 auto;margin-right:8px;">${game.i18n.localize('DSCT.dialog.sampleMacros.rememberLabel')}</label>
      <select id="dsct-macro-prompt-pref" style="flex:1;">
        <option value="ask">${game.i18n.localize('DSCT.dialog.sampleMacros.optAsk')}</option>
        <option value="skip-update">${game.i18n.localize('DSCT.dialog.sampleMacros.optSkipUpdate')}</option>
        <option value="never">${game.i18n.localize('DSCT.dialog.sampleMacros.optNever')}</option>
      </select>
    </div>
  `;

  const getChoice = (html) => {
    const root = html instanceof HTMLElement ? html : (html[0] ?? null);
    return root?.querySelector('#dsct-macro-prompt-pref')?.value ?? 'ask';
  };

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('DSCT.dialog.sampleMacros.title') },
    content,
    buttons: [
      { action: "yes", label: game.i18n.localize('DSCT.dialog.sampleMacros.yes'), default: true, callback: (_e, _btn, dialog) => ({ doImport: true,  choice: getChoice(dialog.element) }) },
      { action: "no",  label: game.i18n.localize('DSCT.dialog.sampleMacros.no'),                 callback: (_e, _btn, dialog) => ({ doImport: false, choice: getChoice(dialog.element) }) },
    ],
    rejectClose: false,
  });

  if (!result) return;

  const { doImport, choice } = result;
  await game.settings.set(M, 'macroPromptMode', choice);
  await game.settings.set(M, 'macroAutoImport', doImport);
  if (choice === 'skip-update') await game.settings.set(M, 'macroPromptSeenVersion', currentVersion);
  if (doImport) await installMacros();
});



Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

  socket.register('dsct.updateDocument',    async (uuid, data, options = {}) => { const doc = await fromUuid(uuid); if (doc) return await doc.update(data, options); });
  socket.register('dsct.deleteDocument',    async (uuid) => { const doc = await fromUuid(uuid); if (doc) return await doc.delete(); });
  socket.register('dsct.createEmbedded',    async (parentUuid, type, data) => { const parent = await fromUuid(parentUuid); if (parent) return await parent.createEmbeddedDocuments(type, data); });
  socket.register('dsct.toggleStatusEffect',async (uuid, effectId, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.toggleStatusEffect(effectId, options); });
  socket.register('dsct.takeDamage',        async (uuid, amount, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.system.takeDamage(amount, options); });
  socket.register('dsct.rollFreeStrike',    async (itemUuid) => { const item = await fromUuid(itemUuid); if (item) await ds.helpers.macros.rollItemMacro(item.uuid); });
  socket.register('dsct.executeHIWTurn',    async (actorUuid, msgId) => await executeHIWTurn(actorUuid, msgId));
  socket.register('dsct.applyEffectAsGM',   async (pseudoUuid, tierKey, effectId, targetActorUuids) => {
    const pre = await fromUuid(pseudoUuid);
    if (!pre?.applyEffect) return;
    const targets = (await Promise.all(targetActorUuids.map(u => fromUuid(u)))).filter(Boolean);
    if (targets.length) await pre.applyEffect(tierKey, effectId, { targets });
  });
  
  
  socket.register('dsct.openManualModePicker', async (serializedContexts, requestId) => {
    const contexts = serializedContexts.map((ctx, i) => ({
      ...ctx,
      color:          ctx.color ?? _SQUAD_COLORS[i % _SQUAD_COLORS.length],
      lockedIds:      new Set(ctx.lockedIds),
      preSelectedIds: new Set(ctx.preSelectedIds),
      poolTokenIds:   new Set(ctx.poolTokenIds),
    }));
    
    if (!game.settings.get('draw-steel-combat-tools', 'pickDeathsEnabled')) {
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
    if (getSetting('debugMode')) console.log(`DSCT | DT | reportDamagedToken received: ${tokenId} from user ${userId}`);
    _addDamagedToken(tokenId, userId);
  });
  socket.register('dsct.dstdUndoDeath', async (tokenUuid) => { await runDstdUndoRevival(tokenUuid); });

  socket.register('dsct.injectJudgementBane', ({ actorId, tokenId }) => {
    for (const app of foundry.applications.instances.values()) {
      if (!app.options?.ability) continue;
      const dialogActor = app.options.ability.actor ?? app.options.ability.parent;
      if (dialogActor?.id !== actorId) continue;
      if (tokenId && dialogActor.token?.id && dialogActor.token.id !== tokenId) continue;
      if (app._dsctJudgementBaneInjected) return;
      
      const trackId = Hooks.on('createChatMessage', (msg) => {
        if (!msg.system?.parts) return;
        if (msg.speaker?.actor !== actorId) return;
        app._dsctAbilityRolled = true;
        Hooks.off('createChatMessage', trackId);
      });
      app._dsctRollTrackHookId = trackId;
      
      if (injectJudgementBanePill(app)) return;
      app._dsctJudgementBaneInjected = true;
      app.options.context.modifiers.banes = (app.options.context.modifiers.banes ?? 0) + 1;
      app.render();
      return;
    }
  });

  console.log('DSCT | Sockets registered successfully');
});