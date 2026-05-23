export class VerticalDistancePopup extends ds.applications.api.DSApplication {
  #resolve    = null;
  #maxAbsVal  = 0;
  #defaultVal = 0;
  #onPreview  = null;

  constructor({ defaultVal, maxAbsVal }) {
    super();
    this.#defaultVal = defaultVal;
    this.#maxAbsVal  = maxAbsVal;
  }

  static DEFAULT_OPTIONS = {
    id: 'dsct-vertical-popup',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.VerticalDistance', minimizable: false, resizable: false },
    position: { width: 280, height: 'auto' },
    actions: { 'confirm-vertical': VerticalDistancePopup._onConfirm },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/forced-movement-vertical.hbs' },
  };

  async _prepareContext(options) {
    const ctx      = await super._prepareContext(options);
    ctx.defaultVal = this.#defaultVal;
    ctx.maxAbsVal  = this.#maxAbsVal;
    ctx.minVal     = -this.#maxAbsVal;
    return ctx;
  }

  _onRender(context, options) {
    const slider = this.element.querySelector('#dsct-vert-slider');
    const number = this.element.querySelector('#dsct-vert-number');
    if (!slider || !number) return;
    slider.addEventListener('input', () => {
      number.value = slider.value;
      this.#onPreview?.(parseInt(slider.value) || 0);
    });
    number.addEventListener('input', () => {
      const v = parseInt(number.value);
      if (!isNaN(v)) {
        slider.value = Math.max(-this.#maxAbsVal, Math.min(this.#maxAbsVal, v));
        this.#onPreview?.(v);
      }
    });
    this.#onPreview?.(parseInt(slider.value) || 0);
  }

  static _onConfirm(event, target) {
    const slider = this.element.querySelector('#dsct-vert-slider');
    const val    = parseInt(slider?.value ?? this.#defaultVal) || 0;
    const res    = this.#resolve;
    this.#resolve = null;
    this.close();
    res?.(val);
  }

  async close(options = {}) {
    const res    = this.#resolve;
    this.#resolve = null;
    res?.(null);
    return super.close(options);
  }

  static open(defaultVal, maxAbsVal, onPreview = null) {
    return new Promise(resolve => {
      const app      = new VerticalDistancePopup({ defaultVal, maxAbsVal });
      app.#resolve   = resolve;
      app.#onPreview = onPreview;
      app.render(true);
    });
  }
}
