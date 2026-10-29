import { normalizeCollection } from '../helpers.mjs';
import { stackedPrompt, DSTD } from '../ctlib.mjs';
import { setTip, tipFor } from '../chat-tips.mjs';

const M = 'draw-steel-combat-tools';
const PARTIAL = `modules/${M}/templates/effects/choose.hbs`;

function choiceSchema() {
  const { SchemaField, StringField, NumberField, ArrayField, SetField, FilePathField } = foundry.data.fields;
  const Formula = ds.data.fields.FormulaField;

  return new ArrayField(new SchemaField({
    name: new StringField({ required: true, blank: true }),
    icon: new FilePathField({ categories: ['IMAGE'], required: true, blank: true, initial: '' }),
    preview: new StringField({ required: true, blank: true }),
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
  const ability = pseudo.document?.system ?? {};

  const blankFor = (label) => ({
    value: '',
    label: label
      ? game.i18n.format('DSCT.choose.sameAsAbilityNamed', { value: label })
      : game.i18n.localize('DSCT.choose.sameAsAbility'),
  });

  const distanceTypes = [blankFor(config.distances[ability.distance?.type]?.label),
    ...Object.entries(config.distances).map(([value, { label }]) => ({ value, label }))];
  const targetTypes = [blankFor(config.targets[ability.target?.type]?.label),
    ...Object.entries(config.targets).map(([value, { label }]) => ({ value, label }))];
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

  const fallbackIcon = pseudo.img || pseudo.document?.img || 'icons/svg/book.svg';

  const choices = source.map((choice, index) => {
    const dist = config.distances[choice.distance?.type] ?? {};
    const targetType = choice.target?.type ?? '';
    return {
      index,
      number: index + 1,
      src: choice,
      prefix: `choose.choices.${index}`,
      
      iconPreview: choice.icon || fallbackIcon,
      ghostPreview: _defaultPreview(index),
      ghostStory: ability.story ?? '',
      ghostPrimary: ability.distance?.primary ?? '',
      ghostSecondary: ability.distance?.secondary ?? '',
      ghostTertiary: ability.distance?.tertiary ?? '',
      primaryDistance: dist.primary ?? '',
      secondaryDistance: dist.secondary ?? '',
      tertiaryDistance: dist.tertiary ?? '',
      showTargetValue: !['', 'self', 'selfOrAlly', 'special'].includes(targetType),
    };
  });

  const count = pseudo._source.choose?.count ?? 1;
  const option = (key, value) => ({ value, label: game.i18n.localize(`DSCT.choose.${key}.${value || 'none'}`) });

  return {
    fields,
    choices,
    count,
    timing: pseudo._source.choose?.timing ?? 'before',
    timingOptions: ['before', 'after'].map(v => option('timing', v)),
    critical: pseudo._source.choose?.critical ?? '',
    criticalOptions: ['', 'all'].map(v => option('critical', v)),
    countOptions: Array.from({ length: Math.max(source.length, 1) }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
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
        dsctPickIcon: { handler: ChooseEffectSheet.#pickIcon, buttons: [0, 2] },
      },
      position: { width: 560, height: 640 },
      window: { resizable: true },
    };

    
    
    #expanded = new Set();

    #listeners = null;

    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      for (const choice of context.ctx?.choices ?? []) choice.open = this.#expanded.has(choice.index);
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#showGhostKeywords();

      this.#listeners?.abort();
      this.#listeners = new AbortController();
      const { signal } = this.#listeners;

      
      for (const details of this.element.querySelectorAll('.dsct-choice')) {
        details.addEventListener('toggle', () => {
          const index = Number(details.dataset.index);
          if (details.open) this.#expanded.add(index);
          else this.#expanded.delete(index);
        }, { signal });
      }
    }

    
    
    
    #showGhostKeywords() {
      const keywords = this.pseudoDocument.document?.system?.keywords ?? [];
      const labels = [...keywords].map(k => ds.CONFIG.abilities.keywords[k]?.label ?? k);
      if (!labels.length) return;

      const choices = this.pseudoDocument._source.choose?.choices ?? [];
      choices.forEach((choice, index) => {
        if (choice.keywords?.length) return;
        const tags = this.element
          .querySelector(`[name="choose.choices.${index}.keywords"]`)
          ?.querySelector('.tags');
        if (!tags || tags.children.length) return;

        for (const label of labels) {
          const tag = document.createElement('span');
          tag.className = 'tag dsct-ghost-tag';
          tag.textContent = label;
          tags.append(tag);
        }
      });
    }

    async close(options) {
      this.#listeners?.abort();
      this.#listeners = null;
      this.#expanded.clear();
      return super.close(options);
    }

    static async #addChoice() {
      const choices = foundry.utils.deepClone(this.pseudoDocument._source.choose?.choices ?? []);
      choices.push({ name: '', icon: '', preview: '', story: '', keywords: [], distance: {}, target: {}, effects: [] });
      this.#expanded.add(choices.length - 1);
      await this.pseudoDocument.update({ 'choose.choices': choices });
    }

    static async #removeChoice(event, target) {
      event.preventDefault();
      const index = Number(target.dataset.index);
      const choices = foundry.utils.deepClone(this.pseudoDocument._source.choose?.choices ?? []);
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) return;
      choices.splice(index, 1);
      this.#expanded = new Set([...this.#expanded].filter(i => i !== index).map(i => (i > index ? i - 1 : i)));
      await this.pseudoDocument.update({ 'choose.choices': choices });
    }

    static async #pickIcon(event, target) {
      
      event.preventDefault();

      const index = Number(target.dataset.index);
      const input = this.element.querySelector(`input[name="choose.choices.${index}.icon"]`);
      if (!input) return;

      const apply = (path) => {
        input.value = path;
        const preview = target.querySelector('img');
        if (preview) preview.src = path || target.dataset.fallback;
        this.element.dispatchEvent(new Event('submit', { cancelable: true }));
      };

      if (event.button === 2) return apply('');

      const picker = new foundry.applications.apps.FilePicker.implementation({
        type: 'image',
        current: input.value,
        position: { top: this.position.top + 40, left: this.position.left + 10 },
        callback: apply,
      });
      await picker.browse();
    }
  }

  class ChooseSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
    static get TYPE() { return 'dsct.choose'; }

    static get metadata() {
      return { ...super.metadata, sheetClass: ChooseEffectSheet };
    }

    static defineSchema() {
      const { SchemaField, NumberField, StringField } = foundry.data.fields;
      return Object.assign(super.defineSchema(), {
        choose: new SchemaField({
          count: new NumberField({ required: true, integer: true, min: 1, initial: 1, nullable: false }),
          timing: new StringField({ required: true, blank: false, initial: 'before', choices: ['before', 'after'] }),
          critical: new StringField({ required: true, blank: true, initial: '', choices: ['', 'all'] }),
          choices: choiceSchema(),
        }),
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
  _registerPreviewOverride();
  _registerTemplateOverride();
  CONFIG.TextEditor.enrichers.push(chooseEnricher);
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
  const count = Math.max(1, Math.min(effect.choose.count ?? 1, choices.length));

  const words = game.i18n.localize('DSCT.choose.counts').split(',').map(w => w.trim());
  const count_ = words[count - 1] ?? String(count);

  const heading = named
    ? game.i18n.format('DSCT.choose.prompt.named', { effect: effect.name, count: count_ })
    : game.i18n.format('DSCT.choose.prompt.body', { count: count_ });

  const answer = await stackedPrompt({
    title: ability.name,
    heading,
    count,
    options: choices.map((choice, index) => ({
      label: choice.name || game.i18n.format('DSCT.choose.unnamed', { n: index + 1 }),
      img: choice.icon || effect.img || ability.img,
      action: String(index),
    })),
  });

  const actions = Array.isArray(answer) ? answer : (typeof answer === 'string' ? [answer] : null);
  if (!actions) return null;

  const indexes = [...new Set(actions.map(Number))]
    .filter(i => Number.isInteger(i) && i >= 0 && i < choices.length);
  if (indexes.length !== count) return null;

  return count > 1 ? indexes : indexes[0];
}

export function checkAndRunChoose(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return null;

  const effects = _chooseEffects(ability).filter(e => e.choose?.timing !== 'after');
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

export function presetChoose(abilityOrUuid, picks) {
  const ability = typeof abilityOrUuid === 'string' ? fromUuidSync(abilityOrUuid) : abilityOrUuid;
  const effects = ability ? _chooseEffects(ability) : [];
  if (!effects.length) return false;
  const toIndex = (effect, value) => {
    if (Number.isInteger(value)) return value;
    const wanted = String(value ?? '').trim().toLowerCase();
    return (effect.choose?.choices ?? []).findIndex((c) => String(c.name ?? '').trim().toLowerCase() === wanted);
  };
  const resolve = (effect, value) => {
    const list = (Array.isArray(value) ? value : [value]).map((v) => toIndex(effect, v));
    if (list.some((i) => i < 0 || i >= (effect.choose?.choices?.length ?? 0))) return null;
    return Array.isArray(value) ? list : list[0];
  };
  const out = {};
  const keyed = picks && typeof picks === 'object' && !Array.isArray(picks);
  for (const effect of keyed ? effects : effects.slice(0, 1)) {
    const value = keyed ? (picks[effect.id] ?? picks[effect.name]) : picks;
    if (value === undefined) continue;
    const index = resolve(effect, value);
    if (index === null) return false;
    out[effect.id] = index;
  }
  if (!Object.keys(out).length) return false;
  _chosen.set(ability.uuid, { at: Date.now(), picks: out });
  return true;
}

export function clearChoicePicks(abilityUuid) {
  const entry = _chosen.get(abilityUuid);
  if (entry) _recent.set(abilityUuid, { ...entry, at: Date.now() });
  _chosen.delete(abilityUuid);
}

const FLAG = 'choosePicks';

const _pickedIndexes = (picks, effectId) => {
  const value = picks?.[effectId];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

function _pickedChoices(item, picks) {
  const out = [];
  for (const effect of _chooseEffects(item)) {
    
    
    if ((effect.choose?.count ?? 1) > 1) continue;
    for (const index of _pickedIndexes(picks, effect.id)) {
      const choice = effect.choose?.choices?.[index];
      if (choice) out.push(choice);
    }
  }
  return out;
}

function _assignment(item, picks) {
  const claimed = new Set();
  const active = new Set();
  for (const effect of _chooseEffects(item)) {
    const chosen = _pickedIndexes(picks, effect.id);
    effect.choose.choices.forEach((choice, index) => {
      for (const name of choice.effects ?? []) {
        claimed.add(name);
        if (chosen.includes(index)) active.add(name);
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

export function chooseResolved(item, message = null) {
  const picks = message?.getFlag?.(M, FLAG) ?? getChoicePicks(item?.uuid);
  if (!picks || !Object.keys(picks).length) return null;
  return resolveChoice(item, picks);
}

export function chooseKeywords(item, message = null) {
  return chooseResolved(item, message)?.keywords ?? item?.system?.keywords ?? new Set();
}

export function chooseTargeting(item) {
  const resolved = chooseResolved(item);
  if (!resolved) return null;
  const { distance, target, keywords } = resolved;
  return { distance, target, keywords };
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

function _pickedNames(item, picks) {
  const names = [];
  for (const effect of _chooseEffects(item)) {
    for (const index of _pickedIndexes(picks, effect.id)) {
      const name = effect.choose?.choices?.[index]?.name?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function _applyToCard(message, html) {
  const picks = message.getFlag('draw-steel-combat-tools', FLAG);
  if (!picks || !Object.keys(picks).length) return;

  const part = _abilityUsePart(message);
  const item = part ? fromUuidSync(part.part.abilityUuid) : null;
  if (!item) return;

  const embed = html.querySelector('document-embed.draw-steel.ability');
  if (!embed) return;

  
  
  const names = _pickedNames(item, picks);
  const heading = embed.querySelector(':scope > h5');
  if (names.length && heading && !heading.dataset.dsctChoice) {
    heading.dataset.dsctChoice = '1';
    heading.append(document.createTextNode(` (${names.join(', ')})`));
  }

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

  Hooks.on('createChatMessage', (message, _options, userId) => {
    if (userId !== game.user.id) return;
    settleCriticalChoice(message).catch(err => console.warn('DSCT | Choose | critical choice failed:', err));
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    try {
      _applyToCard(message, html);
      _armTemplate(message, html);
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

export function chooseHiddenRollIndexes(message) {
  const found = _abilityUsePart(message);
  const item = found ? fromUuidSync(found.part.abilityUuid) : null;
  if (!item) return null;
  const picks = _effectivePicks(message, item);
  if (!picks) return null;

  const assignment = _assignment(item, picks);
  if (!assignment.claimed.size) return null;

  const hidden = new Set();
  for (const effect of item.system.power?.effects ?? []) {
    if (!_effectShows(effect, assignment)) hidden.add(String(effect.id));
  }
  return hidden.size ? hidden : null;
}

const AFTER_ROW = 'dsct-dstd-after-choice';

const _sideOf = (token, source) => {
  const a = token.document.disposition;
  const b = source?.document.disposition;
  if (b == null) return 'neutral';
  if (a === b) return 'ally';
  return a * b < 0 ? 'enemy' : 'neutral';
};

function _targetTypeFits(type, token, source) {
  const object = token.actor?.type === 'object';
  const side = token === source ? 'self' : _sideOf(token, source);
  switch (type) {
    case 'object': return object;
    case 'creatureObject': return true;
    case 'enemy': return !object && side === 'enemy';
    case 'enemyObject': return object || side === 'enemy';
    case 'ally': case 'selfAlly': return !object && side === 'ally';
    case 'selfOrAlly': return !object && (side === 'ally' || side === 'self');
    default: return !object;
  }
}

async function _reshapeArea(message, item, choice) {
  const region = canvas.scene?.regions.contents.findLast(r => r.getFlag('draw-steel', 'abilitySource') === item.uuid);
  const raw = region?.shapes?.[0];
  const shape = raw?.toObject?.() ?? raw;
  if (shape?.type !== 'rectangle') {
    ui.notifications.warn(game.i18n.format('DSCT.choose.after.noArea', { name: item.name }));
    return null;
  }
  const size = Number(choice.distance?.primary) || 0;
  if (choice.distance?.type === 'cube' && size) {
    
    const w = size * canvas.dimensions.distancePixels;
    const ax = shape.anchorX ?? 0, ay = shape.anchorY ?? 0;
    const cx = shape.x + (0.5 - ax) * shape.width, cy = shape.y + (0.5 - ay) * shape.height;
    await region.update({ shapes: [{ ...shape, x: cx - (0.5 - ax) * w, y: cy - (0.5 - ay) * w, width: w, height: w }] });
  }
  const type = choice.target?.type || item.system.target?.type;
  const source = fromUuidSync(message.flags?.[DSTD]?.state?.sourceTokenUuid ?? '')?.object ?? null;
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const inside = canvas.tokens.placeables.filter(t => t.actor && !t.document.hidden && !t.actor.statuses?.has(dead)
    && t.document.testInsideRegion(region) && _targetTypeFits(type, t, source));
  const { normalizeTargetToken } = await import('/modules/draw-steel-target-damage/src/target-utils.mjs');
  return inside.map(t => normalizeTargetToken(t)).filter(Boolean);
}

async function _chooseAfter(message, item, effect, index) {
  const choice = effect.choose.choices[index];
  const update = { [`flags.${M}.${FLAG}.${effect.id}`]: index };
  if (choice?.distance?.type || choice?.target?.type) {
    const targets = await _reshapeArea(message, item, choice);
    if (targets) update[`flags.${DSTD}.state.targets`] = targets;
  }
  await message.update(update);
}

const _critSettled = new Map();

export function settleCriticalChoice(message) {
  if (!message?.isOwner || !_isCritical(message)) return Promise.resolve(false);
  if (_critSettled.has(message.id)) return _critSettled.get(message.id);
  const run = (async () => {
    const found = _abilityUsePart(message);
    const item = found ? fromUuidSync(found.part.abilityUuid) : null;
    if (!item) return false;
    const stored = message.getFlag(M, FLAG) ?? {};
    const update = {};
    for (const effect of _afterEffects(item)) {
      if (effect.id in stored || effect.choose.critical !== 'all') continue;
      update[`flags.${M}.${FLAG}.${effect.id}`] = effect.choose.choices.map((_, i) => i);
      for (const choice of effect.choose.choices) {
        if (!choice?.distance?.type && !choice?.target?.type) continue;
        const targets = await _reshapeArea(message, item, choice);
        if (targets) update[`flags.${DSTD}.state.targets`] = targets;
      }
    }
    if (!Object.keys(update).length) return false;
    await message.update(update);
    return true;
  })();
  _critSettled.set(message.id, run);
  return run;
}

const CHOOSE_REF = /\[\[\/choose(?:\s+([^\]]*?))?\]\]/gi;
const LABELLED = /\[\[\/([a-z]+)(?:\s([^\]]*))?\]\](?:\{([^}]*)\})?/gi;

const _plainLabel = (item, type, config, label) => {
  if (label != null) return label;
  if (type.toLowerCase() !== 'flat') return '';
  const ref = String(config ?? '').trim().split(/\s+/)[0]?.toLowerCase();
  const effect = [...(item.system?.effects ?? [])].find(e => e.id.toLowerCase() === ref || (e.name ?? '').trim().toLowerCase() === ref);
  return effect ? (effect[effect.type.slice(5)]?.display || effect.name || effect.label || '') : '';
};

const _findChoose = (item, ref) => {
  const all = _chooseEffects(item);
  const wanted = String(ref ?? '').trim().toLowerCase();
  if (!wanted) return all[0] ?? null;
  return all.find(e => e.id.toLowerCase() === wanted || (e.name ?? '').trim().toLowerCase() === wanted) ?? null;
};

export const placedChooseIds = (item) => {
  const ids = new Set();
  for (const s of item?.system?.effects ?? []) {
    for (const m of String(s.description ?? '').matchAll(CHOOSE_REF)) {
      const found = _findChoose(item, m[1]);
      if (found) ids.add(found.id);
    }
  }
  return ids;
};

const chooseEnricher = {
  id: 'dsct.choose',
  pattern: /\[\[\/choose(?:\s+(?<config>[^\]]*?))?]](?!])(?:{(?<label>[^}]+)})?/gi,
  async enricher(match, options) {
    const item = options.relativeTo?.documentName === 'Item' ? options.relativeTo : null;
    const effect = item ? _findChoose(item, match.groups.config) : null;
    if (!effect) return null;
    const enrich = (text) => foundry.applications.ux.TextEditor.implementation.enrichHTML(text, options);
    const wrap = document.createElement('span');
    wrap.className = 'dsct-choose-text';
    wrap.dataset.chooseEffect = effect.id;
    wrap.dataset.itemUuid = item.uuid;
    const lead = document.createElement('span');
    lead.className = 'dsct-choose-lead';
    lead.textContent = match.groups.label ?? game.i18n.localize('DSCT.choose.preview.heading');
    const list = document.createElement('ul');
    list.className = 'dsct-choose-list';
    for (const [index, choice] of effect.choose.choices.entries()) {
      const text = choice.preview?.trim() || choice.name || _defaultPreview(index);
      const li = document.createElement('li');
      li.dataset.index = String(index);
      const line = document.createElement('span');
      line.className = 'dsct-choose-line';
      line.innerHTML = await enrich(text.replace(LABELLED, (_, type, config, label) => _plainLabel(item, type, config, label)));
      
      const rich = document.createElement('template');
      rich.className = 'dsct-choose-rich';
      rich.innerHTML = await enrich(text);
      li.append(line, rich);
      list.append(li);
    }
    wrap.append(lead, list);
    return wrap;
  },
  onRender(element) {
    const wrap = element.querySelector('.dsct-choose-text');
    const item = wrap ? fromUuidSync(wrap.dataset.itemUuid) : null;
    const effect = item?.system?.effects?.get?.(wrap.dataset.chooseEffect);
    if (!effect) return;
    const live = (li) => {
      const line = li.querySelector('.dsct-choose-line');
      line.replaceChildren(li.querySelector('template.dsct-choose-rich').content.cloneNode(true));
      line.classList.add('dsct-choose-live');
    };
    const row = element.closest('[data-message-id]');
    const message = row ? game.messages.get(row.dataset.messageId) : null;
    const lines = [...wrap.querySelectorAll('.dsct-choose-list > li')];
    if (!message) return void lines.forEach(live);
    const picked = _pickedIndexes(_effectivePicks(message, item), effect.id);
    if (picked.length) {
      for (const li of lines) (picked.includes(Number(li.dataset.index)) ? live(li) : li.remove());
      if (picked.length === 1) wrap.replaceChildren(...wrap.querySelector('.dsct-choose-live').childNodes);
      else wrap.querySelector('.dsct-choose-lead')?.remove();
      return;
    }
    wrap.classList.add('dsct-choose-pending');
    for (const li of lines) {
      const line = li.querySelector('.dsct-choose-line');
      line.setAttribute('role', 'button');
      line.tabIndex = 0;
      setTip(line, tipFor('choosePick', { title: effect.choose.choices[Number(li.dataset.index)]?.name ?? '' }));
      const pick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!message.isOwner) return void ui.notifications.warn(game.i18n.localize('DSCT.choose.after.notYours'));
        if (wrap.dataset.picking) return;
        wrap.dataset.picking = '1';
        try { await _chooseAfter(message, item, effect, Number(li.dataset.index)); }
        finally { delete wrap.dataset.picking; }
      };
      line.addEventListener('click', pick);
      line.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') pick(event); });
    }
  },
};

function _installAfterChoice(message, panel) {
  const found = _abilityUsePart(message);
  const item = found ? fromUuidSync(found.part.abilityUuid) : null;
  
  const placed = item ? placedChooseIds(item) : new Set();
  const effects = item ? _afterEffects(item).filter(e => !placed.has(e.id)) : [];
  if (!effects.length) return void panel.querySelector(`.${AFTER_ROW}`)?.remove();
  const stored = message.getFlag(M, FLAG) ?? {};
  const critical = _isCritical(message);
  const sig = effects.map(e => `${e.id}:${JSON.stringify(stored[e.id] ?? null)}`).join('|') + (critical ? '|crit' : '');
  const existing = panel.querySelector(`.${AFTER_ROW}`);
  if (existing?.dataset.sig === sig) return;
  existing?.remove();

  const box = document.createElement('div');
  box.className = AFTER_ROW;
  box.dataset.sig = sig;
  for (const effect of effects) {
    const line = document.createElement('div');
    line.className = `${DSTD}-action-row`;
    const note = (text) => {
      const span = document.createElement('span');
      span.className = 'dsct-after-choice-note';
      span.textContent = text;
      line.append(span);
    };
    if (effect.id in stored) {
      const names = _pickedIndexes(stored, effect.id).map(i => effect.choose.choices[i]?.name).filter(Boolean);
      note(game.i18n.format('DSCT.choose.after.chosen', { name: names.join(', ') }));
    } else if (effect.choose.critical === 'all' && critical) {
      note(game.i18n.localize('DSCT.choose.after.critical'));
    } else {
      note(game.i18n.localize('DSCT.choose.after.heading'));
      effect.choose.choices.forEach((choice, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${DSTD}-action-button`;
        btn.textContent = choice.name || game.i18n.format('DSCT.choose.unnamed', { n: index + 1 });
        btn.disabled = !message.isOwner;
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          for (const b of box.querySelectorAll('button')) b.disabled = true;
          await _chooseAfter(message, item, effect, index);
        });
        line.append(btn);
      });
    }
    box.append(line);
  }
  const list = panel.querySelector(`.${DSTD}-target-list`);
  if (list) list.before(box);
  else panel.prepend(box);
}

export function filterChooseDstdRows(message, panel) {
  if (!panel) return;
  _installAfterChoice(message, panel);
  const hidden = chooseHiddenRollIndexes(message);
  if (!hidden) return;

  for (const el of panel.querySelectorAll('[data-roll-index]')) {
    if (!hidden.has(String(el.dataset.rollIndex))) continue;
    (el.closest(`.${DSTD}-action-row`) ?? el).remove();
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

  for (const result of panel.querySelectorAll(`.${DSTD}-tier-result`)) {
    const glyph = result.querySelector('dt.glyph');
    let tier = null;
    for (const cls of glyph?.classList ?? []) {
      const m = /^tier([123])$/.exec(cls);
      if (m) tier = Number(m[1]);
    }
    if (!tier) continue;

    const cell = result.querySelector(`dd.${DSTD}-tier-text`);
    if (cell) cell.innerHTML = kept.map(e => e.toText(tier)).filter(Boolean).join('; ');
  }
}

const DISTANCE_FIELDS = ['primary', 'secondary', 'tertiary'];

const _armedTemplates = new Map();

function _armTemplate(message, html) {
  const picks = message.getFlag(M, FLAG);
  if (!picks || !Object.keys(picks).length) return;

  const part = _abilityUsePart(message);
  const uuid = part?.part?.abilityUuid;
  if (!uuid) return;

  for (const button of html.querySelectorAll('[data-action="placeTemplate"]')) {
    button.addEventListener('click', () => {
      const item = fromUuidSync(uuid);
      if (item) _armedTemplates.set(uuid, resolveChoice(item, picks).distance);
    }, { capture: true });
  }
}

const _asNumber = (value, item) => {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return value;
  const evaluate = ds.utils?.evaluateFormula;
  if (typeof evaluate !== 'function') return Number(value);
  try {
    return evaluate(String(value), item.parent?.getRollData?.() ?? {}, { contextName: item.parent?.uuid });
  } catch {
    return Number(value);
  }
};

function _onPlaceTemplate(wrapped, ...args) {
  const chosen = _armedTemplates.get(this.parent?.uuid);
  if (!chosen) return wrapped(...args);
  _armedTemplates.delete(this.parent.uuid);

  const before = { type: this.distance.type };
  for (const field of DISTANCE_FIELDS) before[field] = this.distance[field];

  if (chosen.type) this.distance.type = chosen.type;
  for (const field of DISTANCE_FIELDS) {
    if (chosen[field] !== undefined && chosen[field] !== '') this.distance[field] = _asNumber(chosen[field], this);
  }

  try {
    return wrapped(...args);
  } finally {
    Object.assign(this.distance, before);
  }
}

function _registerTemplateOverride() {
  const path = 'CONFIG.Item.dataModels.ability.prototype.placeTemplate';
  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, path, _onPlaceTemplate, 'WRAPPER');
    return;
  }
  const proto = CONFIG.Item?.dataModels?.ability?.prototype;
  const original = proto?.placeTemplate;
  if (typeof original !== 'function') {
    console.warn('DSCT | Choose | placeTemplate unavailable, a chosen area is not placed');
    return;
  }
  proto.placeTemplate = function (...args) {
    return _onPlaceTemplate.call(this, original.bind(this), ...args);
  };
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

const _afterEffects = (item) => _chooseEffects(item).filter(e => e.choose?.timing === 'after');

const _isCritical = (message) => [...(message?.rolls ?? []), ...normalizeCollection(message?.system?.parts).flatMap(p => [...(p?.rolls ?? [])])]
  .some(r => r instanceof ds.rolls.PowerRoll && r.isCritical);

function _effectivePicks(message, item) {
  const picks = { ...(message?.getFlag?.(M, FLAG) ?? getChoicePicks(item?.uuid) ?? {}) };
  if (message) for (const effect of _afterEffects(item)) {
    if (effect.id in picks) continue;
    picks[effect.id] = effect.choose.critical === 'all' && _isCritical(message) ? effect.choose.choices.map((_, i) => i) : [];
  }
  return Object.keys(picks).length ? picks : null;
}

export function afterChoiceHoldsArea(item) {
  const reshapes = _afterEffects(item).some(e => e.choose.choices.some(c => c.distance?.type || c.target?.type));
  if (!reshapes) return false;
  const message = game.messages.contents.findLast(m => _abilityUsePart(m)?.part?.abilityUuid === item.uuid);
  return !!message && chooseAfterPending(message);
}

export function chooseAfterPending(message) {
  const found = _abilityUsePart(message);
  const item = found ? fromUuidSync(found.part.abilityUuid) : null;
  if (!item) return false;
  const stored = message.getFlag(M, FLAG) ?? {};
  return _afterEffects(item).some(e => !(e.id in stored) && !(e.choose.critical === 'all' && _isCritical(message)));
}

export function chooseMessageFilter(message, item) {
  if (!item) return null;
  const picks = _effectivePicks(message, item);
  if (!picks) return null;
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

function _defaultPreview(index) {
  const ordinals = game.i18n.localize('DSCT.choose.preview.ordinals').split(',').map(o => o.trim());
  const ordinal = ordinals[index] ?? `${index + 1}th`;
  return game.i18n.format('DSCT.choose.preview.fallback', { ordinal });
}

const _previewRewrites = [];

export const addPreviewRewrite = (fn) => { _previewRewrites.push(fn); };

export const chooseClaimed = (item) => new Set(_chooseEffects(item).flatMap(e => e.choose.choices.flatMap(c => [...(c.effects ?? [])])));

function _registerPreviewOverride() {
  const path = 'CONFIG.Item.dataModels.ability.prototype.getSheetContext';

  const rewrite = async function (context) {
    await chooseRewrite.call(this, context);
    for (const fn of _previewRewrites) await fn.call(this, context);
  };

  const chooseRewrite = async function (context) {

    if ('limitEffects' in context) return;

    const chosen = _chooseEffects(this.parent);
    if (!chosen.length) return;

    const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    const heading = game.i18n.localize('DSCT.choose.preview.heading');
    const claimed = chooseClaimed(this.parent);
    const placed = placedChooseIds(this.parent);
    const isClaimed = (effect) => claimed.has((effect?.name ?? '').trim());

    const systemBefore = [...(context.beforeEffects ?? [])];
    const systemAfter = [...(context.afterEffects ?? [])];
    const before = [];
    const after = [];
    for (const effect of this.effects.sortedContents) {
      const own = effect.before ? systemBefore.shift() : systemAfter.shift();
      const into = effect.before ? before : after;
      
      if (chosen.includes(effect) && (placed.has(effect.id) || !effect.choose.choices.some(c => c.preview?.trim()))) continue;
      if (chosen.includes(effect)) {
        const bullets = [];
        for (const [index, choice] of effect.choose.choices.entries()) {
          const line = choice.preview?.trim() || _defaultPreview(index);
          bullets.push(`<li>${await enrich(line, { relativeTo: this.parent })}</li>`);
        }
        into.push({
          label: game.i18n.localize('TYPES.SpecialEffect.base'),
          text: `<p>${heading}</p><ul class="dsct-choose-preview">${bullets.join('')}</ul>`,
        });
      } else if (!isClaimed(effect) && own) into.push(own);
    }

    context.beforeEffects = before;
    context.afterEffects = after;
    if ([...(this.power?.effects ?? [])].every(isClaimed)) context.powerRolls = false;
  };

  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, path, async function (wrapped, context, ...args) {
      const result = await wrapped(context, ...args);
      await rewrite.call(this, context);
      return result;
    }, 'WRAPPER');
    return;
  }

  const cls = CONFIG.Item?.dataModels?.ability;
  if (!cls) {
    console.warn('DSCT | Choose | ability data model unavailable, the preview is not rewritten');
    return;
  }
  const original = cls.prototype.getSheetContext;
  cls.prototype.getSheetContext = async function (context, ...args) {
    const result = await original.call(this, context, ...args);
    await rewrite.call(this, context);
    return result;
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
