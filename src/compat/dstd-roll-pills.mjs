import { getSetting, getModuleApi } from '../helpers.mjs';
import { DSCTAddModifierDialog } from '../ability-automation/roll-dialog-hooks.mjs';

const M    = 'draw-steel-combat-tools';
const DSTD = 'draw-steel-target-damage';

const _isPowerRoll = (r) => (globalThis.ds?.rolls?.PowerRoll && r instanceof ds.rolls.PowerRoll) || r?.product !== undefined;

const _targetKey = (target) => {
  if (target?.selectedToken) return 'selected-token';
  const raw = target?.tokenUuid ?? target?.actorUuid ?? target?.tokenId ?? target?.actorId ?? '';
  return String(raw).replace(/\./g, '__');
};

function _findTargetRoll(message, target) {
  const parts = Array.from(message.system?.parts?.contents ?? []);
  if (!target?.selectedToken) {
    for (const part of parts) {
      for (const roll of Array.from(part.rolls ?? []).reverse()) {
        if (!_isPowerRoll(roll)) continue;
        if (roll.options?.target && roll.options.target === target?.actorUuid) return roll;
      }
    }
  }
  const withPower = parts.filter(p => Array.from(p.rolls ?? []).some(_isPowerRoll));
  if (withPower.length === 1) return Array.from(withPower[0].rolls).reverse().find(_isPowerRoll) ?? null;
  if (target?.selectedToken && withPower.length) return Array.from(withPower[0].rolls).find(_isPowerRoll) ?? null;
  return null;
}

function _diceResults(powerRoll) {
  try {
    const die = powerRoll?.dice?.[0] ?? powerRoll?.terms?.find(t => t?.faces === 10);
    return (die?.results ?? []).filter(r => r.active !== false).map(r => Number(r.result) || 0);
  } catch { return []; }
}

function _readNaturalRoll(powerRoll) {
  try {
    const die = powerRoll?.dice?.[0] ?? powerRoll?.terms?.find(t => t?.faces === 10);
    return Number(die?.total ?? die?.results?.reduce?.((s, r) => s + (Number(r.result) || 0), 0) ?? 0);
  } catch { return 0; }
}

function _staticModifier(powerRoll, naturalTotal) {
  const total = Number(powerRoll?.total);
  if (!Number.isFinite(total)) return 0;
  const edges   = Number(powerRoll?.options?.edges ?? 0);
  const banes   = Number(powerRoll?.options?.banes ?? 0);
  const bonuses = Number(powerRoll?.options?.bonuses ?? 0);
  const net = edges - banes;
  const singleAdj = Math.abs(net) === 1 ? Math.sign(net) * 2 : 0;
  return total - (Number(naturalTotal) || 0) - singleAdj - bonuses;
}

export function computeTierFromDice(naturalSum, edges = 0, banes = 0, bonuses = 0, criticalThreshold = 19, staticModifier = 0) {
  const naturalTotal = Number(naturalSum) || 0;
  if (naturalTotal >= Number(criticalThreshold ?? 19)) return 3;
  const net = (Number(edges) || 0) - (Number(banes) || 0);
  const singleAdj = Math.abs(net) === 1 ? Math.sign(net) * 2 : 0;
  const total = naturalTotal + (Number(staticModifier) || 0) + singleAdj + (Number(bonuses) || 0);
  let tier = 1;
  if (total >= 12) tier = 2;
  if (total >= 17) tier = 3;
  const adjustment = net - Math.sign(net);
  return Math.min(3, Math.max(1, tier + adjustment));
}

function _rollBasis(powerRoll, override = null) {
  const naturalTotal = _readNaturalRoll(powerRoll);
  return {
    naturalTotal,
    criticalThreshold: Number(powerRoll?.options?.criticalThreshold ?? 19),
    staticModifier: override?.staticModifier != null
      ? Number(override.staticModifier)
      : _staticModifier(powerRoll, naturalTotal),
    edges:   Number(powerRoll?.options?.edges ?? 0),
    banes:   Number(powerRoll?.options?.banes ?? 0),
    bonuses: Number(powerRoll?.options?.bonuses ?? 0),
  };
}

function _buildOverride(basis, eff, dsctPills, dsctBaseOff) {
  const edges = Math.max(0, Math.min(2, eff.edges));
  const banes = Math.max(0, Math.min(2, eff.banes));
  const net = edges - banes;
  const singleAdj = Math.abs(net) === 1 ? Math.sign(net) * 2 : 0;
  return {
    tier: computeTierFromDice(basis.naturalTotal, edges, banes, eff.bonuses, basis.criticalThreshold, basis.staticModifier),
    total: basis.naturalTotal + basis.staticModifier + singleAdj + eff.bonuses,
    naturalTotal: basis.naturalTotal,
    staticModifier: basis.staticModifier,
    edges,
    banes,
    bonuses: eff.bonuses,
    isCritical: basis.naturalTotal >= basis.criticalThreshold,
    dsctPills,
    dsctBaseOff,
  };
}

function _effectiveFrom(basis, basePills, baseOff, session) {
  const sums = { edge: 0, bane: 0, bonus: 0 };
  for (const [i, p] of basePills.entries()) {
    if (baseOff.has(i)) sums[p.kind] = (sums[p.kind] ?? 0) - (Number(p.amount) || 0);
  }
  for (const p of session) {
    if (p.enabled === false) continue;
    sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
  }
  return {
    edges: Math.max(0, Math.min(2, basis.edges + sums.edge)),
    banes: Math.max(0, Math.min(2, basis.banes + sums.bane)),
    bonuses: basis.bonuses + sums.bonus,
  };
}

const _pendingProvenance = new Map();

function _stashProvenance(app) {
  const ability = app.options?.ability;
  if (!ability?.uuid || !app._dsctSources) return;
  const shrink = (p) => ({ kind: p.kind, amount: p.amount, reason: p.reason, src: p.src ?? null });
  const global = app._dsctSources.filter(p => p.scope === 'global' && p.enabled).map(shrink);
  const targets = {};
  for (const tokenId of Object.keys(app.options.context?.targets ?? {})) {
    const uuid = canvas.tokens?.get(tokenId)?.document?.uuid;
    if (!uuid) continue;
    const list = app._dsctSources.filter(p => p.scope === tokenId && p.enabled).map(shrink);
    if (list.length) targets[uuid] = list;
  }
  if (!global.length && !Object.keys(targets).length) return;
  _pendingProvenance.set(ability.uuid, { at: Date.now(), data: { global, targets } });
  for (const [uuid, entry] of _pendingProvenance) {
    if (Date.now() - entry.at > 30000) _pendingProvenance.delete(uuid);
  }
}

function _persistProvenance(message) {
  const abilityUuid = Array.from(message.system?.parts?.contents ?? []).find(p => p.abilityUuid)?.abilityUuid;
  if (!abilityUuid) return;
  const entry = _pendingProvenance.get(abilityUuid);
  if (!entry || Date.now() - entry.at > 30000) return;
  _pendingProvenance.delete(abilityUuid);
  const payload = { [`flags.${M}.rollPills`]: entry.data };
  const api = getModuleApi(false);
  if (game.user.isGM || message.isOwner) message.update(payload);
  else if (api?.socket) api.socket.executeAsGM('dsct.updateDocument', message.uuid, payload);
}

function _pillAmtStr(p) {
  const kindLabel = p.kind === 'edge' ? 'Edge' : p.kind === 'bane' ? 'Bane' : (p.amount >= 0 ? 'Bonus' : 'Penalty');
  const plural = p.kind !== 'bonus' && Math.abs(p.amount) !== 1 ? 's' : '';
  return `${p.amount >= 0 ? '+' : ''}${p.amount} ${kindLabel}${plural}`;
}

function _chatPillHTML(p, msgId, targetKey) {
  const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
  let cls = `dsct-source-pill dsct-chat-roll-pill dsct-pill-${p.kind}`;
  let attrs = '';
  let title = `${_pillAmtStr(p)} on the power roll`;
  if (p.removable) {
    cls += ' dsct-chat-pill-removable';
    if (p.disabled) cls += ' dsct-pill-disabled';
    attrs = ` data-remove-idx="${p.overrideIdx}" data-msg-id="${msgId}" data-target-key="${targetKey}"`;
    title += '\nClick to remove';
  } else if (p.toggleable) {
    cls += ' dsct-chat-pill-toggle';
    if (p.disabled) cls += ' dsct-pill-disabled';
    attrs = ` data-base-idx="${p.baseIdx}" data-msg-id="${msgId}" data-target-key="${targetKey}"`;
    title += p.disabled ? '\nDisabled. Click to re-enable' : '\nClick to disable';
  } else {
    cls += ' dsct-chat-pill-inert';
    if (p.disabled) cls += ' dsct-pill-disabled';
  }
  return `<button type="button" class="${cls}"${attrs} title="${foundry.utils.escapeHTML(title)}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`;
}

function _overrideSessionPills(roll, override) {
  if (!override) return [];
  if (Array.isArray(override.dsctPills)) return override.dsctPills.map(p => ({ ...p }));
  if (Array.isArray(override.dsctBaseOff)) return [];
  const pills = [];
  const de  = Number(override.edges ?? 0)   - Number(roll?.options?.edges ?? 0);
  const db  = Number(override.banes ?? 0)   - Number(roll?.options?.banes ?? 0);
  const dbo = Number(override.bonuses ?? 0) - Number(roll?.options?.bonuses ?? 0);
  const reason = override.dstModName ?? 'Adjustment';
  if (de)  pills.push({ kind: 'edge',  amount: de,  reason, src: null });
  if (db)  pills.push({ kind: 'bane',  amount: db,  reason, src: null });
  if (dbo) pills.push({ kind: 'bonus', amount: dbo, reason, src: null });
  return pills;
}

function _overrideBaseOff(override) {
  return new Set(Array.isArray(override?.dsctBaseOff) ? override.dsctBaseOff : []);
}

function _basePills(roll, prov, target) {
  const pills = [];
  if (prov) {
    for (const p of [...(prov.global ?? []), ...(prov.targets?.[target?.tokenUuid] ?? [])]) pills.push({ ...p });
    const sums = { edge: 0, bane: 0, bonus: 0 };
    for (const p of pills) sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
    const re  = Number(roll.options?.edges ?? 0)   - sums.edge;
    const rb  = Number(roll.options?.banes ?? 0)   - sums.bane;
    const rbo = Number(roll.options?.bonuses ?? 0) - sums.bonus;
    if (re > 0)  pills.push({ kind: 'edge',  amount: re,  reason: 'Rolled', src: null });
    if (rb > 0)  pills.push({ kind: 'bane',  amount: rb,  reason: 'Rolled', src: null });
    if (rbo)     pills.push({ kind: 'bonus', amount: rbo, reason: 'Rolled', src: null });
  } else {
    const oe  = Number(roll.options?.edges ?? 0);
    const ob  = Number(roll.options?.banes ?? 0);
    const obo = Number(roll.options?.bonuses ?? 0);
    if (oe)  pills.push({ kind: 'edge',  amount: oe,  reason: 'Rolled', src: null });
    if (ob)  pills.push({ kind: 'bane',  amount: ob,  reason: 'Rolled', src: null });
    if (obo) pills.push({ kind: 'bonus', amount: obo, reason: 'Rolled', src: null });
  }
  return pills;
}

export function injectRollPills(message, root) {
  if (!getSetting('dstdRollPills')) return;
  if (!game.modules.get(DSTD)?.active) return;
  const state = message.getFlag(DSTD, 'state');
  if (!state) return;
  const prov = message.getFlag(M, 'rollPills') ?? null;
  const canEdit = game.user.isGM || message.isOwner;

  for (const cog of root.querySelectorAll('button[data-dstd-action="editRoll"]')) {
    const rollLine = cog.closest(`.${DSTD}-roll-line`);
    if (!rollLine) continue;
    let target;
    try { target = JSON.parse(cog.dataset.target); } catch { continue; }
    const targetKey = _targetKey(target);
    const host = rollLine.parentElement;
    host?.querySelectorAll(':scope > .dsct-roll-pills-row').forEach(e => e.remove());
    const roll = _findTargetRoll(message, target);
    if (!roll) continue;

    const override = state.tierOverrides?.[targetKey] ?? null;
    const baseOff = _overrideBaseOff(override);
    const pills = _basePills(roll, prov, target).map((p, idx) => ({
      ...p, toggleable: canEdit, baseIdx: idx, disabled: baseOff.has(idx),
    }));
    _overrideSessionPills(roll, override).forEach((p, idx) => {
      pills.push({ ...p, removable: canEdit, overrideIdx: idx, disabled: p.enabled === false });
    });
    if (!pills.length) continue;

    const row = document.createElement('div');
    row.className = 'dsct-roll-pills-row';
    row.dataset.msgId = message.id;
    row.innerHTML = pills.map(p => _chatPillHTML(p, message.id, targetKey)).join('');
    rollLine.after(row);
  }
}

async function _writeOverride(message, targetKey, overrideData) {
  const payload = { [`flags.${DSTD}.state.updatedAt`]: Date.now() };
  if (overrideData) {
    payload[`flags.${DSTD}.state.tierOverrides.${targetKey}`] = overrideData;
  } else if (game.user.isGM || message.isOwner) {
    const FD = foundry.data?.operators?.ForcedDeletion;
    if (FD) payload[`flags.${DSTD}.state.tierOverrides.${targetKey}`] = new FD();
    else payload[`flags.${DSTD}.state.tierOverrides.-=${targetKey}`] = null;
    return message.update(payload);
  } else {
    payload[`flags.${DSTD}.state.tierOverrides.-=${targetKey}`] = null;
  }
  if (game.user.isGM || message.isOwner) return message.update(payload);
  const api = getModuleApi(false);
  if (api?.socket) return api.socket.executeAsGM('dsct.updateDocument', message.uuid, payload);
  ui.notifications.warn(game.i18n.localize('DSCT.notice.rollPills.noPermission'));
}

async function _mutateOverride(msgId, targetKey, mutate) {
  const message = game.messages.get(msgId);
  if (!message) return;
  const state = message.getFlag(DSTD, 'state');
  if (!state) return;
  const target = _findTargetForKey(message, state, targetKey);
  const roll = target ? _findTargetRoll(message, target) : null;
  if (!roll) return;
  const override = state.tierOverrides?.[targetKey] ?? null;
  const basePills = _basePills(roll, message.getFlag(M, 'rollPills') ?? null, target);
  const baseOff = _overrideBaseOff(override);
  const session = _overrideSessionPills(roll, override);
  mutate({ baseOff, session });
  if (!baseOff.size && !session.length) return _writeOverride(message, targetKey, null);
  const basis = _rollBasis(roll, override);
  const eff = _effectiveFrom(basis, basePills, baseOff, session);
  const data = _buildOverride(basis, eff, session, [...baseOff]);
  if (override?.dstModName) data.dstModName = override.dstModName;
  return _writeOverride(message, targetKey, data);
}

function _findTargetForKey(message, state, targetKey) {
  if (targetKey === 'selected-token') return { selectedToken: true };
  return (state?.targets ?? []).find(t => _targetKey(t) === targetKey) ?? null;
}

class DstdRollEditor extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    id: 'dsct-roll-editor',
    classes: ['draw-steel', 'dsct-roll-editor'],
    window: { minimizable: false, resizable: false },
    position: { width: 340, height: 'auto' },
  };

  static PARTS = {
    form: { template: `modules/${M}/templates/dstd-roll-editor.hbs` },
  };

  constructor(message, target, roll, options = {}) {
    super(options);
    this._message  = message;
    this._target   = target;
    this._roll     = roll;
    this._targetKey = _targetKey(target);
    const state    = message.getFlag(DSTD, 'state');
    this._override = state?.tierOverrides?.[this._targetKey] ?? null;
    this._basis    = _rollBasis(roll, this._override);
    this._session  = _overrideSessionPills(roll, this._override);
    this._baseOff  = _overrideBaseOff(this._override);
    this._basePills = _basePills(roll, message.getFlag(M, 'rollPills') ?? null, target);
  }

  get title() {
    return game.i18n.format('DSCT.panel.rollEditor.title', { name: this._target?.name ?? '' });
  }

  _effective() {
    return _effectiveFrom(this._basis, this._basePills, this._baseOff, this._session);
  }

  async _prepareContext(_options) {
    const sm = this._basis.staticModifier;
    return {
      formula: `2d10 ${sm >= 0 ? '+' : '-'} ${Math.abs(sm)}`,
      natural: this._basis.naturalTotal,
      dice: _diceResults(this._roll).filter((n) => n >= 1 && n <= 10),
      targetName: this._target?.name ?? '',
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
    this._listenerAbort?.abort();
    this._listenerAbort = new AbortController();
    const { signal } = this._listenerAbort;
    const el = this.element;

    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="cancel"]')) { this.close(); return; }
      if (e.target.closest('[data-action="apply"]'))  { this._apply(); return; }
      if (e.target.closest('.dsct-add-mod-btn')) {
        new RollEditorAddDialog(this).render(true);
        return;
      }
      const pillBtn = e.target.closest('.dsct-re-pill[data-session-idx]');
      if (pillBtn) {
        const p = this._session[Number(pillBtn.dataset.sessionIdx)];
        if (p) p.enabled = p.enabled === false;
        this._refresh();
        return;
      }
      const baseBtn = e.target.closest('.dsct-re-base[data-base-idx]');
      if (baseBtn) {
        const idx = Number(baseBtn.dataset.baseIdx);
        if (this._baseOff.has(idx)) this._baseOff.delete(idx);
        else this._baseOff.add(idx);
        this._refresh();
      }
    }, { signal });

    el.addEventListener('contextmenu', (e) => {
      const pillBtn = e.target.closest('.dsct-re-pill[data-session-idx]');
      if (!pillBtn) return;
      e.preventDefault();
      this._session.splice(Number(pillBtn.dataset.sessionIdx), 1);
      this._refresh();
    }, { signal });

    this._refresh();
  }

  _refresh() {
    const el = this.element;
    const eff = this._effective();
    const preview = _buildOverride(this._basis, eff, this._session, [...this._baseOff]);
    const totalEl = el.querySelector('.dsct-re-total');
    if (totalEl) {
      const critical = preview.isCritical ? ` ${game.i18n.localize('DSCT.panel.rollEditor.critical')}` : '';
      totalEl.textContent = game.i18n.format('DSCT.panel.rollEditor.totalTier', { total: preview.total, tier: preview.tier }) + critical;
    }
    const totalClass = (val, kind) => val === 0 ? 'dsct-total-zero'
      : kind === 'edge' ? 'dsct-total-edge' : kind === 'bane' ? 'dsct-total-bane' : 'dsct-total-bonus';
    const setDisplay = (kind, val, text) => {
      const span = el.querySelector(`.dsct-total-display[data-dsct-kind="${kind}"]`);
      if (!span) return;
      span.textContent = text;
      span.className = `dsct-total-display ${totalClass(val, kind)}`;
      span.dataset.dsctKind = kind;
    };
    setDisplay('edge', eff.edges, String(eff.edges));
    setDisplay('bane', eff.banes, String(eff.banes));
    setDisplay('bonus', eff.bonuses, eff.bonuses >= 0 ? `+${eff.bonuses}` : String(eff.bonuses));

    const rowEl = el.querySelector('.dsct-re-pills');
    if (rowEl) {
      const base = this._basePills.map((p, idx) => {
        const off = this._baseOff.has(idx);
        const title = game.i18n.localize(off ? 'DSCT.panel.rollEditor.enablePill' : 'DSCT.panel.rollEditor.disablePill');
        const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
        return `<button type="button" class="dsct-source-pill dsct-re-base dsct-pill-${p.kind}${off ? ' dsct-pill-disabled' : ''}" data-base-idx="${idx}" title="${title}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`;
      });
      const session = this._session.map((p, idx) => {
        const off = p.enabled === false;
        const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
        return `<button type="button" class="dsct-source-pill dsct-re-pill dsct-pill-${p.kind} dsct-pill-custom${off ? ' dsct-pill-disabled' : ''}" data-session-idx="${idx}" title="${game.i18n.localize('DSCT.panel.rollEditor.sessionPill')}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`;
      });
      const label = `<span class="dsct-pills-label">${foundry.utils.escapeHTML(this._target?.name ?? '')}</span>`;
      const addBtn = `<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" title="${game.i18n.localize('DSCT.panel.rollEditor.addPill')}">+</button>`;
      rowEl.innerHTML = `${label}${[...base, ...session].join('')}${addBtn}`;
    }
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }

  async _apply() {
    if (!this._session.length && !this._baseOff.size) {
      if (this._override) await _writeOverride(this._message, this._targetKey, null);
      this.close();
      return;
    }
    const eff = this._effective();
    const override = _buildOverride(this._basis, eff, this._session, [...this._baseOff]);
    if (this._override?.dstModName) override.dstModName = this._override.dstModName;
    await _writeOverride(this._message, this._targetKey, override);
    this.close();
  }

  close(options) {
    this._listenerAbort?.abort();
    return super.close(options);
  }
}

class RollEditorAddDialog extends DSCTAddModifierDialog {
  constructor(editor, options = {}) {
    const tokenId = editor._target?.tokenId ?? editor._target?.tokenUuid ?? 'target';
    super({
      rendered: true,
      element: null,
      options: { context: { targets: { [tokenId]: { token: { name: editor._target?.name ?? '' } } } } },
      _dsctSources: [],
      _dsctOrigTargets: {},
    }, tokenId, options);
    this._editor = editor;
  }

  _submit() {
    const reason  = this._reasonInput?.value?.trim() || 'Custom';
    const srcName = this._sourceInput?.value?.trim() || null;
    const amount  = this._readValueAmount();
    this._editor._session.push({ kind: this._kind, amount, reason, src: srcName });
    this._editor._refresh();
    this.close();
  }
}

function _onDocumentClick(e) {
  const removeBtn = e.target.closest('.dsct-chat-pill-removable[data-msg-id]');
  if (removeBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(removeBtn.dataset.removeIdx);
    _mutateOverride(removeBtn.dataset.msgId, removeBtn.dataset.targetKey, ({ session }) => {
      session.splice(idx, 1);
    }).catch(err => console.error('DSCT | roll pills | remove failed', err));
    return;
  }
  const toggleBtn = e.target.closest('.dsct-chat-pill-toggle[data-msg-id]');
  if (toggleBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(toggleBtn.dataset.baseIdx);
    _mutateOverride(toggleBtn.dataset.msgId, toggleBtn.dataset.targetKey, ({ baseOff }) => {
      if (baseOff.has(idx)) baseOff.delete(idx);
      else baseOff.add(idx);
    }).catch(err => console.error('DSCT | roll pills | toggle failed', err));
    return;
  }

  if (!getSetting('dstdRollEditor')) return;
  const cog = e.target.closest('button[data-dstd-action="editRoll"]');
  if (!cog) return;
  const msgEl = cog.closest('[data-message-id]');
  const message = msgEl ? game.messages.get(msgEl.dataset.messageId) : null;
  if (!message) return;
  let target;
  try { target = JSON.parse(cog.dataset.target); } catch { return; }
  const roll = _findTargetRoll(message, target);
  if (!roll) return;
  const api = getModuleApi(false);
  if (!game.user.isGM && !message.isOwner && !api?.socket) return;
  e.preventDefault();
  e.stopPropagation();
  new DstdRollEditor(message, target, roll).render({ force: true });
}

export function registerDstdRollPills() {
  if (!game.modules.get(DSTD)?.active) return;

  Hooks.on('closeAbilityConfigurationDialog', (app) => {
    if (!getSetting('dstdRollPills')) return;
    if (app.config == null) return;
    _stashProvenance(app);
  });

  Hooks.on('createChatMessage', (message, _options, userId) => {
    if (userId !== game.user.id) return;
    if (!getSetting('dstdRollPills')) return;
    _persistProvenance(message);
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const msgId = message.id;
    const inject = () => {
      const live = root.isConnected
        ? root
        : (root.ownerDocument.querySelector(`li.chat-message[data-message-id="${msgId}"]`) ?? root);
      injectRollPills(message, live);
    };
    setTimeout(inject, 0);
    setTimeout(inject, 300);
  });

  const observerCallback = (mutations) => {
    const toInject = new Set();
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList?.contains('dsct-roll-pills-row')) continue;
        if (node.matches?.(`.${DSTD}-roll-display`) || node.querySelector?.(`.${DSTD}-roll-display`)) {
          const li = node.closest?.('li.chat-message[data-message-id]');
          if (li) toInject.add(li);
        }
      }
    }
    for (const li of toInject) {
      const message = game.messages.get(li.dataset.messageId);
      if (message) injectRollPills(message, li);
    }
  };

  const chatLog = document.querySelector('#chat-log') ?? document.querySelector('#chat') ?? document.body;
  new MutationObserver(observerCallback).observe(chatLog, { childList: true, subtree: true });

  document.addEventListener('click', _onDocumentClick, true);

  Hooks.on('openDetachedWindow', (_id, win) => {
    setTimeout(() => {
      try {
        win.document.addEventListener('click', _onDocumentClick, true);
        const log = win.document.querySelector('#chat-log') ?? win.document.body;
        new MutationObserver(observerCallback).observe(log, { childList: true, subtree: true });
      } catch {}
    }, 300);
  });
}
