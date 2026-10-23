import { DSTD, DSTD_ROW, registerPanelDecorator } from '../ctlib.mjs';
import { getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const L = (k, data) => data ? game.i18n.format(`DSCT.panel.potency.${k}`, data) : game.i18n.localize(`DSCT.panel.potency.${k}`);

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

function pillShift(override, effectId) {
  return (Array.isArray(override?.dsctPills) ? override.dsctPills : [])
    .filter(p => p.kind === 'potency' && p.enabled !== false && (!p.effectId || p.effectId === effectId))
    .reduce((n, p) => n + (Number(p.amount) || 0), 0);
}

export function potencyVerdict({ actor, characteristic, value, condition = 'failure', shift = 0 }) {
  if (!actor?.system?.checkPotency || condition === 'always') return null;
  const potency = value + shift;
  const failed = actor.system.checkPotency(potency, characteristic);
  const chr = actor.system.characteristics?.[characteristic];
  return { potency, resist: (chr?.value ?? 0) + (chr?.resist ?? 0), failed, affected: condition === 'success' ? !failed : failed };
}

const tierOf = (message, state, targetKey) => Number(state.tierOverrides?.[targetKey]?.tier)
  || Number((message.system?.parts?.contents ?? []).find(p => p.type === 'abilityResult')?.tier) || null;

function verdictTag(row, button, verdict, characteristic) {
  row.querySelectorAll('.dsct-potency-verdict').forEach(e => e.remove());
  row.classList.toggle('dsct-potency-resisted', !verdict.affected);
  row.dataset.dsctPotencyVerdict = verdict.affected ? 'affected' : 'resisted';
  const abbr = ds.CONFIG.characteristics[characteristic]?.rollKey ?? characteristic;
  const tag = document.createElement('span');
  tag.className = `dsct-potency-verdict ${verdict.affected ? 'is-affected' : 'is-resisted'}`;
  tag.textContent = L(verdict.affected ? 'Affected' : 'Resisted');
  tag.dataset.tooltip = L('Tooltip', { chr: abbr, potency: verdict.potency, resist: verdict.resist });
  button.append(tag);
}

function decorate(message, panel) {
  if (getSetting('potencyChecks') === 'off') return;
  const state = message.getFlag(DSTD, 'state');
  const ability = abilityOf(message);
  if (!state || !ability) return;
  const effects = ability.system?.power?.effects;
  for (const targetRow of panel.querySelectorAll(DSTD_ROW)) {
    const targetKey = targetRow.dataset.targetKey;
    if (!targetKey || targetKey === 'selected-token') continue;
    const target = (state.targets ?? []).find(t => String(t.tokenUuid ?? t.actorUuid ?? '').replace(/\./g, '__') === targetKey);
    const actor = targetActorOf(target);
    if (!actor) continue;
    const override = state.tierOverrides?.[targetKey] ?? null;
    const tier = tierOf(message, state, targetKey);
    for (const row of targetRow.querySelectorAll(`.${DSTD}-action-row`)) {
      const native = row.querySelector('button[data-dstd-action="applyStatus"]');
      const cond = row.querySelector('[data-dsct-dstd-cond]');
      const flat = row.querySelector('[data-dsct-flat-cond-key]');
      let found = null;
      if (native || cond) {
        const effectId = native?.dataset.effectId ?? cond.dataset.dsctDstdCond.split(':cond:').pop();
        const rowTier = Number(native?.dataset.tier) || tier;
        const effect = (effects ?? []).find(e => e.type === 'applied' && tierEffects(e, rowTier).has(effectId));
        const potency = effect && powerEffectPotency(ability, effect, rowTier, effectId);
        if (potency) found = { button: native ?? cond, potency, effectId };
      } else if (flat) {
        const effectId = flat.dataset.dsctFlatCondKey.split(':flatCond:').pop();
        const effect = effects?.get?.(effectId);
        const potency = effect && flatPotency(ability, effect);
        if (potency) found = { button: flat, potency, effectId };
      }
      if (!found) continue;
      const verdict = potencyVerdict({ actor, ...found.potency, shift: pillShift(override, found.effectId) });
      if (verdict) verdictTag(row, found.button, verdict, found.potency.characteristic);
    }
  }
}

export function registerDstdPotency() {
  if (!game.modules.get(DSTD)?.active) return;
  registerPanelDecorator({ id: 'combat-tools-potency', priority: 250, retry: [300], decorate: ({ message, panel }) => decorate(message, panel) });
}
