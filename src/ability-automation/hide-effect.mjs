import { getSetting } from '../helpers.mjs';
import { chooseMessageFilter } from './choose-effect.mjs';
import { hide, proposeHide, stealthActive } from '../conditions/stealth.mjs';
import { COVER_COUNTS } from '../conditions/stealth-traits.mjs';

const { SchemaField, StringField, BooleanField } = foundry.data.fields;
const M = 'draw-steel-combat-tools';
export const HIDE_TYPE = 'dsct.hide';
const ABILITY_PART_ID = 'abilityUse'.padEnd(16, '0');

export const hasHideEffect = (item) =>
  !!item?.system?.effects?.contents?.some(e => e.type === HIDE_TYPE);

class HideSpecialEffect extends ds.data.pseudoDocuments.specialEffects.BaseSpecialEffect {
  static get TYPE() { return HIDE_TYPE; }

  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      hide: new SchemaField({
        from:          new StringField({ required: true, blank: false, initial: 'enemies', label: 'DSCT.HideEffect.from.label', hint: 'DSCT.HideEffect.from.hint' }),
        whileObserved: new BooleanField({ label: 'DSCT.HideEffect.whileObserved.label', hint: 'DSCT.HideEffect.whileObserved.hint' }),
        coverCounts:   new StringField({ required: true, blank: true, initial: '', label: 'DSCT.HideEffect.coverCounts.label', hint: 'DSCT.HideEffect.coverCounts.hint' }),
        display:       new StringField({ required: false, blank: true, label: 'DSCT.HideEffect.display.label', hint: 'DSCT.HideEffect.display.hint' }),
      }),
    });
  }

  get detailsPartial() { return 'dsct.hide-effect'; }
  showUse() { return false; }

  get label() {
    const { from, whileObserved, coverCounts, display } = this.hide;
    if (display) return display;
    const bits = [];
    if (from === 'targets') bits.push(game.i18n.localize('DSCT.HideEffect.labelBits.targets'));
    if (whileObserved) bits.push(game.i18n.localize('DSCT.HideEffect.labelBits.observed'));
    if (coverCounts) bits.push(game.i18n.localize(`DSCT.HideEffect.coverCounts.choice.${coverCounts}`));
    const base = game.i18n.localize('DSCT.HideEffect.button');
    return bits.length ? `${base} (${bits.join(', ')})` : base;
  }

  async getSheetContext() {
    const L = (k) => game.i18n.localize(k);
    return {
      from:          { field: this.schema.getField('hide.from'),          src: this._source.hide.from },
      whileObserved: { field: this.schema.getField('hide.whileObserved'), src: this._source.hide.whileObserved },
      coverCounts:   { field: this.schema.getField('hide.coverCounts'),   src: this._source.hide.coverCounts },
      display:       { field: this.schema.getField('hide.display'),       src: this._source.hide.display },
      fromOptions: ['enemies', 'targets'].map(value => ({ value, label: L(`DSCT.HideEffect.from.choice.${value}`) })),
      coverOptions: COVER_COUNTS.map(value => ({ value, label: L(`DSCT.HideEffect.coverCounts.choice.${value || 'none'}`) })),
    };
  }
}

(function _earlyRegister() {
  const cfg = globalThis.ds?.CONFIG?.SpecialEffect;
  if (!cfg) return;
  cfg[HIDE_TYPE] = { label: `TYPES.SpecialEffect.${HIDE_TYPE}`, defaultImage: 'icons/svg/cowled.svg', documentClass: HideSpecialEffect };
})();

function _registerPartial() {
  Handlebars.registerPartial('dsct.hide-effect', `
    {{formGroup ctx.from.field value=ctx.from.src name="hide.from" options=ctx.fromOptions localize=true}}
    {{formGroup ctx.whileObserved.field value=ctx.whileObserved.src name="hide.whileObserved" localize=true}}
    {{formGroup ctx.coverCounts.field value=ctx.coverCounts.src name="hide.coverCounts" options=ctx.coverOptions localize=true}}
    {{formGroup ctx.display.field value=ctx.display.src name="hide.display" localize=true}}
  `);
}

function _speakerToken(message, item) {
  const byId = message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null;
  if (byId) return byId;
  const actor = item?.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
  return actor?.getActiveTokens?.()?.[0] ?? null;
}

async function _runHide(effect, item, message) {
  if (!stealthActive()) return ui.notifications.warn(game.i18n.localize('DSCT.notice.stealth.outOfCombat'));
  const token = _speakerToken(message, item);
  if (!token) return ui.notifications.warn(game.i18n.localize('DSCT.HideEffect.noToken'));
  if (!token.actor?.isOwner) return ui.notifications.warn(game.i18n.localize('DSCT.HideEffect.notOwner'));

  const { from, whileObserved, coverCounts } = effect.hide;
  const opts = { whileObserved, coverCounts };

  let ids;
  if (from === 'targets') {
    ids = [...game.user.targets].map(t => t.id).filter(id => id !== token.id);
    if (!ids.length) return ui.notifications.warn(game.i18n.localize('DSCT.notice.stealth.noTargets'));
  } else {
    ids = proposeHide(token, opts);
    if (!ids.length) return ui.notifications.warn(game.i18n.format('DSCT.HideEffect.nobody', { name: token.name }));
  }

  const list = await hide(token, ids, opts);
  ui.notifications.info(game.i18n.format('DSCT.HideEffect.hiddenFrom', { name: token.name, count: list.length }));
}

function _buildButton(effect, item, message) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dsct-hide-btn';
  btn.innerHTML = `<i class="fa-solid fa-user-ninja"></i> ${effect.label}`;
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    btn.disabled = true;
    try { await _runHide(effect, item, message); }
    catch (err) { console.warn('DSCT | hide effect |', err); }
    finally { btn.disabled = false; }
  });
  return btn;
}

function _installChatHook() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!getSetting('stealthSystemEnabled')) return;
    const part = message.system?.parts?.get?.(ABILITY_PART_ID);
    if (!part?.abilityUuid) return;
    const item = fromUuidSync(part.abilityUuid);
    if (!item?.system?.effects) return;

    const keeps = chooseMessageFilter(message, item);
    const effects = item.system.effects.contents
      .filter(e => e.type === HIDE_TYPE)
      .filter(e => !keeps || keeps(e));
    if (!effects.length) return;

    const section = html.querySelector(`section[data-message-part="${ABILITY_PART_ID}"]`);
    if (!section || section.querySelector('.dsct-hide-btn')) return;

    let footer = section.querySelector('footer.message-part-buttons');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'message-part-buttons';
      section.appendChild(footer);
    }
    for (const effect of effects) footer.appendChild(_buildButton(effect, item, message));
  });
}

function _installCreateDialogFilter() {
  Hooks.on('renderApplicationV2', (_app, element) => {
    if (getSetting('stealthSystemEnabled')) return;
    const select = element.querySelector?.('select[name="type"]');
    if (!select) return;
    const opt = Array.from(select.options ?? []).find(o => o.value === HIDE_TYPE);
    if (!opt) return;
    const wasSelected = select.value === HIDE_TYPE;
    opt.remove();
    if (wasSelected) select.value = select.options[0]?.value ?? '';
  });
}

export function registerHideEffect() {
  if (typeof ds === 'undefined' || !ds.CONFIG?.SpecialEffect) return;
  _registerPartial();
  _installChatHook();
  _installCreateDialogFilter();
  ds.CONFIG.SpecialEffect[HIDE_TYPE] = {
    label: `TYPES.SpecialEffect.${HIDE_TYPE}`,
    defaultImage: 'icons/svg/cowled.svg',
    documentClass: HideSpecialEffect,
  };
}
