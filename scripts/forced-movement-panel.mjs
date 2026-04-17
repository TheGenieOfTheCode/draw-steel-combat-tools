import {
  s, palette, injectPanelChrome,
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
    position: { width: s(260), height: 'auto' },
  };

  _updatePreview() {
    const controlled  = canvas.tokens.controlled;
    const targets     = [...game.user.targets];
    this._sourceToken = controlled.length === 1 ? controlled[0] : null;
    this._targetTokens = targets;
    this._targetToken = targets.length > 0 ? targets[0] : null;
  }

  _buildTargetHTML(p) {
    const targets = this._targetTokens;
    const count   = targets.length;
    const cols    = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;
    const total   = s(66);
    const gap     = s(2);
    const cell    = Math.floor((total - gap * (cols - 1)) / cols);

    if (cols === 1) {
      const src   = targets[0]?.document.texture.src ?? 'icons/svg/mystery-man.svg';
      const label = targets[0]?.name ?? 'No Target';
      const color = targets[0] ? p.text : p.textDim;
      return `
        <img src="${src}" style="width:${total}px;height:${total}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
        <div style="font-size:${s(11)}px;color:${color};text-align:center;width:100%;overflow-wrap:break-word;word-break:break-word;margin-top:${s(2)}px;">${label}</div>
      `;
    }

    const slots  = cols * cols;
    const filled = targets.slice(0, slots).map(t =>
      `<img src="${t.document.texture.src}" style="width:${cell}px;height:${cell}px;border-radius:2px;object-fit:cover;border:1px solid ${p.border};background:${p.bg};" title="${t.name}">`
    ).join('');
    const empty  = Array(Math.max(0, slots - Math.min(count, slots))).fill(
      `<div style="width:${cell}px;height:${cell}px;border-radius:2px;border:1px dashed ${p.borderOuter};"></div>`
    ).join('');
    const label  = count ? `${count} Target${count !== 1 ? 's' : ''}` : 'No Target';
    return `
      <div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:${gap}px;width:${total}px;height:${total}px;align-items:center;justify-items:center;">
        ${filled}${empty}
      </div>
      <div style="font-size:${s(11)}px;color:${count ? p.text : p.textDim};text-align:center;width:100%;overflow-wrap:break-word;word-break:break-word;margin-top:${s(2)}px;">${label}</div>
    `;
  }

  _refreshPanel() {
    if (!this.rendered) return;
    this._updatePreview();
    const p = palette();

    const sourceImg  = this.element.querySelector('#fm-source-img');
    const sourceName = this.element.querySelector('#fm-source-name');
    if (sourceImg)  { sourceImg.src = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg'; sourceImg.style.width = `${s(66)}px`; sourceImg.style.height = `${s(66)}px`; }
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? 'No Source'; sourceName.style.color = this._sourceToken ? p.text : p.textDim; }

    const targetContainer = this.element.querySelector('#fm-target-container');
    if (targetContainer) targetContainer.innerHTML = this._buildTargetHTML(p);
  }

  async _renderHTML(_context, _options) {
    injectPanelChrome(this.options.id);
    const p = palette();

    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'No Source';

    return `
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;" id="fm-drag-handle">

        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Forced Movement</div>
          <button data-action="close-window"
            style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;margin-left:auto;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;
            display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;"
            onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
        </div>

        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;">
          <div style="display:flex;align-items:center;gap:${s(6)}px;">
            <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;">
              <img id="fm-source-img" src="${sourceSrc}" style="width:${s(66)}px;height:${s(66)}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
              <div id="fm-source-name" style="font-size:${s(11)}px;color:${this._sourceToken ? p.text : p.textDim};text-align:center;width:100%;overflow-wrap:break-word;word-break:break-word;margin-top:${s(2)}px;">${sourceLabel}</div>
            </div>

            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">
              <div style="font-size:${s(12)}px;color:${p.textDim};">moves</div>
            </div>

            <div id="fm-target-container" style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;height:${s(80)}px;">
              ${this._buildTargetHTML(p)}
            </div>
          </div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Parameters</div>
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(4)}px;">

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Distance</div>
            <div style="display:flex;gap:${s(3)}px;">
              <select id="fm-type" style="width:${s(60)}px;">
                <option value="Push">Push</option><option value="Pull">Pull</option><option value="Slide">Slide</option>
              </select>
              <input type="number" id="fm-dist" value="1" min="0" step="1" style="width:${s(30)}px;text-align:center;" title="Squares">
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
              <input type="checkbox" id="fm-vert-check"> Vertical
            </label>
            <input type="number" id="fm-vert-dist" placeholder="Dist" step="1" style="width:${s(40)}px;text-align:center;" title="Leave blank to match horizontal distance">
          </div>

          <div style="width:100%;height:1px;background:${p.border};margin:${s(2)}px 0;"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Fall Reduction</div>
            <input type="number" id="fm-fall-red" value="0" min="0" step="1" style="width:${s(30)}px;text-align:center;" title="Bonus (Stacks with Agility)">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:${s(4)}px;margin-top:${s(2)}px;">
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-no-fall"> No Fall Damage</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-no-col"> No Collision Damage</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-ign-stab"> Ignore Stability</label>
            <label style="color:${p.accent};font-size:${s(8)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;"><input type="checkbox" id="fm-fast-move"> Fast Auto-Path</label>
          </div>
        </div>

        <button data-action="execute-fm" style="width:100%;padding:${s(15)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(12)}px;font-weight:bold;background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">
          <i class="fas fa-arrows-alt" style="margin-right:${s(4)}px;"></i> <span id="fm-exec-text">Execute Move</span>
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
