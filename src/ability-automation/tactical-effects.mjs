import { safeCreateEmbedded, safeDelete, getItemDsid, getSetting, normalizeCollection, getModuleApi } from '../helpers.mjs';

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
  if (targets.length !== 1) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.judgeOneTarget')); return; }
  const targetToken = targets[0];

  await removeExistingJudgement();

  const censorActor = game.user.character
    ?? canvas.tokens.controlled[0]?.actor
    ?? canvas.tokens.placeables.find(t => t.isOwner && !t.actor?.isToken)?.actor;

  if (!censorActor || !censorActor.items.some(i => getItemDsid(i) === 'judgement')) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.judgeRequiresAbility'));
    return;
  }

  const effectData = {
    name: `Judged [${censorActor.name}]`,
    img: getSetting('judgedEffectIcon') || 'icons/magic/death/skull-humanoid-white-red.webp',
    type: 'base',
    system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
    changes: [],
    flags: { [M]: { judgement: { userId: game.user.id, actorId: censorActor.id } } },
  };

  await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [effectData]);
  await ChatMessage.create({ content: game.i18n.format('DSCT.chat.tactical.judged', { name: targetToken.name }) });
};

export const applyMark = async ({ maxTargets = 1, override = false, dsid = 'other', sourceActorId = null } = {}) => {
  const targets = [...game.user.targets];
  if (!targets.length) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.markOneTarget')); return; }

  const resolvedActor = (sourceActorId ? game.actors.get(sourceActorId) : null)
                      ?? canvas.tokens.controlled[0]?.actor;
  const resolvedActorId = resolvedActor?.id ?? null;

  let effectiveMax = maxTargets;
  if (dsid === 'mark') {
    if (resolvedActor?.items.some(i => getItemDsid(i) === 'anticipation')) effectiveMax = Math.max(effectiveMax, 2);
  }

  if (targets.length > effectiveMax) {
    ui.notifications.warn(game.i18n.format('DSCT.notice.tactical.markTooMany', { max: effectiveMax, s: effectiveMax > 1 ? 's' : '' }));
    return;
  }

  if (override) {
    const all = game.actors.contents
      .flatMap(a => [...a.effects])
      .concat([...canvas.tokens.placeables.flatMap(t => t.actor?.isToken ? [...t.actor.effects] : [])]);
    const marksElsewhere = all.filter(e =>
      e.flags?.[M]?.mark?.isMarkAbility &&
      e.flags?.[M]?.mark?.userId === game.user.id &&
      !targets.some(t => t.actor?.id === e.parent?.id)
    );
    const toRemove = Math.max(0, marksElsewhere.length + targets.length - effectiveMax);
    for (let i = 0; i < toRemove; i++) await safeDelete(marksElsewhere[i]);
  }

  const isMarkAbility = dsid === 'mark';
  for (const targetToken of targets) {
    const existingMark = targetToken.actor.effects.find(e => e.flags?.[M]?.mark);
    if (existingMark) await safeDelete(existingMark);
    const effectData = {
      name: 'Mark',
      img: getSetting('markedEffectIcon') || 'icons/skills/targeting/crosshair-pointed-orange.webp',
      type: 'base',
      system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
      changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
      flags: { [M]: { mark: { userId: game.user.id, actorId: resolvedActorId, dsid, isMarkAbility } } },
    };
    await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [effectData]);
  }

  const names = targets.map(t => t.name).join(', ');
  await ChatMessage.create({ content: game.i18n.format('DSCT.chat.tactical.marked', { names, verb: targets.length > 1 ? 'are' : 'is' }) });
};



const recentlyProcessed = new Set();
const shouldTrigger = (key) => {
  if (recentlyProcessed.has(key)) return false;
  recentlyProcessed.add(key);
  setTimeout(() => recentlyProcessed.delete(key), 2000);
  return true;
};


export const flagJudgementTriggersUsed = async (judgedActorId) => {
  const api = getModuleApi(false);
  for (const m of game.messages.contents) {
    let shouldFlag = false;
    const bane = m.getFlag(M, 'judgementBaneReminder');
    if (bane && bane.actorId === judgedActorId && !m.getFlag(M, 'judgementBaneUsed') && !m.getFlag(M, 'judgementTriggerUsed')) shouldFlag = true;
    const potency = m.getFlag(M, 'judgementPotencyReminder');
    if (potency && potency.judgedActorId === judgedActorId && !m.getFlag(M, 'judgementPotencyUsed') && !m.getFlag(M, 'judgementTriggerUsed')) shouldFlag = true;
    if (!shouldFlag) continue;
    if (m.isOwner || game.user.isGM) {
      await m.setFlag(M, 'judgementTriggerUsed', true);
    } else if (api?.socket) {
      await api.socket.executeAsGM('dsct.updateDocument', m.uuid, { [`flags.${M}.judgementTriggerUsed`]: true });
    }
  }
};

const triggerProc = async (actor, effect) => {
  const isJudgement = !!effect.getFlag(M, 'judgement');
  const isMark = !!effect.getFlag(M, 'mark');

  if (isJudgement) {
    const userId = effect.getFlag(M, 'judgement')?.userId;
    await ChatMessage.create({
      content: game.i18n.format('DSCT.chat.tactical.judgementFallen', { name: actor.name }),
      flags: { [M]: { judgementFallen: { userId } } },
    });
  } else if (isMark) {
    const markFlag    = effect.flags?.[M]?.mark ?? {};
    const sourceActor = game.actors.get(markFlag.actorId);
    const markItem    = sourceActor?.items.find(i => getItemDsid(i) === (markFlag.dsid ?? 'other'));
    await ChatMessage.create({
      content: game.i18n.format('DSCT.chat.tactical.markFallen', { name: actor.name, enricher: '[[/apply taunted]]' }),
      speaker: sourceActor ? ChatMessage.getSpeaker({ actor: sourceActor }) : undefined,
      flags: {
        [M]: { markReminder: { dsid: markFlag.dsid ?? 'other', isMarkAbility: markFlag.isMarkAbility ?? false, sourceActorId: markFlag.actorId ?? null } },
        ...(markItem ? { 'draw-steel-target-damage': { state: { abilityUuid: markItem.uuid } } } : {}),
      },
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
  if (selected.length !== 1) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.aidAttackOneSelect')); return; }

  const targets = [...game.user.targets];
  if (targets.length !== 1) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.aidAttackOneTarget')); return; }

  const targetToken = targets[0];
  const targetActor = targetToken.actor;
  const targetTokenId = targetToken.id;

  const existing = targetActor.effects.find(e => e.getFlag(M, 'effectType') === 'aid-attack');
  if (existing) await safeDelete(existing);

  await safeCreateEmbedded(targetActor, 'ActiveEffect', [{ ...foundry.utils.deepClone(AID_ATTACK_EFFECT), img: getSetting('aidAttackEffectIcon') || AID_ATTACK_EFFECT.img }]);

  await ChatMessage.create({ content: game.i18n.format('DSCT.chat.tactical.aidAttack', { name: targetActor.name }) });

  let rollHookId, combatEndHookId;

  const cleanup = async (reason) => {
    Hooks.off('createChatMessage', rollHookId);
    Hooks.off('deleteCombat', combatEndHookId);
    const effect = targetActor.effects.find(e => e.getFlag(M, 'effectType') === 'aid-attack');
    if (effect) await safeDelete(effect);
    ui.notifications.info(game.i18n.format('DSCT.notice.tactical.aidAttackCleared', { name: targetActor.name, reason }));
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

  ui.notifications.info(game.i18n.format('DSCT.notice.tactical.aidAttackApplied', { name: targetActor.name }));
};

export const registerTacticalHooks = () => {
  if (!getSetting('abilityAutomationEnabled')) return;
  Hooks.on('createChatMessage', async (message) => {
    if (!getSetting('judgementAutomation')) return;

    const parts = message.system?.parts?.contents;
    if (!parts) return;

    const abilityUse = parts.find(p => p.type === 'abilityUse');
    if (!abilityUse?.abilityUuid) return;

    const speakerActor = ChatMessage.getSpeakerActor(message.speaker);
    if (!speakerActor) return;

    const debug = getSetting('debugMode');

    
    const speakerToken = canvas.tokens.placeables.find(t => t.id === message.speaker?.token);
    const actorToCheck = speakerToken?.actor ?? speakerActor;
    const judgeEffect  = actorToCheck.effects?.find(e => e.getFlag(M, 'judgement')?.userId === game.user.id)
                      ?? speakerActor.effects?.find(e => e.getFlag(M, 'judgement')?.userId === game.user.id);
    if (debug) console.log(`DSCT | JudgementTriggers | speaker=${speakerActor.name} tokenFound=${!!speakerToken} judgeEffect=${!!judgeEffect}`);
    if (!judgeEffect) return;

    const key = `judgement-triggers-${message.id}`;
    if (!shouldTrigger(key)) return;

    const censorActorId = judgeEffect.getFlag(M, 'judgement')?.actorId;
    const censorActor = (censorActorId ? game.actors.get(censorActorId) : null)
      ?? game.user.character
      ?? canvas.tokens.placeables.find(t => t.isOwner && !t.actor?.isToken)?.actor
      ?? canvas.tokens.placeables.find(t => t.isOwner)?.actor;
    if (debug) console.log(`DSCT | JudgementTriggers | censorActorId=${censorActorId} censorActor=${censorActor?.name ?? 'NOT FOUND'}`);
    if (!censorActor) return;

    const item = await fromUuid(abilityUse.abilityUuid).catch(() => null);
    if (debug) console.log(`DSCT | JudgementTriggers | item=${item?.name ?? 'NOT FOUND'} type=${item?.system?.type}`);
    if (!item) return;

    if (item.system.type === 'main') {
      const presence = censorActor.system.characteristics.presence.value ?? 0;
      const amount = presence * 2;

      const hasPurifyingFireAbility = censorActor.items.some(i =>
        getItemDsid(i) === 'purifying-fire' || i.name.toLowerCase() === 'purifying fire'
      );
      const targetEffectKeys = actorToCheck.effects.contents.flatMap(ef => ef.changes?.map(c => c.key) ?? []);
      const hasPurifyingFire = hasPurifyingFireAbility && actorToCheck.effects.contents.some(ef =>
        ef.changes?.some(c => c.key === 'system.damage.weaknesses.fire')
      );
      if (debug) console.log(`DSCT | JudgementT1 | censor=${censorActor.name} hasPFAbility=${hasPurifyingFireAbility} judgedActor=${actorToCheck.name} effectKeys=${JSON.stringify(targetEffectKeys)} hasPF=${hasPurifyingFire}`);

      const t1Flavor = 'Whenever a creature judged by you uses a main action and is within your line of effect, you can use a free triggered action to deal holy damage equal to twice your Presence score to them.';
      const makeT1Msg = async (damageType) => {
        const dmgRoll = new ds.rolls.DamageRoll(`${amount}`, {}, { type: damageType });
        await dmgRoll.evaluate();
        const typeLabel = ds.CONFIG.damageTypes[damageType]?.label ?? damageType;
        const title = `${amount} ${typeLabel} (Judgement)`;
        await ds.documents.DrawSteelChatMessage.create({
          title,
          rolls: [dmgRoll],
          type: 'standard',
          'system.parts': [{ rolls: [dmgRoll], flavor: t1Flavor, type: 'roll' }],
          flags: { core: { canPopout: true } },
        });
      };
      await makeT1Msg('holy');
      if (hasPurifyingFire) await makeT1Msg('fire');
    }

    
    
    const effectsArr = normalizeCollection(item.system.power?.effects);
    const hasPotency = effectsArr.some(e =>
      ['tier1', 'tier2', 'tier3'].some(t => (e[e.type]?.[t]?.display ?? '').includes('{{potency}}'))
    );
    
    
    
    const abilityResultParts = parts.filter(p => p.type === 'abilityResult');
    const actualTargetCount = abilityResultParts.reduce((sum, p) =>
      sum + (p.rolls?.filter(r => r instanceof ds.rolls.PowerRoll).length ?? 0), 0
    );
    const isDesignedSingleTarget = item.system.target?.value === 1;
    const isSingleTarget = isDesignedSingleTarget || actualTargetCount === 1;
    if (debug) {
      console.log(`DSCT | JudgementT4 | hasPotency=${hasPotency} isSingleTarget=${isSingleTarget} isDesignedSingleTarget=${isDesignedSingleTarget} actualTargetCount=${actualTargetCount} target.value=${item.system.target?.value} effects(${effectsArr.length}):`,
        effectsArr.map(e => ({ type: e.type, t1: e[e.type]?.tier1?.display, t2: e[e.type]?.tier2?.display, t3: e[e.type]?.tier3?.display })));
    }
    if (hasPotency && isSingleTarget) {
      const censorToken = canvas.tokens.placeables.find(t => t.actor?.id === censorActor.id);
      const speakerToken   = canvas.tokens.placeables.find(t => t.actor?.id === speakerActor.id);
      if (debug) console.log(`DSCT | JudgementT4 | censorToken=${censorToken?.name ?? 'NOT FOUND'} speakerToken=${speakerToken?.name ?? 'NOT FOUND'}`);
      if (censorToken && speakerToken) {
        const dist = canvas.grid.measurePath([
          { x: speakerToken.center.x, y: speakerToken.center.y },
          { x: censorToken.center.x, y: censorToken.center.y },
        ]).distance;
        if (debug) console.log(`DSCT | JudgementT4 | dist=${dist} threshold=${10 * canvas.grid.distance} withinRange=${dist <= 10 * canvas.grid.distance}`);
        if (dist <= 10 * canvas.grid.distance) {
          await ChatMessage.create({
            content: game.i18n.format('DSCT.chat.tactical.judgementPotencyReminder', {
              name: speakerActor.name, censorName: censorActor.name,
            }),
            flags: { [M]: { judgementPotencyReminder: {
              censorActorId: censorActor.id,
              judgedActorId: speakerActor.id,
              judgedName: speakerActor.name,
              censorName: censorActor.name,
            } } },
          });
        }
      }
    }
  });

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
