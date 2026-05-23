import { getSetting, getItemDsid } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';

let previousTurnStrikes = new Set();
let currentTurnStrikes  = new Set();

export function getStrikeType(item) {
  const kw = item.system?.keywords;
  if (!kw?.has('strike')) return null;
  const melee  = kw.has('melee');
  const ranged = kw.has('ranged');
  if (melee && ranged) return item.system.damageDisplay ?? 'melee';
  if (melee)  return 'melee';
  if (ranged) return 'ranged';
  return null;
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
  Hooks.on('combatTurnChange', (combat) => {
    if (!getSetting('crossfadeEnabled')) return;
    const actor = findCrossfadeActor();
    if (!actor) return;
    if (combat.combatant?.actorId !== actor.id) return;
    previousTurnStrikes = new Set(currentTurnStrikes);
    currentTurnStrikes  = new Set();
    if (getSetting('debugMode')) console.log('DSCT | Crossfade | Turn started. previous:', [...previousTurnStrikes]);
  });

  Hooks.on('renderAbilityConfigurationDialog', (app, _html, _data) => {
    if (!getSetting('crossfadeEnabled')) return;

    const item = app.options.ability ?? app.item;
    if (!item) return;

    const actor   = item.actor ?? item.parent;
    if (!actor) return;

    const cfActor = findCrossfadeActor();
    if (!cfActor || actor.id !== cfActor.id) return;

    const strikeType = getStrikeType(item);
    if (!strikeType) return;

    const eligible = !previousTurnStrikes.has(strikeType) && !currentTurnStrikes.has(strikeType);
    if (getSetting('debugMode')) console.log(`DSCT | Crossfade | ${item.name}: type=${strikeType}, eligible=${eligible}, prev=[${[...previousTurnStrikes]}], curr=[${[...currentTurnStrikes]}]`);

    
    if (eligible && !app._dsctCrossfadeApplied) {
      app._dsctCrossfadeApplied = true;
      app.options.context.modifiers.edges = (app.options.context.modifiers.edges ?? 0) + 1;
      app.render();
      return; 
    }

    const el = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    if (!el) return;

    if (app._dsctCrossfadeApplied) {
      const edgeSel = el.querySelector('select[name="modifiers.edges"]');
      if (edgeSel && !el.querySelector('.dsct-crossfade-hint')) {
        const notice = document.createElement('p');
        notice.className = 'hint dsct-crossfade-hint';
        notice.innerHTML = '<i class="fa-solid fa-shuffle"></i> Crossfade: edge added';
        edgeSel.closest('.form-group')?.after(notice);
      }
    }

    const rollBtn = el.querySelector('button:not([data-action])');
    if (!rollBtn) return;

    rollBtn.addEventListener('click', () => {
      currentTurnStrikes.add(strikeType);

      const mod     = app.options.context?.modifiers ?? {};
      const netEdge = (mod.edges ?? 0) - (mod.banes ?? 0);
      if (netEdge <= 0) return;

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
