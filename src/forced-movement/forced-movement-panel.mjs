import {
  getWindowById, getModuleApi, getSetting,
} from '../helpers.mjs';
import { pickTarget } from './forced-movement-engine.mjs';
import { runMultiTokenPicker, setFoundryTargets } from '../ability-automation/target-picker.mjs';

export class ForcedMovementPanel extends ds.applications.api.DSApplication {
  constructor() {
    super();
    this._sourceToken = null;
    this._targetToken = null;
    this._targetTokens = [];
    this._updatePreview();
  }

  static DEFAULT_OPTIONS = {
    id: 'dsct-fm-panel',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.ForcedMovement', minimizable: false, resizable: true },
    position: { width: 312, height: 'auto' },
    actions: {
      'execute-fm': ForcedMovementPanel._onExecuteFM,
    },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/forced-movement.hbs' },
  };

  _updatePreview() {
    const controlled  = canvas.tokens.controlled;
    const targets     = [...game.user.targets];
    this._sourceToken = controlled.length === 1 ? controlled[0] : null;
    this._targetTokens = targets;
    this._targetToken = targets.length > 0 ? targets[0] : null;
  }

  _buildTargetHTML() {
    const targets = this._targetTokens;
    const count   = targets.length;
    const cols    = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;
    const total   = 79;
    const gap     = 2;
    const cell    = Math.floor((total - gap * (cols - 1)) / cols);

    if (cols === 1) {
      const src   = targets[0]?.document.texture.src ?? 'icons/svg/mystery-man.svg';
      const label = targets[0]?.name ?? game.i18n.localize('DSCT.panel.fm.noTarget');
      return `
        <img src="${src}" class="dsct-token-img dsct-token-img-lg">
        <div class="dsct-token-name${targets[0] ? '' : ' dim'}">${label}</div>
      `;
    }

    const slots  = cols * cols;
    const filled = targets.slice(0, slots).map(t =>
      `<img src="${t.document.texture.src}" class="dsct-token-img" style="width:${cell}px;height:${cell}px;" title="${t.name}">`
    ).join('');
    const empty  = Array(Math.max(0, slots - Math.min(count, slots))).fill(
      `<div class="dsct-token-placeholder" style="width:${cell}px;height:${cell}px;"></div>`
    ).join('');
    const label  = count ? game.i18n.format('DSCT.panel.fm.countTargets', { count, s: count !== 1 ? 's' : '' }) : game.i18n.localize('DSCT.panel.fm.noTarget');
    return `
      <div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:${gap}px;width:${total}px;height:${total}px;align-items:center;justify-items:center;">
        ${filled}${empty}
      </div>
      <div class="dsct-token-name${count ? '' : ' dim'}">${label}</div>
    `;
  }

  _refreshPanel() {
    if (!this.rendered) return;
    this._updatePreview();

    const sourceImg  = this.element.querySelector('#fm-source-img');
    const sourceName = this.element.querySelector('#fm-source-name');
    if (sourceImg)  { sourceImg.src = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg'; }
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? game.i18n.localize('DSCT.panel.fm.noSource'); sourceName.classList.toggle('dim', !this._sourceToken); }

    const targetContainer = this.element.querySelector('#fm-target-container');
    if (targetContainer) targetContainer.innerHTML = this._buildTargetHTML();
  }

  async _prepareContext(_options) {
    this._updatePreview();
    return {
      sourceSrc:      this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg',
      sourceLabel:    this._sourceToken?.name ?? game.i18n.localize('DSCT.panel.fm.noSource'),
      sourceSelected: !!this._sourceToken,
      targetHTML:     this._buildTargetHTML(),
      isGMDebug:      game.user.isGM && getSetting('debugMode'),
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);

    if (this._hookControl) Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)  Hooks.off('targetToken',  this._hookTarget);
    this._hookControl = Hooks.on('controlToken', () => this._refreshPanel());
    this._hookTarget  = Hooks.on('targetToken',  () => this._refreshPanel());
    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    const juggerEl  = this.element.querySelector('#fm-juggernaut');
    const noFallEl  = this.element.querySelector('#fm-no-fall');
    const noColEl   = this.element.querySelector('#fm-no-col');
    const ignStabEl = this.element.querySelector('#fm-ign-stab');
    const applyJuggernautLock = () => {
      const on = juggerEl?.checked;
      for (const el of [noFallEl, noColEl, ignStabEl]) {
        if (!el) continue;
        el.checked  = on ? true : el.checked;
        el.disabled = !!on;
      }
    };
    juggerEl?.addEventListener('change', applyJuggernautLock);
    applyJuggernautLock();

    const updateExecButton = () => {
      const type     = this.element.querySelector('#fm-type')?.value || 'Move';
      const dist     = this.element.querySelector('#fm-dist')?.value ?? '0';
      const isVert   = this.element.querySelector('#fm-vert-check')?.checked;
      const vertDist = this.element.querySelector('#fm-vert-dist')?.value;
      const vertPart = isVert ? (vertDist ? `Vertical ${vertDist} ` : 'Vertical ') : '';
      this.element.querySelector('#fm-exec-text').textContent = `Execute ${vertPart}${type} ${dist}`;
    };
    this.element.querySelectorAll('input, select').forEach(el => el.addEventListener('change', updateExecButton));
    this.element.querySelectorAll('input, select').forEach(el => el.addEventListener('input', updateExecButton));
    updateExecButton();
  }

  static async _onExecuteFM(_event, _target) {
    if (this._targetTokens.length === 0) {
      if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.localize('DSCT.notice.fm.noTarget')); return; }
      const picked = await runMultiTokenPicker();
      if (!picked?.length) return;
      setFoundryTargets(picked);
      this._targetTokens = picked;
      this._refreshPanel();
    }

    const type       = this.element.querySelector('#fm-type')?.value;
    const distance   = parseInt(this.element.querySelector('#fm-dist')?.value ?? '0');
    const isVertical = this.element.querySelector('#fm-vert-check')?.checked;
    const rawVert    = this.element.querySelector('#fm-vert-dist')?.value;

    let verticalHeight = 0;
    if (isVertical) {
      const sign       = type === 'Pull' ? -1 : 1;
      const parsedVert = rawVert === '' ? distance : parseInt(rawVert);
      const vert       = isNaN(parsedVert) ? distance : parsedVert;
      verticalHeight   = vert < 0 ? vert : vert * sign;
    }

    const fallReduction     = parseInt(this.element.querySelector('#fm-fall-red')?.value) || 0;
    const juggernaut        = this.element.querySelector('#fm-juggernaut')?.checked ?? false;
    const noFallDamage      = juggernaut || this.element.querySelector('#fm-no-fall')?.checked;
    const noCollisionDamage = juggernaut || this.element.querySelector('#fm-no-col')?.checked;
    const ignoreStability   = juggernaut || this.element.querySelector('#fm-ign-stab')?.checked;
    const fastMove          = this.element.querySelector('#fm-fast-move')?.checked;

    const api = getModuleApi(false);
    if (api && api.forcedMovement) {
      const targetsToProcess = this._targetTokens.slice(0, 25);
      const payload = { type, distance, sourceId: this._sourceToken?.id, verticalHeight, fallReduction, noFallDamage, noCollisionDamage, ignoreStability, fastMove, juggernaut };

      if (targetsToProcess.length === 1) {
        await api.forcedMovement({ ...payload, targetId: targetsToProcess[0].id });
      } else {
        const results = [];
        if (fastMove) {
          for (const t of targetsToProcess) {
            const result = await api.forcedMovement({ ...payload, targetId: t.id, suppressMessage: true });
            if (result) results.push(result);
          }
        } else {
          let remaining = [...targetsToProcess];
          while (remaining.length > 0) {
            const picked = await pickTarget(remaining);
            if (!picked) break;
            remaining = remaining.filter(t => t.id !== picked.id);
            const result = await api.forcedMovement({ ...payload, targetId: picked.id, suppressMessage: true });
            if (result) results.push(result);
          }
        }
        if (results.length === 0) return;
        await ChatMessage.create({
          content: results.map(r => r.content).join('<hr style="margin: 4px 0;">'),
          flags: {
            'draw-steel-combat-tools': {
              isFmUndo:   true,
              isCombined: true,
              entries:    results.map(({ content, undoLog, moveId, targetTokenId, targetSceneId, finalPos, hadDamage, grabsToRestore }) =>
                            ({ content, undoLog, moveId, targetTokenId, targetSceneId, finalPos, hadDamage, grabsToRestore: grabsToRestore ?? [] })),
              isUndone:   false,
              hadDamage:  results.some(r => r.hadDamage),
            }
          }
        });
      }
    }
  }

  async close(options = {}) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const toggleForcedMovementPanel = () => {
  const existing = getWindowById('dsct-fm-panel');
  if (existing) {
    existing.close();
  } else {
    new ForcedMovementPanel().render({ force: true });
  }
};
