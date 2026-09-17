import { getSetting, safeDelete, safeCreateEmbedded, safeSetFlag } from '../helpers.mjs';

const M  = 'draw-steel-combat-tools';
const DS = 'draw-steel';

export const ONGOING = 'templateOngoing';
export const ENDS    = 'templateEnd';

const EFFECT_REGION = 'ongoingRegionUuid';
const REGION_EFFECT = 'ongoingEffectUuid';

const DEFAULT_SECONDS = 5;

const _pending = new Map();

const _tearing = new Set();

export const DEFAULT_END = 'turnEnd';

const EVENT_ORDER = ['turnEnd', 'roundEnd', 'combatEnd', 'save', 'respite', 'turnStart', 'roundStart', 'combatStart'];

export function expiryOptions() {
  const events = foundry.documents.ActiveEffect.EXPIRY_EVENTS ?? {};

  
  const preferred = {};
  for (const cfg of Object.values(ds.CONFIG.effectEnds ?? {})) {
    if (cfg?.expiryEvent && cfg.label) preferred[cfg.expiryEvent] = cfg.label;
  }

  const keys = Object.keys(events);
  keys.sort((a, b) => {
    const ai = EVENT_ORDER.indexOf(a);
    const bi = EVENT_ORDER.indexOf(b);
    return (ai < 0 ? EVENT_ORDER.length : ai) - (bi < 0 ? EVENT_ORDER.length : bi);
  });

  return keys.map(value => ({ value, label: game.i18n.localize(preferred[value] ?? events[value]) }));
}

export const defaultEnd = () => (foundry.documents.ActiveEffect.EXPIRY_EVENTS?.[DEFAULT_END] ? DEFAULT_END : expiryOptions()[0]?.value ?? '');

const abilityOf = (region) => region?.getFlag?.(DS, 'abilitySource') ?? null;

function isPlacedTemplate(region) {
  if (region?.getFlag?.(M, 'isAbilityTemplate')) return false;
  return !!abilityOf(region);
}

function lifetimeMs() {
  const seconds = Number(getSetting('abilityTemplateSeconds'));
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_SECONDS * 1000;
  return seconds * 1000;
}

async function _sweep(uuid) {
  const timer = _pending.get(uuid);
  if (timer) clearTimeout(timer);
  _pending.delete(uuid);

  const region = await fromUuid(uuid).catch(() => null);
  if (region) await safeDelete(region);
}

function _scheduleSweep(region) {
  const uuid = region.uuid;
  if (_pending.has(uuid)) return;
  _pending.set(uuid, setTimeout(() => {
    _sweep(uuid).catch(err => console.warn('DSCT | template lifetime | sweep failed:', err));
  }, lifetimeMs()));
}

async function _trackOngoing(region, item) {
  const actor = item.actor;
  if (!actor) return;

  
  
  const expiry = item.getFlag(M, ENDS) || defaultEnd();
  if (!foundry.documents.ActiveEffect.EXPIRY_EVENTS?.[expiry]) {
    console.warn(`DSCT | template lifetime | ${item.name} wants an expiry of "${expiry}" that no package registered, its area is left alone`);
    return;
  }

  const data = {
    name: game.i18n.format('DSCT.templateLifetime.effectName', { name: item.name }),
    img: item.img,
    origin: item.uuid,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER,
    duration: { expiry },
    flags: { [M]: { [EFFECT_REGION]: region.uuid } },
  };

  
  
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart?.();
  if (start) {
    start.combatant = game.combat?.getCombatantsByActor(actor)?.[0] ?? start.combatant;
    data.start = start;
  }

  const created = await safeCreateEmbedded(actor, 'ActiveEffect', [data]);
  const effect = Array.isArray(created) ? created[0] : created;
  const effectUuid = effect?.uuid ?? (typeof effect === 'string' ? effect : null);
  if (!effectUuid) return;

  await safeSetFlag(region, M, REGION_EFFECT, effectUuid);
}

async function _onCreateRegion(region, _options, userId) {
  if (userId !== game.user.id) return;
  if (!getSetting('abilityTemplateCleanup')) return;
  if (!isPlacedTemplate(region)) return;

  const item = await fromUuid(abilityOf(region)).catch(() => null);
  if (!item) return;

  if (item.getFlag(M, ONGOING)) await _trackOngoing(region, item);
  else _scheduleSweep(region);
}

async function _onDeleteRegion(region) {
  const uuid = region.uuid;
  const timer = _pending.get(uuid);
  if (timer) clearTimeout(timer);
  _pending.delete(uuid);

  const effectUuid = region.getFlag?.(M, REGION_EFFECT);
  if (!effectUuid || _tearing.has(effectUuid)) return;
  if (!game.users.activeGM?.isSelf) return;

  _tearing.add(uuid);
  try {
    const effect = await fromUuid(effectUuid).catch(() => null);
    if (effect) await safeDelete(effect);
  } finally {
    _tearing.delete(uuid);
  }
}

async function _clearPair(effect, removeEffect) {
  const regionUuid = effect.getFlag?.(M, EFFECT_REGION);
  if (!regionUuid || _tearing.has(regionUuid)) return;
  if (!game.users.activeGM?.isSelf) return;

  _tearing.add(effect.uuid);
  _tearing.add(regionUuid);
  try {
    const region = await fromUuid(regionUuid).catch(() => null);
    if (region) await safeDelete(region);

    if (removeEffect && effect.parent) await safeDelete(effect);
  } finally {
    _tearing.delete(effect.uuid);
    _tearing.delete(regionUuid);
  }
}

async function _onExpireEffect(effect, changed) {
  if (changed?.duration?.expired !== true) return;
  await _clearPair(effect, true);
}

async function _onDeleteEffect(effect) {
  await _clearPair(effect, false);
}

export function registerTemplateLifetime() {
  Hooks.on('createRegion', (region, options, userId) => {
    _onCreateRegion(region, options, userId)
      .catch(err => console.warn('DSCT | template lifetime | tracking failed:', err));
  });

  Hooks.on('deleteRegion', (region) => {
    _onDeleteRegion(region).catch(err => console.warn('DSCT | template lifetime | region cleanup failed:', err));
  });

  
  
  Hooks.on('updateActiveEffect', (effect, changed) => {
    _onExpireEffect(effect, changed).catch(err => console.warn('DSCT | template lifetime | expiry cleanup failed:', err));
  });

  Hooks.on('deleteActiveEffect', (effect) => {
    _onDeleteEffect(effect).catch(err => console.warn('DSCT | template lifetime | effect cleanup failed:', err));
  });

  
  Hooks.on('combatTurnChange', () => {
    for (const uuid of [..._pending.keys()]) {
      _sweep(uuid).catch(err => console.warn('DSCT | template lifetime | turn sweep failed:', err));
    }
  });
}
