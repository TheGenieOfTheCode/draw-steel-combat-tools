import { isPrimaryGM } from '../ctlib.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'endsWhenNotWinded';

const winded = (actor) => {
  const st = actor?.system?.stamina;
  return !!st && Number(st.value) <= Number(st.winded);
};

export function registerWindedEffects() {
  Hooks.on('updateActor', async (actor, changes) => {
    if (!isPrimaryGM() || !foundry.utils.hasProperty(changes, 'system.stamina.value') || winded(actor)) return;
    const ending = actor.effects.filter((e) => e.flags?.[M]?.[FLAG]).map((e) => e.id);
    if (ending.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ending).catch(() => {});
  });
}
