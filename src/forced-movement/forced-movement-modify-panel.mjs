import { getModuleApi } from '../helpers.mjs';

export const replayModifiers = (baseStates, stack, states) => {
  for (let i = 0; i < states.length; i++) {
    const base = baseStates[i];
    const st   = states[i];
    st.distance          = base.distance;
    st.movement          = base.movement;
    st.vertical          = base.vertical;
    st.verticalDistance  = base.verticalDistance;
    st.fallReduction     = base.fallReduction;
    st.noFallDamage      = base.noFallDamage;
    st.noCollisionDamage        = base.noCollisionDamage;
    st.noMoverCollisionDamage   = base.noMoverCollisionDamage;
    st.noObstacleCollisionDamage = base.noObstacleCollisionDamage;
    st.ignoreStability          = base.ignoreStability;
    st.fastMove                 = base.fastMove;
    for (const entry of stack) {
      if (entry.enabled === false) continue;
      const m = entry.modState[i];
      if (!m) continue;
      st.distance                  += m.distanceDelta;
      st.movement                   = m.movement;
      st.vertical                   = m.vertical;
      st.verticalDistance           = m.verticalDistance;
      st.fallReduction              = m.fallReduction;
      st.noFallDamage               = m.noFallDamage;
      st.noCollisionDamage          = m.noCollisionDamage;
      st.noMoverCollisionDamage     = m.noMoverCollisionDamage;
      st.noObstacleCollisionDamage   = m.noObstacleCollisionDamage;
      st.ignoreStability            = m.ignoreStability;
      st.fastMove                   = m.fastMove;
    }
  }
  console.log(`DSCT | replayModifiers | stack depth=${stack.length} states=${JSON.stringify(states.map(st => ({ movement: st.movement, distance: st.distance })))}`);
};

const DSCT_FM_PRESET_KEY = 'dsct-fm-presets';
const loadPresets = () => { try { return JSON.parse(localStorage.getItem(DSCT_FM_PRESET_KEY) ?? '[]'); } catch { return []; } };
const savePresets = (arr) => localStorage.setItem(DSCT_FM_PRESET_KEY, JSON.stringify(arr));

export const persistStack = (msgEl, stack) => {
  const msgId = msgEl?.dataset?.messageId;
  if (!msgId) return;
  const msg = game.messages.get(msgId);
  if (!msg) return;
  const stackData = stack.map(e => ({
    modState: e.modState, noteName: e.noteName, noteDesc: e.noteDesc,
    noteSrc: e.noteSrc ?? null, srcTokenId: e.srcTokenId ?? null,
    ...(e.enabled === false ? { enabled: false } : {}),
  }));
  const api = getModuleApi();
  if (api?.socket) api.socket.executeAsGM('dsct.updateDocument', msg.uuid, { 'flags.draw-steel-combat-tools.fmModifiers': stackData });
  else msg.setFlag('draw-steel-combat-tools', 'fmModifiers', stackData);
};

const _buildModTooltip = (entry, baseStates) => {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const lines = entry.modState.map((m, i) => {
    const base  = baseStates[i];
    const parts = [];
    if (m.distanceDelta !== 0)                              parts.push(`Distance ${m.distanceDelta > 0 ? '+' : ''}${m.distanceDelta}`);
    if (m.movement !== base?.movement)                      parts.push(`→ ${cap(m.movement)}`);
    if (m.vertical && !base?.vertical)                      parts.push('Vertical');
    if (m.verticalDistance !== '' && m.verticalDistance !== base?.verticalDistance) parts.push(`Vert. dist. ${m.verticalDistance}`);
    if (m.fallReduction !== (base?.fallReduction ?? 0))     parts.push(`Fall reduction: ${m.fallReduction}`);
    if (m.noFallDamage)                                     parts.push('No fall damage');
    if (m.noCollisionDamage)                                parts.push('No collision damage');
    if (m.noMoverCollisionDamage)                           parts.push('No mover damage');
    if (m.noObstacleCollisionDamage)                        parts.push('No obstacle damage');
    if (m.ignoreStability)                                  parts.push('Ignore stability');
    if (m.fastMove)                                         parts.push('Fast path');
    return parts.join(', ');
  }).filter(Boolean);
  const summary = lines.join('\n');
  const hint    = game.i18n.localize('DSCT.panel.modFm.modifierTitle');
  return summary ? `${summary}\n${'_'.repeat(24)}\n${hint}` : hint;
};

const _modEffectSummary = (entry, baseStates) => {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const m = entry.modState[0];
  const base = baseStates[0];
  if (!m) return '';
  const parts = [];
  if (m.distanceDelta !== 0)                          parts.push(`${m.distanceDelta > 0 ? '+' : ''}${m.distanceDelta} Distance`);
  if (m.movement !== base?.movement)                  parts.push(`→ ${cap(m.movement)}`);
  if (m.vertical && !base?.vertical)                  parts.push('Vertical');
  if (m.fallReduction !== (base?.fallReduction ?? 0)) parts.push(`Fall -${m.fallReduction}`);
  if (m.noFallDamage)                                 parts.push('No Fall Dmg');
  if (m.noCollisionDamage)                            parts.push('No Collision Dmg');
  if (m.noMoverCollisionDamage)                       parts.push('No Mover Dmg');
  if (m.noObstacleCollisionDamage)                    parts.push('No Obstacle Dmg');
  if (m.ignoreStability)                              parts.push('Ignore Stability');
  if (m.fastMove)                                     parts.push('Fast Path');
  return parts.join(', ');
};

export const createModifierNoteDiv = (entry, modifierStack, baseStates, states, btnEls, makeLabel, noteParent, msgEl, persistFn = persistStack) => {
  const { noteName, noteDesc } = entry;
  const esc = foundry.utils.escapeHTML;
  const pillBtn = document.createElement('button');
  pillBtn.type = 'button';
  pillBtn.className = `dsct-source-pill dsct-fm-pill dsct-pill-custom${entry.enabled === false ? ' dsct-pill-disabled' : ''}`;
  pillBtn.dataset.modifierName = noteName;
  if (entry.srcTokenId) pillBtn.dataset.srcTokenId = entry.srcTokenId;
  const effectStr = _modEffectSummary(entry, baseStates);
  const fromStr = entry.noteSrc ? `<span class="dsct-pill-from">from ${esc(entry.noteSrc)}</span>` : '';
  pillBtn.innerHTML = `<span class="dsct-pip">${effectStr ? `${esc(effectStr)} &middot; ${esc(noteName)}` : esc(noteName)}</span>${fromStr}`;
  const descLine = noteDesc ? `${noteDesc}\n` : '';
  pillBtn.title = `${descLine}${_buildModTooltip(entry, baseStates)}`;

  const refresh = () => {
    replayModifiers(baseStates, modifierStack, states);
    for (let i = 0; i < states.length; i++) {
      btnEls[i].innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${makeLabel(states[i])}`;
    }
    persistFn(msgEl, modifierStack);
  };
  pillBtn.addEventListener('click', () => {
    entry.enabled = entry.enabled === false;
    pillBtn.classList.toggle('dsct-pill-disabled', entry.enabled === false);
    refresh();
  });
  pillBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const idx = modifierStack.indexOf(entry);
    if (idx !== -1) modifierStack.splice(idx, 1);
    pillBtn.remove();
    refresh();
  });
  let row = noteParent.querySelector(':scope > .dsct-fm-pills-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'dsct-fm-pills-row';
    noteParent.appendChild(row);
  }
  row.appendChild(pillBtn);
  return pillBtn;
};

export class FmModifyPanel extends ds.applications.api.DSApplication {
  constructor(states, baseStates, modifierStack, effects, btnEls, makeLabel, msgEl, noteParent = null, persistFn = null) {
    super();
    this._states         = states;
    this._baseStates     = baseStates;
    this._modifierStack  = modifierStack;
    this._effects        = effects;
    this._btnEls         = btnEls;
    this._makeLabel      = makeLabel;
    this._msgEl          = msgEl;
    this._noteParent     = noteParent;
    this._persistFn      = persistFn ?? persistStack;
    console.log(`DSCT | FmModifyPanel constructed | effects=${effects.length} msgId=${msgEl?.dataset?.messageId}`);
  }

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/chat-integration.hbs' },
  };

  static DEFAULT_OPTIONS = {
    id: 'dsct-fm-modify',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.ModifyFM', minimizable: false, resizable: true },
    position: { width: 312, height: 'auto' },
    actions: {
      'apply-mod': FmModifyPanel._onApplyMod,
    },
  };

  static async _onApplyMod(_event, _target) {
    const root    = this.element;
    const rawName = root.querySelector('[data-field="note-name"]')?.value?.trim() ?? '';
    const rawDesc = root.querySelector('[data-field="note-desc"]')?.value?.trim() ?? '';
    const rawSrc  = root.querySelector('[data-field="note-src"]')?.value?.trim() ?? '';

    if (rawName && this._msgEl) {
      const existingNames = [...this._msgEl.querySelectorAll('.dsct-fm-pill[data-modifier-name]')]
        .map(n => n.dataset.modifierName);
      if (existingNames.includes(rawName)) {
        ui.notifications.error(game.i18n.format('DSCT.notice.chat.modifierAlreadyApplied', { name: rawName }));
        return;
      }
    }

    const modState = this._states.map((_, i) => {
      const tmp = { ...this._states[i] };
      this._readInputs(root, i, tmp);
      console.log(`DSCT | FmModifyPanel apply-mod | i=${i} distanceDelta=${tmp.distance} movement=${tmp.movement} vertical=${tmp.vertical}`);
      return {
        distanceDelta:     tmp.distance,
        movement:          tmp.movement,
        vertical:          tmp.vertical,
        verticalDistance:  tmp.verticalDistance,
        fallReduction:     tmp.fallReduction,
        noFallDamage:              tmp.noFallDamage,
        noCollisionDamage:         tmp.noCollisionDamage,
        noMoverCollisionDamage:    tmp.noMoverCollisionDamage,
        noObstacleCollisionDamage:  tmp.noObstacleCollisionDamage,
        ignoreStability:           tmp.ignoreStability,
        fastMove:                  tmp.fastMove,
      };
    });

    const existing = this._msgEl?.querySelectorAll('.dsct-fm-pill').length ?? 0;
    const noteName = rawName || game.i18n.format('DSCT.panel.modFm.defaultName', { n: existing + 1 });
    const srcToken = rawSrc ? canvas.tokens?.placeables.find(t => t.name === rawSrc) ?? null : null;
    const entry    = { modState, noteName, noteDesc: rawDesc, noteSrc: rawSrc || null, srcTokenId: srcToken?.id ?? null };
    this._modifierStack.push(entry);
    console.log(`DSCT | FmModifyPanel apply-mod | stack depth now=${this._modifierStack.length}`);
    replayModifiers(this._baseStates, this._modifierStack, this._states);

    for (let i = 0; i < this._states.length; i++) {
      const newLabel = this._makeLabel(this._states[i]);
      console.log(`DSCT | FmModifyPanel apply-mod | updating btnEl[${i}] to "${newLabel}"`);
      this._btnEls[i].innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${newLabel}`;
    }

    if (this._msgEl) {
      const noteParent = this._noteParent
        ?? (this._msgEl.querySelector('.dsct-forced-buttons')?.parentElement ?? this._msgEl);
      createModifierNoteDiv(entry, this._modifierStack, this._baseStates, this._states, this._btnEls, this._makeLabel, noteParent, this._msgEl, this._persistFn);
      this._persistFn(this._msgEl, this._modifierStack);
    } else {
      console.warn('DSCT | FmModifyPanel apply-mod | no msgEl, cannot inject note');
    }

    this.close();
  }

  async close(options = {}) {
    if (this._shiftListeners) {
      document.removeEventListener('keydown', this._shiftListeners.down);
      document.removeEventListener('keyup',   this._shiftListeners.up);
      this._shiftListeners = null;
    }
    return super.close(options);
  }

  _readInputs(root, i, st) {
    st.movement          = root.querySelector(`[data-field="type-${i}"]`)?.value       ?? st.movement;
    st.distance          = parseInt(root.querySelector(`[data-field="distance-${i}"]`)?.value) || 0;
    st.vertical          = root.querySelector(`[data-field="vertical-${i}"]`)?.checked ?? st.vertical;
    const vdRaw          = root.querySelector(`[data-field="vertDist-${i}"]`)?.value   ?? '';
    st.verticalDistance  = vdRaw !== '' ? (parseInt(vdRaw) || '') : '';
    st.fallReduction     = parseInt(root.querySelector(`[data-field="fallRed-${i}"]`)?.value) || 0;
    st.noFallDamage             = root.querySelector(`[data-field="noFall-${i}"]`)?.checked      ?? st.noFallDamage;
    const colDmgVal             = root.querySelector(`[data-field="colDmg-${i}"]`)?.value ?? 'all';
    st.noCollisionDamage        = colDmgVal === 'none';
    st.noMoverCollisionDamage   = colDmgVal === 'no-mover';
    st.noObstacleCollisionDamage = colDmgVal === 'no-obstacle';
    st.ignoreStability          = root.querySelector(`[data-field="ignoreStab-${i}"]`)?.checked  ?? st.ignoreStability;
    st.fastMove          = root.querySelector(`[data-field="fast-${i}"]`)?.checked     ?? st.fastMove;
  }

  _buildEffectSections() {
    return this._states.map((state, i) => {
      const effectName = this._effects[i]?.name ?? this._makeLabel(state);
      return `
        ${this._states.length > 1 ? `<div class="dsct-section-label" style="margin-bottom:5px;">${effectName}</div>` : ''}
        <div class="dsct-fm-effect-section">

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="dsct-section-label">Distance</div>
            <div style="display:flex;gap:4px;align-items:center;">
              <select data-field="type-${i}" style="width:72px;">
                <option value="push"  ${state.movement === 'push'  ? 'selected' : ''}>Push</option>
                <option value="pull"  ${state.movement === 'pull'  ? 'selected' : ''}>Pull</option>
                <option value="slide" ${state.movement === 'slide' ? 'selected' : ''}>Slide</option>
              </select>
              <span class="dsct-fm-distance-display" title="Current effective distance">${state.distance}</span>
              <span style="font-size:11px;color:var(--dsct-textDim);">&#177;</span>
              <input type="number" data-field="distance-${i}" value="0" step="1"
                style="width:31px;text-align:center;" title="Distance delta - adds to current effective distance">
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="color:var(--dsct-accent);font-size:11px;font-weight:bold;display:flex;align-items:center;gap:4px;cursor:pointer;">
              <input type="checkbox" data-field="vertical-${i}" ${state.vertical ? 'checked' : ''}> Vertical
            </label>
            <input type="number" data-field="vertDist-${i}" placeholder="${state.distance}" step="1"
              style="width:48px;text-align:center;" title="Leave blank to match distance">
          </div>

          <div class="dsct-divider"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="dsct-section-label">Fall Reduction</div>
            <input type="number" data-field="fallRed-${i}" value="${state.fallReduction}" min="0" step="1"
              style="width:36px;text-align:center;" title="Bonus on top of Agility">
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="dsct-section-label">Collision Damage</div>
            <select data-field="colDmg-${i}" style="width:175px;">
              <option value="all"        ${ (!state.noCollisionDamage && !state.noMoverCollisionDamage && !state.noObstacleCollisionDamage) ? 'selected' : ''}>All Take Damage</option>
              <option value="no-mover"   ${(!state.noCollisionDamage &&  state.noMoverCollisionDamage)   ? 'selected' : ''}>Moved Takes No Damage</option>
              <option value="no-obstacle" ${(!state.noCollisionDamage &&  state.noObstacleCollisionDamage) ? 'selected' : ''}>Obstacles Take No Damage</option>
              <option value="none"       ${ state.noCollisionDamage                                      ? 'selected' : ''}>No Collision Damage</option>
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
            <label style="color:var(--dsct-accent);font-size:10px;font-weight:bold;display:flex;align-items:center;gap:4px;cursor:pointer;">
              <input type="checkbox" data-field="noFall-${i}" ${state.noFallDamage ? 'checked' : ''}> No Fall Damage</label>
            <label style="color:var(--dsct-accent);font-size:10px;font-weight:bold;display:flex;align-items:center;gap:4px;cursor:pointer;">
              <input type="checkbox" data-field="ignoreStab-${i}" ${state.ignoreStability ? 'checked' : ''}> Ignore Stability</label>
            <label style="color:var(--dsct-accent);font-size:10px;font-weight:bold;display:flex;align-items:center;gap:4px;cursor:pointer;">
              <input type="checkbox" data-field="fast-${i}" ${state.fastMove ? 'checked' : ''}> Fast Path</label>
          </div>
        </div>
      `;
    }).join('');
  }

  async _prepareContext(_options) {
    console.log(`DSCT | FmModifyPanel._prepareContext | effects=${this._effects.length} msgId=${this._msgEl?.dataset?.messageId}`);
    const presets = loadPresets();
    return {
      presetOptions:  presets.map((pr, i) => ({ value: i, label: pr.name })),
      effectSections: this._buildEffectSections(),
    };
  }

  _onRender(_context, _options) {
    console.log(`DSCT | FmModifyPanel._onRender | effects=${this._effects.length}`);
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);

    const presetSel = this.element.querySelector('[data-field="preset-select"]');

    const rebuildDropdown = (presets, selectedIdx = -1) => {
      presetSel.innerHTML = `<option value="">${game.i18n.localize('DSCT.panel.modFm.noPreset')}</option>`
        + presets.map((pr, i) => `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${pr.name}</option>`).join('');
      updateDeleteState();
    };

    const fillFromPreset = (root, preset) => {
      const nameEl = root.querySelector('[data-field="note-name"]');
      const descEl = root.querySelector('[data-field="note-desc"]');
      const srcEl  = root.querySelector('[data-field="note-src"]');
      if (nameEl) nameEl.value = preset.noteName ?? '';
      if (srcEl)  srcEl.value  = preset.noteSrc ?? '';
      if (descEl) { descEl.value = preset.noteDesc ?? ''; descEl.style.height = 'auto'; descEl.style.height = descEl.scrollHeight + 'px'; }
      for (let i = 0; i < this._states.length; i++) {
        const m = preset.modState[i];
        if (!m) continue;
        const get = (f) => root.querySelector(`[data-field="${f}-${i}"]`);
        const setVal = (f, v) => { const el = get(f); if (el) el.value = v; };
        const setChk = (f, v) => { const el = get(f); if (el) el.checked = v; };
        setVal('type',       m.movement          ?? 'push');
        setVal('distance',   m.distanceDelta      ?? 0);
        setChk('vertical',   m.vertical           ?? false);
        setVal('vertDist',   m.verticalDistance   ?? '');
        setVal('fallRed',    m.fallReduction      ?? 0);
        setChk('noFall', m.noFallDamage ?? false);
        setVal('colDmg', m.noCollisionDamage ? 'none' : m.noMoverCollisionDamage ? 'no-mover' : m.noObstacleCollisionDamage ? 'no-obstacle' : 'all');
        setChk('ignoreStab', m.ignoreStability ?? false);
        setChk('fast',       m.fastMove           ?? false);
      }
    };

    const deleteBtn = this.element.querySelector('[data-action="delete-preset"]');
    const updateDeleteState = () => { deleteBtn.disabled = presetSel.value === ''; };
    updateDeleteState();

    const saveBtnEl = this.element.querySelector('[data-action="save-preset"]');
    const updateSaveShift = (held) => {
      saveBtnEl.style.color = held ? 'var(--dsct-text-active)' : 'var(--dsct-text-dim)';
      saveBtnEl.title = held ? 'Shift+Click to overwrite existing preset' : 'Save current inputs as a preset';
    };
    const onShiftDown = (e) => { if (e.key === 'Shift') updateSaveShift(true);  };
    const onShiftUp   = (e) => { if (e.key === 'Shift') updateSaveShift(false); };
    document.addEventListener('keydown', onShiftDown);
    document.addEventListener('keyup',   onShiftUp);
    this._shiftListeners = { down: onShiftDown, up: onShiftUp };

    presetSel.addEventListener('change', () => {
      updateDeleteState();
      const idx = parseInt(presetSel.value);
      if (isNaN(idx)) return;
      const presets = loadPresets();
      const preset  = presets[idx];
      if (!preset) return;
      console.log(`DSCT | FM presets | loading "${preset.name}"`);
      fillFromPreset(this.element, preset);
    });

    this.element.addEventListener('click', e => {
      if (e.target.closest('.dsct-amw-target-fill')) {
        const t = game.user.targets.first();
        const srcEl = this.element.querySelector('[data-field="note-src"]');
        if (t && srcEl) srcEl.value = t.name;
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'save-preset') {
        const root     = this.element;
        const presets  = loadPresets();
        const noteName = root.querySelector('[data-field="note-name"]')?.value?.trim() ?? '';
        const noteDesc = root.querySelector('[data-field="note-desc"]')?.value?.trim() ?? '';
        const noteSrc  = root.querySelector('[data-field="note-src"]')?.value?.trim() ?? '';
        const name     = noteName || `Preset ${presets.length + 1}`;

        const existingIdx = presets.findIndex(pr => pr.name === name);
        if (existingIdx !== -1 && !e.shiftKey) {
          ui.notifications.warn(game.i18n.format('DSCT.notice.chat.presetExists', { name }));
          return;
        }

        const modState = this._states.map((_, i) => {
          const get = (f) => root.querySelector(`[data-field="${f}-${i}"]`);
          const vdRaw    = get('vertDist')?.value ?? '';
          const colDmgV  = get('colDmg')?.value ?? 'all';
          return {
            distanceDelta:           parseInt(get('distance')?.value) || 0,
            movement:                get('type')?.value               ?? 'push',
            vertical:                get('vertical')?.checked         ?? false,
            verticalDistance:        vdRaw !== '' ? (parseInt(vdRaw) || '') : '',
            fallReduction:           parseInt(get('fallRed')?.value)  || 0,
            noFallDamage:            get('noFall')?.checked           ?? false,
            noCollisionDamage:       colDmgV === 'none',
            noMoverCollisionDamage:  colDmgV === 'no-mover',
            noObstacleCollisionDamage: colDmgV === 'no-obstacle',
            ignoreStability:         get('ignoreStab')?.checked       ?? false,
            fastMove:                get('fast')?.checked             ?? false,
          };
        });

        if (existingIdx !== -1) {
          presets[existingIdx] = { name, noteName, noteDesc, noteSrc, modState };
          savePresets(presets);
          rebuildDropdown(presets, existingIdx);
          updateSaveShift(false);
          console.log(`DSCT | FM presets | overwriting "${name}" at idx=${existingIdx}`);
        } else {
          presets.push({ name, noteName, noteDesc, noteSrc, modState });
          savePresets(presets);
          rebuildDropdown(presets, presets.length - 1);
          console.log(`DSCT | FM presets | saved "${name}" (total=${presets.length})`);
        }
        btn.blur();
      }

      if (action === 'delete-preset') {
        const idx = parseInt(presetSel.value);
        if (isNaN(idx)) return;
        const presets = loadPresets();
        if (!presets[idx]) return;
        const name = presets[idx].name;
        presets.splice(idx, 1);
        savePresets(presets);
        rebuildDropdown(presets);
        console.log(`DSCT | FM presets | deleted "${name}" (remaining=${presets.length})`);
        btn.blur();
      }
    });
  }
}
