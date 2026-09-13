import { getSetting, safeDelete, safeUpdate, safeCreateEmbedded, hasSightToToken, getModuleApi } from '../helpers.mjs';
import { coverWithBurrow as hasCover } from './burrow.mjs';
import { playDetected } from './detected-flash.mjs';

const M = 'draw-steel-combat-tools';

const PARKED = {
  INVISIBLE: 'dsctUnusedInvisible',
  BURROW: 'dsctUnusedBurrow',
};

export const STEALTH_STATUSES = {
  dsctHidden: {
    name: 'DSCT.status.hidden',
    img: 'icons/svg/cowled.svg',
  },
  dsctConcMagic: {
    name: 'DSCT.status.concealedMagical',
    img: 'icons/svg/aura.svg',
  },
  dsctConcMundane: {
    name: 'DSCT.status.concealedMundane',
    img: 'icons/svg/light-off.svg',
  },
};

export const HIDDEN = 'dsctHidden';
export const CONCEALED = ['dsctConcMagic', 'dsctConcMundane'];

export const isConcealed = (token) => {
  const statuses = token?.actor?.statuses;
  if (!statuses) return false;
  return statuses.has('invisible') || CONCEALED.some(id => statuses.has(id));
};

function _syncInvisibilityFilter(token) {
  if (!token?.mesh) return;
  const wanted = token.actor?.statuses?.has('invisible') ?? false;
  try {
    token._configureFilterEffect(PARKED.INVISIBLE, wanted);
  } catch (err) {
    console.warn('DSCT | stealth | could not sync the invisibility filter:', err);
  }
}

function _syncActorTokens(actor) {
  for (const token of actor?.getActiveTokens?.() ?? []) _syncInvisibilityFilter(token);
}

export function registerStealthSystem() {
  if (!getSetting('stealthSystemEnabled')) return;

  CONFIG.specialStatusEffects.INVISIBLE = PARKED.INVISIBLE;
  CONFIG.specialStatusEffects.BURROW = PARKED.BURROW;

  for (const [id, value] of Object.entries(STEALTH_STATUSES)) {
    CONFIG.statusEffects[id] = { id, _id: id.padEnd(16, '0'), order: 2, ...value };
  }

  registerHiddenTracking();
  Hooks.on('deleteCombat', (combat) => clearStealthEffects(combat));
  Hooks.on('updateActiveEffect', _sweepExpiredEcho);
  Hooks.on('drawToken', _syncInvisibilityFilter);
  for (const hook of ['createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const actor = effect?.parent;
      if (actor?.documentName === 'Actor') _syncActorTokens(actor);
    });
  }
}

const FLAG = 'hiddenFrom';

const _hiddenEffect = (token) =>
  token?.actor?.appliedEffects?.find(e => e.statuses?.has(HIDDEN)) ?? null;

export function hiddenFrom(token) {
  const effect = _hiddenEffect(token);
  if (!effect) return new Set();

  const ids = effect.getFlag(M, FLAG);
  if (Array.isArray(ids)) return new Set(ids);
  return new Set(canvas.tokens.placeables.filter(t => t.id !== token.id).map(t => t.id));
}

export const isHiddenFrom = (token, observer) =>
  !!observer && hiddenFrom(token).has(observer.id);

export const canHideFrom = (observer, token) =>
  isConcealed(token) || !hasSightToToken(observer, token) || hasCover(observer, token);

const _canHideFrom = canHideFrom;

export const stealthActive = () => !!game.combat;

const _outOfCombat = () =>
  ui.notifications.warn(game.i18n.localize('DSCT.notice.stealth.outOfCombat'));

export function proposeHide(token) {
  if (!token || !stealthActive()) return [];
  const disposition = token.document.disposition;
  return canvas.tokens.placeables
    .filter(other => other.id !== token.id && other.actor)
    .filter(other => other.document.disposition !== disposition)
    .filter(other => _canHideFrom(other, token))
    .map(other => other.id);
}

export const WAS_HIDDEN = 'dsctWasHidden';

const _echoEffect = (token) =>
  token?.actor?.appliedEffects?.find(e => e.getFlag(M, 'effectType') === WAS_HIDDEN) ?? null;

async function _rememberEcho(token, observerIds) {
  const actor = token?.actor;
  if (!actor || !observerIds.length || !game.combat) return;

  const existing = _echoEffect(token);
  const merged = [...new Set([...(existing?.getFlag(M, FLAG) ?? []), ...observerIds])];

  if (existing) return safeUpdate(existing, { [`flags.${M}.${FLAG}`]: merged });

  const start = ds.documents.DrawSteelActiveEffect.getEffectStart();
  start.combatant = game.combat.getCombatantsByActor(actor)[0];

  await safeCreateEmbedded(actor, 'ActiveEffect', [{
    name: game.i18n.localize('DSCT.status.wasHidden'),
    img: 'icons/svg/cowled.svg',
    type: 'base',
    
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.NEVER ?? 0,
    system: { end: { roll: '' } },
    changes: [],
    start,
    duration: { expiry: 'turnEnd' },
    flags: { [M]: { effectType: WAS_HIDDEN, [FLAG]: merged } },
  }]);
}

export function hiddenEchoFrom(token) {
  const effect = _echoEffect(token);
  if (!effect || effect.duration?.expired) return new Set();
  return new Set(effect.getFlag(M, FLAG) ?? []);
}

export const hasHiddenEcho = (token, observer) =>
  !!observer && hiddenEchoFrom(token).has(observer.id);

function _sweepExpiredEcho(effect) {
  if (!game.users.activeGM?.isSelf) return;
  if (effect?.getFlag(M, 'effectType') !== WAS_HIDDEN) return;
  if (!effect.duration?.expired) return;
  safeDelete(effect);
}

export async function setHiddenFrom(token, ids) {
  const before = hiddenFrom(token);
  const list = [...new Set(ids)].filter(Boolean);

  
  if (list.length && !stealthActive()) { _outOfCombat(); return []; }

  const effect = _hiddenEffect(token);

  
  const dropped = [...before].filter(id => !list.includes(id));

  if (!list.length) {
    if (effect) await safeDelete(effect);
    await _rememberEcho(token, dropped);
    return [];
  }

  if (effect) await safeUpdate(effect, { [`flags.${M}.${FLAG}`]: list });
  else await token.actor?.toggleStatusEffect?.(HIDDEN, { active: true })
    .then(() => safeUpdate(_hiddenEffect(token), { [`flags.${M}.${FLAG}`]: list }));

  await _rememberEcho(token, dropped);
  return list;
}

export const hide = (token, ids = null) => {
  if (!stealthActive()) { _outOfCombat(); return Promise.resolve([]); }
  return setHiddenFrom(token, ids ?? proposeHide(token));
};

export async function clearStealthEffects(combat = null) {
  if (!game.users.activeGM?.isSelf) return 0;

  const actors = new Map();
  for (const combatant of combat?.combatants ?? []) {
    if (combatant.actor) actors.set(combatant.actor.uuid, combatant.actor);
  }
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor) actors.set(token.actor.uuid, token.actor);
  }

  let cleared = 0;
  for (const actor of actors.values()) {
    const ids = actor.effects
      .filter(e => e.statuses?.has(HIDDEN) || e.getFlag(M, 'effectType') === WAS_HIDDEN)
      .map(e => e.id);
    if (!ids.length) continue;

    const done = await actor.deleteEmbeddedDocuments('ActiveEffect', ids)
      .catch(err => { console.warn('DSCT | stealth | could not clear on combat end:', err); return null; });
    if (done) cleared += ids.length;
  }

  if (cleared) Hooks.callAll('dsct.stealthChanged');
  return cleared;
}

export async function reveal(token, observerIds = null) {
  if (!observerIds) return setHiddenFrom(token, []);
  const remaining = [...hiddenFrom(token)].filter(id => !observerIds.includes(id));
  return setHiddenFrom(token, remaining);
}

function _announceDetected(spotterId, hiderId) {
  playDetected(spotterId, hiderId);
  const socket = getModuleApi(false)?.socket;
  socket?.executeForOthers?.('dsct.detected', spotterId, hiderId);
}

export function pendingSpots() {
  const pairs = [];
  if (!stealthActive()) return pairs;
  for (const hider of canvas.tokens?.placeables ?? []) {
    if (!_hiddenEffect(hider)) continue;
    for (const id of hiddenFrom(hider)) {
      const observer = canvas.tokens.get(id);
      if (!observer || _canHideFrom(observer, hider)) continue;
      pairs.push({ hiderId: hider.id, observerId: observer.id });
    }
  }
  return pairs;
}

export async function confirmSpot(hiderId, observerIds = null) {
  const hider = canvas.tokens.get(hiderId);
  if (!hider) return [];

  const pending = pendingSpots().filter(p => p.hiderId === hiderId).map(p => p.observerId);
  const ids = (observerIds ?? pending).filter(id => pending.includes(id));
  if (!ids.length) return [];

  await reveal(hider, ids);
  for (const id of ids) _announceDetected(id, hiderId);

  const by = ids.map(id => canvas.tokens.get(id)?.name ?? id).join(', ');
  ChatMessage.create({
    content: game.i18n.format('DSCT.chat.stealth.spotted', { name: hider.name, by }),
    whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
  });

  Hooks.callAll('dsct.stealthChanged');
  return ids;
}

export async function recheckHidden(moved) {
  if (!moved || !stealthActive()) return;

  const trace = [];
  for (const hider of canvas.tokens?.placeables ?? []) {
    if (!_hiddenEffect(hider)) continue;
    const concealed = isConcealed(hider);

    for (const id of hiddenFrom(hider)) {
      const observer = canvas.tokens.get(id);
      if (!observer) continue;
      if (_canHideFrom(observer, hider)) {
        trace.push(`${hider.name}: still hidden from ${observer.name} (concealed=${concealed}, cover=${hasCover(observer, hider)}, noLineOfEffect=${!hasSightToToken(observer, hider)})`);
      } else {
        trace.push(`${hider.name}: would be spotted by ${observer.name}, waiting on the Director`);
      }
    }
  }

  Hooks.callAll('dsct.stealthChanged');
  return trace;
}

const _moveLog = [];
export const moveLog = () => [..._moveLog];

function _watchQualifyingStatuses() {
  const qualifying = (effect) =>
    effect?.statuses?.has('invisible')
    || effect?.statuses?.has('burrow')
    || CONCEALED.some(id => effect?.statuses?.has(id));

  for (const hook of ['createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const actor = effect?.parent;
      if (actor?.documentName !== 'Actor') return;
      if (!qualifying(effect)) return;
      for (const token of actor.getActiveTokens?.() ?? []) recheckHidden(token);
    });
  }
}

export function registerHiddenTracking() {
  _watchQualifyingStatuses();

  Hooks.on('updateToken', async (doc, change) => {
    const keys = Object.keys(change).filter(k => k !== '_id').join(', ');
    const note = (what) => {
      if (!getSetting('debugMode')) return;
      _moveLog.push(`${doc.name}: ${keys || '(nothing)'} -> ${what}`);
      if (_moveLog.length > 12) _moveLog.shift();
    };

    if (!('x' in change || 'y' in change || 'elevation' in change)) return note('not a move');

    const token = doc.object;
    if (!token) return note('no placeable');

    try {
      
      
      if (doc.rendered && token.movementAnimationPromise) {
        await token.movementAnimationPromise.catch(() => {});
      }

      const trace = await recheckHidden(token);
      note(trace ? (trace.join(' / ') || 'ran, nothing to do') : 'bailed before looking');
    } catch (err) {
      note(`THREW ${err.message}`);
    }
  });
}
