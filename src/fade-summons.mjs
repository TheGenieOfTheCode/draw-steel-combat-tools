const M = 'draw-steel-combat-tools';
const FADE_ALPHA = 0.3;

const lib = () => game.modules.get('draw-steel-ctlib')?.api;

export const fadingSummons = () => game.user?.getFlag(M, 'fadeSummons') === true;

export const isSummonedMinion = (token) => {
  const actor = token?.actor;
  if (!(actor?.system?.isMinion ?? actor?.isMinion)) return false;
  return !!(lib()?.isSummoned?.(token) ?? actor.getFlag?.('draw-steel', 'summonSource'));
};

const refreshAll = () => {
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (isSummonedMinion(token)) token.renderFlags.set({ refreshState: true });
  }
};

export const toggleFadeSummons = async (on = !fadingSummons()) => {
  await game.user.setFlag(M, 'fadeSummons', on);
  refreshAll();
};

export const registerFadeSummons = () => {
  Hooks.on('refreshToken', (token) => {
    if (!token.mesh || !fadingSummons() || !isSummonedMinion(token)) return;
    token.mesh.alpha = Math.min(token.mesh.alpha, FADE_ALPHA);
  });
};
