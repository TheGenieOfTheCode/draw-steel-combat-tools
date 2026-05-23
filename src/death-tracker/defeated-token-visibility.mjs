import { getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const DBG = () => getSetting('debugMode');

const _deathGrace = new Set();

let _raisedDeadVisible = false;
const _previewTokenIds = new Set();

export const setRaisedDeadVisible = (v) => { _raisedDeadVisible = v; };
export const addPreviewToken = (id) => { _previewTokenIds.add(id); };
export const removePreviewToken = (id) => { _previewTokenIds.delete(id); };
export const clearPreviewTokens = () => { _previewTokenIds.clear(); };

const isDefeatedAndHiding = (tokenDoc) =>
  (game.user.getFlag(M, 'hideDefeated') ?? false) === true &&
  (tokenDoc?.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead') ?? false);

export const activateTokenLayer = () => {
  
  if (canvas.tokens._activate) canvas.tokens._activate();
  else canvas.tokens.activate();
};

export const registerDefeatedTokenVisibility = () => {
  const usingLibWrapper = !!game.modules.get('lib-wrapper')?.active;
  if (DBG()) console.log(`DSCT | DTV | init -- libWrapper: ${usingLibWrapper}`);

  if (usingLibWrapper) {
    libWrapper.register(M, 'CONFIG.Token.objectClass.prototype.isVisible',
      function (wrapped, ...args) {
        const id = this.document?.id;
        if (!_raisedDeadVisible && !_previewTokenIds.has(id)) {
          if (isDefeatedAndHiding(this.document) && !_deathGrace.has(id)) return false;
        }
        return wrapped(...args);
      }, 'MIXED');

    const tokenProtoPath = foundry?.canvas?.placeables?.Token
      ? 'foundry.canvas.placeables.Token.prototype'
      : 'Token.prototype';

    libWrapper.register(M, `${tokenProtoPath}._canControl`,
      function (wrapped, ...args) {
        if (isDefeatedAndHiding(this.document)) return false;
        return wrapped(...args);
      }, 'MIXED');

    libWrapper.register(M, `${tokenProtoPath}._canHover`,
      function (wrapped, ...args) {
        if (isDefeatedAndHiding(this.document)) return false;
        return wrapped(...args);
      }, 'MIXED');

    libWrapper.register(M, `${tokenProtoPath}._canDrag`,
      function (wrapped, ...args) {
        if (isDefeatedAndHiding(this.document)) return false;
        return wrapped(...args);
      }, 'MIXED');
  } else {
    const TokenCls = foundry?.canvas?.placeables?.Token ?? Token;

    const _isVisibleDesc = Object.getOwnPropertyDescriptor(CONFIG.Token.objectClass.prototype, 'isVisible');
    if (_isVisibleDesc?.get) {
      const _isVisibleOld = _isVisibleDesc.get;
      Object.defineProperty(CONFIG.Token.objectClass.prototype, 'isVisible', {
        get() {
          const id = this.document?.id;
          if (!_raisedDeadVisible && !_previewTokenIds.has(id)) {
            if (isDefeatedAndHiding(this.document) && !_deathGrace.has(id)) return false;
          }
          return _isVisibleOld.call(this);
        },
        configurable: true,
      });
    }

    const _canControlOld = TokenCls.prototype._canControl;
    TokenCls.prototype._canControl = function (...args) {
      if (isDefeatedAndHiding(this.document)) return false;
      return _canControlOld.call(this, ...args);
    };

    const _canHoverOld = TokenCls.prototype._canHover;
    TokenCls.prototype._canHover = function (...args) {
      if (isDefeatedAndHiding(this.document)) return false;
      return _canHoverOld.call(this, ...args);
    };

    const _canDragOld = TokenCls.prototype._canDrag;
    TokenCls.prototype._canDrag = function (...args) {
      if (isDefeatedAndHiding(this.document)) return false;
      return _canDragOld.call(this, ...args);
    };
  }

  Hooks.on('createActiveEffect', (effect) => {
    const statuses = [...(effect.statuses ?? [])];
    if (!statuses.includes('dead')) return;

    const actor = effect.parent;
    if (!actor) return;
    const token = actor.isToken ? actor.token?.object : canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
    if (!token) return;

    token.setTarget(false, { releaseOthers: false });
    if ((game.user.getFlag(M, 'hideDefeated') ?? false) === true) token.release();

    const graceDuration = getSetting('deathAnimationDuration') + 500;
    if (DBG()) console.log(`DSCT | DTV | death grace start token=${token.document?.name} duration=${graceDuration}ms`);
    _deathGrace.add(token.document.id);
    setTimeout(() => {
      _deathGrace.delete(token.document.id);
      if (DBG()) console.log(`DSCT | DTV | death grace expired token=${token.document?.name}`);
      activateTokenLayer();
    }, graceDuration);
  });

  Hooks.on('getSceneControlButtons', (controls) => {
    const tokenControl = controls.tokens ?? controls.token;
    if (!tokenControl) return;
    if (!game.settings.get(M, 'deathTrackerEnabled')) return;

    const tool = {
      name: 'dsct-hide-defeated',
      title: game.i18n.localize('DSCT.button.hideDefeated'),
      icon: 'fas fa-eye-slash',
      toggle: true,
      active: (game.user.getFlag(M, 'hideDefeated') ?? false) === true,
      visible: true,
      onChange: () => toggleHideDefeated(),
    };

    if (Array.isArray(tokenControl.tools)) {
      tokenControl.tools.push(tool);
    } else {
      tool.order = Object.keys(tokenControl.tools).length;
      tokenControl.tools['dsct-hide-defeated'] = tool;
    }
  });
};

const refreshDefeatedVisibility = () => {
  const hiding = (game.user.getFlag(M, 'hideDefeated') ?? false) === true;
  const defeatedStatusId = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  if (DBG()) console.log(`DSCT | DTV | refresh -- hiding=${hiding} tokens=${canvas.tokens.placeables.length}`);

  if (hiding) {
    for (const t of canvas.tokens.placeables) {
      if (!t.actor?.statuses?.has(defeatedStatusId)) continue;
      t.release();
      t.setTarget(false, { releaseOthers: false });
    }
  }

  activateTokenLayer();
};

export const toggleHideDefeated = async () => {
  const current = (game.user.getFlag(M, 'hideDefeated') ?? false) === true;
  const next = !current;
  if (DBG()) console.log(`DSCT | DTV | toggle ${current} -> ${next}`);
  await game.user.setFlag(M, 'hideDefeated', next);
  refreshDefeatedVisibility();
};
