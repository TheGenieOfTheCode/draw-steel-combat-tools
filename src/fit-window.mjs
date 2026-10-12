const MIN_SCALE = 0.8;
const MAX_SCALE = 1.5;

const storeKey = (app) => `dsct-fit-${app.id}`;
const readScale = (app) => { try { return Number(localStorage.getItem(storeKey(app))) || 1; } catch { return 1; } };
const saveScale = (app, scale) => { try { localStorage.setItem(storeKey(app), String(scale)); } catch {  } };

export const FitsOnResize = (Base) => class extends Base {
  _fitScale = null;

  _fitBaseWidth() {
    return this.options.position?.width;
  }

  _fitApply() {
    const content = this.element?.querySelector('.window-content');
    if (content) content.style.zoom = this._fitScale === 1 ? '' : String(this._fitScale);
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._fitScale = readScale(this);
    this._fitApply();
    const base = this._fitBaseWidth();
    if (base && this._fitScale !== 1) this.setPosition({ width: Math.round(base * this._fitScale) });
  }

  setPosition(position = {}) {
    const base = this._fitBaseWidth();
    if (this.rendered && base && typeof position.width === 'number') {
      const scale = Math.round(Math.clamp(position.width / base, MIN_SCALE, MAX_SCALE) * 100) / 100;
      if (scale !== this._fitScale) {
        this._fitScale = scale;
        this._fitApply();
        saveScale(this, scale);
      }
      position = { ...position, width: Math.round(base * scale), height: 'auto' };
    }
    return super.setPosition(position);
  }
};
