import { getSetting } from './helpers.mjs';

const _priorGroupInitiative = new Map();
let _squadBatchInProgress = false;

function getSquadGroup(combatant) {
  return combatant?.group?.type === 'squad' ? combatant.group : null;
}

function getGroupBaseName(name) {
  const m = name?.match(/^(.*\d+)[A-Za-z]+\s*$/);
  return m ? m[1].trim() : null;
}

function findSiblingGroups(combat, group) {
  const base = getGroupBaseName(group.name);
  if (!base) return [];
  return [...(combat.groups ?? [])].filter(g =>
    g !== group && g.type === 'squad' && getGroupBaseName(g.name) === base
  );
}

async function fireStartTurn(member, combat) {
  const idx = combat.turns.findIndex(c => c === member);
  if (idx < 0) return;
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
  if (getSetting('debugMode')) {
    const effectDebug = member.actor?.appliedEffects?.map(e => `${e.name}(${e.duration?.expiry},rem=${e.duration?.remaining})`).join(', ') ?? 'none';
    console.log(`DSCT | fireEndTurn: ${member.name}, idx=${idx}, effects=[${effectDebug}]`);
  }
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
  await combat.updateEmbeddedDocuments(
    'Combatant',
    membersToActivate.map(m => ({ _id: m.id, initiative: m.initiative - 1 })),
    { _dsctSquadBatch: true }
  );
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

export function registerSquadTurnHooks() {
  Hooks.on('preUpdateCombatantGroup', (group, changes) => {
    if (_squadBatchInProgress) return;
    if ('initiative' in changes) _priorGroupInitiative.set(group.id, group.initiative);
  });

  Hooks.on('updateCombatantGroup', async (group, changes) => {
    if (!getSetting('squadSimultaneousTurns')) return;
    if (!game.user.isGM) return;
    if (_squadBatchInProgress) return;
    if (!('initiative' in changes) || group.type !== 'squad') return;

    const oldInit = _priorGroupInitiative.get(group.id);
    _priorGroupInitiative.delete(group.id);
    if (oldInit == null || oldInit <= 0 || changes.initiative >= oldInit) return;

    const combat = group.parent;
    if (!combat) return;

    const primary = [...group.members].find(m => m.initiative > 0);
    if (getSetting('debugMode')) console.log(`DSCT | squad batch activate (group): ${group.name}, primary=${primary?.name}`);

    _squadBatchInProgress = true;
    try {
      await activateSquadMembers(group, combat, primary);

      for (const sibGroup of findSiblingGroups(combat, group)) {
        if (!(sibGroup.initiative > 0)) continue;
        if (getSetting('debugMode')) console.log(`DSCT | squad batch activate (sibling): ${sibGroup.name}`);
        await activateSquadMembers(sibGroup, combat, null);
        await sibGroup.update({ initiative: sibGroup.initiative - 1 });
      }
    } finally {
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

    const combat = combatant.parent;
    if (!combat) return;

    if (getSetting('debugMode')) console.log(`DSCT | squad batch activate (individual): ${combatant.name} in ${group.name}`);

    _squadBatchInProgress = true;
    try {
      await activateSquadMembers(group, combat, combatant);
      await group.update({ initiative: group.initiative - 1 });
      for (const sibGroup of findSiblingGroups(combat, group)) {
        if (!(sibGroup.initiative > 0)) continue;
        if (getSetting('debugMode')) console.log(`DSCT | squad batch activate (sibling): ${sibGroup.name}`);
        await activateSquadMembers(sibGroup, combat, null);
        await sibGroup.update({ initiative: sibGroup.initiative - 1 });
      }
    } finally {
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

    if (getSetting('debugMode')) console.log(`DSCT | combatTurnChange: prev=${prev?.name}(groupId=${prev?.group?.id}), cur=${cur?.name}, prevSquad=${prevGroup?.name ?? 'none'}, curSquad=${curGroup?.name ?? 'none'}`);

    if (curGroup) {
      const primaryToken = cur?.token?.object ?? canvas.tokens?.get(cur?.tokenId);
      refreshSquadMarkers(curGroup, primaryToken);
    }

    if (prevGroup && cur?.group?.id !== prev?.group?.id) {
      refreshSquadMarkers(prevGroup, null);
      for (const sibling of prevGroup.members) {
        if (sibling === prev) continue; 
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

      const activeCombatant = game.combat?.combatant;
      if (activeCombatant?.group?.type === 'squad') {
        const myCombatant = game.combat.combatants?.find(c => c.tokenId === this.id);
        if (myCombatant?.group?.id === activeCombatant.group?.id && myCombatant !== activeCombatant) {
          const { turnMarker } = this.document;
          const markersEnabled = CONFIG.Combat.settings?.turnMarker?.enabled
            && turnMarker?.mode !== CONST.TOKEN_TURN_MARKER_MODES?.DISABLED;

          if (markersEnabled) {
            const TurnMarkerCtor = globalThis.TokenTurnMarker
              ?? canvas.tokens?.get(activeCombatant.tokenId)?.turnMarker?.constructor
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
