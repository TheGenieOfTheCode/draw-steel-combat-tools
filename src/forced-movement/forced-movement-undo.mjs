import {
  replayUndo, safeUpdate, safeDelete, safeToggleStatusEffect, getSetting, getTokenById,
} from '../helpers.mjs';
import { applyGrab } from '../conditions/grab.mjs';
import { addPreviewToken, removePreviewToken, activateTokenLayer } from '../death-tracker/defeated-token-visibility.mjs';

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

  const processedActorIds = new Set();

  for (const tokenDoc of tokensToRevive.values()) {
    if (!tokenDoc || !tokenDoc.actor) continue;

    const actorAlreadyDone  = processedActorIds.has(tokenDoc.actor.uuid);
    const isDead            = !actorAlreadyDone && (tokenDoc.actor.statuses?.has('dead')  ?? false);
    const isDying           = !actorAlreadyDone && (tokenDoc.actor.statuses?.has('dying') ?? false);
    const existingCombatant = game.combat?.combatants.find(c => c.tokenId === tokenDoc.id);
    const combatantDefeated = existingCombatant?.defeated ?? false;

    if (!isDead && !isDying && !combatantDefeated) continue;

    
    const ownStaminaOp = staminaOps.find(op =>
      op.uuid === tokenDoc.actor?.uuid ||
      (Array.isArray(op.squadTokenIds) && op.squadTokenIds.includes(tokenDoc.id))
    );
    if (ownStaminaOp?.wasDeadBefore) continue;

    if (isDead || isDying) {
      processedActorIds.add(tokenDoc.actor.uuid);
      if (isDead) {
        let attempts = 0;
        while (tokenDoc.actor.statuses?.has('dead') && attempts++ < 5)
          await safeToggleStatusEffect(tokenDoc.actor, 'dead', { active: false });
      }
      if (isDying) await safeToggleStatusEffect(tokenDoc.actor, 'dying', { active: false });
    }

    
    if (isDead) {
      const preTint = tokenDoc.getFlag('draw-steel-combat-tools', 'preDeathTint') ?? '#ffffff';
      const preAlpha = tokenDoc.getFlag('draw-steel-combat-tools', 'preDeathAlpha') ?? 1;
      const savedDisplayBars = tokenDoc.getFlag('draw-steel-combat-tools', 'savedDisplayBars');
      const restoreData = { 'texture.tint': preTint, alpha: preAlpha };
      if (savedDisplayBars !== undefined) restoreData.displayBars = savedDisplayBars;
      await safeUpdate(tokenDoc, restoreData);
      await tokenDoc.unsetFlag('draw-steel-combat-tools', 'preDeathTint');
      await tokenDoc.unsetFlag('draw-steel-combat-tools', 'preDeathAlpha');
      if (savedDisplayBars !== undefined) await tokenDoc.unsetFlag('draw-steel-combat-tools', 'savedDisplayBars');
    }

    
    
    
    if (game.combat) {
      const savedGroupId = tokenDoc.getFlag('draw-steel-combat-tools', 'savedGroupId');
      if (combatantDefeated) {
        await existingCombatant.update({ defeated: false });
        if (savedGroupId) await tokenDoc.unsetFlag('draw-steel-combat-tools', 'savedGroupId');
      } else if (!existingCombatant) {
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
    }

    const deathMsgs = game.messages.filter(m => {
      if (!m.getFlag('draw-steel-combat-tools', 'isDeathMessage')) return false;
      const ids = m.getFlag('draw-steel-combat-tools', 'deadTokenIds') ??
        (m.getFlag('draw-steel-combat-tools', 'deadTokenId') ? [m.getFlag('draw-steel-combat-tools', 'deadTokenId')] : []);
      return ids.includes(tokenDoc.id);
    });
    for (const dm of deathMsgs) await safeDelete(dm);

    if (isDead || isDying) revivedNames.push(tokenDoc.name);
  }

  return revivedNames;
};


const isEntryExpired = (entry) => {
  if (!getSetting('undoExpirationCheck')) return false;
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
    const isDead = token.actor?.statuses?.has('dead');
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


const makeStatusDiv = (text) => {
  const div = document.createElement('div');
  div.className = 'dsct-undo-status';
  div.textContent = text;
  return div;
};

const makeUndoBtn = (label, onClick) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dsct-undo-fm';
  btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${label}`;
  btn.addEventListener('click', async (e) => { e.preventDefault(); await onClick(); });
  return btn;
};


const addFmUndoPreview = (btn, previews) => {
  const hlName = 'dsct-fm-undo-hl';
  let cleanupTimer = null;

  const clearPreview = () => {
    for (const { tokenId } of previews) removePreviewToken(tokenId);
    activateTokenLayer();
    if (canvas.interface.grid.highlightLayers?.[hlName]) canvas.interface.grid.clearHighlightLayer(hlName);
  };

  btn.addEventListener('mouseenter', () => {
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
    for (const { tokenId } of previews) addPreviewToken(tokenId);
    activateTokenLayer();
    if (!canvas.interface.grid.highlightLayers?.[hlName]) canvas.interface.grid.addHighlightLayer(hlName);
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const { tokenId, startPos } of previews) {
      if (!startPos) continue;
      const t = canvas.tokens.get(tokenId);
      if (!t) continue;
      const w = Math.max(1, Math.round(t.document.width));
      const h = Math.max(1, Math.round(t.document.height));
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          canvas.interface.grid.highlightPosition(hlName, {
            x: startPos.x + dx * canvas.grid.size,
            y: startPos.y + dy * canvas.grid.size,
            color: 0x4488FF, border: 0x2266CC,
          });
        }
      }
    }
    
    cleanupTimer = setTimeout(() => { cleanupTimer = null; clearPreview(); }, 1500);
  });
  btn.addEventListener('mouseleave', () => {
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
    clearPreview();
  });
};

export const registerForcedMovementHooks = () => {
  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!msg.getFlag('draw-steel-combat-tools', 'isFmUndo')) return;

    const isUndone   = msg.getFlag('draw-steel-combat-tools', 'isUndone');
    const isCombined = msg.getFlag('draw-steel-combat-tools', 'isCombined');
    const hadDamage  = msg.getFlag('draw-steel-combat-tools', 'hadDamage');

    let btnArea = el.querySelector('.message-part-buttons');
    if (!btnArea) {
      btnArea = document.createElement('div');
      btnArea.className = 'message-part-buttons';
      (el.querySelector('.message-content') ?? el).appendChild(btnArea);
    }

    if (isCombined) {
      const entries  = msg.getFlag('draw-steel-combat-tools', 'entries') ?? [];
      let isExpired  = msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false;
      if (!isExpired) isExpired = entries.some(isEntryExpired);

      if (isUndone) {
        btnArea.appendChild(makeStatusDiv(hadDamage ? '(Movements and Damage Undone)' : '(Movements Undone)'));
      } else if (isExpired) {
        btnArea.appendChild(makeStatusDiv('(Undo Expired)'));
      } else if (game.user.isGM || msg.isAuthor) {
        const btn = makeUndoBtn('Undo All Movements', async () => {
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
        addFmUndoPreview(btn, entries.map(e => ({
          tokenId:  e.targetTokenId,
          startPos: e.undoLog?.find(op => op.op === 'update')?.data ?? null,
        })));
        btnArea.appendChild(btn);
      }
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

    if (isUndone) {
      btnArea.appendChild(makeStatusDiv(hadDamage ? '(Movement and Damage Undone)' : '(Movement Undone)'));
    } else if (isExpired) {
      btnArea.appendChild(makeStatusDiv('(Undo Expired)'));
    } else if (game.user.isGM || msg.isAuthor) {
      const undoLog     = msg.getFlag('draw-steel-combat-tools', 'undoLog');
      const targetTokId = msg.getFlag('draw-steel-combat-tools', 'targetTokenId');
      const btn = makeUndoBtn('Undo Movement', async () => {
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
      addFmUndoPreview(btn, [{ tokenId: targetTokId, startPos: undoLog?.find(op => op.op === 'update')?.data ?? null }]);
      btnArea.appendChild(btn);
    }
  });
};