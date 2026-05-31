import { MATERIAL_RULE_DEFAULTS, WALL_RESTRICTION_DEFAULTS } from '../forced-movement/wall-builder.mjs';
import { InstallMacrosMenu } from '../setup-macros.mjs';
import {
  ForcedMovementSettingsMenu,
  ConditionsSettingsMenu,
  DeathTrackerSettingsMenu,
  TriggeredActionsSettingsMenu,
  AbilityAutomationSettingsMenu,
  ModuleButtonsSettingsMenu,
  HomeRulesSettingsMenu,
  CompatibilitySettingsMenu,
  SquadLabelsSettingsMenu,
  CombatLogsSettingsMenu,
} from './settings-menus.mjs';

export const registerSettings = () => {
  const M = 'draw-steel-combat-tools';
  const L = (key) => game.i18n.localize(`DSCT.setting.${key}`);
  const reloadOnChange = { onChange: () => SettingsConfig.reloadConfirm({ world: true }) };

  game.settings.register(M, 'macroPromptMode', {
    name: L('macroPromptMode.name'),
    hint: L('macroPromptMode.hint'),
    scope: 'world', config: true, type: String,
    choices: {
      'ask':          L('macroPromptMode.choice.ask'),
      'skip-update':  L('macroPromptMode.choice.skipUpdate'),
      'never':        L('macroPromptMode.choice.never'),
    },
    default: 'ask',
  });
  game.settings.register(M, 'macroPromptSeenVersion', { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'macroAutoImport', { scope: 'world', config: false, type: Boolean, default: false });

  game.settings.register(M, 'quickStrikeCompat', {
    name: L('quickStrikeCompat.name'),
    hint: L('quickStrikeCompat.hint'),
    scope: 'world', config: false, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'dstdQuickFmButton', {
    name: L('dstdQuickFmButton.name'), hint: L('dstdQuickFmButton.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'playerCanUndoDstdDeaths', {
    name: L('playerCanUndoDstdDeaths.name'), hint: L('playerCanUndoDstdDeaths.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });

  game.settings.register(M, 'minionHealthEstimate', {
    name: L('minionHealthEstimate.name'), hint: L('minionHealthEstimate.hint'),
    scope: 'world', config: false, type: String,
    choices: {
      'hide':  L('minionHealthEstimate.choice.hide'),
      'count': L('minionHealthEstimate.choice.count'),
      'off':   L('minionHealthEstimate.choice.off'),
    },
    default: 'hide',
    ...reloadOnChange,
  });

  game.settings.register(M, 'debugMode', {
    name: L('debugMode.name'), hint: L('debugMode.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });

  game.settings.registerMenu(M, 'homeRulesSettings', {
    name: L('homeRulesSettings.name'), label: L('homeRulesSettings.label'),
    hint: L('homeRulesSettings.hint'),
    icon: 'fas fa-house-chimney', type: HomeRulesSettingsMenu, restricted: false,
  });
  game.settings.register(M, 'homeRulesEnabled', {
    name: L('homeRulesEnabled.name'), hint: L('homeRulesEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'homebrewOptions', {
    name: L('homebrewOptions.name'), hint: L('homebrewOptions.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });

  game.settings.registerMenu(M, 'compatibilitySettings', {
    name: L('compatibilitySettings.name'), label: L('compatibilitySettings.label'),
    hint: L('compatibilitySettings.hint'),
    icon: 'fas fa-puzzle-piece', type: CompatibilitySettingsMenu, restricted: true,
  });

  game.settings.registerMenu(M, 'forcedMovementSettings', {
    name: L('forcedMovementSettings.name'), label: L('forcedMovementSettings.label'),
    hint: L('forcedMovementSettings.hint'),
    icon: 'fas fa-person-running', type: ForcedMovementSettingsMenu, restricted: true,
  });
  game.settings.register(M, 'forcedMovementEnabled', {
    name: L('forcedMovementEnabled.name'), hint: L('forcedMovementEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'animationStepDelay', {
    name: L('animationStepDelay.name'), hint: L('animationStepDelay.hint'),
    scope: 'world', config: false, type: Number, default: 80, range: { min: 0, max: 500, step: 10 },
  });
  game.settings.register(M, 'fallDamageCap', {
    name: L('fallDamageCap.name'), hint: L('fallDamageCap.hint'),
    scope: 'world', config: false, type: Number, default: 50, range: { min: 10, max: 200, step: 5 },
  });
  game.settings.register(M, 'fallConfirmation', {
    name: L('fallConfirmation.name'), hint: L('fallConfirmation.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'friendlyFireConfirmation', {
    name: L('friendlyFireConfirmation.name'), hint: L('friendlyFireConfirmation.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'ignoreAllyEnabled', {
    name: L('ignoreAllyEnabled.name'), hint: L('ignoreAllyEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'corpsesBlock', {
    name: L('corpsesBlock.name'), hint: L('corpsesBlock.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'fmModifyGmOnly', {
    name: L('fmModifyGmOnly.name'), hint: L('fmModifyGmOnly.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'allowIllegalMovement', {
    name: L('allowIllegalMovement.name'), hint: L('allowIllegalMovement.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'cornerCutMode', {
    name: L('cornerCutMode.name'), hint: L('cornerCutMode.hint'),
    scope: 'world', config: false, type: String,
    choices: { 'block': L('cornerCutMode.choice.block'), 'collide': L('cornerCutMode.choice.collide') },
    default: 'collide',
  });
  game.settings.register(M, 'allowCrookedPushPull', {
    name: L('allowCrookedPushPull.name'), hint: L('allowCrookedPushPull.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'undoExpirationCheck', {
    name: L('undoExpirationCheck.name'), hint: L('undoExpirationCheck.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'cancelOnRightClick', {
    name: L('cancelOnRightClick.name'), hint: L('cancelOnRightClick.hint'),
    scope: 'client', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'experimentalObstacleArrow', {
    name: L('experimentalObstacleArrow.name'), hint: L('experimentalObstacleArrow.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'conditionsEnabled', {
    name: L('conditionsEnabled.name'), hint: L('conditionsEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'grabEnabled', {
    name: L('grabEnabled.name'), hint: L('grabEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'grabbedEffectIcon', {
    name: L('grabbedEffectIcon.name'), hint: L('grabbedEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/skills/melee/unarmed-punch-fist-yellow-red.webp',
  });
  game.settings.register(M, 'grabberEffectIcon', {
    name: L('grabberEffectIcon.name'), hint: L('grabberEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/magic/control/debuff-chains-shackle-movement-red.webp',
  });
  game.settings.register(M, 'gmBypassesSizeCheck', {
    name: L('gmBypassesSizeCheck.name'), hint: L('gmBypassesSizeCheck.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'restrictGrabButtons', {
    name: L('restrictGrabButtons.name'), hint: L('restrictGrabButtons.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.registerMenu(M, 'conditionsSettings', {
    name: L('conditionsSettings.name'), label: L('conditionsSettings.label'),
    hint: L('conditionsSettings.hint'),
    icon: 'fas fa-circle-exclamation', type: ConditionsSettingsMenu, restricted: true,
  });
  game.settings.register(M, 'frightenedEnabled', {
    name: L('frightenedEnabled.name'), hint: L('frightenedEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'frightenedEffectIcon', {
    name: L('frightenedEffectIcon.name'), hint: L('frightenedEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/svg/terror.svg',
  });
  game.settings.register(M, 'tauntedEnabled', {
    name: L('tauntedEnabled.name'), hint: L('tauntedEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'tauntedEffectIcon', {
    name: L('tauntedEffectIcon.name'), hint: L('tauntedEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'systems/draw-steel/assets/icons/flag-banner-fold-fill.svg',
  });
  game.settings.register(M, 'bleedingEnabled', {
    name: L('bleedingEnabled.name'), hint: L('bleedingEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'bleedingEffectIcon', {
    name: L('bleedingEffectIcon.name'), hint: L('bleedingEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/svg/blood.svg',
  });
  game.settings.register(M, 'bleedingMode', {
    name: L('bleedingMode.name'), hint: L('bleedingMode.hint'),
    scope: 'world', config: false, type: String,
    choices: { 'auto': L('bleedingMode.choice.auto'), 'manual': L('bleedingMode.choice.manual') },
    default: 'auto',
  });
  game.settings.register(M, 'areaDamageEnabled', {
    name: L('areaDamageEnabled.name'), hint: L('areaDamageEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'squadStaminaClamp', {
    name: L('squadStaminaClamp.name'), hint: L('squadStaminaClamp.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'appliedEffectEnabled', {
    name: L('appliedEffectEnabled.name'), hint: L('appliedEffectEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'applyDamageEnabled', {
    name: L('applyDamageEnabled.name'), hint: L('applyDamageEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });

  game.settings.registerMenu(M, 'deathTrackerSettings', {
    name: L('deathTrackerSettings.name'), label: L('deathTrackerSettings.label'),
    hint: L('deathTrackerSettings.hint'),
    icon: 'fas fa-skull', type: DeathTrackerSettingsMenu, restricted: false,
  });
  game.settings.register(M, 'deathTrackerEnabled', {
    name: L('deathTrackerEnabled.name'), hint: L('deathTrackerEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'deathTrackerManualMode', {
    name: L('deathTrackerManualMode.name'), hint: L('deathTrackerManualMode.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'deathAnimationDuration', {
    name: L('deathAnimationDuration.name'), hint: L('deathAnimationDuration.hint'),
    scope: 'world', config: false, type: Number, default: 2000, range: { min: 0, max: 5000, step: 100 },
  });
  game.settings.register(M, 'batchAnimationSafety', {
    name: L('batchAnimationSafety.name'), hint: L('batchAnimationSafety.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'clearSkullsOnCombatEnd', {
    name: L('clearSkullsOnCombatEnd.name'), hint: L('clearSkullsOnCombatEnd.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'clearEffectsOnRevive', {
    name: L('clearEffectsOnRevive.name'), hint: L('clearEffectsOnRevive.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'autoAssignDamagedMinion', {
    name: L('autoAssignDamagedMinion.name'), hint: L('autoAssignDamagedMinion.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
    onChange: (value) => { if (value) _minionDeathConflict(); },
  });
  game.settings.register(M, 'pickDeathsEnabled', {
    name: L('pickDeathsEnabled.name'), hint: L('pickDeathsEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'deathPickerDimAll', {
    name: L('deathPickerDimAll.name'), hint: L('deathPickerDimAll.hint'),
    scope: 'client', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'gmControlsAllDeathPickers', {
    name: L('gmControlsAllDeathPickers.name'), hint: L('gmControlsAllDeathPickers.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'cedeDeathPickerToGM', {
    name: L('cedeDeathPickerToGM.name'), hint: L('cedeDeathPickerToGM.hint'),
    scope: 'client', config: false, type: Boolean, default: false,
    onChange: (v) => { if (!game.user?.isGM) game.user?.setFlag(M, 'cedeDeathPickerToGM', v); },
  });
  game.settings.register(M, 'overrideMinionDefeat', {
    name: L('overrideMinionDefeat.name'), hint: L('overrideMinionDefeat.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'cleanOrphanedCombatants', {
    name: L('cleanOrphanedCombatants.name'), hint: L('cleanOrphanedCombatants.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'deathTrackerSkullIds', { scope: 'world', config: false, type: Array, default: [] });
  
  game.settings.register(M, 'skullEnabled', { scope: 'world', config: false, type: Boolean, default: false });
  game.settings.register(M, 'skullIcon',    { scope: 'world', config: false, type: String,  default: '' });
  game.settings.register(M, 'deathMarkerEnabled', {
    name: L('deathMarkerEnabled.name'), hint: L('deathMarkerEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'deathMarkerIcon', {
    name: L('deathMarkerIcon.name'), hint: L('deathMarkerIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/commodities/bones/skull-hollow-worn-blue.webp',
  });
  Hooks.once('ready', async () => {
    if (!game.users.activeGM?.isSelf) return;
    const oldEnabled = game.settings.get(M, 'skullEnabled');
    const oldIcon    = game.settings.get(M, 'skullIcon');
    if (oldEnabled) {
      await game.settings.set(M, 'deathMarkerEnabled', true);
      await game.settings.set(M, 'skullEnabled', false);
    }
    if (oldIcon) {
      await game.settings.set(M, 'deathMarkerIcon', oldIcon);
      await game.settings.set(M, 'skullIcon', '');
    }
  });

  game.settings.registerMenu(M, 'squadLabelsSettings', {
    name: L('squadLabelsSettings.name'), label: L('squadLabelsSettings.label'),
    hint: L('squadLabelsSettings.hint'),
    icon: 'fas fa-tags', type: SquadLabelsSettingsMenu, restricted: true,
  });
  game.settings.register(M, 'autoSquadLabelsEnabled', {
    name: L('autoSquadLabelsEnabled.name'), hint: L('autoSquadLabelsEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'squadLabelAutoRelabel', {
    name: L('squadLabelAutoRelabel.name'), hint: L('squadLabelAutoRelabel.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'squadLabelCaptainNow', {
    name: L('squadLabelCaptainNow.name'), hint: L('squadLabelCaptainNow.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'squadCaptainShortcut', {
    name: L('squadCaptainShortcut.name'), hint: L('squadCaptainShortcut.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'squadSimultaneousTurns', {
    name: L('squadSimultaneousTurns.name'), hint: L('squadSimultaneousTurns.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'squadHudEnabled', {
    name: L('squadHudEnabled.name'), hint: L('squadHudEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'squadHudPlayerVisibility', {
    name: L('squadHudPlayerVisibility.name'), hint: L('squadHudPlayerVisibility.hint'),
    scope: 'world', config: false, type: String,
    choices: {
      'all':  L('squadHudPlayerVisibility.choice.all'),
      'bar':  L('squadHudPlayerVisibility.choice.bar'),
      'none': L('squadHudPlayerVisibility.choice.none'),
    },
    default: 'all',
  });
  game.settings.register(M, 'stickbugMode', {
    name: L('stickbugMode.name'), hint: L('stickbugMode.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'stickbugChatTrigger', {
    name: L('stickbugChatTrigger.name'), hint: L('stickbugChatTrigger.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });

  game.settings.registerMenu(M, 'triggeredActionsSettings', {
    name: L('triggeredActionsSettings.name'), label: L('triggeredActionsSettings.label'),
    hint: L('triggeredActionsSettings.hint'),
    icon: 'fas fa-bolt', type: TriggeredActionsSettingsMenu, restricted: true,
  });
  game.settings.register(M, 'autoTriggeredActionsEnabled', {
    name: L('autoTriggeredActionsEnabled.name'), hint: L('autoTriggeredActionsEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'autoTriggeredActionsTarget', {
    name: L('autoTriggeredActionsTarget.name'), hint: L('autoTriggeredActionsTarget.hint'),
    scope: 'world', config: false, type: String,
    choices: {
      'ALL':    L('autoTriggeredActionsTarget.choice.ALL'),
      'HEROES': L('autoTriggeredActionsTarget.choice.HEROES'),
      'NPCS':   L('autoTriggeredActionsTarget.choice.NPCS'),
    },
    default: 'ALL',
  });
  game.settings.register(M, 'triggeredActionsRequireAbility', {
    name: L('triggeredActionsRequireAbility.name'), hint: L('triggeredActionsRequireAbility.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });

  game.settings.registerMenu(M, 'abilityAutomationSettings', {
    name: L('abilityAutomationSettings.name'), label: L('abilityAutomationSettings.label'),
    hint: L('abilityAutomationSettings.hint'),
    icon: 'fas fa-wand-magic-sparkles', type: AbilityAutomationSettingsMenu, restricted: true,
  });

  game.settings.registerMenu(M, 'combatLogsSettings', {
    name: L('combatLogsSettings.name'), label: L('combatLogsSettings.label'),
    hint: L('combatLogsSettings.hint'),
    icon: 'fas fa-clipboard-list', type: CombatLogsSettingsMenu, restricted: true,
  });
  game.settings.register(M, 'combatTurnLog', {
    name: L('combatTurnLog.name'), hint: L('combatTurnLog.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'combatRoundLog', {
    name: L('combatRoundLog.name'), hint: L('combatRoundLog.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });

  game.settings.register(M, 'abilityAutomationEnabled', {
    name: L('abilityAutomationEnabled.name'), hint: L('abilityAutomationEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'judgementAutomation', {
    name: L('judgementAutomation.name'), hint: L('judgementAutomation.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'judgedEffectIcon', {
    name: L('judgedEffectIcon.name'), hint: L('judgedEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/magic/death/skull-humanoid-white-red.webp',
  });
  game.settings.register(M, 'judgementBaneLock', {
    name: L('judgementBaneLock.name'), hint: L('judgementBaneLock.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'judgementBaneLockDuration', {
    name: L('judgementBaneLockDuration.name'), hint: L('judgementBaneLockDuration.hint'),
    scope: 'world', config: false, type: Number, default: 10,
  });
  game.settings.register(M, 'markAutomation', {
    name: L('markAutomation.name'), hint: L('markAutomation.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'markedEffectIcon', {
    name: L('markedEffectIcon.name'), hint: L('markedEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/skills/targeting/crosshair-pointed-orange.webp',
  });
  game.settings.register(M, 'aidAttackAutomation', {
    name: L('aidAttackAutomation.name'), hint: L('aidAttackAutomation.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'aidAttackEffectIcon', {
    name: L('aidAttackEffectIcon.name'), hint: L('aidAttackEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/skills/social/diplomacy-handshake-blue.webp',
  });
  game.settings.register(M, 'imNoThreatEnabled', {
    name: L('imNoThreatEnabled.name'), hint: L('imNoThreatEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'imNoThreatEffectIcon', {
    name: L('imNoThreatEffectIcon.name'), hint: L('imNoThreatEffectIcon.hint'),
    scope: 'world', config: false, type: String, default: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
  });
  game.settings.register(M, 'abyssalEvolutionEnabled', {
    name: L('abyssalEvolutionEnabled.name'), hint: L('abyssalEvolutionEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'crossfadeEnabled', {
    name: L('crossfadeEnabled.name'), hint: L('crossfadeEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'hiwEnabled', {
    name: L('hiwEnabled.name'), hint: L('hiwEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'purifyingFireEnabled', {
    name: L('purifyingFireEnabled.name'), hint: L('purifyingFireEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'neutralizeEnrichers', {
    name: L('neutralizeEnrichers.name'), hint: L('neutralizeEnrichers.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'autoConfirmSelection', {
    name: L('autoConfirmSelection.name'), hint: L('autoConfirmSelection.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'rollDialogPillUI', {
    name: L('rollDialogPillUI.name'), hint: L('rollDialogPillUI.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'highGroundEnabled', {
    name: L('highGroundEnabled.name'), hint: L('highGroundEnabled.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'enforceAbilityRange', {
    name: L('enforceAbilityRange.name'), hint: L('enforceAbilityRange.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'gmBypassRangeEnforcement', {
    name: L('gmBypassRangeEnforcement.name'), hint: L('gmBypassRangeEnforcement.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'intAnimals', { scope: 'world', config: false, type: Array, default: [] });

  game.settings.register(M, 'teleportEnabled', {
    name: L('teleportEnabled.name'), hint: L('teleportEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'materialRules',         { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS) });
  game.settings.register(M, 'wallRestrictions',      { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS) });
  game.settings.register(M, 'wbDefaultMaterial',     { scope: 'world', config: false, type: String, default: 'stone' });
  game.settings.register(M, 'wbDefaultHeightBottom', { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'wbDefaultHeightTop',    { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'customMaterials',       { scope: 'world', config: false, type: Array,  default: [] });
  game.settings.register(M, 'rubbleInvisible', {
    name: L('rubbleInvisible.name'), hint: L('rubbleInvisible.hint'),
    scope: 'world', config: false, type: Boolean, default: false,
  });

  game.settings.registerMenu(M, 'moduleButtonsSettings', {
    name: L('moduleButtonsSettings.name'), label: L('moduleButtonsSettings.label'),
    hint: L('moduleButtonsSettings.hint'),
    icon: 'fas fa-toolbox', type: ModuleButtonsSettingsMenu, restricted: false,
  });
  game.settings.register(M, 'toolboxEnabled', {
    name: L('toolboxEnabled.name'), hint: L('toolboxEnabled.hint'),
    scope: 'client', config: false, type: Boolean, default: false,
  });
  game.settings.register(M, 'showForcedMovementButton', {
    name: L('showForcedMovementButton.name'), hint: L('showForcedMovementButton.hint'),
    scope: 'client', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'showGrabButton', {
    name: L('showGrabButton.name'), hint: L('showGrabButton.hint'),
    scope: 'client', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'showTeleportButton', {
    name: L('showTeleportButton.name'), hint: L('showTeleportButton.hint'),
    scope: 'client', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'showDamageConditionsButton', {
    name: L('showDamageConditionsButton.name'), hint: L('showDamageConditionsButton.hint'),
    scope: 'client', config: false, type: Boolean, default: true,
  });
  game.settings.register(M, 'showWallBuilderButton', {
    name: L('showWallBuilderButton.name'), hint: L('showWallBuilderButton.hint'),
    scope: 'world', config: false, type: Boolean, default: true,
  });

  game.settings.registerMenu(M, 'installMacros', {
    name: L('installMacros.name'), label: L('installMacros.label'),
    hint: L('installMacros.hint'),
    icon: 'fas fa-scroll', type: InstallMacrosMenu, restricted: true,
  });
};

const _DSCT = 'draw-steel-combat-tools';
const _DSCT_KEY = 'overrideMinionDefeat';
const _DSCT_CT = 'draw-steel-target-damage';
const _DSCT_CT_KEY = 'minionDamageAutomation';

const _minionDeathConflict = () => {
  if (!game.users.activeGM?.isSelf) return;
  if (!game.modules.get(_DSCT_CT)?.active) return;
  let theirValue;
  try { theirValue = game.settings.get(_DSCT_CT, _DSCT_CT_KEY); } catch { return; }
  if (!theirValue || !game.settings.get(_DSCT, _DSCT_KEY)) return;
  game.settings.set(_DSCT, _DSCT_KEY, false);
  
  const menu = foundry.applications.instances?.get('dsct-death-tracker-settings');
  const cb   = menu?.element?.querySelector(`[name="${_DSCT_KEY}"]`);
  if (cb) cb.checked = false;
  ui.notifications.warn(game.i18n.localize('DSCT.notice.conflict.minionDeath'));
};

const _dstdQuickStrikeConflict = () => {
  if (!game.users.activeGM?.isSelf) return;
  if (!game.modules.get('draw-steel-target-damage')?.active) return;
  if (!game.modules.get('ds-quick-strike')?.active) return;
  if (!game.settings.get(_DSCT, 'quickStrikeCompat')) return;
  game.settings.set(_DSCT, 'quickStrikeCompat', false);
  const menu = foundry.applications.instances?.get('dsct-compatibility-settings');
  const cb   = menu?.element?.querySelector('[name="quickStrikeCompat"]');
  if (cb) cb.checked = false;
  ui.notifications.warn(game.i18n.localize('DSCT.notice.conflict.dstdQuickStrike'));
};

export const registerCompatibilityChecks = () => {
  Hooks.once('ready', () => {
    _minionDeathConflict();
    _dstdQuickStrikeConflict();
  });
  Hooks.on('updateSetting', (setting) => {
    if (setting.key === `${_DSCT_CT}.${_DSCT_CT_KEY}`) {
      if (!setting.value) return;
      _minionDeathConflict();
    }
    if (setting.key === `${_DSCT}.overrideMinionDefeat` && setting.value) {
      _minionDeathConflict();
    }
  });
};
