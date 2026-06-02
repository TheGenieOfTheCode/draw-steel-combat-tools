import { safeCreateEmbedded, safeDelete, getSetting, monsterFilter as filter } from './helpers.mjs';
import { runMultiTokenPicker, runColoredTokenPicker } from './ability-automation/target-picker.mjs';

const M         = 'draw-steel-combat-tools';
const ICON_PATH = 'modules/draw-steel-combat-tools/assets/Icons';

const GROUP_TINTS = {
  1:  '#ff4444',
  2:  '#4488ff',
  3:  '#44dd44',
  4:  '#ffcc00',
  5:  '#ff44ff',
  6:  '#44ffff',
  7:  '#ff8800',
  8:  '#aa44ff',
  9:  '#00ff88',
  10: '#ff88aa',
};

export const autoRenameGroups = async () => {
  if (!game.combat) return;

  const groups = game.combat.groups?.contents ?? [];
  const takenNums = new Set();
  const toRename = [];

  for (const group of groups) {
    const combatants = [...group.members];
    if (!combatants.length) continue;
    if (combatants.some(c => c.actor?.type === 'hero')) continue;
    const fractional = group.name.match(/^Group (\d+)[A-Za-z]+\s*$/i);
    if (fractional) { takenNums.add(parseInt(fractional[1])); continue; }
    toRename.push(group);
  }

  let groupNum = 1;
  for (const group of toRename) {
    while (takenNums.has(groupNum)) groupNum++;
    await group.update({ name: `Group ${groupNum}` });
    groupNum++;
  }
};

export const applySquadLabels = async () => {
  if (!game.combat) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.squads.noActiveCombat'));
    return;
  }

  const dbg = getSetting('debugMode');
  const _t0 = dbg ? performance.now() : 0;
  const _tm = (label) => { if (dbg) console.log(`DSCT | SL | [+${(performance.now()-_t0).toFixed(0)}ms] ${label}`); };
  let skipped = 0, updated = 0;

  const allTokens = canvas.tokens.placeables;

  
  const expected = new Map();
  for (const group of game.combat.groups?.contents ?? []) {
    const match = group.name.match(/^Group (\d+)([a-z]?)$/i);
    if (!match) continue;
    const num    = parseInt(match[1]);
    const letter = (match[2] || '').toLowerCase();
    if (num > 10) continue;
    const combatants = [...group.members];
    if (!combatants.length) continue;
    if (combatants.some(c => c.actor?.type === 'hero')) continue;
    const tint       = GROUP_TINTS[num] ?? '#ffffff';
    const suffix     = letter === 'b' ? 'B' : '';
    const captainId  = group.system?.captainId;
    const liveMinions = combatants.filter(c => c.actor?.system?.isMinion && !c.defeated);
    for (const combatant of combatants) {
      const actor = allTokens.find(t => t.id === combatant.tokenId)?.actor;
      if (!actor) continue;
      const isCaptain = combatant.id === captainId && liveMinions.length > 0;
      const prefix    = isCaptain ? 'Captain' : actor.system.isMinion ? 'Minion' : 'Group';
      expected.set(combatant.tokenId, { name: group.name, img: `${ICON_PATH}/${prefix}${num}${suffix}.png`, tint });
    }
  }
  _tm(`expected map built (${expected.size} tokens)`);

  
  for (const token of allTokens) {
    if (!token.actor) continue;
    const existing = token.actor.effects.filter(e => e.getFlag(M, 'effectType') === 'squad-label');
    const want     = expected.get(token.id);

    if (!want) {
      if (existing.length) {
        _tm(`removing stale label from ${token.name}`);
        for (const e of existing) await safeDelete(e);
        updated++;
      }
      continue;
    }

    if (existing.length === 1 && existing[0].name === want.name && existing[0].img === want.img) {
      skipped++;
      continue;
    }

    if (dbg && existing.length === 1) {
      const e = existing[0];
      const reasons = [];
      if (e.name !== want.name) reasons.push(`name: "${e.name}" vs "${want.name}"`);
      if (e.img  !== want.img)  reasons.push(`img: "${e.img}" vs "${want.img}"`);
      console.log(`DSCT | SL | mismatch on ${token.name}: ${reasons.join(', ') || '(match!)'}`);
    }
    _tm(`updating label for ${token.name} (${want.img})`);
    for (const e of existing) await safeDelete(e);
    try {
      await safeCreateEmbedded(token.actor, 'ActiveEffect', [{
        name: want.name, img: want.img,
        type: "base",
        system: { end: { type: "encounter", roll: "" }, filters: { keywords: [] } },
        changes: [], disabled: false,
        duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
        description: "", tint: want.tint, transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'squad-label' } },
      }]);
      updated++;
    } catch (err) {
      console.warn(`DSCT | SL | failed to create label for ${token.name}:`, err);
    }
  }

  if (dbg) console.log(`DSCT | SL | applySquadLabels done in ${(performance.now()-_t0).toFixed(0)}ms -- skipped=${skipped} updated=${updated}`);

  if (!game.combat.started) {
    ui.notifications.info(game.i18n.localize('DSCT.notice.squads.labelsApplied'));
  }
};

const _labelsApplied = () => {
  if (!game.combat) return false;
  return game.combat.combatants.some(c =>
    c.actor?.effects.some(e => e.getFlag(M, 'effectType') === 'squad-label')
  );
};

const _findCaptainCandidates = (group, combat) => {
  const liveMinions = [...group.members].filter(m => m.actor?.system?.isMinion && !m.defeated);

  let squadDisp = null;
  for (const m of liveMinions) {
    const tok = canvas.tokens.placeables.find(t => t.id === m.tokenId);
    if (tok) { squadDisp = tok.document.disposition; break; }
  }

  const minionLangs = new Set();
  for (const m of liveMinions) {
    for (const l of (m.actor?.system?.biography?.languages ?? [])) minionLangs.add(l);
  }

  const isMount  = filter.keyword('mount');
  const isLeader = filter.organization('leader');
  const isSolo   = filter.organization('solo');

  return canvas.tokens.placeables.filter(t => {
    const a = t.actor;
    if (!a || a.type !== 'npc') return false;
    if (a.system.isMinion) return false;
    if (isMount(a) || isLeader(a) || isSolo(a)) return false;
    const c = combat.combatants.find(cb => cb.tokenId === t.id);
    if (!c || c.defeated) return false;
    
    if (c.system?.isCaptain && c.group?.id !== group.id) return false;
    if (squadDisp !== null && t.document.disposition !== squadDisp) return false;
    
    if (minionLangs.size > 0) {
      const capLangs = a.system?.biography?.languages ?? new Set();
      if (![...capLangs].some(l => minionLangs.has(l))) return false;
    }
    return true;
  });
};

const _findCaptainlessSquads = (combat) => {
  return (combat.groups?.contents ?? []).filter(g => {
    if (g.type !== 'squad') return false;
    if (![...g.members].some(m => m.actor?.system?.isMinion && !m.defeated)) return false;
    if (!g.system?.captainId) return true;
    const captain = combat.combatants.get(g.system.captainId);
    return !captain || captain.defeated;
  });
};

const updateWithCaptainEffects = async () => {
  if (!game.combat) return;
  for (const squad of game.combat.groups?.contents ?? []) {
    if (squad.type !== 'squad') continue;
    const captain = squad.system.captain;
    for (const minion of squad.system.minions) {
      const captainEffect = minion.actor?.effects.getName('With Captain');
      await captainEffect?.update({ disabled: !captain || captain.isDefeated });
    }
  }
};

let _relabelTimer = null;
let _suppressGroupDeleteRelabel = false;
let _suppressCaptainRelabel = false;
const _captainFellSent = new Set();

const _assignCaptain = async (chosenToken, group, combat) => {
  const chosenCombatant = combat.combatants.find(c => c.tokenId === chosenToken.id);
  if (!chosenCombatant) return;

  const oldGroup = chosenCombatant.group?.id !== group.id ? chosenCombatant.group : null;

  await combat.updateEmbeddedDocuments('Combatant', [{ _id: chosenCombatant.id, group: group.id }]);
  _suppressCaptainRelabel = true;
  try {
    await group.update({ 'system.captainId': chosenCombatant.id });
  } finally {
    _suppressCaptainRelabel = false;
  }

  if (oldGroup && [...oldGroup.members].length === 0) {
    _suppressGroupDeleteRelabel = true;
    try {
      await combat.deleteEmbeddedDocuments('CombatantGroup', [oldGroup.id]);
    } finally {
      _suppressGroupDeleteRelabel = false;
    }
    await autoRenameGroups();
  }

  await applySquadLabels();
  await updateWithCaptainEffects();

  ChatMessage.create({ content: game.i18n.format('DSCT.chat.squads.newCaptain', {
    name: chosenToken.name, group: group.name,
  }) });
};

const _processCaptainQueue = async (groups, combat) => {
  const validGroups = groups.filter(g =>
    [...g.members].some(m => m.actor?.system?.isMinion && !m.defeated)
  );
  if (!validGroups.length) return;

  
  const seenIds = new Set();
  const allCandidateTokens = [];
  for (const group of validGroups) {
    for (const c of _findCaptainCandidates(group, combat)) {
      if (!seenIds.has(c.id)) { seenIds.add(c.id); allCandidateTokens.push(c); }
    }
  }

  if (!allCandidateTokens.length) {
    for (const group of validGroups) {
      ui.notifications.info(game.i18n.format('DSCT.notice.squads.noCaptainCandidates', { group: group.name }));
    }
    return;
  }

  
  if (getSetting('squadCaptainShortcut') && allCandidateTokens.length === validGroups.length) {
    const assignedIds = new Set();
    for (const group of validGroups) {
      const candidates = _findCaptainCandidates(group, combat).filter(t => !assignedIds.has(t.id));
      if (!candidates.length) continue;
      assignedIds.add(candidates[0].id);
      await _assignCaptain(candidates[0], group, combat);
    }
    return;
  }

  if (allCandidateTokens.length < validGroups.length) {
    
    
    let remainingGroups = [...validGroups];
    for (const candidateToken of allCandidateTokens) {
      if (!remainingGroups.length) break;

      const colorMap = new Map();
      for (const group of remainingGroups) {
        const num = parseInt(group.name.match(/^Group (\d+)/i)?.[1]);
        const css = GROUP_TINTS[num] ?? '#ffffff';
        for (const m of group.members) {
          if (m.defeated || !m.actor?.system?.isMinion) continue;
          const tok = canvas.tokens.placeables.find(t => t.id === m.tokenId);
          if (tok) colorMap.set(tok.id, css);
        }
      }

      const minionTokens = [...colorMap.keys()]
        .map(id => canvas.tokens.placeables.find(t => t.id === id))
        .filter(Boolean);
      if (!minionTokens.length) continue;

      const picked = await runColoredTokenPicker({
        tokens: minionTokens,
        colorMap,
        hint: game.i18n.format('DSCT.notice.squads.pickSquadForCaptain', { name: candidateToken.name }),
      });
      if (!picked) continue;

      const squad = remainingGroups.find(g =>
        [...g.members].some(m => m.tokenId === picked.id && m.actor?.system?.isMinion)
      );
      if (!squad) continue;

      await _assignCaptain(candidateToken, squad, combat);
      remainingGroups = remainingGroups.filter(g => g.id !== squad.id);
    }
  } else {
    
    for (const group of validGroups) {
      const candidates = _findCaptainCandidates(group, combat);
      if (!candidates.length) {
        ui.notifications.info(game.i18n.format('DSCT.notice.squads.noCaptainCandidates', { group: group.name }));
        continue;
      }
      const picked = await runMultiTokenPicker({
        candidates,
        hint: game.i18n.format('DSCT.notice.squads.pickCaptain', { group: group.name }),
        maxTargets: 1,
      });
      if (!picked?.length) continue;
      await _assignCaptain(picked[0], group, combat);
    }
  }
};

let _shiftOverrideRename = false;

export const registerSquadLabelHooks = () => {
  Hooks.on('renderCombatTracker', (_app, html) => {
    if (!getSetting('autoSquadLabelsEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;
    const el = html instanceof HTMLElement ? html : html[0];
    const btn = el?.querySelector('[data-action="startCombat"]');
    if (!btn || btn.dataset.dsctShiftBound) return;
    btn.dataset.dsctShiftBound = '1';
    btn.dataset.tooltip = game.i18n.localize('DSCT.tooltip.shiftStartCombat');
    btn.addEventListener('click', e => { if (e.shiftKey) _shiftOverrideRename = true; });
  });
  Hooks.on('canvasReady', async () => {
    if (!game.users.activeGM?.isSelf) return;
    if (!getSetting('autoSquadLabelsEnabled')) return;

    const combatantTokenIds = new Set(
      (game.combat?.combatants.contents ?? []).map(c => c.tokenId)
    );

    for (const token of canvas.tokens.placeables) {
      if (!token.actor) continue;
      const labels = token.actor.effects.filter(e => e.getFlag(M, 'effectType') === 'squad-label');
      if (!labels.length || combatantTokenIds.has(token.id)) continue;
      for (const e of labels) await safeDelete(e);
    }
  });

  Hooks.on('deleteCombat', async () => {
    if (!game.users.activeGM?.isSelf) return;
    if (!getSetting('autoSquadLabelsEnabled')) return;
    await new Promise(r => setTimeout(r, 3000));
    for (const token of canvas.tokens.placeables) {
      if (!token.actor) continue;
      const labels = token.actor.effects.filter(e => e.getFlag(M, 'effectType') === 'squad-label');
      for (const e of labels) await safeDelete(e);
    }
  });

  Hooks.on('combatStart', async (combat) => {
    if (!getSetting('autoSquadLabelsEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;

    await new Promise(resolve => setTimeout(resolve, 500));

    const shiftOverride = _shiftOverrideRename;
    _shiftOverrideRename = false;
    const preference = shiftOverride ? 'ask' : getSetting('squadLabelRenamePreference');

    if (preference === 'rename') {
      await autoRenameGroups();
      await applySquadLabels();
      ui.notifications.info(game.i18n.localize('DSCT.notice.squads.renamedAndLabeled'));
    } else if (preference === 'apply') {
      await applySquadLabels();
      ui.notifications.info(game.i18n.localize('DSCT.notice.squads.labelsAppliedExisting'));
    } else {
      let remember = false;
      const result = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize('DSCT.dialog.autoRenameSquads.title') },
        content: `<p>${game.i18n.localize('DSCT.dialog.autoRenameSquads.content')}</p>
          <label style="display:flex;align-items:center;gap:6px;margin-top:8px;">
            <input type="checkbox" id="dsct-remember-rename">
            ${game.i18n.localize('DSCT.dialog.autoRenameSquads.remember')}
          </label>`,
        buttons: [
          { action: "rename", label: game.i18n.localize('DSCT.dialog.autoRenameSquads.rename'), icon: "fas fa-check", default: true },
          { action: "apply",  label: game.i18n.localize('DSCT.dialog.autoRenameSquads.apply'),  icon: "fas fa-paint-brush" },
        ],
        render: (_event, dialog) => {
          dialog.element?.querySelector('#dsct-remember-rename')?.addEventListener('change', e => {
            remember = e.target.checked;
          });
        },
        rejectClose: false,
      });

      if (result === "rename") {
        if (remember) await game.settings.set(M, 'squadLabelRenamePreference', 'rename');
        await autoRenameGroups();
        await applySquadLabels();
        ui.notifications.info(game.i18n.localize('DSCT.notice.squads.renamedAndLabeled'));
      } else if (result === "apply") {
        if (remember) await game.settings.set(M, 'squadLabelRenamePreference', 'apply');
        await applySquadLabels();
        ui.notifications.info(game.i18n.localize('DSCT.notice.squads.labelsAppliedExisting'));
      }
    }

    if (getSetting('squadLabelCaptainNow')) {
      const captainless = _findCaptainlessSquads(combat);
      if (captainless.length) await _processCaptainQueue(captainless, combat);
    }
    await updateWithCaptainEffects();
  });

  
  Hooks.on('deleteCombatantGroup', async () => {
    if (_suppressGroupDeleteRelabel) return;
    if (!getSetting('autoSquadLabelsEnabled') || !getSetting('squadLabelAutoRelabel')) return;
    if (!game.users.activeGM?.isSelf || !game.combat || !_labelsApplied()) return;

    const namedGroups = (game.combat.groups?.contents ?? []).filter(g => /^Group \d+$/i.test(g.name));
    const nums = namedGroups.map(g => parseInt(g.name.match(/^Group (\d+)$/i)?.[1])).sort((a, b) => a - b);
    if (!nums.length || nums.every((n, i) => n === i + 1)) return;

    await autoRenameGroups();
    await applySquadLabels();
  });

  Hooks.on('updateCombatant', async (combatant, changes) => {
    if (!getSetting('autoSquadLabelsEnabled') || !changes.defeated) return;
    if (!game.users.activeGM?.isSelf) return;

    const group = combatant.group;
    if (!group || group.type !== 'squad') return;

    if (combatant.actor?.system?.isMinion) {
      if (!getSetting('squadLabelAutoRelabel') || !group.system?.captainId) return;
      const liveMinions = [...group.members].filter(m => m.actor?.system?.isMinion && !m.defeated);
      if (liveMinions.length > 0 || !_labelsApplied()) return;

      const captainCombatant = game.combat?.combatants.get(group.system.captainId);
      const captainName = captainCombatant?.actor?.name ?? captainCombatant?.name ?? 'Unknown';
      ChatMessage.create({ content: game.i18n.format('DSCT.chat.squads.captainLostSquad', {
        name: captainName, group: group.name,
      }) });
      await group.update({ 'system.captainId': null });
      await applySquadLabels();
    } else if (combatant.system?.isCaptain) {
      _captainFellSent.add(combatant.id);
      setTimeout(() => _captainFellSent.delete(combatant.id), 2000);
      ChatMessage.create({ content: game.i18n.format('DSCT.chat.squads.captainFell', {
        name: combatant.actor?.name ?? combatant.name, group: group.name,
      }) });
      await updateWithCaptainEffects();
    }
  });

  
  
  Hooks.on('createCombatant', () => {
    if (!getSetting('autoSquadLabelsEnabled') || !game.users.activeGM?.isSelf) return;
    if (window._dsctReviveActive) return;
    if (_relabelTimer) clearTimeout(_relabelTimer);
    _relabelTimer = setTimeout(async () => {
      _relabelTimer = null;
      if (_labelsApplied()) await applySquadLabels();
    }, 250);
  });

  
  
  Hooks.on('deleteCombatant', async (combatant) => {
    if (!getSetting('autoSquadLabelsEnabled')) return;
    if (!game.users.activeGM?.isSelf) return;
    if (_captainFellSent.has(combatant.id)) return;
    const group = combatant.group;
    if (!group || group.type !== 'squad') return;
    if (group.system?.captainId !== combatant.id) return;

    _captainFellSent.add(combatant.id);
    setTimeout(() => _captainFellSent.delete(combatant.id), 2000);
    ChatMessage.create({ content: game.i18n.format('DSCT.chat.squads.captainFell', {
      name: combatant.actor?.name ?? combatant.name, group: group.name,
    }) });
    await updateWithCaptainEffects();
  });

  Hooks.on('updateCombatantGroup', async (group, changes) => {
    if (!getSetting('autoSquadLabelsEnabled') || !getSetting('squadLabelAutoRelabel')) return;
    if (!game.users.activeGM?.isSelf || !game.combat || !_labelsApplied()) return;
    if (changes.system?.captainId === undefined) return;
    if (_suppressCaptainRelabel) return;
    await applySquadLabels();
    await updateWithCaptainEffects();
  });

  Hooks.on('combatRound', async () => {
    if (!getSetting('autoSquadLabelsEnabled')) return;
    if (!game.users.activeGM?.isSelf || !game.combat || !_labelsApplied()) return;

    if (getSetting('squadLabelCaptainNow')) {
      const captainless = _findCaptainlessSquads(game.combat);
      if (captainless.length) await _processCaptainQueue(captainless, game.combat);
    }
    await updateWithCaptainEffects();
  });
};
