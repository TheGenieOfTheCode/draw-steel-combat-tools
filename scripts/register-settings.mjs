import { WallBuilderSettingsMenu, MATERIAL_RULE_DEFAULTS, WALL_RESTRICTION_DEFAULTS } from './wall-builder.mjs';
import { ImNoThreatSettingsMenu } from './ability-automation.mjs';
import { InstallMacrosMenu } from './setup-macros.mjs';

export const registerSettings = () => {
  const M = 'draw-steel-combat-tools';
  const L = (key) => game.i18n.localize(`DSCT.setting.${key}`);
  const reloadOnChange = { onChange: () => SettingsConfig.reloadConfirm({ world: true }) };

  game.settings.register(M, 'chatInjectDelay', {
    name: L('chatInjectDelay.name'), hint: L('chatInjectDelay.hint'),
    scope: 'world', config: true, type: Number, default: 500, range: { min: 100, max: 2000, step: 100 }, ...reloadOnChange
  });

  game.settings.registerMenu(M, 'installMacros', {
    name: L('installMacros.name'), label: L('installMacros.label'),
    hint: L('installMacros.hint'),
    icon: 'fas fa-scroll', type: InstallMacrosMenu, restricted: true,
  });
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
    scope: 'world', config: game.modules.get('ds-quick-strike')?.active ?? false, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'forcedMovementEnabled', {
    name: L('forcedMovementEnabled.name'), hint: L('forcedMovementEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'animationStepDelay', {
    name: L('animationStepDelay.name'), hint: L('animationStepDelay.hint'),
    scope: 'world', config: true, type: Number, default: 80, range: { min: 0, max: 500, step: 10 }, ...reloadOnChange
  });
  game.settings.register(M, 'fallDamageCap', {
    name: L('fallDamageCap.name'), hint: L('fallDamageCap.hint'),
    scope: 'world', config: true, type: Number, default: 50, range: { min: 10, max: 200, step: 5 }, ...reloadOnChange
  });
  game.settings.register(M, 'gmBypassesRangeCheck', {
    name: L('gmBypassesRangeCheck.name'), hint: L('gmBypassesRangeCheck.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'fmModifyGmOnly', {
    name: L('fmModifyGmOnly.name'), hint: L('fmModifyGmOnly.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'grabEnabled', {
    name: L('grabEnabled.name'), hint: L('grabEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'gmBypassesSizeCheck', {
    name: L('gmBypassesSizeCheck.name'), hint: L('gmBypassesSizeCheck.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'restrictGrabButtons', {
    name: L('restrictGrabButtons.name'), hint: L('restrictGrabButtons.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'grabbedBaneEnabled', {
    name: L('grabbedBaneEnabled.name'), hint: L('grabbedBaneEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'allowIllegalMovement', {
    name: L('allowIllegalMovement.name'), hint: L('allowIllegalMovement.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'frightenedEnabled', {
    name: L('frightenedEnabled.name'), hint: L('frightenedEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'tauntedEnabled', {
    name: L('tauntedEnabled.name'), hint: L('tauntedEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'bleedingEnabled', {
    name: L('bleedingEnabled.name'), hint: L('bleedingEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'bleedingMode', {
    name: L('bleedingMode.name'),
    hint: L('bleedingMode.hint'),
    scope: 'world', config: true, type: String,
    choices: { 'auto': L('bleedingMode.choice.auto'), 'manual': L('bleedingMode.choice.manual') },
    default: 'auto', ...reloadOnChange
  });

  game.settings.register(M, 'deathTrackerEnabled', {
    name: L('deathTrackerEnabled.name'), hint: L('deathTrackerEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'deathAnimationDuration', {
    name: L('deathAnimationDuration.name'), hint: L('deathAnimationDuration.hint'),
    scope: 'world', config: true, type: Number, default: 2000, range: { min: 0, max: 5000, step: 100 }, ...reloadOnChange
  });
  game.settings.register(M, 'clearSkullsOnCombatEnd', {
    name: L('clearSkullsOnCombatEnd.name'), hint: L('clearSkullsOnCombatEnd.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'clearEffectsOnRevive', {
    name: L('clearEffectsOnRevive.name'), hint: L('clearEffectsOnRevive.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'autoAssignDamagedMinion', {
    name: L('autoAssignDamagedMinion.name'),
    hint: L('autoAssignDamagedMinion.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'overrideMinionDefeat', {
    name: L('overrideMinionDefeat.name'),
    hint: L('overrideMinionDefeat.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'deathTrackerSkullIds', { scope: 'world', config: false, type: Array, default: [] });

  game.settings.register(M, 'autoSquadLabelsEnabled', {
    name: L('autoSquadLabelsEnabled.name'), hint: L('autoSquadLabelsEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'autoTriggeredActionsEnabled', {
    name: L('autoTriggeredActionsEnabled.name'), hint: L('autoTriggeredActionsEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'autoTriggeredActionsTarget', {
    name: L('autoTriggeredActionsTarget.name'), hint: L('autoTriggeredActionsTarget.hint'),
    scope: 'world', config: true, type: String,
    choices: {
      'ALL':   L('autoTriggeredActionsTarget.choice.ALL'),
      'HEROES': L('autoTriggeredActionsTarget.choice.HEROES'),
      'NPCS':  L('autoTriggeredActionsTarget.choice.NPCS'),
    },
    default: 'ALL', ...reloadOnChange
  });
  game.settings.register(M, 'triggeredActionsRequireAbility', {
    name: L('triggeredActionsRequireAbility.name'), hint: L('triggeredActionsRequireAbility.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'teleportEnabled', {
    name: L('teleportEnabled.name'), hint: L('teleportEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'judgementAutomation', {
    name: L('judgementAutomation.name'), hint: L('judgementAutomation.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'markAutomation', {
    name: L('markAutomation.name'), hint: L('markAutomation.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'aidAttackAutomation', {
    name: L('aidAttackAutomation.name'), hint: L('aidAttackAutomation.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'imNoThreatEnabled', {
    name: L('imNoThreatEnabled.name'), hint: L('imNoThreatEnabled.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'intAnimals', { scope: 'world', config: false, type: Array, default: [] });
  game.settings.registerMenu(M, 'intAnimalsMenu', {
    name: L('intAnimalsMenu.name'),
    label: L('intAnimalsMenu.label'),
    hint: L('intAnimalsMenu.hint'),
    icon: 'fas fa-paw',
    type: ImNoThreatSettingsMenu,
    restricted: true,
  });


  game.settings.registerMenu(M, 'wallBuilderSettings', { name: L('wallBuilderSettings.name'), label: L('wallBuilderSettings.label'), hint: L('wallBuilderSettings.hint'), icon: 'fas fa-dungeon', type: WallBuilderSettingsMenu, restricted: true });
  game.settings.register(M, 'materialRules',         { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS) });
  game.settings.register(M, 'wallRestrictions',      { scope: 'world', config: false, type: Object, default: foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS) });
  game.settings.register(M, 'wbDefaultMaterial',     { scope: 'world', config: false, type: String, default: 'stone' });
  game.settings.register(M, 'wbDefaultHeightBottom', { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'wbDefaultHeightTop',    { scope: 'world', config: false, type: String, default: '' });
  game.settings.register(M, 'customMaterials',       { scope: 'world', config: false, type: Array,  default: [] });
  game.settings.register(M, 'keepInvisibleWhenBroken', { name: L('keepInvisibleWhenBroken.name'), hint: L('keepInvisibleWhenBroken.hint'), scope: 'world', config: true, type: Boolean, default: false });
  game.settings.register(M, 'showWallBuilderButton', { name: L('showWallBuilderButton.name'), hint: L('showWallBuilderButton.hint'), scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange });

  game.settings.register(M, 'showForcedMovementButton', {
    name: L('showForcedMovementButton.name'), hint: L('showForcedMovementButton.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showGrabButton', {
    name: L('showGrabButton.name'), hint: L('showGrabButton.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showTeleportButton', {
    name: L('showTeleportButton.name'), hint: L('showTeleportButton.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showPowerWordKillButton', {
    name: L('showPowerWordKillButton.name'), hint: L('showPowerWordKillButton.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });
  game.settings.register(M, 'showDamageConditionsButton', {
    name: L('showDamageConditionsButton.name'), hint: L('showDamageConditionsButton.hint'),
    scope: 'world', config: true, type: Boolean, default: true, ...reloadOnChange
  });

  game.settings.register(M, 'debugMode', {
    name: L('debugMode.name'), hint: L('debugMode.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'cornerCutMode', {
    name: L('cornerCutMode.name'),
    hint: L('cornerCutMode.hint'),
    scope: 'world', config: true, type: String,
    choices: { 'block': L('cornerCutMode.choice.block'), 'collide': L('cornerCutMode.choice.collide') },
    default: 'collide', ...reloadOnChange
  });
  game.settings.register(M, 'legacySingleCellCollisions', {
    name: L('legacySingleCellCollisions.name'),
    hint: L('legacySingleCellCollisions.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
  game.settings.register(M, 'allowCrookedPushPull', {
    name: L('allowCrookedPushPull.name'),
    hint: L('allowCrookedPushPull.hint'),
    scope: 'world', config: true, type: Boolean, default: false, ...reloadOnChange
  });
};
