import { getSetting } from '../helpers.mjs';
import { services } from '../ctlib.mjs';
import { chooseMessageFilter } from '../ability-automation/choose-effect.mjs';
import { levelAllows, expendAllows } from '../ability-automation/flat-special-effects.mjs';
import { enricherSignatures, effectSignature } from './mirror.mjs';

const DERIVED = 'dsctDrv';
const FLAT_TYPES = new Set(['dsct.flatDamage', 'dsct.flatHeal', 'dsct.flatResource', 'dsct.flatApplied', 'dsct.flatForced', 'dsct.flatCleanse']);
const GAIN_TYPES = new Set(['epic', 'heroic', 'renown', 'surge', 'victory', 'wealth']);
const FORCED_WORDS = {
  vertical: 'vertical', 'ignore-stability': 'ignoreStability', 'no-collision-damage': 'nocollision', 'fast-auto-path': 'fast',
  'no-mover-collision-damage': 'nomovercollision', 'no-obstacle-collision-damage': 'noobstaclecollision',
};

const on = () => getSetting('advancedEnrichers') !== false && getSetting('flatEffectsEnabled') !== false;
const setOf = (v) => (v instanceof Set ? v : new Set(v ?? []));
const label = (text) => (text ? `{${String(text).replace(/[{}]/g, '')}}` : '');
const recipient = (r, fallback) => (r && r !== fallback ? ` recipient=${r}` : '');
const twoWay = (r) => r === 'target' || r === 'self';
const spendPart = (data) => (data?.spend?.enabled ? ` spend=${data.spend.value ?? 1}` : '');

const PER_TARGET = /@target\b/;
const plainFormula = (formula) => !PER_TARGET.test(String(formula ?? ''));
const quoted = (value) => (/\s/.test(value) ? `"${value}"` : value);

export const flatEnricherText = (effect, ability) => {
  const tag = ` flat=${effect.id}`;
  switch (effect.type) {
    case 'dsct.flatDamage': {
      const f = effect.flatDamage;
      if (!twoWay(f.recipient ?? 'target') || !String(f.value ?? '').trim() || !plainFormula(f.value)) return null;
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
      if (h.tempStack || h.repeatable || !twoWay(h.recipient ?? 'target')) return null;
      let formula;
      let value = '';
      if (h.amountType === 'recoveryValue') {
        formula = '@recoveries.recoveryValue';
        value = ` value=${h.recoveryValueSource === 'target' ? 'target' : 'self'}`;
      } else formula = String(h.amountFormula ?? '').trim();
      if (!formula || formula === '0' || !plainFormula(formula)) return null;
      const recovery = h.spendRecovery ? ` recovery=${h.recoverySource === 'target' ? 'target' : 'self'}` : '';
      return `[[/heal ${formula}${h.tempStamina ? ' temp' : ''}${value}${recovery}${recipient(h.recipient, 'target')}${spendPart(h)}${tag}]]${label(h.display)}`;
    }
    case 'dsct.flatResource': {
      const r = effect.flatResource;
      if (r.preApplied || !twoWay(r.recipient ?? 'self') || !GAIN_TYPES.has(r.type) || !r.amount) return null;
      return `[[/gain ${r.amount} ${r.type} recipient=${r.recipient ?? 'self'}${spendPart(r)}${tag}]]${label(r.display)}`;
    }
    case 'dsct.flatApplied': {
      const a = effect.flatApplied;
      if (a.exclusiveSelf || !a.statusId) return null;
      const known = CONFIG.statusEffects.some((s) => s.id === a.statusId) || !!ability?.effects?.get?.(a.statusId);
      if (!known) return null;
      const end = a.end && ds.CONFIG.effectEnds?.[a.end] ? ` ${a.end}` : '';
      const chr = a.potency?.characteristic;
      const strength = a.potency?.strength === 'custom' ? (a.potency.custom || 'average') : (a.potency?.strength || 'average');
      const potency = chr && chr !== 'none' && ds.CONFIG.characteristics?.[chr] ? ` potency=${quoted(`${chr}:${strength}`)}` : '';
      return `[[/apply ${a.statusId}${end}${potency}${spendPart(a)}${tag}]]${label(a.display)}`;
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
      if (c.repeatable || !twoWay(c.recipient ?? 'target')) return null;
      const expiry = [...setOf(c.expiryFilter)].map((e) => (e === 'turnEnd' ? 'turn' : e === 'save' ? 'save' : null));
      if (expiry.includes(null)) return null;
      const parts = [c.all ? 'all' : '', ...expiry, ...setOf(c.statusFilter)].filter(Boolean).join(' ');
      return `[[/cleanse ${parts}${recipient(c.recipient, 'target')}${spendPart(c)}${tag}]]${label(c.display)}`;
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
  return flatEnricherText(effect, ability) != null;
};

const textsOf = (ability) => Object.values(foundry.utils.flattenObject(ability.system?.toObject?.() ?? {})).filter((v) => typeof v === 'string');

const findFlat = (ability, ref) => {
  const wanted = String(ref ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const flats = flatEffectsOf(ability);
  return flats.find((e) => e.id.toLowerCase() === wanted)
    ?? flats.find((e) => [e.name, e.label, e[e.type.slice(5)]?.display].some((n) => n && String(n).toLowerCase() === wanted)) ?? null;
};

const placedIds = (ability) => {
  const ids = new Set();
  for (const text of textsOf(ability)) {
    for (const m of text.matchAll(/\[\[\/flat\s+([^\]]+?)\]\]/gi)) {
      const found = findFlat(ability, m[1]);
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
  pattern: /\[\[\/flat\s+(?<config>[^\]]+?)]](?:{(?<label>[^}]+)})?/gi,
  async enricher(match, options) {
    const ability = options.relativeTo;
    const effect = ability?.documentName === 'Item' ? findFlat(ability, match.groups.config) : null;
    if (!effect) return null;
    let text = flatEnricherText(effect, ability);
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

const injectFallback = async (message, html) => {
  if (!on() || html.querySelector('.dsct-adv-fallback')) return;
  const uuid = (message.system?.parts?.contents ?? []).find((p) => p?.abilityUuid)?.abilityUuid;
  const ability = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (!ability) return;
  const placed = placedIds(ability);
  const signatures = enricherSignatures(ability);
  const texts = visibleFlatEffects(message, ability)
    .filter((e) => !placed.has(e.id))
    .filter((e) => !(e.id.startsWith(DERIVED) && signatures.has(effectSignature(ability, e))))
    .map((e) => flatEnricherText(e, ability))
    .filter(Boolean);
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

export function registerFlatEnrichers() {
  CONFIG.TextEditor.enrichers.push(flat);
  services.provide('flatTakesOver', takesOver);
  Hooks.on('renderChatMessageHTML', (message, html) => {
    injectFallback(message, html).catch((err) => console.warn('DSCT | flat enrichers | fallback:', err));
  });
}
