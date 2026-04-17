import {
  s, injectPanelChrome,
  getWindowById, getModuleApi,
} from './helpers.mjs';

const { ApplicationV2 } = foundry.applications.api;

export class ForcedMovementPanel extends ApplicationV2 {
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
    window: { title: 'Forced Movement', minimizable: false, resizable: false },
    position: { width: 312, height: 'auto' },
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
      const label = targets[0]?.name ?? 'No Target';
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
    const label  = count ? `${count} Target${count !== 1 ? 's' : ''}` : 'No Target';
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
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? 'No Source'; sourceName.classList.toggle('dim', !this._sourceToken); }

    const targetContainer = this.element.querySelector('#fm-target-container');
    if (targetContainer) targetContainer.innerHTML = this._buildTargetHTML();
  }

  async _renderHTML(_context, _options) {
    injectPanelChrome(this.options.id);

    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'No Source';

    return `
      <div class="dsct-panel" id="fm-drag-handle">

        <div class="dsct-panel-header">
          <div class="dsct-panel-title">Forced Movement</div>
          <button class="dsct-close-btn" data-action="close-window">x</button>
        </div>

        <div class="dsct-section">
          <div class="dsct-fm-actors">
            <div class="dsct-token-col">
              <img id="fm-source-img" src="${sourceSrc}" class="dsct-token-img dsct-token-img-lg">
              <div id="fm-source-name" class="dsct-token-name${this._sourceToken ? '' : ' dim'}">${sourceLabel}</div>
            </div>

            <div class="dsct-center-col">
              <div class="dsct-fm-moves-label">moves</div>
            </div>

            <div id="fm-target-container" class="dsct-target-col">
              ${this._buildTargetHTML()}
            </div>
          </div>
        </div>

        <div class="dsct-section-label">Parameters</div>
        <div class="dsct-section dsct-col-gap">

          <div class="dsct-row">
            <div class="dsct-param-label">Distance</div>
            <div class="dsct-btn-group">
              <select id="fm-type" class="dsct-input-lg">
                <option value="Push">Push</option><option value="Pull">Pull</option><option value="Slide">Slide</option>
              </select>
              <input type="number" id="fm-dist" value="1" min="0" step="1" class="dsct-input-sm" title="Squares">
            </div>
          </div>

          <div class="dsct-row">
            <label class="dsct-checkbox-label">
              <input type="checkbox" id="fm-vert-check"> Vertical
            </label>
            <input type="number" id="fm-vert-dist" placeholder="Dist" step="1" class="dsct-input-md" title="Leave blank to match horizontal distance">
          </div>

          <div class="dsct-divider"></div>

          <div class="dsct-row">
            <div class="dsct-param-label">Fall Reduction</div>
            <input type="number" id="fm-fall-red" value="0" min="0" step="1" class="dsct-input-sm" title="Bonus (Stacks with Agility)">
          </div>

          <div class="dsct-checkbox-grid">
            <label class="dsct-checkbox-label"><input type="checkbox" id="fm-no-fall"> No Fall Damage</label>
            <label class="dsct-checkbox-label"><input type="checkbox" id="fm-no-col"> No Collision Damage</label>
            <label class="dsct-checkbox-label"><input type="checkbox" id="fm-ign-stab"> Ignore Stability</label>
            <label class="dsct-checkbox-label"><input type="checkbox" id="fm-fast-move"> Fast Auto-Path</label>
          </div>
        </div>

        <button class="dsct-execute-btn" data-action="execute-fm">
          <i class="fas fa-arrows-alt"></i> <span id="fm-exec-text">Execute Move</span>
        </button>

      </div>`;
  }

  _replaceHTML(result, content, _options) {
    content.innerHTML = result;
  }

  _onRender(_context, _options) {
    const saved = window._fmPanelPos;
    if (saved) this.setPosition({ left: saved.left, top: saved.top });

    this.element.querySelector('#fm-drag-handle')?.addEventListener('mousedown', e => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
      e.preventDefault();
      const sx = e.clientX - this.position.left, sy = e.clientY - this.position.top;
      const onMove = ev => { this.setPosition({ left: ev.clientX - sx, top: ev.clientY - sy }); };
      const onUp   = () => {
        window._fmPanelPos = { left: this.position.left, top: this.position.top };
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    if (this._hookControl) Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)  Hooks.off('targetToken',  this._hookTarget);
    this._hookControl = Hooks.on('controlToken', () => this._refreshPanel());
    this._hookTarget  = Hooks.on('targetToken',  () => this._refreshPanel());
    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    const updateExecButton = () => {
      const type    = this.element.querySelector('#fm-type')?.value || 'Move';
      const dist    = this.element.querySelector('#fm-dist')?.value ?? '0';
      const isVert  = this.element.querySelector('#fm-vert-check')?.checked;
      const vertDist = this.element.querySelector('#fm-vert-dist')?.value;
      const vertPart = isVert ? (vertDist ? `Vertical ${vertDist} ` : 'Vertical ') : '';
      this.element.querySelector('#fm-exec-text').textContent = `Execute ${vertPart}${type} ${dist}`;
    };
    this.element.querySelectorAll('input, select').forEach(el => el.addEventListener('change', updateExecButton));
    this.element.querySelectorAll('input, select').forEach(el => el.addEventListener('input', updateExecButton));
    updateExecButton();

    this.element.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'close-window') {
        this.close();
        return;
      }

      if (action === 'execute-fm') {
        if (this._targetTokens.length === 0) { ui.notifications.warn("DSCT | You must target at least one token."); return; }

        const type     = this.element.querySelector('#fm-type')?.value;
        const distance = parseInt(this.element.querySelector('#fm-dist')?.value ?? '0');
        const isVertical  = this.element.querySelector('#fm-vert-check')?.checked;
        const rawVert  = this.element.querySelector('#fm-vert-dist')?.value;

        let verticalHeight = 0;
        if (isVertical) {
          const sign       = type === 'Pull' ? -1 : 1;
          const parsedVert = rawVert === '' ? distance : parseInt(rawVert);
          const vert       = isNaN(parsedVert) ? distance : parsedVert;
          verticalHeight   = vert < 0 ? vert : vert * sign;
        }

        const fallReduction     = parseInt(this.element.querySelector('#fm-fall-red')?.value) || 0;
        const noFallDamage      = this.element.querySelector('#fm-no-fall')?.checked;
        const noCollisionDamage = this.element.querySelector('#fm-no-col')?.checked;
        const ignoreStability   = this.element.querySelector('#fm-ign-stab')?.checked;
        const fastMove          = this.element.querySelector('#fm-fast-move')?.checked;

        const api = getModuleApi(false);
        if (api && api.forcedMovement) {
          const targetsToProcess = this._targetTokens.slice(0, 25);
          const payload = { type, distance, sourceId: this._sourceToken?.id, verticalHeight, fallReduction, noFallDamage, noCollisionDamage, ignoreStability, fastMove };

          if (targetsToProcess.length === 1) {
            await api.forcedMovement({ ...payload, targetId: targetsToProcess[0].id });
          } else {
            const results = [];
            for (const t of targetsToProcess) {
              const result = await api.forcedMovement({ ...payload, targetId: t.id, suppressMessage: true });
              if (result) results.push(result);
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
    });
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
