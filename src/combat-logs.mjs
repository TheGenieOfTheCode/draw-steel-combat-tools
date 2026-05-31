import { getSetting } from './helpers.mjs';

const roundFmt = (text) => `<hr><p style="text-align:center"><span style="font-family:'Draw Steel Book'"><span style="font-size:x-large">${text}</span></span></p><hr>`;
const turnFmt  = (text) => `<p style="text-align:center"><span style="font-family:'Draw Steel Book'"><span style="font-size:large">${text}</span></span></p>`;

function squadTurnMsg(group, action) {
  const captain  = group.system?.captain;
  const capName  = captain?.token?.name ?? captain?.actor?.name;

  const counts = new Map();
  for (const member of group.members) {
    if (member.id === captain?.id) continue;
    const name = member.actor?.name ?? 'unknown';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const parts = [...counts.entries()].map(([name, n]) => `${n}× ${name}`);
  if (capName && parts.length) parts[0] += ` led by ${capName}`;
  else if (capName) parts.push(`led by ${capName}`);
  const detail = parts.join(' and ');

  const tokenIds = [...group.members].map(m => m.tokenId).filter(Boolean).join(',');
  return `<span class="dsct-squad-log" data-token-ids="${tokenIds}" data-tooltip="${detail}">${group.name}</span> ${action} their turn!`;
}

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

    const prevC = prior.combatantId ? combat.combatants.get(prior.combatantId) : null;
    const curC  = current.combatantId ? combat.combatants.get(current.combatantId) : null;

    const prevGroup = prevC?.group?.type === 'squad' ? prevC.group : null;
    const curGroup  = curC?.group?.type === 'squad' ? curC.group : null;

    const sameTurn = prevC && curC && prevC.group?.id && prevC.group?.id === curC.group?.id;
    if (sameTurn) return; 

    if (prevC) {
      const msg = prevGroup
        ? squadTurnMsg(prevGroup, 'ended')
        : `${prevC.name} ended their turn.`;
      ChatMessage.create({ content: turnFmt(msg) });
    }

    if (curC) {
      const msg = curGroup
        ? squadTurnMsg(curGroup, 'started')
        : `${curC.name} started their turn.`;
      ChatMessage.create({ content: turnFmt(msg) });
    }
  });

  Hooks.on('renderChatMessageHTML', (_msg, html) => {
    for (const span of html.querySelectorAll('.dsct-squad-log[data-token-ids]')) {
      const ids = span.dataset.tokenIds.split(',').filter(Boolean);
      span.style.cursor = 'pointer';
      span.addEventListener('mouseenter', () => {
        for (const id of ids) canvas.tokens?.get(id)?._onHoverIn?.({});
      });
      span.addEventListener('mouseleave', () => {
        for (const id of ids) canvas.tokens?.get(id)?._onHoverOut?.({});
      });
    }
  });
};
