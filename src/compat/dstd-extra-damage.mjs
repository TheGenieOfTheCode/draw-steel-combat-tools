import { DSTD, DSTD_ROW, DAMAGE_TYPES, registerPanelDecorator, safeUpdate } from '../ctlib.mjs';
import { setTip, tipFor } from '../chat-tips.mjs';
import { dropKeyOverSocket } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'extraDamage';
const ROW_CLASS = 'dsct-extra-dmg-row';

const L = (k, data) => data ? game.i18n.format(`DSCT.panel.extraDamage.${k}`, data) : game.i18n.localize(`DSCT.panel.extraDamage.${k}`);

const rowsOf = (message) => {
  const f = message?.getFlag(M, FLAG);
  return Array.isArray(f) ? f : [];
};

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'extra';

const hash = (value) => {
  let h = 0;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) { h = ((h << 5) - h) + text.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
};

const opIdOf = (targetUuid, id) => `damage-dsct-xd-${slug(id)}-${hash(String(targetUuid).replace(/\./g, '__'))}`.replace(/[^A-Za-z0-9_-]/g, '-');

const write = (message, rows) => safeUpdate(message, { [`flags.${M}.${FLAG}`]: rows });

export async function addExtraDamage(message, { targetUuid, id, amount, type = '', label = '', enabled = true }) {
  if (!message || !targetUuid || !id) return false;
  const rows = rowsOf(message);
  if (rows.some((r) => r.targetUuid === targetUuid && r.id === id)) return false;
  await write(message, [...rows, { targetUuid, id, amount: Math.max(0, Number(amount) || 0), type, label: label || id, ...(enabled ? {} : { enabled: false }) }]);
  return true;
}

export async function setExtraDamageEnabled(message, { targetUuid = null, id, enabled = true }) {
  const rows = rowsOf(message);
  let hit = false;
  const next = rows.map((r) => {
    if (r.id !== id || (targetUuid && r.targetUuid !== targetUuid)) return r;
    hit = true;
    const { enabled: _e, ...rest } = r;
    return enabled ? rest : { ...rest, enabled: false };
  });
  if (hit) await write(message, next);
  return hit;
}

const typeLabelOf = (type) => type ? (ds.CONFIG.damageTypes?.[type]?.label ?? type) : '';

export async function syncSurgeRows(message, { targetUuid, key, wanted, surgeDamage, label }) {
  const state = message.getFlag(DSTD, 'state') ?? {};
  const prefix = `surge-${key}-`;
  const ours = (r) => r.targetUuid === targetUuid && r.id.startsWith(prefix);
  const applied = (r) => state.applications?.[opIdOf(targetUuid, r.id)]?.status === 'applied';
  const rows = rowsOf(message);
  if (!wanted.length && !rows.some(ours)) return;
  const next = rows.filter((r) => !ours(r) || applied(r));
  const direct = game.user.isGM || message.isOwner;
  const FD = foundry.data?.operators?.ForcedDeletion;
  const FR = foundry.data?.operators?.ForcedReplacement;
  const payload = { [`flags.${M}.${FLAG}`]: next, [`flags.${DSTD}.state.updatedAt`]: Date.now() };
  for (const r of rows.filter((r) => ours(r) && !applied(r))) {
    payload[`flags.${DSTD}.state.damageOverrides.${opIdOf(targetUuid, r.id)}`] = direct && FD ? new FD() : dropKeyOverSocket();
  }
  for (const { type, count } of wanted) {
    const id = `${prefix}${type}`;
    if (next.some((r) => r.targetUuid === targetUuid && r.id === id)) continue;
    const amount = count * surgeDamage;
    next.push({ targetUuid, id, amount, type, label });
    const data = { baseAmount: amount, amount, bonus: 0, additional: '', surges: count, surgeDamage, damageType: type, typeLabel: game.i18n.localize(typeLabelOf(type)) };
    payload[`flags.${DSTD}.state.damageOverrides.${opIdOf(targetUuid, id)}`] = direct && FR ? new FR(data) : data;
  }
  await safeUpdate(message, payload);
}

function _icon(cls) {
  const i = document.createElement('i');
  i.className = cls;
  return i;
}

function _decorate(message, panel) {
  const extras = rowsOf(message).filter((r) => r.enabled !== false && r.amount > 0);
  if (!extras.length) return;
  const state = message.getFlag(DSTD, 'state') ?? {};
  for (const row of panel.querySelectorAll(DSTD_ROW)) {
    const key = row.dataset.targetKey;
    const target = (state.targets ?? []).find((t) => (t.tokenUuid?.replace(/\./g, '__') ?? '') === key);
    if (!target) continue;
    const actions = row.querySelector(`.${DSTD}-target-actions`) ?? row.querySelector(`.${DSTD}-target-body`);
    if (!actions) continue;
    for (const x of extras.filter((r) => r.targetUuid === target.tokenUuid)) {
      const operationId = opIdOf(target.tokenUuid, x.id);
      if (actions.querySelector(`[data-operation-id="${operationId}"]`)) continue;
      const record = state.applications?.[operationId];
      const applied = record?.status === 'applied';
      const typeLabel = typeLabelOf(x.type);
      const label = L('apply', { name: x.label, amount: x.amount, type: typeLabel || L('untyped') });
      const dataset = {
        syntheticDamage: 'true', amount: String(x.amount), formula: String(x.amount), damageType: x.type ?? '', typeLabel,
        isHeal: 'false', ignoredImmunities: '[]', partId: `dsct-xd-${slug(x.id)}`,
      };
      const targetJSON = JSON.stringify(target);

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = `${DSTD}-action-button ${DSTD}-stretch-button`;
      if (x.type) apply.classList.add(`${DSTD}-damage-type-${x.type}`);
      Object.assign(apply.dataset, { dstdAction: 'applyDamage', target: targetJSON, operationId }, dataset);
      setTip(apply, tipFor('extraDamage', { title: label }));
      apply.disabled = applied;
      const span = document.createElement('span');
      span.textContent = applied ? L('applied', { name: x.label, amount: record?.amount ?? x.amount, type: typeLabel || L('untyped') }) : label;
      apply.append(_icon((DAMAGE_TYPES[x.type] ?? DAMAGE_TYPES.untyped).icon), span);

      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = `${DSTD}-icon-button ${DSTD}-undo-button`;
      Object.assign(undo.dataset, { dstdAction: 'undoDamage', target: targetJSON, operationId });
      setTip(undo, tipFor('damageUndo'));
      undo.disabled = !applied;
      undo.append(_icon('fa-solid fa-rotate-left'));

      const line = document.createElement('div');
      line.className = `${DSTD}-action-row ${DSTD}-damage-row ${ROW_CLASS}`;
      if (applied) line.classList.add('is-applied');
      if (record?.status === 'undone') line.classList.add('is-undone');
      line.append(apply, undo);
      actions.appendChild(line);
    }
  }
}

export function registerDstdExtraDamage() {
  registerPanelDecorator({ id: 'combat-tools-extra-damage', priority: 110, ignore: [`.${ROW_CLASS}`], decorate: ({ message, panel }) => {
    if (panel) _decorate(message, panel);
  } });
}
