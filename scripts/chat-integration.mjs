import { applyGrab, buildFreeStrikeButton, sizeRankG } from './grab.mjs';
import { canForcedMoveTarget, getItemRange, getItemDsid, getSetting, parsePowerRollState, applyRollMod, registerInjector, scheduleInject, getTokenById, getWindowById, getModuleApi, normalizeCollection, applyDamage, getSquadGroup, s, palette, injectPanelChrome } from './helpers.mjs';
import { registerAbilityInjectors } from './ability-automation.mjs';
import { applyFrightened, applyTaunted, getFrightenedData, getTauntedData, sightBlockedBetween } from './conditions.mjs';

// DSIDs that allow grabbing more than one creature simultaneously. All other grab abilities default to the standard limit of 1.
const MULTI_GRAB_LIMITS = {
  'choking-grasp': 2,
  'claw-swing':    2,
  'several-arms':  4,
  'tentacle-grab': 4,
  'ribcage-chomp': 4,
};

const getForcedEffects = (item, tier) => {
  const effectsCollection = item.system?.power?.effects;
  const effects = normalizeCollection(effectsCollection);
  const results = [];
  for (const effect of effects) {
    if (effect.type !== 'forced') continue;
    const tierData = effect.forced?.[`tier${tier}`];
    if (!tierData) continue;
    const distance = parseInt(tierData.distance);
    if (isNaN(distance) || distance <= 0) continue;
    const propertiesRaw = tierData.properties;
    const properties = normalizeCollection(propertiesRaw);
    const vertical        = properties.includes('vertical');
    const ignoreStability = properties.includes('ignoresImmunity');
    for (const movement of (tierData.movement ?? [])) {
      results.push({ movement, distance, vertical, ignoreStability, name: effect.name ?? movement });
    }
  }
  return results;
};

const hasGrabEffect = (item, tier) => {
  const dsid = item.system?._dsid ?? item.toObject().system?._dsid;
  if (dsid === 'grab') return tier >= 2;

  const effects = normalizeCollection(item.system?.power?.effects);
  for (const effect of effects) {
    if (getSetting('debugMode')) console.log(`DSCT | hasGrabEffect | effect.type=${effect.type} tier=${tier}`, effect.applied?.[`tier${tier}`]);
    if (effect.type === 'applied') {
      if (effect.applied?.[`tier${tier}`]?.effects?.grabbed) return true;
    }
  }
  return false;
};

// Resets states to baseStates then replays every modifier in order.
// Distance is additive across modifiers; everything else is last-write-wins.
const replayModifiers = (baseStates, stack, states) => {
  for (let i = 0; i < states.length; i++) {
    const base = baseStates[i];
    const st   = states[i];
    st.distance          = base.distance;
    st.movement          = base.movement;
    st.vertical          = base.vertical;
    st.verticalDistance  = base.verticalDistance;
    st.fallReduction     = base.fallReduction;
    st.noFallDamage      = base.noFallDamage;
    st.noCollisionDamage = base.noCollisionDamage;
    st.ignoreStability   = base.ignoreStability;
    st.fastMove          = base.fastMove;
    for (const entry of stack) {
      const m = entry.modState[i];
      if (!m) continue;
      st.distance         += m.distanceDelta;
      st.movement          = m.movement;
      st.vertical          = m.vertical;
      st.verticalDistance  = m.verticalDistance;
      st.fallReduction     = m.fallReduction;
      st.noFallDamage      = m.noFallDamage;
      st.noCollisionDamage = m.noCollisionDamage;
      st.ignoreStability   = m.ignoreStability;
      st.fastMove          = m.fastMove;
    }
  }
  console.log(`DSCT | replayModifiers | stack depth=${stack.length} states=${JSON.stringify(states.map(st => ({ movement: st.movement, distance: st.distance })))}`);
};

const DSCT_FM_PRESET_KEY = 'dsct-fm-presets';
const loadPresets = () => { try { return JSON.parse(localStorage.getItem(DSCT_FM_PRESET_KEY) ?? '[]'); } catch { return []; } };
const savePresets = (arr) => localStorage.setItem(DSCT_FM_PRESET_KEY, JSON.stringify(arr));

class FmModifyPanel extends Application {
  constructor(states, baseStates, modifierStack, effects, btnEls, makeLabel, msgEl) {
    super();
    this._states         = states;
    this._baseStates     = baseStates;
    this._modifierStack  = modifierStack;
    this._effects        = effects;
    this._btnEls         = btnEls;
    this._makeLabel      = makeLabel;
    this._msgEl          = msgEl;
    console.log(`DSCT | FmModifyPanel constructed | effects=${effects.length} msgId=${msgEl?.dataset?.messageId}`);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'dsct-fm-modify', title: 'Modify Forced Movement', template: null,
      width: s(260), height: 'auto', resizable: false, minimizable: false,
    });
  }

  // Reads DOM inputs for effect index i into st. Initialise st from current state first
  // so that missing fields fall back to whatever is already accumulated, not undefined.
  _readInputs(root, i, st) {
    st.movement          = root.querySelector(`[data-field="type-${i}"]`)?.value       ?? st.movement;
    st.distance          = parseInt(root.querySelector(`[data-field="distance-${i}"]`)?.value) || 0;
    st.vertical          = root.querySelector(`[data-field="vertical-${i}"]`)?.checked ?? st.vertical;
    const vdRaw          = root.querySelector(`[data-field="vertDist-${i}"]`)?.value   ?? '';
    st.verticalDistance  = vdRaw !== '' ? (parseInt(vdRaw) || '') : '';
    st.fallReduction     = parseInt(root.querySelector(`[data-field="fallRed-${i}"]`)?.value) || 0;
    st.noFallDamage      = root.querySelector(`[data-field="noFall-${i}"]`)?.checked   ?? st.noFallDamage;
    st.noCollisionDamage = root.querySelector(`[data-field="noCol-${i}"]`)?.checked    ?? st.noCollisionDamage;
    st.ignoreStability   = root.querySelector(`[data-field="ignoreStab-${i}"]`)?.checked ?? st.ignoreStability;
    st.fastMove          = root.querySelector(`[data-field="fast-${i}"]`)?.checked     ?? st.fastMove;
  }

  async _renderInner(_data) {
    console.log(`DSCT | FmModifyPanel._renderInner | effects=${this._effects.length} msgId=${this._msgEl?.dataset?.messageId}`);
    injectPanelChrome(this.options.id);
    const p = palette();
    const presetList    = loadPresets();
    const presetOptions = presetList.map((pr, i) => `<option value="${i}">${pr.name}</option>`).join('');

    const effectSections = this._states.map((state, i) => {
      const effectName = this._effects[i]?.name ?? this._makeLabel(state);
      return `
        ${this._states.length > 1 ? `<div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">${effectName}</div>` : ''}
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(4)}px;">

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Distance</div>
            <div style="display:flex;gap:${s(3)}px;align-items:center;">
              <select data-field="type-${i}" style="width:${s(60)}px;">
                <option value="push"  ${state.movement === 'push'  ? 'selected' : ''}>Push</option>
                <option value="pull"  ${state.movement === 'pull'  ? 'selected' : ''}>Pull</option>
                <option value="slide" ${state.movement === 'slide' ? 'selected' : ''}>Slide</option>
              </select>
              <span style="font-size:${s(8)}px;color:${p.textDim};" title="Current effective distance">${state.distance}</span>
              <span style="font-size:${s(9)}px;color:${p.textDim};">±</span>
              <input type="number" data-field="distance-${i}" value="0" step="1"
                style="width:${s(26)}px;text-align:center;" title="Distance delta — adds to current effective distance">
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" data-field="vertical-${i}" ${state.vertical ? 'checked' : ''}> Vertical
            </label>
            <input type="number" data-field="vertDist-${i}" placeholder="${state.distance}" step="1"
              style="width:${s(40)}px;text-align:center;" title="Leave blank to match distance">
          </div>

          <div style="width:100%;height:1px;background:${p.border};"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Fall Reduction</div>
            <input type="number" data-field="fallRed-${i}" value="${state.fallReduction}" min="0" step="1"
              style="width:${s(30)}px;text-align:center;" title="Bonus on top of Agility">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:${s(4)}px;">
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" data-field="noFall-${i}" ${state.noFallDamage ? 'checked' : ''}> No Fall Dmg</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" data-field="noCol-${i}" ${state.noCollisionDamage ? 'checked' : ''}> No Collision</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" data-field="ignoreStab-${i}" ${state.ignoreStability ? 'checked' : ''}> Ignore Stab</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" data-field="fast-${i}" ${state.fastMove ? 'checked' : ''}> Fast Path</label>
          </div>
        </div>
      `;
    }).join('');

    return $(`
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;">

        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Modify Forced Movement</div>
          <button data-action="close-window"
            style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;margin-left:auto;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;
            display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Log Entry</div>
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(4)}px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Name</div>
            <input type="text" data-field="note-name" placeholder="Optional"
              style="width:${s(130)}px;padding:${s(2)}px ${s(4)}px;">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;padding-top:${s(3)}px;">Description</div>
            <textarea data-field="note-desc" placeholder="Optional" rows="2"
              style="width:${s(130)}px;padding:${s(2)}px ${s(4)}px;resize:none;overflow:hidden;min-height:${s(32)}px;box-sizing:border-box;"
              oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
          </div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Presets</div>
        <div style="display:flex;gap:${s(4)}px;margin-bottom:${s(6)}px;align-items:center;">
          <select data-field="preset-select" style="flex:1;">
            <option value="">-- No Preset --</option>
            ${presetOptions}
          </select>
          <button data-action="save-preset" title="Save current inputs as a preset"
            style="width:${s(24)}px;height:${s(24)}px;flex-shrink:0;cursor:pointer;background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:${s(11)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">
            <i class="fas fa-save"></i>
          </button>
          <button data-action="delete-preset" title="Delete selected preset"
            style="width:${s(24)}px;height:${s(24)}px;flex-shrink:0;cursor:pointer;background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:${s(11)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">
            <i class="fas fa-trash"></i>
          </button>
        </div>

        ${effectSections}

        <button data-action="apply-mod"
          style="width:100%;padding:${s(6)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(10)}px;font-weight:bold;background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">
          <i class="fas fa-check" style="margin-right:${s(4)}px;"></i> Apply
        </button>

      </div>
    `);
  }

  activateListeners(html) {
    super.activateListeners(html);
    console.log(`DSCT | FmModifyPanel.activateListeners | effects=${this._effects.length}`);

    const appEl = html[0].closest('.app');
    if (appEl) {
      const saved = window._fmModifyPanelPos;
      appEl.style.left = saved ? `${saved.left}px` : `${Math.round((window.innerWidth  - (appEl.offsetWidth  || s(260))) / 2)}px`;
      appEl.style.top  = saved ? `${saved.top}px`  : `${Math.round((window.innerHeight - (appEl.offsetHeight || s(300))) / 2)}px`;

      html[0].addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea')) return;
        e.preventDefault();
        const sx = e.clientX - appEl.offsetLeft, sy = e.clientY - appEl.offsetTop;
        const onMove = ev => { appEl.style.left = `${ev.clientX - sx}px`; appEl.style.top = `${ev.clientY - sy}px`; };
        const onUp   = () => {
          window._fmModifyPanelPos = { left: parseInt(appEl.style.left), top: parseInt(appEl.style.top) };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    } else {
      console.warn('DSCT | FmModifyPanel.activateListeners | could not find .app element for dragging');
    }

    const presetSel = html[0].querySelector('[data-field="preset-select"]');

    const rebuildDropdown = (presets, selectedIdx = -1) => {
      presetSel.innerHTML = '<option value="">-- No Preset --</option>'
        + presets.map((pr, i) => `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${pr.name}</option>`).join('');
    };

    const fillFromPreset = (root, preset) => {
      const nameEl = root.querySelector('[data-field="note-name"]');
      const descEl = root.querySelector('[data-field="note-desc"]');
      if (nameEl) nameEl.value = preset.noteName ?? '';
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
        setChk('noFall',     m.noFallDamage       ?? false);
        setChk('noCol',      m.noCollisionDamage  ?? false);
        setChk('ignoreStab', m.ignoreStability    ?? false);
        setChk('fast',       m.fastMove           ?? false);
      }
    };

    presetSel.addEventListener('change', () => {
      const idx = parseInt(presetSel.value);
      if (isNaN(idx)) return;
      const presets = loadPresets();
      const preset  = presets[idx];
      if (!preset) return;
      console.log(`DSCT | FM presets | loading "${preset.name}"`);
      fillFromPreset(html[0], preset);
    });

    html.on('click', '[data-action]', e => {
      const action = e.currentTarget.dataset.action;

      if (action === 'close-window') {
        console.log('DSCT | FmModifyPanel | close-window clicked');
        this.close();
        return;
      }

      if (action === 'apply-mod') {
        const root = html[0];

        const modState = this._states.map((_, i) => {
          const tmp = { ...this._states[i] };
          this._readInputs(root, i, tmp);
          console.log(`DSCT | FmModifyPanel apply-mod | i=${i} distanceDelta=${tmp.distance} movement=${tmp.movement} vertical=${tmp.vertical}`);
          return {
            distanceDelta:    tmp.distance,
            movement:         tmp.movement,
            vertical:         tmp.vertical,
            verticalDistance: tmp.verticalDistance,
            fallReduction:    tmp.fallReduction,
            noFallDamage:     tmp.noFallDamage,
            noCollisionDamage: tmp.noCollisionDamage,
            ignoreStability:  tmp.ignoreStability,
            fastMove:         tmp.fastMove,
          };
        });

        const entry = { modState };
        this._modifierStack.push(entry);
        console.log(`DSCT | FmModifyPanel apply-mod | stack depth now=${this._modifierStack.length}`);
        replayModifiers(this._baseStates, this._modifierStack, this._states);

        for (let i = 0; i < this._states.length; i++) {
          const newLabel = this._makeLabel(this._states[i]);
          console.log(`DSCT | FmModifyPanel apply-mod | updating btnEl[${i}] to "${newLabel}"`);
          this._btnEls[i].innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${newLabel}`;
        }

        // Build and inject the note into the chat message.
        if (this._msgEl) {
          const rawName  = root.querySelector('[data-field="note-name"]')?.value?.trim() ?? '';
          const rawDesc  = root.querySelector('[data-field="note-desc"]')?.value?.trim() ?? '';
          const existing = this._msgEl.querySelectorAll('.dsct-fm-mod-note').length;
          const noteName = rawName || `Forced Movement Modifier ${existing + 1}`;
          const noteText = rawDesc ? `${noteName}: ${rawDesc}` : noteName;
          console.log(`DSCT | FmModifyPanel apply-mod | injecting note "${noteText}"`);

          const noteDiv = document.createElement('div');
          noteDiv.className = 'dsct-fm-mod-note';
          noteDiv.textContent = noteText;
          noteDiv.title = 'Click to remove this modifier';
          noteDiv.style.cssText = 'font-size:11px;padding:3px 6px;margin-top:4px;border-radius:3px;cursor:pointer;border:1px dashed rgba(200,80,80,0.4);color:inherit;user-select:none;';

          noteDiv.addEventListener('mouseenter', () => {
            noteDiv.style.background     = 'rgba(180,40,40,0.2)';
            noteDiv.style.textDecoration = 'line-through';
          });
          noteDiv.addEventListener('mouseleave', () => {
            noteDiv.style.background     = '';
            noteDiv.style.textDecoration = '';
          });
          noteDiv.addEventListener('click', () => {
            const idx = this._modifierStack.indexOf(entry);
            console.log(`DSCT | FM note clicked | removing entry at idx=${idx} stackDepth=${this._modifierStack.length}`);
            if (idx !== -1) this._modifierStack.splice(idx, 1);
            replayModifiers(this._baseStates, this._modifierStack, this._states);
            for (let i = 0; i < this._states.length; i++) {
              const newLabel = this._makeLabel(this._states[i]);
              console.log(`DSCT | FM note remove | updating btnEl[${i}] to "${newLabel}"`);
              this._btnEls[i].innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${newLabel}`;
            }
            noteDiv.remove();
          });

          const buttonsContainer = this._msgEl.querySelector('.dsct-forced-buttons');
          const noteParent = buttonsContainer?.parentElement ?? this._msgEl;
          noteParent.appendChild(noteDiv);
          console.log(`DSCT | FmModifyPanel apply-mod | note appended to ${noteParent.className || noteParent.tagName}`);
        } else {
          console.warn('DSCT | FmModifyPanel apply-mod | no msgEl, cannot inject note');
        }

        this.close();
      }

      if (action === 'save-preset') {
        const root     = html[0];
        const presets  = loadPresets();
        const noteName = root.querySelector('[data-field="note-name"]')?.value?.trim() ?? '';
        const noteDesc = root.querySelector('[data-field="note-desc"]')?.value?.trim() ?? '';
        const name     = noteName || `Preset ${presets.length + 1}`;
        const modState = this._states.map((_, i) => {
          const get = (f) => root.querySelector(`[data-field="${f}-${i}"]`);
          const vdRaw = get('vertDist')?.value ?? '';
          return {
            distanceDelta:    parseInt(get('distance')?.value)  || 0,
            movement:         get('type')?.value                ?? 'push',
            vertical:         get('vertical')?.checked          ?? false,
            verticalDistance: vdRaw !== '' ? (parseInt(vdRaw) || '') : '',
            fallReduction:    parseInt(get('fallRed')?.value)   || 0,
            noFallDamage:     get('noFall')?.checked            ?? false,
            noCollisionDamage: get('noCol')?.checked            ?? false,
            ignoreStability:  get('ignoreStab')?.checked        ?? false,
            fastMove:         get('fast')?.checked              ?? false,
          };
        });
        presets.push({ name, noteName, noteDesc, modState });
        savePresets(presets);
        rebuildDropdown(presets, presets.length - 1);
        console.log(`DSCT | FM presets | saved "${name}" (total=${presets.length})`);
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
      }
    });
  }
}

const injectForcedButtons = (msg, { el, buttons, content }) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'forcedMovement');
  if (!data) return;
  if (el.querySelector('.dsct-forced-buttons')) return;

  const target = buttons ?? content ?? el;
  if (!target) return;

  const gmOnly   = getSetting('fmModifyGmOnly');
  const showEdit = !gmOnly || game.user.isGM;
  console.log(`DSCT | injectForcedButtons | msgId=${msg.id} effects=${data.effects?.length ?? 0} gmOnly=${gmOnly} isGM=${game.user.isGM} showEdit=${showEdit}`);

  // Frozen baseline — never mutated. States starts as a copy and gets updated by replayModifiers.
  const baseStates = data.effects.map(effect => ({
    movement:          effect.movement,
    distance:          effect.distance,
    vertical:          effect.vertical          ?? false,
    verticalDistance:  '',
    ignoreStability:   effect.ignoreStability   ?? false,
    fallReduction:     0,
    noFallDamage:      false,
    noCollisionDamage: false,
    fastMove:          false,
  }));
  const states        = baseStates.map(st => ({ ...st }));
  const modifierStack = [];

  const makeLabel = (st) => [
    st.fastMove ? 'Auto'     : '',
    st.vertical ? 'Vertical' : '',
    `${st.movement.charAt(0).toUpperCase() + st.movement.slice(1)} ${st.distance}`,
  ].filter(Boolean).join(' ');

  const container = document.createElement('div');
  container.className = 'dsct-forced-buttons';
  container.style.cssText = 'display:contents;';

  const btnEls = [];

  for (let i = 0; i < data.effects.length; i++) {
    const state = states[i];

    const execBtn = document.createElement('button');
    execBtn.type = 'button';
    execBtn.className = 'dsct-fm-exec';
    execBtn.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i> ${makeLabel(state)}`;
    execBtn.style.cssText = showEdit ? 'cursor:pointer;flex:1;' : 'cursor:pointer;';

    execBtn.addEventListener('click', async () => {
      console.log(`DSCT | FM exec clicked | state=${JSON.stringify({ movement: state.movement, distance: state.distance, vertical: state.vertical })}`);
      const api = getModuleApi();
      if (!api) return;

      const targets    = [...game.user.targets];
      const controlled = canvas.tokens.controlled;
      const source     = targets.length === 1 && controlled.length === 1 ? controlled[0] : null;
      const tgt        = targets.length === 1 ? targets[0] : null;

      if (!(game.user.isGM && getSetting('gmBypassesSizeCheck')) && (data.dsid === 'knockback' || data.dsid === 'grab')) {
        if (source && tgt && !canForcedMoveTarget(source.actor, tgt.actor)) {
          ui.notifications.warn(`${source.name} cannot force-move ${tgt.name} (size too large for their Might and size).`);
          return;
        }
      }

      const type           = state.movement.charAt(0).toUpperCase() + state.movement.slice(1);
      const verticalHeight = state.vertical ? (state.verticalDistance !== '' ? String(state.verticalDistance) : String(state.distance)) : '';
      const kwArray        = normalizeCollection(data.keywords);
      const kw             = kwArray.join(',');
      await api.forcedMovement([type, String(state.distance), '0', '0', verticalHeight, String(state.fallReduction), String(state.noFallDamage), String(state.ignoreStability), String(state.noCollisionDamage), kw, String(data.range ?? 0), String(state.fastMove)]);
    });

    btnEls.push(execBtn);

    if (showEdit) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'dsct-fm-edit';
      editBtn.title = 'Modify Forced Movement';
      editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
      editBtn.style.cssText = 'cursor:pointer;flex-shrink:0;';
      editBtn.addEventListener('click', () => {
        console.log(`DSCT | FM edit clicked | msgId=${msg.id} stackDepth=${modifierStack.length}`);
        const existing = getWindowById('dsct-fm-modify');
        if (existing) {
          console.log('DSCT | FM edit | closing existing panel before opening new one');
          existing.close();
        }
        new FmModifyPanel(states, baseStates, modifierStack, data.effects, btnEls, makeLabel, el).render(true);
      });

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;gap:2px;';
      wrapper.appendChild(execBtn);
      wrapper.appendChild(editBtn);
      container.appendChild(wrapper);
    } else {
      container.appendChild(execBtn);
    }
  }

  target.appendChild(container);
  console.log(`DSCT | injectForcedButtons | done | effects=${data.effects.length} showEdit=${showEdit}`);
};

const injectGrabButton = (msg, { el }) => {
  const data = msg.getFlag('draw-steel-combat-tools', 'grab');
  if (!data) return;

  // Honour the "Restrict Manual Grab Buttons to GM" setting
  if (getSetting('restrictGrabButtons') && !game.user.isGM) return;

  const nativeBtns = el.querySelectorAll('button[data-action="applyEffect"][data-effect-id="grabbed"]');
  if (!nativeBtns.length) return;

  const maxGrabs = data.maxGrabs ?? 1;

  for (const btn of nativeBtns) {
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = btn.className ? `${btn.className} dsct-grab-btn` : 'dsct-grab-btn';
    newBtn.innerHTML = '<i class="fa-solid fa-hand-rock"></i> Apply Grabbed';
    newBtn.style.cssText = 'cursor:pointer;';

    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const speakerTok = data.speakerToken ? canvas?.tokens?.get(data.speakerToken) : null;
      const controlled = canvas.tokens.controlled;
      const grabber    = controlled.length === 1 ? controlled[0] : speakerTok;
      if (!grabber) { ui.notifications.warn('Control the grabber token or ensure the ability speaker token is on the canvas.'); return; }

      const targets = [...game.user.targets].filter(t => t.id !== grabber.id);
      if (!targets.length) { ui.notifications.warn(`Target the creature${maxGrabs > 1 ? 's' : ''} to apply Grabbed to.`); return; }
      if (targets.length > maxGrabs) { ui.notifications.warn(`This ability can only grab up to ${maxGrabs} creature${maxGrabs !== 1 ? 's' : ''} at once. Target fewer tokens.`); return; }

      // Size check (unless GM bypass is on)
      if (!(game.user.isGM && getSetting('gmBypassesSizeCheck'))) {
        for (const t of targets) {
          if (!canForcedMoveTarget(grabber.actor, t.actor)) {
            ui.notifications.warn(`${grabber.name} cannot grab ${t.name}: target is too large given their size and Might score.`);
            return;
          }
        }
      }

      // Apply grabs sequentially: no power roll, no free strike opportunity
      for (const t of targets) {
        await applyGrab(grabber, t, { maxGrabs });
        ChatMessage.create({ content: `<strong>Grab:</strong> ${grabber.name} grabs ${t.name}!` });
      }
    });

    btn.replaceWith(newBtn);
  }
};

const injectGrabResolutions = (msg, { el, buttons, content }) => {
  const grabActions = el.querySelector('.dsct-tier2-grab-actions');
  if (grabActions && !grabActions.dataset.bound) {
    grabActions.dataset.bound = "true";
    const confirmBtn = grabActions.querySelector('[data-action="dsct-confirm-grab"]');
    const cancelBtn = grabActions.querySelector('[data-action="dsct-cancel-grab"]');
    
    confirmBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const api = getModuleApi(false);
        const grabber = getTokenById(grabActions.dataset.grabberId);
        const target  = getTokenById(grabActions.dataset.targetId);
        const grabFlag = msg.getFlag('draw-steel-combat-tools', 'grab');
        if (grabber && target) await api?.grab(grabber, target, { forceApply: true, maxGrabs: grabFlag?.maxGrabs ?? 1 });
        await resolveGrabConfirmChatMessage(msg.id, 'confirmed');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
    });

    cancelBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await resolveGrabConfirmChatMessage(msg.id, 'cancelled');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingConfirm = null; panel._refreshPanel(); }
    });
  }

  
  const escapeData = msg.getFlag('draw-steel-combat-tools', 'escapeGrab');
  if (escapeData && escapeData.tier === 2) {
    if (el.querySelector('.dsct-escape-actions')) return; 
    
    const targetArea = buttons ?? content ?? el;
    const resolvedState = msg.getFlag('draw-steel-combat-tools', 'escapeResolved');

    const container = document.createElement('div');
    container.className = 'dsct-escape-actions';

    
    if (resolvedState) {
      container.innerHTML = `<div style="margin-top:8px; font-size: 13px; border-top: 1px solid var(--color-border-light-primary); padding-top: 8px;"><em>${resolvedState === 'accepted' ? 'Escape Accepted' : 'Stayed Grabbed'}</em></div>`;
      targetArea.appendChild(container);
      return;
    }

    const grab = window._activeGrabs?.get(escapeData.speakerToken);
    if (!grab) return;

    const grabberTok = getTokenById(grab.grabberTokenId);
    const fsHtml = grabberTok ? buildFreeStrikeButton(grabberTok.actor) : '';
    
    container.innerHTML = `
      <div style="margin-top:8px; font-size: 13px; border-top: 1px solid var(--color-border-light-primary); padding-top: 8px;">
          <strong>${grab.grabberName}</strong> may make a free strike:<br>
          <div style="margin: 4px 0;">${fsHtml}</div>
          <div style="display:flex;gap:4px;margin-top:4px;">
            <button type="button" class="apply-effect dsct-accept-escape" style="cursor:pointer;flex:1;"><i class="fa-solid fa-check"></i> Accept Escape</button>
            <button type="button" class="apply-effect dsct-deny-escape" style="cursor:pointer;flex:1;border-color:var(--color-text-error);color:var(--color-text-error);"><i class="fa-solid fa-times"></i> Stay Grabbed</button>
          </div>
      </div>
    `;
    
    container.querySelector('.dsct-accept-escape').addEventListener('click', async (e) => {
        e.preventDefault();
        const api = getModuleApi(false);
        await triggerGrabberFreeStrike(grabberTok, grab);
        await api?.endGrab(escapeData.speakerToken, { silent: true });
        await resolveEscapeChatMessage(escapeData.speakerToken, 'accepted');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
    });

    container.querySelector('.dsct-deny-escape').addEventListener('click', async (e) => {
        e.preventDefault();
        ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} stays grabbed.` });
        await resolveEscapeChatMessage(escapeData.speakerToken, 'denied');
        const panel = getWindowById('grab-panel');
        if (panel) { panel._pendingEscape = null; panel._refreshPanel(); }
    });
    
    targetArea.appendChild(container);
  }
};

/**
 * Trigger the grabber's Melee Free Strike. Routes to their controlling player if online,
 * falls back to GM. Call this from both the chat button and the grab panel button.
 * @param {Token} grabberTok
 * @param {object} grab  - entry from window._activeGrabs
 */
export const triggerGrabberFreeStrike = async (grabberTok, grab) => {
  const api = getModuleApi(false);
  const freeStrikeItem = grabberTok?.actor?.items.find(i => i.name.toLowerCase().includes('melee free strike'));
  if (freeStrikeItem) {
    const socket = api?.socket;
    const controllingUser = game.users.find(u =>
      u.active && !u.isGM &&
      (u.character?.id === grabberTok.actor.id ||
       (grabberTok.actor.ownership[u.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    );
    if (controllingUser && controllingUser.id !== game.user.id && socket) {
      await socket.executeAsUser('rollFreeStrike', controllingUser.id, freeStrikeItem.uuid);
    } else {
      await ds.helpers.macros.rollItemMacro(freeStrikeItem.uuid);
    }
  } else {
    ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} escapes after taking a free strike from ${grab.grabberName}.` });
  }
};

/**
 * Resolve an escape grab chat message. Sets the escapeResolved flag so the chat UI updates.
 * @param {string} grabbedTokenId
 * @param {'accepted'|'denied'} resolution
 */
export const resolveEscapeChatMessage = async (grabbedTokenId, resolution) => {
  const msg = game.messages.contents.findLast(m =>
    m.getFlag('draw-steel-combat-tools', 'escapeGrab')?.speakerToken === grabbedTokenId &&
    !m.getFlag('draw-steel-combat-tools', 'escapeResolved')
  );
  if (msg && (msg.isOwner || game.user.isGM)) {
    await msg.setFlag('draw-steel-combat-tools', 'escapeResolved', resolution);
  }
};

/**
 * Resolve a tier-2 grab confirm chat message. Updates the content in place.
 * @param {string} msgId
 * @param {'confirmed'|'cancelled'} resolution
 */
export const resolveGrabConfirmChatMessage = async (msgId, resolution) => {
  if (!msgId) return;
  const msg = game.messages.get(msgId);
  if (!msg || !(msg.isOwner || game.user.isGM)) return;
  const label = resolution === 'confirmed' ? 'Grab Confirmed' : 'Grab Cancelled';
  const newContent = msg.content.replace(/<div[^>]*class="dsct-tier2-grab-actions"[^>]*>.*?<\/div>/s, `<div style="margin-top:6px;"><em>${label}</em></div>`);
  await msg.update({ content: newContent });
};

const _knockbackNotified    = new Set(); // guards against double-notify race
const _escapeGrabInFlight   = new Set(); // guards against double-trigger escape race
const _grabFlagInFlight     = new Set(); // guards against double-trigger grab race
const _bleedingInFlight     = new Set(); // guards against double-trigger bleeding race
const _recentlyCreated      = new Set(); // messages created this session within the last few seconds
const _powerRollModInFlight = new Set(); // guards against double-processing power roll mods

// Returns the action type string from the rendered ability embed ("Main Action", "Triggered Action", etc.)
const getActionType = (el) => {
  return el.querySelector('document-embed dd.type')?.textContent?.trim() ?? '';
};

// Returns the characteristics used by the ability roll ("Might", "Agility", etc.). Also checks the test flavor text for standalone Might/Agility tests.
const getRollCharacteristics = (el) => {
  const rollLine  = el.querySelector('document-embed .powerResult strong')?.textContent ?? '';
  const flavorTxt = el.querySelector('.message-part-flavor')?.textContent?.trim() ?? '';
  return (rollLine + ' ' + flavorTxt).toLowerCase();
};

// Checks whether a set of targets includes a specific actor/token ID pair
const targetsInclude = (targets, actorId, tokenId) =>
  targets.some(t => (actorId && t.actor?.id === actorId) || (tokenId && t.id === tokenId));

// Reads the running bane/edge totals from flags and applies them all at once. Each condition writes its own key into 'powerRollDeltas' so they never overwrite each other. Combining them here keeps multiple active conditions from stepping on each other.
const injectAllRollMods = (msg, { el }) => {
  const base   = msg.getFlag('draw-steel-combat-tools', 'powerRollBase');
  const deltas = msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas');
  if (!base?.originalTotal || !deltas) return;

  const totalDelta = Object.values(deltas).reduce((sum, d) => sum + d, 0);
  if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | msg=${msg.id} deltas=${JSON.stringify(deltas)} totalDelta=${totalDelta} originalNet=${base.originalNet} ? finalNet=${Math.max(-2, Math.min(2, base.originalNet + totalDelta))} isCritical=${base.isCritical}`);
  applyRollMod(el, base, totalDelta);
};

export function registerChatHooks() {
  const trySetFlag = async (msg, el = null) => {
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | enter msg=${msg.id} author=${msg.author?.name} isMe=${msg.author.id === game.user.id}`);
    if (msg.author.id !== game.user.id) return;

    // Bleeding: runs for all message types (including tests); must be before the ability-parts guard
    if (el && getSetting('bleedingEnabled') && _recentlyCreated.has(msg.id) && !msg.getFlag('draw-steel-combat-tools', 'bleedingTriggered') && !_bleedingInFlight.has(msg.id)) {
      const speakerTokenId = msg.speaker?.token;
      const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
      if (speakerTok?.actor?.statuses?.has('bleeding')) {
        const actionType = getActionType(el).toLowerCase();
        const rollChars  = getRollCharacteristics(el);
        const triggers   = actionType.includes('main action') || actionType.includes('triggered action')
                        || rollChars.includes('might') || rollChars.includes('agility');
        if (triggers) {
          _bleedingInFlight.add(msg.id);
          await msg.setFlag('draw-steel-combat-tools', 'bleedingTriggered', {
            tokenId: speakerTokenId,
            actorUuid: speakerTok.actor.uuid,
            mode: getSetting('bleedingMode'),
          });
          _bleedingInFlight.delete(msg.id);
          if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Flagged msg ${msg.id} for ${speakerTok.name}`);
        }
      }
    }

    const parts         = normalizeCollection(msg.system?.parts);
    const abilityUse    = parts.find(p => p.type === 'abilityUse');
    const abilityResult = parts.find(p => p.type === 'abilityResult');
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | msg=${msg.id} parts=${parts.length} abilityUuid=${abilityUse?.abilityUuid ?? 'none'} tier=${abilityResult?.tier ?? 'none'}`);
    if (!abilityUse?.abilityUuid) return;

    const item = await fromUuid(abilityUse.abilityUuid);
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | item=${item?.name ?? 'null'} uuid=${abilityUse.abilityUuid}`);
    if (!item) return;

    const dsid = getItemDsid(item);

    // Store per-ability flags for any ability message, even those without a tier result. Injectors read these immediately when the message renders.
    if (!msg.getFlag('draw-steel-combat-tools', 'abilityDsid') && dsid) {
      await msg.setFlag('draw-steel-combat-tools', 'abilityDsid', dsid);
    }
    if (!msg.getFlag('draw-steel-combat-tools', 'areaAbility') && item.system?.keywords?.has('area')) {
      await msg.setFlag('draw-steel-combat-tools', 'areaAbility', true);
    }

    if (!abilityResult?.tier) return;

    const tier = abilityResult.tier;
    if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | dsid=${dsid} tier=${tier} item.system.power.effects count=${normalizeCollection(item.system?.power?.effects).length}`);

    // Power roll mods: requires the live rendered element because dice roll HTML is client-side only. Each condition writes its own key into 'powerRollDeltas'; all are applied together at inject time.
    if (el && !_powerRollModInFlight.has(msg.id)) {
      const existingBase   = msg.getFlag('draw-steel-combat-tools', 'powerRollBase');
      const existingDeltas = msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas') ?? {};
      const pendingDeltas  = { ...existingDeltas };
      let baseState = existingBase ?? null;

      // Grabbed bane
      if (getSetting('grabbedBaneEnabled') && !('grabbed' in existingDeltas)) {
        const speakerTokenId = msg.speaker?.token;
        const grab = speakerTokenId ? window._activeGrabs?.get(speakerTokenId) : null;
        if (grab) {
          const targets = [...game.user.targets];
          const targetingGrabber = targetsInclude(targets, grab.grabberActorId, grab.grabberTokenId);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Grabbed bane check msg=${msg.id} targetingGrabber=${targetingGrabber} targets=${targets.length}`);
          if (!targetingGrabber) pendingDeltas.grabbed = 1;

          // Escape grab size bane: smaller creature escaping a larger grabber takes an extra bane
          if (!('escapeBane' in existingDeltas) && dsid === 'escape-grab') {
            const grabberTok = getTokenById(grab.grabberTokenId);
            if (grabberTok) {
              const grabbedSize  = speakerTok?.actor?.system?.combat?.size ?? { value: 1, letter: 'M' };
              const grabberSize  = grabberTok.actor?.system?.combat?.size  ?? { value: 1, letter: 'M' };
              if (sizeRankG(grabbedSize) < sizeRankG(grabberSize)) {
                pendingDeltas.escapeBane = 1;
                if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Escape size bane applied msg=${msg.id}`);
              }
            }
          }
        }
      }

      // Frightened bane: bane on rolls against the source of fear
      if (getSetting('frightenedEnabled') && !('frightened' in existingDeltas)) {
        const speakerTokenId = msg.speaker?.token;
        const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
        const fd = speakerTok ? getFrightenedData(speakerTok.actor) : null;
        if (fd) {
          const targets = [...game.user.targets];
          const targetingSource = targetsInclude(targets, fd.sourceActorId, fd.sourceTokenId);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Frightened bane check msg=${msg.id} targetingSource=${targetingSource}`);
          if (targetingSource) pendingDeltas.frightened = 1;
        }
      }

      // Taunted double-bane: on rolls that don't target the taunting creature (if LoE exists)
      if (getSetting('tauntedEnabled') && !('taunted' in existingDeltas)) {
        const speakerTokenId = msg.speaker?.token;
        const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
        const td = speakerTok ? getTauntedData(speakerTok.actor) : null;
        if (td) {
          const targets = [...game.user.targets];
          const targetingSource = targetsInclude(targets, td.sourceActorId, td.sourceTokenId);
          if (!targetingSource) {
            // Only apply if speaker has LoE to the taunt source (sight-unblocked)
            const sourceTok = getTokenById(td.sourceTokenId);
            const hasLoE = sourceTok ? !sightBlockedBetween(speakerTok, sourceTok) : false;
            if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Taunted check msg=${msg.id} targetingSource=${targetingSource} hasLoE=${hasLoE}`);
            if (hasLoE) pendingDeltas.taunted = 2; // double bane
          }
        }
      }

      const hasNewDeltas = Object.keys(pendingDeltas).some(k => !(k in existingDeltas));
      if (hasNewDeltas) {
        if (!baseState) {
          baseState = parsePowerRollState(el);
          if (getSetting('debugMode')) console.log(`DSCT | Power Roll Mods | Captured base state for msg=${msg.id}:`, baseState);
        }
        if (baseState) {
          _powerRollModInFlight.add(msg.id);
          if (!existingBase) await msg.setFlag('draw-steel-combat-tools', 'powerRollBase', baseState);
          await msg.setFlag('draw-steel-combat-tools', 'powerRollDeltas', pendingDeltas);
          _powerRollModInFlight.delete(msg.id);
        }
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'knockbackBlocked') && !_knockbackNotified.has(msg.id) && dsid === 'knockback') {
      const speakerTokenId = msg.speaker?.token;
      if (speakerTokenId && window._activeGrabs?.has(speakerTokenId)) {
        _knockbackNotified.add(msg.id);
        await msg.setFlag('draw-steel-combat-tools', 'knockbackBlocked', true);
        ui.notifications.warn('A grabbed creature cannot use the Knockback maneuver.');
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'areaAbility') && item.system?.keywords?.has('area')) {
      await msg.setFlag('draw-steel-combat-tools', 'areaAbility', true);
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'forcedMovement')) {
      const forced = getForcedEffects(item, tier);
      if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | forcedEffects=${forced.length} for dsid=${dsid} tier=${tier}`);
      if (forced.length) {
        const range = getItemRange(item);
        await msg.setFlag('draw-steel-combat-tools', 'forcedMovement', {
          effects:      forced,
          keywords:     Array.from(item.system?.keywords ?? []),
          range,
          dsid,
          speakerToken: msg.speaker?.token ?? null,
        });
      }
    }

    if (!msg.getFlag('draw-steel-combat-tools', 'grab') && !_grabFlagInFlight.has(msg.id)) {
      const grabResult = hasGrabEffect(item, tier);
      if (getSetting('debugMode')) console.log(`DSCT | trySetFlag | hasGrabEffect=${grabResult} dsid=${dsid} tier=${tier}`);
      if (grabResult) {
        _grabFlagInFlight.add(msg.id);
        await msg.setFlag('draw-steel-combat-tools', 'grab', {
          speakerToken: msg.speaker?.token ?? null,
          tier,
          dsid,
          maxGrabs: MULTI_GRAB_LIMITS[dsid] ?? 1,
        });
        _grabFlagInFlight.delete(msg.id);
      }
    }

    
    if (!msg.getFlag('draw-steel-combat-tools', 'escapeGrab') && !_escapeGrabInFlight.has(msg.id)) {
      if (dsid === 'escape-grab' || item.name.toLowerCase().includes('escape grab')) {
        const grabbedTokenId = msg.speaker?.token;
        if (grabbedTokenId && window._activeGrabs?.has(grabbedTokenId)) {
          _escapeGrabInFlight.add(msg.id);
          await msg.setFlag('draw-steel-combat-tools', 'escapeGrab', {
            speakerToken: grabbedTokenId,
            tier
          });

          
          const grab = window._activeGrabs.get(grabbedTokenId);
          if (tier >= 3) {
            const api = getModuleApi(false);
            if (api) {
               await api.endGrab(grabbedTokenId, { silent: true });
               ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} breaks free from ${grab.grabberName}!` });
            }
          } else if (tier === 1) {
            ChatMessage.create({ content: `<strong>Escape Grab:</strong> ${grab.grabbedName} fails to escape.` });
          } else if (tier === 2) {
             const panel = getWindowById('grab-panel');
             if (panel) {
                 panel._pendingEscape = { grabbedTokenId };
                 panel._refreshPanel();
             }
          }
          _escapeGrabInFlight.delete(msg.id);
        }
      }
    }

    // Frightened: speaker is the source of fear, so targets of this ability get an edge injected
    if (el && getSetting('frightenedEnabled') && !('frightenedSource' in (msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas') ?? {})) && !_powerRollModInFlight.has(msg.id)) {
      const speakerTokenId = msg.speaker?.token;
      const speakerTok = speakerTokenId ? getTokenById(speakerTokenId) : null;
      if (speakerTok) {
        const targets = [...game.user.targets];
        for (const t of targets) {
          const fd = getFrightenedData(t.actor);
          if (fd && (fd.sourceActorId === speakerTok.actor?.id || fd.sourceTokenId === speakerTokenId)) {
            // This target is frightened of the speaker, so speaker gets edge
            const existingDeltas = msg.getFlag('draw-steel-combat-tools', 'powerRollDeltas') ?? {};
            if (!('frightenedSource' in existingDeltas)) {
              const existingBase = msg.getFlag('draw-steel-combat-tools', 'powerRollBase');
              const baseState = existingBase ?? parsePowerRollState(el);
              if (baseState) {
                _powerRollModInFlight.add(msg.id);
                if (!existingBase) await msg.setFlag('draw-steel-combat-tools', 'powerRollBase', baseState);
                await msg.setFlag('draw-steel-combat-tools', 'powerRollDeltas', { ...existingDeltas, frightenedSource: -1 });
                _powerRollModInFlight.delete(msg.id);
              }
            }
            break;
          }
        }
      }
    }

  };

  // Injectors run in order; returning true skips all remaining injectors (used when one completely replaces a message)
  registerInjector(function injectKnockbackBlock(msg, { el }) {
    if (!msg.getFlag('draw-steel-combat-tools', 'knockbackBlocked')) return;
    for (const child of [...el.children]) {
      if (!child.matches('.message-header')) child.remove();
    }
    const div = document.createElement('div');
    div.className = 'message-content';
    div.innerHTML = '<p><em>A grabbed creature cannot use the Knockback maneuver.</em></p>';
    el.appendChild(div);
    return true; // stop further injectors; message content replaced
  });
  registerInjector(injectAllRollMods);
  registerInjector(injectForcedButtons);
  registerInjector(injectGrabButton);
  registerInjector(injectGrabResolutions);

  // Inject a Teleport button on any ability whose effect text mentions the word "teleport". We can't reliably extract distance from prose (wildly inconsistent phrasing across 100+ abilities), so the button simply opens the Teleport panel and lets the user set the numbers themselves.
  registerInjector(function injectTeleportButton(msg, { el, buttons, content }) {
    if (!getSetting('teleportEnabled')) return;
    if (el.querySelector('.dsct-tp-ability-btn')) return;

    // Only ability messages
    if (!normalizeCollection(msg.system?.parts).some(p => p.type === 'abilityUse')) return;

    // Check the rendered ability text, the one section that contains effect prose
    const abilityHTML = el.querySelector('.message-part-html');
    if (!abilityHTML?.textContent?.toLowerCase().includes('teleport')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-tp-ability-btn';
    btn.innerHTML = '<i class="fa-solid fa-person-through-window"></i> Teleport';
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      getModuleApi(false)?.teleportUI();
    });
    (buttons ?? content ?? el).appendChild(btn);
  });

  registerAbilityInjectors();

  // Minions and Area Effects rule: for area abilities, cap damage dealt to each minion at their individual stamina max so the squad pool only loses as much as each minion in the area can take. Non-minion targets receive the full amount. Replaces DS's own apply-damage buttons so the per-target capping happens before damage hits the pool.
  registerInjector(function injectAreaDamageCap(msg, { el }) {
    if (!msg.getFlag('draw-steel-combat-tools', 'areaAbility')) return;

    const origButtons = [...el.querySelectorAll('.apply-damage')];
    if (!origButtons.length) return;

    for (const origBtn of origButtons) {
      const btn = origBtn.cloneNode(true);
      // Remove DS's class and data-action so its querySelector and delegation don't re-attach
      btn.classList.remove('apply-damage');
      delete btn.dataset.action;
      btn.classList.add('dsct-area-dmg-btn');
      btn.appendChild(document.createTextNode(' (Area)'));

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        const partEl = btn.closest('[data-message-part]');
        const partId = partEl?.dataset.messagePart;
        const idx    = parseInt(btn.dataset.index);
        const roll   = partId
          ? msg.system.parts.get(partId)?.rolls?.[idx]
          : msg.rolls?.[idx];
        if (!roll) return;

        // Area heals don't need capping; pass through to DS unchanged
        if (roll.isHeal) {
          await roll.applyDamage(null, { halfDamage: e.shiftKey });
          return;
        }

        const tokens = game.user.targets.size
          ? [...game.user.targets]
          : [...canvas.tokens.controlled];

        if (!tokens.length) {
          ui.notifications.error('No tokens selected or targeted.');
          return;
        }

        let amount = roll.total;
        if (e.shiftKey) amount = Math.floor(amount / 2);

        for (const token of tokens) {
          const actor = token.actor;
          if (!actor) continue;
          const squadGroup   = getSquadGroup(actor);
          const effectiveAmt = squadGroup
            ? Math.min(amount, actor.system.stamina.max ?? amount)
            : amount;
          if (getSetting('debugMode')) console.log(`DSCT | Area Damage | ${actor.name}: rolled=${amount} cap=${actor.system.stamina.max ?? 'n/a'} effective=${effectiveAmt} isMinion=${!!squadGroup}`);
          await applyDamage(actor, effectiveAmt);
        }
      });

      origBtn.replaceWith(btn);
    }
  });

  // For non-area abilities, replace the apply-damage button so damage routes through our applyDamage function. This ensures squad tracking (for breakpoint auto-assign) and QS integration work the same way they do for area abilities and forced movement damage.
  registerInjector(function injectSingleTargetDamage(msg, { el }) {
    if (msg.getFlag('draw-steel-combat-tools', 'areaAbility')) return;

    const origButtons = [...el.querySelectorAll('.apply-damage')];
    if (!origButtons.length) return;

    for (const origBtn of origButtons) {
      const btn = origBtn.cloneNode(true);
      btn.classList.remove('apply-damage');
      delete btn.dataset.action;
      btn.classList.add('dsct-single-dmg-btn');

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        const partEl = btn.closest('[data-message-part]');
        const partId = partEl?.dataset.messagePart;
        const idx    = parseInt(btn.dataset.index);
        const roll   = partId
          ? msg.system.parts.get(partId)?.rolls?.[idx]
          : msg.rolls?.[idx];
        if (!roll) return;

        if (roll.isHeal) {
          await roll.applyDamage(null, { halfDamage: e.shiftKey });
          return;
        }

        const tokens = game.user.targets.size
          ? [...game.user.targets]
          : [...canvas.tokens.controlled];

        if (!tokens.length) {
          ui.notifications.error('No tokens selected or targeted.');
          return;
        }

        let amount = roll.total;
        if (e.shiftKey) amount = Math.floor(amount / 2);

        for (const token of tokens) {
          const actor = token.actor;
          if (!actor) continue;
          await applyDamage(actor, amount);
        }
      });

      origBtn.replaceWith(btn);
    }
  });

  // Reads the `end` string for a given condition from an ability item's AppliedPowerRollEffects. Returns the raw DS system string ("turn", "encounter", "save") or null if not found.
  const getConditionEndFromAbility = (item, conditionId) => {
    const appliedEffects = item?.system?.power?.effects?.contents?.filter(e => e.type === 'applied') ?? [];
    for (const eff of appliedEffects) {
      for (const tier of [1, 2, 3]) {
        const condEntry = eff.applied?.[`tier${tier}`]?.effects?.[conditionId];
        if (condEntry?.end) return condEntry.end;
      }
    }
    return null;
  };

  // Replace native frightened/taunted "Apply Effect" buttons with our versioned ones
  registerInjector(function injectConditionButtons(msg, { el }) {
    if (!getSetting('frightenedEnabled') && !getSetting('tauntedEnabled')) return;

    const speakerTokenId = msg.speaker?.token;
    const speakerTok     = speakerTokenId ? getTokenById(speakerTokenId) : null;
    if (!speakerTok?.actor) return;

    for (const conditionId of ['frightened', 'taunted']) {
      if (!getSetting(conditionId === 'frightened' ? 'frightenedEnabled' : 'tauntedEnabled')) continue;
      const nativeBtns = el.querySelectorAll(`button[data-action="applyEffect"][data-effect-id="${conditionId}"]`);
      for (const btn of nativeBtns) {
        if (btn.dataset.dsctReplaced) continue;
        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = btn.className || '';
        newBtn.dataset.dsctReplaced = 'true';
        newBtn.innerHTML = `<i class="fa-solid fa-skull"></i> Apply ${conditionId.charAt(0).toUpperCase() + conditionId.slice(1)} (DSCT)`;
        newBtn.style.cssText = 'cursor:pointer;';
        newBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targets = [...game.user.targets];
          if (!targets.length) { ui.notifications.warn('Target one or more tokens to apply the condition.'); return; }
          const sourceActor   = speakerTok.actor;
          const sourceTokenId = speakerTok.id;
          const abilityUuid = normalizeCollection(msg.system?.parts).find(p => p.type === 'abilityUse')?.abilityUuid;
          const abilityItem = abilityUuid ? await fromUuid(abilityUuid) : null;
          const endStr = abilityItem ? getConditionEndFromAbility(abilityItem, conditionId) : null;
          for (const t of targets) {
            if (conditionId === 'frightened') await applyFrightened(t, sourceActor, sourceTokenId, endStr);
            else                              await applyTaunted(t, sourceActor, sourceTokenId, endStr);
          }
        });
        btn.replaceWith(newBtn);
      }
    }
  });

  // Bleeding injector: posts damage roll or applies it automatically
  registerInjector(function injectBleedingDamage(msg, { el, buttons, content }) {
    const data = msg.getFlag('draw-steel-combat-tools', 'bleedingTriggered');
    if (!data) return;
    if (el.querySelector('.dsct-bleeding-roll')) return;

    const target = buttons ?? content ?? el;
    const div = document.createElement('div');
    div.className = 'dsct-bleeding-roll';
    div.style.cssText = 'margin-top:6px;border-top:1px solid var(--color-border-light-primary);padding-top:6px;font-size:13px;';

    if (data.mode === 'auto') {
      // Check if already applied
      const applied = msg.getFlag('draw-steel-combat-tools', 'bleedingApplied');
      if (applied) {
        div.innerHTML = `<em><i class="fa-solid fa-droplet"></i> Bleeding damage applied.</em>`;
      } else {
        // Auto-apply on first render: post the roll as its own message with the undo button injected there
        (async () => {
          const actor = await fromUuid(data.actorUuid);
          if (!actor) return;
          const level = actor.system.level ?? 1;
          const roll = await new Roll(`1d6 + ${level}`).evaluate();
          const dmg  = roll.total;
          const prevValue = actor.system.stamina.value;
          const prevTemp  = actor.system.stamina.temporary;
          const rollMsg = await roll.toMessage({
            flavor: `<strong>Bleeding</strong> (1d6 + ${level}): ${actor.name} loses stamina`,
            speaker: ChatMessage.getSpeaker({ token: getTokenById(data.tokenId)?.document }),
            flags: { 'draw-steel-combat-tools': { bleedingRoll: {
              actorUuid: data.actorUuid, dmg, prevValue, prevTemp, sourceMsgId: msg.id,
            }}},
          });
          await actor.system.takeDamage(dmg, { type: 'untyped', ignoredImmunities: [] });
          await msg.setFlag('draw-steel-combat-tools', 'bleedingApplied', { dmg, rollMsgId: rollMsg?.id });
          if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Auto-applied ${dmg} damage to ${actor.name}`);
        })();
        div.innerHTML = `<em>Bleeding: applying damage�</em>`;
      }
    } else {
      // Manual mode: post a roll button
      if (el.querySelector('.dsct-bleed-roll-btn')) return;
      div.innerHTML = `<button type="button" class="dsct-bleed-roll-btn" style="cursor:pointer;"><i class="fa-solid fa-droplet"></i> Roll Bleeding Damage (1d6 + level)</button>`;
      div.querySelector('.dsct-bleed-roll-btn')?.addEventListener('click', async () => {
        const actor = await fromUuid(data.actorUuid);
        const level = actor?.system?.level ?? 1;
        const roll = await new Roll(`1d6 + ${level}`).evaluate();
        roll.toMessage({ flavor: `Bleeding damage (1d6 + ${level}), apply manually`, speaker: { token: data.tokenId } });
      });
    }
    target.appendChild(div);
  });

  // Undo button lives on the bleeding roll message itself
  registerInjector(function injectBleedingUndo(msg, { el, buttons, content }) {
    const rollData = msg.getFlag('draw-steel-combat-tools', 'bleedingRoll');
    if (!rollData) return;
    if (el.querySelector('.dsct-bleed-undo')) return;

    const target = buttons ?? content ?? el;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-bleed-undo';
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Undo Bleeding';
    btn.style.cssText = 'cursor:pointer;margin-top:4px;';
    btn.addEventListener('click', async () => {
      const actor = await fromUuid(rollData.actorUuid);
      if (actor) {
        await actor.update({ 'system.stamina.temporary': rollData.prevTemp, 'system.stamina.value': rollData.prevValue });
        if (getSetting('debugMode')) console.log(`DSCT | Bleeding | Undid ${rollData.dmg} damage on ${actor.name}`);
      }
      // Clear the source ability message flags so bleeding can't re-trigger
      const sourceMsg = game.messages.get(rollData.sourceMsgId);
      if (sourceMsg && (sourceMsg.isOwner || game.user.isGM)) {
        await sourceMsg.unsetFlag('draw-steel-combat-tools', 'bleedingTriggered');
        await sourceMsg.unsetFlag('draw-steel-combat-tools', 'bleedingApplied');
      }
      // Delete this roll message
      if (msg.isOwner || game.user.isGM) await msg.delete();
    });
    target.appendChild(btn);
  });

  const sweepVisibleMessages = () => {
    document.querySelectorAll('[data-message-id]').forEach(el => {
      const msg = game.messages.get(el.dataset.messageId);
      if (msg) scheduleInject(msg);
    });
  };

  Hooks.on('createChatMessage', (msg) => {
    // Mark as freshly created so bleeding can trigger; cleared after 5s to prevent retroactive tagging
    _recentlyCreated.add(msg.id);
    setTimeout(() => _recentlyCreated.delete(msg.id), 5000);
    trySetFlag(msg);
    // Safety sweep: 2 seconds after any new message, re-inject ALL visible messages, not just the new one, so previously-failed injects get a second chance.
    setTimeout(sweepVisibleMessages, 2000);
  });
  Hooks.on('updateChatMessage',     (msg)     => { trySetFlag(msg); scheduleInject(msg); });
  Hooks.on('renderChatMessageHTML', (msg, el) => trySetFlag(msg, el).then(() => scheduleInject(msg)));

  // Re-inject all currently visible messages when the chat log renders (e.g. user opens the chat tab)
  let _chatLogInjectTimer = null;
  Hooks.on('renderChatLog', () => {
    clearTimeout(_chatLogInjectTimer);
    _chatLogInjectTimer = setTimeout(sweepVisibleMessages, 1000);
  });
}

export function refreshChatInjections() {
  ui.chat.render(true);
}