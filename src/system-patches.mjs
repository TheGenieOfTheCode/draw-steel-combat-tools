import { getSetting, getItemDsid, canForcedMoveTarget, MULTI_GRAB_LIMITS, normalizeCollection, getModuleApi, getWindowById, getSquadGroup, applyDamage, safeDelete } from './helpers.mjs';
import { applyGrab, runGrab, endGrab, openGrabPanel } from './conditions/grab.mjs';
import { applyFrightened, applyTaunted } from './conditions/conditions.mjs';
import { DamageConditionsPanel } from './conditions/damage-conditions.mjs';
import { runForcedMovement } from './forced-movement/forced-movement-engine.mjs';
import { FmModifyPanel, replayModifiers, createModifierNoteDiv, persistStack } from './forced-movement/forced-movement-modify-panel.mjs';

const M = 'draw-steel-combat-tools';

function _fmMakeLabel(state) {
  return [
    state.fastMove ? 'Auto' : '',
    state.vertical ? (state.verticalDistance ? `Vertical ${state.verticalDistance}` : 'Vertical') : '',
    `${state.movement.charAt(0).toUpperCase() + state.movement.slice(1)} ${state.distance}`,
  ].filter(Boolean).join(' ');
}

function _fmBaseStateFromBtn(btn) {
  const props = new Set(JSON.parse(btn.dataset.properties ?? '[]'));
  const vd    = Number(btn.dataset.verticalDistance ?? 0);
  return {
    movement:          btn.dataset.movement ?? 'push',
    distance:          parseInt(btn.dataset.distance) || 0,
    vertical:          props.has('vertical'),
    verticalDistance:  vd > 0 ? vd : '',
    fallReduction:     Number(btn.dataset.fallReduction ?? 0),
    noFallDamage:              false,
    noCollisionDamage:         props.has('no-collision-damage'),
    noMoverCollisionDamage:    props.has('no-mover-collision-damage'),
    noObstacleCollisionDamage:  props.has('no-obstacle-collision-damage'),
    ignoreStability:           props.has('ignore-stability'),
    fastMove:          props.has('fast-auto-path'),
  };
}

export function registerSystemPatches() {
  _extendFMProperties();
  _registerFMEditorFields();
  _registerConditionSheetHooks();
  _registerAbilityHudCompat();
  if (getSetting('effectExpiryPatch')) _patchEffectExpiryEvent();
  if (!globalThis.libWrapper) {
    console.warn('DSCT | registerSystemPatches | libWrapper not found -- constructButtons patches skipped');
    return;
  }
  _patchFMConstructButtons();
  _patchAppliedConstructButtons();
  _patchAppliedEffect();
  _patchDamageRollButton();
  _patchToggleStatusEffect();
  _registerButtonHooks();
}

function _extendFMProperties() {
  const forcedProps = ds?.CONFIG?.PowerRollEffect?.forced?.properties;
  if (forcedProps) {
    forcedProps['no-collision-damage']        = { label: 'DSCT.FM.Property.NoCollisionDamage' };
    forcedProps['no-mover-collision-damage']  = { label: 'DSCT.FM.Property.NoMoverCollisionDamage' };
    forcedProps['no-obstacle-collision-damage'] = { label: 'DSCT.FM.Property.NoObstacleCollisionDamage' };
    forcedProps['fast-auto-path']             = { label: 'DSCT.FM.Property.FastAutoPath' };
  }
  const appliedProps = ds?.CONFIG?.PowerRollEffect?.applied?.properties;
  if (appliedProps) {
    appliedProps['ignore-size'] = { label: 'DSCT.FM.Property.IgnoreSize' };
  }
}

function _patchFMConstructButtons() {
  libWrapper.register(
    M,
    'ds.data.pseudoDocuments.powerRollEffects.ForcedMovementPowerRollEffect.prototype.constructButtons',
    function(tier) {
      if (!getSetting('forcedMovementEnabled')) return null;

      const tierData = this.forced?.[`tier${tier}`];
      if (!tierData) return null;

      const movementSet = tierData.movement instanceof Set ? tierData.movement : new Set(tierData.movement ?? []);
      const properties  = tierData.properties instanceof Set ? tierData.properties : new Set(tierData.properties ?? []);
      const distanceRaw = String(tierData.distance ?? '0');
      const item        = this.item;

      const rollData = item?.getRollData?.() ?? {};
      let distance;
      try {
        distance = typeof ds?.utils?.evaluateFormula === 'function'
          ? ds.utils.evaluateFormula(distanceRaw, rollData)
          : Roll.safeEval(Roll.replaceFormulaData(distanceRaw, rollData));
      } catch {
        distance = parseInt(distanceRaw) || 0;
      }

      const verticalDistance = item?.getFlag(M, `fmVerticalDistance${tier}`) ?? 0;
      const fallRed1         = item?.getFlag(M, 'fmFallReduction1')         ?? 0;
      const fallRedN         = item?.getFlag(M, `fmFallReduction${tier}`);
      const fallReduction    = fallRedN != null ? fallRedN : fallRed1;

      const types = [...movementSet].filter(Boolean);
      if (!types.length) return null;

      
      return types.map(movementType => {
        const label = _fmMakeLabel({
          movement: movementType,
          distance,
          vertical:          properties.has('vertical'),
          verticalDistance:  verticalDistance > 0 ? verticalDistance : '',
          fastMove:          properties.has('fast-auto-path'),
        });
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${label}`;
        btn.style.cssText = 'cursor:pointer;';
        btn.dataset.dsctAction       = 'dsct-fm';
        btn.dataset.movement         = movementType;
        btn.dataset.distance         = String(distance);
        btn.dataset.properties       = JSON.stringify([...properties]);
        btn.dataset.verticalDistance = String(verticalDistance);
        btn.dataset.fallReduction    = String(fallReduction);
        return btn;
      });
    },
    'OVERRIDE'
  );
}

function _patchAppliedConstructButtons() {
  libWrapper.register(
    M,
    'ds.data.pseudoDocuments.powerRollEffects.AppliedPowerRollEffect.prototype.constructButtons',
    function(wrapped, tier) {
      const original  = wrapped(tier) ?? [];
      const tierKey   = `tier${tier}`;
      const item      = this.item;
      const tierData  = this.applied?.[tierKey];
      const tierProps = tierData?.properties instanceof Set ? tierData.properties : new Set(tierData?.properties ?? []);

      
      return original.map(btn => {
        const effectId = btn.dataset?.effectId ?? btn.dataset?.effectid;

        if (effectId === 'grabbed' && getSetting('grabEnabled')) {
          return _buildGrabButton(btn, item, tier, tierProps);
        }
        if (effectId === 'frightened' && getSetting('frightenedEnabled')) {
          return _buildConditionButton(btn, this, tierKey, item, 'frightened');
        }
        if (effectId === 'taunted' && getSetting('tauntedEnabled')) {
          return _buildConditionButton(btn, this, tierKey, item, 'taunted');
        }
        return btn;
      }).filter(Boolean);
    },
    'WRAPPER'
  );
}

function _buildGrabButton(original, item, tier, properties = new Set()) {
  const dsid     = getItemDsid(item);
  const maxGrabs = MULTI_GRAB_LIMITS[dsid] ?? 1;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = original.className ? `${original.className} dsct-grab-btn` : 'dsct-grab-btn';
  btn.innerHTML = '<i class="fa-solid fa-hand-rock"></i> Grabbed';
  btn.style.cssText = 'cursor:pointer;';
  btn.dataset.dsctAction = 'dsct-grab';
  btn.dataset.dsctDsid   = dsid ?? '';
  btn.dataset.dsctTier   = String(tier ?? 0);
  btn.dataset.maxGrabs   = String(maxGrabs);
  btn.dataset.properties = JSON.stringify([...properties]);
  btn.dataset.tooltip    = 'Holding Shift bypasses restrictions';
  return btn;
}

function _buildConditionButton(original, effect, tierKey, item, conditionId) {
  const endStr      = effect.applied?.[tierKey]?.effects?.[conditionId]?.end ?? '';
  const label       = conditionId.charAt(0).toUpperCase() + conditionId.slice(1);
  const sourceActor = item?.actor ?? null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = original.className ?? '';
  btn.innerHTML = `<i class="fa-solid fa-skull"></i> Apply ${label}`;
  btn.style.cssText = 'cursor:pointer;';
  btn.dataset.dsctAction       = `dsct-${conditionId}`;
  btn.dataset.sourceActorUuid  = sourceActor?.uuid ?? '';
  btn.dataset.end              = endStr;
  return btn;
}

function _patchAppliedEffect() {
  libWrapper.register(
    M,
    'ds.data.pseudoDocuments.powerRollEffects.AppliedPowerRollEffect.prototype.applyEffect',
    async function(wrapped, tierKey, effectId, options = {}) {
      
      if (options.targets !== undefined) return wrapped(tierKey, effectId, options);

      if (!getSetting('appliedEffectEnabled')) return wrapped(tierKey, effectId, options);

      const targets = [...game.user.targets].map(t => t.actor).filter(Boolean);
      if (!targets.length) {
        ui.notifications.warn(game.i18n.localize('DSCT.notice.sys.noTargetForEffect'));
        return;
      }

      if (targets.every(a => a.isOwner)) {
        return wrapped(tierKey, effectId, { ...options, targets });
      }

      const api = getModuleApi(false);
      if (!api?.socket) return;
      await api.socket.executeAsGM('dsct.applyEffectAsGM', this.uuid, tierKey, effectId, targets.map(a => a.uuid));
    },
    'MIXED'
  );
}

function _patchDamageRollButton() {
  libWrapper.register(
    M,
    'ds.rolls.DamageRoll.applyDamageCallback',
    async function(wrapped, event) {
      const btn      = event.target?.closest?.('.apply-damage') ?? event.currentTarget;
      const dsctArea = btn?.dataset.dsctArea;
      if (getSetting('debugMode')) console.log(`DSCT | ApplyDmg | dsctArea=${dsctArea} targets=${game.user.targets.size} controlled=${canvas.tokens.controlled.length} currentTarget=${event.currentTarget?.className} target=${event.target?.className}`);
      if (dsctArea === undefined) return wrapped(event);

      const part  = btn.closest('[data-message-part]');
      const li    = btn.closest('[data-message-id]');
      const msg   = game.messages.get(li?.dataset.messageId);
      const idx   = parseInt(btn.dataset.index);
      const roll  = part
        ? msg?.system.parts.get(part.dataset.messagePart)?.rolls?.[idx]
        : msg?.rolls?.[idx];
      if (!roll) return;

      if (roll.isHeal) return wrapped(event);

      let amount = roll.total;
      if (event.shiftKey) amount = Math.floor(amount / 2);

      const tokens = [...game.user.targets];
      if (!tokens.length) { ui.notifications.error(game.i18n.localize('DSCT.notice.sys.noTargetForDamage')); return; }

      for (const token of tokens) {
        const actor = token.actor;
        if (!actor) continue;
        if (dsctArea === 'true') {
          const squadGroup   = getSquadGroup(actor);
          const effectiveAmt = squadGroup ? Math.min(amount, actor.system.stamina.max ?? amount) : amount;
          await applyDamage(actor, effectiveAmt, undefined, { damageType: roll.type });
        } else {
          await applyDamage(actor, amount, undefined, { damageType: roll.type });
        }
      }
    },
    'MIXED'
  );
}


const _usedJudgementT3 = new Set();

function _registerButtonHooks() {
  Hooks.on('renderChatMessageHTML', async (_msg, root) => {
    if (!root) return;

    const _dstdCeding = !!game.modules.get('draw-steel-target-damage')?.active;

    if (getSetting('applyDamageEnabled') && !_dstdCeding) {
      for (const btn of root.querySelectorAll('.apply-damage')) {
        btn.dataset.dsctArea = 'false';
      }
    }

    const parts      = normalizeCollection(_msg.system?.parts);
    const abilityUse = parts.find(p => p.type === 'abilityUse');
    if (getSetting('applyDamageEnabled') && !_dstdCeding && getSetting('areaDamageEnabled') && abilityUse?.abilityUuid) {
      const item   = await fromUuid(abilityUse.abilityUuid).catch(() => null);
      if (item?.system?.keywords?.has('area')) {
        for (const btn of root.querySelectorAll('.apply-damage')) {
          btn.dataset.dsctArea = 'true';
          btn.appendChild(document.createTextNode(' (Area)'));
        }
      }
    }

    
    
    if (getSetting('purifyingFireEnabled') && !_dstdCeding) {
      const speakerActor = game.actors.get(_msg.speaker?.actor);
      const debug = getSetting('debugMode');
      if (debug) console.log(`DSCT | PurifyingFire | speakerActor=${speakerActor?.name ?? 'none'}`);
      if (speakerActor?.items.some(i => getItemDsid(i) === 'purifying-fire' || i.name.toLowerCase() === 'purifying fire')) {
        const targetTokens = [...game.user.targets];
        if (debug) console.log(`DSCT | PurifyingFire | targets from game.user.targets:`, targetTokens.map(t => t.name));
        if (debug) targetTokens.forEach(t => console.log(`DSCT | PurifyingFire | ${t.name} effects:`, [...(t.actor?.effects ?? [])].map(ef => ({ name: ef.name, changes: ef.changes }))));
        const hasFireWeaknessTarget = targetTokens.some(t =>
          t.actor?.effects.some(ef => ef.changes?.some(c => c.key === 'system.damage.weaknesses.fire'))
        );
        if (debug) console.log(`DSCT | PurifyingFire | hasFireWeaknessTarget=${hasFireWeaknessTarget}`);
        if (hasFireWeaknessTarget) {
          for (const btn of root.querySelectorAll('.apply-damage')) {
            const partEl = btn.closest('[data-message-part]');
            const partId = partEl?.dataset.messagePart;
            const part   = partId ? _msg.system.parts.get(partId) : null;
            const roll   = part ? part.rolls?.[parseInt(btn.dataset.index)] : _msg.rolls?.[parseInt(btn.dataset.index)];
            if (roll?.type !== 'holy') continue;

            const fireBtn = document.createElement('button');
            fireBtn.type = 'button';
            fireBtn.className = btn.className;
            fireBtn.innerHTML = `<i class="fa-solid fa-fire"></i> ${game.i18n.format('DSCT.button.purifyingFireDamage', { amount: roll.total })}`;
            fireBtn.style.cssText = 'cursor:pointer;';
            if (btn.dataset.tooltip)          fireBtn.dataset.tooltip          = btn.dataset.tooltip;
            if (btn.dataset.tooltipDirection) fireBtn.dataset.tooltipDirection = btn.dataset.tooltipDirection;
            fireBtn.dataset.dsctAction = 'dsct-purifying-fire';
            fireBtn.dataset.index      = btn.dataset.index;
            fireBtn.dataset.dsctArea   = btn.dataset.dsctArea ?? 'false';
            if (partId) fireBtn.dataset.dsctPartId = partId;
            if (btn.dataset.dsctArea === 'true') fireBtn.appendChild(document.createTextNode(' (Area)'));
            btn.after(fireBtn);
          }
        }
      }
    }

    if (getSetting('judgementAutomation')) {
      const speakerActor = game.actors.get(_msg.speaker?.actor);
      if (speakerActor) {
        if (_msg.getFlag(M, 'judgementT3Fired')) {
          let ba = root.querySelector('.message-part-buttons');
          if (!ba) {
            ba = document.createElement('div');
            ba.className = 'message-part-buttons';
            (root.querySelector('.message-content') ?? root).appendChild(ba);
          }
          const tag = document.createElement('div');
          tag.className = 'dsct-undo-status';
          tag.textContent = game.i18n.localize('DSCT.chat.tactical.judgementT3FiredTag');
          ba.appendChild(tag);
        } else {
          const t3Parts = normalizeCollection(_msg.system?.parts);
          const t3Au    = t3Parts.find(p => p.type === 'abilityUse');
          if (t3Au?.abilityUuid) {
            const t3Item = await fromUuid(t3Au.abilityUuid).catch(() => null);
            if (t3Item?.system?.keywords?.has('melee')) {
              root.querySelectorAll('.apply-damage').forEach(dmgBtn => {
                dmgBtn.addEventListener('click', async () => {
                  if (_usedJudgementT3.has(_msg.id)) return;
                  const judgedHitTokens = [...game.user.targets].filter(t =>
                    t.actor?.appliedEffects?.find(ef => ef.getFlag(M, 'judgement')?.actorId === speakerActor.id)
                  );
                  if (!judgedHitTokens.length) return;
                  _usedJudgementT3.add(_msg.id);
                  await ChatMessage.create({
                    content: game.i18n.format('DSCT.chat.tactical.judgementTauntedReminder', {
                      censorName: speakerActor.name,
                      targetNames: judgedHitTokens.map(t => t.name).join(', '),
                    }),
                    flags: { [M]: { judgementT3Reminder: {
                      censorActorId: speakerActor.id,
                      judgedTokenIds: judgedHitTokens.map(t => t.id),
                      censorUserId: _msg.author?.id ?? game.user.id,
                    }}},
                  });
                  const api = getModuleApi(false);
                  if (_msg.isOwner || game.user.isGM) {
                    await _msg.setFlag(M, 'judgementT3Fired', true);
                  } else if (api?.socket) {
                    await api.socket.executeAsGM('dsct.updateDocument', _msg.uuid, { [`flags.${M}.judgementT3Fired`]: true });
                  }
                });
              });
            }
          }
        }
      }
    }

    const fmBtns = [...root.querySelectorAll('[data-dsct-action="dsct-fm"]')];
    if (fmBtns.length) {
      const savedMods  = _msg.getFlag(M, 'fmModifiers') ?? [];
      const modStack   = savedMods.map(s => ({ modState: s.modState, noteName: s.noteName, noteDesc: s.noteDesc }));
      const baseStates = fmBtns.map(btn => _fmBaseStateFromBtn(btn));
      const states     = baseStates.map(st => ({ ...st }));

      if (modStack.length > 0) replayModifiers(baseStates, modStack, states);

      fmBtns.forEach((btn, i) => {
        btn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${_fmMakeLabel(states[i])}`;
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const st = states[i];
          const props = new Set([
            st.vertical                ? 'vertical'                    : null,
            st.noCollisionDamage       ? 'no-collision-damage'         : null,
            st.noMoverCollisionDamage  ? 'no-mover-collision-damage'   : null,
            st.noObstacleCollisionDamage ? 'no-obstacle-collision-damage' : null,
            st.ignoreStability         ? 'ignore-stability'             : null,
            st.fastMove                ? 'fast-auto-path'               : null,
          ].filter(Boolean));
          const vertDist = st.vertical
            ? (st.verticalDistance !== '' ? Number(st.verticalDistance) : st.distance)
            : 0;
          await runForcedMovement({
            movement: st.movement, distance: String(st.distance),
            properties: props, verticalDistance: vertDist, fallReduction: st.fallReduction,
          });
        });
      });

      const gmOnly   = getSetting('fmModifyGmOnly');
      const showEdit = !gmOnly || game.user.isGM;

      if (showEdit) {
        const noteParent = root.querySelector('.message-part-buttons') ?? root;
        const effects    = baseStates.map((_, i) => ({ name: _fmMakeLabel(baseStates[i]) }));

        fmBtns.forEach((btn, i) => {
          const wrapper = document.createElement('div');
          wrapper.className = 'dsct-fm-split';
          btn.parentNode.insertBefore(wrapper, btn);
          wrapper.appendChild(btn);

          const pencilBtn = document.createElement('button');
          pencilBtn.type = 'button';
          pencilBtn.className = 'dsct-fm-edit';
          pencilBtn.title = 'Modify Forced Movement';
          pencilBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
          wrapper.appendChild(pencilBtn);

          pencilBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const existing = getWindowById('dsct-fm-modify');
            if (existing) existing.close();
            new FmModifyPanel(states, baseStates, modStack, effects, fmBtns, _fmMakeLabel, root, noteParent).render({ force: true });
          });
        });

        for (const entry of modStack) {
          createModifierNoteDiv(entry, modStack, baseStates, states, fmBtns, _fmMakeLabel, noteParent, root);
        }
      }
    }

    for (const btn of root.querySelectorAll('[data-dsct-action="dsct-grab"]')) {
      const maxGrabs  = Number(btn.dataset.maxGrabs ?? 1);
      const dsid      = btn.dataset.dsctDsid || null;
      const tier      = Number(btn.dataset.dsctTier ?? 0);
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const shiftBypass = e.shiftKey;
        if (!shiftBypass && getSetting('restrictGrabButtons') && !game.user.isGM) return;

        const controlled = canvas.tokens.controlled;
        const grabber    = controlled.length === 1 ? controlled[0] : null;
        if (!grabber) { ui.notifications.warn(game.i18n.localize('DSCT.notice.sys.controlGrabber')); return; }

        const targets = [...game.user.targets].filter(t => t.id !== grabber.id);
        if (!targets.length) { ui.notifications.warn(game.i18n.format('DSCT.notice.sys.grabApplyTarget', { s: maxGrabs > 1 ? 's' : '' })); return; }
        if (targets.length > maxGrabs) { ui.notifications.warn(game.i18n.format('DSCT.notice.sys.grabTooManyTargets', { max: maxGrabs, s: maxGrabs !== 1 ? 's' : '' })); return; }

        const grabProps = new Set(JSON.parse(btn.dataset.properties ?? '[]'));
        if (!shiftBypass && !grabProps.has('ignore-size') && !(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
          for (const t of targets) {
            if (!canForcedMoveTarget(grabber.actor, t.actor)) {
              ui.notifications.warn(game.i18n.format('DSCT.notice.sys.grabTargetTooLarge', { grabber: grabber.name, target: t.name }));
              return;
            }
          }
        }

        if (dsid === 'grab') {
          
          for (const t of targets) {
            await runGrab(grabber, t, { tier, maxGrabs, ignoreSizeCheck: shiftBypass });
          }
        } else {
          for (const t of targets) {
            await applyGrab(grabber, t, { maxGrabs });
            ChatMessage.create({ content: `<strong>Grab:</strong> ${grabber.name} grabs ${t.name}!` });
          }
        }
      });
    }

    if (getSetting('teleportEnabled') && !root.querySelector('.dsct-tp-ability-btn')) {
      const hasPart = normalizeCollection(_msg.system?.parts).some(p => p.type === 'abilityUse');
      if (hasPart && root.querySelector('.message-part-html')?.textContent?.toLowerCase().includes('teleport')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsct-tp-ability-btn';
        btn.innerHTML = '<i class="fa-solid fa-person-through-window"></i> Teleport';
        btn.style.cssText = 'cursor:pointer;';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          getModuleApi(false)?.teleportUI();
        });
        (root.querySelector('.message-part-buttons') ?? root.querySelector('.message-content') ?? root).appendChild(btn);
      }
    }

    for (const btn of root.querySelectorAll('[data-dsct-action="dsct-purifying-fire"]')) {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targets = [...game.user.targets];
        if (!targets.length) { ui.notifications.error(game.i18n.localize('DSCT.notice.sys.noTargetForDamage')); return; }

        const li  = btn.closest('[data-message-id]');
        const msg = game.messages.get(li?.dataset.messageId);
        if (!msg) return;

        const partId = btn.dataset.dsctPartId;
        const part   = partId ? msg.system.parts.get(partId) : null;
        const roll   = part ? part.rolls?.[parseInt(btn.dataset.index)] : msg.rolls?.[parseInt(btn.dataset.index)];
        if (!roll) return;

        let amount = roll.total;
        if (e.shiftKey) amount = Math.floor(amount / 2);

        const isArea = btn.dataset.dsctArea === 'true';

        for (const token of targets) {
          const actor = token.actor;
          if (!actor) continue;
          await applyDamage(actor, amount, undefined, { damageType: 'fire', isArea });
        }
      });
    }

    for (const btn of root.querySelectorAll('[data-dsct-action="dsct-frightened"],[data-dsct-action="dsct-taunted"]')) {
      const conditionId      = btn.dataset.dsctAction === 'dsct-frightened' ? 'frightened' : 'taunted';
      const sourceActorUuid  = btn.dataset.sourceActorUuid || null;
      const endStr           = btn.dataset.end || null;

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targets = [...game.user.targets];
        if (!targets.length) { ui.notifications.warn(game.i18n.localize('DSCT.notice.sys.noConditionTargets')); return; }

        const sourceActor = sourceActorUuid ? await fromUuid(sourceActorUuid) : null;
        const sourceToken = sourceActor
          ? (canvas.tokens.controlled.find(t => t.actor?.id === sourceActor.id)
            ?? canvas.tokens.placeables.find(t => t.actor?.id === sourceActor.id))
          : null;
        const sourceTokenId = sourceToken?.id ?? null;

        for (const t of targets) {
          if (conditionId === 'frightened') await applyFrightened(t, sourceActor, sourceTokenId, endStr);
          else                              await applyTaunted(t, sourceActor, sourceTokenId, endStr);
        }
      });
    }
  });
}

function _registerConditionSheetHooks() {
  const lightUp = (element, actor) => {
    if (!actor) return;
    const grabbed = [...(window._activeGrabs?.values() ?? [])].some(g => g.grabbedActorId === actor.id);
    if (grabbed)                                             element.querySelector('[data-status-id="grabbed"]')?.classList.add('active');
    if (actor.effects.some(e => e.getFlag(M, 'frightened'))) element.querySelector('[data-status-id="frightened"]')?.classList.add('active');
    if (actor.effects.some(e => e.getFlag(M, 'taunted')))    element.querySelector('[data-status-id="taunted"]')?.classList.add('active');
  };
  Hooks.on('renderDrawSteelActorSheet', (app, element) => lightUp(element, app.actor));
  Hooks.on('renderDrawSteelTokenHUD',   (app, element) => lightUp(element, app.actor));
}

function _registerAbilityHudCompat() {
  Hooks.on('renderAbilityHud', (_app, html) => {
    const actor = canvas.tokens?.controlled?.[0]?.actor;
    if (!actor) return;
    const checks = {
      grabbed:    [...(window._activeGrabs?.values() ?? [])].some(g => g.grabbedActorId === actor.id),
      frightened: actor.effects.some(e => e.getFlag(M, 'frightened')),
      taunted:    actor.effects.some(e => e.getFlag(M, 'taunted')),
    };
    for (const [id, isActive] of Object.entries(checks)) {
      html[0].querySelector(`[data-action-id="${id}"]`)?.classList.toggle('active', isActive);
    }
  });
}

function _patchToggleStatusEffect() {
  libWrapper.register(M, 'ds.documents.DrawSteelActor.prototype.toggleStatusEffect',
    async function(wrapped, statusId, options = {}) {
      if (statusId === 'grabbed' && getSetting('conditionsEnabled')) {
        const grab = [...(window._activeGrabs?.values() ?? [])].find(g => g.grabbedActorId === this.id);
        if (grab) await endGrab(grab.grabbedTokenId);
        else openGrabPanel();
        return;
      }
      if ((statusId === 'frightened' || statusId === 'taunted') && getSetting('conditionsEnabled')) {
        const effect = this.effects.find(e => e.getFlag(M, statusId));
        if (effect) {
          await safeDelete(effect);
        } else {
          const panel = getWindowById('dsct-dc-panel') ?? new DamageConditionsPanel();
          panel._condition = statusId;
          if (options.effectEnd) {
            const expiryEvent = ds.CONFIG.effectEnds[options.effectEnd]?.expiryEvent;
            if (expiryEvent) panel._conditionEnd = expiryEvent;
          }
          panel.render({ force: true });
        }
        return;
      }
      return wrapped(statusId, options);
    }, 'MIXED');
}



function _patchEffectExpiryEvent() {
  Hooks.once('ready', () => {
    const registry = foundry.documents?.ActiveEffect?.registry;
    if (!registry) {
      console.warn('DSCT | _patchEffectExpiryEvent | registry not found -- DB error guard skipped');
      return;
    }
    const _origRefresh = registry.refresh.bind(registry);
    registry.refresh = async function(event, context) {
      for (const effect of this) {
        if (effect.parent?.isToken
          || !(effect.parent instanceof foundry.abstract.Document)
          || !effect.parent?.effects?.has?.(effect.id)
          || ['squad-label', 'triggered-action'].includes(effect.getFlag?.(M, 'effectType'))) {
          this.delete(effect);
        }
      }
      return _origRefresh(event, context);
    };
  });
}

function _registerFMEditorFields() {
  Hooks.on('renderPowerRollEffectSheet', (sheet, element, _context) => {
    const pseudo = sheet.pseudoDocument;
    if (pseudo?.type !== 'forced') return;
    const item = pseudo.item;
    if (!item) return;

    const fallRed1 = item.getFlag(M, 'fmFallReduction1') ?? null;

    for (const n of [1, 2, 3]) {
      const section = element.querySelector(`section[data-tab="tier${n}"]`);
      if (!section) continue;

      const distanceEl  = section.querySelector(`[name="forced.tier${n}.distance"]`);
      const insertAfter = distanceEl?.closest('.form-group') ?? null;

      const vertVal  = item.getFlag(M, `fmVerticalDistance${n}`) ?? null;
      const fallRawN = item.getFlag(M, `fmFallReduction${n}`);
      
      const fallVal  = n === 1 ? (fallRawN ?? null) : fallRawN ?? null;

      const vertGroup = document.createElement('div');
      vertGroup.className = 'form-group';
      vertGroup.innerHTML = `
        <label>${game.i18n.localize('DSCT.label.verticalDistance')}</label>
        <div class="form-field">
          <input type="number" min="0" step="1" placeholder="0"${vertVal != null ? ` value="${Number(vertVal)}"` : ''}>
        </div>
        <p class="hint">${game.i18n.localize('DSCT.label.verticalDistanceHint')}</p>
      `;

      const fallGroup = document.createElement('div');
      fallGroup.className = 'form-group';
      const fallPlaceholder = n > 1 && fallRed1 != null ? String(fallRed1) : '0';
      fallGroup.innerHTML = `
        <label>${game.i18n.localize('DSCT.label.fallDistanceReduction')}</label>
        <div class="form-field">
          <input type="number" min="0" step="1" placeholder="${fallPlaceholder}"${fallVal != null ? ` value="${Number(fallVal)}"` : ''}>
        </div>
      `;

      const vertInput = vertGroup.querySelector('input');
      const fallInput = fallGroup.querySelector('input');

      vertInput.addEventListener('change', e => {
        const v = e.target.value.trim();
        v === '' ? item.unsetFlag(M, `fmVerticalDistance${n}`) : item.setFlag(M, `fmVerticalDistance${n}`, Number(v) || 0);
      });
      fallInput.addEventListener('change', e => {
        const v = e.target.value.trim();
        v === '' ? item.unsetFlag(M, `fmFallReduction${n}`) : item.setFlag(M, `fmFallReduction${n}`, Number(v) || 0);
      });

      if (insertAfter) {
        insertAfter.after(vertGroup, fallGroup);
      } else {
        section.append(vertGroup, fallGroup);
      }
    }
  });
}
