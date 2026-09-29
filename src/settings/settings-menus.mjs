import { ImNoThreatSettingsMenu } from '../ability-automation/ability-automation.mjs';
import { WallBuilderSettingsMenu } from '../forced-movement/wall-builder.mjs';
import { STEALTH_WORKFLOW_READY } from '../helpers.mjs';
import { SettingsSubmenu as LibSettingsSubmenu } from '../ctlib.mjs';

const M = 'draw-steel-combat-tools';
export class SettingsSubmenu extends LibSettingsSubmenu {
  static get moduleId()         { return M; }
  static get choiceHintPrefix() { return 'DSCT.setting'; }
}

const header = (label) => ({ isSectionHeader: true, label });

const compatInfo = (moduleId, nameKey, hintKey) => ({
  isInfo: true,
  name:     game.i18n.localize(nameKey),
  hint:     game.i18n.localize(hintKey),
  isActive: game.modules.get(moduleId)?.active ?? false,
});

export class ForcedMovementSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-fm-settings',
    window: { title: 'DSCT.panel.title.ForcedMovementSettings' },
  };

  static get enableKey()   { return 'forcedMovementEnabled'; }

  static get regularKeys() {
    return ['forcedMovementEnabled', 'animationStepDelay', 'fallConfirmation', 'friendlyFireConfirmation', 'fmModifyGmOnly', 'dstdQuickFmButton'];
  }

  static get debugKeys() {
    return ['undoExpirationCheck', 'experimentalObstacleArrow'];
  }

  _regularItems() {
    const items = super._regularItems();
    items.push({
      isNestedMenu: true,
      id:    'dsct-sub-wb-btn',
      icon:  'fas fa-dungeon',
      name:  game.i18n.localize('DSCT.setting.wallBuilderSettings.name'),
      label: game.i18n.localize('DSCT.setting.wallBuilderSettings.label'),
      hint:  game.i18n.localize('DSCT.setting.wallBuilderSettings.hint'),
    });
    return items;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el         = this.element;
    const wbBtn      = el.querySelector('#dsct-sub-wb-btn');
    const enableInput = el.querySelector(`[name="${this.constructor.enableKey}"]`);

    const syncWbBtn = () => {
      const on = enableInput?.checked ?? true;
      if (wbBtn) wbBtn.disabled = !on;
      wbBtn?.closest('.form-group')?.classList.toggle('dsct-sub-disabled', !on);
    };
    enableInput?.addEventListener('change', syncWbBtn);
    syncWbBtn();

    wbBtn?.addEventListener('click', () => new WallBuilderSettingsMenu().render(true));
  }
}

export class ConditionsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-conditions-settings',
    window: { title: 'DSCT.panel.title.ConditionsSettings' },
  };

  static get enableKey()   { return 'conditionsEnabled'; }

  static get regularKeys() {
    return [
      'conditionsEnabled',
      'appliedEffectEnabled',
      'applyDamageEnabled',
      'neutralizeEnrichers',
      header('Frightened'),
      'frightenedEnabled',
      'frightenedEffectIcon',
      'allowIllegalMovement',
      header('Taunted'),
      'tauntedEnabled',
      'tauntedEffectIcon',
      header('Bleeding'),
      'bleedingEnabled',
      'bleedingEffectIcon',
      'bleedingMode',
      header('Grab'),
      'grabEnabled',
      'grabbedEffectIcon',
      'grabberEffectIcon',
      'gmBypassesSizeCheck',
      'restrictGrabButtons',
      'allowIllegalMovement',
      header('Area Damage'),
      'areaDamageEnabled',
    ];
  }

  static _FILE_PICKER_KEYS = new Set(['frightenedEffectIcon', 'tauntedEffectIcon', 'bleedingEffectIcon', 'grabbedEffectIcon', 'grabberEffectIcon']);

  _buildEntry(key) {
    const entry = super._buildEntry(key);
    if (entry && ConditionsSettingsMenu._FILE_PICKER_KEYS.has(key)) entry.isFilePicker = true;
    return entry;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const illegalToggles = [...this.element.querySelectorAll('[name="allowIllegalMovement"]')];
    for (const toggle of illegalToggles) {
      toggle.addEventListener('change', () => {
        for (const other of illegalToggles) {
          if (other !== toggle) other.checked = toggle.checked;
        }
      });
    }

    const enableInput = this.element.querySelector(`[name="${this.constructor.enableKey}"]`);
    const iconPairs = [
      ['frightenedEnabled', 'frightenedEffectIcon'],
      ['tauntedEnabled',    'tauntedEffectIcon'],
      ['bleedingEnabled',   'bleedingEffectIcon'],
      ['grabEnabled',       'grabbedEffectIcon'],
      ['grabEnabled',       'grabberEffectIcon'],
    ];
    for (const [toggleName, iconKey] of iconPairs) {
      const toggle    = this.element.querySelector(`[name="${toggleName}"]`);
      const iconGroup = this.element.querySelector(`[name="${iconKey}"]`)?.closest('.form-group');
      if (!toggle || !iconGroup) continue;
      const sync = () => {
        const on = (enableInput?.checked ?? true) && toggle.checked;
        iconGroup.classList.toggle('dsct-sub-disabled', !on);
        iconGroup.querySelectorAll('input, button').forEach(i => { i.disabled = !on; });
      };
      toggle.addEventListener('change', sync);
      enableInput?.addEventListener('change', sync);
      sync();
    }

    const bleedToggle = this.element.querySelector('[name="bleedingEnabled"]');
    const modeGroup   = this.element.querySelector('[name="bleedingMode"]')?.closest('.form-group');
    if (bleedToggle && modeGroup) {
      const sync = () => {
        const on = (enableInput?.checked ?? true) && bleedToggle.checked;
        modeGroup.classList.toggle('dsct-sub-disabled', !on);
        const sel = modeGroup.querySelector('select');
        if (sel) sel.disabled = !on;
      };
      bleedToggle.addEventListener('change', sync);
      enableInput?.addEventListener('change', sync);
      sync();
    }

    const applyDmgToggle  = this.element.querySelector('[name="applyDamageEnabled"]');
    const areaDmgGroup    = this.element.querySelector('[name="areaDamageEnabled"]')?.closest('.form-group');
    if (applyDmgToggle && areaDmgGroup) {
      const sync = () => {
        const on = (enableInput?.checked ?? true) && applyDmgToggle.checked;
        areaDmgGroup.classList.toggle('dsct-sub-disabled', !on);
        const cb = areaDmgGroup.querySelector('input');
        if (cb) cb.disabled = !on;
      };
      applyDmgToggle.addEventListener('change', sync);
      enableInput?.addEventListener('change', sync);
      sync();
    }

    if (game.modules.get('draw-steel-target-damage')?.active) {
      for (const name of ['applyDamageEnabled', 'areaDamageEnabled']) {
        const grp = this.element.querySelector(`[name="${name}"]`)?.closest('.form-group');
        if (!grp) continue;
        grp.classList.add('dsct-sub-disabled');
        grp.querySelectorAll('input, select').forEach(i => { i.disabled = true; });
      }
    }
  }
}

export class StealthSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-stealth-settings',
    window: { title: 'DSCT.panel.title.StealthSettings' },
  };

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

export class TriggeredActionsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-triggered-actions-settings',
    window: { title: 'DSCT.panel.title.TriggeredActionsSettings' },
  };

  static get enableKey()   { return 'autoTriggeredActionsEnabled'; }

  static get regularKeys() {
    return ['autoTriggeredActionsEnabled', 'autoTriggeredActionsTarget', 'triggeredActionsRequireAbility'];
  }
}

export class FlatEffectsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-flat-effects-settings',
    window: { title: 'DSCT.panel.title.FlatEffectsSettings' },
  };

  static get enableKey()   { return 'flatEffectsEnabled'; }

  static get regularKeys() {
    return [
      'flatEffectsEnabled',
      header('Spend Resource Defaults'),
      'flatDefaultSpendEnabled',
      'flatDefaultSpendValue',
      header('Damage Defaults'),
      'flatDefaultDamageFormula',
      'flatDefaultDamageType',
      header('Forced Movement Defaults'),
      'flatDefaultMovement',
      'flatDefaultForcedDistance',
      header('Applied Condition Defaults'),
      'flatDefaultPotencyStrength',
      'flatDefaultAppliedEnd',
      header('Resource Gain Defaults'),
      'flatDefaultResourceType',
      'flatDefaultResourceAmount',
      header('Heal Defaults'),
      'flatDefaultHealAmountType',
      'flatDefaultHealTempStamina',
      header('Cleanse Defaults'),
      'flatDefaultCleanseRepeatable',
    ];
  }
}

export class AbilityAutomationSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-ability-automation-settings',
    window: { title: 'DSCT.panel.title.AbilityAutomationSettings' },
  };

  static get enableKey()   { return 'abilityAutomationEnabled'; }

  static get dependencies() {
    return {
      alwaysRepickTargets: 'abilityTargetingEnabled',
      autoConfirmSelection: 'abilityTargetingEnabled',
      gmBypassRangeEnforcement: 'enforceAbilityRange',
      abilityTemplateSeconds: 'abilityTemplateCleanup',
      squadAutoAssignStaminaPriority: 'groupActionsEnabled',
      squadTargetingIcon: 'groupActionsEnabled',
    };
  }

  static get regularKeys() {
    return [
      'abilityAutomationEnabled',
      header('Targeting'),
      'abilityTargetingEnabled',
      'alwaysRepickTargets',
      'autoConfirmSelection',
      header('Group Actions'),
      'groupActionsEnabled',
      'squadAutoAssignStaminaPriority',
      'squadTargetingIcon',
      header('Ability Range'),
      'enforceAbilityRange',
      'gmBypassRangeEnforcement',
      header('Ability Templates'),
      'abilityTemplateConfigEnabled',
      'abilityTemplateCleanup',
      'abilityTemplateSeconds',
      header('Visible Modifiers'),
      'rollDialogPillUI',
      'dstdRollPills',
      'dstdRollEditor',
      'pillDamageEditor',
      'skipPillEditor',
      'multiplierOverride',
      'noMultiplierStacking',
      header('Enrichers'),
      'neutralizeEnrichers',
      header('Aid Attack'),
      'aidAttackAutomation',
      'aidAttackEffectIcon',
      header('Class: Censor'),
      'judgementAutomation',
      'judgedEffectIcon',
      'judgementBaneLock',
      'judgementBaneLockDuration',
      'purifyingFireEnabled',
      header('Class: Tactician'),
      'markAutomation',
      'markedEffectIcon',
      header('Class: Shadow'),
      'hiwEnabled',
      'imNoThreatEnabled',
      'imNoThreatEffectIcon',
      'crossfadeEnabled',
      header('Class: Null'),
      'nullGrabIntuition',
      'psionicMartialArts',
      header('Malice'),
      'abyssalEvolutionEnabled',
    ];
  }

  static _FILE_PICKER_KEYS = new Set(['judgedEffectIcon', 'markedEffectIcon', 'aidAttackEffectIcon', 'imNoThreatEffectIcon', 'squadTargetingIcon']);

  _buildEntry(key) {
    const entry = super._buildEntry(key);
    if (entry && AbilityAutomationSettingsMenu._FILE_PICKER_KEYS.has(key)) entry.isFilePicker = true;
    return entry;
  }

  _regularItems() {
    const items = super._regularItems();
    const intIdx = items.findIndex(it => it.key === 'imNoThreatEnabled');
    if (intIdx !== -1) {
      items.splice(intIdx + 1, 0, {
        isNestedMenu: true,
        id:    'dsct-sub-animals-btn',
        icon:  'fas fa-paw',
        name:  game.i18n.localize('DSCT.setting.intAnimalsMenu.name'),
        label: game.i18n.localize('DSCT.setting.intAnimalsMenu.label'),
        hint:  game.i18n.localize('DSCT.setting.intAnimalsMenu.hint'),
      });
    }
    return items;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('#dsct-sub-animals-btn')?.addEventListener('click', () => {
      new ImNoThreatSettingsMenu().render(true);
    });

    const enforceInput  = this.element.querySelector('[name="enforceAbilityRange"]');
    const bypassGroup   = this.element.querySelector('[name="gmBypassRangeEnforcement"]')?.closest('.form-group');
    const aaEnableInput = this.element.querySelector(`[name="${this.constructor.enableKey}"]`);
    if (enforceInput && bypassGroup) {
      const sync = () => {
        const on = (aaEnableInput?.checked ?? true) && enforceInput.checked;
        bypassGroup.classList.toggle('dsct-sub-disabled', !on);
        bypassGroup.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
      };
      enforceInput.addEventListener('change', sync);
      aaEnableInput?.addEventListener('change', sync);
      sync();
    }

    const targetingToggle    = this.element.querySelector('[name="abilityTargetingEnabled"]');
    const autoConfirmGroup   = this.element.querySelector('[name="autoConfirmSelection"]')?.closest('.form-group');
    if (targetingToggle && autoConfirmGroup) {
      const syncTargeting = () => {
        const on = (aaEnableInput?.checked ?? true) && targetingToggle.checked;
        autoConfirmGroup.classList.toggle('dsct-sub-disabled', !on);
        autoConfirmGroup.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
      };
      targetingToggle.addEventListener('change', syncTargeting);
      aaEnableInput?.addEventListener('change', syncTargeting);
      syncTargeting();
    }

    const judgementToggle     = this.element.querySelector('[name="judgementAutomation"]');
    const baneLockInput       = this.element.querySelector('[name="judgementBaneLock"]');
    const baneLockGroup       = baneLockInput?.closest('.form-group');
    const baneLockDurGroup    = this.element.querySelector('[name="judgementBaneLockDuration"]')?.closest('.form-group');
    const judgedIconGroup     = this.element.querySelector('[name="judgedEffectIcon"]')?.closest('.form-group');
    if (judgementToggle) {
      const setGroup = (grp, on) => {
        if (!grp) return;
        grp.classList.toggle('dsct-sub-disabled', !on);
        grp.querySelectorAll('input, select, button').forEach(i => { i.disabled = !on; });
      };
      const syncJudgement = () => {
        const on = (aaEnableInput?.checked ?? true) && judgementToggle.checked;
        for (const grp of [baneLockGroup, judgedIconGroup]) setGroup(grp, on);
        setGroup(baneLockDurGroup, on && (baneLockInput?.checked ?? true));
      };
      judgementToggle.addEventListener('change', syncJudgement);
      baneLockInput?.addEventListener('change', syncJudgement);
      aaEnableInput?.addEventListener('change', syncJudgement);
      syncJudgement();
    }

    const markToggle      = this.element.querySelector('[name="markAutomation"]');
    const markedIconGroup = this.element.querySelector('[name="markedEffectIcon"]')?.closest('.form-group');
    if (markToggle && markedIconGroup) {
      const syncMark = () => {
        const on = (aaEnableInput?.checked ?? true) && markToggle.checked;
        markedIconGroup.classList.toggle('dsct-sub-disabled', !on);
        markedIconGroup.querySelectorAll('input, select, button').forEach(i => { i.disabled = !on; });
      };
      markToggle.addEventListener('change', syncMark);
      aaEnableInput?.addEventListener('change', syncMark);
      syncMark();
    }

    const aidAttackToggle    = this.element.querySelector('[name="aidAttackAutomation"]');
    const aidAttackIconGroup = this.element.querySelector('[name="aidAttackEffectIcon"]')?.closest('.form-group');
    if (aidAttackToggle && aidAttackIconGroup) {
      const syncAidAttack = () => {
        const on = (aaEnableInput?.checked ?? true) && aidAttackToggle.checked;
        aidAttackIconGroup.classList.toggle('dsct-sub-disabled', !on);
        aidAttackIconGroup.querySelectorAll('input, select, button').forEach(i => { i.disabled = !on; });
      };
      aidAttackToggle.addEventListener('change', syncAidAttack);
      aaEnableInput?.addEventListener('change', syncAidAttack);
      syncAidAttack();
    }

    const imNoThreatToggle    = this.element.querySelector('[name="imNoThreatEnabled"]');
    const imNoThreatIconGroup = this.element.querySelector('[name="imNoThreatEffectIcon"]')?.closest('.form-group');
    if (imNoThreatToggle && imNoThreatIconGroup) {
      const syncImNoThreat = () => {
        const on = (aaEnableInput?.checked ?? true) && imNoThreatToggle.checked;
        imNoThreatIconGroup.classList.toggle('dsct-sub-disabled', !on);
        imNoThreatIconGroup.querySelectorAll('input, select, button').forEach(i => { i.disabled = !on; });
      };
      imNoThreatToggle.addEventListener('change', syncImNoThreat);
      aaEnableInput?.addEventListener('change', syncImNoThreat);
      syncImNoThreat();
    }

    const homebrewOn     = game.settings.get(M, 'homebrewOptions');
    const crossfadeGroup = this.element.querySelector('[name="crossfadeEnabled"]')?.closest('.form-group');
    if (crossfadeGroup && !homebrewOn) crossfadeGroup.style.display = 'none';

    const psionicGroup     = this.element.querySelector('[name="psionicMartialArts"]')?.closest('.form-group');
    const nullGrabToggle   = this.element.querySelector('[name="nullGrabIntuition"]');
    if (psionicGroup) {
      if (!homebrewOn) {
        psionicGroup.style.display = 'none';
      } else if (nullGrabToggle) {
        const syncPsionic = () => {
          const on = nullGrabToggle.checked;
          psionicGroup.classList.toggle('dsct-sub-disabled', !on);
          psionicGroup.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
        };
        nullGrabToggle.addEventListener('change', syncPsionic);
        syncPsionic();
      }
    }
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

export class HomeRulesSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-home-rules-settings',
    window: { title: 'DSCT.panel.title.HomeRulesSettings' },
  };

  static get enableKey()   { return 'homeRulesEnabled'; }

  static get dependencies() {
    return { peekRequiresSpeed: 'peekHouseRule', peekDistance: 'peekHouseRule', peekDuration: 'peekHouseRule' };
  }

  static get regularKeys() {
    return [
      'homeRulesEnabled',
      'homebrewOptions',
      header('Pickers'),
      'cancelOnRightClick',
      'targetDistanceLines',
      header('Vision'),
      'trueDrawSteelLos',
      'loeCornerMode',
      'revealCombatantPositions',
      'greyscaleNoLos',
      header('Peek'),
      'peekHouseRule',
      'peekRequiresSpeed',
      'peekDistance',
      'peekDuration',
      header('Forced Movement'),
      'fallDamageCap',
      'cornerCutMode',
      'allowCrookedPushPull',
      'ignoreAllyEnabled',
      'corpsesBlock',
      'negativeElevationIsBurrowing',
      'statusDrivesMovementType',
    ];
  }
}

export class CompatibilitySettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-compatibility-settings',
    window: { title: 'DSCT.panel.title.CompatibilitySettings' },
  };

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

export class PartyToolsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-party-tools-settings',
    window: { title: 'DSCT.panel.title.PartyToolsSettings' },
  };

  static get enableKey()   { return 'partyToolsEnabled'; }

  static get regularKeys() {
    return ['partyToolsEnabled', 'partySetupPrompt', 'partyShowLanguages', 'partyIgnoreDeadLanguages',
      'partyPlayersCanPickIgnored', 'partyIgnoredWarning'];
  }
}

export class SquadToolsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-squad-tools-settings',
    window: { title: 'DSCT.panel.title.SquadToolsSettings' },
  };

  static get enableKey()   { return 'squadToolsEnabled'; }

  static get dependencies() {
    return { dstdSquadSectionsOpen: 'dstdSquadSections' };
  }

  static get regularKeys() {
    return [
      'squadToolsEnabled',
      header('Squad Labels'),
      'autoSquadLabelsEnabled',
      'squadLabelApplyEffects',
      'squadLabelAutoRelabel',
      'squadLabelCaptainNow',
      'squadCaptainShortcut',
      'squadLabelRenamePreference',
      header('Simultaneous Turns'),
      'squadSimultaneousTurns',
      'pairSimultaneousTurns',
      header('Subtle Turn Markers'),
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

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    const labelsInput = el.querySelector('[name="autoSquadLabelsEnabled"]');
    const labelKeys   = ['squadLabelApplyEffects', 'squadLabelAutoRelabel', 'squadLabelCaptainNow', 'squadCaptainShortcut', 'squadLabelRenamePreference'];
    const labelGroups = labelKeys.map(k => el.querySelector(`[name="${k}"]`)?.closest('.form-group')).filter(Boolean);
    const syncLabels  = (on) => {
      for (const grp of labelGroups) {
        grp.classList.toggle('dsct-sub-disabled', !on);
        grp.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
      }
    };
    syncLabels(labelsInput?.checked ?? true);
    labelsInput?.addEventListener('change', () => syncLabels(labelsInput.checked));

    const glowInput    = el.querySelector('[name="squadGlowMarker"]');
    const coloredGroup = el.querySelector('[name="squadGlowMarkerColored"]')?.closest('.form-group');
    const syncColored  = (on) => {
      coloredGroup?.classList.toggle('dsct-sub-disabled', !on);
      coloredGroup?.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
    };
    syncColored(glowInput?.checked ?? true);
    glowInput?.addEventListener('change', () => syncColored(glowInput.checked));

    const hudInput     = el.querySelector('[name="squadHudEnabled"]');
    const hudSubKeys   = ['squadHudScale', 'squadHudPlayerVisibility'];
    const hudGroups    = hudSubKeys.map(k => el.querySelector(`[name="${k}"]`)?.closest('.form-group')).filter(Boolean);
    const syncHud      = (on) => {
      for (const grp of hudGroups) {
        grp.classList.toggle('dsct-sub-disabled', !on);
        grp.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
      }
    };
    syncHud(hudInput?.checked ?? true);
    hudInput?.addEventListener('change', () => syncHud(hudInput.checked));
  }
}
