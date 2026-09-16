import { getSetting } from '../helpers.mjs';
import {
  buildFlatEffectButtons, addFlatEffectListeners, flatSetting,
  healAutoLabel, teleportAutoLabel, teleportDistance, teleportModeOptions, teleportMoverOptions,
} from './flat-special-effects.mjs';

const { SchemaField, StringField, NumberField, BooleanField } = foundry.data.fields;
const M = 'draw-steel-combat-tools';
const ABILITY_PART_ID = 'abilityUse'.padEnd(16, '0');
const DETAILS_TEMPLATE = `modules/${M}/templates/effects/power-roll-effect-details.hbs`;
const SYSTEM_TIERS_PARTIAL = 'systems/draw-steel/templates/sheets/pseudo-documents/power-roll-effect-sheet/details-tiers.hbs';

export const TIERED_TYPES = Object.freeze({
  dsctHeal:     'dsct.flatHeal',
  dsctTeleport: 'dsct.flatTeleport',
});

function _commonTierFields() {
  return {
    enabled:     new BooleanField({ initial: true, label: 'DSCT.TieredEffect.enabled.label', hint: 'DSCT.TieredEffect.enabled.hint' }),
    displayText: new StringField({ required: false, blank: true, label: 'DSCT.FlatEffect.displayText.label', hint: 'DSCT.TieredEffect.displayText.hint' }),
    display:     new StringField({ required: false, blank: true, label: 'DSCT.FlatEffect.display.label', hint: 'DSCT.FlatEffect.display.hint' }),
    spend: new SchemaField({
      enabled: new BooleanField({ initial: () => flatSetting('flatDefaultSpendEnabled', false), label: 'DSCT.FlatEffect.spend.enabled.label', hint: 'DSCT.FlatEffect.spend.enabled.hint' }),
      value:   new NumberField({ integer: true, initial: () => flatSetting('flatDefaultSpendValue', 1), positive: true, nullable: false, required: true, label: 'DSCT.FlatEffect.spend.value.label' }),
    }),
  };
}

class TieredEffectBase extends ds.data.pseudoDocuments.powerRollEffects.BasePowerRollEffect {
  static get FLAT_TYPE() { return TIERED_TYPES[this.TYPE]; }
  static get FLAT_KEY() { return this.FLAT_TYPE.split('.')[1]; }
  static get PARTIAL() { return `dsct.tier-${this.TYPE.slice(4).toLowerCase()}`; }
  static get TIER_KEYS() { return []; }

  tierData(tier) { return this[this.constructor.TYPE]?.[`tier${tier}`] ?? null; }
  flatData(tier) { return this.tierData(tier); }
  autoLabel(_tier) { return ''; }

  
  asFlat(tier) {
    const data = this.tierData(tier);
    if (!data?.enabled) return null;
    const flat = this.flatData(tier);
    return {
      id: this.id, uuid: this.uuid, name: this.name, img: this.img,
      type: this.constructor.FLAT_TYPE, tiered: this, tier,
      [this.constructor.FLAT_KEY]: flat,
      label: flat.display || flat.displayText || this.autoLabel(tier),
    };
  }

  toText(tier) {
    const data = this.tierData(tier);
    if (!data?.enabled) return '';
    return Handlebars.escapeExpression(data.displayText?.trim() || this.autoLabel(tier));
  }

  constructButtons() { return null; }

  _tierFieldContext(n) {
    const type = this.constructor.TYPE;
    const out = { prefix: `${type}.tier${n}` };
    for (const key of this.constructor.TIER_KEYS) {
      const path = `${out.prefix}.${key}`;
      const field = this.schema.getField(path);
      if (!field) continue;
      foundry.utils.setProperty(out, key, { field, src: foundry.utils.getProperty(this._source, path), name: path });
    }
    return out;
  }

  _tierExtraContext(_n) { return {}; }

  async _tierRenderingContext(context, options) {
    await super._tierRenderingContext(context, options);
    context.dsctPartial = this.constructor.PARTIAL;
    for (const n of [1, 2, 3]) {
      Object.assign(context.fields[`tier${n}`][this.constructor.TYPE], this._tierFieldContext(n), this._tierExtraContext(n));
    }
  }
}

class TieredHealEffect extends TieredEffectBase {
  static get TYPE() { return 'dsctHeal'; }
  static get TIER_KEYS() {
    return ['enabled', 'displayText', 'display', 'spendRecovery', 'recoverySource', 'amountType', 'amountFormula',
      'recoveryValueSource', 'tempStamina', 'repeatable', 'spend.enabled', 'spend.value'];
  }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      dsctHeal: this.duplicateTierSchema(() => ({
        ..._commonTierFields(),
        spendRecovery:       new BooleanField({ initial: false, label: 'DSCT.FlatEffect.Heal.spendRecovery.label', hint: 'DSCT.FlatEffect.Heal.spendRecovery.hint' }),
        recoverySource:      new StringField({ required: false, blank: false, initial: 'self', label: 'DSCT.FlatEffect.Heal.recoverySource.label' }),
        amountType:          new StringField({ required: false, blank: false, initial: () => flatSetting('flatDefaultHealAmountType', 'recoveryValue'), label: 'DSCT.FlatEffect.Heal.amountType.label' }),
        amountFormula:       new ds.data.fields.FormulaField({ initial: '0', label: 'DSCT.FlatEffect.Heal.amountFormula.label' }),
        recoveryValueSource: new StringField({ required: false, blank: false, initial: 'self', label: 'DSCT.FlatEffect.Heal.recoveryValueSource.label' }),
        tempStamina:         new BooleanField({ initial: () => flatSetting('flatDefaultHealTempStamina', false), label: 'DSCT.FlatEffect.Heal.tempStamina.label', hint: 'DSCT.FlatEffect.Heal.tempStamina.hint' }),
        repeatable:          new BooleanField({ initial: false, label: 'DSCT.FlatEffect.Heal.repeatable.label', hint: 'DSCT.FlatEffect.Heal.repeatable.hint' }),
      })),
    });
  }

  autoLabel(tier) { return healAutoLabel(this.tierData(tier), this.actor ?? null); }

  _tierExtraContext(n) {
    const src = this._source.dsctHeal[`tier${n}`];
    return { isCustomAmount: src.amountType === 'custom', isRecoveryValueAmount: src.amountType === 'recoveryValue' };
  }

  async _tierRenderingContext(context, options) {
    await super._tierRenderingContext(context, options);
    context.fields.healSourceOptions = [
      { value: 'self',   label: game.i18n.localize('DSCT.FlatEffect.Heal.Source.self') },
      { value: 'target', label: game.i18n.localize('DSCT.FlatEffect.Heal.Source.target') },
    ];
    context.fields.healAmountTypeOptions = [
      { value: 'recoveryValue', label: game.i18n.localize('DSCT.FlatEffect.Heal.AmountType.recoveryValue') },
      { value: 'custom',        label: game.i18n.localize('DSCT.FlatEffect.Heal.AmountType.custom') },
    ];
  }
}

class TieredTeleportEffect extends TieredEffectBase {
  static get TYPE() { return 'dsctTeleport'; }
  static get TIER_KEYS() {
    return ['enabled', 'displayText', 'display', 'mode', 'mover', 'distance', 'animate', 'color', 'duration', 'spend.enabled', 'spend.value'];
  }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      dsctTeleport: this.duplicateTierSchema((n) => ({
        ..._commonTierFields(),
        mode:     new StringField({ required: true, blank: false, initial: 'normal', label: 'DSCT.FlatEffect.Teleport.mode.label', hint: 'DSCT.FlatEffect.Teleport.mode.hint' }),
        mover:    new StringField({ required: true, blank: false, initial: 'self', label: 'DSCT.FlatEffect.Teleport.mover.label', hint: 'DSCT.FlatEffect.Teleport.mover.hint' }),
        distance: new ds.data.fields.FormulaField({ deterministic: true, initial: '5', label: 'DSCT.FlatEffect.Teleport.distance.label' }),
        
        ...(n === 1 ? {
          animate:  new BooleanField({ initial: true, label: 'DSCT.FlatEffect.Teleport.animate.label' }),
          color:    new StringField({ required: true, blank: false, initial: '#a030ff', label: 'DSCT.FlatEffect.Teleport.color.label' }),
          duration: new NumberField({ integer: true, positive: true, nullable: false, required: true, initial: 600, label: 'DSCT.FlatEffect.Teleport.duration.label' }),
        } : {}),
      })),
    });
  }

  flatData(tier) {
    const t1 = this.tierData(1);
    return { ...this.tierData(tier), animate: t1.animate, color: t1.color, duration: t1.duration };
  }

  autoLabel(tier) {
    const tv = this.flatData(tier);
    return teleportAutoLabel(tv, teleportDistance(tv, this.item, 0));
  }

  async _tierRenderingContext(context, options) {
    await super._tierRenderingContext(context, options);
    context.fields.teleportModeOptions  = teleportModeOptions();
    context.fields.teleportMoverOptions = teleportMoverOptions();
  }
}

export function tieredEffectsOf(item) {
  return Array.from(item?.system?.power?.effects?.contents ?? []).filter(e => Object.hasOwn(TIERED_TYPES, e.type));
}

export function tieredAsFlat(item, tier) {
  return tieredEffectsOf(item).map(e => e.asFlat(tier)).filter(Boolean);
}

const SPEND_AND_LABEL = `
    {{formGroup spend.enabled.field value=spend.enabled.src name=spend.enabled.name localize=true}}
    <div data-dsct-flat-spend-cost="{{prefix}}" {{#unless spend.enabled.src}}hidden{{/unless}}>
      {{formGroup spend.value.field value=spend.value.src name=spend.value.name localize=true}}
    </div>
    {{formGroup display.field value=display.src name=display.name localize=true}}
`;

const _tierSection = (type, body) => `
<section class="tab {{tab.cssClass}}" data-tab="{{tab.id}}" data-group="{{tab.group}}">
  {{#with tierFields.${type}}}
  {{formGroup enabled.field value=enabled.src name=enabled.name localize=true}}
  <div data-dsct-tier-body="{{enabled.name}}" {{#unless enabled.src}}hidden{{/unless}}>
    {{formGroup displayText.field value=displayText.src name=displayText.name localize=true}}
${body}${SPEND_AND_LABEL}
  </div>
  {{/with}}
</section>
`;

function _registerPartials() {
  Handlebars.registerPartial('dsct.tier-heal', _tierSection('dsctHeal', `
    {{formGroup spendRecovery.field value=spendRecovery.src name=spendRecovery.name localize=true}}
    <div data-dsct-heal-recovery-source="{{prefix}}" {{#unless spendRecovery.src}}hidden{{/unless}}>
      {{formGroup recoverySource.field value=recoverySource.src name=recoverySource.name options=@root.fields.healSourceOptions localize=true}}
    </div>
    {{formGroup amountType.field value=amountType.src name=amountType.name options=@root.fields.healAmountTypeOptions localize=true}}
    <div data-dsct-heal-custom="{{prefix}}" {{#unless isCustomAmount}}hidden{{/unless}}>
      {{formGroup amountFormula.field value=amountFormula.src name=amountFormula.name localize=true}}
    </div>
    <div data-dsct-heal-rv-source="{{prefix}}" {{#unless isRecoveryValueAmount}}hidden{{/unless}}>
      {{formGroup recoveryValueSource.field value=recoveryValueSource.src name=recoveryValueSource.name options=@root.fields.healSourceOptions localize=true}}
    </div>
    {{formGroup tempStamina.field value=tempStamina.src name=tempStamina.name localize=true}}
    {{formGroup repeatable.field value=repeatable.src name=repeatable.name localize=true}}
`));

  Handlebars.registerPartial('dsct.tier-teleport', _tierSection('dsctTeleport', `
    {{formGroup mode.field value=mode.src name=mode.name options=@root.fields.teleportModeOptions localize=true}}
    {{formGroup mover.field value=mover.src name=mover.name options=@root.fields.teleportMoverOptions localize=true}}
    {{formGroup distance.field value=distance.src name=distance.name localize=true}}
    {{#if animate}}
    {{formGroup animate.field value=animate.src name=animate.name localize=true}}
    {{formGroup color.field value=color.src name=color.name localize=true}}
    {{formGroup duration.field value=duration.src name=duration.name localize=true}}
    {{else}}
    <p class="hint">{{localize "DSCT.TieredEffect.teleportAnimationNote"}}</p>
    {{/if}}
`));
}

function _registerTypes() {
  const cfg = globalThis.ds?.CONFIG?.PowerRollEffect;
  if (!cfg) return;
  cfg.dsctHeal     = { label: 'TYPES.PowerRollEffect.dsctHeal',     defaultImage: 'icons/svg/heal.svg',      documentClass: TieredHealEffect };
  cfg.dsctTeleport = { label: 'TYPES.PowerRollEffect.dsctTeleport', defaultImage: 'icons/svg/door-exit.svg', documentClass: TieredTeleportEffect };
}
_registerTypes();

function _patchSheetTemplate() {
  const details = ds.applications?.sheets?.pseudoDocuments?.PowerRollEffectSheet?.PARTS?.details;
  if (!details || details.template === DETAILS_TEMPLATE) return;
  details.templates = Array.from(new Set([...(details.templates ?? []), SYSTEM_TIERS_PARTIAL]));
  details.template = DETAILS_TEMPLATE;
  foundry.applications.handlebars.loadTemplates([DETAILS_TEMPLATE]);
}

function _installTierToggles() {
  Hooks.on('renderApplicationV2', (_app, element) => {
    element.querySelectorAll?.('[data-dsct-tier-body]').forEach(body => {
      const toggle = element.querySelector(`input[name="${body.dataset.dsctTierBody}"]`);
      if (!toggle) return;
      const sync = () => body.toggleAttribute('hidden', !toggle.checked);
      toggle.addEventListener('change', sync);
      sync();
    });
  });
}

function _messageParts(message) {
  const parts = message?.system?.parts;
  if (!parts) return [];
  if (typeof parts.values === 'function') return Array.from(parts.values());
  return Array.isArray(parts) ? parts : Object.values(parts);
}

function _installChatHook() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!getSetting('flatEffectsEnabled')) return;
    const parts = _messageParts(message);
    const usePart = parts.find(p => p.id === ABILITY_PART_ID || p.type === 'abilityUse');
    if (!usePart?.abilityUuid) return;
    const item = fromUuidSync(usePart.abilityUuid);
    if (!item || !tieredEffectsOf(item).length) return;
    const resultPart = parts.find(p => p.type === 'abilityResult');
    const tier = Number(resultPart?.tier);
    if (!(tier >= 1 && tier <= 3)) return;
    const section = html.querySelector(`section[data-message-part="${resultPart.id}"]`);
    if (!section) return;

    const buttons = buildFlatEffectButtons(tieredAsFlat(item, tier), item, message);
    if (!buttons.length) return;
    let footer = section.querySelector('footer.message-part-buttons');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'message-part-buttons';
      section.appendChild(footer);
    }
    for (const btn of buttons) footer.appendChild(btn);
    addFlatEffectListeners(section, item, message);
  });
}

export function registerTieredEffects() {
  _registerPartials();
  _registerTypes();
  _patchSheetTemplate();
  _installTierToggles();
  _installChatHook();
}
