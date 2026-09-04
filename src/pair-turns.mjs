import { getSetting } from './helpers.mjs';
import { fireStartTurn, fireEndTurn } from './squad-turns.mjs';

window._dsctActivePairLeaderId = window._dsctActivePairLeaderId ?? null;
window._dsctActivePairIds = window._dsctActivePairIds ?? new Set();

function getPairPartners(combatant, combat) {
  const actor = combatant?.actor;
  if (!actor) return [];
  const ownMentorId = actor.system?.retainer?.mentor?.id ?? null;
  const mentorActorId = ownMentorId ?? actor.id;
  return combat.combatants.filter(c =>
    c.id !== combatant.id &&
    (c.actor?.id === mentorActorId ||
      (c.actor?.system?.retainer?.mentor?.id ?? null) === mentorActorId)
  );
}

function _clearPairState() {
  window._dsctActivePairLeaderId = null;
  window._dsctActivePairIds = new Set();
}

export function registerPairTurnHooks() {
  Hooks.on('deleteCombat', _clearPairState);

  
  Hooks.on('renderCombatTracker', (_app, html) => {
    if (!getSetting('pairSimultaneousTurns')) return;
    const el = html instanceof HTMLElement ? html : html[0];
    if (!el || !game.combat) return;
    for (const combatant of game.combat.combatants) {
      const mentorId = combatant.actor?.system?.retainer?.mentor?.id ?? null;
      if (!mentorId) continue;
      if (!game.combat.combatants.some(c => c.actor?.id === mentorId)) continue;
      const row = el.querySelector(`.combatant[data-combatant-id="${combatant.id}"]`);
      if (!row) continue;
      for (const initDiv of row.querySelectorAll('.token-initiative')) {
        initDiv.style.display = 'none';
      }
    }
  });

  Hooks.on('combatTurnChange', async (combat, previous, current) => {
    if (!getSetting('pairSimultaneousTurns')) return;

    const cur = combat.combatants.get(current?.combatantId);

    
    const leavingPair = window._dsctActivePairLeaderId
      && cur?.id !== window._dsctActivePairLeaderId
      && !window._dsctActivePairIds?.has(cur?.id);
    if (leavingPair) {
      const oldPartnerIds = [...(window._dsctActivePairIds ?? [])];
      const oldLeaderId = window._dsctActivePairLeaderId;
      _clearPairState();
      for (const pid of oldPartnerIds) {
        const partner = combat.combatants.get(pid);
        if (game.user.isGM && partner) await fireEndTurn(partner, combat, previous?.round ?? combat.round);
        partner?.token?.object?._refreshTurnMarker?.();
      }
      combat.combatants.get(oldLeaderId)?.token?.object?._refreshTurnMarker?.();
    }

    if (!cur) return;
    
    if (cur.id === window._dsctActivePairLeaderId || window._dsctActivePairIds?.has(cur.id)) return;

    const partners = getPairPartners(cur, combat).filter(p => p.initiative > 0 && !p.isDefeated);
    if (!partners.length) return;

    window._dsctActivePairLeaderId = cur.id;
    window._dsctActivePairIds = new Set(partners.map(p => p.id));

    if (game.user.isGM) {
      for (const partner of partners) {
        await fireStartTurn(partner, combat);
        try { await partner.update({ initiative: partner.initiative - 1 }, { _dsctPairBatch: true }); }
        catch (err) { if (getSetting('debugMode')) console.warn('DSCT | pair-turns | partner update skipped:', err.message); }
      }
      
      const idx = combat.turns.findIndex(c => c.id === cur.id);
      if (idx >= 0 && combat.turn !== idx) await combat.update({ turn: idx }).catch(() => {});
    }

    for (const partner of partners) partner.token?.object?._refreshTurnMarker?.();
    cur.token?.object?._refreshTurnMarker?.();
  });
}
