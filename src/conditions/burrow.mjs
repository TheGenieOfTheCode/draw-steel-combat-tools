import {
  getSetting, hasCover,
  isBurrowing, groundElevation, burrowDepth, isCompletelyBeneath, touchesGround, isOnGround,
  burrowBlocksLineOfEffect, burrowAdjacent,
} from '../helpers.mjs';

export {
  isBurrowing, groundElevation, burrowDepth, isCompletelyBeneath, touchesGround, isOnGround,
  burrowBlocksLineOfEffect,
};

const M = 'draw-steel-combat-tools';

export function coverWithBurrow(observer, target) {
  if (getSetting('stealthSystemEnabled') && isBurrowing(target)) {
    if (!isBurrowing(observer)) return true;
    if (burrowAdjacent(observer, target)) return true;
  }
  return hasCover(observer, target);
}

function _liftBelowGround() {
  if (!this.mesh) return;
  if (!getSetting('stealthSystemEnabled')) return;
  if (!isBurrowing(this)) return;
  if (this.mesh.elevation < 0) this.mesh.elevation = 0;
}

function _fadeBurrowed(token) {
  if (!token?.mesh) return;
  if (!getSetting('stealthSystemEnabled')) return;

  if (isBurrowing(token)) {
    token.mesh.alpha = 0.5;
    token.mesh.dsctBurrowFaded = true;
    return;
  }

  if (token.mesh.dsctBurrowFaded) {
    token.mesh.alpha = 1;
    delete token.mesh.dsctBurrowFaded;
  }
}

export function registerBurrowRendering() {
  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(M, 'CONFIG.Token.objectClass.prototype._refreshElevation', function (wrapped, ...args) {
      wrapped(...args);
      _liftBelowGround.call(this);
    }, 'WRAPPER');
  } else {
    const cls = CONFIG.Token?.objectClass;
    const original = cls?.prototype?._refreshElevation;
    if (original) {
      cls.prototype._refreshElevation = function (...args) {
        original.apply(this, args);
        _liftBelowGround.call(this);
      };
    }
  }

  Hooks.on('drawToken', _fadeBurrowed);
  Hooks.on('refreshToken', _fadeBurrowed);
}
