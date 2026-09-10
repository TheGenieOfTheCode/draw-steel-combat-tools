import { normalizeCollection } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const PARTIAL = `modules/${M}/templates/effects/choose.hbs`;

function choiceSchema() {
  const { SchemaField, StringField, NumberField, ArrayField, SetField } = foundry.data.fields;
  const Formula = ds.data.fields.FormulaField;

  return new ArrayField(new SchemaField({
    name: new StringField({ required: true, blank: true }),
    story: new StringField({ required: true, blank: true }),
    keywords: new SetField(new StringField({ required: true, blank: false })),
    distance: new SchemaField({
      type: new StringField({ required: true, blank: true, initial: '' }),
      primary: new Formula({ deterministic: true, blank: true, initial: '' }),
      secondary: new Formula({ deterministic: true, blank: true, initial: '' }),
      tertiary: new Formula({ deterministic: true, blank: true, initial: '' }),
    }),
    target: new SchemaField({
      type: new StringField({ required: true, blank: true, initial: '' }),
      custom: new StringField({ required: true, blank: true }),
      value: new NumberField({ required: false, integer: true, initial: null, nullable: true }),
    }),
    
    
    effects: new SetField(new StringField({ required: true, blank: false })),
  }));
}

function _effectChoices(pseudo) {
  const item = pseudo.document;
  const seen = new Map();

  const collect = (collection, kind) => {
    for (const effect of collection ?? []) {
      if (effect.id === pseudo.id) continue;
      const name = (effect.name ?? '').trim();
      if (!name) continue;
      if (!seen.has(name)) seen.set(name, { name, kind, count: 0 });
      seen.get(name).count++;
    }
  };

  collect(item?.system?.power?.effects, 'powerRoll');
  collect(item?.system?.effects, 'special');

  const options = [...seen.values()].map(e => ({
    value: e.name,
    label: e.count > 1 ? `${e.name} (x${e.count})` : e.name,
    group: game.i18n.localize(`DSCT.choose.group.${e.kind}`),
  }));

  return { options, duplicates: [...seen.values()].filter(e => e.count > 1).map(e => e.name) };
}

function chooseSheetContext(pseudo) {
  const config = ds.CONFIG.abilities;
  const blank = { value: '', label: game.i18n.localize('DSCT.choose.sameAsAbility') };

  const distanceTypes = [blank, ...Object.entries(config.distances).map(([value, { label }]) => ({ value, label }))];
  const targetTypes = [blank, ...Object.entries(config.targets).map(([value, { label }]) => ({ value, label }))];
  const { options: effectOptions, duplicates } = _effectChoices(pseudo);

  const source = pseudo._source.choose?.choices ?? [];
  const fields = pseudo.schema.getField('choose.choices').element.fields;

  
  
  
  const af = pseudo.document?.system?.schema?.fields ?? {};
  const labels = {
    story: af.story?.label ?? '',
    keywords: af.keywords?.label ?? '',
    distanceLegend: af.distance?.label ?? '',
    distanceType: af.distance?.fields?.type?.label ?? '',
    targetLegend: af.target?.label ?? '',
    targetType: af.target?.fields?.type?.label ?? '',
    targetCustom: af.target?.fields?.custom?.label ?? '',
    targetValue: af.target?.fields?.value?.label ?? '',
  };

  const choices = source.map((choice, index) => {
    const dist = config.distances[choice.distance?.type] ?? {};
    const targetType = choice.target?.type ?? '';
    return {
      index,
      number: index + 1,
      src: choice,
      prefix: `choose.choices.${index}`,
      primaryDistance: dist.primary ?? '',
      secondaryDistance: dist.secondary ?? '',
      tertiaryDistance: dist.tertiary ?? '',
      showTargetValue: !['', 'self', 'selfOrAlly', 'special'].includes(targetType),
    };
  });

  return {
    fields,
    choices,
    distanceTypes,
    targetTypes,
    effectOptions,
    duplicateNames: duplicates.join(', '),
    hasDuplicates: duplicates.length > 0,
    keywordOptions: config.keywordOptions,
    labels,
    hasEffects: effectOptions.length > 0,
  };
}

export function registerChooseEffect() {
  if (typeof ds === 'undefined' || !ds.CONFIG?.SpecialEffect) {
    console.warn(`DSCT | ds.CONFIG.SpecialEffect unavailable, Choose not registered`);
    return;
  }

  const BaseSheet = ds.applications.sheets.pseudoDocuments.SpecialEffectSheet;

  
  class ChooseEffectSheet extends BaseSheet {
    
    
    static DEFAULT_OPTIONS = {
      classes: ['special-effect', 'dsct-choose-sheet'],
      actions: {
        dsctAddChoice: ChooseEffectSheet.#addChoice,
        dsctRemoveChoice: ChooseEffectSheet.#removeChoice,
      },
      position: { width: 560, height: 640 },
      window: { resizable: true },
    };

    static async #addChoice() {
      const choices = foundry.utils.deepClone(this.pseudoDocument._source.choose?.choices ?? []);
      choices.push({ name: '', story: '', keywords: [], distance: {}, target: {}, effects: [] });
      await this.pseudoDocument.update({ 'choose.choices': choices });
    }

    static async #removeChoice(event, target) {
      const index = Number(target.dataset.index);
      const choices = foundry.utils.deepClone(this.pseudoDocument._source.choose?.choices ?? []);
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) return;
      choices.splice(index, 1);
      await this.pseudoDocument.update({ 'choose.choices': choices });
    }
  }

  class ChooseSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
    static get TYPE() { return 'dsct.choose'; }

    static get metadata() {
      return { ...super.metadata, sheetClass: ChooseEffectSheet };
    }

    static defineSchema() {
      const { SchemaField } = foundry.data.fields;
      return Object.assign(super.defineSchema(), {
        choose: new SchemaField({ choices: choiceSchema() }),
      });
    }

    get detailsPartial() { return PARTIAL; }

    get label() {
      const names = (this.choose?.choices ?? []).map(c => c.name).filter(Boolean);
      if (!names.length) return this.name;
      return game.i18n.format('DSCT.choose.label', { choices: names.join(', ') });
    }

    async getSheetContext() {
      return chooseSheetContext(this);
    }

    
    showUse() { return false; }
  }

  ds.CONFIG.SpecialEffect['dsct.choose'] = {
    label: 'TYPES.SpecialEffect.dsct.choose',
    defaultImage: 'icons/svg/book.svg',
    documentClass: ChooseSpecialEffect,
  };

  foundry.applications.handlebars.loadTemplates([PARTIAL]);
  _registerChooseMessageHooks();
  _registerDamageRollFilter();
  _registerRollSuppression();
}

const _chosen = new Map();

const _recent = new Map();

const PICK_TTL = 300000;
const RECENT_TTL = 60000;

function _chooseEffects(ability) {
  const effects = ability?.system?.effects;
  if (!effects) return [];
  return [...effects].filter(e => e.type === 'dsct.choose' && (e.choose?.choices?.length ?? 0) > 0);
}

export function getChoicePicks(abilityUuid) {
  const entry = _recent.get(abilityUuid);
  if (!entry) return null;
  if (Date.now() - entry.at > RECENT_TTL) {
    _recent.delete(abilityUuid);
    return null;
  }
  return entry.picks;
}

async function _promptChoice(ability, effect, named) {
  const choices = effect.choose.choices;

  const lines = choices.map((choice, index) => {
    const name = choice.name || game.i18n.format('DSCT.choose.unnamed', { n: index + 1 });
    const story = choice.story ? `<span class="dsct-choose-story">${choice.story}</span>` : '';
    return `<li><strong>${name}</strong>${story ? ' ' + story : ''}</li>`;
  }).join('');

  const heading = named
    ? game.i18n.format('DSCT.choose.prompt.named', { effect: effect.name })
    : game.i18n.localize('DSCT.choose.prompt.body');

  const action = await foundry.applications.api.DialogV2.wait({
    window: { title: ability.name },
    classes: ['dsct-choose-prompt'],
    content: `<p>${heading}</p><ul class="dsct-choose-list">${lines}</ul>`,
    buttons: choices.map((choice, index) => ({
      label: choice.name || game.i18n.format('DSCT.choose.unnamed', { n: index + 1 }),
      action: String(index),
      default: index === 0,
    })),
    rejectClose: false,
  });

  const index = Number(action);
  return Number.isInteger(index) && index >= 0 && index < choices.length ? index : null;
}

export function checkAndRunChoose(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return null;

  const effects = _chooseEffects(ability);
  if (!effects.length) return null;

  const entry = _chosen.get(ability.uuid);
  const fresh = entry && Date.now() - entry.at < PICK_TTL;
  if (fresh && effects.every(e => e.id in entry.picks)) return null;
  if (!fresh) _chosen.delete(ability.uuid);

  (async () => {
    const picks = fresh ? { ...entry.picks } : {};
    const named = effects.length > 1;

    for (const effect of effects) {
      if (effect.id in picks) continue;
      const index = await _promptChoice(ability, effect, named);
      
      if (index === null) return;
      picks[effect.id] = index;
    }

    const stamped = { at: Date.now(), picks };
    _chosen.set(ability.uuid, stamped);
    _recent.set(ability.uuid, stamped);

    
    
    ability.prepareData?.();
    ability.system.use();
  })();

  return 'block';
}

export function clearChoicePicks(abilityUuid) {
  const entry = _chosen.get(abilityUuid);
  if (entry) _recent.set(abilityUuid, { ...entry, at: Date.now() });
  _chosen.delete(abilityUuid);
}

const FLAG = 'choosePicks';

function _pickedChoices(item, picks) {
  const out = [];
  for (const effect of _chooseEffects(item)) {
    const index = picks?.[effect.id];
    const choice = effect.choose?.choices?.[index];
    if (choice) out.push(choice);
  }
  return out;
}

function _assignment(item, picks) {
  const claimed = new Set();
  const active = new Set();
  for (const effect of _chooseEffects(item)) {
    const chosenIndex = picks?.[effect.id];
    effect.choose.choices.forEach((choice, index) => {
      for (const name of choice.effects ?? []) {
        claimed.add(name);
        if (index === chosenIndex) active.add(name);
      }
    });
  }
  return { claimed, active };
}

function _effectShows(effect, assignment) {
  const name = (effect?.name ?? '').trim();
  if (!name) return true;
  if (!assignment.claimed.has(name)) return true;
  return assignment.active.has(name);
}

export function resolveChoice(item, picks) {
  const sys = item.system;
  const out = {
    story: sys.story,
    keywords: new Set(sys.keywords),
    distance: { ...sys.distance },
    target: { ...sys.target },
  };

  for (const choice of _pickedChoices(item, picks)) {
    if (choice.story) out.story = choice.story;
    if (choice.keywords?.size ?? choice.keywords?.length) out.keywords = new Set(choice.keywords);
    if (choice.distance?.type) {
      out.distance = {
        type: choice.distance.type,
        primary: choice.distance.primary || sys.distance.primary,
        secondary: choice.distance.secondary || sys.distance.secondary,
        tertiary: choice.distance.tertiary || sys.distance.tertiary,
      };
    }
    if (choice.target?.type) {
      out.target = {
        type: choice.target.type,
        custom: choice.target.custom || '',
        value: choice.target.value ?? null,
      };
    }
  }

  return out;
}

function _labels(resolved) {
  const config = ds.CONFIG.abilities;
  const labels = {};

  const formatter = game.i18n.getListFormatter({ type: 'unit' });
  const list = [...resolved.keywords].map(k => config.keywords[k]?.label ?? k);
  labels.keywords = formatter.format(list) || '—';

  labels.distance = game.i18n.format(config.distances[resolved.distance.type]?.embedLabel ?? '', { ...resolved.distance });

  const tc = config.targets[resolved.target.type] ?? { embedLabel: 'COMMON.Unknown' };
  if (resolved.target.custom) labels.target = resolved.target.custom;
  else if (resolved.target.value === null) labels.target = tc.all;
  if (!labels.target) {
    if (game.i18n.has(tc.embedLabel)) labels.target = game.i18n.localize(tc.embedLabel);
    else {
      const suffix = game.i18n.pluralRules.select(resolved.target.value);
      labels.target = game.i18n.format(`${tc.embedLabel}.${suffix}`, { value: resolved.target.value });
    }
  }

  return labels;
}

function _abilityUsePart(source) {
  const parts = source?.system?.parts;
  if (!parts) return null;
  for (const part of normalizeCollection(parts)) {
    if (part?.type === 'abilityUse') return { id: part.id ?? part._id, part };
  }
  return null;
}

function _stampMessage(message, data) {
  const found = _abilityUsePart(data);
  if (!found) return;

  const picks = getChoicePicks(found.part.abilityUuid);
  if (!picks || !Object.keys(picks).length) return;

  const item = fromUuidSync(found.part.abilityUuid);
  if (!item) return;

  const update = { [`flags.draw-steel-combat-tools.${FLAG}`]: picks };

  const assignment = _assignment(item, picks);
  if (assignment.claimed.size) {
    const kept = (found.part.effects ?? []).filter(id => {
      const effect = item.system.effects?.get?.(id);
      return _effectShows(effect, assignment);
    });
    update[`system.parts.${found.id}.effects`] = kept;
  }

  message.updateSource(update);

  
  
  
  _recent.delete(found.part.abilityUuid);
  item.prepareData?.();
}

function _applyToCard(message, html) {
  const picks = message.getFlag('draw-steel-combat-tools', FLAG);
  if (!picks || !Object.keys(picks).length) return;

  const part = _abilityUsePart(message);
  const item = part ? fromUuidSync(part.part.abilityUuid) : null;
  if (!item) return;

  const embed = html.querySelector('document-embed.draw-steel.ability');
  if (!embed) return;

  const resolved = resolveChoice(item, picks);
  const labels = _labels(resolved);

  const set = (selector, text) => {
    const el = embed.querySelector(selector);
    if (el && text) el.textContent = text;
  };
  set('.metadata dd.keywords', labels.keywords);
  set('.metadata dd.distance', labels.distance);
  set('.metadata dd.target', labels.target);

  if (resolved.story && resolved.story !== item.system.story) {
    let flavor = embed.querySelector('.metadata p.flavor em');
    if (!flavor) {
      const p = document.createElement('p');
      p.className = 'flavor';
      p.append(document.createElement('em'));
      embed.querySelector('.metadata')?.prepend(p);
      flavor = p.querySelector('em');
    }
    flavor.textContent = resolved.story;
  }

  const assignment = _assignment(item, picks);
  if (!assignment.claimed.size) return;

  const effects = item.system.power?.effects?.sortedContents ?? [];
  const kept = effects.filter(e => _effectShows(e, assignment));
  if (kept.length === effects.length) return;

  let anyTier = false;
  for (const tier of [1, 2, 3]) {
    const cell = embed.querySelector(`dd.tier${tier}`);
    if (!cell) continue;
    const text = kept.map(e => e.toText(tier)).filter(Boolean).join('; ');
    cell.innerHTML = text;
    if (text) anyTier = true;
  }
  if (!anyTier) embed.querySelector('section.powerResult')?.remove();
}

function _registerChooseMessageHooks() {
  Hooks.on('preCreateChatMessage', (message, data) => {
    try {
      _stampMessage(message, data);
    } catch (err) {
      console.warn('DSCT | Choose | stamping message failed:', err);
    }
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    try {
      _applyToCard(message, html);
    } catch (err) {
      console.warn('DSCT | Choose | applying choice to card failed:', err);
    }
  });

  Hooks.on('renderAbilityConfigurationDialog', (app) => {
    try {
      _filterChooseDialog(app);
    } catch (err) {
      console.warn('DSCT | Choose | filtering the roll dialog failed:', err);
    }
  });
}

const DSTD_ID = 'draw-steel-target-damage';

export function chooseHiddenRollIndexes(message) {
  const picks = message?.getFlag?.(M, FLAG);
  if (!picks || !Object.keys(picks).length) return null;

  const found = _abilityUsePart(message);
  const item = found ? fromUuidSync(found.part.abilityUuid) : null;
  if (!item) return null;

  const assignment = _assignment(item, picks);
  if (!assignment.claimed.size) return null;

  const hidden = new Set();
  for (const effect of item.system.power?.effects ?? []) {
    if (!_effectShows(effect, assignment)) hidden.add(String(effect.id));
  }
  return hidden.size ? hidden : null;
}

export function filterChooseDstdRows(message, panel) {
  if (!panel) return;
  const hidden = chooseHiddenRollIndexes(message);
  if (!hidden) return;

  for (const el of panel.querySelectorAll('[data-roll-index]')) {
    if (!hidden.has(String(el.dataset.rollIndex))) continue;
    (el.closest(`.${DSTD_ID}-action-row`) ?? el).remove();
  }

  
  
  
  requestAnimationFrame(() => _rewriteDstdTierText(message, panel));
}

function _rewriteDstdTierText(message, panel) {
  if (!panel?.isConnected) return;

  const found = _abilityUsePart(message);
  const item = found ? fromUuidSync(found.part.abilityUuid) : null;
  const picks = message?.getFlag?.(M, FLAG);
  if (!item || !picks) return;

  const assignment = _assignment(item, picks);
  if (!assignment.claimed.size) return;

  const all = item.system.power?.effects?.sortedContents ?? [];
  const kept = all.filter(e => _effectShows(e, assignment));
  if (kept.length === all.length) return;

  for (const result of panel.querySelectorAll(`.${DSTD_ID}-tier-result`)) {
    const glyph = result.querySelector('dt.glyph');
    let tier = null;
    for (const cls of glyph?.classList ?? []) {
      const m = /^tier([123])$/.exec(cls);
      if (m) tier = Number(m[1]);
    }
    if (!tier) continue;

    const cell = result.querySelector(`dd.${DSTD_ID}-tier-text`);
    if (cell) cell.innerHTML = kept.map(e => e.toText(tier)).filter(Boolean).join('; ');
  }
}

function _registerDamageRollFilter() {
  const cls = ds.data?.pseudoDocuments?.powerRollEffects?.DamagePowerRollEffect;
  if (!cls) {
    console.warn('DSCT | Choose | DamagePowerRollEffect unavailable, damage is not filtered by choice');
    return;
  }

  const skip = (effect) => {
    const item = effect?.item;
    if (!item) return false;
    const picks = getChoicePicks(item.uuid);
    if (!picks || !Object.keys(picks).length) return false;
    const assignment = _assignment(item, picks);
    if (!assignment.claimed.size) return false;
    return !_effectShows(effect, assignment);
  };

  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, 'ds.data.pseudoDocuments.powerRollEffects.DamagePowerRollEffect.prototype.toDamageRoll',
      function (wrapped, ...args) {
        if (skip(this)) return null;
        return wrapped(...args);
      }, 'MIXED');
    return;
  }

  const original = cls.prototype.toDamageRoll;
  cls.prototype.toDamageRoll = function (...args) {
    if (skip(this)) return null;
    return original.apply(this, args);
  };
}

export function chooseMessageFilter(message, item) {
  if (!item) return null;
  
  
  const picks = message?.getFlag?.(M, FLAG) ?? getChoicePicks(item.uuid);
  if (!picks || !Object.keys(picks).length) return null;
  const assignment = _assignment(item, picks);
  if (!assignment.claimed.size) return null;
  return effect => _effectShows(effect, assignment);
}

function _registerRollSuppression() {
  const path = 'CONFIG.Item.dataModels.ability.prototype.prepareDerivedData';

  const suppress = function () {
    const item = this.parent;
    const picks = getChoicePicks(item?.uuid);
    if (!picks || !Object.keys(picks).length) return;
    const assignment = _assignment(item, picks);
    if (!assignment.claimed.size) return;
    const anyShown = [...(this.power?.effects ?? [])].some(e => _effectShows(e, assignment));
    if (!anyShown) this.power.roll.enabled = false;
  };

  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, path, function (wrapped, ...args) {
      wrapped(...args);
      suppress.call(this);
    }, 'WRAPPER');
    return;
  }

  const cls = CONFIG.Item?.dataModels?.ability;
  if (!cls) {
    console.warn('DSCT | Choose | ability data model unavailable, the power roll is not suppressed');
    return;
  }
  const original = cls.prototype.prepareDerivedData;
  cls.prototype.prepareDerivedData = function (...args) {
    original.apply(this, args);
    suppress.call(this);
  };
}

function _filterChooseDialog(app) {
  const item = app?.options?.ability;
  const root = app?.element;
  if (!item || !root) return;

  const keeps = chooseMessageFilter(null, item);
  if (!keeps) return;

  for (const input of root.querySelectorAll('[name^="spend."]')) {
    const id = input.getAttribute('name').slice('spend.'.length);
    const effect = item.system?.effects?.get?.(id);
    if (effect && !keeps(effect)) input.closest('.form-group')?.classList.add('dsct-choose-hidden');
  }

  
  const fieldset = root.querySelector('section.ability-config fieldset');
  const visible = [...(fieldset?.querySelectorAll('.form-group') ?? [])]
    .some(g => !g.classList.contains('dsct-choose-hidden'));
  if (fieldset && !visible) fieldset.classList.add('dsct-choose-hidden');

  const offersTypes = [...(item.system?.power?.effects ?? [])]
    .filter(e => e.type === 'damage' && keeps(e))
    .some(e => [1, 2, 3].some(t => (e.damage?.['tier' + t]?.types?.size ?? 0) > 1));

  if (!offersTypes) {
    root.querySelector('select[name="damage-selection"]')?.closest('.form-group')?.classList.add('dsct-choose-hidden');
  }
}
