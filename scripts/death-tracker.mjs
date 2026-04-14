import { getSetting, safeTeleport, getModuleApi } from './helpers.mjs';

const SKULL_SRC = 'icons/commodities/bones/skull-hollow-worn-blue.webp';

const getGraveyardPosition = (tokenDoc) => {
  const gs = canvas.grid.size;
  const tokenW = tokenDoc.width ?? 1;
  const tokenH = tokenDoc.height ?? 1;
  const tw = tokenW * gs;
  const th = tokenH * gs;

  // So 2 tokens dying in the same moment will race to claim the same graveyard square and stack on top of each other. We give each placement a 5 second hold so they land somewhere different.

  if (!window._graveyardReservations) window._graveyardReservations = new Set();

  const isOccupied = (testX, testY) => {
    return canvas.tokens.placeables.some(t => {
      if (t.id === tokenDoc.id) return false;
      const w = (t.document.width ?? 1) * gs;
      const h = (t.document.height ?? 1) * gs;
      return !(testX >= t.x + w || testX + tw <= t.x || testY >= t.y + h || testY + th <= t.y);
    });
  };

  for (let ring = 0; ring < 20; ring++) {
    for (let x = 0; x <= ring; x++) {
      for (let y = 0; y <= ring; y++) {
        if (x === ring || y === ring) {
          const gx = x * gs;
          const gy = y * gs;
          
          let reservationConflict = false;
          for(let rx = 0; rx < tokenW; rx++) {
              for(let ry = 0; ry < tokenH; ry++) {
                  if (window._graveyardReservations.has(`${gx + rx * gs},${gy + ry * gs}`)) {
                      reservationConflict = true;
                  }
              }
          }

          if (!isOccupied(gx, gy) && !reservationConflict) {
            for(let rx = 0; rx < tokenW; rx++) {
                for(let ry = 0; ry < tokenH; ry++) {
                    const rKey = `${gx + rx * gs},${gy + ry * gs}`;
                    window._graveyardReservations.add(rKey);
                    setTimeout(() => window._graveyardReservations.delete(rKey), 5000);
                }
            }
            return { x: gx, y: gy };
          }
        }
      }
    }
  }
  return { x: 0, y: 0 }; 
};

export function registerDeathTrackerHooks() {

  // Apologies to the dev responsible for the built-in minion selection dialog, I made my own version before v14 launched, and I tried making it work nicely with the official implementation, but I just like mine better. Users can still opt out from the settings and by turning off "Override Minion Defeat UI".

  Hooks.once('ready', () => {
    if (getSetting('overrideMinionDefeat') && ds?.applications?.apps?.DefeatedMinionSelection) {
      ds.applications.apps.DefeatedMinionSelection.create = async () => null;
    }
  });

  Hooks.on('createActiveEffect', async (effect) => {
    if (!getSetting('deathTrackerEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;

    const statuses = [...(effect.statuses ?? [])];
    if (!statuses.includes('dead') && !statuses.includes('dying')) return;

    const actor = effect.parent;
    if (!actor || actor.type === 'hero') return;

    const token = actor.isToken ? actor.token.object : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    if (!token) return;

    if (getSetting('debugMode')) console.log(`DSCT | DT | createActiveEffect fired for ${actor.name} (${token.id}) statuses=[${statuses.join(',')}] effectId=${effect.id}`);

    if (!window._deathTrackerLocks) window._deathTrackerLocks = new Set();
    if (window._deathTrackerLocks.has(token.id)) {
      if (getSetting('debugMode')) console.log(`DSCT | DT | Lock already held for ${actor.name} (${token.id}), skipping.`);
      return;
    }
    window._deathTrackerLocks.add(token.id);
    if (getSetting('debugMode')) console.log(`DSCT | DT | Lock acquired for ${actor.name} (${token.id}).`);
    setTimeout(() => { window._deathTrackerLocks.delete(token.id); if (getSetting('debugMode')) console.log(`DSCT | DT | Lock released for ${actor.name} (${token.id}).`); }, 2000);

    if (window._activeGrabs) {
      for (const [gid, grab] of [...window._activeGrabs.entries()]) {
        if (grab.grabbedTokenId === token.id || grab.grabberTokenId === token.id) {
          const api = getModuleApi(false);
          if (api) await api.endGrab(gid, { silent: false, customMsg: `${actor.name} fell, ending the grab.` });
        }
      }
    }

    const combatant = game.combat?.combatants.find(c => c.tokenId === token.id);
    if (combatant) {
      const groupId = combatant._source?.group ?? null;
      if (groupId) await token.document.setFlag('draw-steel-combat-tools', 'savedGroupId', groupId);
      await combatant.delete();
    }

    const animDuration = getSetting('deathAnimationDuration');
    if (animDuration > 0) {
      await token.document.update({ 'texture.tint': '#ff0000' });
      const steps = 20;
      const stepTime = Math.round(animDuration / steps);
      for (let i = steps - 1; i >= 0; i--) {
        await new Promise(r => setTimeout(r, stepTime));
        if (!canvas.tokens.get(token.id)) break; 
        await token.document.update({ alpha: i / steps });
      }
    }

    if (canvas.tokens.get(token.id)) {
      const tileSize = Math.round(token.document.width * canvas.grid.size / 2);
      const tileX    = token.center.x;
      const tileY    = token.center.y;

      const [tile] = await canvas.scene.createEmbeddedDocuments('Tile', [{
        texture: { src: SKULL_SRC, scaleX: 1, scaleY: 1, tint: '#ffffff', anchorX: 0.5, anchorY: 0.5 },
        x: tileX, y: tileY,
        width: tileSize, height: tileSize,
        rotation: 0, alpha: 1, hidden: false, locked: false,
        occlusion: { modes: [], alpha: 0 },
        restrictions: { light: false, weather: false },
        video: { loop: false, autoplay: false, volume: 0 },
        flags: {
          'draw-steel-combat-tools': { deadTokenId: token.id }
        }
      }]);

      if (getSetting('clearSkullsOnCombatEnd') && tile) {
        const skullIds = game.settings.get('draw-steel-combat-tools', 'deathTrackerSkullIds') ?? [];
        skullIds.push(tile.id);
        await game.settings.set('draw-steel-combat-tools', 'deathTrackerSkullIds', skullIds);
      }

      await new Promise(r => setTimeout(r, 150));

      const gravePos = getGraveyardPosition(token.document);
      await token.document.update({ hidden: true, alpha: 1, 'texture.tint': '#ffffff' });
      await safeTeleport(token.document, gravePos.x, gravePos.y);

      await ChatMessage.create({
        content: `<strong>${actor.name}</strong> ${actor.type === 'object' ? 'was destroyed' : 'has fallen'}.`,
        flags: { 'draw-steel-combat-tools': { isDeathMessage: true, deadTokenId: token.id } }
      });
    }
  });

  Hooks.on('preUpdateCombatantGroup', (group, changes) => {
    if (group.type !== 'squad') return;
    const newVal = changes.system?.staminaValue;
    if (newVal === undefined || newVal <= 0) return;
    const members = Array.from(group.members || []).filter(m => m?.actor && !m.defeated);
    if (!members.length) return;
    const indivHP = members[0].actor?.system?.stamina?.max ?? 1;
    const maxHP   = members.length * indivHP;
    if (newVal > maxHP) changes.system.staminaValue = maxHP;
  });

  Hooks.on('updateCombatantGroup', async (group, changes) => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('overrideMinionDefeat') || !game.users.activeGM?.isSelf) return;

    const newHp = changes.system?.staminaValue ?? changes.system?.stamina?.value;
    if (newHp === undefined) return;
    if (group.type !== 'squad') return;

    if (!window._squadDeathLocks) window._squadDeathLocks = new Set();
    if (window._squadDeathLocks.has(group.id)) return;
    window._squadDeathLocks.add(group.id);

    const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    const minions = Array.from(group.members || []).filter(m => {
      if (!m || !m.actor) return false;
      const sys = m.actor.system;
      const roleStr = String(sys?.monster?.organization || sys?.role?.value || sys?.role || m.actor.type).toLowerCase().trim();
      return roleStr === 'minion';
    });

    if (minions.length === 0) { window._squadDeathLocks.delete(group.id); return; }

    try {
      if (newHp <= 0) {
        for (const minion of minions) {
          if (!minion.actor) continue;
          const alreadyDefeated = minion.actor.statuses?.has(defeatedStatusId);
          if (!alreadyDefeated) {
            await minion.actor.toggleStatusEffect(defeatedStatusId, { overlay: true, active: true });
            await minion.update({ defeated: true });
          }
        }
        return;
      }

      const indivHP = minions[0].actor?.system?.stamina?.max || 1;
      const numToKill = minions.length - Math.ceil(newHp / indivHP);

      if (numToKill > 0) {
        const chosenUserId = resolveBreakpointUser();
        const api = getModuleApi(false);
        const socket = api?.socket;
        const damagedTokenIds = window._lastSquadDamagedTokenIds ? [...window._lastSquadDamagedTokenIds] : [];
        const oneMustDie = () => {
          if (chosenUserId === game.user.id || !socket) {
            if (api?.powerWordKill) api.powerWordKill({ maxTargets: numToKill, squadGroup: group, minions, damagedTokenIds });
          } else {
            socket.executeAsUser('openSquadBreakpoint', chosenUserId, group.id, numToKill, damagedTokenIds);
          }
        };
        if (window._dsctFMActive) {
          const poll = setInterval(() => { if (!window._dsctFMActive) { clearInterval(poll); oneMustDie(); } }, 50);
        } else {
          oneMustDie();
        }
      }
    } finally {
      window._squadDeathLocks.delete(group.id);
    }
  });

  Hooks.on('deleteTile', (tileDoc) => {
    if (!game.users.activeGM?.isSelf) return;
    const deadTokenId = tileDoc.flags?.['draw-steel-combat-tools']?.deadTokenId;
    if (!deadTokenId) return;
    const rubble = canvas.scene?.tiles?.contents?.filter(t =>
      t.flags?.['draw-steel-combat-tools']?.objectTokenId === deadTokenId
    ) ?? [];
    for (const tile of rubble) tile.delete().catch(() => {});
    if (getSetting('debugMode') && rubble.length > 0) console.log(`DSCT | DT | Deleted ${rubble.length} rubble tile(s) for object token ${deadTokenId}.`);
  });

  Hooks.on('deleteCombat', async () => {
    if (!getSetting('deathTrackerEnabled') || !getSetting('clearSkullsOnCombatEnd') || !game.users.activeGM?.isSelf) return;

    const skullIds = game.settings.get('draw-steel-combat-tools', 'deathTrackerSkullIds') ?? [];
    const deadTokenIds = [];
    for (const id of skullIds) {
      const tile = canvas.scene.tiles.get(id);
      if (tile) {
        const deadTokenId = tile.document.flags?.['draw-steel-combat-tools']?.deadTokenId;
        if (deadTokenId) {
          deadTokenIds.push(deadTokenId);
          const deadToken = canvas.scene.tokens.get(deadTokenId);
          if (deadToken) await deadToken.delete();
        }
        await tile.document.delete();
      }
    }
    const deadSet = new Set(deadTokenIds);
    const orphanRubble = canvas.scene?.tiles?.contents?.filter(t =>
      deadSet.has(t.flags?.['draw-steel-combat-tools']?.objectTokenId)
    ) ?? [];
    for (const tile of orphanRubble) await tile.document.delete();
    await game.settings.set('draw-steel-combat-tools', 'deathTrackerSkullIds', []);
  });

  Hooks.on('renderChatMessage', (msg, html) => {
    if (!game.user.isGM) return;
    const isDeath = msg.getFlag('draw-steel-combat-tools', 'isDeathMessage');
    if (isDeath) {
      const tokenId = msg.getFlag('draw-steel-combat-tools', 'deadTokenId');
      if (!tokenId) return;
      
      const btn = $(`<button type="button" class="dsct-undo-death" style="margin-top:4px;cursor:pointer;"><i class="fa-solid fa-rotate-left"></i> Undo</button>`);
      btn.on('click', async (e) => {
         e.preventDefault();
         await executeRevival(tokenId);
         if (msg.isOwner || game.user.isGM) await msg.delete();
      });
      html.find('.message-content').append(btn);
    }
  });
}

const resolveBreakpointUser = () => {
  const combatant = game.combat?.combatant;
  if (combatant?.actor?.type === 'hero') {
    const owner = game.users.find(u => !u.isGM && u.active && combatant.actor.testUserPermission(u, 'OWNER'));
    if (owner) return owner.id;
  }
  const lastMsg = game.messages.contents[game.messages.contents.length - 1];
  if (lastMsg) {
    const author = game.users.get(lastMsg.author?.id ?? lastMsg.user?.id);
    if (author && !author.isGM && author.active) return author.id;
  }
  return game.users.activeGM?.id ?? game.user.id;
};

export const runReviveUI = () => {
  if (!game.user.isGM) { ui.notifications.warn("Revive is a GM-only tool."); return; }

  const skulls = canvas.tiles.placeables.filter(t => t.document.flags?.['draw-steel-combat-tools']?.deadTokenId);
  if (!skulls.length) { ui.notifications.warn("No valid skulls found for revival."); return; }

  if (window._reviveActive) return;
  window._reviveActive = true;

  const hlName = 'dsct-revive-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const selected = new Set(); 

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const skull of skulls) {
      const gx = Math.floor(skull.x / canvas.grid.size) * canvas.grid.size;
      const gy = Math.floor(skull.y / canvas.grid.size) * canvas.grid.size;
      const isSelected = selected.has(skull.id);
      canvas.interface.grid.highlightPosition(hlName, {
        x: gx, y: gy,
        color:  isSelected ? 0x00CCFF : 0x00FF00,
        border: isSelected ? 0x0088AA : 0x00AA00,
      });
    }
  };

  drawHighlights();
  ui.notifications.info("REVIVE | Click skulls to select them, press ENTER to revive, or Right-Click to cancel.");

  const finish = () => {
    window._reviveActive = false;
    canvas.interface.grid.destroyHighlightLayer(hlName);
    canvas.stage.off('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
  };

  const onClick = (event) => {
    if (event.data.originalEvent.button === 2) {
      finish();
      ui.notifications.info("Revival cancelled.");
      return;
    }
    if (event.data.originalEvent.button !== 0) return;

    const pos = event.data.getLocalPosition(canvas.app.stage);
    const clicked = skulls.filter(s =>
      pos.x >= s.x && pos.x <= s.x + s.document.width &&
      pos.y >= s.y && pos.y <= s.y + s.document.height
    );
    if (!clicked.length) return;

    const allSelected = clicked.every(s => selected.has(s.id));
    for (const s of clicked) {
      if (allSelected) selected.delete(s.id);
      else selected.add(s.id);
    }
    drawHighlights();
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish();
      if (!selected.size) { ui.notifications.warn("No skulls selected for revival."); return; }
      for (const tileId of selected) {
        const skull = canvas.tiles.get(tileId);
        if (!skull) continue;
        const tokenId = skull.document.flags['draw-steel-combat-tools'].deadTokenId;
        await executeRevival(tokenId, skull);
      }
    } else if (event.key === 'Escape') {
      finish();
      ui.notifications.info("Revival cancelled.");
    }
  };

  canvas.stage.on('mousedown', onClick);
  document.addEventListener('keydown', onKey);
};

const executeRevival = async (tokenId, explicitTile = null) => {
  const tokenDoc = canvas.scene.tokens.get(tokenId);
  
  if (!tokenDoc) {
      ui.notifications.error("The token for this creature no longer exists in the Graveyard.");
      return;
  }

  const tile = explicitTile || canvas.tiles.placeables.find(t => t.document.flags?.['draw-steel-combat-tools']?.deadTokenId === tokenId);

  if (tile) {
      const tileDocX = tile.document.x;
      const tileDocY = tile.document.y;
      const tileW    = tile.document.width;
      const tileH    = tile.document.height;
      const rawX = tileDocX - tileW / 2;
      const rawY = tileDocY - tileH / 2;
      const snapped = canvas.grid.getSnappedPoint({ x: rawX, y: rawY }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_CORNER });
      await safeTeleport(tokenDoc, snapped.x, snapped.y);
  }

  const combatant = game.combat?.combatants.find(c => c.tokenId === tokenId);
  if (combatant?.defeated) await combatant.update({ defeated: false });

  const actor = tokenDoc.actor;
  const isMinion = actor ? String(actor.system?.monster?.organization || '').toLowerCase().trim() === 'minion' : false;
  if (actor) {
      const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
      if (actor.statuses?.has(defeatedStatusId)) {
          await actor.toggleStatusEffect(defeatedStatusId, { overlay: true, active: false });
      }

      const currentStamina = actor.system.stamina?.value || 0;
      if (currentStamina <= 0) {
        await actor.update({ 'system.stamina.value': 1 });
      }

      await new Promise(r => setTimeout(r, 250));

      if (getSetting('clearEffectsOnRevive')) {
          // IDs ending in '0000000000' are core system states from the Draw Steel system. Deleting them breaks the actor in ways that are not immediately obvious and very annoying to debug.

          const validEffectIds = actor.effects
              .filter(e => !e.id.endsWith('0000000000'))
              .map(e => e.id);

          if (validEffectIds.length > 0) {
              try {
                  await actor.deleteEmbeddedDocuments("ActiveEffect", validEffectIds);
              } catch (e) {
                  console.warn("DSCT | DT | Minor error clearing remaining effects: ", e);
              }
          }
      }
  }

  await tokenDoc.update({ hidden: false });

  if (game.combat && !game.combat.combatants.find(c => c.tokenId === tokenId)) {
    const savedGroupId = tokenDoc.getFlag('draw-steel-combat-tools', 'savedGroupId');
    const group = savedGroupId ? game.combat.groups.get(savedGroupId) : null;
    const combatantData = { tokenId, sceneId: canvas.scene.id, actorId: tokenDoc.actorId };
    if (group) combatantData.group = savedGroupId;
    await game.combat.createEmbeddedDocuments('Combatant', [combatantData]);
    if (group && isMinion) {
      const minionMaxHP = tokenDoc.actor?.system?.stamina?.max ?? 0;
      if (minionMaxHP > 0) await group.update({ 'system.staminaValue': (group.system.staminaValue ?? 0) + minionMaxHP });
    }
    if (savedGroupId) await tokenDoc.unsetFlag('draw-steel-combat-tools', 'savedGroupId');
  }

  if (tile) await tile.document.delete();
  ui.notifications.info(`${tokenDoc.name} has been revived!`);
};

export const runPowerWordKillUI = async (options = {}) => {
  if (!game.user.isGM) {
    ui.notifications.warn("POWER WORD: KILL is a GM-only tool.");
    return;
  }

  if (!getSetting('deathTrackerEnabled')) return;

  if (window._pwkActive) return;

  const maxTargets = options.maxTargets || Infinity;
  const squadGroup = options.squadGroup || null;
  const minionCombatants = options.minions || [];
  const damagedTokenIds = options.damagedTokenIds || [];
  const autoAssign = squadGroup && getSetting('autoAssignDamagedMinion');

  window._pwkActive = true;

  const minionTokenIds = new Set(minionCombatants.map(m => m.tokenId));
  const npcs = squadGroup
    ? canvas.tokens.placeables.filter(t => minionTokenIds.has(t.id) && !t.document.hidden && !t.document.defeated)
    : canvas.tokens.placeables.filter(t => t.actor && t.actor.type !== 'hero' && !t.document.hidden && (t.actor.system?.stamina?.value > 0));

  if (!npcs.length) {
    ui.notifications.warn("No valid targets found on the board.");
    window._pwkActive = false;
    return;
  }

  const hlName = 'dsct-pwk-hl';
  if (canvas.interface.grid.highlightLayers[hlName]) canvas.interface.grid.destroyHighlightLayer(hlName);
  canvas.interface.grid.addHighlightLayer(hlName);

  const lockedTokens = new Set();
  const selectedTokens = new Set();

  if (autoAssign && damagedTokenIds.length > 0) {
    for (const id of damagedTokenIds) {
      if (npcs.find(t => t.id === id) && selectedTokens.size < maxTargets) {
        lockedTokens.add(id);
        selectedTokens.add(id);
      }
    }
    if (lockedTokens.size === maxTargets) {
      window._pwkActive = false;
      for (const id of lockedTokens) {
        const t = canvas.tokens.get(id);
        if (t?.actor && !t.actor.statuses?.has('dead')) {
          await t.actor.toggleStatusEffect('dead', { active: true });
        }
      }
      ui.notifications.info(lockedTokens.size > 1 ? 'MASS POWER WORD: KILL' : 'POWER WORD: KILL');
      return;
    }
  }

  const drawHighlights = () => {
    canvas.interface.grid.clearHighlightLayer(hlName);
    for (const npc of npcs) {
      const isSelected = selectedTokens.has(npc.id);
      const isLocked   = lockedTokens.has(npc.id);
      const color = isSelected ? 0xFF0000 : 0xFF8800;
      const border = isSelected ? 0xAA0000 : 0xAA4400;

      const w = Math.max(1, Math.round(npc.document.width));
      const h = Math.max(1, Math.round(npc.document.height));

      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          const gx = Math.floor(npc.x / canvas.grid.size) * canvas.grid.size + (dx * canvas.grid.size);
          const gy = Math.floor(npc.y / canvas.grid.size) * canvas.grid.size + (dy * canvas.grid.size);
          canvas.interface.grid.highlightPosition(hlName, { x: gx, y: gy, color, border });
        }
      }
    }
  };

  drawHighlights();
  ui.notifications.info(`POWER WORD: KILL | Click NPCs to select them, press ENTER to execute, or Right-Click to cancel.`);

  const finish = () => {
    window._pwkActive = false;
    canvas.interface.grid.destroyHighlightLayer(hlName);
    canvas.stage.off('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
  };

  const onClick = (event) => {
    if (event.data.originalEvent.button === 2) {
      finish();
      ui.notifications.info("POWER WORD: KILL cancelled.");
      return;
    }
    
    if (event.data.originalEvent.button !== 0) return;
    
    const pos = event.data.getLocalPosition(canvas.app.stage);
    
    const clicked = npcs.filter(t => {
       const w = t.document.width * canvas.grid.size;
       const h = t.document.height * canvas.grid.size;
       return pos.x >= t.x && pos.x <= t.x + w && pos.y >= t.y && pos.y <= t.y + h;
    });

    if (!clicked.length) return;

    const targetId = clicked[0].id;
    if (selectedTokens.has(targetId)) {
        if (lockedTokens.has(targetId)) {
            if (!onClick._warnCooldown) {
                ui.notifications.warn(`${clicked[0].name} took the damage and cannot be deselected.`);
                onClick._warnCooldown = setTimeout(() => { delete onClick._warnCooldown; }, 3000);
            }
            return;
        }
        selectedTokens.delete(targetId);
    } else {
        if (selectedTokens.size >= maxTargets) {
            if (!onClick._warnCooldown) {
                ui.notifications.warn(`You must select exactly ${maxTargets} target${maxTargets !== 1 ? 's' : ''}.`);
                onClick._warnCooldown = setTimeout(() => { delete onClick._warnCooldown; }, 3000);
            }
            return;
        }
        selectedTokens.add(targetId);
    }
    
    drawHighlights();
  };

  const onKey = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); 
      finish();
      canvas.tokens.releaseAll();
      [...game.user.targets].forEach(t => t.setTarget(false, { releaseOthers: false }));
      
      if (selectedTokens.size === 0) {
        ui.notifications.warn("No targets selected.");
        return;
      }

      for (const id of selectedTokens) {
        const t = canvas.tokens.get(id);
        if (!t?.actor) continue;
        if (!t.actor.statuses?.has('dead')) {
          if (getSetting('debugMode')) console.log(`DSCT | DT | PWK applying dead to ${t.actor.name} (${id})`);
          await t.actor.toggleStatusEffect('dead', { active: true });
        }
      }

      ui.notifications.info(selectedTokens.size > 1 ? 'MASS POWER WORD: KILL' : 'POWER WORD: KILL');
      
    } else if (event.key === 'Escape') {
      finish();
      ui.notifications.info("Selection cancelled.");
    }
  };

  canvas.stage.on('mousedown', onClick);
  document.addEventListener('keydown', onKey);
};