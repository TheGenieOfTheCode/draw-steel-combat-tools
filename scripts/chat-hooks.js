import { runForcedMovement } from './forced-movement.js';
import { runGrab, buildFreeStrikeButton } from './grab.js';
import { canForcedMoveTarget, getItemRange, getItemDsid, getSetting, parsePowerRollState, applyRollMod, registerInjector, scheduleInject, getTokenById, getWindowById, getModuleApi, normalizeCollection } from './helpers.js';
import { applyFrightened, applyTaunted, getFrightenedData, getTauntedData, sightBlockedBetween } from './conditions.js';

const getForcedEffects = (item, tier) => {
  const effectsCollection = item.system?.power?.effects;
  const effects = normalizeCollection(effectsCollection);
  const results = [];
  for (const effect of effects) {
    if (effect.type !== 'forced') continue;
    const tierData = effect.forced?.[`tier${tier}`];
    if (!tierData) continue;
    const distance = parseInt(tierData.distance);
    if (isNaN(distance) || distance <= 0) continue;
    const propertiesRaw = tierData.properties;
    const properties = normalizeCollection(propertiesRaw);
    const vertical        = properties.includes('vertical');
    const ignoreStability = properties.includes('ignoresImmunity');
    for (const movement of (tierData.movement ?? [])) {
      results.push({ movement, distance, vertical, ignoreStability, name: effect.name ?? movement });
    }
  }
  return results;
};

const hasGrabEffect = (item, tier) => {
  const dsid = item.system?._dsid ?? item.toObject().system?._dsid;
  if (dsid === 'grab') return tier >= 2;

  const effectsCollection = item.system?.power?.effects;
  const effects = normalizeCollection(effectsCollection);
  for (const effect of effects) {
    const tierData = effect[effect.type]?.[`tier${tier}`] ?? effect[`tier${tier}`];
    if (!tierData) continue;
    const conditions = tierData.conditions ?? tierData.statuses ?? tierData.status ?? [];
    const arr = normalizeCollection(conditions);
    if (arr.some(c => String(c?.id ?? c?.name ?? c).toLowerCase() === 'grabbed')) return true;
  }
  return false;
};

const injectForcedButtons = (msg, { el, buttons, content }) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'forcedMovement');
  if (!data) return;
  if (el.querySelector('.dsct-forced-buttons')) return;

  const target = buttons ?? content ?? el;
  if (!target) return;

  const container = document.createElement('div');
  container.className = 'dsct-forced-buttons';
  container.style.cssText = 'display:contents;';

  for (const effect of data.effects) {
    const label = [
      effect.vertical ? 'Vertical' : '',
      `${effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1)} ${effect.distance}`,
    ].filter(Boolean).join(' ');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${label}`;
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', async () => {
      const api = getModuleApi();
      if (!api) return;

      const targets    = [...game.user.targets];
      const controlled = canvas.tokens.controlled;
      const target     = targets.length === 1 ? targets[0] : null;
      const source     = targets.length === 1 && controlled.length === 1 ? controlled[0] : null;

      if (!(game.user.isGM && getSetting('gmBypassesSizeCheck')) && (data.dsid === 'knockback' || data.dsid === 'grab')) {
        if (source && target && !canForcedMoveTarget(source.actor, target.actor)) {
          ui.notifications.warn(`${source.name} cannot force-move ${target.name} (size too large for their Might and size).`);
          return;
        }
      }

      const type           = effect.movement.charAt(0).toUpperCase() + effect.movement.slice(1);
      const verticalHeight = effect.vertical ? String(effect.distance) : '';
      const kwArray        = normalizeCollection(data.keywords);
      const kw             = kwArray.join(',');
      await api.forcedMovement([type, String(effect.distance), '0', '0', verticalHeight, '0', 'false', String(effect.ignoreStability), 'false', kw, String(data.range ?? 0)]);
    });
    container.appendChild(btn);
  }

  target.appendChild(container);
};

const injectGrabButton = (msg, { el }) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'grab');
  if (!data) return;

  const nativeBtns = el.querySelectorAll('button[data-action="applyEffect"][data-effect-id="grabbed"]');
  if (!nativeBtns.length) return;

  for (const btn of nativeBtns) {
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = btn.className ? `${btn.className} dsct-grab-btn` : 'dsct-grab-btn';
    newBtn.innerHTML = '<i class="fa-solid fa-hand-rock"></i> Execute Grab';
    newBtn.style.cssText = 'cursor:pointer;';

    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const api = getModuleApi();
      if (!api) return;

      const targets    = [...game.user.targets];
      const controlled = canvas.tokens.controlled;
      
      const speakerTok = data.speakerToken ? canvas?.tokens?.get(data.speakerToken) : null;
      const grabber = controlled.length === 1 ? controlled[0] : speakerTok;
      
      let grabbed = targets.length === 1 ? targets[0] : null;

      
      if (!grabbed) {
        const targetHeaders = el.querySelectorAll('.dice-roll .header[data-uuid]');
        if (targetHeaders.length === 1) {
          const uuid = targetHeaders[0].dataset.uuid;
          const parts = uuid.split('.');
          const tokenIdx = parts.indexOf('Token');
          
          if (tokenIdx !== -1) {
            const tokenId = parts[tokenIdx + 1];
            grabbed = getTokenById(tokenId);
          } else {
            const actorIdx = parts.indexOf('Actor');
            const actorId = actorIdx !== -1 ? parts[actorIdx + 1] : parts[parts.length - 1];
            grabbed = canvas.tokens.placeables.find(t => t.actor?.id === actorId);
          }
        }
      }

      if (!grabber) { ui.notifications.warn('Control the grabber token or ensure the ability speaker token is on the canvas.'); return; }
      if (!grabbed) { ui.notifications.warn('Target the creature to be grabbed.'); return; }

      await api.grab(grabber, grabbed, { tier: data.tier });
    });

    btn.replaceWith(newBtn);
  }
};

const injectGrabResolutions = (msg, { el, buttons, content }) => {
  const grabActions = el.querySelector('.dsct-tier2-grab-actions');
  if (grabActions && !grabActions.dataset.bound) {
    grabActions.dataset.bound = "true";
    const confirmBtn = grabActions.querySelector('[data-action="dsct-confirm-grab"]');
    const cancelBtn = grabActions.querySelector('[data-action="dsct-cancel-grab"]');
    
    confirmBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const api = getModuleApi(false);
        const grabber = getTokenById(grabActions.dataset.grabberId);
        const target  = getTokenById(grabActions.dataset.targetId);
        if (grabber && target) await api?.grab(grabber, target, { forceApply: true });
        await resolveGrabConfirmChatMessage(msg.id, 'confirmed');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
    });

    cancelBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await resolveGrabConfirmChatMessage(msg.id, 'cancelled');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
    });
  }

  
  const escapeData = msg.getFlag('draw-steel-combat-tools', 'escapeGrab');
  if (escapeData && escapeData.tier === 2) {
    if (el.querySelector('.dsct-escape-actions')) return; 
    
    const targetArea = buttons ?? content ?? el;
    const resolvedState = msg.getFlag('draw-steel-combat-tools', 'escapeResolved');

    const container = document.createElement('div');
    container.className = 'dsct-escape-actions';

    
    if (resolvedState) {
      container.innerHTML = `<div style="margin-top:8px; font-size: 13px; border-top: 1px solid var(--color-border-light-primary); padding-top: 8px;"><em>${resolvedState === 'accepted' ? 'Escape Accepted' : 'Stayed Grabbed'}</em></div>`;
      targetArea.appendChild(container);
      return;
    }

    const grab = window._activeGrabs?.get(escapeData.speakerToken);
    if (!grab) return;

    const grabberTok = getTokenById(grab.grabberTokenId);
    const fsHtml = grabberTok ? buildFreeStrikeButton(grabberTok.actor) : '';
    
    container.innerHTML = `
      <div style="margin-top:8px; font-size: 13px; border-top: 1px solid var(--color-border-light-primary); padding-top: 8px;">
          <strong>${grab.grabberName}</strong> may make a free strike:<br>
          <div style="margin: 4px 0;">${fsHtml}</div>
          <div style="display:flex;gap:4px;margin-top:4px;">
            <button type="button" class="apply-effect dsct-accept-escape" style="cursor:pointer;flex:1;"><i class="fa-solid fa-check"></i> Accept Escape</button>
            <button type="button" class="apply-effect dsct-deny-escape" style="cursor:pointer;flex:1;border-color:var(--color-text-error);color:var(--color-text-error);"><i class="fa-solid fa-times"></i> Stay Grabbed</button>
          </div>
      </div>
    `;
    
    container.querySelector('.dsct-accept-escape').addEventListener('click', async (e) => {
        e.preventDefault();
        const api = getModuleApi(false);
        await triggerGrabberFreeStrike(grabberTok, grab);
        await api?.endGrab(escapeData.speakerToken, { silent: true });
        await resolveEscapeChatMessage(escapeData.speakerToken, 'accepted');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
    });

    container.querySelector('.dsct-deny-escape').addEventListener('click', async (e) => {
        e.preventDefault();
        ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} stays grabbed.` });
        await resolveEscapeChatMessage(escapeData.speakerToken, 'denied');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
    });
    
    targetArea.appendChild(container);
  }
};

/**
 * Trigger the grabber's Melee Free Strike — routes to their controlling player if online,
 * falls back to GM. Call this from both the chat button and the grab panel button.
 * @param {Token} grabberTok
 * @param {object} grab  - entry from window._activeGrabs
 */
export const triggerGrabberFreeStrike = async (grabberTok, grab) => {
  const api = getModuleApi(false);
  const freeStrikeItem = grabberTok?.actor?.items.find(i => i.name.toLowerCase().includes('melee free strike'));
  if (freeStrikeItem) {
    const socket = api?.socket;
    const controllingUser = game.users.find(u =>
      u.active && !u.isGM &&
      (u.character?.id === grabberTok.actor.id ||
       (grabberTok.actor.ownership[u.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    );
    if (controllingUser && controllingUser.id !== game.user.id && socket) {
      await socket.executeAsUser('rollFreeStrike', controllingUser.id, freeStrikeItem.uuid);
    } else {
      await ds.helpers.macros.rollItemMacro(freeStrikeItem.uuid);
    }
  } else {
    ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} escapes after taking a free strike from ${grab.grabberName}.` });
  }
};

/**
 * Resolve an escape grab chat message — sets the escapeResolved flag so the chat UI updates.
 * @param {string} grabbedTokenId
 * @param {'accepted'|'denied'} resolution
 */
export const resolveEscapeChatMessage = async (grabbedTokenId, resolution) => {
  const msg = game.messages.contents.findLast(m =>
    m.getFlag('draw-steel-combat-tools', 'escapeGrab')?.speakerToken === grabbedTokenId &&
    !m.getFlag('draw-steel-combat-tools', 'escapeResolved')
  );
  if (msg && (msg.isOwner || game.user.isGM)) {
    await msg.setFlag('draw-steel-combat-tools', 'escapeResolved', resolution);
  }
};

/**
 * Resolve a tier-2 grab confirm chat message — updates the content in place.
 * @param {string} msgId
 * @param {'confirmed'|'cancelled'} resolution
 */
export const resolveGrabConfirmChatMessage = async (msgId, resolution) => {
  if (!msgId) return;
  const msg = game.messages.get(msgId);
  if (!msg || !(msg.isOwner || game.user.isGM)) return;
  const label = resolution === 'confirmed' ? 'Grab Confirmed' : 'Grab Cancelled';
  const newContent = msg.content.replace(/<div[^>]*class="dsct-tier2-grab-actions"[^>]*>.*?<\/div>/s, `<div style="margin-top:6px;"><em>${label}</em></div>`);
  await msg.update({ content: newContent });
};

const _knockbackNotified    = new Set(); // guards against double-notify race
const _escapeGrabInFlight   = new Set(); // guards against double-trigger escape race
const _grabFlagInFlight     = new Set(); // guards against double-trigger grab race
const _bleedingInFlight     = new Set(); // guards against double-trigger bleeding race
const _recentlyCreated      = new Set(); // messages created this session within the last few seconds
const _powerRollModInFlight = new Set(); // guards against double-processing power roll mods

// Returns the action type string from the rendered ability embed ("Main Action", "Triggered Action", etc.)
const getActionType = (el) => {
  return el.querySelector('document-embed dd.type')?.textContent?.trim() ?? '';
};

// Returns the characteristics used by the ability roll ("Might", "Agility", etc.)
// Also checks the test flavor text for standalone Might/Agility tests.
const getRollCharacteristics = (el) => {
  const rollLine  = el.querySelector('document-embed .powerResult strong')?.textContent ?? '';
  const flavorTxt = el.querySelector('.message-part-flavor')?.textContent?.trim() ?? '';
  return (rollLine + ' ' + flavorTxt).toLowerCase();
};

// Checks whether a set of targets includes a specific actor/token ID pair
const targetsInclude = (targets, actorId, tokenId) =>
  targets.some(t => (actorId && t.actor?.id === actorId) || (tokenId && t.id === tokenId));

// Reads the accumulated bane/edge deltas from flags and applies them once.
// Each system contributing banes/edges writes its own key into 'powerRollDeltas'.
// This ensures multiple conditions never conflict — they all combine into one pass.
const injectAllRollMods = (msg, { el }) => {
  const base   = msg.getFlag('draw-steel-combat-tools', 'powerRollBase');
  const deltas = msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas');
  if (!base?.originalTotal || !deltas) return;

  const totalDelta = Object.values(deltas).reduce((sum, d) => sum + d, 0);
  if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | msg=${msg.id} deltas=${JSON.stringify(deltas)} totalDelta=${totalDelta} originalNet=${base.originalNet} → finalNet=${Math.max(-2, Math.min(2, base.originalNet + totalDelta))} isCritical=${base.isCritical}`);
  applyRollMod(el, base, totalDelta);
};

export function registerChatHooks() {
  const trySetFlag = async (msg, el = null) => {
    if (msg.author.id !== game.user.id) return;

    // Bleeding: runs for all message types (including tests) — must be before the ability-parts guard
    if (el && getSetting('bleedingEnabled') && _recentlyCreated.has(msg.id) && !msg.getFlag('draw-steel-combat-tools', 'bleedingTriggered') && !_bleedingInFlight.has(msg.id)) {
      const speakerTokenId = msg.speaker?.token;
      const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
      if (speakerTok?.actor?.statuses?.has('bleeding')) {
        const actionType = getActionType(el).toLowerCase();
        const rollChars  = getRollCharacteristics(el);
        const triggers   = actionType.includes('main action') || actionType.includes('triggered action')
                        || rollChars.includes('might') || rollChars.includes('agility');
        if (triggers) {
          _bleedingInFlight.add(msg.id);
          await msg.setFlag('draw-steel-combat-tools', 'bleedingTriggered', {
            tokenId: speakerTokenId,
            actorUuid: speakerTok.actor.uuid,
            mode: getSetting('bleedingMode'),
          });
          _bleedingInFlight.delete(msg.id);
          if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Flagged msg ${msg.id} for ${speakerTok.name}`);
        }
      }
    }

    const parts         = normalizeCollection(msg.system?.parts);
    const abilityUse    = parts.find(p => p.type === 'abilityUse');
    const abilityResult = parts.find(p => p.type === 'abilityResult');
    if (!abilityUse?.abilityUuid || !abilityResult?.tier) return;

    const item = await fromUuid(abilityUse.abilityUuid);
    if (!item) return;

    const dsid = getItemDsid(item);
    const tier = abilityResult.tier;

    // Power roll mods: requires the live rendered element — dice roll HTML is client-side only.
    // Each condition writes its own key into 'powerRollDeltas'; all are applied together at inject time.
    if (el && !_powerRollModInFlight.has(msg.id)) {
      const existingBase   = msg.getFlag('draw-steel-combat-tools', 'powerRollBase');
      const existingDeltas = msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas') ?? {};
      const pendingDeltas  = { ...existingDeltas };
      let baseState = existingBase ?? null;

      // Grabbed bane
      if (getSetting('grabbedBaneEnabled') && !('grabbed' in existingDeltas)) {
        const speakerTokenId = msg.speaker?.token;
        const grab = speakerTokenId ? window._activeGrabs?.get(speakerTokenId) : null;
        if (grab) {
          const targets = [...game.user.targets];
          const targetingGrabber = targetsInclude(targets, grab.grabberActorId, grab.grabberTokenId);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Grabbed bane check msg=${msg.id} targetingGrabber=${targetingGrabber} targets=${targets.length}`);
          if (!targetingGrabber) pendingDeltas.grabbed = 1;
        }
      }

      // Frightened bane — bane on rolls against non-source targets
      if (getSetting('frightenedEnabled') && !('frightened' in existingDeltas)) {
        const speakerTokenId = msg.speaker?.token;
        const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
        const fd = speakerTok ? getFrightenedData(speakerTok.actor) : null;
        if (fd) {
          const targets = [...game.user.targets];
          const targetingSource = targetsInclude(targets, fd.sourceActorId, fd.sourceTokenId);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Frightened bane check msg=${msg.id} targetingSource=${targetingSource}`);
          if (!targetingSource) pendingDeltas.frightened = 1;
        }
      }

      // Taunted double-bane — on rolls that don't target the taunting creature (if LoE exists)
      if (getSetting('tauntedEnabled') && !('taunted' in existingDeltas)) {
        const speakerTokenId = msg.speaker?.token;
        const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
        const td = speakerTok ? getTauntedData(speakerTok.actor) : null;
        if (td) {
          const targets = [...game.user.targets];
          const targetingSource = targetsInclude(targets, td.sourceActorId, td.sourceTokenId);
          if (!targetingSource) {
            // Only apply if speaker has LoE to the taunt source (sight-unblocked)
            const sourceTok = getTokenById(td.sourceTokenId);
            const hasLoE = sourceTok ? !sightBlockedBetween(speakerTok, sourceTok) : false;
            if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Taunted check msg=${msg.id} targetingSource=${targetingSource} hasLoE=${hasLoE}`);
            if (hasLoE) pendingDeltas.taunted = 2; // double bane
          }
        }
      }

      const hasNewDeltas = Object.keys(pendingDeltas).some(k => !(k in existingDeltas));
      if (hasNewDeltas) {
        if (!baseState) {
          baseState = parsePowerRollState(el);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Captured base state for msg=${msg.id}:`, baseState);
        }
        if (baseState) {
          _powerRollModInFlight.add(msg.id);
          if (!existingBase) await msg.setFlag('draw-steel-combat-tools', 'powerRollBase', baseState);
          await msg.setFlag('draw-steel-combat-tools', 'powerRollDeltas', pendingDeltas);
          _powerRollModInFlight.delete(msg.id);
        }
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'knockbackBlocked') && !_knockbackNotified.has(msg.id) && dsid === 'knockback') {
      const speakerTokenId = msg.speaker?.token;
      if (speakerTokenId && window._activeGrabs?.has(speakerTokenId)) {
        _knockbackNotified.add(msg.id);
        await msg.setFlag('draw-steel-combat-tools', 'knockbackBlocked', true);
        ui.notifications.warn('A grabbed creature cannot use the Knockback maneuver.');
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'forcedMovement')) {
      const forced = getForcedEffects(item, tier);
      if (forced.length) {
        const range = getItemRange(item);
        await msg.setFlag('draw-steel-combat-tools', 'forcedMovement', {
          effects:      forced,
          keywords:     Array.from(item.system?.keywords ?? []),
          range,
          dsid,
          speakerToken: msg.speaker?.token ?? null,
        });
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'grab') && !_grabFlagInFlight.has(msg.id)) {
      if (hasGrabEffect(item, tier)) {
        _grabFlagInFlight.add(msg.id);
        await msg.setFlag('draw-steel-combat-tools', 'grab', {
          speakerToken: msg.speaker?.token ?? null,
          tier,
          dsid,
        });
        _grabFlagInFlight.delete(msg.id);
      }
    }

    
    if (!msg.getFlag('draw-steel-combat-tools', 'escapeGrab') && !_escapeGrabInFlight.has(msg.id)) {
      if (dsid === 'escape-grab' || item.name.toLowerCase().includes('escape grab')) {
        const grabbedTokenId = msg.speaker?.token;
        if (grabbedTokenId && window._activeGrabs?.has(grabbedTokenId)) {
          _escapeGrabInFlight.add(msg.id);
          await msg.setFlag('draw-steel-combat-tools', 'escapeGrab', {
            speakerToken: grabbedTokenId,
            tier
          });

          
          const grab = window._activeGrabs.get(grabbedTokenId);
          if (tier >= 3) {
            const api = getModuleApi(false);
            if (api) {
               await api.endGrab(grabbedTokenId, { silent: true });
               ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} breaks free from ${grab.grabberName}!` });
            }
          } else if (tier === 1) {
            ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} fails to escape.` });
          } else if (tier === 2) {
             const panel = getWindowById('grab-panel');
             if (panel) {
                 panel._pendingEscape = { grabbedTokenId };
                 panel._refreshPanel();
             }
          }
          _escapeGrabInFlight.delete(msg.id);
        }
      }
    }

    // Frightened: speaker is the source of fear — targets of this ability get an edge injected
    if (el && getSetting('frightenedEnabled') && !('frightenedSource' in (msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas') ?? {})) && !_powerRollModInFlight.has(msg.id)) {
      const speakerTokenId = msg.speaker?.token;
      const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
      if (speakerTok) {
        const targets = [...game.user.targets];
        for (const t of targets) {
          const fd = getFrightenedData(t.actor);
          if (fd && (fd.sourceActorId === speakerTok.actor?.id || fd.sourceTokenId === speakerTokenId)) {
            // This target is frightened of the speaker — speaker gets edge
            const existingDeltas = msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas') ?? {};
            if (!('frightenedSource' in existingDeltas)) {
              const existingBase = msg.getFlag('draw-steel-combat-tools', 'powerRollBase');
              const baseState = existingBase ?? parsePowerRollState(el);
              if (baseState) {
                _powerRollModInFlight.add(msg.id);
                if (!existingBase) await msg.setFlag('draw-steel-combat-tools', 'powerRollBase', baseState);
                await msg.setFlag('draw-steel-combat-tools', 'powerRollDeltas', { ...existingDeltas, frightenedSource: -1 });
                _powerRollModInFlight.delete(msg.id);
              }
            }
            break;
          }
        }
      }
    }

  };

  // Injectors run in order; returning true stops the chain (used for full replacements)
  registerInjector(function injectKnockbackBlock(msg, { el }) {
    if (!msg.getFlag('draw-steel-combat-tools', 'knockbackBlocked')) return;
    for (const child of [...el.children]) {
      if (!child.matches('.message-header')) child.remove();
    }
    const div = document.createElement('div');
    div.className = 'message-content';
    div.innerHTML = '<p><em>A grabbed creature cannot use the Knockback maneuver.</em></p>';
    el.appendChild(div);
    return true; // stop further injectors — message content replaced
  });
  registerInjector(injectAllRollMods);
  registerInjector(injectForcedButtons);
  registerInjector(injectGrabButton);
  registerInjector(injectGrabResolutions);

  // Replace native frightened/taunted "Apply Effect" buttons with our versioned ones
  registerInjector(function injectConditionButtons(msg, { el }) {
    if (!getSetting('frightenedEnabled') && !getSetting('tauntedEnabled')) return;

    const speakerTokenId = msg.speaker?.token;
    const speakerTok     = speakerTokenId ? getTokenById(speakerTokenId) : null;
    if (!speakerTok?.actor) return;

    for (const conditionId of ['frightened', 'taunted']) {
      if (!getSetting(conditionId === 'frightened' ? 'frightenedEnabled' : 'tauntedEnabled')) continue;
      const nativeBtns = el.querySelectorAll(`button[data-action="applyEffect"][data-effect-id="${conditionId}"]`);
      for (const btn of nativeBtns) {
        if (btn.dataset.dsctReplaced) continue;
        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = btn.className || '';
        newBtn.dataset.dsctReplaced = 'true';
        newBtn.innerHTML = `<i class="fa-solid fa-skull"></i> Apply ${conditionId.charAt(0).toUpperCase() + conditionId.slice(1)} (DSCT)`;
        newBtn.style.cssText = 'cursor:pointer;';
        newBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targets = [...game.user.targets];
          if (!targets.length) { ui.notifications.warn('Target one or more tokens to apply the condition.'); return; }
          const sourceActor   = speakerTok.actor;
          const sourceTokenId = speakerTok.id;
          for (const t of targets) {
            if (conditionId === 'frightened') await applyFrightened(t, sourceActor, sourceTokenId);
            else                              await applyTaunted(t, sourceActor, sourceTokenId);
          }
        });
        btn.replaceWith(newBtn);
      }
    }
  });

  // Bleeding injector: posts damage roll or applies it automatically
  registerInjector(function injectBleedingDamage(msg, { el, buttons, content }) {
    const data = msg.getFlag('draw-steel-combat-tools', 'bleedingTriggered');
    if (!data) return;
    if (el.querySelector('.dsct-bleeding-roll')) return;

    const target = buttons ?? content ?? el;
    const div = document.createElement('div');
    div.className = 'dsct-bleeding-roll';
    div.style.cssText = 'margin-top:6px;border-top:1px solid var(--color-border-light-primary);padding-top:6px;font-size:13px;';

    if (data.mode === 'auto') {
      // Check if already applied
      const applied = msg.getFlag('draw-steel-combat-tools', 'bleedingApplied');
      if (applied) {
        div.innerHTML = `<em><i class="fa-solid fa-droplet"></i> Bleeding damage applied.</em>`;
      } else {
        // Auto-apply on first render — post the roll as its own message with the undo button injected there
        (async () => {
          const actor = await fromUuid(data.actorUuid);
          if (!actor) return;
          const roll = await new Roll('1d6 + 1').evaluate();
          const dmg  = roll.total;
          const prevValue = actor.system.stamina.value;
          const prevTemp  = actor.system.stamina.temporary;
          const rollMsg = await roll.toMessage({
            flavor: `<strong>Bleeding</strong> — ${actor.name} loses stamina`,
            speaker: ChatMessage.getSpeaker({ token: getTokenById(data.tokenId)?.document }),
            flags: { 'draw-steel-combat-tools': { bleedingRoll: {
              actorUuid: data.actorUuid, dmg, prevValue, prevTemp, sourceMsgId: msg.id,
            }}},
          });
          await actor.system.takeDamage(dmg, { type: 'untyped', ignoredImmunities: [] });
          await msg.setFlag('draw-steel-combat-tools', 'bleedingApplied', { dmg, rollMsgId: rollMsg?.id });
          if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Auto-applied ${dmg} damage to ${actor.name}`);
        })();
        div.innerHTML = `<em>Bleeding: applying damage…</em>`;
      }
    } else {
      // Manual mode — post a roll button
      if (el.querySelector('.dsct-bleed-roll-btn')) return;
      div.innerHTML = `<button type="button" class="dsct-bleed-roll-btn" style="cursor:pointer;"><i class="fa-solid fa-droplet"></i> Roll Bleeding Damage (1d6+1)</button>`;
      div.querySelector('.dsct-bleed-roll-btn')?.addEventListener('click', async () => {
        const roll = await new Roll('1d6 + 1').evaluate();
        roll.toMessage({ flavor: `Bleeding damage — apply manually`, speaker: { token: data.tokenId } });
      });
    }
    target.appendChild(div);
  });

  // Undo button lives on the bleeding roll message itself
  registerInjector(function injectBleedingUndo(msg, { el, buttons, content }) {
    const rollData = msg.getFlag('draw-steel-combat-tools', 'bleedingRoll');
    if (!rollData) return;
    if (el.querySelector('.dsct-bleed-undo')) return;

    const target = buttons ?? content ?? el;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-bleed-undo';
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Undo Bleeding';
    btn.style.cssText = 'cursor:pointer;margin-top:4px;';
    btn.addEventListener('click', async () => {
      const actor = await fromUuid(rollData.actorUuid);
      if (actor) {
        await actor.update({ 'system.stamina.temporary': rollData.prevTemp, 'system.stamina.value': rollData.prevValue });
        if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Undid ${rollData.dmg} damage on ${actor.name}`);
      }
      // Clear the source ability message flags so bleeding can't re-trigger
      const sourceMsg = game.messages.get(rollData.sourceMsgId);
      if (sourceMsg && (sourceMsg.isOwner || game.user.isGM)) {
        await sourceMsg.unsetFlag('draw-steel-combat-tools', 'bleedingTriggered');
        await sourceMsg.unsetFlag('draw-steel-combat-tools', 'bleedingApplied');
      }
      // Delete this roll message
      if (msg.isOwner || game.user.isGM) await msg.delete();
    });
    target.appendChild(btn);
  });

  Hooks.on('createChatMessage',     (msg)     => {
    // Mark as freshly created so bleeding can trigger — cleared after 5s to prevent retroactive tagging
    _recentlyCreated.add(msg.id);
    setTimeout(() => _recentlyCreated.delete(msg.id), 5000);
    trySetFlag(msg);
  });
  Hooks.on('updateChatMessage',     (msg)     => { trySetFlag(msg); scheduleInject(msg); });
  Hooks.on('renderChatMessageHTML', (msg, el) => trySetFlag(msg, el).then(() => scheduleInject(msg)));
}

export function refreshChatInjections() {
  ui.chat.render(true);
}