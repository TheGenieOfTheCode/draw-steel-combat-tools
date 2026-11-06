import { getSetting, isOwnAbilityActor, damageBatch } from '../helpers.mjs';
import { services, safeSetFlag, safeUpdate } from '../ctlib.mjs';
import { setTip, tipFor } from '../chat-tips.mjs';
import { settleCriticalChoice } from '../ability-automation/choose-effect.mjs';
import { _waitForHolds, _waitForChoice, _promptOpen, _resolving } from './dstd-compat.mjs';

const M = 'draw-steel-combat-tools';
const DSTD_ID = 'draw-steel-target-damage';
const L = (k, data) => game.i18n.format(`DSCT.apply12.${k}`, data ?? {});
const lib = () => globalThis.ctlib ?? game.modules.get('draw-steel-ctlib')?.api ?? {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

const SETTLE_MS = 600;
const LAND_MAX_MS = 10000;
const FM_MAX_MS = 15000;
const PROMPT_WAIT_MS = 120000;
const FLAT = /\bdsct-flat-(damage|forced|applied|heal|cleanse|teleport|resource)-btn\b/;
const FLAT_MANUAL = new Set(['forced', 'teleport']);

export const on12 = () => !!ds.CONFIG.MessagePart?.targetResult && !game.modules.get(DSTD_ID)?.active;

const resultParts = (message) => Array.from(message?.system?.parts?.contents ?? []).filter((p) => p.type === 'targetResult');
const abilityOf = (message) => {
  const uuid = Array.from(message?.system?.parts?.contents ?? []).find((p) => p.abilityUuid)?.abilityUuid;
  return uuid ? fromUuidSync(uuid) : null;
};
const liveLi = (id) => ui.chat?.element?.querySelector(`li.chat-message[data-message-id="${id}"]`)
  ?? document.querySelector(`#chat li.chat-message[data-message-id="${id}"]`);
const sectionOf = (root, partId) => root?.querySelector(`section[data-message-part="${partId}"]`);
const marksOf = (message, partId) => message?.flags?.[M]?.applied12?.[partId] ?? [];

export function squadOfPart(part) {
  const token = part?.tokenUuid ? fromUuidSync(part.tokenUuid, { strict: false }) : null;
  if (!token?.actor?.isMinion) return null;
  const combatant = game.combat?.combatants.find((c) => c.tokenId === token.id);
  const group = combatant?.group;
  return group?.type === 'squad' ? group : null;
}

function itemsOf(section) {
  if (!section) return [];
  const items = [];
  section.querySelectorAll('button[data-action="applyDamage"]').forEach((btn, i) => items.push({ kind: 'damage', btn, key: `damage:${btn.dataset.index ?? i}` }));
  const rest = [];
  for (const el of section.querySelectorAll('.dsct-effect-roll, .dsct-fm-roll, button[data-action="applyEffect"], button[data-action="gainResource"], button.dsct-grab-btn, [data-dsct-action="dsct-purifying-fire"], footer button')) {
    if (el.classList.contains('dsct-effect-roll')) {
      const btn = el.querySelector('button[data-action="applyEffect"]');
      if (btn) rest.push({ kind: 'effect', btn, row: el, key: `effect:${el.dataset.effectId}` });
    } else if (el.classList.contains('dsct-fm-roll')) {
      rest.push({ kind: 'forced', btn: el.querySelector('.dsct-fm-go'), row: el, key: `forced:${el.dataset.fmIndex}` });
    } else if (el.dataset.action === 'applyEffect') {
      if (!el.closest('.dsct-effect-roll')) rest.push({ kind: 'effect', btn: el, key: `effect:${el.dataset.effectId}` });
    } else if (el.dataset.action === 'gainResource') {
      rest.push({ kind: 'resource', btn: el, key: `resource:${el.dataset.uuid ?? rest.length}` });
    } else if (el.classList.contains('dsct-grab-btn')) {
      rest.push({ kind: 'grab', btn: el, key: 'grab' });
    } else if (el.dataset.dsctAction === 'dsct-purifying-fire') {
      rest.push({ kind: 'option', btn: el, key: 'purifying-fire' });
    } else {
      const flat = el.className.match?.(FLAT)?.[1];
      if (flat) rest.push({ kind: 'flat', flat, btn: el, key: `flat:${flat}:${rest.filter((r) => r.flat === flat).length}` });
    }
  }
  const seen = new Set();
  return [...items, ...rest].filter((it) => it.btn && !seen.has(it.btn) && seen.add(it.btn));
}

const usePart = (message) => Array.from(message?.system?.parts?.contents ?? []).find((p) => p.type === 'abilityUse') ?? null;

function cardItems(root, message) {
  const part = usePart(message);
  const section = part ? sectionOf(root, part.id) : null;
  if (!section) return [];
  const items = [];
  for (const el of section.querySelectorAll('footer button')) {
    if (el.closest('.ctlib-split.dsct-apply-all')) continue;
    if (el.classList.contains('dsct-tp-ability-btn')) { items.push({ kind: 'option', btn: el, key: 'tp-ability' }); continue; }
    const flat = el.className.match?.(FLAT)?.[1];
    if (flat) items.push({ kind: 'flat', flat, btn: el, key: `flat:${flat}:${items.filter((r) => r.flat === flat).length}` });
  }
  return items.map((it) => ({ ...it, partId: part.id }));
}

const labelOf = (it) => (it.row?.querySelector('.dice-formula')?.textContent || it.btn.dataset.tooltip || it.btn.textContent || it.kind)
  .replace(/\s+/g, ' ').trim();

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
const targetActorOf = (message, partId) => {
  const part = message?.system?.parts?.get?.(partId);
  if (part?.type !== 'targetResult') return null;
  return (part.tokenUuid ? fromUuidSync(part.tokenUuid, { strict: false })?.actor : null) ?? part.actorTarget ?? null;
};

function verdictOf(it, message, partId) {
  const { btn } = it;
  if (btn.disabled || btn.classList.contains('ctlib-applied') || btn.closest('.ctlib-split-applied')) return 'done';
  if (marksOf(message, partId).includes(it.key)) return 'done';
  
  if (it.kind !== 'damage' && targetActorOf(message, partId)?.statuses?.has(DEFEATED())) return 'done';
  switch (it.kind) {
    case 'damage':
    case 'resource':
      return 'apply';
    case 'effect': {
      const potency = it.row?.dataset.dsctPotency ?? 'none';
      if (potency === 'none') return 'apply';
      if (potency === 'resisted') return 'done';
      return potency === 'affected' && getSetting('potencyChecks') === 'apply' ? 'apply' : 'manual';
    }
    case 'forced':
      return it.row?.dataset.fmAuto === '1' ? 'apply' : 'manual';
    case 'flat':
      return FLAT_MANUAL.has(it.flat) ? 'manual' : 'apply';
    default:
      return 'manual';
  }
}

const journalCount = (id) => lib().journal?.(game.messages.get(id))?.length ?? 0;

async function land(it, msgId, before) {
  const until = Date.now() + (it.kind === 'forced' ? FM_MAX_MS : LAND_MAX_MS);
  if (it.kind === 'forced') {
    await wait(150);
    while (window._dsctFMActive && !_promptOpen() && Date.now() < until) await wait(50);
  } else if (['damage', 'effect', 'resource'].includes(it.kind)) {
    while (journalCount(msgId) === before && !_promptOpen() && Date.now() < until) await wait(50);
  } else {
    await wait(500);
  }
}

async function mark(msgId, partId, key) {
  const message = game.messages.get(msgId);
  const marks = marksOf(message, partId);
  if (marks.includes(key)) return;
  await safeUpdate(message, { [`flags.${M}.applied12.${partId}`]: [...marks, key] });
}

async function remind(message, skipped) {
  if (!skipped.length) return;
  const ability = abilityOf(message);
  const rows = skipped.map((s) => `<li><strong>${esc(s.target)}</strong>: ${esc(s.label)}</li>`).join('');
  await ChatMessage.implementation.create({
    type: 'standard',
    'system.parts': [{ type: 'content', flavor: L('reminderTitle') }],
    content: `<p>${esc(L('reminderIntro', { ability: ability?.name ?? '' }))}</p><ul class="dsct-apply-reminder">${rows}</ul>`,
    speaker: { alias: L('reminderSpeaker') },
    whisper: [game.user.id],
    flags: { [M]: { applyReminder: message.id } },
  });
}

const _running = new Set();

export async function applyAll12(message, { partIds = null, kinds = null } = {}) {
  const msgId = message.id;
  if (_running.has(msgId)) return false;
  _running.add(msgId);
  _resolving.add(msgId);
  const targetsBefore = [...game.user.targets].map((t) => t.id);
  const fresh = () => game.messages.get(msgId);
  const skipped = [];
  try {
    if (!(await _waitForHolds(msgId))) return false;
    if (!partIds) {
      if (await settleCriticalChoice(fresh())) await wait(SETTLE_MS);
      if (!(await _waitForChoice(msgId))) return false;
      if (await services.get('settleChainTargets')?.(fresh())) await wait(SETTLE_MS);
      if (await services.get('settleOthersEnrichers')?.(fresh(), document)) await wait(SETTLE_MS);
    }
    const enrichers = (phase) => (partIds ? false : services.get('applyAutoEnrichers')?.(fresh(), document, phase));
    let damagedAny = !!(await damageBatch(() => enrichers('damage')));
    if (damagedAny && !(await _waitForHolds(msgId))) return false;
    const parts = () => resultParts(fresh()).filter((p) => !partIds || partIds.includes(p.id));
    const noted = new Set();
    for (let col = 0; ; col++) {
      const { stop, any, damaged } = await damageBatch(async () => {
        let anyHere = false;
        let hit = false;
        for (const part of parts()) {
          const it = itemsOf(sectionOf(liveLi(msgId), part.id)).filter((i) => !kinds || kinds.includes(i.kind))[col];
          if (!it) continue;
          anyHere = true;
          const verdict = verdictOf(it, fresh(), part.id);
          if (verdict === 'manual') {
            const note = `${part.id}:${it.key}`;
            if (!noted.has(note)) {
              noted.add(note);
              skipped.push({ target: fromUuidSync(part.tokenUuid ?? '')?.name ?? part.actorTarget?.name ?? '', label: labelOf(it) });
            }
            continue;
          }
          if (verdict !== 'apply') continue;
          const before = journalCount(msgId);
          if (it.kind === 'damage') hit = true;
          it.btn.click();
          await land(it, msgId, before);
          if (['forced', 'flat'].includes(it.kind)) await mark(msgId, part.id, it.key);
          const promptUntil = Date.now() + PROMPT_WAIT_MS;
          while (_promptOpen() && Date.now() < promptUntil) await wait(100);
          if (_promptOpen()) return { stop: true };
          if (!(await _waitForHolds(msgId))) return { stop: true };
          await wait(60);
        }
        return { any: anyHere, damaged: hit };
      });
      if (stop) return false;
      if (!any) break;
      damagedAny ||= damaged;
      if (damaged) await services.get('settleDeaths')?.();
    }
    if (damagedAny) await services.get('settleDeaths')?.();
    if (!partIds) {
      for (const key of cardItems(liveLi(msgId), fresh()).map((i) => i.key)) {
        const it = cardItems(liveLi(msgId), fresh()).find((i) => i.key === key);
        if (!it) continue;
        const verdict = verdictOf(it, fresh(), it.partId);
        if (verdict === 'manual') skipped.push({ target: abilityOf(fresh())?.actor?.name ?? '', label: labelOf(it) });
        if (verdict !== 'apply') continue;
        await damageBatch(async () => {
          it.btn.click();
          await land(it, msgId, journalCount(msgId));
          await mark(msgId, it.partId, it.key);
        });
        const promptUntil = Date.now() + PROMPT_WAIT_MS;
        while (_promptOpen() && Date.now() < promptUntil) await wait(100);
        if (_promptOpen() || !(await _waitForHolds(msgId))) return false;
      }
    }
    await enrichers('rest');
    return true;
  } finally {
    _running.delete(msgId);
    _resolving.delete(msgId);
    if (canvas.ready) {
      const keep = new Set(targetsBefore);
      for (const t of [...game.user.targets]) if (!keep.has(t.id)) t.setTarget(false, { releaseOthers: false, groupSelection: true });
      for (const id of keep) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false, groupSelection: true });
    }
    await remind(fresh() ?? message, skipped).catch((err) => console.warn('DSCT | apply all | reminder failed', err));
  }
}

export async function undoAll12(message, { partIds = null, actions = null } = {}) {
  let undone = 0;
  await damageBatch(async () => {
    undone += (await lib().undoAllEntries?.(message, { partIds, actions })) ?? 0;
    if (!partIds && !actions && await services.get('undoAutoEnrichers')?.(game.messages.get(message.id), document)) undone++;
  });
  return undone;
}

const appliable = (message, root = liveLi(message.id)) => resultParts(message)
  .some((p) => itemsOf(sectionOf(root, p.id)).some((i) => verdictOf(i, message, p.id) === 'apply'))
  || cardItems(root, message).some((i) => verdictOf(i, message, i.partId) === 'apply');
const undoable = (message, opts) => (lib().undoableEntries?.(message, opts) ?? []).length > 0;

function splitButton({ applyLabel, applyIcon, applyTip, undoTip, cls, canApply, canUndo, onApply, onUndo }) {
  const wrap = document.createElement('span');
  wrap.className = `ctlib-split ${cls}`;
  const go = document.createElement('button');
  go.type = 'button';
  go.className = `${cls}-go`;
  go.innerHTML = `<i class="${applyIcon}" inert></i>${applyLabel ? ` ${esc(applyLabel)}` : ''}`;
  go.disabled = !canApply;
  if (applyTip) setTip(go, applyTip);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = `ctlib-undo ${cls}-undo`;
  back.innerHTML = '<i class="fa-solid fa-rotate-left" inert></i>';
  back.setAttribute('aria-label', game.i18n.localize('DSCT.apply12.undoAll'));
  back.classList.toggle('ctlib-undo-off', !canUndo);
  back.setAttribute('aria-disabled', String(!canUndo));
  if (undoTip) setTip(back, undoTip);
  go.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (go.disabled) return;
    go.disabled = true;
    try { await onApply(); } finally { go.disabled = false; }
  });
  back.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (back.classList.contains('ctlib-undo-off')) return;
    back.classList.add('ctlib-undo-off');
    await onUndo();
  });
  wrap.append(go, back);
  return wrap;
}

const mayRun = (message) => game.user.isGM || message.isOwner;

function addApplyAllRow(message, html) {
  const parts = resultParts(message);
  if (!parts.length || !mayRun(message)) return;
  const count = parts.reduce((n, p) => n + itemsOf(sectionOf(html, p.id)).length, 0) + cardItems(html, message).length;
  const enrichers = !!html.querySelector('enriched-content.dsct-adv[data-adv-auto]');
  if (count + (enrichers ? 1 : 0) < 2) return;
  const content = html.querySelector('.message-content') ?? html;
  content.querySelector(':scope > .dsct-apply-all-row')?.remove();
  const canApply = appliable(message, html) || (enrichers && !html.querySelector('enriched-content.dsct-adv[data-adv-auto].dsct-adv-done'));
  const choicesLeft = !canApply && [...parts.flatMap((p) => itemsOf(sectionOf(html, p.id)).map((it) => ({ it, id: p.id }))), ...cardItems(html, message).map((it) => ({ it, id: it.partId }))]
    .some(({ it, id }) => verdictOf(it, message, id) === 'manual');
  const footer = document.createElement('footer');
  footer.className = 'message-part-buttons dsct-apply-all-row';
  footer.append(splitButton({
    cls: 'dsct-apply-all',
    applyLabel: L(canApply ? 'applyAll' : choicesLeft ? 'choicesLeft' : 'allApplied'),
    applyIcon: 'fa-solid fa-check-double',
    applyTip: tipFor('applyAll12'),
    undoTip: tipFor('undoAll12'),
    canApply,
    canUndo: undoable(message),
    onApply: () => applyAll12(game.messages.get(message.id) ?? message),
    onUndo: () => undoAll12(game.messages.get(message.id) ?? message),
  }));
  content.append(footer);
}

const openKey = (id) => `dsct-squads12-${id}`;
const readOpen = (id) => { try { return JSON.parse(localStorage.getItem(openKey(id)) ?? '{}'); } catch { return {}; } };
const writeOpen = (id, state) => { try { localStorage.setItem(openKey(id), JSON.stringify(state)); } catch { } };

function addSquadSections(message, html) {
  if (!getSetting('squadToolsEnabled') || !getSetting('dstdSquadSections')) return;
  const squads = new Map();
  for (const part of resultParts(message)) {
    const squad = squadOfPart(part);
    const section = sectionOf(html, part.id);
    if (!squad || !section) continue;
    if (!squads.has(squad.id)) squads.set(squad.id, { squad, parts: [], sections: [] });
    squads.get(squad.id).parts.push(part);
    squads.get(squad.id).sections.push(section);
  }
  const open = readOpen(message.id);
  for (const { squad, parts, sections } of squads.values()) {
    if (sections.length < 2) continue;
    const details = document.createElement('details');
    details.className = 'dsct-dstd-squad dsct-squad12';
    details.dataset.groupId = squad.id;
    details.open = open[squad.id] ?? getSetting('dstdSquadSectionsOpen');
    const hdr = document.createElement('summary');
    hdr.className = 'dsct-dstd-squad-hdr';
    hdr.innerHTML = `<i class="fa-solid fa-chevron-right dsct-dstd-squad-chevron" inert></i><span class="dsct-dstd-squad-label">${esc(squad.name || game.i18n.localize('DSCT.chat.squads.squadSectionFallback'))}</span><span class="dsct-dstd-squad-badge">${sections.length}</span>`;
    const partIds = parts.map((p) => p.id);
    if (mayRun(message)) {
      hdr.append(splitButton({
        cls: 'dsct-squad12-btn',
        applyLabel: '',
        applyIcon: 'fa-solid fa-check-double',
        applyTip: tipFor('squadApply', { data: { group: squad.name } }),
        undoTip: tipFor('squadUndo', { data: { group: squad.name } }),
        canApply: appliableIn(html, message, partIds, ['damage']),
        canUndo: undoable(message, { partIds, actions: ['applyDamage'] }),
        onApply: async () => {
          await applyAll12(game.messages.get(message.id) ?? message, { partIds, kinds: ['damage'] });
          services.get('resolveDeathsNow')?.();
        },
        onUndo: () => undoAll12(game.messages.get(message.id) ?? message, { partIds, actions: ['applyDamage'] }),
      }));
    }
    const rows = document.createElement('div');
    rows.className = 'dsct-dstd-squad-rows';
    sections[0].before(details);
    details.append(hdr, rows);
    for (const s of sections) rows.append(s);
    details.addEventListener('toggle', () => writeOpen(message.id, { ...readOpen(message.id), [squad.id]: details.open }));
  }
}

const appliableIn = (html, message, partIds, kinds) => resultParts(message).filter((p) => partIds.includes(p.id))
  .some((p) => itemsOf(sectionOf(html, p.id)).filter((i) => kinds.includes(i.kind)).some((i) => verdictOf(i, message, p.id) === 'apply'));

function showMarks(message, html) {
  const marked = message.flags?.[M]?.applied12 ?? {};
  if (!Object.keys(marked).length) return;
  const all = [...resultParts(message).flatMap((p) => itemsOf(sectionOf(html, p.id)).map((it) => ({ ...it, partId: p.id }))), ...cardItems(html, message)];
  for (const it of all) if ((marked[it.partId] ?? []).includes(it.key)) it.btn.classList.add('dsct-applied12');
}

const _eligible = new Set();

async function autoApply(msgId) {
  const message = game.messages.get(msgId);
  if (!message || message.getFlag(M, 'autoApplied') || !getSetting('autoApplyOwnAbilities')) return;
  if (!isOwnAbilityActor(abilityOf(message)?.actor)) return;
  const li = liveLi(msgId);
  const enrichers = !!li?.querySelector('enriched-content.dsct-adv[data-adv-auto]');
  if (!enrichers && !appliable(message)) return;
  await safeSetFlag(message, M, 'autoApplied', true);
  await wait(SETTLE_MS);
  await applyAll12(game.messages.get(msgId) ?? message);
}

export function registerApply12() {
  if (!ds.CONFIG.MessagePart?.targetResult) return;
  services.provide('applyAllEffects', (message) => applyAll12(message));
  Hooks.on('createChatMessage', (message, _options, userId) => {
    if (userId === game.user.id && on12() && getSetting('autoApplyOwnAbilities') && usePart(message)) _eligible.add(message.id);
  });
  Hooks.once('ready', () => {
    
    Hooks.on('renderChatMessageHTML', (message, html) => {
      if (!on12() || !usePart(message)) return;
      try {
        showMarks(message, html);
        if (resultParts(message).length) {
          addSquadSections(message, html);
          addApplyAllRow(message, html);
        }
      } catch (err) { console.warn('DSCT | apply all', err); }
      if (_eligible.delete(message.id)) setTimeout(() => autoApply(message.id).catch((err) => console.warn('DSCT | auto-apply', err)), SETTLE_MS);
    });
  });
}
