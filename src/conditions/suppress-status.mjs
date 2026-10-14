const M = 'draw-steel-combat-tools';
const FLAG = 'suppressStatuses';

const _suppressors = (actor) => (actor?.effects ?? []).filter((e) => !e.disabled && Array.isArray(e.flags?.[M]?.[FLAG]) && e.flags[M][FLAG].length);

function _suppressedByAnother(effect) {
  if (!effect.statuses?.size || effect.flags?.[M]?.[FLAG]) return false;
  const actor = effect.parent?.documentName === 'Actor' ? effect.parent : effect.parent?.actor ?? null;
  for (const other of _suppressors(actor)) {
    if (other === effect) continue;
    if (other.flags[M][FLAG].some((s) => effect.statuses.has(s))) return true;
  }
  return false;
}

export function registerStatusSuppression() {
  if (!game.modules.get('lib-wrapper')?.active) return;
  libWrapper.register(M, 'CONFIG.ActiveEffect.documentClass.prototype.isSuppressed', function (wrapped) {
    return wrapped() || _suppressedByAnother(this);
  }, 'WRAPPER');

  const refresh = (effect) => {
    if (!effect.flags?.[M]?.[FLAG]) return;
    const actor = effect.parent?.documentName === 'Actor' ? effect.parent : null;
    if (!actor) return;
    actor.reset();
    for (const token of actor.getActiveTokens()) token.renderFlags.set({ refreshEffects: true });
  };
  Hooks.on('createActiveEffect', refresh);
  Hooks.on('deleteActiveEffect', refresh);
}
