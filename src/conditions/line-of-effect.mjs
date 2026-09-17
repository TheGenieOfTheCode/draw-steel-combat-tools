import { registerEffectFlag } from '../effect-flag-picker.mjs';
import { armCoverImmunity, disarmCoverImmunity, getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const FLAG_ROOT = `flags.${M}.loe`;

export function registerLineOfEffectFlags() {
  const def = (name, extra = {}) => ({
    key: `${FLAG_ROOT}.${name}`,
    category: 'lineOfEffect',
    label: `DSCT.effectFlags.loe.${name}.label`,
    description: `DSCT.effectFlags.loe.${name}.description`,
    values: `DSCT.effectFlags.loe.${name}.values`,
    ...extra,
  });

  registerEffectFlag('actor', def('blocksForEnemies'));
  registerEffectFlag('actor', def('rangeCap', { type: 'override', value: '2' }));
  registerEffectFlag('actor', def('coverGrantsImmunity'));
}

const ABILITY_PART = 'abilityUse'.padEnd(16, '0');

function _rolledTargets(message) {
  const parts = Array.from(message?.system?.parts ?? []).map(p => (Array.isArray(p) ? p[1] : p));
  const actors = new Map();
  for (const part of parts) {
    for (const roll of Array.from(part?.rolls ?? [])) {
      const uuid = roll?.options?.target;
      if (!uuid || actors.has(uuid)) continue;
      const actor = fromUuidSync(uuid);
      if (actor?.documentName === 'Actor') actors.set(uuid, actor);
    }
  }
  return [...actors.values()];
}

async function _armForMessage(message) {
  if (!game.users.activeGM?.isSelf) return;
  if (!message?.system?.parts?.get?.(ABILITY_PART)) return;

  const sourceToken = message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null;
  if (!sourceToken) return;

  for (const actor of _rolledTargets(message)) {
    try { await armCoverImmunity(actor, sourceToken); }
    catch (err) { console.warn('DSCT | cover immunity | could not arm', actor?.name, err); }
  }
}

function _wrapTakeDamage() {
  const owners = new Set();
  for (const model of Object.values(CONFIG.Actor?.dataModels ?? {})) {
    let proto = model?.prototype;
    while (proto) {
      if (Object.prototype.hasOwnProperty.call(proto, 'takeDamage')) { owners.add(proto); break; }
      proto = Object.getPrototypeOf(proto);
    }
  }
  for (const proto of owners) {
    const original = proto.takeDamage;
    if (typeof original !== 'function' || original.__dsctCoverImmunity) continue;
    async function takeDamage(...args) {
      try { return await original.apply(this, args); }
      finally { disarmCoverImmunity(this.parent).catch(() => {}); }
    }
    takeDamage.__dsctCoverImmunity = true;
    proto.takeDamage = takeDamage;
  }
  if (!owners.size) console.warn('DSCT | cover immunity | takeDamage not found, immunity will not clear itself');
}

export function registerCoverImmunity() {
  _wrapTakeDamage();
  Hooks.on('createChatMessage', (message) => {
    if (!getSetting('abilityAutomationEnabled')) return;
    _armForMessage(message).catch(err => console.warn('DSCT | cover immunity |', err));
  });
}
