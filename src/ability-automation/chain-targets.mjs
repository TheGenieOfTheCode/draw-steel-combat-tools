import { services, registerPanelDecorator, DSTD, DSTD_PANEL } from '../ctlib.mjs';
import { setTip, tipFor } from '../chat-tips.mjs';
import { runMultiTokenPicker } from './target-picker.mjs';
import { _othersCandidates } from '../compat/dstd-compat.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'chain';
const L = (k, data) => (data ? game.i18n.format(`DSCT.chain.${k}`, data) : game.i18n.localize(`DSCT.chain.${k}`));

export const chainSpec = (ability) => {
  const c = ability?.getFlag?.(M, 'chainTargets');
  if (!c) return null;
  return { links: Math.max(1, Number(c.links) || 1), range: Math.max(1, Number(c.range) || 1) };
};

const abilityOf = (message) => {
  const uuid = (message.system?.parts?.contents ?? []).find((p) => p?.abilityUuid)?.abilityUuid ?? message.flags?.[DSTD]?.state?.abilityUuid;
  return uuid ? fromUuidSync(uuid) : null;
};

const canAct = (message) => game.user.isGM || message.isOwner || message.author?.id === game.user.id;

const stateOf = (message) => message.getFlag(M, FLAG) ?? { picked: [], done: false };

const targetUuids = (message) => (message.flags?.[DSTD]?.state?.targets ?? []).map((t) => t.tokenUuid).filter(Boolean);

const speakerToken = (message) => {
  const s = message.speaker ?? {};
  return (s.token ? (game.scenes.get(s.scene) ?? canvas.scene)?.tokens.get(s.token)?.object : null) ?? null;
};

const linkOrigin = (message, st) => {
  const own = targetUuids(message).filter((u) => !st.picked.includes(u));
  return fromUuidSync(st.picked.at(-1) ?? own[0] ?? '')?.object ?? null;
};

const candidatesFor = (message, spec, st) => {
  const origin = linkOrigin(message, st);
  if (!origin) return { origin, tokens: [] };
  const taken = new Set(targetUuids(message));
  const tokens = _othersCandidates({ mode: 'pick', origin: 'target', range: spec.range, disposition: 'any', count: 1, includeSelf: false },
    { sourceToken: speakerToken(message), targetTokens: [origin], ability: abilityOf(message) })
    .filter((t) => !taken.has(t.document.uuid));
  return { origin, tokens };
};

const pending = (message, spec) => {
  const st = stateOf(message);
  return !!spec && !st.done && st.picked.length < spec.links;
};

const addTarget = async (message, token) => {
  const { normalizeTargetToken } = await import('/modules/draw-steel-target-damage/src/target-utils.mjs');
  const entry = normalizeTargetToken(token);
  const st = stateOf(message);
  const targets = [...(message.flags?.[DSTD]?.state?.targets ?? []), entry];
  const picked = [...st.picked, token.document.uuid];
  const spec = chainSpec(abilityOf(message));
  await message.update({
    [`flags.${DSTD}.state.targets`]: targets,
    [`flags.${M}.${FLAG}`]: { picked, done: picked.length >= (spec?.links ?? 0) },
  });
};

const stop = (message) => message.update({ [`flags.${M}.${FLAG}`]: { ...stateOf(message), done: true } });

export async function pickNextLink(message) {
  const spec = chainSpec(abilityOf(message));
  if (!pending(message, spec)) return false;
  const st = stateOf(message);
  const { origin, tokens } = candidatesFor(message, spec, st);
  if (!tokens.length) {
    ui.notifications.info(L('none', { range: spec.range, name: origin?.name ?? '?' }));
    await stop(message);
    return false;
  }
  const chosen = await runMultiTokenPicker({ candidates: tokens, maxTargets: 1,
    hint: L('hint', { n: st.picked.length + 1, total: spec.links, range: spec.range, name: origin.name }) });
  if (!chosen?.length) return false;
  await addTarget(game.messages.get(message.id) ?? message, chosen[0]);
  return true;
}

const runsHere = (message) => message.author?.id === game.user.id || (game.user.isGM && !message.author?.active);

const _settled = new Map();

export function settleChainTargets(message) {
  if (!message || !runsHere(message)) return Promise.resolve(false);
  if (!pending(message, chainSpec(abilityOf(message)))) return Promise.resolve(false);
  if (_settled.has(message.id)) return _settled.get(message.id);
  const run = (async () => {
    let any = false;
    while (await pickNextLink(game.messages.get(message.id) ?? message)) {
      any = true;
      await waitForRow(message.id, stateOf(game.messages.get(message.id)).picked.at(-1));
    }
    return any;
  })().finally(() => _settled.delete(message.id));
  _settled.set(message.id, run);
  return run;
}

const waitForRow = async (msgId, uuid, ms = 3000) => {
  const key = CSS.escape(String(uuid ?? '').replace(/\./g, '__'));
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (document.querySelector(`li.chat-message[data-message-id="${msgId}"] ${DSTD_PANEL} [data-target-key="${key}"]`)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

const pickRow = (message, spec) => {
  const st = stateOf(message);
  const label = L('pick', { n: st.picked.length + 1, total: spec.links });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-link';
  const span = document.createElement('span');
  span.textContent = label;
  btn.append(icon, span);
  setTip(btn, tipFor('chainPick', { title: label, data: { range: spec.range } }));
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (_settled.has(message.id)) return;
    const run = pickNextLink(game.messages.get(message.id) ?? message).finally(() => _settled.delete(message.id));
    _settled.set(message.id, run);
  });
  const row = document.createElement('div');
  row.className = `${DSTD}-action-row dsct-dstd-chain-pick`;
  row.append(btn);
  return row;
};

export function registerChainTargets() {
  services.provide('settleChainTargets', settleChainTargets);
  registerPanelDecorator({ id: 'combat-tools-chain-targets', priority: 60, decorate: ({ message, panel }) => {
    if (!message || !panel || !canAct(message)) return;
    panel.querySelector('.dsct-dstd-chain-pick')?.remove();
    const spec = chainSpec(abilityOf(message));
    if (!pending(message, spec)) return;
    (panel.querySelector(`.${DSTD}-target-list`) ?? panel).append(pickRow(message, spec));
  } });
}
