import { applyDamage } from '../helpers.mjs';
import { runForcedMovement } from '../forced-movement/forced-movement.mjs';

const { SchemaField, SetField, StringField, NumberField } = foundry.data.fields;
const ABILITY_PART_ID = "abilityUse".padEnd(16, "0");
const FLAT_TYPES = new Set(["dsct.flatDamage", "dsct.flatForced", "dsct.flatApplied", "dsct.flatResource"]);

function _setField(opts = {}) {
  return new StringField({ ...opts, required: true, blank: false });
}

function _registerPartials() {
  Handlebars.registerPartial("dsct.flat-damage", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatDamage.displayText" localize=true}}
    {{formGroup ctx.value.field value=ctx.value.src name="flatDamage.value" localize=true}}
    {{formGroup ctx.types.field value=ctx.types.src name="flatDamage.types" options=ctx.damageTypes localize=true}}
    {{formGroup ctx.ignoredImmunities.field value=ctx.ignoredImmunities.src name="flatDamage.ignoredImmunities" options=ctx.immunityTypes localize=true}}
    {{formGroup ctx.display.field value=ctx.display.src name="flatDamage.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-forced", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatForced.displayText" localize=true}}
    {{formGroup ctx.movement.field value=ctx.movement.src name="flatForced.movement" options=ctx.movementOptions localize=true}}
    {{formGroup ctx.distance.field value=ctx.distance.src name="flatForced.distance" localize=true}}
    {{formGroup ctx.properties.field value=ctx.properties.src name="flatForced.properties" options=ctx.propertyOptions localize=true}}
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
    {{formGroup ctx.display.field value=ctx.display.src name="flatApplied.display" localize=true}}
  `);

  Handlebars.registerPartial("dsct.flat-resource", `
    {{formGroup ctx.displayText.field value=ctx.displayText.src name="flatResource.displayText" localize=true}}
    {{formGroup ctx.amount.field value=ctx.amount.src name="flatResource.amount" localize=true}}
    {{formGroup ctx.type.field value=ctx.type.src name="flatResource.type" options=ctx.typeOptions localize=true}}
    {{formGroup ctx.display.field value=ctx.display.src name="flatResource.display" localize=true}}
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
    };
  }
}

function _buildDamageButton(effect, item) {
  const { value, types, ignoredImmunities, display } = effect.flatDamage;
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
  const btnLabel = display || `Apply ${simplified} ${typeLabel}`;
  const iconClass = firstType ? (_FLAT_DAMAGE_ICONS[firstType] ?? "fa-solid fa-burst") : "fa-solid fa-burst";
  btn.innerHTML = `<i class="${iconClass}"></i> ${btnLabel}`;
  return btn;
}

const _FLAT_DAMAGE_ICONS = {
  acid: "fa-solid fa-flask-vial", cold: "fa-solid fa-snowflake",
  corruption: "fa-brands fa-galactic-republic", fire: "fa-solid fa-fire",
  holy: "fa-solid fa-sun", lightning: "fa-solid fa-bolt",
  poison: "fa-solid fa-skull-crossbones", psychic: "fa-solid fa-brain",
  sonic: "fa-solid fa-volume-high",
};

function _buildForcedRow(effect, item) {
  const { movement, distance, properties, display } = effect.flatForced;
  const rollData = item.actor?.getRollData?.() ?? {};
  let distLabel;
  try { distLabel = rollData ? ds.utils.evaluateFormula(distance, rollData, { contextName: item.uuid }) : distance; }
  catch { distLabel = distance; }

  const movArr = Array.from(movement);
  const firstMov = movArr[0] ?? "push";
  const movConfig = ds.CONFIG.abilities.forcedMovement[firstMov];
  const movLabel = movConfig?.label ?? firstMov;
  const propArr = Array.from(properties);

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "dsct-flat-forced-btn";
  applyBtn.style.flex = "1 1 auto";
  applyBtn.dataset.movement = firstMov;
  applyBtn.dataset.distance = distance;
  applyBtn.dataset.properties = propArr.join(",");
  applyBtn.dataset.actorUuid = item.actor?.uuid ?? "";
  applyBtn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${display || `${movLabel} ${distLabel}`}`;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "dsct-flat-forced-edit-btn";
  editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
  editBtn.title = "Modify distance";
  editBtn.style.cssText = "flex:0 0 auto;width:2.25em;padding:0;display:flex;align-items:center;justify-content:center;";
  editBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const cur = parseInt(applyBtn.dataset.distance) || 1;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Modify ${movLabel}` },
      content: `<label style="display:flex;align-items:center;gap:.5rem;">Distance <input type="number" name="dist" value="${cur}" min="1" style="width:5rem;"></label>`,
      ok: { label: "OK", callback: (_ev, btn) => Number(btn.form.elements.dist.value) },
    }).catch(() => null);
    if (result != null && result >= 1) {
      applyBtn.dataset.distance = String(result);
      applyBtn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${display || `${movLabel} ${result}`}`;
    }
  });

  const row = document.createElement("div");
  row.className = "dsct-flat-forced-row";
  row.style.cssText = "display:flex;gap:2px;";
  row.appendChild(applyBtn);
  row.appendChild(editBtn);
  return row;
}

function _buildAppliedButton(effect) {
  const { statusId, display } = effect.flatApplied;
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

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dsct-flat-applied-btn";
  btn.dataset.statusId = statusId ?? "";
  btn.innerHTML = `${iconHtml} ${label ?? statusId}`;
  return btn;
}

function _addFlatEffectListeners(section, item) {
  section.querySelectorAll(".dsct-flat-damage-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const formula = btn.dataset.formula;
      const typeList = btn.dataset.types ? btn.dataset.types.split(",").filter(Boolean) : [];
      const immunities = btn.dataset.ignoredImmunities ? btn.dataset.ignoredImmunities.split(",").filter(Boolean) : [];
      const targets = [...game.user.targets];
      if (!targets.length) { ui.notifications.warn(game.i18n.localize("DSCT.notice.noTargets")); return; }

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
      for (const target of targets) {
        if (!target.actor) continue;
        await target.actor.toggleStatusEffect(statusId, { active: true });
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
    const condButtons = flatEffects.filter(e => e.type === "dsct.flatApplied").map(e => _buildAppliedButton(e)).filter(Boolean);
    const buttons = [...dmgButtons, ...fmRows, ...condButtons];
    if (!buttons.length) return;

    let footer = partSection.querySelector("footer.message-part-buttons");
    if (!footer) {
      footer = document.createElement("footer");
      footer.className = "message-part-buttons";
      partSection.appendChild(footer);
    }
    for (const btn of buttons) footer.appendChild(btn);

    _addFlatEffectListeners(partSection, item);
  });
}

(function _earlyRegister() {
  const cfg = globalThis.ds?.CONFIG?.SpecialEffect;
  if (!cfg) return;
  cfg["dsct.flatDamage"]   = { label: "TYPES.SpecialEffect.dsct.flatDamage",   defaultImage: "icons/svg/fire.svg",     documentClass: FlatDamageSpecialEffect };
  cfg["dsct.flatForced"]   = { label: "TYPES.SpecialEffect.dsct.flatForced",   defaultImage: "icons/svg/portal.svg",    documentClass: FlatForcedSpecialEffect };
  cfg["dsct.flatApplied"]  = { label: "TYPES.SpecialEffect.dsct.flatApplied",  defaultImage: "icons/svg/paralysis.svg", documentClass: FlatAppliedSpecialEffect };
  cfg["dsct.flatResource"] = { label: "TYPES.SpecialEffect.dsct.flatResource", defaultImage: "icons/svg/lightning.svg", documentClass: FlatResourceSpecialEffect };
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
}
