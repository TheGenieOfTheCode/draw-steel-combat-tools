import { getSetting, getItemDsid } from '../helpers.mjs';
import { getFrightenedData, getTauntedData, sightBlockedBetweenTokens } from '../conditions/conditions.mjs';
import { sizeRankG } from '../conditions/grab.mjs';
import { getStrikeType } from './crossfade.mjs';

let _pillIdCounter = 0;
const mkId = (s) => `dsct-p-${++_pillIdCounter}-${s}`;

function pill(id, kind, amount, reason, src, scope, dsNative = false) {
  return { id, kind, amount, reason, src, srcTokenId: null, srcAbility: null, scope, enabled: true, custom: false, dsNative };
}

function _pickFlankingAlly(casterToken, targetToken, allies) {
  if (allies.length <= 1) return allies[0] ?? null;
  const tcx = targetToken.center.x, tcy = targetToken.center.y;
  const dcx = casterToken.center.x - tcx, dcy = casterToken.center.y - tcy;
  let best = null, bestScore = -Infinity;
  for (const a of allies) {
    const score = (a.center.x - tcx) * (-dcx) + (a.center.y - tcy) * (-dcy);
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

function _hasHighGround(casterToken, targetToken) {
  const casterElev = casterToken.document.elevation ?? 0;
  const targetElev = targetToken.document.elevation ?? 0;
  const targetSize = targetToken.actor?.system?.combat?.size?.value ?? 1;
  if ((targetElev + targetSize) > casterElev) return false;

  
  
  
  
  const gridSize = canvas.grid.size;
  const gridX = Math.floor(casterToken.document.x / gridSize);
  const gridY = Math.floor(casterToken.document.y / gridSize);
  const terrainMap = canvas.scene?.getFlag('ds-terrain-designer', 'elevation-levels') ?? {};
  const terrainElev = terrainMap[`${gridX},${gridY}`] ?? 0;
  return casterElev === terrainElev;
}

function _buildGlobalPills(actor) {
  const pills = [];
  
  if (actor.statuses?.has('weakened'))   pills.push(pill(mkId('wk'), 'bane', 1, 'Weakened',   null, 'global', true));
  if (actor.statuses?.has('restrained')) pills.push(pill(mkId('rs'), 'bane', 1, 'Restrained', null, 'global', true));
  
  for (const eff of actor.appliedEffects ?? []) {
    if (eff.type !== 'abilityModifier') continue;
    for (const ch of eff.changes ?? []) {
      const amt = Math.abs(parseInt(ch.value) || 1);
      if (ch.key === 'power.roll.banes') pills.push(pill(mkId(`ae-b-${eff.id}`), 'bane', amt, eff.name, null, 'global', true));
      if (ch.key === 'power.roll.edges') pills.push(pill(mkId(`ae-e-${eff.id}`), 'edge', amt, eff.name, null, 'global', true));
    }
  }
  
  if (actor.statuses?.has('prone')) pills.push(pill(mkId('pr'), 'bane', 1, 'Prone', null, 'global', false));
  return pills;
}

function _buildNativeConditionTargetPills(actor, casterToken, targetActor, tokenId) {
  const pills = [];

  
  if (actor.statuses?.has('grabbed')) {
    const srcUuid = actor.system?.statuses?.grabbed?.sources?.first?.();
    const grabberActor = srcUuid ? fromUuidSync(srcUuid) : null;
    if (!grabberActor || grabberActor.uuid !== targetActor.uuid) {
      const grabberTok = grabberActor ? canvas.tokens.placeables.find(t => t.actor?.uuid === grabberActor.uuid) : null;
      const p = pill(mkId(`gr-${tokenId}`), 'bane', 1, 'Grabbed', grabberActor?.name ?? null, tokenId, true);
      p.srcTokenId = grabberTok?.id ?? null;
      pills.push(p);
    }
  }

  if (actor.statuses?.has('frightened')) {
    const srcUuid = actor.system?.statuses?.frightened?.sources?.first?.();
    if (srcUuid) {
      const srcActor = fromUuidSync(srcUuid);
      if (srcActor && srcActor.uuid === targetActor.uuid) {
        const p = pill(mkId(`fr-ca-${tokenId}`), 'bane', 1, 'Frightened', srcActor.name, tokenId, true);
        p.srcTokenId = tokenId;
        pills.push(p);
      }
    }
  }

  if (targetActor.statuses?.has('frightened') && casterToken) {
    const tSrcUuid = targetActor.system?.statuses?.frightened?.sources?.first?.();
    if (tSrcUuid) {
      const tSrcActor = fromUuidSync(tSrcUuid);
      if (tSrcActor && tSrcActor.uuid === actor.uuid) {
        const p = pill(mkId(`fr-ta-${tokenId}`), 'edge', 1, 'Target Frightened', actor.name, tokenId, true);
        p.srcTokenId = casterToken.id;
        pills.push(p);
      }
    }
  }

  
  if (actor.statuses?.has('taunted')) {
    const tntUuid = actor.system?.statuses?.taunted?.sources?.first?.();
    const tauntActor = tntUuid ? fromUuidSync(tntUuid) : null;
    if (!tauntActor || tauntActor.uuid !== targetActor.uuid) {
      const tauntTok = tauntActor ? canvas.tokens.placeables.find(t => t.actor?.uuid === tauntActor.uuid) : null;
      const p = pill(mkId(`ta-${tokenId}`), 'bane', 2, 'Taunted', tauntActor?.name ?? null, tokenId, true);
      p.srcTokenId = tauntTok?.id ?? null;
      pills.push(p);
    }
  }

  return pills;
}

function _buildTargetPills(app, tokenId) {
  const ability = app.options.ability;
  const actor   = ability.actor ?? ability.parent;
  const casterToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
                   ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  const targetToken = canvas.tokens.placeables.find(t => t.id === tokenId);
  const targetActor = targetToken?.actor;
  if (!targetToken || !targetActor) return [];

  const isMeleeStrike = ability.system?.keywords?.has('melee') && ability.system?.keywords?.has('strike');
  const pills = [];

  
  if (targetActor.statuses?.has('restrained'))
    pills.push(pill(mkId(`rst-${tokenId}`), 'edge', 1, 'Target Restrained', null, tokenId, true));
  if (targetActor.statuses?.has('surprised'))
    pills.push(pill(mkId(`sup-${tokenId}`), 'edge', 1, 'Target Surprised', null, tokenId, true));
  if (isMeleeStrike && casterToken && targetActor.system?.statuses?.flankable !== false && typeof casterToken.isFlanking === 'function' && casterToken.isFlanking(targetToken)) {
    const allies = casterToken.getAdjacentAllies?.(targetToken)?.filter(a => a !== targetToken && a.canFlank) ?? [];
    const flanker = _pickFlankingAlly(casterToken, targetToken, allies);
    const p = pill(mkId(`fl-${tokenId}`), 'edge', 1, 'Flanking', flanker?.name ?? null, tokenId, true);
    p.srcTokenId = flanker?.id ?? null;
    pills.push(p);
  }
  
  for (const eff of targetActor.appliedEffects ?? []) {
    for (const ch of eff.changes ?? []) {
      if (!ch.key?.startsWith('system.combat.targetModifiers.')) continue;
      const amt = Math.abs(parseInt(ch.value) || 1);
      if (ch.key.includes('.edges')) pills.push(pill(mkId(`ae-te-${eff.id}-${tokenId}`), 'edge', amt, eff.name, null, tokenId, true));
      if (ch.key.includes('.banes')) pills.push(pill(mkId(`ae-tb-${eff.id}-${tokenId}`), 'bane', amt, eff.name, null, tokenId, true));
    }
  }

  
  if (getSetting('grabEnabled') && casterToken) {
    const grab = window._activeGrabs?.get(casterToken.id);
    if (grab && grab.grabberTokenId !== tokenId && grab.grabberActorId !== targetActor.id) {
      const p = pill(mkId(`gr-${tokenId}`), 'bane', 1, 'Grabbed', grab.grabberName, tokenId, false);
      p.srcTokenId = grab.grabberTokenId;
      pills.push(p);
    }
  }
  if (getSetting('frightenedEnabled')) {
    const fd = getFrightenedData(actor);
    if (fd && fd.sourceTokenId === tokenId) {
      const srcName = game.actors.get(fd.sourceActorId)?.name ?? canvas.tokens.get(fd.sourceTokenId)?.name ?? null;
      const p = pill(mkId(`fr-ca-${tokenId}`), 'bane', 1, 'Frightened', srcName, tokenId, false);
      p.srcTokenId = fd.sourceTokenId ?? null;
      pills.push(p);
    }
  }
  if (getSetting('frightenedEnabled') && casterToken) {
    const tfd = getFrightenedData(targetActor);
    if (tfd && tfd.sourceTokenId === casterToken.id) {
      const p = pill(mkId(`fr-ta-${tokenId}`), 'edge', 1, 'Target Frightened', actor.name, tokenId, false);
      p.srcTokenId = casterToken.id;
      pills.push(p);
    }
  }
  
  if (!getSetting('conditionsEnabled') && casterToken)
    pills.push(..._buildNativeConditionTargetPills(actor, casterToken, targetActor, tokenId));

  
  
  
  if (getSetting('highGroundEnabled') && casterToken && _hasHighGround(casterToken, targetToken)) {
    const dstdActive = !!game.modules.get('ds-terrain-designer')?.active;
    pills.push(pill(mkId(`hg-${tokenId}`), 'edge', 1, 'High Ground', null, tokenId, dstdActive));
  }

  return pills;
}

function _buildModifierSources(app) {
  const ability = app.options.ability;
  if (!ability) return [];
  const actor = ability.actor ?? ability.parent;
  if (!actor) return [];
  const casterToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
                   ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  const targetEntries = Object.entries(app.options.context?.targets ?? {});

  const pills = [..._buildGlobalPills(actor)];

  if (getSetting('grabEnabled') && casterToken && getItemDsid(ability) === 'escape-grab') {
    const grab = window._activeGrabs?.get(casterToken.id);
    if (grab) {
      const grabberTok = canvas.tokens.placeables.find(t => t.id === grab.grabberTokenId);
      if (grabberTok) {
        const grabbedSize = actor.system?.combat?.size ?? { value: 1, letter: 'M' };
        const grabberSize = grabberTok.actor?.system?.combat?.size ?? { value: 1, letter: 'M' };
        if (sizeRankG(grabbedSize) < sizeRankG(grabberSize)) {
          const p = pill(mkId('gr-sz'), 'bane', 1, 'Size (Grabber larger)', grab.grabberName, 'global', false);
          p.srcTokenId = grab.grabberTokenId;
          pills.push(p);
        }
      }
    }
  }

  
  if (getSetting('tauntedEnabled') && casterToken) {
    const td = getTauntedData(actor);
    if (td) {
      const taunterIsTarget = targetEntries.some(([id]) => id === td.sourceTokenId);
      if (!taunterIsTarget) {
        const sourceTok = canvas.tokens.placeables.find(t => t.id === td.sourceTokenId);
        if (sourceTok && !sightBlockedBetweenTokens(casterToken, sourceTok)) {
          const srcName = game.actors.get(td.sourceActorId)?.name ?? sourceTok?.name ?? null;
          const p = pill(mkId('ta'), 'bane', 2, 'Taunted', srcName, 'global', false);
          p.srcTokenId = td.sourceTokenId ?? null;
          pills.push(p);
        }
      }
    }
  }

  
  if (casterToken && getStrikeType(ability) === 'ranged') {
    const casterDisp = casterToken.document.disposition;
    const adj = canvas.tokens.placeables.filter(t => {
      if (!t.actor || t.id === casterToken.id) return false;
      const d = t.document.disposition;
      return d !== CONST.TOKEN_DISPOSITIONS.NEUTRAL
        && casterDisp !== CONST.TOKEN_DISPOSITIONS.NEUTRAL
        && d !== casterDisp
        && typeof casterToken.isAdjacentTo === 'function' && casterToken.isAdjacentTo(t);
    });
    if (adj.length) {
      const p = pill(mkId('rng-adj'), 'bane', 1, 'Adjacent Enemy', adj[0].name, 'global', false);
      p.srcTokenId = adj[0].id;
      pills.push(p);
    }
  }

  for (const [tokenId] of targetEntries) pills.push(..._buildTargetPills(app, tokenId));
  return pills;
}

function _recomputeAndSync(app) {
  const ctx    = app.options.context;
  if (!ctx?.modifiers) return;
  const origG  = app._dsctOrigGlobal;
  const origTs = app._dsctOrigTargets;

  let gE = origG.edges ?? 0, gB = origG.banes ?? 0, gBo = origG.bonuses ?? 0;
  for (const p of app._dsctSources.filter(x => x.scope === 'global')) {
    if (p.dsNative) {
      if (!p.enabled) {
        if (p.kind === 'edge')        gE  -= p.amount;
        else if (p.kind === 'bane')   gB  -= p.amount;
        else if (p.kind === 'bonus')  gBo -= p.amount;
      }
    } else {
      if (p.enabled) {
        if (p.kind === 'edge')        gE  += p.amount;
        else if (p.kind === 'bane')   gB  += p.amount;
        else if (p.kind === 'bonus')  gBo += p.amount;
      }
    }
  }
  ctx.modifiers.edges   = Math.max(0, gE);
  ctx.modifiers.banes   = Math.max(0, gB);
  ctx.modifiers.bonuses = gBo;

  for (const [tokenId, target] of Object.entries(ctx.targets ?? {})) {
    const orig = origTs[tokenId] ?? { edges: 0, banes: 0, bonuses: 0 };
    let tE = orig.edges ?? 0, tB = orig.banes ?? 0, tBo = orig.bonuses ?? 0;
    for (const p of app._dsctSources.filter(x => x.scope === tokenId)) {
      if (p.dsNative) {
        if (!p.enabled) {
          if (p.kind === 'edge')        tE  -= p.amount;
          else if (p.kind === 'bane')   tB  -= p.amount;
          else if (p.kind === 'bonus')  tBo -= p.amount;
        }
      } else {
        if (p.enabled) {
          if (p.kind === 'edge')        tE  += p.amount;
          else if (p.kind === 'bane')   tB  += p.amount;
          else if (p.kind === 'bonus')  tBo += p.amount;
        }
      }
    }
    if (!target.modifiers) continue;
    target.modifiers.edges   = Math.max(0, tE);
    target.modifiers.banes   = Math.max(0, tB);
    target.modifiers.bonuses = tBo;
    
    if (target.combinedModifiers) {
      target.combinedModifiers.edges   = Math.max(0, Math.min(5, target.modifiers.edges   + ctx.modifiers.edges));
      target.combinedModifiers.banes   = Math.max(0, Math.min(5, target.modifiers.banes   + ctx.modifiers.banes));
      if ('bonuses' in target.combinedModifiers)
        target.combinedModifiers.bonuses = target.modifiers.bonuses + ctx.modifiers.bonuses;
    }
  }
}

function _totalClass(val, kind) {
  if (val === 0) return 'dsct-total-zero';
  return kind === 'edge' ? 'dsct-total-edge' : kind === 'bane' ? 'dsct-total-bane' : 'dsct-total-bonus';
}

function _pillHTML(p) {
  const isBonus   = p.kind === 'bonus';
  const kindLabel = p.kind === 'edge' ? 'Edge' : p.kind === 'bane' ? 'Bane' : (p.amount >= 0 ? 'Bonus' : 'Penalty');
  const sign      = isBonus ? (p.amount >= 0 ? '+' : '') : (p.amount >= 0 ? '+' : '');
  const plural    = !isBonus && Math.abs(p.amount) !== 1 ? 's' : '';
  const amtStr    = `${sign}${p.amount} ${kindLabel}${plural}`;
  const fromStr      = p.src ? `<span class="dsct-pill-from">from ${p.src}</span>` : '';
  const disClass     = p.enabled ? '' : ' dsct-pill-disabled';
  const custClass    = p.custom ? ' dsct-pill-custom' : '';
  const title        = p.custom ? 'Click to toggle · Right-click to remove' : (p.enabled ? 'Click to disable' : 'Click to enable');
  const srcTokenAttr = p.srcTokenId ? ` data-src-token-id="${p.srcTokenId}"` : '';
  return `<button type="button" class="dsct-source-pill dsct-pill-${p.kind}${disClass}${custClass}"${srcTokenAttr} data-pill-id="${p.id}" title="${title}"><span class="dsct-pip">${amtStr} &middot; ${p.reason}</span>${fromStr}</button>`;
}

function _injectPillUI(app) {
  const el  = app.element;
  const ctx = app.options.context;
  if (!el) return;

  
  el.classList.add('dsct-pill-ui-active');
  el.querySelectorAll('.dsct-rdp-pill-injection').forEach(e => e.remove());

  const globalGroup = el.querySelector('.global.group');
  if (globalGroup) {
    const fg = globalGroup.querySelector('.form-group.general');
    if (fg) {
      fg.querySelectorAll('select[name="modifiers.edges"], select[name="modifiers.banes"]').forEach(sel => {
        if (sel.dataset.dsctHidden) return;
        sel.dataset.dsctHidden = '1';
        sel.style.display = 'none';
        const isEdge = sel.name.endsWith('.edges');
        const val    = isEdge ? (ctx.modifiers.edges ?? 0) : (ctx.modifiers.banes ?? 0);
        const kind   = isEdge ? 'edge' : 'bane';
        const span   = document.createElement('div');
        span.className = `dsct-total-display ${_totalClass(val, kind)}`;
        span.dataset.dsctScope = 'global';
        span.dataset.dsctKind  = kind;
        span.textContent = String(Math.min(2, val));
        sel.after(span);
      });
      _updateTotalSpan(fg, 'global', 'edge', ctx.modifiers.edges ?? 0);
      _updateTotalSpan(fg, 'global', 'bane', ctx.modifiers.banes ?? 0);
      _updateTotalSpan(fg, 'global', 'bonus', ctx.modifiers.bonuses ?? 0);
      
      const bonusInput = fg.querySelector('input[name="modifiers.bonuses"]');
      if (bonusInput) {
        if (!bonusInput.dataset.dsctHidden) {
          bonusInput.dataset.dsctHidden = '1';
          bonusInput.style.display = 'none';
          const bonusVal = ctx.modifiers.bonuses ?? 0;
          const bonusSpan = document.createElement('div');
          bonusSpan.className = `dsct-total-display ${_totalClass(bonusVal, 'bonus')}`;
          bonusSpan.dataset.dsctScope = 'global';
          bonusSpan.dataset.dsctKind  = 'bonus';
          bonusSpan.textContent = bonusVal >= 0 ? `+${bonusVal}` : String(bonusVal);
          bonusInput.after(bonusSpan);
        }
        bonusInput.value = ctx.modifiers.bonuses ?? 0;
      }

      const globalPills = app._dsctSources.filter(p => p.scope === 'global');
      const row = document.createElement('div');
      row.className = 'dsct-mod-pills-row dsct-rdp-pill-injection';
      row.innerHTML = `<span class="dsct-pills-label">Global</span>${globalPills.map(_pillHTML).join('')}<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" data-scope="global" title="Add global modifier">+</button>`;
      fg.after(row);
    }
  }

  for (const targetDiv of el.querySelectorAll('.target.group')) {
    const tokenUuid = targetDiv.dataset.tokenUuid;
    const tokenId   = Object.keys(ctx.targets ?? {}).find(id => {
      const t = ctx.targets[id];
      return t?.tokenUuid === tokenUuid || t?.token?.uuid === tokenUuid;
    });
    if (!tokenId) continue;

    const target = ctx.targets[tokenId];
    const fg     = targetDiv.querySelector('.form-group');
    if (!fg) continue;

    const selEdge = fg.querySelector(`select[name="targets.${tokenId}.modifiers.edges"]`);
    const selBane = fg.querySelector(`select[name="targets.${tokenId}.modifiers.banes"]`);
    const combined = target?.combinedModifiers ?? { edges: 0, banes: 0 };

    for (const [sel, kind] of [[selEdge, 'edge'], [selBane, 'bane']]) {
      if (!sel) continue;
      if (!sel.dataset.dsctHidden) {
        sel.dataset.dsctHidden = '1';
        sel.style.display = 'none';
        const val  = kind === 'edge' ? combined.edges : combined.banes;
        const span = document.createElement('div');
        span.className = `dsct-total-display ${_totalClass(val, kind)}`;
        span.dataset.dsctScope = tokenId;
        span.dataset.dsctKind  = kind;
        span.textContent = String(Math.min(2, val));
        sel.after(span);
      }
    }
    fg.querySelectorAll('.total-edges, .total-banes, .total-bonuses').forEach(s => { s.style.display = 'none'; });
    _updateTotalSpan(fg, tokenId, 'edge', combined.edges);
    _updateTotalSpan(fg, tokenId, 'bane', combined.banes);
    const bonusInputT = fg.querySelector(`input[name="targets.${tokenId}.modifiers.bonuses"]`);
    if (bonusInputT) {
      if (!bonusInputT.dataset.dsctHidden) {
        bonusInputT.dataset.dsctHidden = '1';
        bonusInputT.style.display = 'none';
        const bv = target?.modifiers?.bonuses ?? 0;
        const bs = document.createElement('div');
        bs.className = `dsct-total-display ${_totalClass(bv, 'bonus')}`;
        bs.dataset.dsctScope = tokenId;
        bs.dataset.dsctKind  = 'bonus';
        bs.textContent = bv >= 0 ? `+${bv}` : String(bv);
        bonusInputT.after(bs);
      }
      bonusInputT.value = target?.modifiers?.bonuses ?? 0;
    }
    _updateTotalSpan(fg, tokenId, 'bonus', target?.modifiers?.bonuses ?? 0);

    const targetPills = app._dsctSources.filter(p => p.scope === tokenId);
    const row = document.createElement('div');
    row.className = 'dsct-mod-pills-row dsct-rdp-pill-injection';
    row.innerHTML = `<span class="dsct-pills-label">Target</span>${targetPills.map(_pillHTML).join('')}<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" data-scope="${tokenId}" title="Add modifier">+</button>`;
    fg.after(row);
  }

  if (app._dsctPillClickOff) app._dsctPillClickOff();

  const clickHandler = (e) => {
    const addBtn = e.target.closest('.dsct-add-mod-btn[data-scope]');
    if (addBtn) { new DSCTAddModifierDialog(app, addBtn.dataset.scope).render(true); return; }
    const btn = e.target.closest('.dsct-source-pill[data-pill-id]');
    if (!btn) return;
    const p = app._dsctSources?.find(x => x.id === btn.dataset.pillId);
    if (!p) return;
    p.enabled = !p.enabled;
    _recomputeAndSync(app);
    _injectPillUI(app);
  };

  el.addEventListener('click', clickHandler);

  const contextHandler = (e) => {
    const btn = e.target.closest('.dsct-source-pill[data-pill-id]');
    if (!btn) return;
    const p = app._dsctSources?.find(x => x.id === btn.dataset.pillId);
    if (!p?.custom) return;
    e.preventDefault();
    app._dsctSources = app._dsctSources.filter(x => x.id !== p.id);
    _recomputeAndSync(app);
    _injectPillUI(app);
  };

  el.addEventListener('contextmenu', contextHandler);

  
  
  
  for (const pillEl of el.querySelectorAll('.dsct-source-pill[data-src-token-id]')) {
    const token = canvas.tokens.placeables.find(t => t.id === pillEl.dataset.srcTokenId);
    if (!token) continue;
    pillEl.addEventListener('pointerenter', (e) => {
      if (!canvas.ready || !token._canHover(game.user, e) || !token.visible) return;
      app._dsctHighlightedToken?._onHoverOut(e);
      token._onHoverIn(e, { hoverOutOthers: true });
      app._dsctHighlightedToken = token;
    });
    pillEl.addEventListener('pointerleave', (e) => {
      token._onHoverOut(e);
      if (app._dsctHighlightedToken === token) app._dsctHighlightedToken = null;
    });
    pillEl.addEventListener('pointermove', (e) => e.stopPropagation());
  }

  app._dsctPillClickOff = () => {
    el.removeEventListener('click', clickHandler);
    el.removeEventListener('contextmenu', contextHandler);
    app._dsctHighlightedToken?._onHoverOut(null);
    app._dsctHighlightedToken = null;
  };
}

function _updateTotalSpan(fg, scope, kind, val) {
  const span = fg.querySelector(`.dsct-total-display[data-dsct-scope="${scope}"][data-dsct-kind="${kind}"]`);
  if (!span) return;
  const display = kind === 'bonus' ? (val >= 0 ? `+${val}` : String(val)) : String(Math.min(2, val));
  span.textContent = display;
  span.className   = `dsct-total-display ${_totalClass(val, kind)}`;
}

const M_ID = 'draw-steel-combat-tools';

class DSCTAddModifierDialog extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    classes: ['dsct-add-modifier-dialog'],
    window: { title: 'Add Modifier', resizable: false },
    position: { width: 360 },
  };

  static PARTS = {
    main: { template: `modules/${M_ID}/templates/add-modifier-form.hbs` },
  };

  constructor(parentApp, scope, options = {}) {
    super(options);
    this._parentApp = parentApp;
    this._scope     = scope;
    this._kind      = 'edge';
    this._negate    = false;
    this._amount    = 1;
  }

  async _prepareContext() {
    const targets = Object.entries(this._parentApp.options.context?.targets ?? {}).map(([id, t]) => ({
      id,
      name: t.token?.name ?? id,
    }));
    return { targets };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);

    
    
    
    this._amwRoot        = this.element.querySelector('.dsct-amw') ?? this.element;
    this._previewPill    = this._amwRoot.querySelector('.dsct-amw-preview-pill');
    this._reasonInput    = this._amwRoot.querySelector('.dsct-amw-reason-input');
    this._sourceInput    = this._amwRoot.querySelector('.dsct-amw-source-input');
    this._valueInput     = this._amwRoot.querySelector('.dsct-amw-value-input');
    this._valueGroup     = this._amwRoot.querySelector('.dsct-amw-value-group');
    this._typeButtons    = [...this._amwRoot.querySelectorAll('.dsct-amw-type-btn')];
    const scopeSel       = this._amwRoot.querySelector('.dsct-amw-scope-select');
    if (scopeSel) scopeSel.value = this._scope;

    this._syncValueField();

    if (!this._dsctListenersAttached) {
      this._dsctListenersAttached = true;
      this._amwRoot.addEventListener('click', (e) => {
        if (e.target.closest('.dsct-amw-cancel')) { this.close(); return; }
        if (e.target.closest('.dsct-amw-submit')) { this._submit(); return; }
        if (e.target.closest('.dsct-amw-target-fill')) {
          const t = game.user.targets.first();
          if (t && this._sourceInput) {
            this._sourceInput.value = t.name;
            this._updatePreview();
          }
        }
      });
    }

    for (const btn of this._typeButtons) {
      btn.addEventListener('click', () => {
        this._typeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._kind   = btn.dataset.kind;
        this._amount = Math.abs(parseInt(btn.dataset.amount)) || 1;
        this._negate = parseInt(btn.dataset.amount) < 0;
        this._syncValueField();
        this._updatePreview();
      });
    }

    this._reasonInput?.addEventListener('input', () => this._updatePreview());
    this._sourceInput?.addEventListener('input', () => this._updatePreview());
    this._valueInput?.addEventListener('input',  () => this._updatePreview());
    scopeSel?.addEventListener('change', (e) => { this._scope = e.target.value; this._updatePreview(); });

    this._updatePreview();
  }

  _syncValueField() {
    if (this._valueGroup) this._valueGroup.style.display = this._kind === 'bonus' ? '' : 'none';
  }

  _readValueAmount() {
    if (this._kind !== 'bonus') return this._negate ? -this._amount : this._amount;
    const raw = Math.abs(parseFloat(this._valueInput?.value) || 1);
    return this._negate ? -raw : raw;
  }

  _updatePreview() {
    const prev   = this._previewPill;
    const reason = this._reasonInput?.value?.trim() || '(custom)';
    const src       = this._sourceInput?.value?.trim() || null;
    const amount    = this._readValueAmount();
    const kindLabel = this._kind === 'edge' ? 'Edge' : this._kind === 'bane' ? 'Bane' : (amount >= 0 ? 'Bonus' : 'Penalty');
    const sign      = this._kind === 'bonus' ? (amount >= 0 ? '+' : '') : (amount >= 0 ? '+' : '');
    const plural    = this._kind !== 'bonus' && Math.abs(amount) !== 1 ? 's' : '';
    const amtStr    = `${sign}${amount} ${kindLabel}${plural}`;
    const fromStr   = src ? `<span class="dsct-pill-from">from ${src}</span>` : '';
    if (prev) {
      prev.className = `dsct-source-pill dsct-pill-${this._kind} dsct-pill-custom`;
      prev.innerHTML = `<span class="dsct-pip">${amtStr} &middot; ${reason}</span>${fromStr}`;
    }
  }

  _submit() {
    if (!this._parentApp?.rendered) { this.close(); return; }
    const reason   = this._reasonInput?.value?.trim() || 'Custom';
    const srcName  = this._sourceInput?.value?.trim() || null;
    const scope    = (this._amwRoot?.querySelector('.dsct-amw-scope-select') ?? this.element.querySelector('.dsct-amw-scope-select'))?.value ?? 'global';
    const amount   = this._readValueAmount();
    const srcToken = srcName ? canvas.tokens.placeables.find(t => t.name === srcName) : null;
    const p = pill(mkId('custom'), this._kind, amount, reason, srcName, scope, false);
    p.custom    = true;
    p.srcTokenId = srcToken?.id ?? null;
    this._parentApp._dsctSources.push(p);
    
    if (scope !== 'global' && !this._parentApp._dsctOrigTargets?.[scope]) {
      const t = this._parentApp.options.context.targets?.[scope];
      this._parentApp._dsctOrigTargets[scope] = { ...(t?.modifiers ?? { edges: 0, banes: 0, bonuses: 0 }) };
    }
    _recomputeAndSync(this._parentApp);
    _injectPillUI(this._parentApp);
    this.close();
  }
}

function _refreshTauntedPill(app) {
  if (!getSetting('tauntedEnabled')) return;
  const ability = app.options.ability;
  const actor   = ability?.actor ?? ability?.parent;
  if (!actor) return;
  const casterToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
                   ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  if (!casterToken) return;

  const prevTaunted = app._dsctSources.filter(p => p.scope === 'global' && p.reason === 'Taunted');
  app._dsctSources  = app._dsctSources.filter(p => !(p.scope === 'global' && p.reason === 'Taunted'));

  const td = getTauntedData(actor);
  if (!td) return;
  const targetEntries    = Object.entries(app.options.context?.targets ?? {});
  const taunterIsTarget  = targetEntries.some(([id, t]) => id === td.sourceTokenId || t?.actor?.id === td.sourceActorId);
  if (taunterIsTarget) return;

  const sourceTok = canvas.tokens.placeables.find(t => t.id === td.sourceTokenId);
  if (!sourceTok || sightBlockedBetweenTokens(casterToken, sourceTok)) return;

  const srcName = game.actors.get(td.sourceActorId)?.name ?? sourceTok?.name ?? null;
  const p = pill(mkId('ta'), 'bane', 2, 'Taunted', srcName, 'global', false);
  p.srcTokenId = td.sourceTokenId ?? null;
  if (prevTaunted[0]) p.enabled = prevTaunted[0].enabled; 
  app._dsctSources.push(p);
}

export function setBaneDialogLockWithOverlay(app, locked, reasons = []) {
  if (!app.element) return;
  if (!getSetting('rollDialogPillUI')) return;

  app._dsctBaneLocked      = locked;
  app._dsctBaneLockReasons = reasons;
  app.element.classList.toggle('dsct-locked', locked);

  app.element.querySelector('.dsct-lock-overlay')?.remove();

  if (locked) {
    const overlay = document.createElement('div');
    overlay.className = 'dsct-lock-overlay';
    const reasonsHTML = reasons.length
      ? reasons.map(r => `<div class="dsct-lock-reason-pill">${r}</div>`).join('')
      : '';
    overlay.innerHTML = `
      <div class="dsct-lock-overlay-card">
        <i class="dsct-lock-overlay-icon fa-solid fa-ban fa-lg"></i>
        <div class="dsct-lock-overlay-title">Roll Locked</div>
        ${reasonsHTML ? `<div class="dsct-lock-overlay-reasons">${reasonsHTML}</div>` : ''}
      </div>`;
    app.element.appendChild(overlay);
  }
}

export function injectJudgementBanePill(app) {
  if (!getSetting('rollDialogPillUI') || !app._dsctSources) return false;
  if (app._dsctJudgementBaneInjected) return true;
  app._dsctJudgementBaneInjected = true;

  const ability = app.options.ability;
  const actor   = ability?.actor ?? ability?.parent;
  const judgeEffect = actor?.effects?.find(e => e.getFlag('draw-steel-combat-tools', 'judgement')?.userId);
  let censorName = null;
  let srcTokenId    = null;
  if (judgeEffect) {
    const flag   = judgeEffect.getFlag('draw-steel-combat-tools', 'judgement');
    const cActor = (flag?.actorId ? game.actors.get(flag.actorId) : null)
                ?? game.users.get(flag?.userId)?.character;
    censorName = cActor?.name ?? null;
    srcTokenId    = flag?.actorId
      ? (canvas.tokens.placeables.find(t => t.actor?.id === flag.actorId)?.id ?? null)
      : null;
  }

  const p = pill(mkId('jg-bane'), 'bane', 1, 'Judgement', censorName, 'global', false);
  p.srcTokenId = srcTokenId;
  app._dsctSources.push(p);
  _recomputeAndSync(app);
  _injectPillUI(app);
  return true;
}

export function registerRollDialogPillHooks() {
  if (!getSetting('abilityAutomationEnabled')) return;

  
  
  
  
  
  if (game.modules.get('ds-terrain-designer')?.active) {
    setTimeout(() => {
      const AbilitySystem = CONFIG.Item.dataModels?.ability;
      if (!AbilitySystem?.prototype?.getTargetModifiers) return;
      const _prev = AbilitySystem.prototype.getTargetModifiers;
      AbilitySystem.prototype.getTargetModifiers = function(target) {
        const suppress = getSetting('rollDialogPillUI') && getSetting('highGroundEnabled');
        const origInfo = suppress ? ui.notifications?.info?.bind(ui.notifications) : null;
        if (origInfo) {
          ui.notifications.info = (msg, ...rest) => {
            if (typeof msg === 'string' && /high ground/i.test(msg)) return;
            return origInfo(msg, ...rest);
          };
        }
        try { return _prev.call(this, target); }
        finally { if (origInfo) ui.notifications.info = origInfo; }
      };
    }, 0);
  }

  Hooks.on('renderAbilityConfigurationDialog', (app) => {
    if (!getSetting('rollDialogPillUI')) return;
    const ability = app.options.ability;
    if (!ability) return;
    const actor = ability.actor ?? ability.parent;
    if (!actor) return;

    if (!app._dsctSources) {
      app._dsctOrigGlobal  = { ...(app.options.context.modifiers  ?? { edges: 0, banes: 0, bonuses: 0 }) };
      app._dsctOrigTargets = {};
      for (const [id, t] of Object.entries(app.options.context.targets ?? {})) {
        app._dsctOrigTargets[id] = { ...(t.modifiers ?? { edges: 0, banes: 0, bonuses: 0 }) };
      }
      app._dsctSources = _buildModifierSources(app);
      _recomputeAndSync(app);
    } else {
      const existingScopes = new Set(app._dsctSources.map(p => p.scope));
      for (const [tokenId, t] of Object.entries(app.options.context.targets ?? {})) {
        if (existingScopes.has(tokenId)) continue;
        app._dsctOrigTargets ??= {};
        app._dsctOrigTargets[tokenId] = { ...(t.modifiers ?? { edges: 0, banes: 0, bonuses: 0 }) };
        app._dsctSources.push(..._buildTargetPills(app, tokenId));
      }
      
      _refreshTauntedPill(app);
      _recomputeAndSync(app);
    }

    _injectPillUI(app);

    
    if (app._dsctBaneLocked) setBaneDialogLockWithOverlay(app, true, app._dsctBaneLockReasons ?? []);
  });

  Hooks.on('closeAbilityConfigurationDialog', (app) => {
    if (app._dsctPillClickOff) { app._dsctPillClickOff(); app._dsctPillClickOff = null; }
  });
}
