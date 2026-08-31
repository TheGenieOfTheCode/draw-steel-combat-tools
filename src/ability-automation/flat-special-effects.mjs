import { applyDamage } from '../helpers.mjs';
import { runForcedMovement } from '../forced-movement/forced-movement.mjs';

const { SchemaField, SetField, StringField, NumberField, BooleanField } = foundry.data.fields;
const ABILITY_PART_ID = "abilityUse".padEnd(16, "0");
const FLAT_TYPES = new Set(["dsct.flatDamage", "dsct.flatForced", "dsct.flatApplied", "dsct.flatResource", "dsct.flatHeal", "dsct.flatCleanse"]);
const _nonDstdHealUsed    = new Set();
const _nonDstdCleanseUsed = new Set();

function _setField(opts = {}) {
  return new StringField({ ...opts, required: true, blank: false });
}

function _registerPartials() {
  Handlebars.registerPartial("dsct.flat-damage", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatDamage.displayText" localize=true}}
    {{formGroup ctx.value.field value=ctx.value.src name="flatDamage.value" localize=true}}
    {{formGroup ctx.types.field value=ctx.types.src name="flatDamage.types" options=ctx.damageTypes localize=true}}
    {{formGroup ctx.ignoredImmunities.field value=ctx.ignoredImmunities.src name="flatDamage.ignoredImmunities" options=ctx.immunityTypes localize=true}}
    {{formGroup ctx.spend.enabled.field value=ctx.spend.enabled.src name="flatDamage.spend.enabled" localize=true}}
    <div data-dsct-flat-spend-cost="flatDamage" {{#unless ctx.spend.enabled.src}}hidden{{/unless}}>
      {{formGroup ctx.spend.value.field value=ctx.spend.value.src name="flatDamage.spend.value" localize=true}}
    </div>
    {{formGroup ctx.display.field value=ctx.display.src name="flatDamage.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-forced", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatForced.displayText" localize=true}}
    {{formGroup ctx.movement.field value=ctx.movement.src name="flatForced.movement" options=ctx.movementOptions localize=true}}
    {{formGroup ctx.distance.field value=ctx.distance.src name="flatForced.distance" localize=true}}
    {{formGroup ctx.properties.field value=ctx.properties.src name="flatForced.properties" options=ctx.propertyOptions localize=true}}
    {{formGroup ctx.spend.enabled.field value=ctx.spend.enabled.src name="flatForced.spend.enabled" localize=true}}
    <div data-dsct-flat-spend-cost="flatForced" {{#unless ctx.spend.enabled.src}}hidden{{/unless}}>
      {{formGroup ctx.spend.value.field value=ctx.spend.value.src name="flatForced.spend.value" localize=true}}
    </div>
    {{formGroup ctx.display.field value=ctx.display.src name="flatForced.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-applied", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatApplied.displayText" localize=true}}
    {{formGroup ctx.potencyChar.field value=ctx.potencyChar.src name="flatApplied.potency.characteristic" options=ctx.characteristicOptions localize=true}}
    {{formGroup ctx.potencyStrength.field value=ctx.potencyStrength.src name="flatApplied.potency.strength" options=ctx.strengthOptions localize=true}}
    <div data-dsct-potency-custom {{#unless ctx.isCustomStrength}}hidden{{/unless}}>
      {{formGroup ctx.potencyCustom.field value=ctx.potencyCustom.src name="flatApplied.potency.custom" localize=true}}
    </div>
    {{formGroup ctx.statusId.field value=ctx.statusId.src name="flatApplied.statusId" options=ctx.effectOptions localize=true}}
    {{formGroup ctx.end.field value=ctx.end.src name="flatApplied.end" options=ctx.endOptions localize=true}}
    {{formGroup ctx.properties.field value=ctx.properties.src name="flatApplied.properties" options=ctx.propertyOptions localize=true}}
    {{formGroup ctx.spend.enabled.field value=ctx.spend.enabled.src name="flatApplied.spend.enabled" localize=true}}
    <div data-dsct-flat-spend-cost="flatApplied" {{#unless ctx.spend.enabled.src}}hidden{{/unless}}>
      {{formGroup ctx.spend.value.field value=ctx.spend.value.src name="flatApplied.spend.value" localize=true}}
    </div>
    {{formGroup ctx.display.field value=ctx.display.src name="flatApplied.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-resource", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatResource.displayText" localize=true}}
    {{formGroup ctx.amount.field value=ctx.amount.src name="flatResource.amount" localize=true}}
    {{formGroup ctx.type.field value=ctx.type.src name="flatResource.type" options=ctx.typeOptions localize=true}}
    {{formGroup ctx.spend.enabled.field value=ctx.spend.enabled.src name="flatResource.spend.enabled" localize=true}}
    <div data-dsct-flat-spend-cost="flatResource" {{#unless ctx.spend.enabled.src}}hidden{{/unless}}>
      {{formGroup ctx.spend.value.field value=ctx.spend.value.src name="flatResource.spend.value" localize=true}}
    </div>
    {{formGroup ctx.display.field value=ctx.display.src name="flatResource.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-cleanse", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatCleanse.displayText" localize=true}}
    <div class="form-group">
      <label class="form-label">{{localize "DSCT.FlatEffect.Cleanse.expiryFilter.label"}}</label>
      <div class="form-fields">
        <div class="dsct-tag-picker" data-dsct-tag-field="flatCleanse.expiryFilter">
          <div class="dsct-tag-list">
            {{#each ctx.expirySelected}}<span class="dsct-tag" data-value="{{value}}">{{label}}<button type="button" class="dsct-tag-remove"><i class="fa-solid fa-xmark"></i></button></span>{{/each}}
          </div>
          <select class="dsct-tag-add-select">
            <option value="">{{localize "DSCT.FlatEffect.Cleanse.addFilter"}}</option>
            {{#each ctx.expiryOptions}}<option value="{{value}}">{{label}}</option>{{/each}}
          </select>
          <select name="flatCleanse.expiryFilter" multiple style="display:none">
            {{#each ctx.allExpiryOptions}}<option value="{{value}}"{{#if selected}} selected{{/if}}>{{label}}</option>{{/each}}
          </select>
        </div>
      </div>
      <p class="hint">{{localize "DSCT.FlatEffect.Cleanse.expiryFilter.hint"}}</p>
    </div>
    <div class="form-group">
      <label class="form-label">{{localize "DSCT.FlatEffect.Cleanse.statusFilter.label"}}</label>
      <div class="form-fields">
        <div class="dsct-tag-picker" data-dsct-tag-field="flatCleanse.statusFilter">
          <div class="dsct-tag-list">
            {{#each ctx.statusSelected}}<span class="dsct-tag" data-value="{{value}}">{{label}}<button type="button" class="dsct-tag-remove"><i class="fa-solid fa-xmark"></i></button></span>{{/each}}
          </div>
          <select class="dsct-tag-add-select">
            <option value="">{{localize "DSCT.FlatEffect.Cleanse.addFilter"}}</option>
            {{#each ctx.statusOptions}}<option value="{{value}}">{{label}}</option>{{/each}}
          </select>
          <select name="flatCleanse.statusFilter" multiple style="display:none">
            {{#each ctx.allStatusOptions}}<option value="{{value}}"{{#if selected}} selected{{/if}}>{{label}}</option>{{/each}}
          </select>
        </div>
      </div>
      <p class="hint">{{localize "DSCT.FlatEffect.Cleanse.statusFilter.hint"}}</p>
    </div>
    {{formGroup ctx.repeatable.field value=ctx.repeatable.src name="flatCleanse.repeatable" localize=true}}
    {{formGroup ctx.spend.enabled.field value=ctx.spend.enabled.src name="flatCleanse.spend.enabled" localize=true}}
    <div data-dsct-flat-spend-cost="flatCleanse" {{#unless ctx.spend.enabled.src}}hidden{{/unless}}>
      {{formGroup ctx.spend.value.field value=ctx.spend.value.src name="flatCleanse.spend.value" localize=true}}
    </div>
    {{formGroup ctx.display.field value=ctx.display.src name="flatCleanse.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-heal", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatHeal.displayText" localize=true}}
    {{formGroup ctx.spendRecovery.field value=ctx.spendRecovery.src name="flatHeal.spendRecovery" localize=true}}
    <div data-dsct-heal-recovery-source {{#unless ctx.spendRecovery.src}}hidden{{/unless}}>
      {{formGroup ctx.recoverySource.field value=ctx.recoverySource.src name="flatHeal.recoverySource" options=ctx.sourceOptions localize=true}}
    </div>
    {{formGroup ctx.amountType.field value=ctx.amountType.src name="flatHeal.amountType" options=ctx.amountTypeOptions localize=true}}
    <div data-dsct-heal-custom {{#unless ctx.isCustomAmount}}hidden{{/unless}}>
      {{formGroup ctx.amountFormula.field value=ctx.amountFormula.src name="flatHeal.amountFormula" localize=true}}
    </div>
    <div data-dsct-heal-rv-source {{#unless ctx.isRecoveryValueAmount}}hidden{{/unless}}>
      {{formGroup ctx.recoveryValueSource.field value=ctx.recoveryValueSource.src name="flatHeal.recoveryValueSource" options=ctx.sourceOptions localize=true}}
    </div>
    {{formGroup ctx.tempStamina.field value=ctx.tempStamina.src name="flatHeal.tempStamina" localize=true}}
    {{formGroup ctx.repeatable.field value=ctx.repeatable.src name="flatHeal.repeatable" localize=true}}
    {{formGroup ctx.spend.enabled.field value=ctx.spend.enabled.src name="flatHeal.spend.enabled" localize=true}}
    <div data-dsct-flat-spend-cost="flatHeal" {{#unless ctx.spend.enabled.src}}hidden{{/unless}}>
      {{formGroup ctx.spend.value.field value=ctx.spend.value.src name="flatHeal.spend.value" localize=true}}
    </div>
    {{formGroup ctx.display.field value=ctx.display.src name="flatHeal.display" localize=true}}
  `);
}

class FlatDamageSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return "dsct.flatDamage"; }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      flatDamage: new SchemaField({
        displayText: new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.displayText.label", hint: "DSCT.FlatEffect.displayText.hint" }),
        display:     new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.display.label",     hint: "DSCT.FlatEffect.display.hint" }),
        value: new ds.data.fields.FormulaField({ initial: "2 + @chr", label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.damage.label" }),
        types: new SetField(_setField(), { label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.types.label" }),
        ignoredImmunities: new SetField(_setField(), {
          label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.ignoredImmunities.label",
          hint: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.ignoredImmunities.hint",
        }),
        spend: new SchemaField({
          enabled: new BooleanField({ initial: false, label: "DSCT.FlatEffect.spend.enabled.label", hint: "DSCT.FlatEffect.spend.enabled.hint" }),
          value:   new NumberField({ integer: true, initial: 1, positive: true, nullable: false, required: true, label: "DSCT.FlatEffect.spend.value.label" }),
        }),
      }),
    });
  }

  get detailsPartial() { return "dsct.flat-damage"; }
  showUse() { return false; }

  get label() {
    const { value, types } = this.flatDamage;
    if (!value) return this.name;
    try {
      const rollData = this.document.getRollData?.();
      const simplified = rollData ? ds.utils.simplifyRollFormula(value, rollData) : value;
      if (!types.size) return game.i18n.format("DRAW_STEEL.POWER_ROLL_EFFECT.DAMAGE.formattedTypeless", { value: simplified });
      const fmt = game.i18n.getListFormatter({ type: "disjunction" });
      const typeLabel = fmt.format(Array.from(types).map(t => ds.CONFIG.damageTypes[t]?.label ?? t));
      return game.i18n.format("DRAW_STEEL.POWER_ROLL_EFFECT.DAMAGE.formatted", { value: simplified, damageTypes: typeLabel });
    } catch { return this.name; }
  }

  async getSheetContext() {
    return {
      displayText:       { field: this.schema.getField("flatDamage.displayText"), src: this._source.flatDamage.displayText },
      display:           { field: this.schema.getField("flatDamage.display"),     src: this._source.flatDamage.display },
      value:             { field: this.schema.getField("flatDamage.value"),       src: this._source.flatDamage.value },
      types:             { field: this.schema.getField("flatDamage.types"),       src: this._source.flatDamage.types },
      ignoredImmunities: { field: this.schema.getField("flatDamage.ignoredImmunities"), src: this._source.flatDamage.ignoredImmunities },
      damageTypes: Object.entries(ds.CONFIG.damageTypes).map(([k, v]) => ({ value: k, label: v.label })),
      immunityTypes: [
        { value: "all", label: game.i18n.localize("DRAW_STEEL.Damage.Immunities.All") },
        { rule: true },
        ...Object.entries(ds.CONFIG.damageTypes).map(([k, v]) => ({ value: k, label: v.label })),
      ],
      spend: {
        enabled: { field: this.schema.getField("flatDamage.spend.enabled"), src: this._source.flatDamage.spend.enabled },
        value:   { field: this.schema.getField("flatDamage.spend.value"),   src: this._source.flatDamage.spend.value },
      },
    };
  }
}

class FlatForcedSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return "dsct.flatForced"; }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      flatForced: new SchemaField({
        displayText: new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.displayText.label", hint: "DSCT.FlatEffect.displayText.hint" }),
        display:     new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.display.label",     hint: "DSCT.FlatEffect.display.hint" }),
        movement: new SetField(_setField(), { initial: ["push"], label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.movement.label" }),
        distance: new ds.data.fields.FormulaField({ deterministic: true, initial: "1", label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.distance.label" }),
        properties: new SetField(_setField(), { label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.properties.label" }),
        spend: new SchemaField({
          enabled: new BooleanField({ initial: false, label: "DSCT.FlatEffect.spend.enabled.label", hint: "DSCT.FlatEffect.spend.enabled.hint" }),
          value:   new NumberField({ integer: true, initial: 1, positive: true, nullable: false, required: true, label: "DSCT.FlatEffect.spend.value.label" }),
        }),
      }),
    });
  }

  get detailsPartial() { return "dsct.flat-forced"; }
  showUse() { return false; }

  get label() {
    const tv = this.flatForced;
    try {
      const isVertical = tv.properties.has("vertical");
      const rollData = this.document.getRollData?.();
      const dist = rollData ? ds.utils.evaluateFormula(tv.distance, rollData, { contextName: this.uuid }) : tv.distance;
      const movementLabels = Array.from(tv.movement).map(m => {
        const c = ds.CONFIG.abilities.forcedMovement[m];
        return isVertical ? c?.vertical : c?.label;
      }).filter(Boolean);
      const fmt = game.i18n.getListFormatter({ type: "disjunction" });
      return game.i18n.format("DRAW_STEEL.Item.ability.ForcedMovement.Display", { movement: fmt.format(movementLabels), distance: dist });
    } catch { return this.name; }
  }

  async getSheetContext() {
    return {
      displayText: { field: this.schema.getField("flatForced.displayText"), src: this._source.flatForced.displayText },
      display:     { field: this.schema.getField("flatForced.display"),     src: this._source.flatForced.display },
      movement:    { field: this.schema.getField("flatForced.movement"),    src: this._source.flatForced.movement },
      distance:    { field: this.schema.getField("flatForced.distance"),    src: this._source.flatForced.distance },
      properties:  { field: this.schema.getField("flatForced.properties"), src: this._source.flatForced.properties },
      movementOptions: Object.entries(ds.CONFIG.abilities.forcedMovement).map(([value, { label }]) => ({ value, label })),
      propertyOptions: Object.entries(ds.CONFIG.PowerRollEffect.forced.properties).map(([value, { label }]) => ({ value, label })),
      spend: {
        enabled: { field: this.schema.getField("flatForced.spend.enabled"), src: this._source.flatForced.spend.enabled },
        value:   { field: this.schema.getField("flatForced.spend.value"),   src: this._source.flatForced.spend.value },
      },
    };
  }
}

class FlatAppliedSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return "dsct.flatApplied"; }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      flatApplied: new SchemaField({
        displayText: new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.Applied.displayText.label", hint: "DSCT.FlatEffect.Applied.displayText.hint" }),
        display:     new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.Applied.display.label",     hint: "DSCT.FlatEffect.Applied.display.hint" }),
        potency: new SchemaField({
          characteristic: new StringField({ required: false, blank: true, initial: "",        label: "DSCT.FlatEffect.Applied.potency.characteristic.label", hint: "DSCT.FlatEffect.Applied.potency.characteristic.hint" }),
          strength:       new StringField({ required: false, blank: true, initial: "average", label: "DSCT.FlatEffect.Applied.potency.strength.label" }),
          custom:         new StringField({ required: false, blank: true, initial: "",        label: "DSCT.FlatEffect.Applied.potency.custom.label",         hint: "DSCT.FlatEffect.Applied.potency.custom.hint" }),
        }),
        statusId:   new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.Applied.statusId.label",    hint: "DSCT.FlatEffect.Applied.statusId.hint" }),
        end:        new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.Applied.end.label",         hint: "DSCT.FlatEffect.Applied.end.hint" }),
        properties: new SetField(_setField(), { initial: [], label: "DSCT.FlatEffect.Applied.properties.label" }),
        spend: new SchemaField({
          enabled: new BooleanField({ initial: false, label: "DSCT.FlatEffect.spend.enabled.label", hint: "DSCT.FlatEffect.spend.enabled.hint" }),
          value:   new NumberField({ integer: true, initial: 1, positive: true, nullable: false, required: true, label: "DSCT.FlatEffect.spend.value.label" }),
        }),
      }),
    });
  }

  get detailsPartial() { return "dsct.flat-applied"; }
  showUse() { return false; }

  get label() {
    const { statusId, display, displayText } = this.flatApplied;
    if (display) return display;
    if (displayText) return displayText;
    if (!statusId) return this.name;
    const aeMatch = this.document.effects?.get(statusId);
    if (aeMatch) return aeMatch.name ?? statusId;
    return CONFIG.statusEffects.find(s => s.id === statusId)?.name ?? statusId;
  }

  async getSheetContext() {
    const aeOptions = (this.document.effects?.contents ?? [])
      .filter(e => !e.transfer)
      .map(e => ({ value: e.id, label: e.name ?? e.id }));
    const statusOptions = CONFIG.statusEffects
      .filter(s => s.hud !== false)
      .map(s => ({ value: s.id, label: s.name ?? s.id }));

    const effectOptions = [{ value: "", label: game.i18n.localize("None") ?? "None" }];
    if (aeOptions.length) {
      effectOptions.push(...aeOptions);
      effectOptions.push({ rule: true });
    }
    effectOptions.push(...statusOptions);

    const characteristicOptions = [
      { value: "", label: game.i18n.localize("COMMON.None") ?? "None" },
      ...Object.entries(ds.CONFIG.characteristics ?? {}).map(([value, { label }]) => ({ value, label })),
    ];

    const strengthOptions = [
      { value: "weak",    label: game.i18n.localize("DSCT.FlatEffect.Applied.potency.Strength.weak")    ?? "Weak" },
      { value: "average", label: game.i18n.localize("DSCT.FlatEffect.Applied.potency.Strength.average") ?? "Average" },
      { value: "strong",  label: game.i18n.localize("DSCT.FlatEffect.Applied.potency.Strength.strong")  ?? "Strong" },
      { value: "custom",  label: game.i18n.localize("DSCT.FlatEffect.Applied.potency.Strength.custom")  ?? "Custom" },
    ];

    const endOptions = [
      { value: "", label: game.i18n.localize("DSCT.FlatEffect.Applied.end.default") ?? "Default" },
      ...Object.entries(ds.CONFIG.effectEnds ?? {}).map(([value, cfg]) => ({ value, label: cfg.label ?? value })),
    ];

    const dsAppliedProps = Object.entries(ds.CONFIG.PowerRollEffect?.applied?.properties ?? {})
      .map(([value, { label }]) => ({ value, label }));
    const propertyOptions = [
      ...dsAppliedProps,
      ...(dsAppliedProps.some(p => p.value === "ignoreSize")
        ? []
        : [{ value: "ignoreSize", label: "DSCT.FlatEffect.Applied.Properties.ignoreSize" }]),
    ];

    const isCustomStrength = this._source.flatApplied.potency.strength === "custom";

    return {
      displayText:     { field: this.schema.getField("flatApplied.displayText"),              src: this._source.flatApplied.displayText },
      display:         { field: this.schema.getField("flatApplied.display"),                  src: this._source.flatApplied.display },
      potencyChar:     { field: this.schema.getField("flatApplied.potency.characteristic"),   src: this._source.flatApplied.potency.characteristic },
      potencyStrength: { field: this.schema.getField("flatApplied.potency.strength"),         src: this._source.flatApplied.potency.strength },
      potencyCustom:   { field: this.schema.getField("flatApplied.potency.custom"),           src: this._source.flatApplied.potency.custom },
      statusId:        { field: this.schema.getField("flatApplied.statusId"),                 src: this._source.flatApplied.statusId },
      end:             { field: this.schema.getField("flatApplied.end"),                      src: this._source.flatApplied.end },
      properties:      { field: this.schema.getField("flatApplied.properties"),               src: this._source.flatApplied.properties },
      effectOptions,
      characteristicOptions,
      strengthOptions,
      endOptions,
      propertyOptions,
      isCustomStrength,
      spend: {
        enabled: { field: this.schema.getField("flatApplied.spend.enabled"), src: this._source.flatApplied.spend.enabled },
        value:   { field: this.schema.getField("flatApplied.spend.value"),   src: this._source.flatApplied.spend.value },
      },
    };
  }
}

class FlatResourceSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return "dsct.flatResource"; }

  static get _resourceTypes() {
    return ds.data.pseudoDocuments.powerRollEffects.GainResourcePowerRollEffect.resourceTypes;
  }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      flatResource: new SchemaField({
        displayText: new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.displayText.label", hint: "DSCT.FlatEffect.displayText.hint" }),
        display:     new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.display.label",     hint: "DSCT.FlatEffect.display.hint" }),
        amount: new NumberField({ integer: true, initial: 1, label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.resource.amount.label" }),
        type: new StringField({ initial: "surge", label: "DRAW_STEEL.POWER_ROLL_EFFECT.FIELDS.resource.type.label" }),
        spend: new SchemaField({
          enabled: new BooleanField({ initial: false, label: "DSCT.FlatEffect.spend.enabled.label", hint: "DSCT.FlatEffect.spend.enabled.hint" }),
          value:   new NumberField({ integer: true, initial: 1, positive: true, nullable: false, required: true, label: "DSCT.FlatEffect.spend.value.label" }),
        }),
      }),
    });
  }

  get detailsPartial() { return "dsct.flat-resource"; }
  showUse() { return false; }

  get label() {
    const { amount, type } = this.flatResource;
    if (!amount || !type) return this.name;
    try {
      const rt = this.constructor._resourceTypes;
      const key = `${rt[type]?.plural ?? ""}.${game.i18n.pluralRules.select(amount)}`;
      return game.i18n.format("DRAW_STEEL.POWER_ROLL_EFFECT.RESOURCE.DefaultDisplay", { amount, resource: game.i18n.localize(key) });
    } catch { return this.name; }
  }

  async getSheetContext() {
    const rt = this.constructor._resourceTypes;
    return {
      displayText: { field: this.schema.getField("flatResource.displayText"), src: this._source.flatResource.displayText },
      display:     { field: this.schema.getField("flatResource.display"),     src: this._source.flatResource.display },
      amount:      { field: this.schema.getField("flatResource.amount"),      src: this._source.flatResource.amount },
      type:        { field: this.schema.getField("flatResource.type"),        src: this._source.flatResource.type },
      typeOptions: Object.entries(rt).map(([value, { label }]) => ({ value, label })),
      spend: {
        enabled: { field: this.schema.getField("flatResource.spend.enabled"), src: this._source.flatResource.spend.enabled },
        value:   { field: this.schema.getField("flatResource.spend.value"),   src: this._source.flatResource.spend.value },
      },
    };
  }
}

class FlatHealSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return "dsct.flatHeal"; }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      flatHeal: new SchemaField({
        displayText:         new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.displayText.label",                   hint: "DSCT.FlatEffect.displayText.hint" }),
        display:             new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.display.label",                       hint: "DSCT.FlatEffect.display.hint" }),
        spendRecovery:       new BooleanField({ initial: false,              label: "DSCT.FlatEffect.Heal.spendRecovery.label",            hint: "DSCT.FlatEffect.Heal.spendRecovery.hint" }),
        recoverySource:      new StringField({ required: false, blank: false, initial: "self",         label: "DSCT.FlatEffect.Heal.recoverySource.label" }),
        amountType:          new StringField({ required: false, blank: false, initial: "recoveryValue", label: "DSCT.FlatEffect.Heal.amountType.label" }),
        amountFormula:       new ds.data.fields.FormulaField({ initial: "0",                           label: "DSCT.FlatEffect.Heal.amountFormula.label" }),
        recoveryValueSource: new StringField({ required: false, blank: false, initial: "self",         label: "DSCT.FlatEffect.Heal.recoveryValueSource.label" }),
        tempStamina:         new BooleanField({ initial: false,              label: "DSCT.FlatEffect.Heal.tempStamina.label",             hint: "DSCT.FlatEffect.Heal.tempStamina.hint" }),
        repeatable:          new BooleanField({ initial: false,              label: "DSCT.FlatEffect.Heal.repeatable.label",              hint: "DSCT.FlatEffect.Heal.repeatable.hint" }),
        spend: new SchemaField({
          enabled: new BooleanField({ initial: false, label: "DSCT.FlatEffect.spend.enabled.label", hint: "DSCT.FlatEffect.spend.enabled.hint" }),
          value:   new NumberField({ integer: true, initial: 1, positive: true, nullable: false, required: true, label: "DSCT.FlatEffect.spend.value.label" }),
        }),
      }),
    });
  }

  get detailsPartial() { return "dsct.flat-heal"; }
  showUse() { return false; }

  get label() {
    const { display, displayText, spendRecovery, amountType, amountFormula, recoveryValueSource, tempStamina } = this.flatHeal;
    if (display) return display;
    if (displayText) return displayText;
    const sourceActor = this.document?.actor ?? null;
    let amountStr;
    if (amountType === "recoveryValue") {
      amountStr = recoveryValueSource === "self" && sourceActor
        ? String(sourceActor.system.recoveries?.recoveryValue ?? "?")
        : game.i18n.localize("DSCT.FlatEffect.Heal.rvPlaceholder");
    } else {
      try {
        const rd = sourceActor?.getRollData?.();
        amountStr = rd ? ds.utils.simplifyRollFormula(amountFormula, rd) : amountFormula;
      } catch { amountStr = amountFormula; }
    }
    if (tempStamina && spendRecovery) return game.i18n.format("DSCT.FlatEffect.Heal.spendTempLabel",  { amount: amountStr });
    if (tempStamina)                  return game.i18n.format("DSCT.FlatEffect.Heal.tempLabel",        { amount: amountStr });
    if (spendRecovery)                return game.i18n.format("DSCT.FlatEffect.Heal.spendHealLabel",   { amount: amountStr });
    return game.i18n.format("DSCT.FlatEffect.Heal.healLabel", { amount: amountStr });
  }

  async getSheetContext() {
    const src = this._source.flatHeal;
    const sourceOptions = [
      { value: "self",   label: game.i18n.localize("DSCT.FlatEffect.Heal.Source.self")   },
      { value: "target", label: game.i18n.localize("DSCT.FlatEffect.Heal.Source.target") },
    ];
    const amountTypeOptions = [
      { value: "recoveryValue", label: game.i18n.localize("DSCT.FlatEffect.Heal.AmountType.recoveryValue") },
      { value: "custom",        label: game.i18n.localize("DSCT.FlatEffect.Heal.AmountType.custom") },
    ];
    return {
      displayText:         { field: this.schema.getField("flatHeal.displayText"),         src: src.displayText },
      display:             { field: this.schema.getField("flatHeal.display"),             src: src.display },
      spendRecovery:       { field: this.schema.getField("flatHeal.spendRecovery"),       src: src.spendRecovery },
      recoverySource:      { field: this.schema.getField("flatHeal.recoverySource"),      src: src.recoverySource },
      amountType:          { field: this.schema.getField("flatHeal.amountType"),          src: src.amountType },
      amountFormula:       { field: this.schema.getField("flatHeal.amountFormula"),       src: src.amountFormula },
      recoveryValueSource: { field: this.schema.getField("flatHeal.recoveryValueSource"), src: src.recoveryValueSource },
      tempStamina:         { field: this.schema.getField("flatHeal.tempStamina"),         src: src.tempStamina },
      repeatable:          { field: this.schema.getField("flatHeal.repeatable"),          src: src.repeatable },
      sourceOptions,
      amountTypeOptions,
      isCustomAmount:        src.amountType === "custom",
      isRecoveryValueAmount: src.amountType === "recoveryValue",
      spend: {
        enabled: { field: this.schema.getField("flatHeal.spend.enabled"), src: src.spend.enabled },
        value:   { field: this.schema.getField("flatHeal.spend.value"),   src: src.spend.value },
      },
    };
  }
}

class FlatCleanseSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return "dsct.flatCleanse"; }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      flatCleanse: new SchemaField({
        displayText:  new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.displayText.label",         hint: "DSCT.FlatEffect.displayText.hint" }),
        display:      new StringField({ required: false, blank: true, label: "DSCT.FlatEffect.display.label",             hint: "DSCT.FlatEffect.display.hint" }),
        expiryFilter: new SetField(_setField(), { initial: ["turnEnd", "save"], label: "DSCT.FlatEffect.Cleanse.expiryFilter.label" }),
        statusFilter: new SetField(_setField(), { initial: [],                  label: "DSCT.FlatEffect.Cleanse.statusFilter.label" }),
        repeatable:   new BooleanField({ initial: false, label: "DSCT.FlatEffect.Cleanse.repeatable.label", hint: "DSCT.FlatEffect.Cleanse.repeatable.hint" }),
        spend: new SchemaField({
          enabled: new BooleanField({ initial: false, label: "DSCT.FlatEffect.spend.enabled.label", hint: "DSCT.FlatEffect.spend.enabled.hint" }),
          value:   new NumberField({ integer: true, initial: 1, positive: true, nullable: false, required: true, label: "DSCT.FlatEffect.spend.value.label" }),
        }),
      }),
    });
  }

  get detailsPartial() { return "dsct.flat-cleanse"; }
  showUse() { return false; }

  get label() {
    return buildCleanseAutoLabel(this.flatCleanse);
  }

  async getSheetContext() {
    const src = this._source.flatCleanse;

    const expiryEntries = Object.values(ds.CONFIG.effectEnds ?? {})
      .filter(cfg => cfg.expiryEvent)
      .map(cfg => ({ value: cfg.expiryEvent, label: cfg.label ?? cfg.expiryEvent }));
    const expirySelected    = expiryEntries.filter(o => this.flatCleanse.expiryFilter.has(o.value));
    const expiryOptions     = expiryEntries.filter(o => !this.flatCleanse.expiryFilter.has(o.value));
    const allExpiryOptions  = expiryEntries.map(o => ({ ...o, selected: this.flatCleanse.expiryFilter.has(o.value) }));

    const statusEntries = CONFIG.statusEffects
      .filter(s => s.hud !== false)
      .map(s => ({ value: s.id, label: s.name ?? s.id }));
    const statusSelected   = statusEntries.filter(o => this.flatCleanse.statusFilter.has(o.value));
    const statusOptions    = statusEntries.filter(o => !this.flatCleanse.statusFilter.has(o.value));
    const allStatusOptions = statusEntries.map(o => ({ ...o, selected: this.flatCleanse.statusFilter.has(o.value) }));

    return {
      displayText:    { field: this.schema.getField("flatCleanse.displayText"), src: src.displayText },
      display:        { field: this.schema.getField("flatCleanse.display"),     src: src.display },
      repeatable:     { field: this.schema.getField("flatCleanse.repeatable"),  src: src.repeatable },
      expirySelected,
      expiryOptions,
      allExpiryOptions,
      statusSelected,
      statusOptions,
      allStatusOptions,
      spend: {
        enabled: { field: this.schema.getField("flatCleanse.spend.enabled"), src: src.spend.enabled },
        value:   { field: this.schema.getField("flatCleanse.spend.value"),   src: src.spend.value },
      },
    };
  }
}

function _buildDamageButton(effect, item) {
  const { value, types, ignoredImmunities, display, spend } = effect.flatDamage;
  const rollData = item.actor?.getRollData?.() ?? {};
  const simplified = rollData ? ds.utils.simplifyRollFormula(value, rollData) : value;
  const typeList = Array.from(types);
  const typeLabel = typeList.length
    ? game.i18n.getListFormatter({ type: "disjunction" }).format(typeList.map(t => ds.CONFIG.damageTypes[t]?.label ?? t))
    : game.i18n.localize("DRAW_STEEL.DamageType.typeless");
  const firstType = typeList[0] ?? null;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dsct-flat-damage-btn apply-damage";
  btn.dataset.formula = value;
  btn.dataset.types = typeList.join(",");
  btn.dataset.ignoredImmunities = Array.from(ignoredImmunities).join(",");
  btn.dataset.actorUuid    = item.actor?.uuid ?? "";
  btn.dataset.spendEnabled = String(spend?.enabled ?? false);
  btn.dataset.spendValue   = String(spend?.value ?? 1);
  const spendSuffix = spend?.enabled ? ` ${game.i18n.format("DSCT.FlatEffect.spend.costSuffix", { cost: spend.value })}` : "";
  const btnLabel = (display || game.i18n.format("DSCT.FlatEffect.Damage.defaultLabel", { value: simplified, types: typeLabel })) + spendSuffix;
  const iconClass = firstType ? (_FLAT_DAMAGE_ICONS[firstType] ?? "fa-solid fa-burst") : "fa-solid fa-burst";
  const dmgIconEl = document.createElement("i");
  dmgIconEl.className = iconClass;
  if (firstType && _FLAT_DAMAGE_COLORS[firstType]) dmgIconEl.style.color = _FLAT_DAMAGE_COLORS[firstType];
  btn.append(dmgIconEl, ` ${btnLabel}`);
  return btn;
}

const _FLAT_DAMAGE_ICONS = {
  acid: "fa-solid fa-flask-vial", cold: "fa-solid fa-snowflake",
  corruption: "fa-brands fa-galactic-republic", fire: "fa-solid fa-fire",
  holy: "fa-solid fa-sun", lightning: "fa-solid fa-bolt",
  poison: "fa-solid fa-skull-crossbones", psychic: "fa-solid fa-brain",
  sonic: "fa-solid fa-volume-high",
};
const _FLAT_DAMAGE_COLORS = {
  acid: "#6fbf4a", cold: "#65c7f7", corruption: "#9b59b6", fire: "#e74c3c",
  holy: "#f1c40f", lightning: "#f7dc6f", poison: "#2ecc71", psychic: "#e056fd",
  sonic: "#00cec9",
};

function _buildForcedRow(effect, item) {
  const { movement, distance, properties, display, spend } = effect.flatForced;
  const rollData = item.actor?.getRollData?.() ?? {};
  let distLabel;
  try { distLabel = rollData ? ds.utils.evaluateFormula(distance, rollData, { contextName: item.uuid }) : distance; }
  catch { distLabel = distance; }

  const movArr = Array.from(movement);
  const firstMov = movArr[0] ?? "push";
  const movConfig = ds.CONFIG.abilities.forcedMovement[firstMov];
  const movLabel = movConfig?.label ?? firstMov;
  const propArr = Array.from(properties);
  const spendSuffix = spend?.enabled ? ` ${game.i18n.format("DSCT.FlatEffect.spend.costSuffix", { cost: spend.value })}` : "";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "dsct-flat-forced-btn";
  applyBtn.style.flex = "1 1 auto";
  applyBtn.dataset.movement    = firstMov;
  applyBtn.dataset.distance    = distance;
  applyBtn.dataset.properties  = propArr.join(",");
  applyBtn.dataset.actorUuid   = item.actor?.uuid ?? "";
  applyBtn.dataset.spendEnabled = String(spend?.enabled ?? false);
  applyBtn.dataset.spendValue   = String(spend?.value ?? 1);
  applyBtn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${(display || game.i18n.format("DSCT.FlatEffect.FM.defaultLabel", { movement: movLabel, distance: distLabel })) + spendSuffix}`;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "dsct-flat-forced-edit-btn";
  editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
  editBtn.title = game.i18n.localize("DSCT.FlatEffect.FM.editTooltip");
  editBtn.style.cssText = "flex:0 0 auto;width:2.25em;padding:0;display:flex;align-items:center;justify-content:center;";
  editBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const cur = parseInt(applyBtn.dataset.distance) || 1;
    const distLbl = game.i18n.localize("DSCT.FlatEffect.FM.distanceLabel");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("DSCT.FlatEffect.FM.editTitle", { movement: movLabel }) },
      content: `<label style="display:flex;align-items:center;gap:.5rem;">${distLbl} <input type="number" name="dist" value="${cur}" min="1" style="width:5rem;"></label>`,
      ok: { label: game.i18n.localize("OK"), callback: (_ev, btn) => Number(btn.form.elements.dist.value) },
    }).catch(() => null);
    if (result != null && result >= 1) {
      applyBtn.dataset.distance = String(result);
      applyBtn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${(display || game.i18n.format("DSCT.FlatEffect.FM.defaultLabel", { movement: movLabel, distance: result })) + spendSuffix}`;
    }
  });

  const row = document.createElement("div");
  row.className = "dsct-flat-forced-row";
  row.style.cssText = "display:flex;gap:2px;";
  row.appendChild(applyBtn);
  row.appendChild(editBtn);
  return row;
}

function _buildAppliedButton(effect, item) {
  const { statusId, display, spend } = effect.flatApplied;
  const statusEntry = statusId ? CONFIG.statusEffects.find(s => s.id === statusId) : null;
  const label = display || statusEntry?.name || statusId;
  if (!label && !statusId) return null;

  const iconSrc = statusEntry?.img ?? statusEntry?.icon ?? null;
  let iconHtml;
  if (iconSrc && (iconSrc.includes("/") || iconSrc.includes("."))) {
    iconHtml = `<img src="${iconSrc}" style="width:1.35em;height:1.35em;object-fit:contain;vertical-align:middle;">`;
  } else if (iconSrc) {
    iconHtml = `<i class="${iconSrc}"></i>`;
  } else {
    iconHtml = `<i class="fa-solid fa-star"></i>`;
  }

  const spendSuffix = spend?.enabled ? ` ${game.i18n.format("DSCT.FlatEffect.spend.costSuffix", { cost: spend.value })}` : "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dsct-flat-applied-btn";
  btn.dataset.statusId     = statusId ?? "";
  btn.dataset.actorUuid    = item?.actor?.uuid ?? "";
  btn.dataset.spendEnabled = String(spend?.enabled ?? false);
  btn.dataset.spendValue   = String(spend?.value ?? 1);
  btn.innerHTML = `${iconHtml} ${(label ?? statusId) + spendSuffix}`;
  return btn;
}

function _buildHealButton(effect, item) {
  const { display, spendRecovery, recoverySource, amountType, amountFormula, recoveryValueSource, tempStamina, repeatable, spend } = effect.flatHeal;
  const sourceActor = item.actor;

  let amountStr;
  if (amountType === "recoveryValue") {
    amountStr = recoveryValueSource === "self" && sourceActor
      ? String(sourceActor.system.recoveries?.recoveryValue ?? "?")
      : game.i18n.localize("DSCT.FlatEffect.Heal.rvPlaceholder");
  } else {
    const rd = sourceActor?.getRollData?.() ?? {};
    try { amountStr = ds.utils.simplifyRollFormula(amountFormula, rd); }
    catch { amountStr = amountFormula; }
  }

  let defaultLabel;
  if (tempStamina && spendRecovery) defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.spendTempLabel",  { amount: amountStr });
  else if (tempStamina)             defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.tempLabel",        { amount: amountStr });
  else if (spendRecovery)           defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.spendHealLabel",   { amount: amountStr });
  else                              defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.healLabel",        { amount: amountStr });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dsct-flat-heal-btn";
  btn.dataset.effectId            = effect.id;
  btn.dataset.spendRecovery       = String(spendRecovery);
  btn.dataset.recoverySource      = recoverySource;
  btn.dataset.amountType          = amountType;
  btn.dataset.amountFormula       = amountFormula;
  btn.dataset.recoveryValueSource = recoveryValueSource;
  btn.dataset.tempStamina         = String(tempStamina);
  btn.dataset.repeatable          = String(repeatable);
  btn.dataset.actorUuid           = sourceActor?.uuid ?? "";
  btn.dataset.spendEnabled        = String(spend?.enabled ?? false);
  btn.dataset.spendValue          = String(spend?.value ?? 1);
  const spendSuffix = spend?.enabled ? ` ${game.i18n.format("DSCT.FlatEffect.spend.costSuffix", { cost: spend.value })}` : "";
  const iconClass = tempStamina ? "fa-solid fa-shield-halved" : "fa-solid fa-heart-pulse";
  btn.innerHTML = `<i class="${iconClass}" style="color:#2ecc71"></i> ${(display || defaultLabel) + spendSuffix}`;
  return btn;
}

export function buildCleanseAutoLabel(flatCleanse) {
  const { display, displayText, expiryFilter, statusFilter } = flatCleanse;
  if (display) return display;
  if (displayText) return displayText;
  const parts = [];
  const efSet = expiryFilter instanceof Set ? expiryFilter : new Set(expiryFilter ?? []);
  for (const ev of efSet) {
    const cfg = Object.values(ds.CONFIG.effectEnds ?? {}).find(c => c.expiryEvent === ev);
    if (cfg?.label) parts.push(cfg.label);
  }
  const sfSet = statusFilter instanceof Set ? statusFilter : new Set(statusFilter ?? []);
  for (const id of sfSet) {
    const name = CONFIG.statusEffects.find(s => s.id === id)?.name;
    if (name) parts.push(name);
  }
  if (!parts.length) return game.i18n.localize('DSCT.FlatEffect.Cleanse.defaultLabel');
  return game.i18n.format('DSCT.FlatEffect.Cleanse.autoLabel', {
    effects: game.i18n.getListFormatter({ type: 'disjunction' }).format(parts),
  });
}

function _buildCleanseButton(effect, item) {
  const { expiryFilter, statusFilter, repeatable, spend } = effect.flatCleanse;
  const label = buildCleanseAutoLabel(effect.flatCleanse);
  const spendSuffix = spend?.enabled ? ` ${game.i18n.format("DSCT.FlatEffect.spend.costSuffix", { cost: spend.value })}` : "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dsct-flat-cleanse-btn";
  btn.dataset.effectId     = effect.id;
  btn.dataset.expiryFilter = [...expiryFilter].join(",");
  btn.dataset.statusFilter = [...statusFilter].join(",");
  btn.dataset.repeatable   = String(repeatable);
  btn.dataset.actorUuid    = item.actor?.uuid ?? "";
  btn.dataset.spendEnabled = String(spend?.enabled ?? false);
  btn.dataset.spendValue   = String(spend?.value ?? 1);
  btn.innerHTML = `<i class="fa-solid fa-broom"></i> ${label + spendSuffix}`;
  return btn;
}

async function _spendHeroicResource(actor, cost) {
  const heroicVal = actor?.system.hero?.primary?.value ?? 0;
  if (heroicVal < cost) {
    const resName = actor?.system.hero?.primary?.label ?? game.i18n.localize("DSCT.FlatEffect.spend.resource");
    ui.notifications.warn(game.i18n.format("DSCT.FlatEffect.spend.insufficient", { name: actor?.name ?? "?", cost, resource: resName }));
    return false;
  }
  await actor.update({ "system.hero.primary.value": heroicVal - cost });
  return true;
}

function _addFlatEffectListeners(section, item, message) {
  section.querySelectorAll(".dsct-flat-damage-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const formula = btn.dataset.formula;
      const typeList = btn.dataset.types ? btn.dataset.types.split(",").filter(Boolean) : [];
      const immunities = btn.dataset.ignoredImmunities ? btn.dataset.ignoredImmunities.split(",").filter(Boolean) : [];
      const targets = [...game.user.targets];
      if (!targets.length) { ui.notifications.warn(game.i18n.localize("DSCT.notice.noTargets")); return; }

      if (btn.dataset.spendEnabled === "true") {
        const sourceActor = btn.dataset.actorUuid ? fromUuidSync(btn.dataset.actorUuid) : item.actor;
        const ok = await _spendHeroicResource(sourceActor, parseInt(btn.dataset.spendValue) || 1);
        if (!ok) return;
      }

      const rollData = item.actor?.getRollData?.() ?? {};
      const roll = new Roll(formula, rollData);
      await roll.evaluate();
      const amount = Math.floor(roll.total);

      for (const target of targets) {
        if (!target.actor) continue;
        await applyDamage(target.actor, amount, undefined, {
          damageType: typeList[0] ?? "untyped",
          ignoreImmunity: immunities.includes("all"),
          sourceItemName: item.name,
        });
      }
    });
  });

  section.querySelectorAll(".dsct-flat-forced-btn").forEach(applyBtn => {
    applyBtn.addEventListener("click", async () => {
      const controlled = canvas.tokens.controlled;
      const actorUuid = applyBtn.dataset.actorUuid;
      const sourceActor = actorUuid ? fromUuidSync(actorUuid) : null;

      if (applyBtn.dataset.spendEnabled === "true") {
        const ok = await _spendHeroicResource(sourceActor ?? item.actor, parseInt(applyBtn.dataset.spendValue) || 1);
        if (!ok) return;
      }

      const source = (sourceActor?.isToken
        ? sourceActor.token?.object
        : canvas.tokens.placeables.find(t => t.actor?.id === sourceActor?.id)
      ) ?? (controlled.length === 1 ? controlled[0] : null);

      await runForcedMovement({
        movement: applyBtn.dataset.movement,
        distance: applyBtn.dataset.distance,
        properties: new Set(applyBtn.dataset.properties ? applyBtn.dataset.properties.split(",").filter(Boolean) : []),
        source,
      });
    });
  });

  section.querySelectorAll(".dsct-flat-applied-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const statusId = btn.dataset.statusId;
      if (!statusId) return;
      const targets = [...game.user.targets];
      if (!targets.length) { ui.notifications.warn(game.i18n.localize("DSCT.notice.noTargets")); return; }

      if (btn.dataset.spendEnabled === "true") {
        const sourceActor = btn.dataset.actorUuid ? fromUuidSync(btn.dataset.actorUuid) : item.actor;
        const ok = await _spendHeroicResource(sourceActor, parseInt(btn.dataset.spendValue) || 1);
        if (!ok) return;
      }

      for (const target of targets) {
        if (!target.actor) continue;
        await target.actor.toggleStatusEffect(statusId, { active: true });
      }
    });
  });

  section.querySelectorAll(".dsct-flat-heal-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const targets = [...game.user.targets];
      if (!targets.length) { ui.notifications.warn(game.i18n.localize("DSCT.notice.noTargets")); return; }
      const sourceActor         = btn.dataset.actorUuid ? fromUuidSync(btn.dataset.actorUuid) : null;
      const spendRecovery       = btn.dataset.spendRecovery === "true";
      const recoverySource      = btn.dataset.recoverySource;
      const amountType          = btn.dataset.amountType;
      const amountFormula       = btn.dataset.amountFormula;
      const recoveryValueSource = btn.dataset.recoveryValueSource;
      const tempStamina         = btn.dataset.tempStamina === "true";
      const repeatable          = btn.dataset.repeatable === "true";
      const effectId            = btn.dataset.effectId;

      if (btn.dataset.spendEnabled === "true") {
        const ok = await _spendHeroicResource(sourceActor, parseInt(btn.dataset.spendValue) || 1);
        if (!ok) return;
      }

      let anyApplied = false;
      for (const target of targets) {
        const targetActor = target.actor;
        if (!targetActor) continue;

        if (!tempStamina) {
          const curStamina = targetActor.system.stamina?.value ?? 0;
          const maxStamina = targetActor.system.stamina?.max ?? 0;
          if (curStamina >= maxStamina) {
            ui.notifications.warn(game.i18n.format("DSCT.FlatEffect.Heal.alreadyMax", { name: targetActor.name }));
            continue;
          }
        }

        if (spendRecovery) {
          const recovActor = recoverySource === "target" ? targetActor : sourceActor;
          if (!recovActor) continue;
          const available = recovActor.system.recoveries?.value ?? 0;
          if (available <= 0) {
            ui.notifications.warn(game.i18n.format("DSCT.FlatEffect.Heal.noRecoveries", { name: recovActor.name }));
            continue;
          }
          await recovActor.update({ "system.recoveries.value": available - 1 });
        }

        let amount;
        if (amountType === "recoveryValue") {
          const rvActor = recoveryValueSource === "target" ? targetActor : sourceActor;
          amount = rvActor?.system.recoveries?.recoveryValue ?? 0;
        } else {
          const rd = sourceActor?.getRollData?.() ?? {};
          const roll = new Roll(amountFormula || "0", rd);
          await roll.evaluate();
          amount = Math.floor(roll.total);
        }

        if (tempStamina) {
          await targetActor.update({ "system.stamina.temporary": amount });
        } else {
          await targetActor.modifyTokenAttribute("stamina", amount, true);
        }
        anyApplied = true;
      }

      if (!repeatable && anyApplied) {
        btn.disabled = true;
        if (message) _nonDstdHealUsed.add(`${message.id}:${effectId}`);
      }
    });
  });

  section.querySelectorAll(".dsct-flat-cleanse-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const targets = [...game.user.targets];
      if (!targets.length) { ui.notifications.warn(game.i18n.localize("DSCT.notice.noTargets")); return; }

      const expiryFilter = new Set(btn.dataset.expiryFilter ? btn.dataset.expiryFilter.split(",").filter(Boolean) : []);
      const statusFilter = new Set(btn.dataset.statusFilter ? btn.dataset.statusFilter.split(",").filter(Boolean) : []);
      const repeatable   = btn.dataset.repeatable === "true";
      const effectId     = btn.dataset.effectId;

      if (btn.dataset.spendEnabled === "true") {
        const sourceActor = btn.dataset.actorUuid ? fromUuidSync(btn.dataset.actorUuid) : item.actor;
        const ok = await _spendHeroicResource(sourceActor, parseInt(btn.dataset.spendValue) || 1);
        if (!ok) return;
      }

      const matchesFilter = (effect) => {
        if (expiryFilter.size > 0 && expiryFilter.has(effect.duration?.expiry)) return true;
        if (statusFilter.size > 0 && [...(effect.statuses ?? [])].some(s => statusFilter.has(s))) return true;
        return false;
      };

      let anyApplied = false;
      for (const target of targets) {
        const actor = target.actor;
        if (!actor) continue;

        const cleansable = actor.effects.filter(matchesFilter);
        if (!cleansable.length) {
          ui.notifications.warn(game.i18n.format("DSCT.FlatEffect.Cleanse.noMatch", { name: actor.name }));
          continue;
        }

        let chosen = cleansable.length === 1 ? cleansable[0] : null;
        if (!chosen) {
          let chosenId = null;
          const boxes = cleansable.map(e => {
            const expiryLabel = ds.CONFIG.effectEnds?.[e.duration?.expiry]?.label ?? "";
            const expPart = expiryLabel ? ` (${expiryLabel})` : "";
            return `<label style="display:block;margin:4px 0"><input type="radio" name="dsct-cleanse-pick" value="${e.id}"> ${e.name}${expPart}</label>`;
          }).join("");
          await foundry.applications.api.DialogV2.wait({
            window: { title: game.i18n.format("DSCT.FlatEffect.Cleanse.pickTitle", { name: actor.name }) },
            content: `<fieldset style="border:0;padding:8px">${boxes}</fieldset>`,
            buttons: [
              { label: game.i18n.localize("DSCT.FlatEffect.Cleanse.cleanseBtn"), action: "confirm", callback: (_ev, _btn, dialog) => {
                const checked = dialog.element.querySelector("input[name=dsct-cleanse-pick]:checked");
                if (checked) chosenId = checked.value;
              }},
              { label: game.i18n.localize("Cancel"), action: "cancel" },
            ],
            rejectClose: false,
          });
          if (!chosenId) continue;
          chosen = actor.effects.get(chosenId);
        }

        if (!chosen) continue;
        await chosen.delete();
        anyApplied = true;
      }

      if (!repeatable && anyApplied) {
        btn.disabled = true;
        if (message) _nonDstdCleanseUsed.add(`${message.id}:${effectId}`);
      }
    });
  });
}

function _installFlatEffectChatHook() {
  Hooks.on("renderChatMessageHTML", async (message, html) => {
    if (!message.system?.parts) return;
    const part = message.system.parts.get(ABILITY_PART_ID);
    if (!part?.abilityUuid) return;

    const item = fromUuidSync(part.abilityUuid);
    if (!item?.system?.effects) return;

    const flatEffects = item.system.effects.contents.filter(e => FLAT_TYPES.has(e.type));
    if (!flatEffects.length) return;

    const partSection = html.querySelector(`section[data-message-part="${ABILITY_PART_ID}"]`);
    if (!partSection) return;

    const dmgButtons  = flatEffects.filter(e => e.type === "dsct.flatDamage") .map(e => _buildDamageButton(e, item));
    const fmRows      = flatEffects.filter(e => e.type === "dsct.flatForced") .map(e => _buildForcedRow(e, item));
    const condButtons = flatEffects.filter(e => e.type === "dsct.flatApplied").map(e => _buildAppliedButton(e, item)).filter(Boolean);
    const healButtons = flatEffects.filter(e => e.type === "dsct.flatHeal").map(e => {
      const btn = _buildHealButton(e, item);
      if (!e.flatHeal.repeatable && _nonDstdHealUsed.has(`${message.id}:${e.id}`)) btn.disabled = true;
      return btn;
    });
    const cleanseButtons = flatEffects.filter(e => e.type === "dsct.flatCleanse").map(e => {
      const btn = _buildCleanseButton(e, item);
      if (!e.flatCleanse.repeatable && _nonDstdCleanseUsed.has(`${message.id}:${e.id}`)) btn.disabled = true;
      return btn;
    });
    const buttons = [...dmgButtons, ...fmRows, ...condButtons, ...healButtons, ...cleanseButtons];
    if (!buttons.length) return;

    let footer = partSection.querySelector("footer.message-part-buttons");
    if (!footer) {
      footer = document.createElement("footer");
      footer.className = "message-part-buttons";
      partSection.appendChild(footer);
    }
    for (const btn of buttons) footer.appendChild(btn);

    _addFlatEffectListeners(partSection, item, message);
  });
}

(function _earlyRegister() {
  const cfg = globalThis.ds?.CONFIG?.SpecialEffect;
  if (!cfg) return;
  cfg["dsct.flatDamage"]   = { label: "TYPES.SpecialEffect.dsct.flatDamage",   defaultImage: "icons/svg/fire.svg",     documentClass: FlatDamageSpecialEffect };
  cfg["dsct.flatForced"]   = { label: "TYPES.SpecialEffect.dsct.flatForced",   defaultImage: "icons/svg/portal.svg",    documentClass: FlatForcedSpecialEffect };
  cfg["dsct.flatApplied"]  = { label: "TYPES.SpecialEffect.dsct.flatApplied",  defaultImage: "icons/svg/paralysis.svg", documentClass: FlatAppliedSpecialEffect };
  cfg["dsct.flatResource"] = { label: "TYPES.SpecialEffect.dsct.flatResource", defaultImage: "icons/svg/lightning.svg", documentClass: FlatResourceSpecialEffect };
  cfg["dsct.flatHeal"]    = { label: "TYPES.SpecialEffect.dsct.flatHeal",    defaultImage: "icons/svg/heal.svg",      documentClass: FlatHealSpecialEffect };
  cfg["dsct.flatCleanse"] = { label: "TYPES.SpecialEffect.dsct.flatCleanse", defaultImage: "icons/svg/aura.svg",      documentClass: FlatCleanseSpecialEffect };
})();

function _installDisplayTextAutofill() {
  Hooks.on('renderApplicationV2', (_app, element) => {
    const input = element.querySelector?.('input[name="flatApplied.displayText"]');
    if (!input) return;
    input.addEventListener('blur', () => {
      if (input.value.trim()) return;
      const form = input.closest('form') ?? element;
      const statusSel = form.querySelector('select[name="flatApplied.statusId"]');
      const endSel    = form.querySelector('select[name="flatApplied.end"]');
      const charSel   = form.querySelector('select[name="flatApplied.potency.characteristic"]');
      const hasPotency = !!(charSel?.value);
      const statusName = statusSel?.options[statusSel.selectedIndex]?.text?.trim() ?? '';
      const endVal    = endSel?.value ?? '';
      const endName   = endVal ? (endSel?.options[endSel.selectedIndex]?.text?.trim() ?? '') : '';
      const parts = [];
      if (hasPotency) parts.push('{{potency}}');
      parts.push(statusName || '[Effect]');
      if (endName) parts.push(`(${endName})`);
      input.value = parts.join(' ');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function _installHealToggleListeners() {
  Hooks.on('renderApplicationV2', (_app, element) => {
    const spendToggle = element.querySelector?.('input[name="flatHeal.spendRecovery"]');
    const amountSel   = element.querySelector?.('select[name="flatHeal.amountType"]');
    if (!spendToggle && !amountSel) return;

    const recSourceDiv = element.querySelector('[data-dsct-heal-recovery-source]');
    const customDiv    = element.querySelector('[data-dsct-heal-custom]');
    const rvSourceDiv  = element.querySelector('[data-dsct-heal-rv-source]');

    const syncSpend = () => {
      if (!recSourceDiv) return;
      if (spendToggle?.checked) recSourceDiv.removeAttribute('hidden');
      else recSourceDiv.setAttribute('hidden', '');
    };
    const syncAmount = () => {
      const isCustom = amountSel?.value === 'custom';
      const isRV     = amountSel?.value === 'recoveryValue';
      if (customDiv)   { if (isCustom) customDiv.removeAttribute('hidden');   else customDiv.setAttribute('hidden', ''); }
      if (rvSourceDiv) { if (isRV)     rvSourceDiv.removeAttribute('hidden'); else rvSourceDiv.setAttribute('hidden', ''); }
    };

    if (spendToggle) { spendToggle.addEventListener('change', syncSpend); syncSpend(); }
    if (amountSel)   { amountSel.addEventListener('change', syncAmount); syncAmount(); }
  });
}

function _installCleanseTagPickers() {
  Hooks.on('renderApplicationV2', (_app, element) => {
    element.querySelectorAll?.('.dsct-tag-picker').forEach(picker => {
      const fieldName = picker.dataset.dsctTagField;
      const tagList   = picker.querySelector('.dsct-tag-list');
      const addSelect = picker.querySelector('.dsct-tag-add-select');
      const hiddenSel = picker.querySelector(`select[name="${fieldName}"]`);
      if (!tagList || !addSelect || !hiddenSel) return;

      const findHiddenOpt = (value) => [...hiddenSel.options].find(o => o.value === value);

      const removeTag = (value) => {
        const hiddenOpt = findHiddenOpt(value);
        if (hiddenOpt) {
          hiddenOpt.selected = false;
          const restoreOpt = document.createElement('option');
          restoreOpt.value = value;
          restoreOpt.textContent = hiddenOpt.text;
          addSelect.appendChild(restoreOpt);
        }
        tagList.querySelector(`.dsct-tag[data-value="${value}"]`)?.remove();
        hiddenSel.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const addTag = (value) => {
        const hiddenOpt = findHiddenOpt(value);
        if (!hiddenOpt || hiddenOpt.selected) return;
        hiddenOpt.selected = true;
        [...addSelect.options].find(o => o.value === value)?.remove();
        const tag = document.createElement('span');
        tag.className = 'dsct-tag';
        tag.dataset.value = value;
        const labelNode = document.createTextNode(hiddenOpt.text);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dsct-tag-remove';
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        removeBtn.addEventListener('click', () => removeTag(value));
        tag.appendChild(labelNode);
        tag.appendChild(removeBtn);
        tagList.appendChild(tag);
        hiddenSel.dispatchEvent(new Event('change', { bubbles: true }));
      };

      tagList.querySelectorAll('.dsct-tag-remove').forEach(btn => {
        const tag = btn.closest('.dsct-tag');
        const value = tag?.dataset.value;
        if (value) btn.addEventListener('click', () => removeTag(value));
      });

      addSelect.addEventListener('change', () => {
        const value = addSelect.value;
        if (!value) return;
        addSelect.value = '';
        addTag(value);
      });
    });
  });
}

function _installSpendToggleListeners() {
  const PREFIXES = ["flatDamage", "flatForced", "flatApplied", "flatResource", "flatHeal", "flatCleanse"];
  Hooks.on('renderApplicationV2', (_app, element) => {
    for (const prefix of PREFIXES) {
      const toggle = element.querySelector?.(`input[name="${prefix}.spend.enabled"]`);
      if (!toggle) continue;
      const costDiv = element.querySelector(`[data-dsct-flat-spend-cost="${prefix}"]`);
      if (!costDiv) continue;
      const sync = () => {
        if (toggle.checked) costDiv.removeAttribute('hidden');
        else costDiv.setAttribute('hidden', '');
      };
      toggle.addEventListener('change', sync);
      sync();
    }
  });
}

function _installPotencyCustomToggle() {
  Hooks.on('renderApplicationV2', (_app, element) => {
    const strengthSel = element.querySelector?.('select[name="flatApplied.potency.strength"]');
    if (!strengthSel) return;
    const customDiv = element.querySelector('[data-dsct-potency-custom]');
    if (!customDiv) return;
    const update = () => {
      if (strengthSel.value === 'custom') customDiv.removeAttribute('hidden');
      else customDiv.setAttribute('hidden', '');
    };
    strengthSel.addEventListener('change', update);
    update();
  });
}

export function registerFlatEffects() {
  _registerPartials();
  _installFlatEffectChatHook();
  _installDisplayTextAutofill();
  _installPotencyCustomToggle();
  _installHealToggleListeners();
  _installSpendToggleListeners();
  _installCleanseTagPickers();

  ds.CONFIG.SpecialEffect["dsct.flatDamage"] = {
    label: "TYPES.SpecialEffect.dsct.flatDamage",
    defaultImage: "icons/svg/fire.svg",
    documentClass: FlatDamageSpecialEffect,
  };
  ds.CONFIG.SpecialEffect["dsct.flatForced"] = {
    label: "TYPES.SpecialEffect.dsct.flatForced",
    defaultImage: "icons/svg/portal.svg",
    documentClass: FlatForcedSpecialEffect,
  };
  ds.CONFIG.SpecialEffect["dsct.flatApplied"] = {
    label: "TYPES.SpecialEffect.dsct.flatApplied",
    defaultImage: "icons/svg/paralysis.svg",
    documentClass: FlatAppliedSpecialEffect,
  };
  ds.CONFIG.SpecialEffect["dsct.flatResource"] = {
    label: "TYPES.SpecialEffect.dsct.flatResource",
    defaultImage: "icons/svg/lightning.svg",
    documentClass: FlatResourceSpecialEffect,
  };
  ds.CONFIG.SpecialEffect["dsct.flatHeal"] = {
    label: "TYPES.SpecialEffect.dsct.flatHeal",
    defaultImage: "icons/svg/heal.svg",
    documentClass: FlatHealSpecialEffect,
  };
  ds.CONFIG.SpecialEffect["dsct.flatCleanse"] = {
    label: "TYPES.SpecialEffect.dsct.flatCleanse",
    defaultImage: "icons/svg/aura.svg",
    documentClass: FlatCleanseSpecialEffect,
  };
}
