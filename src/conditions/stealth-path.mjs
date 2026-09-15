import { getSetting, getModuleApi } from '../helpers.mjs';
import { hiddenFrom, canHideFrom, stealthActive, sneakMode, SNEAKING, squareOccupied } from './stealth.mjs';
import { stealthTraits } from './stealth-traits.mjs';

const M = 'draw-steel-combat-tools';

function _ghostAt(token, step) {
  const GS = canvas.grid.size;
  const w = Math.max(1, Math.round(token.document.width));
  const h = Math.max(1, Math.round(token.document.height));
  const x = step.x;
  const y = step.y;

  return {
    id: token.id,
    actor: token.actor,
    x, y,
    w: w * GS,
    h: h * GS,
    center: { x: x + (w * GS) / 2, y: y + (h * GS) / 2 },
    document: {
      x, y, width: w, height: h,
      elevation: step.elevation ?? token.document.elevation ?? 0,
    },
  };
}

const _cache = new Map();
export const clearStealthPathCache = () => _cache.clear();

function _blindObservers(hider, traits) {
  const out = [];
  for (const id of hiddenFrom(hider)) {
    if (id === hider.id) continue;
    const observer = canvas.tokens.get(id);
    if (observer && canHideFrom(observer, hider, traits)) out.push(observer);
  }
  return out;
}

function _exposedAt(hider, observers, step, traits) {
  const key = `${hider.id}|${step.x},${step.y},${step.elevation ?? 0}`;
  const cached = _cache.get(key);
  if (cached !== undefined) return cached;

  let exposed = false;
  if (!(traits.movementKeeps.has('occupied') && squareOccupied(hider, step))) {
    const ghost = _ghostAt(hider, step);
    exposed = observers.some(observer => !canHideFrom(observer, ghost, traits));
  }
  _cache.set(key, exposed);
  return exposed;
}

function _cutoff(token, path) {
  if (!canvas.ready || !token?.actor || !path?.length) return null;
  if (!getSetting('stealthSystemEnabled') || sneakMode() !== 'path') return null;
  if (!token.actor?.statuses?.has(SNEAKING)) return null;
  if (!stealthActive()) return null;

  if (window._dsctFMActive) return null;

  const traits = stealthTraits(token);
  if (traits.movementKeeps.has('any')) return null;

  const observers = _blindObservers(token, traits);
  if (!observers.length) return null;

  const steps = token.document.getCompleteMovementPath(path);
  for (let i = 1; i < steps.length; i++) {
    if (!_exposedAt(token, observers, steps[i], traits)) continue;

    const cut = steps.slice(0, i + 1);
    const last = cut[cut.length - 1];

    last.intermediate = false;
    last.explicit = false;
    return cut;
  }

  return null;
}

export function pingStealthStop(at, sceneId) {
  if (!canvas.ready || (sceneId && canvas.scene?.id !== sceneId)) return;
  canvas.controls.handlePing(game.user, at, {
    scene: canvas.scene?.id,
    style: 'alert',
    zoom: canvas.stage.scale.x,
  });
}

let _lastNotice = 0;

function _announceStop(token, step) {
  const now = Date.now();
  if (now - _lastNotice < 1000) return;
  _lastNotice = now;

  ui.notifications.info(game.i18n.format('DSCT.notice.stealth.stoppedInView', { name: token.name }));

  const GS = canvas.grid.size;
  const at = {
    x: step.x + (Math.max(1, Math.round(token.document.width)) * GS) / 2,
    y: step.y + (Math.max(1, Math.round(token.document.height)) * GS) / 2,
  };

  pingStealthStop(at);
  if (!game.user.isGM) getModuleApi(false)?.socket?.executeAsGM?.('dsct.stealthPing', at, canvas.scene?.id);
}

function _constrain(wrapped, ...args) {
  const result = wrapped(...args);

  try {
    const cut = _cutoff(this, result?.[0]);
    if (!cut) return result;

    if (!args[1]?.preview) _announceStop(this, cut[cut.length - 1]);
    return [cut, true];
  } catch (err) {
    console.warn('DSCT | stealth path | leaving this move alone:', err);
    return result;
  }
}

export function registerStealthPath() {
  if (!getSetting('stealthSystemEnabled')) return;

  const path = 'CONFIG.Token.objectClass.prototype.constrainMovementPath';
  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, path, _constrain, 'WRAPPER');
  } else {
    const cls = CONFIG.Token?.objectClass;
    const original = cls?.prototype?.constrainMovementPath;
    if (original) {
      cls.prototype.constrainMovementPath = function (...args) {
        return _constrain.call(this, (...inner) => original.apply(this, inner), ...args);
      };
    }
  }

  const clear = () => clearStealthPathCache();
  for (const hook of ['updateToken', 'createToken', 'deleteToken', 'canvasReady',
    'createWall', 'updateWall', 'deleteWall',
    'createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, clear);
  }
}
