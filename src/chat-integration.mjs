import { applyGrab, buildFreeStrikeButton, sizeRankG } from './conditions/grab.mjs';
import { getItemDsid, getSetting, getTokenById, getWindowById, getModuleApi, normalizeCollection, applyDamage, undoDamage, getSquadGroup, safeDelete } from './helpers.mjs';
import { registerAbilityInjectors } from './ability-automation/ability-automation.mjs';
import { applyFrightened, applyTaunted, getFrightenedData, getTauntedData, sightBlockedBetweenTokens } from './conditions/conditions.mjs';

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
      await socket.executeAsUser('dsct.rollFreeStrike', controllingUser.id, freeStrikeItem.uuid);
    } else {
      await ds.helpers.macros.rollItemMacro(freeStrikeItem.uuid);
    }
  } else {
    ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.escapeAfterFreeStrike', { grabbed: grab.grabbedName, grabber: grab.grabberName }) });
  }
};

export const resolveEscapeChatMessage = async (grabbedTokenId, resolution) => {
  const msg = game.messages.contents.findLast(m =>
    m.getFlag('draw-steel-combat-tools', 'escapeGrab')?.speakerToken === grabbedTokenId &&
    !m.getFlag('draw-steel-combat-tools', 'escapeResolved')
  );
  if (msg && (msg.isOwner || game.user.isGM)) {
    await msg.setFlag('draw-steel-combat-tools', 'escapeResolved', resolution);
  }
};

export const resolveGrabConfirmChatMessage = async (msgId, resolution) => {
  if (!msgId) return;
  const msg = game.messages.get(msgId);
  if (!msg || !(msg.isOwner || game.user.isGM)) return;
  await msg.setFlag('draw-steel-combat-tools', 'grabConfirmResolved', resolution);
};

const _escapeGrabInFlight = new Set();
const _bleedingInFlight   = new Set();
const _recentlyCreated    = new Set();

const getActionType = (el) => {
  return el.querySelector('document-embed dd.type')?.textContent?.trim() ?? '';
};

const getRollCharacteristics = (el) => {
  const rollLine  = el.querySelector('document-embed .powerResult strong')?.textContent ?? '';
  const flavorTxt = el.querySelector('.message-part-flavor')?.textContent?.trim() ?? '';
  return (rollLine + ' ' + flavorTxt).toLowerCase();
};

function _setBaneDialogLock(app, locked, reasons = []) {
  if (!app.element) return;
  if (getSetting('rollDialogPillUI')) {
    const api = getModuleApi(false);
    if (api?.setRollDialogLock) { api.setRollDialogLock(app, locked, reasons); return; }
    
    app.element.classList.toggle('dsct-locked', locked);
    app._dsctBaneLocked       = locked;
    app._dsctBaneLockReasons  = reasons;
    return;
  }
  for (const b of app.element.querySelectorAll('button')) {
    const action = b.dataset.action ?? '';
    if (!action.includes('cancel') && !action.includes('close') && !b.classList.contains('close')) {
      b.disabled = locked;
    }
  }
}

function registerRollDialogHooks() {
  Hooks.on('renderAbilityConfigurationDialog', (app) => {
    if (getSetting('rollDialogPillUI')) return;
    if (app._dsctModifiersApplied) return;

    const ability = app.options.ability;
    if (!ability) return;

    const actor = ability.actor ?? ability.parent;
    if (!actor) return;

    const casterToken = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
                     ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);

    const targetEntries = Object.entries(app.options.context?.targets ?? {});
    const dsid = getItemDsid(ability);

    let banes = 0;
    let edges = 0;

    if (getSetting('grabEnabled') && casterToken) {
      const grab = window._activeGrabs?.get(casterToken.id);
      if (grab) {
        const targetingGrabber = targetEntries.some(([id]) => id === grab.grabberTokenId);
        if (!targetingGrabber) banes += 1;

        if (dsid === 'escape-grab') {
          const grabberTok = getTokenById(grab.grabberTokenId);
          if (grabberTok) {
            const grabbedSize = casterToken.actor?.system?.combat?.size ?? { value: 1, letter: 'M' };
            const grabberSize = grabberTok.actor?.system?.combat?.size  ?? { value: 1, letter: 'M' };
            if (sizeRankG(grabbedSize) < sizeRankG(grabberSize)) banes += 1;
          }
        }
      }
    }

    if (getSetting('frightenedEnabled') && casterToken) {
      const fd = getFrightenedData(actor);
      if (fd) {
        const targetingSource = targetEntries.some(([id]) => id === fd.sourceTokenId);
        if (targetingSource) banes += 1;
      }
    }

    if (getSetting('tauntedEnabled') && casterToken) {
      const td = getTauntedData(actor);
      if (td) {
        const targetingSource = targetEntries.some(([id]) => id === td.sourceTokenId);
        if (!targetingSource) {
          const sourceTok = getTokenById(td.sourceTokenId);
          const hasLoE = sourceTok ? !sightBlockedBetweenTokens(casterToken, sourceTok) : false;
          if (hasLoE) banes += 2;
        }
      }
    }

    if (getSetting('frightenedEnabled') && casterToken) {
      for (const [tokenId] of targetEntries) {
        const targetTok = getTokenById(tokenId);
        if (!targetTok?.actor) continue;
        const fd = getFrightenedData(targetTok.actor);
        if (fd && fd.sourceTokenId === casterToken.id) {
          edges += 1;
          break;
        }
      }
    }

    if (banes === 0 && edges === 0) return;

    app._dsctModifiersApplied = true;
    app.options.context.modifiers.banes = (app.options.context.modifiers.banes ?? 0) + banes;
    app.options.context.modifiers.edges = (app.options.context.modifiers.edges ?? 0) + edges;
    if (getSetting('debugMode')) console.log(`DSCT | Roll Dialog | injecting banes=${banes} edges=${edges} for ${actor.name}`);
    app.render();
  });

  Hooks.on('renderAbilityConfigurationDialog', (app) => {
    if (!getSetting('judgementAutomation')) return;

    const ability = app.options.ability;
    if (!ability) return;
    const actor = ability.actor ?? ability.parent;
    if (!actor) return;

    const casterTokenDoc = actor.token
      ? canvas.tokens.get(actor.token.id)
      : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    const judgeEffect = (casterTokenDoc?.actor ?? actor).effects?.find(e => e.getFlag('draw-steel-combat-tools', 'judgement')?.userId)
                     ?? actor.effects?.find(e => e.getFlag('draw-steel-combat-tools', 'judgement')?.userId);
    if (!judgeEffect) return;

    const judgementFlag  = judgeEffect.getFlag('draw-steel-combat-tools', 'judgement');
    const censorActor = (judgementFlag?.actorId ? game.actors.get(judgementFlag.actorId) : null)
                        ?? game.users.get(judgementFlag?.userId)?.character;

    
    if (censorActor) {
      const casterToken    = casterTokenDoc ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
      const censorToken = canvas.tokens.placeables.find(t => t.actor?.id === censorActor.id);
      if (casterToken && censorToken) {
        const dist = canvas.grid.measurePath([
          { x: casterToken.center.x, y: casterToken.center.y },
          { x: censorToken.center.x, y: censorToken.center.y },
        ]).distance;
        if (dist > 10 * canvas.grid.distance) return;
      }
    }

    
    if (app._dsctBaneLocked) {
      _setBaneDialogLock(app, true, app._dsctBaneLockReasons ?? []);
      return;
    }

    
    if (app._dsctJudgementBaneReminded) return;
    app._dsctJudgementBaneReminded = true;

    const lockEnabled  = getSetting('judgementBaneLock');
    const lockDuration = lockEnabled ? ((getSetting('judgementBaneLockDuration') ?? 10) * 1000) : 0;
    const lockUntil    = lockDuration > 0 ? Date.now() + lockDuration : 0;

    const nameStr     = censorActor ? censorActor.name : 'Someone';
    const lockReasons = [`<strong>Judgement</strong>${nameStr} can impose a bane on this roll.`];
    if (lockDuration > 0) {
      app._dsctBaneLocked = true;
      _setBaneDialogLock(app, true, lockReasons);
    }

    const unlockBtns = () => {
      app._dsctBaneLocked = false;
      _setBaneDialogLock(app, false);
    };

    if (lockDuration > 0) app._dsctBaneLockTimeout = setTimeout(unlockBtns, lockDuration);

    const flagData = lockUntil > 0 ? { judgementBaneLock: { lockUntil } } : {};

    ChatMessage.create({
      content: game.i18n.format('DSCT.chat.tactical.judgementBaneReminder', { name: actor.name }),
      flags: { 'draw-steel-combat-tools': { judgementBaneReminder: { actorId: actor.id, tokenId: actor.token?.id ?? casterTokenDoc?.id ?? null, dialogOwnerUserId: game.user.id }, ...flagData } },
    }).then(msg => {
      if (!msg) return;
      app._dsctJudgementBaneMsgId = msg.id;
      if (lockDuration > 0) {
        const unlockHookId = Hooks.on('updateChatMessage', (m) => {
          if (m.id !== msg.id) return;
          if (!m.getFlag('draw-steel-combat-tools', 'judgementBaneDeclined') && !m.getFlag('draw-steel-combat-tools', 'judgementBaneUsed')) return;
          clearTimeout(app._dsctBaneLockTimeout);
          Hooks.off('updateChatMessage', unlockHookId);
          unlockBtns();
        });
      }
    });
  });

  Hooks.on('closeAbilityConfigurationDialog', async (app) => {
    if (app._dsctBaneLockTimeout) { clearTimeout(app._dsctBaneLockTimeout); app._dsctBaneLockTimeout = null; }
    if (app._dsctRollTrackHookId) { Hooks.off('createChatMessage', app._dsctRollTrackHookId); app._dsctRollTrackHookId = null; }

    if (app._dsctJudgementBaneInjected && !app._dsctAbilityRolled && app._dsctJudgementBaneMsgId) {
      
      const msg = game.messages.get(app._dsctJudgementBaneMsgId);
      if (msg) {
        const M = 'draw-steel-combat-tools';
        if (msg.isOwner || game.user.isGM) {
          await msg.setFlag(M, 'judgementBaneCanceled', true);
        } else {
          const api = getModuleApi(false);
          if (api?.socket) await api.socket.executeAsGM('dsct.updateDocument', msg.uuid, { [`flags.${M}.judgementBaneCanceled`]: true });
        }
      }
      return;
    }

    if (!app._dsctJudgementBaneMsgId || app._dsctJudgementBaneInjected) return;
    const msg = game.messages.get(app._dsctJudgementBaneMsgId);
    if (msg) await safeDelete(msg);
  });
}

export function registerChatHooks() {
  registerRollDialogHooks();
  const trySetFlag = async (msg, el = null) => {
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | enter msg=${msg.id} author=${msg.author?.name} isMe=${msg.author.id === game.user.id}`);
    if (msg.author.id !== game.user.id) return;

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
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | msg=${msg.id} parts=${parts.length} abilityUuid=${abilityUse?.abilityUuid ?? 'none'} tier=${abilityResult?.tier ?? 'none'}`);
    if (!abilityUse?.abilityUuid) return;

    const item = await fromUuid(abilityUse.abilityUuid);
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | item=${item?.name ?? 'null'} uuid=${abilityUse.abilityUuid}`);
    if (!item) return;

    const dsid = getItemDsid(item);

    if (!msg.getFlag('draw-steel-combat-tools', 'abilityDsid') && dsid) {
      await msg.setFlag('draw-steel-combat-tools', 'abilityDsid', dsid);
    }
    if (!abilityResult?.tier) return;

    const tier = abilityResult.tier;
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | dsid=${dsid} tier=${tier} item.system.power.effects count=${normalizeCollection(item.system?.power?.effects).length}`);

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
               ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.brokeFree', { grabbed: grab.grabbedName, grabber: grab.grabberName }) });
            }
          } else if (tier === 1) {
            ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.failedEscape', { grabbed: grab.grabbedName }) });
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

  };

  registerAbilityInjectors();

  
  
  
  Hooks.on('openDetachedWindow', () => {
    if (!ui.chat?.popout?.rendered) return;
    setTimeout(() => ui.chat.popout.render({ force: true }), 250);
  });

  Hooks.on('createChatMessage', (msg) => {
    _recentlyCreated.add(msg.id);
    setTimeout(() => _recentlyCreated.delete(msg.id), 5000);
    trySetFlag(msg);
  });
  Hooks.on('updateChatMessage', (msg) => { trySetFlag(msg); });
  Hooks.on('renderChatMessageHTML', (msg, el) => {
    trySetFlag(msg, el);

    let _ba = null;
    const btnArea = () => {
      if (!_ba) {
        _ba = el.querySelector('.message-part-buttons');
        const created = !_ba;
        if (!_ba) {
          _ba = document.createElement('div');
          _ba.className = 'message-part-buttons';
          (el.querySelector('.message-content') ?? el).appendChild(_ba);
        }
        if (getSetting('debugMode')) console.log(`DSCT | DSP-debug | chat-integration btnArea: ${created ? 'CREATED' : 'FOUND'} .message-part-buttons`, _ba, 'parent:', _ba.parentElement, 'el classes:', el.className);
      }
      return _ba;
    };

    if (msg.getFlag('draw-steel-combat-tools', 'isFallConfirm')) {
      const creatorUserId = msg.getFlag('draw-steel-combat-tools', 'creatorUserId');
      const isResolved    = msg.getFlag('draw-steel-combat-tools', 'fallConfirmResolved') != null;
      const canResolve    = game.user.isGM || game.user.id === creatorUserId;

      if (isResolved) {
        const res = msg.getFlag('draw-steel-combat-tools', 'fallConfirmResolved');
        const status = document.createElement('div');
        status.className = 'dsct-undo-status';
        status.textContent = res === 'confirmed' ? game.i18n.localize('DSCT.fall.confirmed') : game.i18n.localize('DSCT.fall.cancelled');
        btnArea().appendChild(status);
      } else if (canResolve) {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize('DSCT.button.confirmFall')}`;
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${game.i18n.localize('DSCT.button.cancelFall')}`;
        confirmBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          confirmBtn.disabled = true;
          cancelBtn.disabled  = true;
          await msg.setFlag('draw-steel-combat-tools', 'fallConfirmResolved', 'confirmed');
        });
        cancelBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          confirmBtn.disabled = true;
          cancelBtn.disabled  = true;
          await msg.setFlag('draw-steel-combat-tools', 'fallConfirmResolved', 'cancelled');
        });
        btnArea().appendChild(confirmBtn);
        btnArea().appendChild(cancelBtn);
      } else {
        const status = document.createElement('div');
        status.className = 'dsct-undo-status';
        status.textContent = game.i18n.localize('DSCT.fall.awaitingConfirm');
        btnArea().appendChild(status);
      }
    }

    if (msg.getFlag('draw-steel-combat-tools', 'isFriendlyFireCase1')) {
      const isResolved = msg.getFlag('draw-steel-combat-tools', 'ffCase1Resolved') != null;
      if (isResolved) {
        const res = msg.getFlag('draw-steel-combat-tools', 'ffCase1Resolved');
        const status = document.createElement('div');
        status.className = 'dsct-undo-status';
        status.textContent = res === 'stop'
          ? game.i18n.localize('DSCT.friendlyFire.movementStopped')
          : game.i18n.localize('DSCT.friendlyFire.proceeded');
        btnArea().appendChild(status);
      } else {
        const stopBtn = document.createElement('button');
        stopBtn.type  = 'button';
        stopBtn.innerHTML = `<i class="fa-solid fa-hand"></i> ${game.i18n.localize('DSCT.button.stopMovement')}`;
        const proceedBtn = document.createElement('button');
        proceedBtn.type  = 'button';
        proceedBtn.innerHTML = `<i class="fa-solid fa-arrow-right"></i> ${game.i18n.localize('DSCT.button.proceedAnyway')}`;
        stopBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          stopBtn.disabled    = true;
          proceedBtn.disabled = true;
          await msg.setFlag('draw-steel-combat-tools', 'ffCase1Resolved', 'stop');
        });
        proceedBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          stopBtn.disabled    = true;
          proceedBtn.disabled = true;
          await msg.setFlag('draw-steel-combat-tools', 'ffCase1Resolved', 'proceed');
        });
        btnArea().appendChild(stopBtn);
        btnArea().appendChild(proceedBtn);
      }
    }

    if (msg.getFlag('draw-steel-combat-tools', 'isFriendlyFireCase2')) {
      const isResolved = msg.getFlag('draw-steel-combat-tools', 'ffCase2Resolved') != null;
      if (isResolved) {
        const res = msg.getFlag('draw-steel-combat-tools', 'ffCase2Resolved');
        const status = document.createElement('div');
        status.className = 'dsct-undo-status';
        status.textContent = res === 'confirm'
          ? game.i18n.localize('DSCT.friendlyFire.collisionConfirmed')
          : res === 'ignore'
            ? game.i18n.localize('DSCT.friendlyFire.allyIgnored')
            : game.i18n.localize('DSCT.friendlyFire.collisionCancelled');
        btnArea().appendChild(status);
      } else {
        const confirmBtn = document.createElement('button');
        confirmBtn.type  = 'button';
        confirmBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize('DSCT.button.confirmCollision')}`;
        const cancelBtn  = document.createElement('button');
        cancelBtn.type   = 'button';
        cancelBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${game.i18n.localize('DSCT.button.cancelCollision')}`;
        confirmBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          confirmBtn.disabled = true;
          cancelBtn.disabled  = true;
          await msg.setFlag('draw-steel-combat-tools', 'ffCase2Resolved', 'confirm');
        });
        cancelBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          confirmBtn.disabled = true;
          cancelBtn.disabled  = true;
          await msg.setFlag('draw-steel-combat-tools', 'ffCase2Resolved', 'cancel');
        });
        btnArea().appendChild(confirmBtn);
        btnArea().appendChild(cancelBtn);
        if (msg.getFlag('draw-steel-combat-tools', 'ffCase2HasIgnoreOption')) {
          const ignoreBtn = document.createElement('button');
          ignoreBtn.type  = 'button';
          ignoreBtn.innerHTML = `<i class="fa-solid fa-person-running"></i> ${game.i18n.localize('DSCT.button.ignoreAlly')}`;
          ignoreBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            confirmBtn.disabled = true;
            cancelBtn.disabled  = true;
            ignoreBtn.disabled  = true;
            await msg.setFlag('draw-steel-combat-tools', 'ffCase2Resolved', 'ignore');
          });
          btnArea().appendChild(ignoreBtn);
        }
      }
    }

    const grabConfirm = msg.getFlag('draw-steel-combat-tools', 'grabConfirm');
    if (grabConfirm) {
      const resolved = msg.getFlag('draw-steel-combat-tools', 'grabConfirmResolved');
      if (resolved) {
        const status = document.createElement('div');
        status.className = 'dsct-undo-status';
        status.textContent = game.i18n.localize(resolved === 'confirmed' ? 'DSCT.chat.grab.grabConfirmed' : 'DSCT.chat.grab.grabCancelled');
        btnArea().appendChild(status);
      } else {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'dsct-grab-action-btn accent';
        confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Grab';
        confirmBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const grabber = getTokenById(grabConfirm.grabberId);
          const grabbed = getTokenById(grabConfirm.targetId);
          if (grabber && grabbed) await getModuleApi(false)?.grab(grabber, grabbed, { forceApply: true, maxGrabs: grabConfirm.maxGrabs ?? 1 });
          await resolveGrabConfirmChatMessage(msg.id, 'confirmed');
          const panel = getWindowById('grab-panel');
          if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'dsct-grab-action-btn danger';
        cancelBtn.innerHTML = '<i class="fa-solid fa-times"></i> Cancel';
        cancelBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          await resolveGrabConfirmChatMessage(msg.id, 'cancelled');
          const panel = getWindowById('grab-panel');
          if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
        });
        btnArea().appendChild(confirmBtn);
        btnArea().appendChild(cancelBtn);
      }
    }

    const escapeData = msg.getFlag('draw-steel-combat-tools', 'escapeGrab');
    if (escapeData?.tier === 2) {
      const resolvedState = msg.getFlag('draw-steel-combat-tools', 'escapeResolved');
      const container = document.createElement('div');
      container.className = 'dsct-escape-actions';

      if (resolvedState) {
        container.innerHTML = `<div style="margin-top:8px;font-size:13px;border-top:1px solid var(--color-border-light-primary);padding-top:8px;"><em>${game.i18n.localize(resolvedState === 'accepted' ? 'DSCT.chat.grab.escapeAccepted' : 'DSCT.chat.grab.stayedGrabbed')}</em></div>`;
        btnArea().appendChild(container);
      } else {
        const grab = window._activeGrabs?.get(escapeData.speakerToken);
        if (grab) {
          const grabberTok = getTokenById(grab.grabberTokenId);
          container.innerHTML = `
            ${game.i18n.format('DSCT.chat.grab.freeStrikePrompt', { grabber: grab.grabberName })}<br>
            <div style="margin:4px 0;">${grabberTok ? buildFreeStrikeButton(grabberTok.actor) : ''}</div>
            <div style="display:flex;gap:4px;margin-top:4px;">
              <button type="button" class="apply-effect dsct-accept-escape"><i class="fa-solid fa-check"></i> ${game.i18n.localize('DSCT.button.acceptEscape')}</button>
              <button type="button" class="apply-effect dsct-deny-escape"><i class="fa-solid fa-times"></i> ${game.i18n.localize('DSCT.button.stayGrabbed')}</button>
            </div>
          `;
          container.querySelector('.dsct-accept-escape')?.addEventListener('click', async (e) => {
            e.preventDefault();
            await triggerGrabberFreeStrike(grabberTok, grab);
            await getModuleApi(false)?.endGrab(escapeData.speakerToken, { silent: true });
            await resolveEscapeChatMessage(escapeData.speakerToken, 'accepted');
            const panel = getWindowById('grab-panel');
            if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
          });
          container.querySelector('.dsct-deny-escape')?.addEventListener('click', async (e) => {
            e.preventDefault();
            ChatMessage.create({ content: game.i18n.format('DSCT.chat.grab.staysGrabbed', { name: grab.grabbedName }) });
            await resolveEscapeChatMessage(escapeData.speakerToken, 'denied');
            const panel = getWindowById('grab-panel');
            if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
          });
          btnArea().appendChild(container);
        }
      }
    }

    const bleedingData = msg.getFlag('draw-steel-combat-tools', 'bleedingTriggered');
    if (bleedingData) {
      const div = document.createElement('div');
      div.className = 'dsct-bleeding-roll';
      div.style.cssText = 'margin-top:6px;border-top:1px solid var(--color-border-light-primary);padding-top:6px;font-size:13px;';

      if (bleedingData.mode === 'auto') {
        const applied = msg.getFlag('draw-steel-combat-tools', 'bleedingApplied');
        if (applied) {
          div.innerHTML = `<em><i class="fa-solid fa-droplet"></i> ${game.i18n.localize('DSCT.chat.bleeding.applied')}</em>`;
        } else {
          if (!_bleedingInFlight.has(msg.id)) {
            _bleedingInFlight.add(msg.id);
            (async () => {
              const actor = await fromUuid(bleedingData.actorUuid);
              if (!actor) { _bleedingInFlight.delete(msg.id); return; }
              
              const activeOwner = game.users.find(u => u.active && !u.isGM &&
                (actor.ownership?.[u.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
              if (activeOwner ? game.user.id !== activeOwner.id : !game.user.isGM) {
                _bleedingInFlight.delete(msg.id); return;
              }
              const level = actor.system.level ?? 1;
              const dmgRoll = new ds.rolls.DamageRoll(`1d6 + ${level}`, {}, { type: 'untyped' });
              await dmgRoll.evaluate();
              const dmg = dmgRoll.total;
              
              const sg = getSquadGroup(actor);
              const prevValue  = actor.system.stamina.value;
              const prevTemp   = actor.system.stamina.temporary;
              const prevSquadHP = sg?.system?.staminaValue ?? null;
              const title = game.i18n.format('DSCT.chat.bleeding.rollTitle', { name: actor.name });
              const rollMsg = await ds.documents.DrawSteelChatMessage.create({
                title,
                rolls: [dmgRoll],
                type: 'standard',
                speaker: ChatMessage.getSpeaker({ token: getTokenById(bleedingData.tokenId)?.document }),
                'system.parts': [{ rolls: [dmgRoll], flavor: title, type: 'roll' }],
                flags: {
                  core: { canPopout: true },
                  'draw-steel-combat-tools': { bleedingRoll: {
                    actorUuid: bleedingData.actorUuid, dmg, prevValue, prevTemp,
                    prevSquadHP, squadGroupUuid: sg?.uuid ?? null, sourceMsgId: msg.id,
                  }},
                },
              });
              await applyDamage(actor, dmg, undefined, { damageType: 'untyped', sourceItemName: 'Bleeding' });
              await msg.setFlag('draw-steel-combat-tools', 'bleedingApplied', { dmg, rollMsgId: rollMsg?.id });
              if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Auto-applied ${dmg} damage to ${actor.name}`);
              _bleedingInFlight.delete(msg.id);
            })();
          }
          div.innerHTML = `<em>${game.i18n.localize('DSCT.chat.bleeding.applying')}</em>`;
        }
      } else {
        const applied = msg.getFlag('draw-steel-combat-tools', 'bleedingApplied');
        if (applied) {
          div.innerHTML = `<em><i class="fa-solid fa-droplet"></i> ${game.i18n.localize('DSCT.chat.bleeding.rollCreated')}</em>`;
        } else {
          div.innerHTML = `<button type="button" class="dsct-bleed-roll-btn" style="cursor:pointer;"><i class="fa-solid fa-droplet"></i> ${game.i18n.localize('DSCT.button.rollBleedingDamage')}</button>`;
          div.querySelector('.dsct-bleed-roll-btn')?.addEventListener('click', async () => {
            const actor = await fromUuid(bleedingData.actorUuid);
            if (!actor) return;
            const level = actor.system.level ?? 1;
            const dmgRoll = new ds.rolls.DamageRoll(`1d6 + ${level}`, {}, { type: 'untyped' });
            await dmgRoll.evaluate();
            const title = game.i18n.format('DSCT.chat.bleeding.rollTitle', { name: actor.name });
            await ds.documents.DrawSteelChatMessage.create({
              title,
              rolls: [dmgRoll],
              type: 'standard',
              speaker: ChatMessage.getSpeaker({ token: getTokenById(bleedingData.tokenId)?.document }),
              'system.parts': [{ rolls: [dmgRoll], flavor: title, type: 'roll' }],
              flags: { core: { canPopout: true } },
            });
            await msg.setFlag('draw-steel-combat-tools', 'bleedingApplied', { manual: true });
          });
        }
      }
      btnArea().appendChild(div);
    }

    
    const rollData = msg.getFlag('draw-steel-combat-tools', 'bleedingRoll');
    if (rollData) {
      
      el.querySelectorAll('.apply-damage').forEach(b => b.remove());
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-bleed-undo';
      btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize('DSCT.button.undoBleeding')}`;
      btn.style.cssText = 'cursor:pointer;margin-top:4px;';
      btn.addEventListener('click', async () => {
        const actor = await fromUuid(rollData.actorUuid);
        if (actor) {
          const squadGroup = rollData.squadGroupUuid
            ? await fromUuid(rollData.squadGroupUuid).catch(() => null)
            : null;
          await undoDamage(actor, {
            prevTemp: rollData.prevTemp, prevValue: rollData.prevValue,
            prevSquadHP: rollData.prevSquadHP ?? null, squadGroup,
          });
          if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Undid ${rollData.dmg} damage on ${actor.name}`);
        }
        const sourceMsg = game.messages.get(rollData.sourceMsgId);
        if (sourceMsg && (sourceMsg.isOwner || game.user.isGM)) {
          await sourceMsg.unsetFlag('draw-steel-combat-tools', 'bleedingTriggered');
          await sourceMsg.unsetFlag('draw-steel-combat-tools', 'bleedingApplied');
        }
        if (msg.isOwner || game.user.isGM) await msg.delete();
      });
      btnArea().appendChild(btn);
    }
  });

}

export function refreshChatInjections() {
  ui.chat.render(true);
  if (ui.chat?.popout?.rendered) ui.chat.popout.render({ force: true });
}