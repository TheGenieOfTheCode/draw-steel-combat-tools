import {
  getSetting, getWindowById, getSquadGroup, applyDamage,
  safeToggleStatusEffect, safeCreateEmbedded, safeDelete, getItemDsid,
} from '../helpers.mjs';
import { applyFrightened, applyTaunted } from './conditions.mjs';
import { runSourcePicker, runMultiTokenPicker, setFoundryTargets } from '../ability-automation/target-picker.mjs';

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
  { id: 'invisible',  label: 'Invisible' },
  { id: 'judged',     label: 'Judged',     requiresSource: true, dsct: true },
  { id: 'marked',     label: 'Marked',     requiresSource: true, dsct: true },
  { id: 'prone',      label: 'Prone' },
  { id: 'restrained', label: 'Restrained' },
  { id: 'sleep',      label: 'Sleep' },
  { id: 'slowed',     label: 'Slowed' },
  { id: 'surprised',  label: 'Surprised' },
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


const applyJudgedEffect = async (targetToken, sourceActor, sourceTokenId, endStr) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const existing = actor.appliedEffects?.find(e => e.getFlag(M, 'judgement')?.userId === game.user.id);
  if (existing) await safeDelete(existing);
  const end = resolveEnd(endStr);
  await safeCreateEmbedded(actor, 'ActiveEffect', [{
    name: `Judged [${sourceActor.name}]`,
    img: getSetting('judgedEffectIcon') || 'icons/magic/death/skull-humanoid-white-red.webp',
    type: 'base',
    system: end?.systemEnd ? { end: end.systemEnd } : {},
    duration: end?.duration ?? {},
    changes: [],
    flags: { [M]: { judgement: { userId: game.user.id, actorId: sourceActor.id } } },
  }]);
};

const applyMarkedEffect = async (targetToken, sourceActor, sourceTokenId, endStr) => {
  const actor = targetToken.actor;
  if (!actor) return;
  const end = resolveEnd(endStr);
  await safeCreateEmbedded(actor, 'ActiveEffect', [{
    name: `Mark [${sourceActor.name}]`,
    img: getSetting('markedEffectIcon') || 'icons/skills/targeting/crosshair-pointed-orange.webp',
    type: 'base',
    system: end?.systemEnd ? { end: end.systemEnd } : {},
    duration: end?.duration ?? {},
    changes: [{ key: 'system.combat.targetModifiers.edges', mode: 2, value: '1', priority: null }],
    flags: { [M]: { mark: { userId: game.user.id, actorId: sourceActor.id, dsid: 'other', isMarkAbility: false } } },
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
    img:      (condId === 'bleeding' ? getSetting('bleedingEffectIcon') : '') || (statusCfg?.img ?? 'icons/svg/mystery-man.svg'),
    type:     'base',
    system:   end.systemEnd ? { end: end.systemEnd } : {},
    duration: end.duration,
    statuses: [condId],
    changes:  statusCfg?.changes ?? [],
    flags:    statusCfg?.flags   ?? {},
    disabled: false, transfer: false,
  }]);
};

export class DamageConditionsPanel extends ds.applications.api.DSApplication {
  constructor() {
    super();
    this._sourceToken    = null;
    this._pinnedSource   = null;
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
    window: { title: 'DSCT.panel.title.DamageConditions', minimizable: false, resizable: true },
    position: { width: 348, height: 'auto' },
    actions: {
      'execute-dc': DamageConditionsPanel._onExecuteDC,
      'set-mode':   DamageConditionsPanel._onSetMode,
    },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/damage-conditions.hbs' },
  };

  _updatePreview() {
    const controlled = canvas.tokens.controlled;
    const targets    = [...game.user.targets];
    if (controlled.length === 1) {
      this._sourceToken  = controlled[0];
      this._pinnedSource = null;
    } else if (this._pinnedSource) {
      this._sourceToken = canvas.tokens.placeables.find(t => t.id === this._pinnedSource.id) ?? null;
      if (!this._sourceToken) this._pinnedSource = null;
    } else {
      this._sourceToken = null;
    }
    this._targetTokens = targets;
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

  async _prepareContext(_options) {
    return {
      sourceSrc:       this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg',
      sourceLabel:     this._sourceToken?.name ?? 'No Source',
      sourceSelected:  !!this._sourceToken,
      targetHTML:      this._buildTargetHTML(),
      amount:          this._amount,
      damageTypes:     DAMAGE_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1), selected: t === this._damageType })),
      ignoreImmunity:  this._ignoreImmunity,
      modeStrike:      this._damageMode === 'strike',
      modeArea:        this._damageMode === 'area',
      conditions:      [{ value: '', label: '-- None --', selected: !this._condition }, ...ALL_CONDITIONS.map(c => ({ value: c.id, label: c.label, selected: c.id === this._condition }))],
      durOptions:      DUR_OPTIONS.map(o => ({ value: o.value, label: o.label, selected: o.value === this._conditionEnd })),
      conditionDisabled: !this._condition,
      requiresSource:  !!(ALL_CONDITIONS.find(c => c.id === this._condition)?.requiresSource),
      buttonText:      this._buildButtonText(),
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

    const refreshBtn = () => {
      const execBtn = this.element.querySelector('[data-action="execute-dc"]');
      if (execBtn) execBtn.textContent = this._buildButtonText();
    };


    this.element.querySelector('#dc-amount')?.addEventListener('input',  e => { this._amount        = parseInt(e.target.value) || 0; refreshBtn(); });
    this.element.querySelector('#dc-type')?.addEventListener('change',   e => { this._damageType    = e.target.value;              refreshBtn(); });
    this.element.querySelector('#dc-ignore-immunity')?.addEventListener('change', e => { this._ignoreImmunity = e.target.checked; });
    this.element.querySelector('#dc-condition')?.addEventListener('change', e => {
      this._condition = e.target.value;
      const sel = this.element.querySelector('#dc-condition-end');
      if (sel) sel.disabled = !this._condition;
      this._refreshPanel();
      refreshBtn();
    });
    this.element.querySelector('#dc-condition-end')?.addEventListener('change', e => { this._conditionEnd = e.target.value; refreshBtn(); });
  }

  static async _onExecuteDC() {
    await this._execute();
  }

  static _onSetMode(_event, target) {
    this._damageMode = target.dataset.mode;
    this.element.querySelectorAll('[data-action="set-mode"]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === this._damageMode);
    });
    const execBtn = this.element.querySelector('[data-action="execute-dc"]');
    if (execBtn) execBtn.textContent = this._buildButtonText();
  }

  async _execute() {
    if (this._targetTokens.length === 0) {
      if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dc.noTarget')); return; }
      const picked = await runMultiTokenPicker();
      if (!picked?.length) return;
      setFoundryTargets(picked);
      this._targetTokens = picked;
      this._refreshPanel();
    }

    const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
    if (condDef?.requiresSource && !this._sourceToken) {
      if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.format('DSCT.notice.dc.requiresSource', { condition: condDef.label })); return; }
      const picked = await runSourcePicker();
      if (!picked) return;
      this._pinnedSource = picked;
      this._sourceToken  = picked;
      this._refreshPanel();
    }

    if (this._amount <= 0 && !this._condition) { ui.notifications.warn(game.i18n.localize('DSCT.notice.dc.nothingToApply')); return; }

    const isArea        = this._damageMode === 'area';
    const sourceToken   = this._sourceToken;
    const sourceActor   = sourceToken?.actor;
    const sourceTokenId = sourceToken?.id;

    if (this._condition === 'judged' && sourceActor && !sourceActor.items.some(i => getItemDsid(i) === 'judgement')) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.judgeRequiresAbility'));
      return;
    }
    if (this._condition === 'marked' && sourceActor && !sourceActor.items.some(i => getItemDsid(i) === 'mark')) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.markRequiresAbility'));
      return;
    }
    const endStr        = this._conditionEnd;

    for (const targetToken of this._targetTokens) {
      const actor = targetToken.actor;
      if (!actor) continue;

      if (this._amount > 0) {
        await applyDamage(actor, this._amount, undefined, { damageType: this._damageType, ignoreImmunity: this._ignoreImmunity, sourceToken, isArea });
      }
      if (this._condition) {
        switch (this._condition) {
          case 'frightened': if (sourceActor) await applyFrightened(targetToken, sourceActor, sourceTokenId, endStr); break;
          case 'taunted':    if (sourceActor) await applyTaunted(targetToken, sourceActor, sourceTokenId, endStr); break;
          case 'judged':     if (sourceActor) await applyJudgedEffect(targetToken, sourceActor, sourceTokenId, endStr); break;
          case 'marked':     if (sourceActor) await applyMarkedEffect(targetToken, sourceActor, sourceTokenId, endStr); break;
          default:           await applyNativeCondition(actor, this._condition, endStr); break;
        }
      }
    }

    const count = this._targetTokens.length;
    ui.notifications.info(game.i18n.format('DSCT.notice.dc.appliedToCount', { count, s: count !== 1 ? 's' : '' }));
  }

  async close(options = {}) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const toggleDamageConditionsPanel = () => {
  if (!getSetting('conditionsEnabled')) return;
  const existing = getWindowById('dsct-dc-panel');
  if (existing) { existing.close(); return; }
  new DamageConditionsPanel().render({ force: true });
};
