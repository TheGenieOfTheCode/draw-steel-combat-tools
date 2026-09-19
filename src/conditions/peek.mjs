const M = 'draw-steel-combat-tools';

const LEAN_MS = 1800;

const _gs = () => canvas?.grid?.size ?? 100;

export const peekEffect = (actor) => actor?.effects?.find(e => e.getFlag(M, 'peek')) ?? null;

const _settled = (doc) => canvas.grid.getTopLeftPoint(
  canvas.grid.getOffset({ x: doc.x + _gs() / 2, y: doc.y + _gs() / 2 }),
);

export async function unpeek(token, { settle = true } = {}) {
  const effect = peekEffect(token?.actor);
  if (!effect) return false;

  if (settle && token.document) {
    const home = _settled(token.document);
    if (home.x !== token.document.x || home.y !== token.document.y) {
      await token.document.update({ x: home.x, y: home.y }, { animation: { duration: LEAN_MS }, pan: false });
    }
  }
  await effect.delete();
  return true;
}

export function registerPeek() {

  Hooks.on('updateToken', async (doc, changed) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!('x' in changed) && !('y' in changed)) return;
    if (!canvas?.grid) return;

    const effect = peekEffect(doc.actor);
    const home = effect?.getFlag(M, 'peek');
    if (!home) return;

    const now = _settled(doc);
    if (now.x === home.x && now.y === home.y) return;

    await effect.delete();
    if (doc.object) ui.notifications.info(`${doc.object.name} stops peeking and moves off.`);
  });

  Hooks.on('combatTurnChange', async (combat, previous) => {
    if (!game.users.activeGM?.isSelf) return;
    const prev = combat?.combatants?.get(previous?.combatantId);
    const token = prev?.token?.object ?? canvas.tokens?.get(prev?.tokenId);
    if (!token) return;
    if (await unpeek(token)) ui.notifications.info(`${token.name} settles back at the end of their turn.`);
  });
}
