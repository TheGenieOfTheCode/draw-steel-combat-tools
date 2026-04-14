import { safeCreateEmbedded, safeDelete, getItemDsid } from './helpers.mjs';

const M = 'draw-steel-combat-tools';

const AID_ATTACK_EFFECT = {
  name: 'Aid Attack (Target)',
  img: 'icons/skills/social/diplomacy-handshake-blue.webp',
  type: 'base',
  system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
  changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'aid-attack' } },
};


const removeExistingJudgement = async () => {
  const existing = game.actors.contents
    .flatMap(a => [...a.effects])
    .concat([...canvas.tokens.placeables.flatMap(t => t.actor?.isToken ? [...t.actor.effects] : [])])
    .find(e => e.getFlag(M, 'judgement')?.userId === game.user.id);
  if (existing) await safeDelete(existing);
};

const removeMarkAbilityMarks = async () => {
  const all = game.actors.contents
    .flatMap(a => [...a.effects])
    .concat([...canvas.tokens.placeables.flatMap(t => t.actor?.isToken ? [...t.actor.effects] : [])]);
  for (const e of all) {
    if (e.flags?.[M]?.mark?.isMarkAbility && e.flags?.[M]?.mark?.userId === game.user.id) {
      await safeDelete(e);
    }
  }
};

export const applyJudgement = async () => {
  const targets = [...game.user.targets];
  if (targets.length !== 1) { ui.notifications.warn('Target exactly one creature to judge.'); return; }
  const targetToken = targets[0];

  await removeExistingJudgement();

  const effectData = {
    name: 'Judged',
    img: 'icons/magic/death/skull-humanoid-white-red.webp',
    type: 'base',
    system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
    changes: [],
    flags: { [M]: { judgement: { userId: game.user.id } } },
  };

  await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [effectData]);
  await ChatMessage.create({ content: `<strong>Judgement:</strong> ${targetToken.name} is judged.` });
};

export const applyMark = async ({ maxTargets = 1, override = false, dsid = 'other', sourceActorId = null } = {}) => {
  const targets = [...game.user.targets];
  if (!targets.length) { ui.notifications.warn('Target one or more creatures to mark.'); return; }

  const resolvedActor = (sourceActorId ? game.actors.get(sourceActorId) : null)
                      ?? canvas.tokens.controlled[0]?.actor;
  const resolvedActorId = resolvedActor?.id ?? null;

  let effectiveMax = maxTargets;
  if (dsid === 'mark') {
    if (resolvedActor?.items.some(i => getItemDsid(i) === 'anticipation')) effectiveMax = Math.max(effectiveMax, 2);
  }

  if (targets.length > effectiveMax) {
    ui.notifications.warn(`This ability can mark up to ${effectiveMax} target${effectiveMax > 1 ? 's' : ''}.`);
    return;
  }

  if (override) await removeMarkAbilityMarks();

  const isMarkAbility = dsid === 'mark';
  for (const targetToken of targets) {
    const effectData = {
      name: 'Mark',
      img: 'icons/skills/targeting/crosshair-pointed-orange.webp',
      type: 'base',
      system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
      changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
      flags: { [M]: { mark: { userId: game.user.id, actorId: resolvedActorId, dsid, isMarkAbility } } },
    };
    await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [effectData]);
  }

  const names = targets.map(t => t.name).join(', ');
  await ChatMessage.create({ content: `<strong>Mark:</strong> ${names} ${targets.length > 1 ? 'are' : 'is'} marked.` });
};



const recentlyProcessed = new Set();
const shouldTrigger = (key) => {
  if (recentlyProcessed.has(key)) return false;
  recentlyProcessed.add(key);
  setTimeout(() => recentlyProcessed.delete(key), 2000);
  return true;
};

const triggerProc = async (actor, effect) => {
  const isJudgement = !!effect.getFlag(M, 'judgement');
  const isMark = !!effect.getFlag(M, 'mark');

  if (isJudgement) {
    await ChatMessage.create({
      content: `<strong>${actor.name} has fallen!</strong> You may use a free triggered action to use @Macro[Judgement]{Judgement} against a new target.`
    });
  } else if (isMark) {
    const markFlag = effect.flags?.[M]?.mark ?? {};
    await ChatMessage.create({
      content: `<strong>${actor.name} has fallen!</strong> You may use a free triggered action to mark a new target within 10 squares.`,
      flags: { [M]: { markReminder: { dsid: markFlag.dsid ?? 'other', isMarkAbility: markFlag.isMarkAbility ?? false, sourceActorId: markFlag.actorId ?? null } } },
    });
  }

  await safeDelete(effect);
};

const handleActorDeath = (actor) => {
  if (!actor) return;
  const relevantEffects = actor.effects.filter(e =>
    e.getFlag(M, 'judgement') || e.getFlag(M, 'mark')
  );

  for (const effect of relevantEffects) {
    const ownerId = effect.getFlag(M, 'mark')?.userId ?? effect.getFlag(M, 'judgement')?.userId;
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

  const existing = targetActor.effects.find(e => e.getFlag(M, 'effectType') === 'aid-attack');
  if (existing) await safeDelete(existing);

  await safeCreateEmbedded(targetActor, 'ActiveEffect', [foundry.utils.deepClone(AID_ATTACK_EFFECT)]);

  await ChatMessage.create({ content: `<strong>Aid Attack:</strong> The next ally ability roll against <strong>${targetActor.name}</strong> has an edge.` });

  let rollHookId, combatEndHookId;

  const cleanup = async (reason) => {
    Hooks.off('createChatMessage', rollHookId);
    Hooks.off('deleteCombat', combatEndHookId);
    const effect = targetActor.effects.find(e => e.getFlag(M, 'effectType') === 'aid-attack');
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