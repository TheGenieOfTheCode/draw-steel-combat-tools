import {
  replayUndo, safeUpdate, safeDelete, safeToggleStatusEffect, getSetting, getTokenById,
} from './helpers.mjs';
import { applyGrab } from './grab.mjs';

const restoreGrabs = async (grabsToRestore) => {
  if (!grabsToRestore?.length) return;
  const maxByGrabber = new Map();
  for (const { grabberTokenId } of grabsToRestore) {
    maxByGrabber.set(grabberTokenId, (maxByGrabber.get(grabberTokenId) ?? 0) + 1);
  }
  for (const { grabberTokenId, grabbedTokenId } of grabsToRestore) {
    const grabberTok = getTokenById(grabberTokenId);
    const grabbedTok = getTokenById(grabbedTokenId);
    if (grabberTok && grabbedTok) await applyGrab(grabberTok, grabbedTok, { maxGrabs: maxByGrabber.get(grabberTokenId) ?? 1 });
  }
};

const handleStaminaRevival = async (undoLog) => {
  const staminaOps   = undoLog.filter(op => op.op === 'stamina');
  const revivedNames = [];

  
  
  const tokensToRevive = new Map();

  for (const op of staminaOps) {
    
    const actor = await fromUuid(op.uuid);
    if (actor) {
      if (actor.isToken) {
        tokensToRevive.set(actor.token.id, actor.token);
      } else {
        const sceneTokens = canvas.scene.tokens.filter(t => t.actor?.id === actor.id);
        for (const st of sceneTokens) tokensToRevive.set(st.id, st);
      }
    }

    
    
    const tokenIds = Array.isArray(op.squadTokenIds) ? op.squadTokenIds : [];
    for (const tid of tokenIds) {
      if (!tokensToRevive.has(tid)) {
        const t = canvas.scene.tokens.get(tid);
        if (t) tokensToRevive.set(tid, t);
      }
    }
  }

  
  for (const tokenDoc of tokensToRevive.values()) {
    if (!tokenDoc || !tokenDoc.actor) continue;

    const skulls = canvas.scene.tiles.filter(t =>
      t.flags?.['draw-steel-combat-tools']?.deadTokenId === tokenDoc.id
    );
    const isDead  = tokenDoc.actor.statuses?.has('dead');
    const isDying = tokenDoc.actor.statuses?.has('dying');

    
    if (!isDead && !isDying && skulls.length === 0) continue;

    
    if (isDead)  await safeToggleStatusEffect(tokenDoc.actor, 'dead',  { active: false });
    if (isDying) await safeToggleStatusEffect(tokenDoc.actor, 'dying', { active: false });

    
    for (const skull of skulls) {
      const gx = Math.floor(skull.x / canvas.grid.size) * canvas.grid.size;
      const gy = Math.floor(skull.y / canvas.grid.size) * canvas.grid.size;

      await safeUpdate(tokenDoc, { x: gx, y: gy }, { animate: false, teleport: true });

      
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const live = canvas.scene.tokens.get(tokenDoc.id);
        if (live && Math.abs(live.x - gx) < 1 && Math.abs(live.y - gy) < 1) break;
        await new Promise(r => setTimeout(r, 50));
      }

      await safeDelete(skull);
    }

    if (tokenDoc.hidden) await safeUpdate(tokenDoc, { hidden: false });

    
    
    
    if (game.combat && !game.combat.combatants.find(c => c.tokenId === tokenDoc.id)) {
      const savedGroupId = tokenDoc.getFlag('draw-steel-combat-tools', 'savedGroupId');

      if (savedGroupId) {
        const squadOp = staminaOps.find(op =>
          op.squadGroupUuid && op.prevSquadHP !== null &&
          Array.isArray(op.squadTokenIds) && op.squadTokenIds.includes(tokenDoc.id)
        );
        if (getSetting('debugMode')) console.log(`DSCT | FM UNDO | handleStaminaRevival squadHP check: tokenId=${tokenDoc.id} savedGroupId=${savedGroupId} squadOp found=${!!squadOp}`, squadOp ? { squadGroupUuid: squadOp.squadGroupUuid, prevSquadHP: squadOp.prevSquadHP, squadTokenIds: squadOp.squadTokenIds } : null);
        if (squadOp) {
          const sg = await fromUuid(squadOp.squadGroupUuid);
          if (getSetting('debugMode')) console.log(`DSCT | FM UNDO | handleStaminaRevival sg found=${!!sg} currentStaminaValue=${sg?.system?.staminaValue} prevSquadHP=${squadOp.prevSquadHP}`);
          if (sg && sg.system.staminaValue < squadOp.prevSquadHP) {
            await safeUpdate(sg, { 'system.staminaValue': squadOp.prevSquadHP });
          }
        }
      }

      const combatantData = { tokenId: tokenDoc.id, sceneId: canvas.scene.id, actorId: tokenDoc.actorId };
      if (savedGroupId) combatantData.group = savedGroupId;
      await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
      if (savedGroupId) await tokenDoc.unsetFlag('draw-steel-combat-tools', 'savedGroupId');
    }

    
    const deathMsgs = game.messages.filter(m =>
      m.getFlag('draw-steel-combat-tools', 'isDeathMessage') &&
      m.getFlag('draw-steel-combat-tools', 'deadTokenId') === tokenDoc.id
    );
    for (const dm of deathMsgs) await safeDelete(dm);

    revivedNames.push(tokenDoc.name);
  }

  return revivedNames;
};


const isEntryExpired = (entry) => {
  if (canvas.scene?.id !== entry.targetSceneId) {
    if (getSetting('debugMode')) console.log(`DSCT | FM | EXPIRED (scene mismatch) targetScene=${entry.targetSceneId} currentScene=${canvas.scene?.id}`);
    return true;
  }
  const token = canvas.scene.tokens.get(entry.targetTokenId);
  if (!token) {
    if (getSetting('debugMode')) console.log(`DSCT | FM | EXPIRED (token deleted) targetTokenId=${entry.targetTokenId}`);
    return true;
  }
  const lastMoveId = token.getFlag('draw-steel-combat-tools', 'lastFmMoveId');
  if (lastMoveId && lastMoveId !== entry.moveId) {
    if (getSetting('debugMode')) console.log(`DSCT | FM | EXPIRED (moveId mismatch) msg=${entry.moveId} token=${lastMoveId} | target=${token.name}`);
    return true;
  }
  if (entry.finalPos) {
    const isDead = token.actor?.statuses?.has('dead') || token.hidden;
    if (!isDead) {
      const posMatch = token.x === entry.finalPos.x && token.y === entry.finalPos.y && (token.elevation ?? 0) === entry.finalPos.elevation;
      if (getSetting('debugMode')) console.log(`DSCT | FM | Position check for ${token.name}: token(${token.x},${token.y},${token.elevation??0}) vs finalPos(${entry.finalPos.x},${entry.finalPos.y},${entry.finalPos.elevation}) | match=${posMatch} | isDead=${isDead} | moveId=${entry.moveId}`);
      if (!posMatch) return true;
    } else {
      if (getSetting('debugMode')) console.log(`DSCT | FM | Skipping pos check for ${token.name}: isDead=${isDead} finalPos=${JSON.stringify(entry.finalPos)}`);
    }
  }
  return false;
};


export const registerForcedMovementHooks = () => {
  const STATUS_STYLE = 'text-align: center; color: var(--color-text-dark-secondary); font-style: italic; font-size: 11px; padding: 4px; border: 1px dashed var(--color-border-dark-4); border-radius: 3px;';

  Hooks.on('renderChatMessageHTML', (msg, htmlElement) => {
    const html = $(htmlElement);
    if (!msg.getFlag('draw-steel-combat-tools', 'isFmUndo')) return;

    const isUndone   = msg.getFlag('draw-steel-combat-tools', 'isUndone');
    const isCombined = msg.getFlag('draw-steel-combat-tools', 'isCombined');
    const hadDamage  = msg.getFlag('draw-steel-combat-tools', 'hadDamage');
    const container  = $('<div class="dsct-fm-undo-container" style="margin-top: 4px;"></div>');

    
    if (isCombined) {
      const entries   = msg.getFlag('draw-steel-combat-tools', 'entries') ?? [];
      let isExpired   = msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false;
      if (!isExpired) isExpired = entries.some(isEntryExpired);

      const undoneText = hadDamage ? '(Movements and Damage Undone)' : '(Movements Undone)';

      if (isUndone) {
        container.append(`<div style="${STATUS_STYLE}">${undoneText}</div>`);
      } else if (isExpired) {
        container.append(`<div style="${STATUS_STYLE}">(Undo Expired)</div>`);
      } else if (game.user.isGM || msg.isAuthor) {
        const btn = $(`<button type="button" class="dsct-undo-fm" style="cursor:pointer; font-size: 12px; line-height: 14px; margin-top: 2px;"><i class="fa-solid fa-rotate-left"></i> Undo All Movements</button>`);
        btn.on('click', async (e) => {
          e.preventDefault();
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isUndone': true });
          const allRevived = [];
          for (const entry of [...entries].reverse()) {
            if (entry.undoLog) {
              allRevived.push(...await handleStaminaRevival(entry.undoLog));
              await replayUndo(entry.undoLog);
            }
            await restoreGrabs(entry.grabsToRestore);
          }
          const unique = [...new Set(allRevived)];
          ui.notifications.info(unique.length > 0
            ? `Forced movement reversed. Revived: ${unique.join(', ')}.`
            : 'All forced movements undone.'
          );
        });
        container.append(btn);
      }

      html.find('.message-content').append(container);
      return;
    }

    
    let isExpired = msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false;
    if (!isExpired) {
      isExpired = isEntryExpired({
        moveId:        msg.getFlag('draw-steel-combat-tools', 'moveId'),
        targetTokenId: msg.getFlag('draw-steel-combat-tools', 'targetTokenId'),
        targetSceneId: msg.getFlag('draw-steel-combat-tools', 'targetSceneId'),
        finalPos:      msg.getFlag('draw-steel-combat-tools', 'finalPos'),
      });
    }

    const undoneText = hadDamage ? '(Movement and Damage Undone)' : '(Movement Undone)';

    if (isUndone) {
      container.append(`<div style="${STATUS_STYLE}">${undoneText}</div>`);
    } else if (isExpired) {
      container.append(`<div style="${STATUS_STYLE}">(Undo Expired)</div>`);
    } else if (game.user.isGM || msg.isAuthor) {
      const btn = $(`<button type="button" class="dsct-undo-fm" style="cursor:pointer; font-size: 12px; line-height: 14px; margin-top: 2px;"><i class="fa-solid fa-rotate-left"></i> Undo Movement</button>`);
      btn.on('click', async (e) => {
        e.preventDefault();
        const undoLog = msg.getFlag('draw-steel-combat-tools', 'undoLog');
        if (undoLog) {
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isUndone': true });
          const revivedNames = await handleStaminaRevival(undoLog);
          await replayUndo(undoLog);
          await restoreGrabs(msg.getFlag('draw-steel-combat-tools', 'grabsToRestore'));
          ui.notifications.info(revivedNames.length > 0
            ? `Forced movement reversed. Revived: ${[...new Set(revivedNames)].join(', ')}.`
            : 'Forced movement undone.'
          );
        }
      });
      container.append(btn);
    }

    html.find('.message-content').append(container);
  });
};