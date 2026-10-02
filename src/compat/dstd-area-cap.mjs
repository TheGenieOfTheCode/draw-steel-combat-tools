import { DSTD } from '../ctlib.mjs';
const AREA_TYPES = new Set(['aura', 'burst', 'cube', 'line', 'wall']);

const L = (k, data) => data
  ? game.i18n.format(`DSCT.panel.areaCap.${k}`, data)
  : game.i18n.localize(`DSCT.panel.areaCap.${k}`);

function _abilityOf(message) {
  const use = message.system?.parts?.contents?.find?.((p) => p.type === 'abilityUse');
  return use?.abilityUuid ? fromUuidSync(use.abilityUuid) : null;
}

const _isArea = (message) => AREA_TYPES.has(String(_abilityOf(message)?.system?.distance?.type ?? '').toLowerCase());

function _minionCap(targetKey) {
  const doc = fromUuidSync(String(targetKey ?? '').replace(/__/g, '.'));
  const actor = doc?.actor;
  if (!actor?.system?.isMinion) return null;
  const combatant = game.combat?.combatants?.find((c) => c.tokenId === doc.id);
  if (combatant?.group?.type !== 'squad') return null;
  return Number(actor.system.stamina?.max) || null;
}

function _afterModifiers(targetKey, amount, type) {
  const actor = fromUuidSync(String(targetKey ?? '').replace(/__/g, '.'))?.actor;
  const damage = actor?.system?.damage ?? {};
  const weakness = Math.max(Number(damage.weaknesses?.all ?? 0) || 0, Number(damage.weaknesses?.[type] ?? 0) || 0);
  const immunity = Math.max(Number(damage.immunities?.all ?? 0) || 0, Number(damage.immunities?.[type] ?? 0) || 0);
  return Math.max(0, amount + weakness - immunity);
}

export function markAreaCaps(message, root) {
  if (!game.modules.get(DSTD)?.active || !root) return;
  const panel = root.querySelector(`.${DSTD}-panel`);
  if (!panel || !_isArea(message)) return;

  const tierLine = panel.querySelector(`.${DSTD}-tier-line`);
  if (tierLine && !tierLine.querySelector('.dsct-area-tag')) {
    tierLine.insertAdjacentHTML('beforeend', ` <span class="dsct-area-tag" data-tooltip="${foundry.utils.escapeHTML(L('tagTooltip'))}">${foundry.utils.escapeHTML(L('tag'))}</span>`);
  }

  for (const row of panel.querySelectorAll(`.${DSTD}-target-row[data-target-key]`)) {
    const cap = _minionCap(row.dataset.targetKey);
    if (!cap) continue;
    for (const btn of row.querySelectorAll('button[data-dstd-action="applyDamage"]')) {
      const span = btn.querySelector('span');
      if (!span) continue;
      if (span.dataset.dsctCapText != null && span.textContent !== span.dataset.dsctCapText) delete span.dataset.dsctCapText;
      if (span.dataset.dsctCapText != null) continue;
      const label = span.textContent;
      const match = label.match(/\d+/);
      if (!match) continue;
      const shown = Number(match[0]);
      const type = [...btn.classList].find((c) => c.startsWith(`${DSTD}-damage-type-`))?.slice(`${DSTD}-damage-type-`.length) ?? '';
      const lands = Math.min(_afterModifiers(row.dataset.targetKey, shown, type === 'untyped' ? '' : type), cap);
      if (lands >= shown) continue;
      const esc = foundry.utils.escapeHTML;
      span.innerHTML = `${esc(label.slice(0, match.index))}<s class="dsct-capped-from">${shown}</s> ${lands}${esc(label.slice(match.index + match[0].length))}`;
      span.dataset.dsctCapText = span.textContent;
      if (btn.dataset.dsctTipBase == null) btn.dataset.dsctTipBase = btn.dataset.tooltip ?? '';
      btn.dataset.tooltip = [btn.dataset.dsctTipBase, L('cappedTooltip', { cap })].filter(Boolean).join(' ');
    }
  }
}
