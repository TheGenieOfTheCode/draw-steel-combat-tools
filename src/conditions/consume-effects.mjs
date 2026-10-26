import { isPrimaryGM, safeDelete } from '../ctlib.mjs';
import { normalizeCollection } from '../helpers.mjs';
import { registerEffectFlag } from '../effect-flag-picker.mjs';

const M = 'draw-steel-combat-tools';
const KEY = `flags.${M}.consumeOn`;

const consumeOn = (effect) => effect.getFlag?.(M, 'consumeOn')
  ?? [...(effect.system?.changes ?? []), ...(effect.changes ?? [])].find(c => c?.key === KEY)?.value ?? null;

function _rollKind(message) {
  const parts = normalizeCollection(message.system?.parts);
  const rolled = [...(message.rolls ?? []), ...parts.flatMap(p => [...(p?.rolls ?? [])])].some(r => r instanceof ds.rolls.PowerRoll);
  if (!rolled) return null;
  const use = parts.find(p => p?.type === 'abilityUse');
  const ability = use?.abilityUuid ? fromUuidSync(use.abilityUuid) : null;
  return { ability: !!ability, strike: !!ability?.system?.keywords?.has?.('strike') };
}

async function _consume(message) {
  if (!isPrimaryGM()) return;
  const kind = _rollKind(message);
  if (!kind) return;
  const actor = message.speakerActor ?? ChatMessage.getSpeakerActor?.(message.speaker);
  if (!actor) return;
  for (const effect of actor.allApplicableEffects?.() ?? actor.effects) {
    const on = consumeOn(effect);
    if (!on || effect.disabled) continue;
    if (on === 'powerRoll' || (on === 'abilityRoll' && kind.ability) || (on === 'strike' && kind.strike)) await safeDelete(effect);
  }
}

const OWN_GRANT_MS = 4000;

async function _tempStaminaEnded(actor, changes, before) {
  if (!isPrimaryGM()) return;
  const temp = foundry.utils.getProperty(changes, 'system.stamina.temporary');
  if (temp === undefined) return;
  const gone = Number(temp) <= 0;
  const replaced = !gone && before != null && Number(temp) > before;
  if (!gone && !replaced) return;
  for (const effect of actor.allApplicableEffects?.() ?? actor.effects) {
    if (consumeOn(effect) !== 'tempStamina') continue;
    if (replaced && Date.now() - (effect._stats?.createdTime ?? 0) < OWN_GRANT_MS) continue;
    await safeDelete(effect);
  }
}

export function registerConsumeEffects() {
  Hooks.on('preUpdateActor', (actor, changes, options) => {
    if (foundry.utils.hasProperty(changes, 'system.stamina.temporary')) options.dsctTempBefore = actor.system?.stamina?.temporary ?? 0;
  });
  Hooks.on('updateActor', (actor, changes, options) => {
    _tempStaminaEnded(actor, changes, options?.dsctTempBefore).catch(err => console.warn('DSCT | consume effects |', err));
  });
  for (const group of ['actor', 'ability']) {
    registerEffectFlag(group, {
      key: KEY, category: 'duration', type: 'override', value: 'powerRoll',
      label: 'DSCT.effectFlags.consumeOn.label',
      description: 'DSCT.effectFlags.consumeOn.description',
      values: 'DSCT.effectFlags.consumeOn.values',
    });
  }
  Hooks.on('createChatMessage', (message) => {
    _consume(message).catch(err => console.warn('DSCT | consume effects |', err));
  });
}
