import { runForcedMovement, toggleForcedMovementPanel, registerForcedMovementHooks } from './forced-movement.js';
import { WallBuilderPanel } from './wall-builder.js';
import { WallBuilderSettingsMenu, MATERIAL_RULE_DEFAULTS, WALL_RESTRICTION_DEFAULTS } from './wall-builder-settings.js';
import { registerChatHooks, refreshChatInjections } from './chat-hooks.js';
import { runGrab, toggleGrabPanel, endGrab, registerGrabHooks } from './grab.js';
import { applyFall } from './helpers.js';
import { applyJudgement, applyMark, applyAidAttack, registerTacticalHooks } from './tactical-effects.js';
import { parsePowerRollState, applyRollMod, getWindowById } from './helpers.js';
import { registerDeathTrackerHooks, runReviveUI, runPowerWordKillUI } from './death-tracker.js';
import { applySquadLabels, autoRenameGroups, registerSquadLabelHooks } from './squad-labels.js';
import { applyTriggeredActions, registerTriggeredActionHooks } from './triggered-actions.js';
import { registerModuleButtons } from './module-buttons.js';
import { installMacros, distributeAbilities, InstallMacrosMenu } from './setup-macros.js';
import { toggleTeleportPanel, registerTeleportHooks, runTeleport } from './teleport.js';

const api = {
  forcedMovement:   runForcedMovement,
  grab:             runGrab,
  wallBuilder: () => {
    const existing = getWindowById('wall-builder-panel');
    if (existing) existing.close();
    else new WallBuilderPanel().render(true);
  },
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
  teleportUI:       toggleTeleportPanel,
  installMacros:        installMacros,
  distributeAbilities:  distributeAbilities,
  fall:                 applyFall,
  parsePowerRollState:  parsePowerRollState,
  applyRollMod:         applyRollMod,
  socket:           null,
};

Hooks.once('init', () => {
  game.modules.get('draw-steel-combat-tools').api = api;

  const M = 'draw-steel-combat-tools';
  const reloadOnChange = { onChange: () => SettingsConfig.reloadConfirm({ world: true }) };

  game.settings.register(M, 'forcedMovementEnabled', {
    name: 'Enable Forced Movement', hint: 'Enables the Forced Movement panel and all push/pull/slide mechanics.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'animationStepDelay', {
    name: 'Animation Step Delay (ms)', hint: 'Time in milliseconds between each square of animated forced movement. Set to 0 to disable animation.',
    scope: 'world', config: true, type: Number, default: 80, range: { min: 0, max: 500, step: 10 }, ...reloadOnChange
  });
  game.settings.register(M, 'fallDamageCap', {
    name: 'Fall Damage Cap', hint: 'Maximum damage a creature can take from a single fall.',
    scope: 'world', config: true, type: Number, default: 50, range: { min: 10, max: 200, step: 5 }, ...reloadOnChange
  });
  game.settings.register(M, 'gmBypassesRangeCheck', {
    name: 'GM Bypasses Range Check', hint: 'When enabled, the GM can execute forced movement from chat buttons regardless of range.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'grabEnabled', {
    name: 'Enable Grab System', hint: 'Enables the Grab panel and all grab mechanics.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'gmBypassesSizeCheck', {
    name: 'GM Bypasses Size Check', hint: 'When enabled, the GM can execute Knockback and Grab regardless of target size.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'restrictGrabButtons', {
    name: 'Restrict Manual Grab Buttons to GM', hint: 'If enabled, only the GM can see and click the Apply Grab and End Grab buttons in the Grab Panel.',
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'grabbedBaneEnabled', {
    name: 'Enable Grabbed Bane', hint: 'Edits abilities posted by a grabbed creature if they don\'t target their grabber to inflict 1 bane.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'deathTrackerEnabled', {
    name: 'Enable Death Tracker', hint: 'Automatically removes dead enemies from combat, triggers a death animation, and places a skull marker.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'deathAnimationDuration', {
    name: 'Death Animation Duration (ms)', hint: 'How long the red fade-out animation lasts before the token is removed. Set to 0 to skip.',
    scope: 'world', config: true, type: Number, default: 2000, range: { min: 0, max: 5000, step: 100 }, ...reloadOnChange
  });
  game.settings.register(M, 'clearSkullsOnCombatEnd', {
    name: 'Clear Skulls on Combat End', hint: 'If enabled, all skull tiles placed during a combat encounter are deleted when combat ends.',
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'clearEffectsOnRevive', {
    name: 'Clear Effects on Revive', hint: 'If enabled, reviving a creature automatically removes all active conditions and effects (except core system states like Winded).',
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'deathTrackerSkullIds', { scope: 'world', config: false, type: Array, default: [] });

  game.settings.register(M, 'autoSquadLabelsEnabled', {
    name: 'Enable Squad Labels', hint: 'Automatically apply squad label icons to tokens when combat starts.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'autoTriggeredActionsEnabled', {
    name: 'Enable Triggered Action Tracker', hint: 'Automatically place the Unspent Triggered Action effect on combatants when combat starts.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'autoTriggeredActionsTarget', {
    name: 'Triggered Action Tracker Targets', hint: 'Who should receive the Triggered Action tracker at the start of combat?',
    scope: 'world', config: true, type: String,
    choices: { 'ALL': 'All Combatants', 'HEROES': 'Heroes Only', 'NPCS': 'NPCs Only' },
    default: 'ALL', ...reloadOnChange
  });

  game.settings.register(M, 'teleportEnabled', {
    name: 'Enable Teleport Tool', hint: 'Adds a teleport button to the token controls for phasing tokens across the map.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.registerMenu(M, 'wallBuilderSettings', {
    name: 'Wall Builder Settings', label: 'Configure Wall Builder',
    hint: 'Adjust material costs, damage values, wall restrictions, and wall builder defaults.',
    icon: 'fas fa-dungeon', type: WallBuilderSettingsMenu, restricted: true,
  });
  game.settings.register(M, 'materialRules',         { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS) });
  game.settings.register(M, 'wallRestrictions',      { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS) });
  game.settings.register(M, 'wbDefaultMaterial',     { scope: 'world', config: false, type: String, default: 'stone' });
  game.settings.register(M, 'wbDefaultHeightBottom', { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'wbDefaultHeightTop',    { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'customMaterials',       { scope: 'world', config: false, type: Array,  default: [] });

  game.settings.register(M, 'showForcedMovementButton', {
    name: 'Show Forced Movement Button', hint: 'Show the Forced Movement toolbar button in the token controls.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showGrabButton', {
    name: 'Show Grab Button', hint: 'Show the Grab Panel toolbar button in the token controls.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showTeleportButton', {
    name: 'Show Teleport Button', hint: 'Show the Teleport toolbar button in the token controls.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showWallBuilderButton', {
    name: 'Show Wall Builder Button', hint: 'Show the Wall Builder toolbar button in the token controls (GM only).',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showPowerWordKillButton', {
    name: 'Show Power Word Kill Button', hint: 'Show the Power Word Kill toolbar button in the token controls (GM only).',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'chatInjectDelay', {
    name: 'Chat Button Inject Delay (ms)', hint: 'Time in milliseconds to wait after a chat message renders before injecting forced movement buttons.',
    scope: 'world', config: true, type: Number, default: 500, range: { min: 100, max: 2000, step: 100 }, ...reloadOnChange
  });
  game.settings.register(M, 'debugMode', {
    name: 'Debug Mode', hint: 'If enabled, verbose debug messages are printed to the browser console.',
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'cornerCutMode', {
    name: 'Corner Cut Movement',
    hint: 'Collide on Corner Cuts (default): diagonal movement clipping a wall corner is allowed but triggers collision damage.\nBlock Corner Cutting: diagonal movement through a wall corner is forbidden entirely.',
    scope: 'world', config: true, type: String,
    choices: { 'block': 'Block Corner Cutting', 'collide': 'Collide on Corner Cuts' },
    default: 'collide', ...reloadOnChange
  });
  game.settings.registerMenu(M, 'installMacros', {
    name: 'Install API Macros', label: 'Install Macros',
    hint: 'Creates a folder of ready-to-use macros for every module API function in your Macros sidebar.',
    icon: 'fas fa-scroll', type: InstallMacrosMenu, restricted: true,
  });

  registerChatHooks();
  registerGrabHooks();
  registerTacticalHooks();
  registerDeathTrackerHooks();
  registerSquadLabelHooks();
  registerTriggeredActionHooks();
  registerModuleButtons();
  registerForcedMovementHooks();
  registerTeleportHooks();

  console.log('DSCT | Initialized');

  game.keybindings.register(M, 'refreshChatInjections', {
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
    return input ? (input.closest('.form-group') ?? input.closest('li') ?? input.parentElement) : null;
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

  addHeader('forcedMovementEnabled', 'Forced Movement');
  addHeader('grabEnabled', 'Grab');
  addHeader('deathTrackerEnabled', 'Death Tracker');
  addHeader('autoSquadLabelsEnabled', 'Squad Labels');
  addHeader('autoTriggeredActionsEnabled', 'Triggered Actions');
  addHeader('teleportEnabled', 'Teleport');
  addHeader('showForcedMovementButton', 'Module Buttons');
  addHeader('chatInjectDelay', 'General');

  bindToggle('forcedMovementEnabled', ['animationStepDelay', 'fallDamageCap', 'gmBypassesRangeCheck']);
  bindToggle('grabEnabled', ['gmBypassesSizeCheck', 'restrictGrabButtons', 'grabbedBaneEnabled']);
  bindToggle('deathTrackerEnabled', ['deathAnimationDuration', 'clearSkullsOnCombatEnd', 'clearEffectsOnRevive']);
  bindToggle('autoTriggeredActionsEnabled', ['autoTriggeredActionsTarget']);
  bindToggle('debugMode', ['cornerCutMode']);

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

//Lesson learned in blood, gooogle things for the program you're trying to mod. Wasted many hours trying to brute force sockets into foundry before I realized socketlib exists!
Hooks.once('socketlib.ready', () => {
  const socket = socketlib.registerModule('draw-steel-combat-tools');
  api.socket = socket;

  socket.register('updateDocument',    async (uuid, data, options = {}) => { const doc = await fromUuid(uuid); if (doc) return await doc.update(data, options); });
  socket.register('deleteDocument',    async (uuid) => { const doc = await fromUuid(uuid); if (doc) return await doc.delete(); });
  socket.register('createEmbedded',    async (parentUuid, type, data) => { const parent = await fromUuid(parentUuid); if (parent) return await parent.createEmbeddedDocuments(type, data); });
  socket.register('toggleStatusEffect',async (uuid, effectId, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.toggleStatusEffect(effectId, options); });
  socket.register('takeDamage',        async (uuid, amount, options) => { const actor = await fromUuid(uuid); if (actor) return await actor.system.takeDamage(amount, options); });
  socket.register('openSquadBreakpoint', async (groupId, numToKill) => {
    const group = game.combat?.groups?.get(groupId);
    if (!group) return;
    const minions = Array.from(group.members || []).filter(m => {
      if (!m?.actor) return false;
      const sys = m.actor.system;
      return String(sys?.monster?.organization || sys?.role?.value || sys?.role || m.actor.type).toLowerCase().trim() === 'minion';
    });
    api.powerWordKill({ maxTargets: numToKill, squadGroup: group, minions });
  });

  console.log('DSCT | Sockets registered successfully');
});
