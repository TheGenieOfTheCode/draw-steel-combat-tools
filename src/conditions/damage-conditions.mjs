import {
  getSetting, getWindowById, getSquadGroup, applyDamage,
  safeToggleStatusEffect, safeCreateEmbedded, safeDelete, getItemDsid,
  tokFootprintDist, confirmRangeOverride,
} from '../helpers.mjs';
import { applyFrightened, applyTaunted } from './conditions.mjs';
import { applyGrab, buildGrabListHTML, handleGrabListClick, grabUiState } from './grab.mjs';
import { _FLAT_DAMAGE_ICONS as DMG_ICONS, _FLAT_DAMAGE_COLORS as DMG_COLORS } from '../ability-automation/flat-special-effects.mjs';
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
  { id: 'grabbed',    label: 'Grabbed',    requiresSource: true, dsct: true },
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


export const applyJudgedEffect = async (targetToken, sourceActor, sourceTokenId, endStr) => {
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

export const applyMarkedEffect = async (targetToken, sourceActor, sourceTokenId, endStr) => {
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
    this._grabbedEnd     = 'combatEnd';
    this._distance       = null;
    this._grabsExpanded  = false;
    this._updatePreview();
  }

  static DEFAULT_OPTIONS = {
    id: 'dsct-dc-panel',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.DamageConditions', minimizable: false },
    position: { width: 348, height: 'auto' },
    actions: {
      'execute-dc': DamageConditionsPanel._onExecuteDC,
      'set-mode':   DamageConditionsPanel._onSetMode,
      'post-dc':    DamageConditionsPanel._onPostDC,
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

  _typeVisual() {
    const t = this._damageType;
    return {
      icon:  DMG_ICONS[t] ?? 'fa-solid fa-burst',
      color: DMG_COLORS[t] ?? '',
    };
  }

  _buildButtonText() {
    const parts = [];
    if (this._amount > 0) {
      const modeStr = this._damageMode === 'area' ? ' (Area)' : '';
      if (this._damageType !== 'untyped') {
        const { icon, color } = this._typeVisual();
        const label = this._damageType.charAt(0).toUpperCase() + this._damageType.slice(1);
        parts.push(`<i class="${icon}" style="color:${color}"></i> <span style="color:${color}">${this._amount} ${label}</span> Damage${modeStr}`);
      } else {
        parts.push(`${this._amount} Damage${modeStr}`);
      }
    }
    if (this._condition) {
      const condDef = ALL_CONDITIONS.find(c => c.id === this._condition);
      if (condDef) parts.push(`${condDef.label}${durAbbr(this._activeEnd())}`);
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
    if (execBtn) execBtn.innerHTML = this._buildButtonText();
  }

  async _prepareContext(_options) {
    return {
      sourceSrc:       this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg',
      sourceLabel:     this._sourceToken?.name ?? 'No Source',
      sourceSelected:  !!this._sourceToken,
      targetHTML:      this._buildTargetHTML(),
      amount:          this._amount,
      damageTypes:     DAMAGE_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1), selected: t === this._damageType, color: t === 'untyped' ? '#c8c8d0' : (DMG_COLORS[t] ?? '') })),
      typeIcon:        this._typeVisual().icon,
      typeColor:       this._typeVisual().color,
      ignoreImmunity:  this._ignoreImmunity,
      modeStrike:      this._damageMode === 'strike',
      modeArea:        this._damageMode === 'area',
      conditions:      [{ value: '', label: '-- None --', selected: !this._condition }, ...ALL_CONDITIONS.map(c => ({ value: c.id, label: c.label, selected: c.id === this._condition }))],
      durOptions:      DUR_OPTIONS.map(o => ({ value: o.value, label: o.label, selected: o.value === this._activeEnd() })),
      conditionDisabled: !this._condition,
      requiresSource:  !!(ALL_CONDITIONS.find(c => c.id === this._condition)?.requiresSource),
      distanceValue:   this._distance ?? '',
      buttonText:      this._buildButtonText(),
      hasGrabs:        this._hasGrabs(),
      grabsExpanded:   this._grabsExpanded,
      grabListHTML:    buildGrabListHTML(),
    };
  }

  _activeEnd() {
    return this._condition === 'grabbed' ? this._grabbedEnd : this._conditionEnd;
  }

  _hasGrabs() {
    return !!(window._activeGrabs?.size || grabUiState.pendingConfirm);
  }

  _setGrabsExpanded(open) {
    this._grabsExpanded = !!open && this._hasGrabs();
    const section = this.element?.querySelector('#dc-grabs-section');
    if (!section) return;
    section.classList.toggle('expanded', this._grabsExpanded);
    this.element.querySelector('#dc-grab-toggle')?.classList.toggle('active', this._grabsExpanded);
    if (this._grabsExpanded) {
      const list = this.element.querySelector('#dc-grab-list');
      if (list) list.innerHTML = buildGrabListHTML();
    }
    this.setPosition({ width: this._grabsExpanded ? 596 : 348, height: 'auto' });
  }

  _refreshGrabs() {
    if (!this.rendered) return;
    const hasGrabs = this._hasGrabs();
    const fist = this.element.querySelector('#dc-grab-toggle');
    if (fist) { fist.disabled = !hasGrabs; fist.classList.toggle('lit', hasGrabs); }
    if (!hasGrabs && this._grabsExpanded) { this._setGrabsExpanded(false); return; }
    if (this._grabsExpanded) {
      const list = this.element.querySelector('#dc-grab-list');
      if (list) list.innerHTML = buildGrabListHTML();
      this.setPosition({ height: 'auto' });
    }
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
      if (execBtn) execBtn.innerHTML = this._buildButtonText();
    };


    this.element.querySelector('#dc-amount')?.addEventListener('input',  e => { this._amount        = parseInt(e.target.value) || 0; refreshBtn(); });
    this.element.querySelector('#dc-type')?.addEventListener('change', e => {
      this._damageType = e.target.value;
      const { icon, color } = this._typeVisual();
      const iconEl = this.element.querySelector('#dc-type-icon');
      if (iconEl) { iconEl.className = icon; iconEl.style.color = color; }
      e.target.style.color = color;
      refreshBtn();
    });
    this.element.querySelector('#dc-ignore-immunity')?.addEventListener('change', e => { this._ignoreImmunity = e.target.checked; });
    this.element.querySelector('#dc-condition')?.addEventListener('change', e => {
      this._condition = e.target.value;
      const sel = this.element.querySelector('#dc-condition-end');
      if (sel) {
        sel.disabled = !this._condition;
        
        
        sel.value = this._activeEnd();
      }
      this._refreshPanel();
      refreshBtn();
    });
    this.element.querySelector('#dc-condition-end')?.addEventListener('change', e => {
      if (this._condition === 'grabbed') this._grabbedEnd = e.target.value;
      else this._conditionEnd = e.target.value;
      refreshBtn();
    });
    this.element.querySelector('#dc-distance')?.addEventListener('input', e => { this._distance = parseInt(e.target.value) || null; });

    this.element.style.transition = 'width 0.25s ease';

    
    
    const header = this.element.querySelector('.window-header');
    if (header && !header.querySelector('#dc-grab-toggle')) {
      const fist = document.createElement('button');
      fist.type = 'button';
      fist.id = 'dc-grab-toggle';
      fist.className = 'header-control icon fa-solid fa-hand-fist dsct-dc-grab-fist';
      fist.dataset.tooltip = game.i18n.localize('DSCT.panel.dc.activeGrabs');
      fist.addEventListener('click', () => this._setGrabsExpanded(!this._grabsExpanded));
      const kebab = header.querySelector('[data-action="toggleControls"]');
      header.insertBefore(fist, kebab ?? header.querySelector('[data-action="close"]'));
    }
    const fistBtn = this.element.querySelector('#dc-grab-toggle');
    if (fistBtn) {
      const has = this._hasGrabs();
      fistBtn.disabled = !has;
      fistBtn.classList.toggle('lit', has);
      fistBtn.classList.toggle('active', this._grabsExpanded);
    }

    this.element.querySelector('#dc-grab-list')?.addEventListener('click', async e => {
      await handleGrabListClick(e);
      this._refreshGrabs();
    });
    if (this._grabsStartExpanded) {
      this._grabsStartExpanded = false;
      this._setGrabsExpanded(true);
    }
  }

  static async _onExecuteDC() {
    await this._execute();
  }

  static async _onPostDC() {
    await this._postToChat();
  }

  static _onSetMode(_event, target) {
    this._damageMode = target.dataset.mode;
    this.element.querySelectorAll('[data-action="set-mode"]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === this._damageMode);
    });
    const execBtn = this.element.querySelector('[data-action="execute-dc"]');
    if (execBtn) execBtn.innerHTML = this._buildButtonText();
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
    const endStr        = this._activeEnd();

    
    if (sourceToken && this._targetTokens.length) {
      const CGD       = canvas.grid.distance;
      const rangeLimit = this._distance || 10;
      const offending = this._targetTokens
        .map(t => ({ t, squares: Math.round(tokFootprintDist(sourceToken, t) / CGD) + 1 }))
        .filter(o => o.squares > rangeLimit);
      if (offending.length) {
        const worst = offending.reduce((a, b) => (b.squares > a.squares ? b : a));
        const label = this._condition
          ? (ALL_CONDITIONS.find(c => c.id === this._condition)?.label ?? 'this')
          : 'Damage';
        const ok = await confirmRangeOverride(sourceToken, worst.t, worst.squares, label);
        if (!ok) return;
      }
    }

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
          case 'grabbed':    if (sourceToken) await applyGrab(sourceToken, targetToken, { maxGrabs: this._targetTokens.length }); break;
          case 'judged':     if (sourceActor) await applyJudgedEffect(targetToken, sourceActor, sourceTokenId, endStr); break;
          case 'marked':     if (sourceActor) await applyMarkedEffect(targetToken, sourceActor, sourceTokenId, endStr); break;
          default:           await applyNativeCondition(actor, this._condition, endStr); break;
        }
      }
    }

    const count = this._targetTokens.length;
    ui.notifications.info(game.i18n.format('DSCT.notice.dc.appliedToCount', { count, s: count !== 1 ? 's' : '' }));
  }

  async _postToChat() {
    if (this._amount <= 0 && !this._condition) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.dc.nothingToApply'));
      return;
    }

    
    
    const postCondDef = ALL_CONDITIONS.find(c => c.id === this._condition);
    if (postCondDef?.requiresSource && !this._sourceToken) {
      if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.format('DSCT.notice.dc.requiresSource', { condition: postCondDef.label })); return; }
      const picked = await runSourcePicker();
      if (!picked) return;
      this._pinnedSource = picked;
      this._sourceToken  = picked;
      this._refreshPanel();
    }

    const speaker   = this._sourceToken
      ? ChatMessage.getSpeaker({ token: this._sourceToken.document })
      : ChatMessage.getSpeaker();
    const isArea    = this._damageMode === 'area';
    const msgParts  = [];
    let   content   = '';
    let   title     = '';

    if (this._amount > 0) {
      const typeLabel = this._damageType !== 'untyped'
        ? ` ${this._damageType.charAt(0).toUpperCase() + this._damageType.slice(1)}`
        : '';
      title = `${this._amount}${typeLabel} Damage${isArea ? ' (Area)' : ''}`;
      const roll = new ds.rolls.DamageRoll(String(this._amount), {}, { type: this._damageType, isArea });
      await roll.evaluate();
      msgParts.push({ rolls: [roll], flavor: title, type: 'roll' });
    }

    const condDef  = ALL_CONDITIONS.find(c => c.id === this._condition);
    const isDsctCond = !!condDef?.dsct;

    if (this._condition) {
      if (!isDsctCond) {
        const end = this._activeEnd() !== 'unlimited' ? ` ${this._activeEnd()}` : '';
        content   = `[[/apply ${this._condition}${end}]]`;
        msgParts.push({ type: 'content' });
      } else {
        
        
        const srcNote = this._sourceToken ? ` from <strong>${this._sourceToken.name}</strong>` : '';
        content = `<p><strong>${condDef.label}</strong>${durAbbr(this._activeEnd())}${srcNote}</p>`;
        msgParts.push({ type: 'content' });
      }
      if (!title) title = `${condDef?.label ?? this._condition}${durAbbr(this._activeEnd())}`;
    }

    const dsctCondFlag = isDsctCond ? {
      postedDsctCondition: {
        conditionId:     this._condition,
        endStr:          this._activeEnd() !== 'unlimited' ? this._activeEnd() : null,
        endLabel:        durAbbr(this._activeEnd()),
        sourceActorUuid: this._sourceToken?.actor?.uuid ?? null,
        sourceTokenId:   this._sourceToken?.id ?? null,
      },
    } : {};

    await ds.documents.DrawSteelChatMessage.create({
      title,
      content,
      type: 'standard',
      speaker,
      'system.parts': msgParts,
      flags: {
        [M]: {
          ...(isArea ? { postedAreaDamage: { damageType: this._damageType, amount: this._amount } } : {}),
          ...dsctCondFlag,
        },
        core: { canPopout: true },
      },
    });
  }

  async close(options = {}) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const registerDCHooks = () => {};

export const toggleDamageConditionsPanel = (opts = {}) => {
  if (!getSetting('conditionsEnabled')) return;
  const existing = getWindowById('dsct-dc-panel');
  if (existing) {
    if (opts.grabsExpanded) { existing._setGrabsExpanded(true); existing.bringToFront?.(); return; }
    existing.close();
    return;
  }
  const panel = new DamageConditionsPanel();
  panel._grabsStartExpanded = !!opts.grabsExpanded;
  panel.render({ force: true });
};
