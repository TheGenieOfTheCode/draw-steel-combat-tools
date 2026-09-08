import { getSetting, safeCreateEmbedded, safeDelete, safeUpdate, canForcedMoveTarget, getTokenById, getWindowById, getItemDsid, tokFootprintDist, getItemRange, chooseFreeSquare, toWorld, confirmRangeOverride } from '../helpers.mjs';
import { triggerGrabberFreeStrike, resolveEscapeChatMessage, resolveGrabConfirmChatMessage } from '../chat-integration.mjs';
import { checkAndRunTargetPicker } from '../ability-automation/target-picker.mjs';
import { toggleDamageConditionsPanel } from './damage-conditions.mjs';
import { checkAndRunSquadTargeting } from '../ability-automation/squad-targeting.mjs';
import { isNullGrabIntuitionActive, nullIntuitionScore, isNullSpeedExemptActive } from '../ability-automation/class-null/psionic-martial-arts.mjs';
import { _effectiveRowTier } from '../compat/dstd-compat.mjs';

const M = 'draw-steel-combat-tools';

const TIMEOUT_MS = 60_000;


export const sizeRankG = (size) =>
  size.value >= 2 ? size.value + 2 : ({ T: 0, S: 1, M: 2, L: 3 })[size.letter] ?? 2;

const SIZE_EDGE_EFFECT = {
  name: 'Size Advantage (Grab)',
  img: 'icons/skills/social/diplomacy-handshake-blue.webp',
  type: 'base',
  system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
  changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: {},
};

export const buildFreeStrikeButton = (actor, targetTokenId = null) => {
  const item = actor?.items.find(i => i.name.toLowerCase().includes('melee free strike'));
  if (item) {
    const targetAttr = targetTokenId ? ` data-target-token-id="${targetTokenId}"` : '';
    return `<a data-dsct-action="dsct-free-strike" data-item-uuid="${item.uuid}"${targetAttr} style="cursor:pointer;">Melee Free Strike</a>`;
  }
  const dmg = actor?.system.monster?.freeStrike;
  return dmg !== undefined ? `[[/damage ${dmg}]]{Free Strike (${dmg} damage)}` : `<em>(No Melee Free Strike found)</em>`;
};


export const grabUiState = { pendingConfirm: null, pendingEscape: null };

const refreshOpenPanel = () => {
  getWindowById('dsct-dc-panel')?._refreshGrabs?.();
};
export const refreshGrabUis = refreshOpenPanel;

const ensureGrabHooks = () => {
  if (!window._grabFollowActive)  window._grabFollowActive  = new Set();
  if (!window._grabRepositioning) window._grabRepositioning = new Set();

  if (!window._grabPreHook) {
    window._grabPreHook = Hooks.on('preUpdateToken', async (doc, changes) => {
      if (window._grabFollowActive?.has(doc.id))    return;
      if (window._grabRepositioning?.has(doc.id))   return;
      if (!window._activeGrabs?.has(doc.id))        return;
      if (changes.x === undefined && changes.y === undefined) return;
      if (getSetting('allowIllegalMovement')) {
        ui.notifications.warn(game.i18n.format('DSCT.notice.grab.grabbedCannotMove', { name: window._activeGrabs.get(doc.id).grabbedName }));
        await endGrab(doc.id, { silent: true });
      } else {
        delete changes.x; delete changes.y;
        ui.notifications.warn(game.i18n.format('DSCT.notice.grab.grabbedBlocked', { name: window._activeGrabs.get(doc.id).grabbedName }));
      }
    });
  }

  if (!window._grabFollowHook) {
    window._grabFollowHook = Hooks.on('updateToken', async (doc, changes) => {
      
      if (!game.user.isGM) return;
      if (!window._activeGrabs?.size) return;
      if (changes.x === undefined && changes.y === undefined) return;
      if (window._grabFMSuppressed?.has(doc.id)) return;
      const deltaX = (changes.x ?? doc.x) - doc.x;
      const deltaY = (changes.y ?? doc.y) - doc.y;
      for (const [gid, grab] of window._activeGrabs.entries()) {
        if (doc.id !== grab.grabberTokenId) continue;
        const gt = getTokenById(gid);
        if (gt) {
          window._grabFollowActive.add(gid);
          await gt.document.update({ x: gt.document.x + deltaX, y: gt.document.y + deltaY });
          window._grabFollowActive.delete(gid);
        }
      }
    });
  }

  if (!window._grabberGrabbedHook) {
    window._grabberGrabbedHook = Hooks.on('createActiveEffect', async (effect) => {
      if (!game.users.activeGM?.isSelf) return;
      if (!effect.getFlag(M, 'grabbed') || !window._activeGrabs?.size) return;
      const effectToken = effect.parent?.token;
      for (const [gid, grab] of [...window._activeGrabs.entries()]) {
        const isGrabber = effectToken
          ? effectToken.id === grab.grabberTokenId
          : effect.parent?.id === grab.grabberActorId;
        if (!isGrabber) continue;
        await endGrab(gid, { silent: !game.user.isGM, customMsg: game.user.isGM ? `${grab.grabberName} was grabbed and released ${grab.grabbedName}.` : null });
      }
    });
  }

  if (!window._grabEffectDeleteHook) {
    window._grabEffectDeleteHook = Hooks.on('deleteActiveEffect', async (effect, options) => {
      if (!window._activeGrabs?.size) return;
      for (const [gid, grab] of [...window._activeGrabs.entries()]) {
        if (effect.id !== grab.grabbedEffectId && effect.id !== grab.grabberEffectId) continue;
        
        
        
        
        if (options?.dsctGrabTeardown || !game.users.activeGM?.isSelf) {
          window._activeGrabs.delete(gid);
          if (!window._activeGrabs.size) removeGrabHooks();
          refreshOpenPanel();
          break;
        }
        const isGrabber = effect.id === grab.grabberEffectId;
        const msg = isGrabber
          ? `${grab.grabberName}'s Grabber effect was removed, ending the grab on ${grab.grabbedName}.`
          : `${grab.grabbedName}'s Grabbed effect was removed, ending the grab.`;
        await endGrab(gid, { customMsg: msg });
        break;
      }
    });
  }
};

const removeGrabHooks = () => {
  if (window._grabPreHook)           { Hooks.off('preUpdateToken',     window._grabPreHook);           window._grabPreHook           = null; }
  if (window._grabFollowHook)        { Hooks.off('updateToken',        window._grabFollowHook);        window._grabFollowHook        = null; }
  if (window._grabberGrabbedHook)    { Hooks.off('createActiveEffect', window._grabberGrabbedHook);    window._grabberGrabbedHook    = null; }
  if (window._grabEffectDeleteHook)  { Hooks.off('deleteActiveEffect', window._grabEffectDeleteHook);  window._grabEffectDeleteHook  = null; }
  if (window._grabRepositionHook)    { Hooks.off('updateToken',        window._grabRepositionHook);    window._grabRepositionHook    = null; }
  window._grabFollowActive  = new Set();
  window._grabRepositioning = new Set();
};

const rehydrateGrabs = () => {
  window._activeGrabs = new Map();
  if (!canvas?.tokens?.placeables) return;

  for (const token of canvas.tokens.placeables) {
    if (!token.actor) continue;
    const grabberEffects = token.actor.effects.filter(e => e.name === 'Grabber' && e.getFlag(M, 'grab'));

    for (const effect of grabberEffects) {
      const { grabberId, grabbedId } = effect.getFlag(M, 'grab') ?? {};
      if (!grabberId || !grabbedId) continue;

      const grabberTok = getTokenById(grabberId);
      const grabbedTok = getTokenById(grabbedId);

      if (!grabberTok || !grabbedTok) continue;

      const grabbedEffect = grabbedTok.actor.effects.find(e => e.getFlag(M, 'grabbed'));

      window._activeGrabs.set(grabbedId, {
        grabbedTokenId:  grabbedId,
        grabbedActorId:  grabbedTok.actor.id,
        grabbedName:  grabbedTok.name,
        grabberTokenId:  grabberId,
        grabberActorId:  grabberTok.actor.id,
        grabberName:  grabberTok.name,
        grabberEffectId: effect.id,
        grabbedEffectId: grabbedEffect?.id ?? null,
        offsetX: grabbedTok.document.x - grabberTok.document.x,
        offsetY: grabbedTok.document.y - grabberTok.document.y
      });
    }
  }

  if (window._activeGrabs.size > 0) {
    ensureGrabHooks();
    refreshOpenPanel();
    
    
    setTimeout(() => { ui.chat?.render(true); }, 250);
  }
};

export const registerGrabHooks = () => {
  if (!getSetting('conditionsEnabled')) return;
  Hooks.on('canvasReady', rehydrateGrabs);
  
  Hooks.on('createActiveEffect', (effect) => {
    if (effect.getFlag(M, 'grab')?.grabberId) rehydrateGrabs();
  });
};

const GRAB_TRAIT_CAPS = {
  'four-armed martial arts': 2,
  'choking grasp': 2,
  'claw and blade': 2,
  'conditioning spear': 2,
  'several arms': 4,
  'ribcage chomp': 4,
  'four-way grasp': 4,
  'multiple tongues': 3,
};

const _traitGrabCap = (actor) => {
  if (!actor) return 1;
  let cap = 1;
  let multilimb = 0;
  let hasGrowingFerocity = false;
  let hasBoren = false;
  for (const item of actor.items) {
    const n = item.name?.toLowerCase().trim();
    if (!n) continue;
    if (GRAB_TRAIT_CAPS[n]) cap = Math.max(cap, GRAB_TRAIT_CAPS[n]);
    if (n === 'multilimb') multilimb++;
    if (n === 'growing ferocity') hasGrowingFerocity = true;
    if (n === 'boren') hasBoren = true;
  }
  if (multilimb) cap = Math.max(cap, 1 + multilimb);
  if (hasGrowingFerocity && hasBoren) {
    const ferocity = actor.system?.hero?.primary?.value ?? 0;
    if (ferocity >= 2) cap = Math.max(cap, 2);
  }
  return cap;
};

export const applyGrab = async (grabberTok, grabbedTok, { maxGrabs = 1 } = {}) => {
  if (!window._activeGrabs) window._activeGrabs = new Map();
  if (window._activeGrabs.has(grabbedTok.id)) await endGrab(grabbedTok.id, { silent: true });

  const flagMax = Number(grabberTok.actor?.getFlag('draw-steel-combat-tools', 'maxGrabs')) || 0;
  const effMax  = Math.max(maxGrabs, flagMax, _traitGrabCap(grabberTok.actor));
  const currentGrabs = [...window._activeGrabs.values()].filter(g => g.grabberTokenId === grabberTok.id);
  if (currentGrabs.length >= effMax) {
    if (effMax === 1) {
      await endGrab(currentGrabs[0].grabbedTokenId, { silent: false, customMsg: `${grabberTok.name} releases ${currentGrabs[0].grabbedName} to grab a new target.` });
    } else {
      ui.notifications.warn(game.i18n.format('DSCT.notice.grab.alreadyGrabbing', { name: grabberTok.name, max: effMax, s: effMax !== 1 ? 's' : '' }));
      return;
    }
  }

  await safeCreateEmbedded(grabbedTok.actor, 'ActiveEffect', [{
    name: 'Grabbed',
    img: getSetting('grabbedEffectIcon') || 'icons/skills/melee/unarmed-punch-fist-yellow-red.webp',
    type: 'base',
    statuses: [],
    changes: [],
    system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
    disabled: false, transfer: false, flags: { [M]: { grabbed: true } },
    duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
    description: '<p>You have speed 0, cannot be force moved except by the creature, object, or effect that has you grabbed, and cannot use the Knockback maneuver. You take a bane on abilities that do not target the creature, object, or effect that has you grabbed.</p><p>You can attempt to escape using the <strong>Escape Grab</strong> maneuver. If you teleport, or if either you or the creature grabbing you is force moved so that you are no longer adjacent, the grab ends.</p><p>If the creature grabbing you moves, they bring you with them.</p>',
    tint: '#ffffff', sort: 0,
  }]);

  const grabberSizeObj = grabberTok.actor.system?.combat?.size ?? { value: 1, letter: 'M' };
  const grabbedSizeObj = grabbedTok.actor.system?.combat?.size ?? { value: 1, letter: 'M' };
  const speedChanges = (!isNullSpeedExemptActive(grabberTok.actor) && sizeRankG(grabberSizeObj) <= sizeRankG(grabbedSizeObj))
    ? [{ key: 'system.movement.value', mode: 5, value: String(Math.floor((grabberTok.actor.system?.movement?.value ?? 5) / 2)), priority: null }]
    : [];

  const [grabberEffect] = await safeCreateEmbedded(grabberTok.actor, 'ActiveEffect', [{
    name: 'Grabber',
    img: getSetting('grabberEffectIcon') || 'icons/magic/control/debuff-chains-shackle-movement-red.webp',
    type: 'base',
    system: { end: { type: 'encounter', roll: '' }, filters: { keywords: [] } },
    changes: speedChanges, disabled: false, transfer: false, statuses: [], flags: {},
    duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
    description: '<p>You can use a maneuver to move the grabbed creature into an unoccupied space adjacent to you. You can release the grabbed creature at any time to end the grab (no action required). If you are force moved so that you are no longer adjacent to the grabbed creature, the grab ends.</p><p>You can grab only creatures of your size or smaller. If your Might score is 2 or higher, you can grab creatures larger than you with a size equal to or less than your Might score. Unless otherwise indicated, you can grab only one creature at a time.</p><p>If your size is equal to or less than the size of the creature you have grabbed, your speed is halved while you have them grabbed.</p>',
    tint: '#ffffff', sort: 0,
    flags: { [M]: { grab: { grabberId: grabberTok.id, grabbedId: grabbedTok.id } } },
  }]);

  const grabbedEffect = grabbedTok.actor.effects.find(e => e.getFlag(M, 'grabbed'));

  window._activeGrabs.set(grabbedTok.id, {
    grabbedTokenId:  grabbedTok.id,  grabbedActorId:  grabbedTok.actor.id,  grabbedName:  grabbedTok.name,
    grabberTokenId:  grabberTok.id,  grabberActorId:  grabberTok.actor.id,  grabberName:  grabberTok.name,
    grabberEffectId: grabberEffect?.id ?? null,
    grabbedEffectId: grabbedEffect?.id ?? null,
    offsetX: grabbedTok.document.x - grabberTok.document.x,
    offsetY: grabbedTok.document.y - grabberTok.document.y
  });

  ensureGrabHooks();
  refreshOpenPanel();
};

export const endGrab = async (grabbedTokenId, { silent = false, customMsg = null } = {}) => {
  const grab = window._activeGrabs?.get(grabbedTokenId);
  if (!grab) return;

  window._activeGrabs.delete(grabbedTokenId);

  const grabberTok = getTokenById(grab.grabberTokenId);
  const grabbedTok = getTokenById(grab.grabbedTokenId);
  if (grab.grabberEffectId) { const e = grabberTok?.actor.effects.get(grab.grabberEffectId); if (e) await safeDelete(e, { dsctGrabTeardown: true }); }
  if (grab.grabbedEffectId) { const e = grabbedTok?.actor.effects.get(grab.grabbedEffectId); if (e) await safeDelete(e, { dsctGrabTeardown: true }); }

  if (!window._activeGrabs.size) {
    removeGrabHooks();
  }

  if (!silent) ChatMessage.create({ content: customMsg ? `<strong>Grab ended:</strong> ${customMsg}` : game.i18n.format('DSCT.chat.grab.ended', { grabber: grab.grabberName, grabbed: grab.grabbedName }) });
  refreshOpenPanel();
};

export const runGrab = async (grabberToken, targetToken, { forceApply = false, ignoreSizeCheck = false, tier = null, maxGrabs = 1 } = {}) => {
  if (!grabberToken) { ui.notifications.warn(game.i18n.localize('DSCT.notice.grab.noGrabber')); return; }
  if (!targetToken)  { ui.notifications.warn(game.i18n.localize('DSCT.notice.grab.noTarget')); return; }
  if (grabberToken.id === targetToken.id) { ui.notifications.warn(game.i18n.localize('DSCT.notice.grab.selfGrab')); return; }

  const grabberActor = grabberToken.actor;
  const targetActor  = targetToken.actor;

  if (!forceApply && !ignoreSizeCheck && !(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
    const mightOverride = isNullGrabIntuitionActive(grabberActor) ? nullIntuitionScore(grabberActor) : null;
    if (!canForcedMoveTarget(grabberActor, targetActor, mightOverride)) {
      ui.notifications.warn(game.i18n.format('DSCT.notice.grab.tooLarge', { grabber: grabberToken.name, target: targetToken.name }));
      return;
    }
  }

  if (forceApply) {
    await applyGrab(grabberToken, targetToken, { maxGrabs });
    ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.applied', { grabber: grabberToken.name, target: targetToken.name }) });
    return;
  }

  if (tier !== null) {
    if (tier < 2) {
      ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.failed', { grabber: grabberToken.name, target: targetToken.name }) });
      return;
    }
    if (tier === 2) {
      const createdMsg = await ChatMessage.create({
        content: `<strong>Grab - Tier 2:</strong> ${grabberToken.name} gets hold of ${targetToken.name}!<br>
          ${targetToken.name} may make a free strike:<br>
          <div style="margin: 4px 0;">${buildFreeStrikeButton(targetActor, grabberToken.id)}</div>`,
        flags: { [M]: { grabConfirm: { grabberId: grabberToken.id, targetId: targetToken.id, maxGrabs } } },
      });

      grabUiState.pendingConfirm = { grabberToken, targetToken, msgId: createdMsg?.id ?? null, maxGrabs };
      refreshOpenPanel();
      return;
    }
    await applyGrab(grabberToken, targetToken, { maxGrabs });
    ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.tier3', { grabber: grabberToken.name, target: targetToken.name }) });
    return;
  }

  const dist = tokFootprintDist(grabberToken, targetToken);
  if (dist >= canvas.grid.distance) {
    
    const squares = Math.round(dist / canvas.grid.distance) + 1;
    const ok = await confirmRangeOverride(grabberToken, targetToken, squares, 'Grab');
    if (!ok) return;
  }

  const grabItem = grabberActor.items.find(i => i.name === 'Grab');
  if (!grabItem) { ui.notifications.warn(game.i18n.format('DSCT.notice.grab.noGrabItem', { name: grabberActor.name })); return; }

  const grabberSize = grabberActor.system.combat.size.value ?? 1;
  const targetSize  = targetActor.system.combat.size.value  ?? 1;
  const sizeEdge    = grabberSize > targetSize ? 1 : 0;

  let sizeEdgeEffectId = null;
  if (sizeEdge > 0) {
    const [c] = await safeCreateEmbedded(grabberActor, 'ActiveEffect', [foundry.utils.deepClone(SIZE_EDGE_EFFECT)]);
    sizeEdgeEffectId = c?.id;
    await new Promise(r => setTimeout(r, 300));
  }

  const resolvedTier = await new Promise((resolve) => {
    let hookId, timeoutId;
    const cleanup = async (val) => {
      Hooks.off('createChatMessage', hookId); clearTimeout(timeoutId);
      if (sizeEdgeEffectId) { const e = grabberActor.effects.get(sizeEdgeEffectId); if (e) await safeDelete(e); }
      resolve(val);
    };
    hookId = Hooks.on('createChatMessage', async (msg) => {
      const parts = msg.system?.parts?.contents; if (!parts) return;
      const ar = parts.find(p => p.type === 'abilityResult'); if (!ar) return;
      msg.setFlag(M, 'grabRoll', { grabberTokenId: grabberToken.id, targetTokenId: targetToken.id, appliedTier: ar.tier }).catch(() => {});
      await cleanup(ar.tier);
    });
    timeoutId = setTimeout(async () => { ui.notifications.warn(game.i18n.localize('DSCT.notice.grab.rollNotDetected')); await cleanup(null); }, TIMEOUT_MS);
    ds.helpers.macros.rollItemMacro(grabItem.uuid);
  });

  if (resolvedTier === null) return;
  await runGrab(grabberToken, targetToken, { tier: resolvedTier });
};

export const registerGrabTierSync = () => {
  Hooks.on('updateChatMessage', async (message, changes) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!foundry.utils.hasProperty(changes, 'flags.draw-steel-target-damage')) return;
    const gr = message.getFlag(M, 'grabRoll');
    if (!gr) return;
    const grabberTok = getTokenById(gr.grabberTokenId);
    const targetTok  = getTokenById(gr.targetTokenId);
    if (!grabberTok || !targetTok) return;
    const targetKey = targetTok.document.uuid.replace(/\./g, '__');
    const newTier = _effectiveRowTier(message, targetKey, targetTok.document.uuid, gr.appliedTier);
    if (newTier === gr.appliedTier) return;
    await message.setFlag(M, 'grabRoll', { ...gr, appliedTier: newTier });
    if (getSetting('debugMode')) console.log(`DSCT | grab | roll tier ${gr.appliedTier} -> ${newTier} via pill edit, reconciling`);
    const active = window._activeGrabs?.get(gr.targetTokenId);
    const wasApplied = !!(active && active.grabberTokenId === gr.grabberTokenId);
    if (wasApplied) await endGrab(gr.targetTokenId, { silent: true });
    await runGrab(grabberTok, targetTok, { tier: newTier });
  });
};

export const attemptGrabEscape = async (grabbedTokenId) => {
  const grab = window._activeGrabs?.get(grabbedTokenId);
  if (!grab) return;
  const grabbedTok = getTokenById(grabbedTokenId);
  if (!grabbedTok) return;
  const escapeItem = grabbedTok.actor.items.find(i => i.name === 'Escape Grab');
  if (!escapeItem) { ui.notifications.warn(game.i18n.format('DSCT.notice.grab.noEscapeItem', { name: grab.grabbedName })); return; }
  ds.helpers.macros.rollItemMacro(escapeItem.uuid);
};

export const startGrabReposition = async (grabbedTokenId) => {
  const grab = window._activeGrabs?.get(grabbedTokenId);
  if (!grab) return;
  const grabbedTok = getTokenById(grabbedTokenId);
  const grabberTok = getTokenById(grab.grabberTokenId);
  if (!grabbedTok || !grabberTok) return;

  if (!window._grabRepositioning) window._grabRepositioning = new Set();
  if (window._grabRepositioning.has(grabbedTokenId)) return;

  window._grabRepositioning.add(grabbedTokenId);
  refreshOpenPanel();

  const chosen = await chooseFreeSquare(grabbedTok, grabberTok, {
    maxRadius: 1,
    title: game.i18n.localize('DSCT.picker.titleReposition'),
    status: game.i18n.format('DSCT.picker.repositionInstruction', { name: grab.grabbedName, grabber: grab.grabberName }),
  });

  window._grabRepositioning.delete(grabbedTokenId);

  if (chosen) {
    const dest = toWorld(chosen);
    window._grabFollowActive.add(grabbedTokenId);
    await safeUpdate(grabbedTok.document, { x: dest.x, y: dest.y });
    window._grabFollowActive.delete(grabbedTokenId);
    grab.offsetX = dest.x - grabberTok.document.x;
    grab.offsetY = dest.y - grabberTok.document.y;
    window._activeGrabs.set(grabbedTokenId, grab);
    ui.notifications.info(game.i18n.format('DSCT.notice.grab.repositioned', { name: grab.grabbedName }));
  }

  refreshOpenPanel();
};

export const buildGrabListHTML = () => {
  const grabs = window._activeGrabs?.size ? [...window._activeGrabs.values()] : [];
  if (!grabs.length && !grabUiState.pendingConfirm) {
    return `<div class="dsct-grab-empty">No active grabs</div>`;
  }

  const allowManual = !getSetting('restrictGrabButtons') || game.user.isGM;
  let html = '';

  if (grabUiState.pendingConfirm) {
    const { grabberToken, targetToken } = grabUiState.pendingConfirm;
    html += `<div class="dsct-grab-pending">
      <div class="dsct-grab-pending-label">Pending: ${grabberToken.name} grabs ${targetToken.name}</div>
      <div class="dsct-grab-free-strike">${buildFreeStrikeButton(targetToken.actor, grabberToken.id)}</div>
      <div class="dsct-flex-row">
        <button type="button" data-confirm-grab="1" class="dsct-grab-action-btn accent">Confirm</button>
        <button type="button" data-cancel-grab="1"  class="dsct-grab-action-btn danger">Cancel</button>
      </div>
    </div>`;
  }

  html += grabs.map(grab => {
    const grabberTok    = getTokenById(grab.grabberTokenId);
    const grabbedTok    = getTokenById(grab.grabbedTokenId);
    const grabberSrc    = grabberTok?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const grabbedSrc    = grabbedTok?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const isPending     = grabUiState.pendingEscape?.grabbedTokenId === grab.grabbedTokenId;
    const repositioning = window._grabRepositioning?.has(grab.grabbedTokenId);

    return `<div class="dsct-grab-item${repositioning ? ' repositioning' : ''}">
      <div class="dsct-grab-grid">
        <img data-ping="${grab.grabberTokenId}" src="${grabberSrc}"
          class="dsct-grab-token-img" style="grid-column:1;grid-row:1;">
        <div class="dsct-fm-moves-label" style="grid-column:2;grid-row:1/3;align-self:center;">grabs</div>
        <img data-ping="${grab.grabbedTokenId}" src="${grabbedSrc}"
          class="dsct-grab-token-img${repositioning ? ' repositioning' : ''}" style="grid-column:3;grid-row:1;">
        <div class="dsct-grab-name" style="grid-column:1;grid-row:2;">${grab.grabberName}</div>
        <div class="dsct-grab-name" style="grid-column:3;grid-row:2;">${grab.grabbedName}</div>
      </div>
      ${repositioning ? `<div class="dsct-reposition-status">Move ${grab.grabbedName} to an adjacent position</div>` : ''}
      <div class="dsct-flex-row">
        <button type="button" data-escape="${grab.grabbedTokenId}" class="dsct-grab-action-btn">Escape</button>
        <button type="button" data-reposition="${grab.grabbedTokenId}" class="dsct-grab-action-btn${repositioning ? ' repositioning' : ''}">
          ${repositioning ? 'Moving...' : 'Reposition'}</button>
        ${allowManual ? `<button type="button" data-endgrab="${grab.grabbedTokenId}" class="dsct-grab-action-btn danger">End Grab</button>` : ''}
      </div>
      ${isPending ? `<div class="dsct-escape-tier2">
        Tier 2: ${grab.grabbedName} can escape, but ${grab.grabberName} gets a free strike first.<br>
        ${buildFreeStrikeButton(grabberTok?.actor, grab.grabbedTokenId)}
        <div class="dsct-flex-row" style="margin-top:4px;">
          <button type="button" data-escapetier2accept="${grab.grabbedTokenId}" class="dsct-grab-action-btn accent">Accept escape</button>
          <button type="button" data-escapetier2deny="${grab.grabbedTokenId}"   class="dsct-grab-action-btn danger">Stay grabbed</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');

  return html;
};

export const handleGrabListClick = async (e) => {
  const pingId = e.target.closest('[data-ping]')?.dataset.ping;
  if (pingId) { const tok = getTokenById(pingId); if (tok) canvas.ping({ x: tok.center.x, y: tok.center.y }); return true; }

  const escapeId = e.target.closest('[data-escape]')?.dataset.escape;
  if (escapeId) { await attemptGrabEscape(escapeId); return true; }

  const repoId = e.target.closest('[data-reposition]')?.dataset.reposition;
  if (repoId) { await startGrabReposition(repoId); return true; }

  const endId = e.target.closest('[data-endgrab]')?.dataset.endgrab;
  if (endId) { await endGrab(endId); return true; }

  const acceptId = e.target.closest('[data-escapetier2accept]')?.dataset.escapetier2accept;
  if (acceptId) {
    const grab = window._activeGrabs?.get(acceptId);
    const grabberTk = grab ? getTokenById(grab.grabberTokenId) : null;
    grabUiState.pendingEscape = null;
    if (grab && grabberTk) await triggerGrabberFreeStrike(grabberTk, grab);
    await endGrab(acceptId, { silent: true });
    await resolveEscapeChatMessage(acceptId, 'accepted');
    return true;
  }

  const denyId = e.target.closest('[data-escapetier2deny]')?.dataset.escapetier2deny;
  if (denyId) {
    const grab = window._activeGrabs?.get(denyId);
    grabUiState.pendingEscape = null;
    refreshOpenPanel();
    if (grab) ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.staysGrabbed', { name: grab.grabbedName }) });
    await resolveEscapeChatMessage(denyId, 'denied');
    return true;
  }

  if (e.target.closest('[data-confirm-grab]')) {
    if (!grabUiState.pendingConfirm) return true;
    const { grabberToken, targetToken, msgId, maxGrabs } = grabUiState.pendingConfirm;
    grabUiState.pendingConfirm = null;
    await applyGrab(grabberToken, targetToken, { maxGrabs: maxGrabs ?? 1 });
    await resolveGrabConfirmChatMessage(msgId, 'confirmed');
    return true;
  }

  if (e.target.closest('[data-cancel-grab]')) {
    const pc = grabUiState.pendingConfirm;
    grabUiState.pendingConfirm = null;
    refreshOpenPanel();
    if (pc) await resolveGrabConfirmChatMessage(pc.msgId, 'cancelled');
    return true;
  }

  const freeStrikeEl = e.target.closest('[data-dsct-action="dsct-free-strike"]');
  if (freeStrikeEl) {
    const targetTokId = freeStrikeEl.dataset.targetTokenId;
    if (targetTokId) {
      const tok = getTokenById(targetTokId);
      if (tok) tok.setTarget(true, { user: game.user, releaseOthers: true });
    }
    await ds.helpers.macros.rollItemMacro(freeStrikeEl.dataset.itemUuid);
    return true;
  }

  return false;
};


export const toggleGrabPanel = () => {
  if (!getSetting('conditionsEnabled')) return;
  const existing = getWindowById('dsct-dc-panel');
  if (existing) { existing._setGrabsExpanded?.(true); existing.bringToFront?.(); return; }
  toggleDamageConditionsPanel({ grabsExpanded: true });
};

export const openGrabPanel = toggleGrabPanel;

function _isKnockbackGrabbed(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return false;
  if (getItemDsid(ability) !== 'knockback') return false;
  const actor = ability.actor ?? ability.parent;
  if (!actor) return false;
  const casterToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
                   ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  if (!casterToken || !window._activeGrabs?.has(casterToken.id)) return false;
  ui.notifications.warn(game.i18n.format('DSCT.notice.grab.knockbackWhileGrabbed', { name: casterToken.name }));
  return true;
}

function _checkAbilityRange(dialog) {
  const ability = dialog.options?.ability;
  if (!ability) return null;
  if (ability.system?.keywords?.has('area')) return null;
  if (ability.system?.type === 'triggered') return null;

  const _actor = ability.actor ?? ability.parent;
  if (_actor?.system?.isMinion && ability.system?.category === 'signature') return null;

  const range = getItemRange(ability);
  if (!range || isNaN(range)) return null;

  const actor       = ability.actor ?? ability.parent;
  const casterToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
                   ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  if (!casterToken) return null;

  const targets = [...game.user.targets].filter(t => t.id !== casterToken.id);
  if (!targets.length) return null;

  const CGD        = canvas.grid.distance;
  const outOfRange = targets.filter(t => tokFootprintDist(casterToken, t) >= range * CGD);
  if (!outOfRange.length) return null;

  
  const abilityLabel = /[!?.]$/.test(ability.name) ? ability.name : ability.name + '.';
  ui.notifications.warn(game.i18n.format('DSCT.notice.abilityRange.outOfRange', {
    names:   outOfRange.map(t => t.name).join(', '),
    verb:    outOfRange.length === 1 ? 'is' : 'are',
    ability: abilityLabel,
    range,
  }));

  if (game.user.isGM && getSetting('gmBypassRangeEnforcement')) return null;
  return getSetting('enforceAbilityRange') ? 'block' : null;
}

export function registerKnockbackGuard() {
  Hooks.on('ds.canRenderAbilityConfigurationDialog', (app) => {
    if (getSetting('conditionsEnabled') && _isKnockbackGrabbed(app)) return false;
    if (getSetting('abilityAutomationEnabled') && _checkAbilityRange(app) === 'block') return false;
    if (getSetting('abilityAutomationEnabled') && checkAndRunSquadTargeting(app) === 'block') return false;
    if (getSetting('abilityAutomationEnabled') && checkAndRunTargetPicker(app) === 'block') return false;
  });
}