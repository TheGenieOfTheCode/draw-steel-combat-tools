import { getSetting, applyFall, surfaceUnder, canCurrentlyFly, replayUndo, safeUpdate } from '../helpers.mjs';
import { isPrimaryGM } from '../ctlib.mjs';
import { setTip } from '../chat-tips.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'systemFall';
const L = (key) => game.i18n.localize(`DSCT.fall.${key}`);

const fallingParts = (message) => (message.system?.parts?.contents ?? []).filter((p) => p.type === 'falling');
const movementOwnsFalls = () => !!game.modules.get('draw-steel-forced-movement')?.active;

const stateOf = (message, part) => {
  const raw = message.getFlag(M, `${FLAG}.${part.id}`);
  return raw === true ? { done: true } : raw ?? null;
};
const resolved = (state) => !!state?.done && !state.undone;

const rollsOf = (part) => [...(part.rolls ?? [])];
const editedHeight = (part) => {
  const rolls = rollsOf(part);
  const height = rolls.length > 1 ? Number(rolls.at(-1)?.options?.fallHeight) : NaN;
  return Number.isFinite(height) ? height : null;
};

async function takeSystemFall(message, part, { redo = false } = {}) {
  const doc = part.token;
  const token = doc?.object;
  const fresh = game.messages.get(message.id) ?? message;
  if (!token || (!redo && resolved(stateOf(fresh, part)))) return;
  const autoEdit = !redo && rollsOf(part).length === 1;
  if (autoEdit) {
    const agility = token.actor?.system?.combat?.fall?.agility === false ? 0 : Math.max(0, token.actor?.system?.characteristics?.agility?.value ?? 0);
    const height = Number(part.fallerDistance);
    if (agility > 0 && Number.isFinite(height)) await part.createModifiedFallRoll(rollsOf(part)[0], Math.max(0, height - agility));
  }
  const result = await applyFall(token, surfaceUnder(doc), { skipConfirm: true, silent: true, effective: autoEdit ? null : editedHeight(part) });
  if (!(result?.cancelled || result?.aloft || result?.fallDist > 0)) return;
  const lines = result.aloft ? [game.i18n.format('DSCT.fall.staysAloft', { name: token.name })] : result.lines ?? [];
  const state = { done: true, undone: false, lines, undoLog: result.undoLog ?? [], finalPos: result.finalPos ?? null,
    tokenUuid: doc.uuid, canUndo: result.fallDist > 0,
    rollCount: rollsOf(fallingParts(game.messages.get(message.id) ?? message).find((p) => p.id === part.id) ?? part).length };
  const update = { [`flags.${M}.${FLAG}.${part.id}`]: state };
  if (result.fallDist > 0) Object.assign(update, { [`flags.${M}.fallLog`]: result.fallLog, [`flags.${M}.isUndone`]: false });
  await safeUpdate(fresh, update);
}

async function redoEditedFall(message, part) {
  const state = stateOf(message, part);
  if (!resolved(state) || rollsOf(part).length <= (state.rollCount ?? 1)) return;
  if (state.canUndo) await replayUndo(state.undoLog ?? []);
  await takeSystemFall(message, part, { redo: true });
}

async function editSystemFall(message) {
  const part = fallingParts(message)[0];
  const roll = rollsOf(part ?? {}).at(-1);
  if (part && roll) await part.modifyFallDialog(roll);
}

async function undoSystemFall(message, part) {
  const state = stateOf(message, part);
  if (!resolved(state) || !state.canUndo) return;
  const token = state.tokenUuid ? fromUuidSync(state.tokenUuid) : null;
  const final = state.finalPos;
  if (getSetting('undoExpirationCheck') && token && final
    && (token.x !== final.x || token.y !== final.y || (token.elevation ?? 0) !== final.elevation)) {
    ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.undoExpiredMoved'));
    return;
  }
  await safeUpdate(message, { [`flags.${M}.${FLAG}.${part.id}.undone`]: true, [`flags.${M}.isUndone`]: true });
  await replayUndo(state.undoLog ?? []);
  ui.notifications.info(L('undoneNotice'));
}

function splitFallButton(message, part, button) {
  const state = stateOf(message, part);
  const done = resolved(state);
  let wrap = button.parentElement?.classList.contains('ctlib-split') ? button.parentElement : null;
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.className = 'ctlib-split dsct-fall-split';
    button.before(wrap);
    wrap.append(button);
  }
  button.classList.toggle('ctlib-applied', done);
  wrap.classList.toggle('ctlib-split-applied', done);
  if (done && state.lines?.length) setTip(button, { title: L('tipTitle'), html: state.lines.join('<br>') });
  wrap.querySelector(':scope > .ctlib-undo')?.remove();
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ctlib-undo';
  back.innerHTML = '<i class="fa-solid fa-rotate-left" inert></i>';
  back.setAttribute('aria-label', L('undo'));
  back.dataset.tooltip = L('undo');
  const off = !(done && state.canUndo && (game.user.isGM || message.isAuthor));
  back.classList.toggle('ctlib-undo-off', off);
  back.setAttribute('aria-disabled', String(off));
  back.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (back.classList.contains('ctlib-undo-off')) return;
    back.classList.add('ctlib-undo-off');
    await undoSystemFall(game.messages.get(message.id) ?? message, part);
  });
  wrap.append(back);
}

const pending = new Set();
const inCombat = (doc) => !!game.combat?.started
  && game.combat.combatants.some((c) => c.tokenId === doc.id && c.sceneId === doc.parent?.id);

async function fallIfUnsupported(doc) {
  if (!doc?.actor || doc.hidden || pending.has(doc.id) || !inCombat(doc) || canCurrentlyFly(doc.actor)) return;
  const dist = (doc.elevation ?? 0) - surfaceUnder(doc);
  if (!(dist > 0)) return;
  pending.add(doc.id);
  setTimeout(() => pending.delete(doc.id), 3000);
  await doc.actor.system?.processFall?.(doc.object, dist);
}

const OWN_LANDING = new Set(['teleport', 'forced', 'displace', 'fall', 'burrow', 'climb']);
const flying = new Set();
const airborne = (doc) => (doc.elevation ?? 0) > surfaceUnder(doc);
const remember = (doc) => {
  if (doc.actor && airborne(doc) && canCurrentlyFly(doc.actor)) flying.add(doc.id);
  else flying.delete(doc.id);
};

function registerImmediateFalls() {
  const live = () => getSetting('forcedMovementEnabled') && !movementOwnsFalls();
  Hooks.on('moveToken', (doc, movement, operation, user) => {
    if (movement.pending?.waypoints?.length) return;
    const settle = async () => {
      if (doc.rendered) await doc.object.movementAnimationPromise;
      const action = movement.passed?.waypoints?.at(-1)?.action ?? doc.movementAction;
      const own = movement.method === 'undo' || operation?.dsMovement || operation?.isUndo || OWN_LANDING.has(action);
      if (user.isSelf && live() && !own) await fallIfUnsupported(doc);
      remember(doc);
    };
    settle().catch((err) => console.warn('DSCT | immediate fall', err));
  });
  const recheck = (actor) => {
    if (!actor || !live() || !isPrimaryGM() || !canvas.scene) return;
    for (const token of actor.getActiveTokens?.(true) ?? []) {
      const doc = token.document ?? token;
      if (doc.parent !== canvas.scene) continue;
      if (flying.has(doc.id) && !canCurrentlyFly(actor)) {
        flying.delete(doc.id);
        fallIfUnsupported(doc).catch((err) => console.warn('DSCT | immediate fall', err));
      } else remember(doc);
    }
  };
  Hooks.on('canvasReady', () => {
    flying.clear();
    for (const t of canvas.tokens?.placeables ?? []) if (t.actor) remember(t.document);
  });
  const onEffect = (effect) => recheck(effect.parent?.documentName === 'Actor' ? effect.parent : effect.parent?.actor);
  Hooks.on('createActiveEffect', onEffect);
  Hooks.on('deleteActiveEffect', onEffect);
  Hooks.on('updateActiveEffect', onEffect);
  Hooks.on('updateActor', (actor, changes) => {
    if (foundry.utils.hasProperty(changes, 'system.movement') || changes.statuses) recheck(actor);
  });
}

function registerFallUndo() {
  Hooks.on('renderChatMessageHTML', (msg, html) => {
    if (!msg.getFlag(M, 'isFallUndo')) return;
    let area = html.querySelector('.message-part-buttons');
    if (!area) {
      area = document.createElement('div');
      area.className = 'message-part-buttons';
      (html.querySelector('.message-content') ?? html).appendChild(area);
    }
    if (msg.getFlag(M, 'isUndone')) {
      const div = document.createElement('div');
      div.className = 'dsct-undo-status';
      div.textContent = L('undone');
      area.appendChild(div);
      return;
    }
    if (!(game.user.isGM || msg.isAuthor)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-undo-tp';
    btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${L('undo')}`;
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      const log = msg.getFlag(M, 'fallLog');
      const final = msg.getFlag(M, 'finalPos');
      const token = game.scenes.get(log?.targetSceneId)?.tokens.get(log?.targetTokenId);
      if (getSetting('undoExpirationCheck') && token && final
        && (token.x !== final.x || token.y !== final.y || (token.elevation ?? 0) !== final.elevation)) {
        ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.undoExpiredMoved'));
        return;
      }
      await safeUpdate(msg, { [`flags.${M}.isUndone`]: true });
      await replayUndo(msg.getFlag(M, 'undoLog') ?? []);
      ui.notifications.info(L('undoneNotice'));
    });
    area.appendChild(btn);
  });
}

export function registerSystemFalls() {
  registerFallUndo();
  if (!globalThis.ds?.CONFIG?.MessagePart?.fall) return;
  registerImmediateFalls();
  Hooks.on('createChatMessage', (message) => {
    if (!getSetting('forcedMovementEnabled') || !getSetting('fallAutoResolve') || !isPrimaryGM()) return;
    for (const part of fallingParts(message)) {
      takeSystemFall(message, part).catch((err) => console.error('DSCT | system fall', err));
    }
  });
  Hooks.on('updateChatMessage', (message) => {
    if (!getSetting('forcedMovementEnabled') || !isPrimaryGM()) return;
    for (const part of fallingParts(message)) {
      redoEditedFall(message, part).catch((err) => console.error('DSCT | edited fall', err));
    }
  });
  Hooks.once('ready', () => {
    game.modules.get('draw-steel-battle-log')?.api?.registerMoveSource?.({
      flags: (m) => (fallingParts(m).length && m.flags?.[M]?.fallLog ? m.flags[M] : null),
      html: (m) => {
        const part = fallingParts(m)[0];
        return part ? stateOf(m, part)?.lines?.join('<br>') ?? null : null;
      },
      undo: (m) => {
        const part = fallingParts(m)[0];
        return part ? undoSystemFall(m, part) : null;
      },
      edit: (m) => editSystemFall(m),
    });
  });
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!getSetting('forcedMovementEnabled')) return;
    for (const part of fallingParts(message)) {
      const section = html.querySelector(`section[data-message-part="${part.id}"]`);
      if (!section) continue;
      section.querySelectorAll('[data-action="applyDamage"]').forEach((el) => el.remove());
      const button = section.querySelector('[data-action="fall"]');
      if (!button) continue;
      splitFallButton(message, part, button);
      if (section.dataset.dsctFall) continue;
      section.dataset.dsctFall = '1';
      section.addEventListener('click', (event) => {
        if (!event.target.closest('[data-action="fall"]')) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        takeSystemFall(game.messages.get(message.id) ?? message, part).catch((err) => console.error('DSCT | system fall', err));
      }, true);
    }
  });
}
