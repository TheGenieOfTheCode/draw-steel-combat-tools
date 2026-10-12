import { getSetting, safeUpdate } from '../helpers.mjs';
import { GRABBER_IMG } from '../conditions/statuses.mjs';

const M = 'draw-steel-combat-tools';
const GRABBER = 'dsct-grabber';
const _defaults = new Map();

const _groupStatuses = (ids) => globalThis.ctlib?.groupStatuses?.(ids)
  ?? [{ key: 'all', label: 'DSCT.statusIcons.all', statuses: ids }];

export const statusIconOverrides = () => ({ ...(getSetting('statusIcons') ?? {}) });

export const defaultStatusIcon = (id) => {
  if (id === GRABBER) return GRABBER_IMG;
  if (!_defaults.has(id)) { const s = CONFIG.statusEffects.find(x => x.id === id); if (s) _defaults.set(id, s.img); }
  return _defaults.get(id) ?? null;
};

export const applyStatusIcons = () => {
  const overrides = statusIconOverrides();
  for (const status of CONFIG.statusEffects) {
    const base = defaultStatusIcon(status.id);
    status.img = overrides[status.id] || base;
  }
};

const LEGACY_ICONS = {
  frightened: ['frightenedEffectIcon', 'icons/svg/terror.svg'],
  taunted:    ['tauntedEffectIcon', 'systems/draw-steel/assets/icons/flag-banner-fold-fill.svg'],
  bleeding:   ['bleedingEffectIcon', 'icons/svg/blood.svg'],
  grabbed:    ['grabbedEffectIcon', 'icons/skills/melee/unarmed-punch-fist-yellow-red.webp'],
};

export const migrateLegacyIcons = async () => {
  if (!game.user.isGM || getSetting('statusIconsMigrated')) return;
  const overrides = statusIconOverrides();
  for (const [id, [key, oldDefault]] of Object.entries(LEGACY_ICONS)) {
    const value = game.settings.get(M, key);
    if (value && value !== oldDefault && !overrides[id]) overrides[id] = value;
  }
  if (game.settings.get(M, 'grabberEffectIcon') === 'icons/magic/control/debuff-chains-shackle-movement-red.webp') {
    await game.settings.set(M, 'grabberEffectIcon', GRABBER_IMG);
  }
  await game.settings.set(M, 'statusIcons', overrides);
  await game.settings.set(M, 'statusIconsMigrated', true);
  applyStatusIcons();
};

const _relabelExisting = async (changes) => {
  if (!changes.length) return;
  const actors = new Set([...game.actors, ...(canvas.scene?.tokens ?? []).map(t => t.actor).filter(Boolean)]);
  for (const actor of actors) {
    for (const { id, from, to } of changes) {
      const effects = id === GRABBER
        ? actor.effects.filter(e => e.getFlag(M, 'grab')?.grabberId && e.img === from)
        : actor.effects.filter(e => e.statuses.has(id) && e.img === from);
      for (const e of effects) await safeUpdate(e, { img: to });
    }
  }
};

export class StatusIconsMenu extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    id:       'dsct-status-icons',
    classes:  ['draw-steel', 'dsct-status-icons-app'],
    window:   { title: 'DSCT.statusIcons.title', resizable: true },
    position: { width: 560, height: 'auto' },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/settings/status-icons.hbs' },
  };

  _pending = null;

  _current() {
    this._pending ??= { ...statusIconOverrides(), [GRABBER]: getSetting('grabberEffectIcon') || GRABBER_IMG };
    return this._pending;
  }

  _imgFor(id) {
    const chosen = this._current()[id];
    return chosen || defaultStatusIcon(id);
  }

  async _prepareContext(_options) {
    const pending = this._current();
    const tile = (id, name) => ({
      id, name, img: this._imgFor(id),
      changed: !!pending[id] && pending[id] !== defaultStatusIcon(id),
    });
    const names = new Map(CONFIG.statusEffects.map(s => [s.id, game.i18n.localize(s.name ?? s.id)]));
    const groups = _groupStatuses([...names.keys()]).map(g => ({
      label: game.i18n.localize(g.label),
      tiles: g.statuses.map(id => tile(id, names.get(id))),
    }));
    const ct = groups.find(g => g.label === game.i18n.localize('DSCT.statusGroup.dsct')) ?? groups.at(-1);
    ct?.tiles.push(tile(GRABBER, game.i18n.localize('DSCT.statusIcons.grabber')));
    return { groups };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
    const el = this.element;
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('dsct-status-tile')) { e.preventDefault(); e.target.click(); }
    });
    el.addEventListener('click', (e) => {
      const reset = e.target.closest('[data-reset]');
      if (reset) {
        e.stopPropagation();
        delete this._current()[reset.dataset.reset];
        return this.render();
      }
      const tileEl = e.target.closest('.dsct-status-tile');
      if (tileEl) {
        const id = tileEl.dataset.statusId;
        new foundry.applications.apps.FilePicker.implementation({
          type: 'image',
          current: this._imgFor(id),
          callback: (path) => { this._current()[id] = path; this.render(); },
        }).browse();
        return;
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'resetAll') { this._pending = {}; this.render(); }
      if (action === 'save') this._save().then(() => this.close());
    });
  }

  async _save() {
    const pending = this._current();
    const before = { ...statusIconOverrides(), [GRABBER]: getSetting('grabberEffectIcon') || GRABBER_IMG };
    const changes = [];
    const ids = new Set([...Object.keys(before), ...Object.keys(pending), ...CONFIG.statusEffects.map(s => s.id), GRABBER]);
    for (const id of ids) {
      const from = before[id] || defaultStatusIcon(id);
      const to = pending[id] || defaultStatusIcon(id);
      if (from && to && from !== to) changes.push({ id, from, to });
    }
    const overrides = Object.fromEntries(Object.entries(pending).filter(([id, img]) => id !== GRABBER && img && img !== defaultStatusIcon(id)));
    await game.settings.set(M, 'statusIcons', overrides);
    await game.settings.set(M, 'grabberEffectIcon', pending[GRABBER] || GRABBER_IMG);
    applyStatusIcons();
    await _relabelExisting(changes);
    ui.notifications.info(game.i18n.localize('DSCT.statusIcons.saved'));
  }
}
