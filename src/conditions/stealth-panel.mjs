import { getWindowById } from '../helpers.mjs';
import { hide, reveal, setHiddenFrom, hiddenFrom, proposeHide } from './stealth.mjs';
import { toggleStealthVision, stealthVisionActive, endStealthVision, markPanelExempt } from './stealth-vision.mjs';

const nameOf = (id) => canvas.tokens.get(id)?.name ?? id;

export class StealthPanel extends ds.applications.api.DSApplication {
  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/stealth.hbs' },
  };

  static DEFAULT_OPTIONS = {
    id: 'dsct-stealth-panel',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.stealth', minimizable: true, resizable: true },
    position: { width: 360, height: 'auto' },
    actions: {
      hide: StealthPanel._onHide,
      hideTargeted: StealthPanel._onHideTargeted,
      reveal: StealthPanel._onReveal,
      vision: StealthPanel._onVision,
    },
  };

  _token() { return canvas.tokens.controlled[0] ?? null; }

  static async _onHide() {
    const token = this._token();
    if (token) await hide(token);
    this.render();
  }

  static async _onHideTargeted() {
    const token = this._token();
    if (!token) return;
    const ids = [...game.user.targets].map(t => t.id).filter(id => id !== token.id);
    if (!ids.length) return ui.notifications.warn(game.i18n.localize('DSCT.notice.stealth.noTargets'));
    await setHiddenFrom(token, ids);
    this.render();
  }

  static async _onReveal() {
    const token = this._token();
    if (token) await reveal(token);
    this.render();
  }

  static _onVision() {
    const token = this._token();
    if (token) toggleStealthVision(token);
    this.render();
  }

  async _prepareContext(_options) {
    const token = this._token();
    if (!token) return { ctx: { token: null } };

    return {
      ctx: {
        token: true,
        name: token.name,
        img: token.document.texture?.src ?? token.actor?.img ?? '',
        hiddenFrom: [...hiddenFrom(token)].map(nameOf),
        couldHideFrom: proposeHide(token).map(nameOf),
        hasTargets: game.user.targets.size > 0,
        visionOn: stealthVisionActive(),
      },
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    markPanelExempt(stealthVisionActive());
  }

  async close(options) {
    endStealthVision();
    return super.close(options);
  }
}

export function toggleStealthPanel() {
  const existing = getWindowById('dsct-stealth-panel');
  if (existing) return existing.close();
  new StealthPanel().render(true);
}

export function registerStealthPanel() {
  const refresh = () => getWindowById('dsct-stealth-panel')?.render();
  for (const hook of ['controlToken', 'targetToken', 'updateToken', 'createActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, refresh);
  }
}
