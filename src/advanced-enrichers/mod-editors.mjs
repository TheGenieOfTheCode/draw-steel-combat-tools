import { DsctDamageEditor } from '../compat/dstd-damage-pills.mjs';
import { EffectModDialog } from '../compat/dstd-potency.mjs';
import { DSCTAddModifierDialog } from '../ability-automation/roll-dialog-hooks.mjs';
import { FmModifyPanel } from '../forced-movement/forced-movement-modify-panel.mjs';
import { tipAttrs, tipFor } from '../chat-tips.mjs';

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

export class TargetTabsDamageEditor extends DsctDamageEditor {
  constructor(config, done, options) {
    super({ ...config, base: config.tabs[0].base, pills: config.tabs[0].pills }, done, options);
    this._tabs = config.tabs.map((t) => ({ ...t, pills: (t.pills ?? []).map((p) => foundry.utils.deepClone(p)) }));
    this._tab = Math.max(0, config.start ?? 0);
    this._pills = this._tabs[this._tab].pills;
    this._cfg = { ...this._cfg, base: this._tabs[this._tab].base };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element.querySelector('.dsct-re');
    if (!root || root.querySelector('.dsct-adv-tabs')) return;
    const bar = document.createElement('nav');
    bar.className = 'dsct-adv-tabs';
    this._tabs.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-adv-tab';
      btn.dataset.tab = String(i);
      btn.innerHTML = `<img src="${esc(t.img)}" alt=""><span>${esc(t.name)}</span>`;
      btn.addEventListener('click', () => this._switch(i));
      const token = () => fromUuidSync(t.uuid)?.object;
      btn.addEventListener('pointerenter', (event) => token()?._onHoverIn?.(event, { hoverOutOthers: true }));
      btn.addEventListener('pointerleave', () => token()?._onHoverOut?.({}));
      bar.append(btn);
    });
    root.prepend(bar);
    this._markTab();
  }

  _switch(i) {
    this._tabs[this._tab].pills = this._pills;
    this._tab = i;
    this._pills = this._tabs[i].pills;
    this._cfg = { ...this._cfg, base: this._tabs[i].base };
    const baseEl = this.element.querySelector('.dsct-de-base');
    if (baseEl) baseEl.textContent = String(this._tabs[i].base);
    this._markTab();
    this._refresh();
  }

  _markTab() {
    this.element.querySelectorAll('.dsct-adv-tab').forEach((b) => b.classList.toggle('active', Number(b.dataset.tab) === this._tab));
  }

  _apply() {
    this._tabs[this._tab].pills = this._pills;
    this._done?.(this._tabs.map((t) => ({ uuid: t.uuid, pills: t.pills })));
    this._done = null;
    this.close();
  }
}

export class TargetTabsModEditor extends TargetTabsDamageEditor {
  constructor(config, done, options) {
    super(config, done, options);
    this._adapter = config.adapter;
  }

  get currentTab() { return this._tabs[this._tab]; }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this._addHooked) return;
    this._addHooked = true;
    this.element.addEventListener('click', (event) => {
      if (!event.target.closest('.dsct-add-mod-btn')) return;
      event.stopPropagation();
      this._adapter.openAdd(this, this.currentTab);
    }, { capture: true });
  }

  addPill(pill) {
    this._pills.push(pill);
    this._refresh();
  }

  _refresh() {
    const el = this.element;
    if (!el) return;
    const { base, final } = this._adapter.preview(this.currentTab, this._pills);
    const baseEl = el.querySelector('.dsct-de-base');
    const finalEl = el.querySelector('.dsct-de-final');
    if (baseEl) baseEl.textContent = String(base);
    if (finalEl) finalEl.textContent = String(final);
    el.querySelector('.dsct-de-total')?.classList.toggle('dsct-adv-wordy', `${base}${final}`.length > 16);
    const row = el.querySelector('.dsct-re-pills');
    if (row) {
      const items = this._pills.map((p, idx) => {
        const off = p.enabled === false;
        const text = this._adapter.pillText(p);
        const from = p.src ? `<span class="dsct-pill-from">from ${esc(p.src)}</span>` : '';
        const tip = tipAttrs({ title: text, category: game.i18n.localize('DSCT.tip.advAddModifier.category'),
          body: `${game.i18n.localize(off ? 'DSCT.tip.pillOff' : 'DSCT.tip.pillOn')} ${game.i18n.localize('DSCT.advEnricher.mods.rightClick')}` });
        return `<button type="button" class="dsct-source-pill dsct-de-pill dsct-pill-${this._adapter.pillCss(p)}${off ? ' dsct-pill-disabled' : ''}" data-pill-idx="${idx}" ${tip}>`
          + `<span class="dsct-pip">${esc(text)}${p.reason ? ` &middot; ${esc(p.reason)}` : ''}</span>${from}</button>`;
      });
      row.innerHTML = `${items.join('')}<button type="button" class="dsct-add-mod-btn dsct-add-pill-mini" ${tipAttrs(tipFor('advAddModifier'))}>+</button>`;
    }
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }
}

const sourceOf = (dialog) => {
  const src = dialog._sourceInput?.value?.trim() || null;
  return { src, srcTokenId: src ? (canvas.tokens?.placeables.find((t) => t.name === src)?.id ?? null) : null };
};

export class KindPillDialog extends DSCTAddModifierDialog {
  constructor({ title, buttons, valued = [], selects = [], pillText, pillCss, onPill }) {
    super({ rendered: true, options: { context: { targets: {} } }, _dsctSources: [], _dsctOrigTargets: {} }, 'global', { window: { title } });
    Object.assign(this, { _buttons: buttons, _valued: new Set(valued), _selects: selects, _text: pillText, _css: pillCss, _onPill: onPill });
    this._kind = buttons[0].kind;
    this._negate = buttons[0].amount < 0;
  }

  _onRender(context, options) {
    const root = this.element.querySelector('.dsct-amw') ?? this.element;
    const grid = root.querySelector('.dsct-amw-type-grid');
    if (grid && !grid.dataset.dsctAdv) {
      grid.dataset.dsctAdv = '1';
      grid.innerHTML = this._buttons.map((b, i) => `<button type="button" class="dsct-amw-type-btn ${b.css}${i === 0 ? ' active' : ''}" data-kind="${b.kind}" data-amount="${b.amount}">${esc(b.label)}</button>`).join('');
      const html = this._selects.map((s) => `<div class="form-group dsct-adv-sel" data-sel-kind="${s.kind}" style="display:none"><label>${esc(s.label)}</label>`
        + `<div class="form-fields"><select data-field="${s.field}">${s.choices.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('')}</select></div></div>`).join('');
      root.querySelector('.dsct-amw-value-group')?.insertAdjacentHTML('afterend', html);
      root.querySelector('.dsct-amw-scope-select')?.closest('.form-group')?.remove();
      for (const sel of root.querySelectorAll('.dsct-adv-sel select')) sel.addEventListener('change', () => this._updatePreview());
    }
    super._onRender(context, options);
  }

  _activeAmount() {
    return Number(this._typeButtons?.find((b) => b.classList.contains('active'))?.dataset.amount ?? this._buttons[0].amount) || 0;
  }

  _syncValueField() {
    if (this._valueGroup) this._valueGroup.style.display = this._valued.has(this._kind) ? '' : 'none';
    for (const g of this.element?.querySelectorAll('.dsct-adv-sel') ?? []) g.style.display = g.dataset.selKind === this._kind ? '' : 'none';
  }

  _readValueAmount() {
    const amount = this._activeAmount();
    if (!this._valued.has(this._kind)) return amount;
    return Math.max(1, Math.abs(parseInt(this._valueInput?.value) || 1)) * (amount < 0 ? -1 : 1);
  }

  _pill() {
    const pill = { kind: this._kind, amount: this._readValueAmount() };
    for (const s of this._selects) {
      if (s.kind === this._kind) pill[s.field] = this.element?.querySelector(`.dsct-adv-sel[data-sel-kind="${s.kind}"] select`)?.value ?? s.choices[0]?.value;
    }
    return pill;
  }

  _updatePreview() {
    const prev = this._previewPill;
    if (!prev) return;
    const pill = this._pill();
    const reason = this._reasonInput?.value?.trim() || '';
    const { src } = sourceOf(this);
    prev.className = `dsct-source-pill dsct-pill-${this._css(pill)} dsct-pill-custom`;
    prev.innerHTML = `<span class="dsct-pip">${esc(this._text(pill))}${reason ? ` &middot; ${esc(reason)}` : ''}</span>`
      + (src ? `<span class="dsct-pill-from">from ${esc(src)}</span>` : '');
  }

  _submit() {
    this._onPill({ ...this._pill(), reason: this._reasonInput?.value?.trim() || null, ...sourceOf(this), custom: true });
    this.close();
  }
}

export class EnricherEffectModDialog extends EffectModDialog {
  constructor({ name, hasPotency, hasRecurring, onPill }) {
    super({ messageId: null, targetKey: null, effectId: null, name, hasPotency, hasRecurring });
    this._onPill = onPill;
  }

  _submit() {
    this._onPill({ ...this._pill(), effectId: null, reason: this._reasonInput?.value?.trim() || null, ...sourceOf(this), custom: true });
    this.close();
  }
}

export class EnricherFmPanel extends FmModifyPanel {
  constructor({ base, current, stack, name, makeLabel, onDone }) {
    super([{ ...(current ?? base) }], [base], stack, [{ name }], [document.createElement('span')], makeLabel, null, null, () => {});
    this._onDone = onDone;
  }

  async close(options) {
    const done = this._onDone;
    this._onDone = null;
    done?.();
    return super.close(options);
  }
}
