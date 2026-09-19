import { getSetting, hasSightToToken } from '../helpers.mjs';
import { hiddenFrom, HIDDEN } from './stealth.mjs';

let _combatants = new Set();

let _noLos = new Set();

const _baked = new Map();

const _live = (obj) => !!obj && obj.destroyed !== true;

const _rebuild = () => {
  _combatants = new Set((game.combat?.combatants ?? []).map(c => c.tokenId).filter(Boolean));
};

const _forced = (token) => {
  const id = token?.document?.id;
  return !!id && _combatants.has(id) && getSetting('revealCombatantPositions');
};

function _viewers() {
  const layer = canvas.tokens;
  if (!layer) return [];
  const sighted = (t) => t.hasSight && !t.document.hidden;
  const controlled = layer.controlled.filter(sighted);
  return controlled.length ? controlled : layer.placeables.filter(t => sighted(t) && t.isOwner);
}

function _fullyHidden(token) {
  if (game.user.isGM || !token?.id || token.isOwner) return false;
  if (!getSetting('stealthSystemEnabled') || !getSetting('stealthTrueHidden')) return false;
  const from = hiddenFrom(token);
  if (!from.size) return false;
  const viewers = _viewers();
  return viewers.length > 0 && viewers.every(v => from.has(v.id));
}

const _seenCache = new Map();

export const dropSeenCache = () => _seenCache.clear();

const _anyViewerSees = (token) => {
  const id = token?.id;
  if (!id) return false;
  if (_seenCache.has(id)) return _seenCache.get(id);
  const seen = _viewers().some(v => v !== token && hasSightToToken(v, token));
  _seenCache.set(id, seen);
  return seen;
};

export function resolveTokenVisibility(token, real) {
  if (_fullyHidden(token)) {
    if (token) token.dsctForcedVisible = false;
    return false;
  }
  const forced = !real && _forced(token);

  if (forced && _anyViewerSees(token)) {
    if (token) token.dsctForcedVisible = false;
    return true;
  }

  if (token) token.dsctForcedVisible = forced;
  return real || forced;
}

function _newFilter() {
  const Cls = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
  if (!Cls) {
    console.warn('DSCT | combat reveal | this PIXI build has no ColorMatrixFilter');
    return null;
  }

  const filter = new Cls();
  if (typeof filter.blackAndWhite === 'function') filter.blackAndWhite(false);
  else filter.desaturate();
  return filter;
}

function _bakedTexture(texture) {
  if (!texture?.baseTexture?.valid) return null;

  const cached = _baked.get(texture);
  if (_live(cached)) return cached;

  const filter = _newFilter();
  if (!filter) return null;

  const source = new PIXI.Sprite(texture);
  source.filters = [filter];

  let baked = null;
  try {
    baked = canvas.app.renderer.generateTexture(source, {
      resolution: texture.baseTexture.resolution,
    });

    baked.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    baked.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
  } catch (err) {
    console.warn('DSCT | combat reveal | could not bake a black and white texture:', err);
  }
  source.destroy();

  if (baked) _baked.set(texture, baked);
  return baked;
}

export function syncPositionGhost(token) {
  if (!_live(token)) return;

  const mesh = token.mesh;
  if (!mesh || mesh.destroyed) return;

  const greyed = token.dsctForcedVisible || _noLos.has(token.id);

  if (!greyed) {
    if (_live(mesh.dsctColourTexture)) {
      mesh.texture = mesh.dsctColourTexture;
      delete mesh.dsctColourTexture;
    }
    return;
  }

  const source = mesh.dsctColourTexture ?? token.texture ?? mesh.texture;
  if (!source) return;

  const baked = _bakedTexture(source);
  if (!baked || mesh.texture === baked) return;

  mesh.dsctColourTexture = source;
  mesh.texture = baked;
}

function _computeNoLos() {
  const next = new Set();
  if (!canvas.ready || !getSetting('greyscaleNoLos')) return next;

  const viewers = (canvas.tokens?.controlled ?? []).filter(t => !t.document.hidden);
  if (!viewers.length) return next;

  for (const token of canvas.tokens?.placeables ?? []) {
    if (viewers.includes(token)) continue;
    if (token.document.hidden && !game.user.isGM) continue;
    if (!viewers.some(v => hasSightToToken(v, token))) next.add(token.id);
  }
  return next;
}

const _sameSet = (a, b) => a.size === b.size && [...a].every(v => b.has(v));

export function recheckNoLos() {
  if (!canvas.ready) return;
  dropSeenCache();
  const next = _computeNoLos();
  if (_sameSet(next, _noLos)) return;
  _noLos = next;
  for (const token of canvas.tokens?.placeables ?? []) syncPositionGhost(token);
}

export function recheckCombatReveal() {
  if (!canvas.ready) return;
  dropSeenCache();
  _rebuild();
  for (const token of canvas.tokens?.placeables ?? []) {
    token.renderFlags?.set?.({ refreshVisibility: true });
  }
}

function _dropBaked() {
  for (const token of canvas.tokens?.placeables ?? []) {
    const mesh = token.mesh;
    if (mesh && !mesh.destroyed && _live(mesh.dsctColourTexture)) {
      mesh.texture = mesh.dsctColourTexture;
      delete mesh.dsctColourTexture;
    }
  }
  for (const texture of _baked.values()) {
    if (_live(texture)) texture.destroy(true);
  }
  _baked.clear();
}

export function registerCombatReveal() {
  _rebuild();

  for (const hook of ['createCombat', 'deleteCombat', 'updateCombat',
    'createCombatant', 'deleteCombatant', 'updateCombatant']) {
    Hooks.on(hook, () => recheckCombatReveal());
  }

  Hooks.on('canvasTearDown', () => { _noLos = new Set(); dropSeenCache(); _dropBaked(); });
  Hooks.on('canvasReady', () => { _rebuild(); _noLos = new Set(); recheckNoLos(); });

  
  
  
  Hooks.on('dsct.stealthChanged', () => { recheckCombatReveal(); recheckNoLos(); });
  Hooks.on('controlToken', () => { recheckCombatReveal(); recheckNoLos(); });

  

  const _moved = () => {
    recheckNoLos();
    if (getSetting('revealCombatantPositions')) recheckCombatReveal();
  };

  Hooks.on('updateToken', (doc, changed) => {
    if (['x', 'y', 'elevation', 'hidden', 'width', 'height'].some(k => k in changed)) _moved();
  });
  for (const hook of ['createWall', 'updateWall', 'deleteWall', 'createToken', 'deleteToken']) {
    Hooks.on(hook, () => _moved());
  }
  for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, (effect) => {
      if (effect?.statuses?.has?.(HIDDEN) || effect?.getFlag?.('draw-steel-combat-tools', 'hiddenFrom')) recheckCombatReveal();
    });
  }

  Hooks.on('drawToken', syncPositionGhost);
  Hooks.on('refreshToken', syncPositionGhost);
}
