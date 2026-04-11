import { getSetting, safeCreateEmbedded, safeDelete, canForcedMoveTarget, getTokenById, getWindowById, s, palette, injectPanelChrome } from './helpers.mjs';
import { triggerGrabberFreeStrike, resolveEscapeChatMessage, resolveGrabConfirmChatMessage } from './chat-integration.mjs';

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

export const buildFreeStrikeButton = (actor) => {
  const item = actor?.items.find(i => i.name.toLowerCase().includes('melee free strike'));
  if (item) return `<a onclick="ds.helpers.macros.rollItemMacro('${item.uuid}')" style="cursor:pointer;">Melee Free Strike</a>`;
  const dmg = actor?.system.monster?.freeStrike;
  return dmg !== undefined ? `[[/damage ${dmg}]]{Free Strike (${dmg} damage)}` : `<em>(No Melee Free Strike found)</em>`;
};

const refreshOpenPanel = () => {
  const panel = getWindowById('grab-panel');
  if (panel) panel._refreshPanel();
};

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
        ui.notifications.warn(`${window._activeGrabs.get(doc.id).grabbedName} is grabbed and cannot move. Moving ends the grab.`);
        await endGrab(doc.id, { silent: true });
      } else {
        delete changes.x; delete changes.y;
        ui.notifications.warn(`${window._activeGrabs.get(doc.id).grabbedName} is grabbed and cannot move!`);
      }
    });
  }

  if (!window._grabFollowHook) {
    window._grabFollowHook = Hooks.on('updateToken', async (doc, changes) => {
      if (!window._activeGrabs?.size) return;
      if (changes.x === undefined && changes.y === undefined) return;
      if (window._grabFMSuppressed?.has(doc.id)) return; // grabber being force-moved; grabbed creature stays put
      // Capture delta before any awaits because doc.x/y is a live reference and may update
      // once Foundry finishes processing the first grabbed-token follow-move.
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
      if (!effect.statuses?.has('grabbed') || !window._activeGrabs?.size) return;
      for (const [gid, grab] of [...window._activeGrabs.entries()]) {
        if (effect.parent?.id !== grab.grabberActorId) continue;
        await endGrab(gid, { silent: false, customMsg: `${grab.grabberName} was grabbed and released ${grab.grabbedName}.` });
      }
    });
  }
};

const removeGrabHooks = () => {
  if (window._grabPreHook)        { Hooks.off('preUpdateToken',     window._grabPreHook);        window._grabPreHook        = null; }
  if (window._grabFollowHook)     { Hooks.off('updateToken',        window._grabFollowHook);     window._grabFollowHook     = null; }
  if (window._grabberGrabbedHook) { Hooks.off('createActiveEffect', window._grabberGrabbedHook); window._grabberGrabbedHook = null; }
  if (window._grabRepositionHook) { Hooks.off('updateToken',        window._grabRepositionHook); window._grabRepositionHook = null; }
  window._grabFollowActive  = new Set();
  window._grabRepositioning = new Set();
};

const rehydrateGrabs = () => {
  // the entire grab state lives in a window global and evaporates on reload.
  // we rebuild it here by scanning every token for the 'Grabber' effect and parsing the token IDs
  // we baked into the effect origin when the grab started. it works, it's just not pretty.
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

      const grabbedEffect = grabbedTok.actor.effects.find(e => [...(e.statuses ?? [])].includes('grabbed'));

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
  
  Hooks.on('canvasReady', rehydrateGrabs);
};

export const applyGrab = async (grabberTok, grabbedTok, { maxGrabs = 1 } = {}) => {
  if (!window._activeGrabs) window._activeGrabs = new Map();
  if (window._activeGrabs.has(grabbedTok.id)) await endGrab(grabbedTok.id, { silent: true });

  // Enforce the grabber's simultaneous grab limit.
  const currentGrabs = [...window._activeGrabs.values()].filter(g => g.grabberTokenId === grabberTok.id);
  if (currentGrabs.length >= maxGrabs) {
    if (maxGrabs === 1) {
      // Standard rule: silently drop the existing grab and replace it.
      await endGrab(currentGrabs[0].grabbedTokenId, { silent: false, customMsg: `${grabberTok.name} releases ${currentGrabs[0].grabbedName} to grab a new target.` });
    } else {
      ui.notifications.warn(`${grabberTok.name} is already grabbing ${maxGrabs} creature${maxGrabs !== 1 ? 's' : ''} (the maximum for this ability).`);
      return;
    }
  }

  await safeCreateEmbedded(grabbedTok.actor, 'ActiveEffect', [{
    name: 'Grabbed',
    img: 'icons/skills/melee/unarmed-punch-fist-yellow-red.webp',
    type: 'base',
    statuses: ['grabbed'],
    changes: [],
    system: { end: { type: 'encounter', roll: '1d10 + @combat.save.bonus' } },
    disabled: false, transfer: false, flags: {},
    duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: 0, startTurn: 0 },
    description: '<p>You have speed 0, cannot be force moved except by the creature, object, or effect that has you grabbed, and cannot use the Knockback maneuver. You take a bane on abilities that do not target the creature, object, or effect that has you grabbed.</p><p>You can attempt to escape using the <strong>Escape Grab</strong> maneuver. If you teleport, or if either you or the creature grabbing you is force moved so that you are no longer adjacent, the grab ends.</p><p>If the creature grabbing you moves, they bring you with them.</p>',
    tint: '#ffffff', sort: 0,
  }]);

  const grabberSizeObj = grabberTok.actor.system?.combat?.size ?? { value: 1, letter: 'M' };
  const grabbedSizeObj = grabbedTok.actor.system?.combat?.size ?? { value: 1, letter: 'M' };
  const speedChanges = sizeRankG(grabberSizeObj) <= sizeRankG(grabbedSizeObj)
    ? [{ key: 'system.movement.value', mode: 5, value: String(Math.floor((grabberTok.actor.system?.movement?.value ?? 5) / 2)), priority: null }]
    : [];

  const [grabberEffect] = await safeCreateEmbedded(grabberTok.actor, 'ActiveEffect', [{
    name: 'Grabber',
    img: 'icons/magic/control/debuff-chains-shackle-movement-red.webp',
    type: 'base',
    system: { end: { type: 'encounter', roll: '' }, filters: { keywords: [] } },
    changes: speedChanges, disabled: false, transfer: false, statuses: [], flags: {},
    duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
    description: '<p>You can use a maneuver to move the grabbed creature into an unoccupied space adjacent to you. You can release the grabbed creature at any time to end the grab (no action required). If you are force moved so that you are no longer adjacent to the grabbed creature, the grab ends.</p><p>You can grab only creatures of your size or smaller. If your Might score is 2 or higher, you can grab creatures larger than you with a size equal to or less than your Might score. Unless otherwise indicated, you can grab only one creature at a time.</p><p>If your size is equal to or less than the size of the creature you have grabbed, your speed is halved while you have them grabbed.</p>',
    tint: '#ffffff', sort: 0,
    flags: { [M]: { grab: { grabberId: grabberTok.id, grabbedId: grabbedTok.id } } },
  }]);

  const grabbedEffect = grabbedTok.actor.effects.find(e => [...(e.statuses ?? [])].includes('grabbed'));

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

  const grabberTok = getTokenById(grab.grabberTokenId);
  const grabbedTok = getTokenById(grab.grabbedTokenId);
  if (grab.grabberEffectId) { const e = grabberTok?.actor.effects.get(grab.grabberEffectId); if (e) await safeDelete(e); }
  if (grab.grabbedEffectId) { const e = grabbedTok?.actor.effects.get(grab.grabbedEffectId); if (e) await safeDelete(e); }
  window._activeGrabs.delete(grabbedTokenId);

  if (!window._activeGrabs.size) {
    removeGrabHooks();
  }

  if (!silent) ChatMessage.create({ content: `<strong>Grab ended:</strong> ${customMsg ?? `${grab.grabberName} releases ${grab.grabbedName}.`}` });
  refreshOpenPanel();
};

export const runGrab = async (grabberToken, targetToken, { forceApply = false, tier = null, maxGrabs = 1 } = {}) => {
  if (!grabberToken) { ui.notifications.warn('No grabber token specified.'); return; }
  if (!targetToken)  { ui.notifications.warn('No target token specified.'); return; }
  if (grabberToken.id === targetToken.id) { ui.notifications.warn('A creature cannot grab itself.'); return; }

  const grabberActor = grabberToken.actor;
  const targetActor  = targetToken.actor;

  if (!forceApply && !(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
    if (!canForcedMoveTarget(grabberActor, targetActor)) {
      ui.notifications.warn(`${grabberToken.name} cannot grab ${targetToken.name}: target is too large given their size and Might score.`);
      return;
    }
  }

  if (forceApply) {
    await applyGrab(grabberToken, targetToken, { maxGrabs });
    ChatMessage.create({ content: `<strong>Grab applied:</strong> ${grabberToken.name} grabs ${targetToken.name}!` });
    return;
  }

  if (tier !== null) {
    if (tier < 2) {
      ChatMessage.create({ content: `<strong>Grab:</strong> ${grabberToken.name} fails to grab ${targetToken.name}.` });
      return;
    }
    if (tier === 2) {
      const createdMsg = await ChatMessage.create({ content: `
        <strong>Grab - Tier 2:</strong> ${grabberToken.name} gets hold of ${targetToken.name}!<br>
        ${targetToken.name} may make a free strike:<br>
        <div style="margin: 4px 0;">${buildFreeStrikeButton(targetActor)}</div>
        <div style="display:flex;gap:4px;margin-top:6px;" class="dsct-tier2-grab-actions" data-grabber-id="${grabberToken.id}" data-target-id="${targetToken.id}">
          <button type="button" class="apply-effect" data-action="dsct-confirm-grab" style="cursor:pointer;flex:1;"><i class="fa-solid fa-check"></i> Confirm Grab</button>
          <button type="button" class="apply-effect" data-action="dsct-cancel-grab" style="cursor:pointer;flex:1;border-color:var(--color-text-error);color:var(--color-text-error);"><i class="fa-solid fa-times"></i> Cancel</button>
        </div>
      ` });

      const panel = getWindowById('grab-panel');
      if (panel) {
        panel._pendingConfirm = { grabberToken, targetToken, msgId: createdMsg?.id ?? null, maxGrabs };
        panel._refreshPanel();
      }
      return;
    }
    await applyGrab(grabberToken, targetToken, { maxGrabs });
    ChatMessage.create({ content: `<strong>Grab - Tier 3:</strong> ${grabberToken.name} grabs ${targetToken.name}!` });
    return;
  }

  const dist = canvas.grid.measurePath([
    { x: grabberToken.center.x, y: grabberToken.center.y },
    { x: targetToken.center.x,  y: targetToken.center.y }
  ]).distance;
  if (dist > canvas.grid.distance) {
    ui.notifications.warn(`${targetToken.name} is not adjacent (${dist} squares away).`);
    return;
  }

  const grabItem = grabberActor.items.find(i => i.name === 'Grab');
  if (!grabItem) { ui.notifications.warn(`No "Grab" item found on ${grabberActor.name}.`); return; }

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
      await cleanup(ar.tier);
    });
    timeoutId = setTimeout(() => { ui.notifications.warn('Roll not detected.'); cleanup(null); }, TIMEOUT_MS);
    ds.helpers.macros.rollItemMacro(grabItem.uuid);
  });

  if (resolvedTier === null) return;
  await runGrab(grabberToken, targetToken, { tier: resolvedTier });
};

export class GrabPanel extends Application {
  constructor() {
    super();
    this._html           = null;
    this._grabberToken   = null;
    this._targetToken    = null;
    this._pendingEscape  = null;
    this._pendingConfirm = null;
    this._updatePreview();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'grab-panel', title: 'Grab', template: null,
      width: s(280), height: 'auto', resizable: false, minimizable: false,
    });
  }

  _updatePreview() {
    const controlled   = canvas.tokens.controlled;
    const targets      = [...game.user.targets];
    this._grabberToken = controlled.length === 1 ? controlled[0] : null;
    this._targetToken  = targets.length   === 1 ? targets[0]    : null;
  }

  async _endGrab(grabbedTokenId, silent = false, customMsg = null) {
    await endGrab(grabbedTokenId, { silent, customMsg });
  }

  async _applyGrab(grabberTok, grabbedTok) {
    await applyGrab(grabberTok, grabbedTok);
  }

  async _attemptEscape(grabbedTokenId) {
    const grab       = window._activeGrabs?.get(grabbedTokenId);
    if (!grab) return;
    const grabbedTok = getTokenById(grabbedTokenId);
    if (!grabbedTok) return;

    const escapeItem = grabbedTok.actor.items.find(i => i.name === 'Escape Grab');
    if (!escapeItem) { ui.notifications.warn(`No "Escape Grab" ability found on ${grab.grabbedName}.`); return; }

    // Size bane (if applicable) is now injected via the power roll delta system in chat-hooks,
    // so it applies consistently whether escape is triggered from the panel or the actor sheet.
    ds.helpers.macros.rollItemMacro(escapeItem.uuid);
  }

  async _startReposition(grabbedTokenId) {
    const grab = window._activeGrabs?.get(grabbedTokenId);
    if (!grab) return;

    if (!window._grabRepositioning) window._grabRepositioning = new Set();

    if (window._grabRepositioning.has(grabbedTokenId)) {
      window._grabRepositioning.delete(grabbedTokenId);
      if (window._grabRepositionHook) { Hooks.off('updateToken', window._grabRepositionHook); window._grabRepositionHook = null; }
      this._refreshPanel();
      return;
    }

    window._grabRepositioning.add(grabbedTokenId);
    this._refreshPanel();

    window._grabRepositionHook = Hooks.on('updateToken', async (doc, changes) => {
      if (doc.id !== grabbedTokenId) return;
      if (changes.x === undefined && changes.y === undefined) return;

      Hooks.off('updateToken', window._grabRepositionHook);
      window._grabRepositionHook = null;
      window._grabRepositioning.delete(grabbedTokenId);

      const grabbedTok = getTokenById(grabbedTokenId);
      const grabberTok = getTokenById(grab.grabberTokenId);
      if (!grabbedTok || !grabberTok) { this._refreshPanel(); return; }

      const newX = (changes.x ?? doc.x) + (grabbedTok.document.width  * canvas.grid.size / 2);
      const newY = (changes.y ?? doc.y) + (grabbedTok.document.height * canvas.grid.size / 2);

      const dist = canvas.grid.measurePath([
        { x: grabberTok.center.x, y: grabberTok.center.y },
        { x: newX, y: newY }
      ]).distance;

      if (dist > canvas.grid.distance) {
        window._grabFollowActive.add(grabbedTokenId);
        await grabbedTok.document.update({ x: grabberTok.document.x + (grab.offsetX ?? 0), y: grabberTok.document.y + (grab.offsetY ?? 0) });
        window._grabFollowActive.delete(grabbedTokenId);
        ui.notifications.warn(`${grab.grabbedName} must be placed adjacent to ${grab.grabberName}, reverted.`);
      } else {
        grab.offsetX = (changes.x ?? doc.x) - grabberTok.document.x;
        grab.offsetY = (changes.y ?? doc.y) - grabberTok.document.y;
        window._activeGrabs.set(grabbedTokenId, grab);
        ui.notifications.info(`${grab.grabbedName} repositioned.`);
      }

      this._refreshPanel();
    });
  }

  _buildGrabListHTML(p) {
    const grabs = window._activeGrabs?.size ? [...window._activeGrabs.values()] : [];
    if (!grabs.length && !this._pendingConfirm) {
      return `<div style="font-size:${s(10)}px;color:${p.textDim};text-align:center;padding:${s(10)}px 0;">No active grabs</div>`;
    }

    const allowManual = !getSetting('restrictGrabButtons') || game.user.isGM;
    let html = '';

    if (this._pendingConfirm) {
      const { grabberToken, targetToken } = this._pendingConfirm;
      html += `<div style="padding:${s(5)}px;border-radius:${s(3)}px;border:1px solid ${p.accent};
        background:${p.bgInner};margin-bottom:${s(4)}px;">
        <div style="font-size:${s(9)}px;color:${p.accent};margin-bottom:${s(4)}px;">Pending: ${grabberToken.name} grabs ${targetToken.name}</div>
        <div style="font-size:${s(8)}px;color:${p.text};margin-bottom:${s(4)}px;">${buildFreeStrikeButton(targetToken.actor)}</div>
        <div style="display:flex;gap:${s(3)}px;">
          <button data-confirm-grab="1"
            style="flex:1;font-size:${s(8)}px;padding:${s(3)}px;border-radius:${s(2)}px;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">Confirm</button>
          <button data-cancel-grab="1"
            style="flex:1;font-size:${s(8)}px;padding:${s(3)}px;border-radius:${s(2)}px;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${p.accentRed};color:${p.accentRed};">Cancel</button>
        </div>
      </div>`;
    }

    html += grabs.map(grab => {
      const grabberTok    = getTokenById(grab.grabberTokenId);
      const grabbedTok    = getTokenById(grab.grabbedTokenId);
      const grabberSrc    = grabberTok?.document.texture.src ?? 'icons/svg/mystery-man.svg';
      const grabbedSrc    = grabbedTok?.document.texture.src ?? 'icons/svg/mystery-man.svg';
      const isPending     = this._pendingEscape?.grabbedTokenId === grab.grabbedTokenId;
      const repositioning = window._grabRepositioning?.has(grab.grabbedTokenId);

      return `<div style="padding:${s(5)}px;border-radius:${s(3)}px;border:1px solid ${repositioning ? '#806020' : p.border};
        background:${p.bgInner};margin-bottom:${s(4)}px;">
        <div style="display:flex;justify-content:center;align-items:flex-end;gap:${s(12)}px;margin-bottom:${s(5)}px;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:${s(2)}px;">
            <img data-ping="${grab.grabberTokenId}" src="${grabberSrc}"
              style="width:${s(40)}px;height:${s(40)}px;border-radius:${s(2)}px;object-fit:contain;
              cursor:pointer;border:1px solid ${p.border};background:${p.bg};">
            <div style="font-size:${s(7)}px;color:${p.textDim};max-width:${s(52)}px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${grab.grabberName}</div>
          </div>
          <div style="font-size:${s(9)}px;color:${p.textDim};padding-bottom:${s(14)}px;">grabs</div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:${s(2)}px;">
            <img data-ping="${grab.grabbedTokenId}" src="${grabbedSrc}"
              style="width:${s(40)}px;height:${s(40)}px;border-radius:${s(2)}px;object-fit:contain;
              cursor:pointer;border:1px solid ${repositioning ? '#806020' : p.border};background:${p.bg};">
            <div style="font-size:${s(7)}px;color:${p.textDim};max-width:${s(52)}px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${grab.grabbedName}</div>
          </div>
        </div>
        ${repositioning ? `<div style="font-size:${s(8)}px;color:#c09030;text-align:center;margin-bottom:${s(4)}px;">
          Move ${grab.grabbedName} to an adjacent position</div>` : ''}
        <div style="display:flex;gap:${s(3)}px;">
          <button data-escape="${grab.grabbedTokenId}"
            style="flex:1;font-size:${s(8)}px;padding:${s(3)}px ${s(2)}px;border-radius:${s(2)}px;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.text};">Escape</button>
          <button data-reposition="${grab.grabbedTokenId}"
            style="flex:1;font-size:${s(8)}px;padding:${s(3)}px ${s(2)}px;border-radius:${s(2)}px;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${repositioning ? '#806020' : p.border};
            color:${repositioning ? '#c09030' : p.text};">${repositioning ? 'Moving...' : 'Reposition'}</button>
          ${allowManual ? `<button data-endgrab="${grab.grabbedTokenId}"
            style="flex:1;font-size:${s(8)}px;padding:${s(3)}px ${s(2)}px;border-radius:${s(2)}px;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${p.accentRed};color:${p.accentRed};">End Grab</button>` : ''}
        </div>
        ${isPending ? `<div style="border-top:1px solid ${p.border};padding-top:${s(4)}px;margin-top:${s(5)}px;font-size:${s(8)}px;color:${p.text};">
          Tier 2: ${grab.grabbedName} can escape, but ${grab.grabberName} gets a free strike first.<br>
          ${buildFreeStrikeButton(grabberTok?.actor)}
          <div style="display:flex;gap:${s(3)}px;margin-top:${s(3)}px;">
            <button data-escapetier2accept="${grab.grabbedTokenId}"
              style="flex:1;font-size:${s(8)}px;padding:${s(2)}px;border-radius:${s(2)}px;cursor:pointer;
              background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">Accept escape</button>
            <button data-escapetier2deny="${grab.grabbedTokenId}"
              style="flex:1;font-size:${s(8)}px;padding:${s(2)}px;border-radius:${s(2)}px;cursor:pointer;
              background:${p.bgBtn};border:1px solid ${p.accentRed};color:${p.accentRed};">Stay grabbed</button>
          </div>
        </div>` : ''}
      </div>`;
    }).join('');

    return html;
  }

  _refreshPanel() {
    if (!this._html) return;
    this._updatePreview();
    const p = palette();

    const grabberImg    = this._html.find('#grab-grabber-img')[0];
    const grabberNameEl = this._html.find('#grab-grabber-name')[0];
    if (grabberImg)    grabberImg.src = this._grabberToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    if (grabberNameEl) { grabberNameEl.textContent = this._grabberToken?.name ?? 'No token selected'; grabberNameEl.style.color = this._grabberToken ? p.text : p.textDim; }

    const targetImg    = this._html.find('#grab-target-img')[0];
    const targetNameEl = this._html.find('#grab-target-name')[0];
    if (targetImg)    targetImg.src = this._targetToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    if (targetNameEl) { targetNameEl.textContent = this._targetToken?.name ?? 'No target'; targetNameEl.style.color = this._targetToken ? p.text : p.textDim; }

    const grabList = this._html.find('#grab-list')[0];
    if (grabList) grabList.innerHTML = this._buildGrabListHTML(p);
    this._bindGrabListHandlers();
  }

  _bindGrabListHandlers() {
    if (!this._html) return;
    const h = this._html;

    h.find('[data-ping]').off('click').on('click', e => {
      const tok = getTokenById(e.currentTarget.dataset.ping);
      if (tok) canvas.ping({ x: tok.center.x, y: tok.center.y });
    });
    h.find('[data-escape]').off('click').on('click', async e => {
      await this._attemptEscape(e.currentTarget.dataset.escape);
    });
    h.find('[data-reposition]').off('click').on('click', async e => {
      await this._startReposition(e.currentTarget.dataset.reposition);
    });
    h.find('[data-endgrab]').off('click').on('click', async e => {
      await endGrab(e.currentTarget.dataset.endgrab);
    });
    h.find('[data-escapetier2accept]').off('click').on('click', async e => {
      const id        = e.currentTarget.dataset.escapetier2accept;
      const grab      = window._activeGrabs?.get(id);
      const grabberTk = grab ? getTokenById(grab.grabberTokenId) : null;
      this._pendingEscape = null;
      if (grab && grabberTk) await triggerGrabberFreeStrike(grabberTk, grab);
      await endGrab(id, { silent: true });
      await resolveEscapeChatMessage(id, 'accepted');
    });
    h.find('[data-escapetier2deny]').off('click').on('click', async e => {
      const id   = e.currentTarget.dataset.escapetier2deny;
      const grab = window._activeGrabs?.get(id);
      this._pendingEscape = null;
      this._refreshPanel();
      if (grab) ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} stays grabbed.` });
      await resolveEscapeChatMessage(id, 'denied');
    });
    h.find('[data-confirm-grab]').off('click').on('click', async () => {
      if (!this._pendingConfirm) return;
      const { grabberToken, targetToken, msgId, maxGrabs } = this._pendingConfirm;
      this._pendingConfirm = null;
      await applyGrab(grabberToken, targetToken, { maxGrabs: maxGrabs ?? 1 });
      await resolveGrabConfirmChatMessage(msgId, 'confirmed');
    });
    h.find('[data-cancel-grab]').off('click').on('click', async () => {
      const pc = this._pendingConfirm;
      this._pendingConfirm = null;
      this._refreshPanel();
      if (pc) await resolveGrabConfirmChatMessage(pc.msgId, 'cancelled');
    });
  }

  async _renderInner(data) {
    injectPanelChrome(this.options.id);
    const p = palette();

    const grabberSrc   = this._grabberToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const grabberLabel = this._grabberToken?.name ?? 'No token selected';
    const targetSrc    = this._targetToken?.document.texture.src  ?? 'icons/svg/mystery-man.svg';
    const targetLabel  = this._targetToken?.name ?? 'No target';
    
    const allowManual = !getSetting('restrictGrabButtons') || game.user.isGM;

    return $(`
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;min-height:${s(420)}px;" id="grab-drag-handle">

        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Grab</div>
          <button data-action="close-window"
            style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;margin-left:auto;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;
            display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
        </div>

        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(8)}px;">
          <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(6)}px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:${s(3)}px;flex:1;min-width:0;">
              <img id="grab-grabber-img" src="${grabberSrc}"
                style="width:${s(48)}px;height:${s(48)}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
              <div id="grab-grabber-name" style="font-size:${s(8)}px;color:${this._grabberToken ? p.text : p.textDim};
                text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${grabberLabel}</div>
            </div>
            <div style="font-size:${s(14)}px;color:${p.textDim};flex-shrink:0;">to</div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:${s(3)}px;flex:1;min-width:0;">
              <img id="grab-target-img" src="${targetSrc}"
                style="width:${s(48)}px;height:${s(48)}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
              <div id="grab-target-name" style="font-size:${s(8)}px;color:${this._targetToken ? p.text : p.textDim};
                text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${targetLabel}</div>
            </div>
          </div>
          <div style="display:flex;gap:${s(4)}px;">
            <button data-action="attempt-grab"
              style="flex:1;padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;
              background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">Attempt Grab</button>
            ${allowManual ? `<button data-action="apply-grab"
              style="flex:1;padding:${s(5)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;
              background:${p.bgBtn};border:1px solid ${p.accentGreen};color:${p.accentGreen};">Apply Grab</button>` : ''}
          </div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Active Grabs</div>
        <div id="grab-list">${this._buildGrabListHTML(p)}</div>

      </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._html = html;

    const appEl = html[0].closest('.app');
    if (appEl) {
	  const saved = window._grabPanelPos;
      appEl.style.left = saved ? `${saved.left}px` : `${Math.round((window.innerWidth - (appEl.offsetWidth || s(280))) / 2)}px`;
      appEl.style.top  = saved ? `${saved.top}px`  : `${Math.round((window.innerHeight - (appEl.offsetHeight || s(420))) / 2)}px`;
      html[0].addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('[data-ping]')) return;
        e.preventDefault();
        const sx = e.clientX - appEl.offsetLeft, sy = e.clientY - appEl.offsetTop;
        const onMove = ev => { appEl.style.left = `${ev.clientX - sx}px`; appEl.style.top = `${ev.clientY - sy}px`; };
        const onUp   = () => {
          window._grabPanelPos = { left: parseInt(appEl.style.left), top: parseInt(appEl.style.top) };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    if (this._hookControl) Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)  Hooks.off('targetToken',  this._hookTarget);
    this._hookControl = Hooks.on('controlToken', () => this._refreshPanel());
    this._hookTarget  = Hooks.on('targetToken',  () => this._refreshPanel());
    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    this._bindGrabListHandlers();

    html.on('click', '[data-action]', async e => {
      const action = e.currentTarget.dataset.action;
      if (action === 'close-window')  { this.close(); return; }
      if (action === 'attempt-grab')  { await runGrab(this._grabberToken, this._targetToken); return; }
      if (action === 'apply-grab')    { await runGrab(this._grabberToken, this._targetToken, { forceApply: true }); return; }
    });
  }

  async close(options) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const toggleGrabPanel = () => {
  const existing = getWindowById('grab-panel');
  if (existing) existing.close();
  else new GrabPanel().render(true);
};