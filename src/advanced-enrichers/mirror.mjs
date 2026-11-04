

const DERIVED = 'dsctDrv';

const GAIN_ALIASES = { hr: 'heroic', victories: 'victory', surges: 'surge' };
const GAIN_TYPES = new Set(['epic', 'heroic', 'renown', 'surge', 'victory', 'wealth']);
const TEMP_WORDS = new Set(['temp', 'temphp', 'temporary']);

const normalize = (formula) => String(formula ?? '').replace(/\s+/g, '').toLowerCase();
const resolve = (formula, rollData) => ds.rolls.DSRoll.replaceFormulaData(String(formula ?? ''), rollData);

export const damageSignature = (formula, types) => `damage:${normalize(formula)}|${[...(types ?? [])].filter(Boolean).sort().join('/')}`;
export const healSignature = (formula, temporary) => `heal:${normalize(formula)}|${temporary ? 'temporary' : 'value'}`;
export const gainSignature = (type, formula) => `gain:${type}|${normalize(formula)}`;
export const applySignature = (status) => `apply:${status}`;

const textsOf = (ability) => Object.values(foundry.utils.flattenObject(ability.system?.toObject?.() ?? {}))
  .filter((v) => typeof v === 'string' && v.includes('[[/'));

const rollDataOf = (ability) => ability.getRollData?.() ?? {};

const _cache = new WeakMap();

export const enricherSignatures = (ability) => {
  if (_cache.has(ability)) return _cache.get(ability);
  const out = new Set();
  const { roll, applyEffect } = ds.applications?.ux?.enrichers ?? {};
  const parseConfig = ds.applications?.ux?.helpers?.parseConfig;
  if (parseConfig) {
    const rollData = rollDataOf(ability);
    for (const text of textsOf(ability)) {
      if (roll?.pattern) for (const m of text.matchAll(new RegExp(roll.pattern.source, 'gi'))) {
        let type = m.groups?.type?.toLowerCase();
        if (type === 'damage' || type === 'heal' || type === 'healing') {
          for (const c of parseConfig(m.groups.config ?? '', { multiple: true })) {
            const parts = c.formula ? [String(c.formula)] : [];
            const types = c.type ? String(c.type).replaceAll('/', '|').split('|') : [];
            let temporary = types.includes('temporary');
            for (const value of c.values) {
              const lower = value.toLowerCase();
              if (lower in ds.CONFIG.damageTypes) types.push(lower);
              else if (TEMP_WORDS.has(lower)) temporary = true;
              else if (!['scaling', 'aoe', 'heal', 'healing', 'value'].includes(lower)) parts.push(value);
            }
            const formula = resolve(parts.join(' '), rollData);
            out.add(type === 'damage' ? damageSignature(formula, types) : healSignature(formula, temporary));
          }
          continue;
        }
        const c = parseConfig(m.groups.config ?? '');
        let gain = GAIN_TYPES.has(type) ? type : (c.type ?? null);
        const parts = c.formula ? [String(c.formula)] : [];
        for (const value of c.values) {
          const lower = value.toLowerCase();
          if (GAIN_TYPES.has(lower)) gain = lower;
          else if (GAIN_ALIASES[lower]) gain = GAIN_ALIASES[lower];
          else parts.push(value);
        }
        if (gain) out.add(gainSignature(gain, resolve(parts.join(' '), rollData)));
      }
      if (applyEffect?.pattern) for (const m of text.matchAll(new RegExp(applyEffect.pattern.source, 'gi'))) {
        const c = parseConfig(m.groups?.config ?? '');
        if (c.status) out.add(applySignature(c.status));
        for (const value of c.values) {
          const status = CONFIG.statusEffects.find((s) => s.id === value.toLowerCase());
          if (status) out.add(applySignature(status.id));
        }
      }
    }
  }
  _cache.set(ability, out);
  setTimeout(() => _cache.delete(ability), 2000);
  return out;
};

export const effectSignature = (ability, effect) => {
  const rollData = rollDataOf(ability);
  switch (effect.type) {
    case 'dsct.flatDamage':
      return damageSignature(resolve(effect.flatDamage?.value, rollData), effect.flatDamage?.types ?? []);
    case 'dsct.flatHeal': {
      const h = effect.flatHeal ?? {};
      if (h.spendRecovery) return null;
      const formula = h.amountType === 'recoveryValue' ? '@recoveries.recoveryValue' : h.amountFormula;
      return healSignature(resolve(formula, rollData), !!h.tempStamina);
    }
    case 'dsct.flatResource':
      return gainSignature(effect.flatResource?.type, String(effect.flatResource?.amount ?? ''));
    case 'dsct.flatApplied':
      return effect.flatApplied?.statusId ? applySignature(effect.flatApplied.statusId) : null;
    default:
      return null;
  }
};

export const derivedSignatures = (ability) => new Set(
  Array.from(ability?.system?.effects?.contents ?? [])
    .filter((e) => e.id.startsWith(DERIVED))
    .map((e) => effectSignature(ability, e))
    .filter(Boolean));
