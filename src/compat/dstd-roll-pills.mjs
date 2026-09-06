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

function _findBaseRoll(message) {
  const parts = Array.from(message.system?.parts?.contents ?? [])
    .filter(p => Array.from(p.rolls ?? []).some(_isPowerRoll));
  for (const part of parts) {
    const roll = Array.from(part.rolls ?? []).reverse().find(r => _isPowerRoll(r) && !r?.options?.target);
    if (roll) return roll;
  }
  return parts.length ? Array.from(parts[0].rolls).reverse().find(_isPowerRoll) ?? null : null;
}

function _globalPills(message) {
  const list = message.getFlag(M, 'rollGlobalPills');
  return Array.isArray(list) ? list.map(p => ({ ...p })) : [];
}

function _overrideGlobalOff(override) {
  return new Set(Array.isArray(override?.dsctGlobalOff) ? override.dsctGlobalOff : []);
}

function _activeGlobals(globalPills, globalOff) {
  return globalPills.filter(p => p.enabled !== false && !globalOff.has(p.id)).length;
}

function _msgGlobalBaseOff(message) {
  const list = message.getFlag(M, 'rollGlobalBaseOff');
  return new Set(Array.isArray(list) ? list : []);
}

function _overrideGlobalBaseOff(override) {
  return new Set(Array.isArray(override?.dsctGlobalBaseOff) ? override.dsctGlobalBaseOff : []);
}

function _globalBasePills(message, prov) {
  const baseRoll = _findBaseRoll(message);
  if (!baseRoll) return [];
  const pills = (prov?.global ?? []).map(p => ({ ...p }));
  const sums = { edge: 0, bane: 0, bonus: 0 };
  for (const p of pills) {
    if (p.enabled === false) continue;
    sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
  }
  const re  = Number(baseRoll.options?.edges ?? 0)   - sums.edge;
  const rb  = Number(baseRoll.options?.banes ?? 0)   - sums.bane;
  const rbo = Number(baseRoll.options?.bonuses ?? 0) - sums.bonus;
  if (re > 0)  pills.push({ kind: 'edge',  amount: re,  reason: 'Rolled', src: null });
  if (rb > 0)  pills.push({ kind: 'bane',  amount: rb,  reason: 'Rolled', src: null });
  if (rbo)     pills.push({ kind: 'bonus', amount: rbo, reason: 'Rolled', src: null });
  return pills;
}

function _rollCtx(message, state, prov) {
  const grouped = (state?.targets?.length ?? 0) > 1;
  return {
    grouped,
    globalBase: grouped ? _globalBasePills(message, prov) : [],
    globalBaseOff: _msgGlobalBaseOff(message),
    globalPills: _globalPills(message),
  };
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

function _buildOverride(basis, eff, dsctPills, dsctBaseOff, dsctGlobalOff = [], dsctGlobalBaseOff = []) {
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
    dsctGlobalOff,
    dsctGlobalBaseOff,
  };
}

function _effectiveFrom(basis, o) {
  
  
  
  const sums = { edge: 0, bane: 0, bonus: 0 };
  for (const [i, p] of (o.basePills ?? []).entries()) {
    if (p.removed) continue;
    const active = (p.enabled !== false) !== !!o.baseOff?.has(i);
    if (active) sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
  }
  for (const p of o.session ?? []) {
    if (p.enabled === false) continue;
    sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
  }
  const ctx = o.ctx;
  if (ctx) {
    for (const p of ctx.globalPills) {
      if (p.enabled === false || o.globalOff?.has(p.id)) continue;
      sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
    }
    for (const [i, p] of ctx.globalBase.entries()) {
      if (p.removed) continue;
      const flipped = ctx.globalBaseOff.has(i) !== (o.globalBaseOff?.has(i) ?? false);
      const active = (p.enabled !== false) !== flipped;
      if (active) sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
    }
  }
  return {
    edges: Math.max(0, Math.min(2, sums.edge)),
    banes: Math.max(0, Math.min(2, sums.bane)),
    bonuses: sums.bonus,
  };
}

const _pendingProvenance = new Map();

function _stashProvenance(app) {
  const ability = app.options?.ability;
  if (!ability?.uuid || !app._dsctSources) return;
  const shrink = (p) => ({
    kind: p.kind, amount: p.amount, reason: p.reason, src: p.src ?? null, srcTokenId: p.srcTokenId ?? null,
    ...(p.enabled ? {} : { enabled: false }),
    ...(p.custom ? { custom: true } : {}),
  });
  const global = app._dsctSources.filter(p => p.scope === 'global').map(shrink);
  const targets = {};
  for (const tokenId of Object.keys(app.options.context?.targets ?? {})) {
    const uuid = canvas.tokens?.get(tokenId)?.document?.uuid;
    if (!uuid) continue;
    const list = app._dsctSources.filter(p => p.scope === tokenId).map(shrink);
    
    
    if (list.length) targets[uuid.replace(/\./g, '__')] = list;
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
  if (p.echo) {
    cls += ' dsct-chat-pill-echo';
    if (p.disabled) cls += ' dsct-pill-disabled';
    if (p.clickable) {
      attrs = p.gbase
        ? ` data-gbecho-idx="${p.gbaseIdx}" data-msg-id="${msgId}" data-target-key="${targetKey}"`
        : ` data-echo-id="${p.id}" data-msg-id="${msgId}" data-target-key="${targetKey}"`;
      title += p.disabled
        ? `\n${game.i18n.localize('DSCT.panel.rollEditor.echoPillOff')}`
        : `\n${game.i18n.localize('DSCT.panel.rollEditor.echoPill')}`;
    }
  } else if (p.gbaseGlobal) {
    cls += ' dsct-chat-pill-gbase';
    if (p.disabled) cls += ' dsct-pill-disabled';
    if (p.clickable) {
      attrs = ` data-gbase-idx="${p.gbaseIdx}" data-msg-id="${msgId}"`;
      title += p.disabled
        ? `\n${game.i18n.localize('DSCT.panel.rollEditor.gbasePillOff')}`
        : `\n${game.i18n.localize('DSCT.panel.rollEditor.gbasePill')}`;
      if (p.custom) {
        cls += ' dsct-pill-custom';
        attrs += ' data-custom-gbase="1"';
        title += `\n${game.i18n.localize('DSCT.panel.rollEditor.customRemove')}`;
      }
    }
  } else if (p.globalPill) {
    cls += ' dsct-chat-pill-global dsct-pill-custom';
    if (p.disabled) cls += ' dsct-pill-disabled';
    if (p.clickable) {
      attrs = ` data-global-id="${p.id}" data-msg-id="${msgId}"`;
      title += `\n${game.i18n.localize('DSCT.panel.rollEditor.globalChatPill')}`;
    }
  } else if (p.removable) {
    cls += ' dsct-chat-pill-removable dsct-pill-custom';
    if (p.disabled) cls += ' dsct-pill-disabled';
    attrs = ` data-remove-idx="${p.overrideIdx}" data-msg-id="${msgId}" data-target-key="${targetKey}"`;
    title += `\n${game.i18n.localize('DSCT.panel.rollEditor.sessionChatPill')}`;
  } else if (p.toggleable) {
    cls += ' dsct-chat-pill-toggle';
    if (p.disabled) cls += ' dsct-pill-disabled';
    attrs = ` data-base-idx="${p.baseIdx}" data-msg-id="${msgId}" data-target-key="${targetKey}"`;
    title += p.disabled ? '\nDisabled. Click to re-enable' : '\nClick to disable';
    if (p.custom) {
      cls += ' dsct-pill-custom';
      attrs += ' data-custom-base="1"';
      title += `\n${game.i18n.localize('DSCT.panel.rollEditor.customRemove')}`;
    }
  } else {
    cls += ' dsct-chat-pill-inert';
    if (p.disabled) cls += ' dsct-pill-disabled';
  }
  if (p.srcTokenId) attrs += ` data-src-token-id="${p.srcTokenId}"`;
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

function _basePills(roll, prov, target, ctx = null) {
  const pills = [];
  const includeGlobal = !ctx?.grouped;
  if (prov || (ctx?.grouped && ctx.globalBase.length)) {
    if (includeGlobal) for (const p of prov?.global ?? []) pills.push({ ...p });
    for (const p of prov?.targets?.[String(target?.tokenUuid ?? '').replace(/\./g, '__')] ?? []) pills.push({ ...p });
    const sums = { edge: 0, bane: 0, bonus: 0 };
    for (const p of pills) {
      if (p.enabled === false) continue;
      sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
    }
    if (ctx?.grouped) {
      for (const p of ctx.globalBase) {
        if (p.enabled === false) continue;
        sums[p.kind] = (sums[p.kind] ?? 0) + (Number(p.amount) || 0);
      }
    }
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
  const ctx = _rollCtx(message, state, prov);

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
    const pills = _basePills(roll, prov, target, ctx).map((p, idx) => ({
      ...p, toggleable: canEdit, baseIdx: idx, disabled: (p.enabled === false) !== baseOff.has(idx),
    })).filter(p => !p.removed);
    _overrideSessionPills(roll, override).forEach((p, idx) => {
      pills.push({ ...p, removable: canEdit, overrideIdx: idx, disabled: p.enabled === false });
    });
    if (ctx.grouped) {
      const gbOff = _overrideGlobalBaseOff(override);
      ctx.globalBase.forEach((p, idx) => {
        if (p.removed) return;
        if ((p.enabled === false) !== ctx.globalBaseOff.has(idx)) return;
        pills.push({ ...p, echo: true, clickable: canEdit, toggleable: false, gbase: true, gbaseIdx: idx, disabled: gbOff.has(idx) });
      });
      const globalOff = _overrideGlobalOff(override);
      for (const p of ctx.globalPills) {
        if (p.enabled === false) continue;
        pills.push({ ...p, echo: true, clickable: canEdit, toggleable: false, disabled: globalOff.has(p.id) });
      }
    }
    if (!pills.length) continue;

    const row = document.createElement('div');
    row.className = 'dsct-roll-pills-row';
    row.dataset.msgId = message.id;
    row.innerHTML = pills.map(p => _chatPillHTML(p, message.id, targetKey)).join('');
    rollLine.after(row);
  }

  const summary = root.querySelector(`.${DSTD}-base-roll-summary`);
  if (summary && ctx.grouped) {
    const rollLine = summary.querySelector(`.${DSTD}-roll-line`);
    const baseRoll = _findBaseRoll(message);
    if (rollLine && baseRoll) {
      summary.querySelectorAll('.dsct-roll-pills-row').forEach(e => e.remove());
      if (canEdit && getSetting('dstdRollEditor') && !rollLine.querySelector('.dsct-global-cog')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${DSTD}-icon-button ${DSTD}-cog-button dsct-global-cog`;
        btn.dataset.dsctGlobalEdit = message.id;
        btn.dataset.tooltip = game.i18n.localize('DSCT.panel.rollEditor.globalEdit');
        btn.innerHTML = '<i class="fa-solid fa-gear"></i>';
        rollLine.append(btn);
      }
      const gp = ctx.globalBase.map((p, idx) => ({
        ...p, gbaseGlobal: true, clickable: canEdit, gbaseIdx: idx, disabled: (p.enabled === false) !== ctx.globalBaseOff.has(idx),
      })).filter(p => !p.removed);
      gp.push(...ctx.globalPills.map(p => ({ ...p, globalPill: true, clickable: canEdit, disabled: p.enabled === false })));
      if (gp.length) {
        const row = document.createElement('div');
        row.className = 'dsct-roll-pills-row dsct-global-pills-row';
        row.dataset.msgId = message.id;
        row.innerHTML = gp.map(p => _chatPillHTML(p, message.id, '')).join('');
        rollLine.after(row);
      }
    }
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
  const prov = message.getFlag(M, 'rollPills') ?? null;
  const ctx = _rollCtx(message, state, prov);
  const basePills = _basePills(roll, prov, target, ctx);
  const baseOff = _overrideBaseOff(override);
  const session = _overrideSessionPills(roll, override);
  const globalOff = _overrideGlobalOff(override);
  const globalBaseOff = _overrideGlobalBaseOff(override);
  mutate({ baseOff, session, globalOff, globalBaseOff });
  const stillNeeded = baseOff.size || session.length || globalOff.size || globalBaseOff.size
    || _activeGlobals(ctx.globalPills, globalOff) || ctx.globalBaseOff.size
    || basePills.some(p => p.removed) || ctx.globalBase.some(p => p.removed);
  if (!stillNeeded) return _writeOverride(message, targetKey, null);
  const basis = _rollBasis(roll, override);
  const eff = _effectiveFrom(basis, { basePills, baseOff, session, ctx, globalOff, globalBaseOff });
  const data = _buildOverride(basis, eff, session, [...baseOff], [...globalOff], [...globalBaseOff]);
  if (override?.dstModName) data.dstModName = override.dstModName;
  return _writeOverride(message, targetKey, data);
}

async function _recomputeAllTargets(message, globalPills, globalBaseOffList = null) {
  const state = message.getFlag(DSTD, 'state');
  if (!state) return;
  const prov = message.getFlag(M, 'rollPills') ?? null;
  const FD = foundry.data?.operators?.ForcedDeletion;
  const direct = game.user.isGM || message.isOwner;
  const validIds = new Set(globalPills.map(p => p.id));
  const msgGlobalBaseOff = globalBaseOffList != null ? [...globalBaseOffList] : [..._msgGlobalBaseOff(message)];
  const ctx = _rollCtx(message, state, prov);
  ctx.globalPills = globalPills.map(p => ({ ...p }));
  ctx.globalBaseOff = new Set(msgGlobalBaseOff.filter(i => i < ctx.globalBase.length));
  const payload = {
    [`flags.${M}.rollGlobalPills`]: globalPills,
    [`flags.${M}.rollGlobalBaseOff`]: [...ctx.globalBaseOff],
    [`flags.${DSTD}.state.updatedAt`]: Date.now(),
  };
  for (const t of state.targets ?? []) {
    const targetKey = _targetKey(t);
    const roll = _findTargetRoll(message, t);
    if (!roll) continue;
    const override = state.tierOverrides?.[targetKey] ?? null;
    const baseOff = _overrideBaseOff(override);
    const session = _overrideSessionPills(roll, override);
    const globalOff = new Set([..._overrideGlobalOff(override)].filter(id => validIds.has(id)));
    const globalBaseOff = new Set([..._overrideGlobalBaseOff(override)].filter(i => i < ctx.globalBase.length && !ctx.globalBaseOff.has(i)));
    const stillNeeded = baseOff.size || session.length || globalOff.size || globalBaseOff.size
      || _activeGlobals(ctx.globalPills, globalOff) || ctx.globalBaseOff.size;
    if (!stillNeeded) {
      if (override) {
        if (direct && FD) payload[`flags.${DSTD}.state.tierOverrides.${targetKey}`] = new FD();
        else payload[`flags.${DSTD}.state.tierOverrides.-=${targetKey}`] = null;
      }
      continue;
    }
    const basis = _rollBasis(roll, override);
    const basePills = _basePills(roll, prov, t, ctx);
    const eff = _effectiveFrom(basis, { basePills, baseOff, session, ctx, globalOff, globalBaseOff });
    const data = _buildOverride(basis, eff, session, [...baseOff], [...globalOff], [...globalBaseOff]);
    if (override?.dstModName) data.dstModName = override.dstModName;
    payload[`flags.${DSTD}.state.tierOverrides.${targetKey}`] = data;
  }
  if (direct) return message.update(payload);
  const api = getModuleApi(false);
  if (api?.socket) return api.socket.executeAsGM('dsct.updateDocument', message.uuid, payload);
  ui.notifications.warn(game.i18n.localize('DSCT.notice.rollPills.noPermission'));
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
    this._global   = !!options.globalMode;
    this._target   = target;
    this._roll     = roll;
    this._targetKey = this._global ? null : _targetKey(target);
    const state    = message.getFlag(DSTD, 'state');
    this._override = this._global ? null : (state?.tierOverrides?.[this._targetKey] ?? null);
    this._basis    = _rollBasis(roll, this._override);
    const prov     = message.getFlag(M, 'rollPills') ?? null;
    this._ctx      = _rollCtx(message, state, prov);
    if (this._global) {
      this._session = _globalPills(message);
      this._baseOff = new Set(this._ctx.globalBaseOff);
      this._globalOff = new Set();
      this._globalBaseOffT = new Set();
      this._basePills = this._ctx.globalBase;
    } else {
      this._session = _overrideSessionPills(roll, this._override);
      this._baseOff = _overrideBaseOff(this._override);
      this._globalOff = _overrideGlobalOff(this._override);
      this._globalBaseOffT = _overrideGlobalBaseOff(this._override);
      this._basePills = _basePills(roll, prov, target, this._ctx);
    }
  }

  get title() {
    if (this._global) return game.i18n.localize('DSCT.panel.rollEditor.globalTitle');
    return game.i18n.format('DSCT.panel.rollEditor.title', { name: this._target?.name ?? '' });
  }

  _effective() {
    if (this._global) {
      return _effectiveFrom(this._basis, {
        basePills: this._basePills, baseOff: this._baseOff, session: this._session,
      });
    }
    return _effectiveFrom(this._basis, {
      basePills: this._basePills, baseOff: this._baseOff, session: this._session, ctx: this._ctx,
      globalOff: this._globalOff, globalBaseOff: this._globalBaseOffT,
    });
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
      const gbEchoBtn = e.target.closest('.dsct-re-echo[data-gbecho-idx]');
      if (gbEchoBtn) {
        const idx = Number(gbEchoBtn.dataset.gbechoIdx);
        if (this._globalBaseOffT.has(idx)) this._globalBaseOffT.delete(idx);
        else this._globalBaseOffT.add(idx);
        this._refresh();
        return;
      }
      const echoBtn = e.target.closest('.dsct-re-echo[data-echo-id]');
      if (echoBtn) {
        const id = echoBtn.dataset.echoId;
        if (this._globalOff.has(id)) this._globalOff.delete(id);
        else this._globalOff.add(id);
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
        if (p.removed) return '';
        const off = (p.enabled === false) !== this._baseOff.has(idx);
        const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
        const title = game.i18n.localize(off ? 'DSCT.panel.rollEditor.enablePill' : 'DSCT.panel.rollEditor.disablePill');
        return `<button type="button" class="dsct-source-pill dsct-re-base dsct-pill-${p.kind}${off ? ' dsct-pill-disabled' : ''}" data-base-idx="${idx}" title="${title}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`;
      });
      const session = this._session.map((p, idx) => {
        const off = p.enabled === false;
        const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
        return `<button type="button" class="dsct-source-pill dsct-re-pill dsct-pill-${p.kind} dsct-pill-custom${off ? ' dsct-pill-disabled' : ''}" data-session-idx="${idx}" title="${game.i18n.localize('DSCT.panel.rollEditor.sessionPill')}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`;
      });
      const echoes = [];
      if (!this._global && this._ctx.grouped) {
        this._ctx.globalBase.forEach((p, idx) => {
          if (p.removed) return;
          if ((p.enabled === false) !== this._ctx.globalBaseOff.has(idx)) return;
          const off = this._globalBaseOffT.has(idx);
          const title = game.i18n.localize(off ? 'DSCT.panel.rollEditor.echoPillOff' : 'DSCT.panel.rollEditor.echoPill');
          const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
          echoes.push(`<button type="button" class="dsct-source-pill dsct-re-echo dsct-chat-pill-echo dsct-pill-${p.kind}${off ? ' dsct-pill-disabled' : ''}" data-gbecho-idx="${idx}" title="${title}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`);
        });
        for (const p of this._ctx.globalPills.filter(p => p.enabled !== false)) {
          const off = this._globalOff.has(p.id);
          const title = game.i18n.localize(off ? 'DSCT.panel.rollEditor.echoPillOff' : 'DSCT.panel.rollEditor.echoPill');
          const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
          echoes.push(`<button type="button" class="dsct-source-pill dsct-re-echo dsct-chat-pill-echo dsct-pill-${p.kind}${off ? ' dsct-pill-disabled' : ''}" data-echo-id="${p.id}" title="${title}"><span class="dsct-pip">${_pillAmtStr(p)} &middot; ${foundry.utils.escapeHTML(p.reason ?? '')}</span>${fromStr}</button>`);
        }
      }
      const labelText = this._global
        ? game.i18n.localize('DSCT.panel.rollEditor.globalLabel')
        : (this._target?.name ?? '');
      const label = `<span class="dsct-pills-label">${foundry.utils.escapeHTML(labelText)}</span>`;
      const addBtn = `<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" title="${game.i18n.localize('DSCT.panel.rollEditor.addPill')}">+</button>`;
      rowEl.innerHTML = `${label}${[...base, ...session, ...echoes].join('')}${addBtn}`;
    }
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }

  async _apply() {
    if (this._global) {
      const pills = this._session.map(p => ({
        id: p.id ?? foundry.utils.randomID(),
        kind: p.kind,
        amount: p.amount,
        reason: p.reason ?? '',
        src: p.src ?? null,
        ...(p.enabled === false ? { enabled: false } : {}),
      }));
      await _recomputeAllTargets(this._message, pills, [...this._baseOff]);
      this.close();
      return;
    }
    const keep = this._session.length || this._baseOff.size || this._globalOff.size
      || this._globalBaseOffT.size || this._ctx.globalBaseOff.size
      || _activeGlobals(this._ctx.globalPills, this._globalOff)
      || this._basePills.some(p => p.removed) || this._ctx.globalBase.some(p => p.removed);
    if (!keep) {
      if (this._override) await _writeOverride(this._message, this._targetKey, null);
      this.close();
      return;
    }
    const eff = this._effective();
    const override = _buildOverride(this._basis, eff, this._session, [...this._baseOff], [...this._globalOff], [...this._globalBaseOffT]);
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
    const name = editor._global
      ? game.i18n.localize('DSCT.panel.rollEditor.globalLabel')
      : (editor._target?.name ?? '');
    super({
      rendered: true,
      element: null,
      options: { context: { targets: { [tokenId]: { token: { name } } } } },
      _dsctSources: [],
      _dsctOrigTargets: {},
    }, tokenId, options);
    this._editor = editor;
  }

  _submit() {
    const reason  = this._reasonInput?.value?.trim() || 'Custom';
    const srcName = this._sourceInput?.value?.trim() || null;
    const srcToken = srcName ? canvas.tokens?.placeables.find(t => t.name === srcName) ?? null : null;
    const amount  = this._readValueAmount();
    this._editor._session.push({ kind: this._kind, amount, reason, src: srcName, srcTokenId: srcToken?.id ?? null });
    this._editor._refresh();
    this.close();
  }
}

async function _writeProvenance(message, prov) {
  const payload = { [`flags.${M}.rollPills`]: prov };
  if (game.user.isGM || message.isOwner) return message.update(payload);
  const api = getModuleApi(false);
  if (api?.socket) return api.socket.executeAsGM('dsct.updateDocument', message.uuid, payload);
  ui.notifications.warn(game.i18n.localize('DSCT.notice.rollPills.noPermission'));
}

async function _removeCustomBasePill(msgId, targetKey, baseIdx) {
  const message = game.messages.get(msgId);
  if (!message) return;
  const state = message.getFlag(DSTD, 'state');
  const target = _findTargetForKey(message, state, targetKey);
  const prov = foundry.utils.deepClone(message.getFlag(M, 'rollPills') ?? null);
  if (!prov || !target) return;
  const ctx = _rollCtx(message, state, prov);
  const gl = ctx.grouped ? [] : (prov.global ?? []);
  const tl = prov.targets?.[String(target.tokenUuid ?? '').replace(/\./g, '__')] ?? [];
  const entry = baseIdx < gl.length ? gl[baseIdx] : tl[baseIdx - gl.length];
  if (!entry?.custom || entry.removed) return;
  entry.removed = true;
  await _writeProvenance(message, prov);
  await _mutateOverride(msgId, targetKey, () => {});
}

async function _removeCustomGlobalBasePill(msgId, gbaseIdx) {
  const message = game.messages.get(msgId);
  if (!message) return;
  const prov = foundry.utils.deepClone(message.getFlag(M, 'rollPills') ?? null);
  const entry = prov?.global?.[gbaseIdx];
  if (!entry?.custom || entry.removed) return;
  entry.removed = true;
  await _writeProvenance(message, prov);
  await _recomputeAllTargets(message, _globalPills(message), [..._msgGlobalBaseOff(message)]);
}

function _onDocumentContextMenu(e) {
  const baseBtn = e.target.closest?.('[data-custom-base][data-base-idx][data-msg-id]');
  const gbaseBtn = e.target.closest?.('[data-custom-gbase][data-gbase-idx][data-msg-id]');
  const sessBtn = e.target.closest?.('.dsct-chat-pill-removable[data-remove-idx][data-msg-id]');
  const globBtn = e.target.closest?.('.dsct-chat-pill-global[data-global-id][data-msg-id]');
  const btn = baseBtn ?? gbaseBtn ?? sessBtn ?? globBtn;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const message = game.messages.get(btn.dataset.msgId);
  if (!message || (!game.user.isGM && !message.isOwner && !getModuleApi(false)?.socket)) return;
  if (baseBtn) {
    _removeCustomBasePill(btn.dataset.msgId, btn.dataset.targetKey, Number(btn.dataset.baseIdx));
  } else if (gbaseBtn) {
    _removeCustomGlobalBasePill(btn.dataset.msgId, Number(btn.dataset.gbaseIdx));
  } else if (sessBtn) {
    const idx = Number(btn.dataset.removeIdx);
    _mutateOverride(btn.dataset.msgId, btn.dataset.targetKey, ({ session }) => {
      session.splice(idx, 1);
    }).catch(err => console.error('DSCT | roll pills | session remove failed', err));
  } else {
    const remaining = _globalPills(message).filter(p => p.id !== btn.dataset.globalId);
    _recomputeAllTargets(message, remaining)
      .catch(err => console.error('DSCT | roll pills | global remove failed', err));
  }
}

function _onDocumentClick(e) {
  const gbEchoBtn = e.target.closest('.dsct-chat-pill-echo[data-gbecho-idx]');
  if (gbEchoBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(gbEchoBtn.dataset.gbechoIdx);
    _mutateOverride(gbEchoBtn.dataset.msgId, gbEchoBtn.dataset.targetKey, ({ globalBaseOff }) => {
      if (globalBaseOff.has(idx)) globalBaseOff.delete(idx);
      else globalBaseOff.add(idx);
    }).catch(err => console.error('DSCT | roll pills | global base echo toggle failed', err));
    return;
  }
  const gbaseBtn = e.target.closest('.dsct-chat-pill-gbase[data-gbase-idx]');
  if (gbaseBtn) {
    e.preventDefault();
    e.stopPropagation();
    const message = game.messages.get(gbaseBtn.dataset.msgId);
    if (!message) return;
    const idx = Number(gbaseBtn.dataset.gbaseIdx);
    const off = _msgGlobalBaseOff(message);
    if (off.has(idx)) off.delete(idx);
    else off.add(idx);
    _recomputeAllTargets(message, _globalPills(message), [...off])
      .catch(err => console.error('DSCT | roll pills | global base toggle failed', err));
    return;
  }
  const echoBtn = e.target.closest('.dsct-chat-pill-echo[data-echo-id]');
  if (echoBtn) {
    e.preventDefault();
    e.stopPropagation();
    const id = echoBtn.dataset.echoId;
    _mutateOverride(echoBtn.dataset.msgId, echoBtn.dataset.targetKey, ({ globalOff }) => {
      if (globalOff.has(id)) globalOff.delete(id);
      else globalOff.add(id);
    }).catch(err => console.error('DSCT | roll pills | echo toggle failed', err));
    return;
  }
  const globalBtn = e.target.closest('.dsct-chat-pill-global[data-msg-id]');
  if (globalBtn) {
    e.preventDefault();
    e.stopPropagation();
    const message = game.messages.get(globalBtn.dataset.msgId);
    if (!message) return;
    const toggled = _globalPills(message).map(p => p.id === globalBtn.dataset.globalId
      ? { ...p, enabled: p.enabled === false }
      : p);
    _recomputeAllTargets(message, toggled)
      .catch(err => console.error('DSCT | roll pills | global toggle failed', err));
    return;
  }
  const gcog = e.target.closest('.dsct-global-cog[data-dsct-global-edit]');
  if (gcog) {
    e.preventDefault();
    e.stopPropagation();
    const message = game.messages.get(gcog.dataset.dsctGlobalEdit);
    const baseRoll = message ? _findBaseRoll(message) : null;
    if (!message || !baseRoll) return;
    new DstdRollEditor(message, null, baseRoll, { globalMode: true }).render({ force: true });
    return;
  }
  const removeBtn = e.target.closest('.dsct-chat-pill-removable[data-msg-id]');
  if (removeBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(removeBtn.dataset.removeIdx);
    _mutateOverride(removeBtn.dataset.msgId, removeBtn.dataset.targetKey, ({ session }) => {
      const p = session[idx];
      if (p) p.enabled = p.enabled === false;
    }).catch(err => console.error('DSCT | roll pills | session toggle failed', err));
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
  document.addEventListener('contextmenu', _onDocumentContextMenu, true);
  document.addEventListener('pointerover', _onPillHoverIn);
  document.addEventListener('pointerout', _onPillHoverOut);

  Hooks.on('openDetachedWindow', (_id, win) => {
    setTimeout(() => {
      try {
        win.document.addEventListener('click', _onDocumentClick, true);
        win.document.addEventListener('contextmenu', _onDocumentContextMenu, true);
        win.document.addEventListener('pointerover', _onPillHoverIn);
        win.document.addEventListener('pointerout', _onPillHoverOut);
        const log = win.document.querySelector('#chat-log') ?? win.document.body;
        new MutationObserver(observerCallback).observe(log, { childList: true, subtree: true });
      } catch {}
    }, 300);
  });
}

function _hoverPillEl(e) {
  const el = e.target?.closest?.('.dsct-source-pill[data-src-token-id]');
  if (!el) return null;
  if (!el.closest('li.chat-message, .dsct-roll-editor, .dsct-damage-editor')) return null;
  return el;
}

function _onPillHoverIn(e) {
  const el = _hoverPillEl(e);
  if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
  if (!canvas?.ready) return;
  const token = canvas.tokens.placeables.find(t => t.id === el.dataset.srcTokenId);
  if (!token || !token.visible || !token._canHover(game.user, e)) return;
  token._onHoverIn(e, { hoverOutOthers: true });
}

function _onPillHoverOut(e) {
  const el = _hoverPillEl(e);
  if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
  if (!canvas?.ready) return;
  const token = canvas.tokens.placeables.find(t => t.id === el.dataset.srcTokenId);
  token?._onHoverOut(e);
}
