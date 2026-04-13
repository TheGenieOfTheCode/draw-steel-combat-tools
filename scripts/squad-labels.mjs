import { safeCreateEmbedded, safeDelete, getSetting } from './helpers.mjs';

const M         = 'draw-steel-combat-tools';
const ICON_PATH = 'modules/draw-steel-combat-tools/assets/icons';

const GROUP_TINTS = {
  1:  '#ff4444',
  2:  '#4488ff',
  3:  '#44dd44',
  4:  '#ffcc00',
  5:  '#ff44ff',
  6:  '#44ffff',
  7:  '#ff8800',
  8:  '#aa44ff',
  9:  '#00ff88',
  10: '#ff88aa',
};

export const autoRenameGroups = async () => {
  if (!game.combat) return;
  
  let groupNum = 1;
  const groups = game.combat.groups?.contents ?? [];
  
  for (const group of groups) {
    const combatants = [...group.members];
    if (!combatants.length) continue;
    
    
    if (combatants.some(c => c.actor?.type === 'hero')) continue;

    await group.update({ name: `Group ${groupNum}` });
    groupNum++;
  }
};

export const applySquadLabels = async () => {
  if (!game.combat) {
    ui.notifications.warn("No active combat encounter found.");
    return;
  }
  
  const allTokens = canvas.tokens.placeables;
  for (const token of allTokens) {
    if (!token.actor) continue;
    const effects = token.actor.effects.filter(e => e.getFlag(M, 'effectType') === 'squad-label');
    for (const effect of effects) {
      await safeDelete(effect);
    }
  }
  
  for (const group of game.combat.groups?.contents ?? []) {
    const match = group.name.match(/^Group (\d+)([a-z]?)$/i);
    if (!match) continue;

    const num    = parseInt(match[1]);
    const letter = (match[2] || '').toLowerCase();

    if (num > 10) continue;

    const combatants = [...group.members];
    if (!combatants.length) continue;
    if (combatants.some(c => c.actor?.type === 'hero')) continue;

    const tint      = GROUP_TINTS[num] ?? '#ffffff';
    const suffix    = letter === 'b' ? 'B' : '';
    const captainId = group.system?.captainId;

    for (const combatant of combatants) {
      const token = allTokens.find(t => t.id === combatant.tokenId);
      if (!token) continue;
      const actor = token.actor;
      if (!actor) continue;

      const isCaptain = combatant.id === captainId;
      const isMinion  = actor.system.monster?.organization === 'minion';
      const prefix    = isCaptain ? 'Captain' : isMinion ? 'Minion' : 'Group';
      
      const img       = `${ICON_PATH}/${prefix}${num}${suffix}.png`;

      const effectData = {
        name: group.name,
        img,
        type: "base",
        system: { end: { type: "encounter", roll: "" }, filters: { keywords: [] } },
        changes: [],
        disabled: false,
        duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
        description: "", tint, transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'squad-label' } }
      };

      await safeCreateEmbedded(actor, 'ActiveEffect', [effectData]);
    }
  }
  
  if (!game.combat.started) {
    ui.notifications.info("Squad labels applied.");
  }
};

export const registerSquadLabelHooks = () => {
  Hooks.on('combatStart', async (combat, updateData) => {
    
    if (!getSetting('autoSquadLabelsEnabled')) return;
    
    if (!game.users.activeGM?.isSelf) return;
    
    await new Promise(resolve => setTimeout(resolve, 500));

    new Dialog({
      title: "Auto-Rename Squads?",
      content: "<p>Do you want to rename all NPC combat groups to <strong>Group 1</strong>, <strong>Group 2</strong>, etc. before applying the labels?</p>",
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Rename & Apply",
          callback: async () => {
            await autoRenameGroups();
            await applySquadLabels();
            ui.notifications.info("Combat squads renamed and labels applied.");
          }
        },
        no: {
          icon: '<i class="fas fa-paint-brush"></i>',
          label: "Just Apply Labels",
          callback: async () => {
            await applySquadLabels();
            ui.notifications.info("Squad labels applied to existing groups.");
          }
        }
      },
      default: "yes"
    }).render(true);
  });
};