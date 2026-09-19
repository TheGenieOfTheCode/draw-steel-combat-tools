import { getSetting, getModuleApi, tokFootprintDist, hasSightToToken } from '../helpers.mjs';
import { hiddenFrom, isHiddenFrom, stealthActive, revealWithReason, setHiddenFrom, isObjectToken, markObjectFound } from './stealth.mjs';

const M = 'draw-steel-combat-tools';
const ABILITY_PART_ID = 'abilityUse'.padEnd(16, '0');
const FLAG = 'search';
const RANGE = 10;
const SHADOW = 'icons/svg/mystery-man-black.svg';

const L = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));
const trueHidden = () => !!getSetting('stealthTrueHidden');

const _skillTest = (actor, skill) => {
  const has = actor?.system?.skills?.value?.has?.(skill);
  if (!has) return { config: {}, dialog: {} };
  const mods = actor.system.skills?.modifiers?.[skill] ?? {};
  return {
    config: { bonuses: 2, edges: mods.edges ?? 0, banes: mods.banes ?? 0 },
    dialog: { context: { skill } },
  };
};

function _fromRoll(roll, characteristic = null) {
  if (!Number.isFinite(roll?.total)) return null;
  const net = Number(roll.netBoon ?? ((roll.options?.edges ?? 0) - (roll.options?.banes ?? 0)));
  const adjust = net >= 2 ? 4 : net <= -2 ? -4 : 0;

  const die = roll.dice?.[0] ?? roll.terms?.find(t => Number(t?.faces) === 10);
  const dice = (die?.results ?? []).filter(r => r.active !== false).map(r => Number(r.result) || 0);

  const chrLabel = characteristic ? L(ds.CONFIG.characteristics?.[characteristic]?.label ?? '') : '';
  const mods = [];
  let sign = 1;
  for (const term of roll.terms ?? []) {
    if (term instanceof foundry.dice.terms.OperatorTerm) { sign = term.operator === '-' ? -1 : 1; continue; }
    if (!(term instanceof foundry.dice.terms.NumericTerm)) continue;
    const value = sign * Number(term.number);
    if (!value) continue;
    mods.push({ value, label: term.options?.flavor || chrLabel });
  }
  if (adjust) mods.push({ value: adjust, label: L(adjust > 0 ? 'DSCT.search.doubleEdge' : 'DSCT.search.doubleBane') });

  return { total: roll.total + adjust, adjust, dice, mods };
}

async function _rollTest(actor, characteristic, skill) {
  const system = actor.system;
  const chr = system.characteristics?.[characteristic];
  const cfg = ds.CONFIG.characteristics?.[characteristic];
  if (!chr || !cfg) return null;

  const { config, dialog } = _skillTest(actor, skill);
  const baseFormula = chr.dice?.number > 2 ? `${chr.dice.number}d10${chr.dice.mode}2` : '2d10';
  const formula = `${baseFormula} + @${cfg.rollKey}`;
  const rollData = actor.getRollData();
  const modifiers = {
    edges: (config.edges ?? 0) + (chr.edges ?? 0),
    banes: (config.banes ?? 0) + (chr.banes ?? 0),
    bonuses: config.bonuses ?? 0,
  };
  if (actor.statuses.has('weakened')) modifiers.banes += 1;
  if (actor.statuses.has('restrained') && ['might', 'agility'].includes(characteristic)) modifiers.banes += 1;

  const flavor = game.i18n.format('DRAW_STEEL.ROLL.Power.TestDifficulty.label', { difficulty: '', characteristic: L(cfg.label) }).trim();
  const fd = await ds.applications.apps.PowerRollDialog.create(foundry.utils.mergeObject({
    context: {
      modifiers,
      formula: ds.rolls.PowerRoll.replaceFormulaData(formula, rollData, { missing: '0' }),
      skills: system.skills?.value ?? null,
      skillModifiers: system.skills?.modifiers ?? null,
    },
    window: { title: flavor },
  }, dialog));
  if (!fd) return null;

  const [rollOptions] = fd.rolls;
  rollOptions.skill = fd.skill;
  rollOptions.flavor = fd.skill ? `${flavor} — ${L(ds.CONFIG.skills.list[fd.skill]?.label ?? fd.skill)}` : flavor;
  const roll = new ds.rolls.PowerRoll(formula, rollData, rollOptions);
  await roll.evaluate();

  const result = _fromRoll(roll, characteristic);
  if (!result) return null;
  await _show3d(roll);
  return { ...result, rollJSON: roll.toJSON(), hero: actor.type === 'hero' };
}

async function _show3d(roll) {
  try { await game.dice3d?.showForRoll?.(roll, game.user, true); } catch {  }
}

const _canHeroReroll = (side, actor) =>
  !!side?.hero && side.total !== null && side.total !== undefined && !!side.rollJSON
  && (game.user.isGM || !!actor?.isOwner) && (game.actors?.heroTokens?.value ?? 0) > 0;

export async function spendHeroToken() {
  if (!game.user.isGM) return false;
  const value = game.actors?.heroTokens?.value ?? 0;
  if (value < 1) {
    ui.notifications.error('DRAW_STEEL.Setting.HeroTokens.NoHeroTokens', { localize: true });
    return false;
  }
  await game.settings.set('draw-steel', 'heroTokens', { value: value - 1 });
  return true;
}

async function _spendHeroToken() {
  if (game.user.isGM) return spendHeroToken();
  if ((game.actors?.heroTokens?.value ?? 0) < 1) {
    ui.notifications.error('DRAW_STEEL.Setting.HeroTokens.NoHeroTokens', { localize: true });
    return false;
  }
  const socket = getModuleApi(false)?.socket;
  if (!socket) return false;
  return !!(await socket.executeAsGM('dsct.spendHeroToken'));
}

export async function rerollSearch(message, tokenId = null) {
  const state = _state(message);
  if (!state) return;
  const side = tokenId ? state.rows.find(r => r.tokenId === tokenId) : state.searcher;
  const actor = canvas.tokens?.get(side?.tokenId)?.actor ?? null;
  if (!_canHeroReroll(side, actor)) return;

  if (!(await _spendHeroToken())) return;

  const base = foundry.dice.Roll.fromData(side.rollJSON);
  const fresh = await base.reroll();
  const result = _fromRoll(fresh, tokenId ? 'agility' : 'intuition');
  if (!result) return;
  await _show3d(fresh);

  Object.assign(side, result, { rollJSON: fresh.toJSON(), rerolls: (side.rerolls ?? 0) + 1 });

  if (!tokenId) {
    const searcher = canvas.tokens?.get(state.searcher.tokenId);
    if (searcher) {
      state.band = objectBand(state.searcher.total);
      const kept = new Map((state.objects ?? []).filter(r => r.status === 'found').map(r => [r.tokenId, r]));
      for (const row of _objectRowsFor(searcher, state.searcher.total)) {
        if (row.status === 'found') await markObjectFound(canvas.tokens.get(row.tokenId), [searcher.id]);
        if (!kept.has(row.tokenId)) kept.set(row.tokenId, row);
      }
      state.objects = [...kept.values()];
    }
  }

  await _reconcile(state);
  await _saveAs(message, state);
}

function _rollLine(side, { masked = false, hero = '' } = {}) {
  const esc = foundry.utils.escapeHTML;
  if (masked) {
    return `<span class="dsct-search-roll-line is-masked"><span class="dsct-search-roll-box"><span class="dsct-search-roll-total">?</span></span></span>`;
  }
  if (!side || side.total === null || side.total === undefined) return '';
  const dice = (side.dice ?? []).map(f => `<img class="dsct-die" src="modules/${M}/assets/Dice/die-${f}.png" alt="${f}">`).join('');
  const mods = (side.mods ?? []).map(m =>
    `<span class="dsct-die-mod" data-tooltip="${esc(m.label ?? '')}">${m.value > 0 ? '+' : '−'}${Math.abs(m.value)}</span>`).join('');
  const reroll = side.rerolls
    ? `<i class="fa-solid fa-rotate dsct-search-rerolled" data-tooltip="${esc(game.i18n.format('DSCT.search.rerolled', { n: side.rerolls }))}"></i>`
    : '';
  return `<span class="dsct-search-roll-line"><span class="dsct-search-roll-box"><span class="dsct-search-roll-formula dsct-dice-formula">${dice}${mods}</span><span class="dsct-search-roll-total">${side.total}${reroll}</span></span>${hero}</span>`;
}

const _heroBtn = (side, actor, tokenId) => (_canHeroReroll(side, actor)
  ? `<button type="button" class="dsct-search-hero" data-token-id="${foundry.utils.escapeHTML(tokenId ?? '')}" data-tooltip="${foundry.utils.escapeHTML(game.i18n.localize('DSCT.search.heroReroll'))}"><i class="fa-solid fa-medal"></i></button>`
  : '');

const _withinRange = (a, b) => tokFootprintDist(a, b) < RANGE * canvas.grid.distance;

const _allies = (searcher) =>
  canvas.tokens.placeables.filter(t => t.id !== searcher.id && t.actor
    && t.document.disposition === searcher.document.disposition && _withinRange(searcher, t));

const trueHiddenObjects = () => !!getSetting('stealthTrueHiddenObjects');

const OBJECT_BANDS = [{ max: 11, squares: 1 }, { max: 16, squares: 5 }, { max: Infinity, squares: 10 }];

export const objectBand = (total) => OBJECT_BANDS.find(b => total <= b.max).squares;

const _hiddenObjectsNear = (searcher) =>
  canvas.tokens.placeables.filter(t => t.id !== searcher.id && t.actor && isObjectToken(t)
    && hiddenFrom(t).has(searcher.id) && _withinRange(searcher, t));

function _objectRowsFor(searcher, total) {
  const squares = objectBand(total);
  return _hiddenObjectsNear(searcher).map((token) => {
    const inBand = tokFootprintDist(searcher, token) < squares * canvas.grid.distance;
    const found = inBand && hasSightToToken(searcher, token);
    return {
      tokenId: token.id, name: token.name, img: token.document.texture?.src ?? token.actor.img,
      kind: 'object', status: found ? 'found' : 'missed',
      playerOwned: !!token.actor.hasPlayerOwner, total: null,
    };
  });
}

function _rowsFor(searcher) {
  const rows = [];
  const allies = _allies(searcher);
  for (const token of canvas.tokens.placeables) {
    if (token.id === searcher.id || !token.actor || isObjectToken(token)) continue;
    const from = hiddenFrom(token);
    if (!from.size) continue;
    const base = {
      tokenId: token.id, name: token.name, img: token.document.texture?.src ?? token.actor.img, total: null,
      playerOwned: !!token.actor.hasPlayerOwner,
    };
    if (from.has(searcher.id)) {
      if (_withinRange(searcher, token) && hasSightToToken(searcher, token)) rows.push({ ...base, kind: 'contest', status: 'pending' });
    } else if (allies.some(a => from.has(a.id))) {
      rows.push({ ...base, kind: 'known', status: 'known' });
    }
  }
  return rows;
}

export async function runSearch(searcher, message = null) {
  if (!searcher?.actor) return;
  if (message?.getFlag?.(M, FLAG)) return;
  if (!stealthActive()) return ui.notifications.warn(L('DSCT.notice.stealth.outOfCombat'));
  if (!searcher.actor.isOwner) return ui.notifications.warn(L('DSCT.search.notOwner'));

  const rows = _rowsFor(searcher);

  const quietRoll = trueHidden() || trueHiddenObjects();
  if (!rows.length && !_hiddenObjectsNear(searcher).length && !quietRoll) {
    return ui.notifications.warn(L('DSCT.search.nobody', { name: searcher.name }));
  }

  const result = await _rollTest(searcher.actor, 'intuition', 'search');
  if (result === null) return;

  const objects = _objectRowsFor(searcher, result.total);
  for (const row of objects) {
    if (row.status !== 'found') continue;
    await markObjectFound(canvas.tokens.get(row.tokenId), [searcher.id]);
  }

  const state = {
    searcher: {
      tokenId: searcher.id, sceneId: canvas.scene.id, name: searcher.name, img: searcher.document.texture?.src ?? searcher.actor.img,
      total: result.total, adjust: result.adjust, dice: result.dice, mods: result.mods, rollJSON: result.rollJSON, hero: result.hero, rerolls: 0,
    },
    rows,
    objects,
    band: objectBand(result.total),
    complete: !rows.some(r => r.kind === 'contest'),
    pointedOut: false,
    pointedTo: [],
  };
  if (message) {
    await _saveAs(message, state);
    return;
  }
  await ChatMessage.create({
    content: `<div class="dsct-search-host"></div>`,
    speaker: ChatMessage.getSpeaker({ token: searcher.document }),
    flags: { [M]: { [FLAG]: state } },
  });
}

const _state = (message) => foundry.utils.deepClone(message?.getFlag(M, FLAG) ?? null);
const _save = (message, state) => message.update({ [`flags.${M}.${FLAG}`]: state });

async function _reconcile(state) {
  const searcher = canvas.tokens.get(state.searcher.tokenId);
  for (const row of state.rows) {
    if (row.kind !== 'contest' || row.status === 'pending') continue;
    const want = row.total !== null && state.searcher.total > row.total ? 'found' : 'hidden';
    if (want === row.status) continue;
    row.status = want;
    const hider = canvas.tokens.get(row.tokenId);
    if (!hider || !searcher) continue;
    if (want === 'found') await revealWithReason(hider, [searcher.id], 'search', searcher.name);
    else if (!isHiddenFrom(hider, searcher)) await setHiddenFrom(hider, [...hiddenFrom(hider), searcher.id]);
  }
}

export async function resolveSearch(messageId, tokenId) {
  const message = game.messages.get(messageId);
  const state = _state(message);
  if (!state || state.complete) return;
  const row = state.rows.find(r => r.tokenId === tokenId && r.kind === 'contest' && r.status === 'pending');
  if (!row) return;
  const hider = canvas.tokens.get(row.tokenId);
  if (!hider?.actor || !(game.user.isGM || hider.actor.isOwner)) return;

  const result = await _rollTest(hider.actor, 'agility', 'hide');
  if (result === null) return;

  row.total = result.total;
  row.adjust = result.adjust;
  row.dice = result.dice;
  row.mods = result.mods;
  row.rollJSON = result.rollJSON;
  row.hero = result.hero;
  row.rerolls = 0;
  row.status = 'hidden';
  await _reconcile(state);
  state.complete = !state.rows.some(r => r.kind === 'contest' && r.status === 'pending');
  await _saveAs(message, state);
}

async function _saveAs(message, state) {
  if (game.user.isGM || message.isAuthor) return _save(message, state);
  return getModuleApi(false)?.socket?.executeAsGM?.('dsct.updateDocument', message.uuid, { [`flags.${M}.${FLAG}`]: state });
}

export async function pointOut(messageId) {
  if (!game.user.isGM) return;
  const message = game.messages.get(messageId);
  const state = _state(message);
  if (!state?.complete || state.pointedOut) return;
  const searcher = canvas.tokens.get(state.searcher.tokenId);
  if (!searcher) return;

  const allies = _allies(searcher);
  const pointed = new Map();
  for (const row of state.rows) {
    if (!['found', 'known'].includes(row.status)) continue;
    const hider = canvas.tokens.get(row.tokenId);
    if (!hider) continue;
    const ids = allies.filter(a => isHiddenFrom(hider, a)).map(a => a.id);
    if (!ids.length) continue;
    await revealWithReason(hider, ids, 'pointedOut', searcher.name);
    for (const id of ids) pointed.set(id, canvas.tokens.get(id)?.name ?? id);
  }

  for (const row of state.objects ?? []) {
    if (row.status !== 'found') continue;
    const object = canvas.tokens.get(row.tokenId);
    if (!object) continue;
    const ids = allies.filter(a => isHiddenFrom(object, a)).map(a => a.id);
    if (!ids.length) continue;
    await markObjectFound(object, ids);
    for (const id of ids) pointed.set(id, canvas.tokens.get(id)?.name ?? id);
  }

  state.pointedOut = true;
  state.pointedTo = [...pointed].map(([tokenId, name]) => ({ tokenId, name }));
  await _save(message, state);
}

function _requestPointOut(message) {
  if (game.user.isGM) return pointOut(message.id);
  return getModuleApi(false)?.socket?.executeAsGM?.('dsct.searchPointOut', message.id);
}

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

const _nameHTML = (name, tokenId, cls = 'dsct-search-name') =>
  tokenId
    ? `<span class="${cls} dsct-search-link" data-token-id="${esc(tokenId)}" data-tooltip="${esc(L('DSCT.search.pingHint'))}">${esc(name)}</span>`
    : `<span class="${cls}">${esc(name)}</span>`;

const _isMasked = (row, redact) => redact && !row.playerOwned && ['pending', 'hidden', 'decoy'].includes(row.status);

function _rowHTML(row, redact) {
  const masked = _isMasked(row, redact);
  const img = masked ? SHADOW : row.img;
  const name = masked ? L('DSCT.search.unknown') : row.name;
  const actor = canvas.tokens?.get(row.tokenId)?.actor ?? null;
  const roll = row.kind === 'known' ? '' : _rollLine(row, { masked, hero: masked ? '' : _heroBtn(row, actor, row.tokenId) });
  const mayRoll = !masked && (game.user.isGM || !!actor?.isOwner);
  
  const outcome = masked ? `<i class="fa-solid fa-question"></i> ${esc(L('DSCT.search.unknownOutcome'))}` : {
    pending: mayRoll
      ? `<button type="button" class="dsct-search-roll-btn" data-token-id="${esc(row.tokenId)}"><i class="fa-solid fa-dice-d10"></i> ${esc(L('DSCT.search.roll'))}</button>`
      : `<i class="fa-solid fa-hourglass-half"></i> ${esc(L('DSCT.search.rolling'))}`,
    found: `<i class="fa-solid fa-eye"></i> ${esc(L('DSCT.search.found'))}`,
    hidden: `<i class="fa-solid fa-eye-slash"></i> ${esc(L('DSCT.search.stillHidden'))}`,
    known: `<i class="fa-solid fa-location-crosshairs"></i> ${esc(L('DSCT.search.known'))}`,
  }[row.status] ?? '';
  return `<div class="dsct-search-row is-${masked ? 'masked' : row.status}${masked ? ' is-masked' : ''}">
    <img class="dsct-search-art" src="${esc(img)}" alt="">
    ${_nameHTML(name, masked ? null : row.tokenId)}
    ${roll}
    <span class="dsct-search-outcome">${outcome}</span>
  </div>`;
}

function _objectRowHTML(row) {
  const masked = row.status === 'decoy';
  const outcome = masked
    ? `<i class="fa-solid fa-question"></i> ${esc(L('DSCT.search.unknownOutcome'))}`
    : row.status === 'found'
      ? `<i class="fa-solid fa-eye"></i> ${esc(L('DSCT.search.objectFound'))}`
      : `<i class="fa-solid fa-eye-slash"></i> ${esc(L('DSCT.search.objectMissed'))}`;
  return `<div class="dsct-search-row is-${row.status}${masked ? ' is-masked' : ''}">
    <img class="dsct-search-art" src="${esc(masked ? SHADOW : row.img)}" alt="">
    ${_nameHTML(masked ? L('DSCT.search.unknownObject') : row.name, masked ? null : row.tokenId)}
    <span class="dsct-search-outcome">${outcome}</span>
  </div>`;
}

const _openState = new Map();

function _section(label, rows, badge, open, { locked = false, key = null } = {}) {
  if (!rows.length) return '';
  const cls = `dsct-search-section${locked ? ' is-locked' : ''}`;
  return `<details class="${cls}"${open && !locked ? ' open' : ''}${key ? ` data-section="${esc(key)}"` : ''}>
    <summary class="dsct-search-section-hdr">
      <i class="fa-solid ${locked ? 'fa-lock' : 'fa-chevron-right dsct-search-chevron'}"></i>
      <span class="dsct-search-section-label">${esc(label)}</span>
      <span class="dsct-search-badge">${esc(badge)}</span>
    </summary>
    <div class="dsct-search-rows">${rows.join('')}</div>
  </details>`;
}

function _cardHTML(state, message) {
  const redact = !game.user.isGM && trueHidden();
  let contest = state.rows.filter(r => r.kind === 'contest');
  const known = state.rows.filter(r => r.kind === 'known');
  const found = contest.filter(r => r.status === 'found').length;
  const pending = contest.some(r => r.status === 'pending');

  
  
  
  const locked = redact && (!state.complete || found === 0);
  if (redact) {
    contest = [
      ...contest.filter(r => r.status === 'found' || (r.playerOwned && r.kind === 'contest')),
      { tokenId: null, name: '', img: SHADOW, kind: 'contest', status: 'decoy', playerOwned: false, total: null },
    ];
  }
  const sectionKey = `${message?.id ?? ''}:hidden`;
  const contestOpen = redact ? (_openState.get(sectionKey) ?? true) : true;

  const contestBadge = locked
    ? L('DSCT.search.badgeLocked')
    : redact
      ? L('DSCT.search.badgeFoundOnly', { found })
      : pending
      ? L('DSCT.search.badgePending', { done: contest.length - contest.filter(r => r.status === 'pending').length, total: contest.length })
      : L('DSCT.search.badgeFound', { found, total: contest.length });

  const allObjects = state.objects ?? [];
  const objectsFound = allObjects.filter(r => r.status === 'found').length;
  const redactObjects = !game.user.isGM && trueHiddenObjects();

  const objects = redactObjects
    ? [...allObjects.filter(r => r.status === 'found'),
       { tokenId: null, name: '', img: SHADOW, kind: 'object', status: 'decoy' }]
    : allObjects;

  const objectsLocked = redactObjects && objectsFound === 0;
  const objectKey = `${message?.id ?? ''}:objects`;
  const objectsOpen = redactObjects ? (_openState.get(objectKey) ?? true) : true;
  const objectBadge = objectsLocked
    ? L('DSCT.search.badgeLocked')
    : redactObjects
      ? L('DSCT.search.badgeFoundOnly', { found: objectsFound })
      : L('DSCT.search.badgeObjects', { found: objectsFound, total: allObjects.length, squares: state.band ?? 1 });

  const pointable = state.rows.some(r => ['found', 'known'].includes(r.status)) || objectsFound > 0;
  const canPoint = state.complete && !state.pointedOut && pointable
    && (game.user.isGM || !!canvas.tokens?.get(state.searcher.tokenId)?.actor?.isOwner);

  let foot;
  if (state.pointedOut) {
    const names = (state.pointedTo ?? []).map(p => typeof p === 'string' ? esc(p) : _nameHTML(p.name, p.tokenId, 'dsct-search-ally')).join(', ');
    foot = `<span class="dsct-search-status"><i class="fa-solid fa-bullhorn"></i> ${names ? L('DSCT.search.pointedTo', { names }) : esc(L('DSCT.search.pointedNone'))}</span>`;
  } else if (redact) {
    
    
    foot = canPoint
      ? `<button type="button" class="dsct-search-point"><i class="fa-solid fa-bullhorn"></i> ${esc(L('DSCT.search.pointOut'))}</button>`
      : `<span class="dsct-search-status"><i class="fa-solid fa-wind"></i> ${esc(L('DSCT.search.quiet'))}</span>`;
  } else if (!state.complete) {
    foot = `<span class="dsct-search-status"><i class="fa-solid fa-hourglass-half"></i> ${esc(L(game.user.isGM ? 'DSCT.search.awaitingGM' : 'DSCT.search.awaiting'))}</span>`;
  } else if (!state.rows.length && !allObjects.length) {
    foot = `<span class="dsct-search-status"><i class="fa-solid fa-wind"></i> ${esc(L('DSCT.search.nothing'))}</span>`;
  } else {
    foot = `<button type="button" class="dsct-search-point" ${canPoint ? '' : 'disabled'}><i class="fa-solid fa-bullhorn"></i> ${esc(L('DSCT.search.pointOut'))}</button>`;
  }

  return `<div class="dsct-search-card">
    <div class="dsct-search-header">
      <div class="dsct-search-header-text">
        <strong><i class="fa-solid fa-magnifying-glass"></i> ${esc(L('DSCT.search.title'))}</strong>
        <span>${_nameHTML(state.searcher.name, state.searcher.tokenId, 'dsct-search-searcher-name')} · ${esc(L('DSCT.search.testLabel'))}</span>
      </div>
      ${_rollLine(state.searcher, { hero: _heroBtn(state.searcher, canvas.tokens?.get(state.searcher.tokenId)?.actor ?? null, null) })}
    </div>
    ${_section(L('DSCT.search.sectionHidden'), contest.map(r => _rowHTML(r, redact)), contestBadge, contestOpen, { locked, key: sectionKey })}
    ${_section(L('DSCT.search.sectionObjects'), objects.map(_objectRowHTML), objectBadge, objectsOpen, { locked: objectsLocked, key: objectKey })}
    ${_section(L('DSCT.search.sectionKnown'), known.map(r => _rowHTML(r, redact)), String(known.length), false)}
    <footer class="dsct-search-foot">${foot}</footer>
  </div>`;
}

function _installCardHook() {
  
  
  Hooks.on('canvasReady', () => {
    for (const message of game.messages?.contents ?? []) {
      if (message.getFlag(M, FLAG)) ui.chat?.updateMessage?.(message);
    }
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    const state = message.getFlag(M, FLAG);
    if (!state) return;
    try { _renderCard(message, html, state); }
    catch (err) { console.warn('DSCT | search card |', err); }
  });
}

function _renderCard(message, html, state) {
  {
    
    
    const content = html.querySelector('.message-content') ?? html;
    content.querySelector(':scope > .dsct-search-card, :scope > .dsct-search-part')?.remove();
    const card = _cardHTML(state, message);
    content.insertAdjacentHTML('beforeend', content === html ? `<section class="dsct-search-part">${card}</section>` : card);
    for (const details of content.querySelectorAll('details.dsct-search-section[data-section]')) {
      if (details.classList.contains('is-locked')) {
        details.querySelector('summary')?.addEventListener('click', (ev) => ev.preventDefault());
        continue;
      }
      details.addEventListener('toggle', () => _openState.set(details.dataset.section, details.open));
    }
    content.querySelector('.dsct-search-point')?.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      await _requestPointOut(message);
    });
    for (const btn of content.querySelectorAll('.dsct-search-hero')) {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        btn.disabled = true;
        try { await rerollSearch(message, btn.dataset.tokenId || null); }
        catch (err) { console.warn('DSCT | search reroll |', err); }
        finally { btn.disabled = false; }
      });
    }
    for (const btn of content.querySelectorAll('.dsct-search-roll-btn')) {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        btn.disabled = true;
        try { await resolveSearch(message.id, btn.dataset.tokenId); }
        finally { btn.disabled = false; }
      });
    }
    for (const link of content.querySelectorAll('.dsct-search-link')) {
      link.addEventListener('mouseenter', (ev) => {
        const token = canvas.tokens?.get(link.dataset.tokenId);
        if (token?.visible && token._canHover?.(game.user, ev)) token._onHoverIn(ev, { hoverOutOthers: true });
      });
      link.addEventListener('mouseleave', (ev) => canvas.tokens?.get(link.dataset.tokenId)?._onHoverOut(ev));
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        const token = canvas.tokens?.get(link.dataset.tokenId);
        if (!token) return;

        const types = CONFIG.Canvas.pings.types;
        const pull = ev.shiftKey;
        canvas.ping(token.center, { style: pull ? types.PULL : types.PULSE, pull });
      });
    }
  }
}

function _installSearchButton() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!getSetting('stealthSystemEnabled')) return;
    const part = message.system?.parts?.get?.(ABILITY_PART_ID);
    if (!part?.abilityUuid) return;
    const item = fromUuidSync(part.abilityUuid);
    if (item?.system?._dsid !== 'dsct-search') return;
    if (message.getFlag(M, FLAG)) return;

    const section = html.querySelector(`section[data-message-part="${ABILITY_PART_ID}"]`);
    if (!section || section.querySelector('.dsct-search-btn')) return;
    let footer = section.querySelector('footer.message-part-buttons');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'message-part-buttons';
      section.appendChild(footer);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-search-btn';
    btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> ${esc(L('DSCT.search.button'))}`;
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const token = canvas.tokens?.get(message.speaker?.token) ?? item.actor?.getActiveTokens?.()?.[0] ?? null;
      if (!token) return ui.notifications.warn(L('DSCT.HideEffect.noToken'));
      btn.disabled = true;
      try { await runSearch(token, message); }
      catch (err) { console.warn('DSCT | search |', err); }
      finally { btn.disabled = false; }
    });
    footer.appendChild(btn);
  });
}

export function registerSearch() {
  _installSearchButton();
  _installCardHook();
}
