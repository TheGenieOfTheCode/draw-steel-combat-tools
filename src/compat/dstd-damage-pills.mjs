import { getSetting, getModuleApi } from '../helpers.mjs';
import { chooseMessageFilter } from '../ability-automation/choose-effect.mjs';

const M    = 'draw-steel-combat-tools';
const DSTD = 'draw-steel-target-damage';

const L = (k, data) => data
  ? game.i18n.format(`DSCT.panel.damagePills.${k}`, data)
  : game.i18n.localize(`DSCT.panel.damagePills.${k}`);

const _isMult = (p) => p.kind === 'half' || p.kind === 'double';

export function damagePillDisplayList(pills) {
  const pairs = (pills ?? []).map((pill, idx) => ({ pill, idx, inert: false }));
  let list = pairs;
  try {
    if (getSetting('multiplierOverride')) {
      list = [...pairs.filter((x) => !_isMult(x.pill)), ...pairs.filter((x) => _isMult(x.pill))];
    }
    if (getSetting('noMultiplierStacking')) {
      const seen = {};
      for (const x of list) {
        if (!_isMult(x.pill)) continue;
        if (x.pill.enabled === false) continue;
        if (seen[x.pill.kind]) x.inert = true;
        else seen[x.pill.kind] = true;
      }
    }
  } catch {}
  let lastType = -1;
  list.forEach((x, i) => { if (x.pill.kind === 'type' && x.pill.enabled !== false) lastType = i; });
  list.forEach((x, i) => { if (x.pill.kind === 'type' && i !== lastType) x.inert = true; });
  return list;
}

export function foldDamagePills(base, pills) {
  let v = Number(base) || 0;
  for (const x of damagePillDisplayList(pills)) {
    if (x.inert || x.pill.enabled === false) continue;
    const p = x.pill;
    if (p.kind === 'half') v = Math.floor(v / 2);
    else if (p.kind === 'double') v = v * 2;
    else if (p.kind === 'delta' || p.kind === 'surge') v = Math.max(0, v + (Number(p.value) || 0));
  }
  return Math.max(0, v);
}

export function damageTypeLabel(value) {
  if (!value) return L('typeUntyped');
  const cfg = globalThis.ds?.CONFIG?.damageTypes?.[value];
  return cfg?.label ? game.i18n.localize(cfg.label) : value;
}

export function damageTypeColor(value) {
  try {
    const c = globalThis.ds?.CONFIG?.damageTypes?.[value]?.color;
    return c ? String(c) : null;
  } catch { return null; }
}

export function damagePillType(pills) {
  let found = null;
  for (const x of damagePillDisplayList(pills)) {
    if (x.inert || x.pill.enabled === false) continue;
    if (x.pill.kind === 'type') found = x.pill.value ?? '';
  }
  return found;
}

export function damagePillEffect(p) {
  if (p.kind === 'note') return (p.label ?? '').trim();
  if (p.kind === 'half') return L('effectHalf');
  if (p.kind === 'double') return L('effectDouble');
  if (p.kind === 'surge') return L('effectSurge', { n: Math.abs(Number(p.value) || 0) });
  if (p.kind === 'type') return L('effectType', { type: damageTypeLabel(p.value) });
  const v = Number(p.value) || 0;
  return v >= 0 ? L('effectPlus', { n: v }) : L('effectMinus', { n: Math.abs(v) });
}

export function damagePillAmtStr(p) {
  if (p.kind === 'half') return L('half');
  if (p.kind === 'double') return L('double');
  if (p.kind === 'surge') return L('surgeAmt', { n: Math.abs(Number(p.value) || 0) });
  if (p.kind === 'type') return damageTypeLabel(p.value);
  const v = Number(p.value) || 0;
  return v >= 0 ? `+${v}` : String(v);
}

export function damagePillText(p) {
  const label = (p.label ?? '').trim();
  if (p.kind === 'note') return label;
  if (label) return `${damagePillAmtStr(p)} · ${label}`;
  if (p.kind === 'half') return L('effectHalf');
  if (p.kind === 'double') return L('effectDouble');
  if (p.kind === 'surge') return L('surge');
  if (p.kind === 'type') return damageTypeLabel(p.value);
  return damagePillEffect(p);
}

function _typePillStyleAttr(p) {
  if (p.kind !== 'type') return '';
  const col = damageTypeColor(p.value);
  if (!col) return '';
  return ` style="color:${col};border-color:${col};background:color-mix(in srgb, ${col} 12%, transparent)"`;
}

export function styleTypePill(el, p) {
  if (p.kind !== 'type') return;
  const col = damageTypeColor(p.value);
  if (!col) return;
  el.style.color = col;
  el.style.borderColor = col;
  el.style.background = `color-mix(in srgb, ${col} 12%, transparent)`;
}

class DsctDamageEditor extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    id: 'dsct-damage-editor',
    classes: ['draw-steel', 'dsct-roll-editor', 'dsct-damage-editor'],
    window: { minimizable: false, resizable: false },
    position: { width: 340, height: 'auto' },
  };

  static PARTS = {
    form: { template: `modules/${M}/templates/dstd-damage-editor.hbs` },
  };

  constructor(config, done, options = {}) {
    super(options);
    this._cfg = config;
    this._done = done;
    this._pills = (config.pills ?? []).map(p => ({ ...p }));
  }

  get title() { return this._cfg.title ?? L('title'); }

  _surgeCap() {
    const surge = this._cfg.surge;
    return surge ? Math.min(3, Number(surge.available) || 0) : 0;
  }

  _stagedSurges() {
    return this._pills.filter(p => p.kind === 'surge' && p.enabled !== false).length;
  }

  async _prepareContext(_options) {
    return {
      base: this._cfg.base,
      hint: this._cfg.hint ?? '',
      label: this._cfg.label ?? '',
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
        new DsctDamageAddDialog(this).render(true);
        return;
      }
      const pillBtn = e.target.closest('.dsct-de-pill[data-pill-idx]');
      if (pillBtn) {
        const p = this._pills[Number(pillBtn.dataset.pillIdx)];
        if (p && p.kind !== 'note') p.enabled = p.enabled === false;
        this._refresh();
      }
    }, { signal });

    el.addEventListener('contextmenu', (e) => {
      const pillBtn = e.target.closest('.dsct-de-pill[data-pill-idx]');
      if (!pillBtn) return;
      e.preventDefault();
      const p = this._pills[Number(pillBtn.dataset.pillIdx)];
      if (p?.source === 'trigger') return;
      this._pills.splice(Number(pillBtn.dataset.pillIdx), 1);
      this._refresh();
    }, { signal });

    this._refresh();
  }

  _refresh() {
    const el = this.element;
    const finalEl = el.querySelector('.dsct-de-final');
    if (finalEl) finalEl.textContent = String(foldDamagePills(this._cfg.base, this._pills));

    const rowEl = el.querySelector('.dsct-re-pills');
    if (rowEl) {
      const items = damagePillDisplayList(this._pills).map((x) => {
        const p = x.pill;
        const off = p.enabled === false;
        const title = x.inert ? (p.kind === 'type' ? L('typeOverridden') : L('inert')) : L('sessionPill');
        const fromStr = p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : '';
        const srcAttr = (p.srcTokenId ? ` data-src-token-id="${p.srcTokenId}"` : '')
          + (p.lineFrom ? ` data-line-from="${p.lineFrom}"` : '')
          + (p.lineStyle ? ` data-line-style="${p.lineStyle}"` : '');
        return `<button type="button" class="dsct-source-pill dsct-de-pill dsct-dpill-${p.kind}${off ? ' dsct-pill-disabled' : ''}${x.inert ? ' dsct-dpill-inert' : ''}"${_typePillStyleAttr(p)} data-pill-idx="${x.idx}"${srcAttr} title="${foundry.utils.escapeHTML(title)}"><span class="dsct-pip">${foundry.utils.escapeHTML(damagePillText(p))}</span>${fromStr}</button>`;
      });
      const label = this._cfg.label
        ? `<span class="dsct-pills-label">${foundry.utils.escapeHTML(this._cfg.label)}</span>` : '';
      const addBtn = `<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" title="${L('addPill')}">+</button>`;
      rowEl.innerHTML = `${label}${items.join('')}${addBtn}`;
    }
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }

  _apply() {
    const result = { final: foldDamagePills(this._cfg.base, this._pills), pills: this._pills };
    this._done?.(result);
    this._done = null;
    this.close();
  }

  close(options) {
    this._listenerAbort?.abort();
    this._done?.(null);
    this._done = null;
    return super.close(options);
  }
}

export function openDamageEditor(config) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    new DsctDamageEditor(config, done).render({ force: true });
  });
}

function _openDamageAddDirect(config) {
  return new Promise((resolve) => {
    let settled = false;
    const shim = {
      rendered: true,
      _cfg: config,
      _pills: (config.pills ?? []).map(p => ({ ...p })),
      _surgeCap: DsctDamageEditor.prototype._surgeCap,
      _stagedSurges: DsctDamageEditor.prototype._stagedSurges,
      _refresh() {
        if (settled) return;
        settled = true;
        resolve({ final: foldDamagePills(config.base, this._pills), pills: this._pills });
      },
    };
    const dlg = new DsctDamageAddDialog(shim);
    const origClose = dlg.close.bind(dlg);
    dlg.close = (o) => { if (!settled) { settled = true; resolve(null); } return origClose(o); };
    dlg.render(true);
  });
}

class DsctDamageAddDialog extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    classes: ['dsct-add-modifier-dialog'],
    window: { title: 'Add Modifier', resizable: false },
    position: { width: 360 },
  };

  static PARTS = {
    main: { template: `modules/${M}/templates/dstd-damage-add.hbs` },
  };

  constructor(editor, options = {}) {
    super(options);
    this._editor = editor;
    this._kind   = 'half';
    this._negate = false;
  }

  
  _surgeRoom() {
    return Math.max(0, this._editor._surgeCap() - this._editor._stagedSurges());
  }

  async _prepareContext() {
    const surge = this._editor._cfg.surge;
    const room  = this._surgeRoom();
    return {
      hasSurge: !!surge,
      surgeDisabled: !surge || room <= 0,
      
      surgeOptions: Array.from({ length: room }, (_, i) => i + 1),
      surgeTooltip: surge ? L('surgeTooltip', { damage: surge.damage, available: surge.available }) : '',
      typeOptions: [
        { value: '__untyped', label: L('typeUntyped') },
        ...Object.entries(globalThis.ds?.CONFIG?.damageTypes ?? {})
          .map(([value, cfg]) => ({ value, label: game.i18n.localize(cfg.label ?? value) })),
      ],
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
    const root = this.element.querySelector('.dsct-amw') ?? this.element;
    this._amwRoot = root;
    this._previewPill = root.querySelector('.dsct-amw-preview-pill');
    this._reasonInput = root.querySelector('.dsct-amw-reason-input');
    this._sourceInput = root.querySelector('.dsct-amw-source-input');
    this._valueInput  = root.querySelector('.dsct-amw-value-input');
    this._valueGroup  = root.querySelector('.dsct-amw-value-group');
    this._typeGroup   = root.querySelector('.dsct-dmw-type-group');
    this._typeSelect  = root.querySelector('.dsct-dmw-type-select');
    this._surgeGroup  = root.querySelector('.dsct-amw-surge-group');
    this._surgeSelect = root.querySelector('.dsct-amw-surge-select');
    this._typeButtons = [...root.querySelectorAll('.dsct-amw-type-btn')];

    this._syncFields();

    if (!this._dsctListenersAttached) {
      this._dsctListenersAttached = true;
      root.addEventListener('click', (e) => {
        if (e.target.closest('.dsct-amw-cancel')) { this.close(); return; }
        if (e.target.closest('.dsct-amw-submit')) { this._submit(); return; }
        if (e.target.closest('.dsct-amw-target-fill')) {
          const t = game.user.targets.first();
          if (t && this._sourceInput) {
            this._sourceInput.value = t.name;
            this._updatePreview();
          }
        }
      });
    }

    for (const btn of this._typeButtons) {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this._typeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._kind   = btn.dataset.kind;
        this._negate = btn.dataset.negate === '1';
        this._syncFields();
        this._updatePreview();
      });
    }

    this._reasonInput?.addEventListener('input', () => this._updatePreview());
    this._sourceInput?.addEventListener('input', () => this._updatePreview());
    this._valueInput?.addEventListener('input',  () => this._updatePreview());
    this._typeSelect?.addEventListener('change', () => this._updatePreview());
    this._surgeSelect?.addEventListener('change', () => this._updatePreview());

    this._updatePreview();
  }

  _syncFields() {
    if (this._valueGroup) this._valueGroup.style.display = this._kind === 'delta' ? '' : 'none';
    if (this._typeGroup)  this._typeGroup.style.display  = this._kind === 'type' ? '' : 'none';
    if (this._surgeGroup) this._surgeGroup.style.display = this._kind === 'surge' ? '' : 'none';
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }

  _buildPill() {
    const reason  = this._reasonInput?.value?.trim() || '';
    const srcName = this._sourceInput?.value?.trim() || null;
    const srcToken = srcName ? canvas.tokens?.placeables.find(t => t.name === srcName) ?? null : null;
    const pill = { kind: this._kind, value: null, label: reason, src: srcName, srcTokenId: srcToken?.id ?? null, source: 'manual' };
    if (this._kind === 'delta') {
      const raw = Math.abs(parseInt(this._valueInput?.value) || 1);
      pill.value = this._negate ? -raw : raw;
    } else if (this._kind === 'surge') {
      pill.value = Number(this._editor._cfg.surge?.damage) || 0;
      pill.source = 'surge';
    } else if (this._kind === 'type') {
      const v = this._typeSelect?.value ?? '__untyped';
      pill.value = v === '__untyped' ? '' : v;
    }
    return pill;
  }

  _updatePreview() {
    const prev = this._previewPill;
    if (!prev) return;
    const pill = this._buildPill();
    const fromStr = pill.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(pill.src)}</span>` : '';

    prev.className = `dsct-source-pill dsct-dpill-${pill.kind} dsct-pill-custom dsct-amw-preview-pill`;
    prev.removeAttribute('style');
    styleTypePill(prev, pill);
    prev.innerHTML = `<span class="dsct-pip">${foundry.utils.escapeHTML(damagePillText(pill))}</span>${fromStr}`;

    
    
    for (const extra of prev.parentElement?.querySelectorAll('.dsct-amw-preview-extra') ?? []) extra.remove();
    const n = pill.kind === 'surge' ? (parseInt(this._surgeSelect?.value) || 1) : 1;
    for (let i = 1; i < n; i++) {
      const clone = prev.cloneNode(true);
      clone.classList.add('dsct-amw-preview-extra');
      prev.parentElement.appendChild(clone);
    }
  }

  _submit() {
    if (!this._editor?.rendered) { this.close(); return; }
    const pill = this._buildPill();

    if (pill.kind === 'surge') {
      const room = this._surgeRoom();
      if (room <= 0) { ui.notifications.warn(L('surgeCapWarn')); return; }
      
      
      const n = Math.min(Math.max(1, parseInt(this._surgeSelect?.value) || 1), room);
      for (let i = 0; i < n; i++) this._editor._pills.push({ ...pill });
      this._editor._refresh();
      this.close();
      return;
    }

    this._editor._pills.push(pill);
    this._editor._refresh();
    this.close();
  }
}

async function _updateMessage(message, payload) {
  if (game.user.isGM || message.isOwner) return message.update(payload);
  const api = getModuleApi(false);
  if (api?.socket) return api.socket.executeAsGM('dsct.updateDocument', message.uuid, payload);
  ui.notifications.warn(game.i18n.localize('DSCT.notice.rollPills.noPermission'));
}

function _pillFamily(state, opId) {
  const clicked = state.damageOverrides?.[opId];
  if (!clicked) return [];
  const all = Object.entries(state.damageOverrides ?? {});
  if (clicked.dstFam) return all.filter(([, ov]) => ov?.dstFam === clicked.dstFam);
  if (clicked.dstHalf) {
    const suffix = opId.slice(opId.lastIndexOf('-'));
    return all.filter(([id, ov]) => ov?.dstHalf && ov.dstModName === clicked.dstModName && id.endsWith(suffix));
  }
  return [[opId, clicked]];
}

function _pillOpData(ov, pills) {
  const base = Number(ov.baseAmount ?? 0);
  const orig = _origDamageType(ov);
  const typePill = damagePillType(pills);
  const surges = pills.filter((p) => p.kind === 'surge' && p.enabled !== false).length;
  const surgeDamage = Number(ov.surgeDamage ?? 0) || 0;
  return {
    ...ov,
    amount: foldDamagePills(base, pills),
    damageType: typePill != null ? typePill : orig.damageType,
    typeLabel: typePill != null ? (typePill ? damageTypeLabel(typePill) : '') : orig.typeLabel,
    dstOrigType: orig,
    surges,
    surgeBonus: surges * surgeDamage,
    dstPills: pills,
  };
}

async function _writePillsToOps(message, entries, pills, srcGrp = null) {
  if (!entries.length) return;
  const direct = game.user.isGM || message.isOwner;
  const FD = foundry.data?.operators?.ForcedDeletion;
  const FR = foundry.data?.operators?.ForcedReplacement;
  const payload = { [`flags.${DSTD}.state.updatedAt`]: Date.now() };
  const mults = pills.filter(_isMult);
  for (const [id, ov] of entries) {
    const own = (srcGrp == null || (ov.dstGrp ?? 'rolled') === srcGrp)
      ? pills
      : [...(Array.isArray(ov.dstPills) ? ov.dstPills : []).filter((p) => !_isMult(p)), ...mults];
    const removeAll = !own.length;
    if (removeAll && !ov.additional && (ov.dstOrigType !== undefined || !ov.damageType)) {
      if (direct && FD) payload[`flags.${DSTD}.state.damageOverrides.${id}`] = new FD();
      else payload[`flags.${DSTD}.state.damageOverrides.-=${id}`] = null;
      continue;
    }
    const data = _pillOpData(ov, own);
    payload[`flags.${DSTD}.state.damageOverrides.${id}`] = direct && FR ? new FR(data) : data;
  }
  if (direct) return message.update(payload);
  return _updateMessage(message, payload);
}

function _dsctHashKey(value) {
  let hash = 0;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function _targetOpId(target, partId, rollIndex) {
  const key = String(target?.tokenUuid ?? target?.actorUuid ?? '').replace(/\./g, '__');
  return `damage-${partId ?? 'part'}-${rollIndex}-${_dsctHashKey(key)}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

async function _siblingDamageOps(message, target) {
  if (!target || target.selectedToken) return [];
  const out = [];
  const DamageRoll = globalThis.ds?.rolls?.DamageRoll;
  const parts = Array.from(message.system?.parts?.contents ?? []);
  for (const part of parts) {
    const partId = part.id ?? part._id;
    const rolls = part.rolls ?? [];
    for (let i = 0; i < rolls.length; i++) {
      const roll = rolls[i];
      const isDamage = DamageRoll ? roll instanceof DamageRoll : roll?.constructor?.name === 'DamageRoll';
      if (!isDamage || roll?.isHeal) continue;
      out.push({
        opId: _targetOpId(target, partId, i), base: Number(roll.total ?? 0),
        damageType: roll.type ?? roll.options?.type ?? '', typeLabel: roll.typeLabel ?? '',
        grp: 'rolled',
      });
    }
  }
  const abilityUuid = parts.find((p) => p.type === 'abilityUse')?.abilityUuid;
  const ability = abilityUuid ? await fromUuid(abilityUuid).catch(() => null) : null;
  const chooseKeeps = chooseMessageFilter(message, ability);
  let dmgIndex = 0;
  for (const powerEffect of ability?.system?.power?.effects ?? []) {
    if (powerEffect.type !== 'damage') continue;
    if (chooseKeeps && !chooseKeeps(powerEffect)) continue;
    const effKey = powerEffect.id ?? powerEffect._id ?? `damage-${dmgIndex}`;
    for (const tier of [1, 2, 3]) {
      const tierData = powerEffect.damage?.[`tier${tier}`];
      if (!tierData || Number(tierData.value) === 0) continue;
      let amount = NaN;
      try {
        amount = Number(globalThis.ds?.utils?.simplifyRollFormula?.(String(tierData.value ?? '0'), ability.getRollData?.() ?? {}));
      } catch {  }
      if (!Number.isFinite(amount)) amount = Number(tierData.value);
      if (!Number.isFinite(amount)) continue;
      const type = tierData.types?.size === 1 ? tierData.types.first() : '';
      out.push({
        opId: _targetOpId(target, `tier${tier}-synthetic`, effKey), base: amount,
        damageType: type, typeLabel: type ? damageTypeLabel(type) : '',
        grp: 'rolled',
      });
    }
    dmgIndex++;
  }
  if (getSetting('flatEffectsEnabled')) {
    const chosen = foundry.utils.getProperty(message.flags, `${M}.flatDmgTypes`) ?? {};
    const targetHash = _dsctHashKey(String(target?.tokenUuid ?? '').replace(/\./g, '__'));
    for (const eff of Array.from(ability?.system?.effects?.contents ?? [])) {
      if (eff.type !== 'dsct.flatDamage') continue;
      if (chooseKeeps && !chooseKeeps(eff)) continue;
      let amount = NaN;
      try {
        amount = Number(globalThis.ds?.utils?.simplifyRollFormula?.(String(eff.flatDamage.value ?? '0'), ability.getRollData?.() ?? {}));
      } catch {  }
      if (!Number.isFinite(amount)) amount = Number(eff.flatDamage.value);
      if (!Number.isFinite(amount) || !amount) continue;
      const allTypes = Array.from(eff.flatDamage.types);
      const pick = chosen[eff.id] && allTypes.includes(chosen[eff.id]) ? chosen[eff.id] : (allTypes[0] ?? '');
      out.push({
        opId: `damage-${eff.id}-action-${targetHash}`.replace(/[^A-Za-z0-9_-]/g, '-'),
        base: amount, damageType: pick, typeLabel: pick ? damageTypeLabel(pick) : '',
        grp: `flat:${eff.id}`,
      });
    }
  }
  return out;
}

async function _toggleOverridePill(message, opId, idx) {
  const state = message.getFlag(DSTD, 'state') ?? {};
  const ov = state.damageOverrides?.[opId];
  if (!Array.isArray(ov?.dstPills) || !ov.dstPills[idx]) return;
  const pills = ov.dstPills.map((p, i) => i === idx ? { ...p, enabled: p.enabled === false } : p);
  await _writePillsToOps(message, _pillFamily(state, opId), pills, ov.dstGrp ?? 'rolled');
}

async function _toggleHalfFamily(message, opId) {
  const state = message.getFlag(DSTD, 'state') ?? {};
  const clicked = state.damageOverrides?.[opId];
  if (!clicked?.dstHalf) return;
  const targetHash = opId.slice(opId.lastIndexOf('-'));
  const off = !clicked.dstHalfOff;
  const payload = { [`flags.${DSTD}.state.updatedAt`]: Date.now() };
  for (const [id, ov] of Object.entries(state.damageOverrides ?? {})) {
    if (!ov?.dstHalf || ov.dstModName !== clicked.dstModName || !id.endsWith(targetHash)) continue;
    const base = Number(ov.baseAmount ?? 0);
    payload[`flags.${DSTD}.state.damageOverrides.${id}`] = {
      ...ov,
      amount: off ? base : Math.floor(base / 2),
      dstHalfOff: off,
    };
  }
  return _updateMessage(message, payload);
}

function _origDamageType(ov) {
  if (ov?.dstOrigType !== undefined) {
    return { damageType: ov.dstOrigType?.damageType ?? null, typeLabel: ov.dstOrigType?.typeLabel ?? null };
  }
  return { damageType: ov?.damageType || null, typeLabel: ov?.typeLabel || null };
}

async function _removeOverridePill(message, opId, idx) {
  const state = message.getFlag(DSTD, 'state') ?? {};
  const ov = state.damageOverrides?.[opId];
  if (!Array.isArray(ov?.dstPills)) return;
  const pills = ov.dstPills.filter((_, i) => i !== idx);
  await _writePillsToOps(message, _pillFamily(state, opId), pills, ov.dstGrp ?? 'rolled');
}

function _findPartRoll(message, partId, rollIndex) {
  if (partId === 'message') return message.rolls?.[rollIndex] ?? null;
  const parts = message.system?.parts;
  const list = parts
    ? (Array.isArray(parts) ? parts : Array.from(parts.contents ?? (typeof parts.values === 'function' ? parts.values() : Object.values(parts))))
    : [];
  const part = list.find((p) => (p.id ?? p._id) === partId);
  return part?.rolls?.[rollIndex] ?? null;
}

async function _resolveSurgeContext(message, state) {
  let src = null;
  if (state.sourceActorUuid) src = await fromUuid(state.sourceActorUuid).catch(() => null);
  if (!src && state.abilityUuid) src = (await fromUuid(state.abilityUuid).catch(() => null))?.actor ?? null;
  if (src?.type === 'retainer') src = src.system?.retainer?.mentor ?? null;
  if (src?.type === 'draw-steel-companion.companion') src = src.system?.retainer?.mentor ?? null;
  if (src?.type !== 'hero') return null;
  return {
    actorUuid: src.uuid,
    available: Number(src.system?.hero?.surges ?? 0) || 0,
    damage: Number(src.getRollData?.()?.chr ?? 0) || 0,
  };
}

function _seedPillsFromOverride(ov) {
  if (Array.isArray(ov?.dstPills)) return ov.dstPills.map((p) => ({ ...p }));
  const seed = [];
  if (ov?.dstHalf) seed.push({ kind: 'half', label: ov.dstModName ?? '', src: ov.dstSrcName ?? null, srcTokenId: ov.dstSrcTokenId ?? null, source: 'trigger', ...(ov.dstHalfOff ? { enabled: false } : {}) });
  const surges = Number(ov?.surges ?? 0) || 0;
  for (let i = 0; i < surges; i++) seed.push({ kind: 'surge', value: Number(ov?.surgeDamage ?? 0) || 0, label: '', source: 'surge' });
  const bonus = Number(ov?.bonus ?? 0) || 0;
  if (bonus) seed.push({ kind: 'delta', value: bonus, label: '', source: 'manual' });
  return seed;
}

async function _openPillDamageEditor(message, button, fullEditor = false) {
  let target = {};
  try { target = JSON.parse(button.dataset.target ?? '{}'); } catch {}
  const opId = button.dataset.operationId;
  if (!opId) return;
  const state = foundry.utils.getProperty(message.flags, `${DSTD}.state`) ?? {};
  const ov = state.damageOverrides?.[opId] ?? null;
  const roll = _findPartRoll(message, button.dataset.partId, Number(button.dataset.rollIndex));
  const synthetic = button.dataset.syntheticDamage === 'true';
  const base = Number(ov?.baseAmount ?? roll?.total ?? (synthetic ? button.dataset.amount : NaN));
  if (!Number.isFinite(base)) {
    ui.notifications.warn(L('noRoll'));
    return;
  }
  const srcGrp = synthetic ? `flat:${button.dataset.partId}` : 'rolled';
  const surge = synthetic ? null : await _resolveSurgeContext(message, state);
  const editorCfg = {
    title: L('editorTitle', { name: target.name ?? '' }),
    label: target.name ?? '',
    base,
    pills: _seedPillsFromOverride(ov),
    surge,
  };
  const outcome = (!fullEditor && getSetting('skipPillEditor'))
    ? await _openDamageAddDirect(editorCfg)
    : await openDamageEditor(editorCfg);
  if (!outcome) return;

  const pills = outcome.pills.map((p) => ({
    kind: p.kind, value: p.value ?? null, label: p.label ?? '', src: p.src ?? null,
    srcTokenId: p.srcTokenId ?? null, source: p.source ?? 'manual',
    ...(p.enabled === false ? { enabled: false } : {}),
  }));
  if (!pills.length && !ov) return;
  const fam = ov?.dstFam ?? foundry.utils.randomID();
  const surgeDamage = surge?.damage ?? (Number(ov?.surgeDamage ?? 0) || 0);
  const cleanEntry = (o) => ({
    baseAmount: Number(o.baseAmount ?? 0),
    bonus: 0,
    additional: o.additional ?? '',
    damageType: o.damageType ?? '',
    typeLabel: o.typeLabel ?? '',
    ...(o.dstOrigType !== undefined ? { dstOrigType: o.dstOrigType } : {}),
    surgeDamage,
    dstFam: fam,
    dstGrp: o.grp ?? 'rolled',
    dstPills: Array.isArray(o.dstPills) ? o.dstPills : [],
  });
  const sibs    = await _siblingDamageOps(message, target);
  const grpById = new Map(sibs.map((s) => [s.opId, s.grp]));
  const known = new Map((ov ? _pillFamily(state, opId) : []).map(([id, o]) =>
    [id, cleanEntry({ ...o, grp: o.dstGrp ?? grpById.get(id) ?? 'rolled' })]));
  if (!known.has(opId)) {
    known.set(opId, cleanEntry({
      baseAmount: base,
      damageType: roll?.type ?? roll?.options?.type ?? button.dataset.damageType ?? '',
      typeLabel: roll?.typeLabel ?? button.dataset.typeLabel ?? '',
      grp: srcGrp,
    }));
  }
  const hasMult = pills.some(_isMult);
  if (pills.length) {
    for (const sib of sibs) {
      if (known.has(sib.opId) || state.damageOverrides?.[sib.opId]) continue;
      if (sib.grp !== srcGrp && !hasMult) continue;
      known.set(sib.opId, cleanEntry({ baseAmount: sib.base, damageType: sib.damageType, typeLabel: sib.typeLabel, grp: sib.grp }));
    }
  }
  await _writePillsToOps(message, [...known.entries()], pills, srcGrp);
}

const _providers = [];

export function registerDamagePillProvider(fn) {
  _providers.push(fn);
}

function _pillRowFor(btn) {
  const host = btn.closest('[class*="action-row"]');
  if (!host?.parentElement) return null;
  const next = host.nextElementSibling;
  if (next?.classList?.contains('dsct-dmg-pills-row')) return next;
  const rowEl = document.createElement('div');
  rowEl.className = 'dsct-dmg-pills-row';
  host.insertAdjacentElement('afterend', rowEl);
  return rowEl;
}

function _multSuffixText(halves, doubles) {
  const sup = (n) => n > 1 ? String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]) : '';
  const parts = [];
  if (halves) parts.push(L('suffixHalf') + sup(halves));
  if (doubles) parts.push(L('suffixDouble') + sup(doubles));
  return parts.length ? ` (${parts.join(' ')})` : '';
}

function _multSuffixFor(pills) {
  let halves = 0;
  let doubles = 0;
  for (const x of damagePillDisplayList(pills)) {
    if (x.inert || x.pill.enabled === false) continue;
    if (x.pill.kind === 'half') halves++;
    else if (x.pill.kind === 'double') doubles++;
  }
  return _multSuffixText(halves, doubles);
}

function _applyMultSuffix(btn, suffix) {
  const span = btn.querySelector('span');
  if (!span || span.dataset.dsctMultSuffix === suffix) return;
  if (span.dataset.dsctBaseLabel == null) span.dataset.dsctBaseLabel = span.textContent;
  span.dataset.dsctMultSuffix = suffix;
  span.textContent = span.dataset.dsctBaseLabel + suffix;
}

export function injectDamagePills(message, root) {
  if (!game.modules.get(DSTD)?.active) return;
  const overrides = foundry.utils.getProperty(message.flags, `${DSTD}.state.damageOverrides`) ?? {};
  const apps = foundry.utils.getProperty(message.flags, `${DSTD}.state.applications`) ?? {};
  const canRemove = game.user.isGM || message.isOwner || !!getModuleApi(false)?.socket;

  const byOp = new Map();
  const add = (opId, pill, { toggleable = false, custom = false, idx = null, legacyHalf = false, inert = false } = {}) => {
    if (!byOp.has(opId)) byOp.set(opId, []);
    byOp.get(opId).push({ pill, toggleable, custom, idx, legacyHalf, inert });
  };
  const suffixByOp = new Map();

  const wildcards = [];
  const providerEntries = [];
  for (const fn of _providers) {
    let extra = [];
    try { extra = fn(message) ?? []; } catch (err) { console.error('DSCT | damage pill provider failed', err); }
    for (const entry of extra) {
      if (entry.opId === '*') wildcards.push(entry.pill);
      else providerEntries.push(entry);
    }
  }
  if (wildcards.length) {
    const seen = new Set();
    for (const btn of root.querySelectorAll('button[data-dstd-action="applyDamage"][data-operation-id]')) {
      const id = btn.dataset.operationId;
      if (seen.has(id)) continue;
      seen.add(id);
      const opPills = overrides[id]?.dstPills ?? apps[id]?.override?.dstPills;
      const typeOverridden = Array.isArray(opPills) && damagePillType(opPills) != null;
      for (const p of wildcards) add(id, p, { inert: p.kind === 'type' && typeOverridden });
    }
    if (getSetting('debugMode')) console.log(`DSCT | damage pills | wildcard pills=${wildcards.length} matched ops=${seen.size} msg=${message.id}`);
  }

  for (const [opId, ov] of Object.entries(overrides)) {
    const applied = apps[opId]?.status === 'applied';
    if (Array.isArray(ov?.dstPills) && ov.dstPills.length) {
      for (const x of damagePillDisplayList(ov.dstPills)) {
        const toggleable = !applied && x.pill.kind !== 'note';
        add(opId, x.pill, { toggleable, custom: toggleable && x.pill.source !== 'trigger', idx: x.idx, inert: x.inert });
      }
      suffixByOp.set(opId, _multSuffixFor(ov.dstPills));
    } else if (ov?.dstHalf) {
      add(opId, {
        kind: 'half', label: ov.dstModName ?? '', src: ov.dstSrcName ?? null, srcTokenId: ov.dstSrcTokenId ?? null,
        source: 'trigger', ...(ov.dstHalfOff ? { enabled: false } : {}),
      }, { toggleable: !applied, legacyHalf: true });
    }
  }

  for (const [opId, rec] of Object.entries(apps)) {
    if (rec?.status !== 'applied' || overrides[opId]) continue;
    const recPills = rec.override?.dstPills ?? [];
    for (const p of recPills) add(opId, p);
    if (recPills.length) suffixByOp.set(opId, _multSuffixFor(recPills));
  }

  for (const entry of providerEntries) add(entry.opId, entry.pill);

  for (const btn of root.querySelectorAll('button[data-dstd-action="editDamage"][data-operation-id]')) {
    btn.disabled = apps[btn.dataset.operationId]?.status === 'applied';
  }

  for (const [opId, items] of byOp) {
    for (const btn of root.querySelectorAll(`button[data-dstd-action="applyDamage"][data-operation-id="${opId}"]`)) {
      _applyMultSuffix(btn, suffixByOp.get(opId) ?? '');
      const rowEl = _pillRowFor(btn);
      if (!rowEl || rowEl.dataset.dsctPills === opId) continue;
      rowEl.dataset.dsctPills = opId;
      rowEl.innerHTML = '';
      for (const it of items) {
        const p = it.pill;
        const span = document.createElement('button');
        span.type = 'button';
        span.className = `dsct-source-pill dsct-dmg-pill dsct-dpill-${p.kind}${it.inert ? ' dsct-dpill-inert' : ''}${p.enabled === false ? ' dsct-pill-disabled' : ''}`;
        styleTypePill(span, p);
        span.innerHTML = `<span class="dsct-pip">${foundry.utils.escapeHTML(damagePillText(p))}</span>${p.src ? `<span class="dsct-pill-from">from ${foundry.utils.escapeHTML(p.src)}</span>` : ''}`;
        if (p.srcTokenId) span.dataset.srcTokenId = p.srcTokenId;
        if (p.lineFrom)   span.dataset.lineFrom   = p.lineFrom;
        if (p.lineStyle)  span.dataset.lineStyle  = p.lineStyle;
        let tooltip = it.inert
          ? (p.kind === 'type' ? L('typeOverridden') : L('inert'))
          : damagePillEffect(p);
        if (it.toggleable && canRemove) {
          span.classList.add('dsct-dmg-pill-live');
          span.dataset.dpillOp = opId;
          span.dataset.dpillMsg = message.id;
          if (!it.legacyHalf && it.idx != null) span.dataset.dpillIdx = String(it.idx);
          if (it.custom) {
            span.classList.add('dsct-pill-custom');
            span.dataset.dpillCustom = '1';
            tooltip += `<br>${L('sessionPill')}`;
          } else {
            tooltip += `<br>${L('toggleTooltip')}`;
          }
        }
        span.dataset.tooltip = tooltip;
        rowEl.appendChild(span);
      }
    }
  }
}

document.addEventListener('click', async (ev) => {
  const pill = ev.target?.closest?.('.dsct-dmg-pill-live[data-dpill-op]');
  if (!pill) return;
  ev.preventDefault();
  ev.stopPropagation();
  const msgId = pill.dataset.dpillMsg || pill.closest('li.chat-message')?.dataset?.messageId;
  const message = msgId ? game.messages.get(msgId) : null;
  if (!message || (!game.user.isGM && !message.isOwner && !getModuleApi(false)?.socket)) return;
  const opId = pill.dataset.dpillOp;
  if (pill.dataset.dpillIdx != null) {
    await _toggleOverridePill(message, opId, Number(pill.dataset.dpillIdx));
    return;
  }
  
  
  await _toggleHalfFamily(message, opId);
}, { capture: true });

document.addEventListener('contextmenu', async (ev) => {
  const pill = ev.target?.closest?.('.dsct-dmg-pill-live[data-dpill-op][data-dpill-custom]');
  if (!pill || pill.dataset.dpillIdx == null) return;
  ev.preventDefault();
  ev.stopPropagation();
  const msgId = pill.dataset.dpillMsg || pill.closest('li.chat-message')?.dataset?.messageId;
  const message = msgId ? game.messages.get(msgId) : null;
  if (!message || (!game.user.isGM && !message.isOwner && !getModuleApi(false)?.socket)) return;
  await _removeOverridePill(message, pill.dataset.dpillOp, Number(pill.dataset.dpillIdx));
}, { capture: true });

document.addEventListener('click', (ev) => {
  const btn = ev.target?.closest?.('button[data-dstd-action="editDamage"]');
  if (!btn || !game.modules.get(DSTD)?.active || !getSetting('pillDamageEditor')) return;
  const msgId = btn.closest('[data-message-id]')?.dataset?.messageId;
  const message = msgId ? game.messages.get(msgId) : null;
  if (!message) return;
  if (!message.isOwner && !game.user.isGM && !getModuleApi(false)?.socket) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  _openPillDamageEditor(message, btn, ev.shiftKey).catch((err) => console.error('DSCT | pill damage editor:', err));
}, { capture: true });

export function registerDstdDamagePills() {
  if (!game.modules.get(DSTD)?.active) return;

  Hooks.on('renderChatMessageHTML', (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const msgId = message.id;
    const inject = () => {
      const live = root.isConnected
        ? root
        : (root.ownerDocument.querySelector(`li.chat-message[data-message-id="${msgId}"]`) ?? root);
      injectDamagePills(message, live);
    };
    setTimeout(inject, 0);
    setTimeout(inject, 300);
  });

  const observerCallback = (mutations) => {
    const toInject = new Set();
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList?.contains('dsct-dmg-pills-row')) continue;
        if (node.matches?.(`.${DSTD}-target-row`) || node.querySelector?.(`.${DSTD}-target-row`)
          || node.matches?.(`.${DSTD}-panel`) || node.querySelector?.(`.${DSTD}-panel`)) {
          const li = node.closest?.('li.chat-message[data-message-id]');
          if (li) toInject.add(li);
        }
      }
    }
    for (const li of toInject) {
      const message = game.messages.get(li.dataset.messageId);
      if (message) injectDamagePills(message, li);
    }
  };

  const chatLog = document.querySelector('#chat-log') ?? document.querySelector('#chat') ?? document.body;
  new MutationObserver(observerCallback).observe(chatLog, { childList: true, subtree: true });

  Hooks.on('openDetachedWindow', (_id, win) => {
    setTimeout(() => {
      try {
        const log = win.document.querySelector('#chat-log') ?? win.document.body;
        new MutationObserver(observerCallback).observe(log, { childList: true, subtree: true });
      } catch {}
    }, 300);
  });
}
