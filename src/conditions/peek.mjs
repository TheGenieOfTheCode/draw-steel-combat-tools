import { getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';

export const peekDistance = () => Math.min(0.49, Math.max(0.01, Number(getSetting('peekDistance')) || 0.15));

export const peekDuration = () => { const v = Number(getSetting('peekDuration')); return Number.isFinite(v) ? Math.max(0, v) : 1200; };

const _settled_anim = async (token) => {
  const promise = token?.movementAnimationPromise;
  if (!promise) return;
  try { await (game.raceWithWindowHidden?.(promise) ?? promise); } catch (_) {  }
};

const _gs = () => canvas?.grid?.size ?? 100;

export const peekEffect = (actor) => actor?.effects?.find(e => e.getFlag(M, 'peek')) ?? null;

export const isPeeking = (actor) => {
  const effect = peekEffect(actor);
  return !!effect && !effect.disabled;
};

const _busy = new Set();

const _settled = (doc) => canvas.grid.getTopLeftPoint(
  canvas.grid.getOffset({ x: doc.x + _gs() / 2, y: doc.y + _gs() / 2 }),
);

const _blocked = (from, to) =>
  !!CONFIG.Canvas.polygonBackends.move?.testCollision(from, to, { type: 'move', mode: 'any' });

const _centre = (gx, gy) => canvas.grid.getCenterPoint({ i: gy, j: gx });

export function wallAdjacent(token) {
  if (!token?.document || !canvas?.grid) return false;
  const GS = _gs();
  const w = Math.max(1, Math.round(token.document.width));
  const h = Math.max(1, Math.round(token.document.height));
  const from = { x: token.document.x + (w * GS) / 2, y: token.document.y + (h * GS) / 2 };
  const o = canvas.grid.getOffset({ x: token.document.x + GS / 2, y: token.document.y + GS / 2 });
  return [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .some(([dx, dy]) => _blocked(from, _centre(o.j + dx * w, o.i + dy * h)));
}

export function peekSpaces(token) {
  if (!token?.document || !canvas?.grid) return [];
  const GS = _gs();
  const o  = canvas.grid.getOffset({ x: token.document.x + GS / 2, y: token.document.y + GS / 2 });
  const og = { x: o.j, y: o.i };
  const w  = Math.max(1, Math.round(token.document.width));
  const h  = Math.max(1, Math.round(token.document.height));

  const defeated = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const occupied = (gx, gy) => canvas.tokens.placeables.some((t) => {
    if (t.id === token.id || !t.actor || t.actor.statuses?.has(defeated)) return false;
    const p = canvas.grid.getOffset({ x: t.document.x + GS / 2, y: t.document.y + GS / 2 });
    const tw = Math.max(1, Math.round(t.document.width));
    const th = Math.max(1, Math.round(t.document.height));
    return gx >= p.j && gx < p.j + tw && gy >= p.i && gy < p.i + th;
  });

  const d = canvas.dimensions;
  const inScene = (gx, gy) => {
    const c = _centre(gx, gy);
    return c.x > d.sceneX && c.x < d.sceneX + d.sceneWidth && c.y > d.sceneY && c.y < d.sceneY + d.sceneHeight;
  };

  const from = { x: token.document.x + (w * GS) / 2, y: token.document.y + (h * GS) / 2 };
  const out = [];

  for (let x = og.x - 1; x <= og.x + w; x++) {
    for (let y = og.y - 1; y <= og.y + h; y++) {
      if (x >= og.x && x < og.x + w && y >= og.y && y < og.y + h) continue;
      if (!inScene(x, y) || occupied(x, y)) continue;

      const to = _centre(x, y);
      if (_blocked(from, to)) continue;

      const dx = Math.sign(x - (og.x + (w - 1) / 2));
      const dy = Math.sign(y - (og.y + (h - 1) / 2));

      if (dx !== 0 && dy !== 0) {
        const sideA = _centre(x, y - dy);
        const sideB = _centre(x - dx, y);
        if (_blocked(from, sideA) || _blocked(sideA, to)) continue;
        if (_blocked(from, sideB) || _blocked(sideB, to)) continue;
      }

      const d = peekDistance();
      out.push({ x, y, dx, dy, shift: { x: dx * GS * d, y: dy * GS * d } });
    }
  }
  return out;
}

export async function peekTo(token, space, { auto = false } = {}) {
  if (!token?.document || !space || !token.actor) return false;
  if (_busy.has(token.id)) return false;
  _busy.add(token.id);

  try {
    const home = _settled(token.document);
    await token.document.update(
      { x: home.x + space.shift.x, y: home.y + space.shift.y },
      { animation: { duration: peekDuration() }, pan: false },
    );
    await _settled_anim(token);

    const peek = { x: home.x, y: home.y, auto };
    const existing = peekEffect(token.actor);
    if (existing) await existing.update({ disabled: false, [`flags.${M}.peek`]: peek });
    else {
      await token.actor.createEmbeddedDocuments('ActiveEffect', [{
        name: 'Peeking',
        img: 'icons/svg/eye.svg',
        origin: token.actor.uuid,
        description: '<p>Leaning out of cover to see past a corner. Run the Peek macro again to settle back.</p>',
        flags: { [M]: { peek } },
      }]);
    }
    return true;
  } finally {
    _busy.delete(token.id);
  }
}

export async function unpeek(token, { settle = true } = {}) {
  const effect = peekEffect(token?.actor);
  if (!effect || effect.disabled) return false;
  if (_busy.has(token.id)) return false;
  _busy.add(token.id);

  try {
    if (settle && token.document) {
      const home = _settled(token.document);
      if (home.x !== token.document.x || home.y !== token.document.y) {
        await token.document.update({ x: home.x, y: home.y }, { animation: { duration: peekDuration() }, pan: false });
        await _settled_anim(token);
      }
    }
    
    if (!effect.disabled) await effect.update({ disabled: true });
    return true;
  } finally {
    _busy.delete(token.id);
  }
}

const _endAutoPeek = async (token) => {
  if (!token?.actor || !isPeeking(token.actor)) return;
  if (!peekEffect(token.actor)?.getFlag(M, 'peek')?.auto) return;
  await unpeek(token);
};

export function registerPeek() {

  Hooks.on('updateToken', async (doc, changed) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!('x' in changed) && !('y' in changed)) return;
    if (!canvas?.grid || !isPeeking(doc.actor)) return;

    const home = peekEffect(doc.actor)?.getFlag(M, 'peek');
    if (!home) return;

    const now = _settled(doc);
    if (now.x === home.x && now.y === home.y) return;

    
    await unpeek(doc.object, { settle: false });
    if (doc.object) ui.notifications.info(`${doc.object.name} stops peeking and moves off.`);
  });

  
  
  
  
  
  Hooks.on('closeAbilityConfigurationDialog', async (app) => {
    if (!game.users.activeGM?.isSelf) return;
    const actor = app?.options?.ability?.actor ?? app?.options?.ability?.parent;
    if (!actor) return;
    for (const token of canvas.tokens?.placeables ?? []) {
      if (token.actor === actor) await _endAutoPeek(token);
    }
  });

  Hooks.on('createChatMessage', async (message) => {
    if (!game.users.activeGM?.isSelf) return;
    await _endAutoPeek(canvas.tokens?.get(message?.speaker?.token));
  });

  Hooks.on('combatTurnChange', async (combat, previous) => {
    if (!game.users.activeGM?.isSelf) return;
    const prev = combat?.combatants?.get(previous?.combatantId);
    const token = prev?.token?.object ?? canvas.tokens?.get(prev?.tokenId);
    if (!token) return;
    if (await unpeek(token)) ui.notifications.info(`${token.name} settles back at the end of their turn.`);
  });

  
  
  Hooks.on('deleteCombat', async () => {
    if (!game.users.activeGM?.isSelf) return;
    for (const token of canvas.tokens?.placeables ?? []) {
      const effect = peekEffect(token.actor);
      if (!effect) continue;
      await unpeek(token);
      try { await effect.delete(); }
      catch (_) {  }
    }
  });
}
