export const getSetting = (key) => game.settings.get('draw-steel-combat-tools', key);

export const hasTags    = (obj, tag)  => Tagger.hasTags(obj, tag);
export const getTags    = (obj)       => Tagger.getTags(obj);
export const getByTag   = (tag)       => Tagger.getByTag(tag);
export const addTags    = (obj, tags) => Tagger.addTags(obj, tags);
export const removeTags = (obj, tags) => Tagger.removeTags(obj, tags);

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

export const getMaterial = (obj) => {
  for (const mat of Object.keys(MATERIAL_RULES())) {
    if (hasTags(obj, mat)) return mat;
  }
  return 'wood';
};

export const tokenAt = (gx, gy, excludeId) => canvas.tokens.placeables.find(t => {
  if (t.id === excludeId) return false;
  const tg = toGrid(t.document);
  return tg.x === gx && tg.y === gy;
});

export const tileAt = (gx, gy) => canvas.tiles.placeables.find(t => {
  const tg = toGrid(t.document);
  return tg.x === gx && tg.y === gy;
});

// strict cross product: two segments that only touch at a shared endpoint do NOT count as crossing.
// this is the root cause of the diagonal corner-clipping problem. see forced-movement.js for the workaround.
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
  for (const w of canvas.walls.placeables) {
    const c = w.document.c;
    if (segmentsIntersect(from.x, from.y, to.x, to.y, c[0], c[1], c[2], c[3])) return w.document;
  }
  return null;
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
          await safeUpdate(doc, { 'system.stamina.temporary': entry.prevTemp, 'system.stamina.value': entry.prevValue });
          if (entry.squadGroupUuid && entry.prevSquadHP !== null) {
            const sg = await fromUuid(entry.squadGroupUuid);
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
  if (document.isOwner) return await document.update(data, options);
  return await getSocket().executeAsGM('updateDocument', document.uuid, data, options);
};

export const safeDelete = async (document) => {
  if (document.isOwner) return await document.delete();
  return await getSocket().executeAsGM('deleteDocument', document.uuid);
};

export const safeCreateEmbedded = async (parent, type, data) => {
  if (parent.isOwner) return await parent.createEmbeddedDocuments(type, data);
  return await getSocket().executeAsGM('createEmbedded', parent.uuid, type, data);
};

export const safeToggleStatusEffect = async (actor, effectId, options = {}) => {
  if (actor.isOwner) return await actor.toggleStatusEffect(effectId, options);
  return await getSocket().executeAsGM('toggleStatusEffect', actor.uuid, effectId, options);
};

export const safeTakeDamage = async (actor, amount, options = {}) => {
  if (actor.isOwner) return await actor.system.takeDamage(amount, options);
  return await getSocket().executeAsGM('takeDamage', actor.uuid, amount, options);
};

export const applyDamage = async (actor, amount, squadGroupOverride = undefined) => {
  const prevValue   = actor.system.stamina.value;
  const prevTemp    = actor.system.stamina.temporary;
  const squadGroup  = squadGroupOverride !== undefined ? squadGroupOverride : getSquadGroup(actor);
  const prevSquadHP = squadGroup?.system?.staminaValue ?? null;
  const members = squadGroup ? Array.from(squadGroup.members || []).filter(m => m) : [];
  const squadCombatantIds = members.map(m => m.id);
  const squadTokenIds     = members.map(m => m.tokenId).filter(Boolean);
  await safeTakeDamage(actor, amount, { type: 'untyped', ignoredImmunities: [] });
  return { prevTemp, prevValue, prevSquadHP, squadGroup, squadCombatantIds, squadTokenIds };
};

export const undoDamage = async (actor, { prevTemp, prevValue, prevSquadHP, squadGroup }) => {
  await safeUpdate(actor, { 'system.stamina.temporary': prevTemp, 'system.stamina.value': prevValue });
  if (squadGroup && prevSquadHP !== null) {
    await safeUpdate(squadGroup, { 'system.staminaValue': prevSquadHP });
  }
};

export const snapStamina = (actor) => {
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

// a prone or restrained flyer can't use flight to cancel a fall — restrained sets effective speed to 0 as a condition,
// which isn't reflected in the base movement.speed stat, so we have to check the status directly
export const canCurrentlyFly = (actor) => {
  if (!hasFly(actor)) return false;
  if (actor?.statuses?.has('prone'))      return false;
  if (actor?.statuses?.has('restrained')) return false;
  return (actor?.system?.movement?.speed ?? 1) > 0;
};

export const applyFall = async (token, targetElev = 0, { silent = true } = {}) => {
  const currentElev = token.document?.elevation ?? 0;
  if (currentElev <= targetElev) return { dmg: 0, fallDist: 0, effectiveFall: 0 };
  let dmg = 0, fallDist = 0, effectiveFall = 0;
  if (!canCurrentlyFly(token.actor)) {
    fallDist      = currentElev - targetElev;
    const agility = token.actor?.system?.characteristics?.agility?.value ?? 0;
    effectiveFall = Math.max(0, fallDist - agility);
    const cap     = getSetting('fallDamageCap');
    // effective fall under 2 squares isn't enough to deal damage
    dmg = effectiveFall < 2 ? 0 : Math.min(effectiveFall * 2, cap);
    if (dmg > 0) await applyDamage(token.actor, dmg);
  }
  // always land at targetElev — flyers glide down, everyone else falls
  await safeUpdate(token.document, { elevation: targetElev }, { animate: false, teleport: true });
  if (!silent) {
    await ChatMessage.create({ content: buildFallMessage(token.name, fallDist, effectiveFall, dmg) });
  }
  return { dmg, fallDist, effectiveFall };
};

const buildFallMessage = (name, fallDist, effectiveFall, dmg) => {
  const distPart = `<strong>${name}</strong> falls <strong>${fallDist}</strong> square${fallDist !== 1 ? 's' : ''}`;
  if (effectiveFall === fallDist) {
    // agility didn't reduce anything — skip the redundant "(X effective)" clause
    return dmg > 0
      ? `${distPart}, dealing <strong>${dmg}</strong> fall damage (${effectiveFall * 2} × ½ effective).`
      : `${distPart} but the fall is too short to deal damage.`;
  }
  const effectivePart = ` (<strong>${effectiveFall}</strong> effective after Agility reduction)`;
  return dmg > 0
    ? `${distPart}${effectivePart}, dealing <strong>${dmg}</strong> fall damage.`
    : `${distPart}${effectivePart} — not enough to deal damage.`;
};

export const sizeRank = (size) =>
  size.value >= 2 ? size.value + 2 : ({ T: 0, S: 1, M: 2, L: 3 })[size.letter] ?? 2;

export const canForcedMoveTarget = (attackerActor, targetActor) => {
  const targetSizeValue = targetActor?.system?.combat?.size?.value ?? 1;
  const might           = attackerActor?.system?.characteristics?.might?.value ?? 0;
  if (might >= 2 && targetSizeValue <= might) return true;
  const attackerRank = sizeRank(attackerActor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  const targetRank   = sizeRank(targetActor?.system?.combat?.size ?? { value: 1, letter: 'M' });
  return attackerRank >= targetRank;
};

export const getItemDsid = (item) => item.system?._dsid ?? item.toObject().system?._dsid ?? null;

export const getItemRange = (item) => {
  const dist = item.system?.distance;
  if (!dist) return 0;
  const p = parseInt(dist.primary)   || 0;
  const s = parseInt(dist.secondary) || 0;
  const t = parseInt(dist.tertiary)  || 0;
  if (dist.type === 'meleeRanged')                  return Math.max(p, s);
  if (dist.type === 'line')                         return p + t;
  if (dist.type === 'cube' || dist.type === 'wall') return p + s;
  return p;
};

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
  await safeUpdate(tokenDoc, { x: targetX, y: targetY }, { animate: false, teleport: true });
};