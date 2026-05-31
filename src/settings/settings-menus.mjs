import { ImNoThreatSettingsMenu } from '../ability-automation/ability-automation.mjs';
import { WallBuilderSettingsMenu } from '../forced-movement/wall-builder.mjs';
import { getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';

class SettingsSubmenu extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    classes:  ['draw-steel'],
    window:   { minimizable: false, resizable: true },
    position: { width: 640, height: 'auto' },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/settings/settings-submenu.hbs' },
  };

  static get regularKeys() { return []; }
  static get debugKeys()   { return []; }
  static get enableKey()   { return null; }

  async _prepareContext(_options) {
    const debugMode    = game.settings.get(M, 'debugMode');
    const debugEntries = debugMode ? this.constructor.debugKeys.map(k => this._buildEntry(k)).filter(Boolean) : [];
    return {
      items: [
        ...this._regularItems(),
        ...(debugEntries.length ? [{ isDebugHeader: true }] : []),
        ...debugEntries,
      ],
    };
  }

  _regularItems() {
    const entries = this.constructor.regularKeys.map(k => this._buildEntry(k));
    const result = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      if (e.isSectionHeader) {
        let hasContent = false;
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[j]?.isSectionHeader) break;
          if (entries[j]) { hasContent = true; break; }
        }
        if (!hasContent) continue;
      }
      result.push(e);
    }
    return result;
  }

  _buildEntry(key) {
    
    if (key && typeof key === 'object') return key;
    const def = game.settings.settings.get(`${M}.${key}`);
    if (!def) return null;
    if (!game.user.isGM && def.scope === 'world') return null;
    const value = game.settings.get(M, key);
    return {
      key,
      name:           game.i18n.localize(def.name),
      hint:           game.i18n.localize(def.hint),
      isBoolean:      def.type === Boolean,
      isSelect:       !!def.choices,
      isRange:        !!def.range,
      isNumber:       def.type === Number && !def.range,
      isEnableToggle: key === this.constructor.enableKey,
      value,
      choices:   def.choices
        ? Object.entries(def.choices).map(([v, l]) => ({ value: v, label: game.i18n.localize(l), selected: v === value }))
        : null,
      range: def.range ?? null,
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
    const el = this.element;

    el.querySelectorAll('input[type="range"]').forEach(input => {
      const display = el.querySelector(`#dsct-sub-val-${input.name}`);
      if (display) input.addEventListener('input', () => { display.textContent = input.value; });
    });

    const enableKey = this.constructor.enableKey;
    if (enableKey) {
      const enableInput = el.querySelector(`[name="${enableKey}"]`);
      if (enableInput) {
        const syncDisabled = () => {
          const on = enableInput.checked;
          el.querySelectorAll('.form-group').forEach(grp => {
            const first = grp.querySelector('input, select');
            if (!first || first === enableInput) return;
            grp.classList.toggle('dsct-sub-disabled', !on);
            grp.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
          });
        };
        enableInput.addEventListener('change', syncDisabled);
        syncDisabled();
      }
    }

    el.querySelectorAll('.dsct-fp-btn').forEach(btn => {
      const input   = el.querySelector(`[name="${btn.dataset.target}"]`);
      const preview = btn.closest('.form-fields')?.querySelector('.dsct-icon-preview');
      input?.addEventListener('input', () => { if (preview) preview.src = input.value; });
      btn.addEventListener('click', () => {
        new FilePicker({
          type: 'imagevideo',
          current: input?.value ?? '',
          callback: (path) => {
            if (input)   input.value = path;
            if (preview) preview.src = path;
          },
        }).render(true);
      });
    });

    el.querySelector('#dsct-sub-save-btn')?.addEventListener('click', async () => {
      await this._doSave();
      this.close();
    });
  }

  async _doSave() {
    const el        = this.element;
    const debugMode = game.settings.get(M, 'debugMode');
    const allKeys   = [
      ...this.constructor.regularKeys,
      ...(debugMode ? this.constructor.debugKeys : []),
    ];
    const seen    = new Set();
    const entries = [];
    for (const k of allKeys) {
      if (!k || typeof k !== 'string' || seen.has(k)) continue;
      seen.add(k);
      const def   = game.settings.settings.get(`${M}.${k}`);
      if (!def) continue;
      const input = el.querySelector(`[name="${k}"]`);
      if (!input) continue;
      entries.push({ k, def, input });
    }

    const before = new Map(entries.map(({ k }) => [k, game.settings.get(M, k)]));

    for (const { k, def, input } of entries) {
      let value;
      if (def.type === Boolean) value = input.checked;
      else if (def.type === Number) value = Number(input.value);
      else value = input.value;
      await game.settings.set(M, k, value);
    }

    
    
    const changed = entries.some(({ k }) => game.settings.get(M, k) !== before.get(k));
    if (changed) SettingsConfig.reloadConfirm({ world: true });
  }
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
    return ['forcedMovementEnabled', 'animationStepDelay', 'fallConfirmation', 'friendlyFireConfirmation', 'fmModifyGmOnly'];
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
      'squadStaminaClamp',
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

export class DeathTrackerSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-death-tracker-settings',
    window: { title: 'DSCT.panel.title.DeathTrackerSettings' },
  };

  static get enableKey()   { return 'deathTrackerEnabled'; }

  static get regularKeys() {
    return [
      'deathTrackerEnabled',
      'overrideMinionDefeat',
      'autoAssignDamagedMinion',
      'pickDeathsEnabled',
      'deathPickerDimAll',
      'gmControlsAllDeathPickers',
      'cedeDeathPickerToGM',
      'deathAnimationDuration',
      'batchAnimationSafety',
      'deathMarkerEnabled',
      'deathMarkerIcon',
      'clearSkullsOnCombatEnd',
      'clearEffectsOnRevive',
      'cleanOrphanedCombatants',
    ];
  }

  static get debugKeys() {
    return ['deathTrackerManualMode'];
  }

  _buildEntry(key) {
    if (key === 'cedeDeathPickerToGM' && game.user.isGM) return null;
    if (key === 'cedeDeathPickerToGM' && getSetting('gmControlsAllDeathPickers')) return null;
    const entry = super._buildEntry(key);
    if (entry && key === 'deathMarkerIcon') entry.isFilePicker = true;
    return entry;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    const skullToggle   = el.querySelector('[name="deathMarkerEnabled"]');
    const iconGroup     = el.querySelector('[name="deathMarkerIcon"]')?.closest('.form-group');
    const dtEnableInput = el.querySelector(`[name="${this.constructor.enableKey}"]`);
    if (skullToggle && iconGroup) {
      const sync = () => {
        const on = (dtEnableInput?.checked ?? true) && skullToggle.checked;
        iconGroup.classList.toggle('dsct-sub-disabled', !on);
        iconGroup.querySelectorAll('input, button').forEach(i => { i.disabled = !on; });
      };
      skullToggle.addEventListener('change', sync);
      dtEnableInput?.addEventListener('change', sync);
      sync();
    }

    
    const overrideToggle = el.querySelector('[name="overrideMinionDefeat"]');
    const autoAssignGroup = el.querySelector('[name="autoAssignDamagedMinion"]')?.closest('.form-group');
    if (overrideToggle && autoAssignGroup) {
      const sync = () => {
        const on = (dtEnableInput?.checked ?? true) && overrideToggle.checked;
        autoAssignGroup.classList.toggle('dsct-sub-disabled', !on);
        autoAssignGroup.querySelectorAll('input, select').forEach(i => { i.disabled = !on; });
      };
      overrideToggle.addEventListener('change', sync);
      dtEnableInput?.addEventListener('change', sync);
      sync();
    }

    
    if (game.modules.get('draw-steel-target-damage')?.active) {
      let dstdMinionOn = false;
      try { dstdMinionOn = game.settings.get('draw-steel-target-damage', 'minionDamageAutomation'); } catch {}
      if (dstdMinionOn) {
        for (const name of ['overrideMinionDefeat', 'autoAssignDamagedMinion']) {
          const grp = el.querySelector(`[name="${name}"]`)?.closest('.form-group');
          if (!grp) continue;
          grp.classList.add('dsct-sub-disabled');
          grp.querySelectorAll('input, select').forEach(i => { i.disabled = true; });
        }
      }
    }
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

export class AbilityAutomationSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-ability-automation-settings',
    window: { title: 'DSCT.panel.title.AbilityAutomationSettings' },
  };

  static get enableKey()   { return 'abilityAutomationEnabled'; }

  static get regularKeys() {
    return [
      'abilityAutomationEnabled',
      header('General'),
      'neutralizeEnrichers',
      'autoConfirmSelection',
      'rollDialogPillUI',
      'highGroundEnabled',
      'enforceAbilityRange',
      'gmBypassRangeEnforcement',
      'aidAttackAutomation',
      'aidAttackEffectIcon',
      header('Class — Censor'),
      'judgementAutomation',
      'judgedEffectIcon',
      'judgementBaneLock',
      'judgementBaneLockDuration',
      'purifyingFireEnabled',
      header('Class — Tactician'),
      'markAutomation',
      'markedEffectIcon',
      header('Class — Shadow'),
      'hiwEnabled',
      'imNoThreatEnabled',
      'imNoThreatEffectIcon',
      'crossfadeEnabled',
      header('Malice'),
      'abyssalEvolutionEnabled',
    ];
  }

  static _FILE_PICKER_KEYS = new Set(['judgedEffectIcon', 'markedEffectIcon', 'aidAttackEffectIcon', 'imNoThreatEffectIcon']);

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

    
    const judgementToggle     = this.element.querySelector('[name="judgementAutomation"]');
    const baneLockGroup       = this.element.querySelector('[name="judgementBaneLock"]')?.closest('.form-group');
    const baneLockDurGroup    = this.element.querySelector('[name="judgementBaneLockDuration"]')?.closest('.form-group');
    const judgedIconGroup     = this.element.querySelector('[name="judgedEffectIcon"]')?.closest('.form-group');
    if (judgementToggle) {
      const syncJudgement = () => {
        const on = (aaEnableInput?.checked ?? true) && judgementToggle.checked;
        for (const grp of [baneLockGroup, baneLockDurGroup, judgedIconGroup]) {
          if (!grp) continue;
          grp.classList.toggle('dsct-sub-disabled', !on);
          grp.querySelectorAll('input, select, button').forEach(i => { i.disabled = !on; });
        }
      };
      judgementToggle.addEventListener('change', syncJudgement);
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

    
    const homebrewOn    = game.settings.get(M, 'homebrewOptions');
    const crossfadeGroup = this.element.querySelector('[name="crossfadeEnabled"]')?.closest('.form-group');
    if (crossfadeGroup && !homebrewOn) {
      crossfadeGroup.style.display = 'none';
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

  static get regularKeys() {
    return [
      'homeRulesEnabled',
      'homebrewOptions',
      header('Pickers'),
      'cancelOnRightClick',
      header('Forced Movement'),
      'fallDamageCap',
      'cornerCutMode',
      'allowCrookedPushPull',
      'ignoreAllyEnabled',
      'corpsesBlock',
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

    if (debugMode || isActive('ds-quick-strike')) keys.push('quickStrikeCompat');

    if (debugMode || isActive('draw-steel-target-damage')) {
      keys.push(header('Draw Steel: Target Damage'));
      keys.push('dstdQuickFmButton');
      keys.push('playerCanUndoDstdDeaths');
      keys.push(compatInfo('draw-steel-target-damage', 'DSCT.compat.dsTargetDamage.name', 'DSCT.compat.dsTargetDamage.hint'));
    }

    if (debugMode || isActive('healthEstimate')) {
      keys.push(header('Health Estimate'));
      keys.push('minionHealthEstimate');
      keys.push(compatInfo('healthEstimate', 'DSCT.compat.healthEstimate.name', 'DSCT.compat.healthEstimate.hint'));
    }

    const autoEntries = [
      compatInfo('ds-terrain-designer', 'DSCT.compat.dsTerrain.name',      'DSCT.compat.dsTerrain.hint'),
      compatInfo('tagger',              'DSCT.compat.tagger.name',          'DSCT.compat.tagger.hint'),
      compatInfo('wall-height',         'DSCT.compat.wallHeight.name',      'DSCT.compat.wallHeight.hint'),
      compatInfo('ds-token-override',   'DSCT.compat.dsTokenOverride.name', 'DSCT.compat.dsTokenOverride.hint'),
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

export class CombatLogsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-combat-logs-settings',
    window: { title: 'DSCT.panel.title.CombatLogsSettings' },
  };

  static get regularKeys() {
    return ['combatTurnLog', 'combatRoundLog'];
  }
}

export class SquadLabelsSettingsMenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    id:     'dsct-squad-labels-settings',
    window: { title: 'DSCT.panel.title.SquadLabelsSettings' },
  };

  static get enableKey()   { return 'autoSquadLabelsEnabled'; }

  static get regularKeys() {
    return ['autoSquadLabelsEnabled', 'squadLabelAutoRelabel', 'squadLabelCaptainNow', 'squadCaptainShortcut', 'squadSimultaneousTurns', 'squadHudEnabled', 'squadHudPlayerVisibility'];
  }

  static get debugKeys() { return ['stickbugMode', 'stickbugChatTrigger']; }
}
