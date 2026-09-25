import { getSetting, safeDelete, safeUpdate, safeCreateEmbedded, hasSightToToken, getModuleApi , dropKey } from '../helpers.mjs';
import { coverWithBurrow as hasCover } from './burrow.mjs';
import { playDetected } from './detected-flash.mjs';
import { stealthTraits, observerBlocksHiding, coverCountingCreatures, widestCover, forbiddenToHide } from './stealth-traits.mjs';

const M = 'draw-steel-combat-tools';

const PARKED = {
  INVISIBLE: 'dsctUnusedInvisible',
  BURROW: 'dsctUnusedBurrow',
};

const RULES = 'Compendium.draw-steel-combat-tools.rules.JournalEntry.DSCTrulesJournal.JournalEntryPage.';

export async function syncHiddenRule() {
  const mode = sneakMode();
  const hidden = CONFIG.statusEffects?.dsctHidden;
  if (hidden) hidden.rule = RULES + (mode === 'off' ? 'DSCTruleHidden00' : 'DSCTruleHiddenSk');

  if (game.ready) {
    for (const id of Object.keys(STEALTH_STATUSES)) {
      const status = CONFIG.statusEffects?.[id];
      if (!status?.rule) continue;
      const page = await fromUuid(status.rule).catch(() => null);
      if (page) continue;
      console.warn(`DSCT | stealth | rules page missing for ${id}, tooltip disabled: ${status.rule}`);
      delete status.rule;
    }
  }

  if (!game.users.activeGM?.isSelf || !game.ready) return;
  for (const actor of game.actors) {
    if (isObjectActor(actor)) continue;
    const hiddenNow = actor.effects.some(e => e.statuses?.has(HIDDEN));
    const sneakingNow = actor.effects.filter(e => e.statuses?.has(SNEAKING));
    if (mode === 'off' && sneakingNow.length) await _dropSneaking(actor);
    else if (mode !== 'off' && hiddenNow && !sneakingNow.length) await _grantSneaking(actor);
    else {
      
      const description = _sneakingDescription();
      for (const effect of sneakingNow) if (effect.description !== description) await safeUpdate(effect, { description });
    }
  }
}

export const STEALTH_STATUSES = {
  dsctHidden: {
    name: 'DSCT.status.hidden',
    img: 'icons/svg/cowled.svg',
    rule: RULES + 'DSCTruleHidden00',
  },
  dsctConcMagic: {
    name: 'DSCT.status.concealedMagical',
    img: 'icons/svg/aura.svg',
    rule: RULES + 'DSCTruleConcMag0',
  },
  dsctConcMundane: {
    name: 'DSCT.status.concealedMundane',
    img: 'icons/svg/light-off.svg',
    rule: RULES + 'DSCTruleConcMun0',
  },
};

export const SNEAKING = 'dsctSneaking';

const _sneakingDescription = () =>
  `@Embed[${RULES}${sneakMode() === 'ends' ? 'DSCTruleSneakEnd' : 'DSCTruleSneakPth'} inline]`;

const _sneakingData = () => ({
  name: game.i18n.localize('DSCT.status.sneaking'),
  img: 'icons/svg/walk.svg',
  type: 'base',
  statuses: [SNEAKING],
  description: _sneakingDescription(),
  system: { changes: [{ key: 'system.movement.multiplier', type: 'multiply', value: 0.5, phase: 'initial', priority: null }] },
  flags: { [M]: { effectType: 'sneaking' } },
});

async function _grantSneaking(actor) {
  if (!actor || actor.statuses?.has(SNEAKING)) return;
  await safeCreateEmbedded(actor, 'ActiveEffect', [_sneakingData()]);
}

export function sneakMode() {
  const v = getSetting('stealthSneakHouseRule');
  if (v === true) return 'path';
  return ['path', 'ends'].includes(v) ? v : 'off';
}

const _isSneaking = (token) => !!token?.actor?.statuses?.has(SNEAKING);

async function _dropSneaking(actor) {
  const ids = actor?.effects?.filter(e => e.statuses?.has(SNEAKING)).map(e => e.id) ?? [];
  for (const id of ids) await safeDelete(actor.effects.get(id));
}

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

const BLUR = 'dsctConcealBlur';

const _blurAt = (strength) => Math.max(0.1, strength * (canvas?.stage?.scale?.x || 1));

function _syncConcealmentBlur(token) {
  const mesh = token?.mesh;
  if (!mesh) return;

  const strength = Number(getSetting('concealmentBlur'));
  
  
  const wanted = isConcealed(token) && Number.isFinite(strength) && strength > 0;
  const existing = token[BLUR] ?? null;

  try {
    if (!wanted) {
      if (!existing) return;
      mesh.filters = (mesh.filters ?? []).filter(f => f !== existing);
      token[BLUR] = null;
      existing.destroy?.();
      return;
    }

    if (existing) {
      existing.blur = _blurAt(strength);
      existing.padding = _blurAt(strength) * 2;
      if (!(mesh.filters ?? []).includes(existing)) mesh.filters = [...(mesh.filters ?? []), existing];
      return;
    }

    const filter = new PIXI.BlurFilter(_blurAt(strength));
    
    filter.padding = _blurAt(strength) * 2;
    mesh.filters = [...(mesh.filters ?? []), filter];
    token[BLUR] = filter;
  } catch (err) {
    console.warn('DSCT | stealth | could not sync the concealment blur:', err);
  }
}

export function resyncConcealmentBlur() {
  for (const token of canvas?.tokens?.placeables ?? []) _syncConcealmentBlur(token);
}

function _rescaleConcealmentBlur() {
  const strength = Number(getSetting('concealmentBlur'));
  if (!Number.isFinite(strength) || strength <= 0) return;
  const scaled = _blurAt(strength);
  for (const token of canvas?.tokens?.placeables ?? []) {
    const filter = token[BLUR];
    if (!filter) continue;
    filter.blur = scaled;
    filter.padding = scaled * 2;
  }
}

function _syncActorTokens(actor) {
  for (const token of actor?.getActiveTokens?.() ?? []) {
    _syncInvisibilityFilter(token);
    _syncConcealmentBlur(token);
  }
}

export function registerStealthSystem() {
  if (!getSetting('stealthSystemEnabled')) return;

  CONFIG.specialStatusEffects.INVISIBLE = PARKED.INVISIBLE;
  CONFIG.specialStatusEffects.BURROW = PARKED.BURROW;

  for (const [id, value] of Object.entries(STEALTH_STATUSES)) {
    CONFIG.statusEffects[id] = { id, _id: id.padEnd(16, '0'), order: 2, ...value };
  }

  registerHiddenTracking();
  Hooks.once('ready', syncHiddenRule);
  Hooks.on('deleteCombat', (combat) => clearStealthEffects(combat));

  Hooks.on('createActiveEffect', (effect) => {
    if (!game.users.activeGM?.isSelf || !effect?.statuses?.has(HIDDEN) || sneakMode() === 'off') return;
    const actor = effect.parent;
    if (actor?.documentName !== 'Actor' || isObjectActor(actor)) return;
    _grantSneaking(actor).catch(() => {});
  });

  Hooks.on('deleteActiveEffect', (effect) => {
    if (!game.users.activeGM?.isSelf || !effect?.statuses?.has(HIDDEN)) return;
    const actor = effect.parent;
    if (actor?.documentName === 'Actor' && !actor.effects.some(e => e.statuses?.has(HIDDEN))) _dropSneaking(actor);
  });
  Hooks.on('updateActiveEffect', _sweepExpiredEcho);
  Hooks.on('canvasPan', _rescaleConcealmentBlur);
  Hooks.on('canvasReady', resyncConcealmentBlur);
  Hooks.on('drawToken', (token) => {
    _syncInvisibilityFilter(token);
    _syncConcealmentBlur(token);
  });
  for (const hook of ['createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const actor = effect?.parent;
      if (actor?.documentName === 'Actor') _syncActorTokens(actor);
    });
  }
}

const FLAG = 'hiddenFrom';
const FOUND_BY = 'foundBy';

const _hiddenEffect = (token) =>
  token?.actor?.appliedEffects?.find(e => e.statuses?.has(HIDDEN)) ?? null;

export function enemyCombatants(token) {
  if (!token || !game.combat) return [];

  const side = token.document.disposition;
  const out = [];
  for (const combatant of game.combat.combatants) {
    const other = combatant.token?.object;
    if (!other || other.id === token.id) continue;
    if (other.document.disposition === side) continue;
    out.push(other.id);
  }
  return out;
}

export const isObjectActor = (actor) =>
  !!(actor?.system?.isObject || actor?.type === 'object');

export const isObjectToken = (token) => isObjectActor(token?.actor);

export const objectFoundBy = (token) => {
  const list = _hiddenEffect(token)?.getFlag(M, FOUND_BY);
  return new Set(Array.isArray(list) ? list : []);
};

export function hiddenFrom(token) {
  const effect = _hiddenEffect(token);
  if (!effect) return new Set();

  if (isObjectToken(token)) {
    const found = objectFoundBy(token);
    return new Set((canvas.tokens?.placeables ?? [])
      .filter(t => t.id !== token.id && t.actor && !found.has(t.id))
      .map(t => t.id));
  }

  const ids = effect.getFlag(M, FLAG);
  if (Array.isArray(ids)) return new Set(ids);
  return new Set(enemyCombatants(token));
}

export async function markObjectFound(token, ids) {
  const effect = _hiddenEffect(token);
  if (!effect) return [];
  const found = objectFoundBy(token);
  const added = [...new Set(ids)].filter(id => id && !found.has(id));
  if (!added.length) return [];

  for (const id of added) found.add(id);
  await safeUpdate(effect, { [`flags.${M}.${FOUND_BY}`]: [...found] });
  Hooks.callAll('dsct.stealthChanged');
  return added;
}

export const isHiddenFrom = (token, observer) =>
  !!observer && hiddenFrom(token).has(observer.id);

export const isObserving = (observer, token) =>
  !!observer && !!token && !isConcealed(token) && hasSightToToken(observer, token);

export const canHideFrom = (observer, token, traits = null) => {
  if (!observer || !token) return false;
  if (observerBlocksHiding(observer, token)) return false;
  traits ??= stealthTraits(token);
  if (traits.cannotHide) return false;
  if (traits.maintain === 'always') return true;
  if (isConcealed(token) || !hasSightToToken(observer, token)) return true;
  if (hasCover(observer, token)) return true;
  return !!traits.coverCounts && coverCountingCreatures(observer, token, traits.coverCounts);
};

const _canHideFrom = canHideFrom;

export const stealthActive = () => !!game.combat;

const _outOfCombat = () =>
  ui.notifications.warn(game.i18n.localize('DSCT.notice.stealth.outOfCombat'));

const _enemiesOnScene = (token) => {
  if (!token || !game.combat) return [];

  const disposition = token.document.disposition;
  const defeated = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const out = [];

  for (const combatant of game.combat.combatants) {
    const other = combatant.token?.object;
    if (!other?.actor || other.id === token.id) continue;
    if (other.document.disposition === disposition) continue;
    if (other.actor.system?.isObject) continue;
    if (combatant.isDefeated || other.actor.statuses?.has(defeated)) continue;
    out.push(other);
  }
  return out;
};

const _hideTraits = (token, opts = {}) => {
  const traits = stealthTraits(token);
  return {
    ...traits,
    hideWhileObserved: traits.hideWhileObserved || !!opts.whileObserved,
    coverCounts: widestCover(traits.coverCounts, opts.coverCounts),
  };
};

export function proposeHide(token, opts = {}) {
  if (!token || !stealthActive()) return [];
  const traits = _hideTraits(token, opts);
  return _enemiesOnScene(token)
    .filter(other => _canHideFrom(other, token, traits))
    .filter(other => traits.hideWhileObserved || !isObserving(other, token))
    .map(other => other.id);
}

export function hideCandidates(token) {
  if (!token || !stealthActive()) return [];
  if (forbiddenToHide(token)) return [];
  return _enemiesOnScene(token).filter(other => !observerBlocksHiding(other, token));
}

export const hideTraitsOf = (token, opts = {}) => _hideTraits(token, opts);

export function observingEnemies(token, opts = {}) {
  if (!token || !stealthActive()) return [];
  const traits = _hideTraits(token, opts);
  if (traits.hideWhileObserved) return [];
  return _enemiesOnScene(token)
    .filter(other => _canHideFrom(other, token, traits))
    .filter(other => isObserving(other, token))
    .map(other => other.id);
}

export const WAS_HIDDEN = 'dsctWasHidden';

const _echoEffect = (token) =>
  token?.actor?.appliedEffects?.find(e => e.getFlag(M, 'effectType') === WAS_HIDDEN) ?? null;

const _turnCombatantId = (actor) =>
  game.combat?.combatant?.id ?? game.combat?.getCombatantsByActor(actor)[0]?.id ?? null;

async function _rememberEcho(token, observerIds) {
  const actor = token?.actor;
  if (!actor || !observerIds.length || !game.combat) return;

  const existing = _echoEffect(token);
  const merged = [...new Set([...(existing?.getFlag(M, FLAG) ?? []), ...observerIds])];

  if (existing) {
    return safeUpdate(existing, { [`flags.${M}.${FLAG}`]: merged, 'start.combatant': _turnCombatantId(actor) });
  }

  const start = ds.documents.DrawSteelActiveEffect.getEffectStart();
  start.combatant = _turnCombatantId(actor);

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

const PENDING = 'revealPending';
const DETAIL = 'revealDetail';
export const EVENT_REASONS = ['movement', 'ability', 'forced', 'teleport'];

export const revealPendingReasons = (token) =>
  Object.keys(_hiddenEffect(token)?.getFlag(M, PENDING) ?? {});

export function revealPendingSince(token) {
  const stamps = Object.values(_hiddenEffect(token)?.getFlag(M, PENDING) ?? {}).filter(v => typeof v === 'number');
  return stamps.length ? Math.min(...stamps) : null;
}

export const revealPromptMs = () => Math.max(1, Number(getSetting('stealthRevealPromptSeconds')) || 10) * 1000;

const UNDOABLE = ['movement', 'forced', 'teleport'];
const SNAPSHOT = 'revealSnapshot';

const _snapshotReveal = (token, ids, reason) =>
  safeUpdate(token.document, { [`flags.${M}.${SNAPSHOT}`]: { hiddenFrom: ids, reason, at: Date.now() } });

const _forgetSnapshot = (token) =>
  token.document.getFlag(M, SNAPSHOT)
    ? safeUpdate(token.document, { flags: { [M]: { [SNAPSHOT]: dropKey() } } })
    : Promise.resolve();

async function _restoreFromSnapshot(token) {
  const snap = token.document.getFlag(M, SNAPSHOT);
  if (!snap?.hiddenFrom?.length) return false;
  const current = _hiddenEffect(token) ? [...hiddenFrom(token)] : [];

  const echo = _echoEffect(token);
  const same = (a, b) => [...a].sort().join() === [...b].sort().join();
  if (echo && same(echo.getFlag(M, FLAG) ?? [], snap.hiddenFrom)) await safeDelete(echo);

  await setHiddenFrom(token, [...new Set([...current, ...snap.hiddenFrom])]);
  await _forgetSnapshot(token);
  Hooks.callAll('dsct.stealthChanged');
  return true;
}

export async function markRevealed(token, reason, detail = null) {

  if (isObjectToken(token)) return false;
  const effect = _hiddenEffect(token);
  if (!effect || !stealthActive() || !hiddenFrom(token).size) return false;

  if (getSetting('stealthAutoReveal')) {
    const ids = [...hiddenFrom(token)];
    if (UNDOABLE.includes(reason)) await _snapshotReveal(token, ids, reason);
    await _finishReveal(token, ids, reason, detail);
    return true;
  }

  if (effect.getFlag(M, PENDING)?.[reason]) return true;
  const update = { [`flags.${M}.${PENDING}.${reason}`]: Date.now() };
  if (detail) update[`flags.${M}.${DETAIL}.${reason}`] = detail;
  await safeUpdate(effect, update);
  Hooks.callAll('dsct.stealthChanged');
  return true;
}

export const dismissReveal = (token) => clearRevealPending(token, EVENT_REASONS);

async function _sweepStalePrompts(force = false) {
  if (!game.users.activeGM?.isSelf || !canvas.ready) return;
  const limit = revealPromptMs();
  for (const hider of canvas.tokens.placeables) {
    const since = revealPendingSince(hider);
    if (since === null) continue;
    if (force || Date.now() - since > limit) await dismissReveal(hider);
  }
}

export async function clearRevealPending(token, reasons) {
  const effect = _hiddenEffect(token);
  const pending = effect?.getFlag(M, PENDING);
  if (!pending) return;
  const drop = reasons.filter(r => r in pending);
  if (!drop.length) return;
  const pendingDrops = {};
  const detailDrops = {};
  for (const r of drop) {
    pendingDrops[r] = dropKey();
    if (effect.getFlag(M, DETAIL)?.[r]) detailDrops[r] = dropKey();
  }
  const update = { flags: { [M]: { [PENDING]: pendingDrops } } };
  if (Object.keys(detailDrops).length) update.flags[M][DETAIL] = detailDrops;
  await safeUpdate(effect, update);
  Hooks.callAll('dsct.stealthChanged');
}

export async function setHiddenFrom(token, ids, { keepPending = false } = {}) {

  if (isObjectToken(token)) return [...hiddenFrom(token)];

  const before = hiddenFrom(token);

  
  
  
  const blocked = (id) => {
    const observer = canvas.tokens?.get(id);
    return !!observer && observerBlocksHiding(observer, token);
  };

  const list = [...new Set(ids)].filter(Boolean).filter(id => {
    if (!blocked(id)) return true;
    if (getSetting('debugMode')) console.log(`DSCT | stealth | ${canvas.tokens.get(id)?.name} cannot be hidden from, dropped from ${token.name}'s hidden list.`);
    return false;
  });

  if (list.length && !stealthActive()) { _outOfCombat(); return []; }

  const effect = _hiddenEffect(token);

  
  
  const dropped = [...before].filter(id => !list.includes(id) && !blocked(id));

  if (!list.length) {
    if (effect) await safeDelete(effect);
    await _rememberEcho(token, dropped);
    return [];
  }

  if (!keepPending) await _forgetSnapshot(token);

  if (effect) {

    const mine = { [FLAG]: list };
    if (!keepPending && effect.getFlag(M, PENDING)) mine[PENDING] = dropKey();
    if (!keepPending && effect.getFlag(M, DETAIL)) mine[DETAIL] = dropKey();
    await safeUpdate(effect, { flags: { [M]: mine } });
  }
  else await token.actor?.toggleStatusEffect?.(HIDDEN, { active: true })
    .then(() => safeUpdate(_hiddenEffect(token), { [`flags.${M}.${FLAG}`]: list }));

  await _rememberEcho(token, dropped);
  return list;
}

export const hide = (token, ids = null, opts = {}) => {
  if (!stealthActive()) { _outOfCombat(); return Promise.resolve([]); }
  return setHiddenFrom(token, ids ?? proposeHide(token, opts));
};

export async function clearStealthEffects(combat = null) {
  if (!game.users.activeGM?.isSelf) return 0;

  const actors = new Map();
  for (const combatant of combat?.combatants ?? []) {
    if (combatant.actor && !isObjectActor(combatant.actor)) actors.set(combatant.actor.uuid, combatant.actor);
  }
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor && !isObjectActor(token.actor)) actors.set(token.actor.uuid, token.actor);
  }

  let cleared = 0;
  for (const actor of actors.values()) {
    const ids = actor.effects
      .filter(e => e.statuses?.has(HIDDEN) || e.statuses?.has(SNEAKING) || e.getFlag(M, 'effectType') === WAS_HIDDEN)
      .map(e => e.id);
    if (!ids.length) continue;

    const done = await actor.deleteEmbeddedDocuments('ActiveEffect', ids)
      .catch(err => { console.warn('DSCT | stealth | could not clear on combat end:', err); return null; });
    if (done) cleared += ids.length;
  }

  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.document.getFlag(M, SNAPSHOT)) await _forgetSnapshot(token).catch(() => {});
  }

  if (cleared) Hooks.callAll('dsct.stealthChanged');
  return cleared;
}

export async function reveal(token, observerIds = null) {
  if (isObjectToken(token)) {
    return markObjectFound(token, observerIds ?? (canvas.tokens?.placeables ?? []).map(t => t.id));
  }
  if (!observerIds) return setHiddenFrom(token, []);
  const remaining = [...hiddenFrom(token)].filter(id => !observerIds.includes(id));
  return setHiddenFrom(token, remaining, { keepPending: true });
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
    if (!_hiddenEffect(hider) || isObjectToken(hider)) continue;
    const reasons = revealPendingReasons(hider);
    const traits = stealthTraits(hider);
    for (const id of hiddenFrom(hider)) {
      const observer = canvas.tokens.get(id);
      if (!observer) continue;
      const reason = reasons[0] ?? (_canHideFrom(observer, hider, traits) ? null : 'seen');
      if (!reason) continue;
      pairs.push({ hiderId: hider.id, observerId: observer.id, reason });
    }
  }
  return pairs;
}

function _revealWhy(reason, detail) {
  if (!reason) return '';
  const key = `DSCT.chat.stealth.reason.${reason}`;
  if (!game.i18n.has(key)) return '';
  const withDetail = `${key}Named`;
  const text = detail && game.i18n.has(withDetail)
    ? game.i18n.format(withDetail, { detail })
    : game.i18n.localize(key);
  return ` ${text}`;
}

async function _finishReveal(hider, ids, reason = null, detail = null) {
  if (!ids.length) return [];
  await reveal(hider, ids);
  for (const id of ids) _announceDetected(id, hider.id);

  const by = ids.map(id => canvas.tokens.get(id)?.name ?? id).join(', ');
  ChatMessage.create({
    content: game.i18n.format('DSCT.chat.stealth.spotted', { name: hider.name, by, why: _revealWhy(reason, detail) }),
    whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
  });

  Hooks.callAll('dsct.stealthChanged');
  return ids;
}

export const revealWithReason = (hider, ids, reason, detail = null) =>
  _finishReveal(hider, ids.filter(id => hiddenFrom(hider).has(id)), reason, detail);

export async function confirmSpot(hiderId, observerIds = null) {
  const hider = canvas.tokens.get(hiderId);
  if (!hider) return [];

  const pairs = pendingSpots().filter(p => p.hiderId === hiderId);
  const pending = pairs.map(p => p.observerId);
  const ids = (observerIds ?? pending).filter(id => pending.includes(id));
  const reason = pairs.find(p => ids.includes(p.observerId))?.reason ?? null;
  const detail = reason ? (_hiddenEffect(hider)?.getFlag(M, DETAIL)?.[reason] ?? null) : null;
  return _finishReveal(hider, ids, reason, detail);
}

export async function recheckHidden(moved) {
  if (!moved || !stealthActive()) return;

  const trace = [];
  for (const hider of canvas.tokens?.placeables ?? []) {
    if (!_hiddenEffect(hider) || isObjectToken(hider)) continue;
    const concealed = isConcealed(hider);
    const traits = stealthTraits(hider);

    for (const id of hiddenFrom(hider)) {
      const observer = canvas.tokens.get(id);
      if (!observer) continue;
      if (_canHideFrom(observer, hider, traits)) {
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

const _writesStealthFlag = (effect) =>
  [...(effect?.system?.changes ?? []), ...(effect?.changes ?? [])]
    .some(c => String(c?.key ?? '').includes(`flags.${M}.stealth.`));

export async function enforceBlockedObservers() {
  if (!stealthActive() || !game.users.activeGM?.isSelf) return 0;
  let stripped = 0;
  for (const hider of canvas.tokens?.placeables ?? []) {
    if (!_hiddenEffect(hider) || isObjectToken(hider)) continue;
    const ids = [...hiddenFrom(hider)];
    const kept = ids.filter(id => {
      const observer = canvas.tokens.get(id);
      return !observer || !observerBlocksHiding(observer, hider);
    });
    if (kept.length === ids.length) continue;
    stripped += ids.length - kept.length;
    await setHiddenFrom(hider, kept);
  }
  return stripped;
}

function _watchQualifyingStatuses() {
  const qualifying = (effect) =>
    effect?.statuses?.has('invisible')
    || effect?.statuses?.has('burrow')
    || CONCEALED.some(id => effect?.statuses?.has(id))
    || !!effect?.flags?.[M]?.stealth
    || _writesStealthFlag(effect);

  for (const hook of ['createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const actor = effect?.parent;
      if (actor?.documentName !== 'Actor') return;
      if (!qualifying(effect)) return;
      for (const token of actor.getActiveTokens?.() ?? []) recheckHidden(token);
      enforceBlockedObservers().catch(err => console.warn('DSCT | stealth |', err));
    });
  }
}

const _abilityKeepsHidden = (item, token) =>
  !!item?.getFlag?.(M, 'keepsHidden')
  || !!item?.system?.effects?.contents?.some(e => e.type === 'dsct.hide')
  || item?.name?.trim().toLowerCase() === 'hide'
  || stealthTraits(token).keepsHidden;

const _footprintCentres = (token, step) => {
  const GS = canvas.grid.size;
  const w = Math.max(1, Math.round(token.document.width));
  const h = Math.max(1, Math.round(token.document.height));
  const out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push({ x: step.x + (i + 0.5) * GS, y: step.y + (j + 0.5) * GS });
  return out;
};

export const squareOccupied = (token, step) => {
  const GS = canvas.grid.size;
  const others = canvas.tokens.placeables.filter(t => t.id !== token.id && t.actor && !t.document.hidden);
  const inside = (p, d) =>
    p.x > d.x && p.x < d.x + Math.max(1, Math.round(d.width)) * GS
    && p.y > d.y && p.y < d.y + Math.max(1, Math.round(d.height)) * GS;
  return _footprintCentres(token, step).every(p => others.some(t => inside(p, t.document)));
};

function _movementKept(token, options) {
  const keeps = stealthTraits(token).movementKeeps;
  if (!keeps.size) return null;
  if (keeps.has('any')) return 'kept';
  if (!keeps.has('occupied')) return null;

  const movement = options?._movement?.[token.id];
  const passed = movement?.passed?.waypoints ?? [];
  if (!passed.length) return null;
  const origin = movement.origin ?? {};
  const walked = token.document.getCompleteMovementPath(passed)
    .filter(step => !(step.x === origin.x && step.y === origin.y));
  if (!walked.length) return null;
  return walked.every(step => squareOccupied(token, step)) ? 'kept:occupied' : null;
}

async function _afterWillingMove(token, options, userId) {
  if (userId !== game.userId) return null;
  if (window._dsctFMActive || window._dsctTeleportActive) return null;
  if (!stealthActive()) return null;

  if (isObjectToken(token)) return null;

  if (options?.isUndo || options?.isPaste) {
    if (_hiddenEffect(token)) await clearRevealPending(token, UNDOABLE);
    if (await _restoreFromSnapshot(token)) return 'restored';
    return _hiddenEffect(token) ? 'undone' : null;
  }

  if (!_hiddenEffect(token)) { await _forgetSnapshot(token); return null; }

  const kept = _movementKept(token, options);
  if (kept) return kept;

  if (sneakMode() === 'off' || !_isSneaking(token)) {
    await markRevealed(token, 'movement');
    return 'movement';
  }

  const seers = [...hiddenFrom(token)]
    .map(id => canvas.tokens.get(id))
    .filter(observer => observer && !_canHideFrom(observer, token))
    .map(observer => observer.id);
  if (!seers.length) return 'sneaking';
  if (!getSetting('stealthAutoReveal')) return 'sneaking';
  await _snapshotReveal(token, seers, 'movement');
  await _finishReveal(token, seers, 'sneaking');
  return 'seen';
}

function _watchAbilityUse() {
  Hooks.on('createChatMessage', async (message) => {
    if (!message.isAuthor || !stealthActive()) return;
    const parts = message.system?.parts?.contents;
    const use = parts?.find(p => p.type === 'abilityUse');
    if (!use?.abilityUuid) return;

    const token = canvas.tokens?.get(message.speaker?.token);
    if (!token) return;

    const item = await fromUuid(use.abilityUuid).catch(() => null);
    if (!item) return;
    if (_abilityKeepsHidden(item, token)) return;
    await markRevealed(token, 'ability', item.name);
  });
}

export function registerHiddenTracking() {
  _watchQualifyingStatuses();
  _watchAbilityUse();

  setInterval(() => { _sweepStalePrompts().catch(() => {}); }, 1000);
  Hooks.on('canvasReady', () => { _sweepStalePrompts(true).catch(() => {}); });

  Hooks.on('updateToken', async (doc, change, options, userId) => {
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
      const outcome = await _afterWillingMove(token, options, userId);
      if (outcome) trace?.push(`${doc.name}: ${outcome}`);
      note(trace ? (trace.join(' / ') || 'ran, nothing to do') : 'bailed before looking');
    } catch (err) {
      note(`THREW ${err.message}`);
    }
  });
}
