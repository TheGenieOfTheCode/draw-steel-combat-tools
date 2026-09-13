import { getSetting, isBurrowing } from '../helpers.mjs';
import { hiddenFrom, hiddenEchoFrom, pendingSpots, confirmSpot } from './stealth.mjs';

const ICON = 'icons/svg/blind.svg';
const MARK = 'dsct-hidden-mark';
const SHROUD = 'dsct-hidden-shroud';

const BOX = 100;
const DISC = 50;
const GLYPH = 76;
const SIZE = 0.5;

const LOOK = {
  spot:  { tint: 0xd04040, disc: 0x2a0000, discAlpha: 0.65, alpha: 1,    rim: true },
  blind: { tint: 0xf4f4f4, disc: 0x000000, discAlpha: 0.4,  alpha: 1,    rim: false },
  echo:  { tint: 0xe8c53a, disc: 0x000000, discAlpha: 0.25, alpha: 0.45, rim: false },
};

const SHROUD_TINT = 0x0a0a14;
const SHROUD_ALPHA = 0.35;
const SHROUD_MESH = 0.45;
const BURROW_MESH = 0.5;

let _suspended = false;
let _texture = null;
let _lines = null;
let _lineCount = 0;

const _marked = new Map();

const _shrouded = new Set();

const _live = (obj) => !!obj && obj.destroyed !== true;

function _icon() {
  if (_texture) return _texture;
  const svg = new PIXI.SVGResource(ICON, { scale: (window.devicePixelRatio || 1) * 4 });
  _texture = new PIXI.Texture(new PIXI.BaseTexture(svg));
  return _texture;
}

const _child = (token, name) => {
  const found = _live(token) ? token.children?.find(c => c.name === name) : null;
  return _live(found) ? found : null;
};

const _drop = (node) => node.destroy({ children: true, texture: false, baseTexture: false });

function _buildMark(observerId, state) {
  const look = LOOK[state] ?? LOOK.blind;

  const group = new PIXI.Container();
  group.name = MARK;
  group.dsctState = state;
  group.alpha = look.alpha;

  const disc = new PIXI.Graphics();
  disc.beginFill(look.disc, look.discAlpha);
  disc.drawCircle(0, 0, DISC);
  disc.endFill();
  if (look.rim) {
    disc.lineStyle(6, look.tint, 0.9);
    disc.drawCircle(0, 0, DISC - 3);
  }
  group.addChild(disc);

  const glyph = new PIXI.Sprite(_icon());
  glyph.anchor.set(0.5);
  glyph.width = GLYPH;
  glyph.height = GLYPH;
  glyph.tint = look.tint;
  group.addChild(glyph);

  if (state === 'spot' && game.user.isGM) {
    group.eventMode = 'static';
    group.cursor = 'pointer';
    group.hitArea = new PIXI.Circle(0, 0, DISC);
    
    group.on('pointerdown', (event) => {
      event.stopPropagation();
      _confirm(observerId);
    });
  } else {
    group.eventMode = 'none';
  }

  return group;
}

async function _confirm(observerId) {
  for (const hiderId of [...(_marked.get(observerId)?.hiders ?? [])]) {
    await confirmSpot(hiderId, [observerId]);
  }
}

function _placeMark(mark, token) {
  mark.scale.set((Math.min(token.w, token.h) * SIZE) / BOX);
  mark.position.set(token.w / 2, token.h / 2);
}

function _syncMark(token) {
  if (!_live(token) || !token.mesh) return;

  const state = _marked.get(token.id)?.state ?? null;
  const existing = _child(token, MARK);

  if (!state) {
    if (existing) _drop(existing);
    return;
  }
  if (existing && existing.dsctState === state) return _placeMark(existing, token);
  if (existing) _drop(existing);

  const mark = _buildMark(token.id, state);
  token.addChild(mark);
  _placeMark(mark, token);
}

function _placeShroud(shroud, token) {
  shroud.clear();
  shroud.beginFill(SHROUD_TINT, SHROUD_ALPHA);
  shroud.drawRoundedRect(0, 0, token.w, token.h, 6);
  shroud.endFill();
}

function _syncMesh(token) {
  if (!token?.mesh) return;

  if (_shrouded.has(token.id)) {
    token.mesh.alpha = SHROUD_MESH;
    token.mesh.dsctStealthFaded = true;
  } else if (token.mesh.dsctStealthFaded) {
    token.mesh.alpha = isBurrowing(token) ? BURROW_MESH : 1;
    delete token.mesh.dsctStealthFaded;
  }
}

function _syncShroud(token) {
  if (!_live(token) || !token.mesh) return;

  const existing = _child(token, SHROUD);
  if (!_shrouded.has(token.id)) {
    if (existing) _drop(existing);
  } else {
    const shroud = existing ?? new PIXI.Graphics();
    if (!existing) {
      shroud.name = SHROUD;
      shroud.eventMode = 'none';
      token.addChildAt(shroud, 0);
    }
    _placeShroud(shroud, token);
  }

  _syncMesh(token);
}

function _ensureLines() {
  if (_live(_lines) && _lines.parent) return _lines;
  _lines = new PIXI.Graphics();
  _lines.eventMode = 'none';
  canvas.controls.addChild(_lines);
  return _lines;
}

function _drawLines() {
  if (!canvas.ready) return;
  const g = _ensureLines();
  g.clear();
  _lineCount = 0;

  for (const [observerId, entry] of _marked) {
    if (entry.state !== 'spot') continue;
    const observer = canvas.tokens.get(observerId);
    if (!observer?.visible) continue;

    for (const hiderId of entry.hiders) {
      const hider = canvas.tokens.get(hiderId);
      if (!hider) continue;
      g.lineStyle(4, LOOK.spot.tint, 0.35);
      g.moveTo(observer.center.x, observer.center.y);
      g.lineTo(hider.center.x, hider.center.y);
      _lineCount++;
    }
  }
}

const _enabled = () =>
  getSetting('stealthSystemEnabled') && getSetting('hiddenMarkers') && !_suspended;

const _tokensFor = (id) => [
  canvas.tokens?.get(id),
  ...(canvas.tokens?.preview?.children ?? []).filter(t => t.id === id),
].filter(Boolean);

function _planMarks() {
  const plan = new Map();
  if (!_enabled()) return plan;

  const controlled = canvas.tokens?.controlled ?? [];
  const selected = controlled.length === 1 ? controlled[0] : null;

  
  
  for (const { hiderId, observerId } of pendingSpots()) {
    if (!game.user.isGM && selected?.id !== hiderId) continue;
    if (plan.has(observerId)) plan.get(observerId).hiders.push(hiderId);
    else plan.set(observerId, { state: 'spot', hiders: [hiderId] });
  }

  if (selected) {
    for (const id of hiddenFrom(selected)) {
      if (id !== selected.id && !plan.has(id)) plan.set(id, { state: 'blind', hiders: [] });
    }
    for (const id of hiddenEchoFrom(selected)) {
      if (id !== selected.id && !plan.has(id)) plan.set(id, { state: 'echo', hiders: [] });
    }
  }

  return plan;
}

function _planShroud() {
  const out = new Set();
  if (!_enabled()) return out;

  const controlled = canvas.tokens?.controlled ?? [];
  if (!controlled.length) return out;

  for (const hider of canvas.tokens?.placeables ?? []) {
    if (controlled.some(t => t.id === hider.id)) continue;
    const from = hiddenFrom(hider);
    if (from.size && controlled.every(t => from.has(t.id))) out.add(hider.id);
  }

  return out;
}

export function refreshHiddenMarkers() {
  const marks = _planMarks();
  const shroud = _planShroud();

  const touched = new Set([..._marked.keys(), ...marks.keys()]);
  _marked.clear();
  for (const [id, entry] of marks) _marked.set(id, entry);
  for (const id of touched) for (const token of _tokensFor(id)) _syncMark(token);

  const ghosted = new Set([..._shrouded, ...shroud]);
  _shrouded.clear();
  for (const id of shroud) _shrouded.add(id);
  for (const id of ghosted) for (const token of _tokensFor(id)) _syncShroud(token);

  _drawLines();
}

export function registerHiddenMarkers() {
  if (!getSetting('stealthSystemEnabled')) return;

  const refresh = () => refreshHiddenMarkers();
  for (const hook of ['controlToken', 'createToken', 'deleteToken', 'dsct.stealthChanged',
    'createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, refresh);
  }

  
  
  Hooks.on('drawToken', (token) => {
    if (_marked.has(token.id)) _syncMark(token);
    if (_shrouded.has(token.id)) _syncShroud(token);
  });

  Hooks.on('refreshToken', (token) => {
    const mark = _child(token, MARK);
    if (mark) _placeMark(mark, token);
    if (_shrouded.has(token.id) || token.mesh?.dsctStealthFaded) _syncShroud(token);
    if (_lineCount) _drawLines();
  });

  Hooks.on('dsct.stealthVision', (on) => {
    _suspended = !!on;
    refreshHiddenMarkers();
  });

  const forget = () => { _marked.clear(); _shrouded.clear(); _lines = null; _lineCount = 0; };
  Hooks.on('canvasTearDown', forget);
  Hooks.on('canvasReady', () => { forget(); refreshHiddenMarkers(); });
}
