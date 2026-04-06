import { runForcedMovement } from './forced-movement.js';
import { runGrab, buildFreeStrikeButton } from './grab.js';
import { canForcedMoveTarget, getItemRange, getItemDsid, getSetting, parsePowerRollState, applyRollMod } from './helpers.js';

const getForcedEffects = (item, tier) => {
  const effectsCollection = item.system?.power?.effects;
  const effects = effectsCollection?.contents ?? Object.values(effectsCollection ?? {});
  const results = [];
  for (const effect of effects) {
    if (effect.type !== 'forced') continue;
    const tierData = effect.forced?.[`tier${tier}`];
    if (!tierData) continue;
    const distance = parseInt(tierData.distance);
    if (isNaN(distance) || distance <= 0) continue;
    const propertiesRaw = tierData.properties;
    const properties = Array.isArray(propertiesRaw) ? propertiesRaw
                     : propertiesRaw instanceof Set  ? [...propertiesRaw]
                     : (propertiesRaw?.contents ?? Object.values(propertiesRaw ?? {}));
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
  const effects = effectsCollection?.contents ?? Object.values(effectsCollection ?? {});
  for (const effect of effects) {
    const tierData = effect[effect.type]?.[`tier${tier}`] ?? effect[`tier${tier}`];
    if (!tierData) continue;
    const conditions = tierData.conditions ?? tierData.statuses ?? tierData.status ?? [];
    const arr = Array.isArray(conditions) ? conditions
              : conditions instanceof Set ? [...conditions]
              : Object.values(conditions ?? {});
    if (arr.some(c => String(c?.id ?? c?.name ?? c).toLowerCase() === 'grabbed')) return true;
  }
  return false;
};

const injectForcedButtons = (msg, el) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'forcedMovement');
  if (!data) return;
  if (el.querySelector('.dsct-forced-buttons')) return;

  const footer  = el.querySelector('.message-part-buttons');
  const content = el.querySelector('.message-content');
  const target  = footer ?? content ?? el;
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
      const api = game.modules.get('draw-steel-combat-tools')?.api;
      if (!api) { ui.notifications.error('Draw Steel: Combat Tools not active.'); return; }

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
      const kwArray        = data.keywords instanceof Set ? [...data.keywords] : (Array.isArray(data.keywords) ? data.keywords : []);
      const kw             = kwArray.join(',');
      await api.forcedMovement([type, String(effect.distance), '0', '0', verticalHeight, '0', 'false', String(effect.ignoreStability), 'false', kw, String(data.range ?? 0)]);
    });
    container.appendChild(btn);
  }

  target.appendChild(container);
};

const injectGrabButton = (msg, el) => {
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

      const api = game.modules.get('draw-steel-combat-tools')?.api;
      if (!api) { ui.notifications.error('Draw Steel: Combat Tools not active.'); return; }

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
            grabbed = canvas.tokens.get(tokenId) || canvas.tokens.placeables.find(t => t.id === tokenId);
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

const injectGrabResolutions = (msg, el) => {
  
  const grabActions = el.querySelector('.dsct-tier2-grab-actions');
  if (grabActions && !grabActions.dataset.bound) {
    grabActions.dataset.bound = "true";
    const confirmBtn = grabActions.querySelector('[data-action="dsct-confirm-grab"]');
    const cancelBtn = grabActions.querySelector('[data-action="dsct-cancel-grab"]');
    
    confirmBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const api = game.modules.get('draw-steel-combat-tools')?.api;
        const grabber = canvas.tokens.get(grabActions.dataset.grabberId) || canvas.tokens.placeables.find(t=>t.id===grabActions.dataset.grabberId);
        const target = canvas.tokens.get(grabActions.dataset.targetId) || canvas.tokens.placeables.find(t=>t.id===grabActions.dataset.targetId);
        if (grabber && target) await api?.grab(grabber, target, { forceApply: true });
        
        
        const newContent = msg.content.replace(/<div[^>]*class="dsct-tier2-grab-actions"[^>]*>.*?<\/div>/s, '<div style="margin-top:6px;"><em>Grab Confirmed</em></div>');
        if (msg.isOwner || game.user.isGM) await msg.update({ content: newContent });
        else grabActions.innerHTML = '<em>Grab Confirmed</em>';
        
        const panel = Object.values(ui.windows).find(w => w.id === 'grab-panel');
        if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
    });
    
    cancelBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const newContent = msg.content.replace(/<div[^>]*class="dsct-tier2-grab-actions"[^>]*>.*?<\/div>/s, '<div style="margin-top:6px;"><em>Grab Cancelled</em></div>');
        if (msg.isOwner || game.user.isGM) await msg.update({ content: newContent });
        else grabActions.innerHTML = '<em>Grab Cancelled</em>';
        
        const panel = Object.values(ui.windows).find(w => w.id === 'grab-panel');
        if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
    });
  }

  
  const escapeData = msg.getFlag('draw-steel-combat-tools', 'escapeGrab');
  if (escapeData && escapeData.tier === 2) {
    if (el.querySelector('.dsct-escape-actions')) return; 
    
    const targetArea = el.querySelector('.message-part-buttons') || el.querySelector('.message-content') || el;
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

    const grabberTok = canvas.tokens.get(grab.grabberTokenId) || canvas.tokens.placeables.find(t=>t.id===grab.grabberTokenId);
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
        const api = game.modules.get('draw-steel-combat-tools')?.api;
        await api?.endGrab(escapeData.speakerToken, { silent: true });
        ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} escapes after taking a free strike.` });
        
        
        if (msg.isOwner || game.user.isGM) await msg.setFlag('draw-steel-combat-tools', 'escapeResolved', 'accepted');
        else container.innerHTML = '<em>Escape Accepted</em>';
        
        const panel = Object.values(ui.windows).find(w => w.id === 'grab-panel');
        if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
    });
    
    container.querySelector('.dsct-deny-escape').addEventListener('click', async (e) => {
        e.preventDefault();
        ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} stays grabbed.` });
        
        if (msg.isOwner || game.user.isGM) await msg.setFlag('draw-steel-combat-tools', 'escapeResolved', 'denied');
        else container.innerHTML = '<em>Stayed Grabbed</em>';
        
        const panel = Object.values(ui.windows).find(w => w.id === 'grab-panel');
        if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
    });
    
    targetArea.appendChild(container);
  }
};

const _knockbackNotified    = new Set(); // guards against double-notify race
const _powerRollModInFlight = new Set(); // guards against double-processing power roll mods

// Reads the accumulated bane/edge deltas from flags and applies them once.
// Each system contributing banes/edges writes its own key into 'powerRollDeltas'.
// This ensures multiple conditions never conflict — they all combine into one pass.
const injectAllRollMods = (msg, el) => {
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

    const parts         = msg.system?.parts?.contents ?? Object.values(msg.system?.parts ?? {});
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
          const targetingGrabber = targets.some(t => t.actor?.id === grab.grabberActorId || t.id === grab.grabberTokenId);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Grabbed bane check msg=${msg.id} targetingGrabber=${targetingGrabber} targets=${targets.length}`);
          if (!targetingGrabber) pendingDeltas.grabbed = 1;
        }
      }

      // Future conditions add their own keys here, e.g.: pendingDeltas.frightened = 1;

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

    if (!msg.getFlag('draw-steel-combat-tools', 'grab')) {
      if (hasGrabEffect(item, tier)) {
        await msg.setFlag('draw-steel-combat-tools', 'grab', {
          speakerToken: msg.speaker?.token ?? null,
          tier,
          dsid,
        });
      }
    }

    
    if (!msg.getFlag('draw-steel-combat-tools', 'escapeGrab')) {
      if (dsid === 'escape-grab' || item.name.toLowerCase().includes('escape grab')) {
        const grabbedTokenId = msg.speaker?.token;
        if (grabbedTokenId && window._activeGrabs?.has(grabbedTokenId)) {
          await msg.setFlag('draw-steel-combat-tools', 'escapeGrab', {
            speakerToken: grabbedTokenId,
            tier
          });

          
          const grab = window._activeGrabs.get(grabbedTokenId);
          if (tier >= 3) {
            const api = game.modules.get('draw-steel-combat-tools')?.api;
            if (api) {
               await api.endGrab(grabbedTokenId, { silent: true });
               ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} breaks free from ${grab.grabberName}!` });
            }
          } else if (tier === 1) {
            ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} fails to escape.` });
          } else if (tier === 2) {
             
             const panel = Object.values(ui.windows).find(w => w.id === 'grab-panel');
             if (panel) {
                 panel._pendingEscape = { grabbedTokenId };
                 panel._refreshPanel();
             }
          }
        }
      }
    }

  };

  const tryInject = (msg) => {
    setTimeout(() => {
      const liveEl = document.querySelector(`[data-message-id="${msg.id}"]`);
      if (!liveEl) return;
      if (msg.getFlag('draw-steel-combat-tools', 'knockbackBlocked')) {
        for (const child of [...liveEl.children]) {
          if (!child.matches('.message-header')) child.remove();
        }
        const div = document.createElement('div');
        div.className = 'message-content';
        div.innerHTML = '<p><em>A grabbed creature cannot use the Knockback maneuver.</em></p>';
        liveEl.appendChild(div);
        return;
      }
      injectAllRollMods(msg, liveEl);
      injectForcedButtons(msg, liveEl);
      injectGrabButton(msg, liveEl);
      injectGrabResolutions(msg, liveEl);
    }, getSetting('chatInjectDelay'));
  };

  Hooks.on('createChatMessage',     (msg)      => trySetFlag(msg));
  Hooks.on('updateChatMessage',     (msg)      => { trySetFlag(msg); tryInject(msg); });
  Hooks.on('renderChatMessageHTML', (msg, el)  => trySetFlag(msg, el).then(() => tryInject(msg)));
}

export function refreshChatInjections() {
  ui.chat.render(true);
}