import { getSetting } from '../helpers.mjs';
import { isDeathDeferred } from './defer-death.mjs';

const M = 'draw-steel-combat-tools';

const FILTERS = 'dsctDeathFilters';
const TWEEN = 'dsctDeathTween';
const PROGRESS = 'dsctDeathProgress';

const _defeatedId = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';

const DEATH_ALPHA = 0.5;

const OBJECT_DEATH_ALPHA = 0;

const CLAIM_MS = 2000;

export function isDeadLooking(token) {
  const actor = token?.actor;
  if (!actor?.statuses?.has(_defeatedId())) return false;
  return !isDeathDeferred(actor);
}

const _deadAlpha = (token) => (token?.actor?.type === 'object' ? OBJECT_DEATH_ALPHA : DEATH_ALPHA);

const _ColorMatrixFilter = () => PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter ?? null;
const _AlphaFilter = () => PIXI.AlphaFilter ?? PIXI.filters?.AlphaFilter ?? null;

const MARK = 'dsctDeathFilter';

function _makeFilters(token) {
  const Color = _ColorMatrixFilter();
  const Alpha = _AlphaFilter();
  if (!Color || !Alpha) {
    console.warn('DSCT | death visuals | PIXI is missing a filter this needs; the dead will look alive');
    return null;
  }
  const set = { color: new Color(), alpha: new Alpha() };
  for (const f of [set.color, set.alpha]) { f.padding = 0; f[MARK] = true; }
  token[FILTERS] = set;
  return set;
}

function _attach(token, set) {
  const current = token.mesh.filters ?? [];
  const missing = [set.color, set.alpha].filter((f) => !current.includes(f));
  if (missing.length) token.mesh.filters = [...current, ...missing];
}

function _detach(token) {
  const filters = token.mesh?.filters;
  if (filters?.length) {
    const ours = filters.filter((f) => f?.[MARK]);
    if (ours.length) {
      token.mesh.filters = filters.filter((f) => !f?.[MARK]);
      for (const f of ours) f.destroy?.();
    }
  }
  token[FILTERS] = null;
  token[PROGRESS] = 0;
}

const _hasOurFilters = (token) => (token.mesh?.filters ?? []).some((f) => f?.[MARK]);

function _apply(token, progress, deadAlpha) {

  if (!token[FILTERS] && _hasOurFilters(token)) _detach(token);
  const set = token[FILTERS] ?? _makeFilters(token);
  if (!set) return;
  _attach(token, set);

  const keep = 1 - progress;
  set.color.matrix = [
    1, 0, 0, 0, 0,
    0, keep, 0, 0, 0,
    0, 0, keep, 0, 0,
    0, 0, 0, 1, 0,
  ];
  set.alpha.alpha = 1 + (deadAlpha - 1) * progress;
  token[PROGRESS] = progress;
}

const _claims = new Map();

function _claim(token) {
  const id = token.id;
  clearTimeout(_claims.get(id));
  _claims.set(id, setTimeout(() => {
    _claims.delete(id);
    const live = canvas?.tokens?.get(id);
    if (live) syncDeathVisual(live);
  }, CLAIM_MS));
}

function _release(token) {
  clearTimeout(_claims.get(token.id));
  _claims.delete(token.id);
}

export function syncDeathVisual(token) {
  if (!token?.mesh || !canvas?.ready) return;
  if (token[TWEEN] || _claims.has(token.id)) return;

  if (!isDeadLooking(token)) {
    if (token[FILTERS] || _hasOurFilters(token)) _detach(token);
    return;
  }

  if (token[PROGRESS] === 1 && token[FILTERS]) { _attach(token, token[FILTERS]); return; }
  _apply(token, 1, _deadAlpha(token));
}

function _animationDuration() {
  if (window._dsctKillLockActive || window._dsctFMActive) return 0;
  const ms = Number(getSetting('deathAnimationDuration'));
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function animateDeathVisual(token, { duration } = {}) {
  if (!token?.mesh || !canvas?.ready) return Promise.resolve();

  _release(token);
  token[TWEEN]?.cancel();
  token[TWEEN] = null;

  const to = isDeadLooking(token) ? 1 : 0;
  const from = token[PROGRESS] ?? (to === 1 ? 0 : 1);
  const ms = Number.isFinite(duration) ? duration : _animationDuration();

  if (ms <= 0 || from === to) {
    syncDeathVisual(token);
    return Promise.resolve();
  }

  const deadAlpha = _deadAlpha(token);
  const start = performance.now();
  const id = token.id;
  let cancelled = false;

  const promise = new Promise((resolve) => {
    let done = false;
    let watchdog = null;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      if (token[TWEEN]?.promise === promise) token[TWEEN] = null;
      if (!cancelled) syncDeathVisual(token);
      resolve();
    };

    const tick = (now) => {
      if (done) return;
      if (cancelled || !canvas.tokens.get(id)?.mesh) { finish(); return; }
      _apply(token, from + (to - from) * Math.min(1, (now - start) / ms), deadAlpha);
      if (now - start < ms) requestAnimationFrame(tick);
      else finish();
    };

    
    watchdog = setTimeout(finish, ms + 500);
    requestAnimationFrame(tick);
  });

  token[TWEEN] = { promise, cancel: () => { cancelled = true; } };
  return promise;
}

export const deathVisualSettled = (token) => token?.[TWEEN]?.promise ?? Promise.resolve();

export function resyncDeathVisuals() {
  for (const token of canvas?.tokens?.placeables ?? []) syncDeathVisual(token);
}

const PENDING = 'dsctPendingFilter';
const PENDING_PERIOD_MS = 1500;
const PENDING_DEPTH = 0.3;

const _pendingFilters = new Map();
let _pendingPhase = 0;
let _pendingTicker = null;

const _pendingStep = () => {
  _pendingPhase = (_pendingPhase + (canvas?.app?.ticker?.deltaMS ?? 16) / PENDING_PERIOD_MS) % 1;
  const keep = 1 - PENDING_DEPTH * (0.5 - 0.5 * Math.cos(_pendingPhase * Math.PI * 2));
  for (const [id, filter] of _pendingFilters) {
    const token = canvas?.tokens?.get(id);
    
    
    if (!token?.mesh || isDeadLooking(token)) { clearDeathPending([{ id }]); continue; }
    const mesh = token.mesh;

    if (!(mesh.filters ?? []).includes(filter)) mesh.filters = [...(mesh.filters ?? []), filter];
    filter.matrix = [
      1, 0, 0, 0, 0,
      0, keep, 0, 0, 0,
      0, 0, keep, 0, 0,
      0, 0, 0, 1, 0,
    ];
  }
};

export function markDeathPending(tokens) {
  const Color = _ColorMatrixFilter();
  if (!Color || !canvas?.ready) return;

  for (const token of tokens ?? []) {
    if (!token?.mesh || _pendingFilters.has(token.id)) continue;
    const filter = new Color();
    filter.padding = 0;
    filter[PENDING] = true;
    _pendingFilters.set(token.id, filter);
    token.mesh.filters = [...(token.mesh.filters ?? []), filter];
  }

  if (_pendingFilters.size && !_pendingTicker) {
    _pendingTicker = _pendingStep;
    canvas.app.ticker.add(_pendingTicker);
  }
}

export function clearDeathPending(tokens = null) {
  const ids = tokens ? [...tokens].map((t) => t?.id).filter(Boolean) : [..._pendingFilters.keys()];

  
  for (const id of _pendingFilters.keys()) {
    const token = canvas?.tokens?.get(id);
    if (!token?.mesh || isDeadLooking(token)) ids.push(id);
  }

  for (const id of new Set(ids)) {
    const filter = _pendingFilters.get(id);
    _pendingFilters.delete(id);
    const mesh = canvas?.tokens?.get(id)?.mesh;

    if (mesh?.filters?.length) mesh.filters = mesh.filters.filter((f) => !f?.[PENDING]);
    filter?.destroy?.();
  }

  if (!_pendingFilters.size && _pendingTicker) {
    canvas.app.ticker.remove(_pendingTicker);
    _pendingTicker = null;
    _pendingPhase = 0;
  }
}

async function _migrateStoredDeathLook() {
  if (!game.users.activeGM?.isSelf) return;
  for (const scene of game.scenes) {
    const updates = [];
    for (const doc of scene.tokens) {
      const tint = doc.getFlag(M, 'preDeathTint');
      const alpha = doc.getFlag(M, 'preDeathAlpha');
      if (tint === undefined && alpha === undefined) continue;
      updates.push({
        _id: doc.id,
        'texture.tint': tint ?? '#ffffff',
        alpha: alpha ?? 1,
        [`flags.${M}.-=preDeathTint`]: null,
        [`flags.${M}.-=preDeathAlpha`]: null,
      });
    }
    if (!updates.length) continue;
    console.log(`DSCT | death visuals | restoring ${updates.length} token(s) on "${scene.name}" that stored the old death look`);
    await scene.updateEmbeddedDocuments('Token', updates)
      .catch((err) => console.error('DSCT | death visuals | could not restore stored death looks:', err));
  }
}

export function registerDeathVisuals() {
  Hooks.on('drawToken', syncDeathVisual);
  Hooks.on('refreshToken', syncDeathVisual);
  Hooks.on('canvasReady', () => { clearDeathPending(); resyncDeathVisuals(); });

  for (const hook of ['createActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, (effect, options, userId) => {
      const actor = effect?.parent;
      if (actor?.documentName !== 'Actor' || !effect.statuses?.has(_defeatedId())) return;

      const mine = userId === game.userId;
      for (const token of actor.getActiveTokens?.(false, false) ?? []) {
        if (mine) _claim(token);
        else animateDeathVisual(token);
      }
    });
  }

  Hooks.on('updateActiveEffect', (effect) => {
    const actor = effect?.parent;
    if (actor?.documentName !== 'Actor' || !effect.statuses?.has(_defeatedId())) return;
    for (const token of actor.getActiveTokens?.(false, false) ?? []) syncDeathVisual(token);
  });

  Hooks.once('ready', () => _migrateStoredDeathLook().catch(() => {}));
}
