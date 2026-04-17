import {
  getSetting, getWindowById, getSquadGroup, safeTakeDamage,
  safeToggleStatusEffect, safeCreateEmbedded, safeDelete,
  s, injectPanelChrome,
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
    position: { width: 348, height: 'auto' },
  };

  _updatePreview() {
    const controlled    = canvas.tokens.controlled;
    const targets       = [...game.user.targets];
    this._sourceToken   = controlled.length === 1 ? controlled[0] : null;
    this._targetTokens  = targets;
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
        <div class="dsct-token-name${count ? '' : ' dim'}">${label}</div>
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

    const sourceImg  = this.element.querySelector('#dc-source-img');
    const sourceName = this.element.querySelector('#dc-source-name');
    if (sourceImg)  sourceImg.src = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    if (sourceName) { sourceName.textContent = this._sourceToken?.name ?? 'No Source'; sourceName.classList.toggle('dim', !this._sourceToken); }

    const targetContainer = this.element.querySelector('#dc-target-container');
    if (targetContainer) targetContainer.innerHTML = this._buildTargetHTML();

    const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
    const srcNote = this.element.querySelector('#dc-source-note');
    if (srcNote) srcNote.classList.toggle('dsct-hidden', !condDef?.requiresSource);

    const execBtn = this.element.querySelector('[data-action="execute-dc"]');
    if (execBtn) execBtn.textContent = this._buildButtonText();
  }

  async _renderHTML(_context, _options) {
    injectPanelChrome(this.options.id);

    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'No Source';
    const dmgTypeHTML = DAMAGE_TYPES.map(t => `<option value="${t}" ${t === this._damageType ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('');

    const condOptHTML = `<option value="">-- None --</option>`
      + ALL_CONDITIONS.map(c => `<option value="${c.id}" ${c.id === this._condition ? 'selected' : ''}>${c.label}</option>`).join('');
    const condDef   = ALL_CONDITIONS.find(c => c.id === this._condition);
    const hideSrcNote = !(condDef?.requiresSource ?? false);

    return `
      <div class="dsct-panel" id="dc-drag-handle">

        <div class="dsct-panel-header">
          <div class="dsct-panel-title">Damage &amp; Conditions</div>
          <button class="dsct-close-btn" data-action="close-window">x</button>
        </div>

        <div class="dsct-section">
          <div class="dsct-fm-actors">
            <div class="dsct-token-col">
              <img id="dc-source-img" src="${sourceSrc}" class="dsct-token-img dsct-token-img-lg">
              <div id="dc-source-name" class="dsct-token-name${this._sourceToken ? '' : ' dim'}">${sourceLabel}</div>
            </div>
            <div class="dsct-arrow">&#8594;</div>
            <div id="dc-target-container" class="dsct-target-col">
              ${this._buildTargetHTML()}
            </div>
          </div>
        </div>

        <div class="dsct-section-label">Damage</div>
        <div class="dsct-section dsct-col-gap">
          <div class="dsct-row">
            <span class="dsct-param-label">Amount</span>
            <div class="dsct-btn-group">
              <input type="number" id="dc-amount" value="0" min="0" step="1" class="dsct-input-md">
              <select id="dc-type" style="width:98px;">${dmgTypeHTML}</select>
            </div>
          </div>
          <label class="dsct-checkbox-label">
            <input type="checkbox" id="dc-ignore-immunity"> Ignore Immunity
          </label>
          <div class="dsct-flex-row">
            <button id="dc-mode-strike" data-mode="strike" class="dsct-mode-btn${this._damageMode==='strike' ? ' active' : ''}">Strike</button>
            <button id="dc-mode-area"   data-mode="area"   class="dsct-mode-btn${this._damageMode==='area'   ? ' active' : ''}">Area</button>
          </div>
        </div>

        <div class="dsct-section-label">Condition</div>
        <div class="dsct-section dsct-col-gap">
          <div class="dsct-row-start">
            <select id="dc-condition" style="flex:1;">${condOptHTML}</select>
            <select id="dc-condition-end" style="width:103px;" ${!this._condition ? 'disabled' : ''}>${durOptsHTML(this._conditionEnd)}</select>
          </div>
          <div id="dc-source-note" class="dsct-source-note${hideSrcNote ? ' dsct-hidden' : ''}">Requires a controlled source token.</div>
        </div>

        <button class="dsct-execute-btn sm" data-action="execute-dc">
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
        this.element.querySelectorAll('[data-mode]').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === this._damageMode);
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
