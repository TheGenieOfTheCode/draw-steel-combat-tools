import { getSetting } from '../helpers.mjs';
import { services, DSTD } from '../ctlib.mjs';
import { registerDamagePillProvider } from '../compat/dstd-damage-pills.mjs';
import { chooseMessageFilter, addPreviewRewrite, chooseClaimed } from '../ability-automation/choose-effect.mjs';
import { levelAllows, expendAllows } from '../ability-automation/flat-special-effects.mjs';
import { enricherSignatures, effectSignature } from './mirror.mjs';

const DERIVED = 'dsctDrv';
const FLAT_TYPES = new Set(['dsct.flatDamage', 'dsct.flatHeal', 'dsct.flatResource', 'dsct.flatApplied', 'dsct.flatForced', 'dsct.flatCleanse', 'dsct.flatTeleport']);
const GAIN_TYPES = new Set(['epic', 'heroic', 'renown', 'surge', 'victory', 'wealth']);
const FORCED_WORDS = {
  vertical: 'vertical', 'ignore-stability': 'ignoreStability', 'no-collision-damage': 'nocollision', 'fast-auto-path': 'fast',
  'no-mover-collision-damage': 'nomovercollision', 'no-obstacle-collision-damage': 'noobstaclecollision',
};

const on = () => getSetting('advancedEnrichers') !== false && getSetting('flatEffectsEnabled') !== false;
const setOf = (v) => (v instanceof Set ? v : new Set(v ?? []));
const label = (text) => (text ? `{${String(text).replace(/[{}]/g, '')}}` : '');

const recipient = (r, fallback) => ` recipient=${r || fallback}`;
const twoWay = (r) => r === 'target' || r === 'self';
const reachable = (r, data) => twoWay(r) || (r === 'others' && !!data?.others);
const flag = (on, key) => (on ? ` ${key}=true` : '');
const spendPart = (data) => (data?.spend?.enabled ? ` spend=${data.spend.value ?? 1}` : '');

const PER_TARGET = /@target\b/;
const plainFormula = (formula) => !PER_TARGET.test(String(formula ?? ''));
const quoted = (value) => (/\s/.test(value) ? `"${value}"` : value);

const baseDamageTypes = (ability) => new Set([...(ability?.system?.power?.effects ?? [])].filter((e) => e.type === 'damage')
  .flatMap((e) => [1, 2, 3].flatMap((t) => [...setOf(e.damage?.[`tier${t}`]?.types)])));

export const bonusDamage = (ability, effect) => {
  if (effect?.type !== 'dsct.flatDamage' || !ability) return false;
  const f = effect.flatDamage;
  const types = [...setOf(f.types)];
  return (f.recipient ?? 'target') === 'target' && plainFormula(f.value) && types.length === 1 && baseDamageTypes(ability).has(types[0]);
};

const bonusPills = (message) => {
  if (!on()) return [];
  const uuid = (message.system?.parts?.contents ?? []).find((p) => p?.abilityUuid)?.abilityUuid;
  const ability = uuid ? fromUuidSync(uuid) : null;
  if (!ability) return [];
  const pills = visibleFlatEffects(message, ability).filter((e) => bonusDamage(ability, e)).map((e) => {
    let value = 0;
    try { value = Number(ds.utils.evaluateFormula(String(e.flatDamage.value), ability.getRollData?.() ?? {})) || 0; } catch { value = 0; }
    return { kind: 'delta', value, label: e.name || e.flatDamage.display || e.label, source: 'flat', dsctFlat: e.id };
  }).filter((p) => p.value);
  if (!pills.length) return [];
  const targets = message.getFlag?.(DSTD, 'state')?.targets ?? [];
  return targets.filter((t) => t.tokenUuid).flatMap((t) => pills.map((pill) => ({ targetUuid: t.tokenUuid, pill: { ...pill, dstTarget: t.tokenUuid } })));
};

export const flatEnricherText = (effect, ability) => {
  const tag = ` flat=${effect.id}`;
  switch (effect.type) {
    case 'dsct.flatDamage': {
      const f = effect.flatDamage;
      if (bonusDamage(ability, effect)) return null;
      if (!reachable(f.recipient ?? 'target', f) || !String(f.value ?? '').trim() || !plainFormula(f.value)) return null;
      const types = [...setOf(f.types)];
      const ignored = [...setOf(f.ignoredImmunities)];
      const typePart = types.length > 1 ? ` type=${types.join('/')}` : (types[0] ? ` ${types[0]}` : '');
      const ignorePart = ignored.length ? ` ignoredImmunities=${ignored.join('/')}` : '';
      const typeName = types.length === 1 ? game.i18n.localize(ds.CONFIG.damageTypes[types[0]]?.label ?? types[0]) : '';
      const fallback = game.i18n.format('DSCT.advEnricher.flatDamage', { type: typeName }).trim();
      return `[[/damage ${f.value}${typePart}${ignorePart}${recipient(f.recipient, 'target')}${spendPart(f)}${tag}]]${label(f.display || fallback)}`;
    }
    case 'dsct.flatHeal': {
      const h = effect.flatHeal;
      if (!reachable(h.recipient ?? 'target', h)) return null;
      let formula;
      let value = '';
      if (h.amountType === 'recoveryValue') {
        formula = '@recoveries.recoveryValue';
        value = ` value=${h.recoveryValueSource === 'target' ? 'target' : 'self'}`;
      } else formula = String(h.amountFormula ?? '').trim();
      if (!formula || formula === '0' || !plainFormula(formula)) return null;
      const recovery = h.spendRecovery ? ` recovery=${h.recoverySource === 'target' ? 'target' : 'self'}` : '';
      const extras = `${flag(h.tempStamina && h.tempStack, 'tempStack')}${flag(h.repeatable, 'repeatable')}`;
      return `[[/heal ${formula}${h.tempStamina ? ' temp' : ''}${value}${recovery}${extras}${recipient(h.recipient, 'target')}${spendPart(h)}${tag}]]${label(h.display)}`;
    }
    case 'dsct.flatResource': {
      const r = effect.flatResource;
      if (r.preApplied || !reachable(r.recipient ?? 'self', r) || !GAIN_TYPES.has(r.type) || !r.amount) return null;
      return `[[/gain ${r.amount} ${r.type} recipient=${r.recipient ?? 'self'}${spendPart(r)}${tag}]]${label(r.display)}`;
    }
    case 'dsct.flatApplied': {
      const a = effect.flatApplied;
      if (!a.statusId) return null;
      const known = CONFIG.statusEffects.some((s) => s.id === a.statusId) || !!ability?.effects?.get?.(a.statusId);
      if (!known) return null;
      const end = a.end && ds.CONFIG.effectEnds?.[a.end] ? ` ${a.end}` : '';
      const chr = a.potency?.characteristic;
      const strength = a.potency?.strength === 'custom' ? (a.potency.custom || 'average') : (a.potency?.strength || 'average');
      const potency = chr && chr !== 'none' && ds.CONFIG.characteristics?.[chr] ? ` potency=${quoted(`${chr}:${strength}`)}` : '';
      return `[[/apply ${a.statusId}${end}${potency}${a.exclusiveSelf ? ' recipient=self' : ''}${spendPart(a)}${tag}]]${label(a.display)}`;
    }
    case 'dsct.flatForced': {
      const f = effect.flatForced;
      const movement = [...setOf(f.movement)];
      const distance = String(f.distance ?? '').trim();
      if (movement.length !== 1 || !distance) return null;
      const words = [...setOf(f.properties)].map((p) => FORCED_WORDS[p]).filter(Boolean).map((w) => ` ${w}`).join('');
      const origin = f.origin === 'area' ? ' origin=area' : '';
      const requires = f.requiresStatus ? ` requires=${f.requiresStatus}` : '';
      return `[[/${movement[0]} ${distance}${words}${origin}${requires}${spendPart(f)}${tag}]]${label(f.display)}`;
    }
    case 'dsct.flatCleanse': {
      const c = effect.flatCleanse;
      if (!twoWay(c.recipient ?? 'target')) return null;
      const expiry = [...setOf(c.expiryFilter)].map((e) => (e === 'turnEnd' ? 'turn' : e === 'save' ? 'save' : null));
      if (expiry.includes(null)) return null;
      const parts = [c.all ? 'all' : '', ...expiry, ...setOf(c.statusFilter), ...setOf(c.keywordFilter)].filter(Boolean).join(' ');
      return `[[/cleanse ${parts}${flag(c.repeatable, 'repeatable')}${recipient(c.recipient, 'target')}${spendPart(c)}${tag}]]${label(c.display)}`;
    }
    case 'dsct.flatTeleport': {
      const t = effect.flatTeleport;
      const distance = String(t.distance ?? '5').trim() || '5';
      if (!plainFormula(distance)) return null;
      const mode = t.mode ?? 'normal';
      const self = mode === 'normal' && (t.mover ?? 'self') === 'self';
      const modePart = mode === 'adjacent' || mode === 'intoSpace' ? ` mode=${mode}` : '';
      const fallback = mode === 'intoSpace' ? game.i18n.localize('DSCT.FlatEffect.Teleport.intoSpaceLabel') : '';
      return `[[/${mode === 'swap' ? 'teleswap' : 'teleport'} ${quoted(distance)}${modePart} recipient=${self ? 'self' : 'target'}${spendPart(t)}${tag}]]${label(t.display || fallback)}`;
    }
    default:
      return null;
  }
};

const flatEffectsOf = (ability) => Array.from(ability?.system?.effects?.contents ?? []).filter((e) => FLAT_TYPES.has(e.type));

export const takesOver = (ability, effect) => {
  if (!on() || !ability || !FLAT_TYPES.has(effect?.type)) return false;
  if (effect.id.startsWith(DERIVED)) {
    const sig = effectSignature(ability, effect);
    if (sig && enricherSignatures(ability).has(sig)) return true;
  }
  return flatEnricherText(effect, ability) != null || bonusDamage(ability, effect);
};

const textsOf = (ability) => [
  ...Object.values(foundry.utils.flattenObject(ability.system?.toObject?.() ?? {})).filter((v) => typeof v === 'string'),
  
  ...Array.from(ability.system?.effects ?? []).flatMap((e) => (e.choose?.choices ?? []).map((c) => c.preview ?? '')),
];

const findFlat = (ability, ref) => {
  const wanted = String(ref ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const flats = flatEffectsOf(ability);
  return flats.find((e) => e.id.toLowerCase() === wanted)
    ?? flats.find((e) => [e.name, e.label, e[e.type.slice(5)]?.display].some((n) => n && String(n).toLowerCase() === wanted)) ?? null;
};

const PRESETS = /\s+(?:targets|source|distance|targetType|count|from|short|unless)=(?:"[^"]*"|\S+)/gi;

const splitFlatConfig = (config) => ({
  name: String(config ?? '').replace(PRESETS, '').trim(),
  presets: [...String(config ?? '').matchAll(PRESETS)].map((m) => m[0]).join(''),
});

const placedIds = (ability) => {
  const ids = new Set();
  for (const text of textsOf(ability)) {
    for (const m of text.matchAll(/\[\[\/flat\s+(.*?)\]\](?!\])/gi)) {
      const found = findFlat(ability, splitFlatConfig(` ${m[1]}`).name);
      if (found) ids.add(found.id);
    }
  }
  return ids;
};

export const visibleFlatEffects = (message, ability) => {
  const keeps = chooseMessageFilter(message, ability);
  return flatEffectsOf(ability).filter((e) => (!keeps || keeps(e))
    && (e.type !== 'dsct.flatDamage' || expendAllows(e, ability, message))
    && (e.type !== 'dsct.flatApplied' || levelAllows(e, ability, message)));
};

const enrich = (text, ability) => foundry.applications.ux.TextEditor.implementation.enrichHTML(text, { relativeTo: ability, rollData: ability.getRollData?.() });

const flat = {
  id: 'dsct.flat',
  pattern: /\[\[\/flat\s+(?<config>.*?)]](?!])(?:{(?<label>[^}]+)})?/gi,
  async enricher(match, options) {
    const ability = options.relativeTo;
    const { name, presets } = splitFlatConfig(` ${match.groups.config}`);
    const effect = ability?.documentName === 'Item' ? findFlat(ability, name) : null;
    if (!effect) return null;
    let text = flatEnricherText(effect, ability);
    if (text && presets) text = text.replace(/]](?=(?:{[^}]*})?$)/, `${presets}]]`);
    if (!text || getSetting('advancedEnrichers') === false) {
      const span = document.createElement('span');
      span.textContent = match.groups.label ?? effect[effect.type.slice(5)]?.display ?? effect.label ?? effect.name;
      return span;
    }
    if (match.groups.label) text = text.replace(/{[^}]*}$/, '') + `{${match.groups.label}}`;
    const holder = document.createElement('template');
    holder.innerHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, options);
    return holder.content.firstElementChild;
  },
};

const fallbackTexts = (ability, effects) => {
  const placed = placedIds(ability);
  const signatures = enricherSignatures(ability);
  return effects
    .filter((e) => !placed.has(e.id))
    .filter((e) => !(e.id.startsWith(DERIVED) && signatures.has(effectSignature(ability, e))))
    .map((e) => flatEnricherText(e, ability))
    .filter(Boolean);
};

const injectFallback = async (message, html) => {
  if (!on() || html.querySelector('.dsct-adv-fallback')) return;
  const uuid = (message.system?.parts?.contents ?? []).find((p) => p?.abilityUuid)?.abilityUuid;
  const ability = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (!ability) return;
  const texts = fallbackTexts(ability, visibleFlatEffects(message, ability));
  if (!texts.length) return;
  const embed = html.querySelector('document-embed.ability, .message-part-html document-embed');
  if (!embed || html.querySelector('.dsct-adv-fallback')) return;
  const out = document.createElement('span');
  out.className = 'dsct-adv-fallback';
  out.innerHTML = await enrich(texts.join('; '), ability);
  const effectText = [...embed.querySelectorAll('section.effect dd.effect')].at(-1);
  const host = effectText?.querySelector('p:last-of-type') ?? effectText;
  if (host) {
    host.append(document.createTextNode(host.textContent.trim().match(/[.!?]$/) ? ' ' : '; '), out);
  } else {
    const p = document.createElement('p');
    p.className = 'dsct-adv-fallback-line';
    p.append(out);
    embed.append(p);
  }
  services.get('syncEmptyPanel')?.(message, html);
};

const blank = (html) => !String(html ?? '').replace(/<[^>]*>/g, '').trim();

const appendInline = (html, extra) => {
  const at = html.lastIndexOf('</p>');
  if (at < 0) return `${html}<p>${extra}</p>`;
  const before = html.slice(0, at);
  const joint = before.replace(/<[^>]*>/g, '').trim().match(/[.!?]$/) ? ' ' : '; ';
  return `${before}${joint}${extra}${html.slice(at)}`;
};

async function previewEnrichers(context) {
  if (!on() || 'limitEffects' in context) return;
  const ability = this.parent;
  const taken = flatEffectsOf(ability).filter((e) => takesOver(ability, e));
  if (!taken.length) return;
  const labels = taken.map((e) => e.label);
  const strip = (list) => (list ?? []).filter((d) => {
    const i = labels.indexOf(d.label);
    if (i < 0 || !blank(d.text)) return true;
    labels.splice(i, 1);
    return false;
  });
  context.beforeEffects = strip(context.beforeEffects);
  context.afterEffects = strip(context.afterEffects);
  const claimed = chooseClaimed(ability);
  const texts = fallbackTexts(ability, taken.filter((e) => !claimed.has((e.name ?? '').trim())));
  if (!texts.length) return;
  const extra = `<span class="dsct-adv-fallback">${await enrich(texts.join('; '), ability)}</span>`;
  const host = context.afterEffects.at(-1) ?? context.beforeEffects.at(-1);
  if (host) host.text = appendInline(host.text, extra);
  else context.afterEffects.push({ label: game.i18n.localize('TYPES.SpecialEffect.base'), text: `<p>${extra}</p>` });
}

export function registerFlatEnrichers() {
  CONFIG.TextEditor.enrichers.push(flat);
  addPreviewRewrite(previewEnrichers);
  registerDamagePillProvider(bonusPills);
  services.provide('flatTakesOver', takesOver);
  Hooks.on('renderChatMessageHTML', (message, html) => {
    injectFallback(message, html).catch((err) => console.warn('DSCT | flat enrichers | fallback:', err));
  });
}
