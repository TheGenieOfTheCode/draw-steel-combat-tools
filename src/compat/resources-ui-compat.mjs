import { safeUpdate, safeDelete } from '../helpers.mjs';

const RUI = 'draw-steel-resources-ui';
const TRIGGERS = 'draw-steel-triggers';
const CARD = 'dsresources-chat-card';

let _rui = null;

const textOf = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html ?? '';
  return div;
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const sharedTracking = () => {
  try { return game.settings.get(RUI, 'combatTracking') && game.settings.get(RUI, 'sharedTracking'); }
  catch { return false; }
};
const stillUsed = (actor, trackKey) => (sharedTracking()
  ? (actor.getFlag(RUI, 'usedEntries') ?? []).includes(trackKey)
  : !!_rui.ResourceApp._usedEntries?.[actor.id]?.has(trackKey));

const activeActor = (app) => (game.user.isGM ? game.actors.get(app?._selectedActorId) ?? null : game.user.character ?? null);

const entryFor = (actor, trackKey) => {
  const id = trackKey.split(':').slice(1).join(':');
  const classDef = _rui.getClassDefinition(actor);
  if (!classDef) return null;
  const entries = _rui.resolveEntries(classDef.gains ?? [], _rui.getHeroLevel(actor));
  return entries.find((e) => e.id === id) ?? entries.flatMap((e) => e.children ?? []).find((e) => e.id === id) ?? null;
};

const cardFor = (actor, entry) => {
  const since = game.combat?._stats?.createdTime ?? 0;
  const method = clean(textOf(entry.description).textContent);
  return game.messages.contents
    .filter((m) => m.speaker?.actor === actor.id && (m.content ?? '').includes(CARD) && (m.timestamp ?? 0) >= since)
    .reverse()
    .find((m) => clean(textOf(m.content).querySelector('.dsresources-chat-method')?.textContent) === method) ?? null;
};

const refund = async (actor, trackKey) => {
  if (stillUsed(actor, trackKey)) return;
  const entry = entryFor(actor, trackKey);
  const card = entry ? cardFor(actor, entry) : null;
  if (!card) return;
  const amount = Number(textOf(card.content).querySelectorAll('.dsresources-chat-header strong')[1]?.textContent);
  if (!(amount > 0)) return;
  const value = Number(actor.system?.hero?.primary?.value ?? 0);
  
  await safeUpdate(actor, { 'system.hero.primary.value': Math.max(0, value - amount) }, { dsblQuiet: true });
  await safeDelete(card);
};

const wrapUndo = (actions) => {
  const original = actions?.undoUsage;
  if (typeof original !== 'function' || original._dsctRefunds) return;
  const wrapped = async function (event, target) {
    const trackKey = target?.dataset?.trackKey;
    const actor = activeActor(this);
    const triggers = game.modules.get(TRIGGERS)?.active ? game.modules.get(TRIGGERS).api : null;
    const theirs = !!(actor && trackKey && triggers?.ownsResourceGain?.(actor.id, trackKey));
    await original.call(this, event, target);
    if (actor && trackKey && !theirs) await refund(actor, trackKey);
  };
  wrapped._dsctRefunds = true;
  actions.undoUsage = wrapped;
};

export const registerResourcesUiCompat = () => {
  Hooks.once('ready', async () => {
    if (!game.modules.get(RUI)?.active) return;
    try {
      const [app, logic] = await Promise.all([
        import(`/modules/${RUI}/src/resources/resource-app.mjs`),
        import(`/modules/${RUI}/src/resources/resource-logic.mjs`),
      ]);
      _rui = { ResourceApp: app.ResourceApp, ...logic };
      wrapUndo(app.ResourceApp.DEFAULT_OPTIONS?.actions);
      wrapUndo(app.ResourceApp._instance?.options?.actions);
    } catch (err) {
      console.warn('DSCT | Draw Steel - Resources UI could not be read, so its undo stays as it is', err);
    }
  });
};
