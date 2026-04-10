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

// Returns the ds-quick-strike socketlib socket if compat mode is active, otherwise null.
const getQuickStrikeSocket = () => {
  if (!getSetting('quickStrikeCompat')) return null;
  if (!game.modules.get('ds-quick-strike')?.active) return null;
  return socketlib.registerModule('ds-quick-strike');
};

export const applyDamage = async (actor, amount, squadGroupOverride = undefined) => {
  const prevValue   = actor.system.stamina.value;
  const prevTemp    = actor.system.stamina.temporary;
  const squadGroup  = squadGroupOverride !== undefined ? squadGroupOverride : getSquadGroup(actor);
  const prevSquadHP = squadGroup?.system?.staminaValue ?? null;
  const members = squadGroup ? Array.from(squadGroup.members || []).filter(m => m) : [];
  const squadCombatantIds = members.map(m => m.id);
  const squadTokenIds     = members.map(m => m.tokenId).filter(Boolean);
  // Track which tokens were damaged in this action batch so the breakpoint UI can pre-lock them.
  if (squadGroup && actor.isToken && actor.token?.id) {
    if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
    window._lastSquadDamagedTokenIds.add(actor.token.id);
    clearTimeout(window._lastSquadDamagedTokenIdsTimer);
    window._lastSquadDamagedTokenIdsTimer = setTimeout(() => { window._lastSquadDamagedTokenIds = null; }, 2000);
  }
  const qsSocket = getQuickStrikeSocket();
  if (qsSocket) {
    // Route through ds-quick-strike so it appears in that module's chat log with source info and undo.
    // We still capture prevValue/prevTemp above so DSCT's own undo (position + status) continues working.
    const tokenId = actor.isToken
      ? actor.token?.id
      : canvas.tokens.placeables.find(t => t.actor?.id === actor.id)?.id;
    await qsSocket.executeAsGM('applyDamageToTarget', {
      tokenId,
      amount,
      type:             'untyped',
      ignoredImmunities: [],
      sourceActorName:  game.user.character?.name ?? game.user.name,
      sourceActorId:    game.user.character?.id ?? null,
      sourceItemName:   'Draw Steel: Combat Tools',
      sourcePlayerName: game.user.name,
      sourceItemId:     null,
      eventId:          `dsct-${foundry.utils.randomID()}`,
    });
  } else {
    await safeTakeDamage(actor, amount, { type: 'untyped', ignoredImmunities: [] });
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

// a prone or restrained flyer can't use flight to cancel a fall - restrained sets effective speed to 0 as a condition,
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
  // always land at targetElev - flyers glide down, everyone else falls
  await safeUpdate(token.document, { elevation: targetElev }, { animate: false, teleport: true });
  if (!silent) {
    await ChatMessage.create({ content: buildFallMessage(token.name, fallDist, effectiveFall, dmg) });
  }
  return { dmg, fallDist, effectiveFall };
};

const buildFallMessage = (name, fallDist, effectiveFall, dmg) => {
  const distPart = `<strong>${name}</strong> falls <strong>${fallDist}</strong> square${fallDist !== 1 ? 's' : ''}`;
  if (effectiveFall === fallDist) {
    // agility didn't reduce anything - skip the redundant "(X effective)" clause
    return dmg > 0
      ? `${distPart}, dealing <strong>${dmg}</strong> fall damage (${effectiveFall * 2} × ½ effective).`
      : `${distPart} but the fall is too short to deal damage.`;
  }
  const effectivePart = ` (<strong>${effectiveFall}</strong> effective after Agility reduction)`;
  return dmg > 0
    ? `${distPart}${effectivePart}, dealing <strong>${dmg}</strong> fall damage.`
    : `${distPart}${effectivePart} - not enough to deal damage.`;
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

/** Get a token placeable by ID. Tries the faster indexed lookup first, falls back to a full search. */
export const getTokenById = (id) =>
  canvas?.tokens?.get(id) ?? canvas?.tokens?.placeables?.find(t => t.id === id) ?? null;

/** Find an open UI window by its id string. */
export const getWindowById = (id) => Object.values(ui.windows).find(w => w.id === id) ?? null;

/**
 * Get the module API, optionally showing an error notification if it isn't available.
 * @param {boolean} [warn=true] - If true, shows an error notification when the API is missing.
 */
export const getModuleApi = (warn = true) => {
  const api = game.modules.get('draw-steel-combat-tools')?.api ?? null;
  if (!api && warn) ui.notifications.error('Draw Steel: Combat Tools not active.');
  return api;
};

/**
 * Normalise a Foundry collection value to a plain Array.
 * Handles: Array, Set, collection objects with a `.contents` array, or plain objects (returns values).
 */
export const normalizeCollection = (collection) => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Set) return [...collection];
  if (Array.isArray(collection.contents)) return collection.contents;
  return Object.values(collection);
};

// ── Canvas Pick Helper ────────────────────────────────────────────────────────

/**
 * Generic PIXI canvas-click picker.
 * Creates a full-viewport transparent overlay, redraws on every hover change,
 * and resolves when the user clicks a valid target. Resolves null on Escape.
 *
 * @param {object} opts
 * @param {(gfx: PIXI.Graphics, hover: *) => void} opts.draw
 *   Called on init and every hover change. Must fully clear and redraw `gfx`.
 *   `hover` is the last hitTest result (non-null) or null.
 * @param {(worldPos: {x,y}) => *|null} opts.hitTest
 *   Called on pointermove and pointerdown. Return a non-null value for a valid
 *   target; that value becomes `hover` and is resolved on click. Return null for
 *   "miss". For hover comparison to work correctly, return the same object
 *   instance for the same target (e.g. from a pre-built candidates array).
 * @param {string} [opts.hint]  Shown as a ui.notifications.info on open.
 * @returns {Promise<*|null>}  The clicked hitTest result, or null on Escape.
 */
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
    const result = hitTest(e.data.getLocalPosition(canvas.app.stage));
    if (result == null) return;
    cleanup();
    resolve(result);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  redraw();
  if (hint) ui.notifications.info(hint);
});

// ── Chat Message Injection ────────────────────────────────────────────────────

const _injectors     = [];
const _pendingInjects = new Map();

/**
 * Register an injector function to be called on every chat message inject pass.
 *
 * Injectors are called in registration order with (msg, ctx), where ctx contains:
 *   el      - the full message <li> element
 *   header  - .message-header
 *   content - .message-content (may be null)
 *   buttons - .message-part-buttons footer (may be null)
 *   rolls   - .message-part-rolls (may be null)
 *   parts   - NodeList of all [data-message-part] sections
 *
 * Return true from an injector to stop subsequent injectors running (use for
 * full content replacements like the knockback block).
 *
 * @param {Function} fn - (msg, ctx) => void | true
 */
export const registerInjector = (fn) => _injectors.push(fn);

/**
 * Schedule a debounced injection pass for a message.
 * Multiple rapid calls for the same message (e.g. from flag writes triggering
 * updateChatMessage) collapse into a single pass after chatInjectDelay.
 *
 * @param {ChatMessage} msg
 */
export const scheduleInject = (msg) => {
  const existing = _pendingInjects.get(msg.id);
  if (existing) clearTimeout(existing);
  const id = setTimeout(() => {
    _pendingInjects.delete(msg.id);
    const el = document.querySelector(`[data-message-id="${msg.id}"]`);
    if (!el) return;
    const ctx = {
      el,
      header:  el.querySelector('.message-header'),
      content: el.querySelector('.message-content'),
      buttons: el.querySelector('.message-part-buttons'),
      rolls:   el.querySelector('.message-part-rolls'),
      parts:   el.querySelectorAll('[data-message-part]'),
    };
    for (const fn of _injectors) {
      try {
        const stop = fn(msg, ctx);
        if (stop) break;
      } catch (e) {
        console.error('DSCT | scheduleInject | Injector error:', fn.name ?? '(anonymous)', e);
      }
    }
  }, getSetting('chatInjectDelay'));
  _pendingInjects.set(msg.id, id);
};

// ── Power Roll Bane/Edge Helpers ─────────────────────────────────────────────

export const tierOf = (total) => total <= 11 ? 1 : total <= 16 ? 2 : 3;

export const formatRollModLabel = (n) => {
  if (n === 0)  return '';
  if (n === 1)  return ' <em>(1 Bane)</em>';
  if (n === -1) return ' <em>(1 Edge)</em>';
  if (n >= 2)   return ` <em>(${n} Banes)</em>`;
  return ` <em>(${Math.abs(n)} Edges)</em>`;
};

/**
 * Parses the current bane/edge state from a live rendered chat message element.
 * Finds the "Ability Roll" dice section and extracts the base values (stripping any
 * existing ±2 modifier so the result represents the clean pre-bane state).
 *
 * @param {HTMLElement} el - A rendered chat message element (from renderChatMessageHTML)
 * @returns {{ originalTotal, originalNet, baseFormula, baseTooltip, isCritical } | null}
 */
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

/**
 * Applies a bane/edge delta to a rendered chat message element.
 * Uses the original parsed state (from parsePowerRollState) to ensure idempotency.
 * Safe to call on every re-render with the same stored data.
 *
 * @param {HTMLElement} el       - A rendered chat message element
 * @param {object}      baneData - Original roll state from parsePowerRollState
 * @param {number}      delta    - How many banes (+) or edges (-) to add to the original state.
 *                                 e.g. +1 adds one bane, -2 adds double edge.
 *                                 Final net is always capped to ±2.
 */
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

  // Strip any existing single-bane/edge modifier to get raw base total
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
  tierEl.innerHTML = `Tier ${finalTier}${formatRollModLabel(newNet)}`;

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
      if (applyBtn) applyBtn.innerHTML = `<i class="fa-solid fa-burst"></i> Apply ${dmgMatch[1]} Damage`;
    }
  }

  abilityRoll.dataset.dsctBaneApplied = 'true';
};