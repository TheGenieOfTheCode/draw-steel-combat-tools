import { getSetting, getItemDsid } from '../../helpers.mjs';

const M   = 'draw-steel-combat-tools';
const DBG = () => getSetting('debugMode');

let hiwActivatedCombatantIds = new Set();

function findHIWActor(combat) {
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || actor.type !== 'hero' || combatant.defeated) continue;
    if (actor.items.some(i => getItemDsid(i) === 'hesitation-is-weakness' || i.name.toLowerCase() === 'hesitation is weakness'))
      return actor;
  }
  return null;
}

async function markPendingHIWUsed(actorId) {
  for (const msg of game.messages.contents) {
    if (msg.getFlag(M, 'isHiwMessage') && msg.getFlag(M, 'hiwActorId') === actorId && !msg.getFlag(M, 'isUsed')) {
      await msg.setFlag(M, 'isUsed', true);
    }
  }
}

export const executeHIWTurn = async (actorUuid, msgId) => {
  const actor = await fromUuid(actorUuid);
  if (!actor) return;

  const priLabel = actor.system.hero?.primary?.label ?? 'Insight';
  const insight  = actor.system.hero?.primary?.value ?? 0;

  if (insight < 1) {
    ui.notifications.warn(`${actor.name} has no ${priLabel} remaining.`);
    return;
  }

  const combatant = game.combat?.combatants.find(c => c.actorId === actor.id && !c.defeated);
  if (!combatant || !(combatant.initiative > 0)) {
    ui.notifications.warn(`${actor.name} has already taken their turn this round.`);
    return;
  }

  await actor.update({ 'system.hero.primary.value': insight - 1 });

  await combatant.update({ initiative: combatant.initiative - 1 });
  const newTurn = game.combat.turns.findIndex(c => c === combatant);
  if (newTurn >= 0) await game.combat.update({ turn: newTurn }, { direction: 1 });

  hiwActivatedCombatantIds.add(combatant.id);
  await markPendingHIWUsed(actor.id);
};

export const registerHIWHooks = () => {
  if (!getSetting('abilityAutomationEnabled')) return;
  
  if (game.modules.get('draw-steel-triggers')?.active) return;
  Hooks.on('updateCombat', async (combat, changes) => {
    if (changes.round === undefined) return;
    hiwActivatedCombatantIds.clear();
    if (!game.users.activeGM?.isSelf) return;
    for (const msg of game.messages.contents) {
      if (msg.getFlag(M, 'isHiwMessage') && !msg.getFlag(M, 'isUsed')) {
        await msg.setFlag(M, 'isUsed', true);
      }
    }
  });

  Hooks.on('combatTurnChange', async (combat, prior, current) => {
    if (!getSetting('hiwEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;
    if (!combat.started) return;
    if (prior.round !== current.round) return;

    if (current.combatantId) { if (DBG()) console.log('DSCT | HIW: turn start event, skipping'); return; }
    if (!prior.combatantId)  { if (DBG()) console.log('DSCT | HIW: no prior combatant'); return; }

    if (DBG()) console.log('DSCT | HIW: turn end detected, prior combatantId:', prior.combatantId);

    const endedCombatant = combat.combatants.get(prior.combatantId);
    if (!endedCombatant) { if (DBG()) console.log('DSCT | HIW: endedCombatant not found'); return; }

    const wasHIW = hiwActivatedCombatantIds.has(endedCombatant.id);
    hiwActivatedCombatantIds.delete(endedCombatant.id);
    if (wasHIW) { if (DBG()) console.log('DSCT | HIW: ended turn was a HIW activation, skipping'); return; }

    const endedActor = endedCombatant.actor;
    if (!endedActor || endedActor.type !== 'hero') { if (DBG()) console.log('DSCT | HIW: ended actor is not a hero:', endedActor?.name); return; }

    const hiwActor = findHIWActor(combat);
    if (!hiwActor) { if (DBG()) console.log('DSCT | HIW: no HIW actor found in combat'); return; }
    if (endedActor.id === hiwActor.id) { if (DBG()) console.log('DSCT | HIW: HIW actor ended their own turn'); return; }

    const hiwCombatant = combat.combatants.find(c => c.actorId === hiwActor.id && !c.defeated);
    if (!hiwCombatant || !(hiwCombatant.initiative > 0)) { if (DBG()) console.log('DSCT | HIW: HIW combatant already went (initiative:', hiwCombatant?.initiative, ')'); return; }

    const insight = hiwActor.system.hero?.primary?.value ?? 0;
    if (insight < 1) { if (DBG()) console.log('DSCT | HIW: HIW actor has no Insight'); return; }

    if (DBG()) console.log('DSCT | HIW: posting notification for', hiwActor.name);
    const priLabel = hiwActor.system.hero?.primary?.label ?? 'Insight';
    await ChatMessage.create({
      content: `<b><i class="fa-solid fa-bolt"></i> Hesitation Is Weakness:</b> ${hiwActor.name} may take their turn now (costs 1 ${priLabel}).`,
      flags: { [M]: { isHiwMessage: true, hiwActorId: hiwActor.id, hiwActorUuid: hiwActor.uuid, isUsed: false } },
      speaker: ChatMessage.getSpeaker({ actor: hiwActor }),
    });
  });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!msg.getFlag(M, 'isHiwMessage')) return;

    const actorUuid  = msg.getFlag(M, 'hiwActorUuid');
    const hiwActorId = msg.getFlag(M, 'hiwActorId');
    const isUsed     = msg.getFlag(M, 'isUsed');
    const hiwActor   = game.actors.get(hiwActorId);

    let btnArea = el.querySelector('.message-part-buttons');
    if (!btnArea) {
      btnArea = document.createElement('div');
      btnArea.className = 'message-part-buttons';
      (el.querySelector('.message-content') ?? el).appendChild(btnArea);
    }

    if (isUsed) {
      const status = document.createElement('div');
      status.className = 'dsct-undo-status';
      status.textContent = '(Turn Started)';
      btnArea.appendChild(status);
      return;
    }

    const isOwner = hiwActor?.testUserPermission(game.user, 'OWNER') ?? false;
    if (!game.user.isGM && !isOwner) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-bolt"></i> Start ${hiwActor?.name ?? 'Character'}'s Turn`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const api = game.modules.get(M).api;
      if (game.user.isGM) {
        await executeHIWTurn(actorUuid, msg.id);
      } else {
        await api.socket.executeAsGM('dsct.executeHIWTurn', actorUuid, msg.id);
      }
    });
    btnArea.appendChild(btn);
  });
};
