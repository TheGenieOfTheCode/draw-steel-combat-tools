import { runForcedMovement, toggleForcedMovementPanel, registerForcedMovementHooks, bypassNextFmGate } from './forced-movement/forced-movement.mjs';
import { runColoredTokenPicker, _getValidTargets } from './ability-automation/target-picker.mjs';
import { WallBuilderPanel, convertWalls, mergeSelectedWalls, registerWallDoorHooks } from './forced-movement/wall-builder.mjs';
import { registerChatHooks, refreshChatInjections } from './chat-integration.mjs';
import { runGrab, toggleGrabPanel, endGrab, registerGrabHooks, registerKnockbackGuard, registerGrabTierSync } from './conditions/grab.mjs';
import { STEALTH_WORKFLOW_READY, applyFall, getSetting, initPalette, parsePowerRollState, applyRollMod, getWindowById, monsterFilter, sightLinesToToken, hasSightToToken, hasCover, visibleTargetCorners} from './helpers.mjs';
import { applyJudgement, applyMark, applyAidAttack, registerTacticalHooks } from './ability-automation/tactical-effects.mjs';
import { registerDeathTrackerHooks, runRaiseDeadUI, reviveAll, runPowerWordKillUI, cleanupPixi, _runManualModePicker, _SQUAD_COLORS, _addDamagedToken, deathTrackerExcludedTypes } from './death-tracker/death-tracker.mjs';
import { registerDeferDeath, isDeathDeferred, DEFER_DEATH } from './death-tracker/defer-death.mjs';
import { suppressTrackerAutoDefeat } from './compat/combat-tracker-compat.mjs';
import { applySquadLabels, autoRenameGroups, clearSquadLabels, registerSquadLabelHooks } from './squad-labels.mjs';
import { registerSquadHudHooks, getStickBugged } from './squad-hud.mjs';
import { registerSquadTurnHooks } from './squad-turns.mjs';
import { registerPairTurnHooks } from './pair-turns.mjs';
import { applyTriggeredActions, registerTriggeredActionHooks } from './triggered-actions.mjs';
import { registerModuleButtons } from './module-buttons.mjs';
import { registerCornerVision } from './corner-vision.mjs';
import { installMacros, distributeAbilities, distributeEnhancedAbilities, cleanupEnhancedAbilities, swapEnhancedItem } from './setup-macros.mjs';
import { toggleTeleportPanel, registerTeleportHooks, runTeleport, runBurstTeleport } from './teleport.mjs';
import { registerTargetDistance } from './ability-automation/target-distance.mjs';
import { registerSourceLineHooks } from './ability-automation/source-lines.mjs';
import { toggleDamageConditionsPanel, registerDCHooks } from './conditions/damage-conditions.mjs';
import { applyFrightened, applyTaunted, registerConditionHooks } from './conditions/conditions.mjs';
import { registerStealthSystem, hide, reveal, hiddenFrom, isHiddenFrom, proposeHide, setHiddenFrom, recheckHidden, enforceBlockedObservers, moveLog, pendingSpots, confirmSpot, stealthActive, clearStealthEffects, markRevealed, clearRevealPending, revealPendingReasons, isObserving, observingEnemies } from './conditions/stealth.mjs';
import { registerStatusPalette } from './status-palette.mjs';
import { registerBurrowRendering } from './conditions/burrow.mjs';
import { registerSearch, pointOut, runSearch, spendHeroToken } from './conditions/search.mjs';
import { registerHiddenMarkers } from './conditions/hidden-markers.mjs';
import { registerPartyOverview } from './party/overview.mjs';
import { registerAdvancementHints } from './party/advancement-hints.mjs';
import { registerPartySetupPrompt } from './party/setup-prompt.mjs';
import { registerIgnoredWarning } from './party/ignored-warning.mjs';
import { registerStealthPath, pingStealthStop } from './conditions/stealth-path.mjs';
import { registerCombatReveal } from './conditions/combat-reveal.mjs';
import { playDetected } from './conditions/detected-flash.mjs';
import { openImNoThreatPanel } from './ability-automation/ability-automation.mjs';
import { openTransformPicker, runTransform } from './ability-automation/transformation.mjs';
import { triggerAbyssalEvolution, registerMaliceInjectors } from './ability-automation/malice/malice-features.mjs';
import { registerCrossfadeHooks } from './ability-automation/class-shadow/crossfade.mjs';
import { registerSquadTargetingHooks, _pendingSquadMap } from './ability-automation/squad-targeting.mjs';
import { executeHIWTurn, registerHIWHooks } from './ability-automation/class-shadow/hesitation.mjs';
import { registerCompleteEncounterHooks } from './complete-encounter.mjs';
import { registerDefeatedTokenVisibility } from './death-tracker/defeated-token-visibility.mjs';
import { registerSettings, registerCompatibilityChecks } from './settings/register-settings.mjs';
import { registerSystemPatches } from './system-patches.mjs';
import { registerRollDialogPillHooks, setBaneDialogLockWithOverlay, injectJudgementBanePill, addExternalRollPill } from './ability-automation/roll-dialog-hooks.mjs';
import { registerDstdCompat, queueDstdUndoRevival, markPendingRevival, setFmRowRemoteExecuting } from './compat/dstd-compat.mjs';
import { registerDstdRollPills } from './compat/dstd-roll-pills.mjs';
import {
  registerDstdDamagePills, openDamageEditor, foldDamagePills, damagePillDisplayList,
  damagePillText, damagePillEffect, damagePillType, damageTypeLabel, styleTypePill,
  registerDamagePillProvider,
} from './compat/dstd-damage-pills.mjs';
import { registerHealthEstimateCompat } from './compat/health-estimate-compat.mjs';
import { registerAbilityHudCompat } from './compat/ability-hud-compat.mjs';
import { registerCombatLogHooks } from './combat-logs.mjs';
import { registerFlatEffects, setPendingTriggerDamage } from './ability-automation/flat-special-effects.mjs';
import { registerTieredEffects } from './ability-automation/tiered-effects.mjs';
import { registerChooseEffect } from './ability-automation/choose-effect.mjs';
import { registerHideEffect, runHideFor } from './ability-automation/hide-effect.mjs';
import { registerStealthTraits, stealthTraits } from './conditions/stealth-traits.mjs';
import { registerLineOfEffectFlags, registerCoverImmunity } from './conditions/line-of-effect.mjs';
import { registerEffectFlagPicker } from './effect-flag-picker.mjs';
import { registerEnhancedBadge } from './enhanced-badge.mjs';
import { beginPickerOverlay, endPickerOverlay } from './ability-automation/picker-overlay.mjs';
import { stackedPrompt } from './ability-automation/stacked-prompt.mjs';
import { handleObservationRequest } from './conditions/observation-picker.mjs';
import { registerLowCover } from './conditions/low-cover.mjs';
import { registerPeek, unpeek, peekEffect, peekSpaces, peekTo, peekDistance, peekDuration, isPeeking } from './conditions/peek.mjs';
import { registerColorFields, upgradeColorFields } from './color-field.mjs';
import { registerObservationMemory, suggestObserving, obscuredNear, lastSeenOf, lastHarmOf, seesClearly, clearObservationMemory } from './conditions/observation.mjs';

const api = {
  forcedMovement:   runForcedMovement,
  bypassNextFmGate: bypassNextFmGate,
  setTriggerDamage:  setPendingTriggerDamage,
  colorTokenPicker: runColoredTokenPicker,
  
  getValidTargets:  _getValidTargets,
  deferDeath:       { status: DEFER_DEATH, isDeferred: isDeathDeferred },
  pickerOverlay:    { begin: beginPickerOverlay, end: endPickerOverlay },
  stackedPrompt:    stackedPrompt,
  colorFields:      upgradeColorFields,
  observation:      { suggest: suggestObserving, obscuredNear, lastSeen: lastSeenOf, lastHarm: lastHarmOf, seesClearly, clear: clearObservationMemory },
  stealth:          { hide, reveal, hiddenFrom, isHiddenFrom, proposeHide, setHiddenFrom, recheck: recheckHidden, enforceBlocked: enforceBlockedObservers, moveLog, pendingSpots, confirmSpot, isActive: stealthActive, clearAll: clearStealthEffects, markRevealed, clearRevealPending, revealPendingReasons, isObserving, observingEnemies, traits: stealthTraits, search: runSearch, runHide: runHideFor },
  sight:            { hasCover, visibleTargetCorners, hasSightTo: hasSightToToken },
  peek:             { unpeek, effect: peekEffect, isPeeking, spaces: peekSpaces, to: peekTo, distance: peekDistance, duration: peekDuration },
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
  clearSquadLabels: clearSquadLabels,
  renameSquads:     autoRenameGroups,
  triggeredActions: applyTriggeredActions,
  teleport:         runTeleport,
  burstTeleport:    runBurstTeleport,
  teleportUI:       toggleTeleportPanel,
  installMacros:        installMacros,
  distributeEnhancedAbilities,
  cleanupEnhancedAbilities,
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

  sightLines:       sightLinesToToken,
  hasSightTo:       hasSightToToken,
  setRollDialogLock:         setBaneDialogLockWithOverlay,
  getStickBugged:   getStickBugged,
  isFMActive:       () => !!window._dsctFMActive,
  pendingSquadMap:  () => _pendingSquadMap,
  deathTrackerExcludedTypes,
  damagePills: {
    open: openDamageEditor,
    fold: foldDamagePills,
    displayList: damagePillDisplayList,
    text: damagePillText,
    effect: damagePillEffect,
    pillType: damagePillType,
    typeLabel: damageTypeLabel,
    styleTypePill,
    registerProvider: registerDamagePillProvider,
  },
  rollDialog: {
    addPill: addExternalRollPill,
  },
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
  registerGrabTierSync();
  registerConditionHooks();
  registerStatusPalette();
  registerStealthSystem();
  registerObservationMemory();
  registerLowCover();
  registerPeek();
  registerColorFields();
  registerBurrowRendering();
  registerHiddenMarkers();
  if (getSetting('partyToolsEnabled')) {
    registerPartyOverview();
    registerAdvancementHints();
    registerPartySetupPrompt();
    registerIgnoredWarning();
  }
  registerStealthTraits();
  registerLineOfEffectFlags();
  registerCoverImmunity();
  registerEffectFlagPicker();
  registerEnhancedBadge();
  if (STEALTH_WORKFLOW_READY) {
    registerStealthPath();
    registerSearch();
    registerCombatReveal();
  }
  registerDCHooks();
  registerTacticalHooks();
  registerDeathTrackerHooks();
  registerDeferDeath();
  registerSquadLabelHooks();
  registerSquadHudHooks();
  registerSquadTurnHooks();
  registerPairTurnHooks();
  registerTriggeredActionHooks();
  registerModuleButtons();
  registerForcedMovementHooks();
  registerWallDoorHooks();
  registerTeleportHooks();
  registerTargetDistance();
  registerSourceLineHooks();
  registerCrossfadeHooks();
  registerHIWHooks();
  registerCompleteEncounterHooks();
  registerCombatLogHooks();
  registerSystemPatches();
  registerCornerVision();
  registerDefeatedTokenVisibility();
  registerRollDialogPillHooks();
  registerSquadTargetingHooks();
  registerMaliceInjectors();
  registerFlatEffects();
  registerTieredEffects();
  registerChooseEffect();
  registerHideEffect();
  registerDstdCompat();
  registerDstdRollPills();
  registerDstdDamagePills();
  registerHealthEstimateCompat();
  registerAbilityHudCompat();
  
  
  if (game.modules.get('draw-steel-combat-tools')?.flags?.['draw-steel-combat-tools']?.testFeatures) {
    import('./test-features.mjs').then(m => { m.registerTestFeaturesSettings(); m.registerTestFeatureHooks(); }).catch(() => {});
  }
  console.log('DSCT | Initialized');

  game.keybindings.register('draw-steel-combat-tools', 'refreshChatInjections', {
    name: 'Refresh Chat Forced Movement Buttons', hint: 'Re-injects Execute buttons into any chat messages that have forced movement data.',
    editable: [{ key: 'KeyR', modifiers: ['Shift'] }],
    onDown: () => { refreshChatInjections(); return true; },
  });
});

Hooks.once('canvasReady', () => {

  canvas.app?.view?.addEventListener('webglcontextlost', (e) => {
    console.error('DSCT | WebGL context lost -- likely cause of DevTools disconnect', e);
    e.preventDefault();
  });
  canvas.app?.view?.addEventListener('webglcontextrestored', () => {
    console.warn('DSCT | WebGL context restored');
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
  suppressTrackerAutoDefeat();
  if (!game.user.isGM) {
    const M = 'draw-steel-combat-tools';
    game.user.setFlag(M, 'cedeDeathPickerToGM', game.settings.get(M, 'cedeDeathPickerToGM'));
  }
});

Hooks.once('ready', async () => {
  if (!game.user.isGM) return;

  const M              = 'draw-steel-combat-tools';

  if (!game.modules.get('draw-steel-target-damage')?.active && game.settings.get(M, 'squadTargetBonus')) {
    await game.settings.set(M, 'squadTargetBonus', false);
  }

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
    <div class="form-group dsct-prompt-remember">
      <label>${game.i18n.localize('DSCT.dialog.sampleMacros.rememberLabel')}</label>
      <select id="dsct-macro-prompt-pref">
        ${['ask', 'skip-update', 'never'].map(v => `<option value="${v}"${v === promptMode ? ' selected' : ''}>${game.i18n.localize(`DSCT.dialog.sampleMacros.${{ 'ask': 'optAsk', 'skip-update': 'optSkipUpdate', 'never': 'optNever' }[v]}`)}</option>`).join('')}
      </select>
    </div>
  `;

  const getChoice = (html) => {
    const root = html instanceof HTMLElement ? html : (html[0] ?? null);
    return root?.querySelector('#dsct-macro-prompt-pref')?.value ?? 'ask';
  };

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('DSCT.dialog.sampleMacros.title') },
    position: { width: 480 },
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

Hooks.once('ready', async () => {
  if (!game.user.isGM) return;
  const M = 'draw-steel-combat-tools';

  const currentVersion = game.modules.get(M).version ?? '';
  const promptMode     = game.settings.get(M, 'enhancedPromptMode');
  const seenVersion    = game.settings.get(M, 'enhancedPromptSeenVersion') ?? '';

  const REPAIR_ID = 'retype-1';
  if (game.settings.get(M, 'enhancedRepairDone') !== REPAIR_ID) {
    try {
      const r = await distributeEnhancedAbilities({ silent: true, repair: true });
      const touched = (r?.refreshed ?? 0) + (r?.added ?? 0);
      if (touched) ui.notifications.info(game.i18n.format('DSCT.notice.macros.enhancedRepaired', { count: touched }));
      if (r?.failed) console.warn(`DSCT | enhanced | repair pass could not finish ${r.failed} actor(s)`);
    } catch (err) {
      console.warn('DSCT | enhanced | repair pass failed:', err);
    }
    await game.settings.set(M, 'enhancedRepairDone', REPAIR_ID);
  }

  const remembered = promptMode === 'never' || (promptMode === 'skip-update' && seenVersion === currentVersion);
  if (remembered) {
    if (game.settings.get(M, 'enhancedAutoAdd')) {
      const r = await distributeEnhancedAbilities({ silent: true });
      const touched = (r?.added ?? 0) + (r?.refreshed ?? 0) + (r?.swapped ?? 0);
      if (touched) ui.notifications.info(game.i18n.format('DSCT.notice.macros.enhancedKeptCurrent', { count: touched }));
    }
    return;
  }

  const content = `
    ${game.i18n.localize('DSCT.dialog.enhancedAbilities.body')}
    <div class="form-group dsct-prompt-remember">
      <label>${game.i18n.localize('DSCT.dialog.sampleMacros.rememberLabel')}</label>
      <select id="dsct-enhanced-prompt-pref">
        ${['ask', 'skip-update', 'never'].map(v => `<option value="${v}"${v === promptMode ? ' selected' : ''}>${game.i18n.localize(`DSCT.dialog.sampleMacros.${{ 'ask': 'optAsk', 'skip-update': 'optSkipUpdate', 'never': 'optNever' }[v]}`)}</option>`).join('')}
      </select>
    </div>
  `;
  const getChoice = (html) => {
    const root = html instanceof HTMLElement ? html : (html[0] ?? null);
    return root?.querySelector('#dsct-enhanced-prompt-pref')?.value ?? 'ask';
  };

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('DSCT.dialog.enhancedAbilities.title') },
    position: { width: 480 },
    content,
    buttons: [
      { action: 'yes', label: game.i18n.localize('DSCT.dialog.enhancedAbilities.yes'), default: true, callback: (_e, _btn, dialog) => ({ doAdd: true,  choice: getChoice(dialog.element) }) },
      { action: 'no',  label: game.i18n.localize('DSCT.dialog.enhancedAbilities.no'),                 callback: (_e, _btn, dialog) => ({ doAdd: false, choice: getChoice(dialog.element) }) },
    ],
    rejectClose: false,
  });
  if (!result) return;

  const { doAdd, choice } = result;
  await game.settings.set(M, 'enhancedPromptMode', choice);
  await game.settings.set(M, 'enhancedAutoAdd', doAdd);
  if (choice === 'skip-update') await game.settings.set(M, 'enhancedPromptSeenVersion', currentVersion);
  if (doAdd) await distributeEnhancedAbilities();
});

Hooks.on('createActor', async (actor, _options, _userId) => {
  if (!game.users.activeGM?.isSelf || actor.pack) return;
  if (!game.settings.get('draw-steel-combat-tools', 'enhancedAutoAdd')) return;
  if (['party', 'object'].includes(actor.type)) return;
  await distributeEnhancedAbilities({ actors: [actor], silent: true });
});

Hooks.on('createItem', async (item, _options, _userId) => {
  if (!game.users.activeGM?.isSelf || item.pack) return;
  if (!game.settings.get('draw-steel-combat-tools', 'enhancedAutoAdd')) return;
  try { await swapEnhancedItem(item); }
  catch (err) { console.warn('DSCT | enhanced | could not swap an imported item:', err); }
});

Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

  socket.register('dsct.updateDocument',    async (uuid, data, options = {}) => { const doc = await fromUuid(uuid); if (doc) return await doc.update(data, options); });
  socket.register('dsct.deleteDocument',    async (uuid, options = {}) => { const doc = await fromUuid(uuid); if (doc) return await doc.delete(options); });
  socket.register('dsct.createEmbedded',    async (parentUuid, type, data) => { const parent = await fromUuid(parentUuid); if (parent) return await parent.createEmbeddedDocuments(type, data); });
  socket.register('dsct.toggleStatusEffect',async (uuid, effectId, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.toggleStatusEffect(effectId, options); });
  socket.register('dsct.detected',          (spotterId, hiderId) => playDetected(spotterId, hiderId));
  socket.register('dsct.stealthPing',       (at, sceneId) => { if (game.user.isGM) pingStealthStop(at, sceneId); });
  socket.register('dsct.searchPointOut',    (messageId) => pointOut(messageId));
  socket.register('dsct.askObservation',    (hiderId, observerIds) => handleObservationRequest(hiderId, observerIds));
  socket.register('dsct.spendHeroToken',    () => spendHeroToken());
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
  socket.register('dsct.dstdUndoDeath', (tokenUuid) => { queueDstdUndoRevival(tokenUuid); });
  socket.register('dsct.dstdPendingRevival', (tokenUuid) => { markPendingRevival(tokenUuid); });
  socket.register('dsct.fmRowExecuting', (stateKey, executing) => setFmRowRemoteExecuting(stateKey, executing));

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