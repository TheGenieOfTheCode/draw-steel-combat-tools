import { ImNoThreatSettingsMenu } from '../ability-automation/ability-automation.mjs';
import { WallBuilderSettingsMenu } from '../forced-movement/wall-builder.mjs';
import { StatusIconsMenu } from './status-icons.mjs';
import { STEALTH_WORKFLOW_READY, HANDED_TO_TRIGGERS, triggersHandlesClassTriggers } from '../helpers.mjs';
import { SettingsSubmenu as LibSettingsSubmenu } from '../ctlib.mjs';

const M = 'draw-steel-combat-tools';
const ENRICHER_WIKI = 'https://github.com/MetaMorphic-Digital/draw-steel/wiki/Enrichers';
const WIKI = 'https://github.com/TheGenieOfTheCode/draw-steel-combat-tools/wiki/';
const FILE_PICKER_KEYS = new Set(['judgedEffectIcon', 'markedEffectIcon', 'aidAttackEffectIcon', 'imNoThreatEffectIcon', 'squadTargetingIcon']);

const linkEnrichers = (root) => {
  const word = /\benrichers?\b/gi;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  const linked = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    word.lastIndex = 0;
    const block = n.parentElement?.closest('label, .hint');
    if (!block || linked.has(block) || n.parentElement.closest('a') || !word.test(n.nodeValue)) continue;
    linked.add(block);
    hits.push(n);
  }
  for (const n of hits) {
    word.lastIndex = 0;
    const m = word.exec(n.nodeValue);
    const a = document.createElement('a');
    a.className = 'dsct-enricher-link';
    a.href = ENRICHER_WIKI;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = m[0];
    n.replaceWith(n.nodeValue.slice(0, m.index), a, n.nodeValue.slice(m.index + m[0].length));
  }
};

export class SettingsSubmenu extends LibSettingsSubmenu {
  static get moduleId()         { return M; }
  static get choiceHintPrefix() { return 'DSCT.setting'; }

  _buildEntry(key) {
    const entry = super._buildEntry(key);
    if (entry && FILE_PICKER_KEYS.has(key)) entry.isFilePicker = true;
    return entry;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    linkEnrichers(this.element);
  }
}

const header = (label) => ({ isSectionHeader: true, label });

const nested = (id, icon, lang, opens, extra = {}) => {
  const keys = typeof lang === 'string' ? { name: `${lang}.name`, label: `${lang}.label`, hint: `${lang}.hint` } : lang;
  return {
    isNestedMenu: true, id, icon, opens,
    name:  game.i18n.localize(keys.name),
    label: game.i18n.localize(keys.label),
    hint:  game.i18n.localize(keys.hint),
    ...extra,
  };
};

const compatInfo = (moduleId, nameKey, hintKey) => ({
  isInfo: true,
  name:     game.i18n.localize(nameKey),
  hint:     game.i18n.localize(hintKey),
  isActive: game.modules.get(moduleId)?.active ?? false,
});

const homebrew = (...keys) => (game.settings.get(M, 'homebrewOptions') ? keys : []);

export class AbilityAutomationSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-ability-automation-settings',
    window: { title: 'DSCT.panel.title.AbilityAutomationSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      Targeting: 'Target-Pickers#ability-targeting',
      Areas: 'Ability-Areas-and-Regions',
      areaPicker: 'Target-Pickers#area-picker',
      potencyChecks: 'Potency-Checks',
      'Roll Window': 'Visible-Modifiers#in-the-roll-dialog',
      'Modifiers in Chat': 'Visible-Modifiers#in-chat',
      modifierEditors: 'Visible-Modifiers#the-editors',
      'Damage Rules': 'Visible-Modifiers#damage-multipliers',
      Enrichers: 'Enrichers',
    } };
  }

  static get enableKey() { return 'abilityAutomationEnabled'; }

  static get requires() {
    return { areaPicker: 'abilityTargetingEnabled' };
  }

  static get dependencies() {
    return {
      alwaysRepickTargets: 'abilityTargetingEnabled',
      autoConfirmSelection: 'abilityTargetingEnabled',
      gmBypassRangeEnforcement: 'enforceAbilityRange',
      areaPickerTurnStep: 'areaPicker',
      areaPickerOrigin: 'areaPicker',
      areaPickerPlayerExclude: 'areaPicker',
      abilityTemplateSeconds: 'abilityTemplateCleanup',
      compactChatPills: 'dstdRollPills',
      skipPillEditor: 'modifierEditors',
      advancedEnricherMessages: 'advancedEnrichers',
      compactEnrichers: 'advancedEnrichers',
    };
  }

  static get regularKeys() {
    return [
      'abilityAutomationEnabled',
      header('Targeting'),
      'abilityTargetingEnabled',
      'alwaysRepickTargets',
      'autoConfirmSelection',
      'enforceAbilityRange',
      'gmBypassRangeEnforcement',
      'cancelOnRightClick',
      'targetDistanceLines',
      header('Areas'),
      'areaPicker',
      'areaPickerTurnStep',
      'areaPickerOrigin',
      'areaPickerPlayerExclude',
      'abilityTemplateConfigEnabled',
      'abilityTemplateCleanup',
      'abilityTemplateSeconds',
      header('Applying Results'),
      'autoApplyOwnAbilities',
      'potencyChecks',
      'sortTargetsNearest',
      'hideApplyWord',
      header('Roll Window'),
      'rollDialogPillUI',
      'rollDialogDodge',
      header('Modifiers in Chat'),
      'dstdRollPills',
      'compactChatPills',
      'modifierEditors',
      'skipPillEditor',
      header('Damage Rules'),
      'multiplierOverride',
      'noMultiplierStacking',
      'extraDamageTypes',
      header('Enrichers'),
      'advancedEnrichers',
      'advancedEnricherMessages',
      'compactEnrichers',
      'neutralizeEnrichers',
      header('Class Features'),
      nested('dsct-sub-class-btn', 'fas fa-users-gear', 'DSCT.setting.classFeaturesMenu', ClassFeaturesSettingsMenu),
    ];
  }
}

export class ClassFeaturesSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-class-features-settings',
    window: { title: 'DSCT.panel.title.ClassFeaturesSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      aidAttackAutomation: 'Aid-Attack',
      judgementAutomation: 'Judgement',
      purifyingFireEnabled: 'Purifying-Fire',
      markAutomation: 'Mark',
      hiwEnabled: 'Hesitation-Is-Weakness',
      imNoThreatEnabled: 'Im-No-Threat',
      crossfadeEnabled: 'Crossfade',
    } };
  }

  static get enableKey() { return 'abilityAutomationEnabled'; }

  static get dependencies() {
    return {
      aidAttackEffectIcon: 'aidAttackAutomation',
      judgedEffectIcon: 'judgementAutomation',
      judgementHoldSeconds: 'judgementAutomation',
      markedEffectIcon: 'markAutomation',
      'dsct-sub-animals-btn': 'imNoThreatEnabled',
      imNoThreatEffectIcon: 'imNoThreatEnabled',
      psionicMartialArts: 'nullGrabIntuition',
    };
  }

  static get regularKeys() {
    return [
      header('Maneuvers'),
      'aidAttackAutomation',
      'aidAttackEffectIcon',
      header('Censor'),
      'judgementAutomation',
      'judgedEffectIcon',
      'judgementHoldSeconds',
      'purifyingFireEnabled',
      header('Tactician'),
      'markAutomation',
      'markedEffectIcon',
      header('Shadow'),
      'hiwEnabled',
      'imNoThreatEnabled',
      nested('dsct-sub-animals-btn', 'fas fa-paw', 'DSCT.setting.intAnimalsMenu', ImNoThreatSettingsMenu),
      'imNoThreatEffectIcon',
      ...homebrew('crossfadeEnabled'),
      header('Null'),
      'nullGrabIntuition',
      ...homebrew('psionicMartialArts'),
      header('Malice'),
      'abyssalEvolutionEnabled',
    ];
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (!triggersHandlesClassTriggers()) return;
    for (const name of HANDED_TO_TRIGGERS) {
      const input = this.element.querySelector(`[name="${name}"]`);
      const grp = input?.closest('.form-group');
      if (!grp) continue;
      input.checked = false;
      input.dispatchEvent(new Event('change'));
      grp.classList.add('dsct-sub-disabled');
      grp.querySelectorAll('input, select').forEach(i => { i.disabled = true; });
      if (grp.querySelector('.dsct-handed-note')) continue;
      const note = document.createElement('p');
      note.className = 'hint dsct-sub-note dsct-handed-note';
      note.textContent = game.i18n.localize('DSCT.setting.handedToTriggers');
      grp.append(note);
    }
  }
}

export class FlatEffectsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-flat-effects-settings',
    window: { title: 'DSCT.panel.title.FlatEffectsSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      flatEffectsEnabled: 'Flat-Effects',
    } };
  }

  static get enableKey() { return 'flatEffectsEnabled'; }
  static get intro()     { return game.i18n.localize('DSCT.panel.intro.FlatEffectsSettings'); }

  static get regularKeys() {
    return [
      'flatEffectsEnabled',
      header('Cost'),
      'flatDefaultSpendEnabled',
      'flatDefaultSpendValue',
      header('Damage and Movement'),
      'flatDefaultDamageFormula',
      'flatDefaultDamageType',
      'flatDefaultMovement',
      'flatDefaultForcedDistance',
      header('Conditions'),
      'flatDefaultPotencyStrength',
      'flatDefaultAppliedEnd',
      header('Resources and Healing'),
      'flatDefaultResourceType',
      'flatDefaultResourceAmount',
      'flatDefaultHealAmountType',
      'flatDefaultHealTempStamina',
      header('Cleanse'),
      'flatDefaultCleanseRepeatable',
    ];
  }
}

export class TriggeredActionsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-triggered-actions-settings',
    window: { title: 'DSCT.panel.title.TriggeredActionsSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      autoTriggeredActionsEnabled: 'Triggered-Actions',
    } };
  }

  static get enableKey() { return 'autoTriggeredActionsEnabled'; }

  static get dependencies() {
    return { autoTriggeredActionsTarget: 'autoTriggeredActionsEnabled', triggeredActionsRequireAbility: 'autoTriggeredActionsEnabled' };
  }

  static get regularKeys() {
    return ['autoTriggeredActionsEnabled', 'autoTriggeredActionsTarget', 'triggeredActionsRequireAbility'];
  }
}

export class ConditionsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-conditions-settings',
    window: { title: 'DSCT.panel.title.ConditionsSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      'Chat Buttons': 'Damage-and-Conditions-Panel',
      frightenedEnabled: 'Frightened',
      tauntedEnabled: 'Taunted',
      bleedingEnabled: 'Bleeding',
      recurringDamage: 'Recurring-Damage',
      Grab: 'Grab-System',
    } };
  }

  static get enableKey() { return 'conditionsEnabled'; }

  static get dependencies() {
    return {
      areaDamageEnabled: 'applyDamageEnabled',
      bleedingMode: 'bleedingEnabled',
      gmBypassesSizeCheck: 'grabEnabled',
      restrictGrabButtons: 'grabEnabled',
    };
  }

  static get regularKeys() {
    return [
      'conditionsEnabled',
      nested('dsct-sub-status-icons-btn', 'fas fa-icons',
        { name: 'DSCT.statusIcons.menuName', label: 'DSCT.statusIcons.menuLabel', hint: 'DSCT.statusIcons.menuHint' }, StatusIconsMenu, { free: true }),
      header('Chat Buttons'),
      'appliedEffectEnabled',
      'applyDamageEnabled',
      'areaDamageEnabled',
      'applyToTargets',
      header('Conditions'),
      'frightenedEnabled',
      'tauntedEnabled',
      'judgedMarkedLifetimes',
      'allowIllegalMovement',
      header('Bleeding and Recurring Damage'),
      'bleedingEnabled',
      'bleedingMode',
      'recurringDamage',
      header('Grab'),
      'grabEnabled',
      'gmBypassesSizeCheck',
      'restrictGrabButtons',
    ];
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (!game.modules.get('draw-steel-target-damage')?.active) return;
    const lock = () => {
      for (const name of ['applyDamageEnabled', 'areaDamageEnabled']) {
        const grp = this.element.querySelector(`[name="${name}"]`)?.closest('.form-group');
        if (!grp) continue;
        grp.classList.add('dsct-sub-disabled');
        grp.querySelectorAll('input, select').forEach(i => { i.disabled = true; });
      }
    };
    this.element.addEventListener('change', lock);
    lock();
  }
}

export class ForcedMovementSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-fm-settings',
    window: { title: 'DSCT.panel.title.ForcedMovementSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      Moving: 'Push-Pull-Slide',
      fallConfirmation: 'Vertical-Movement-and-Falls',
      Rules: 'Collision-Rules',
      fallDamageCap: 'Vertical-Movement-and-Falls',
      'Wall Builder': 'Wall-Builder',
    } };
  }

  static get enableKey() { return 'forcedMovementEnabled'; }

  static get dependencies() {
    return { ignoreAllyEnabled: 'friendlyFireConfirmation' };
  }

  static get regularKeys() {
    return [
      'forcedMovementEnabled',
      header('Moving'),
      'animationStepDelay',
      'fmAutoForOwnAbilities',
      header('Confirmations'),
      'fallConfirmation',
      'friendlyFireConfirmation',
      'ignoreAllyEnabled',
      header('Rules'),
      'fallDamageCap',
      'cornerCutMode',
      'allowCrookedPushPull',
      'corpsesBlock',
      'negativeElevationIsBurrowing',
      'statusDrivesMovementType',
      header('Buttons'),
      'fmModifyGmOnly',
      'dstdQuickFmButton',
      header('Wall Builder'),
      nested('dsct-sub-wb-btn', 'fas fa-dungeon', 'DSCT.setting.wallBuilderSettings', WallBuilderSettingsMenu, { gmOnly: true }),
    ];
  }

  static get debugKeys() {
    return ['undoExpirationCheck', 'experimentalObstacleArrow'];
  }
}

export class StealthSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-stealth-settings',
    window: { title: 'DSCT.panel.title.StealthSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      Visuals: 'Stealth-Overview',
      Hiding: 'Hiding-and-Searching',
      Observation: 'Observation-Picker',
      'Cover and Concealment': 'Cover-and-Concealment',
      lowCoverEnabled: 'Cover-and-Concealment#low-cover',
    } };
  }

  static get enableKey() { return 'stealthSystemEnabled'; }

  static get dependencies() {
    return { stealthRevealPromptSeconds: '!stealthAutoReveal' };
  }

  static get regularKeys() {
    return [
      'stealthSystemEnabled',
      header('Visuals'),
      'hiddenMarkers',
      'concealmentBlur',
      ...(STEALTH_WORKFLOW_READY ? [header('Hiding'), 'stealthSneakHouseRule', 'stealthTrueHidden', 'stealthTrueHiddenObjects'] : []),
      ...(STEALTH_WORKFLOW_READY ? [header('Being Revealed'), 'stealthAutoReveal', 'stealthRevealPromptSeconds'] : []),
      header('Observation'),
      'observationRadius',
      'observationAdjacentThreshold',
      header('Cover and Concealment'),
      'coverBaneEnabled',
      'lowCoverEnabled',
    ];
  }
}

export class HomeRulesSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-home-rules-settings',
    window: { title: 'DSCT.panel.title.HomeRulesSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      'Line of Effect': 'Target-Pickers#true-line-of-effect',
      loeCornerMode: 'Cover-and-Concealment#corner-precision',
    } };
  }

  static get dependencies() {
    return { loeCornerMode: 'trueDrawSteelLos', peekRequiresSpeed: 'peekHouseRule', peekDistance: 'peekHouseRule', peekDuration: 'peekHouseRule' };
  }

  static get regularKeys() {
    return [
      header('Line of Effect'),
      'trueDrawSteelLos',
      'loeCornerMode',
      'revealCombatantPositions',
      'greyscaleNoLos',
      header('Peek'),
      'peekHouseRule',
      'peekRequiresSpeed',
      'peekDistance',
      'peekDuration',
    ];
  }
}

export class SquadToolsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-squad-tools-settings',
    window: { title: 'DSCT.panel.title.SquadToolsSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      'Group Actions': 'Squad-Targeting',
      'Squad Labels': 'Squad-Labels',
      Turns: 'Squad-Simultaneous-Turns',
      'Squad HUD': 'Squad-HUD',
    } };
  }

  static get enableKey() { return 'squadToolsEnabled'; }

  static get requires() {
    return { groupActionsEnabled: 'abilityTargetingEnabled' };
  }

  static get dependencies() {
    return {
      squadAutoAssignStaminaPriority: 'groupActionsEnabled',
      squadTargetingIcon: 'groupActionsEnabled',
      squadLabelApplyEffects: 'autoSquadLabelsEnabled',
      squadLabelAutoRelabel: 'autoSquadLabelsEnabled',
      squadLabelCaptainNow: 'autoSquadLabelsEnabled',
      squadCaptainShortcut: 'autoSquadLabelsEnabled',
      squadLabelRenamePreference: 'autoSquadLabelsEnabled',
      squadGlowMarkerColored: 'squadGlowMarker',
      squadHudScale: 'squadHudEnabled',
      squadHudPlayerVisibility: 'squadHudEnabled',
      dstdSquadSectionsOpen: 'dstdSquadSections',
    };
  }

  static get regularKeys() {
    return [
      'squadToolsEnabled',
      header('Group Actions'),
      'groupActionsEnabled',
      'squadAutoAssignStaminaPriority',
      'squadTargetingIcon',
      header('Squad Labels'),
      'autoSquadLabelsEnabled',
      'squadLabelApplyEffects',
      'squadLabelAutoRelabel',
      'squadLabelCaptainNow',
      'squadCaptainShortcut',
      'squadLabelRenamePreference',
      header('Turns'),
      'squadSimultaneousTurns',
      'pairSimultaneousTurns',
      'squadGlowMarker',
      'squadGlowMarkerColored',
      header('Squad HUD'),
      'squadHudEnabled',
      'squadHudScale',
      'squadHudPlayerVisibility',
      header('Damage Panels'),
      'dstdSquadSections',
      'dstdSquadSectionsOpen',
    ];
  }

  static get debugKeys() { return ['stickbugMode', 'stickbugChatTrigger']; }
}

export class PartyToolsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-party-tools-settings',
    window: { title: 'DSCT.panel.title.PartyToolsSettings' },
  };

  static get wiki() {
    return { base: WIKI, pages: {
      partyToolsEnabled: 'Party-Tools',
    } };
  }

  static get enableKey() { return 'partyToolsEnabled'; }

  static get dependencies() {
    return { partyIgnoreDeadLanguages: 'partyShowLanguages' };
  }

  static get regularKeys() {
    return [
      'partyToolsEnabled',
      'partySetupPrompt',
      header('Languages'),
      'partyShowLanguages',
      'partyIgnoreDeadLanguages',
      header('Ignored Picks'),
      'partyPlayersCanPickIgnored',
      'partyIgnoredWarning',
    ];
  }
}

export class ModuleButtonsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-module-buttons-settings',
    window: { title: 'DSCT.panel.title.ModuleButtonsSettings' },
  };

  static get regularKeys() {
    const keys = ['toolboxEnabled', 'showForcedMovementButton', 'showGrabButton', 'showTeleportButton', 'showDamageConditionsButton'];
    if (game.user.isGM) keys.push('showWallBuilderButton');
    return keys;
  }
}

export class CompatibilitySettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-compatibility-settings',
    window: { title: 'DSCT.panel.title.CompatibilitySettings' },
  };

  static get intro() { return game.i18n.localize('DSCT.panel.intro.CompatibilitySettings'); }

  static get regularKeys() {
    const debugMode = game.settings.get(M, 'debugMode');
    const isActive  = (id) => game.modules.get(id)?.active ?? false;
    const keys      = [];

    if (debugMode || isActive('ds-terrain-designer')) {
      keys.push(header('DS Terrain Designer'));
      keys.push('highGroundEnabled');
      keys.push('collisionOnUnitStep');
      keys.push(compatInfo('ds-terrain-designer', 'DSCT.compat.dsTerrain.name', 'DSCT.compat.dsTerrain.hint'));
    }

    if (debugMode || isActive('healthEstimate')) {
      keys.push(header('Health Estimate'));
      keys.push('minionHealthEstimate');
      keys.push(compatInfo('healthEstimate', 'DSCT.compat.healthEstimate.name', 'DSCT.compat.healthEstimate.hint'));
    }

    if (debugMode || isActive('draw-steel-ability-hud')) {
      keys.push(header('Draw Steel: Ability HUD'));
      keys.push(compatInfo('draw-steel-ability-hud', 'DSCT.compat.abilityHud.name', 'DSCT.compat.abilityHud.hint'));
    }

    const autoEntries = [
      compatInfo('tagger',                    'DSCT.compat.tagger.name',          'DSCT.compat.tagger.hint'),
      compatInfo('ds-token-override',         'DSCT.compat.dsTokenOverride.name', 'DSCT.compat.dsTokenOverride.hint'),
      compatInfo('draw-steel-combat-tracker', 'DSCT.compat.dsCombatTracker.name', 'DSCT.compat.dsCombatTracker.hint'),
      compatInfo('ds-movement-lab',           'DSCT.compat.dsMovementLab.name',   'DSCT.compat.dsMovementLab.hint'),
      compatInfo('draw-steel-companion',      'DSCT.compat.dsCompanion.name',     'DSCT.compat.dsCompanion.hint'),
    ].filter(e => debugMode || e.isActive);

    if (autoEntries.length) {
      keys.push(header('Automatic Integrations'));
      keys.push(...autoEntries);
    }

    return keys;
  }

  async render(...args) {
    const debugMode = game.settings.get(M, 'debugMode');
    if (!debugMode && !this.constructor.regularKeys.length) {
      ui.notifications.info(game.i18n.localize('DSCT.notice.noCompatModules'));
      return;
    }
    return super.render(...args);
  }
}
