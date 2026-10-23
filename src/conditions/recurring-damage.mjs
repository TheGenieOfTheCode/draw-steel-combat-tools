import { getSetting, getTokenById, applyDamage, undoDamage } from '../helpers.mjs';
import { isPrimaryGM, safeDelete, safeUpdate } from '../ctlib.mjs';
import { registerEffectFlag } from '../effect-flag-picker.mjs';

const M = 'draw-steel-combat-tools';
const PREFIX = `flags.${M}.recurring.`;
const IGNORES = `flags.${M}.recurringIgnoresImmunity`;
const L = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));
const typeLabel = (type) => L(ds.CONFIG.damageTypes?.[type]?.label ?? type);

export const RECURRING_PREFIX = PREFIX;
export const RECURRING_IGNORES = IGNORES;

const changesOf = (effect) => effect?.system?.changes ?? effect?.changes ?? [];

export function recurringOf(effect, rollData = {}) {
  const changes = changesOf(effect);
  const ignores = changes.some((c) => c.key === IGNORES && String(c.value) !== 'false');
  const out = [];
  for (const c of changes) {
    if (!String(c.key ?? '').startsWith(PREFIX)) continue;
    let amount = Number(c.value);
    if (!Number.isFinite(amount)) {
      try { amount = new Roll(String(c.value), rollData).evaluateSync({ strict: false }).total; } catch { amount = 0; }
    }
    amount = Math.max(0, Math.floor(amount));
    if (amount) out.push({ type: c.key.slice(PREFIX.length) || 'untyped', amount, ignores });
  }
  return out;
}

export const hasRecurring = (effect) => changesOf(effect).some((c) => String(c.key ?? '').startsWith(PREFIX));

async function dealRecurring(combatant) {
  const actor = combatant.actor;
  const mode = getSetting('recurringDamage');
  if (!actor || mode === 'off' || combatant.isDefeated) return;
  const rollData = actor.getRollData?.() ?? {};
  const entries = [];
  for (const effect of actor.appliedEffects ?? []) {
    for (const r of recurringOf(effect, rollData)) entries.push({ ...r, source: effect.name });
  }
  if (!entries.length) return;

  const record = mode === 'auto' ? await applyEntries(actor, entries) : null;
  const esc = foundry.utils.escapeHTML;
  const lines = entries.map((r) => `<p><strong>${esc(r.source)}</strong>: ${L('DSCT.chat.recurring.line', { n: r.amount, type: r.type === 'untyped' ? '' : typeLabel(r.type) }).replace(/\s{2,}/g, ' ')}`
    + `${r.ignores ? ` ${L('DSCT.chat.recurring.ignores')}` : ''}</p>`).join('');
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: combatant.token ?? getTokenById(combatant.tokenId)?.document }),
    content: `<div class="dsct-recurring-card"><h4 class="dsct-recurring-title"><i class="fa-solid fa-heart-crack"></i> ${esc(L('DSCT.chat.recurring.title'))}</h4>${lines}</div>`,
    flags: { [M]: { recurring: { actorUuid: actor.uuid, entries, record } } },
  });
}

async function applyEntries(actor, entries) {
  let record = null;
  for (const r of entries) {
    const prev = await applyDamage(actor, r.amount, undefined, { damageType: r.type, ignoreImmunity: r.ignores, source: r.source });
    record ??= { prevValue: prev.prevValue, prevTemp: prev.prevTemp, prevSquadHP: prev.prevSquadHP ?? null, squadGroupUuid: prev.squadGroup?.uuid ?? null };
  }
  return record;
}

const _started = new Set();
export async function onCombatantTurnStart(combatant) {
  if (!combatant?.combat || !isPrimaryGM()) return;
  const key = `${combatant.combat.id}:${combatant.id}:${combatant.combat.round}`;
  if (_started.has(key)) return;
  _started.add(key);
  if (_started.size > 500) _started.clear();
  try { await dealRecurring(combatant); }
  catch (err) { console.error('DSCT | recurring damage failed', err); }
}

function renderButtons(message, html) {
  const data = message.getFlag(M, 'recurring');
  if (!data || html.querySelector('.dsct-recurring-btn')) return;
  if (!(game.user.isGM || fromUuidSync(data.actorUuid)?.isOwner)) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dsct-recurring-btn';
  const undo = !!data.record;
  btn.innerHTML = undo
    ? `<i class="fa-solid fa-rotate-left"></i> ${L('DSCT.button.undoRecurring')}`
    : `<i class="fa-solid fa-heart-crack"></i> ${L('DSCT.button.applyRecurring')}`;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const actor = await fromUuid(data.actorUuid);
    if (!actor) return;
    if (!undo) {
      const record = await applyEntries(actor, data.entries ?? []);
      await safeUpdate(message, { [`flags.${M}.recurring.record`]: record });
      return;
    }
    const squadGroup = data.record.squadGroupUuid ? await fromUuid(data.record.squadGroupUuid).catch(() => null) : null;
    await undoDamage(actor, { prevTemp: data.record.prevTemp, prevValue: data.record.prevValue, prevSquadHP: data.record.prevSquadHP, squadGroup });
    await safeDelete(message);
  });
  (html.querySelector('.dsct-recurring-card') ?? html.querySelector('.message-content') ?? html).append(btn);
}

export function registerRecurringDamage() {
  Hooks.once('setup', () => {
    for (const type of ['untyped', ...Object.keys(ds.CONFIG.damageTypes ?? {})]) {
      const label = type === 'untyped' ? 'untyped' : typeLabel(type).toLowerCase();
      registerEffectFlag('actor', {
        key: `${PREFIX}${type}`, category: 'recurring', type: 'add', value: '5',
        label: L('DSCT.effectFlags.recurring.type.label', { type: label }),
        description: L('DSCT.effectFlags.recurring.type.description', { type: label }),
        values: 'DSCT.effectFlags.recurring.type.values',
      });
    }
    registerEffectFlag('actor', {
      key: IGNORES, category: 'recurring', type: 'override', value: 'true',
      label: 'DSCT.effectFlags.recurring.ignoresImmunity.label',
      description: 'DSCT.effectFlags.recurring.ignoresImmunity.description',
      values: 'DSCT.effectFlags.recurring.ignoresImmunity.values',
    });
  });
  Hooks.on('combatTurnChange', (combat, _prior, current) => {
    const combatant = combat.combatants.get(current?.combatantId);
    if (combatant) onCombatantTurnStart(combatant);
  });
  Hooks.on('renderChatMessageHTML', (message, html) => renderButtons(message, html));
}
