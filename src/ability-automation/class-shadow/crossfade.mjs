import { getSetting, getItemDsid } from '../../helpers.mjs';
import { chooseKeywords } from '../choose-effect.mjs';

const M = 'draw-steel-combat-tools';

let previousTurnStrikes = new Set();
let currentTurnStrikes  = new Set();

const CF_EFFECT_DEFS = {
  melee: {
    name: 'Crossfade: Melee Edge',
    img:  'icons/skills/melee/sword-winged-holy-orange.webp',
    type: 'base',
    system: { end: { roll: '1d10 + @combat.save.bonus' }, filters: { keywords: [] } },
    changes: [], disabled: false,
    duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null, expiry: 'combatEnd' },
    description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0,
    flags: { [M]: { isCrossfadeEffect: true, strikeType: 'melee' } },
  },
  ranged: {
    name: 'Crossfade: Ranged Edge',
    img:  'icons/skills/ranged/shuriken-thrown-orange.webp',
    type: 'base',
    system: { end: { roll: '1d10 + @combat.save.bonus' }, filters: { keywords: [] } },
    changes: [], disabled: false,
    duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null, expiry: 'combatEnd' },
    description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0,
    flags: { [M]: { isCrossfadeEffect: true, strikeType: 'ranged' } },
  },
};

function _getCfEffect(actor, type) {
  return actor.effects.find(e => e.getFlag(M, 'isCrossfadeEffect') && e.getFlag(M, 'strikeType') === type);
}

async function _hydrateCrossfadeState() {
  const cfActor   = findCrossfadeActor();
  const combatant = cfActor ? game.combat?.combatants.find(c => c.actorId === cfActor.id && !c.defeated) : null;
  if (!combatant) return;
  previousTurnStrikes = new Set(combatant.getFlag(M, 'crossfadePrevStrikes') ?? []);
  currentTurnStrikes  = new Set(combatant.getFlag(M, 'crossfadeCurrStrikes') ?? []);
  if (game.users.activeGM?.isSelf) await _syncCfEffects(cfActor);
}

async function _saveCrossfadeState(cfActor) {
  const combatant = game.combat?.combatants.find(c => c.actorId === cfActor.id && !c.defeated);
  if (!combatant) return;
  await combatant.update({
    [`flags.${M}.crossfadePrevStrikes`]: [...previousTurnStrikes],
    [`flags.${M}.crossfadeCurrStrikes`]: [...currentTurnStrikes],
  });
}

function _saveCurrStrikes(cfActor) {
  const combatant = game.combat?.combatants.find(c => c.actorId === cfActor.id && !c.defeated);
  if (!combatant) return;
  const data = { [`flags.${M}.crossfadeCurrStrikes`]: [...currentTurnStrikes] };
  if (game.user.isGM) combatant.update(data).catch(() => {});
  else game.modules.get(M).api.socket?.executeAsGM('dsct.updateDocument', combatant.uuid, data);
}

async function _syncCfEffects(actor) {
  for (const type of ['melee', 'ranged']) {
    const eligible = !previousTurnStrikes.has(type);
    const existing = _getCfEffect(actor, type);
    if (eligible && !existing) await actor.createEmbeddedDocuments('ActiveEffect', [CF_EFFECT_DEFS[type]]);
    else if (!eligible && existing) await existing.delete();
  }
}

export function getStrikeType(item) {
  const kw = chooseKeywords(item);
  if (!kw?.has('strike')) return null;
  const melee  = kw.has('melee');
  const ranged = kw.has('ranged');
  if (melee && ranged) return item.system.damageDisplay ?? 'melee';
  if (melee)  return 'melee';
  if (ranged) return 'ranged';
  return null;
}

export function isCrossfadeStrike(ability) {
  if (!getSetting('crossfadeEnabled')) return false;
  const actor = ability.actor ?? ability.parent;
  if (!actor) return false;
  const cfActor = findCrossfadeActor();
  if (!cfActor || actor.id !== cfActor.id) return false;
  return getStrikeType(ability) !== null;
}

export function getCrossfadeEdgeForAbility(ability) {
  if (!getSetting('crossfadeEnabled')) return null;
  const actor = ability.actor ?? ability.parent;
  if (!actor) return null;
  const cfActor = findCrossfadeActor();
  if (!cfActor || actor.id !== cfActor.id) return null;
  const strikeType = getStrikeType(ability);
  if (!strikeType) return null;
  if (previousTurnStrikes.has(strikeType) || currentTurnStrikes.has(strikeType)) return null;
  return strikeType;
}

function findCrossfadeActor() {
  for (const actor of game.actors) {
    if (actor.items.some(i => getItemDsid(i) === 'crossfade' || i.name.toLowerCase() === 'crossfade'))
      return actor;
  }
  return null;
}

function distanceToAnyTarget(sourceToken) {
  const targets = game.users.contents.flatMap(u => [...u.targets]);
  const target  = targets.find(t => t.id !== sourceToken.id);
  if (!target) return null;
  return canvas.grid.measurePath([
    { x: sourceToken.center.x, y: sourceToken.center.y },
    { x: target.center.x,      y: target.center.y },
  ]).distance;
}

export const registerCrossfadeHooks = () => {
  if (!getSetting('abilityAutomationEnabled')) return;

  Hooks.on('canvasReady', _hydrateCrossfadeState);

  Hooks.on('combatTurnChange', async (combat) => {
    if (!getSetting('crossfadeEnabled')) return;
    const actor = findCrossfadeActor();
    if (!actor) return;
    if (combat.combatant?.actorId !== actor.id) return;
    previousTurnStrikes = new Set(currentTurnStrikes);
    currentTurnStrikes  = new Set();
    if (getSetting('debugMode')) console.log('DSCT | Crossfade | Turn started. previous:', [...previousTurnStrikes]);
    if (!game.users.activeGM?.isSelf) return;
    await _syncCfEffects(actor);
    await _saveCrossfadeState(actor);
  });

  Hooks.on('deleteCombat', async () => {
    if (!game.users.activeGM?.isSelf) return;
    const actor = findCrossfadeActor();
    if (!actor) return;
    for (const type of ['melee', 'ranged']) {
      const effect = _getCfEffect(actor, type);
      if (effect) await effect.delete();
    }
    previousTurnStrikes = new Set();
    currentTurnStrikes  = new Set();
  });

  Hooks.on('renderAbilityConfigurationDialog', (app, _html, _data) => {
    if (!getSetting('crossfadeEnabled')) return;
    const item = app.options.ability ?? app.item;
    if (!item) return;
    const actor = item.actor ?? item.parent;
    if (!actor) return;
    const cfActor = findCrossfadeActor();
    if (!cfActor || actor.id !== cfActor.id) return;
    const strikeType = getStrikeType(item);
    if (!strikeType) return;

    const el = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    if (!el) return;
    const rollBtn = el.querySelector('button:not([data-action])');
    if (!rollBtn || rollBtn._dsctCfAttached) return;

    rollBtn._dsctCfAttached = true;
    rollBtn.addEventListener('click', () => {
      const cfPill      = app._dsctSources?.find(p => p.reason === 'Crossfade' && p.scope === 'global');
      const wasEligible = !previousTurnStrikes.has(strikeType) && !currentTurnStrikes.has(strikeType);
      const shouldFire  = cfPill ? cfPill.enabled : wasEligible;
      currentTurnStrikes.add(strikeType);
      _saveCurrStrikes(cfActor);

      const cfEffect = _getCfEffect(cfActor, strikeType);
      if (cfEffect) {
        const api = game.modules.get(M).api;
        if (game.user.isGM) cfEffect.delete().catch(() => {});
        else api.socket?.executeAsGM('dsct.deleteDocument', cfEffect.uuid);
      }

      if (!shouldFire) return;

      const sourceToken = canvas.tokens.placeables.find(t => t.actor?.id === cfActor.id);
      let canDisengage  = false;
      if (strikeType === 'melee') {
        canDisengage = true;
      } else {
        const dist   = sourceToken ? distanceToAnyTarget(sourceToken) : null;
        canDisengage = dist !== null && dist <= 5;
      }

      if (canDisengage) {
        setTimeout(async () => {
          await ChatMessage.create({
            content: '<b><i class="fa-solid fa-shuffle"></i> Crossfade:</b> You may Disengage as a free triggered action after the Strike resolves.',
            speaker: ChatMessage.getSpeaker({ actor: cfActor }),
          });
        }, 300);
      }
    }, { once: true });
  });
};
