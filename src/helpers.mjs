export const getSetting = (key) => game.settings.get('draw-steel-combat-tools', key);

const PALETTE_DARK = {
  '--dsct-bg':           '#0e0c14',
  '--dsct-bg-inner':     '#0a0810',
  '--dsct-bg-btn':       '#1a1628',
  '--dsct-border':       '#2a2040',
  '--dsct-border-outer': '#4a3870',
  '--dsct-text':         '#8a88a0',
  '--dsct-text-dim':     '#3a3050',
  '--dsct-text-label':   '#4a3870',
  '--dsct-accent':       '#7a50c0',
  '--dsct-accent-red':   '#802020',
  '--dsct-accent-green': '#206040',
  '--dsct-text-active':    '#c0a8e8',
  '--dsct-text-mimic':     '#9a7a5a',
  '--dsct-text-mimic-dim': '#3a3050',
  '--dsct-border-panel':   '#1e1a24',
  '--dsct-mimic-label':    '#6a5080',
  '--dsct-animal-label':   '#6a5a8a',
  '--dsct-close-fg':       '#6a5a8a',
};
const PALETTE_LIGHT = {
  '--dsct-bg':           '#f0eef8',
  '--dsct-bg-inner':     '#e4e0f0',
  '--dsct-bg-btn':       '#dbd8ec',
  '--dsct-border':       '#b0a8cc',
  '--dsct-border-outer': '#7060a8',
  '--dsct-text':         '#3a3060',
  '--dsct-text-dim':     '#8880aa',
  '--dsct-text-label':   '#5040a0',
  '--dsct-accent':       '#7a50c0',
  '--dsct-accent-red':   '#a03030',
  '--dsct-accent-green': '#206040',
  '--dsct-text-active':    '#4030a0',
  '--dsct-text-mimic':     '#7a5a30',
  '--dsct-text-mimic-dim': '#9088b0',
  '--dsct-border-panel':   '#c8c0e0',
  '--dsct-mimic-label':    '#5a4070',
  '--dsct-animal-label':   '#6a5a8a',
  '--dsct-close-fg':       '#7060a8',
};

export const initPalette = () => {
  const pal = document.body.classList.contains('theme-dark') ? PALETTE_DARK : PALETTE_LIGHT;
  for (const [k, v] of Object.entries(pal)) document.documentElement.style.setProperty(k, v);
};

const taggerActive = () => game.modules.get('tagger')?.active;



const M = 'draw-steel-combat-tools';
const _doc  = (obj) => obj?.document ?? obj;
const _tags = (obj) => _doc(obj)?.getFlag(M, 'tags') ?? [];

export const hasTags = (obj, tag) => {
  if (taggerActive()) return Tagger.hasTags(obj, tag);
  const tags = _tags(obj);
  return Array.isArray(tag) ? tag.every(t => tags.includes(t)) : tags.includes(tag);
};

export const getTags = (obj) => taggerActive() ? Tagger.getTags(obj) : _tags(obj);

export const getByTag = (tag) => {
  if (taggerActive()) return Tagger.getByTag(tag);
  const results = [];
  for (const w of canvas.scene?.walls?.contents ?? [])  { if (_tags(w).includes(tag))  results.push(w); }
  for (const t of canvas.scene?.tiles?.contents ?? [])  { if (_tags(t).includes(tag))  results.push(t); }
  for (const t of canvas.scene?.tokens?.contents ?? []) { if (_tags(t).includes(tag))  results.push(t); }
  return results;
};

export const addTags = async (obj, tags) => {
  if (taggerActive()) return Tagger.addTags(obj, tags);
  const doc  = _doc(obj);
  const curr = _tags(obj);
  await doc.setFlag(M, 'tags', [...new Set([...curr, ...tags])]);
};

export const removeTags = async (obj, tags) => {
  if (taggerActive()) return Tagger.removeTags(obj, tags);
  const doc  = _doc(obj);
  const curr = _tags(obj);
  await doc.setFlag(M, 'tags', curr.filter(t => !tags.includes(t)));
};

export const GRID = () => canvas.grid.size;

export const toGrid   = (world) => ({ x: Math.floor(world.x / GRID()), y: Math.floor(world.y / GRID()) });
export const toWorld  = (grid)  => ({ x: grid.x * GRID(), y: grid.y * GRID() });
export const toCenter = (grid)  => ({ x: grid.x * GRID() + GRID() / 2, y: grid.y * GRID() + GRID() / 2 });
export const gridEq   = (a, b)  => a.x === b.x && a.y === b.y;
export const gridDist = (a, b)  => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const MATERIAL_RULES    = () => getSetting('materialRules');
export const WALL_RESTRICTIONS = () => getSetting('wallRestrictions');

export const MATERIAL_ICONS = {
  glass:  'icons/magic/light/beam-rays-yellow-blue-small.webp',
  wood:   'icons/commodities/wood/lumber-plank-brown.webp',
  stone:  'icons/commodities/stone/paver-brick-brown.webp',
  metal:  'icons/environment/traps/pressure-plate.webp',
  broken: 'icons/environment/settlement/building-rubble.webp',
};

export const MATERIAL_ALPHA = { glass: 0.1, wood: 0.8, stone: 0.8, metal: 0.8 };

export const BASE_MATERIALS    = ['glass', 'wood', 'stone', 'metal'];
export const getCustomMaterials = () => { try { return getSetting('customMaterials') ?? []; } catch { return []; } };
export const getAllMaterials    = () => [...BASE_MATERIALS, ...getCustomMaterials().map(m => m.name)];
export const getMaterialIcon   = (name) => MATERIAL_ICONS[name] ?? getCustomMaterials().find(m => m.name === name)?.icon ?? MATERIAL_ICONS.stone;
export const getMaterialAlpha  = (name) => MATERIAL_RULES()[name]?.alpha ?? MATERIAL_ALPHA[name] ?? getCustomMaterials().find(m => m.name === name)?.alpha ?? 0.8;

export const getMaterial = (obj) => {
  for (const mat of Object.keys(MATERIAL_RULES())) {
    if (hasTags(obj, mat)) return mat;
  }
  return 'wood';
};


export const tokenAt = (gx, gy, excludeId) => canvas.tokens.placeables.find(t => {
  if (t.id === excludeId) return false;
  const tg   = toGrid(t.document);
  const size = t.actor?.system?.combat?.size?.value ?? t.document.width ?? 1;
  return gx >= tg.x && gx < tg.x + size && gy >= tg.y && gy < tg.y + size;
});

export const tileAt = (gx, gy) => canvas.tiles.placeables.find(t => {
  const tg = toGrid(t.document);
  return tg.x === gx && tg.y === gy;
});



export const segmentsIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
          ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)));
};

export const wallBetween = (fromGrid, toGrid_) => {
  const from = toCenter(fromGrid);
  const to   = toCenter(toGrid_);
  let fallback = null;
  for (const w of canvas.walls.placeables) {
    const c = w.document.c;
    if (!segmentsIntersect(from.x, from.y, to.x, to.y, c[0], c[1], c[2], c[3])) continue;
    if (hasTags(w.document, 'obstacle')) return w.document;
    if (!fallback) fallback = w.document;
  }
  return fallback;
};


export const getSquadGroup = (actor) => {
  const combatant = game.combat?.combatants.find(c => c.actorId === actor.id);
  const group = combatant?.group;
  if (group?.type === 'squad') return group;
  return null;
};

const getSocket = () => game.modules.get('draw-steel-combat-tools').api.socket;

export const replayUndo = async (ops) => {
  for (const entry of ops) {
    try {
      const doc = await fromUuid(entry.uuid);
      if (!doc) continue;
      const obj = doc.object ?? doc;
      switch (entry.op) {
        case 'update':     await safeUpdate(doc, entry.data, entry.options ?? {}); break;
        case 'delete':     await safeDelete(doc); break;
        case 'addTags':    await addTags(obj, entry.tags); break;
        case 'removeTags': await removeTags(obj, entry.tags); break;
        case 'status':     await safeToggleStatusEffect(doc, entry.effectId, { active: entry.active }); break;
        case 'stamina':
          if (entry.wasDeadBefore) break;
          if (getSetting('debugMode')) console.log(`DSCT | HLP | replayUndo stamina: actorUuid=${entry.uuid} prevValue=${entry.prevValue} squadGroupUuid=${entry.squadGroupUuid} prevSquadHP=${entry.prevSquadHP} squadTokenIds=${JSON.stringify(entry.squadTokenIds)}`);
          await safeUpdate(doc, { 'system.stamina.temporary': entry.prevTemp, 'system.stamina.value': entry.prevValue });
          if (entry.squadGroupUuid && entry.prevSquadHP !== null) {
            const sg = await fromUuid(entry.squadGroupUuid);
            if (getSetting('debugMode')) console.log(`DSCT | HLP | replayUndo stamina squad: sg found=${!!sg} currentStaminaValue=${sg?.system?.staminaValue} prevSquadHP=${entry.prevSquadHP}`);
            if (sg) await safeUpdate(sg, { 'system.staminaValue': entry.prevSquadHP });
          }
          break;
      }
    } catch (e) {
      console.error('DSCT | HLP | replayUndo error on entry:', entry, e);
    }
  }
};

export const safeUpdate = async (document, data, options = {}) => {
  if (options.teleport) {
    const { teleport, ...rest } = options;
    const x = data.x ?? document._source?.x ?? document.x;
    const y = data.y ?? document._source?.y ?? document.y;
    options = { ...rest, movement: { [document.id]: { waypoints: [{ x, y, action: 'displace' }] } } };
  }
  if (document.isOwner) return await document.update(data, options);
  return await getSocket().executeAsGM('dsct.updateDocument', document.uuid, data, options);
};

export const safeDelete = async (document) => {
  try {
    if (document.isOwner) return await document.delete();
    return await getSocket().executeAsGM('dsct.deleteDocument', document.uuid);
  } catch (_) {}
};

export const safeCreateEmbedded = async (parent, type, data) => {
  if (parent.isOwner) return await parent.createEmbeddedDocuments(type, data);
  return await getSocket().executeAsGM('dsct.createEmbedded', parent.uuid, type, data);
};

export const safeToggleStatusEffect = async (actor, effectId, options = {}) => {
  if (actor.isOwner) return await actor.toggleStatusEffect(effectId, options);
  return await getSocket().executeAsGM('dsct.toggleStatusEffect', actor.uuid, effectId, options);
};

export const safeTakeDamage = async (actor, amount, options = {}) => {
  
  
  
  if (actor.isOwner && (game.user.isGM || !getSquadGroup(actor))) return await actor.system.takeDamage(amount, options);
  return await getSocket().executeAsGM('dsct.takeDamage', actor.uuid, amount, options);
};

const getQuickStrikeSocket = () => {
  if (!getSetting('quickStrikeCompat')) return null;
  if (!game.modules.get('ds-quick-strike')?.active) return null;
  return socketlib.registerModule('ds-quick-strike');
};

export const applyDamage = async (actor, amount, squadGroupOverride = undefined, {
  damageType     = 'untyped',
  ignoreImmunity = false,
  sourceToken    = null,
  isArea         = false,
  sourceItemName = 'Draw Steel: Combat Tools',
} = {}) => {
  const prevValue   = actor.system.stamina.value;
  const prevTemp    = actor.system.stamina.temporary;
  const squadGroup  = squadGroupOverride !== undefined ? squadGroupOverride : getSquadGroup(actor);
  const prevSquadHP = squadGroup?.system?.staminaValue ?? null;
  const members = squadGroup ? Array.from(squadGroup.members || []).filter(m => m) : [];
  const squadCombatantIds = members.map(m => m.id);
  const squadTokenIds     = members.map(m => m.tokenId).filter(Boolean);
  if (squadGroup && actor.isToken && actor.token?.id) {
    const _dmgTokenId = actor.token.id;
    if (game.users.activeGM?.isSelf) {
      if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
      window._lastSquadDamagedTokenIds.add(_dmgTokenId);
      clearTimeout(window._lastSquadDamagedTokenIdsTimer);
      window._lastSquadDamagedTokenIdsTimer = setTimeout(() => { window._lastSquadDamagedTokenIds = null; }, window._dsctFMActive ? 10000 : 2000);
    } else {
      console.log(`DSCT | DT | applyDamage: player client, reporting squad-damaged token ${_dmgTokenId} to GM via socket`);
      getModuleApi(false)?.socket?.executeAsGM('dsct.reportDamagedToken', _dmgTokenId, game.user.id);
    }
  }
  const type              = damageType || 'untyped';
  const ignoredImmunities = ignoreImmunity ? [type] : [];
  const effectiveAmt      = (isArea && squadGroup) ? Math.min(amount, actor.system.stamina.max ?? amount) : amount;
  const qsSocket = getQuickStrikeSocket();
  if (qsSocket && !squadGroup) {
    const tokenId = actor.isToken
      ? actor.token?.id
      : canvas.tokens.placeables.find(t => t.actor?.id === actor.id)?.id;
    await qsSocket.executeAsGM('applyDamageToTarget', {
      tokenId,
      amount: effectiveAmt,
      type,
      ignoredImmunities,
      sourceActorName:  sourceToken?.actor?.name ?? sourceToken?.name ?? game.user.character?.name ?? game.user.name,
      sourceActorId:    sourceToken?.actor?.id ?? game.user.character?.id ?? null,
      sourceItemName,
      sourcePlayerName: game.user.name,
      sourceItemId:     null,
      eventId:          `dsct-${foundry.utils.randomID()}`,
    });
  } else {
    await safeTakeDamage(actor, effectiveAmt, { type, ignoredImmunities });
  }
  return { prevTemp, prevValue, prevSquadHP, squadGroup, squadCombatantIds, squadTokenIds };
};

export const undoDamage = async (actor, { prevTemp, prevValue, prevSquadHP, squadGroup }) => {
  await safeUpdate(actor, { 'system.stamina.temporary': prevTemp, 'system.stamina.value': prevValue });
  if (squadGroup && prevSquadHP !== null) {
    await safeUpdate(squadGroup, { 'system.staminaValue': prevSquadHP });
  }
};

export const snapStamina = (actor) => {
  if (!actor) return { prevValue: 0, prevTemp: 0, squadGroup: null, prevSquadHP: null, squadCombatantIds: [], squadTokenIds: [] };
  const sg = getSquadGroup(actor);
  const members = sg ? Array.from(sg.members || []).filter(m => m) : [];
  return {
    prevValue:   actor.system.stamina.value,
    prevTemp:    actor.system.stamina.temporary,
    squadGroup:  sg,
    prevSquadHP: sg?.system?.staminaValue ?? null,
    squadCombatantIds: members.map(m => m.id),
    squadTokenIds:     members.map(m => m.tokenId).filter(Boolean),
  };
};

export const hasFly = (actor) => {
  const types = actor?.system?.movement?.types;
  if (types instanceof Set) return types.has('fly');
  if (Array.isArray(types)) return types.includes('fly');
  return false;
};

export const canCurrentlyFly = (actor) => {
  if (!hasFly(actor)) return false;
  if (actor?.statuses?.has('prone'))      return false;
  if (actor?.statuses?.has('restrained')) return false;
  return (actor?.system?.movement?.speed ?? 1) > 0;
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

export const chooseFreeSquare = (targetToken, landedOnToken = null, { forceOnCancel = false } = {}) => new Promise((resolve) => {
  const G        = GRID();
  const refToken = landedOnToken ?? targetToken;
  const refTg    = toGrid(refToken.document);
  const refSize  = refToken.actor?.system?.combat?.size?.value ?? 1;

  const getAdjacentRing = (radius) => {
    const squares = [];
    const minX = refTg.x - radius, maxX = refTg.x + refSize - 1 + radius;
    const minY = refTg.y - radius, maxY = refTg.y + refSize - 1 + radius;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (x !== minX && x !== maxX && y !== minY && y !== maxY) continue;
        if (x >= refTg.x && x < refTg.x + refSize && y >= refTg.y && y < refTg.y + refSize) continue;
        squares.push({ x, y });
      }
    }
    return squares;
  };

  const defeatedId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const isSquareFree = (gx, gy) => {
    const tok = tokenAt(gx, gy, targetToken.id);
    if (tok && !tok.actor?.statuses?.has(defeatedId)) return false;
    const t = tileAt(gx, gy);
    if (t && hasTags(t, 'obstacle') && !hasTags(t, 'broken')) return false;
    return true;
  };

  let candidates = [];
  const invalidSquares = [];

  const fallerSize = targetToken.actor?.system?.combat?.size?.value ?? 1;
  if (landedOnToken && Math.abs(fallerSize - refSize) >= 2) {
    candidates.push({ x: refTg.x, y: refTg.y });
  }

  for (let r = 1; r <= 10; r++) {
    const ring = getAdjacentRing(r);
    for (const g of ring) {
      (isSquareFree(g.x, g.y) ? candidates : invalidSquares).push(g);
    }
    if (candidates.length > 0) break;
  }

  if (getSetting('debugMode')) {
    const fallerTg = toGrid(targetToken.document);
    console.log(`DSCT | chooseFreeSquare | ref=${refToken.name} grid=(${refTg.x},${refTg.y}) size=${refSize} | faller=${targetToken.name} grid=(${fallerTg.x},${fallerTg.y}) | candidates=[${candidates.map(c => `(${c.x},${c.y})`).join(',')}]`);
  }

  if (candidates.length === 0) { resolve(null); return; }

  const fallerW  = targetToken.document.width  ?? 1;
  const fallerH  = targetToken.document.height ?? 1;
  const fallerCx = targetToken.x + fallerW * G / 2;
  const fallerCy = targetToken.y + fallerH * G / 2;

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const drawArrow = (toPx) => {
    const dx = toPx.x - fallerCx, dy = toPx.y - fallerCy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const thin = G * 0.08, wide = G * 0.19, HW = G * 0.33, HL = G * 0.46, tipExt = G * 0.3;
    const baseX = toPx.x - ux * HL, baseY = toPx.y - uy * HL;
    const poly = [
      fallerCx + nx * thin, fallerCy + ny * thin,
      baseX + nx * wide,    baseY + ny * wide,
      baseX + nx * HW,      baseY + ny * HW,
      toPx.x + ux * tipExt, toPx.y + uy * tipExt,
      baseX - nx * HW,      baseY - ny * HW,
      baseX - nx * wide,    baseY - ny * wide,
      fallerCx - nx * thin, fallerCy - ny * thin,
    ];
    const SO   = 3;
    const GLOW = [[G * 0.24, 0.07], [G * 0.15, 0.14], [G * 0.08, 0.30], [G * 0.03, 0.65]];
    graphics.beginFill(0x000000, 0.22);
    graphics.drawPolygon(poly.map((v, i) => v + SO));
    graphics.drawCircle(fallerCx + SO, fallerCy + SO, thin);
    graphics.endFill();
    for (const [w, a] of GLOW) {
      graphics.lineStyle(w, 0xffffff, a);
      graphics.drawPolygon(poly);
      graphics.drawCircle(fallerCx, fallerCy, thin);
      graphics.lineStyle(0);
    }
    graphics.beginFill(0xdd1111, 1.0);
    graphics.drawPolygon(poly);
    graphics.drawCircle(fallerCx, fallerCy, thin);
    graphics.endFill();
  };

  const redrawHighlight = (hoverGrid) => {
    graphics.clear();
    for (const g of invalidSquares) {
      graphics.beginFill(0x880000, 0.4);
      graphics.drawRect(g.x * G, g.y * G, G, G);
      graphics.endFill();
    }
    for (const g of candidates) {
      const isHover = hoverGrid && g.x === hoverGrid.x && g.y === hoverGrid.y;
      graphics.beginFill(0x44cc44, isHover ? 0.6 : 0.3);
      graphics.drawRect(g.x * G, g.y * G, G, G);
      graphics.endFill();
    }
    if (hoverGrid) drawArrow({ x: hoverGrid.x * G + fallerW * G / 2, y: hoverGrid.y * G + fallerH * G / 2 });
  };

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);
  let hoverGrid = null;

  const onMove = (e) => {
    const pos  = e.data.getLocalPosition(canvas.app.stage);
    const gpos = toGrid(pos);
    hoverGrid  = candidates.find(g => g.x === gpos.x && g.y === gpos.y) ?? null;
    redrawHighlight(hoverGrid);
  };

  const onClick = (e) => {
    const pos    = e.data.getLocalPosition(canvas.app.stage);
    const gpos   = toGrid(pos);
    const chosen = candidates.find(g => g.x === gpos.x && g.y === gpos.y);
    if (!chosen) return;
    cleanupPicker();
    resolve(chosen);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanupPicker(); resolve(forceOnCancel ? (candidates[0] ?? null) : null); } };

  const cleanupPicker = () => {
    overlay.off('pointermove', onMove);
    overlay.off('pointerdown', onClick);
    document.removeEventListener('keydown', onKeyDown);
    canvas.app.stage.removeChild(overlay);
    canvas.app.stage.removeChild(graphics);
    graphics.destroy();
    overlay.destroy();
  };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  redrawHighlight(null);
  ui.notifications.info(game.i18n.format('DSCT.notice.fm.chooseLanding', { name: targetToken.name }));
});

export const sizeRank = (size) =>
  size.value >= 2 ? size.value + 2 : ({ T: 0, S: 1, M: 2, L: 3 })[size.letter] ?? 2;

export const canForcedMoveTarget = (attackerActor, targetActor, mightOverride = null) => {
  const targetSizeValue = targetActor?.system?.combat?.size?.value ?? 1;
  const might = mightOverride ?? (attackerActor?.system?.characteristics?.might?.value ?? 0);
  if (might >= 2 && targetSizeValue <= might) return true;
  const attackerRank = sizeRank(attackerActor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  const targetRank   = sizeRank(targetActor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  return attackerRank >= targetRank;
};

export const getItemDsid = (item) => item.system?._dsid ?? item.toObject().system?._dsid ?? null;

export const MULTI_GRAB_LIMITS = {
  'choking-grasp': 2,
  'claw-swing':    2,
  'several-arms':  4,
  'tentacle-grab': 4,
  'ribcage-chomp': 4,
};

export const getItemRange = (item) => {
  const dist = item.system?.distance;
  if (!dist) return 0;
  const p = parseInt(dist.primary)   || 0;
  const s = parseInt(dist.secondary) || 0;
  const t = parseInt(dist.tertiary)  || 0;
  if (dist.type === 'meleeRanged')                  return (item.system?.damageDisplay ?? 'melee') === 'ranged' ? s : p;
  if (dist.type === 'line')                         return p + t;
  if (dist.type === 'cube' || dist.type === 'wall') return p + s;
  return p;
};

export const footprintDistFromBounds = (aL, aT, aW, aH, bL, bT, bW, bH) => {
  const GS = canvas.grid.size;
  const aR = aL + aW * GS, aB = aT + aH * GS;
  const bR = bL + bW * GS, bB = bT + bH * GS;
  let px, qx, py, qy;
  if (aR <= bL)      { px = aR; qx = bL; }
  else if (bR <= aL) { px = aL; qx = bR; }
  else               { px = qx = Math.max(aL, bL); }
  if (aB <= bT)      { py = aB; qy = bT; }
  else if (bB <= aT) { py = aT; qy = bB; }
  else               { py = qy = Math.max(aT, bT); }
  return canvas.grid.measurePath([{ x: px, y: py }, { x: qx, y: qy }]).distance;
};

export const tokFootprintDist = (tokA, tokB) => footprintDistFromBounds(
  tokA.document.x, tokA.document.y, tokA.document.width, tokA.document.height,
  tokB.document.x, tokB.document.y, tokB.document.width, tokB.document.height,
);


export const getWallBlockTileAt = (gx, gy) => {
  return canvas.tiles.placeables.find(t => {
    const tg = toGrid(t.document);
    return tg.x === gx && tg.y === gy && hasTags(t, 'obstacle');
  }) ?? null;
};

export const getWallBlockWalls = (tile) => {
  const blockTag = getTags(tile).find(t => t.startsWith('wall-block-'));
  if (!blockTag) return { blockTag: null, walls: [] };
  return { blockTag, walls: getByTag(blockTag).filter(o => Array.isArray(o.c)) };
};

export const getWallBlockBottom = (tile) => {
  const { walls } = getWallBlockWalls(tile);
  return walls[0]?.flags?.['wall-height']?.bottom ?? null;
};

export const getWallBlockTop = (tile) => {
  const { walls } = getWallBlockWalls(tile);
  return walls[0]?.flags?.['wall-height']?.top ?? null;
};

export const safeTeleport = async (tokenDoc, targetX, targetY) => {
  canvas.tokens.releaseAll();
  await safeUpdate(tokenDoc, { x: targetX, y: targetY }, { isUndo: true });
};

export const getTokenById = (id) =>
  canvas?.tokens?.get(id) ?? canvas?.tokens?.placeables?.find(t => t.id === id) ?? null;

export const getWindowById = (id) =>
  foundry.applications.instances?.get(id)
  ?? Object.values(ui.windows).find(w => w.id === id)
  ?? null;

export const getModuleApi = (warn = true) => {
  const api = game.modules.get('draw-steel-combat-tools')?.api ?? null;
  if (!api && warn) ui.notifications.error(game.i18n.localize('DSCT.notice.notActive'));
  return api;
};

export const normalizeCollection = (collection) => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Set) return [...collection];
  if (Array.isArray(collection.contents)) return collection.contents;
  return Object.values(collection);
};

export const pickCanvasTarget = ({ draw, hitTest, hint }) => new Promise((resolve) => {
  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);

  let hover = null;
  const redraw = () => { graphics.clear(); draw(graphics, hover); };

  const cleanup = () => {
    overlay.off('pointermove', onMove);
    overlay.off('pointerdown', onClick);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('contextmenu', onContextMenu);
    canvas.app.stage.removeChild(overlay);
    canvas.app.stage.removeChild(graphics);
    graphics.destroy();
    overlay.destroy();
  };

  const onMove = (e) => {
    const result = hitTest(e.data.getLocalPosition(canvas.app.stage));
    if (result !== hover) { hover = result; redraw(); }
  };

  const onClick = (e) => {
    if (e.data.button === 2) { if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); } return; }
    const result = hitTest(e.data.getLocalPosition(canvas.app.stage));
    if (result == null) return;
    cleanup();
    resolve(result);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
  const onContextMenu = (e) => { e.preventDefault(); };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('contextmenu', onContextMenu);
  redraw();
  if (hint) ui.notifications.info(hint);
});

export const monsterFilter = {
  keyword:          (kw)  => (a) => a?.system?.monster?.keywords?.has(kw) ?? false,
  organization:     (o)   => (a) => a?.system?.monster?.organization === o,
  level:            (n)   => (a) => a?.system?.monster?.level === n,
  type:             (t)   => (a) => a?.type === t,
  isMinion:                  (a) => a?.system?.isMinion ?? false,
  sameLevel:        (src) => {
    const lvl = src?.actor?.system?.monster?.level ?? src?.system?.monster?.level ?? null;
    return (a) => a?.system?.monster?.level === lvl;
  },
  sameOrganization: (src) => {
    const org = src?.actor?.system?.monster?.organization ?? src?.system?.monster?.organization ?? null;
    return (a) => a?.system?.monster?.organization === org;
  },
  sameKeywords:     (src) => {
    const kwds = src?.actor?.system?.monster?.keywords ?? src?.system?.monster?.keywords ?? new Set();
    return (a) => {
      const ak = a?.system?.monster?.keywords;
      if (!ak) return kwds.size === 0;
      if (ak.size !== kwds.size) return false;
      for (const kw of kwds) if (!ak.has(kw)) return false;
      return true;
    };
  },
  onActor:          (fn)  => (t) => fn(t?.actor),
};

export const tierOf = (total) => total <= 11 ? 1 : total <= 16 ? 2 : 3;

export const formatRollModLabel = (n) => {
  if (n === 0)  return '';
  if (n === 1)  return ' <em>(1 Bane)</em>';
  if (n === -1) return ' <em>(1 Edge)</em>';
  if (n >= 2)   return ` <em>(${n} Banes)</em>`;
  return ` <em>(${Math.abs(n)} Edges)</em>`;
};

export const parsePowerRollState = (el) => {
  const abilityRoll = [...el.querySelectorAll('.dice-roll')]
    .find(r => r.querySelector('.dice-flavor')?.textContent?.trim() === 'Ability Roll');
  if (!abilityRoll) return null;

  const totalEl   = abilityRoll.querySelector('.dice-total');
  const formulaEl = abilityRoll.querySelector('.dice-formula');
  const tooltipEl = abilityRoll.querySelector('[data-tooltip-text]');
  const tierEl    = abilityRoll.querySelector('.tier');
  if (!totalEl || !formulaEl || !tierEl) return null;

  const originalTotal = parseInt(totalEl.textContent.trim());
  if (isNaN(originalTotal)) return null;

  const isCritical = totalEl.classList.contains('critical');

  const emText = tierEl.querySelector('em')?.textContent?.toLowerCase().trim() ?? '';
  let originalNet = 0;
  if (emText) {
    const isBane   = emText.includes('bane');
    const isEdge   = emText.includes('edge');
    const numMatch = emText.match(/(\d+)/);
    const count    = numMatch ? parseInt(numMatch[1]) : 1;
    if (isBane) originalNet =  count;
    if (isEdge) originalNet = -count;
  }

  let baseFormula = formulaEl.textContent.trim();
  let baseTooltip = tooltipEl?.getAttribute('data-tooltip-text') ?? baseFormula;
  if (originalNet === 1) {
    baseFormula = baseFormula.replace(/\s*-\s*2\s*$/, '').trim();
    baseTooltip = baseTooltip.replace(/\s*-\s*2(\[Bane\])?/i, '').trim();
  } else if (originalNet === -1) {
    baseFormula = baseFormula.replace(/\s*\+\s*2\s*$/, '').trim();
    baseTooltip = baseTooltip.replace(/\s*\+\s*2(\[Edge\])?/i, '').trim();
  }

  return { originalTotal, originalNet, baseFormula, baseTooltip, isCritical };
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

