const M = 'draw-steel-combat-tools';
const L = 'DSCT'; 
const { RegionBehaviorType } = foundry.data.regionBehaviors;
const { BooleanField, DocumentUUIDField, NumberField, SetField, StringField } = foundry.data.fields;

const DISPOSITION_MAP = {
  friendly: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
  neutral:  CONST.TOKEN_DISPOSITIONS.NEUTRAL,
  hostile:  CONST.TOKEN_DISPOSITIONS.HOSTILE,
  secret:   CONST.TOKEN_DISPOSITIONS.SECRET,
};

function _dispositionField() {
  return new SetField(new StringField({
    choices: Object.fromEntries(Object.keys(DISPOSITION_MAP).map(k => [k, `${L}.region.disposition.${k}`])),
  }), { initial: [], required: false });
}

function _passesDispositionFilter(behavior, event) {
  if (!behavior.dispositions?.size) return true;
  const disp = event.data?.token?.disposition;
  return [...behavior.dispositions].some(k => DISPOSITION_MAP[k] === disp);
}

const TOKEN_EVENTS = [
  CONST.REGION_EVENTS.TOKEN_ENTER,
  CONST.REGION_EVENTS.TOKEN_EXIT,
  CONST.REGION_EVENTS.TOKEN_MOVE_IN,
  CONST.REGION_EVENTS.TOKEN_MOVE_OUT,
  CONST.REGION_EVENTS.TOKEN_ROUND_END,
  CONST.REGION_EVENTS.TOKEN_ROUND_START,
  CONST.REGION_EVENTS.TOKEN_TURN_END,
  CONST.REGION_EVENTS.TOKEN_TURN_START,
];

async function _resolveEffect(actor, uuid) {
  const source = await fromUuid(uuid);
  if (!source) return null;
  return actor.effects.getName(source.name) ?? null;
}

async function _addEffect(actor, uuid, origin) {
  const source = await fromUuid(uuid);
  if (!source) return;
  const existing = actor.effects.find(e => e.origin === origin);
  if (existing) {
    return existing.update({
      disabled: false,
      start: ActiveEffect.implementation.getEffectStart(),
      'duration.expired': false,
    });
  }
  return ActiveEffect.implementation.create({
    ...source.toObject(),
    disabled: false,
    transfer: false,
    origin,
  }, { parent: actor });
}

async function _resetDuration(actor, uuid) {
  const existing = await _resolveEffect(actor, uuid);
  if (existing) return existing.update({
    start: ActiveEffect.implementation.getEffectStart(),
    'duration.expired': false,
  });
}

async function _enableEffect(actor, uuid) {
  const existing = await _resolveEffect(actor, uuid);
  if (existing) return existing.update({
    disabled: false,
    start: ActiveEffect.implementation.getEffectStart(),
    'duration.expired': false,
  });
}

async function _disableEffect(actor, uuid) {
  const existing = await _resolveEffect(actor, uuid);
  if (existing) return existing.update({ disabled: true });
}

async function _deleteEffect(actor, uuid) {
  const existing = await _resolveEffect(actor, uuid);
  if (existing) return existing.delete();
}

class DSStatusRegionBehaviorType extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [`${L}.region.statusEffect`];

  static defineSchema() {
    return {
      dispositions: _dispositionField(),
      statusId: new StringField({
        required: true, blank: false, nullable: true, initial: null,
        choices: () => Object.fromEntries(CONFIG.statusEffects.map(s => [s.id, s.name])),
      }),
      overlay: new BooleanField({ initial: false }),
    };
  }

  static #onTokenEnter(event) {
    const actor = event.data?.token?.actor;
    if (!actor || !this.statusId) return;
    if (!event.user.isSelf) return;
    if (!_passesDispositionFilter(this, event)) return;
    actor.toggleStatusEffect(this.statusId, { active: true, overlay: this.overlay });
  }

  static #onTokenExit(event) {
    const actor = event.data?.token?.actor;
    if (!actor || !this.statusId) return;
    if (!event.user.isSelf) return;
    if (!_passesDispositionFilter(this, event)) return;
    actor.toggleStatusEffect(this.statusId, { active: false, overlay: this.overlay });
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
  };
}

class DSStatusEventsRegionBehaviorType extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [`${L}.region.statusEffect`, `${L}.region.statusEffectEvents`];

  static defineSchema() {
    return {
      dispositions: _dispositionField(),
      events: this._createEventsField({ events: TOKEN_EVENTS }),
      statusId: new StringField({
        required: true, blank: false, nullable: true, initial: null,
        choices: () => Object.fromEntries(CONFIG.statusEffects.map(s => [s.id, s.name])),
      }),
      action: new StringField({
        required: true, blank: false, nullable: false, initial: 'toggle',
        choices: {
          toggle: `${L}.region.statusEffectEvents.FIELDS.action.choices.toggle`,
          apply:  `${L}.region.statusEffectEvents.FIELDS.action.choices.apply`,
          remove: `${L}.region.statusEffectEvents.FIELDS.action.choices.remove`,
        },
      }),
      overlay: new BooleanField({ initial: false }),
    };
  }

  async _handleRegionEvent(event) {
    const actor = event.data?.token?.actor;
    if (!actor || !this.statusId) return;
    if (!game.users.activeGM?.isSelf) return;
    if (!_passesDispositionFilter(this, event)) return;
    const active = this.action === 'apply' ? true : this.action === 'remove' ? false : undefined;
    actor.toggleStatusEffect(this.statusId, { active, overlay: this.overlay });
  }
}

class DSActiveEffectRegionBehaviorType extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [`${L}.region.activeEffect`];

  static defineSchema() {
    return {
      dispositions: _dispositionField(),
      uuid: new DocumentUUIDField({ type: 'ActiveEffect' }),
      disable: new BooleanField({ initial: false }),
    };
  }

  static async #onTokenEnter(event) {
    const actor = event.data?.token?.actor;
    if (!actor || !this.uuid) return;
    if (!event.user.isSelf) return;
    if (!_passesDispositionFilter(this, event)) return;
    await _addEffect(actor, this.uuid, this.parent.uuid);
  }

  static async #onTokenExit(event) {
    const actor = event.data?.token?.actor;
    if (!actor || !this.uuid) return;
    if (!event.user.isSelf) return;
    if (!_passesDispositionFilter(this, event)) return;
    if (this.disable) await _disableEffect(actor, this.uuid);
    else await _deleteEffect(actor, this.uuid);
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
  };
}

const ALL_ACTIONS = ['add', 'resetDuration', 'enable', 'disable', 'delete'];

class DSActiveEffectEventsRegionBehaviorType extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [`${L}.region.activeEffect`, `${L}.region.activeEffectEvents`];

  static defineSchema() {
    return {
      dispositions: _dispositionField(),
      events: this._createEventsField({ events: TOKEN_EVENTS }),
      action: new StringField({
        required: true, blank: false, nullable: true,
        choices: Object.fromEntries(ALL_ACTIONS.map(a => [a, `${L}.region.action.${a}`])),
      }),
      uuid: new DocumentUUIDField({ type: 'ActiveEffect' }),
    };
  }

  async _handleRegionEvent(event) {
    const actor = event.data?.token?.actor;
    if (!actor) return;
    if (!game.users.activeGM?.isSelf) return;
    if (!_passesDispositionFilter(this, event)) return;
    switch (this.action) {
      case 'add':           await _addEffect(actor, this.uuid, this.parent.uuid); break;
      case 'resetDuration': await _resetDuration(actor, this.uuid); break;
      case 'enable':        await _enableEffect(actor, this.uuid); break;
      case 'disable':       await _disableEffect(actor, this.uuid); break;
      case 'delete':        await _deleteEffect(actor, this.uuid); break;
    }
  }
}

const EVENTS_TYPES = new Set([`${M}.statusEffectEvents`, `${M}.activeEffectEvents`]);
const STATIC_TYPES = new Set([`${M}.statusEffect`,       `${M}.activeEffect`]);

const STATIC_TYPE_EVENTS = {
  [`${M}.statusEffect`]: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT],
  [`${M}.activeEffect`]: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT],
};

function _injectDispositionIntoEventsSection(app, html) {
  const type = app.document?.type;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  if (EVENTS_TYPES.has(type)) {
    const dispGroup = root.querySelector('[name="system.dispositions"]')?.closest('.form-group');
    const eventsGroup = root.querySelector('[name="system.events"]')?.closest('.form-group');
    if (dispGroup && eventsGroup && dispGroup !== eventsGroup)
      eventsGroup.before(dispGroup);

  } else if (STATIC_TYPES.has(type)) {
    const dispGroup = root.querySelector('[name="system.dispositions"]')?.closest('.form-group');
    if (!dispGroup) return;

    const fieldset = document.createElement('fieldset');
    fieldset.innerHTML = `<legend>Filter</legend>`;
    fieldset.appendChild(dispGroup);

    const fieldsets = root.querySelectorAll('fieldset');
    if (fieldsets.length >= 2) fieldsets[1].after(fieldset);
  }
}

export function registerRegionEffectBehaviors() {
  const TYPES = [
    [`${M}.statusEffect`,       DSStatusRegionBehaviorType],
    [`${M}.statusEffectEvents`, DSStatusEventsRegionBehaviorType],
    [`${M}.activeEffect`,       DSActiveEffectRegionBehaviorType],
    [`${M}.activeEffectEvents`, DSActiveEffectEventsRegionBehaviorType],
  ];

  for (const [type, cls] of TYPES) {
    CONFIG.RegionBehavior.dataModels[type] = cls;
  }

  Object.assign(CONFIG.RegionBehavior.typeIcons, {
    [`${M}.statusEffect`]:       'fa-solid fa-person-burst',
    [`${M}.statusEffectEvents`]: 'fa-solid fa-person-burst',
    [`${M}.activeEffect`]:       'fa-solid fa-gears',
    [`${M}.activeEffectEvents`]: 'fa-solid fa-gears',
  });

  Hooks.on('renderRegionBehaviorConfig', _injectDispositionIntoEventsSection);
}
