import { getSetting, getSquadGroup, safeDelete } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';

export const DEFER_DEATH = 'dsctDeferDeath';

const _status = () => ({
  id: DEFER_DEATH,
  _id: DEFER_DEATH.padEnd(16, '0'),
  order: 2,
  name: 'DSCT.status.deferDeath',
  img: 'icons/svg/angel.svg',
  description: game.i18n.localize('DSCT.status.deferDeathDescription'),
});

export function registerDeferDeath() {
  if (!getSetting('deathTrackerEnabled')) return;
  
  Hooks.once('i18nInit', () => { CONFIG.statusEffects[DEFER_DEATH] = _status(); });
  registerDefeatBlock();
  registerReleaseRecheck();

  
  Hooks.on('createActiveEffect', async (effect) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!effect?.statuses?.has(DEFER_DEATH)) return;
    const actor = effect.parent;
    if (actor?.documentName !== 'Actor' || !actor.system?.isMinion) return;
    const group = getSquadGroup(actor);
    if (!group) return;
    const others = [...(group.system?.minions ?? [])]
      .map(m => m.token?.actor ?? m.actor)
      .filter(a => a && a !== actor && isDeathDeferred(a));
    if (!others.length) return;
    await safeDelete(effect);
    ui.notifications.warn(game.i18n.format('DSCT.notice.dt.deferAlreadyInSquad', {
      squad: group.name ?? 'squad', other: others[0].name,
    }));
  });
}

export const isDeathDeferred = (actor) => !!actor?.statuses?.has(DEFER_DEATH);

const _defeatedId = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';

function registerDefeatBlock() {
  
  Hooks.on('preUpdateCombatant', (combatant, changes) => {
    if (changes?.defeated !== true) return;
    if (!isDeathDeferred(combatant?.actor)) return;
    if (getSetting('debugMode')) console.log(`DSCT | DEFER | refused the defeated flag on ${combatant.actor.name}`);
    return false;
  });
}

function registerReleaseRecheck() {
  Hooks.on('deleteActiveEffect', async (effect) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!effect?.statuses?.has(DEFER_DEATH)) return;
    const actor = effect.parent;
    if (actor?.documentName !== 'Actor') return;
    await new Promise((r) => setTimeout(r, 250));
    if (isDeathDeferred(actor)) return;
    if (actor.statuses?.has(_defeatedId())) return;

    const group = getSquadGroup(actor);
    if (group) {
      
      const live = [...(group.system?.minions ?? [])]
        .map(m => m.token?.actor ?? m.actor)
        .filter(a => a && !a.statuses?.has(_defeatedId()));
      const indiv = live[0]?.system?.stamina?.max || 1;
      const owed = live.length - Math.ceil((group.system?.staminaValue ?? 0) / indiv);
      if (getSetting('debugMode')) console.log(`DSCT | DEFER | released ${actor.name}: live=${live.length} pool=${group.system?.staminaValue} owed=${owed}`);
      if (owed <= 0) return;
    } else if ((actor.system?.stamina?.value ?? 1) > 0) {
      return;
    }
    await actor.toggleStatusEffect(_defeatedId(), { active: true, overlay: true }).catch(() => {});
  });
}

export const isTokenDeathDeferred = (token) => isDeathDeferred(token?.actor);

export function withoutDeferred(tokenIds) {
  const out = new Set();
  for (const id of tokenIds ?? []) {
    const token = canvas.tokens.get(id);
    if (token && isTokenDeathDeferred(token)) continue;
    out.add(id);
  }
  return out;
}
