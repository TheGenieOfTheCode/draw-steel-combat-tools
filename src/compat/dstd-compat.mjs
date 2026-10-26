import { getSetting, getModuleApi, getWindowById, getItemDsid, MULTI_GRAB_LIMITS, applyDamage, canForcedMoveTarget, safeDelete, tokFootprintDist, sizeRank, damageBatch , dropKey, cleansed, isOwnAbilityActor, effectStartFor } from '../helpers.mjs';
import { isOthersEffect, othersSpec, triggerRollData, triggerDamageTypeFor, grantTempStamina, levelAllows, expendAllows, buildCleanseAutoLabel, cleansePreviewLabel, healAutoLabel, runTeleportEffect, teleportAutoLabel, teleportDistance, applyFlatResource, undoFlatResource, resourceAppliedLabel, resourceFlagKey, resourceIcon, resourceRecipient, canGainResource, resourceJobs, resourceShortLabel, applyFlatAppliedEffect, flatAppliedSourceToken, removeFlatAppliedEffect, flatAppliedLabel, flatAppliedStacks, modifyAttributeSafely } from '../ability-automation/flat-special-effects.mjs';
import { tieredAsFlat, tieredEffectsOf } from '../ability-automation/tiered-effects.mjs';
import { runColoredTokenPicker, runMultiTokenPicker, pickTargetsFor, setFoundryTargets } from '../ability-automation/target-picker.mjs';
import { pickAreaTargetsFor } from '../ability-automation/area-picker.mjs';
import { setTip, tipFor } from '../chat-tips.mjs';

const _tip = (el, key, opts = {}) => setTip(el, tipFor(key, opts));
const _appliedTip = (el, key, title) => setTip(el, tipFor(key, { title, body: game.i18n.localize('DSCT.tip.applied') }));
import { runForcedMovement, forcedMovementTaken } from '../forced-movement/forced-movement-engine.mjs';
import { FmModifyPanel, replayModifiers, createModifierNoteDiv } from '../forced-movement/forced-movement-modify-panel.mjs';
import { applyGrab, runGrab, endGrab, grabChat } from '../conditions/grab.mjs';
import { isNullGrabIntuitionActive, nullIntuitionScore } from '../ability-automation/class-null/psionic-martial-arts.mjs';
import { applyFrightened, applyTaunted } from '../conditions/conditions.mjs';
import { applyStatus, SOURCED_STATUSES } from '../conditions/statuses.mjs';
import { services, applicationSignature, registerPanelDecorator, DSTD, DSTD_PANEL, DSTD_ROW, DAMAGE_TYPES, isPrimaryGM, safeUpdate, safeCreateEmbedded, safeSetFlag, executeAsDirector } from '../ctlib.mjs';
import { MARK_ABILITY_CONFIG } from '../ability-automation/ability-automation.mjs';
import { injectDamagePills, foldDamagePills } from './dstd-damage-pills.mjs';
import { takesOver } from '../advanced-enrichers/flat-enrichers.mjs';
import { syncBaseRollTier } from './dstd-roll-pills.mjs';
import { filterChooseDstdRows, chooseMessageFilter, chooseKeywords, chooseAfterPending, settleCriticalChoice } from '../ability-automation/choose-effect.mjs';
import { _pendingSquadMap, consumePendingSquadMap } from '../ability-automation/squad-targeting.mjs';

const PANEL_ANCHOR = 'dsct-panel-anchor';

const M          = 'draw-steel-combat-tools';

const _fmState = new Map();

const _fmUndoIndex = new Map();
const _tpUndoIndex = new Map();
const _fmExecutingKeys = new Set();

const _flatCondState = new Map();

function _dmgIcon(type) { return (DAMAGE_TYPES[type] ?? DAMAGE_TYPES.untyped).icon; }

const SPEND_HANDLER = 'dsct.dstdSpendResource';

export async function _spendSourceResource(actor, cost) {
  const local = actor.system.coreResource?.target === actor ? actor.isOwner : game.user.isGM;
  if (local) return await actor.system.updateResource(-cost);
  return await executeAsDirector(getModuleApi(false)?.socket, SPEND_HANDLER, actor.uuid, cost);
}

function _makeStatusIcon(iconSrc) {
  if (!iconSrc) {
    const i = document.createElement('i');
    i.className = 'fa-solid fa-star';
    return i;
  }
  const img = document.createElement('img');
  img.src = iconSrc;
  img.style.cssText = 'width:1.35em;height:1.35em;object-fit:contain;vertical-align:middle;';
  return img;
}

function _dstdHashString(value) {
  let hash = 0;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) { hash = ((hash << 5) - hash) + text.charCodeAt(i); hash |= 0; }
  return Math.abs(hash).toString(36);
}
function _dstdTargetKey(target) {
  if (target?.selectedToken) return 'selected-token';
  return target?.tokenUuid?.replace(/\./g, '__') ?? '';
}
function _dstdOperationId(kind, target, action) {
  const hash     = _dstdHashString(_dstdTargetKey(target));
  const actionId = action.rollIndex ?? action.effectId ?? action.characteristic ?? 'action';
  return `${kind}-${action.partId ?? 'part'}-${actionId}-${hash}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

const _squadAbilityRange = (ability) => {
  const dist = ability?.system?.distance;
  if (!dist) return null;
  const p = parseInt(dist.primary) || 0;
  const s = parseInt(dist.secondary) || 0;
  return dist.type === 'meleeRanged' ? Math.max(p, s) : (p || null);
};

function _regionContainsToken(region, token) {
  if (!region?.testPoint) return false;
  const elevation = Number(token.document?.elevation ?? 0);
  const size      = canvas.grid.size;
  const center    = token.center ?? {
    x: Number(token.document?.x ?? 0) + Number(token.w ?? size) / 2,
    y: Number(token.document?.y ?? 0) + Number(token.h ?? size) / 2,
  };
  const inset  = Math.max(1, Math.min(Number(token.w ?? size), Number(token.h ?? size)) * 0.25);
  const points = [
    center,
    { x: center.x - inset, y: center.y - inset },
    { x: center.x + inset, y: center.y - inset },
    { x: center.x - inset, y: center.y + inset },
    { x: center.x + inset, y: center.y + inset },
  ];
  return points.some(p => region.testPoint({ ...p, elevation }));
}

async function _handleAoeTargeting(region) {
  const abilityUuid = region.getFlag?.('draw-steel', 'abilitySource')
    ?? foundry.utils.getProperty(region, 'flags.draw-steel.abilitySource')
    ?? foundry.utils.getProperty(region._source, 'flags.draw-steel.abilitySource');
  if (!abilityUuid) return;

  const ability = await fromUuid(abilityUuid).catch(() => null);
  if (!ability?.system) return;

  const targetType   = String(ability.system.target?.type ?? '');
  const targetCustom = ability.system.target?.custom ?? '';
  const targetLabel  = ability.system.formattedLabels?.target ?? '';
  const text         = `${targetType} ${targetCustom} ${targetLabel}`.toLowerCase();
  const isObjectAbility = targetType.includes('object') || /\bobjects?\b/.test(text);

  const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';

  if (isObjectAbility) {
    
    const defeated = (canvas.tokens?.placeables ?? []).filter(token =>
      token.actor?.statuses?.has(defeatedStatus) && _regionContainsToken(region, token),
    );
    if (!defeated.length) return;
    if (getSetting('debugMode')) console.log(`DSCT | AoE targeting | object ability: ${defeated.length} defeated token(s) will be supplemented`);
    
    await new Promise(r => setTimeout(r, 300));
    for (const token of defeated) {
      token.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
    }
  } else {
    
    
    await new Promise(resolve => {
      let timeout = setTimeout(resolve, 2000);
      const hookId = Hooks.on('targetToken', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { Hooks.off('targetToken', hookId); resolve(); }, 50);
      });
    });
    const dead = [...game.user.targets].filter(t => t.actor?.statuses?.has(defeatedStatus));
    if (!dead.length) return;
    if (getSetting('debugMode')) console.log(`DSCT | AoE targeting | removing ${dead.length} dead token(s) from targets`);
    for (const t of dead) {
      t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
    }
  }
}

function _creditPanelEffect(effect, data) {
  if (effect.parent?.documentName !== 'Actor' || data.origin || !game.modules.get(DSTD)?.active) return;
  const sameChanges = (e) => (e.changes?.length ?? 0) === (data.changes?.length ?? 0);
  const recent = game.messages.contents.slice(-30).reverse();
  for (const message of recent) {
    const use = Array.from(message.system?.parts?.contents ?? []).find((p) => p.type === 'abilityUse');
    const ability = use?.abilityUuid ? fromUuidSync(use.abilityUuid) : null;
    if (!ability?.effects) continue;
    if (!ability.effects.some((e) => e.name === data.name && (!data.img || e.img === data.img) && sameChanges(e))) continue;
    effect.updateSource({ origin: ability.uuid });
    return;
  }
}

const NEAREST_FIRST = /starting with the (?:target|creature)s? nearest to you/i;

const _abilitySaysNearest = (abilityUuid) => {
  const ability = abilityUuid ? fromUuidSync(abilityUuid) : null;
  return [...(ability?.system?.effects?.contents ?? [])].some((e) => NEAREST_FIRST.test(e.description ?? ''));
};

const _targetKey = (t) => t?.tokenUuid ?? t?.actorUuid ?? '';

function _nearestFirst(state, targets) {
  if (!Array.isArray(targets) || targets.length < 2) return null;
  if (getSetting('sortTargetsNearest') !== 'all' && !_abilitySaysNearest(state?.abilityUuid)) return null;
  const source = state?.sourceTokenUuid ? fromUuidSync(state.sourceTokenUuid)?.object : null;
  if (!source) return null;
  const reach = (t) => {
    const token = t?.tokenUuid ? fromUuidSync(t.tokenUuid)?.object : null;
    if (!token) return Infinity;
    const rise = Math.abs((source.document.elevation ?? 0) - (token.document.elevation ?? 0)) * canvas.grid.distance;
    return Math.max(tokFootprintDist(source, token), rise);
  };
  const sorted = targets.map((t) => ({ t, d: reach(t) })).sort((a, b) => a.d - b.d).map((e) => e.t);
  return sorted.some((t, i) => t !== targets[i]) ? sorted : null;
}

function _sortNewPanelTargets(message, _data, _options, userId) {
  if (userId !== game.userId) return;
  const state = message.flags?.[DSTD]?.state;
  const sorted = _nearestFirst(state, state?.targets);
  if (sorted) message.updateSource({ [`flags.${DSTD}.state.targets`]: sorted });
}

function _sortUpdatedPanelTargets(message, changes) {
  const path = `flags.${DSTD}.state.targets`;
  const flat = path in changes;
  const next = flat ? changes[path] : foundry.utils.getProperty(changes, path);
  if (!Array.isArray(next)) return;
  const stored = message.flags?.[DSTD]?.state ?? {};
  const had = new Set((stored.targets ?? []).map(_targetKey));
  if (had.size === next.length && next.every((t) => had.has(_targetKey(t)))) return;
  const sorted = _nearestFirst({ ...stored, ...(foundry.utils.getProperty(changes, `flags.${DSTD}.state`) ?? {}) }, next);
  if (!sorted) return;
  if (flat) changes[path] = sorted;
  else foundry.utils.setProperty(changes, path, sorted);
}

export function registerDstdCompat() {
  const dbg = getSetting('debugMode');
  const messageProto = foundry.documents.ChatMessage.prototype;
  if (game.modules.get(DSTD)?.active && !('user' in messageProto)) {
    Object.defineProperty(messageProto, 'user', { get() { return this.author; }, configurable: true });
  }
  Hooks.on('preCreateActiveEffect', _creditPanelEffect);
  Hooks.once('ready', () => getModuleApi(false)?.socket?.register(SPEND_HANDLER, async (uuid, cost) => {
    const actor = await fromUuid(uuid);
    if (actor) await actor.system.updateResource(-cost);
  }));
  
  Hooks.once('ready', () => Hooks.on('preCreateChatMessage', _sortNewPanelTargets));
  Hooks.on('preUpdateChatMessage', _sortUpdatedPanelTargets);

  
  registerPanelDecorator({ id: 'combat-tools-prelude', priority: 20, ignore: ['.dsct-dstd-fm-row', '.dsct-dstd-squad'], decorate: ({ message, panel }) => {
    if (!panel) return;
    _hideAnchorRows(panel);
    _installAreaDamageHook(panel, message);
    _installSquadHoverListeners(panel, message);
    filterChooseDstdRows(message, panel);
    _allowSoloCollapse(message, panel);
  } });
  registerPanelDecorator({ id: 'combat-tools-panel', priority: 50, decorate: ({ message, panel }) => {
    if (!panel) return;
    _installGlobalDamageButtons(panel, message);
    _installSquadSections(panel, message);
    _lockSweptSquadUndos(panel, message);
  } });
  registerPanelDecorator({ id: 'combat-tools-forced-movement', priority: 100, decorate: ({ message, root }) => _injectFmButtons(message, root) });
  registerPanelDecorator({ id: 'combat-tools-auto-apply', priority: 300, retry: [400], decorate: ({ message, panel }) => _autoApplyOwn(message, panel) });
  registerPanelDecorator({ id: 'combat-tools-potency-deferred', priority: 310, retry: [400], decorate: ({ message, panel }) => _applyDeferredPotency(message, panel) });
  Hooks.on('createChatMessage', (message, _options, userId) => {
    if (userId === game.user.id && getSetting('autoApplyOwnAbilities')) _autoApplyEligible.add(message.id);
  });
  services.provide('abilityResolving', _abilityResolving);

  
  
  
  
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!game.modules.get(DSTD)?.active) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | renderChatMessageHTML msgId=${message.id} hasPanel=${!!root?.querySelector(DSTD_PANEL)}`);
    if (!root) return;
    
    
    try { _seedPanelAnchor(message, root); }
    catch (err) { if (getSetting('debugMode')) console.warn('DSCT | panel anchor |', err); }
    _watchUpdateTargets(message, root);
    const msgId = message.id;
    setTimeout(() => {

      const live = root.isConnected
        ? root
        : (root.ownerDocument.querySelector(`li.chat-message[data-message-id="${msgId}"]`) ?? root);
      _injectMarkReminder(message, live);
    }, 0);
  });

  
  

  Hooks.on('createRegion', (region, _options, userId) => {
    if (userId !== game.user.id) return;
    if (!game.modules.get(DSTD)?.active) return;
    let dstdAoe = true;
    try { dstdAoe = game.settings.get(DSTD, 'aoeTargeting'); } catch {}
    if (!dstdAoe) return;
    _handleAoeTargeting(region);
  });

  Hooks.on('preCreateChatMessage', (message, _data, _options, userId) => {
    if (userId !== game.userId) return;
    if (!game.modules.get(DSTD)?.active) return;
    const parts = _getMessageParts(message);
    const abilityUuid = parts.find(p => p.abilityUuid)?.abilityUuid;
    if (!abilityUuid) return;

    const hasRolledParts = parts.some(part => {
      const rolls = Array.isArray(part.rolls) ? part.rolls : Array.from(part.rolls ?? []);
      return rolls.length > 0;
    });
    if (hasRolledParts) return;

    const ability = fromUuidSync(abilityUuid);
    if (!ability) return;
    const _keeps = chooseMessageFilter(message, ability);
    const effectsList = Array.from(ability.system?.effects?.contents ?? [])
      .filter(e => !_keeps || _keeps(e));
    const hasFlatEffects = getSetting('flatEffectsEnabled')
      && effectsList.some(e => ['dsct.flatDamage', 'dsct.flatForced', 'dsct.flatApplied', 'dsct.flatHeal', 'dsct.flatCleanse'].includes(e.type));
    if (!hasFlatEffects) return;

    const targets = Array.from(game.user.targets).map(token => {
      const doc   = token.document;
      const actor = token.actor;
      const img   = doc.texture?.src ?? doc.img ?? actor?.img ?? '';
      return {
        tokenUuid: doc.uuid,
        tokenId:   doc.id,
        sceneId:   doc.parent?.id ?? null,
        actorUuid: actor?.uuid ?? null,
        actorId:   actor?.id ?? null,
        name:      doc.name ?? '',
        tokenImg:  img,
        actorImg:  actor?.img ?? '',
        img,
      };
    });

    const speakerTokenDoc = message.speaker?.token
      ? canvas.tokens?.get(message.speaker.token)?.document
      : null;
    const speakerActor = speakerTokenDoc?.actor ?? null;
    message.updateSource({
      [`flags.${DSTD}.state`]: {
        abilityUuid,
        abilityName:        ability.name ?? '',
        sourceActorName:    speakerActor?.name ?? ability.actor?.name ?? message.speaker?.alias ?? '',
        sourceUserName:     game.user.name,
        targetingUserId:    game.user.id,
        targetingUserName:  game.user.name,
        targets,
        sourceTokenUuid:    speakerTokenDoc?.uuid ?? null,
        applications:       {},
        reactiveResults:    {},
        tierOverrides:      {},
        damageOverrides:    {},
      },
    });
  });

  
  Hooks.on('updateChatMessage', (msg, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${M}.dstdFmState`)) return;
    for (const key of [..._fmState.keys()]) if (key.startsWith(`${msg.id}:`)) _fmState.delete(key);
  });

  Hooks.on('updateChatMessage', (msg, changes) => {
    if (!game.modules.get(DSTD)?.active) return;
    if (!foundry.utils.getProperty(changes, `flags.${M}.isUndone`)) return;
    const tp = _tpUndoIndex.get(msg.id);
    if (tp) {
      _tpUndoIndex.delete(msg.id);
      _syncTeleportRow(tp, { applied: false, undoMsgId: null, distance: null });
      if (isPrimaryGM() || (!game.users.activeGM && tp.message.isOwner))
        tp.message.setFlag(M, tp.tpKey, { applied: false, undoMsgId: null, distance: null }).catch(() => {});
    }
    const entry = _fmUndoIndex.get(msg.id);
    if (!entry) return;
    const { fmRow, applyBtn, undoBtn, modBtn, quickBtn, stateKey, baseState, movementType, message, subKey, tokenUuid, flatDisplayOverride } = entry;
    _fmUndoIndex.delete(msg.id);
    const flagEntry = (message.getFlag(M, 'dstdFmState') ?? {})[subKey];
    const cur = _fmState.get(stateKey)
      ?? (flagEntry
        ? { applied: flagEntry.applied ?? false, undoMsgId: flagEntry.undoMsgId ?? null, modStack: (flagEntry.modStack ?? []).map(e => ({ ...e })) }
        : { applied: false, undoMsgId: msg.id, modStack: [] });
    const newState = { ...cur, applied: false };
    _fmState.set(stateKey, newState);
    const eff = _effectiveState(baseState, newState.modStack);
    _syncRow(fmRow, applyBtn, undoBtn, modBtn, newState, _flatFmLabel(flatDisplayOverride, eff), _stabInfo(tokenUuid, eff), !!flatDisplayOverride);
    if (quickBtn) _syncQuickBtn(quickBtn, newState, movementType, eff.distance);
    if (flagEntry?.applied) _persistDstdState(message, subKey, newState);
  });

  if (dbg) console.log('DSCT | DSTD compat | registered on the CTLib panel pipeline');
}

const _collapseKey = (msgId) => `dsct-dstd-collapse-${msgId}`;

const _SWEEP_TOASTS = {
  applied:  ['DSTD.Notify.DealtDamage', 'DSTD.Notify.DealtTypedDamage', 'DSTD.Notify.HealedTarget'],
  reverted: ['DSTD.Notify.UndoneDamage', 'DSTD.Notify.UndoneHealing'],
};

let _toastPatterns = null;
const _sweepPatterns = () => {
  if (_toastPatterns) return _toastPatterns;
  const build = (key) => new RegExp('^' + game.i18n.localize(key)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{\w+\\\}/g, '.+?') + '$');
  _toastPatterns = {
    applied:  _SWEEP_TOASTS.applied.map(build),
    reverted: _SWEEP_TOASTS.reverted.map(build),
  };
  return _toastPatterns;
};

const _withOneToast = async (fn) => {
  const notes = ui.notifications;
  if (!notes?.notify) return fn();

  const original = notes.notify;
  const caught = { applied: 0, reverted: 0 };
  let only = null;

  notes.notify = function (message, type, options) {
    if (typeof message === 'string') {
      const pat = _sweepPatterns();
      for (const kind of ['applied', 'reverted']) {
        if (pat[kind].some((re) => re.test(message))) {
          caught[kind]++;
          only = only === null ? { message, type, options } : undefined;
          
          console.log(`DSCT | DSTD | ${message}`);
          return null;
        }
      }
    }
    return original.call(this, message, type, options);
  };

  try { return await fn(); }
  finally {
    notes.notify = original;
    const total = caught.applied + caught.reverted;
    if (total === 1 && only) original.call(notes, only.message, only.type, only.options);
    else if (total > 1) {
      const key = caught.reverted > caught.applied ? 'DSCT.notice.dstd.sweepReverted' : 'DSCT.notice.dstd.sweepApplied';
      original.call(notes, game.i18n.format(key, { count: total }), 'info');
    }
  }
};

const _autoApplyEligible = new Set();

async function _autoApplyOwn(message, panel) {
  if (!panel || !_autoApplyEligible.has(message.id)) return;
  if (!getSetting('autoApplyOwnAbilities') || message.getFlag(M, 'autoApplied')) return void _autoApplyEligible.delete(message.id);
  const rows = [...panel.querySelectorAll(DSTD_ROW)].filter(r => r.dataset.targetKey && r.dataset.targetKey !== 'selected-token');
  const autoEnrichers = !!panel.closest('li.chat-message')?.querySelector('enriched-content.dsct-adv[data-adv-auto]');
  if (!autoEnrichers && !rows.some(r => _effectRows(r).some(_autoButton))) return;
  const abilityUuid = _getMessageParts(message).find(p => p.abilityUuid)?.abilityUuid ?? message.flags?.[DSTD]?.state?.abilityUuid;
  const ability = abilityUuid ? fromUuidSync(abilityUuid) : null;
  _autoApplyEligible.delete(message.id);
  if (!isOwnAbilityActor(ability?.actor)) return;
  await safeSetFlag(message, M, 'autoApplied', true);
  if (getSetting('potencyChecks') === 'apply') _potencyWatch.set(message.id, new Set());
  _autoRunning.add(message.id);
  try {
    await new Promise(r => setTimeout(r, AUTO_APPLY_SETTLE_MS));
    const squadsOnCard = rows.map(r => _squadOfRow(r)?.id).filter(Boolean);
    await _applyEffectsInOrder(message.id, panel.ownerDocument, { safe: true });
    await _noteSquadsSwept(message, squadsOnCard);
  } finally {
    _autoRunning.delete(message.id);
  }
}

const PROMPT_WAIT_MS = 120000;

const _promptOpen = () => !!document.getElementById('dsct-picker-topbar')
  || document.body.classList.contains('dsct-picker-lock')
  || !!document.getElementById('dsct-vertical-popup')
  || [...foundry.applications.instances.values()].some(a => a.rendered
    && (a instanceof foundry.applications.api.DialogV2 || /^(TargetedConditionPrompt|DefeatedMinionSelection)$/.test(a.constructor.name)));

const _sourceOnCanvas = (message) => {
  const uuid = message?.flags?.[DSTD]?.state?.sourceTokenUuid;
  return !!(uuid && fromUuidSync(uuid)?.object);
};

const _wouldPrompt = (actionRow, btn, message) => {
  const targetRow = actionRow.closest(DSTD_ROW);
  const status = (btn.dataset.dsctDstdCond ?? '').match(/:cond:([\w-]+)$/)?.[1]
    ?? (btn.dataset.dsctEnrichKey ?? '').match(/:enrich:([\w-]+)$/)?.[1]
    ?? btn.dataset.dsctStatus ?? null;
  if (status && SOURCED_STATUSES.has(status)) {
    if (!getSetting('conditionsEnabled')) return true;
    const others = canvas.tokens.controlled.filter(t => t.document.uuid.replace(/\./g, '__') !== targetRow?.dataset.targetKey).length;
    if ((btn.dataset.dsctStatus || !_sourceOnCanvas(message)) && others !== 1) return true;
  }
  if (actionRow.classList.contains('dsct-dstd-fm-row')) {
    if (/\b(Vertical|Slide)\b/.test(btn.textContent) || targetRow?.dataset.targetKey === 'selected-token') return true;
    if (!_sourceOnCanvas(message) && canvas.tokens.controlled.length !== 1) return true;
  }
  return false;
};

const AUTO_APPLY_SETTLE_MS = 600;
const FM_SETTLE_MAX_MS = 15000;
const NOT_APPLY = new Set(['undoDamage', 'undoStatus', 'editDamage', 'editRoll', 'updateTargets', 'rollReactive']);

const _effectRows = (targetRow) => [...targetRow.querySelectorAll(`.${DSTD}-action-row`)].filter(r => !r.classList.contains('dsct-dstd-global-row'));

const POTENCY_TEXT = /\{\{\s*potency\s*\}\}/i;

const _tierHasPotency = (powerEffect, tier) => {
  let display = '';
  let characteristic = null;
  for (let i = Number(tier); i >= 1; i--) {
    const data = powerEffect?.applied?.[`tier${i}`];
    display ||= String(data?.display ?? '').trim();
    if (!characteristic && ds.CONFIG.characteristics?.[data?.potency?.characteristic]) characteristic = data.potency.characteristic;
  }
  return !!characteristic && POTENCY_TEXT.test(display);
};

const _tierEffectIds = (powerEffect, tier) => {
  const effects = powerEffect?.applied?.[`tier${tier}`]?.effects;
  return effects instanceof Map ? [...effects.keys()] : Object.keys(effects ?? {});
};

const _statusHasPotency = (btn, message) => {
  const uuid = (message?.system?.parts?.contents ?? []).find(p => p.abilityUuid)?.abilityUuid;
  const ability = uuid ? fromUuidSync(uuid) : null;
  const tier = Number(btn.dataset.tier);
  if (!ability || !tier) return false;
  return (ability.system?.power?.effects ?? []).some(e => e.type === 'applied'
    && _tierEffectIds(e, tier).includes(btn.dataset.effectId) && _tierHasPotency(e, tier));
};

const _rowMessage = (actionRow, message) => message ?? game.messages.get(actionRow.closest('li.chat-message')?.dataset.messageId);

const TRIGGERS_ID = 'draw-steel-triggers';
const HELD_KINDS = new Set(['held', 'damageHeld', 'resolutionHeld']);
const HOLD_GRACE_MS = 150;
const HOLD_WAIT_MS = 600000;

const _heldNow = (msgId) => !!game.modules.get(TRIGGERS_ID)?.api?.getQueueMirror?.()?.some(e => HELD_KINDS.has(e.kind))
  || Object.values(game.messages.get(msgId)?.flags?.[DSTD]?.state?.applications ?? {}).some(a => a?.dstHeld);

const _waitForChoice = async (msgId) => {
  const pending = () => { const m = game.messages.get(msgId); return !!m && chooseAfterPending(m); };
  if (!pending()) return true;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const until = Date.now() + HOLD_WAIT_MS;
  while (pending() && Date.now() < until) await wait(200);
  if (pending()) return false;
  await wait(AUTO_APPLY_SETTLE_MS);
  return true;
};

export const _waitForHolds = async (msgId) => {
  if (!game.modules.get(TRIGGERS_ID)?.active) return true;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(HOLD_GRACE_MS);
  const until = Date.now() + HOLD_WAIT_MS;
  while (_heldNow(msgId) && Date.now() < until) await wait(200);
  return !_heldNow(msgId);
};

const _damageHeld = (actionRow, message) => {
  const opId = actionRow.closest(DSTD_ROW)?.querySelector('button[data-dstd-action="applyDamage"]')?.dataset.operationId;
  return !!(opId && _rowMessage(actionRow, message)?.flags?.[DSTD]?.state?.applications?.[opId]?.dstHeld);
};

const _potencyWatch = new Map();
const _autoRunning = new Set();

const _autoButton = (actionRow, safe = false, message = null) => {
  if (!actionRow || actionRow.matches('[data-dsct-manual]')) return null;

  const verdict = getSetting('potencyChecks') === 'apply' ? actionRow.dataset.dsctPotencyVerdict ?? null : null;
  if (verdict === 'resisted' || (verdict !== 'affected' && actionRow.matches('[data-dsct-potency]'))) return null;
  if (verdict === 'affected' && _damageHeld(actionRow, message)) return null;
  const btn = [...actionRow.children].find(c => c.tagName === 'BUTTON');
  if (!btn || btn.disabled || NOT_APPLY.has(btn.dataset.dstdAction) || btn.classList.contains(`${DSTD}-undo-button`)) return null;
  if (btn.dataset.dstdAction === 'applyStatus' && verdict !== 'affected' && _statusHasPotency(btn, message)) return null;
  if (actionRow.classList.contains('dsct-dstd-fm-row') && !/\bAuto\b/.test(btn.textContent)) return null;
  if (safe && _wouldPrompt(actionRow, btn, message)) return null;
  return btn;
};

const _rowKey = (actionRow) => {
  const btn = [...actionRow.children].find(c => c.tagName === 'BUTTON');
  return btn?.dataset.operationId ?? btn?.dataset.dsctFlatCondKey ?? btn?.dataset.dsctDstdCond ?? null;
};

async function _applyDeferredPotency(message, panel) {
  const tried = _potencyWatch.get(message.id);  if (!panel || !tried || _autoRunning.has(message.id)) return;
  if (getSetting('potencyChecks') !== 'apply') return void _potencyWatch.delete(message.id);
  let waiting = false;
  for (const row of panel.querySelectorAll(DSTD_ROW)) {
    for (const actionRow of _effectRows(row)) {
      const key = _rowKey(actionRow);
      if (!key || tried.has(key)) continue;
      if (actionRow.classList.contains('is-applied')) { tried.add(key); continue; }
      const verdict = actionRow.dataset.dsctPotencyVerdict;
      const first = [...actionRow.children].find(c => c.tagName === 'BUTTON');
      const potencyRow = !!verdict || actionRow.matches('[data-dsct-potency]')
        || (first?.dataset.dstdAction === 'applyStatus' && _statusHasPotency(first, message));
      if (!potencyRow) continue;
      if (!verdict || _damageHeld(actionRow, message)) { waiting = true; continue; }
      if (verdict !== 'affected') continue;
      const btn = _autoButton(actionRow, true, message);
      if (!btn) continue;
      tried.add(key);
      return void btn.click();
    }
  }
  if (!waiting) _potencyWatch.delete(message.id);
}

const _resolving = new Set();

const _abilityResolving = (item) => {
  const message = game.messages.contents.findLast(m => _getMessageParts(m).some(p => p.abilityUuid === item?.uuid));
  return !!message && (_resolving.has(message.id) || !!services.get('areaEnrichersPending')?.(message));
};

const _applyEffectsInOrder = (msgId, msgDoc, opts) => {
  _resolving.add(msgId);
  return _applyInOrder(msgId, msgDoc, opts).finally(() => _resolving.delete(msgId));
};

const _applyInOrder = (msgId, msgDoc, { safe = false } = {}) => _withOneToast(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const panelNow = () => msgDoc.querySelector(`li.chat-message[data-message-id="${msgId}"]`)?.querySelector(DSTD_PANEL);
  const rowOf = (key) => panelNow()?.querySelector(`${DSTD_ROW}[data-target-key="${CSS.escape(key)}"]`);
  const actionAt = (key, col) => (rowOf(key) ? _effectRows(rowOf(key))[col] : null);
  let keys = [];
  const targetsBefore = [...game.user.targets].map(t => t.id);
  const runColumn = (col) => damageBatch(async () => {
    let anyRow = false;
    let damaged = false;
    for (const key of keys) {
      const actionRow = actionAt(key, col);
      if (!actionRow) continue;
      anyRow = true;
      const message = game.messages.get(msgId);
      const btn = _autoButton(actionRow, safe, message);
      if (!btn) continue;
      const isFm = actionRow.classList.contains('dsct-dstd-fm-row');
      const before = applicationSignature(message);
      if (btn.dataset.dstdAction === 'applyDamage') damaged = true;
      btn.click();
      if (isFm) {
        await wait(150);
        const until = Date.now() + FM_SETTLE_MAX_MS;
        while ((window._dsctFMActive || actionAt(key, col)?.classList.contains('is-executing')) && !_promptOpen() && Date.now() < until) await wait(50);
      } else if (btn.dataset.dstdAction) {
        await _dstdRowLanded(btn);
      } else {
        const until = Date.now() + ROW_SETTLE_MAX_MS;
        while (Date.now() < until && applicationSignature(game.messages.get(msgId)) === before
          && _autoButton(actionAt(key, col))) await wait(25);
      }
      const promptUntil = Date.now() + PROMPT_WAIT_MS;
      while (_promptOpen() && Date.now() < promptUntil) await wait(100);
      if (_promptOpen()) return { stop: true };
      if (!(await _waitForHolds(msgId))) return { stop: true };
      await wait(ROW_REDRAW_MS);
    }
    return { anyRow, damaged };
  });
  
  try {
    if (!(await _waitForHolds(msgId))) return;
    if (await settleCriticalChoice(game.messages.get(msgId))) await wait(AUTO_APPLY_SETTLE_MS);
    if (!(await _waitForChoice(msgId))) return;
    if (await services.get('settleChainTargets')?.(game.messages.get(msgId))) await wait(AUTO_APPLY_SETTLE_MS);
    const apply =(phase) => services.get('applyAutoEnrichers')?.(game.messages.get(msgId), msgDoc, phase);
    let damagedAny = !!(await damageBatch(() => apply('damage')));
    if (damagedAny && !(await _waitForHolds(msgId))) return;
    keys = [...(panelNow()?.querySelectorAll(DSTD_ROW) ?? [])].map(r => r.dataset.targetKey).filter(k => k && k !== 'selected-token');
    for (let col = 0; ; col++) {
      const { stop, anyRow, damaged } = await runColumn(col);
      if (stop) return;
      if (!anyRow) break;
      damagedAny ||= damaged;
      if (damaged && keys.some(key => actionAt(key, col + 1))) await services.get('settleDeaths')?.();
    }
    if (damagedAny) await services.get('settleDeaths')?.();
    await apply('rest');
  } finally {
    if (canvas.ready) {
      const keep = new Set(targetsBefore);
      for (const t of [...game.user.targets]) if (!keep.has(t.id)) t.setTarget(false, { releaseOthers: false, groupSelection: true });
      for (const id of keep) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false, groupSelection: true });
    }
  }
});

const ROW_SETTLE_MAX_MS = 500;
const ROW_REDRAW_MS = 60;
const ROW_LAND_MAX_MS = 10000;

const _dstdRowLanded = async (btn) => {
  const until = Date.now() + ROW_LAND_MAX_MS;
  while (Date.now() < until && btn.isConnected && btn.disabled && !_promptOpen()) await new Promise(r => setTimeout(r, 25));
};

const _clickRowsSequentially = (msgId, msgDoc, getBtn, onlyKeys = null, unlock = false) => damageBatch(() => _withOneToast(async () => {
  
  if (unlock) _squadSweepRunning = true;
  try {
  const processed = new Set();
  while (true) {
    const li = msgDoc.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
    const cur = li?.querySelector(DSTD_PANEL);
    if (!cur) break;
    let clicked = false;
    for (const row of cur.querySelectorAll(DSTD_ROW)) {
      const key = row.dataset.targetKey;
      if (processed.has(key)) continue;
      if (onlyKeys && !onlyKeys.has(key)) continue;
      const btn = getBtn(row);
      if (btn && !btn.disabled) {
        processed.add(key);
        
        const before = applicationSignature(game.messages.get(msgId));
        btn.click();
        clicked = true;
        if (btn.dataset.dstdAction) await _dstdRowLanded(btn);
        const until = Date.now() + ROW_SETTLE_MAX_MS;
        while (Date.now() < until && applicationSignature(game.messages.get(msgId)) === before) {
          await new Promise(r => setTimeout(r, 25));
        }
        
        await new Promise(r => setTimeout(r, ROW_REDRAW_MS));
        break;
      }
      processed.add(key);
    }
    if (!clicked) break;
  }
  } finally {
    if (unlock) _squadSweepRunning = false;
  }
}));

const _canUndoAll = (rows, message) => {
  if (game.user.isGM) return true;
  const damaged = rows.filter(r => r.querySelector(`.${DSTD}-damage-row.is-applied, .${DSTD}-damage-row.has-stack`));
  const undoOf = (r) => r.querySelector('[data-dstd-action="undoDamage"]');
  if (!damaged.every(r => undoOf(r) && !undoOf(r).disabled)) return false;
  const uuid = (message?.system?.parts?.contents ?? []).find(p => p.abilityUuid)?.abilityUuid;
  if (uuid && fromUuidSync(uuid)?.isOwner) return true;
  const records = message?.flags?.[DSTD]?.state?.applications ?? {};
  return damaged.every((r) => {
    const record = records[undoOf(r).dataset.operationId];
    return (record?.appliedByUserId ?? record?.stack?.at?.(-1)?.appliedByUserId) === game.user.id;
  });
};

function _installGlobalDamageButtons(panel, message) {
  panel.querySelector('.dsct-dstd-global-row')?.remove();

  const targetRows = [...panel.querySelectorAll(DSTD_ROW)];
  if (targetRows.length <= 1) return;

  const undoBtns  = targetRows.map(r => r.querySelector('[data-dstd-action="undoDamage"]')).filter(Boolean);
  const anyApplyEnabled = targetRows.some(r => _effectRows(r).some(_autoButton));
  const anyUndoEnabled  = undoBtns.some(b => !b.disabled) && _canUndoAll(targetRows, message);
  if (!anyApplyEnabled && !anyUndoEnabled) return;

  const msgId  = message.id;
  const msgDoc = panel.ownerDocument;

  const _clickSequentially = (getBtn, unlock = false) => _clickRowsSequentially(msgId, msgDoc, getBtn, null, unlock);

  const applyAllBtn = document.createElement('button');
  applyAllBtn.type = 'button';
  applyAllBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
  applyAllBtn.disabled = !anyApplyEnabled;
  _tip(applyAllBtn, 'applyAll');
  applyAllBtn.append(_makeIcon('fa-solid fa-check-double'), _makeSpan('Apply All'));

  const undoAllBtn = document.createElement('button');
  undoAllBtn.type = 'button';
  undoAllBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
  undoAllBtn.disabled = !anyUndoEnabled;
  _tip(undoAllBtn, 'undoAll');
  undoAllBtn.append(_makeIcon('fa-solid fa-rotate-left'));

  applyAllBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    if (applyAllBtn.disabled) return;
    applyAllBtn.disabled = true;

    const squadsOnCard = targetRows.map(r => _squadOfRow(r)?.id).filter(Boolean);
    await _applyEffectsInOrder(msgId, msgDoc);
    await _noteSquadsSwept(message, squadsOnCard);
  });

  undoAllBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    if (undoAllBtn.disabled || !_canUndoAll(targetRows, game.messages.get(msgId))) return;
    undoAllBtn.disabled = true;
    const squadsOnCard = targetRows.map(r => _squadOfRow(r)?.id).filter(Boolean);
    await _clickSequentially(row => row.querySelector('[data-dstd-action="undoDamage"]'), true);
    await _clearSquadsSwept(message, squadsOnCard);
  });

  const globalRow = document.createElement('div');
  globalRow.className = `${DSTD}-action-row dsct-dstd-global-row`;
  globalRow.append(applyAllBtn, undoAllBtn);

  
  
  
  const targetList = panel.querySelector(`.${DSTD}-target-list`);
  if (targetList) panel.insertBefore(globalRow, targetList);
  else panel.appendChild(globalRow);
}

const _squadKey = (msgId) => `dsct-dstd-squads-${msgId}`;

const _squadStateRead = (msgId) => {
  try { return JSON.parse(localStorage.getItem(_squadKey(msgId))) ?? {}; } catch { return {}; }
};

const _squadStateWrite = (msgId, panel) => {
  const state = {};
  for (const sec of panel.querySelectorAll('.dsct-dstd-squad')) state[sec.dataset.groupId] = sec.open;
  try {
    if (Object.keys(state).length) localStorage.setItem(_squadKey(msgId), JSON.stringify(state));
    else localStorage.removeItem(_squadKey(msgId));
  } catch {  }
};

const _squadOfRow = (row) => {
  const key = row?.dataset?.targetKey;
  if (!key || key === 'selected-token') return null;
  const doc = fromUuidSync(key.replace(/__/g, '.'));
  const tokenId = doc?.id;
  if (!tokenId) return null;

  const groupId = game.combat?.combatants.find(c => c.tokenId === tokenId)?._source?.group
    ?? services.get('deathSavedSquad')?.(doc)
    ?? null;
  if (!groupId) return null;

  const group = game.combat?.groups?.get(groupId);
  if (group && group.type !== 'squad') return null;
  return { id: groupId, name: group?.name ?? game.i18n.localize('DSCT.chat.squads.squadSectionFallback') };
};

function _unwrapSquadSections(list) {
  for (const sec of [...list.querySelectorAll('.dsct-dstd-squad')]) {
    for (const row of [...sec.querySelectorAll(DSTD_ROW)]) list.insertBefore(row, sec);
    sec.remove();
  }
}

const _sweptSquads = (message) => new Set(message?.flags?.[M]?.sweptSquads ?? []);

const _writeSwept = async (message, ids) => {
  const payload = { [`flags.${M}.sweptSquads`]: ids };
  if (game.user.isGM || message.isOwner) await message.update(payload).catch(() => {});
  else safeUpdate(message, payload);
};

const _noteSquadsSwept = async (message, groupIds) => {
  const ids = [...new Set([...(_sweptSquads(message)), ...groupIds])].filter(Boolean);
  if (!ids.length) return;
  await _writeSwept(message, ids);
};

const _clearSquadsSwept = async (message, groupIds) => {
  const drop = new Set(groupIds.filter(Boolean));
  const left = [...(_sweptSquads(message))].filter(id => !drop.has(id));
  if (left.length === _sweptSquads(message).size) return;
  await _writeSwept(message, left);
};

let _squadSweepRunning = false;
let _lockedUndoGuard = false;

const _guardLockedUndos = () => {
  if (_lockedUndoGuard) return;
  _lockedUndoGuard = true;
  document.addEventListener('click', (e) => {
    if (_squadSweepRunning) return;
    const btn = e.target?.closest?.('.dsct-squad-undo-locked');
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ui.notifications.info(game.i18n.format('DSCT.tooltip.undoWholeSquad', { group: btn.dataset.dsctSquadName ?? '' }));
  }, true);
};

function _lockSweptSquadUndos(panel, message) {
  _guardLockedUndos();
  const swept = _sweptSquads(message);
  for (const row of panel.querySelectorAll(DSTD_ROW)) {
    const squad = _squadOfRow(row);
    const undo = row.querySelector('[data-dstd-action="undoDamage"]');
    if (!undo) continue;
    if (!squad || !swept.has(squad.id)) { undo.classList.remove('dsct-squad-undo-locked'); continue; }
    undo.classList.add('dsct-squad-undo-locked');
    undo.dataset.dsctSquadName = squad.name;
    _tip(undo, 'squadUndoLocked', { data: { group: squad.name } });
  }
}

function _installSquadButtons(hdr, message, panel, squad) {
  const keys = new Set(squad.rows.map(r => r.dataset.targetKey));
  const msgId = message.id;
  const msgDoc = panel.ownerDocument;

  const enabled = (action) => (action !== 'undoDamage' || _canUndoAll(squad.rows, message)) && squad.rows.some((r) => {
    const b = r.querySelector(`[data-dstd-action="${action}"]`);
    return b && !b.disabled;
  });

  const make = (cls, icon, tooltip, action, extra = '') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${DSTD}-icon-button dsct-dstd-squad-btn ${cls} ${extra}`.trim();
    _tip(btn, tooltip, { data: { group: squad.name } });
    btn.disabled = !enabled(action);
    btn.append(_makeIcon(icon));
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      await _clickRowsSequentially(msgId, msgDoc, row => row.querySelector(`[data-dstd-action="${action}"]`), keys, action === 'undoDamage');

      
      if (action === 'applyDamage') {
        await _noteSquadsSwept(message, [squad.id]);
        services.get('resolveDeathsNow')?.();
      } else {
        await _clearSquadsSwept(message, [squad.id]);
      }
    });
    return btn;
  };

  hdr.append(
    make('dsct-dstd-squad-apply', 'fa-solid fa-check-double', 'squadApply', 'applyDamage'),
    make('dsct-dstd-squad-undo', 'fa-solid fa-rotate-left', 'squadUndo', 'undoDamage', `${DSTD}-undo-button`),
  );
}

function _installSquadSections(panel, message) {
  const list = panel.querySelector(`.${DSTD}-target-list`);
  if (!list) return;

  if (!getSetting('squadToolsEnabled') || !getSetting('dstdSquadSections')) {
    _unwrapSquadSections(list);
    delete list.dataset.dsctSquadSig;
    return;
  }

  const rows = [...list.querySelectorAll(DSTD_ROW)];

  
  const want = rows.map(r => `${r.dataset.targetKey}:${_squadOfRow(r)?.id ?? ''}`).sort().join('|');
  if (list.dataset.dsctSquadSig === want) return;

  _unwrapSquadSections(list);
  list.dataset.dsctSquadSig = want;
  if (rows.length <= 1) return;

  const squads = new Map();
  for (const row of rows) {
    const squad = _squadOfRow(row);
    if (!squad) continue;
    if (!squads.has(squad.id)) squads.set(squad.id, { ...squad, rows: [] });
    squads.get(squad.id).rows.push(row);
  }

  const saved = _squadStateRead(message.id);
  const openByDefault = !!getSetting('dstdSquadSectionsOpen');

  for (const [groupId, squad] of squads) {

    if (squad.rows.length < 2) continue;

    const section = document.createElement('details');
    section.className = 'dsct-dstd-squad';
    section.dataset.groupId = groupId;
    section.open = saved[groupId] ?? openByDefault;

    const hdr = document.createElement('summary');
    hdr.className = 'dsct-dstd-squad-hdr';

    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-right dsct-dstd-squad-chevron';
    hdr.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'dsct-dstd-squad-label';
    label.textContent = squad.name;
    hdr.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'dsct-dstd-squad-badge';
    badge.textContent = String(squad.rows.length);
    hdr.appendChild(badge);

    _installSquadButtons(hdr, message, panel, squad);
    section.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'dsct-dstd-squad-rows';
    section.appendChild(body);

    list.insertBefore(section, squad.rows[0]);
    for (const row of squad.rows) body.appendChild(row);

    section.addEventListener('toggle', () => _squadStateWrite(message.id, panel));
  }
}

function _saveCollapseState(msgId, panel) {
  const state = {};
  for (const row of panel.querySelectorAll(DSTD_ROW)) {
    state[row.dataset.targetKey] = row.classList.contains('is-collapsed');
  }
  if (Object.keys(state).length) localStorage.setItem(_collapseKey(msgId), JSON.stringify(state));
  else localStorage.removeItem(_collapseKey(msgId));
}

function _restoreCollapseState(msgId, panel) {
  let state;
  try { state = JSON.parse(localStorage.getItem(_collapseKey(msgId))); } catch { return; }
  if (!state) return;
  for (const row of panel.querySelectorAll(DSTD_ROW)) {
    const saved = state[row.dataset.targetKey];
    if (saved !== undefined) row.classList.toggle('is-collapsed', saved);
  }
}

function _getMessageParts(message) {
  const parts = message?.system?.parts;
  if (!parts) return [];
  if (Array.isArray(parts)) return parts;
  if (typeof parts.values === 'function') return Array.from(parts.values());
  return Object.values(parts);
}

async function _restoreGainResource(message, root, ability, tier) {
  if (!tier || !ability) return;
  if (!document.body.classList.contains(`${DSTD}-hide-system`)) return;
  const effects = ability.system?.power?.effects?.documentsByType?.resource ?? [];
  if (!effects.length) return;

  const section = root.querySelector(`section[data-message-part="${'abilityUse'.padEnd(16, '0')}"]`);
  if (!section) return;
  let footer = section.querySelector('footer.message-part-buttons');
  if (!footer) {
    footer = document.createElement('footer');
    footer.className = 'message-part-buttons';
    section.appendChild(footer);
  }

  for (const effect of effects) {
    const { amount, type } = effect.resource?.[`tier${tier}`] ?? {};
    if (!amount || !type) continue;
    const key = `dsct-gain-${effect.id}`;
    if (footer.querySelector(`[data-dsct-gain="${key}"]`)) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-flat-resource-btn';
    btn.dataset.dsctGain = key;
    btn.innerHTML = `<i class="fa-solid fa-bolt"></i> ${effect.constructButtons(tier)?.[0]?.textContent?.trim() ?? `${amount} ${type}`}`;
    btn.addEventListener('click', async () => {
      const live = await fromUuid(effect.uuid).catch(() => null);
      if (!live?.applyGain) return;
      try { await live.applyGain(`tier${tier}`); }
      catch (err) { ui.notifications.warn(err.message); }
    });
    footer.appendChild(btn);
  }
}

export function _effectiveRowTier(message, targetKey, tokenUuid, fallbackTier) {
  const ov = foundry.utils.getProperty(message.flags, `${DSTD}.state.tierOverrides.${targetKey}`);
  const ovTier = Number(ov?.tier);
  if (ovTier >= 1 && ovTier <= 3) return ovTier;
  const actorUuid = tokenUuid ? fromUuidSync(tokenUuid)?.actor?.uuid : null;
  if (actorUuid) {
    for (const part of _getMessageParts(message)) {
      if (part.type !== 'abilityResult') continue;
      const roll = Array.from(part.rolls ?? []).reverse().find(r => r?.options?.target === actorUuid);
      if (roll) {
        const t = Number(part.tier);
        if (t >= 1 && t <= 3) return t;
      }
    }
  }
  return fallbackTier;
}

function _getMessageTier(message) {
  for (const part of _getMessageParts(message)) {
    if (part.type !== 'abilityResult') continue;
    const tier = Number(part.tier);
    if (tier >= 1 && tier <= 3) return tier;
  }
  return null;
}

function _seedPanelAnchor(message, root) {
  if (!getSetting('flatEffectsEnabled')) return;
  if (root.querySelector(DSTD_PANEL)) return;
  if (message.getFlag(DSTD, 'state')) return;
  if (root.querySelector(`.${PANEL_ANCHOR}`)) return;

  const abilityUuid = _getMessageParts(message).find(p => p.abilityUuid)?.abilityUuid;
  if (!abilityUuid) return;
  const ability = fromUuidSync(abilityUuid);
  const effects = ability?.system?.effects?.contents ?? [];
  
  
  if (!effects.some(e => String(e?.type ?? '').startsWith('dsct.flat'))) return;

  const anchor = document.createElement('a');
  anchor.className = `roll-link ${PANEL_ANCHOR}`;
  anchor.dataset.type = 'custom';
  anchor.dataset.uuid = PANEL_ANCHOR;
  anchor.hidden = true;
  anchor.style.display = 'none';

  const section = root.querySelector(`section[data-message-part="${'abilityUse'.padEnd(16, '0')}"]`)
    ?? root.querySelector('.message-content')
    ?? root;
  section.appendChild(anchor);
}

function _hideAnchorRows(panel) {
  for (const btn of panel.querySelectorAll(`[data-effect-id="${PANEL_ANCHOR}"]`)) {
    const row = btn.closest(`.${DSTD}-action-row`);
    if (row) row.remove();
  }
}

function _injectMarkReminder(message, live) {
  if (!message.getFlag(M, 'markReminder')) return;
  const panel = live.querySelector(DSTD_PANEL);
  if (!panel) return;
  for (const row of panel.querySelectorAll(`.${DSTD}-status-row`)) {
    row.style.display = 'none';
  }
}

function _syncResourceRow({ resRow, resBtn, undoBtn, label, compact }, state) {
  const applied = !!state?.applied;
  resBtn.disabled = applied;
  resRow.classList.toggle('is-applied', applied);
  if (compact) resBtn.dataset.dsctCompact = compact;
  const text = applied ? resourceAppliedLabel(state) : label;
  if (applied) _appliedTip(resBtn, 'resource', text);
  else _tip(resBtn, 'resource', { title: text });
  const span = resBtn.querySelector('span');
  if (span) span.textContent = text;
  undoBtn.disabled = !applied;
}

function _syncTeleportRow({ tpRow, tpBtn, undoBtn, label }, state) {
  const applied = !!state?.applied;
  tpBtn.disabled = applied;
  tpRow.classList.toggle('is-applied', applied);
  const text = !applied ? label
    : (state.distance == null
      ? game.i18n.localize('DSCT.FlatEffect.Teleport.applied')
      : game.i18n.format('DSCT.FlatEffect.Teleport.appliedDist', { distance: state.distance }));
  if (applied) _appliedTip(tpBtn, 'teleport', text);
  else _tip(tpBtn, 'teleport', { title: text });
  const span = tpBtn.querySelector('span');
  if (span) span.textContent = text;
  undoBtn.disabled = !applied || !state?.undoMsgId;
  undoBtn.dataset.dsctTpMsgId = state?.undoMsgId ?? '';
}

function _makeIcon(cls) {
  const i = document.createElement('i');
  i.className = cls;
  return i;
}

function _makeSpan(text) {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

function _buildBaseState(movementType, distance, properties, verticalDistance, fallReduction) {
  return {
    movement:          movementType,
    distance:          distance,
    vertical:          properties.has('vertical'),
    verticalDistance:  verticalDistance > 0 ? verticalDistance : '',
    fallReduction:     fallReduction,
    noFallDamage:              false,
    noCollisionDamage:         properties.has('no-collision-damage'),
    noMoverCollisionDamage:    properties.has('no-mover-collision-damage'),
    noObstacleCollisionDamage:  properties.has('no-obstacle-collision-damage'),
    ignoreStability:           properties.has('ignore-stability'),
    fastMove:          properties.has('fast-auto-path'),
    sourceTokenId:     null,
  };
}

const _spendSuffix = (spend) => (spend?.enabled
  ? ` ${game.i18n.format('DSCT.FlatEffect.spend.costSuffix', { cost: spend.value ?? 1 })}`
  : '');

function _flatFmLabel(override, state) {
  if (!override) return _makeLabel(state);
  const named = /\d/.test(override) ? override : `${override} ${state.distance}`;
  return state.fastMove ? `Auto ${named}` : named;
}

function _makeLabel(state) {
  return [
    state.fastMove ? 'Auto' : '',
    state.vertical ? (state.verticalDistance ? `Vertical ${state.verticalDistance}` : 'Vertical') : '',
    `${state.movement.charAt(0).toUpperCase() + state.movement.slice(1)} ${state.distance}`,
  ].filter(Boolean).join(' ');
}

function _effectiveState(baseState, modStack) {
  if (!modStack?.length) return { ...baseState };
  const s = { ...baseState };
  replayModifiers([baseState], modStack, [s]);
  return s;
}

function _fmQuickIcon(movementType) {
  switch (movementType) {
    case 'pull':  return 'fa-solid fa-left-long';
    case 'slide': return 'fa-solid fa-arrows-left-right';
    default:      return 'fa-solid fa-right-long'; 
  }
}

function _getHolyRolls(message) {
  const result = [];
  for (const part of _getMessageParts(message)) {
    const rolls = Array.isArray(part.rolls) ? part.rolls : Array.from(part.rolls ?? []);
    for (const roll of rolls) {
      if (roll?.type === 'holy' && !roll?.isHeal) result.push({ amount: roll.total });
    }
  }
  return result;
}

function _syncQuickBtn(btn, state, movementType, distance) {
  if (state.applied) {
    btn.disabled = true;
    btn.replaceChildren(_makeIcon('fa-solid fa-check'));
    _tip(btn, 'fmQuickApplied');
  } else {
    btn.disabled = false;
    btn.replaceChildren(_makeIcon(_fmQuickIcon(movementType)), _makeSpan(String(distance)));
    _tip(btn, 'fmQuick', { title: `${movementType.charAt(0).toUpperCase() + movementType.slice(1)} ${distance}` });
  }
}

function _stabInfo(tokenUuid, effState) {
  const actor = tokenUuid ? fromUuidSync(tokenUuid)?.actor : null;
  return { stab: actor?.system?.combat?.stability ?? 0, ignores: !!effState?.ignoreStability, taken: forcedMovementTaken(actor) };
}

function _stabSuffix(stabInfo, applied) {
  const taken = stabInfo?.taken ? ` (+${stabInfo.taken} Moved Farther)` : '';
  if (!(stabInfo?.stab > 0)) return taken;
  if (stabInfo.ignores) return `${taken} (Ignores Stability)`;
  return taken + (applied ? ` (Stability ${stabInfo.stab})` : ` (vs Stability ${stabInfo.stab})`);
}

function _setRowExecuting(fmRow, applyBtn, undoBtn, modBtn, quickBtn) {
  fmRow.classList.add('is-executing');
  fmRow.classList.remove('is-applied', 'is-undone');
  applyBtn.disabled = true;
  applyBtn.replaceChildren(_makeIcon('fa-solid fa-person-walking-arrow-right fa-fade'), _makeSpan('Forced Movement in Progress'));
  _tip(applyBtn, 'fmRunning');
  undoBtn.disabled = true;
  modBtn.disabled  = true;
  if (quickBtn) quickBtn.disabled = true;
}

export function setFmRowRemoteExecuting(stateKey, executing) {
  if (executing) {
    _fmExecutingKeys.add(stateKey);
    const fmRow = document.querySelector(`[data-dsct-fm-key="${stateKey}"]`);
    const btns  = fmRow ? fmRow.querySelectorAll('button') : [];
    if (btns.length >= 3) _setRowExecuting(fmRow, btns[0], btns[1], btns[2], null);
    setTimeout(() => {
      if (_fmExecutingKeys.delete(stateKey)) {
        const msg = game.messages.get(stateKey.split(':')[0]);
        if (msg) ui.chat.updateMessage(msg);
      }
    }, 120000);
  } else {
    if (!_fmExecutingKeys.delete(stateKey)) return;
    const msg = game.messages.get(stateKey.split(':')[0]);
    if (msg) ui.chat.updateMessage(msg);
  }
}

function _syncRow(fmRow, applyBtn, undoBtn, modBtn, state, label, stabInfo = null, verbatim = false) {
  fmRow.classList.remove('is-executing');
  if (state.redirected) {
    applyBtn.replaceChildren(_makeIcon('fa-solid fa-shuffle'), _makeSpan(`Redirected: ${state.redirected.newTargetName || state.redirected.newTargetKey}`));
    _tip(applyBtn, 'fmRedirected', { title: state.redirected.modName || label });
    fmRow.classList.add('is-redirected');
    fmRow.classList.remove('is-applied', 'is-undone');
    applyBtn.disabled = true;
    undoBtn.disabled = false;
    _tip(undoBtn, 'fmRedirectUndo');
    modBtn.disabled = true;
    return;
  }
  fmRow.classList.remove('is-redirected');
  _tip(undoBtn, 'fmUndo');
  const suffix  = _stabSuffix(stabInfo, state.applied);
  const fmLabel = verbatim
    ? (state.applied ? `Applied: ${label}` : label) + suffix
    : (state.applied ? `Applied ${label}` : `Apply ${label}`) + suffix;
  applyBtn.replaceChildren(_makeIcon('fa-solid fa-person-walking-arrow-right'), _makeSpan(fmLabel));
  _tip(applyBtn, state.applied ? 'fmApplied' : 'fm', { title: fmLabel });
  if (state.applied) {
    fmRow.classList.add('is-applied');
    fmRow.classList.remove('is-undone');
    applyBtn.disabled = true;
    undoBtn.disabled = !state.undoMsgId;
    if (state.undoMsgId) undoBtn.dataset.dsctFmMsgId = state.undoMsgId;
    modBtn.disabled = true;
  } else {
    fmRow.classList.remove('is-applied');
    if (state.undoMsgId) fmRow.classList.add('is-undone');
    applyBtn.disabled = false;
    undoBtn.disabled = true;
    modBtn.disabled = false;
  }
}

async function _persistDstdState(message, subKey, state) {
  const stackData = (state.modStack ?? []).map(e => ({
    modState: e.modState, noteName: e.noteName, noteDesc: e.noteDesc,
    noteSrc: e.noteSrc ?? null, srcTokenId: e.srcTokenId ?? null,
    ...(e.enabled === false ? { enabled: false } : {}),
    ...(e.dstRedirect ? { dstRedirect: true } : {}),
    ...(e.dsctSeeded ? { dsctSeeded: true } : {}),
    ...(e.dstTrigger ? { dstTrigger: true } : {}),
  }));
  const allState  = foundry.utils.deepClone(message.getFlag(M, 'dstdFmState') ?? {});
  allState[subKey] = {
    applied: state.applied, undoMsgId: state.undoMsgId ?? null, modStack: stackData,
    ...(state.seeded ? { seeded: true } : {}),
    ...(state.redirected ? { redirected: state.redirected } : {}),
  };
  const api = getModuleApi();
  if (api?.socket) safeUpdate(message, { [`flags.${M}.dstdFmState`]: allState });
  else await message.setFlag(M, 'dstdFmState', allState);
}

async function _undoFmRedirect(message, origSubKey, origStateKey, movementType, cur) {
  const red = cur.redirected;
  const newSubKey   = `${red.newTargetKey}:${movementType}`;
  const newStateKey = `${message.id}:${red.newTargetKey}:${movementType}`;
  const allState    = foundry.utils.deepClone(message.getFlag(M, 'dstdFmState') ?? {});
  const liveNew     = _fmState.get(newStateKey) ?? allState[newSubKey];

  if (liveNew?.applied && liveNew.undoMsgId) {
    const chatLi   = document.querySelector(`[data-message-id="${liveNew.undoMsgId}"]`);
    const dsctUndo = chatLi?.querySelector('.dsct-undo-fm');
    if (dsctUndo) { dsctUndo.click(); _fmUndoIndex.delete(liveNew.undoMsgId); }
    else ui.notifications.warn('DSCT | Could not find the redirected FM undo button in the chat log');
  }

  
  const fmState = {};
  const dstdState = { updatedAt: Date.now() };
  const upd = { flags: { [DSTD]: { state: dstdState }, [M]: { dstdFmState: fmState } } };

  const origEntry = allState[origSubKey];
  const origKept  = (origEntry?.modStack ?? []).filter(e => !(e.dstTrigger && e.noteName === red.modName));
  const origBare  = origEntry && !origEntry.applied && !origEntry.undoMsgId && !origKept.length;
  if (origBare) {
    fmState[origSubKey] = dropKey();
  } else {
    fmState[origSubKey] = { redirected: dropKey(), modStack: origKept };
  }

  if (red.newWasTarget) {
    fmState[newSubKey] = {
      applied: false,
      modStack: (allState[newSubKey]?.modStack ?? []).filter(e => !e.dstRedirect),
    };
  } else {
    fmState[newSubKey] = dropKey();
    const st = foundry.utils.getProperty(message.flags, `${DSTD}.state`) ?? {};
    dstdState.targets = (st.targets ?? []).filter(t =>
      t.tokenUuid !== red.newTargetUuid
      && String(t.tokenUuid ?? '').replace(/\./g, '__') !== red.newTargetKey);
  }

  _fmState.delete(origStateKey);
  _fmState.delete(newStateKey);

  const api = getModuleApi();
  if (api?.socket) safeUpdate(message, upd);
  else await message.update(upd);
}

function _hoverMinions(minionIds) {
  if (getSetting('debugMode')) {
    console.log(`DSCT | squadHover | _hoverMinions ids=`, minionIds);
    for (const id of minionIds) {
      const tok = canvas.tokens?.get(id);
      console.log(`DSCT | squadHover | token id=${id} found=${!!tok} hasFn=${typeof tok?._onHoverIn}`);
      tok?._onHoverIn?.({});
    }
    return;
  }
  for (const id of minionIds) canvas.tokens?.get(id)?._onHoverIn?.({});
}

function _unhoverMinions(minionIds) {
  for (const id of minionIds) canvas.tokens?.get(id)?._onHoverOut?.({});
}

function _installSquadHoverListeners(panel, message) {
  const rows = panel.querySelectorAll(DSTD_ROW);
  if (getSetting('debugMode')) console.log(`DSCT | squadHover | _installSquadHoverListeners msgId=${message.id} rows=${rows.length}`);
  for (const row of rows) {
    const key = row.dataset?.targetKey;
    if (!key || key === 'selected-token') continue;
    const applyBtns = row.querySelectorAll('[data-dstd-action="applyDamage"]');
    const qdBtn     = row.querySelector(`.${DSTD}-quick-damage:not(.dsct-dstd-quick-fm-btn)`);
    if (getSetting('debugMode')) console.log(`DSCT | squadHover | row key=${key} applyBtns=${applyBtns.length} qdBtn=${!!qdBtn}`);
    const hover = () => {
      const sqMap = message.getFlag(M, 'squadTargetMap');
      const ids   = sqMap?.[key]?.minionIds;
      if (getSetting('debugMode')) console.log(`DSCT | squadHover | hover key=${key} sqMap=${!!sqMap} sqEntry=${!!sqMap?.[key]} ids=`, ids);
      if (ids?.length) _hoverMinions(ids);
    };
    const unhov = () => {
      const ids = message.getFlag(M, 'squadTargetMap')?.[key]?.minionIds;
      if (ids?.length) _unhoverMinions(ids);
    };
    for (const btn of applyBtns) {
      if (btn.dataset.dsctSquadHoverRt) continue;
      btn.dataset.dsctSquadHoverRt = '1';
      btn.addEventListener('mouseenter', hover);
      btn.addEventListener('mouseleave', unhov);
    }
    if (qdBtn && !qdBtn.dataset.dsctSquadHoverRt) {
      qdBtn.dataset.dsctSquadHoverRt = '1';
      qdBtn.addEventListener('mouseenter', hover);
      qdBtn.addEventListener('mouseleave', unhov);
    }
  }
}

function _installAreaDamageHook(panel, message) {
  const areaFlag = message.getFlag(M, 'postedAreaDamage');
  if (!areaFlag) return;
  if (panel.dataset.dsctAreaDmgHooked) return;
  panel.dataset.dsctAreaDmgHooked = '1';
  const { damageType, amount } = areaFlag;
  panel.addEventListener('click', async (e) => {
    const applyBtn = e.target.closest('[data-dstd-action="applyDamage"]');
    if (!applyBtn) return;
    e.stopImmediatePropagation();
    let token = null;
    try {
      const tgt = JSON.parse(applyBtn.dataset.target ?? 'null');
      if (tgt?.tokenId) token = canvas.tokens.get(tgt.tokenId);
      else if (tgt?.selectedToken) token = canvas.tokens.controlled[0] ?? null;
    } catch {}
    if (!token?.actor) return;
    if (token.document?.id && services.get('minionOverrideActive')?.()) services.get('reportSquadDamage')?.(token.document.id);
    const finalAmt = e.shiftKey ? Math.floor(amount / 2) : amount;
    await applyDamage(token.actor, finalAmt, undefined, { damageType, isArea: true });
  }, { capture: true });
}

const _dstdLoc = (key, data) => {
  const full = `DSTD.${key}`;
  const out = data ? game.i18n.format(full, data) : game.i18n.localize(full);
  return out === full ? null : out;
};

const UPDATE_TARGETS = '[data-dstd-action="updateTargets"], [data-dsct-update-targets]';

export async function _repickForMessage(message) {
  const abilityUuid = _getMessageParts(message).find(p => p.abilityUuid)?.abilityUuid ?? message.flags?.[DSTD]?.state?.abilityUuid;
  const ability = abilityUuid ? await fromUuid(abilityUuid).catch(() => null) : null;
  if (!ability) return undefined;
  const area = await pickAreaTargetsFor(ability);
  return area !== undefined ? area : pickTargetsFor(ability);
}

function _watchUpdateTargets(message, root) {
  if (root.dataset.dsctRepick) return;
  root.dataset.dsctRepick = '1';
  root.addEventListener('click', async (event) => {
    const button = event.target.closest?.(UPDATE_TARGETS);
    if (!button) return;
    if (button.dataset.dsctRepicked) { delete button.dataset.dsctRepicked; return; }
    if (!getSetting('abilityTargetingEnabled')) return;
    if (game.user.targets.size && !getSetting('alwaysRepickTargets')) return;
    if (!game.user.isGM && !message.isOwner && message.author?.id !== game.user.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const picked = await _repickForMessage(message);
    if (picked === null) return;
    if (picked) setFoundryTargets(picked);
    const live = button.isConnected ? button
      : document.querySelector(`li.chat-message[data-message-id="${message.id}"]`)?.querySelector(UPDATE_TARGETS) ?? button;
    live.dataset.dsctRepicked = '1';
    live.click();
  }, true);
}

async function _updateSyntheticTargets(message) {
  let collect = null;
  try {
    ({ collectCurrentTargets: collect } = await import('/modules/draw-steel-target-damage/src/target-utils.mjs'));
  } catch { collect = null; }
  if (!collect) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dstd.noTargetUtils')); return; }
  const targets = collect();
  if (!targets.length) { ui.notifications.warn(game.i18n.localize('DSCT.notice.noTargets')); return; }
  await message.update({ [`flags.${DSTD}.state.targets`]: targets });
}

function _buildSyntheticHeader(message, ability) {
  const title = _dstdLoc('Chat.TargetPanelTitle');
  if (!title) return null;

  const header = document.createElement('header');
  header.className = `${DSTD}-header`;

  const titleWrap = document.createElement('div');
  titleWrap.className = `${DSTD}-header-text`;
  const strong = document.createElement('strong');
  strong.textContent = title;
  titleWrap.appendChild(strong);

  const name = (message.getFlag(DSTD, 'state') ?? {}).sourceActorName
    ?? ability?.actor?.name
    ?? game.users.get(message.author?.id)?.name
    ?? '';
  const line = _dstdLoc('Chat.TargetingLine', { name });
  if (line) {
    const span = document.createElement('span');
    span.textContent = line;
    titleWrap.appendChild(span);
  }
  header.appendChild(titleWrap);

  
  
  const label = _dstdLoc('Chat.UpdateTargets');
  if (label && message.getFlag(DSTD, 'state') && message.isOwner) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${DSTD}-icon-button ${DSTD}-update-targets`;
    btn.dataset.dsctUpdateTargets = '1';
    _tip(btn, 'updateTargets', { title: label });
    btn.append(_makeIcon('fa-solid fa-bullseye'), _makeSpan(label));
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      btn.disabled = true;
      try { await _updateSyntheticTargets(message); }
      finally { btn.disabled = false; }
    });
    header.appendChild(btn);
  }

  return header;
}

async function _buildSyntheticFlatPanel(message, root, storedTargets, { allowEmpty = false, ability = null } = {}) {
  const panel = document.createElement('section');
  panel.className = `${DSTD}-panel`;
  panel.dataset.messageId = message.id;

  const header = _buildSyntheticHeader(message, ability);
  if (header) panel.appendChild(header);

  const list = document.createElement('div');
  list.className = `${DSTD}-target-list`;

  for (const targetKey of storedTargets) {
    const tokenUuid = targetKey.replace(/__/g, '.');
    const tokenDoc = await fromUuid(tokenUuid).catch(() => null);
    if (!tokenDoc) continue;

    const row = document.createElement('div');
    row.className = `${DSTD}-target-row`;
    row.dataset.targetKey = targetKey;

    const head = document.createElement('div');
    head.className = `${DSTD}-target-head`;
    const img = document.createElement('img');
    img.className = `${DSTD}-portrait`;
    img.src = tokenDoc.texture?.src ?? tokenDoc.img ?? 'icons/svg/mystery-man.svg';
    img.alt = tokenDoc.name ?? '';
    const nameDiv = document.createElement('div');
    nameDiv.className = `${DSTD}-target-name`;
    nameDiv.textContent = tokenDoc.name ?? '';
    head.append(img, nameDiv);

    const body = document.createElement('div');
    body.className = `${DSTD}-target-body`;
    const actions = document.createElement('div');
    actions.className = `${DSTD}-target-actions`;
    body.append(actions);

    row.append(head, body);
    list.append(row);
  }

  if (!list.children.length && !allowEmpty) return null;
  panel.append(list);

  const footer = root.querySelector('footer.message-part-buttons');
  if (footer) footer.before(panel);
  else root.appendChild(panel);

  return panel;
}

const _soloCollapsed = new Set();

const _COMPACT_VERBS = /^(?:apply|applied|applying|deal|deals|gain|gained|undo)\s*:?\s+/i;

const _COMPACT_TYPED_DAMAGE = /^([0-9]+)\s+(.+?)\s+damage$/i;

function _compactText(text) {
  const stripped = String(text ?? '')
    .replace(_COMPACT_VERBS, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  const typed = stripped.match(_COMPACT_TYPED_DAMAGE);
  return typed ? `${typed[1]} ${typed[2]}` : stripped;
}

function _compactify(button, applied) {
  if (applied) return;
  const span = button.querySelector('span');
  if (!span) return;
  
  const suffix = span.dataset.dsctMultSuffix ?? '';
  const base = span.dataset.dsctBaseLabel ?? span.textContent;
  const short = button.dataset.dsctCompact || _compactText(base);
  if (short) span.textContent = short + suffix;
}

function _allowSoloCollapse(message, panel) {
  const rows = panel.querySelectorAll(`.${DSTD}-target-row[data-target-key]`);
  if (rows.length !== 1) return;

  const row = rows[0];
  const key = `${message.id}:${row.dataset.targetKey}`;
  row.classList.toggle('is-collapsed', _soloCollapsed.has(key));

  const head = row.querySelector(`.${DSTD}-target-head`);
  if (!head) return;

  
  
  
  if (!head.querySelector('.dsct-solo-quick')) {
    const source = row.querySelector(`.${DSTD}-target-body .${DSTD}-action-button`);
    const toggle = head.querySelector(`.${DSTD}-target-toggle`);
    if (source && toggle) {
      
      
      const sourceRow = source.closest(`.${DSTD}-action-row`);
      const applied = !!sourceRow?.classList.contains('is-applied');
      const quick = source.cloneNode(true);
      quick.classList.remove(`${DSTD}-stretch-button`);
      quick.classList.add('dsct-solo-quick');
      quick.classList.toggle('is-applied', applied);
      quick.classList.toggle('is-undone', !!sourceRow?.classList.contains('is-undone'));
      _compactify(quick, applied);
      head.insertBefore(quick, toggle);
      
      if (!source.dataset.dstdAction) {
        const live = () => row.querySelector(`.${DSTD}-target-body .${DSTD}-action-button`);
        quick.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          live()?.click();
        });
        const mirror = () => {
          const src = live();
          if (!src || !quick.isConnected) return;
          const done = !!src.closest(`.${DSTD}-action-row`)?.classList.contains('is-applied');
          quick.disabled = src.disabled;
          if (src.dataset.dsctTip) setTip(quick, src.dataset.dsctTip);
          else _tip(quick, 'quickRow', { title: src.dataset.tooltip || src.textContent.trim() });
          quick.classList.toggle('is-applied', done);
          quick.replaceChildren(...[...src.childNodes].map((n) => n.cloneNode(true)));
          _compactify(quick, done);
        };
        const body = row.querySelector(`.${DSTD}-target-body`);
        if (body) new MutationObserver(mirror).observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'class'] });
      }
    }
  }

  if (head.dataset.dsctSolo) return;
  head.dataset.dsctSolo = '1';

  
  head.addEventListener('click', (event) => {
    if (event.target.closest(`button, .${DSTD}-action-button, .${DSTD}-icon-button`)) return;
    event.preventDefault();
    event.stopPropagation();

    const collapsed = !row.classList.contains('is-collapsed');
    row.classList.toggle('is-collapsed', collapsed);
    if (collapsed) _soloCollapsed.add(key);
    else _soloCollapsed.delete(key);
  }, { capture: true });
}

function _squadFreeStrikePills(message, root) {
  const sq = message.getFlag(M, 'squadFreeStrike');
  const state = message.flags?.[DSTD]?.state;
  if (!(sq?.minions?.length > 0) || !state || !isPrimaryGM()) return;
  const pills = sq.minions.map(id => ({
    kind: 'delta', value: sq.value, label: 'Free Strike', src: canvas.tokens.get(id)?.name ?? null, srcTokenId: id, source: 'trigger', dstSquad: true,
  }));
  const type = sq.type ?? '';
  const update = {};
  for (const btn of root?.querySelectorAll(`${DSTD_PANEL} [data-dstd-action="applyDamage"][data-operation-id]`) ?? []) {
    const operationId = btn.dataset.operationId;
    const existing = state.damageOverrides?.[operationId];
    if (existing?.dstPills?.some(p => p.dstSquad)) continue;
    const baseAmount = 0;
    const all = [...(existing?.dstPills ?? []), ...pills];
    update[`flags.${DSTD}.state.damageOverrides.${operationId}`] = {
      ...(existing ?? {}),
      amount: foldDamagePills(baseAmount, all),
      baseAmount,
      bonus: 0,
      additional: existing?.additional ?? '',
      damageType: existing?.damageType ?? type,
      typeLabel: existing?.typeLabel ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : ''),
      surges: existing?.surges ?? 0,
      surgeDamage: existing?.surgeDamage ?? 0,
      surgeBonus: existing?.surgeBonus ?? 0,
      dstPills: all,
    };
  }
  if (Object.keys(update).length) message.update(update).catch(() => {});
}

function _syntheticTargetRow(token) {
  const row = document.createElement('div');
  row.className = `${DSTD}-target-row`;
  row.dataset.targetKey = token.document.uuid.replace(/\./g, '__');
  const head = document.createElement('div');
  head.className = `${DSTD}-target-head`;
  const img = document.createElement('img');
  img.className = `${DSTD}-portrait`;
  img.src = token.document.texture?.src ?? token.actor?.img ?? 'icons/svg/mystery-man.svg';
  img.alt = token.name ?? '';
  const nameDiv = document.createElement('div');
  nameDiv.className = `${DSTD}-target-name`;
  nameDiv.textContent = token.name ?? '';
  head.append(img, nameDiv);
  const body = document.createElement('div');
  body.className = `${DSTD}-target-body`;
  const acts = document.createElement('div');
  acts.className = `${DSTD}-target-actions`;
  body.append(acts);
  row.append(head, body);
  return row;
}

const OTHERS_FLAG = 'othersPicked';

export function _areaOrigin(ability) {
  const region = canvas.scene?.regions.contents.findLast(r => r.getFlag('draw-steel', 'abilitySource') === ability?.uuid);
  const shape = region?.shapes?.[0];
  if (!shape) return null;
  const G = canvas.grid.size;
  const cx = shape.type === 'rectangle' ? shape.x + (0.5 - (shape.anchorX ?? 0)) * shape.width : shape.x;
  const cy = shape.type === 'rectangle' ? shape.y + (0.5 - (shape.anchorY ?? 0)) * shape.height : shape.y;
  const x = Math.floor(cx / G) * G;
  const y = Math.floor(cy / G) * G;
  const bottom = region.elevation?.bottom;
  return { id: `area-${region.id}`, name: ability.name, x, y, center: { x: x + G / 2, y: y + G / 2 }, actor: null,
    document: { x, y, width: 1, height: 1, elevation: Number.isFinite(bottom) ? bottom : 0, uuid: null, texture: { src: ability.img } } };
}

const _recipientTarget = (tokenUuid) => {
  const doc = tokenUuid ? fromUuidSync(tokenUuid) : null;
  return doc ? { tokenUuid: doc.uuid, tokenId: doc.id, sceneId: doc.parent?.id ?? null, actorUuid: doc.actor?.uuid ?? null,
    actorId: doc.actor?.id ?? null, name: doc.name, img: doc.texture?.src ?? doc.actor?.img ?? null } : null;
};

const _sideOf = (token, source) => {
  const a = token.document.disposition;
  const b = source?.document.disposition;
  if (b == null) return 'neutral';
  if (a === b) return 'ally';
  return a * b < 0 ? 'enemy' : 'neutral';
};

const _squaresApart = (a, b) => Math.round(tokFootprintDist(a, b) / (canvas.grid.distance || 1)) + 1;

export function _othersCandidates(spec, { sourceToken, targetTokens, ability }) {
  const dead = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  const living = canvas.tokens.placeables.filter(t => t.actor && !t.document.hidden && !t.actor.statuses?.has(dead));
  let pool;
  if (spec.origin === 'area') {
    const region = canvas.scene?.regions.contents.findLast(r => r.getFlag('draw-steel', 'abilitySource') === ability?.uuid);
    const inside = new Set([...(region?.tokens ?? [])].map(d => d.id));
    pool = living.filter(t => inside.has(t.id));
  } else {
    const origins = spec.origin === 'self' ? [sourceToken].filter(Boolean) : targetTokens;
    pool = living.filter(t => !origins.includes(t) && origins.some(o => _squaresApart(o, t) <= Math.max(1, spec.range)));
  }
  if (spec.includeSelf && sourceToken && !pool.includes(sourceToken)) pool.push(sourceToken);
  return pool.filter(t => (t === sourceToken ? spec.includeSelf : spec.disposition === 'any' || _sideOf(t, sourceToken) === spec.disposition));
}

function _othersPickRow(message, effect, spec, ctx, picked) {
  const noun = spec.count === 1 ? { ally: 'ally', enemy: 'enemy', any: 'creature' } : { ally: 'allies', enemy: 'enemies', any: 'creatures' };
  const who = game.i18n.localize(`DSCT.FlatEffect.Others.${noun[spec.disposition] ?? noun.any}`);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
  const label = picked ? game.i18n.localize('DSCT.FlatEffect.Others.repick') : game.i18n.format('DSCT.FlatEffect.Others.pick', { count: spec.count, who });
  btn.append(_makeIcon('fa-solid fa-hand-pointer'), _makeSpan(label));
  _tip(btn, 'othersPick', { title: label, data: { name: effect.name || effect.label || '' } });
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const candidates = _othersCandidates(spec, ctx);
    if (!candidates.length) return void ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.Others.noneInReach', { name: ctx.ability?.name ?? '' }));
    const chosen = await runMultiTokenPicker({ candidates, maxTargets: spec.count,
      hint: game.i18n.format('DSCT.FlatEffect.Others.pickHint', { count: spec.count, range: spec.range }) });
    if (!chosen?.length) return;
    await safeSetFlag(message, M, `${OTHERS_FLAG}.${effect.id}`, { uuids: chosen.map(t => t.document.uuid) });
  });
  const row = document.createElement('div');
  row.className = `${DSTD}-action-row dsct-dstd-others-pick`;
  row.dataset.dsctOthersPick = effect.id;
  row.append(btn);
  return row;
}

async function _addOthersRows(message, panel, effects, { sourceToken, ability }) {
  const list = panel.querySelector(`.${DSTD}-target-list`) ?? panel;
  const mainRows = [...panel.querySelectorAll(DSTD_ROW)].filter(r => !r.dataset.dsctSelfOnly && !r.dataset.dsctOthersOnly
    && r.dataset.targetKey && r.dataset.targetKey !== 'selected-token');
  const targetTokens = mainRows.map(r => fromUuidSync(r.dataset.targetKey.replace(/__/g, '.'))?.object).filter(Boolean);
  const targetsSig = mainRows.map(r => r.dataset.targetKey).sort().join('|');
  const stored = message.getFlag(M, OTHERS_FLAG) ?? {};
  const ctx = { sourceToken, targetTokens, ability };
  const freeze = {};
  for (const effect of effects) {
    const spec = othersSpec(effect);
    if (!spec) continue;
    const saved = stored[effect.id];
    let uuids;
    if (spec.mode === 'pick') {
      uuids = saved?.uuids ?? null;
      if (!panel.querySelector(`[data-dsct-others-pick="${effect.id}"]`)) list.append(_othersPickRow(message, effect, spec, ctx, !!uuids));
      if (!uuids) continue;
    } else if (saved?.targets === targetsSig) {
      uuids = saved.uuids;
    } else {
      uuids = _othersCandidates(spec, ctx).map(t => t.document.uuid);
      freeze[effect.id] = { uuids, targets: targetsSig };
    }
    for (const uuid of uuids) {
      const token = fromUuidSync(uuid)?.object;
      if (!token) continue;
      const key = uuid.replace(/\./g, '__');
      let row = panel.querySelector(`${DSTD_ROW}[data-target-key="${CSS.escape(key)}"]`);
      if (!row) {
        row = _syntheticTargetRow(token);
        row.dataset.dsctOthersOnly = '1';
        list.append(row);
      }
      const ids = new Set((row.dataset.dsctOthers ?? '').split(',').filter(Boolean));
      ids.add(effect.id);
      row.dataset.dsctOthers = [...ids].join(',');
    }
  }
  const writer = message.author?.active ? message.author.isSelf : isPrimaryGM();
  if (Object.keys(freeze).length && writer) {
    await safeSetFlag(message, M, OTHERS_FLAG, { ...stored, ...freeze });
  }
}

async function _injectFmButtons(message, root) {
  const panel = root?.querySelector(DSTD_PANEL);
  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons msgId=${message.id} hasPanel=${!!panel}`);

  const parts       = _getMessageParts(message);
  const abilityUuid = parts.find(p => p.abilityUuid)?.abilityUuid
                   ?? message.flags?.[DSTD]?.state?.abilityUuid;
  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons abilityUuid=${abilityUuid}`);
  if (!abilityUuid) return _squadFreeStrikePills(message, root);
  const ability = await fromUuid(abilityUuid).catch(() => null);
  if (!ability) return;

  const _flatOn = getSetting('flatEffectsEnabled');
  
  const _chooseKeeps = chooseMessageFilter(message, ability);
  const _flatOfType = (type) => _flatOn
    ? Array.from(ability.system?.effects?.contents ?? [])
      .filter(e => e.type === type)
      .filter(e => !_chooseKeeps || _chooseKeeps(e))
      .filter(e => !takesOver(ability, e))
    : [];
  const flatDamageEffects   = _flatOfType('dsct.flatDamage').filter(e => expendAllows(e, ability, message));
  const flatForcedEffects   = _flatOfType('dsct.flatForced');
  const flatAppliedEffects  = _flatOfType('dsct.flatApplied').filter(e => levelAllows(e, ability, message));
  const flatResourceEffects = _flatOfType('dsct.flatResource');
  const flatHealEffects     = _flatOfType('dsct.flatHeal');
  const flatCleanseEffects  = _flatOfType('dsct.flatCleanse');
  const flatTeleportEffects = _flatOfType('dsct.flatTeleport');
  const tieredTypes = _flatOn ? new Set(tieredEffectsOf(ability).map(e => e.type)) : new Set();
  const doFlatEffects = flatDamageEffects.length > 0 || flatForcedEffects.length > 0 || flatAppliedEffects.length > 0 || flatHealEffects.length > 0 || flatCleanseEffects.length > 0 || flatResourceEffects.length > 0
    || flatTeleportEffects.length > 0
    || tieredTypes.has('dsctHeal') || tieredTypes.has('dsctTeleport');

  const dsid     = getItemDsid(ability);
  const _grabTargetCount = (message.flags?.[DSTD]?.state?.targets ?? []).length;
  const maxGrabs = Math.max(MULTI_GRAB_LIMITS[dsid] ?? 1, _grabTargetCount);

  const doMark      = getSetting('markAutomation') && (dsid in MARK_ABILITY_CONFIG);
  const doJudgement = getSetting('judgementAutomation') && dsid === 'judgement';

  const tier = _getMessageTier(message);

  const descEnrichers = !getSetting('neutralizeEnrichers') ? [] : (window._dsctEnricherCache?.get(message.id) ?? (() => {
    const result = [];
    const desc   = ability.system?.description?.value ?? '';
    const re     = /\[\[\/apply(?<config>[^\]]*?)?\]\](?!\])(?:\{(?<label>[^}]+)\})?/gi;
    const seen   = new Set();
    for (const match of desc.matchAll(re)) {
      const config = (match.groups?.config ?? '').trim();
      const label  = match.groups?.label ?? null;
      let statusId = null, endStr = null;
      for (const val of config.split(/\s+/).filter(Boolean)) {
        const lower = val.toLowerCase();
        if (ds?.CONFIG?.effectEnds?.[lower]) { endStr = lower; continue; }
        if (ds?.CONFIG?.conditions?.[lower]) { statusId = lower; continue; }
      }
      if (!statusId || seen.has(statusId)) continue;
      seen.add(statusId);
      const displayLabel = label ?? game.i18n.localize(ds?.CONFIG?.conditions?.[statusId]?.name ?? statusId);
      const lead = desc.slice(Math.max(0, match.index - 200), match.index).split(/[.!?](?:\s|<)|<\/p>|<br\s*\/?>/i).pop();
      const potency = /\[\[\s*potency\b|\b(?:might|agility|reason|intuition|presence|[MARIP])\s*<\s*(?:\d|weak|average|strong|\[\[)/i.test(lead);
      result.push({ statusId, endStr, label: displayLabel, potency });
    }
    return result;
  })());

  if (!window._dsctSquadTargetCache) window._dsctSquadTargetCache = new Map();
  let squadTargetMap = window._dsctSquadTargetCache.get(message.id) ?? null;
  if (getSetting('debugMode')) console.log(`DSCT | squadMap | msgId=${message.id} fromCache=${!!squadTargetMap} flagValue=`, message.getFlag(M, 'squadTargetMap'), `pendingMap=${!!_pendingSquadMap}`);
  if (!squadTargetMap) {
    const stored = message.getFlag(M, 'squadTargetMap') ?? null;
    if (stored) {
      window._dsctSquadTargetCache.set(message.id, stored);
      squadTargetMap = stored;
      if (getSetting('debugMode')) console.log(`DSCT | squadMap | loaded from DB flag, keys=`, Object.keys(stored));
    } else if (_pendingSquadMap && (ability.actor ?? ability.parent)?.system?.isMinion && ability.system?.category === 'signature') {
      if (getSetting('debugMode')) console.log(`DSCT | squadMap | building from _pendingSquadMap, entries=${_pendingSquadMap.size}`);
      const uuidMap = {};
      for (const [tokenId, entry] of _pendingSquadMap) {
        const tok      = canvas.tokens.get(tokenId);
        if (!tok) continue;
        const minionIds = [...(entry.minionIds ?? [])];
        if (!minionIds.length) continue;
        const fs = entry.extraMinions > 0
          ? (canvas.tokens.get(entry.primaryMinionId)?.actor?.system?.monster?.freeStrike ?? 0)
          : 0;
        uuidMap[tok.document.uuid.replace(/\./g, '__')] = { extraMinions: entry.extraMinions, freeStrike: fs, minionIds, primaryMinionId: entry.primaryMinionId ?? null };
      }
      if (getSetting('debugMode')) console.log(`DSCT | squadMap | uuidMap built, keys=`, Object.keys(uuidMap));
      if (Object.keys(uuidMap).length) {
        window._dsctSquadTargetCache.set(message.id, uuidMap);
        squadTargetMap = uuidMap;
        const mapWrite = { [`flags.${M}.squadTargetMap`]: uuidMap };
        if (isPrimaryGM()) {
          if (getSetting('debugMode')) console.log(`DSCT | squadMap | writing to DB as GM`);
          message.update(mapWrite).catch((e) => { if (getSetting('debugMode')) console.error('DSCT | squadMap | DB write failed:', e); });
        } else {
          if (getSetting('debugMode')) console.log(`DSCT | squadMap | writing to DB via socket`);
          safeUpdate(message, mapWrite);
        }
      }
      consumePendingSquadMap();
    }
  }
  const doSquad = !!squadTargetMap;
  if (getSetting('debugMode')) console.log(`DSCT | squadMap | doSquad=${doSquad} squadTargetMap=${!!squadTargetMap}`);

  if (!tier && !doMark && !doJudgement && !descEnrichers.length && !doSquad && !doFlatEffects) return;

  const fmEffects = tier ? Array.from(ability.system?.power?.effects ?? [])
    .filter(e => e.forced && typeof e.forced === 'object')
    .filter(e => !_chooseKeeps || _chooseKeeps(e)) : [];
  const appliedEffects = tier ? Array.from(ability.system?.power?.effects ?? [])
    .filter(e => e.applied && typeof e.applied === 'object')
    .filter(e => !_chooseKeeps || _chooseKeeps(e)) : [];

  const dstdState       = message.flags?.[DSTD]?.state;
  const sourceTokenUuid = dstdState?.sourceTokenUuid;
  const sourceDoc       = sourceTokenUuid ? await fromUuid(sourceTokenUuid).catch(() => null) : null;
  const sourceToken     = sourceDoc?.object ?? null;
  const sourceActor     = sourceToken?.actor ?? null;
  const autoFm          = getSetting('fmAutoForOwnAbilities') && isOwnAbilityActor(ability.actor ?? sourceActor);

  const hasPurifyingFire = getSetting('purifyingFireEnabled') && !!sourceActor?.items?.some(i =>
    getItemDsid(i) === 'purifying-fire' || i.name.toLowerCase() === 'purifying fire'
  );
  const holyRolls = hasPurifyingFire ? _getHolyRolls(message) : [];

  const doFm         = fmEffects.length > 0;
  const doConditions = appliedEffects.length > 0 &&
    (getSetting('grabEnabled') || getSetting('frightenedEnabled') || getSetting('tauntedEnabled'));
  const doPf         = holyRolls.length > 0;

  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons fmEffects=${fmEffects.length} appliedEffects=${appliedEffects.length} tier=${tier} doFm=${doFm} doConditions=${doConditions} doMark=${doMark} doJudgement=${doJudgement} doPf=${doPf}`);
  await _restoreGainResource(message, root, ability, tier);

  if (!doFm && !doConditions && !doPf && !doMark && !doJudgement && !descEnrichers.length && !doSquad && !doFlatEffects) return;

  
  
  const selfOnlyFlat = flatResourceEffects.some(e => resourceJobs(e, message, ability).length > 0);

  let activePanel = panel;
  if (!activePanel) {
    const dstdTargets = (message.getFlag(DSTD, 'state') ?? {}).targets ?? [];
    const storedKeys = dstdTargets.map(t => t.tokenUuid?.replace(/\./g, '__')).filter(Boolean);
    if (!storedKeys.length && !selfOnlyFlat) return;
    activePanel = await _buildSyntheticFlatPanel(message, root, storedKeys, { allowEmpty: selfOnlyFlat, ability });
    if (!activePanel) return;
  }

  if (doFlatEffects) {
    
    
    
    
    
    for (const btn of root.querySelectorAll('.dsct-flat-damage-btn, .dsct-flat-forced-row, .dsct-flat-applied-btn, .dsct-flat-heal-btn, .dsct-flat-cleanse-btn, .dsct-flat-teleport-btn, .dsct-flat-resource-row')) {
      btn.hidden = true;
      const footer = btn.closest('footer.message-part-buttons');
      if (footer && [...footer.children].every(c => c.hidden)) footer.hidden = true;
    }
  }

  const savedFlagState = message.getFlag(M, 'dstdFmState') ?? {};

  const flatDamageResolved = await Promise.all(flatDamageEffects.map(async effect => {
    const rollData = { ...(ability.actor?.getRollData?.() ?? {}), ...triggerRollData(message) };
    try {
      const roll = new Roll(effect.flatDamage.value, rollData);
      await roll.evaluate();
      const amount = Math.floor(roll.total);
      if (getSetting('debugMode')) console.log(`DSCT | flatDamage resolve: effectId=${effect.id} value="${effect.flatDamage.value}" rollTotal=${roll.total} amount=${amount}`);
      return { effect, amount };
    } catch { return { effect, amount: 0 }; }
  }));

  const flatForcedResolved = flatForcedEffects.map(effect => {
    const movArr = Array.from(effect.flatForced.movement);
    const firstMov = movArr[0] ?? 'push';
    const rollData = ability.actor?.getRollData?.() ?? {};
    let dist;
    try { dist = ds.utils.evaluateFormula(effect.flatForced.distance, rollData, { contextName: ability.uuid }); }
    catch { dist = parseInt(effect.flatForced.distance) || 1; }
    return { effect, firstMov, movConfig: ds.CONFIG.abilities.forcedMovement[firstMov], dist, props: new Set(Array.from(effect.flatForced.properties)) };
  });

  if (doFlatEffects && !activePanel.querySelector(DSTD_ROW)) {
    const list = activePanel.querySelector(`.${DSTD}-target-list`) ?? (() => {
      const l = document.createElement('div');
      l.className = `${DSTD}-target-list`;
      const footer = activePanel.querySelector('footer');
      if (footer) activePanel.insertBefore(l, footer);
      else activePanel.appendChild(l);
      return l;
    })();

    const stRow = document.createElement('div');
    stRow.className         = `${DSTD}-target-row`;
    stRow.dataset.targetKey = 'selected-token';

    const stHead = document.createElement('div');
    stHead.className = `${DSTD}-target-head`;
    const selfActor = selfOnlyFlat && !flatDamageEffects.length && !flatForcedEffects.length
      && !flatAppliedEffects.length && !flatHealEffects.length && !flatCleanseEffects.length
      ? ability.actor : null;

    const stImg = document.createElement('img');
    stImg.className = `${DSTD}-portrait`;
    stImg.src = selfActor?.prototypeToken?.texture?.src ?? selfActor?.img ?? 'icons/svg/target.svg';
    stImg.alt = selfActor?.name ?? '';
    const stName = document.createElement('div');
    stName.className  = `${DSTD}-target-name`;
    stName.textContent = selfActor?.name
      ?? (game.i18n.localize('DSTD.Chat.SelectedToken') || 'Apply to Selected Token');
    stHead.append(stImg, stName);

    const stBody = document.createElement('div');
    stBody.className = `${DSTD}-target-body`;
    const stActions = document.createElement('div');
    stActions.className = `${DSTD}-target-actions`;
    stBody.append(stActions);

    stRow.append(stHead, stBody);
    list.append(stRow);
    activePanel.classList.add(`${DSTD}-single-target`);
  }

  
  await syncBaseRollTier(message, root).catch(() => {});

  if (doFlatEffects) {
    const previewParts = [];
    for (const { effect, amount } of flatDamageResolved) {
      if (!amount) continue;
      if (effect.flatDamage.displayText) { previewParts.push(effect.flatDamage.displayText); continue; }
      const chosenFlat = message.getFlag(M, 'flatDmgTypes')?.[effect.id] ?? null;
      const allTypes   = Array.from(effect.flatDamage.types);
      const trigType   = triggerDamageTypeFor(effect, message);
      const typeList   = chosenFlat && allTypes.includes(chosenFlat) ? [chosenFlat] : allTypes.length ? allTypes : trigType ? [trigType] : [];
      const typeLabel = typeList.length
        ? game.i18n.getListFormatter({ type: 'disjunction' }).format(typeList.map(t => ds.CONFIG.damageTypes[t]?.label ?? t))
        : game.i18n.localize('DRAW_STEEL.DamageType.typeless');
      previewParts.push(`${amount} ${typeLabel} damage`);
    }
    for (const { effect, movConfig, firstMov, dist } of flatForcedResolved) {
      if (effect.flatForced.displayText) { previewParts.push(effect.flatForced.displayText); continue; }
      previewParts.push(`${movConfig?.label ?? firstMov} ${dist}`);
    }
    for (const effect of flatAppliedEffects) {
      const { statusId, displayText, potency } = effect.flatApplied;
      
      
      let previewText = displayText || flatAppliedLabel(ability, statusId).name || statusId;
      if (previewText.includes('{{potency}}') && potency?.characteristic) {
        const abbrev = ds.CONFIG.characteristics[potency.characteristic]?.abbreviation ?? potency.characteristic;
        const strength = potency.strength === 'custom' ? (potency.custom || 'average') : (potency.strength || 'average');
        const enricher = `[[potency characteristic=${abbrev} strength=${strength}]]`;
        previewText = previewText.replace(/\{\{potency\}\}/g, enricher).trim();
      }
      previewParts.push(previewText);
    }
    for (const effect of flatResourceEffects) {
      const rv = effect.flatResource ?? {};
      if (!rv.amount) continue;
      if (rv.displayText) { previewParts.push(rv.displayText); continue; }
      previewParts.push(rv.display || effect.label);
    }
    for (const effect of flatHealEffects) {
      const h = effect.flatHeal ?? {};
      if (h.displayText) { previewParts.push(h.displayText); continue; }
      previewParts.push(h.display || healAutoLabel(h, h.recoveryValueSource === 'target' ? null : sourceActor));
    }
    for (const effect of flatCleanseEffects) {
      previewParts.push(cleansePreviewLabel(effect.flatCleanse));
    }
    for (const effect of flatTeleportEffects) {
      const tv = effect.flatTeleport ?? {};
      if (tv.displayText) { previewParts.push(tv.displayText); continue; }
      previewParts.push(effect.label);
    }
    if (previewParts.length) {
      const tierTextDds = activePanel.querySelectorAll(`dd.${DSTD}-tier-text`);
      if (tierTextDds.length) {
        const suffix = '; ' + previewParts.join('; ');
        const _appendSuffix = (span) => {
          const text = span.textContent.replace(/\.\s*$/, '') + suffix;
          span.textContent = text;
          foundry.applications.ux.TextEditor.implementation.enrichHTML(text, { async: true }).then(html => { span.innerHTML = html; }).catch(() => {});
        };
        for (const dd of tierTextDds) {
          if (dd.dataset.dsctFlatPreview) continue;
          dd.dataset.dsctFlatPreview = '1';
          const existingSpan = dd.querySelector('span');
          if (existingSpan?.textContent.trim()) {
            _appendSuffix(existingSpan);
          } else {
            const obs = new MutationObserver((_, o) => {
              const span = dd.querySelector('span');
              if (!span?.textContent.trim()) return;
              _appendSuffix(span);
              o.disconnect();
            });
            obs.observe(dd, { childList: true, subtree: true });
          }
        }
      } else if (!activePanel.querySelector('.dsct-flat-preview')) {
        const rawText = previewParts.join('; ');
        for (const previewRow of activePanel.querySelectorAll(DSTD_ROW)) {
          const previewBody = previewRow.querySelector(`.${DSTD}-target-body`);
          if (!previewBody) continue;
          
          const dl = document.createElement('dl');
          dl.className = `${DSTD}-tier-result power-roll-display dsct-flat-preview`;
          const dd = document.createElement('dd');
          dd.className = `${DSTD}-tier-text`;
          
          dd.dataset.dsctFlatPreview = '1';
          dd.textContent = rawText;
          foundry.applications.ux.TextEditor.implementation.enrichHTML(rawText, { async: true }).then(html => { dd.innerHTML = html; }).catch(() => {});
          dl.appendChild(dd);
          previewBody.insertBefore(dl, previewBody.querySelector(`.${DSTD}-target-actions`));
        }
      }
    }
  }

  
  
  const selfApplied = flatAppliedEffects.filter(e => e.flatApplied?.exclusiveSelf && e.flatApplied?.statusId);
  const selfFlat = flatHealEffects.some(e => e.flatHeal?.recipient === 'self') || flatCleanseEffects.some(e => e.flatCleanse?.recipient === 'self');
  if ((selfApplied.length || selfFlat) && sourceToken) {
    const selfKey = sourceToken.document.uuid.replace(/\./g, '__');
    if (!activePanel.querySelector(`${DSTD_ROW}[data-target-key="${selfKey}"]`)
      && !activePanel.querySelector('[data-dsct-self-only]')) {
      const list = activePanel.querySelector(`.${DSTD}-target-list`) ?? activePanel;
      const row = _syntheticTargetRow(sourceToken);
      row.dataset.dsctSelfOnly = '1';
      list.append(row);
    }
  }

  const othersEffects = [...flatDamageEffects, ...flatHealEffects, ...flatResourceEffects].filter(isOthersEffect);
  if (othersEffects.length) await _addOthersRows(message, activePanel, othersEffects, { sourceToken, ability });

  const targetRows = activePanel.querySelectorAll(DSTD_ROW);
  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons found ${targetRows.length} target rows`);

  for (const row of targetRows) {
    const targetKey = row.dataset.targetKey;
    if (!targetKey) continue;
    
    const tokenUuid = targetKey === 'selected-token' ? null : targetKey.replace(/__/g, '.');
    const rowTier = _effectiveRowTier(message, targetKey, tokenUuid, tier);
    const rowTiered = _flatOn ? tieredAsFlat(ability, rowTier) : [];
    const selfOnlyRow = row.dataset.dsctSelfOnly === '1';
    const othersOnlyRow = row.dataset.dsctOthersOnly === '1';
    const othersHere = new Set((row.dataset.dsctOthers ?? '').split(',').filter(Boolean));
    const userRowKey = sourceToken ? sourceToken.document.uuid.replace(/\./g, '__') : null;
    const onUserRow = selfOnlyRow || (!!userRowKey && targetKey === userRowKey);
    const fitsRow = (recipient, effect) => (recipient === 'others' ? othersHere.has(effect.id)
      : recipient === 'self' ? onUserRow : !selfOnlyRow && !othersOnlyRow);
    const rowHealEffects    = [...flatHealEffects, ...rowTiered.filter(e => e.type === 'dsct.flatHeal')].filter(e => fitsRow(e.flatHeal?.recipient, e));
    const rowCleanseEffects = flatCleanseEffects.filter(e => fitsRow(e.flatCleanse?.recipient, e));
    const rowTeleportEffects = selfOnlyRow || othersOnlyRow ? [] : [...flatTeleportEffects, ...rowTiered.filter(e => e.type === 'dsct.flatTeleport')];

    const body = row.querySelector(`.${DSTD}-target-body`);
    if (!body) continue;
    const actions = body.querySelector(`.${DSTD}-target-actions`) ?? body;

    for (const effect of fmEffects) {
      if (!doFm || selfOnlyRow || othersOnlyRow) break;
      const tierData = effect.forced?.[`tier${rowTier}`];
      if (!tierData) continue;
      const movementSet = tierData.movement instanceof Set ? tierData.movement : new Set(tierData.movement ?? []);
      const properties  = tierData.properties instanceof Set ? tierData.properties : new Set(tierData.properties ?? []);
      const distanceRaw = String(tierData.distance ?? '0');
      const rollData    = ability.getRollData?.() ?? {};
      let baseDistance;
      try {
        baseDistance = typeof ds?.utils?.evaluateFormula === 'function'
          ? ds.utils.evaluateFormula(distanceRaw, rollData)
          : Roll.safeEval(Roll.replaceFormulaData(distanceRaw, rollData));
      } catch { baseDistance = parseInt(distanceRaw) || 0; }

      const verticalDistance = ability.getFlag(M, `fmVerticalDistance${rowTier}`) ?? 0;
      const fallRed1         = ability.getFlag(M, 'fmFallReduction1') ?? 0;
      const fallRedN         = ability.getFlag(M, `fmFallReduction${rowTier}`);
      const fallReduction    = fallRedN != null ? fallRedN : fallRed1;

      for (const movementType of movementSet) {
        if (!movementType) continue;
        const stateKey = `${message.id}:${targetKey}:${movementType}`;
        const subKey   = `${targetKey}:${movementType}`;

        if (actions.querySelector(`[data-dsct-fm-key="${stateKey}"]`)) continue;

        const baseState = _buildBaseState(movementType, baseDistance, properties, verticalDistance, fallReduction);
        if (autoFm && /^(push|pull)$/i.test(movementType)) baseState.fastMove = true;

        const _tgtDoc      = tokenUuid ? fromUuidSync(tokenUuid) : null;
        const _tgtIsFlying = !baseState.vertical && (_tgtDoc?.actor?.statuses?.has('fly') ?? false);
        const _flyingMod   = _tgtIsFlying ? {
          modState: [{
            distanceDelta:             0,
            movement:                  movementType,
            vertical:                  true,
            verticalDistance:          '',
            fallReduction:             baseState.fallReduction,
            noFallDamage:              baseState.noFallDamage,
            noCollisionDamage:         baseState.noCollisionDamage,
            noMoverCollisionDamage:    baseState.noMoverCollisionDamage,
            noObstacleCollisionDamage: baseState.noObstacleCollisionDamage,
            ignoreStability:           baseState.ignoreStability,
            fastMove:                  baseState.fastMove,
          }],
          noteName: 'Flying',
          noteDesc:  '',
        } : null;

        const _bvlApplies = sourceToken?.actor && _tgtDoc?.actor
          && chooseKeywords(ability, message).has('melee')
          && chooseKeywords(ability, message).has('weapon')
          && sizeRank(sourceToken.actor.system?.combat?.size ?? { value: 1, letter: 'M' })
             > sizeRank(_tgtDoc.actor.system?.combat?.size ?? { value: 1, letter: 'M' });
        const _bvlMod = _bvlApplies ? {
          modState: [{
            distanceDelta:             1,
            movement:                  movementType,
            vertical:                  baseState.vertical,
            verticalDistance:          baseState.verticalDistance ?? '',
            fallReduction:             baseState.fallReduction,
            noFallDamage:              baseState.noFallDamage,
            noCollisionDamage:         baseState.noCollisionDamage,
            noMoverCollisionDamage:    baseState.noMoverCollisionDamage,
            noObstacleCollisionDamage: baseState.noObstacleCollisionDamage,
            ignoreStability:           baseState.ignoreStability,
            fastMove:                  baseState.fastMove,
          }],
          noteName: 'Big vs Little',
          dsctSeeded: true,
          noteDesc: '',
          srcTokenId: sourceToken.id,
        } : null;

        const _spentRx = new RegExp(game.i18n.localize('DRAW_STEEL.Item.ability.ConfigureUse.SpentFlavor')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{value\\}', '(\\d+)').replace('\\{name\\}', '.+'));
        const _spentN = (Number(_spentRx.exec(message?.flavor ?? '')?.[1]) || 0) - (Number(ability.system?.resource) || 0);
        const _spendFormula = ability.getFlag(M, 'fmSpendBonus');
        let _spendBonus = 0;
        if (_spentN > 0 && _spendFormula) {
          try { _spendBonus = Number(ds.utils.evaluateFormula(String(_spendFormula).replace(/@spend\b/gi, String(_spentN)), ability.getRollData?.() ?? {})) || 0; }
          catch { _spendBonus = 0; }
        }
        const _spendMod = _spendBonus > 0 ? {
          modState: [{
            distanceDelta:             _spendBonus,
            movement:                  movementType,
            vertical:                  baseState.vertical,
            verticalDistance:          baseState.verticalDistance ?? '',
            fallReduction:             baseState.fallReduction,
            noFallDamage:              baseState.noFallDamage,
            noCollisionDamage:         baseState.noCollisionDamage,
            noMoverCollisionDamage:    baseState.noMoverCollisionDamage,
            noObstacleCollisionDamage: baseState.noObstacleCollisionDamage,
            ignoreStability:           baseState.ignoreStability,
            fastMove:                  baseState.fastMove,
          }],
          noteName: game.i18n.localize('DSCT.panel.modFm.spent'),
          dsctSeeded: true,
          noteDesc: '',
        } : null;

        let quickBtn = null;

        let saved = _fmState.get(stateKey);
        if (!saved) {
          const fromFlags = savedFlagState[subKey];
          const seeds = [...(_bvlMod ? [_bvlMod] : []), ...(_spendMod ? [_spendMod] : []), ...(_flyingMod ? [_flyingMod] : [])];

          
          
          
          
          saved = fromFlags
            ? {
              applied: fromFlags.applied ?? false,
              undoMsgId: fromFlags.undoMsgId ?? null,
              modStack: [
                ...(fromFlags.seeded ? [] : seeds),
                ...(fromFlags.modStack ?? []).map(e => ({ ...e })),
              ],
            }
            : { applied: false, undoMsgId: null, modStack: seeds };
          saved.seeded = true;
          _fmState.set(stateKey, saved);
        }
        saved.redirected = savedFlagState[subKey]?.redirected ?? null;

        const effInit        = _effectiveState(baseState, saved.modStack);
        const label          = _makeLabel(effInit);
        const rowLabelFn     = (st) => `Apply ${_makeLabel(st)}${_stabSuffix(_stabInfo(tokenUuid, st), false)}`;
        const fmSquadMinions = squadTargetMap?.[targetKey]?.minionIds ?? [];

        const applyBtn = document.createElement('button');
        applyBtn.type         = 'button';
        applyBtn.className    = `${DSTD}-action-button ${DSTD}-stretch-button`;
        _tip(applyBtn, 'fm', { title: label });

        const undoBtn = document.createElement('button');
        undoBtn.type         = 'button';
        undoBtn.className    = `${DSTD}-icon-button ${DSTD}-undo-button dsct-dstd-undo-btn`;
        _tip(undoBtn, 'fmUndo');
        undoBtn.append(_makeIcon('fa-solid fa-rotate-left'));

        const modBtn = document.createElement('button');
        modBtn.type         = 'button';
        modBtn.className    = `${DSTD}-icon-button ${DSTD}-cog-button dsct-dstd-modify-btn`;
        _tip(modBtn, 'fmModify');
        modBtn.append(_makeIcon('fa-solid fa-gear'));

        const fmRow = document.createElement('div');
        fmRow.className         = `${DSTD}-action-row dsct-dstd-fm-row`;
        fmRow.dataset.dsctFmKey = stateKey;
        fmRow.append(applyBtn, undoBtn, modBtn);

        _syncRow(fmRow, applyBtn, undoBtn, modBtn, saved, label, _stabInfo(tokenUuid, effInit));

        
        
        
        const makePersistFn = () => async (_msgEl, stack) => {
          const cur     = _fmState.get(stateKey) ?? { applied: false, undoMsgId: null, modStack: [] };
          const newMods = { ...cur, modStack: stack.map(e => ({ ...e })) };
          _fmState.set(stateKey, newMods);
          if (!newMods.applied) {
            const effState = _effectiveState(baseState, newMods.modStack);
            _syncRow(fmRow, applyBtn, undoBtn, modBtn, newMods, _makeLabel(effState), _stabInfo(tokenUuid, effState));
            if (quickBtn) _syncQuickBtn(quickBtn, newMods, movementType, effState.distance);
          }
          await _persistDstdState(message, subKey, newMods);
        };

        applyBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          if (applyBtn.disabled) return;

          let targetToken = null;
          if (tokenUuid) {
            const targetDoc = await fromUuid(tokenUuid).catch(() => null);
            targetToken = targetDoc?.object ?? null;
            if (!targetToken) { ui.notifications.warn('DSCT | Target token not found on canvas'); return; }
          }

          _setRowExecuting(fmRow, applyBtn, undoBtn, modBtn, quickBtn);
          _fmExecutingKeys.add(stateKey);
          getModuleApi(false)?.socket?.executeForOthers('dsct.fmRowExecuting', stateKey, true);

          let capturedMsgId = null;
          const hookId = Hooks.once('createChatMessage', (msg) => {
            if (msg.getFlag(M, 'isFmUndo')) capturedMsgId = msg.id;
          });

          const cur        = _fmState.get(stateKey) ?? saved;
          const clickState = _effectiveState(baseState, cur.modStack);
          const props      = new Set([
            clickState.vertical                ? 'vertical'                    : null,
            clickState.noCollisionDamage       ? 'no-collision-damage'         : null,
            clickState.noMoverCollisionDamage  ? 'no-mover-collision-damage'   : null,
            clickState.noObstacleCollisionDamage ? 'no-obstacle-collision-damage' : null,
            clickState.ignoreStability         ? 'ignore-stability'             : null,
            clickState.fastMove                ? 'fast-auto-path'               : null,
          ].filter(Boolean));
          const vertDist = clickState.vertical
            ? (clickState.verticalDistance !== '' ? Number(clickState.verticalDistance) : clickState.distance)
            : 0;

          let fmSource = sourceToken;
          if (fmSquadMinions.length) {
            let candidates = fmSquadMinions.map(id => canvas.tokens.get(id)).filter(Boolean);
            if (targetToken && candidates.length > 1) {
              const rawRange = _squadAbilityRange(ability);
              if (rawRange) {
                const rangeDist = rawRange * canvas.grid.distance;
                const inRange = candidates.filter(t => tokFootprintDist(t, targetToken) < rangeDist);
                if (inRange.length) candidates = inRange;
              }
            }
            if (candidates.length === 1) {
              fmSource = candidates[0];
            } else if (candidates.length > 1) {
              const colorMap = new Map(candidates.map(t => [t.id, '#ffaa00']));
              const picked = await runColoredTokenPicker({
                tokens: candidates, colorMap,
                hint: `SQUAD FM | Select which minion executes the ${clickState.movement}. Escape to cancel.`,
              });
              if (picked) fmSource = picked;
            }
          }

          try {
            await runForcedMovement({
              movement: clickState.movement, distance: String(clickState.distance),
              properties: props, verticalDistance: vertDist, fallReduction: clickState.fallReduction,
              target: targetToken,
              source: (clickState.sourceTokenId ? canvas.tokens.get(clickState.sourceTokenId) : null) ?? fmSource,
              contextMessageId: message.id,
              origin: "powerRoll",
            });
          } catch {  }

          Hooks.off('createChatMessage', hookId);
          _fmExecutingKeys.delete(stateKey);
          getModuleApi(false)?.socket?.executeForOthers('dsct.fmRowExecuting', stateKey, false);

          if (!capturedMsgId) {
            
            const prevState = _fmState.get(stateKey) ?? saved;
            const prevEff   = _effectiveState(baseState, prevState.modStack);
            _syncRow(fmRow, applyBtn, undoBtn, modBtn, prevState, _makeLabel(prevEff), _stabInfo(tokenUuid, prevEff));
            if (quickBtn) _syncQuickBtn(quickBtn, prevState, movementType, prevEff.distance);
            return;
          }

          const newState = { ...cur, applied: true, undoMsgId: capturedMsgId };
          _fmState.set(stateKey, newState);
          _fmUndoIndex.set(capturedMsgId, { fmRow, applyBtn, undoBtn, modBtn, quickBtn, stateKey, baseState, movementType, message, subKey, tokenUuid });
          _syncRow(fmRow, applyBtn, undoBtn, modBtn, newState, _makeLabel(clickState), _stabInfo(tokenUuid, clickState));
          if (quickBtn) _syncQuickBtn(quickBtn, newState, movementType, clickState.distance);
          await _persistDstdState(message, subKey, newState);
        });

        undoBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          if (undoBtn.disabled) return;
          const redirCur = _fmState.get(stateKey) ?? saved;
          if (redirCur.redirected) {
            await _undoFmRedirect(message, subKey, stateKey, movementType, redirCur);
            return;
          }
          const msgId = undoBtn.dataset.dsctFmMsgId;
          if (!msgId) return;

          const chatLi   = document.querySelector(`[data-message-id="${msgId}"]`);
          const dsctUndo = chatLi?.querySelector('.dsct-undo-fm');
          if (dsctUndo) {
            dsctUndo.click();
            _fmUndoIndex.delete(msgId);
          } else {
            ui.notifications.warn('DSCT | Could not find FM undo button in chat log');
            return;
          }

          const cur      = _fmState.get(stateKey) ?? saved;
          const newState = { ...cur, applied: false, undoMsgId: msgId };
          _fmState.set(stateKey, newState);
          const undoEff  = _effectiveState(baseState, newState.modStack);
          _syncRow(fmRow, applyBtn, undoBtn, modBtn, newState, _makeLabel(undoEff), _stabInfo(tokenUuid, undoEff));
          if (quickBtn) _syncQuickBtn(quickBtn, newState, movementType, undoEff.distance);
          await _persistDstdState(message, subKey, newState);
        });

        modBtn.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          if (modBtn.disabled) return;

          const cur        = _fmState.get(stateKey) ?? saved;
          const panelBase  = { ...baseState };
          const panelState = _effectiveState(panelBase, cur.modStack);
          const effects    = [{ name: _makeLabel(panelBase) }];

          const existing = getWindowById('dsct-fm-modify');
          if (existing) existing.close();

          new FmModifyPanel(
            [panelState], [panelBase], cur.modStack, effects,
            [applyBtn], rowLabelFn, actions, actions, makePersistFn(),
          ).render({ force: true });
        });

        if (fmSquadMinions.length) {
          applyBtn.addEventListener('mouseenter', () => _hoverMinions(fmSquadMinions));
          applyBtn.addEventListener('mouseleave', () => _unhoverMinions(fmSquadMinions));
        }

        actions.appendChild(fmRow);

        const head   = row.querySelector(`.${DSTD}-target-head`);
        const toggle = head?.querySelector(`.${DSTD}-target-toggle`);
        if (head && toggle && targetRows.length > 1 && getSetting('dstdQuickFmButton')) {
          quickBtn = document.createElement('button');
          quickBtn.type      = 'button';
          quickBtn.className = `${DSTD}-action-button ${DSTD}-quick-damage dsct-dstd-quick-fm-btn`;
          quickBtn.addEventListener('click', (e) => {
            e.stopPropagation(); e.preventDefault();
            if (!quickBtn.disabled) applyBtn.click();
          });
          const initEff = _effectiveState(baseState, saved.modStack);
          _syncQuickBtn(quickBtn, saved, movementType, initEff.distance);
          head.insertBefore(quickBtn, toggle);
          if (fmSquadMinions.length) {
            quickBtn.addEventListener('mouseenter', () => _hoverMinions(fmSquadMinions));
            quickBtn.addEventListener('mouseleave', () => _unhoverMinions(fmSquadMinions));
          }

          
          for (const qdBtn of head.querySelectorAll(`.${DSTD}-quick-damage:not(.dsct-dstd-quick-fm-btn):not([data-dsct-condensed])`)) {
            const fullText = qdBtn.textContent.trim();
            if (!qdBtn.dataset.dsctTip) _tip(qdBtn, 'quickDamage', { title: qdBtn.dataset.tooltip || fullText });
            const numMatch = fullText.match(/\d+/);
            const iconEls  = [...qdBtn.children].filter(c => c.tagName === 'I' || c.tagName === 'IMG');
            qdBtn.replaceChildren(...iconEls);
            if (numMatch) qdBtn.append(_makeSpan(numMatch[0]));
            qdBtn.setAttribute('data-dsct-condensed', '1');
          }
        }

        
        if (saved.modStack.length) {
          const panelBase   = { ...baseState };
          const panelStates = [_effectiveState(panelBase, saved.modStack)];
          for (const entry of saved.modStack) {
            createModifierNoteDiv(entry, saved.modStack, [panelBase], panelStates, [applyBtn], rowLabelFn, actions, actions, makePersistFn());
          }
        }

        if (_fmExecutingKeys.has(stateKey)) _setRowExecuting(fmRow, applyBtn, undoBtn, modBtn, quickBtn);
      }
    }

    if (doConditions && !othersOnlyRow) {
      for (const effect of appliedEffects) {
        const tierData = effect.applied?.[`tier${rowTier}`];
        if (!tierData?.effects) continue;
        const effectEntries = tierData.effects instanceof Map
          ? [...tierData.effects.entries()]
          : Object.entries(tierData.effects);

        for (const [effectId, effectData] of effectEntries) {
          const condKey = `${targetKey}:cond:${effectId}`;
          if (actions.querySelector(`[data-dsct-dstd-cond="${condKey}"]`)) continue;
          const endStr = effectData?.end ?? '';

          if (effectId === 'grabbed' && getSetting('grabEnabled')) {
            const grabTargetDoc  = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
            const grabTargetTok  = grabTargetDoc?.object ?? null;
            const grabbedId      = grabTargetTok?.id ?? null;
            const alreadyGrabbed = grabbedId ? !!window._activeGrabs?.has(grabbedId) : false;

            const grabImg = document.createElement('img');
            grabImg.src = CONFIG.statusEffects.find(st => st.id === 'grabbed')?.img ?? 'systems/draw-steel/assets/icons/hand-grabbing-fill.svg';
            grabImg.alt = '';
            grabImg.className = `${DSTD}-button-icon-img`;
            const grabSpan = document.createElement('span');
            grabSpan.textContent = alreadyGrabbed ? 'Applied: Grabbed' : 'Grabbed';
            const grabBtn = document.createElement('button');
            grabBtn.type = 'button';
            grabBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
            grabBtn.dataset.dsctDstdCond = condKey;
            _tip(grabBtn, alreadyGrabbed ? 'grabApplied' : 'grab');
            grabBtn.disabled = alreadyGrabbed;
            grabBtn.append(grabImg, grabSpan);

            const undoGrabBtn = document.createElement('button');
            undoGrabBtn.type = 'button';
            undoGrabBtn.classList.add(`${DSTD}-icon-button`, `${DSTD}-undo-button`);
            _tip(undoGrabBtn, 'grabUndo');
            undoGrabBtn.disabled = !alreadyGrabbed;
            undoGrabBtn.append(_makeIcon('fa-solid fa-rotate-left'));

            const settingsGrabBtn = document.createElement('button');
            settingsGrabBtn.type = 'button';
            settingsGrabBtn.classList.add(`${DSTD}-icon-button`, `${DSTD}-cog-button`);
            _tip(settingsGrabBtn, 'grabSettings');
            settingsGrabBtn.disabled = true;
            settingsGrabBtn.append(_makeIcon('fa-solid fa-gear'));

            grabBtn.addEventListener('click', async (e) => {
              e.stopPropagation(); e.preventDefault();
              const shiftBypass = e.shiftKey;
              if (!shiftBypass && getSetting('restrictGrabButtons') && !game.user.isGM) return;
              if (!sourceToken) { ui.notifications.warn(game.i18n.localize('DSCT.notice.sys.controlGrabber')); return; }
              let targetToken = null;
              if (tokenUuid) {
                const d = await fromUuid(tokenUuid).catch(() => null);
                targetToken = d?.object ?? null;
              } else {
                targetToken = [...game.user.targets].find(t => t.id !== sourceToken?.id) ?? null;
              }
              if (!targetToken) { ui.notifications.warn('DSCT | Target token not found on canvas'); return; }
              const appliedProps = tierData?.properties instanceof Set ? tierData.properties : new Set(tierData?.properties ?? []);
              if (!shiftBypass && !appliedProps.has('ignore-size') && !(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
                const mightOvr = isNullGrabIntuitionActive(sourceToken.actor) ? nullIntuitionScore(sourceToken.actor) : null;
                if (!canForcedMoveTarget(sourceToken.actor, targetToken.actor, mightOvr)) {
                  ui.notifications.warn(game.i18n.format('DSCT.notice.sys.grabTargetTooLarge', { grabber: sourceToken.name, target: targetToken.name }));
                  return;
                }
              }
              if (dsid === 'grab') await runGrab(sourceToken, targetToken, { tier: rowTier, maxGrabs, ignoreSizeCheck: shiftBypass });
              else {
                await applyGrab(sourceToken, targetToken, { maxGrabs });
                grabChat(`<strong>Grab:</strong> ${sourceToken.name} grabs ${targetToken.name}!`, [sourceToken, targetToken]);
              }
              grabBtn.disabled = true;
              undoGrabBtn.disabled = false;
              grabSpan.textContent = 'Applied: Grabbed';
              _tip(grabBtn, 'grabApplied');
            });

            undoGrabBtn.addEventListener('click', async (e) => {
              e.stopPropagation(); e.preventDefault();
              const d   = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
              const tId = d?.object?.id ?? grabbedId;
              if (!tId) return;
              await endGrab(tId);
              grabBtn.disabled = false;
              undoGrabBtn.disabled = true;
              grabSpan.textContent = 'Grabbed';
              _tip(grabBtn, 'grab');
            });

            const grabRow = document.createElement('div');
            grabRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
            grabRow.dataset.dsctManual = '1';
            grabRow.append(grabBtn, undoGrabBtn, settingsGrabBtn);
            actions.appendChild(grabRow);
          }

          else if (effectId === 'frightened' && getSetting('frightenedEnabled')) {
            const condBtn = document.createElement('button');
            condBtn.type      = 'button';
            condBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
            condBtn.dataset.dsctDstdCond = condKey;
            _tip(condBtn, 'frightened');
            condBtn.append(_makeIcon('fa-solid fa-skull'), _makeSpan('Apply Frightened'));
            condBtn.addEventListener('click', async (e) => {
              e.stopPropagation(); e.preventDefault();
              let targetToken = null;
              if (tokenUuid) {
                const d = await fromUuid(tokenUuid).catch(() => null);
                targetToken = d?.object ?? null;
              } else {
                targetToken = [...game.user.targets][0] ?? null;
              }
              if (!targetToken) { ui.notifications.warn('DSCT | Target token not found on canvas'); return; }
              await applyFrightened(targetToken, sourceActor, sourceToken?.id ?? null, endStr);
            });
            const condRow = document.createElement('div');
            condRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
            condRow.append(condBtn);
            actions.appendChild(condRow);
          }

          else if (effectId === 'taunted' && getSetting('tauntedEnabled')) {
            const condBtn = document.createElement('button');
            condBtn.type      = 'button';
            condBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
            condBtn.dataset.dsctDstdCond = condKey;
            _tip(condBtn, 'taunted');
            condBtn.append(_makeIcon('fa-solid fa-skull'), _makeSpan('Apply Taunted'));
            condBtn.addEventListener('click', async (e) => {
              e.stopPropagation(); e.preventDefault();
              let targetToken = null;
              if (tokenUuid) {
                const d = await fromUuid(tokenUuid).catch(() => null);
                targetToken = d?.object ?? null;
              } else {
                targetToken = [...game.user.targets][0] ?? null;
              }
              if (!targetToken) { ui.notifications.warn('DSCT | Target token not found on canvas'); return; }
              await applyTaunted(targetToken, sourceActor, sourceToken?.id ?? null, endStr);
            });
            const condRow = document.createElement('div');
            condRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
            condRow.append(condBtn);
            actions.appendChild(condRow);
          }
        }
      }
    }

    if (doPf && tokenUuid && !othersOnlyRow) {
      const pfTargetDoc   = await fromUuid(tokenUuid).catch(() => null);
      const pfTargetActor = pfTargetDoc?.actor ?? null;
      if (pfTargetActor?.effects.some(ef => ef.changes?.some(c => c.key === 'system.damage.weaknesses.fire'))) {
        for (const { amount } of holyRolls) {
          const pfKey = `${targetKey}:pf:${amount}`;
          if (actions.querySelector(`[data-dsct-dstd-cond="${pfKey}"]`)) continue;
          const pfBtn = document.createElement('button');
          pfBtn.type      = 'button';
          pfBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
          pfBtn.dataset.dsctDstdCond = pfKey;
          _tip(pfBtn, 'purifyingFire', { title: game.i18n.format('DSCT.button.purifyingFireDamage', { amount }) });
          pfBtn.append(_makeIcon('fa-solid fa-fire'), _makeSpan(game.i18n.format('DSCT.button.purifyingFireDamage', { amount })));
          pfBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); e.preventDefault();
            const fireAmount = e.shiftKey ? Math.floor(amount / 2) : amount;
            await applyDamage(pfTargetActor, fireAmount, undefined, { damageType: 'fire' });
          });
          const pfRow = document.createElement('div');
          pfRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
          pfRow.dataset.dsctManual = '1';
          pfRow.append(pfBtn);
          actions.appendChild(pfRow);
        }
      }
    }

    if (doMark && !othersOnlyRow) {
      const markKey = `${targetKey}:dsct-mark`;
      if (!actions.querySelector(`[data-dsct-mark-key="${markKey}"]`)) {
        for (const nativeRow of actions.querySelectorAll(`.${DSTD}-status-row`)) {
          nativeRow.style.display = 'none';
        }

        const config     = MARK_ABILITY_CONFIG[dsid];
        const shortName  = config.override ? 'Mark (Override)' : 'Mark';
        const applyLbl   = `Apply ${shortName}`;
        const appliedLbl = `Applied: ${shortName}`;

        const targetDocMark   = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const targetActorMark = targetDocMark?.object?.actor ?? targetDocMark?.actor ?? null;
        const markIsApplied   = !!targetActorMark?.effects.some(e =>
          e.flags?.[M]?.mark?.userId === game.user.id &&
          (!sourceActor?.id || e.flags?.[M]?.mark?.actorId === sourceActor.id));

        const markBtn = document.createElement('button');
        markBtn.type = 'button';
        markBtn.classList.add(`${DSTD}-action-button`, `${DSTD}-stretch-button`);
        markBtn.dataset.dsctMarkKey = markKey;
        if (markIsApplied) _appliedTip(markBtn, 'mark', appliedLbl);
        else _tip(markBtn, 'mark', { title: applyLbl });
        markBtn.disabled            = markIsApplied;
        const markImg = document.createElement('img');
        markImg.src = 'icons/skills/targeting/crosshair-pointed-orange.webp';
        markImg.alt = '';
        markImg.classList.add(`${DSTD}-button-icon-img`);
        const markSpan = document.createElement('span');
        markSpan.textContent = markIsApplied ? appliedLbl : applyLbl;
        markBtn.append(markImg, markSpan);

        const undoMarkBtn = document.createElement('button');
        undoMarkBtn.type = 'button';
        undoMarkBtn.classList.add(`${DSTD}-icon-button`, `${DSTD}-undo-button`);
        _tip(undoMarkBtn, 'markUndo');
        undoMarkBtn.disabled        = !markIsApplied;
        undoMarkBtn.append(_makeIcon('fa-solid fa-rotate-left'));

        markBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          const d = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
          d?.object?.setTarget(true, { user: game.user, releaseOthers: true });
          await getModuleApi(false)?.mark({ ...config, dsid, sourceActorId: sourceActor?.id ?? null });
          markBtn.disabled        = true;
          undoMarkBtn.disabled    = false;
          markSpan.textContent    = appliedLbl;
          _appliedTip(markBtn, 'mark', appliedLbl);
        });

        undoMarkBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          const d     = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
          const actor = d?.object?.actor ?? d?.actor ?? null;
          if (actor) {
            for (const ef of [...actor.effects]) {
              if (ef.flags?.[M]?.mark?.userId === game.user.id &&
                  (!sourceActor?.id || ef.flags?.[M]?.mark?.actorId === sourceActor.id)) {
                await safeDelete(ef);
              }
            }
          }
          markBtn.disabled        = false;
          undoMarkBtn.disabled    = true;
          markSpan.textContent    = applyLbl;
          _tip(markBtn, 'mark', { title: applyLbl });
        });

        const markRow = document.createElement('div');
        markRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
        markRow.append(markBtn, undoMarkBtn);
        actions.appendChild(markRow);
      }
    }

    if (doJudgement && !othersOnlyRow) {
      const judgeKey = `${targetKey}:dsct-judgement`;
      if (!actions.querySelector(`[data-dsct-judge-key="${judgeKey}"]`)) {
        for (const nativeRow of actions.querySelectorAll(`.${DSTD}-status-row`)) {
          nativeRow.style.display = 'none';
        }

        const targetDocJudge   = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const targetActorJudge = targetDocJudge?.object?.actor ?? targetDocJudge?.actor ?? null;
        const judgeIsApplied   = !!targetActorJudge?.effects.some(e =>
          e.flags?.[M]?.judgement?.userId === game.user.id);

        const judgeBtn = document.createElement('button');
        judgeBtn.type = 'button';
        judgeBtn.classList.add(`${DSTD}-action-button`, `${DSTD}-stretch-button`);
        judgeBtn.dataset.dsctJudgeKey = judgeKey;
        if (judgeIsApplied) _appliedTip(judgeBtn, 'judgement', 'Applied: Judgement');
        else _tip(judgeBtn, 'judgement');
        judgeBtn.disabled             = judgeIsApplied;
        const judgeImg = document.createElement('img');
        judgeImg.src = 'icons/magic/death/skull-humanoid-white-red.webp';
        judgeImg.alt = '';
        judgeImg.classList.add(`${DSTD}-button-icon-img`);
        const judgeSpan = document.createElement('span');
        judgeSpan.textContent = judgeIsApplied ? 'Applied: Judgement' : 'Apply Judgement';
        judgeBtn.append(judgeImg, judgeSpan);

        const undoJudgeBtn = document.createElement('button');
        undoJudgeBtn.type = 'button';
        undoJudgeBtn.classList.add(`${DSTD}-icon-button`, `${DSTD}-undo-button`);
        _tip(undoJudgeBtn, 'judgementUndo');
        undoJudgeBtn.disabled        = !judgeIsApplied;
        undoJudgeBtn.append(_makeIcon('fa-solid fa-rotate-left'));

        judgeBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          const d = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
          d?.object?.setTarget(true, { user: game.user, releaseOthers: true });
          await getModuleApi(false)?.judgement();
          judgeBtn.disabled        = true;
          undoJudgeBtn.disabled    = false;
          judgeSpan.textContent    = 'Applied: Judgement';
          _appliedTip(judgeBtn, 'judgement', 'Applied: Judgement');
        });

        undoJudgeBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          const d     = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
          const actor = d?.object?.actor ?? d?.actor ?? null;
          if (actor) {
            for (const ef of [...actor.effects]) {
              if (ef.flags?.[M]?.judgement?.userId === game.user.id) {
                await safeDelete(ef);
              }
            }
          }
          judgeBtn.disabled        = false;
          undoJudgeBtn.disabled    = true;
          judgeSpan.textContent    = 'Apply Judgement';
          _tip(judgeBtn, 'judgement');
        });

        const judgeRow = document.createElement('div');
        judgeRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
        judgeRow.append(judgeBtn, undoJudgeBtn);
        actions.appendChild(judgeRow);
      }
    }

    if (doConditions && !othersOnlyRow) {
      for (const effect of appliedEffects) {
        if (!_tierHasPotency(effect, rowTier)) continue;
        for (const id of _tierEffectIds(effect, rowTier)) {
          actions.querySelector(`[data-dsct-dstd-cond="${targetKey}:cond:${id}"]`)?.closest(`.${DSTD}-action-row`)?.setAttribute('data-dsct-potency', '1');
        }
      }
    }

    for (const { statusId, endStr, label: enrichLabel, potency: enrichPotency } of descEnrichers) {
      if (othersOnlyRow) break;
      const enrichKey = `${targetKey}:enrich:${statusId}`;
      if (actions.querySelector(`[data-dsct-enrich-key="${enrichKey}"]`)) continue;
      if (actions.querySelector(`[data-dsct-dstd-cond*=":cond:${statusId}"]`)) continue;

      const targetDocE   = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
      const targetActorE = targetDocE?.object?.actor ?? targetDocE?.actor ?? null;
      const isApplied    = !!targetActorE?.statuses?.has(statusId);

      const applyLbl   = `Apply ${enrichLabel}`;
      const appliedLbl = `Applied: ${enrichLabel}`;

      const enrichBtn = document.createElement('button');
      enrichBtn.type = 'button';
      enrichBtn.classList.add(`${DSTD}-action-button`, `${DSTD}-stretch-button`);
      enrichBtn.dataset.dsctEnrichKey = enrichKey;
      if (isApplied) _appliedTip(enrichBtn, 'enricher', appliedLbl);
      else _tip(enrichBtn, 'enricher', { title: applyLbl });
      enrichBtn.disabled = isApplied;
      const enrichSpan = document.createElement('span');
      enrichSpan.textContent = isApplied ? appliedLbl : applyLbl;
      enrichBtn.append(_makeIcon('fa-solid fa-person-rays'), enrichSpan);

      const undoEnrichBtn = document.createElement('button');
      undoEnrichBtn.type = 'button';
      undoEnrichBtn.classList.add(`${DSTD}-icon-button`, `${DSTD}-undo-button`);
      _tip(undoEnrichBtn, 'conditionUndo', { title: `Undo ${enrichLabel}`, category: game.i18n.localize('DSCT.tip.enricher.category') });
      undoEnrichBtn.disabled = !isApplied;
      undoEnrichBtn.append(_makeIcon('fa-solid fa-rotate-left'));

      enrichBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        let targetToken = null;
        if (tokenUuid) {
          const d = await fromUuid(tokenUuid).catch(() => null);
          targetToken = d?.object ?? null;
        }
        if (!targetToken) { ui.notifications.warn('DSCT | Target token not found on canvas'); return; }
        if (SOURCED_STATUSES.has(statusId)) {
          if (!(await applyStatus(targetToken, statusId, { source: sourceToken?.actor ?? sourceActor, end: endStr }))) return;
        }
        else {
          const tmp = await CONFIG.ActiveEffect.documentClass.fromStatusEffect(statusId).catch(() => null);
          if (tmp) {
            const data = foundry.utils.mergeObject(tmp.toObject(), { transfer: true });
            if (endStr && ds?.CONFIG?.effectEnds?.[endStr]) {
              data.duration = { expiry: ds.CONFIG.effectEnds[endStr].expiryEvent };
              data.start = effectStartFor(targetToken.actor);
            }
            if (targetToken.actor) await safeCreateEmbedded(targetToken.actor, 'ActiveEffect', [data]);
          }
        }
        enrichBtn.disabled        = true;
        undoEnrichBtn.disabled    = false;
        enrichSpan.textContent    = appliedLbl;
        _appliedTip(enrichBtn, 'enricher', appliedLbl);
      });

      undoEnrichBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        const d     = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const actor = d?.object?.actor ?? d?.actor ?? null;
        if (actor) {
          for (const ef of [...(actor.appliedEffects ?? actor.effects)]) {
            if (ef.statuses?.has(statusId)) await safeDelete(ef);
          }
        }
        enrichBtn.disabled        = false;
        undoEnrichBtn.disabled    = true;
        enrichSpan.textContent    = applyLbl;
        _tip(enrichBtn, 'enricher', { title: applyLbl });
      });

      const enrichRow = document.createElement('div');
      enrichRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
      enrichRow.append(enrichBtn, undoEnrichBtn);
      if (enrichPotency) enrichRow.dataset.dsctPotency = '1';
      actions.appendChild(enrichRow);
    }

    for (const { effect, amount } of flatDamageResolved) {
      if (!amount) continue;
      if (isOthersEffect(effect) ? !othersHere.has(effect.id) : othersOnlyRow) continue;

      const chosenFlat = message.getFlag(M, 'flatDmgTypes')?.[effect.id] ?? null;
      const allTypes   = Array.from(effect.flatDamage.types);
      const trigType   = triggerDamageTypeFor(effect, message);
      const typeList   = chosenFlat && allTypes.includes(chosenFlat) ? [chosenFlat] : allTypes.length ? allTypes : trigType ? [trigType] : [];
      const immunities = Array.from(effect.flatDamage.ignoredImmunities);
      const damageType = typeList[0] ?? '';
      const typeLabel  = typeList.length
        ? game.i18n.getListFormatter({ type: 'disjunction' }).format(typeList.map(t => ds.CONFIG.damageTypes[t]?.label ?? t))
        : '';

      const targetObj = targetKey === 'selected-token'
        ? { selectedToken: true, name: game.i18n.localize('DSTD.Chat.SelectedToken') || 'Apply to Selected Token', img: 'icons/svg/target.svg' }
        : (dstdState?.targets ?? []).find(t => (t.tokenUuid?.replace(/\./g, '__') ?? '') === targetKey)
          ?? (othersHere.has(effect.id) ? _recipientTarget(tokenUuid) : null);
      if (!targetObj) continue;

      const flatDmgAction = { partId: effect.id };
      const operationId   = _dstdOperationId('damage', targetObj, flatDmgAction);
      if (actions.querySelector(`[data-operation-id="${operationId}"]`)) continue;

      const appRecord  = (dstdState?.applications ?? {})[operationId];
      const isApplied  = !targetObj.selectedToken && appRecord?.status === 'applied';
      const isUndone   = !targetObj.selectedToken && appRecord?.status === 'undone';
      const override   = (dstdState?.damageOverrides ?? {})[operationId];
      const dispAmount = override?.amount != null ? Number(override.amount) : amount;
      const surgeSfx   = override?.surges ? ` (${override.surges}s)` : '';
      const dispType      = override?.damageType ?? damageType;
      const dispTypeLabel = override?.typeLabel ?? typeLabel;
      const applyLabel = effect.flatDamage.display || (dispTypeLabel
        ? game.i18n.format('DSTD.Chat.ApplyTypedDamage', { amount: dispAmount, type: dispTypeLabel }) || `Apply ${dispAmount} ${dispTypeLabel}`
        : game.i18n.format('DSTD.Chat.ApplyDamage', { amount: dispAmount }) || `Apply ${dispAmount} Damage`);
      const fullLabel = `${applyLabel}${surgeSfx}`;

      const synDataset = {
        syntheticDamage:   'true',
        amount:            String(amount),
        formula:           String(amount),
        damageType:        dispType,
        typeLabel:         dispTypeLabel,
        isHeal:            'false',
        ignoredImmunities: JSON.stringify(immunities),
        partId:            effect.id,
        
      };

      if (getSetting('debugMode')) console.log(`DSCT | flatDamage button: target=${targetKey} amount=${amount} synDataset.amount=${synDataset.amount} formula=${synDataset.formula} operationId=${operationId} override=${JSON.stringify(override ?? null)}`);

      const targetJSON = JSON.stringify(targetObj);

      const applyDmgBtn = document.createElement('button');
      applyDmgBtn.type      = 'button';
      applyDmgBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      if (dispType) applyDmgBtn.classList.add(`${DSTD}-damage-type-${dispType}`);
      applyDmgBtn.dataset.dstdAction  = 'applyDamage';
      applyDmgBtn.dataset.target      = targetJSON;
      applyDmgBtn.dataset.operationId = operationId;
      if (isApplied) _appliedTip(applyDmgBtn, 'damage', fullLabel);
      else _tip(applyDmgBtn, 'damage', { title: fullLabel });
      applyDmgBtn.disabled = isApplied;
      Object.assign(applyDmgBtn.dataset, synDataset);
      const dmgLabel = isApplied ? `Applied ${appRecord?.amount ?? dispAmount}` : fullLabel;
      applyDmgBtn.append(_makeIcon(_dmgIcon(dispType)), _makeSpan(dmgLabel));

      
      let stackCount = 0;
      if (targetObj.selectedToken) {
        if (Array.isArray(appRecord?.stack)) stackCount = appRecord.stack.filter(r => r?.status === 'applied').length;
        else if (appRecord?.status === 'applied') stackCount = 1;
      }

      const undoDmgBtn = document.createElement('button');
      undoDmgBtn.type      = 'button';
      undoDmgBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      undoDmgBtn.dataset.dstdAction  = 'undoDamage';
      undoDmgBtn.dataset.target      = targetJSON;
      undoDmgBtn.dataset.operationId = operationId;
      _tip(undoDmgBtn, 'damageUndo');
      undoDmgBtn.disabled = targetObj.selectedToken ? stackCount <= 0 : !isApplied;
      undoDmgBtn.append(_makeIcon('fa-solid fa-rotate-left'));
      if (targetObj.selectedToken && stackCount > 0) {
        const badge = document.createElement('span');
        badge.className = `${DSTD}-undo-badge`;
        badge.textContent = String(stackCount);
        undoDmgBtn.append(badge);
      }

      const editDmgBtn = document.createElement('button');
      editDmgBtn.type      = 'button';
      editDmgBtn.className = `${DSTD}-icon-button ${DSTD}-cog-button`;
      editDmgBtn.dataset.dstdAction  = 'editDamage';
      editDmgBtn.dataset.target      = targetJSON;
      editDmgBtn.dataset.operationId = operationId;
      _tip(editDmgBtn, 'damageEdit');
      Object.assign(editDmgBtn.dataset, synDataset);
      editDmgBtn.append(_makeIcon('fa-solid fa-gear'));

      const dmgRow = document.createElement('div');
      dmgRow.className = `${DSTD}-action-row ${DSTD}-damage-row`;
      if (isApplied) dmgRow.classList.add('is-applied');
      if (isUndone)  dmgRow.classList.add('is-undone');
      dmgRow.append(applyDmgBtn, undoDmgBtn, editDmgBtn);
      actions.appendChild(dmgRow);

      const head   = row.querySelector(`.${DSTD}-target-head`);
      const toggle = head?.querySelector(`.${DSTD}-target-toggle`);
      if (head && toggle && targetRows.length > 1) {
        const quickDmgBtn = document.createElement('button');
        quickDmgBtn.type      = 'button';
        quickDmgBtn.className = `${DSTD}-action-button ${DSTD}-quick-damage dsct-dstd-quick-dmg-btn`;
        if (dispType) quickDmgBtn.classList.add(`${DSTD}-damage-type-${dispType}`);
        quickDmgBtn.disabled  = isApplied;
        _tip(quickDmgBtn, 'quickDamage', { title: fullLabel });
        quickDmgBtn.addEventListener('click', () => { if (!quickDmgBtn.disabled) applyDmgBtn.click(); });
        quickDmgBtn.append(_makeIcon(_dmgIcon(dispType)), _makeSpan(String(dispAmount)));
        head.insertBefore(quickDmgBtn, toggle);
      }
    }

    for (const { effect, firstMov, dist: baseDist, props } of flatForcedResolved) {
      if (othersOnlyRow) break;
      const rowActor = tokenUuid ? fromUuidSync(tokenUuid)?.actor : null;
      const needs = effect.flatForced.requiresStatus;
      if (needs && !rowActor?.statuses?.has(needs)) continue;
      let dist = baseDist;
      if (/@target\b/.test(effect.flatForced.distance) && rowActor) {
        try { dist = ds.utils.evaluateFormula(effect.flatForced.distance, { ...(ability.actor?.getRollData?.() ?? {}), target: rowActor.getRollData() }, { contextName: ability.uuid }); }
        catch { dist = baseDist; }
      }
      const stateKey = `${message.id}:${targetKey}:flatFm:${effect.id}`;
      const subKey   = `${targetKey}:flatFm:${effect.id}`;

      if (actions.querySelector(`[data-dsct-fm-key="${stateKey}"]`)) continue;

      const baseState = _buildBaseState(firstMov, dist, props, 0, 0);
      if (autoFm && /^(push|pull)$/i.test(firstMov)) baseState.fastMove = true;

      const _tgtDoc      = tokenUuid ? fromUuidSync(tokenUuid) : null;
      const _tgtIsFlying = !baseState.vertical && (_tgtDoc?.actor?.statuses?.has('fly') ?? false);
      const _flyingMod   = _tgtIsFlying ? {
        modState: [{
          distanceDelta: 0, movement: firstMov, vertical: true, verticalDistance: '',
          fallReduction: 0, noFallDamage: baseState.noFallDamage,
          noCollisionDamage: baseState.noCollisionDamage,
          noMoverCollisionDamage: baseState.noMoverCollisionDamage,
          noObstacleCollisionDamage: baseState.noObstacleCollisionDamage,
          ignoreStability: baseState.ignoreStability, fastMove: baseState.fastMove,
        }],
        noteName: 'Flying', noteDesc: '',
      } : null;

      let quickFlatBtn = null;

      let saved = _fmState.get(stateKey);
      if (!saved) {
        const fromFlags = savedFlagState[subKey];
        saved = fromFlags
          ? { applied: fromFlags.applied ?? false, undoMsgId: fromFlags.undoMsgId ?? null, modStack: (fromFlags.modStack ?? []).map(e => ({ ...e })) }
          : { applied: false, undoMsgId: null, modStack: _flyingMod ? [_flyingMod] : [] };
        _fmState.set(stateKey, saved);
      }
      saved.redirected = savedFlagState[subKey]?.redirected ?? null;

      const _flatFmDisplayOverride = effect.flatForced.display || null;
      const effInitF       = _effectiveState(baseState, saved.modStack);
      const label          = _flatFmLabel(_flatFmDisplayOverride, effInitF) + _spendSuffix(effect.flatForced.spend);
      const rowLabelFlatFn = (st) => (_flatFmDisplayOverride ? _flatFmLabel(_flatFmDisplayOverride, st) : `Apply ${_makeLabel(st)}`) + _stabSuffix(_stabInfo(tokenUuid, st), false);

      const applyFlatBtn = document.createElement('button');
      applyFlatBtn.type      = 'button';
      applyFlatBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      _tip(applyFlatBtn, 'fm', { title: label });

      const undoFlatBtn = document.createElement('button');
      undoFlatBtn.type      = 'button';
      undoFlatBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button dsct-dstd-undo-btn`;
      _tip(undoFlatBtn, 'fmUndo');
      undoFlatBtn.append(_makeIcon('fa-solid fa-rotate-left'));

      const modFlatBtn = document.createElement('button');
      modFlatBtn.type      = 'button';
      modFlatBtn.className = `${DSTD}-icon-button ${DSTD}-cog-button dsct-dstd-modify-btn`;
      _tip(modFlatBtn, 'fmModify');
      modFlatBtn.append(_makeIcon('fa-solid fa-gear'));

      const fmRow = document.createElement('div');
      fmRow.className         = `${DSTD}-action-row dsct-dstd-fm-row`;
      fmRow.dataset.dsctFmKey = stateKey;
      fmRow.append(applyFlatBtn, undoFlatBtn, modFlatBtn);

      _syncRow(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, saved, label, _stabInfo(tokenUuid, effInitF), !!_flatFmDisplayOverride);

      const makePersisFlatFn = () => async (_msgEl, stack) => {
        const cur     = _fmState.get(stateKey) ?? { applied: false, undoMsgId: null, modStack: [] };
        const newMods = { ...cur, modStack: stack.map(e => ({ ...e })) };
        _fmState.set(stateKey, newMods);
        if (!newMods.applied) {
          const effState = _effectiveState(baseState, newMods.modStack);
          const effLabel = _flatFmLabel(_flatFmDisplayOverride, effState);
          _syncRow(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, newMods, effLabel, _stabInfo(tokenUuid, effState), !!_flatFmDisplayOverride);
          if (quickFlatBtn) _syncQuickBtn(quickFlatBtn, newMods, firstMov, effState.distance);
        }
        await _persistDstdState(message, subKey, newMods);
      };

      applyFlatBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (applyFlatBtn.disabled) return;

        const _fmSpend = effect.flatForced.spend;
        if (_fmSpend?.enabled) {
          const _fmSpendKey = `flatSpend_${effect.id}`;
          if (!message.getFlag(M, _fmSpendKey)) {
            if (!sourceActor) { ui.notifications.warn('DSCT | No source actor for spend check'); return; }
            const _coreRes   = sourceActor.system.coreResource;
            const _curVal    = _coreRes ? (foundry.utils.getProperty(_coreRes.target, _coreRes.path) ?? 0) : 0;
            const _spendCost = _fmSpend.value ?? 1;
            if (_curVal < _spendCost) {
              const _resName = _coreRes?.name ?? game.i18n.localize('DSCT.FlatEffect.spend.resource');
              ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.spend.insufficient', { name: sourceActor.name, cost: _spendCost, resource: _resName }));
              return;
            }
            await _spendSourceResource(sourceActor, _spendCost);
            await safeSetFlag(message, M, _fmSpendKey, true);
          }
        }

        let targetToken = null;
        if (tokenUuid) {
          const targetDoc = await fromUuid(tokenUuid).catch(() => null);
          targetToken = targetDoc?.object ?? null;
          if (!targetToken) { ui.notifications.warn('DSCT | Target token not found on canvas'); return; }
        }

        _setRowExecuting(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, quickFlatBtn);
        _fmExecutingKeys.add(stateKey);
        getModuleApi(false)?.socket?.executeForOthers('dsct.fmRowExecuting', stateKey, true);

        let capturedMsgId = null;
        const hookId = Hooks.once('createChatMessage', (msg) => {
          if (msg.getFlag(M, 'isFmUndo')) capturedMsgId = msg.id;
        });

        const cur        = _fmState.get(stateKey) ?? saved;
        const clickState = _effectiveState(baseState, cur.modStack);
        const clickProps = new Set([
          clickState.vertical                ? 'vertical'                    : null,
          clickState.noCollisionDamage       ? 'no-collision-damage'         : null,
          clickState.noMoverCollisionDamage  ? 'no-mover-collision-damage'   : null,
          clickState.noObstacleCollisionDamage ? 'no-obstacle-collision-damage' : null,
          clickState.ignoreStability         ? 'ignore-stability'             : null,
          clickState.fastMove                ? 'fast-auto-path'               : null,
        ].filter(Boolean));
        const vertDist = clickState.vertical
          ? (clickState.verticalDistance !== '' ? Number(clickState.verticalDistance) : clickState.distance)
          : 0;

        try {
          await runForcedMovement({
            movement: clickState.movement, distance: String(clickState.distance),
            properties: clickProps, verticalDistance: vertDist, fallReduction: clickState.fallReduction,
            target: targetToken ?? undefined,
            source: (clickState.sourceTokenId ? canvas.tokens.get(clickState.sourceTokenId) : null)
              ?? (effect.flatForced?.origin === 'area' ? _areaOrigin(ability) : null) ?? sourceToken,
            contextMessageId: message.id,
            origin: "powerRoll",
            fmKey: subKey,
          });
        } catch { }

        Hooks.off('createChatMessage', hookId);
        _fmExecutingKeys.delete(stateKey);
        getModuleApi(false)?.socket?.executeForOthers('dsct.fmRowExecuting', stateKey, false);

        if (!capturedMsgId) {
          const prevState = _fmState.get(stateKey) ?? saved;
          const prevEff   = _effectiveState(baseState, prevState.modStack);
          _syncRow(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, prevState, _flatFmLabel(_flatFmDisplayOverride, prevEff), _stabInfo(tokenUuid, prevEff), !!_flatFmDisplayOverride);
          if (quickFlatBtn) _syncQuickBtn(quickFlatBtn, prevState, firstMov, prevEff.distance);
          return;
        }

        const newState = { ...cur, applied: true, undoMsgId: capturedMsgId };
        _fmState.set(stateKey, newState);
        _fmUndoIndex.set(capturedMsgId, { fmRow, applyBtn: applyFlatBtn, undoBtn: undoFlatBtn, modBtn: modFlatBtn, quickBtn: quickFlatBtn, stateKey, baseState, movementType: firstMov, message, subKey, tokenUuid, flatDisplayOverride: _flatFmDisplayOverride });
        _syncRow(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, newState, _flatFmLabel(_flatFmDisplayOverride, clickState), _stabInfo(tokenUuid, clickState), !!_flatFmDisplayOverride);
        if (quickFlatBtn) _syncQuickBtn(quickFlatBtn, newState, firstMov, clickState.distance);
        await _persistDstdState(message, subKey, newState);
      });

      undoFlatBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (undoFlatBtn.disabled) return;
        const msgId = undoFlatBtn.dataset.dsctFmMsgId;
        if (!msgId) return;

        const chatLi   = document.querySelector(`[data-message-id="${msgId}"]`);
        const dsctUndo = chatLi?.querySelector('.dsct-undo-fm');
        if (dsctUndo) {
          dsctUndo.click();
          _fmUndoIndex.delete(msgId);
        } else {
          ui.notifications.warn('DSCT | Could not find FM undo button in chat log');
          return;
        }

        const cur      = _fmState.get(stateKey) ?? saved;
        const newState = { ...cur, applied: false, undoMsgId: msgId };
        _fmState.set(stateKey, newState);
        const undoEff  = _effectiveState(baseState, newState.modStack);
        _syncRow(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, newState, _flatFmLabel(_flatFmDisplayOverride, undoEff), _stabInfo(tokenUuid, undoEff), !!_flatFmDisplayOverride);
        if (quickFlatBtn) _syncQuickBtn(quickFlatBtn, newState, firstMov, undoEff.distance);
        await _persistDstdState(message, subKey, newState);
      });

      modFlatBtn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (modFlatBtn.disabled) return;
        const cur        = _fmState.get(stateKey) ?? saved;
        const panelBase  = { ...baseState };
        const panelState = _effectiveState(panelBase, cur.modStack);
        const effects    = [{ name: _makeLabel(panelBase) }];
        const existing   = getWindowById('dsct-fm-modify');
        if (existing) existing.close();
        new FmModifyPanel(
          [panelState], [panelBase], cur.modStack, effects,
          [applyFlatBtn], rowLabelFlatFn, actions, actions, makePersisFlatFn(),
        ).render({ force: true });
      });

      actions.appendChild(fmRow);

      const head   = row.querySelector(`.${DSTD}-target-head`);
      const toggle = head?.querySelector(`.${DSTD}-target-toggle`);
      if (head && toggle && targetRows.length > 1 && getSetting('dstdQuickFmButton')) {
        quickFlatBtn = document.createElement('button');
        quickFlatBtn.type      = 'button';
        quickFlatBtn.className = `${DSTD}-action-button ${DSTD}-quick-damage dsct-dstd-quick-fm-btn`;
        quickFlatBtn.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          if (!quickFlatBtn.disabled) applyFlatBtn.click();
        });
        const initEff = _effectiveState(baseState, saved.modStack);
        _syncQuickBtn(quickFlatBtn, saved, firstMov, initEff.distance);
        head.insertBefore(quickFlatBtn, toggle);

        for (const qdBtn of head.querySelectorAll(`.${DSTD}-quick-damage:not(.dsct-dstd-quick-fm-btn):not([data-dsct-condensed])`)) {
          const fullText = qdBtn.textContent.trim();
          if (!qdBtn.dataset.dsctTip) _tip(qdBtn, 'quickDamage', { title: qdBtn.dataset.tooltip || fullText });
          const numMatch = fullText.match(/\d+/);
          const iconEls  = [...qdBtn.children].filter(c => c.tagName === 'I' || c.tagName === 'IMG');
          qdBtn.replaceChildren(...iconEls);
          if (numMatch) qdBtn.append(_makeSpan(numMatch[0]));
          qdBtn.setAttribute('data-dsct-condensed', '1');
        }
      }

      if (saved.modStack.length) {
        const panelBase   = { ...baseState };
        const panelStates = [_effectiveState(panelBase, saved.modStack)];
        for (const entry of saved.modStack) {
          createModifierNoteDiv(entry, saved.modStack, [panelBase], panelStates, [applyFlatBtn], rowLabelFlatFn, actions, actions, makePersisFlatFn());
        }
      }

      if (_fmExecutingKeys.has(stateKey)) _setRowExecuting(fmRow, applyFlatBtn, undoFlatBtn, modFlatBtn, quickFlatBtn);
    }

    const _condTargetDoc  = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
    const _condTargetActor = _condTargetDoc?.actor ?? null;

    for (const effect of flatAppliedEffects) {
      if (othersOnlyRow) break;
      const { statusId, display, potency } = effect.flatApplied;
      if (!statusId) continue;
      const userKey = sourceToken ? sourceToken.document.uuid.replace(/\./g, '__') : null;
      const isUserRow = selfOnlyRow || (userKey && targetKey === userKey);
      if (selfOnlyRow && !effect.flatApplied.exclusiveSelf) continue;
      if (effect.flatApplied.exclusiveSelf && !isUserRow) continue;
      const statusEntry  = CONFIG.statusEffects.find(s => s.id === statusId);
      const appliedInfo  = flatAppliedLabel(ability, statusId);
      const condStateKey = `${message.id}:${targetKey}:flatCond:${effect.id}`;
      if (actions.querySelector(`[data-dsct-flat-cond-key="${condStateKey}"]`)) continue;

      let condState = _flatCondState.get(condStateKey) ?? { applied: false };
      _flatCondState.set(condStateKey, condState);

      const charKey    = potency?.characteristic || null;
      const charAbbrev = charKey ? (ds.CONFIG.characteristics[charKey]?.abbreviation ?? charKey.slice(0, 1).toUpperCase()) : null;
      const charVal    = charKey ? (_condTargetActor?.system?.characteristics?.[charKey]?.value ?? null) : null;
      const potencyTag = charAbbrev && charVal != null ? ` (${charAbbrev}: ${charVal})` : '';

      const baseName   = appliedInfo.name || statusEntry?.name || statusId;
      const statusIconSrc = appliedInfo.img ?? statusEntry?.img ?? statusEntry?.icon ?? null;
      const applyLbl   = (display || `Apply ${baseName}`) + potencyTag + _spendSuffix(effect.flatApplied.spend);
      const _makeCondIcon = () => _makeStatusIcon(statusIconSrc);

      const condBtn = document.createElement('button');
      condBtn.type      = 'button';
      condBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      condBtn.dataset.dsctFlatCondKey = condStateKey;
      condBtn.dataset.dsctStatus = statusId;
      _tip(condBtn, 'condition', { title: applyLbl });
      condBtn.disabled = condState.applied;
      condBtn.append(_makeCondIcon(), _makeSpan(applyLbl));

      const undoCondBtn = document.createElement('button');
      undoCondBtn.type      = 'button';
      undoCondBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      _tip(undoCondBtn, 'conditionUndo', { title: `Undo ${baseName}` });
      undoCondBtn.disabled = !condState.applied;
      undoCondBtn.append(_makeIcon('fa-solid fa-rotate-left'));

      const condRow = document.createElement('div');
      condRow.className = `${DSTD}-action-row ${DSTD}-status-row`;
      condRow.append(condBtn, undoCondBtn);
      if (condState.applied) condRow.classList.add('is-applied');
      if (ds.CONFIG.characteristics?.[charKey]) condRow.dataset.dsctPotency = '1';

      const _syncCondRow = () => {
        const lbl = condState.applied ? `Applied: ${baseName}${potencyTag}` : applyLbl;
        condRow.classList.toggle('is-applied', condState.applied);
        condBtn.disabled = condState.applied;
        condBtn.replaceChildren(_makeCondIcon(), _makeSpan(lbl));
        if (condState.applied) _appliedTip(condBtn, 'condition', lbl);
        else _tip(condBtn, 'condition', { title: lbl });
        undoCondBtn.disabled = !condState.applied;
      };

      condBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (condBtn.disabled) return;

        const _condSpend = effect.flatApplied.spend;
        if (_condSpend?.enabled) {
          const _condSpendKey = `flatSpend_${effect.id}`;
          if (!message.getFlag(M, _condSpendKey)) {
            if (!sourceActor) { ui.notifications.warn('DSCT | No source actor for spend check'); return; }
            const _coreRes   = sourceActor.system.coreResource;
            const _curVal    = _coreRes ? (foundry.utils.getProperty(_coreRes.target, _coreRes.path) ?? 0) : 0;
            const _spendCost = _condSpend.value ?? 1;
            if (_curVal < _spendCost) {
              const _resName = _coreRes?.name ?? game.i18n.localize('DSCT.FlatEffect.spend.resource');
              ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.spend.insufficient', { name: sourceActor.name, cost: _spendCost, resource: _resName }));
              return;
            }
            await _spendSourceResource(sourceActor, _spendCost);
            await safeSetFlag(message, M, _condSpendKey, true);
          }
        }

        const td    = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const actor = td?.actor ?? null;
        if (!actor) return;
        await applyFlatAppliedEffect(actor, statusId, ability, flatAppliedSourceToken(ability, message), { stack: flatAppliedStacks(effect), end: effect.flatApplied.end });
        condState = { applied: true };
        _flatCondState.set(condStateKey, condState);
        _syncCondRow();
      });

      undoCondBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (undoCondBtn.disabled || !condState.applied) return;
        const td    = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const actor = td?.actor ?? null;
        if (!actor) return;
        await removeFlatAppliedEffect(actor, statusId, { stack: flatAppliedStacks(effect) });
        condState = { applied: false };
        _flatCondState.set(condStateKey, condState);
        _syncCondRow();
      });

      actions.appendChild(condRow);
    }

    for (const effect of rowHealEffects) {
      const { display, spendRecovery, recoverySource, amountType, amountFormula, recoveryValueSource, tempStamina, repeatable } = effect.flatHeal;
      const healFlagKey = `fheal_${effect.id}_${targetKey}`;
      if (actions.querySelector(`[data-dsct-flat-heal-key="${healFlagKey}"]`)) continue;

      const cur = message.getFlag(M, healFlagKey) ?? { usedCount: 0, undoCount: 0, healed: [], granted: [], recoveries: [] };
      const netUsed = (cur.usedCount ?? 0) - (cur.undoCount ?? 0);
      const isApplied = !repeatable && netUsed > 0;

      const rvActor = recoveryValueSource === "target" ? _condTargetActor : sourceActor;
      let amountStr;
      if (amountType === "recoveryValue") {
        const rv = rvActor?.system.recoveries?.recoveryValue;
        amountStr = rv != null ? String(rv) : game.i18n.localize("DSCT.FlatEffect.Heal.rvPlaceholder");
      } else {
        const rd = { ...(ability.actor?.getRollData?.() ?? {}), ...triggerRollData(message) };
        try { amountStr = ds.utils.simplifyRollFormula(amountFormula, rd); }
        catch { amountStr = amountFormula; }
      }

      let defaultLabel;
      if (tempStamina && spendRecovery) defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.spendTempLabel",  { amount: amountStr });
      else if (tempStamina)             defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.tempLabel",        { amount: amountStr });
      else if (spendRecovery)           defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.spendHealLabel",   { amount: amountStr });
      else                              defaultLabel = game.i18n.format("DSCT.FlatEffect.Heal.healLabel",        { amount: amountStr });

      const applyLbl = (display || defaultLabel) + _spendSuffix(effect.flatHeal.spend);

      const healBtn = document.createElement('button');
      healBtn.type      = 'button';
      healBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      healBtn.dataset.dsctFlatHealKey = healFlagKey;
      const appliedHealAmt = isApplied ? (cur.granted?.[netUsed - 1] ?? cur.healed?.[netUsed - 1] ?? null) : null;
      const healLabel = appliedHealAmt != null ? `Applied ${appliedHealAmt}` : applyLbl;
      if (appliedHealAmt != null) _appliedTip(healBtn, 'heal', healLabel);
      else _tip(healBtn, 'heal', { title: healLabel });
      healBtn.dataset.dsctCompact = `${appliedHealAmt ?? amountStr} ${tempStamina ? 'Temp' : 'Healing'}`;
      healBtn.disabled = isApplied;
      const healIcon = tempStamina ? 'fa-solid fa-shield-halved' : 'fa-solid fa-heart-pulse';
      healBtn.append(_makeIcon(healIcon), _makeSpan(healLabel));

      const undoHealBtn = document.createElement('button');
      undoHealBtn.type      = 'button';
      undoHealBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      _tip(undoHealBtn, 'healUndo', { title: `Undo ${applyLbl}${netUsed > 1 ? ` (${netUsed})` : ''}` });
      undoHealBtn.disabled = netUsed === 0;
      const undoIcon = _makeIcon('fa-solid fa-rotate-left');
      if (repeatable && netUsed > 0) {
        const countEl = document.createElement('sup');
        countEl.textContent = String(netUsed);
        countEl.style.cssText = 'font-size:0.65em;vertical-align:super;margin-left:1px;';
        undoHealBtn.append(undoIcon, countEl);
      } else {
        undoHealBtn.append(undoIcon);
      }

      const healRow = document.createElement('div');
      healRow.className = `${DSTD}-action-row`;
      healRow.append(healBtn, undoHealBtn);
      if (isApplied) healRow.classList.add('is-applied');

      healBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (healBtn.disabled) return;

        const _healSpend = effect.flatHeal.spend;
        if (_healSpend?.enabled) {
          const _healSpendKey = `flatSpend_${effect.id}`;
          if (!message.getFlag(M, _healSpendKey)) {
            if (!sourceActor) { ui.notifications.warn('DSCT | No source actor for spend check'); return; }
            const _coreRes   = sourceActor.system.coreResource;
            const _curVal    = _coreRes ? (foundry.utils.getProperty(_coreRes.target, _coreRes.path) ?? 0) : 0;
            const _spendCost = _healSpend.value ?? 1;
            if (_curVal < _spendCost) {
              const _resName = _coreRes?.name ?? game.i18n.localize('DSCT.FlatEffect.spend.resource');
              ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.spend.insufficient', { name: sourceActor.name, cost: _spendCost, resource: _resName }));
              return;
            }
            await _spendSourceResource(sourceActor, _spendCost);
            await safeSetFlag(message, M, _healSpendKey, true);
          }
        }

        const td          = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const targetActor = td?.actor ?? null;
        if (!targetActor) return;

        if (!tempStamina) {
          const curStamina = targetActor.system.stamina?.value ?? 0;
          const maxStamina = targetActor.system.stamina?.max ?? 0;
          if (curStamina >= maxStamina) {
            ui.notifications.warn(game.i18n.format("DSCT.FlatEffect.Heal.alreadyMax", { name: targetActor.name }));
            return;
          }
        }

        healBtn.disabled = true;

        let recoveryActorUuid = null;
        if (spendRecovery) {
          const recovActor = recoverySource === "target" ? targetActor : sourceActor;
          if (!recovActor) { healBtn.disabled = false; return; }
          const available = recovActor.system.recoveries?.value ?? 0;
          if (available <= 0) {
            ui.notifications.warn(game.i18n.format("DSCT.FlatEffect.Heal.noRecoveries", { name: recovActor.name }));
            healBtn.disabled = false;
            return;
          }
          await safeUpdate(recovActor, { "system.recoveries.value": available - 1 });
          recoveryActorUuid = recovActor.uuid;
        }

        let amount;
        if (amountType === "recoveryValue") {
          const rvA = recoveryValueSource === "target" ? targetActor : sourceActor;
          amount = rvA?.system.recoveries?.recoveryValue ?? 0;
        } else {
          const rd = { ...(ability.actor?.getRollData?.() ?? {}), ...triggerRollData(message) };
          const roll = new Roll(amountFormula || "0", rd);
          await roll.evaluate();
          amount = Math.floor(roll.total);
        }

        const staminaBefore = targetActor.system.stamina?.value ?? 0;
        let healedEntry;
        if (tempStamina) {
          healedEntry = targetActor.system.stamina?.temporary ?? 0;
          await grantTempStamina(targetActor, amount, effect.flatHeal.tempStack ? ability.name : null);
        } else {
          await modifyAttributeSafely(targetActor, 'stamina', amount, true);
          healedEntry = (targetActor.system.stamina?.value ?? 0) - staminaBefore;
        }

        const freshCur = message.getFlag(M, healFlagKey) ?? { usedCount: 0, undoCount: 0, healed: [], recoveries: [] };
        await safeSetFlag(message, M, healFlagKey, {
          usedCount:  (freshCur.usedCount  ?? 0) + 1,
          undoCount:   freshCur.undoCount  ?? 0,
          
          healed:     [...(freshCur.healed     ?? []), healedEntry],
          granted:    [...(freshCur.granted    ?? []), amount],
          recoveries: [...(freshCur.recoveries ?? []), recoveryActorUuid],
        });
      });

      undoHealBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (undoHealBtn.disabled) return;
        const td          = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const targetActor = td?.actor ?? null;
        if (!targetActor) return;

        undoHealBtn.disabled = true;

        const freshCur  = message.getFlag(M, healFlagKey) ?? { usedCount: 0, undoCount: 0, healed: [], recoveries: [] };
        const freshNet  = (freshCur.usedCount ?? 0) - (freshCur.undoCount ?? 0);
        if (freshNet <= 0) return;

        const healedAmount    = (freshCur.healed     ?? [])[freshNet - 1] ?? 0;
        const recoveryActorUu = (freshCur.recoveries ?? [])[freshNet - 1] ?? null;

        if (tempStamina) {
          await safeUpdate(targetActor, { "system.stamina.temporary": healedAmount });
        } else if (healedAmount) {
          await modifyAttributeSafely(targetActor, 'stamina', -healedAmount, true);
        }

        if (recoveryActorUu) {
          const recovDoc   = await fromUuid(recoveryActorUu).catch(() => null);
          const recovActor = recovDoc?.actor ?? recovDoc ?? null;
          if (recovActor) await safeUpdate(recovActor, { "system.recoveries.value": (recovActor.system.recoveries?.value ?? 0) + 1 });
        }

        await safeSetFlag(message, M, healFlagKey, { ...freshCur, undoCount: (freshCur.undoCount ?? 0) + 1 });
      });

      actions.appendChild(healRow);
    }

    for (const effect of rowTeleportEffects) {
      const tv = effect.flatTeleport ?? {};
      
      const rowAgnostic = (tv.mode ?? 'normal') === 'normal' && (tv.mover ?? 'self') === 'self';
      if (rowAgnostic && activePanel.querySelector('[data-dsct-flat-tp-key]')) continue;
      const tpKey = `ftp_${effect.id}_${targetKey}`;
      if (actions.querySelector(`[data-dsct-flat-tp-key="${tpKey}"]`)) continue;

      const spentMatch = message?.flavor?.match(/^Spent (\d+)/i);
      const tpDist = teleportDistance(tv, ability, spentMatch ? parseInt(spentMatch[1]) : 0);
      const tpLabel = (tv.display || teleportAutoLabel(tv, tpDist)) + _spendSuffix(tv.spend);

      const tpBtn = document.createElement('button');
      tpBtn.type = 'button';
      tpBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      tpBtn.dataset.dsctFlatTpKey = tpKey;
      const tpIcon = (tv.mode === 'swap') ? 'fa-solid fa-people-arrows' : 'fa-solid fa-person-through-window';
      tpBtn.append(_makeIcon(tpIcon), _makeSpan(tpLabel));

      const undoTpBtn = document.createElement('button');
      undoTpBtn.type = 'button';
      undoTpBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      _tip(undoTpBtn, 'teleportUndo', { title: `${game.i18n.localize('DSCT.FlatEffect.Teleport.undo')} ${tpLabel}` });
      undoTpBtn.append(_makeIcon('fa-solid fa-rotate-left'));

      const tpRow = document.createElement('div');
      tpRow.className = `${DSTD}-action-row`;
      tpRow.dataset.dsctManual = '1';
      tpRow.append(tpBtn, undoTpBtn);

      const tpHandle = { tpRow, tpBtn, undoBtn: undoTpBtn, label: tpLabel, message, tpKey };
      const tpSaved = message.getFlag(M, tpKey) ?? { applied: false, undoMsgId: null, distance: null };
      _syncTeleportRow(tpHandle, tpSaved);
      if (tpSaved.applied && tpSaved.undoMsgId) _tpUndoIndex.set(tpSaved.undoMsgId, tpHandle);

      undoTpBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (undoTpBtn.disabled) return;
        const msgId = undoTpBtn.dataset.dsctTpMsgId;
        const chatLi = msgId ? document.querySelector(`[data-message-id="${msgId}"]`) : null;
        const chatUndo = chatLi?.querySelector('.dsct-undo-tp');
        if (!chatUndo) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.undoNotInLog')); return; }
        _tpUndoIndex.delete(msgId);
        chatUndo.click();
        _syncTeleportRow(tpHandle, { applied: false, undoMsgId: null, distance: null });
        await safeSetFlag(message, M, tpKey, { applied: false, undoMsgId: null, distance: null });
      });

      tpBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (tpBtn.disabled) return;
        const tpSpend = tv.spend;
        if (tpSpend?.enabled) {
          const tpSpendKey = `flatSpend_${effect.id}`;
          if (!message.getFlag(M, tpSpendKey)) {
            if (!sourceActor) { ui.notifications.warn('DSCT | No source actor for spend check'); return; }
            const coreRes = sourceActor.system.coreResource;
            const curVal = coreRes ? (foundry.utils.getProperty(coreRes.target, coreRes.path) ?? 0) : 0;
            const cost = tpSpend.value ?? 1;
            if (curVal < cost) {
              ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.spend.insufficient', { name: sourceActor.name, cost, resource: coreRes?.name ?? game.i18n.localize('DSCT.FlatEffect.spend.resource') }));
              return;
            }
            await _spendSourceResource(sourceActor, cost);
            await safeSetFlag(message, M, tpSpendKey, true);
          }
        }
        const td = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;

        let capturedTpMsgId = null;
        let capturedTpDist = null;
        const tpHookId = Hooks.on('createChatMessage', (msg) => {
          if (!msg.getFlag(M, 'isTpUndo')) return;
          capturedTpMsgId = msg.id;
          capturedTpDist = msg.getFlag(M, 'tpDistance') ?? null;
        });
        try { await runTeleportEffect(tv, ability, { sourceActor, partnerToken: td?.object ?? null }); }
        finally { Hooks.off('createChatMessage', tpHookId); }
        if (!capturedTpMsgId) return;

        const tpState = { applied: true, undoMsgId: capturedTpMsgId, distance: capturedTpDist };
        _tpUndoIndex.set(capturedTpMsgId, tpHandle);
        _syncTeleportRow(tpHandle, tpState);
        await safeSetFlag(message, M, tpKey, tpState);
      });

      actions.appendChild(tpRow);
    }

    for (const effect of flatResourceEffects) {
      const resOthers = isOthersEffect(effect);
      if (resOthers ? !othersHere.has(effect.id) : selfOnlyRow || othersOnlyRow) continue;
      const { amount, type, display } = effect.flatResource ?? {};
      if (!amount) continue;

      const toTarget = resOthers || resourceRecipient(effect) === 'target';
      const perRow = toTarget && targetKey !== 'selected-token';
      if (!perRow && activePanel.querySelector(`[data-dsct-flat-res-key="${resourceFlagKey(effect, null)}"]`)) continue;
      const resKey = resourceFlagKey(effect, perRow ? targetKey : null);
      if (actions.querySelector(`[data-dsct-flat-res-key="${resKey}"]`)) continue;

      const resTargetActor = perRow ? _condTargetActor : null;

      const resLabel = display || effect.label;

      const resBtn = document.createElement('button');
      resBtn.type = 'button';
      resBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      resBtn.dataset.dsctFlatResKey = resKey;
      resBtn.dataset.dsctCompact = resourceShortLabel({ amount, type });
      resBtn.append(_makeIcon(resourceIcon(type)), _makeSpan(resLabel));

      const undoResBtn = document.createElement('button');
      undoResBtn.type = 'button';
      undoResBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      _tip(undoResBtn, 'resourceUndo');
      undoResBtn.append(_makeIcon('fa-solid fa-rotate-left'));

      const resRow = document.createElement('div');
      resRow.className = `${DSTD}-action-row`;
      resRow.dataset.dsctFlatResKey = resKey;
      resRow.append(resBtn, undoResBtn);

      const resHandle = { resRow, resBtn, undoBtn: undoResBtn, label: resLabel, compact: resourceShortLabel({ amount, type }) };
      _syncResourceRow(resHandle, message.getFlag(M, resKey) ?? null);

      
      
      if (perRow && resTargetActor && !canGainResource(resTargetActor, type)) {
        resBtn.disabled = true;
        _tip(resBtn, 'resourceNoPool', { title: resLabel, data: { name: resTargetActor.name } });
      }

      resBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (resBtn.disabled) return;
        const state = await applyFlatResource(effect, ability, message, {
          actors: perRow ? [resTargetActor].filter(Boolean) : null,
          targetKey: perRow ? targetKey : null,
        });
        if (state) _syncResourceRow(resHandle, state);
      });

      undoResBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (undoResBtn.disabled) return;
        if (await undoFlatResource(effect, message, perRow ? targetKey : null)) _syncResourceRow(resHandle, null);
      });

      actions.appendChild(resRow);
    }

    for (const effect of rowCleanseEffects) {
      const { display, expiryFilter, statusFilter, repeatable } = effect.flatCleanse;
      const cleanseFlagKey = `fclns_${effect.id}_${targetKey}`;
      if (actions.querySelector(`[data-dsct-flat-cleanse-key="${cleanseFlagKey}"]`)) continue;

      const cur = message.getFlag(M, cleanseFlagKey) ?? { stack: [] };
      const stackLen = (cur.stack ?? []).length;
      const isApplied = !repeatable && stackLen > 0;

      const applyLbl = buildCleanseAutoLabel(effect.flatCleanse) + _spendSuffix(effect.flatCleanse.spend);

      const cleanseBtn = document.createElement('button');
      cleanseBtn.type      = 'button';
      cleanseBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      cleanseBtn.dataset.dsctFlatCleanseKey = cleanseFlagKey;
      const appliedCleanseName = isApplied ? (cur.stack?.[0]?.name ?? applyLbl) : null;
      const cleanseLabel = appliedCleanseName != null ? `Removed: ${appliedCleanseName}` : applyLbl;
      if (appliedCleanseName != null) _tip(cleanseBtn, 'cleanseApplied', { title: cleanseLabel });
      else _tip(cleanseBtn, 'cleanse', { title: cleanseLabel });
      cleanseBtn.disabled = isApplied;
      cleanseBtn.append(_makeIcon('fa-solid fa-broom'), _makeSpan(cleanseLabel));

      const undoCleanseBtn = document.createElement('button');
      undoCleanseBtn.type      = 'button';
      undoCleanseBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      _tip(undoCleanseBtn, 'cleanseUndo', { title: `Undo ${applyLbl}` });
      undoCleanseBtn.disabled = stackLen === 0;
      const undoClsIcon = _makeIcon('fa-solid fa-rotate-left');
      if (stackLen > 1) {
        const countEl = document.createElement('sup');
        countEl.textContent = String(stackLen);
        countEl.style.cssText = 'font-size:0.65em;vertical-align:super;margin-left:1px;';
        undoCleanseBtn.append(undoClsIcon, countEl);
      } else {
        undoCleanseBtn.append(undoClsIcon);
      }

      const cleanseRow = document.createElement('div');
      cleanseRow.className = `${DSTD}-action-row`;
      cleanseRow.append(cleanseBtn, undoCleanseBtn);
      if (isApplied) cleanseRow.classList.add('is-applied');

      const expiryFilterSet = new Set(Array.isArray(expiryFilter) ? expiryFilter : [...(expiryFilter ?? [])]);
      const statusFilterSet = new Set(Array.isArray(statusFilter) ? statusFilter : [...(statusFilter ?? [])]);
      const clsMatchesFilter = (ae) => {
        if (expiryFilterSet.size > 0 && expiryFilterSet.has(ae.duration?.expiry)) return true;
        if (statusFilterSet.size > 0 && [...(ae.statuses ?? [])].some(s => statusFilterSet.has(s))) return true;
        return false;
      };

      cleanseBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (cleanseBtn.disabled) return;

        const _clsSpend = effect.flatCleanse.spend;
        if (_clsSpend?.enabled) {
          const _clsSpendKey = `flatSpend_${effect.id}`;
          if (!message.getFlag(M, _clsSpendKey)) {
            if (!sourceActor) { ui.notifications.warn('DSCT | No source actor for spend check'); return; }
            const _coreRes   = sourceActor.system.coreResource;
            const _curVal    = _coreRes ? (foundry.utils.getProperty(_coreRes.target, _coreRes.path) ?? 0) : 0;
            const _spendCost = _clsSpend.value ?? 1;
            if (_curVal < _spendCost) {
              const _resName = _coreRes?.name ?? game.i18n.localize('DSCT.FlatEffect.spend.resource');
              ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.spend.insufficient', { name: sourceActor.name, cost: _spendCost, resource: _resName }));
              return;
            }
            await _spendSourceResource(sourceActor, _spendCost);
            await safeSetFlag(message, M, _clsSpendKey, true);
          }
        }

        let targetActor;
        if (tokenUuid) {
          const td = await fromUuid(tokenUuid).catch(() => null);
          targetActor = td?.actor ?? null;
        } else {
          targetActor = canvas.tokens.controlled[0]?.actor ?? [...game.user.targets][0]?.actor ?? null;
        }
        if (!targetActor) return;

        const cleansable = targetActor.effects.filter(clsMatchesFilter);
        if (!cleansable.length) {
          ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.Cleanse.noMatch', { name: targetActor.name }));
          return;
        }

        cleanseBtn.disabled = true;

        if (effect.flatCleanse.all) {
          const all = cleansable.map(ae => ae.toObject());
          if (targetActor.isOwner) await targetActor.deleteEmbeddedDocuments('ActiveEffect', cleansable.map(ae => ae.id), cleansed());
          else for (const ae of cleansable) await safeDelete(ae, cleansed());
          const cur = message.getFlag(M, cleanseFlagKey) ?? { stack: [] };
          await safeSetFlag(message, M, cleanseFlagKey, { stack: [...(cur.stack ?? []), { all }] });
          undoCleanseBtn.disabled = false;
          cleanseRow.classList.add('is-applied');
          const appliedName = game.i18n.format('DSCT.FlatEffect.Cleanse.removedAll', { n: all.length });
          cleanseBtn.replaceChildren(_makeIcon('fa-solid fa-broom'), _makeSpan(appliedName));
          _tip(cleanseBtn, 'cleanseApplied', { title: appliedName });
          return;
        }

        let chosen = cleansable.length === 1 ? cleansable[0] : null;
        if (!chosen) {
          let chosenId = null;
          const boxes = cleansable.map(ae => {
            const expiryLabel = ds.CONFIG.effectEnds?.[ae.duration?.expiry]?.label ?? '';
            const expPart = expiryLabel ? ` (${expiryLabel})` : '';
            return `<label style="display:block;margin:4px 0"><input type="radio" name="dsct-cleanse-pick" value="${ae.id}"> ${ae.name}${expPart}</label>`;
          }).join('');
          await foundry.applications.api.DialogV2.wait({
            window: { title: game.i18n.format('DSCT.FlatEffect.Cleanse.pickTitle', { name: targetActor.name }) },
            content: `<fieldset style="border:0;padding:8px">${boxes}</fieldset>`,
            buttons: [
              { label: game.i18n.localize('DSCT.FlatEffect.Cleanse.cleanseBtn'), action: 'confirm', callback: (_ev, _btn, dialog) => {
                const checked = dialog.element.querySelector('input[name=dsct-cleanse-pick]:checked');
                if (checked) chosenId = checked.value;
              }},
              { label: game.i18n.localize('Cancel'), action: 'cancel' },
            ],
            rejectClose: false,
          });
          if (!chosenId) { cleanseBtn.disabled = false; return; }
          chosen = targetActor.effects.get(chosenId);
        }

        if (!chosen) { cleanseBtn.disabled = false; return; }
        const removedData = chosen.toObject();
        await safeDelete(chosen, cleansed());

        const freshCur = message.getFlag(M, cleanseFlagKey) ?? { stack: [] };
        const newStack = [...(freshCur.stack ?? []), removedData];
        await safeSetFlag(message, M, cleanseFlagKey, { stack: newStack });

        undoCleanseBtn.disabled = false;
        if (!repeatable) {
          cleanseRow.classList.add('is-applied');
          const appliedName = `Removed: ${removedData?.name ?? applyLbl}`;
          cleanseBtn.replaceChildren(_makeIcon('fa-solid fa-broom'), _makeSpan(appliedName));
          _tip(cleanseBtn, 'cleanseApplied', { title: appliedName });
        } else {
          cleanseBtn.disabled = false;
        }
        const existingCount = undoCleanseBtn.querySelector('sup');
        if (newStack.length > 1) {
          if (existingCount) existingCount.textContent = String(newStack.length);
          else {
            const countEl = document.createElement('sup');
            countEl.textContent = String(newStack.length);
            countEl.style.cssText = 'font-size:0.65em;vertical-align:super;margin-left:1px;';
            undoCleanseBtn.appendChild(countEl);
          }
        }
      });

      undoCleanseBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (undoCleanseBtn.disabled) return;

        let targetActor;
        if (tokenUuid) {
          const td = await fromUuid(tokenUuid).catch(() => null);
          targetActor = td?.actor ?? null;
        } else {
          targetActor = canvas.tokens.controlled[0]?.actor ?? [...game.user.targets][0]?.actor ?? null;
        }
        if (!targetActor) return;

        undoCleanseBtn.disabled = true;

        const freshCur = message.getFlag(M, cleanseFlagKey) ?? { stack: [] };
        const freshStack = freshCur.stack ?? [];
        if (!freshStack.length) return;

        const removedData = freshStack[freshStack.length - 1];
        const newStack = freshStack.slice(0, -1);

        if (removedData) {
          await safeCreateEmbedded(targetActor, 'ActiveEffect', Array.isArray(removedData.all) ? removedData.all : [removedData]);
        }

        await safeSetFlag(message, M, cleanseFlagKey, { stack: newStack });

        if (newStack.length > 0) undoCleanseBtn.disabled = false;
        const countEl = undoCleanseBtn.querySelector('sup');
        if (countEl) {
          if (newStack.length > 1) countEl.textContent = String(newStack.length);
          else countEl.remove();
        }
        cleanseRow.classList.remove('is-applied');
        if (!repeatable) cleanseBtn.disabled = newStack.length > 0;
      });

      actions.appendChild(cleanseRow);
    }

    if (doSquad && squadTargetMap && tokenUuid) {
      let sqEntry = squadTargetMap[targetKey];
      if (!sqEntry) {
        const liveKeys = new Set((message.flags?.[DSTD]?.state?.targets ?? []).map(t => String(t.tokenUuid ?? '').replace(/\./g, '__')));
        const orphanKey = Object.keys(squadTargetMap).find(k => k !== targetKey && !liveKeys.has(k));
        if (orphanKey) {
          sqEntry = squadTargetMap[orphanKey];
          squadTargetMap[targetKey] = sqEntry;
          delete squadTargetMap[orphanKey];
          if (getSetting('debugMode')) console.log(`DSCT | squad Phase3 | remapped orphaned squad entry ${orphanKey} -> ${targetKey} (redirect)`);
        }
      }
      const minionIds = sqEntry?.minionIds ?? [];
      if (getSetting('debugMode')) console.log(`DSCT | squad Phase3 | row tokenUuid=${tokenUuid} sqEntry=`, sqEntry);

      
      if (sqEntry?.primaryMinionId || sqEntry?.minionIds?.length) {
        const bonus          = sqEntry.extraMinions * sqEntry.freeStrike;
        const dstdMsgState   = message.flags?.[DSTD]?.state ?? null;
        const nativeApplyBtn = actions.querySelector('[data-dstd-action="applyDamage"]');
        const operationId    = nativeApplyBtn?.dataset?.operationId;
        const qdBtn          = row.querySelector(`.${DSTD}-quick-damage:not(.dsct-dstd-quick-fm-btn)`);
        if (getSetting('debugMode')) console.log(`DSCT | squad Phase3 | bonus=${bonus} operationId=${operationId} hasState=${!!dstdMsgState}`);
        if (operationId && dstdMsgState) {
          const existingOverride = dstdMsgState.damageOverrides?.[operationId];
          const primaryId  = sqEntry.primaryMinionId ?? sqEntry.minionIds?.[0] ?? null;
          const primaryTok = primaryId ? canvas.tokens.get(primaryId) : null;
          const squadPills = [];
          if (primaryTok) {
            squadPills.push({ kind: 'note', value: null, label: 'Primary Attacker', src: primaryTok.name, srcTokenId: primaryTok.id, source: 'trigger', dstSquad: true, lineStyle: 'primary' });
          }
          for (const mid of sqEntry.minionIds ?? []) {
            if (mid === primaryId) continue;
            const tok = canvas.tokens.get(mid);
            squadPills.push({ kind: 'delta', value: sqEntry.freeStrike, label: 'Free Strike', src: tok?.name ?? null, srcTokenId: mid, source: 'trigger', dstSquad: true });
          }
          const sig = (p) => JSON.stringify([p.kind, p.value ?? null, p.srcTokenId ?? null]);
          const wantSigs = new Set(squadPills.map(sig));
          const isSquad = (p) => !!p.dstSquad
            || (p.source === 'trigger' && wantSigs.has(sig(p)) && (p.label === 'Primary Attacker' || p.label === 'Free Strike'));
          const wantKey = JSON.stringify(squadPills.map(sig));
          const haveKey = JSON.stringify((existingOverride?.dstPills ?? []).filter(isSquad).map(sig));
          if (wantKey !== haveKey) {
            const baseText   = qdBtn?.textContent ?? nativeApplyBtn?.textContent ?? '';
            const base       = parseInt(baseText.match(/\d+/)?.[0] ?? '0');
            const typeClass  = [...(qdBtn?.classList ?? [])].find(c => c.includes('-damage-type-'))
                             ?? [...(nativeApplyBtn?.classList ?? [])].find(c => c.includes('-damage-type-'));
            const damageType = typeClass?.split('-damage-type-')[1] ?? existingOverride?.damageType ?? '';
            const typeLabel  = existingOverride?.typeLabel || (damageType && damageType !== 'untyped' ? damageType.charAt(0).toUpperCase() + damageType.slice(1) : '');
            if (base > 0 && isPrimaryGM()) {
              const baseAmount = Number(existingOverride?.baseAmount ?? base);
              const pills = [
                ...(existingOverride?.dstPills ?? []).filter(p => !isSquad(p)),
                ...squadPills,
              ];
              message.update({
                [`flags.${DSTD}.state.damageOverrides.${operationId}`]: {
                  ...(existingOverride ?? {}),
                  amount: foldDamagePills(baseAmount, pills),
                  baseAmount,
                  bonus: 0,
                  additional: existingOverride?.additional ?? '',
                  damageType: existingOverride?.damageType ?? damageType,
                  typeLabel: existingOverride?.typeLabel ?? typeLabel,
                  surges: existingOverride?.surges ?? 0,
                  surgeDamage: existingOverride?.surgeDamage ?? 0,
                  surgeBonus: existingOverride?.surgeBonus ?? 0,
                  dstPills: pills,
                },
                [`flags.${M}.squadTargetMap`]: squadTargetMap,
              }).catch(() => {});
            }
          }
        }
      }
    }

    if (body.querySelector('[data-dsct-dstd-cond], [data-dsct-fm-key], [data-dsct-mark-key], [data-dsct-enrich-key], [data-dsct-judge-key], [data-dsct-flat-key], [data-dsct-flat-heal-key], [data-dsct-flat-cleanse-key]')) {
      const muted = body.querySelector(`.${DSTD}-muted`);
      if (muted) muted.hidden = true;
    }
  }

  _restoreCollapseState(message.id, activePanel);
  if (!activePanel.dataset.dsctCollapseTracked) {
    activePanel.dataset.dsctCollapseTracked = '1';
    activePanel.addEventListener('click', (e) => {
      if (!e.target.closest('[data-dstd-action="toggleTarget"]')) return;
      setTimeout(() => _saveCollapseState(message.id, activePanel), 0);
    });
  }

  injectDamagePills(message, root);
}
