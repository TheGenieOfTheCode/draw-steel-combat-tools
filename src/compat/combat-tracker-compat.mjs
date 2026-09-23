import { getSetting } from '../helpers.mjs';

const TRACKER_ID = 'draw-steel-combat-tracker';

const AUTO_DEFEAT_MARKS = ['dsCombatDock', 'shouldBeDefeated'];

const _isAutoDefeatHook = (entry) => {
  if (typeof entry?.fn !== 'function') return false;
  const src = entry.fn.toString();
  return AUTO_DEFEAT_MARKS.every((mark) => src.includes(mark));
};

const _refreshDockOnly = (actor) => {
  if (!ui.dsCombatDock) return;
  const combat = ui.dsCombatDock.combat;
  if (!combat) return;
  const isInCombat = combat.combatants.some((c) => c.actorId === actor.id || c.actor?.id === actor.id);
  if (isInCombat) ui.dsCombatDock.scheduleRefresh();
};

export function suppressTrackerAutoDefeat() {
  if (!game.modules.get(TRACKER_ID)?.active) return;
  if (!getSetting('suppressTrackerAutoDefeat')) return;

  const events = Hooks.events ?? Hooks._hooks ?? {};
  const found = (events.updateActor ?? []).filter(_isAutoDefeatHook);
  if (!found.length) {
    
    console.warn('DSCT | combat tracker compat | could not find the auto defeat hook to suppress; it may have been changed or removed upstream');
    return;
  }
  for (const entry of found) Hooks.off('updateActor', entry.id);
  Hooks.on('updateActor', _refreshDockOnly);
  console.log(`DSCT | combat tracker compat | suppressed ${found.length} auto defeat hook(s); the dock still refreshes and this module owns death`);
}
