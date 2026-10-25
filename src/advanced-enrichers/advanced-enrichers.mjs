import { getSetting, applyDamage, undoDamage, getSquadGroup, safeDelete } from '../helpers.mjs';
import { DSTD, DSTD_PANEL, DSTD_ROW, isPrimaryGM, safeUpdate, dropKey, dropKeyOverSocket, faceFromToken, faceChainHTML, activateFaces, services, registerPanelDecorator, damageTypeIconHTML, resourceTokenHTML } from '../ctlib.mjs';
import { damageSignature, healSignature, gainSignature, applySignature, derivedSignatures } from './mirror.mjs';
import { richTip, setTip, tipFor } from '../chat-tips.mjs';
import { _repickForMessage, _spendSourceResource, _areaOrigin, _othersCandidates } from '../compat/dstd-compat.mjs';
import { potencyVerdict, pillMods, applyEffectMods } from '../compat/dstd-potency.mjs';
import { foldDamagePills, damagePillType, damagePillText } from '../compat/dstd-damage-pills.mjs';
import { pillAmountLabel, pillCss as effectPillCss } from '../ability-automation/roll-dialog-hooks.mjs';
import { replayModifiers, _modEffectSummary } from '../forced-movement/forced-movement-modify-panel.mjs';
import { hasRecurring } from '../conditions/recurring-damage.mjs';
import { TargetTabsDamageEditor, TargetTabsModEditor, KindPillDialog, EnricherEffectModDialog, EnricherFmPanel } from './mod-editors.mjs';
import { runMultiTokenPicker } from '../ability-automation/target-picker.mjs';
import { applyLinkTo } from '../conditions/apply-to-targets.mjs';
import { runForcedMovement } from '../forced-movement/forced-movement-engine.mjs';
import { triggerRollData, modifyAttributeSafely, grantTempStamina, othersSpec, runTeleportEffect, partnerFilter } from '../ability-automation/flat-special-effects.mjs';
import { FORCED_ICONS, teleportOptions, teleportToken, cleanseSpec, cleanseActor, cleanseMatches, restoreCleansed, registerCtEnrichers } from './ct-enrichers.mjs';
import { registerFlatEnrichers } from './flat-enrichers.mjs';
import { resolveTokenRefs } from './refs.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'adv';
const L = (k, data) => data ? game.i18n.format(`DSCT.advEnricher.${k}`, data) : game.i18n.localize(`DSCT.advEnricher.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

export const advancedEnrichersOn = () => getSetting('advancedEnrichers') !== false;

const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const tk = (uuid) => uuid.replace(/\./g, '__');

const linkOf = (ec) => ec.querySelector(':scope > a.roll-link, :scope > a.roll-link-group, :scope > a');
const signature = (ec) => {
  const d = linkOf(ec)?.dataset ?? {};
  return [ec.getAttribute('enricher'), d.type, d.rollType, d.formulas, d.damageTypes, d.formula, d.gainType, d.status, d.uuid].join('|');
};

const keyFor = (root, ec) => {
  const sig = signature(ec);
  const same = [...root.querySelectorAll(`enriched-content[enricher="${ec.getAttribute('enricher')}"]`)]
    .filter((x) => !x.closest(DSTD_PANEL) && signature(x) === sig);
  return `${hash(sig)}-${Math.max(0, same.indexOf(ec))}`;
};

const stateOf = (message, key) => message?.flags?.[M]?.[FLAG]?.[key] ?? {};

const write = (message, key, data) => safeUpdate(message, Object.fromEntries(
  Object.entries(data).map(([k, v]) => [`flags.${M}.${FLAG}.${key}.${k}`, v])));

const drop = (message) => (message.isOwner ? dropKey() : dropKeyOverSocket());

const canAct = (message) => game.user.isGM || message.isOwner || message.author?.id === game.user.id;

const speakerDoc = (message) => {
  const s = message.speaker ?? {};
  const scene = game.scenes.get(s.scene) ?? canvas.scene;
  return (s.token ? scene?.tokens.get(s.token) : null)
    ?? ChatMessage.getSpeakerActor(s)?.getActiveTokens?.(false, true)?.[0] ?? null;
};

const abilityOf = (message) => {
  const parts = message.system?.parts;
  const list = parts?.contents ?? (parts ? [...parts] : []);
  const uuid = list.find((p) => p?.abilityUuid)?.abilityUuid ?? message.flags?.[DSTD]?.state?.abilityUuid;
  return uuid ? fromUuidSync(uuid) : null;
};

const sentenceBefore = (ec) => {
  const block = ec.closest('p, li, dd, td') ?? ec.parentElement;
  if (!block) return '';
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEndBefore(ec);
  return range.toString().split(/[.!?;:]\s/).pop();
};

const OTHERS = /\b(targets?|them|they|their|creatures?|enem(?:y|ies)|all(?:y|ies)|each|any|it)\b/i;

const meansSpeaker = (ec) => {
  const before = sentenceBefore(ec);
  return /\b(you|yourself)\b/i.test(before) && !OTHERS.test(before);
};

const sourceConfig = (a) => {
  const parse = ds.applications?.ux?.helpers?.parseConfig;
  if (!parse || a?.dataset.dsctSource == null) return {};
  return parse(a.dataset.dsctSource, { multiple: true })[0] ?? {};
};

const flatTargets = (message) => (message.flags?.[DSTD]?.state?.targets ?? []).map((t) => t.tokenUuid).filter(Boolean);

const presetSource = (a) => {
  const raw = sourceConfig(a).source ?? a?.dataset.source;
  return raw == null || raw === '' ? null : String(raw);
};

const relativeRefs = (message, a) => ({
  owner: () => [speakerDoc(message)],
  self: () => [speakerDoc(message)],
  targets: () => flatTargets(message).map((u) => fromUuidSync(u)),
  ...(a ? { source: () => [sourceDoc(message, a)] } : {}),
});

const sourceDoc = (message, a) => {
  const raw = presetSource(a);
  return (raw && resolveTokenRefs(raw, { message, relative: relativeRefs(message, null) })[0]) || speakerDoc(message);
};

const flatEffectOf = (message, a) => {
  const id = sourceConfig(a).flat;
  return id ? (abilityOf(message)?.system?.effects?.get?.(String(id)) ?? null) : null;
};

const othersOf = (message, a) => {
  const effect = flatEffectOf(message, a);
  const spec = effect ? othersSpec(effect) : null;
  if (!spec) return null;
  const ctx = {
    sourceToken: sourceDoc(message, a)?.object ?? null,
    targetTokens: flatTargets(message).map((u) => fromUuidSync(u)?.object).filter(Boolean),
    ability: abilityOf(message),
  };
  const candidates = () => _othersCandidates(spec, ctx);
  return { spec, effect, candidates, live: () => (spec.mode === 'pick' ? [] : candidates().map((t) => t.document.uuid)) };
};

const speakerTargets = (message, a) => {
  const doc = sourceDoc(message, a);
  return doc ? [doc.uuid] : [];
};

const targetsOf = (message, st, ec, kind) => {
  if (Array.isArray(st.targets)) return st.targets;
  const a = linkOf(ec);
  const cfg = sourceConfig(a);
  if (cfg.targets != null && cfg.targets !== '') {
    return resolveTokenRefs(cfg.targets, { message, relative: relativeRefs(message, a) }).map((d) => d.uuid);
  }
  if (cfg.recipient === 'self') return speakerTargets(message, a);
  if (cfg.recipient === 'target') return flatTargets(message);
  if (cfg.recipient === 'others') return othersOf(message, a)?.live() ?? [];
  if (kind.recipient === 'speaker' ? !OTHERS.test(sentenceBefore(ec)) : meansSpeaker(ec)) return speakerTargets(message, a);
  return flatTargets(message);
};

const titleCase = (text) => text.replace(/(^|[\s(/-])(\p{Ll})/gu, (_, pre, ch) => pre + ch.toUpperCase());
const signed = (n) => (n > 0 ? `+${n}` : String(n));

const titleCaseText = (root) => {
  for (const n of root.childNodes) if (n.nodeType === Node.TEXT_NODE) n.nodeValue = titleCase(n.nodeValue);
};
const damageTypeName = (type) => type ? game.i18n.localize(ds.CONFIG.damageTypes[type]?.label ?? type) : L('untyped');

const DIE_FACES = new Set([4, 6, 8, 10, 12, 20]);

const diceBrackets = (term) => {
  const shape = DIE_FACES.has(term.faces) ? ` dsct-adv-d${term.faces}` : '';
  const dice = term.results.filter((r) => r.active !== false)
    .map((r) => `<span class="dsct-adv-die${shape}" aria-label="${esc(L('dieLabel', { faces: term.faces, n: r.result }))}">${r.result}</span>`);
  return `<span class="dsct-adv-dice">[${dice.join('')}]</span>`;
};

const SOURCE_SKIP = new Set(['scaling', 'aoe', 'heal', 'healing', 'temp', 'temphp', 'value', 'temporary',
  'vertical', 'ignorestability', 'nocollision', 'fast', 'swap', 'teleswap', 'adjacent', 'true', 'false']);
const GAIN_TYPES = new Set(['epic', 'heroic', 'renown', 'surge', 'victory', 'wealth', 'hr', 'victories', 'surges']);

const sourceFormula = (a) => {
  const parse = ds.applications?.ux?.helpers?.parseConfig;
  if (a.dataset.dsctSource == null || !parse) return null;
  const c = parse(a.dataset.dsctSource, { multiple: true })[0];
  if (!c) return null;
  const parts = c.formula ? [String(c.formula)] : [];
  for (const value of c.values) {
    const lower = value.toLowerCase();
    if (lower in ds.CONFIG.damageTypes || lower in (ds.CONFIG.healingTypes ?? {}) || SOURCE_SKIP.has(lower) || GAIN_TYPES.has(lower)) continue;
    if (value.startsWith('#') || !/^[\d@(+\-*/)]/.test(value)) continue;
    parts.push(value);
  }
  return parts.join(' ');
};

const REF_LABELS = {
  chr: 'srcChr', level: 'srcLevel', echelon: 'srcEchelon', 'recoveries.recoveryValue': 'srcRecoveryValue', scaling: 'srcScaling',
  triggerDamage: 'srcTriggerDamage', dealt: 'srcDealt', spend: 'srcSpend', triggerLevel: 'srcTriggerLevel',
};

const refLabel = (ref) => {
  const bare = ref.replace(/^characteristics\./, '').replace(/\.value$/, '');
  const ch = Object.values(ds.CONFIG.characteristics).find((c) => c.rollKey === ref) ?? ds.CONFIG.characteristics[bare];
  if (ch) return game.i18n.localize(ch.label);
  if (REF_LABELS[ref]) return L(REF_LABELS[ref]);
  const last = ref.split('.').filter((s) => s !== 'value').pop() ?? ref;
  return titleCase(last.replace(/([a-z])([A-Z])/g, '$1 $2'));
};

const rollDataFor = (message, a) => {
  const preset = a && presetSource(a) ? sourceDoc(message, a)?.actor?.getRollData?.() : null;
  const base = preset ?? abilityOf(message)?.getRollData?.() ?? ChatMessage.getSpeakerActor(message.speaker)?.getRollData?.() ?? {};
  const spent = Number(String(message.flavor ?? '').match(/^Spent (\d+)/i)?.[1]);
  return { ...base, ...triggerRollData(message), ...(Number.isFinite(spent) ? { spend: spent } : {}) };
};

const prettyOps = (text) => esc(text).replace(/\s*\*\s*/g, ' × ').replace(/\s*\/\s*/g, ' ÷ ').replace(/\s*\+\s*/g, ' + ').replace(/\s*-\s*/g, ' − ');

const breakdownHTML = (a, st, message) => {
  const total = st.totals?.[0];
  if (total == null) return '';
  const json = st.rolls?.[0];
  const raw = (sourceFormula(a) ?? json?.formula ?? String(total)).trim();
  let dice = [];
  try { dice = json ? Roll.fromData(json).dice : []; } catch { dice = []; }
  const rollData = rollDataFor(message, a);
  const out = [];
  let last = 0;
  let di = 0;
  let sourced = false;
  for (const m of raw.matchAll(/(\d*)d(\d+)|@([\w.]+)/gi)) {
    out.push(prettyOps(raw.slice(last, m.index)));
    last = m.index + m[0].length;
    sourced = true;
    if (m[3]) {
      out.push(`${esc(ds.rolls.DSRoll.replaceFormulaData(`@${m[3]}`, rollData))} <span class="dsct-adv-src">[${esc(refLabel(m[3]))}]</span>`);
      continue;
    }
    const term = dice[di++];
    out.push(term ? `${term.total} ${diceBrackets(term)}` : esc(m[0]));
  }
  out.push(prettyOps(raw.slice(last)));
  const expr = out.join('').trim();
  if (!sourced && expr === String(total)) return '';
  if (/^\d*d\d+$/i.test(raw)) return expr;
  return `${expr} = <strong>${total}</strong>`;
};

const damagePrep = (a) => {
  const formulas = a.dataset.formulas?.split('&') ?? [];
  const types = a.dataset.damageTypes?.split('&') ?? [];
  const ignored = (a.dataset.ignoredImmunities ?? '').split('|').filter(Boolean);
  return formulas.map((formula, i) => ({ formula, types: types[i]?.split('|').filter(Boolean) ?? [], ignored, aoe: !!a.dataset.aoe }));
};

const sourceLabel = (message) => abilityOf(message)?.name ?? message.speaker?.alias ?? null;

const staminaRecord = (prev) => ({
  prevValue: prev.prevValue, prevTemp: prev.prevTemp,
  prevSquadHP: prev.prevSquadHP ?? null, squadGroupUuid: prev.squadGroup?.uuid ?? prev.squadGroupUuid ?? null,
});

const undoStamina = async (doc, rec) => {
  const squadGroup = rec.squadGroupUuid ? await fromUuid(rec.squadGroupUuid).catch(() => null) : null;
  await undoDamage(doc.actor, { prevTemp: rec.prevTemp, prevValue: rec.prevValue, prevSquadHP: rec.prevSquadHP, squadGroup });
};

const DAMAGE = {
  id: 'damage',
  modifiable: true,
  recipient: 'targets',
  chipIcon: 'fa-dice-d10',
  test: (ec, a) => ec.getAttribute('enricher') === 'ds.roll' && a?.dataset.type === 'damageHeal' && a.dataset.rollType === 'damage',
  single: (a) => damagePrep(a).length === 1,
  signature: (a) => damageSignature(a.dataset.formulas, a.dataset.damageTypes?.split('|')),
  rolls: (a, data) => damagePrep(a).map((p) => new ds.rolls.DamageRoll(p.formula, data,
    { type: p.types[0], types: p.types, isHeal: false, ignoredImmunities: p.ignored, aoe: p.aoe })),
  messageTitle: 'DRAW_STEEL.EDITOR.Enrichers.DamageHeal.MessageTitle.damage',
  typeChoices: (a) => damagePrep(a)[0]?.types ?? [],
  result(st, a, doc) {
    const prep = damagePrep(a)[0];
    const base = st.totals?.[0];
    if (base == null || !prep) return null;
    const pills = st.mods?.[tk(doc.uuid)] ?? [];
    const raw = foldDamagePills(base, pills);
    const type = damagePillType(pills) ?? st.typeChoice ?? prep.types[0] ?? '';
    const actor = doc.actor;
    const squad = actor ? getSquadGroup(actor) : null;
    const { immunity = 0, weakness = 0 } = actor?.system?.calculateImmunityAndWeakness?.({ type, ignoredImmunities: prep.ignored }) ?? {};
    const capped = prep.aoe && squad ? Math.min(raw, actor.system.stamina.max ?? raw) : raw;
    return { base, raw, amount: Math.max(0, capped + weakness - immunity), type, weakness, immunity, pills };
  },
  lead: (r, applied) => L(applied ? 'faceApplied' : 'faceAmount', { n: applied?.amount ?? r.amount, type: damageTypeName(r.type) }),
  steps(r) {
    const steps = [];
    for (const p of r.pills) {
      if (p.enabled === false) continue;
      steps.push(`<li>${esc(damagePillText(p))}${p.src ? ` <em>${esc(L('stepFrom', { src: p.src }))}</em>` : ''}</li>`);
    }
    if (r.weakness) steps.push(`<li>${esc(L('stepWeakness', { n: signed(r.weakness), type: damageTypeName(r.type) }))}</li>`);
    if (r.immunity) steps.push(`<li>${esc(L('stepImmunity', { n: signed(-r.immunity), type: damageTypeName(r.type) }))}</li>`);
    return steps;
  },
  notes(r) {
    const lines = r.pills.filter((p) => p.enabled !== false).map(damagePillText);
    if (r.weakness) lines.push(L('weakness', { n: r.weakness }));
    if (r.immunity) lines.push(L('immunity', { n: r.immunity }));
    return lines;
  },
  async applyMany(ctx, docs) {
    const prep = damagePrep(ctx.a);
    const out = {};
    for (const doc of docs) {
      const r = this.result(ctx.st, ctx.a, doc, ctx.message);
      if (!r) continue;
      const ignoreImmunity = r.pills.length === 0 && (prep[0].ignored.includes('all') || prep[0].ignored.includes(r.type));
      const prev = await applyDamage(doc.actor, r.raw, undefined,
        { damageType: r.type || 'untyped', ignoreImmunity, isArea: prep[0].aoe, source: sourceLabel(ctx.message) });
      for (let i = 1; i < prep.length; i++) {
        const extra = ctx.st.totals?.[i];
        if (extra) await applyDamage(doc.actor, extra, undefined, { damageType: prep[i].types[0] || 'untyped', isArea: prep[i].aoe, source: sourceLabel(ctx.message) });
      }
      out[doc.uuid] = { amount: r.amount, ...staminaRecord(prev) };
    }
    return out;
  },
  undo: undoStamina,
};

const isMinionInSquad = (actor) => !!actor?.isMinion && !!actor.system?.combatGroup && !(actor.system.combatGroups?.size > 1);
const recoveriesOf = (actor) => actor?.system?.recoveries?.value ?? 0;
const casterActor = (message, a) => (a && presetSource(a) ? sourceDoc(message, a)?.actor : null)
  ?? abilityOf(message)?.actor ?? ChatMessage.getSpeakerActor(message.speaker) ?? null;

const pillsOf = (st, doc) => st.mods?.[tk(doc.uuid)] ?? [];
const livePills = (st, doc) => pillsOf(st, doc).filter((p) => p.enabled !== false);

const foldAmount = (base, pills) => {
  let n = base;
  for (const p of pills) if (p.kind === 'amount') n += Number(p.amount) || 0;
  for (const p of pills) if (p.kind === 'mult') n *= Number(p.amount) || 1;
  return Math.max(0, Math.floor(n));
};

const amountPillText = (unit) => (p) => (p.kind === 'mult'
  ? L(Number(p.amount) < 1 ? 'mods.halved' : 'mods.doubled')
  : `${signed(Number(p.amount) || 0)} ${unit}`);
const amountPillCss = (p) => ((p.kind === 'mult' ? Number(p.amount) >= 1 : Number(p.amount) >= 0) ? 'edge' : 'bane');

const amountMods = (unitOf) => (ctx, title) => ({
  pillText: amountPillText(unitOf(ctx.a)),
  pillCss: amountPillCss,
  openAdd: (editor) => new KindPillDialog({
    title,
    buttons: [
      { kind: 'amount', amount: 1, css: 'edge', label: L('mods.raise') },
      { kind: 'amount', amount: -1, css: 'bane', label: L('mods.lower') },
      { kind: 'mult', amount: 2, css: 'edge', label: L('mods.double') },
      { kind: 'mult', amount: 0.5, css: 'bane', label: L('mods.halve') },
    ],
    valued: ['amount'],
    pillText: amountPillText(unitOf(ctx.a)),
    pillCss: amountPillCss,
    onPill: (p) => editor.addPill(p),
  }).render(true),
});

const tempStackKey = (message, a) => (sourceConfig(a).tempStack === true ? (abilityOf(message)?.name ?? null) : null);

const HEAL = {
  id: 'heal',
  modifiable: true,
  mods: amountMods(() => L('mods.unitHeal')),
  recipient: 'targets',
  chipIcon: 'fa-dice-d10',
  test: (ec, a) => ec.getAttribute('enricher') === 'ds.roll' && a?.dataset.type === 'damageHeal' && a.dataset.rollType === 'healing',
  single: (a) => damagePrep(a).length === 1,
  signature: (a) => healSignature(a.dataset.formulas, (a.dataset.damageTypes ?? '') !== 'value' && !!a.dataset.damageTypes),
  rolls: (a, data) => damagePrep(a).map((p) => new ds.rolls.DamageRoll(p.formula, data, { type: p.types[0] ?? 'value', types: p.types, isHeal: true })),
  messageTitle: 'DRAW_STEEL.EDITOR.Enrichers.DamageHeal.MessageTitle.healing',
  typeChoices: () => [],
  
  
  result(st, a, doc, message) {
    const cfg = sourceConfig(a);
    const caster = message ? casterActor(message, a) : null;
    const valueFrom = cfg.value === 'target' ? doc.actor : (cfg.value === 'self' ? caster : null);
    const base = valueFrom ? (valueFrom.system?.recoveries?.recoveryValue ?? 0) : st.totals?.[0];
    if (base == null) return null;
    const temporary = (damagePrep(a)[0]?.types[0] ?? 'value') !== 'value';
    const actor = doc.actor;
    const spender = cfg.recovery === 'target' ? actor : (cfg.recovery === 'self' ? caster : null);
    const pills = livePills(st, doc);
    const amount = foldAmount(base, pills);
    const out = { base, amount, temporary, spender: spender?.name ?? null, valueFrom: valueFrom?.name ?? null,
      modLines: pills.map(amountPillText(L('mods.unitHeal'))) };
    if (isMinionInSquad(actor)) return { ...out, amount: 0, blocked: 'minion' };
    if (spender && recoveriesOf(spender) < 1) return { ...out, amount: 0, blocked: 'noRecoveries' };
    const temp = actor?.system?.stamina?.temporary ?? 0;
    const key = temporary && message ? tempStackKey(message, a) : null;
    const held = actor?.getFlag?.(M, 'tempFrom');
    const stacks = !!key && held?.key === key && held.total === temp;
    if (temporary && !stacks && amount < temp) return { ...out, amount: 0, blocked: 'tempCapped' };
    return stacks ? { ...out, stacks: true } : out;
  },
  lead: (r, applied) => L(r.temporary ? (applied ? 'healTempApplied' : 'healTemp') : (applied ? 'healApplied' : 'healAmount'), { n: applied?.amount ?? r.amount }),
  
  valueAfter: (a) => !!sourceConfig(a).recovery,
  steps(r) {
    const steps = [];
    if (r.valueFrom) steps.push(`<li>${esc(L('stepRecoveryValue', { name: r.valueFrom }))}</li>`);
    if (r.spender) steps.push(`<li>${esc(L('stepSpendsRecovery', { name: r.spender }))}</li>`);
    if (r.blocked) steps.push(`<li>${esc(L(HEAL_BLOCKS[r.blocked], { name: r.spender ?? '' }))}</li>`);
    return steps;
  },
  notes: (r) => (r.blocked ? [L(HEAL_BLOCKS[r.blocked], { name: r.spender ?? '' })] : (r.spender ? [L('noteRecovery', { name: r.spender })] : [])),
  async applyMany(ctx, docs) {
    const cfg = sourceConfig(ctx.a);
    const caster = casterActor(ctx.message, ctx.a);
    const out = {};
    for (const doc of docs) {
      const r = this.result(ctx.st, ctx.a, doc, ctx.message);
      if (!r || r.blocked) continue;
      const actor = doc.actor;
      const prev = { prevValue: actor.system.stamina.value, prevTemp: actor.system.stamina.temporary };
      const tempFrom = r.temporary ? (actor.getFlag(M, 'tempFrom') ?? null) : undefined;
      let recovery = null;
      if (cfg.recovery === 'target' || cfg.recovery === 'self') {
        const spender = cfg.recovery === 'target' ? actor : caster;
        if (!spender || recoveriesOf(spender) < 1) continue;
        await safeUpdate(spender, { 'system.recoveries.value': recoveriesOf(spender) - 1 });
        recovery = spender.uuid;
      }
      if (r.temporary) await grantTempStamina(actor, r.amount, tempStackKey(ctx.message, ctx.a));
      else await modifyAttributeSafely(actor, 'stamina', r.amount, true);
      out[doc.uuid] = { amount: r.amount, ...staminaRecord(prev), recovery, ...(tempFrom !== undefined ? { tempFrom } : {}) };
    }
    return out;
  },
  async undo(doc, rec) {
    await undoStamina(doc, rec);
    if ('tempFrom' in rec) await safeUpdate(doc.actor, { [`flags.${M}.tempFrom`]: rec.tempFrom });
    const spender = rec.recovery ? await fromUuid(rec.recovery).catch(() => null) : null;
    if (spender) await safeUpdate(spender, { 'system.recoveries.value': recoveriesOf(spender) + 1 });
  },
};

const HEAL_BLOCKS = { minion: 'healMinion', tempCapped: 'healTempCapped', noRecoveries: 'healNoRecoveries' };

const GAIN_RESOURCES = {
  heroic: 'hero.primary.value', epic: 'hero.epic.value', renown: 'hero.renown',
  surge: 'hero.surges', victory: 'hero.victories', wealth: 'hero.wealth',
};
const GAIN_LABELS = {
  heroic: 'DRAW_STEEL.Actor.hero.FIELDS.hero.primary.value.label', epic: 'DRAW_STEEL.Actor.hero.FIELDS.hero.epic.value.label',
  renown: 'DRAW_STEEL.Actor.hero.FIELDS.hero.renown.label', surge: 'DRAW_STEEL.Actor.hero.FIELDS.hero.surges.label',
  victory: 'DRAW_STEEL.Actor.hero.FIELDS.hero.victories.label', wealth: 'DRAW_STEEL.Actor.hero.FIELDS.hero.wealth.label',
};

const gainLabel = (a) => game.i18n.localize(GAIN_LABELS[a.dataset.gainType] ?? a.dataset.gainType);

const GAIN = {
  id: 'gain',
  modifiable: true,
  mods: amountMods(gainLabel),
  recipient: 'speaker',
  chipIcon: 'fa-bolt',
  test: (ec, a) => ec.getAttribute('enricher') === 'ds.roll' && a?.dataset.type === 'gain',
  single: () => true,
  signature: (a) => gainSignature(a.dataset.gainType, a.dataset.formula),
  rolls: (a, data) => [new ds.rolls.DSRoll(a.dataset.formula, data)],
  messageTitle: null,
  typeChoices: () => [],
  result(st, a, doc) {
    const base = st.totals?.[0];
    if (base == null) return null;
    const label = gainLabel(a);
    const pills = livePills(st, doc);
    const modLines = pills.map(amountPillText(label));
    if (doc.actor?.type !== 'hero') return { base, amount: 0, label, modLines, blocked: 'notHero' };
    return { base, amount: foldAmount(base, pills), label, modLines };
  },
  lead: (r, applied) => L(applied ? 'gainApplied' : 'gainAmount', { n: applied?.amount ?? r.amount, type: r.label }),
  steps: (r) => (r.blocked ? [`<li>${esc(L('gainNotHero'))}</li>`] : []),
  notes: (r) => (r.blocked ? [L('gainNotHero')] : []),
  async applyMany(ctx, docs) {
    const path = GAIN_RESOURCES[ctx.a.dataset.gainType];
    const out = {};
    if (!path) return out;
    for (const doc of docs) {
      const r = this.result(ctx.st, ctx.a, doc, ctx.message);
      if (!r || r.blocked) continue;
      await modifyAttributeSafely(doc.actor, path, r.amount, true, false);
      out[doc.uuid] = { amount: r.amount, path };
    }
    return out;
  },
  async undo(doc, rec) {
    await modifyAttributeSafely(doc.actor, rec.path, -rec.amount, true, false);
  },
};

const potencyOf = (a, message) => {
  const raw = sourceConfig(a).potency;
  if (!raw) return null;
  const [chr, strength] = String(raw).split(':');
  const characteristic = ds.CONFIG.characteristics[chr?.toLowerCase()] ? chr.toLowerCase()
    : Object.entries(ds.CONFIG.characteristics).find(([, c]) => c.rollKey === chr?.toUpperCase())?.[0];
  if (!characteristic) return null;
  const caster = casterActor(message, a);
  let value = caster?.system?.potency?.[strength];
  if (value == null) {
    try { value = Number(ds.utils.evaluateFormula(String(strength), rollDataFor(message, a))); } catch { value = NaN; }
  }
  return Number.isFinite(Number(value)) ? { characteristic, value: Number(value) } : null;
};

const linkLabel = (a) => a.dataset.dsctLabel ?? a.textContent.trim();
const appliedEffectDoc = (a) => (a.dataset.uuid ? fromUuidSync(a.dataset.uuid) : null);

const APPLY = {
  id: 'apply',
  modifiable: true,
  mods: (ctx) => ({
    pillText: pillAmountLabel,
    pillCss: effectPillCss,
    openAdd: (editor) => new EnricherEffectModDialog({
      name: linkLabel(ctx.a), hasPotency: !!potencyOf(ctx.a, ctx.message), hasRecurring: hasRecurring(appliedEffectDoc(ctx.a)),
      onPill: (p) => editor.addPill(p),
    }).render(true),
  }),
  shown(r) {
    if (r.blocked) return L('resisted');
    const end = r.mods.end ? pillAmountLabel({ kind: 'effectEnd', end: r.mods.end }).replace(/^[^:]*:\s*/, '') : null;
    const parts = [end, r.mods.saveMod ? pillAmountLabel({ kind: 'saveMod', amount: r.mods.saveMod }) : null].filter(Boolean);
    return parts.length ? `${r.label} (${parts.join(', ')})` : r.label;
  },
  recipient: 'targets',
  chipIcon: null,
  rolls: null,
  test: (ec, a) => ec.getAttribute('enricher') === 'ds.apply' && !!a,
  single: () => true,
  signature: (a) => (a.dataset.status ? applySignature(a.dataset.status) : null),
  typeChoices: () => [],
  result(st, a, doc, message) {
    const pills = livePills(st, doc);
    const mods = pillMods(pills.map((p) => ({ p })));
    const out = { label: linkLabel(a), mods, modLines: pills.map(pillAmountLabel) };
    const p = message && doc?.actor ? potencyOf(a, message) : null;
    const verdict = p ? potencyVerdict({ actor: doc.actor, characteristic: p.characteristic, value: p.value, shift: mods.shift, force: mods.force, resistWith: mods.resistWith }) : null;
    if (!verdict) return mods.force != null && mods.force <= 0 ? { ...out, blocked: 'resisted' } : out;
    return { ...out, verdict, blocked: verdict.affected ? null : 'resisted' };
  },
  lead: (r, applied) => L(r.blocked ? 'applyResisted' : (applied ? 'applyApplied' : 'applyAmount'), { name: r.label }),
  steps(r) {
    if (!r.verdict) return [];
    const name = game.i18n.localize(ds.CONFIG.characteristics[r.verdict.characteristic]?.label ?? r.verdict.characteristic);
    return [`<li>${esc(L(r.verdict.affected ? 'potencyAffected' : 'potencyResisted', { name, potency: r.verdict.potency, score: r.verdict.resist }))}</li>`];
  },
  notes: (r) => (r.blocked ? [L('resisted')] : []),
  async applyMany(ctx, docs) {
    docs = docs.filter((d) => d.object && !this.result(ctx.st, ctx.a, d, ctx.message)?.blocked);
    const before = new Map(docs.map((d) => [d.uuid, new Set(d.actor.effects.map((e) => e.id))]));
    if (!docs.length || !(await applyLinkTo(ctx.a, docs.map((d) => d.object)))) return {};
    const out = {};
    const sourceUuid = casterActor(ctx.message, ctx.a)?.uuid ?? null;
    for (const doc of docs) {
      const created = doc.actor.effects.filter((e) => !before.get(doc.uuid).has(e.id));
      const { mods } = this.result(ctx.st, ctx.a, doc, ctx.message);
      const recur = mods.recurDelta || mods.recurMult !== 1 || mods.recurType || mods.recurIgnore
        ? { delta: mods.recurDelta, mult: mods.recurMult, type: mods.recurType, ignore: mods.recurIgnore } : null;
      if (mods.end || mods.saveMod || recur) {
        for (const effect of created) await applyEffectMods(effect, { end: mods.end, saveMod: mods.saveMod, recur, sourceUuid });
      }
      out[doc.uuid] = { effectIds: created.map((e) => e.id) };
    }
    return out;
  },
  async undo(doc, rec) {
    for (const id of rec.effectIds ?? []) {
      const effect = doc.actor.effects.get(id);
      if (effect) await safeDelete(effect);
    }
  },
};

const captureMessage = (flag) => {
  let id = null;
  const hook = Hooks.on('createChatMessage', (m) => { if (m.getFlag(M, flag)) id = m.id; });
  return () => { Hooks.off('createChatMessage', hook); return id; };
};

const pressUndo = (messageId, selector) => {
  const btn = document.querySelector(`li.chat-message[data-message-id="${messageId}"] ${selector}`);
  if (!btn) return void ui.notifications.warn(L('undoMissing'));
  btn.click();
};

const PER_TARGET = /@target\b/;
const statusName = (id) => game.i18n.localize(CONFIG.statusEffects.find((s) => s.id === id)?.name ?? id);

const fmBaseState = (a, distance) => {
  const props = new Set((a.dataset.properties ?? '').split(',').filter(Boolean));
  return {
    distance, movement: a.dataset.movement, vertical: props.has('vertical'), verticalDistance: '',
    fallReduction: Number(a.dataset.fallReduction) || 0, noFallDamage: false,
    noCollisionDamage: props.has('no-collision-damage'), noMoverCollisionDamage: props.has('no-mover-collision-damage'),
    noObstacleCollisionDamage: props.has('no-obstacle-collision-damage'), ignoreStability: props.has('ignore-stability'),
    fastMove: props.has('fast-auto-path'), sourceTokenId: null,
  };
};

const fmProps = (s) => new Set([
  s.vertical && 'vertical', s.noCollisionDamage && 'no-collision-damage', s.noMoverCollisionDamage && 'no-mover-collision-damage',
  s.noObstacleCollisionDamage && 'no-obstacle-collision-damage', s.ignoreStability && 'ignore-stability', s.fastMove && 'fast-auto-path',
].filter(Boolean));

const fmMovementName = (s) => {
  const cfg = ds.CONFIG.abilities.forcedMovement[s.movement];
  return cfg ? game.i18n.localize(s.vertical ? cfg.vertical : cfg.label) : s.movement;
};

const fmEntryText = (entry, base) => {
  const summary = _modEffectSummary(entry, [base]);
  return summary ? `${summary} · ${entry.noteName}` : entry.noteName;
};

const FORCED = {
  id: 'forced',
  valueAfter: true,
  modifiable: true,
  mods: (ctx, title) => ({
    pillText: (e) => fmEntryText(e, fmBaseState(ctx.a, ctx.st.totals?.[0] ?? 0)),
    pillCss: (e) => ((e.modState?.[0]?.distanceDelta ?? 0) < 0 ? 'bane' : 'edge'),
    openAdd: (editor, tab) => {
      const r = FORCED.result({ ...ctx.st, mods: { [tk(tab.uuid)]: editor._pills } }, ctx.a, tab.doc, ctx.message);
      if (!r) return;
      new EnricherFmPanel({
        base: fmBaseState(ctx.a, r.base), current: r.state, stack: editor._pills, name: title,
        makeLabel: (s) => `${fmMovementName(s)} ${s.distance}`, onDone: () => editor._refresh(),
      }).render({ force: true });
    },
  }),
  shown: (r) => `${r.movement} ${r.amount}`,
  recipient: 'targets',
  chipIcon: (a) => FORCED_ICONS[a.dataset.movement],
  test: (ec) => ec.getAttribute('enricher') === 'dsct.forced',
  single: () => true,
  signature: () => null,
  
  rolls: (a, data) => [new ds.rolls.DSRoll(PER_TARGET.test(a.dataset.formula) ? '0' : a.dataset.formula, data)],
  messageTitle: null,
  typeChoices: () => [],
  result(st, a, doc, message) {
    let base = st.totals?.[0];
    if (PER_TARGET.test(a.dataset.formula) && message) {
      try { base = Number(ds.utils.evaluateFormula(a.dataset.formula, { ...rollDataFor(message, a), target: doc.actor?.getRollData?.() ?? {} })); }
      catch { base = null; }
    }
    if (base == null || !Number.isFinite(base)) return null;
    const cfg = sourceConfig(a);
    const baseState = fmBaseState(a, base);
    const state = { ...baseState };
    const entries = pillsOf(st, doc);
    if (entries.length) replayModifiers([baseState], entries, [state]);
    const stability = state.ignoreStability ? 0 : (doc.actor?.system?.combat?.stability ?? 0);
    const out = { base, amount: Math.max(0, state.distance - stability), stability, movement: fmMovementName(state), state,
      modLines: entries.filter((e) => e.enabled !== false).map((e) => fmEntryText(e, baseState)) };
    if (cfg.requires && !doc.actor?.statuses?.has(cfg.requires)) return { ...out, amount: 0, blocked: 'needsStatus', requires: cfg.requires };
    return out;
  },
  lead: (r, applied) => L(applied ? 'forcedApplied' : 'forcedAmount', { movement: r.movement, n: applied?.amount ?? r.amount }),
  steps(r) {
    const steps = r.stability ? [`<li>${esc(L('stepStability', { n: signed(-r.stability) }))}</li>`] : [];
    if (r.blocked) steps.push(`<li>${esc(L('forcedNeedsStatus', { status: statusName(r.requires) }))}</li>`);
    return steps;
  },
  notes: (r) => [...(r.stability ? [L('stability', { n: r.stability })] : []), ...(r.blocked ? [L('forcedNeedsStatus', { status: statusName(r.requires) })] : [])],
  async applyMany(ctx, docs) {
    const { a, st, message } = ctx;
    const from = sourceDoc(message, a)?.object ?? null;
    const source = sourceConfig(a).origin === 'area' ? (_areaOrigin(abilityOf(message)) ?? from) : from;
    const out = {};
    for (const doc of docs) {
      if (!doc.object) continue;
      const r = this.result(st, a, doc, message);
      if (!r || r.blocked) continue;
      const s = r.state;
      const captured = captureMessage('isFmUndo');
      try {
        await runForcedMovement({
          movement: s.movement, distance: String(s.distance), properties: fmProps(s),
          verticalDistance: s.vertical ? (s.verticalDistance !== '' ? Number(s.verticalDistance) : s.distance) : 0, fallReduction: s.fallReduction,
          target: doc.object, source: (s.sourceTokenId ? canvas.tokens.get(s.sourceTokenId) : null) ?? source,
          contextMessageId: message.id, origin: 'enricher',
        });
      } catch (err) { console.warn('DSCT | advanced enricher | forced movement:', err); }
      const undoMessageId = captured();
      if (undoMessageId) out[doc.uuid] = { amount: r.amount, undoMessageId };
    }
    return out;
  },
  undo: async (_doc, rec) => pressUndo(rec.undoMessageId, '.dsct-undo-fm'),
};

const TELEPORT = {
  id: 'teleport',
  valueAfter: true,
  modifiable: true,
  mods: amountMods(() => L('mods.unitDistance')),
  recipient: 'targets',
  chipIcon: (a) => (a.dataset.mode === 'swap' ? 'fa-people-arrows' : 'fa-person-through-window'),
  test: (ec) => ec.getAttribute('enricher') === 'dsct.teleport',
  single: () => true,
  signature: () => null,
  rolls: (a, data) => [new ds.rolls.DSRoll(a.dataset.formula, data)],
  messageTitle: null,
  typeChoices: () => [],
  result(st, a, doc, message) {
    const base = st.totals?.[0];
    if (base == null) return null;
    const pills = livePills(st, doc);
    const out = { base, amount: foldAmount(base, pills), modLines: pills.map(amountPillText(L('mods.unitDistance'))) };
    const tv = message ? flatEffectOf(message, a)?.flatTeleport : null;
    if ((tv?.mode === 'swap' || tv?.mode === 'adjacent') && doc.object && !partnerFilter(tv)(doc.object)) return { ...out, blocked: 'partner' };
    return out;
  },
  lead: (r, applied) => L(applied ? 'teleportApplied' : 'teleportAmount', { n: applied?.amount ?? r.amount }),
  steps: (r) => (r.blocked ? [`<li>${esc(L('teleportPartner'))}</li>`] : []),
  notes: (r) => (r.blocked ? [L('teleportPartner')] : []),
  async applyMany(ctx, docs) {
    const { a, st, message } = ctx;
    const effect = flatEffectOf(message, a);
    if (effect?.type === 'dsct.flatTeleport') return this.applyFlat(ctx, docs, effect);
    const base = teleportOptions(a);
    const partner = base.mode ? (sourceDoc(message, a)?.object ?? null) : null;
    const out = {};
    for (const doc of docs) {
      const token = doc.object;
      if (!token || (partner && partner.id === token.id)) continue;
      const opts = { ...base, distance: this.result(st, a, doc)?.amount ?? base.distance };
      const captured = captureMessage('isTpUndo');
      try { await teleportToken(token, opts, partner); }
      catch (err) { console.warn('DSCT | advanced enricher | teleport:', err); }
      const undoMessageId = captured();
      if (undoMessageId) out[doc.uuid] = { amount: opts.distance, undoMessageId };
    }
    return out;
  },
  async applyFlat({ a, st, message }, docs, effect) {
    const ability = abilityOf(message);
    const sourceActor = casterActor(message, a);
    const out = {};
    for (const doc of docs) {
      const r = this.result(st, a, doc, message);
      if (!r || r.blocked) continue;
      const captured = captureMessage('isTpUndo');
      try { await runTeleportEffect({ ...effect.flatTeleport, distance: String(r.amount) }, ability, { sourceActor, partnerToken: doc.object ?? null }); }
      catch (err) { console.warn('DSCT | advanced enricher | flat teleport:', err); }
      const undoMessageId = captured();
      if (undoMessageId) out[doc.uuid] = { amount: r.amount, undoMessageId };
    }
    return out;
  },
  undo: async (_doc, rec) => pressUndo(rec.undoMessageId, '.dsct-undo-tp'),
};

const statusChoices = () => CONFIG.statusEffects.filter((s) => s.name).map((s) => ({ value: s.id, label: game.i18n.localize(s.name) }));
const cleansePillText = (p) => (p.kind === 'every' ? L('mods.endEveryPill')
  : L(p.kind === 'keep' ? 'mods.keepPill' : 'mods.alsoEndPill', { status: statusName(p.status) }));
const cleansePillCss = (p) => (p.kind === 'keep' ? 'bane' : (p.kind === 'every' ? 'bonus' : 'edge'));

const CLEANSE = {
  id: 'cleanse',
  modifiable: true,
  mods: (_ctx, title) => ({
    pillText: cleansePillText,
    pillCss: cleansePillCss,
    openAdd: (editor) => new KindPillDialog({
      title,
      buttons: [
        { kind: 'also', amount: 1, css: 'edge', label: L('mods.alsoEnd') },
        { kind: 'keep', amount: -1, css: 'bane', label: L('mods.keep') },
        { kind: 'every', amount: 1, css: 'bonus dsct-amw-wide', label: L('mods.endEvery') },
      ],
      selects: ['also', 'keep'].map((kind) => ({ kind, field: 'status', label: L('mods.condition'), choices: statusChoices() })),
      pillText: cleansePillText,
      pillCss: cleansePillCss,
      onPill: (p) => editor.addPill(p),
    }).render(true),
  }),
  shown: (r) => (r.ends.length ? game.i18n.getListFormatter({ type: r.spec.all ? 'conjunction' : 'disjunction' }).format(r.ends) : L('mods.nothing')),
  recipient: 'targets',
  chipIcon: null,
  rolls: null,
  test: (ec) => ec.getAttribute('enricher') === 'dsct.cleanse',
  single: () => true,
  signature: () => null,
  typeChoices: () => [],
  result(st, a, doc) {
    const spec = { ...cleanseSpec(a), keep: new Set() };
    const pills = livePills(st, doc);
    for (const p of pills) {
      if (p.kind === 'also' && p.status) spec.statuses.add(p.status);
      else if (p.kind === 'keep' && p.status) spec.keep.add(p.status);
      else if (p.kind === 'every') spec.all = true;
    }
    return { label: linkLabel(a), spec, ends: cleanseMatches(doc.actor, spec).map((e) => e.name), modLines: pills.map(cleansePillText) };
  },
  lead: (r, applied) => (applied ? L('cleanseApplied', { names: applied.names ?? '' }) : r.label),
  steps: () => [],
  notes: () => [],
  async applyMany(ctx, docs) {
    const out = {};
    for (const doc of docs) {
      const removed = await cleanseActor(doc.actor, this.result(ctx.st, ctx.a, doc).spec);
      if (removed?.length) out[doc.uuid] = { removed, names: removed.map((e) => e.name).join(', ') };
    }
    return out;
  },
  undo: async (doc, rec) => restoreCleansed(doc.actor, rec.removed),
};

const KINDS = [DAMAGE, HEAL, GAIN, APPLY, FORCED, TELEPORT, CLEANSE];
const kindOf = (ec, a) => KINDS.find((k) => k.test(ec, a)) ?? null;

const _rolling = new Map();

const evaluateRolls = async (kind, a, message, { scaling } = {}) => {
  const rolls = kind.rolls(a, { ...rollDataFor(message, a), ...(scaling != null ? { scaling } : {}) });
  for (const roll of rolls) {
    await roll.evaluate();
    if (!roll.isDeterministic) game.dice3d?.showForRoll(roll, game.user, true);
  }
  return rolls;
};

const postRollMessage = async (kind, message, rolls) => {
  if (!kind.messageTitle) return;
  const title = game.i18n.localize(kind.messageTitle);
  await ds.documents.DrawSteelChatMessage.create({
    title,
    rolls: rolls.filter((r) => !r.isDeterministic),
    type: 'standard',
    speaker: message.speaker,
    'system.parts': [{ rolls, flavor: title, type: 'roll' }],
    flags: { core: { canPopout: true } },
  });
};

const storeRolls = async (kind, message, key, rolls) => {
  await write(message, key, { rolls: rolls.map((r) => r.toJSON()), totals: rolls.map((r) => r.total) });
  if (getSetting('advancedEnricherMessages')) await postRollMessage(kind, message, rolls);
};

const ensureRoll = async (kind, message, key, a) => {
  if (!kind.rolls) return;
  const st = stateOf(message, key);
  if (st.totals || a.dataset.scaling) return;
  const roller = message.author?.active ? message.author.isSelf : isPrimaryGM();
  const id = `${message.id}.${key}`;
  if (!roller || _rolling.has(id)) return;
  const run = (async () => storeRolls(kind, message, key, await evaluateRolls(kind, a, message)))();
  _rolling.set(id, run);
  try { await run; }
  finally { _rolling.delete(id); }
};

const rollNow = async (kind, message, key, a) => {
  if (!kind.rolls) return true;
  await _rolling.get(`${message.id}.${key}`)?.catch(() => null);
  message = game.messages.get(message.id) ?? message;
  if (stateOf(message, key).totals) return true;
  let scaling = null;
  if (a.dataset.scaling) {
    const max = Number.isNumeric(a.dataset.scaling) ? Number(a.dataset.scaling) : null;
    scaling = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize('DRAW_STEEL.EDITOR.Enrichers.DamageHeal.RollInput.DialogTitle') },
      content: `<div class="form-group"><label>${esc(game.i18n.localize('DRAW_STEEL.EDITOR.Enrichers.DamageHeal.RollInput.Scaling.label'))}</label>`
        + `<input type="number" name="scaling" value="0" min="0"${max != null ? ` max="${max}"` : ''}></div>`,
      ok: { callback: (_e, button) => Number(button.form.elements.scaling.value) || 0 },
      rejectClose: false,
    });
    if (scaling == null) return false;
  }
  await storeRolls(kind, message, key, await evaluateRolls(kind, a, message, { scaling }));
  return true;
};

const chooseType = async (kind, message, key, a) => {
  const types = kind.typeChoices(a);
  if (types.length <= 1 || stateOf(message, key).typeChoice) return true;
  const options = types.map((t) => `<option value="${esc(t)}">${esc(damageTypeName(t))}</option>`).join('');
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize('DRAW_STEEL.EDITOR.Enrichers.DamageHeal.RollInput.DialogTitle') },
    content: `<div class="form-group"><label>${esc(game.i18n.format('DRAW_STEEL.EDITOR.Enrichers.DamageHeal.RollInput.Type', { index: 1 }))}</label><select name="type">${options}</select></div>`,
    ok: { callback: (_e, button) => button.form.elements.type.value },
    rejectClose: false,
  });
  if (!picked) return false;
  await write(message, key, { typeChoice: picked });
  return true;
};

const isRepeatable = (a) => sourceConfig(a).repeatable === true;

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
const isDefeated = (doc) => !!doc.actor?.statuses?.has(DEFEATED());

const applyRows = async (kind, message, key, a, uuids) => {
  if (!(await rollNow(kind, message, key, a))) return false;
  if (!(await chooseType(kind, message, key, a))) return false;
  message = game.messages.get(message.id) ?? message;
  const st = stateOf(message, key);
  const repeat = isRepeatable(a);
  const docs = uuids.filter((u) => repeat || !st.applied?.[tk(u)]).map((u) => fromUuidSync(u)).filter((d) => d?.actor);
  if (!docs.length) return false;
  const cost = Number(sourceConfig(a).spend) || 0;
  if (cost > 0 && !st.spent && !(await payCost(message, key, cost, a))) return false;
  const records = await kind.applyMany({ message, key, a, st }, docs);
  const stack = (uuid, rec) => {
    if (!repeat) return rec;
    const old = st.applied?.[tk(uuid)];
    return { ...rec, uses: [...(old?.uses ?? (old ? [old] : [])), rec] };
  };
  const updates = Object.fromEntries(Object.entries(records).map(([uuid, rec]) => [`applied.${tk(uuid)}`, stack(uuid, rec)]));
  if (Object.keys(updates).length) await write(message, key, updates);
  else if (cost > 0 && !st.spent) await refundCost(message, key);
  return Object.keys(updates).length > 0;
};

const undoRow = async (kind, message, key, uuid) => {
  const st = stateOf(message, key);
  const rec = st.applied?.[tk(uuid)];
  const doc = fromUuidSync(uuid);
  if (!rec || !doc?.actor) return;
  if (isDefeated(doc) && rec.prevValue != null && services.get('undoCausedDeath')) {
    if (!services.get('canUndoCausedDeath')?.()) return void ui.notifications.warn(L('cannotRevive'));
    services.get('undoCausedDeath')(uuid);
  }
  const uses = rec.uses ?? [];
  await kind.undo(doc, uses.at(-1) ?? rec);
  const rest = uses.slice(0, -1);
  await write(message, key, { [`applied.${tk(uuid)}`]: rest.length ? { ...rest.at(-1), uses: rest } : drop(message) });
  const left = Object.keys(stateOf(game.messages.get(message.id) ?? message, key).applied ?? {}).length;
  if (!left && st.spent) await refundCost(message, key);
};

const payCost = async (message, key, cost, a) => {
  const actor = casterActor(message, a);
  const core = actor?.system?.coreResource;
  const have = core ? (foundry.utils.getProperty(core.target, core.path) ?? 0) : 0;
  if (!actor || have < cost) {
    ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.spend.insufficient', {
      name: actor?.name ?? '', cost, resource: core?.name ?? game.i18n.localize('DSCT.FlatEffect.spend.resource'),
    }));
    return false;
  }
  await _spendSourceResource(actor, cost);
  await write(message, key, { spent: { cost, actor: actor.uuid } });
  return true;
};

const refundCost = async (message, key) => {
  const spent = stateOf(game.messages.get(message.id) ?? message, key).spent;
  const actor = spent?.actor ? await fromUuid(spent.actor).catch(() => null) : null;
  if (actor && spent.cost) await _spendSourceResource(actor, -spent.cost);
  await write(message, key, { spent: drop(message) });
};

const retarget = async (message, key, a) => {
  const others = sourceConfig(a).recipient === 'others' ? othersOf(message, a) : null;
  if (others) {
    const candidates = others.candidates();
    if (!candidates.length) return void ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.Others.noneInReach', { name: abilityOf(message)?.name ?? '' }));
    const count = others.spec.mode === 'pick' ? others.spec.count : candidates.length;
    const chosen = await runMultiTokenPicker({ candidates, maxTargets: count,
      hint: game.i18n.format('DSCT.FlatEffect.Others.pickHint', { count, range: others.spec.range }) });
    if (!chosen?.length) return;
    return void await write(message, key, { targets: chosen.map((t) => t.document.uuid), othersSig: null });
  }
  let picked;
  if (abilityOf(message) && getSetting('abilityTargetingEnabled')) picked = await _repickForMessage(message);
  if (picked === null) return;
  if (!picked?.length) picked = game.user.targets.size ? [...game.user.targets] : await runMultiTokenPicker({ hint: L('pickHint') });
  if (!picked?.length) return;
  const uuids = [...new Set(picked.map((t) => t.document?.uuid ?? t.uuid).filter(Boolean))];
  await write(message, key, { targets: uuids });
};

const freezeOthers = async (message, key, a) => {
  if (sourceConfig(a).recipient !== 'others') return;
  const st = stateOf(message, key);
  if (Array.isArray(st.targets) && st.othersSig == null) return;
  const others = othersOf(message, a);
  const writer = message.author?.active ? message.author.isSelf : isPrimaryGM();
  if (!others || others.spec.mode === 'pick' || !writer) return;
  const sig = [...flatTargets(message)].sort().join('|');
  if (st.othersSig === sig) return;
  await write(message, key, { targets: others.live(), othersSig: sig });
};

const shownOf = (kind, r) => (r ? String(kind.shown?.(r) ?? r.amount ?? r.label ?? '') : '?');

const previewFor = (kind, ctx) => (tab, pills) => {
  const at = (list) => kind.result({ ...ctx.st, mods: { ...(ctx.st.mods ?? {}), [tk(tab.uuid)]: list } }, ctx.a, tab.doc, ctx.message);
  return { base: shownOf(kind, at([])), final: shownOf(kind, at(pills)) };
};

const editModifiers = async (kind, message, key, a, ec, title) => {
  if (!(await rollNow(kind, message, key, a))) return;
  message = game.messages.get(message.id) ?? message;
  const st = stateOf(message, key);
  const docs = targetsOf(message, st, ec, kind).map((u) => fromUuidSync(u)).filter(Boolean);
  if (!docs.length) return void ui.notifications.info(L('noTargets'));
  const editorTitle = titleCase(L('editorTitle', { name: title }));
  const tabs = docs.map((d) => ({ uuid: d.uuid, doc: d, name: d.name, img: d.texture?.src ?? d.actor?.img, base: st.totals?.[0] ?? '', pills: st.mods?.[tk(d.uuid)] ?? [] }));
  const result = await new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    if (kind.id === 'damage') return void new TargetTabsDamageEditor({ title: editorTitle, tabs }, done).render({ force: true });
    const ctx = { message, key, a, st };
    const adapter = { ...kind.mods(ctx, editorTitle), preview: previewFor(kind, ctx) };
    new TargetTabsModEditor({ title: editorTitle, tabs, adapter }, done).render({ force: true });
  });
  if (!result) return;
  await write(message, key, Object.fromEntries(result.map((r) => [`mods.${tk(r.uuid)}`, r.pills])));
};

const toolButton = (tool, icon, tipKey) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dsct-adv-tool';
  b.dataset.advTool = tool;
  b.innerHTML = `<i class="${icon}" inert></i>`;
  const tip = tipFor(tipKey);
  b.setAttribute('aria-label', tip.title);
  setTip(b, tip);
  return b;
};

const faceTip = (kind, row, canUse, breakdown) => {
  const r = row.result;
  const lines = [];
  if (r) {
    lines.push(`<p><strong>${esc(kind.lead(r, row.applied))}</strong></p>`);
    const steps = [...(breakdown ? [`<li>${breakdown}</li>`] : []), ...(r.modLines ?? []).map((m) => `<li>${esc(m)}</li>`), ...kind.steps(r)];
    if (steps.length) lines.push(`<ul class="dsct-adv-steps">${steps.join('')}</ul>`);
    const stamina = row.doc.actor?.system?.stamina;
    if (stamina && (kind.id === 'damage' || kind.id === 'heal')) lines.push(`<p>${esc(L('stepStamina', { value: stamina.value, max: stamina.max, temp: stamina.temporary || 0 }))}</p>`);
  } else {
    lines.push(`<p>${esc(L('notRolled'))}</p>`);
  }
  const uses = row.applied?.uses?.length ?? 0;
  if (uses > 1) lines.push(`<p>${esc(L('repeatUses', { n: uses }))}</p>`);
  if (canUse) lines.push(`<p><em>${esc(L(row.applied ? (uses > 1 ? 'faceUndoLastHint' : 'faceUndoHint') : 'faceApplyHint'))}</em></p>`);
  return richTip({ title: row.doc.name, category: L(row.applied ? 'categoryApplied' : 'categoryTarget'), html: lines.join('') });
};

const deadTip = (row) => {
  const ids = services.get('deathGroupFor')?.(row.doc.id) ?? [row.doc.id];
  const tally = new Map();
  for (const id of ids) {
    const name = canvas.tokens?.get(id)?.name;
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const names = [...tally].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(', ') || row.doc.name;
  const lines = [`<p><strong>${esc(L('faceKilled', { n: row.applied.amount }))}</strong></p>`];
  lines.push(`<p><em>${esc(L(services.get('undoCausedDeath') ? 'faceReviveHint' : 'faceUndoHint', { names }))}</em></p>`);
  return richTip({ title: row.doc.name, category: L('categoryDefeated'), html: lines.join('') });
};

const facesFor = (kind, rows, canUse, breakdown) => {
  const wrap = document.createElement('span');
  wrap.innerHTML = faceChainHTML(rows.map((row) => faceFromToken(row.doc)), { className: 'dsct-adv-faces' });
  const chain = wrap.firstElementChild;
  rows.forEach((row) => {
    const el = chain.querySelector(`[data-ctlib-face="${CSS.escape(row.doc.uuid)}"]`);
    if (!el) return;
    const dead = kind.id === 'damage' && !!row.applied && isDefeated(row.doc);
    el.classList.toggle('dsct-adv-applied', !!row.applied && !dead);
    el.classList.toggle('dsct-adv-dead', dead);
    el.classList.toggle('dsct-adv-blocked', !!row.result?.blocked);
    setTip(el, dead ? deadTip(row) : faceTip(kind, row, canUse, breakdown));
    if (dead) services.get('revivalHoverPreview')?.(el, () => services.get('deathGroupFor')?.(row.doc.id) ?? []);
  });
  return chain;
};

const valueChip = (value, uuids, icon) => {
  const chip = document.createElement('span');
  chip.className = 'dsct-adv-val';
  chip.dataset.advUuids = uuids.join(' ');
  if (icon) chip.append(foundry.applications.fields.createFontAwesomeIcon(icon));
  chip.append(String(value));
  return chip;
};

const groupResults = (rows) => {
  const groups = [];
  for (const row of rows) {
    const value = row.result?.amount ?? null;
    const group = groups.find((g) => g.value === value);
    if (group) group.rows.push(row);
    else groups.push({ value, rows: [row] });
  }
  return groups;
};

const linkTip = (kind, title, rows, breakdown, detail) => {
  const lines = rows.map((row) => {
    const amount = row.applied?.amount ?? row.result?.amount;
    const notes = row.result ? [...(row.result.modLines ?? []), ...kind.notes(row.result)] : [];
    const state = row.applied ? ` <em>${esc(L('applied'))}</em>` : '';
    const value = amount != null ? `: ${amount}` : '';
    return `<p><strong>${esc(row.doc.name)}</strong>${value}${notes.length ? ` (${esc(notes.join(', '))})` : ''}${state}</p>`;
  });
  const about = detail ? `<p>${esc(detail)}</p>` : '';
  const rolled = breakdown ? `<p>${breakdown}</p>` : '';
  const how = `<p>${esc(L(rows.length ? 'howTo' : 'howToEmpty'))}</p>`;
  return richTip({ title, category: L(`category.${kind.id}`), html: about + rolled + lines.join('') + how });
};

const build = (ec, a, message, key, kind) => {
  const st = stateOf(message, key);
  const rows = targetsOf(message, st, ec, kind).map((uuid) => fromUuidSync(uuid)).filter(Boolean).map((doc) => ({
    doc, result: kind.result(st, a, doc, message), applied: st.applied?.[tk(doc.uuid)] ?? null,
  }));
  const canUse = canAct(message);
  const breakdown = kind.rolls ? breakdownHTML(a, st, message) : '';
  const formulaSpans = [...a.querySelectorAll(':scope > span')];
  const compact = a.classList.contains('dsct-adv-compact');
  let title = compact ? a.dataset.dsctLabel : a.textContent.trim();
  const titleWith = (shown) => {
    if (!compact) return a.textContent.trim();
    const words = a.dataset.dsctWords ?? '';
    if (a.dataset.dsctFormulaText) return a.dataset.dsctLabel.replace(a.dataset.dsctFormulaText, String(shown));
    const after = typeof kind.valueAfter === 'function' ? kind.valueAfter(a) : kind.valueAfter;
    return (after ? `${words} ${shown}` : `${shown} ${words}`).trim();
  };
  const groups = groupResults(rows);

  if (kind.rolls && kind.single(a) && st.totals) {
    if (groups.length > 1) {
      const rest = compact ? (a.dataset.dsctWords ?? '') : [...a.childNodes].filter((n) => !formulaSpans.includes(n)).map((n) => n.textContent).join('').trim();
      title = `${groups.map((g) => g.value ?? '?').join(' / ')} ${rest}`.trim();
      for (const s of formulaSpans) s.remove();
      a.querySelector(':scope > i')?.remove();
      const segs = document.createElement('span');
      segs.className = 'dsct-adv-segs';
      groups.forEach((g, i) => {
        if (i) segs.append(Object.assign(document.createElement('span'), { className: 'dsct-adv-div' }));
        const seg = document.createElement('span');
        seg.className = 'dsct-adv-seg';
        const icon = typeof kind.chipIcon === 'function' ? kind.chipIcon(a) : kind.chipIcon;
        seg.append(facesFor(kind, g.rows, canUse, breakdown), valueChip(g.value ?? '?', g.rows.map((r) => r.doc.uuid), i === 0 ? icon : null));
        segs.append(seg);
      });
      ec.prepend(segs);
      a.textContent = a.textContent.trim();
    } else {
      const shown = groups[0]?.value ?? st.totals[0];
      if (formulaSpans[0]) {
        const icon = formulaSpans[0].querySelector('i');
        formulaSpans[0].replaceChildren(...(icon ? [icon] : []), String(shown));
      } else {
        const icon = a.querySelector(':scope > i, :scope > img');
        const val = document.createElement('span');
        
        if (typeof kind.valueAfter === 'function' ? kind.valueAfter(a) : kind.valueAfter) {
          val.textContent = ` ${shown}`;
          a.append(val);
        } else {
          val.textContent = `${shown} `;
          if (icon) icon.after(val);
          else a.prepend(val);
        }
      }
      title = titleWith(shown);
      if (rows.length) ec.prepend(facesFor(kind, rows, canUse, breakdown));
    }
  } else if (rows.length) {
    ec.prepend(facesFor(kind, rows, canUse, breakdown));
  }

  ec.classList.toggle('dsct-adv-done', !isRepeatable(a) && rows.length > 0 && rows.every((r) => r.applied || r.result?.blocked));
  if (canUse) {
    ec.append(toolButton('retarget', 'fa-solid fa-crosshairs', 'advRetarget'));
    if (kind.modifiable) ec.append(toolButton('modify', 'fa-solid fa-gear', 'advModify'));
  }
  ec._advTitle = titleCase(title);
  const cost = Number(sourceConfig(a).spend) || 0;
  const costLine = cost ? L('costLine', { n: cost, resource: casterActor(message, a)?.system?.coreResource?.name ?? '' }) : '';
  const sourceLine = presetSource(a) ? L('sourceLine', { name: sourceDoc(message, a)?.name ?? '?' }) : '';
  setTip(a, linkTip(kind, ec._advTitle, rows, breakdown, [a.dataset.dsctDetail, sourceLine, costLine].filter(Boolean).join(' ')));
  activateFaces(ec);
};

const onClick = (ec, a, message, key, kind) => async (event) => {
  const face = event.target.closest('[data-ctlib-face]');
  const chip = event.target.closest('.dsct-adv-val');
  const tool = event.target.closest('[data-adv-tool]');
  const link = event.target.closest('a');
  if (!face && !chip && !tool && !link) return;
  event.preventDefault();
  event.stopPropagation();
  if (!canAct(message)) return void ui.notifications.warn(L('notYours'));
  if (ec.dataset.advBusy) return;
  ec.dataset.advBusy = '1';
  try {
    const st = stateOf(message, key);
    if (tool?.dataset.advTool === 'retarget') return void await retarget(message, key, a);
    if (tool?.dataset.advTool === 'modify') return void await editModifiers(kind, message, key, a, ec, ec._advTitle ?? a.textContent.trim());
    if (face) {
      const uuid = face.getAttribute('data-ctlib-face');
      if (st.applied?.[tk(uuid)]) return void await undoRow(kind, message, key, uuid);
      return void await applyRows(kind, message, key, a, [uuid]);
    }
    if (chip) return void await applyRows(kind, message, key, a, chip.dataset.advUuids.split(' '));
    if (event.shiftKey && link) {
      const mine = [...game.user.targets].map((t) => t.document.uuid);
      if (!mine.length) return void ui.notifications.warn(L('shiftNoTargets'));
      await write(message, key, { targets: mine, othersSig: null });
      return void await applyRows(kind, game.messages.get(message.id) ?? message, key, a, mine);
    }
    const targets = targetsOf(message, st, ec, kind);
    if (!targets.length) return void await retarget(message, key, a);
    await applyRows(kind, message, key, a, targets);
  } finally {
    delete ec.dataset.advBusy;
  }
};

const autoApplies = (kind, a, message) => {
  const ability = abilityOf(message);
  if (!ability) return false;
  
  if (sourceConfig(a).flat) {
    if (kind.id === 'forced') return (a.dataset.properties ?? '').split(',').includes('fast-auto-path');
    if (kind.id === 'cleanse') return a.dataset.all === 'true';
    return kind.id !== 'teleport';
  }
  const sig = kind.single(a) ? kind.signature(a) : null;
  if (sig && derivedSignatures(ability).has(sig)) return true;
  
  return kind.id === 'apply' && !!a.dataset.status && !!message.getFlag(M, 'abilityDsid');
};

const decorate = (ec) => {
  if (!advancedEnrichersOn() || ec.dataset.dsctAdv || ec.closest(DSTD_PANEL)) return;
  const a = linkOf(ec);
  const kind = kindOf(ec, a);
  if (!kind) return;
  const li = ec.closest('[data-message-id]');
  const message = li ? game.messages.get(li.dataset.messageId) : null;
  if (!message) return;
  const root = ec.closest('.message-content') ?? li;
  const key = keyFor(root, ec);
  ec.dataset.dsctAdv = key;
  ec.dataset.advKind = kind.id;
  ec.classList.add('dsct-adv');
  ec._advOriginal = a.innerHTML;
  if (autoApplies(kind, a, message)) ec.dataset.advAuto = '1';
  build(ec, a, message, key, kind);
  ec.addEventListener('click', onClick(ec, a, message, key, kind), { capture: true });
  ensureRoll(kind, message, key, a).catch((err) => console.warn('DSCT | advanced enricher | roll failed:', err));
  freezeOthers(message, key, a).catch((err) => console.warn('DSCT | advanced enricher | others:', err));
};

const compactOn = () => getSetting('compactEnrichers') === true;
const GAIN_TOKENS = { heroic: 'heroic', epic: 'heroic', surge: 'surges' };

const htmlIcon = (html) => {
  const t = document.createElement('template');
  t.innerHTML = String(html ?? '').trim();
  return t.content.firstElementChild;
};

const imgIcon = (src) => Object.assign(document.createElement('img'), { src, className: 'dsct-adv-icon', alt: '' });

const typeIcon = (id, a) => {
  const d = a.dataset;
  if (id === 'ds.roll' && d.type === 'damageHeal' && d.rollType === 'damage') {
    return htmlIcon(damageTypeIconHTML((d.damageTypes ?? '').split('&')[0].split('|')[0] || 'untyped'));
  }
  if (id === 'ds.roll' && d.type === 'damageHeal') {
    const token = d.damageTypes && d.damageTypes !== 'value' ? 'temporary' : (sourceConfig(a).recovery ? 'recovery' : 'stamina');
    return htmlIcon(resourceTokenHTML(token));
  }
  if (id === 'ds.roll' && d.type === 'gain') {
    return GAIN_TOKENS[d.gainType] ? htmlIcon(resourceTokenHTML(GAIN_TOKENS[d.gainType])) : foundry.applications.fields.createFontAwesomeIcon('fa-bolt');
  }
  if (id === 'ds.apply') {
    const img = d.type === 'status' ? CONFIG.statusEffects.find((s) => s.id === d.status)?.img : fromUuidSync(d.uuid)?.img;
    return img ? imgIcon(img) : null;
  }
  return null;
};

const compactLink = (id, a) => {
  const formula = a.querySelector(':scope > span');
  a.dataset.dsctLabel = a.textContent.trim();
  a.dataset.dsctWords = [...a.childNodes].filter((n) => n !== formula).map((n) => n.textContent).join('').trim();
  if (formula) a.dataset.dsctFormulaText = formula.textContent.trim();
  const icon = typeIcon(id, a);
  for (const n of [...a.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove();
  if (icon) {
    for (const old of a.querySelectorAll('i.fa-dice-d10, i.fa-bolt, :scope > i.fa-person-rays')) old.remove();
    icon.classList.add('dsct-adv-icon');
    a.prepend(icon);
  }
  a.classList.add('dsct-adv-compact');
  if (!a.dataset.dsctTip) setTip(a, richTip({ title: a.dataset.dsctLabel, body: a.dataset.dsctDetail ?? '' }));
};

const untypedAutoDamage = (id, a, match) => id === 'ds.roll' && !match.groups?.label && a.dataset.type === 'damageHeal'
  && a.dataset.rollType === 'damage' && !(a.dataset.damageTypes ?? '').replace(/[&|]/g, '');

const wrapEnricher = (id) => {
  const i = CONFIG.TextEditor.enrichers.findIndex((e) => e.id === id);
  if (i < 0) return;
  const cfg = CONFIG.TextEditor.enrichers[i];
  const inner = cfg.onRender;
  const innerEnrich = cfg.enricher;
  CONFIG.TextEditor.enrichers[i] = {
    ...cfg,
    
    enricher: async function (match, options) {
      const el = await innerEnrich.call(this, match, options);
      const a = el?.matches?.('a') ? el : el?.querySelector?.('a');
      if (a && match.groups?.config != null) a.dataset.dsctSource = match.groups.config.trim();
      if (a && advancedEnrichersOn() && untypedAutoDamage(id, a, match)) a.append(` ${L('flatDamage', { type: '' }).trim()}`);
      if (a && advancedEnrichersOn()) titleCaseText(a);
      if (a && compactOn()) compactLink(id, a);
      return el;
    },
    onRender: async function (element) {
      await inner?.call(this, element);
      try { decorate(element); }
      catch (err) { console.warn(`DSCT | advanced enricher | ${id}:`, err); }
    },
  };
};

const applyAutoEnrichers = async (message, doc = document) => {
  if (!message || !advancedEnrichersOn()) return false;
  const li = doc.querySelector(`li.chat-message[data-message-id="${message.id}"]`);
  let damaged = false;
  for (const ec of li?.querySelectorAll('enriched-content.dsct-adv[data-adv-auto]') ?? []) {
    const key = ec.dataset.dsctAdv;
    const a = linkOf(ec);
    const kind = kindOf(ec, a);
    if (!kind) continue;
    const live = game.messages.get(message.id);
    const st = stateOf(live, key);
    const targets = targetsOf(live, st, ec, kind).filter((u) => !st.applied?.[tk(u)]);
    if (!targets.length) continue;
    if (await applyRows(kind, live, key, a, targets) && kind.id === 'damage') damaged = true;
  }
  return damaged;
};

const refreshEnricher = (ec) => {
  const a = linkOf(ec);
  const kind = kindOf(ec, a);
  const message = game.messages.get(ec.closest('[data-message-id]')?.dataset.messageId);
  if (!a || !kind || !message || ec._advOriginal == null) return;
  for (const node of [...ec.children]) if (node !== a) node.remove();
  a.innerHTML = ec._advOriginal;
  build(ec, a, message, ec.dataset.dsctAdv, kind);
};

const refreshAll = foundry.utils.debounce(() => {
  for (const ec of document.querySelectorAll('enriched-content.dsct-adv')) refreshEnricher(ec);
}, 200);

const ENRICHER_IDS = ['ds.roll', 'ds.apply', 'dsct.forced', 'dsct.teleport', 'dsct.cleanse'];

const hideEmptyPanel = ({ message, root, panel }) => {
  if (!panel) return;
  const enrichers = !!root.querySelector(`${ENRICHER_IDS.map((id) => `enriched-content[enricher="${id}"]`).join(', ')}, .dsct-adv-fallback`);
  const rows = [...panel.querySelectorAll(DSTD_ROW)];
  const empty = rows.every((row) => !row.querySelector(`button, dd.${DSTD}-tier-text`));
  const plain = !!message && !abilityOf(message);
  panel.classList.toggle('dsct-adv-empty-panel', advancedEnrichersOn() && enrichers && (empty || plain));
};

const dropApplyRows = ({ root, panel }) => {
  if (!panel || !advancedEnrichersOn() || !root.querySelector('enriched-content[enricher="ds.apply"]')) return;
  for (const btn of panel.querySelectorAll('[data-part-id="apply"][data-dstd-action]')) btn.closest(`.${DSTD}-action-row`)?.remove();
};

export function registerAdvancedEnrichers() {
  registerPanelDecorator({ id: 'advanced-enrichers-apply-rows', priority: 5, decorate: dropApplyRows });
  registerCtEnrichers();
  registerFlatEnrichers();
  for (const id of ENRICHER_IDS) wrapEnricher(id);
  services.provide('applyAutoEnrichers', applyAutoEnrichers);
  services.provide('syncEmptyPanel', (message, root) => hideEmptyPanel({ message, root, panel: root.querySelector(DSTD_PANEL) }));
  registerPanelDecorator({ id: 'advanced-enrichers-empty-panel', priority: 95, decorate: hideEmptyPanel });
  for (const hook of ['createActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, (effect) => { if (effect?.statuses?.has(DEFEATED())) refreshAll(); });
  }
  Hooks.on('canvasReady', () => refreshAll());
  Hooks.on('updateActor', (_actor, changes) => {
    if (foundry.utils.hasProperty(changes, 'system.stamina') || foundry.utils.hasProperty(changes, 'system.hero')) refreshAll();
  });
}
