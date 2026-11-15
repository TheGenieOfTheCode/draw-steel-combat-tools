import { getSetting } from '../helpers.mjs';
import { setTip, tipFor } from '../chat-tips.mjs';
import { canPickTargetsFor, setFoundryTargets } from '../ability-automation/target-picker.mjs';
import { canPickAreaFor } from '../ability-automation/area-picker.mjs';
import { _repickForMessage } from './dstd-compat.mjs';
import { notePendingDice } from '../ability-automation/roll-dialog-hooks.mjs';
import { undoAll12, armAutoApply } from './apply-12.mjs';
import { takeProvenance } from './dstd-roll-pills.mjs';

const M = 'draw-steel-combat-tools';
const L = (k, data) => game.i18n.format(`DSCT.apply12.${k}`, data ?? {});
const lib = () => globalThis.ctlib ?? game.modules.get('draw-steel-ctlib')?.api ?? {};
const RESULT_TYPES = new Set(['targetResult', 'abilityResult']);

const partsOf = (message) => Array.from(message?.system?.parts?.contents ?? []);
const usePartOf = (message) => partsOf(message).find((p) => p.type === 'abilityUse') ?? null;
const resultPartsOf = (message) => partsOf(message).filter((p) => RESULT_TYPES.has(p.type));
const abilityOf = (message) => {
  const uuid = usePartOf(message)?.abilityUuid;
  return uuid ? fromUuidSync(uuid) : null;
};
const isPowerRoll = (r) => r instanceof ds.rolls.PowerRoll;

export const canUpdateTargets = (message) => {
  const ability = abilityOf(message);
  return !!ability?.system?.power?.roll?.enabled && !!ability.actor
    && resultPartsOf(message).some((p) => Array.from(p.rolls ?? []).some(isPowerRoll));
};

const canRepick = (ability) => {
  if (!getSetting('abilityTargetingEnabled') || !ability) return false;
  if (ability.getFlag?.(M, 'areaFilter')?.carriers) return true;
  return canPickAreaFor(ability) || canPickTargetsFor(ability);
};

const repicks = (ability) => canRepick(ability) && (!game.user.targets.size || !!getSetting('alwaysRepickTargets'));

const hasWork = (ability) => game.user.targets.size > 0 || canRepick(ability);

async function chooseTargets(message, ability) {
  const current = [...game.user.targets];
  if (!repicks(ability)) return current;
  if (current.length) setFoundryTargets([]);
  const picked = await _repickForMessage(message);
  if (picked === null) { if (current.length) setFoundryTargets(current); return null; }
  return picked?.length ? picked : current;
}

function dialogConfigFor(message, ability, tokens) {
  const sys = ability.system;
  const PowerRoll = ds.rolls.PowerRoll;
  const base = PowerRoll.baseDiceFormula(sys.power.roll.dice);
  const formula = sys.power.roll.formula ? `${base} + ${sys.power.roll.formula}` : base;
  const coreResource = ability.actor.system.coreResource ?? {};
  const spent = Object.values(usePartOf(message)?.spendAmounts ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);
  const current = Number(foundry.utils.getProperty(coreResource.target, coreResource.path)) || 0;
  return {
    ability,
    dsctUpdateTargets: message.id,
    rollLockBypass: true,
    context: {
      resource: { current: current + (Number(sys.resource) || 0) + spent, value: sys.resource, name: coreResource.name },
      formula: PowerRoll.replaceFormulaData(formula, ability.getRollData(), { missing: '0' }),
      modifiers: sys.getActorModifiers(),
      targets: Object.fromEntries(tokens.map((t) => [t.id, {
        tokenUuid: t.document.uuid, uuid: t.actor?.uuid ?? '', modifiers: sys.getTargetModifiers(t),
      }])),
      ...(usePartOf(message)?.spendAmounts ? { spend: { ...usePartOf(message).spendAmounts } } : {}),
    },
    window: { title: L('updateTargetsTitle', { ability: ability.name }) },
  };
}

async function buildParts(message, ability, config, fd) {
  const sys = ability.system;
  const PowerRoll = ds.rolls.PowerRoll;
  const original = resultPartsOf(message).flatMap((p) => Array.from(p.rolls ?? [])).find(isPowerRoll);
  const dice = () => foundry.dice.Roll.fromData(original.toJSON()).terms[0];
  const spend = Object.values(usePartOf(message)?.spendAmounts ?? fd.spend ?? {});
  const rolls = [];
  const targetOf = new Map();
  for (const context of fd.rolls ?? []) {
    const target = context.target;
    delete context.target;
    const roll = new PowerRoll(config.context.formula, {}, {
      flavor: game.i18n.localize(PowerRoll.TYPES.ability.label),
      criticalThreshold: sys.power.roll.criticalThreshold,
      ...context,
    });
    roll.terms[0] = dice();
    await roll.evaluate({ allowInteractive: false });
    rolls.push(roll);
    if (target) targetOf.set(roll, target);
  }
  rolls.sort((a, b) => a.product - b.product);
  const parts = [];
  for (const roll of rolls) {
    const id = foundry.utils.randomID();
    const part = {
      _id: id, type: 'targetResult', rolls: [roll], tier: roll.product, abilityUuid: ability.uuid,
      targetUuid: targetOf.get(roll), tokenUuid: roll.options.tokenUuid,
    };
    for (const effect of sys.power.effects.documentsByType.damage) {
      const damage = effect.toDamageRoll(roll.product, { damageSelection: fd.damage, spend, squadMinions: roll.options.minions });
      if (!damage) continue;
      await damage.evaluate();
      part.rolls.push(damage);
    }
    delete roll.options.minions;
    delete roll.options.tokenUuid;
    part.rolls = part.rolls.map((r) => JSON.stringify(r.toJSON()));
    parts.push(part);
  }
  return parts;
}

const _running = new Set();

export async function updateTargets12(message) {
  const ability = abilityOf(message);
  if (!ability || !canUpdateTargets(message) || _running.has(message.id)) return false;
  if (!game.user.isGM && !message.isOwner) return false;
  _running.add(message.id);
  try {
    const tokens = await chooseTargets(message, ability);
    if (!tokens) return false;
    if (!tokens.length) { ui.notifications.warn(L('noTargets')); return false; }
    setFoundryTargets(tokens);
    const config = dialogConfigFor(message, ability, tokens);
    const fd = await ds.applications.apps.AbilityConfigurationDialog.create(config);
    notePendingDice(null);
    if (!fd) return false;
    const fresh = () => game.messages.get(message.id) ?? message;
    if ((lib().undoableEntries?.(fresh()) ?? []).length) await undoAll12(fresh());
    const parts = await buildParts(fresh(), ability, config, fd);
    if (!parts.length) return false;
    const uuids = tokens.map((t) => t.document.uuid);
    const flags = fresh().flags?.[M] ?? {};
    const update = { [`flags.${M}.useTargets`]: uuids };
    const provenance = takeProvenance(ability.uuid);
    if (provenance) update[`flags.${M}.rollPills`] = provenance;
    for (const id of resultPartsOf(fresh()).map((p) => p.id)) {
      update[`system.parts.-=${id}`] = null;
      if (flags.resultMods?.[id]) update[`flags.${M}.resultMods.-=${id}`] = null;
      if (flags.applied12?.[id]) update[`flags.${M}.applied12.-=${id}`] = null;
    }
    for (const part of parts) update[`system.parts.${part._id}`] = part;
    update[`flags.${M}.autoApplied`] = false;
    armAutoApply(message.id);
    await fresh().update(update);
    return true;
  } finally {
    _running.delete(message.id);
  }
}

const _busy = new Set();

function setState(wrap, message) {
  const btn = wrap.querySelector('button.dsct-update-targets');
  const ability = abilityOf(message);
  const off = !ability || !hasWork(ability);
  const repick = !off && repicks(ability);
  const label = L(repick ? 'repickTargets' : 'updateTargets');
  btn.innerHTML = `<i class="fa-solid fa-bullseye" inert></i> ${foundry.utils.escapeHTML(label)}`;
  btn.setAttribute('aria-label', label);
  btn.disabled = off || _busy.has(message.id);
  setTip(wrap, tipFor(off ? 'updateTargets12Off' : repick ? 'repickTargets12' : 'updateTargets12'));
}

const refreshButtons = () => {
  for (const wrap of document.querySelectorAll('.dsct-update-targets-wrap')) {
    const message = game.messages.get(wrap.closest('[data-message-id]')?.dataset.messageId);
    if (message) setState(wrap, message);
  }
};

export function updateTargetsButton(message) {
  if (!canUpdateTargets(message) || (!game.user.isGM && !message.isOwner)) return null;
  const wrap = document.createElement('span');
  wrap.className = 'dsct-update-targets-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dsct-update-targets';
  wrap.append(btn);
  setState(wrap, message);
  btn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.disabled) return;
    _busy.add(message.id);
    btn.disabled = true;
    try { await updateTargets12(game.messages.get(message.id) ?? message); } finally {
      _busy.delete(message.id);
      refreshButtons();
    }
  });
  return wrap;
}

export function registerUpdateTargets12() {
  Hooks.on('targetToken', (user) => { if (user === game.user) refreshButtons(); });
}
