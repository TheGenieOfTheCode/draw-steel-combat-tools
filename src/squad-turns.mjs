import { getSetting } from './helpers.mjs';

const _priorGroupInitiative = new Map();
let _squadBatchInProgress = false;
const _activatedGroupIds = new Set();

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
  });

  Hooks.on('ready', () => {
    _patchCombatDock();
    if (game.combat) ui.combat?.render();
  });
  Hooks.on('combatStart', _patchCombatDock);

  Hooks.on('renderCombatTracker', (_app, html) => {
    if (!getSetting('squadSimultaneousTurns')) return;
    const el = html instanceof HTMLElement ? html : html[0];
    if (!el) return;
    for (const [groupId, group] of (game.combat?.groups ?? [])) {
      if (group.type !== 'squad' && !(group.type === 'base' && group.members.size > 1)) continue;
      const groupEl = el.querySelector(`.combatant-group[data-group-id="${groupId}"]`);
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
      if (!getSetting('squadSimultaneousTurns')) {
        if (this._dsctMarkerWrapper) {
          canvas.tokens?.removeChild(this._dsctMarkerWrapper);
          this._dsctMarkerWrapper.destroy({ children: true });
          this._dsctMarkerWrapper = null;
          this.turnMarker = null;
          canvas.tokens?.turnMarkers?.delete(this);
        }
        return wrapped(...args);
      }

      const activeGroupId = window._dsctActiveSquadGroupId;
      const nativeActiveCombatant = game.combat?.combatant;

      if (activeGroupId) {
        const myCombatant = game.combat?.combatants?.find(c => c.tokenId === this.id);
        const inActiveGroup = myCombatant?.group?.id === activeGroupId;

        if (!inActiveGroup) {
          if (this._dsctMarkerWrapper) {
            canvas.tokens?.removeChild(this._dsctMarkerWrapper);
            this._dsctMarkerWrapper.destroy({ children: true });
            this._dsctMarkerWrapper = null;
            this.turnMarker = null;
            canvas.tokens?.turnMarkers?.delete(this);
          }
          return wrapped(...args);
        }

        if (myCombatant?.id !== nativeActiveCombatant?.id) {
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
            if (this._dsctMarkerWrapper) {
              canvas.tokens?.removeChild(this._dsctMarkerWrapper);
              this._dsctMarkerWrapper.destroy({ children: true });
              this._dsctMarkerWrapper = null;
            } else {
              canvas.tokens.turnMarkers?.delete(this);
              this.turnMarker.destroy();
            }
            this.turnMarker = null;
            return;
          }
        }
      }

      if (this._dsctMarkerWrapper) {
        canvas.tokens?.removeChild(this._dsctMarkerWrapper);
        this._dsctMarkerWrapper.destroy({ children: true });
        this._dsctMarkerWrapper = null;
        this.turnMarker = null;
        canvas.tokens?.turnMarkers?.delete(this);
      }
      return wrapped(...args);
    }, 'MIXED');
  }
}
