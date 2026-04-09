import { runForcedMovement, toggleForcedMovementPanel, registerForcedMovementHooks } from './forced-movement.js';
import { WallBuilderPanel, convertWalls } from './wall-builder.js';
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
import { toggleTeleportPanel, registerTeleportHooks, runTeleport, runBurstTeleport } from './teleport.js';
import { applyFrightened, applyTaunted, registerConditionHooks } from './conditions.js';

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
  burstTeleport:    runBurstTeleport,
  teleportUI:       toggleTeleportPanel,
  installMacros:        installMacros,
  distributeAbilities:  distributeAbilities,
  fall:                 applyFall,
  parsePowerRollState:  parsePowerRollState,
  applyRollMod:         applyRollMod,
  applyFrightened:      applyFrightened,
  applyTaunted:         applyTaunted,
  convertWalls:         convertWalls,
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

  game.settings.register(M, 'frightenedEnabled', {
    name: 'Enable Frightened Automation', hint: 'Applies bane/edge roll modifiers and movement restrictions for the DSCT Frightened condition. Replaces native frightened buttons in chat with our version.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'tauntedEnabled', {
    name: 'Enable Taunted Automation', hint: 'Applies double-bane roll modifiers (with line-of-effect check) for the DSCT Taunted condition. Replaces native taunted buttons in chat with our version.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'bleedingEnabled', {
    name: 'Enable Bleeding Automation', hint: 'Automatically handles the bleeding condition — triggers a 1d6+1 stamina loss when a bleeding creature uses a main action, triggered action ability, or makes a Might/Agility roll.',
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'bleedingMode', {
    name: 'Bleeding Damage Mode',
    hint: 'Auto-Apply: rolls 1d6+1 and applies the damage immediately with an undo button. Manual: posts the roll for the GM/player to apply.',
    scope: 'world', config: true, type: String,
    choices: { 'auto': 'Auto-Apply (with undo)', 'manual': 'Manual (post roll to apply)' },
    default: 'auto', ...reloadOnChange
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
  game.settings.register(M, 'keepInvisibleWhenBroken', {
    name: 'Keep Invisible Wall Tiles Invisible When Broken',
    hint: 'If enabled, obstacle tiles tagged as invisible (e.g. converted walls created with the invisible option) remain at alpha 0 after being broken. Useful when you want no visual change on the canvas regardless of state.',
    scope: 'world', config: true, type: Boolean, default: false,
  });

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
    name: 'Show Wall Builder Button', hint: 'Show the Wall Builder toolbar button in the Walls layer controls (GM only).',
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
  game.settings.register(M, 'legacySingleCellCollisions', {
    name: 'Legacy Single-Cell Collisions',
    hint: 'When enabled, forced movement collision uses only the top-left corner cell for all tokens regardless of size. Default (off) checks the full footprint for size 2+ tokens: multiple blockers each take damage once, the mover takes damage once; multiple breakable walls are each broken if movement permits, stopping at the hardest wall that cannot be broken.',
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.registerMenu(M, 'installMacros', {
    name: 'Install API Macros', label: 'Install Macros',
    hint: 'Creates a folder of ready-to-use macros for every module API function in your Macros sidebar.',
    icon: 'fas fa-scroll', type: InstallMacrosMenu, restricted: true,
  });
  game.settings.register(M, 'macroPromptMode', {
    name: 'Sample Macro Import Prompt',
    hint: 'Controls when Draw Steel: Combat Tools prompts the GM to import sample macros on initialization.',
    scope: 'world', config: true, type: String,
    choices: {
      'ask':          'Ask on every initialization',
      'skip-update':  'Ask only when the module updates',
      'never':        'Never ask',
    },
    default: 'ask',
  });
  game.settings.register(M, 'macroPromptSeenVersion', { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'macroAutoImport', { scope: 'world', config: false, type: Boolean, default: false });

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
  addHeader('frightenedEnabled', 'Conditions');
  addHeader('bleedingEnabled', 'Bleeding');
  addHeader('showForcedMovementButton', 'Module Buttons');
  addHeader('chatInjectDelay', 'General');
  addHeader('macroPromptMode', 'Setup');

  bindToggle('forcedMovementEnabled', ['animationStepDelay', 'fallDamageCap', 'gmBypassesRangeCheck']);
  bindToggle('grabEnabled', ['gmBypassesSizeCheck', 'restrictGrabButtons', 'grabbedBaneEnabled']);
  bindToggle('deathTrackerEnabled', ['deathAnimationDuration', 'clearSkullsOnCombatEnd', 'clearEffectsOnRevive']);
  bindToggle('autoTriggeredActionsEnabled', ['autoTriggeredActionsTarget']);
  bindToggle('bleedingEnabled', ['bleedingMode']);
  bindToggle('debugMode', ['cornerCutMode', 'legacySingleCellCollisions']);

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

  // 'never': always import silently, no prompt ever.
  if (promptMode === 'never') { await installMacros({ silent: true }); return; }

  // 'skip-update': between updates, import silently if user previously said yes.
  // When a new version is detected, fall through to the prompt so the user can re-evaluate.
  if (promptMode === 'skip-update' && seenVersion === currentVersion) {
    if (autoImport) await installMacros({ silent: true });
    return;
  }

  // 'ask', or 'skip-update' on a new version: show the prompt.
  const content = `
    <p>Would you like to import sample macros for <strong>Draw Steel: Combat Tools</strong>?</p>
    <p>These provide ready-to-use buttons for Forced Movement, Grab, Teleport, and all other module features.</p>
    <div class="form-group" style="margin-top:12px;">
      <label style="flex:0 0 auto;margin-right:8px;">Remember my choice:</label>
      <select id="dsct-macro-prompt-pref" style="flex:1;">
        <option value="ask">Ask me on next initialization</option>
        <option value="skip-update">Don't ask until the next update</option>
        <option value="never">Don't ask again (always import)</option>
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
