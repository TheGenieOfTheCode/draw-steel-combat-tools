import { getSetting } from '../helpers.mjs';

let _combatants = new Set();

const _baked = new Map();

const _live = (obj) => !!obj && obj.destroyed !== true;

const _rebuild = () => {
  _combatants = new Set((game.combat?.combatants ?? []).map(c => c.tokenId).filter(Boolean));
};

const _forced = (token) => {
  const id = token?.document?.id;
  return !!id && _combatants.has(id) && getSetting('revealCombatantPositions');
};

export function resolveTokenVisibility(token, real) {
  const forced = !real && _forced(token);
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

  if (!token.dsctForcedVisible) {
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

export function recheckCombatReveal() {
  if (!canvas.ready) return;
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

  
  Hooks.on('canvasTearDown', _dropBaked);
  Hooks.on('canvasReady', () => { _rebuild(); });

  
  
  Hooks.on('drawToken', syncPositionGhost);
  Hooks.on('refreshToken', syncPositionGhost);
}
