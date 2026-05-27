import { getSetting } from './helpers.mjs';

const roundFmt = (text) => `<hr><p style="text-align:center"><span style="font-family:'Draw Steel Book'"><span style="font-size:x-large">${text}</span></span></p><hr>`;

export const registerCombatLogHooks = () => {
  Hooks.on('combatStart', async () => {
    if (!getSetting('combatRoundLog')) return;
    if (!game.users.activeGM?.isSelf) return;
    await ChatMessage.create({ content: roundFmt('Draw Steel!') });
  });

  Hooks.on('updateCombat', async (combat, changes) => {
    if (!getSetting('combatRoundLog')) return;
    if (!game.users.activeGM?.isSelf) return;
    if (changes.round !== undefined && combat.started && changes.round > 1) {
      await ChatMessage.create({ content: roundFmt(`Round ${changes.round}`) });
    }
  });

  Hooks.on('deleteCombat', async () => {
    if (!getSetting('combatRoundLog')) return;
    if (!game.users.activeGM?.isSelf) return;
    await ChatMessage.create({ content: roundFmt('Combat Ends') });
  });

  Hooks.on('combatTurnChange', (combat, prior, current) => {
    if (!getSetting('combatTurnLog')) return;
    if (!game.users.activeGM?.isSelf) return;
    if (!combat.started) return;
    if (prior.round !== current.round) return;

    const fmt = (text) => `<p style="text-align:center"><span style="font-family:'Draw Steel Book'"><span style="font-size:large">${text}</span></span></p>`;
    if (!current.combatantId && prior.combatantId) {
      const c = combat.combatants.get(prior.combatantId);
      if (c) ChatMessage.create({ content: fmt(`${c.name} ended their turn.`) });
    } else if (current.combatantId && !prior.combatantId) {
      const c = combat.combatants.get(current.combatantId);
      if (c) ChatMessage.create({ content: fmt(`${c.name} started their turn.`) });
    }
  });
};
