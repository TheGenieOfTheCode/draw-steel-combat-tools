import { config, services } from './ctlib.mjs';
import { GRID, canCurrentlyFly, chooseFreeSquare, getSquadGroup, safeToggleStatusEffect, safeUpdate, sizeRank, tierOf, toGrid, tokenAt } from './ctlib.mjs';

export {
  BASE_MATERIALS, COVER_KEY, CTLIB_SCOPE, DELETE_MARKER, GRID, LEGACY_SCOPE, LOE_KEY, MATERIAL_ALPHA, MATERIAL_ICONS,
  MATERIAL_RULES, MATERIAL_RULE_DEFAULTS, MULTI_GRAB_LIMITS, SIGHT_SAMPLE_COUNT, STEALTH_WORKFLOW_READY,
  WALL_RESTRICTIONS, WALL_RESTRICTION_DEFAULTS, addTags, armCoverImmunity, atLeastHalfBlocked, blocksLoeForEnemies,
  burrowAdjacent, burrowBlocksLineOfEffect, burrowDepth, canCurrentlyFly, canForcedMoveTarget, chooseFreeSquare,
  clampOutsetPoints, concealingRegions, cornersAreOutside, cornersNeedClamping, coverImmunityGrantor,
  coverObstaclesFor, coveredInSquare, ctlibFlag, damageBatch, disarmCoverImmunity, dropKey, dropKeyOverSocket,
  footprintCoverCells, footprintDistFromBounds, fullCoverBlockersFor, getActingActor, getAllMaterials, getByTag,
  getCustomMaterials, getItemDsid, getItemRange, getMaterial, getMaterialAlpha, getMaterialIcon, getSquadGroup,
  getTags, getTokenById, getWallBlockBottom, getWallBlockTileAt, getWallBlockTop, getWallBlockWalls, getWindowById,
  grantsCoverBehind, grantsCoverImmunity, gridDist, gridEq, groundElevation, hasCover, hasFly, hasSightToSquare,
  hasSightToToken, hasTags, highestCharacteristic, initPalette, isBurrowing, isCompletelyBeneath, isOnGround,
  isOpenDoorWall, isSelfAndSelf, loeBlockersFor, loeRangeBlocked, loeRangeCap, monsterFilter, normalizeCollection,
  parsePowerRollState, pickCanvasTarget, rangeEnforced, refreshLoeCornerMode, removeTags, replayUndo, reviveDropKeys,
  safeCreateEmbedded, safeDelete, safeSetFlag, safeTeleport, safeToggleStatusEffect, safeUnsetFlag, safeUpdate,
  seenPlainlyInSquare, segmentBlockedByCover, segmentBlocksSight, segmentsIntersect, sightBlockPoint,
  sightLinesToToken, sightOriginPoints, sightSamplePoints, sightSamples, sizeRank, snapStamina, spaceSamplePoints,
  squareIsConcealed, tierOf, tileAt, tileIsOpenDoor, toCenter, toGrid, toWorld, tokFootprintDist, tokenAt,
  tokenCoverMode, touchesGround, undoDamage, visibleSquareCorners, visibleTargetCorners, wallBetween,
  wallBlocksMovement, wallGrantsCover
} from './ctlib.mjs';

const M = 'draw-steel-combat-tools';

const MASTER_TOGGLE = {
  autoSquadLabelsEnabled: 'squadToolsEnabled',
  squadSimultaneousTurns: 'squadToolsEnabled',
  pairSimultaneousTurns:  'squadToolsEnabled',
  squadGlowMarker:        'squadToolsEnabled',
  squadHudEnabled:        'squadToolsEnabled',
};

export const getSetting = (key) => {
  const master = MASTER_TOGGLE[key];
  if (master && !game.settings.get('draw-steel-combat-tools', master)) return false;
  return game.settings.get('draw-steel-combat-tools', key);
};

const getSocket = () => game.modules.get('draw-steel-combat-tools').api.socket;

export const safeTakeDamage = async (actor, amount, options = {}) => {
  
  
  
  if (actor.isOwner && (game.user.isGM || !getSquadGroup(actor))) return await actor.system.takeDamage(amount, options);
  
  return await getSocket().executeAsGM('dsct.takeDamage', actor.uuid, amount, options, game.userId);
};

let _staminaLossDepth = 0;

const _markStaminaLossUpdates = () => {
  if (window._dsctStaminaLossHook) return;
  window._dsctStaminaLossHook = true;
  
  const stamp = (doc, changed, options) => {
    if (_staminaLossDepth <= 0) return;
    if (changed?.system?.stamina === undefined && changed?.system?.staminaValue === undefined) return;
    options.staminaLoss = true;
  };
  Hooks.on('preUpdateActor', stamp);
  Hooks.on('preUpdateCombatantGroup', stamp);
};

export const asStaminaLoss = async (fn) => {
  _markStaminaLossUpdates();
  _staminaLossDepth++;
  try { return await fn(); }
  finally { _staminaLossDepth--; }
};

export const noLogFlag = () => ({ 'draw-steel-ctlib': { noLog: true } });

export const cleansed = () => ({ ctlib: { endReason: 'cleansed' } });

let _damageSource = null;
export const withDamageSource = async (source, fn) => {
  const outer = _damageSource;
  _damageSource = source?.actorUuid || source?.tokenUuid || source?.ability ? source : outer;
  try { return await fn(); } finally { _damageSource = outer; }
};
export const messageDamageSource = (message) => {
  const sp = message?.speaker ?? {};
  const use = message?.system?.parts?.contents?.find((p) => p.type === 'abilityUse');
  return {
    tokenUuid: sp.scene && sp.token ? `Scene.${sp.scene}.Token.${sp.token}` : null,
    actorUuid: sp.actor ? `Actor.${sp.actor}` : null,
    ability: use?.abilityUuid ? (fromUuidSync(use.abilityUuid, { strict: false })?.name ?? null) : null,
  };
};

export const applyDamage = async (actor, amount, squadGroupOverride = undefined, {
  damageType     = 'untyped',
  ignoreImmunity = false,
  isArea         = false,
  staminaLoss    = false,
  source         = _damageSource,
} = {}) => {
  const prevValue   = actor.system.stamina.value;
  const prevTemp    = actor.system.stamina.temporary;
  const squadGroup  = squadGroupOverride !== undefined ? squadGroupOverride : getSquadGroup(actor);
  const prevSquadHP = squadGroup?.system?.staminaValue ?? null;
  const members = squadGroup ? Array.from(squadGroup.members || []).filter(m => m && !m.isDefeated) : [];
  const squadCombatantIds = members.map(m => m.id);
  const squadTokenIds     = members.map(m => m.tokenId).filter(Boolean);
  if (squadGroup && actor.isToken && actor.token?.id) {
    services.get('reportSquadDamage')?.(actor.token.id);
  }
  const type = damageType || 'untyped';
  
  const ignoredImmunities = staminaLoss ? ['all'] : (ignoreImmunity ? [type] : []);
  const effectiveAmt      = (isArea && squadGroup) ? Math.min(amount, actor.system.stamina.max ?? amount) : amount;

  const take = () => safeTakeDamage(actor, effectiveAmt, { type, ignoredImmunities, staminaLoss, ...(source ? { dsbl: { source } } : {}) });
  await (staminaLoss ? asStaminaLoss(take) : take());
  return { prevTemp, prevValue, prevSquadHP, squadGroup, squadCombatantIds, squadTokenIds };
};

export const confirmFall = async (token, rawFall, effectiveFall, dmg, { noFallDamage = false } = {}) => {
  const agility = token.actor?.system?.characteristics?.agility?.value ?? 0;
  let content = `<b><i class="fa-solid fa-chevrons-down"></i> Fall:</b> <b>${token.name}</b> is about to fall <b>${rawFall}</b> square${rawFall !== 1 ? 's' : ''}`;
  if (agility > 0 && effectiveFall !== rawFall) content += ` (${effectiveFall} effective after Agility ${agility})`;
  if (noFallDamage)     content += `. No fall damage will be taken.`;
  else if (dmg > 0)     content += `, dealing <b>${dmg} damage</b> and landing prone.`;
  else                  content += `. Less than 2 effective squares; no damage.`;

  const msg = await ChatMessage.create({
    content,
    flags: { [M]: { isFallConfirm: true, creatorUserId: game.user.id } },
    speaker: ChatMessage.getSpeaker({ token: token.document }),
  });

  return new Promise((resolve) => {
    let hookId, deleteHookId;
    const finish = (result) => {
      Hooks.off('updateChatMessage', hookId);
      Hooks.off('deleteChatMessage', deleteHookId);
      resolve(result);
    };
    hookId = Hooks.on('updateChatMessage', (updatedMsg) => {
      if (updatedMsg.id !== msg.id) return;
      const res = updatedMsg.getFlag(M, 'fallConfirmResolved');
      if (res === 'confirmed' || res === 'cancelled') finish(res === 'confirmed');
    });
    deleteHookId = Hooks.on('deleteChatMessage', (deletedMsg) => {
      if (deletedMsg.id !== msg.id) return;
      finish(false);
    });
  });
};

export const confirmRangeOverride = async (sourceToken, targetToken, squares, actionLabel) => {
  if (game.user.isGM) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DSCT.rangeConfirm.title') },
      content: `<p>${game.i18n.format('DSCT.rangeConfirm.gmContent', { source: sourceToken.name, target: targetToken.name, squares, action: actionLabel })}</p>`,
      rejectClose: false,
    });
    return !!ok;
  }
  const whisper = game.users
    .filter(u => u.isGM || sourceToken.actor?.testUserPermission(u, 3))
    .map(u => u.id);
  const content = game.i18n.format('DSCT.rangeConfirm.content', { source: sourceToken.name, target: targetToken.name, squares, action: actionLabel });
  const msg = await ChatMessage.create({
    content,
    whisper,
    flags: { [M]: { isRangeConfirm: true, creatorUserId: game.user.id } },
    speaker: ChatMessage.getSpeaker({ token: sourceToken.document }),
  });
  return new Promise((resolve) => {
    let hookId, deleteHookId;
    const finish = (val) => {
      Hooks.off('updateChatMessage', hookId);
      Hooks.off('deleteChatMessage', deleteHookId);
      resolve(val);
    };
    hookId = Hooks.on('updateChatMessage', (updatedMsg) => {
      if (updatedMsg.id !== msg.id) return;
      const res = updatedMsg.getFlag(M, 'rangeConfirmResolved');
      if (res === 'allow' || res === 'deny') finish(res === 'allow');
    });
    deleteHookId = Hooks.on('deleteChatMessage', (deletedMsg) => {
      if (deletedMsg.id !== msg.id) return;
      finish(false);
    });
  });
};

export const confirmFriendlyFireCase1 = async (sourceToken, targetToken) => {
  const whisper = game.users
    .filter(u => u.isGM || sourceToken.actor?.testUserPermission(u, 3))
    .map(u => u.id);
  const content = game.i18n.format('DSCT.friendlyFire.case1Content', { source: sourceToken.name, target: targetToken.name });
  const msg = await ChatMessage.create({
    content,
    whisper,
    flags: { [M]: { isFriendlyFireCase1: true, creatorUserId: game.user.id } },
    speaker: ChatMessage.getSpeaker({ token: sourceToken.document }),
  });
  return new Promise((resolve) => {
    let hookId, deleteHookId;
    const finish = (val) => {
      Hooks.off('updateChatMessage', hookId);
      Hooks.off('deleteChatMessage', deleteHookId);
      resolve(val);
    };
    hookId = Hooks.on('updateChatMessage', (updatedMsg) => {
      if (updatedMsg.id !== msg.id) return;
      const res = updatedMsg.getFlag(M, 'ffCase1Resolved');
      if (res === 'stop' || res === 'proceed') finish(res === 'stop');
    });
    deleteHookId = Hooks.on('deleteChatMessage', (deletedMsg) => {
      if (deletedMsg.id !== msg.id) return;
      finish(false);
    });
  });
};

export const confirmFriendlyFireCase2 = async (sourceToken, targetToken, blockers, dmg) => {
  const targetRank = sizeRank(targetToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  const showIgnoreBtn = getSetting('ignoreAllyEnabled') && blockers.some(
    b => Math.abs(targetRank - sizeRank(b.actor?.system?.combat?.size ?? { value: 1, letter: 'M' })) >= 2
  );
  const whisper = game.users
    .filter(u => u.isGM || sourceToken.actor?.testUserPermission(u, 3))
    .map(u => u.id);
  const blockerList = blockers.map(b => `<strong>${b.name}</strong>`).join(', ');
  const content = game.i18n.format('DSCT.friendlyFire.case2Content', { source: sourceToken.name, target: targetToken.name, blockers: blockerList, dmg });
  const msg = await ChatMessage.create({
    content,
    whisper,
    flags: { [M]: { isFriendlyFireCase2: true, ffCase2HasIgnoreOption: showIgnoreBtn, creatorUserId: game.user.id } },
    speaker: ChatMessage.getSpeaker({ token: sourceToken.document }),
  });
  return new Promise((resolve) => {
    let hookId, deleteHookId;
    const finish = (val) => {
      Hooks.off('updateChatMessage', hookId);
      Hooks.off('deleteChatMessage', deleteHookId);
      resolve(val);
    };
    hookId = Hooks.on('updateChatMessage', (updatedMsg) => {
      if (updatedMsg.id !== msg.id) return;
      const res = updatedMsg.getFlag(M, 'ffCase2Resolved');
      if (res === 'confirm' || res === 'cancel' || res === 'ignore') finish(res);
    });
    deleteHookId = Hooks.on('deleteChatMessage', (deletedMsg) => {
      if (deletedMsg.id !== msg.id) return;
      finish('cancel');
    });
  });
};

export const applyFall = async (token, targetElev = 0, { silent = true, skipConfirm = false } = {}) => {
  const currentElev = token.document?.elevation ?? 0;
  if (currentElev <= targetElev) return { dmg: 0, fallDist: 0, effectiveFall: 0 };

  const canFly = canCurrentlyFly(token.actor);
  let dmg = 0, fallDist = 0, effectiveFall = 0;
  if (!canFly) {
    fallDist      = currentElev - targetElev;
    const agility = token.actor?.system?.characteristics?.agility?.value ?? 0;
    effectiveFall = Math.max(0, fallDist - agility);
    const cap     = getSetting('fallDamageCap');
    dmg = effectiveFall < 2 ? 0 : Math.min(effectiveFall * 2, cap);
  }

  if (!canFly && fallDist > 0 && !skipConfirm && getSetting('fallConfirmation')) {
    const confirmed = await confirmFall(token, fallDist, effectiveFall, dmg);
    if (!confirmed) return { dmg: 0, fallDist: 0, effectiveFall: 0 };
  }

  const tokenIsDead = token.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead') ?? false;
  if (dmg > 0 && !tokenIsDead) await applyDamage(token.actor, dmg);
  await safeUpdate(token.document, { elevation: targetElev });

  if (dmg > 0) {
    const landingGrid = toGrid(token.document);
    const landedOn    = tokenAt(landingGrid.x, landingGrid.y, token.id);
    if (landedOn) {
      if (getSetting('debugMode')) console.log(`DSCT | applyFall | fell onto ${landedOn.name} at (${landingGrid.x},${landingGrid.y}), applying ${dmg} damage`);
      await applyDamage(landedOn.actor, dmg);
      const fallerSize   = token.actor?.system?.combat?.size?.value ?? 1;
      const blockerMight = landedOn.actor?.system?.characteristics?.might?.value ?? 0;
      if (fallerSize > blockerMight) await safeToggleStatusEffect(landedOn.actor, 'prone', { active: true });
      const fallerWouldDie  = (token.actor.system.stamina?.value ?? 1) <= 0;
      const blockerWouldDie = (landedOn.actor.system.stamina?.value ?? 1) <= 0;
      if (!fallerWouldDie || !blockerWouldDie) {
        const chosen = await chooseFreeSquare(token, landedOn);
        if (chosen) await safeUpdate(token.document, { x: chosen.x * GRID(), y: chosen.y * GRID() }, { dsMovement: true });
      }
    }
  }

  if (!silent) {
    await ChatMessage.create({ content: buildFallMessage(token.name, fallDist, effectiveFall, dmg) });
  }
  return { dmg, fallDist, effectiveFall };
};

const buildFallMessage = (name, fallDist, effectiveFall, dmg) => {
  const distPart = game.i18n.format('DSCT.fall.fallsSquares', { name, dist: fallDist, s: fallDist !== 1 ? 's' : '' });
  if (effectiveFall === fallDist) {
    return dmg > 0
      ? distPart + game.i18n.format('DSCT.fall.noAgility', { dmg, effective: effectiveFall * 2 })
      : distPart + game.i18n.localize('DSCT.fall.tooShort');
  }
  const agilityNote = game.i18n.format('DSCT.fall.agilityNote', { effective: effectiveFall });
  return dmg > 0
    ? distPart + agilityNote + game.i18n.format('DSCT.fall.withAgility', { dmg })
    : distPart + agilityNote + game.i18n.localize('DSCT.fall.agilityNotEnough');
};

export const getModuleApi = (warn = true) => {
  const api = game.modules.get('draw-steel-combat-tools')?.api ?? null;
  if (!api && warn) ui.notifications.error(game.i18n.localize('DSCT.notice.notActive'));
  return api;
};

export const formatRollModLabel = (n) => {
  if (n === 0)  return '';
  if (n === 1)  return ' <em>(1 Bane)</em>';
  if (n === -1) return ' <em>(1 Edge)</em>';
  if (n >= 2)   return ` <em>(${n} Banes)</em>`;
  return ` <em>(${Math.abs(n)} Edges)</em>`;
};

export const applyRollMod = (el, baneData, delta) => {
  const { originalTotal, originalNet, baseFormula, baseTooltip, isCritical } = baneData;
  const newNet = Math.max(-2, Math.min(2, (originalNet ?? 0) + delta));

  const abilityRoll = [...el.querySelectorAll('.dice-roll')]
    .find(r => r.querySelector('.dice-flavor')?.textContent?.trim() === 'Ability Roll');
  if (!abilityRoll || abilityRoll.dataset.dsctBaneApplied) return;

  const totalEl   = abilityRoll.querySelector('.dice-total');
  const formulaEl = abilityRoll.querySelector('.dice-formula');
  const tierEl    = abilityRoll.querySelector('.tier');
  const tooltipEl = abilityRoll.querySelector('[data-tooltip-text]');
  if (!totalEl || !formulaEl || !tierEl) return;

  const baseTotal = originalNet === 1  ? originalTotal + 2
                  : originalNet === -1 ? originalTotal - 2
                  : originalTotal;

  let displayTotal, tierAdjust;
  if      (newNet >=  2) { displayTotal = baseTotal;     tierAdjust = -1; }
  else if (newNet <= -2) { displayTotal = baseTotal;     tierAdjust = +1; }
  else if (newNet ===  1) { displayTotal = baseTotal - 2; tierAdjust =  0; }
  else if (newNet === -1) { displayTotal = baseTotal + 2; tierAdjust =  0; }
  else                   { displayTotal = baseTotal;     tierAdjust =  0; }

  const baseTier  = tierOf(displayTotal);
  const finalTier = isCritical ? 3 : Math.max(1, Math.min(3, baseTier + tierAdjust));

  const originalDisplayTier = isCritical ? 3
                             : originalNet >=  2 ? Math.max(1, tierOf(originalTotal) - 1)
                             : originalNet <= -2 ? Math.min(3, tierOf(originalTotal) + 1)
                             : tierOf(originalTotal);

  const newFormula = newNet ===  1 ? `${baseFormula} - 2`
                   : newNet === -1 ? `${baseFormula} + 2`
                   : baseFormula;
  const newTooltip = newNet ===  1 ? `${baseTooltip} - 2[Bane]`
                   : newNet === -1 ? `${baseTooltip} + 2[Edge]`
                   : `${baseTooltip}${formatRollModLabel(newNet).replace(/<\/?em>/g, '')}`;

  totalEl.textContent = String(displayTotal);
  formulaEl.textContent = newFormula;
  if (tooltipEl) tooltipEl.setAttribute('data-tooltip-text', newTooltip);
  tierEl.className = `tier tier${finalTier}`;
  tierEl.innerHTML = `${game.i18n.localize('DSCT.label.tier')} ${finalTier}${formatRollModLabel(newNet)}`;

  if (finalTier !== originalDisplayTier) {
    const abilityDesc = el.querySelector('document-embed .power-roll-display');
    const newTierDd   = abilityDesc?.querySelector(`dd.tier${finalTier}`);
    const resultPRD   = el.querySelector('.message-part-html > .power-roll-display');
    if (resultPRD && newTierDd) {
      const sym = ['!', '@', '#'][finalTier - 1];
      resultPRD.innerHTML = `<dt class="tier${finalTier}">${sym}</dt><dd>${newTierDd.innerHTML}</dd>`;
    }
    const dmgMatch = newTierDd?.textContent?.trim().match(/^(\d+)\s*damage/i);
    if (dmgMatch) {
      const applyBtn = el.querySelector('[data-action="applyDamage"]');
      if (applyBtn) applyBtn.innerHTML = `<i class="fa-solid fa-burst"></i> ${game.i18n.format('DSCT.button.applyDamage', { amount: dmgMatch[1] })}`;
    }
  }

  abilityRoll.dataset.dsctBaneApplied = 'true';
};

for (const key of ['enforceAbilityRange', 'gmBypassRangeEnforcement', 'loeCornerMode', 'trueDrawSteelLos', 'stealthSystemEnabled', 'materialRules', 'wallRestrictions', 'customMaterials', 'debugMode', 'cancelOnRightClick', 'autoConfirmSelection']) {
  config.provide(key, () => getSetting(key));
}
