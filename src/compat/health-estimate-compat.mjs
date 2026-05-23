import { getSetting } from '../helpers.mjs';

const _isMinionInSquad = (token) => {
  if (!token.actor?.system?.isMinion) return false;
  const comb = game.combat?.combatants?.find(c => c.tokenId === token.id);
  const groupId = comb?._source?.group;
  return !!groupId && !!(game.combat?.groups?.get(groupId));
};

const _getSquadMinionCount = (token) => {
  const comb = game.combat?.combatants?.find(c => c.tokenId === token.id);
  const groupId = comb?._source?.group;
  if (!groupId) return null;
  const group = game.combat?.groups?.get(groupId);
  if (!group) return null;
  return Array.from(group.members ?? []).filter(m => !m.defeated && m.actor?.system?.isMinion).length;
};

let _wrappedGetEstimation = null;

const _applyPatch = () => {
  if (!game.healthEstimate) return;
  const setting = getSetting('minionHealthEstimate');

  if (_wrappedGetEstimation) {
    game.healthEstimate.getEstimation = _wrappedGetEstimation;
    _wrappedGetEstimation = null;
  }

  if (setting === 'hide') {
    const _innerBreak = game.healthEstimate.breakOverlayRender.bind(game.healthEstimate);
    game.healthEstimate.breakOverlayRender = (token) => _isMinionInSquad(token) || _innerBreak(token);
  }

  if (setting === 'count') {
    _wrappedGetEstimation = game.healthEstimate.getEstimation.bind(game.healthEstimate);
    game.healthEstimate.getEstimation = (token) => {
      if (_isMinionInSquad(token)) {
        const count = _getSquadMinionCount(token);
        if (count !== null) {
          const label = count === 1
            ? game.i18n.localize('DSCT.healthEstimate.minionCount.one')
            : game.i18n.format('DSCT.healthEstimate.minionCount.many', { count });
          return { desc: label, color: '#6699ff', stroke: '#003399' };
        }
      }
      return _wrappedGetEstimation(token);
    };
  }
};

export const registerHealthEstimateCompat = () => {
  if (!game.modules.get('healthEstimate')?.active) return;
  Hooks.once('ready', _applyPatch);
};
