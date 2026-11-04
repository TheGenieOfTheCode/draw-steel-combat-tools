import { getSetting } from './helpers.mjs';
import { isPrimaryGM } from './ctlib.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'hostileNeutrals';
const NONCOMBATANT_ID = 'n6KfPTM9QRvDr4x2';
const L = (key, data) => data
  ? game.i18n.format(`DSCT.chat.hostileNeutrals.${key}`, data)
  : game.i18n.localize(`DSCT.chat.hostileNeutrals.${key}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
const plain = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

const _isNoncombatant = (t) => {
  const actors = [t.actor, t.baseActor];
  return [t.name, ...actors.map(a => a?.name)].some(n => plain(n) === 'noncombatant')
    || actors.some(a => String(a?._stats?.compendiumSource ?? '').endsWith(`.${NONCOMBATANT_ID}`));
};

const _npcTokens = (combatants) => {
  const seen = new Map();
  for (const c of combatants) {
    const t = c.token;
    if (t && t.actor?.type === 'npc') seen.set(t.uuid, t);
  }
  return [...seen.values()];
};

const _portrait = (t) => /\.(webm|mp4|m4v|ogv)$/i.test(t.texture?.src ?? '') ? t.actor?.img : (t.texture?.src || t.actor?.img);

const _row = (label, tokens) => !tokens.length ? '' : `<p>${esc(label)}</p><div class="dsct-hn-tokens">${tokens.map(t =>
  `<button type="button" class="dsct-hn-token" data-token-uuid="${t.uuid}" aria-label="${esc(t.name)}">`
  + `<img src="${esc(_portrait(t))}" alt=""></button>`).join('')}</div>`;

function _content(hostile, neutral, secret) {
  return '<div class="dsct-hn">'
    + `<p><strong>${esc(L('title'))}</strong></p>`
    + _row(L('nowHostile'), hostile)
    + _row(L('nowNeutral'), neutral)
    + (hostile.length || neutral.length ? `<p class="dsct-hn-note">${esc(L('undo'))}</p>` : '')
    + (secret.length ? `<p class="dsct-hn-note">${esc(L('secret', { names: secret.map(t => t.name).join(', ') }))}</p>` : '')
    + '</div>';
}

async function _convert(tokens) {
  const { NEUTRAL, HOSTILE, SECRET } = CONST.TOKEN_DISPOSITIONS;
  const hostile = [], neutral = [], secret = [];
  for (const t of tokens) {
    if (t.disposition === SECRET) secret.push(t);
    else if (_isNoncombatant(t)) { if (t.disposition === HOSTILE) neutral.push(t); }
    else if (t.disposition === NEUTRAL) hostile.push(t);
  }
  if (!hostile.length && !neutral.length && !secret.length) return;

  const byScene = new Map();
  const queue = (t, disposition) => {
    if (!byScene.has(t.parent)) byScene.set(t.parent, []);
    byScene.get(t.parent).push({ _id: t.id, disposition });
  };
  for (const t of hostile) queue(t, HOSTILE);
  for (const t of neutral) queue(t, NEUTRAL);
  for (const [scene, updates] of byScene) await scene.updateEmbeddedDocuments('Token', updates);

  await ChatMessage.create({
    content: _content(hostile, neutral, secret),
    whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
    flags: { [M]: { [FLAG]: Object.fromEntries([...hostile.map(t => [t.id, HOSTILE]), ...neutral.map(t => [t.id, NEUTRAL])]) } },
  });
}

function _syncButton(btn, msg) {
  const { NEUTRAL, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  const token = fromUuidSync(btn.dataset.tokenUuid);
  const set = msg?.getFlag(M, FLAG)?.[token?.id];
  const name = token?.name ?? btn.getAttribute('aria-label');
  btn.disabled = !token || !game.user.isGM;
  btn.classList.toggle('is-neutral', token?.disposition === NEUTRAL);
  btn.classList.toggle('is-reverted', !!token && set !== undefined && token.disposition !== set);
  btn.classList.toggle('is-gone', !token);
  const line = !token ? L('gone') : token.disposition === HOSTILE ? L('tipHostile') : L('tipNeutral');
  btn.dataset.tooltipHtml = `<strong>${esc(name)}</strong><br>${esc(line)}`;
}

export const registerHostileNeutralHooks = () => {
  Hooks.on('combatStart', (combat) => {
    if (!game.user.isGM || !getSetting('neutralFoesHostile')) return;
    _convert(_npcTokens(combat.combatants));
  });

  const pending = new Map();
  let timer = null;
  Hooks.on('createCombatant', (combatant) => {
    if (!isPrimaryGM() || !getSetting('neutralFoesHostile')) return;
    const combat = combatant.parent;
    if (!combat?.started) return;
    if (!pending.has(combat)) pending.set(combat, new Set());
    pending.get(combat).add(combatant.id);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const batches = [...pending];
      pending.clear();
      for (const [c, ids] of batches) _convert(_npcTokens([...ids].map(id => c.combatants.get(id)).filter(Boolean)));
    }, 300);
  });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!msg.getFlag(M, FLAG)) return;
    for (const btn of el.querySelectorAll('.dsct-hn-token')) {
      _syncButton(btn, msg);
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const token = fromUuidSync(btn.dataset.tokenUuid);
        if (!token || !game.user.isGM) return;
        const { NEUTRAL, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
        await token.update({ disposition: token.disposition === HOSTILE ? NEUTRAL : HOSTILE });
      });
      btn.addEventListener('pointerenter', (e) => fromUuidSync(btn.dataset.tokenUuid)?.object?._onHoverIn?.(e, { hoverOutOthers: true }));
      btn.addEventListener('pointerleave', (e) => fromUuidSync(btn.dataset.tokenUuid)?.object?._onHoverOut?.(e));
    }
  });

  Hooks.on('updateToken', (token, changes) => {
    if (!('disposition' in changes)) return;
    for (const btn of document.querySelectorAll(`.dsct-hn-token[data-token-uuid="${token.uuid}"]`)) {
      _syncButton(btn, game.messages.get(btn.closest('[data-message-id]')?.dataset.messageId));
    }
  });
};
