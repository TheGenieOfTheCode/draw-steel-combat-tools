import { DSTD, DSTD_ROW, registerPanelDecorator, safeUpdate } from '../ctlib.mjs';
import { getSetting, getModuleApi, effectStartFor } from '../helpers.mjs';
import { DSCTAddModifierDialog, EFFECT_PILL_KINDS, EFFECT_END_LABELS, pillAmountLabel, pillCss } from '../ability-automation/roll-dialog-hooks.mjs';
import { addResultPill, chatPillHTML } from './dstd-roll-pills.mjs';
import { createExpiryReminder } from '../ability-automation/flat-special-effects.mjs';
import { RECURRING_PREFIX, RECURRING_IGNORES, hasRecurring } from '../conditions/recurring-damage.mjs';
import { setTip, tipFor, TIP_CLASS } from '../chat-tips.mjs';

const M = 'draw-steel-combat-tools';
const L = (k, data) => data ? game.i18n.format(`DSCT.panel.potency.${k}`, data) : game.i18n.localize(`DSCT.panel.potency.${k}`);
const E = (k, data) => data ? game.i18n.format(`DSCT.panel.effectMods.${k}`, data) : game.i18n.localize(`DSCT.panel.effectMods.${k}`);
const DEFAULT_SAVE = '1d10 + @combat.save.bonus';

const abilityOf = (message) => {
  const uuid = (message?.system?.parts?.contents ?? []).find(p => p.abilityUuid)?.abilityUuid ?? message?.flags?.[DSTD]?.state?.abilityUuid;
  return uuid ? fromUuidSync(uuid, { strict: false }) : null;
};

const targetActorOf = (target) => {
  const doc = target?.tokenUuid ? fromUuidSync(target.tokenUuid, { strict: false }) : null;
  return doc?.actor ?? (target?.actorUuid ? fromUuidSync(target.actorUuid, { strict: false }) : null);
};

const tierEffects = (effect, tier) => {
  const effects = effect?.applied?.[`tier${tier}`]?.effects;
  return effects instanceof Map ? effects : new Map(Object.entries(effects ?? {}));
};

function powerEffectPotency(ability, effect, tier, effectId) {
  let characteristic = null;
  for (let i = Number(tier); i >= 1 && !characteristic; i--) {
    const c = effect.applied?.[`tier${i}`]?.potency?.characteristic;
    if (ds.CONFIG.characteristics?.[c]) characteristic = c;
  }
  const formula = effect.applied?.[`tier${tier}`]?.potency?.value;
  if (!characteristic || !formula) return null;
  const value = Number(ds.utils.evaluateFormula(formula, ability.getRollData(), { contextName: effect.uuid }));
  const condition = tierEffects(effect, tier).get(effectId)?.condition ?? 'failure';
  return Number.isFinite(value) ? { characteristic, value, condition } : null;
}

function flatPotency(ability, effect) {
  const { characteristic, strength, custom } = effect.flatApplied?.potency ?? {};
  if (!ds.CONFIG.characteristics?.[characteristic]) return null;
  const value = strength === 'custom'
    ? Number(ds.utils.evaluateFormula(custom, ability.getRollData(), { contextName: effect.uuid }))
    : Number(ability.actor?.system?.potency?.[strength]);
  return Number.isFinite(value) ? { characteristic, value, condition: 'failure' } : null;
}

function effectPills(override, effectId) {
  return (Array.isArray(override?.dsctPills) ? override.dsctPills : [])
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => EFFECT_PILL_KINDS.has(p.kind) && (!p.effectId || p.effectId === effectId));
}

function pillMods(pills) {
  const mods = { shift: 0, force: null, resistWith: null, end: null, saveMod: 0, recurDelta: 0, recurMult: 1, recurType: null, recurIgnore: false };
  for (const { p } of pills) {
    if (p.enabled === false) continue;
    const n = Number(p.amount) || 0;
    if (p.kind === 'recurAmount') mods.recurDelta += n;
    else if (p.kind === 'recurMult' && n > 0) mods.recurMult *= n;
    else if (p.kind === 'recurType' && p.damageType) mods.recurType = p.damageType;
    else if (p.kind === 'recurIgnore') mods.recurIgnore = true;
    else if (p.kind === 'potency') mods.shift += n;
    else if (p.kind === 'potencyForce') mods.force = n;
    else if (p.kind === 'resistWith' && ds.CONFIG.characteristics?.[p.characteristic]) mods.resistWith = p.characteristic;
    else if (p.kind === 'effectEnd' && p.end) mods.end = p.end;
    else if (p.kind === 'saveMod') mods.saveMod += n;
  }
  return mods;
}

export function potencyVerdict({ actor, characteristic, value, condition = 'failure', shift = 0, force = null, resistWith = null }) {
  if (!actor?.system?.checkPotency || condition === 'always') return null;
  const chrKey = resistWith ?? characteristic;
  const potency = value + shift;
  const failed = actor.system.checkPotency(potency, chrKey);
  const chr = actor.system.characteristics?.[chrKey];
  const affected = force != null ? force > 0 : (condition === 'success' ? !failed : failed);
  return { potency, characteristic: chrKey, resist: (chr?.value ?? 0) + (chr?.resist ?? 0), resistBonus: chr?.resist ?? 0, failed, affected, forced: force != null };
}

const tierOf = (message, state, targetKey) => Number(state.tierOverrides?.[targetKey]?.tier)
  || Number((message.system?.parts?.contents ?? []).find(p => p.type === 'abilityResult')?.tier) || null;

const effectName = (ability, id) => ability.effects?.get?.(id)?.name
  ?? game.i18n.localize(CONFIG.statusEffects.find(s => s.id === id)?.name ?? id);

export function potencyEffectsOf(messageId, targetKey) {
  const message = game.messages.get(messageId);
  const state = message?.getFlag(DSTD, 'state');
  const ability = abilityOf(message);
  if (!state || !ability || !targetKey) return [];
  const tier = tierOf(message, state, targetKey);
  const out = [];
  const label = (id, potency) => `${effectName(ability, id)} (${ds.CONFIG.characteristics[potency.characteristic]?.rollKey ?? potency.characteristic} < ${potency.value})`;
  for (const effect of ability.system?.power?.effects ?? []) {
    if (effect.type !== 'applied' || !tier) continue;
    for (const effectId of tierEffects(effect, tier).keys()) {
      const potency = powerEffectPotency(ability, effect, tier, effectId);
      if (potency && potency.condition !== 'always') out.push({ effectId, label: label(effectId, potency) });
    }
  }
  for (const effect of ability.system?.effects ?? []) {
    if (effect.type !== 'dsct.flatApplied' || !effect.flatApplied?.statusId) continue;
    const potency = flatPotency(ability, effect);
    if (potency) out.push({ effectId: effect.id, label: label(effect.flatApplied.statusId, potency) });
  }
  return out;
}

const STAT_SUFFIX = /\s*\([MARIP]: -?\d+\)\s*$/;

function stripStat(button) {
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.trim()) last = node;
  if (last && STAT_SUFFIX.test(last.data)) last.data = last.data.replace(STAT_SUFFIX, '');
}

function verdictTooltip(verdict, { name, base, pills }) {
  const esc = foundry.utils.escapeHTML;
  const chr = ds.CONFIG.characteristics[verdict.characteristic];
  const abbr = chr?.rollKey ?? verdict.characteristic;
  const chrName = game.i18n.localize(chr?.label ?? verdict.characteristic);
  const mods = pills.filter(({ p }) => p.enabled !== false && ['potency', 'potencyForce', 'resistWith'].includes(p.kind))
    .map(({ p }) => `<li>${esc(pillAmountLabel(p))} &middot; ${esc(p.reason ?? '')}</li>`);
  const actor = verdict.resist - (verdict.resistBonus ?? 0);
  const lines = verdict.forced
    ? [`<p>${esc(E(verdict.affected ? 'TooltipAlways' : 'TooltipNever'))}</p>`]
    : [
      `<p><strong>${esc(L('TipPotency'))}</strong> ${esc(abbr)} &lt; ${verdict.potency}${verdict.potency !== base ? ` <span class="dsct-tip-dim">(${esc(L('TipBase', { n: base }))})</span>` : ''}</p>`,
      `<p><strong>${esc(L('TipTarget', { chr: chrName }))}</strong> ${verdict.resist}${verdict.resistBonus ? ` <span class="dsct-tip-dim">(${actor} ${verdict.resistBonus > 0 ? '+' : '-'} ${Math.abs(verdict.resistBonus)})</span>` : ''}</p>`,
      `<p>${esc(L(verdict.failed ? 'TipBelow' : 'TipMeets', { chr: chrName, resist: verdict.resist, potency: verdict.potency }))}</p>`,
    ];
  if (mods.length) lines.push(`<ul class="dsct-tip-mods">${mods.join('')}</ul>`);
  return `<header class="metadata"><h3 class="name">${esc(name)}</h3><aside class="category"><h4>${esc(L(verdict.affected ? 'Affected' : 'Resisted'))}</h4></aside></header>`
    + `<section class="content dsct-potency-tip">${lines.join('')}</section>`;
}

function verdictTag(row, button, verdict, detail) {
  row.classList.toggle('dsct-potency-resisted', !verdict.affected);
  row.dataset.dsctPotencyVerdict = verdict.affected ? 'affected' : 'resisted';
  const className = `dsct-potency-verdict ${verdict.affected ? 'is-affected' : 'is-resisted'}`;
  const text = L(verdict.affected ? 'Affected' : 'Resisted');
  const tip = verdictTooltip(verdict, detail);
  const current = row.querySelectorAll('.dsct-potency-verdict');
  if (current.length === 1 && current[0].parentElement === button && current[0].className === className
    && current[0].textContent === text && current[0].dataset.dsctTip === tip) return;
  current.forEach(e => e.remove());
  const tag = document.createElement('span');
  tag.className = className;
  tag.textContent = text;
  tag.dataset.dsctTip = tip;
  tag.dataset.dsctTipClass = TIP_CLASS;
  button.append(tag);
}

function rowEffect(row, ability, tier) {
  const native = row.querySelector('button[data-dstd-action="applyStatus"]');
  const cond = row.querySelector('[data-dsct-dstd-cond*=":cond:"]');
  const flat = row.querySelector('[data-dsct-flat-cond-key]');
  if (native || cond) {
    const effectId = native?.dataset.effectId ?? cond.dataset.dsctDstdCond.split(':cond:').pop();
    const rowTier = Number(native?.dataset.tier) || tier;
    const effect = (ability.system?.power?.effects ?? []).find(e => e.type === 'applied' && tierEffects(e, rowTier).has(effectId));
    return { button: native ?? cond, effectId, statusId: effectId, potency: effect ? powerEffectPotency(ability, effect, rowTier, effectId) : null,
      recurring: hasRecurring(ability.effects?.get?.(effectId)) };
  }
  if (flat) {
    const effectId = flat.dataset.dsctFlatCondKey.split(':flatCond:').pop();
    const effect = ability.system?.effects?.get?.(effectId);
    if (!effect?.flatApplied?.statusId) return null;
    return { button: flat, effectId, statusId: effect.flatApplied.statusId, potency: flatPotency(ability, effect),
      recurring: hasRecurring(ability.effects?.get?.(effect.flatApplied.statusId)) };
  }
  return null;
}

function decorate(message, panel) {
  const state = message.getFlag(DSTD, 'state');
  const ability = abilityOf(message);
  if (!state || !ability) return;
  const checks = getSetting('potencyChecks') !== 'off';
  const sourceUuid = state.sourceActorUuid ?? ability.actor?.uuid ?? null;
  for (const targetRow of panel.querySelectorAll(DSTD_ROW)) {
    const targetKey = targetRow.dataset.targetKey;
    if (!targetKey || targetKey === 'selected-token') continue;
    const target = (state.targets ?? []).find(t => String(t.tokenUuid ?? t.actorUuid ?? '').replace(/\./g, '__') === targetKey);
    const actor = targetActorOf(target);
    if (!actor) continue;
    const override = state.tierOverrides?.[targetKey] ?? null;
    const tier = tierOf(message, state, targetKey);
    for (const row of targetRow.querySelectorAll(`.${DSTD}-action-row`)) {
      const found = rowEffect(row, ability, tier);
      if (!found) continue;
      const pills = effectPills(override, found.effectId);
      const mods = pillMods(pills);
      const name = effectName(ability, found.statusId);
      stripStat(found.button);
      if (checks && found.potency) {
        const verdict = potencyVerdict({ actor, ...found.potency, shift: mods.shift, force: mods.force, resistWith: mods.resistWith });
        if (verdict) verdictTag(row, found.button, verdict, { name, base: found.potency.value, pills });
      }
      const recur = found.recurring && (mods.recurDelta || mods.recurMult !== 1 || mods.recurType || mods.recurIgnore)
        ? { delta: mods.recurDelta, mult: mods.recurMult, type: mods.recurType, ignore: mods.recurIgnore } : null;
      const modsJson = (mods.end || mods.saveMod || recur)
        ? JSON.stringify({ actorUuid: actor.uuid, statusId: found.statusId, name, end: mods.end, saveMod: mods.saveMod, recur, sourceUuid }) : null;
      if (modsJson && row.dataset.dsctEffectMods !== modsJson) row.dataset.dsctEffectMods = modsJson;
      else if (!modsJson && row.dataset.dsctEffectMods) delete row.dataset.dsctEffectMods;
      effectPillRow(row, message, targetKey, pills);
      effectCog(row, message, targetKey, found.effectId, name, !!found.potency, !!found.recurring);
    }
  }
}

const canEdit = (message) => game.user.isGM || message.isOwner || !!getModuleApi(false)?.socket;

function effectPillRow(row, message, targetKey, pills) {
  const live = canEdit(message) && !row.classList.contains('is-applied');
  const html = pills.map(({ p, idx }) => chatPillHTML({ ...p, removable: live, overrideIdx: idx, disabled: p.enabled === false }, message.id, targetKey)).join('');
  const next = row.nextElementSibling?.classList.contains('dsct-effect-pills-row') ? row.nextElementSibling : null;
  if ((next?.dataset.dsctSig ?? '') === html) return;
  next?.remove();
  if (!html) return;
  const el = document.createElement('div');
  el.className = 'dsct-dmg-pills-row dsct-effect-pills-row';
  el.dataset.dsctSig = html;
  el.innerHTML = html;
  row.after(el);
}

function effectCog(row, message, targetKey, effectId, name, hasPotency, hasRecurring) {
  if (!canEdit(message) || row.querySelector('.dsct-effect-cog')) return;
  const cog = document.createElement('button');
  cog.type = 'button';
  cog.className = `${DSTD}-icon-button ${DSTD}-cog-button dsct-effect-cog`;
  setTip(cog, tipFor('potencyEdit'));
  cog.innerHTML = '<i class="fa-solid fa-gear"></i>';
  cog.disabled = row.classList.contains('is-applied');
  cog.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    new EffectModDialog({ messageId: message.id, targetKey, effectId, name, hasPotency, hasRecurring }).render(true);
  });
  row.append(cog);
}

const endChoices = () => [
  ...Object.entries(ds.CONFIG.effectEnds ?? {}).map(([value, cfg]) => ({ value, label: game.i18n.localize(cfg.label ?? value) })),
  ...Object.entries(EFFECT_END_LABELS).map(([value, key]) => ({ value, label: game.i18n.localize(key) })),
];

class EffectModDialog extends DSCTAddModifierDialog {
  constructor({ messageId, targetKey, effectId, name, hasPotency, hasRecurring }, options = {}) {
    super({ rendered: true, options: { context: { targets: {} } }, _dsctSources: [], _dsctOrigTargets: {} }, targetKey,
      foundry.utils.mergeObject({ window: { title: E('EditTitle', { name }) } }, options));
    Object.assign(this, { _messageId: messageId, _targetKey: targetKey, _effectId: effectId, _hasPotency: hasPotency, _hasRecurring: hasRecurring });
    this._kind = hasPotency ? 'potency' : 'effectEnd';
    this._negate = true;
  }

  _onRender(context, options) {
    const root = this.element.querySelector('.dsct-amw') ?? this.element;
    const grid = root.querySelector('.dsct-amw-type-grid');
    if (grid && !grid.dataset.dsctEffect) {
      grid.dataset.dsctEffect = '1';
      const btn = (kind, amount, css, label) => `<button type="button" class="dsct-amw-type-btn ${css}${kind === this._kind ? ' active' : ''}" data-kind="${kind}" data-amount="${amount}">${E(label)}</button>`;
      grid.innerHTML = [
        ...(this._hasPotency ? [
          btn('potency', -1, 'bane', 'LowerPotency'), btn('potency', 1, 'edge', 'RaisePotency'),
          btn('potencyForce', 1, 'edge', 'AlwaysLands'), btn('potencyForce', -1, 'bane', 'NeverLands'),
          btn('resistWith', 1, 'bonus dsct-amw-wide', 'ResistWith'),
        ] : []),
        btn('effectEnd', 1, 'bonus dsct-amw-wide', 'Duration'),
        btn('saveMod', 1, 'edge', 'SaveBonus'), btn('saveMod', -1, 'bane', 'SavePenalty'),
        ...(this._hasRecurring ? [
          btn('recurAmount', 1, 'edge', 'RecurUp'), btn('recurAmount', -1, 'bane', 'RecurDown'),
          btn('recurMult', 2, 'edge', 'RecurDouble'), btn('recurMult', -1, 'bane', 'RecurHalf'),
          btn('recurType', 1, 'bonus', 'RecurType'), btn('recurIgnore', 1, 'bonus', 'RecurIgnore'),
        ] : []),
      ].join('');
      const value = root.querySelector('.dsct-amw-value-group');
      const select = (cls, label, choices) => `<div class="form-group ${cls}" style="display:none"><label>${E(label)}</label>`
        + `<div class="form-fields"><select>${choices.map(c => `<option value="${c.value}">${foundry.utils.escapeHTML(c.label)}</option>`).join('')}</select></div></div>`;
      value?.insertAdjacentHTML('afterend', select('dsct-amw-end-group', 'Lasts', endChoices())
        + select('dsct-amw-char-group', 'Characteristic', Object.entries(ds.CONFIG.characteristics ?? {}).map(([v, c]) => ({ value: v, label: game.i18n.localize(c.label ?? v) })))
        + select('dsct-amw-dtype-group', 'DamageType', Object.entries(ds.CONFIG.damageTypes ?? {}).map(([v, c]) => ({ value: v, label: game.i18n.localize(c.label ?? v) }))));
      root.querySelector('.dsct-amw-scope-select')?.closest('.form-group')?.remove();
      for (const sel of root.querySelectorAll('.dsct-amw-end-group select, .dsct-amw-char-group select, .dsct-amw-dtype-group select')) sel.addEventListener('change', () => this._updatePreview());
    }
    super._onRender(context, options);
  }

  _syncValueField() {
    const root = this.element?.querySelector('.dsct-amw') ?? this.element;
    if (this._valueGroup) this._valueGroup.style.display = ['potency', 'saveMod', 'recurAmount'].includes(this._kind) ? '' : 'none';
    const show = (cls, kind) => { const g = root?.querySelector(cls); if (g) g.style.display = this._kind === kind ? '' : 'none'; };
    show('.dsct-amw-end-group', 'effectEnd');
    show('.dsct-amw-char-group', 'resistWith');
    show('.dsct-amw-dtype-group', 'recurType');
  }

  _readValueAmount() {
    if (this._kind === 'potencyForce') return this._negate ? -1 : 1;
    if (this._kind === 'recurMult') return this._negate ? 0.5 : 2;
    if (!['potency', 'saveMod', 'recurAmount'].includes(this._kind)) return 1;
    const raw = Math.max(1, Math.abs(parseInt(this._valueInput?.value) || 1));
    return this._negate ? -raw : raw;
  }

  _pill() {
    const root = this.element?.querySelector('.dsct-amw') ?? this.element;
    const pill = { kind: this._kind, amount: this._readValueAmount(), effectId: this._effectId };
    if (this._kind === 'effectEnd') pill.end = root?.querySelector('.dsct-amw-end-group select')?.value ?? 'turn';
    if (this._kind === 'resistWith') pill.characteristic = root?.querySelector('.dsct-amw-char-group select')?.value ?? 'might';
    if (this._kind === 'recurType') pill.damageType = root?.querySelector('.dsct-amw-dtype-group select')?.value ?? 'fire';
    return pill;
  }

  _updatePreview() {
    const prev = this._previewPill;
    if (!prev) return;
    const pill = this._pill();
    const reason = this._reasonInput?.value?.trim() || E('Custom');
    const src = this._sourceInput?.value?.trim() || null;
    prev.className = `dsct-source-pill dsct-pill-${pillCss(pill)} dsct-pill-custom`;
    prev.innerHTML = `<span class="dsct-pip">${foundry.utils.escapeHTML(pillAmountLabel(pill))} &middot; ${foundry.utils.escapeHTML(reason)}</span>`
      + (src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(src)}</span>` : '');
  }

  _submit() {
    const reason = this._reasonInput?.value?.trim() || E('Custom');
    const src = this._sourceInput?.value?.trim() || null;
    const srcToken = src ? canvas.tokens?.placeables.find(t => t.name === src) ?? null : null;
    addResultPill(this._messageId, this._targetKey, { ...this._pill(), reason, src, srcTokenId: srcToken?.id ?? null, custom: true })
      .catch(err => console.error('DSCT | effect pill add failed', err));
    this.close();
  }
}

function recurringUpdate(effect, { delta = 0, mult = 1, type = null, ignore = false }) {
  const changes = foundry.utils.deepClone(effect.system?.changes ?? []);
  let name = effect.name;
  for (const c of changes) {
    if (!String(c.key ?? '').startsWith(RECURRING_PREFIX)) continue;
    const from = c.key.slice(RECURRING_PREFIX.length);
    const before = Number(c.value) || 0;
    const after = Math.max(0, Math.floor((before + delta) * mult));
    c.value = String(after);
    if (type) c.key = `${RECURRING_PREFIX}${type}`;
    const fromLabel = game.i18n.localize(ds.CONFIG.damageTypes?.[from]?.label ?? from);
    const toLabel = type ? game.i18n.localize(ds.CONFIG.damageTypes?.[type]?.label ?? type) : fromLabel;
    name = name.replace(new RegExp(`\\b${fromLabel}\\s+${before}\\b`, 'i'), `${toLabel} ${after}`);
  }
  if (ignore && !changes.some(c => c.key === RECURRING_IGNORES)) changes.push({ key: RECURRING_IGNORES, type: 'override', value: 'true', phase: 'initial', priority: null });
  return { 'system.changes': changes, ...(name !== effect.name ? { name } : {}) };
}

async function applyEffectMods(effect, { end, saveMod, recur, sourceUuid }) {
  const update = { [`flags.${M}.effectMods`]: { end: end ?? null, saveMod: saveMod || 0, recur: recur ?? null } };
  if (recur) Object.assign(update, recurringUpdate(effect, recur));
  const giver = sourceUuid ? fromUuidSync(sourceUuid, { strict: false }) : null;
  let reminder = null;
  if (end === 'originNextStart' && giver) {
    update.duration = { value: null, units: 'seconds', expiry: null, expired: false };
    update[`flags.${M}.expiryReminderOwner`] = giver.uuid;
    reminder = giver;
  } else if (end === 'originTurn' && giver) {
    update.duration = { expiry: 'turnEnd' };
    update.start = effectStartFor(giver);
  } else if (ds.CONFIG.effectEnds?.[end]) {
    update.duration = { expiry: ds.CONFIG.effectEnds[end].expiryEvent };
    update.start = effectStartFor(effect.parent);
    if (end === 'save' && !effect.system?.end?.roll) update['system.end.roll'] = DEFAULT_SAVE;
  }
  if (saveMod) {
    const base = update['system.end.roll'] ?? effect.system?.end?.roll ?? DEFAULT_SAVE;
    update['system.end.roll'] = `${base} ${saveMod > 0 ? '+' : '-'} ${Math.abs(saveMod)}`;
  }
  await safeUpdate(effect, update);
  if (reminder) await createExpiryReminder(reminder, effect, { expiry: 'turnStart', rounds: 1 }, effect.parent);
}

function watchCreatedEffect(mods) {
  const actor = fromUuidSync(mods.actorUuid, { strict: false });
  if (!actor?.effects) return;
  const before = new Set(actor.effects.map(e => e.id));
  const match = (e) => !before.has(e.id) && !e.getFlag(M, 'effectMods')
    && (e.statuses?.has(mods.statusId) || e.id === mods.statusId || e.name === mods.name || e.getFlag(M, 'flatAppliedFrom') === mods.statusId);
  const until = Date.now() + 6000;
  const tick = async () => {
    const found = actor.effects.filter(match);
    if (!found.length) return void (Date.now() < until && setTimeout(tick, 150));
    for (const effect of found) await applyEffectMods(effect, mods).catch(err => console.error('DSCT | effect pill apply failed', err));
  };
  setTimeout(tick, 150);
}

document.addEventListener('click', (ev) => {
  const row = ev.target?.closest?.(`.${DSTD}-action-row[data-dsct-effect-mods]`);
  const btn = row ? [...row.children].find(c => c.tagName === 'BUTTON') : null;
  if (!btn || btn.disabled || !btn.contains(ev.target)) return;
  try { watchCreatedEffect(JSON.parse(row.dataset.dsctEffectMods)); } catch {}
}, { capture: true });

export function registerDstdPotency() {
  if (!game.modules.get(DSTD)?.active) return;
  registerPanelDecorator({ id: 'combat-tools-potency', priority: 250, retry: [300], ignore: ['.dsct-effect-pills-row'], decorate: ({ message, panel }) => decorate(message, panel) });
}
