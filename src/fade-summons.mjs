const M = 'draw-steel-combat-tools';
const FADE_ALPHA = 0.3;

let _summoner = null;

export const fadingSummons = () => game.user?.getFlag(M, 'fadeSummons') === true;

export const isSummonedMinion = (token) => {
  const actor = token?.actor;
  if (!(actor?.system?.isMinion ?? actor?.isMinion)) return false;
  return !!(token.document?.getFlag(M, 'summonedBy') || actor.getFlag?.('draw-steel', 'summonSource'));
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

async function stampSummons(wrapped, ...args) {
  _summoner = this.parent?.uuid ?? null;
  try { return await wrapped(...args); }
  finally { _summoner = null; }
}

export const registerFadeSummons = () => {
  Hooks.once('ready', () => {
    if (typeof CONFIG.Item.dataModels?.ability?.prototype?.performSummon !== 'function') return;
    libWrapper.register(M, 'CONFIG.Item.dataModels.ability.prototype.performSummon', stampSummons, 'WRAPPER');
  });  Hooks.on('preCreateToken', (doc) => {
    if (_summoner) doc.updateSource({ [`flags.${M}.summonedBy`]: _summoner });
  });
  Hooks.on('refreshToken', (token) => {
    if (!token.mesh || !fadingSummons() || !isSummonedMinion(token)) return;
    token.mesh.alpha = Math.min(token.mesh.alpha, FADE_ALPHA);
  });
};
