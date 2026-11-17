import { config, services, executeAsDirector } from './ctlib.mjs';
import { GRID, canCurrentlyFly, chooseFreeSquare, getItemRange, getSquadGroup, safeToggleStatusEffect, safeUpdate, sizeRank, snapStamina, tierOf, toGrid, tokenAt } from './ctlib.mjs';

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

export const HANDED_TO_TRIGGERS = new Set(['judgementAutomation', 'markAutomation']);
export const movesGranted = () => CONFIG.TextEditor.enrichers.some((e) => e.id === 'dsm.grant');

export const mentorOf = (actor) => actor?.system?.retainer?.mentor ?? actor?.system?.companion?.master ?? null;

export const systemSwapsMeleeRanged = () => !!globalThis.ds?.applications?.apps?.AbilityConfigurationDialog?.DEFAULT_OPTIONS?.actions?.swapMeleeRanged;

export const reachBeforeDialog = (ability, distance = null) => {
  const dist = distance ?? ability?.system?.distance;
  if (dist?.type === 'meleeRanged' && systemSwapsMeleeRanged()) {
    return Math.max(parseInt(dist.primary) || 0, parseInt(dist.secondary) || 0);
  }
  return getItemRange(ability, distance);
};
export const triggersHandlesClassTriggers = () => !!game.modules.get('draw-steel-triggers')?.active
  && game.settings.settings.has('draw-steel-triggers.featureTriggers')
  && game.settings.get('draw-steel-triggers', 'featureTriggers') !== false;

const _settingCache = new Map();
const _clearSettingCache = () => _settingCache.clear();
for (const hook of ['updateSetting', 'createSetting', 'deleteSetting', 'clientSettingChanged']) Hooks.on(hook, _clearSettingCache);
const _read = (key) => {
  if (_settingCache.has(key)) return _settingCache.get(key);
  const value = game.settings.get('draw-steel-combat-tools', key);
  if (value === null || typeof value !== 'object') _settingCache.set(key, value);
  return value;
};

export const getSetting = (key) => {
  if (HANDED_TO_TRIGGERS.has(key) && triggersHandlesClassTriggers()) return false;
  const master = MASTER_TOGGLE[key];
  if (master && !_read(master)) return false;
  return _read(key);
};

export const isOwnAbilityActor = (actor) => !!actor && (game.user.isGM
  ? !game.users.some((u) => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'))
  : actor.isOwner);

export const effectStartFor = (actor) => {
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  start.combatant = game.combat?.getCombatantsByActor(actor)?.[0]?.id ?? start.combatant ?? null;
  return start;
};

const getSocket = () => game.modules.get('draw-steel-combat-tools').api.socket;

export const safeTakeDamage = async (actor, amount, options = {}) => {
  
  
  
  if (actor.isOwner && (game.user.isGM || !getSquadGroup(actor))) return await actor.system.takeDamage(amount, options);
  
  return await executeAsDirector(getSocket(), 'dsct.takeDamage', actor.uuid, amount, options, game.userId);
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
    abilityUuid: use?.abilityUuid ?? null,
  };
};

export const spentTotal = (message) => {
  const rx = new RegExp(game.i18n.localize('DRAW_STEEL.Item.ability.ConfigureUse.SpentFlavor')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{value\\}', '(\\d+)').replace('\\{name\\}', '.+'));
  return Number(rx.exec(message?.flavor ?? '')?.[1]) || 0;
};

export const spendBeyondCost = (message, ability = null) => {
  const use = message?.system?.parts?.contents?.find((p) => p.type === 'abilityUse');
  ability ??= use?.abilityUuid ? fromUuidSync(use.abilityUuid, { strict: false }) : null;
  return Math.max(0, spentTotal(message) - (Number(ability?.system?.resource) || 0));
};

export const applyDamage = async (actor, amount, squadGroupOverride = undefined, {
  damageType     = 'untyped',
  ignoreImmunity = false,
  ignoredImmunities: ignoredList = null,
  isArea         = false,
  staminaLoss    = false,
  source         = _damageSource,
  fall           = false,
  forced         = false,
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
  
  const ignoredImmunities = staminaLoss ? ['all'] : (ignoredList?.length ? [...ignoredList] : (ignoreImmunity ? [type] : []));
  
  
  const lossWeakness      = staminaLoss ? (actor.system.calculateImmunityAndWeakness?.({ type, ignoredImmunities }).weakness ?? 0) : 0;
  const effectiveAmt      = (isArea && squadGroup) ? Math.min(amount, actor.system.stamina.max ?? amount) : amount - lossWeakness;

  const take = () => safeTakeDamage(actor, effectiveAmt, { type, ignoredImmunities, staminaLoss, ...(fall ? { dsctFall: true } : {}), ...(forced ? { dsctForced: true } : {}), ...(source ? { dsbl: { source } } : {}) });
  await (staminaLoss ? asStaminaLoss(take) : take());
  return { prevTemp, prevValue, prevSquadHP, squadGroup, squadCombatantIds, squadTokenIds };
};

export const confirmFall = async (token, rawFall, effectiveFall, dmg, { noFallDamage = false } = {}) => {
  const agility = token.actor?.system?.characteristics?.agility?.value ?? 0;
  const L = (key, data = {}) => game.i18n.format(`DSCT.fall.${key}`, data);
  const content = L('confirmPrompt', {
    name: token.name, dist: rawFall, s: rawFall !== 1 ? 's' : '',
    agility: agility > 0 && effectiveFall !== rawFall ? L('confirmAgility', { effective: effectiveFall, agility }) : '',
    outcome: L(noFallDamage ? 'confirmNoDamage' : (dmg > 0 ? 'confirmDamage' : 'confirmTooShort'), { dmg }),
  });

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

export const askConsent = async (actor, { content, yes, no, yesDone = yes, noDone = no }) => {
  const whisper = game.users.filter(u => u.isGM || (u.active && actor?.testUserPermission(u, 3))).map(u => u.id);
  const msg = await ChatMessage.create({
    content, whisper,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [M]: { consent: { actorUuid: actor.uuid, yes, no, yesDone, noDone, answer: null } } },
  });
  return new Promise((resolve) => {
    let hookId, deleteHookId;
    const finish = (val) => {
      Hooks.off('updateChatMessage', hookId);
      Hooks.off('deleteChatMessage', deleteHookId);
      resolve(val);
    };
    hookId = Hooks.on('updateChatMessage', (updated) => {
      if (updated.id !== msg.id) return;
      const answer = updated.getFlag(M, 'consent')?.answer;
      if (answer) finish(answer === 'yes');
    });
    deleteHookId = Hooks.on('deleteChatMessage', (deleted) => { if (deleted.id === msg.id) finish(false); });
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

export const stepOffCatcher = async (token) => {
  const at = toGrid(token.document);
  const under = tokenAt(at.x, at.y, token.id);
  if (!under) return;
  const chosen = await chooseFreeSquare(token, under);
  if (chosen) await safeUpdate(token.document, { x: chosen.x * GRID(), y: chosen.y * GRID() }, { dsMovement: true });
};

export const fallGate = async (token, height) => {
  const ctx = { token, height, reduction: 0, reasons: [], cancel: false, safe: false, holds: [] };
  if (!(height > 0)) return ctx;
  Hooks.callAll('dsct.preFall', ctx);
  for (const mods of await Promise.all(ctx.holds)) {
    if (!mods) continue;
    ctx.reduction += Number(mods.reduction) || 0;
    ctx.reasons.push(...(mods.reasons ?? []));
    if (mods.cancel) ctx.cancel = true;
    if (mods.safe) ctx.safe = true;
  }
  return ctx;
};

export const knockProne = async (actor, undoOps = null) => {
  await safeToggleStatusEffect(actor, 'prone', { active: true });
  undoOps?.push({ op: 'status', uuid: actor.uuid, effectId: 'prone', active: false });
};

let _fallHandler = null;
export const registerFallHandler = (fn) => { _fallHandler = typeof fn === 'function' ? fn : null; };

export const surfaceUnder = (token) => {
  const doc = token?.document ?? token;
  try { return doc?._findSupportingSurface?.()?.elevation ?? 0; } catch { return 0; }
};

const fallAgility = (actor) => (actor?.system?.combat?.fall?.agility === false ? 0 : actor?.system?.characteristics?.agility?.value ?? 0);

export const applyFall = async (token, targetElev = null, { silent = false, skipConfirm = false, effective = null } = {}) => {
  if (targetElev === null || targetElev === undefined) targetElev = surfaceUnder(token);
  if (_fallHandler) return _fallHandler(token, targetElev, { silent, skipConfirm });
  const doc = token.document;
  const currentElev = doc?.elevation ?? 0;
  if (currentElev <= targetElev) return { dmg: 0, fallDist: 0, effectiveFall: 0 };

  if (canCurrentlyFly(token.actor)) {
    if (!silent) await ChatMessage.create({ content: game.i18n.format('DSCT.fall.staysAloft', { name: token.name }), speaker: ChatMessage.getSpeaker({ token: doc }) });
    return { dmg: 0, fallDist: 0, effectiveFall: 0, aloft: true };
  }

  const override = Number.isFinite(effective) ? Math.max(0, effective) : null;
  const gate = override === null ? await fallGate(token, currentElev - targetElev) : { cancel: false, safe: false, reasons: [], reduction: 0 };
  if (gate.cancel) return { dmg: 0, fallDist: 0, effectiveFall: 0, cancelled: true };
  const caught        = gate.safe;
  const reasons       = gate.reasons;
  const fallDist      = currentElev - targetElev;
  const agility       = override === null ? fallAgility(token.actor) : 0;
  const effectiveFall = override ?? Math.max(0, fallDist - agility - gate.reduction);
  const dmg = caught || effectiveFall < 2 ? 0 : Math.min(effectiveFall * 2, getSetting('fallDamageCap'));

  if (fallDist > 0 && !skipConfirm && getSetting('fallConfirmation')) {
    const confirmed = await confirmFall(token, fallDist, effectiveFall, dmg);
    if (!confirmed) return { dmg: 0, fallDist: 0, effectiveFall: 0 };
  }

  const tokenIsDead = token.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead') ?? false;
  const hurt = dmg > 0 && !tokenIsDead;
  const undoLog = [{ op: 'update', uuid: doc.uuid, data: { x: doc.x, y: doc.y, elevation: currentElev }, options: { isUndo: true } }];
  let finalX = doc.x, finalY = doc.y;
  const snap = (actor) => {
    const s = snapStamina(actor);
    undoLog.push({ op: 'stamina', uuid: actor.uuid, prevTemp: s.prevTemp, prevValue: s.prevValue, squadGroupUuid: s.squadGroup?.uuid ?? null, prevSquadHP: s.prevSquadHP });
  };

  if (hurt) {
    snap(token.actor);
    await applyDamage(token.actor, dmg, undefined, { fall: true });
  }
  await safeUpdate(doc, { elevation: targetElev });
  if (hurt) await knockProne(token.actor, undoLog);
  if (caught) await stepOffCatcher(token);

  if (dmg > 0) {
    const landingGrid = toGrid(doc);
    const landedOn    = tokenAt(landingGrid.x, landingGrid.y, token.id);
    if (landedOn) {
      if (getSetting('debugMode')) console.log(`DSCT | applyFall | fell onto ${landedOn.name} at (${landingGrid.x},${landingGrid.y}), applying ${dmg} damage`);
      snap(landedOn.actor);
      await applyDamage(landedOn.actor, dmg, undefined, { fall: true });
      const fallerSize   = token.actor?.system?.combat?.size?.value ?? 1;
      const blockerMight = landedOn.actor?.system?.characteristics?.might?.value ?? 0;
      if (fallerSize > blockerMight) await knockProne(landedOn.actor, undoLog);
      const fallerWouldDie  = (token.actor.system.stamina?.value ?? 1) <= 0;
      const blockerWouldDie = (landedOn.actor.system.stamina?.value ?? 1) <= 0;
      if (!fallerWouldDie || !blockerWouldDie) {
        const chosen = await chooseFreeSquare(token, landedOn);
        if (chosen) {
          finalX = chosen.x * GRID();
          finalY = chosen.y * GRID();
          await safeUpdate(doc, { x: finalX, y: finalY }, { dsMovement: true });
        }
      }
    }
  }

  const lines = fallLines(token.name, { fallDist, effectiveFall, dmg, agility, reasons, caught, prone: hurt });
  if (override !== null) lines.splice(1, 0, game.i18n.format('DSCT.fall.edited', { n: override }));
  const fallLog = { fell: fallDist, effective: effectiveFall, dmg, targetTokenId: token.id, targetSceneId: doc.parent?.id ?? canvas.scene?.id, lines };
  const finalPos = { x: finalX, y: finalY, elevation: targetElev };
  if (!silent && fallDist > 0) {
    await ChatMessage.create({
      content: lines.join('<br>'),
      speaker: ChatMessage.getSpeaker({ token: doc }),
      flags: { [M]: { fallLog, isFallUndo: true, isUndone: false, undoLog, finalPos } },
    });
  }

  return { dmg, fallDist, effectiveFall, lines, fallLog, undoLog, finalPos };
};

const fallLines = (name, { fallDist, effectiveFall, dmg, agility, reasons, caught, prone }) => {
  const L = (key, data) => game.i18n.format(`DSCT.fall.${key}`, data);
  const lines = [L('fell', { name, dist: fallDist, s: fallDist !== 1 ? 's' : '' })];
  if (agility > 0) lines.push(L('agility', { n: agility }));
  for (const r of reasons) lines.push(L(r.n > 0 ? 'reducedBy' : 'increasedBy', { source: r.name || L('unknownSource', {}), n: Math.abs(r.n) }));
  if (caught) lines.push(L('caught', {}));
  else if (dmg > 0) lines.push(L('damage', { dmg, effective: effectiveFall }));
  else lines.push(L('tooShort', { effective: effectiveFall }));
  if (prone) lines.push(L('prone', { name }));
  return lines;
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
