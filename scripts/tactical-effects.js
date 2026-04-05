import { safeCreateEmbedded, safeDelete } from './helpers.js';

const JUDGEMENT_BASE_ORIGIN = 'dsct-judgement';
const MARK_BASE_ORIGIN      = 'dsct-mark';
const AID_ATTACK_ORIGIN     = 'dsct-aid-attack';

const AID_ATTACK_EFFECT = {
  name: 'Aid Attack (Target)',
  img: 'icons/skills/social/diplomacy-handshake-blue.webp',
  type: 'base',
  system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
  changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: {},
};


const getJudgementOrigin = () => `${JUDGEMENT_BASE_ORIGIN}-${game.user.id}`;
const getMarkOrigin = () => `${MARK_BASE_ORIGIN}-${game.user.id}`;


const removeExistingEffectGlobal = async (origin) => {
  const existing = game.actors.contents
    .flatMap(a => [...a.effects])
    .concat([...canvas.tokens.placeables.flatMap(t => t.actor?.isToken ? [...t.actor.effects] : [])])
    .find(e => e.origin === origin);
  if (existing) await safeDelete(existing);
};

export const applyJudgement = async () => {
  const targets = [...game.user.targets];
  if (targets.length !== 1) { ui.notifications.warn('Target exactly one creature to judge.'); return; }
  const targetToken = targets[0];

  const origin = getJudgementOrigin();
  await removeExistingEffectGlobal(origin);

  const effectData = {
    name: 'Judged',
    img: 'icons/magic/death/skull-humanoid-white-red.webp',
    type: 'base',
    system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
    changes: [],
    origin: origin
  };

  await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [effectData]);
  await ChatMessage.create({ content: `<strong>Judgement:</strong> ${targetToken.name} is judged.` });
};

export const applyMark = async () => {
  const targets = [...game.user.targets];
  if (targets.length !== 1) { ui.notifications.warn('Target exactly one creature to mark.'); return; }
  const targetToken = targets[0];

  const origin = getMarkOrigin();
  await removeExistingEffectGlobal(origin);

  const effectData = {
    name: 'Mark',
    img: 'icons/skills/targeting/crosshair-pointed-orange.webp',
    type: 'base',
    system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
    changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
    origin: origin
  };

  await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [effectData]);
  await ChatMessage.create({ content: `<strong>Mark:</strong> ${targetToken.name} is marked.` });
};



const recentlyProcessed = new Set();
const shouldTrigger = (key) => {
  if (recentlyProcessed.has(key)) return false;
  recentlyProcessed.add(key);
  setTimeout(() => recentlyProcessed.delete(key), 2000);
  return true;
};

const triggerProc = async (actor, effect) => {
  const isJudgement = effect.origin.startsWith(JUDGEMENT_BASE_ORIGIN);
  const isMark = effect.origin.startsWith(MARK_BASE_ORIGIN);

  if (isJudgement) {
    await ChatMessage.create({
      content: `<strong>${actor.name} has fallen!</strong> You may use a free triggered action to use @Macro[Judgement]{Judgement} against a new target.`
    });
  } else if (isMark) {
    await ChatMessage.create({
      content: `<strong>${actor.name} has fallen!</strong> You may use a free triggered action to use @Macro[Mark]{Mark} a new target within 10 squares.`
    });
  }

  await safeDelete(effect);
};

const handleActorDeath = (actor) => {
  if (!actor) return;
  const relevantEffects = actor.effects.filter(e =>
    e.origin?.startsWith(JUDGEMENT_BASE_ORIGIN) ||
    e.origin?.startsWith(MARK_BASE_ORIGIN)
  );

  for (const effect of relevantEffects) {
    
    const ownerId = effect.origin.split('-')[2];
    if (game.user.id === ownerId) {
      if (!shouldTrigger(`${actor.id}-${effect.id}`)) continue;
      triggerProc(actor, effect);
    }
  }
};

export const applyAidAttack = async () => {
  const selected = canvas.tokens.controlled;
  if (selected.length !== 1) { ui.notifications.warn('Select exactly one token before using Aid Attack.'); return; }

  const targets = [...game.user.targets];
  if (targets.length !== 1) { ui.notifications.warn('Target exactly one adjacent enemy before using Aid Attack.'); return; }

  const targetToken = targets[0];
  const targetActor = targetToken.actor;
  const targetTokenId = targetToken.id;

  const existing = targetActor.effects.find(e => e.origin === AID_ATTACK_ORIGIN);
  if (existing) await safeDelete(existing);

  const effectData = foundry.utils.deepClone(AID_ATTACK_EFFECT);
  effectData.origin = AID_ATTACK_ORIGIN;
  await safeCreateEmbedded(targetActor, 'ActiveEffect', [effectData]);

  await ChatMessage.create({ content: `<strong>Aid Attack:</strong> The next ally ability roll against <strong>${targetActor.name}</strong> has an edge.` });

  let rollHookId, combatEndHookId;

  const cleanup = async (reason) => {
    Hooks.off('createChatMessage', rollHookId);
    Hooks.off('deleteCombat', combatEndHookId);
    const effect = targetActor.effects.find(e => e.origin === AID_ATTACK_ORIGIN);
    if (effect) await safeDelete(effect);
    ui.notifications.info(`Aid Attack on ${targetActor.name} cleared - ${reason}.`);
  };

  rollHookId = Hooks.on('createChatMessage', async (message) => {
    if (!message.rolls?.length) return;
    if (message.rolls[0].options?.type !== 'test') return;
    const allTargets = game.users.contents.flatMap(u => [...u.targets]);
    if (!allTargets.some(t => t.id === targetTokenId)) return;
    await cleanup(`${message.speaker.alias} rolled against ${targetActor.name}`);
  });

  combatEndHookId = Hooks.on('deleteCombat', async () => {
    await cleanup('combat ended');
  });

  ui.notifications.info(`Aid Attack applied to ${targetActor.name}.`);
};

export const registerTacticalHooks = () => {
  Hooks.on('updateActor', (actor, changes, options) => {
    const newStamina = changes.system?.stamina?.value;
    if (newStamina === undefined) return;
    const prevStamina = options.ds?.previousStamina?.value ?? actor.system.stamina?.value;
    if (newStamina > 0 || prevStamina <= 0) return;
    handleActorDeath(actor);
  });

  Hooks.on('createActiveEffect', (effect) => {
    const statuses = [...(effect.statuses ?? [])];
    if (!statuses.includes('dead') && !statuses.includes('dying')) return;
    handleActorDeath(effect.parent);
  });
};