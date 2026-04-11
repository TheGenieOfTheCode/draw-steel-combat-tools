import { safeCreateEmbedded, safeDelete, safeUpdate, getSetting, getTokenById } from './helpers.mjs';

const M = 'draw-steel-combat-tools';

const TRIGGER_EFFECT = {
  name: "Unspent Triggered Action",
  img: "icons/magic/time/arrows-circling-pink.webp",
  type: "base",
  system: { end: { type: "encounter", roll: "" }, filters: { keywords: [] } },
  changes: [], disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
  description: "", tint: "#ffffff", transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'triggered-action' } }
};

const getActorFromCombatant = (combatant) => {
  const token = getTokenById(combatant.tokenId);
  if (!token) return null;
  return token.document.actorLink ? game.actors.get(combatant.actorId) : token.actor;
};

const shouldApply = (actor, mode, targetedIds = new Set()) => {
  if (!actor) return false;
  if (mode === 'HEROES')   return actor.type === 'hero';
  if (mode === 'NPCS')     return actor.type !== 'hero';
  if (mode === 'TARGETED') return targetedIds.has(actor.id);
  return true; 
};

const enableEffect = async (actor) => {
  const existing = actor.effects.find(e => e.getFlag(M, 'effectType') === 'triggered-action');
  if (existing) {
    if (existing.disabled) await safeUpdate(existing, { disabled: false });
    return;
  }
  await safeCreateEmbedded(actor, 'ActiveEffect', [foundry.utils.deepClone(TRIGGER_EFFECT)]);
};

const disableEffect = async (actor) => {
  const effect = actor.effects.find(e => e.getFlag(M, 'effectType') === 'triggered-action');
  if (effect && !effect.disabled) await safeUpdate(effect, { disabled: true });
};

export const applyTriggeredActions = async (mode = null, silent = false) => {
  const resolvedMode = mode ?? getSetting('autoTriggeredActionsTarget');
  
  
  if (!game.combat) {
    if (!silent) ui.notifications.warn('No active combat encounter.');
    return;
  }

  const targetedIds = new Set([...game.user.targets].map(t => t.actor?.id).filter(Boolean));
  if (resolvedMode === 'TARGETED' && !targetedIds.size) {
    if (!silent) ui.notifications.warn('Target at least one token for TARGETED mode.');
    return;
  }


  for (const token of canvas.tokens.placeables) {
    const actor = token.actor;
    if (!actor) continue;
    const effect = actor.effects.find(e => e.getFlag(M, 'effectType') === 'triggered-action');
    if (!effect) continue;

    if (!shouldApply(actor, resolvedMode, targetedIds)) {
      await safeDelete(effect);
    }
  }


  for (const combatant of game.combat.combatants.contents) {
    const actor = getActorFromCombatant(combatant);
    if (!actor) continue;

    if (shouldApply(actor, resolvedMode, targetedIds)) {
      await enableEffect(actor);
    }
  }

  if (!silent) {
    const modeLabel = resolvedMode === 'TARGETED' ? `${targetedIds.size} targeted tokens` :
                      resolvedMode === 'HEROES'   ? 'heroes only' :
                      resolvedMode === 'NPCS'     ? 'NPCs only' : `${game.combat.combatants.size} combatants`;
    ui.notifications.info(`Triggered Action Tracker active (${modeLabel}).`);
  }
};

export const registerTriggeredActionHooks = () => {
  Hooks.on('combatStart', async (combat, updateData) => {
    if (!getSetting('autoTriggeredActionsEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;

    const targetMode = getSetting('autoTriggeredActionsTarget');
    await applyTriggeredActions(targetMode, true); 
  });

  Hooks.on('updateCombat', async (combat, changes) => {
    if (!game.users.activeGM?.isSelf) return;
    if (changes.round === undefined) return;

    
    
    for (const combatant of combat.combatants.contents) {
      const actor = getActorFromCombatant(combatant);
      if (!actor) continue;
      
      const effect = actor.effects.find(e => e.getFlag(M, 'effectType') === 'triggered-action');
      if (effect && effect.disabled) {
        await safeUpdate(effect, { disabled: false });
      }
    }
  });

  Hooks.on('createChatMessage', async (message) => {
    if (!game.users.activeGM?.isSelf) return;

    const parts = message.system?.parts?.contents;
    if (!parts) return;
    
    const abilityUse = parts.find(p => p.type === 'abilityUse');
    if (!abilityUse?.abilityUuid) return;
    
    const item = await fromUuid(abilityUse.abilityUuid);
    if (item?.system?.type !== 'triggered') return;

    const actor = ChatMessage.getSpeakerActor(message.speaker);
    if (!actor) return;

    await disableEffect(actor);
  });

  Hooks.on('deleteCombat', async () => {
    if (!game.users.activeGM?.isSelf) return;

    for (const token of canvas.tokens.placeables) {
      const actor = token.actor;
      if (!actor) continue;
      const effect = actor.effects.find(e => e.getFlag(M, 'effectType') === 'triggered-action');
      if (effect) await safeDelete(effect);
    }
  });
};