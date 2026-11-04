import { openDamageEditor, foldDamagePills, damagePillType, damagePillEffect, damagePillAmtStr, damagePillDisplayList, damageTypeLabel } from './dstd-damage-pills.mjs';
import { RollEditorBase, rollPillAmount } from './dstd-roll-pills.mjs';
import { applyTierMods } from '../ability-automation/roll-dialog-hooks.mjs';
import { chooseKeywords } from '../ability-automation/choose-effect.mjs';
import { runForcedMovement } from '../forced-movement/forced-movement-engine.mjs';
import { FmModifyPanel, replayModifiers } from '../forced-movement/forced-movement-modify-panel.mjs';
import { _fmBaseStateFromBtn, _fmMakeLabel } from '../system-patches.mjs';
import { RESULT_MENU, DAMAGE_TYPES } from '../ctlib.mjs';
import { getSetting, getWindowById } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'resultMods';
const L = (k, data) => game.i18n.format(`DSCT.resultMods.${k}`, data ?? {});
const RESULT_TYPES = new Set(['abilityResult', 'targetResult']);
const { OperatorTerm, NumericTerm } = foundry.dice.terms;

const active = () => !!globalThis.ds?.CONFIG?.MessagePart?.targetResult && !game.modules.get('draw-steel-target-damage')?.active;
const isDamage = (roll) => roll instanceof ds.rolls.DamageRoll && !roll.isHeal;
const isPower = (roll) => roll instanceof ds.rolls.PowerRoll;
const modsOf = (part) => foundry.utils.deepClone(part.message.getFlag(M, `${FLAG}.${part.id}`) ?? {});
const live = (pills) => (pills ?? []).filter((p) => p.enabled !== false && p.kind !== 'note');
const stagedSurges = (pills) => (pills ?? []).filter((p) => p.kind === 'surge' && p.enabled !== false).length;
const plural = (n, one, many, data = {}) => (n === 1 ? L(one, data) : L(many, { ...data, n }));

function surgeSource(part) {
  let src = part.ability?.actor ?? null;
  if (src?.type === 'retainer') src = src.system?.retainer?.mentor ?? null;
  if (src?.type === 'draw-steel-companion.companion') src = src.system?.retainer?.mentor ?? null;
  return src?.type === 'hero' ? src : null;
}

const damageIndexes = (part) => part.rolls.map((r, i) => (isDamage(r) ? i : -1)).filter((i) => i >= 0);

async function append(roll, amount, flavor = undefined) {
  if (!amount) return;
  const terms = [new OperatorTerm({ operator: amount > 0 ? '+' : '-' }), new NumericTerm({ number: Math.abs(amount), options: flavor ? { flavor } : {} })];
  for (const term of terms) if (!term._evaluated) await term.evaluate();
  roll.terms = roll.terms.concat(terms);
  roll.resetFormula();
  roll._total = roll._evaluateTotal();
}

async function tierRolls(part, k, baseTier, baseData) {
  const effect = part.ability?.system?.power?.effects?.documentsByType?.damage?.[k];
  const rolls = { [baseTier]: baseData };
  for (const tier of [1, 2, 3]) {
    if (tier === baseTier) continue;
    const roll = effect?.toDamageRoll?.(tier, {}) ?? new ds.rolls.DamageRoll('0', {}, { ...baseData.options });
    await roll.evaluate();
    rolls[tier] = roll.toJSON();
  }
  return rolls;
}

function damageSteps(start, pills) {
  const order = damagePillDisplayList(pills).filter((x) => !x.inert && x.pill.enabled !== false).map((x) => x.pill);
  const steps = [];
  let before = foldDamagePills(start, []);
  for (let i = 0; i < order.length; i++) {
    const after = foldDamagePills(start, order.slice(0, i + 1));
    if (after !== before || order[i].kind === 'surge') steps.push({ delta: after - before, before, after, pill: order[i] });
    before = after;
  }
  return steps;
}

function damageBaseData(entry, tier) {
  return entry.tierRolls?.[tier] ?? entry.base;
}

function coreFormula(power) {
  const flavors = new Set(['Edge', 'Bane', 'Bonus', 'Penalty'].map((k) => game.i18n.localize(`DRAW_STEEL.ROLL.Power.Modifier.${k}`)));
  const kept = [];
  for (const term of power.terms) {
    if (term instanceof NumericTerm && flavors.has(term.options?.flavor)) {
      if (kept.at(-1) instanceof OperatorTerm) kept.pop();
      continue;
    }
    kept.push(term);
  }
  return foundry.dice.Roll.getFormula(kept);
}

async function rebuildPower(baseData, eff) {
  const base = foundry.dice.Roll.fromData(baseData);
  const roll = new ds.rolls.PowerRoll(coreFormula(base), {}, {
    ...base.options, edges: eff.edges, banes: eff.banes, bonuses: eff.bonuses, appliedModifier: false,
  });
  roll.terms[0] = base.terms[0];
  await roll.evaluate({ allowInteractive: false });
  return { roll, tier: applyTierMods(roll.product, eff.tierMods) };
}

async function rebake(part, change = {}) {
  const mods = modsOf(part);
  mods.damage ??= {};
  if (change.roll) {
    mods.roll = { base: mods.roll?.base ?? part.rolls[0].toJSON(), baseTier: mods.roll?.baseTier ?? part.tier, ...change.roll };
  }
  for (const [index, entry] of Object.entries(change.damage ?? {})) {
    mods.damage[index] = { ...(mods.damage[index] ?? {}), ...entry };
  }

  const rolls = [...part.rolls];
  let tier = part.tier;
  if (mods.roll) {
    const rebuilt = await rebuildPower(mods.roll.base, mods.roll.eff);
    rolls[0] = rebuilt.roll;
    tier = rebuilt.tier;
  }

  const hero = surgeSource(part);
  let surgeDelta = 0;
  for (const [k, index] of damageIndexes(part).entries()) {
    const tierMoved = mods.roll && tier !== mods.roll.baseTier;
    if (!mods.damage[index] && !tierMoved) continue;
    const entry = mods.damage[index] ??= { pills: [], surges: 0 };
    entry.base ??= part.rolls[index].toJSON();
    if (tierMoved) entry.tierRolls ??= await tierRolls(part, k, mods.roll.baseTier, entry.base);
    const roll = foundry.dice.Roll.fromData(damageBaseData(entry, tier));
    if (entry.pills.some((p) => p.splitBase)) await append(roll, -roll.total);
    const start = roll.total;
    entry.steps = damageSteps(start, entry.pills);
    for (const step of entry.steps) await append(roll, step.delta);
    const type = damagePillType(entry.pills);
    if (type !== null) {
      const label = ds.CONFIG.damageTypes[type]?.label ?? type ?? '';
      roll.options = { ...roll.options, type, flavor: game.i18n.format('DRAW_STEEL.Item.ability.DamageFlavor', { type: label }) };
    }
    rolls[index] = roll;
    const staged = stagedSurges(entry.pills);
    if (hero) { surgeDelta += staged - (Number(entry.surges) || 0); entry.surges = staged; }
  }

  if (hero && surgeDelta) {
    const now = Number(hero.system.hero?.surges ?? 0) || 0;
    await hero.update({ 'system.hero.surges': Math.max(0, now - surgeDelta) });
  }
  await part.message.update({ [`flags.${M}.${FLAG}.${part.id}`]: mods });
  await part.update({ rolls, ...(tier !== part.tier ? { tier } : {}) });
}

function damageStart(part, index) {
  const mods = modsOf(part);
  const entry = mods.damage?.[index];
  if (!entry?.base) return part.rolls[index].total;
  return foundry.dice.Roll.fromData(damageBaseData(entry, part.tier)).total;
}

async function openDamage(part, index) {
  const entry = modsOf(part).damage?.[index];
  const hero = surgeSource(part);
  const surge = hero ? {
    actorUuid: hero.uuid,
    available: (Number(hero.system.hero?.surges ?? 0) || 0) + (Number(entry?.surges ?? 0) || 0),
    damage: Number(hero.getRollData?.()?.chr ?? 0) || 0,
  } : null;
  const name = part.actorTarget?.name ?? part.ability?.name ?? '';
  const outcome = await openDamageEditor({
    title: L('title', { name }), label: '', base: (entry?.pills ?? []).some((p) => p.splitBase) ? 0 : damageStart(part, index),
    pills: (entry?.pills ?? []).map((p) => ({ ...p })), surge,
  });
  if (!outcome) return;
  const pills = outcome.pills.map((p) => ({
    kind: p.kind, value: p.value ?? null, label: p.label ?? '', src: p.src ?? null, srcTokenId: p.srcTokenId ?? null,
    source: p.source ?? 'manual', ...(p.enabled === false ? { enabled: false } : {}), ...(p.formula ? { formula: p.formula } : {}),
    ...(p.splitBase ? { splitBase: true } : {}),
  }));
  await rebake(part, { damage: { [index]: { pills } } });
}

class ResultRollEditor extends RollEditorBase {
  constructor(part, options = {}) {
    const entry = modsOf(part).roll;
    const base = entry ? foundry.dice.Roll.fromData(entry.base) : part.rolls[0];
    const target = { name: part.actorTarget?.name ?? part.ability?.name ?? '', tokenUuid: part.tokenUuid ?? null, actorUuid: part.targetUuid ?? null };
    super(part.message, target, base, options);
    this._part = part;
    this._session = (entry?.pills ?? []).map((p) => ({ ...p }));
    this._baseOff = new Set(entry?.baseOff ?? []);
  }

  get title() {
    return L('rollTitle', { name: this._target?.name ?? '' });
  }

  _refresh() {
    super._refresh();
    this.element?.querySelector('.dsct-re-pills .dsct-pills-label')?.remove();
  }

  async _commit() {
    const eff = this._effective();
    const pills = this._session.map((p) => ({
      kind: p.kind, amount: p.amount, reason: p.reason ?? '', src: p.src ?? null, srcTokenId: p.srcTokenId ?? null,
      ...(p.source ? { source: p.source } : {}), ...(p.enabled === false ? { enabled: false } : {}),
    }));
    await rebake(this._part, { roll: { pills, baseOff: [...this._baseOff], eff } });
  }

  async _apply() {
    await this._commit();
    this.close();
  }
}

function partFor(message, target = null) {
  const parts = Array.from(message?.system?.parts?.contents ?? []).filter((p) => RESULT_TYPES.has(p.type));
  if (target == null) return parts.find((p) => p.type === 'abilityResult') ?? (parts.length === 1 ? parts[0] : null);
  if (typeof target === 'string') {
    const byId = parts.find((p) => p.id === target);
    if (byId) return byId;
  }
  const doc = typeof target === 'string' ? fromUuidSync(target, { strict: false }) : target;
  const tokenUuid = doc?.document?.uuid ?? (doc?.documentName === 'Token' ? doc.uuid : null);
  const actorUuid = doc?.documentName === 'Actor' ? doc.uuid : doc?.actor?.uuid ?? null;
  return parts.find((p) => p.type === 'targetResult'
    && ((tokenUuid && p.tokenUuid === tokenUuid) || (actorUuid && p.targetUuid === actorUuid))) ?? null;
}

const _chain = new Map();

function serial(key, fn) {
  const next = (_chain.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  _chain.set(key, next);
  next.finally(() => { if (_chain.get(key) === next) _chain.delete(key); }).catch(() => {});
  return next;
}

const sameDamagePill = (a, b) => a.kind === b.kind && (a.label ?? '') === (b.label ?? '') && (a.src ?? null) === (b.src ?? null);
const sameRollPill = (a, b) => a.kind === b.kind && (a.reason ?? '') === (b.reason ?? '') && (a.src ?? null) === (b.src ?? null);

const cleanDamagePill = (p) => ({
  kind: p.kind, value: p.value ?? null, label: p.label ?? '', src: p.src ?? null, srcTokenId: p.srcTokenId ?? null,
  source: p.source ?? 'manual', ...(p.enabled === false ? { enabled: false } : {}), ...(p.formula ? { formula: p.formula } : {}),
  ...(p.splitBase ? { splitBase: true } : {}),
});

async function addDamagePill(message, target, pill, { index = null } = {}) {
  const part = active() ? partFor(message, target) : null;
  if (!part || !pill?.kind) return false;
  const i = index ?? damageIndexes(part)[0];
  if (i == null || !isDamage(part.rolls[i])) return false;
  return serial(part.id, async () => {
    const pills = [...(modsOf(part).damage?.[i]?.pills ?? [])];
    if (pills.some((p) => sameDamagePill(p, pill) && (p.srcTokenId ?? null) === (pill.srcTokenId ?? null))) return false;
    pills.push(cleanDamagePill(pill.repeat ? { ...pill, kind: 'delta', value: damageStart(part, i) } : pill));
    await rebake(part, { damage: { [i]: { pills } } });
    return true;
  });
}

async function setDamagePillEnabled(message, target, match, enabled) {
  const part = active() ? partFor(message, target) : null;
  if (!part) return false;
  return serial(part.id, () => toggleDamage(part, match, enabled));
}

async function toggleDamage(part, match, enabled) {
  const damage = {};
  for (const [i, entry] of Object.entries(modsOf(part).damage ?? {})) {
    let hit = false;
    const pills = (entry.pills ?? []).map((p) => {
      if (p.label !== match.label || (match.src != null && p.src !== match.src) || (match.kind && p.kind !== match.kind)) return p;
      hit = true;
      const { enabled: _, ...rest } = p;
      return enabled ? rest : { ...rest, enabled: false };
    });
    if (hit) damage[i] = { pills };
  }
  if (!Object.keys(damage).length) return false;
  await rebake(part, { damage });
  return true;
}

async function addRollPill(message, target, pill) {
  const part = active() ? partFor(message, target) : null;
  if (!part || !isPower(part.rolls[0]) || !pill?.kind) return false;
  return serial(part.id, async () => {
    const editor = new ResultRollEditor(part);
    if (editor._session.some((p) => sameRollPill(p, pill))) return false;
    editor._session.push({
      kind: pill.kind, amount: Number(pill.amount) || 0, reason: pill.reason ?? '', src: pill.src ?? null,
      srcTokenId: pill.srcTokenId ?? null, source: pill.source ?? 'trigger', ...(pill.enabled === false ? { enabled: false } : {}),
    });
    await editor._commit();
    return true;
  });
}

async function setRollPillEnabled(message, target, match, enabled) {
  const part = active() ? partFor(message, target) : null;
  if (!part) return false;
  return serial(part.id, () => toggleRoll(part, match, enabled));
}

async function toggleRoll(part, match, enabled) {
  if (!modsOf(part).roll) return false;
  const editor = new ResultRollEditor(part);
  let hit = false;
  editor._session = editor._session.map((p) => {
    if (p.reason !== match.reason || (match.src != null && p.src !== match.src) || (match.kind && p.kind !== match.kind)) return p;
    hit = true;
    const { enabled: _, ...rest } = p;
    return enabled ? rest : { ...rest, enabled: false };
  });
  if (!hit) return false;
  await editor._commit();
  return true;
}

function resultPills(message, target = null) {
  const part = partFor(message, target);
  if (!part) return null;
  const mods = modsOf(part);
  return {
    partId: part.id,
    roll: (mods.roll?.pills ?? []).map((p) => ({ ...p })),
    damage: Object.fromEntries(Object.entries(mods.damage ?? {}).map(([i, e]) => [i, (e.pills ?? []).map((p) => ({ ...p }))])),
  };
}

export const resultModifiersApi = {
  active, partFor, pills: resultPills,
  addDamage: addDamagePill, setDamageEnabled: setDamagePillEnabled,
  addRoll: addRollPill, setRollEnabled: setRollPillEnabled,
};

const FM_ICON = 'fa-solid fa-person-walking-arrow-right';
const cap = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);
const fmEntry = (mods, i) => mods.forced?.[i] ?? null;
const fmStack = (mods, i) => fmEntry(mods, i)?.stack ?? [];

function fmState(base, stack) {
  const st = { ...base };
  replayModifiers([base], stack.map((e) => ({ ...e, modState: [e.modState?.[0]] })), [st]);
  return st;
}

function fmChanges(entry, base) {
  const m = entry.modState?.[0];
  if (!m) return [];
  const out = [];
  if (m.distanceDelta) out.push(L('fmDistance', { n: `${m.distanceDelta > 0 ? '+' : ''}${m.distanceDelta}` }));
  if (base && m.movement && m.movement !== base.movement) out.push(L('fmBecomes', { type: cap(m.movement) }));
  if (m.vertical && !base?.vertical) out.push(L('fmVertical'));
  if (m.ignoreStability && !base?.ignoreStability) out.push(L('fmIgnoreStability'));
  if (m.noCollisionDamage && !base?.noCollisionDamage) out.push(L('fmNoCollision'));
  if (m.fallReduction && m.fallReduction !== base?.fallReduction) out.push(L('fmFall', { n: m.fallReduction }));
  if (m.fastMove && !base?.fastMove) out.push(L('fmAuto'));
  return out;
}

function fmRow(entry, base) {
  const delta = entry.modState?.[0]?.distanceDelta ?? 0;
  const changes = fmChanges(entry, base);
  return {
    amt: delta ? `${delta > 0 ? '+' : ''}${delta}` : '',
    name: entry.noteName || changes[0] || L('sectionForced'),
    effect: changes.join(' · '),
    from: [entry.noteDesc, entry.noteSrc ? L('from', { name: entry.noteSrc }) : null].filter(Boolean).join(' · '),
  };
}

async function saveForced(part, index, base, stack) {
  const clean = stack.map((e) => ({
    modState: e.modState, noteName: e.noteName ?? '', noteDesc: e.noteDesc ?? '', noteSrc: e.noteSrc ?? null,
    srcTokenId: e.srcTokenId ?? null, ...(e.enabled === false ? { enabled: false } : {}),
  }));
  await part.message.update({ [`flags.${M}.${FLAG}.${part.id}.forced.${index}`]: { base, stack: clean } });
}

async function runForced(part, st, keywords) {
  const props = new Set([
    st.vertical ? 'vertical' : null,
    st.noCollisionDamage ? 'no-collision-damage' : null,
    st.noMoverCollisionDamage ? 'no-mover-collision-damage' : null,
    st.noObstacleCollisionDamage ? 'no-obstacle-collision-damage' : null,
    st.ignoreStability ? 'ignore-stability' : null,
    st.fastMove ? 'fast-auto-path' : null,
  ].filter(Boolean));
  const target = part.tokenUuid ? fromUuidSync(part.tokenUuid)?.object : null;
  const speaker = part.message.speaker?.token ? canvas.tokens.get(part.message.speaker.token) : null;
  const source = (st.sourceTokenId ? canvas.tokens.get(st.sourceTokenId) : null) ?? speaker ?? undefined;
  await runForcedMovement({
    movement: st.movement, distance: String(st.distance), properties: props,
    verticalDistance: st.vertical ? (st.verticalDistance !== '' ? Number(st.verticalDistance) : st.distance) : 0,
    fallReduction: st.fallReduction, target: target ?? undefined, source,
    contextMessageId: part.message.id, origin: 'powerRoll', keywords,
  });
}

function addForcedRows(part, html) {
  const sec = html.querySelector(`section[data-message-part="${part.id}"]`);
  const btns = [...(sec?.querySelectorAll('[data-dsct-action="dsct-fm"]') ?? [])];
  if (!btns.length) return;
  const mods = modsOf(part);
  const host = sec.querySelector('.message-part-rolls') ?? sec;
  const item = part.ability;
  btns.forEach((btn, index) => {
    const base = fmEntry(mods, index)?.base ?? _fmBaseStateFromBtn(btn);
    const stack = fmStack(mods, index);
    const st = fmState(base, stack);
    const keywords = item ? [...chooseKeywords(item, part.message)] : (btn.dataset.dsctKeywords ?? '').split(',').filter(Boolean);
    const enabled = stack.filter((e) => e.enabled !== false);
    const typeEntry = st.movement !== base.movement ? enabled.findLast((e) => e.modState?.[0]?.movement === st.movement) : null;
    const termTip = (e) => esc(tipHTML([[L('sectionForced'), [fmRow(e, base)]]]));
    const terms = enabled.map((e) => {
      const delta = e.modState?.[0]?.distanceDelta ?? 0;
      if (delta) return `${delta > 0 ? '+' : '-'} <span class="dsct-mod-term" data-dsct-tip="${termTip(e)}">${Math.abs(delta)}</span>`;
      const typeOnly = e === typeEntry && fmChanges(e, base).length === 1;
      return typeOnly ? null : `<span class="dsct-mod-term" data-dsct-tip="${termTip(e)}">*</span>`;
    }).filter(Boolean);
    const typeWord = cap(base.movement);
    const baseLabel = esc(_fmMakeLabel(base)).replace(typeWord,
      typeEntry ? `<span class="dsct-mod-term" data-dsct-tip="${termTip(typeEntry)}">${esc(cap(st.movement))}</span>` : typeWord);
    const row = document.createElement('div');
    row.className = 'dice-roll dsct-fm-roll';
    row.dataset.fmIndex = String(index);
    row.dataset.fmBase = JSON.stringify(base);
    row.innerHTML = `<div class="dice-flavor">${esc(L('sectionForced'))}</div><div class="dice-result"><div class="inline-result">`
      + `<div class="dice-formula">${[baseLabel, ...terms].join(' ')}</div>`
      + `<button type="button" class="dice-total dsct-fm-go" data-tooltip="${esc(`${_fmMakeLabel(st)} · ${L('fmGo')}`)}"><i class="${FM_ICON}" inert></i> ${st.distance}</button>`
      + `</div></div>`;
    for (const term of row.querySelectorAll('.dsct-mod-term')) bindTip(term, term.dataset.dsctTip);
    row.querySelector('.dsct-fm-go').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      runForced(part, st, keywords).catch((err) => console.error('DSCT | result modifiers | forced movement', err));
    });
    host.append(row);
    btn.remove();
  });
  const footer = sec.querySelector('footer.message-part-buttons');
  if (footer && !footer.querySelector('button, a')) footer.remove();
}

function forcedBases(part) {
  const mods = modsOf(part);
  const rows = [...(ui.chat?.element?.querySelectorAll(`section[data-message-part="${part.id}"] .dsct-fm-roll`) ?? [])];
  const fromDom = rows.map((row) => { try { return JSON.parse(row.dataset.fmBase); } catch { return null; } });
  const fromFlags = Object.entries(mods.forced ?? {}).map(([i, e]) => [Number(i), e.base]);
  const bases = [...fromDom];
  for (const [i, b] of fromFlags) bases[i] ??= b;
  return bases.map((b, i) => (b ? { index: i, base: b } : null)).filter(Boolean);
}

class ResultFmEditor extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    id: 'dsct-fm-editor',
    classes: ['draw-steel', 'dsct-roll-editor', 'dsct-damage-editor', 'dsct-fm-editor'],
    window: { minimizable: false, resizable: false },
    position: { width: 340, height: 'auto' },
  };

  static PARTS = {
    form: { template: `modules/${M}/templates/dstd-damage-editor.hbs` },
  };

  constructor(part, index, base, options = {}) {
    super(options);
    this._part = part;
    this._index = index;
    this._base = base;
    this._stack = foundry.utils.deepClone(fmStack(modsOf(part), index));
  }

  get title() {
    return L('fmTitle', { name: this._part.actorTarget?.name ?? this._part.ability?.name ?? '' });
  }

  async _prepareContext(_options) {
    return { base: _fmMakeLabel(this._base), hint: '', label: '' };
  }

  _onRender(_context, _options) {
    this._listenerAbort?.abort();
    this._listenerAbort = new AbortController();
    const { signal } = this._listenerAbort;
    this.element.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="cancel"]')) { this.close(); return; }
      if (event.target.closest('[data-action="apply"]')) { this._apply(); return; }
      if (event.target.closest('.dsct-add-mod-btn')) {
        getWindowById('dsct-fm-modify')?.close();
        new ResultFmAddPanel(this).render({ force: true });
        return;
      }
      const pill = event.target.closest('.dsct-fm-pill[data-pill-idx]');
      if (!pill) return;
      const entry = this._stack[Number(pill.dataset.pillIdx)];
      if (entry) entry.enabled = entry.enabled === false;
      this._refresh();
    }, { signal });
    this.element.addEventListener('contextmenu', (event) => {
      const pill = event.target.closest('.dsct-fm-pill[data-pill-idx]');
      if (!pill) return;
      event.preventDefault();
      this._stack.splice(Number(pill.dataset.pillIdx), 1);
      this._refresh();
    }, { signal });
    this._refresh();
  }

  _refresh() {
    const el = this.element;
    if (!el) return;
    const finalEl = el.querySelector('.dsct-de-final');
    if (finalEl) finalEl.textContent = _fmMakeLabel(fmState(this._base, this._stack));
    const rowEl = el.querySelector('.dsct-re-pills');
    if (rowEl) {
      const pills = this._stack.map((entry, idx) => {
        const row = fmRow(entry, this._base);
        const off = entry.enabled === false;
        const tip = tipHTML([[L('sectionForced'), [row]]]);
        return `<button type="button" class="dsct-source-pill dsct-fm-pill${off ? ' dsct-pill-disabled' : ''}" data-pill-idx="${idx}" data-tooltip="${esc(tip)}">`
          + `<span class="dsct-pip">${esc([row.amt, row.name].filter(Boolean).join(' · '))}</span></button>`;
      });
      const add = `<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" title="${esc(L('fmAdd'))}">+</button>`;
      rowEl.innerHTML = `${pills.join('')}${add}`;
    }
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }

  async _apply() {
    await saveForced(this._part, this._index, this._base, this._stack);
    this.close();
  }

  close(options) {
    this._listenerAbort?.abort();
    getWindowById('dsct-fm-modify')?.close();
    return super.close(options);
  }
}

class ResultFmAddPanel extends FmModifyPanel {
  constructor(editor) {
    const msgEl = document.createElement('div');
    msgEl.dataset.messageId = editor._part.message.id;
    super([fmState(editor._base, editor._stack)], [editor._base], editor._stack, [{ name: _fmMakeLabel(editor._base) }],
      [document.createElement('button')], _fmMakeLabel, msgEl, msgEl, () => editor._refresh());
  }
}

function addMenuEntries(part, options) {
  if (!active() || !RESULT_TYPES.has(part.type)) return;
  const mods = modsOf(part);
  const first = options.findIndex((o) => o.icon === 'fa-solid fa-dice-d6');
  for (let i = options.length - 1; i >= 0; i--) if (options[i].icon === 'fa-solid fa-dice-d6') options.splice(i, 1);
  const ours = [];
  const owner = () => part.message.isOwner;
  const fail = (err) => console.error('DSCT | result modifiers |', err);
  if (isPower(part.rolls[0])) {
    const n = live(mods.roll?.pills).length + (mods.roll?.baseOff?.length ?? 0);
    ours.push({
      label: n ? plural(n, 'modifyRollCountOne', 'modifyRollCount') : L('modifyRoll'),
      icon: 'fa-solid fa-dice-d10', visible: owner,
      onClick: () => { try { new ResultRollEditor(part).render({ force: true }); } catch (err) { fail(err); } },
    });
  }
  for (const index of damageIndexes(part)) {
    const total = part.rolls[index].total;
    const n = live(mods.damage?.[index]?.pills).length;
    ours.push({
      label: n ? plural(n, 'modifyCountOne', 'modifyCount', { total }) : L('modify', { total }),
      icon: 'fa-solid fa-dice-d6', visible: owner,
      onClick: () => openDamage(part, index).catch(fail),
    });
  }
  for (const { index, base } of forcedBases(part)) {
    const n = live(fmStack(mods, index)).length;
    ours.push({
      label: n ? plural(n, 'modifyForcedCountOne', 'modifyForcedCount') : L('modifyForced'),
      icon: FM_ICON, visible: owner,
      onClick: () => {
        try { getWindowById('dsct-fm-editor')?.close(); new ResultFmEditor(part, index, base).render({ force: true }); } catch (err) { fail(err); }
      },
    });
  }
  options.splice(first < 0 ? 0 : first, 0, ...ours);
}

const esc = (v) => foundry.utils.escapeHTML(String(v ?? ''));
const SOURCES = { trigger: 'sourceTrigger', surge: 'sourceSurge', manual: 'sourceManual' };

function fromLine(p) {
  return [p.src ? L('from', { name: p.src }) : null, SOURCES[p.source] ? L(SOURCES[p.source]) : null].filter(Boolean).join(' · ');
}

function damageRow(p, foot = null) {
  const effect = damagePillEffect(p);
  const name = (p.label ?? '').trim();
  return { amt: damagePillAmtStr(p), name: name || effect, effect: name ? effect : null, from: fromLine(p), foot };
}

function rollRow(p) {
  return { amt: rollPillAmount(p), name: (p.reason ?? '').trim() || L('sectionRoll'), from: fromLine(p) };
}

function rollRows(mods) {
  const rows = live(mods.roll?.pills).map(rollRow);
  const off = mods.roll?.baseOff?.length ?? 0;
  if (off) rows.push({ amt: '', name: plural(off, 'baseOffOne', 'baseOff'), off: true });
  return rows;
}

function tipRow(r) {
  const sub = [r.effect, r.from].filter(Boolean).map((t) => `<span class="dsct-tip-sub">${esc(t)}</span>`).join('');
  const foot = r.foot ? `<span class="dsct-tip-run">${esc(r.foot)}</span>` : '';
  return `<div class="dsct-tip-row${r.off ? ' is-off' : ''}"><span class="dsct-tip-amt">${esc(r.amt)}</span>`
    + `<span class="dsct-tip-body"><span class="dsct-tip-name">${esc(r.name)}</span>${sub}</span>${foot}</div>`;
}

function tipHTML(sections, formula = null) {
  const head = formula ? `<div class="dsct-tip-formula">${esc(formula)}</div>` : '';
  const body = sections.map(([title, rows]) => `<div class="dsct-tip-title">${esc(title)}</div>${rows.map(tipRow).join('')}`).join('');
  return `<div class="dsct-tip">${head}${body}</div>`;
}

function bindTip(el, html) {
  el.dataset.dsctTip = html;
  el.addEventListener('pointerenter', () => {
    game.tooltip.activate(el, { html, direction: 'LEFT' });
    const tip = game.tooltip.tooltip;
    const card = el.closest('.chat-message');
    if (!tip || !card) return;
    requestAnimationFrame(() => {
      const left = card.getBoundingClientRect().left - tip.offsetWidth - 10;
      if (left >= 8) tip.style.left = `${left}px`;
    });
  });
  el.addEventListener('pointerleave', () => game.tooltip.deactivate());
}

function modifierSections(part) {
  const mods = modsOf(part);
  const damage = damageIndexes(part).flatMap((i) => live(mods.damage?.[i]?.pills).map((p) => damageRow(p)));
  const forced = Object.values(mods.forced ?? {}).flatMap((f) => live(f.stack).map((e) => fmRow(e, f.base)));
  return [[L('sectionRoll'), rollRows(mods)], [L('sectionDamage'), damage], [L('sectionForced'), forced]].filter(([, rows]) => rows.length);
}

function fixRollTier(part, html) {
  const roll = part.rolls[0];
  const autos = new Set(modsOf(part).roll?.eff?.tierMods?.auto ?? []);
  const automatic = autos.size === 1;
  if (!isPower(roll) || !part.tier || (roll.product === part.tier && !automatic)) return;
  const tierEl = html.querySelector(`section[data-message-part="${part.id}"] .power-result .tier`);
  if (!tierEl) return;
  const key = `tier${part.tier}`;
  const note = automatic ? `<em>(${esc(L('automatic'))})</em>` : (tierEl.querySelector('em')?.outerHTML ?? '');
  tierEl.classList.remove('tier1', 'tier2', 'tier3');
  tierEl.classList.add(key);
  tierEl.innerHTML = `${esc(game.i18n.localize(ds.rolls.PowerRoll.RESULT_TIERS[key]?.label ?? key))} ${note}`;
}

function addRollTooltip(part, html) {
  const rows = rollRows(modsOf(part));
  if (!rows.length) return;
  const result = html.querySelector(`section[data-message-part="${part.id}"] .dice-roll .power-result`)?.closest('.dice-result');
  if (!result) return;
  const formula = result.dataset.tooltipText ?? part.rolls[0]?.formula ?? '';
  delete result.dataset.tooltipText;
  bindTip(result, tipHTML([[L('rollModifiers'), rows]], formula));
}

function addDamageTerms(part, html) {
  const mods = modsOf(part);
  const rollEls = html.querySelectorAll(`section[data-message-part="${part.id}"] .message-part-rolls > .dice-roll`);
  for (const index of damageIndexes(part)) {
    const entry = mods.damage?.[index];
    const formulaEl = rollEls[index]?.querySelector('.dice-formula');
    if (!entry || !formulaEl) continue;
    if (entry.steps?.length) {
      const base = foundry.dice.Roll.fromData(damageBaseData(entry, part.tier)).formula;
      const terms = entry.steps.map((step) => {
        const tip = tipHTML([[L('sectionDamage'), [damageRow(step.pill, `${step.before} → ${step.after}`)]]]);
        return `${step.delta >= 0 ? '+' : '-'} <span class="dsct-mod-term" data-dsct-tip="${esc(tip)}">${Math.abs(step.delta)}</span>`;
      });
      formulaEl.innerHTML = [esc(base), ...terms].join(' ');
    }
    const typePill = damagePillDisplayList(entry.pills).filter((x) => !x.inert && x.pill.enabled !== false && x.pill.kind === 'type').at(-1)?.pill;
    if (typePill && !formulaEl.querySelector('.dsct-dmg-type')) {
      const type = typePill.value ?? '';
      const word = document.createElement('span');
      word.className = 'dsct-mod-term dsct-dmg-type';
      word.textContent = damageTypeLabel(type);
      word.dataset.dsctTip = tipHTML([[L('sectionDamage'), [damageRow(typePill)]]]);
      formulaEl.prepend(word, ' ');
      const icon = rollEls[index]?.querySelector('.apply-damage i');
      const iconType = DAMAGE_TYPES[type] ? type : 'untyped';
      if (icon && DAMAGE_TYPES[iconType]) icon.className = `${DAMAGE_TYPES[iconType].icon} ctlib-dmg ctlib-dmg-${iconType}`;
    }
    for (const term of formulaEl.querySelectorAll('.dsct-mod-term')) bindTip(term, term.dataset.dsctTip);
  }
}

function addBadges(message, html) {
  if (!active()) return;
  for (const part of message.system?.parts?.contents ?? []) {
    if (!RESULT_TYPES.has(part.type)) continue;
    fixRollTier(part, html);
    addRollTooltip(part, html);
    addDamageTerms(part, html);
    addForcedRows(part, html);
  }
  if (!getSetting('modifierBadge')) return;
  for (const part of message.system?.parts?.contents ?? []) {
    if (!RESULT_TYPES.has(part.type)) continue;
    const sections = modifierSections(part);
    if (!sections.length) continue;
    const header = html.querySelector(`section[data-message-part="${part.id}"] .message-part-header`);
    if (!header || header.querySelector('.dsct-mod-cog')) continue;
    const badge = document.createElement('a');
    badge.className = 'dsct-mod-cog fa-fw fa-solid fa-gear';
    badge.setAttribute('aria-label', L('cogLabel'));
    bindTip(badge, tipHTML(sections));
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const dots = header.querySelector('[data-action="resultPartContext"]');
      const box = dots?.getBoundingClientRect();
      dots?.dispatchEvent(new PointerEvent('click', { bubbles: true, clientX: box?.x ?? 0, clientY: box?.y ?? 0 }));
    });
    const name = header.querySelector('.targetName');
    if (name) { name.classList.add('dsct-modified'); name.append(badge); }
    else { header.classList.add('dsct-modified'); header.append(badge); }
  }
}

export function registerResultModifiers() {
  Hooks.on(RESULT_MENU, addMenuEntries);
  Hooks.on('renderChatMessageHTML', addBadges);
}
