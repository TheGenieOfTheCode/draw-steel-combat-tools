import { getSetting, safeDelete, getModuleApi } from '../helpers.mjs';
import { executeAsDirector, isPrimaryGM } from '../ctlib.mjs';
import { runSourcePicker } from '../ability-automation/target-picker.mjs';

const M = 'draw-steel-combat-tools';

export const SOURCED_STATUSES = new Set(['frightened', 'taunted', 'grabbed']);

export const GRABBER_IMG = 'modules/draw-steel-combat-tools/assets/Icons/grabber.svg';
const OLD_GRABBER_IMG = 'icons/magic/control/debuff-chains-shackle-movement-red.webp';

export const GRABBED_DESCRIPTION = '<p>You have speed 0, cannot be force moved except by the creature, object, or effect that has you grabbed, and cannot use the Knockback maneuver. You take a bane on abilities that do not target the creature, object, or effect that has you grabbed.</p><p>You can attempt to escape using the <strong>Escape Grab</strong> maneuver. If you teleport, or if either you or the creature grabbing you is force moved so that you are no longer adjacent, the grab ends.</p><p>If the creature grabbing you moves, they bring you with them.</p>';

const sourceKey = (statusId) => `system.statuses.${statusId}.sources`;
const sourcesActive = () => getSetting('conditionsEnabled');

export const toActor = (x) => {
  if (!x) return null;
  if (typeof x === 'string') x = fromUuidSync(x);
  if (x instanceof Actor) return x;
  return x.actor ?? null;
};

export const statusSourceUuids = (actor, statusId) => [...(actor?.system?.statuses?.[statusId]?.sources ?? [])];

export const tokenOfActor = (actor) => {
  if (!actor) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return canvas.tokens?.controlled.find(t => t.actor === actor) ?? actor.getActiveTokens?.()[0] ?? null;
};

export const statusSourceTokens = (actor, statusId) =>
  statusSourceUuids(actor, statusId).map(u => tokenOfActor(fromUuidSync(u))).filter(Boolean);

export const statusSourceData = (actor, statusId) => {
  if (!actor?.statuses?.has(statusId)) return null;
  const uuid = statusSourceUuids(actor, statusId)[0];
  if (!uuid) return null;
  const source = fromUuidSync(uuid);
  const token = tokenOfActor(source);
  return { sourceUuid: uuid, sourceActorId: source?.id ?? null, sourceTokenId: token?.id ?? null, sourceName: token?.name ?? source?.name ?? null };
};

export const effectSourceUuids = (data, statusId) => {
  const changes = data?.system?.changes ?? data?.changes ?? [];
  return changes.filter(c => c.key === sourceKey(statusId)).map(c => c.value).filter(Boolean);
};

const sourceChange = (statusId, uuid) => ({ key: sourceKey(statusId), type: 'add', value: uuid });

let _context = null;

export const withStatusSource = async (source, fn) => {
  const prev = _context;
  _context = { source: toActor(source)?.uuid ?? null };
  try { return await fn(); } finally { _context = prev; }
};

export const resolveStatusSource = async (statusId, { known = null, victims = [] } = {}) => {
  const knownActor = toActor(known);
  if (knownActor) return knownActor;
  const victimUuids = new Set(victims.map(v => toActor(v)?.uuid).filter(Boolean));
  const candidates = (canvas.tokens?.controlled ?? []).filter(t => t.actor && !victimUuids.has(t.actor.uuid));
  if (candidates.length === 1) return candidates[0].actor;
  if (!canvas?.ready) return null;
  const condition = game.i18n.localize(CONFIG.statusEffects.find(s => s.id === statusId)?.name ?? statusId);
  const victimNames = victims.map(v => tokenOfActor(toActor(v))?.name ?? toActor(v)?.name).filter(Boolean);
  const picked = await runSourcePicker({
    exclude: victimUuids,
    anyToken: true,
    hint: game.i18n.format('DSCT.notice.status.chooseSource', { condition, name: victimNames.join(', ') || '?' }),
  });
  return picked?.actor ?? null;
};

const _describe = (statusId, effectData, sourceActor) => {
  if (statusId === 'grabbed') effectData.description = GRABBED_DESCRIPTION;
  const token = tokenOfActor(sourceActor);
  const sourceName = token?.name ?? sourceActor?.name;
  if (sourceName) effectData.name = `${game.i18n.localize(effectData.name)} [${sourceName}]`;
};

async function _sourcedPrompt(wrapped, statusId, effectData) {
  if (!SOURCED_STATUSES.has(statusId) || !sourcesActive()) return wrapped(statusId, effectData);
  const ctx = _context ?? {};
  const source = await resolveStatusSource(statusId, { known: ctx.source, victims: ctx.parent ? [ctx.parent] : [] });
  effectData.system ??= {};
  effectData.system.changes = (effectData.system.changes ?? []).filter(c => c.key !== sourceKey(statusId));
  if (!source) {
    foundry.utils.setProperty(effectData, `flags.${M}.sourceCancelled`, true);
    return;
  }
  effectData.system.changes.push(sourceChange(statusId, source.uuid));
  _describe(statusId, effectData, source);
}

async function _fromStatusEffect(wrapped, statusId, effectData, options = {}) {
  if (!SOURCED_STATUSES.has(statusId) || !sourcesActive()) return wrapped(statusId, effectData, options);
  const prev = _context;
  _context = { source: toActor(options.dsctSource)?.uuid ?? prev?.source ?? null, parent: options.parent ?? prev?.parent ?? null };
  try { return await wrapped(statusId, effectData, options); } finally { _context = prev; }
}

const _cancelNotice = (statusId) => {
  const condition = game.i18n.localize(CONFIG.statusEffects.find(s => s.id === statusId)?.name ?? statusId);
  ui.notifications.info(game.i18n.format('DSCT.notice.status.cancelled', { condition }));
};

const _missingSource = (effect) => {
  for (const id of effect.statuses ?? []) {
    if (SOURCED_STATUSES.has(id) && !effectSourceUuids(effect, id).length) return id;
  }
  return null;
};

const _originActor = (effect) => {
  if (!effect.origin) return null;
  try {
    const doc = fromUuidSync(effect.origin);
    return doc instanceof Actor ? doc : (doc?.actor ?? doc?.parent?.actor ?? null);
  } catch { return null; }
};

function _guardSourceless(effect, data, options, userId) {
  if (!sourcesActive() || userId !== game.user.id) return;
  if (!(effect.parent instanceof Actor)) return;
  if (effect.getFlag(M, 'sourceCancelled')) {
    for (const id of effect.statuses ?? []) if (SOURCED_STATUSES.has(id)) { _cancelNotice(id); break; }
    return false;
  }
  const statusId = _missingSource(effect);
  if (!statusId) return;
  const actor = effect.parent;
  const origin = _originActor(effect);
  if (origin && origin !== actor) {
    effect.updateSource({ 'system.changes': [...effect.system.changes, sourceChange(statusId, origin.uuid)] });
    return;
  }
  const raw = effect.toObject();
  (async () => {
    const source = await resolveStatusSource(statusId, { victims: [actor] });
    if (!source) return _cancelNotice(statusId);
    raw.system.changes = [...(raw.system.changes ?? []), sourceChange(statusId, source.uuid)];
    _describe(statusId, raw, source);
    await createStatusEffect(actor, raw, options);
  })();
  return false;
}

export const createStatusEffect = async (actor, data, options = {}) => {
  const opts = { keepId: true, ...options };
  if (actor.isOwner) return (await actor.createEmbeddedDocuments('ActiveEffect', [data], opts))[0] ?? null;
  const socket = getModuleApi(false)?.socket;
  if (!socket) return null;
  return await executeAsDirector(socket, 'dsct.createStatusEffect', actor.uuid, data, opts);
};

export const createStatusEffectAsDirector = async (actorUuid, data, options) => {
  const actor = await fromUuid(actorUuid);
  if (!actor) return null;
  const [created] = await actor.createEmbeddedDocuments('ActiveEffect', [data], options);
  return created?.id ?? null;
};

const resolveEnd = (end) => {
  if (!end || end === 'unlimited') return {};
  return { duration: { expiry: ds?.CONFIG?.effectEnds?.[end]?.expiryEvent ?? end } };
};

export const applyStatus = async (target, statusId, { source = null, end = null, flags = null, data = null } = {}) => {
  const actor = toActor(target);
  const status = CONFIG.statusEffects.find(s => s.id === statusId);
  if (!actor || !status) return null;

  if (statusId === 'grabbed' && sourcesActive() && getSetting('grabEnabled')) {
    const grabber = await resolveStatusSource('grabbed', { known: source, victims: [actor] });
    const grabberTok = tokenOfActor(grabber), victimTok = tokenOfActor(actor);
    if (!grabber || !grabberTok || !victimTok) { if (!grabber) _cancelNotice('grabbed'); return null; }
    const { applyGrab } = await import('./grab.mjs');
    await applyGrab(grabberTok, victimTok);
    return actor.effects.get(status._id) ?? null;
  }

  const AE = CONFIG.ActiveEffect.documentClass;
  const effect = await AE.fromStatusEffect(statusId, { parent: actor, dsctSource: source });
  if (effect.getFlag(M, 'sourceCancelled')) { _cancelNotice(statusId); return null; }
  if (end && AE.getEffectStart) {
    const start = AE.getEffectStart();
    start.combatant = game.combat?.getCombatantsByActor(actor)[0]?.id ?? null;
    effect.updateSource({ start });
  }
  effect.updateSource(foundry.utils.mergeObject(resolveEnd(end), { flags: flags ?? {}, ...(data ?? {}) }));

  const existing = status._id ? actor.effects.get(status._id) : null;
  if (existing) await safeDelete(existing);
  return createStatusEffect(actor, effect.toObject(), {});
};

export const removeStatus = async (target, statusId) => {
  const actor = toActor(target);
  if (!actor) return;
  for (const e of actor.effects.filter(e => e.statuses.has(statusId))) await safeDelete(e);
};

const LEGACY = {
  frightened: (e) => e.getFlag(M, 'frightened'),
  taunted:    (e) => e.getFlag(M, 'taunted'),
  grabbed:    (e) => e.getFlag(M, 'grabbed') === true,
};

const _legacySource = (statusId, effect, actor) => {
  if (statusId === 'grabbed') {
    for (const tok of canvas.tokens?.placeables ?? []) {
      const grabber = tok.actor?.effects.find(e => e.getFlag(M, 'grab')?.grabbedId === actor.token?.id
        || e.getFlag(M, 'grab')?.grabbedId === tokenOfActor(actor)?.id);
      if (grabber) return tok.actor;
    }
    return null;
  }
  const { sourceTokenId, sourceActorId } = effect.getFlag(M, statusId) ?? {};
  const tok = sourceTokenId ? canvas.tokens?.get(sourceTokenId) : null;
  return tok?.actor ?? (sourceActorId ? game.actors.get(sourceActorId) : null) ?? (effect.system?.source ? fromUuidSync(effect.system.source) : null);
};

const _actorsToMigrate = () => {
  const seen = new Set();
  const out = [];
  const add = (a) => { if (a && !seen.has(a.uuid)) { seen.add(a.uuid); out.push(a); } };
  for (const a of game.actors) add(a);
  for (const t of canvas.scene?.tokens ?? []) add(t.actor);
  return out;
};

export const migrateLegacyStatuses = async () => {
  if (!isPrimaryGM() || !sourcesActive()) return 0;
  const AE = CONFIG.ActiveEffect.documentClass;
  let converted = 0;
  for (const actor of _actorsToMigrate()) {
    for (const effect of [...actor.effects]) {
      if (effect.getFlag(M, 'grab')?.grabberId && effect.img === OLD_GRABBER_IMG) await effect.update({ img: GRABBER_IMG });
      const statusId = Object.keys(LEGACY).find(id => effect.statuses.size === 0 && LEGACY[id](effect));
      if (!statusId) continue;
      const status = CONFIG.statusEffects.find(s => s.id === statusId);
      const source = _legacySource(statusId, effect, actor);
      if (!status || !source) continue;
      const fresh = await AE.fromStatusEffect(statusId, { parent: actor, dsctSource: source });
      if (fresh.getFlag(M, 'sourceCancelled')) continue;
      const old = effect.toObject();
      fresh.updateSource({
        duration: old.duration, start: old.start, disabled: old.disabled,
        'system.end': old.system?.end ?? fresh.system?.end,
        ...(statusId === 'grabbed' ? { [`flags.${M}.grabbed`]: true } : {}),
      });
      if (actor.effects.get(status._id)) await actor.effects.get(status._id).delete();
      await effect.delete({ dsctGrabTeardown: true });
      await actor.createEmbeddedDocuments('ActiveEffect', [fresh.toObject()], { keepId: true });
      converted++;
    }
  }
  if (converted) {
    console.log(`DSCT | Statuses | converted ${converted} older Combat Tools condition effect(s) to the system's statuses`);
    (await import('./grab.mjs')).refreshGrabTracking();
  }
  return converted;
};

export function registerStatusSources() {
  if (!game.modules.get('lib-wrapper')?.active) return;
  const cls = 'CONFIG.ActiveEffect.documentClass';
  libWrapper.register(M, `${cls}._fromStatusEffect`, _fromStatusEffect, 'WRAPPER');
  libWrapper.register(M, `${cls}.targetedConditionPrompt`, _sourcedPrompt, 'MIXED');
  Hooks.on('preCreateActiveEffect', _guardSourceless);
}
