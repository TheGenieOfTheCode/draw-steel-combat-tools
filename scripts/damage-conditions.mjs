import {
  getSetting, getWindowById, getSquadGroup, safeTakeDamage,
  safeToggleStatusEffect, safeCreateEmbedded, safeDelete,
  s, palette, injectPanelChrome,
} from './helpers.mjs';
import { applyFrightened, applyTaunted } from './conditions.mjs';

const { ApplicationV2 } = foundry.applications.api;

const M = 'draw-steel-combat-tools';

const DAMAGE_TYPES = [
  'untyped', 'fire', 'cold', 'lightning', 'sonic',
  'holy', 'corruption', 'psychic', 'poison',
];

const DUR_OPTIONS = [
  { value: 'save',        label: 'Save Ends',          abbr: 'Save' },
  { value: 'turnEnd',     label: 'End of Turn',        abbr: 'EoT' },
  { value: 'turnStart',   label: 'Start of Turn',      abbr: 'SoT' },
  { value: 'roundEnd',    label: 'End of Round',       abbr: 'EoR' },
  { value: 'roundStart',  label: 'Start of Round',     abbr: 'SoR' },
  { value: 'combatEnd',   label: 'End of Encounter',   abbr: 'EoE' },
  { value: 'combatStart', label: 'Start of Encounter', abbr: 'SoE' },
  { value: 'respite',     label: 'Respite',            abbr: 'Rest' },
  { value: 'unlimited',   label: 'Unlimited',          abbr: '' },
];

const ALL_CONDITIONS = [
  { id: 'bleeding',   label: 'Bleeding' },
  { id: 'dazed',      label: 'Dazed' },
  { id: 'frightened', label: 'Frightened', requiresSource: true, dsct: true },
  { id: 'judged',     label: 'Judged',     dsct: true },
  { id: 'marked',     label: 'Marked',     dsct: true },
  { id: 'prone',      label: 'Prone' },
  { id: 'restrained', label: 'Restrained' },
  { id: 'slowed',     label: 'Slowed' },
  { id: 'taunted',    label: 'Taunted',    requiresSource: true, dsct: true },
  { id: 'weakened',   label: 'Weakened' },
];

const durAbbr = (endStr) => {
  if (!endStr || endStr === 'unlimited') return '';
  const opt = DUR_OPTIONS.find(o => o.value === endStr);
  return opt?.abbr ? ` (${opt.abbr})` : '';
};

const resolveEnd = (endStr) => {
  if (!endStr || endStr === 'unlimited') return null;
  if (endStr === 'save') return { duration: { expiry: 'save' }, systemEnd: { roll: '1d10 + @combat.save.bonus' } };
  return { duration: { expiry: endStr }, systemEnd: null };
};

const durOptsHTML = (selectedVal = 'save') =>
  DUR_OPTIONS.map(o => `<option value="${o.value}" ${o.value === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');

const getQSSocket = () => {
  if (!getSetting('quickStrikeCompat')) return null;
  if (!game.modules.get('ds-quick-strike')?.active) return null;
  return socketlib.registerModule('ds-quick-strike');
};

const applyDCDamage = async (actor, amount, damageType, ignoreImmunity, sourceToken, isArea) => {
  if (amount <= 0) return;
  const type = damageType || 'untyped';
  const ignoredImmunities = ignoreImmunity ? [type] : [];
  const squadGroup = getSquadGroup(actor);

  const effectiveAmt = (isArea && squadGroup)
    ? Math.min(amount, actor.system.stamina.max ?? amount)
    : amount;

  if (squadGroup && actor.isToken && actor.token?.id) {
    if (!window._lastSquadDamagedTokenIds) window._lastSquadDamagedTokenIds = new Set();
    window._lastSquadDamagedTokenIds.add(actor.token.id);
    clearTimeout(window._lastSquadDamagedTokenIdsTimer);
    window._lastSquadDamagedTokenIdsTimer = setTimeout(() => { window._lastSquadDamagedTokenIds = null; }, 2000);
  }

  const qs = getQSSocket();
  if (qs) {
    const tokenId = actor.isToken
      ? actor.token?.id
      : canvas.tokens.placeables.find(t => t.actor?.id === actor.id)?.id;
    await qs.executeAsGM('applyDamageToTarget', {
      tokenId, amount: effectiveAmt, type, ignoredImmunities,
      sourceActorName:  sourceToken?.actor?.name ?? sourceToken?.name ?? game.user.character?.name ?? game.user.name,
      sourceActorId:    sourceToken?.actor?.id ?? game.user.character?.id ?? null,
      sourceItemName:   'Damage & Conditions',
      sourcePlayerName: game.user.name,
      sourceItemId:     null,
      eventId:          `dsct-dc-${foundry.utils.randomID()}`,
    });
  } else {
    await safeTakeDamage(actor, effectiveAmt, { type, ignoredImmunities });
  }
};

const applyJudgedEffect = async (targetToken, endStr) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const existing = actor.appliedEffects?.find(e => e.getFlag(M, 'judgement')?.userId === game.user.id);
  if (existing) await safeDelete(existing);
  const end = resolveEnd(endStr);
  await safeCreateEmbedded(actor, 'ActiveEffect', [{
    name: 'Judged',
    img: 'icons/magic/death/skull-humanoid-white-red.webp',
    type: 'base',
    system: end?.systemEnd ? { end: end.systemEnd } : {},
    duration: end?.duration ?? {},
    changes: [],
    flags: { [M]: { judgement: { userId: game.user.id } } },
  }]);
};

const applyMarkedEffect = async (targetToken, sourceActorId, endStr) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const end = resolveEnd(endStr);
  await safeCreateEmbedded(actor, 'ActiveEffect', [{
    name: 'Mark',
    img: 'icons/skills/targeting/crosshair-pointed-orange.webp',
    type: 'base',
    system: end?.systemEnd ? { end: end.systemEnd } : {},
    duration: end?.duration ?? {},
    changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
    flags: { [M]: { mark: { userId: game.user.id, actorId: sourceActorId ?? null, dsid: 'other', isMarkAbility: false } } },
  }]);
};

const applyNativeCondition = async (actor, condId, endStr) => {
  const end = resolveEnd(endStr);
  if (!end) {
    await safeToggleStatusEffect(actor, condId, { active: true, overlay: false });
    return;
  }
  const statusCfg = CONFIG.statusEffects?.find(e => e.id === condId);
  await safeCreateEmbedded(actor, 'ActiveEffect', [{
    name:     statusCfg?.name ?? condId,
    img:      statusCfg?.img  ?? 'icons/svg/mystery-man.svg',
    type:     'base',
    system:   end.systemEnd ? { end: end.systemEnd } : {},
    duration: end.duration,
    statuses: [condId],
    changes:  statusCfg?.changes ?? [],
    flags:    statusCfg?.flags   ?? {},
    disabled: false, transfer: false,
  }]);
};

export class DamageConditionsPanel extends ApplicationV2 {
  constructor() {
    super();
    this._sourceToken    = null;
    this._targetTokens   = [];
    this._amount         = 0;
    this._damageType     = 'untyped';
    this._ignoreImmunity = false;
    this._damageMode     = 'strike';
    this._condition      = '';
    this._conditionEnd   = 'save';
    this._updatePreview();
  }

  static DEFAULT_OPTIONS = {
    id: 'dsct-dc-panel',
    classes: ['draw-steel'],
    window: { title: 'Damage & Conditions', minimizable: false, resizable: false },
    position: { width: s(290), height: 'auto' },
  };

  _updatePreview() {
    const controlled    = canvas.tokens.controlled;
    const targets       = [...game.user.targets];
    this._sourceToken   = controlled.length === 1 ? controlled[0] : null;
    this._targetTokens  = targets;
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
      return `
        <img src="${src}" style="width:${total}px;height:${total}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
        <div style="font-size:${s(11)}px;color:${count ? p.text : p.textDim};text-align:center;width:100%;overflow-wrap:break-word;word-break:break-word;margin-top:${s(2)}px;">${label}</div>
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

  _buildButtonText() {
    const parts = [];
    if (this._amount > 0) {
      const typeStr = this._damageType !== 'untyped'
        ? ` ${this._damageType.charAt(0).toUpperCase() + this._damageType.slice(1)}`
        : '';
      const modeStr = this._damageMode === 'area' ? ' (Area)' : '';
      parts.push(`${this._amount}${typeStr} Damage${modeStr}`);
    }
    if (this._condition) {
      const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
      if (condDef) parts.push(`${condDef.label}${durAbbr(this._conditionEnd)}`);
    }
    return parts.length ? `Apply: ${parts.join('; ')}` : 'Apply';
  }

  _refreshPanel() {
    if (!this.rendered) return;
    this._updatePreview();
    const p = palette();

    const sourceImg  = this.element.querySelector('#dc-source-img');
    const sourceName = this.element.querySelector('#dc-source-name');
    if (sourceImg)  { sourceImg.src = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg'; sourceImg.style.width = `${s(66)}px`; sourceImg.style.height = `${s(66)}px`; }
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? 'No Source'; sourceName.style.color = this._sourceToken ? p.text : p.textDim; }

    const targetContainer = this.element.querySelector('#dc-target-container');
    if (targetContainer) targetContainer.innerHTML = this._buildTargetHTML(p);

    const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
    const srcNote = this.element.querySelector('#dc-source-note');
    if (srcNote) srcNote.style.display = condDef?.requiresSource ? 'block' : 'none';

    const execBtn = this.element.querySelector('[data-action="execute-dc"]');
    if (execBtn) execBtn.textContent = this._buildButtonText();
  }

  async _renderHTML(_context, _options) {
    injectPanelChrome(this.options.id);
    const p = palette();

    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'No Source';
    const dmgTypeHTML = DAMAGE_TYPES.map(t => `<option value="${t}" ${t === this._damageType ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('');

    const condOptHTML = `<option value="">-- None --</option>`
      + ALL_CONDITIONS.map(c => `<option value="${c.id}" ${c.id === this._condition ? 'selected' : ''}>${c.label}</option>`).join('');
    const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
    const showSrcNote = condDef?.requiresSource ?? false;

    return `
      <div style="padding:${s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${s(3)}px;cursor:move;" id="dc-drag-handle">

        <div style="display:flex;align-items:center;gap:${s(6)}px;margin-bottom:${s(8)}px;">
          <div style="font-size:${s(9)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">Damage &amp; Conditions</div>
          <button data-action="close-window" style="width:${s(16)}px;height:${s(16)}px;flex-shrink:0;cursor:pointer;margin-left:auto;background:${p.bgBtn};border:1px solid ${p.border};color:${p.textDim};border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:${s(9)}px;padding:0;" onmouseover="this.style.color='${p.text}'" onmouseout="this.style.color='${p.textDim}'">x</button>
        </div>

        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;">
          <div style="display:flex;align-items:center;gap:${s(6)}px;">
            <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;">
              <img id="dc-source-img" src="${sourceSrc}" style="width:${s(66)}px;height:${s(66)}px;border-radius:${s(3)}px;object-fit:contain;border:1px solid ${p.border};background:${p.bg};">
              <div id="dc-source-name" style="font-size:${s(11)}px;color:${this._sourceToken ? p.text : p.textDim};text-align:center;width:100%;overflow-wrap:break-word;word-break:break-word;margin-top:${s(2)}px;">${sourceLabel}</div>
            </div>
            <div style="font-size:${s(16)}px;color:${p.textDim};flex-shrink:0;">&#8594;</div>
            <div id="dc-target-container" style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;height:${s(80)}px;">
              ${this._buildTargetHTML(p)}
            </div>
          </div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Damage</div>
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(5)}px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:${s(4)}px;">
            <span style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;">Amount</span>
            <div style="display:flex;gap:${s(3)}px;align-items:center;">
              <input type="number" id="dc-amount" value="0" min="0" step="1" style="width:${s(40)}px;text-align:center;">
              <select id="dc-type" style="width:${s(82)}px;">${dmgTypeHTML}</select>
            </div>
          </div>
          <label style="color:${p.accent};font-size:${s(9)}px;font-weight:bold;display:flex;align-items:center;gap:${s(3)}px;cursor:pointer;">
            <input type="checkbox" id="dc-ignore-immunity"> Ignore Immunity
          </label>
          <div style="display:flex;gap:${s(4)}px;">
            <button id="dc-mode-strike" data-mode="strike" style="flex:1;padding:${s(4)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._damageMode==='strike'?p.accent:p.border};color:${this._damageMode==='strike'?p.accent:p.text};">Strike</button>
            <button id="dc-mode-area"   data-mode="area"   style="flex:1;padding:${s(4)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(9)}px;background:${p.bgBtn};border:1px solid ${this._damageMode==='area'?p.accent:p.border};color:${this._damageMode==='area'?p.accent:p.text};">Area</button>
          </div>
        </div>

        <div style="font-size:${s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textLabel};margin-bottom:${s(4)}px;">Condition</div>
        <div style="padding:${s(6)}px;border:1px solid ${p.border};border-radius:${s(3)}px;background:${p.bgInner};margin-bottom:${s(6)}px;display:flex;flex-direction:column;gap:${s(5)}px;">
          <div style="display:flex;align-items:center;gap:${s(4)}px;">
            <select id="dc-condition" style="flex:1;">${condOptHTML}</select>
            <select id="dc-condition-end" style="width:${s(86)}px;" ${!this._condition ? 'disabled' : ''}>${durOptsHTML(this._conditionEnd)}</select>
          </div>
          <div id="dc-source-note" style="display:${showSrcNote ? 'block' : 'none'};font-size:${s(8)}px;color:${p.textDim};">Requires a controlled source token.</div>
        </div>

        <button data-action="execute-dc" style="width:100%;padding:${s(10)}px;border-radius:${s(3)}px;cursor:pointer;font-size:${s(12)}px;font-weight:bold;background:${p.bgBtn};border:1px solid ${p.accent};color:${p.accent};">
          ${this._buildButtonText()}
        </button>

      </div>`;
  }

  _replaceHTML(result, content, _options) {
    content.innerHTML = result;
  }

  _onRender(_context, _options) {
    const saved = window._dcPanelPos;
    if (saved) this.setPosition({ left: saved.left, top: saved.top });

    this.element.querySelector('#dc-drag-handle')?.addEventListener('mousedown', e => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
      e.preventDefault();
      const sx = e.clientX - this.position.left, sy = e.clientY - this.position.top;
      const onMove = ev => { this.setPosition({ left: ev.clientX - sx, top: ev.clientY - sy }); };
      const onUp   = () => {
        window._dcPanelPos = { left: this.position.left, top: this.position.top };
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

    const refreshBtn = () => {
      const execBtn = this.element.querySelector('[data-action="execute-dc"]');
      if (execBtn) execBtn.textContent = this._buildButtonText();
    };

    this.element.querySelector('#dc-amount')?.addEventListener('input',  e => { this._amount        = parseInt(e.target.value) || 0; refreshBtn(); });
    this.element.querySelector('#dc-type')?.addEventListener('change',   e => { this._damageType    = e.target.value;              refreshBtn(); });
    this.element.querySelector('#dc-ignore-immunity')?.addEventListener('change', e => { this._ignoreImmunity = e.target.checked; });

    this.element.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action],[data-mode]');
      if (!btn) return;

      if (btn.dataset.mode) {
        this._damageMode = btn.dataset.mode;
        const p = palette();
        this.element.querySelectorAll('[data-mode]').forEach(b => {
          const m = b.dataset.mode;
          b.style.borderColor = m === this._damageMode ? p.accent : p.border;
          b.style.color       = m === this._damageMode ? p.accent : p.text;
        });
        refreshBtn();
        return;
      }

      const action = btn.dataset.action;
      if (action === 'close-window') { this.close(); return; }
      if (action === 'execute-dc')   { await this._execute(); }
    });

    this.element.querySelector('#dc-condition')?.addEventListener('change', e => {
      this._condition = e.target.value;
      const sel = this.element.querySelector('#dc-condition-end');
      if (sel) sel.disabled = !this._condition;
      this._refreshPanel();
      refreshBtn();
    });
    this.element.querySelector('#dc-condition-end')?.addEventListener('change', e => { this._conditionEnd = e.target.value; refreshBtn(); });
  }

  async _execute() {
    if (this._targetTokens.length === 0) { ui.notifications.warn('Target at least one token first.'); return; }

    const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
    if (condDef?.requiresSource && !this._sourceToken) {
      ui.notifications.warn(`Select a source token (control it) to apply ${condDef.label}.`);
      return;
    }

    if (this._amount <= 0 && !this._condition) { ui.notifications.warn('Nothing to apply.'); return; }

    const isArea        = this._damageMode === 'area';
    const sourceToken   = this._sourceToken;
    const sourceActor   = sourceToken?.actor;
    const sourceTokenId = sourceToken?.id;
    const endStr        = this._conditionEnd;

    for (const targetToken of this._targetTokens) {
      const actor = targetToken.actor;
      if (!actor) continue;

      if (this._amount > 0) {
        await applyDCDamage(actor, this._amount, this._damageType, this._ignoreImmunity, sourceToken, isArea);
      }
      if (this._condition) {
        switch (this._condition) {
          case 'frightened': if (sourceActor) await applyFrightened(targetToken, sourceActor, sourceTokenId, endStr); break;
          case 'taunted':    if (sourceActor) await applyTaunted(targetToken, sourceActor, sourceTokenId, endStr); break;
          case 'judged':     await applyJudgedEffect(targetToken, endStr); break;
          case 'marked':     await applyMarkedEffect(targetToken, sourceActor?.id ?? null, endStr); break;
          default:           await applyNativeCondition(actor, this._condition, endStr); break;
        }
      }
    }

    const count = this._targetTokens.length;
    ui.notifications.info(`Applied to ${count} target${count !== 1 ? 's' : ''}.`);
  }

  async close(options = {}) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const toggleDamageConditionsPanel = () => {
  const existing = getWindowById('dsct-dc-panel');
  if (existing) { existing.close(); return; }
  new DamageConditionsPanel().render({ force: true });
};
