export const getSetting = (key) => game.settings.get('draw-steel-combat-tools', key);

// -- Panel scaling & theming --


export const PANEL_SCALE = 1.2;
export const s = (n) => Math.round(n * PANEL_SCALE);

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

export const injectPanelChrome = (appId) => {
  const styleId = `${appId}-chrome`;
  const el = document.getElementById(styleId)
    ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
  el.textContent = `
    #${appId} { border:1px solid var(--dsct-border-outer) !important; border-radius:3px; box-shadow:0 0 12px rgba(0,0,0,0.4); }
    #${appId} .window-header { display:none !important; }
    #${appId} .window-content { padding:0 !important; background:var(--dsct-bg) !important; overflow-y:auto; border-radius:3px; }
    #${appId} button:hover { filter:brightness(1.15); }
    #${appId} button:focus { outline:none; }
    #${appId} button:disabled { opacity:0.35; cursor:not-allowed; }
    #${appId} button:disabled:hover { filter:none; }
    #${appId} input[type="number"], #${appId} input[type="text"], #${appId} select, #${appId} textarea { background:var(--dsct-bg-btn); color:var(--dsct-text); border:1px solid var(--dsct-border); border-radius:2px; font-size:11px; padding:2px; }
    #${appId} input:focus, #${appId} select:focus, #${appId} textarea:focus { outline:none; border-color:var(--dsct-accent); }
    #${appId} input::placeholder, #${appId} textarea::placeholder { color:var(--dsct-text-label); }
    #${appId} input[type="checkbox"] { accent-color:var(--dsct-accent); margin:0; }
    #${appId} select:disabled { opacity:0.35; }
  `;
};

export const palette = () => ({
  bg:          'var(--dsct-bg)',
  bgInner:     'var(--dsct-bg-inner)',
  bgBtn:       'var(--dsct-bg-btn)',
  border:      'var(--dsct-border)',
  borderPanel: 'var(--dsct-border-panel)',
  borderOuter: 'var(--dsct-border-outer)',
  text:        'var(--dsct-text)',
  textDim:     'var(--dsct-text-dim)',
  textLabel:   'var(--dsct-text-label)',
  textActive:  'var(--dsct-text-active)',
  textMimic:   'var(--dsct-text-mimic)',
  textMimicDim:'var(--dsct-text-mimic-dim)',
  accent:      'var(--dsct-accent)',
  accentRed:   'var(--dsct-accent-red)',
  accentGreen: 'var(--dsct-accent-green)',
  mimicLabel:  'var(--dsct-mimic-label)',
  animalLabel: 'var(--dsct-animal-label)',
  closeFg:     'var(--dsct-close-fg)',
});

// -- Tag System --

const taggerActive = () => game.modules.get('tagger')?.active;

// Internal flag-based tag system which replaced Tagger since it's unavailable with V14's release.

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

// -- Grid & Coordinates --


export const GRID = () => canvas.grid.size;

export const toGrid   = (world) => ({ x: Math.floor(world.x / GRID()), y: Math.floor(world.y / GRID()) });
export const toWorld  = (grid)  => ({ x: grid.x * GRID(), y: grid.y * GRID() });
export const toCenter = (grid)  => ({ x: grid.x * GRID() + GRID() / 2, y: grid.y * GRID() + GRID() / 2 });
export const gridEq   = (a, b)  => a.x === b.x && a.y === b.y;
export const gridDist = (a, b)  => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// -- Materials --


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

// This was a headache, corner cutting in foundry is determined by weird sub-pixel measurements which are inconsistent so this bypasses that by allowing corner-cutting. See cornerCutsWall in forced-movement-collision.mjs for the workaround that stops it, since Draw Steel rules don't allow corner cutting around walls.

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

const getQuickStrikeSocket = () => {
  if (!getSetting('quickStrikeCompat')) return null;
  if (!game.modules.get('ds-quick-strike')?.active) return null;
  return socketlib.registerModule('ds-quick-strike');
};

// -- Damage & Stamina --


export const applyDamage = async (actor, amount, squadGroupOverride = undefined) => {
  const prevValue   = actor.system.stamina.value;
  const prevTemp    = actor.system.stamina.temporary;
  const squadGroup  = squadGroupOverride !== undefined ? squadGroupOverride : getSquadGroup(actor);
  const prevSquadHP = squadGroup?.system?.staminaValue ?? null;
  const members = squadGroup ? Array.from(squadGroup.members || []).filter(m => m) : [];
  const squadCombatantIds = members.map(m => m.id);
  const squadTokenIds     = members.map(m => m.tokenId).filter(Boolean);
  if (squadGroup && actor.isToken && actor.token?.id) {
    if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
    window._lastSquadDamagedTokenIds.add(actor.token.id);
    clearTimeout(window._lastSquadDamagedTokenIdsTimer);
    window._lastSquadDamagedTokenIdsTimer = setTimeout(() => { window._lastSquadDamagedTokenIds = null; }, 2000);
  }
  const qsSocket = getQuickStrikeSocket();
  if (qsSocket) {
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

// -- Elevation & Flying --

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

export const applyFall = async (token, targetElev = 0, { silent = true } = {}) => {
  const currentElev = token.document?.elevation ?? 0;
  if (currentElev <= targetElev) return { dmg: 0, fallDist: 0, effectiveFall: 0 };
  let dmg = 0, fallDist = 0, effectiveFall = 0;
  if (!canCurrentlyFly(token.actor)) {
    fallDist      = currentElev - targetElev;
    const agility = token.actor?.system?.characteristics?.agility?.value ?? 0;
    effectiveFall = Math.max(0, fallDist - agility);
    const cap     = getSetting('fallDamageCap');
    dmg = effectiveFall < 2 ? 0 : Math.min(effectiveFall * 2, cap);
    if (dmg > 0) await applyDamage(token.actor, dmg);
  }
  await safeUpdate(token.document, { elevation: targetElev }, { animate: false, teleport: true });
  if (!silent) {
    await ChatMessage.create({ content: buildFallMessage(token.name, fallDist, effectiveFall, dmg) });
  }
  return { dmg, fallDist, effectiveFall };
};

const buildFallMessage = (name, fallDist, effectiveFall, dmg) => {
  const distPart = `<strong>${name}</strong> falls <strong>${fallDist}</strong> square${fallDist !== 1 ? 's' : ''}`;
  if (effectiveFall === fallDist) {
    return dmg > 0
      ? `${distPart}, dealing <strong>${dmg}</strong> fall damage (${effectiveFall * 2} � � effective).`
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

// -- Item Helpers --


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

// -- Token & Window Utilities --


export const safeTeleport = async (tokenDoc, targetX, targetY) => {
  canvas.tokens.releaseAll();
  await safeUpdate(tokenDoc, { x: targetX, y: targetY }, { animate: false, teleport: true });
};

export const getTokenById = (id) =>
  canvas?.tokens?.get(id) ?? canvas?.tokens?.placeables?.find(t => t.id === id) ?? null;

export const getWindowById = (id) => Object.values(ui.windows).find(w => w.id === id) ?? null;

export const getModuleApi = (warn = true) => {
  const api = game.modules.get('draw-steel-combat-tools')?.api ?? null;
  if (!api && warn) ui.notifications.error('Draw Steel: Combat Tools not active.');
  return api;
};

export const normalizeCollection = (collection) => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Set) return [...collection];
  if (Array.isArray(collection.contents)) return collection.contents;
  return Object.values(collection);
};

// -- Canvas Pick Helper --


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

// -- Chat Message Injection --


const _injectors     = [];
const _pendingInjects = new Map();

export const registerInjector = (fn) => _injectors.push(fn);

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

// -- Power Roll Bane/Edge Helpers --


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