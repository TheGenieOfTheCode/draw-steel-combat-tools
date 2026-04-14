import { runForcedMovement, toggleForcedMovementPanel, registerForcedMovementHooks } from './forced-movement.mjs';
import { WallBuilderPanel, convertWalls } from './wall-builder.mjs';
import { registerChatHooks, refreshChatInjections } from './chat-integration.mjs';
import { runGrab, toggleGrabPanel, endGrab, registerGrabHooks } from './grab.mjs';
import { applyFall, initPalette, parsePowerRollState, applyRollMod, getWindowById } from './helpers.mjs';
import { applyJudgement, applyMark, applyAidAttack, registerTacticalHooks } from './tactical-effects.mjs';
import { registerDeathTrackerHooks, runReviveUI, runPowerWordKillUI } from './death-tracker.mjs';
import { applySquadLabels, autoRenameGroups, registerSquadLabelHooks } from './squad-labels.mjs';
import { applyTriggeredActions, registerTriggeredActionHooks } from './triggered-actions.mjs';
import { registerModuleButtons } from './module-buttons.mjs';
import { installMacros, distributeAbilities } from './setup-macros.mjs';
import { toggleTeleportPanel, registerTeleportHooks, runTeleport, runBurstTeleport } from './teleport.mjs';
import { toggleDamageConditionsPanel } from './damage-conditions.mjs';
import { applyFrightened, applyTaunted, registerConditionHooks } from './conditions.mjs';
import { openImNoThreatPanel } from './ability-automation.mjs';
import { registerSettings } from './register-settings.mjs';

const api = {
  forcedMovement:   runForcedMovement,
  grab:             runGrab,
  wallBuilder: () => { const existing = getWindowById('wall-builder-panel'); if (existing) existing.close(); else new WallBuilderPanel().render(true); },
  convertWalls: convertWalls,
  grabPanel:        toggleGrabPanel,
  endGrab:          endGrab,
  revive:           runReviveUI,
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
  imNoThreat:           openImNoThreatPanel,
  damageConditionsUI:   toggleDamageConditionsPanel,
  socket:           null,
};

Hooks.once('init', () => {
  game.modules.get('draw-steel-combat-tools').api = api;

  initPalette();
  new MutationObserver(initPalette).observe(document.body, { attributeFilter: ['class'] });

  registerSettings();
  registerChatHooks();
  registerGrabHooks();
  registerConditionHooks();
  registerTacticalHooks();
  registerDeathTrackerHooks();
  registerSquadLabelHooks();
  registerTriggeredActionHooks();
  registerModuleButtons();
  registerForcedMovementHooks();
  registerTeleportHooks();

  console.log('DSCT | Initialized');

  game.keybindings.register('draw-steel-combat-tools', 'refreshChatInjections', {
    name: 'Refresh Chat Forced Movement Buttons', hint: 'Re-injects Execute buttons into any chat messages that have forced movement data.',
    editable: [{ key: 'KeyR', modifiers: ['Shift'] }],
    onDown: () => { refreshChatInjections(); return true; },
  });
});

Hooks.on('renderSettingsConfig', (_app, html) => {
  const M = 'draw-steel-combat-tools';
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  const settingRow = (key) => {
    const input = root.querySelector(`[name="${M}.${key}"]`);
    if (input) return input.closest('.form-group') ?? input.closest('li') ?? input.parentElement;
    const btn = root.querySelector(`[data-key="${M}.${key}"]`);
    return btn ? (btn.closest('.form-group') ?? btn.closest('li') ?? btn.parentElement) : null;
  };

  const addHeader = (beforeKey, label) => {
    const row = settingRow(beforeKey);
    if (!row) return;
    const h = document.createElement('h3');
    h.className = 'dsct-settings-header';
    h.textContent = label;
    h.style.cssText = 'grid-column:1/-1;border-bottom:1px solid var(--color-border-dark-4);padding:8px 0 4px;margin:12px 0 0;font-size:1em;';
    row.before(h);
  };

  const bindToggle = (masterKey, subKeys) => {
    const masterInput = root.querySelector(`[name="${M}.${masterKey}"]`);
    if (!masterInput) return;
    const rows = subKeys.map(settingRow).filter(Boolean);
    const update = () => { for (const row of rows) row.style.display = masterInput.checked ? '' : 'none'; };
    masterInput.addEventListener('change', update);
    update();
  };

  addHeader('chatInjectDelay', 'General');
  addHeader('installMacros', 'Setup');
  addHeader('quickStrikeCompat', 'Compatability');
  addHeader('forcedMovementEnabled', 'Forced Movement');
  addHeader('grabEnabled', 'Grab');
  addHeader('deathTrackerEnabled', 'Death Tracker');
  addHeader('autoSquadLabelsEnabled', 'Squad Labels');
  addHeader('autoTriggeredActionsEnabled', 'Triggered Actions');
  addHeader('teleportEnabled', 'Teleport');
  addHeader('frightenedEnabled', 'Conditions');
  addHeader('bleedingEnabled', 'Bleeding');
  addHeader('judgementAutomation', 'Ability Automation');
  addHeader('showForcedMovementButton', 'Module Buttons');

  bindToggle('forcedMovementEnabled', ['animationStepDelay', 'fallDamageCap', 'gmBypassesRangeCheck', 'fmModifyGmOnly']);
  bindToggle('grabEnabled', ['gmBypassesSizeCheck', 'restrictGrabButtons', 'grabbedBaneEnabled']);
  bindToggle('deathTrackerEnabled', ['deathAnimationDuration', 'clearSkullsOnCombatEnd', 'clearEffectsOnRevive', 'autoAssignDamagedMinion', 'overrideMinionDefeat']);
  bindToggle('autoTriggeredActionsEnabled', ['autoTriggeredActionsTarget']);
  bindToggle('bleedingEnabled', ['bleedingMode']);
  bindToggle('debugMode', ['cornerCutMode', 'legacySingleCellCollisions', 'allowCrookedPushPull']);

  const fmEnabled   = root.querySelector(`[name="${M}.forcedMovementEnabled"]`)?.checked ?? true;
  const grabEnabled = root.querySelector(`[name="${M}.grabEnabled"]`)?.checked ?? true;
  const tpEnabled   = root.querySelector(`[name="${M}.teleportEnabled"]`)?.checked ?? true;

  const fmBtnRow   = settingRow('showForcedMovementButton');
  const grabBtnRow = settingRow('showGrabButton');
  const tpBtnRow   = settingRow('showTeleportButton');

  if (fmBtnRow   && !fmEnabled)   fmBtnRow.style.display   = 'none';
  if (grabBtnRow && !grabEnabled) grabBtnRow.style.display  = 'none';
  if (tpBtnRow   && !tpEnabled)   tpBtnRow.style.display    = 'none';
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
    <p>Would you like to import sample macros for <strong>Draw Steel: Combat Tools</strong>?</p>
    <p>These provide ready-to-use buttons for Forced Movement, Grab, Teleport, and all other module features.</p>
    <div class="form-group" style="margin-top:12px;">
      <label style="flex:0 0 auto;margin-right:8px;">Remember my choice:</label>
      <select id="dsct-macro-prompt-pref" style="flex:1;">
        <option value="ask">Ask me on next initialization</option>
        <option value="skip-update">Don't ask until the next update</option>
        <option value="never">Don't ask again</option>
      </select>
    </div>
  `;

  const getChoice = (html) => {
    const root = html instanceof HTMLElement ? html : (html[0] ?? null);
    return root?.querySelector('#dsct-macro-prompt-pref')?.value ?? 'ask';
  };

  const result = await Dialog.wait({
    title: 'Draw Steel: Combat Tools - Sample Macros',
    content,
    buttons: {
      yes: { label: 'Yes, Import',  callback: (html) => ({ doImport: true,  choice: getChoice(html) }) },
      no:  { label: 'No Thanks',   callback: (html) => ({ doImport: false, choice: getChoice(html) }) },
    },
    close: () => null,
    default: 'yes',
  });

  if (!result) return;

  const { doImport, choice } = result;
  await game.settings.set(M, 'macroPromptMode', choice);
  await game.settings.set(M, 'macroAutoImport', doImport);
  if (choice === 'skip-update') await game.settings.set(M, 'macroPromptSeenVersion', currentVersion);
  if (doImport) await installMacros();
});

//Lesson learned in blood, gooogle things for the program you're trying to mod. Wasted many hours trying to brute force sockets into foundry before I realized socketlib exists!

Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

  socket.register('updateDocument',    async (uuid, data, options = {}) => { const doc = await fromUuid(uuid); if (doc) return await doc.update(data, options); });
  socket.register('deleteDocument',    async (uuid) => { const doc = await fromUuid(uuid); if (doc) return await doc.delete(); });
  socket.register('createEmbedded',    async (parentUuid, type, data) => { const parent = await fromUuid(parentUuid); if (parent) return await parent.createEmbeddedDocuments(type, data); });
  socket.register('toggleStatusEffect',async (uuid, effectId, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.toggleStatusEffect(effectId, options); });
  socket.register('takeDamage',        async (uuid, amount, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.system.takeDamage(amount, options); });
  socket.register('rollFreeStrike',     async (itemUuid) => { const item = await fromUuid(itemUuid); if (item) await ds.helpers.macros.rollItemMacro(item.uuid); });
  socket.register('openSquadBreakpoint', async (groupId, numToKill, damagedTokenIds = []) => {
    const group = game.combat?.groups?.get(groupId);
    if (!group) return;
    const minions = Array.from(group.members || []).filter(m => {
      if (!m?.actor) return false;
      const sys = m.actor.system;
      return String(sys?.monster?.organization || sys?.role?.value || sys?.role || m.actor.type).toLowerCase().trim() === 'minion';
    });
    api.powerWordKill({ maxTargets: numToKill, squadGroup: group, minions, damagedTokenIds });
  });

  console.log('DSCT | Sockets registered successfully');
});