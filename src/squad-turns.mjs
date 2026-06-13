import { getSetting } from './helpers.mjs';

const _priorGroupInitiative = new Map();
let _squadBatchInProgress = false;
const _activatedGroupIds = new Set();

let _glowTicker = null;
let _glowTime = 0;
const _glowTargets = new Set();

window._dsctActiveSquadGroupId   = window._dsctActiveSquadGroupId   ?? null;
window._dsctActivatingGroupId    = window._dsctActivatingGroupId    ?? null;

function getSquadGroup(combatant) {
  const g = combatant?.group;
  if (!g) return null;
  if (g.type === 'squad') return g;
  if (g.type === 'base' && g.members.size > 1) return g;
  return null;
}

function getGroupBaseName(name) {
  const m = name?.match(/^(.*\d+)[A-Za-z]+\s*$/);
  return m ? m[1].trim() : null;
}

function findSiblingGroups(combat, group) {
  const base = getGroupBaseName(group.name);
  if (!base) return [];
  return [...(combat.groups ?? [])].filter(g =>
    g !== group &&
    (g.type === 'squad' || (g.type === 'base' && g.members.size > 1)) &&
    getGroupBaseName(g.name) === base
  );
}

async function fireStartTurn(member, combat) {
  const idx = combat.turns.findIndex(c => c === member);
  if (idx < 0) return;
  await member.actor?.system?._onStartTurn?.(member);
  const ctx = { round: combat.round, turn: idx, skipped: false };
  const combatProxy = Object.create(combat, {
    combatant: { get: () => member, configurable: true }
  });
  await foundry.documents.ActiveEffect.registry.refresh('turnStart', { ...ctx, combat: combatProxy });
  const tok = member.token;
  if (!tok) return;
  await Promise.allSettled(
    [...(tok.regions ?? [])].map(r =>
      r._triggerEvent(CONST.REGION_EVENTS.TOKEN_TURN_START, { token: tok, combatant: member, combat, ...ctx })
    )
  );
}

async function fireEndTurn(member, combat, round) {
  const idx = combat.turns.findIndex(c => c === member);
  if (idx < 0) return;
  const ctx = { round, turn: idx, skipped: false };
  await combat._onEndTurn(member, ctx);
  const combatProxy = Object.create(combat, {
    previous: { value: { ...combat.previous, combatantId: member.id }, configurable: true }
  });
  await foundry.documents.ActiveEffect.registry.refresh('turnEnd', { ...ctx, combat: combatProxy });
  if (game.users.activeGM?.isSelf) {
    const expiryAction = CONFIG.ActiveEffect.expiryAction ?? 'delete';
    for (const effect of [...(member.actor?.appliedEffects ?? [])]) {
      if (effect.duration.expiry !== 'turnEnd') continue;
      const rem = effect.duration.remaining;
      if (rem != null && rem > 0 && Number.isFinite(rem)) continue;
      if (expiryAction === 'delete') await effect.delete().catch(() => {});
      else await effect.update({ disabled: true }).catch(() => {});
    }
  }
  const tok = member.token;
  if (!tok) return;
  await Promise.allSettled(
    [...(tok.regions ?? [])].map(r =>
      r._triggerEvent(CONST.REGION_EVENTS.TOKEN_TURN_END, { token: tok, combatant: member, combat, ...ctx })
    )
  );
}

async function activateSquadMembers(group, combat, skipMember) {
  const membersToActivate = [...group.members].filter(m => m !== skipMember && m.initiative > 0);
  if (!membersToActivate.length) return;
  for (const member of membersToActivate) {
    await fireStartTurn(member, combat);
  }
}

function refreshSquadMarkers(group, primaryToken) {
  if (!group) return;
  primaryToken?._refreshTurnMarker?.();
  for (const member of group.members) {
    if (member.tokenId === primaryToken?.id) continue;
    member.token?.object?._refreshTurnMarker?.();
  }
}

function _cleanupMarkerWrapper(token) {
  if (token._dsctGlowGraphic) {
    _glowTargets.delete(token._dsctGlowGraphic);
    token.removeChild?.(token._dsctGlowGraphic);
    try { token._dsctGlowGraphic.destroy(); } catch {}
    token._dsctGlowGraphic = null;
    if (_glowTargets.size === 0 && _glowTicker) {
      canvas.app.ticker.remove(_glowTicker);
      _glowTicker = null;
    }
  }
  if (token._dsctMarkerWrapper) {
    canvas.tokens?.removeChild(token._dsctMarkerWrapper);
    token._dsctMarkerWrapper.destroy({ children: true });
    token._dsctMarkerWrapper = null;
    token.turnMarker = null;
    canvas.tokens?.turnMarkers?.delete(token);
  } else if (token.turnMarker) {
    canvas.tokens?.turnMarkers?.delete(token);
    try { token.turnMarker.destroy(); } catch {}
    token.turnMarker = null;
  }
}

const _GLOW_TINTS = {
  1: 0xff4444, 2: 0x4488ff, 3: 0x44dd44,  4: 0xffcc00,
  5: 0xff44ff, 6: 0x44ffff, 7: 0xff8800,  8: 0xaa44ff,
  9: 0x00ff88, 10: 0xff88aa,
};

function _resolveGlowColor(combatant, groupId) {
  if (!getSetting('squadGlowMarkerColored')) return 0xffffff;
  const playerUser = game.users?.find(u => u.character?.id === combatant?.actor?.id);
  if (playerUser) return Number(playerUser.color.valueOf?.() ?? playerUser.color);
  const grp = game.combat?.groups?.get(groupId);
  const num = parseInt(grp?.name?.match(/^Group (\d+)/i)?.[1]) || 0;
  return _GLOW_TINTS[num] ?? 0xffffff;
}

function _makeGlowGraphic(token, color = 0xffffff) {
  const gs = canvas.grid.size;
  const tw = (token.document.width  ?? 1) * gs;
  const th = (token.document.height ?? 1) * gs;
  const r  = Math.max(tw, th) / 2 + gs * 0.12;
  const gfx = new PIXI.Graphics();
  gfx.beginFill(color, 1);
  gfx.drawCircle(tw / 2, th / 2, r);
  gfx.endFill();
  gfx.filters = [new PIXI.BlurFilter(gs * 0.18)];
  gfx.alpha = 0.3;
  if (!_glowTicker) {
    _glowTicker = () => {
      _glowTime += canvas.app.ticker.deltaMS / 1000;
      const a = 0.25 + 0.2 * Math.sin(_glowTime * Math.PI * 1.5);
      for (const g of _glowTargets) g.alpha = a;
    };
    canvas.app.ticker.add(_glowTicker);
  }
  _glowTargets.add(gfx);
  return gfx;
}

function _patchCombatDock() {
  if (!game.modules.get('draw-steel-combat-tracker')?.active) return;
  const dock = ui.dsCombatDock;
  if (!dock) return;
  const proto = Object.getPrototypeOf(dock);
  if (!proto || proto._dsctSquadPatch) return;

  const origGetEntries = proto._getEntries;
  proto._getEntries = function() {
    const entries = origGetEntries.call(this);
    if (!getSetting('squadSimultaneousTurns')) return entries;
    for (const entry of entries) {
      if (!entry.isGroup) continue;
      const group = this.combat?.groups?.get(entry.id);
      if (group?.type !== 'squad' && !(group?.type === 'base' && group?.members?.size > 1)) continue;
      const groupCanAct = group.initiative > 0;
      for (const m of [entry.captainData, ...(entry.nonMinionMembers ?? []), ...(entry.minionGroups ?? []).flat()].filter(Boolean)) {
        m.canAct = groupCanAct;
      }
    }
    return entries;
  };

  const origMiniClick = proto._onMiniPortraitClick;
  proto._onMiniPortraitClick = function(event, el) {
    if (!getSetting('squadSimultaneousTurns')) return origMiniClick.call(this, event, el);
    const combatant = this.combat?.combatants?.get(el.dataset.memberId);
    const cg = combatant?.group;
    if (cg?.type === 'squad' || (cg?.type === 'base' && cg?.members?.size > 1)) {
      return this._onGroupPillClick(event, { dataset: { id: combatant.group.id } });
    }
    return origMiniClick.call(this, event, el);
  };

  proto._dsctSquadPatch = true;
  dock.render();
}

export function registerSquadTurnHooks() {
  Hooks.on('combatRoundChange', () => _activatedGroupIds.clear());
  Hooks.on('deleteCombat', () => {
    _activatedGroupIds.clear();
    window._dsctActiveSquadGroupId  = null;
    window._dsctActivatingGroupId   = null;
    if (_glowTicker) { canvas.app.ticker.remove(_glowTicker); _glowTicker = null; }
    _glowTargets.clear();
    _glowTime = 0;
  });

  Hooks.on('ready', () => {
    _patchCombatDock();
    if (game.combat) ui.combat?.render();
  });
  Hooks.on('combatStart', _patchCombatDock);

  Hooks.on('canvasReady', () => {
    if (!getSetting('squadGlowMarker') && !getSetting('squadSimultaneousTurns')) return;
    const activeCombatant = game.combat?.combatant;
    if (!activeCombatant) return;
    const activeGroup = getSquadGroup(activeCombatant);
    if (activeGroup) {
      window._dsctActiveSquadGroupId = activeGroup.id;
      for (const member of activeGroup.members) {
        member.token?.object?._refreshTurnMarker?.();
      }
    } else {
      activeCombatant.token?.object?._refreshTurnMarker?.();
    }
  });

  Hooks.on('renderCombatTracker', (_app, html) => {
    if (!getSetting('squadSimultaneousTurns')) return;
    const el = html instanceof HTMLElement ? html : html[0];
    if (!el) return;
    for (const group of (game.combat?.groups ?? [])) {
      if (group.type !== 'squad' && !(group.type === 'base' && group.members.size > 1)) continue;
      const groupEl = el.querySelector(`.combatant-group[data-group-id="${group.id}"]`);
      if (!groupEl) continue;
      for (const initDiv of groupEl.querySelectorAll('.group-turns .token-initiative')) {
        initDiv.style.display = 'none';
      }
    }
  });

  Hooks.on('preUpdateCombatantGroup', (group, changes) => {
    if (_squadBatchInProgress) return;
    if ('initiative' in changes) _priorGroupInitiative.set(group.id, group.initiative);
  });

  Hooks.on('updateCombatantGroup', async (group, changes) => {
    if (!getSetting('squadSimultaneousTurns')) return;
    if (!game.user.isGM) return;
    if (_squadBatchInProgress) return;
    if (!('initiative' in changes)) return;
    if (group.type !== 'squad' && !(group.type === 'base' && group.members.size > 1)) return;

    const oldInit = _priorGroupInitiative.get(group.id);
    _priorGroupInitiative.delete(group.id);
    if (oldInit == null || oldInit <= 0 || changes.initiative >= oldInit) return;

    const combat = group.parent;
    if (!combat) return;

    window._dsctActivatingGroupId = group.id;
    _squadBatchInProgress = true;
    _activatedGroupIds.add(group.id);
    try {
      await activateSquadMembers(group, combat, null);

      for (const sibGroup of findSiblingGroups(combat, group)) {
        if (!(sibGroup.initiative > 0)) continue;
        _activatedGroupIds.add(sibGroup.id);
        await activateSquadMembers(sibGroup, combat, null);
        await sibGroup.update({ initiative: sibGroup.initiative - 1 });
      }
    } finally {
      window._dsctActivatingGroupId = null;
      _squadBatchInProgress = false;
    }
  });

  Hooks.on('updateCombatant', async (combatant, changes, options) => {
    if (!getSetting('squadSimultaneousTurns')) return;
    if (!game.user.isGM) return;
    if (!('initiative' in changes)) return;
    if (options?._dsctSquadBatch) return;
    if (_squadBatchInProgress) return;

    const group = getSquadGroup(combatant);
    if (!group || !(group.initiative > 0)) return;
    if (_activatedGroupIds.has(group.id)) return;

    const combat = combatant.parent;
    if (!combat) return;

    window._dsctActivatingGroupId = group.id;
    _squadBatchInProgress = true;
    _activatedGroupIds.add(group.id);
    try {
      await activateSquadMembers(group, combat, combatant);
      await group.update({ initiative: group.initiative - 1 });
      for (const sibGroup of findSiblingGroups(combat, group)) {
        if (!(sibGroup.initiative > 0)) continue;
        _activatedGroupIds.add(sibGroup.id);
        await activateSquadMembers(sibGroup, combat, null);
        await sibGroup.update({ initiative: sibGroup.initiative - 1 });
      }
    } finally {
      window._dsctActivatingGroupId = null;
      _squadBatchInProgress = false;
    }
  });

  Hooks.on('combatTurnChange', async (combat, previous, current) => {
    if (!getSetting('squadSimultaneousTurns')) return;
    if (!game.user.isGM) return;

    const prev = combat.combatants.get(previous?.combatantId);
    const prevGroup = getSquadGroup(prev);
    const cur  = combat.combatants.get(current?.combatantId);
    const curGroup  = getSquadGroup(cur);

    if (window._dsctActivatingGroupId && curGroup?.id !== window._dsctActivatingGroupId) {
      return;
    }

    if (curGroup) {
      window._dsctActiveSquadGroupId = curGroup.id;
      const primaryToken = cur?.token?.object ?? canvas.tokens?.get(cur?.tokenId);
      refreshSquadMarkers(curGroup, primaryToken);
    } else if (!current?.combatantId) {
      window._dsctActiveSquadGroupId = null;
    }

    if (prevGroup && cur?.group?.id !== prev?.group?.id) {
      refreshSquadMarkers(prevGroup, null);
      for (const sibling of prevGroup.members) {
        await fireEndTurn(sibling, combat, previous.round);
      }
    }
  });

  if (typeof libWrapper !== 'undefined') {
    libWrapper.register('draw-steel-combat-tools', 'Token.prototype._refreshPosition', function(wrapped, ...args) {
      wrapped(...args);
      if (this._dsctMarkerWrapper) {
        const { x, y } = this.document;
        this._dsctMarkerWrapper.position.set(x, y);
      }
    }, 'WRAPPER');
  }

  if (typeof libWrapper !== 'undefined') {
    libWrapper.register('draw-steel-combat-tools', 'Token.prototype._refreshTurnMarker', function(wrapped, ...args) {
      if (!game.combat) {
        _cleanupMarkerWrapper(this);
        return wrapped(...args);
      }
      const myCombatant    = game.combat?.combatants?.find(c => c.tokenId === this.id);
      const activeGroupId  = window._dsctActiveSquadGroupId;
      const isNativeActive = !!myCombatant && myCombatant.id === game.combat?.combatant?.id;
      const inActiveGroup  = !!activeGroupId && myCombatant?.group?.id === activeGroupId;

      if (getSetting('squadGlowMarker') && (isNativeActive || inActiveGroup)) {
        if (!this._dsctGlowGraphic) {
          _cleanupMarkerWrapper(this);
          const glow = _makeGlowGraphic(this, _resolveGlowColor(myCombatant, myCombatant?.group?.id ?? activeGroupId));
          this.addChildAt(glow, 0);
          this._dsctGlowGraphic = glow;
          this.turnMarker       = null;
        }
        canvas.tokens.turnMarkers?.add(this);
        return;
      }

      if (this._dsctGlowGraphic) _cleanupMarkerWrapper(this);

      if (!getSetting('squadSimultaneousTurns') || !inActiveGroup) {
        _cleanupMarkerWrapper(this);
        return wrapped(...args);
      }

      if (!isNativeActive) {
        const { turnMarker } = this.document;
        const markersEnabled = CONFIG.Combat.settings?.turnMarker?.enabled
          && turnMarker?.mode !== CONST.TOKEN_TURN_MARKER_MODES?.DISABLED;

        if (markersEnabled) {
          const activeCombatantToken = game.combat?.combatants?.get(
            [...(game.combat?.groups?.get(activeGroupId)?.members ?? [])][0]?.id
          )?.token?.object;
          const TurnMarkerCtor = globalThis.TokenTurnMarker
            ?? activeCombatantToken?.turnMarker?.constructor
            ?? [...(canvas.tokens?.turnMarkers ?? [])].find(t => t.turnMarker)?.turnMarker?.constructor;
          if (TurnMarkerCtor) {
            if (!this.turnMarker) {
              const marker = new TurnMarkerCtor(this);
              const wrapper = new PIXI.Container();
              const { x, y } = this.document;
              wrapper.position.set(x, y);
              canvas.tokens.addChildAt(wrapper, 0);
              wrapper.addChild(marker);
              this._dsctMarkerWrapper = wrapper;
              this.turnMarker = marker;
            }
            canvas.tokens.turnMarkers?.add(this);
            this.turnMarker.draw();
            return;
          }
        } else if (this.turnMarker) {
          _cleanupMarkerWrapper(this);
          return;
        }
      }

      _cleanupMarkerWrapper(this);
      return wrapped(...args);
    }, 'MIXED');
  }
}
