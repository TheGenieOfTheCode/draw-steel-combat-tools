import { getSetting, getModuleApi, getWindowById, getItemDsid, MULTI_GRAB_LIMITS, applyDamage, canForcedMoveTarget, safeDelete } from '../helpers.mjs';
import { runForcedMovement } from '../forced-movement/forced-movement-engine.mjs';
import { FmModifyPanel, replayModifiers, createModifierNoteDiv } from '../forced-movement/forced-movement-modify-panel.mjs';
import { applyGrab, runGrab } from '../conditions/grab.mjs';
import { applyFrightened, applyTaunted } from '../conditions/conditions.mjs';
import { _addDamagedToken, reviveTokens } from '../death-tracker/death-tracker.mjs';
import { MARK_ABILITY_CONFIG } from '../ability-automation/ability-automation.mjs';
import { _pendingSquadMap, consumePendingSquadMap } from '../ability-automation/squad-targeting.mjs';

const DSTD       = 'draw-steel-target-damage';
const DSTD_PANEL = `section.${DSTD}-panel`;
const DSTD_ROW   = `.${DSTD}-target-row[data-target-key]`;
const M          = 'draw-steel-combat-tools';


const _fmState = new Map();

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

export function registerDstdCompat() {
  const dbg = getSetting('debugMode');

  
  
  
  
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!game.modules.get(DSTD)?.active) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | renderChatMessageHTML msgId=${message.id} hasPanel=${!!root?.querySelector(DSTD_PANEL)}`);
    if (!root) return;
    const msgId = message.id;
    setTimeout(() => {
      
      
      const live = root.ownerDocument.querySelector(`li.chat-message[data-message-id="${msgId}"]`) ?? root;
      _injectFmButtons(message, live);
      _injectMarkReminder(message, live);
    }, 0);
  });

  
  
  Hooks.on('openDetachedWindow', (id, win) => {
    setTimeout(() => _startPanelObserverIn(id, win), 300);
  });
  Hooks.on('closeDetachedWindow', (id) => {
    _stopDetachedObserver(id);
  });

  Hooks.on('createRegion', (region, _options, userId) => {
    if (userId !== game.user.id) return;
    if (!game.modules.get(DSTD)?.active) return;
    let dstdAoe = true;
    try { dstdAoe = game.settings.get(DSTD, 'aoeTargeting'); } catch {}
    if (!dstdAoe) return;
    _handleAoeTargeting(region);
  });

  
  
  if (dbg) console.log(`DSCT | DSTD compat | registerDstdCompat called, starting panel observer`);
  _startPanelObserver();
}

let _panelObserver = null;
const _detachedObservers = new Map();


const DSTD_ROW_CLS = `.${DSTD}-target-row`;

function _makePanelCallback() {
  return (mutations) => {
    if (!game.modules.get(DSTD)?.active) return;
    const toInject = new Set();
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList?.contains('dsct-dstd-fm-row')) continue;
        let li = null;
        if (node.matches?.(DSTD_PANEL) || node.querySelector?.(DSTD_PANEL)) {
          li = node.closest?.('li.chat-message[data-message-id]');
          if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | observer: panel added msgId=${li?.dataset?.messageId}`);
        } else if (node.matches?.(DSTD_ROW_CLS) || node.querySelector?.(DSTD_ROW_CLS)) {
          li = node.closest?.('li.chat-message[data-message-id]');
          if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | observer: row added msgId=${li?.dataset?.messageId}`);
        }
        if (li) toInject.add(li);
      }
    }
    for (const li of toInject) {
      const message = game.messages.get(li.dataset.messageId);
      if (message) _injectFmButtons(message, li);
    }
  };
}

function _startPanelObserver() {
  if (_panelObserver) return;
  
  
  const chatLog = document.querySelector('#chat-log') ?? document.querySelector('#chat') ?? document.body;
  if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | MutationObserver starting on ${chatLog.id || chatLog.tagName}`);
  _panelObserver = new MutationObserver(_makePanelCallback());
  _panelObserver.observe(chatLog, { childList: true, subtree: true });
  if (getSetting('debugMode')) console.log('DSCT | DSTD compat | MutationObserver active');
}

function _startPanelObserverIn(id, win) {
  if (_detachedObservers.has(id)) return;
  const doc = win.document;
  
  const chatLog = doc.querySelector('#chat-log') ?? doc.querySelector('[id$="-popout"]') ?? doc.body;
  if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | detached MutationObserver starting for window ${id} on ${chatLog.id || chatLog.tagName}`);
  const obs = new MutationObserver(_makePanelCallback());
  obs.observe(chatLog, { childList: true, subtree: true });
  _detachedObservers.set(id, obs);
}

function _stopDetachedObserver(id) {
  const obs = _detachedObservers.get(id);
  if (obs) { obs.disconnect(); _detachedObservers.delete(id); }
}

const _collapseKey = (msgId) => `dsct-dstd-collapse-${msgId}`;


function _installUndoDeathHook(panel) {
  if (panel.dataset.dsctDmgUndoTracked) return;
  panel.dataset.dsctDmgUndoTracked = '1';
  const dbg = getSetting('debugMode');
  
  
  panel.addEventListener('click', (e) => {
    if (game.users.activeGM?.isSelf || getSetting('playerCanUndoDstdDeaths')) return;
    if (!e.target.closest('[data-dstd-action="undoDamage"]')) return;
    e.stopImmediatePropagation();
    ui.notifications.warn(game.i18n.localize('DSCT.notice.playerCannotUndoDamage'));
  }, { capture: true });
  panel.addEventListener('click', (e) => {
    
    
    
    
    
    if (getSetting('deathTrackerEnabled') && getSetting('overrideMinionDefeat')) {
      const applyBtn = e.target.closest('[data-dstd-action="applyDamage"]');
      if (applyBtn) {
        try {
          const tgt = JSON.parse(applyBtn.dataset.target ?? 'null');
          const tokenIds = [];
          if (tgt?.tokenId) {
            tokenIds.push(tgt.tokenId);
          } else if (tgt?.selectedToken) {
            
            for (const t of Array.from(canvas.tokens?.controlled ?? [])) {
              const id = t.document?.id ?? null;
              if (id) tokenIds.push(id);
            }
          }
          for (const tokenId of tokenIds) {
            if (game.users.activeGM?.isSelf) {
              _addDamagedToken(tokenId, null);
            } else {
              getModuleApi(false)?.socket?.executeAsGM('dsct.reportDamagedToken', tokenId, game.user.id);
            }
          }
        } catch {}
      }
    }

    const undoBtn = e.target.closest(`.${DSTD}-undo-button:not(.dsct-dstd-undo-btn)`);
    if (dbg) console.log(`DSCT | DSTD undo-death | click, btn=${undoBtn?.className ?? 'none'}`);
    if (!undoBtn) return;
    const actionRow = undoBtn.closest(`.${DSTD}-action-row`);
    if (!actionRow || actionRow.classList.contains('dsct-dstd-fm-row')) return;
    const targetRow = undoBtn.closest(DSTD_ROW);
    if (!targetRow) return;
    const { targetKey } = targetRow.dataset;
    if (dbg) console.log(`DSCT | DSTD undo-death | targetKey=${targetKey}`);
    if (!targetKey || targetKey === 'selected-token') return;
    const tokenUuid = targetKey.replace(/__/g, '.');

    if (!game.users.activeGM?.isSelf) {
      
      if (!getSetting('playerCanUndoDstdDeaths')) return;
      const socket = getModuleApi(false)?.socket;
      if (!socket) return;
      
      setTimeout(() => socket.executeAsGM('dsct.dstdUndoDeath', tokenUuid), 600);
      return;
    }

    
    
    
    
    
    setTimeout(() => runDstdUndoRevival(tokenUuid), 500);
  });
}


export async function runDstdUndoRevival(tokenUuid) {
  const dbg = getSetting('debugMode');
  try {
    const tokenDoc = await fromUuid(tokenUuid).catch(() => null);
    const token = tokenDoc?.object;
    if (dbg) console.log(`DSCT | DSTD undo-death | token=${token?.name}, dead=${token?.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead')}`);
    if (!token?.actor) return;
    const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
    if (!token.actor.statuses?.has(defeatedStatus)) return;
    const deathGroup = window._dsctDeathGroups?.get(token.id);
    const toRevive = deathGroup
      ? [...deathGroup].filter(id => canvas.tokens.get(id)?.actor?.statuses?.has(defeatedStatus))
      : [token.id];
    await reviveTokens(toRevive.length ? toRevive : [token.id]);
  } catch (e) {
    console.warn('DSCT | DSTD undo-death | revival error:', e);
  }
}


function _installGlobalDamageButtons(panel, message) {
  panel.querySelector('.dsct-dstd-global-row')?.remove();

  const targetRows = [...panel.querySelectorAll(DSTD_ROW)];
  if (targetRows.length <= 1) return;

  const applyBtns = targetRows.map(r => r.querySelector('[data-dstd-action="applyDamage"]')).filter(Boolean);
  const undoBtns  = targetRows.map(r => r.querySelector('[data-dstd-action="undoDamage"]')).filter(Boolean);
  const anyApplyEnabled = applyBtns.some(b => !b.disabled);
  const anyUndoEnabled  = undoBtns.some(b => !b.disabled);
  if (!anyApplyEnabled && !anyUndoEnabled) return;

  const msgId  = message.id;
  const msgDoc = panel.ownerDocument;

  
  const _clickSequentially = async (getBtn) => {
    const processed = new Set();
    while (true) {
      const li = msgDoc.querySelector(`li.chat-message[data-message-id="${msgId}"]`);
      const cur = li?.querySelector(DSTD_PANEL);
      if (!cur) break;
      let clicked = false;
      for (const row of cur.querySelectorAll(DSTD_ROW)) {
        const key = row.dataset.targetKey;
        if (processed.has(key)) continue;
        const btn = getBtn(row);
        if (btn && !btn.disabled) {
          processed.add(key);
          btn.click();
          clicked = true;
          await new Promise(r => setTimeout(r, 500));
          break;
        }
        processed.add(key);
      }
      if (!clicked) break;
    }
  };

  const applyAllBtn = document.createElement('button');
  applyAllBtn.type = 'button';
  applyAllBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
  applyAllBtn.disabled = !anyApplyEnabled;
  applyAllBtn.dataset.tooltip = 'Apply damage to all targets';
  applyAllBtn.append(_makeIcon('fa-solid fa-check-double'), _makeSpan('Apply All'));

  const undoAllBtn = document.createElement('button');
  undoAllBtn.type = 'button';
  undoAllBtn.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
  undoAllBtn.disabled = !anyUndoEnabled;
  undoAllBtn.dataset.tooltip = 'Undo damage for all targets';
  undoAllBtn.append(_makeIcon('fa-solid fa-rotate-left'));

  applyAllBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    if (applyAllBtn.disabled) return;
    applyAllBtn.disabled = true;
    await _clickSequentially(row => row.querySelector('[data-dstd-action="applyDamage"]'));
  });

  undoAllBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    if (undoAllBtn.disabled) return;
    undoAllBtn.disabled = true;
    await _clickSequentially(row => row.querySelector('[data-dstd-action="undoDamage"]'));
  });

  const globalRow = document.createElement('div');
  globalRow.className = `${DSTD}-action-row dsct-dstd-global-row`;
  globalRow.append(applyAllBtn, undoAllBtn);

  
  
  
  const targetList = panel.querySelector(`.${DSTD}-target-list`);
  if (targetList) panel.insertBefore(globalRow, targetList);
  else panel.appendChild(globalRow);
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

function _getMessageTier(message) {
  for (const part of _getMessageParts(message)) {
    if (part.type !== 'abilityResult') continue;
    const tier = Number(part.tier);
    if (tier >= 1 && tier <= 3) return tier;
  }
  return null;
}


function _injectMarkReminder(message, live) {
  if (!message.getFlag(M, 'markReminder')) return;
  const panel = live.querySelector(DSTD_PANEL);
  if (!panel) return;
  for (const row of panel.querySelectorAll(`.${DSTD}-status-row`)) {
    row.style.display = 'none';
  }
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
  };
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
    btn.dataset.tooltip = 'FM Applied';
  } else {
    btn.disabled = false;
    btn.replaceChildren(_makeIcon(_fmQuickIcon(movementType)), _makeSpan(String(distance)));
    btn.dataset.tooltip = `${movementType.charAt(0).toUpperCase() + movementType.slice(1)} ${distance}`;
  }
}

function _syncRow(fmRow, applyBtn, undoBtn, modBtn, state, label) {
  if (state.applied) {
    fmRow.classList.add('is-applied');
    fmRow.classList.remove('is-undone');
    applyBtn.disabled = true;
    applyBtn.replaceChildren(_makeIcon('fa-solid fa-check'), _makeSpan(`Applied: ${label}`));
    undoBtn.disabled = !state.undoMsgId;
    if (state.undoMsgId) undoBtn.dataset.dsctFmMsgId = state.undoMsgId;
    modBtn.disabled = true;
  } else {
    fmRow.classList.remove('is-applied');
    if (state.undoMsgId) fmRow.classList.add('is-undone');
    applyBtn.disabled = false;
    applyBtn.replaceChildren(_makeIcon('fa-solid fa-person-walking-arrow-right'), _makeSpan(label));
    undoBtn.disabled = true;
    modBtn.disabled = false;
  }
}

async function _persistDstdState(message, subKey, state) {
  const stackData = (state.modStack ?? []).map(e => ({
    modState: e.modState, noteName: e.noteName, noteDesc: e.noteDesc,
  }));
  const allState  = foundry.utils.deepClone(message.getFlag(M, 'dstdFmState') ?? {});
  allState[subKey] = { applied: state.applied, undoMsgId: state.undoMsgId ?? null, modStack: stackData };
  const api = getModuleApi();
  if (api?.socket) api.socket.executeAsGM('dsct.updateDocument', message.uuid, { [`flags.${M}.dstdFmState`]: allState });
  else await message.setFlag(M, 'dstdFmState', allState);
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

async function _injectFmButtons(message, root) {
  const panel = root?.querySelector(DSTD_PANEL);
  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons msgId=${message.id} hasPanel=${!!panel}`);
  if (!panel) return;
  _installUndoDeathHook(panel);
  _installSquadHoverListeners(panel, message);




  const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  for (const deadRow of panel.querySelectorAll(DSTD_ROW)) {
    const dk = deadRow.dataset.targetKey;
    if (!dk || dk === 'selected-token') continue;
    if (deadRow.querySelector('.is-applied')) continue;
    const deadDoc = await fromUuid(dk.replace(/__/g, '.')).catch(() => null);
    if (deadDoc?.actor?.statuses?.has(defeatedStatus)) {
      if (getSetting('debugMode')) console.log(`DSCT | DSTD compat | removing dead target row ${dk}`);
      deadRow.remove();
    }
  }

  _installGlobalDamageButtons(panel, message);
  if (!game.users.activeGM?.isSelf && !getSetting('playerCanUndoDstdDeaths')) {
    for (const btn of panel.querySelectorAll('[data-dstd-action="undoDamage"]')) btn.disabled = true;
  }

  const parts       = _getMessageParts(message);
  const abilityUuid = parts.find(p => p.abilityUuid)?.abilityUuid
                   ?? message.flags?.[DSTD]?.state?.abilityUuid;
  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons abilityUuid=${abilityUuid}`);
  if (!abilityUuid) return;
  const ability = await fromUuid(abilityUuid).catch(() => null);
  if (!ability) return;

  const dsid     = getItemDsid(ability);
  const maxGrabs = MULTI_GRAB_LIMITS[dsid] ?? 1;

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
      result.push({ statusId, endStr, label: displayLabel });
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
    } else if (_pendingSquadMap) {
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
        uuidMap[tok.document.uuid.replace(/\./g, '__')] = { extraMinions: entry.extraMinions, freeStrike: fs, minionIds };
      }
      if (getSetting('debugMode')) console.log(`DSCT | squadMap | uuidMap built, keys=`, Object.keys(uuidMap));
      if (Object.keys(uuidMap).length) {
        window._dsctSquadTargetCache.set(message.id, uuidMap);
        squadTargetMap = uuidMap;
        const mapWrite = { [`flags.${M}.squadTargetMap`]: uuidMap };
        if (game.users.activeGM?.isSelf) {
          if (getSetting('debugMode')) console.log(`DSCT | squadMap | writing to DB as GM`);
          message.update(mapWrite).catch((e) => { if (getSetting('debugMode')) console.error('DSCT | squadMap | DB write failed:', e); });
        } else {
          if (getSetting('debugMode')) console.log(`DSCT | squadMap | writing to DB via socket`);
          getModuleApi(false)?.socket?.executeAsGM('dsct.updateDocument', message.uuid, mapWrite);
        }
      }
      consumePendingSquadMap();
    }
  }
  const doSquad = !!squadTargetMap && getSetting('squadTargetBonus');
  if (getSetting('debugMode')) console.log(`DSCT | squadMap | doSquad=${doSquad} squadTargetBonus=${getSetting('squadTargetBonus')} squadTargetMap=${!!squadTargetMap}`);

  if (!tier && !doMark && !doJudgement && !descEnrichers.length && !doSquad) return;

  const fmEffects = tier ? Array.from(ability.system?.power?.effects ?? [])
    .filter(e => e.forced && typeof e.forced === 'object') : [];
  const appliedEffects = tier ? Array.from(ability.system?.power?.effects ?? [])
    .filter(e => e.applied && typeof e.applied === 'object') : [];

  const dstdState       = message.flags?.[DSTD]?.state;
  const sourceTokenUuid = dstdState?.sourceTokenUuid;
  const sourceDoc       = sourceTokenUuid ? await fromUuid(sourceTokenUuid).catch(() => null) : null;
  const sourceToken     = sourceDoc?.object ?? null;
  const sourceActor     = sourceToken?.actor ?? null;

  const hasPurifyingFire = getSetting('purifyingFireEnabled') && !!sourceActor?.items?.some(i =>
    getItemDsid(i) === 'purifying-fire' || i.name.toLowerCase() === 'purifying fire'
  );
  const holyRolls = hasPurifyingFire ? _getHolyRolls(message) : [];

  const doFm         = fmEffects.length > 0;
  const doConditions = appliedEffects.length > 0 &&
    (getSetting('grabEnabled') || getSetting('frightenedEnabled') || getSetting('tauntedEnabled'));
  const doPf         = holyRolls.length > 0;

  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons fmEffects=${fmEffects.length} appliedEffects=${appliedEffects.length} tier=${tier} doFm=${doFm} doConditions=${doConditions} doMark=${doMark} doJudgement=${doJudgement} doPf=${doPf}`);
  if (!doFm && !doConditions && !doPf && !doMark && !doJudgement && !descEnrichers.length && !doSquad) return;

  const savedFlagState = message.getFlag(M, 'dstdFmState') ?? {};

  const targetRows = panel.querySelectorAll(DSTD_ROW);
  if (getSetting('debugMode')) console.log(`DSCT | _injectFmButtons found ${targetRows.length} target rows`);

  for (const row of targetRows) {
    const targetKey = row.dataset.targetKey;
    if (!targetKey) continue;
    
    const tokenUuid = targetKey === 'selected-token' ? null : targetKey.replace(/__/g, '.');

    const body = row.querySelector(`.${DSTD}-target-body`);
    if (!body) continue;
    const actions = body.querySelector(`.${DSTD}-target-actions`) ?? body;

    for (const effect of fmEffects) {
      if (!doFm) break;
      const tierData = effect.forced?.[`tier${tier}`];
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

      const verticalDistance = ability.getFlag(M, `fmVerticalDistance${tier}`) ?? 0;
      const fallRed1         = ability.getFlag(M, 'fmFallReduction1') ?? 0;
      const fallRedN         = ability.getFlag(M, `fmFallReduction${tier}`);
      const fallReduction    = fallRedN != null ? fallRedN : fallRed1;

      for (const movementType of movementSet) {
        if (!movementType) continue;
        const stateKey = `${message.id}:${targetKey}:${movementType}`;
        const subKey   = `${targetKey}:${movementType}`;

        if (actions.querySelector(`[data-dsct-fm-key="${stateKey}"]`)) continue;

        const baseState = _buildBaseState(movementType, baseDistance, properties, verticalDistance, fallReduction);

        
        
        let quickBtn = null;

        
        let saved = _fmState.get(stateKey);
        if (!saved) {
          const fromFlags = savedFlagState[subKey];
          saved = fromFlags
            ? { applied: fromFlags.applied ?? false, undoMsgId: fromFlags.undoMsgId ?? null, modStack: (fromFlags.modStack ?? []).map(e => ({ ...e })) }
            : { applied: false, undoMsgId: null, modStack: [] };
          _fmState.set(stateKey, saved);
        }

        const label = _makeLabel(_effectiveState(baseState, saved.modStack));

        const applyBtn = document.createElement('button');
        applyBtn.type         = 'button';
        applyBtn.className    = `${DSTD}-action-button ${DSTD}-stretch-button`;
        applyBtn.dataset.tooltip = label;

        const undoBtn = document.createElement('button');
        undoBtn.type         = 'button';
        undoBtn.className    = `${DSTD}-icon-button ${DSTD}-undo-button dsct-dstd-undo-btn`;
        undoBtn.dataset.tooltip = 'Undo FM';
        undoBtn.append(_makeIcon('fa-solid fa-rotate-left'));

        const modBtn = document.createElement('button');
        modBtn.type         = 'button';
        modBtn.className    = `${DSTD}-icon-button ${DSTD}-cog-button dsct-dstd-modify-btn`;
        modBtn.dataset.tooltip = 'Modify FM';
        modBtn.append(_makeIcon('fa-solid fa-gear'));

        const fmRow = document.createElement('div');
        fmRow.className         = `${DSTD}-action-row dsct-dstd-fm-row`;
        fmRow.dataset.dsctFmKey = stateKey;
        fmRow.append(applyBtn, undoBtn, modBtn);

        _syncRow(fmRow, applyBtn, undoBtn, modBtn, saved, label);

        
        
        
        const makePersistFn = () => async (_msgEl, stack) => {
          const cur     = _fmState.get(stateKey) ?? { applied: false, undoMsgId: null, modStack: [] };
          const newMods = { ...cur, modStack: stack.map(e => ({ modState: e.modState, noteName: e.noteName, noteDesc: e.noteDesc })) };
          _fmState.set(stateKey, newMods);
          if (!newMods.applied) {
            const effState = _effectiveState(baseState, newMods.modStack);
            const effLabel = _makeLabel(effState);
            applyBtn.replaceChildren(_makeIcon('fa-solid fa-person-walking-arrow-right'), _makeSpan(effLabel));
            applyBtn.dataset.tooltip = effLabel;
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

          applyBtn.disabled = true;

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

          try {
            await runForcedMovement({
              movement: clickState.movement, distance: String(clickState.distance),
              properties: props, verticalDistance: vertDist, fallReduction: clickState.fallReduction,
              target: targetToken, source: sourceToken,
            });
          } catch {  }

          Hooks.off('createChatMessage', hookId);

          if (!capturedMsgId) {
            
            const prevState = _fmState.get(stateKey) ?? saved;
            const prevEff   = _effectiveState(baseState, prevState.modStack);
            _syncRow(fmRow, applyBtn, undoBtn, modBtn, prevState, _makeLabel(prevEff));
            if (quickBtn) _syncQuickBtn(quickBtn, prevState, movementType, prevEff.distance);
            return;
          }

          const newState = { ...cur, applied: true, undoMsgId: capturedMsgId };
          _fmState.set(stateKey, newState);
          _syncRow(fmRow, applyBtn, undoBtn, modBtn, newState, _makeLabel(clickState));
          if (quickBtn) _syncQuickBtn(quickBtn, newState, movementType, clickState.distance);
          await _persistDstdState(message, subKey, newState);
        });

        undoBtn.addEventListener('click', async (e) => {
          e.stopPropagation(); e.preventDefault();
          if (undoBtn.disabled) return;
          const msgId = undoBtn.dataset.dsctFmMsgId;
          if (!msgId) return;

          const chatLi   = document.querySelector(`[data-message-id="${msgId}"]`);
          const dsctUndo = chatLi?.querySelector('.dsct-undo-fm');
          if (dsctUndo) {
            dsctUndo.click();
          } else {
            ui.notifications.warn('DSCT | Could not find FM undo button in chat log');
            return;
          }

          const cur      = _fmState.get(stateKey) ?? saved;
          const newState = { ...cur, applied: false, undoMsgId: msgId };
          _fmState.set(stateKey, newState);
          const undoEff  = _effectiveState(baseState, newState.modStack);
          _syncRow(fmRow, applyBtn, undoBtn, modBtn, newState, _makeLabel(undoEff));
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
            [applyBtn], _makeLabel, actions, actions, makePersistFn(),
          ).render({ force: true });
        });

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

          
          for (const qdBtn of head.querySelectorAll(`.${DSTD}-quick-damage:not(.dsct-dstd-quick-fm-btn):not([data-dsct-condensed])`)) {
            const fullText = qdBtn.textContent.trim();
            if (!qdBtn.dataset.tooltip) qdBtn.dataset.tooltip = fullText;
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
            createModifierNoteDiv(entry, saved.modStack, [panelBase], panelStates, [applyBtn], _makeLabel, actions, actions, makePersistFn());
          }
        }
      }
    }

    if (doConditions) {
      for (const effect of appliedEffects) {
        const tierData = effect.applied?.[`tier${tier}`];
        if (!tierData?.effects) continue;
        const effectEntries = tierData.effects instanceof Map
          ? [...tierData.effects.entries()]
          : Object.entries(tierData.effects);

        for (const [effectId, effectData] of effectEntries) {
          const condKey = `${targetKey}:cond:${effectId}`;
          if (actions.querySelector(`[data-dsct-dstd-cond="${condKey}"]`)) continue;
          const endStr = effectData?.end ?? '';

          if (effectId === 'grabbed' && getSetting('grabEnabled')) {
            const grabBtn = document.createElement('button');
            grabBtn.type      = 'button';
            grabBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
            grabBtn.dataset.dsctDstdCond = condKey;
            grabBtn.dataset.tooltip = 'Holding Shift bypasses restrictions';
            grabBtn.append(_makeIcon('fa-solid fa-hand-rock'), _makeSpan('Grabbed'));
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
                if (!canForcedMoveTarget(sourceToken.actor, targetToken.actor)) {
                  ui.notifications.warn(game.i18n.format('DSCT.notice.sys.grabTargetTooLarge', { grabber: sourceToken.name, target: targetToken.name }));
                  return;
                }
              }
              if (dsid === 'grab') await runGrab(sourceToken, targetToken, { tier, maxGrabs, ignoreSizeCheck: shiftBypass });
              else {
                await applyGrab(sourceToken, targetToken, { maxGrabs });
                ChatMessage.create({ content: `<strong>Grab:</strong> ${sourceToken.name} grabs ${targetToken.name}!` });
              }
            });
            const grabRow = document.createElement('div');
            grabRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
            grabRow.append(grabBtn);
            actions.appendChild(grabRow);
          }

          else if (effectId === 'frightened' && getSetting('frightenedEnabled')) {
            const condBtn = document.createElement('button');
            condBtn.type      = 'button';
            condBtn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
            condBtn.dataset.dsctDstdCond = condKey;
            condBtn.dataset.tooltip = 'Apply Frightened';
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
            condBtn.dataset.tooltip = 'Apply Taunted';
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

    if (doPf && tokenUuid) {
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
          pfBtn.dataset.tooltip = game.i18n.format('DSCT.button.purifyingFireDamage', { amount });
          pfBtn.append(_makeIcon('fa-solid fa-fire'), _makeSpan(game.i18n.format('DSCT.button.purifyingFireDamage', { amount })));
          pfBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); e.preventDefault();
            const fireAmount = e.shiftKey ? Math.floor(amount / 2) : amount;
            await applyDamage(pfTargetActor, fireAmount, undefined, { damageType: 'fire' });
          });
          const pfRow = document.createElement('div');
          pfRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
          pfRow.append(pfBtn);
          actions.appendChild(pfRow);
        }
      }
    }

    if (doMark) {
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
        markBtn.dataset.tooltip     = markIsApplied ? appliedLbl : applyLbl;
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
        undoMarkBtn.dataset.tooltip = 'Undo Mark';
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
          markBtn.dataset.tooltip = appliedLbl;
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
          markBtn.dataset.tooltip = applyLbl;
        });

        const markRow = document.createElement('div');
        markRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
        markRow.append(markBtn, undoMarkBtn);
        actions.appendChild(markRow);
      }
    }

    if (doJudgement) {
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
        judgeBtn.dataset.tooltip      = judgeIsApplied ? 'Applied: Judgement' : 'Apply Judgement';
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
        undoJudgeBtn.dataset.tooltip = 'Undo Judgement';
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
          judgeBtn.dataset.tooltip = 'Applied: Judgement';
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
          judgeBtn.dataset.tooltip = 'Apply Judgement';
        });

        const judgeRow = document.createElement('div');
        judgeRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
        judgeRow.append(judgeBtn, undoJudgeBtn);
        actions.appendChild(judgeRow);
      }
    }

    
    for (const { statusId, endStr, label: enrichLabel } of descEnrichers) {
      const enrichKey = `${targetKey}:enrich:${statusId}`;
      if (actions.querySelector(`[data-dsct-enrich-key="${enrichKey}"]`)) continue;
      if (actions.querySelector(`[data-dsct-dstd-cond*=":cond:${statusId}"]`)) continue;

      const targetDocE   = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
      const targetActorE = targetDocE?.object?.actor ?? targetDocE?.actor ?? null;
      const isApplied    = statusId === 'taunted'
        ? !!targetActorE?.appliedEffects?.some(e => e.getFlag(M, 'taunted'))
        : statusId === 'frightened'
          ? !!targetActorE?.appliedEffects?.some(e => e.getFlag(M, 'frightened'))
          : !!targetActorE?.statuses?.has(statusId);

      const applyLbl   = `Apply ${enrichLabel}`;
      const appliedLbl = `Applied: ${enrichLabel}`;

      const enrichBtn = document.createElement('button');
      enrichBtn.type = 'button';
      enrichBtn.classList.add(`${DSTD}-action-button`, `${DSTD}-stretch-button`);
      enrichBtn.dataset.dsctEnrichKey = enrichKey;
      enrichBtn.dataset.tooltip = isApplied ? appliedLbl : applyLbl;
      enrichBtn.disabled = isApplied;
      const enrichSpan = document.createElement('span');
      enrichSpan.textContent = isApplied ? appliedLbl : applyLbl;
      enrichBtn.append(_makeIcon('fa-solid fa-person-rays'), enrichSpan);

      const undoEnrichBtn = document.createElement('button');
      undoEnrichBtn.type = 'button';
      undoEnrichBtn.classList.add(`${DSTD}-icon-button`, `${DSTD}-undo-button`);
      undoEnrichBtn.dataset.tooltip = `Undo ${enrichLabel}`;
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
        if (statusId === 'taunted' && sourceActor)         await applyTaunted(targetToken, sourceActor, sourceToken?.id ?? null, endStr);
        else if (statusId === 'frightened' && sourceActor) await applyFrightened(targetToken, sourceActor, sourceToken?.id ?? null, endStr);
        else {
          const tmp = await CONFIG.ActiveEffect.documentClass.fromStatusEffect(statusId).catch(() => null);
          if (tmp) {
            const data = foundry.utils.mergeObject(tmp.toObject(), { transfer: true });
            if (endStr && ds?.CONFIG?.effectEnds?.[endStr]) data.duration = { expiry: ds.CONFIG.effectEnds[endStr].expiryEvent };
            if (targetToken.actor) await targetToken.actor.createEmbeddedDocuments('ActiveEffect', [data]);
          }
        }
        enrichBtn.disabled        = true;
        undoEnrichBtn.disabled    = false;
        enrichSpan.textContent    = appliedLbl;
        enrichBtn.dataset.tooltip = appliedLbl;
      });

      undoEnrichBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        const d     = tokenUuid ? await fromUuid(tokenUuid).catch(() => null) : null;
        const actor = d?.object?.actor ?? d?.actor ?? null;
        if (actor) {
          for (const ef of [...(actor.appliedEffects ?? actor.effects)]) {
            if (ef.getFlag(M, statusId) || ef.statuses?.has(statusId)) await safeDelete(ef);
          }
        }
        enrichBtn.disabled        = false;
        undoEnrichBtn.disabled    = true;
        enrichSpan.textContent    = applyLbl;
        enrichBtn.dataset.tooltip = applyLbl;
      });

      const enrichRow = document.createElement('div');
      enrichRow.className = `${DSTD}-action-row dsct-dstd-condition-row`;
      enrichRow.append(enrichBtn, undoEnrichBtn);
      actions.appendChild(enrichRow);
    }

    if (doSquad && squadTargetMap && tokenUuid) {
      const sqEntry   = squadTargetMap[targetKey];
      const minionIds = sqEntry?.minionIds ?? [];
      if (getSetting('debugMode')) console.log(`DSCT | squad Phase3 | row tokenUuid=${tokenUuid} sqEntry=`, sqEntry);

      
      if (sqEntry?.extraMinions > 0 && sqEntry.freeStrike > 0) {
        const bonus          = sqEntry.extraMinions * sqEntry.freeStrike;
        const dstdMsgState   = message.flags?.[DSTD]?.state ?? null;
        const nativeApplyBtn = actions.querySelector('[data-dstd-action="applyDamage"]');
        const operationId    = nativeApplyBtn?.dataset?.operationId;
        const qdBtn          = row.querySelector(`.${DSTD}-quick-damage:not(.dsct-dstd-quick-fm-btn)`);
        if (getSetting('debugMode')) console.log(`DSCT | squad Phase3 | bonus=${bonus} operationId=${operationId} hasState=${!!dstdMsgState}`);
        if (operationId && dstdMsgState) {
          const existingOverride = dstdMsgState.damageOverrides?.[operationId];
          if (existingOverride?.bonus !== bonus) {
            const baseText   = qdBtn?.textContent ?? nativeApplyBtn?.textContent ?? '';
            const base       = parseInt(baseText.match(/\d+/)?.[0] ?? '0');
            const typeClass  = [...(qdBtn?.classList ?? [])].find(c => c.includes('-damage-type-'));
            const damageType = typeClass?.split('-damage-type-')[1] ?? existingOverride?.damageType ?? '';
            const typeLabel  = existingOverride?.typeLabel || (damageType && damageType !== 'untyped' ? damageType.charAt(0).toUpperCase() + damageType.slice(1) : '');
            if (base > 0 && game.users.activeGM?.isSelf) {
              message.update({
                [`flags.${DSTD}.state.damageOverrides.${operationId}`]: {
                  amount: base + bonus, baseAmount: base, bonus,
                  additional: String(bonus), damageType, typeLabel,
                  surges: 0, surgeDamage: 0, surgeBonus: 0,
                },
                [`flags.${M}.squadTargetMap`]: squadTargetMap,
              }).catch(() => {});
            }
          }
          const strikesLabel = sqEntry.extraMinions === 1
            ? `+${bonus} from 1 extra free strike`
            : `+${bonus} from ${sqEntry.extraMinions} extra free strikes`;
          const squadTooltip = `${strikesLabel}<hr>Hold Shift to deal half damage`;
          if (getSetting('debugMode')) console.log(`DSCT | squadTooltip | setting tooltip="${squadTooltip}" on operationId=${operationId}`);
          for (const btn of row.querySelectorAll('[data-dstd-action="applyDamage"]')) {
            if (btn.dataset.operationId !== operationId) continue;
            btn.dataset.tooltip = squadTooltip;
          }
          if (qdBtn) qdBtn.dataset.tooltip = squadTooltip;
        }
      }
    }

    if (body.querySelector('[data-dsct-dstd-cond], [data-dsct-fm-key], [data-dsct-mark-key], [data-dsct-enrich-key], [data-dsct-judge-key]')) {
      const muted = body.querySelector(`.${DSTD}-muted`);
      if (muted) muted.hidden = true;
    }
  }

  _restoreCollapseState(message.id, panel);
  if (!panel.dataset.dsctCollapseTracked) {
    panel.dataset.dsctCollapseTracked = '1';
    panel.addEventListener('click', (e) => {
      if (!e.target.closest('[data-dstd-action="toggleTarget"]')) return;
      setTimeout(() => _saveCollapseState(message.id, panel), 0);
    });
  }

}
