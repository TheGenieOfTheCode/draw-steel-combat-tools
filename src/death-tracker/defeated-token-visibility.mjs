import { getSetting } from '../helpers.mjs';
import { resolveTokenVisibility } from '../conditions/combat-reveal.mjs';
import { isDeathDeferred } from './defer-death.mjs';

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
  (tokenDoc?.actor?.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? 'dead') ?? false) &&
  !isDeathDeferred(tokenDoc?.actor);

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
        return resolveTokenVisibility(this, wrapped(...args));
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
          return resolveTokenVisibility(this, _isVisibleOld.call(this));
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
      if (!t.actor?.statuses?.has(defeatedStatusId) || isDeathDeferred(t.actor)) continue;
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


const PING_REVEAL_MS = 4000;
const _pingTimers = new Map();

export const pingDeadToken = async (tokenId) => {
  const token = canvas?.tokens?.get(tokenId);
  if (!token) return false;

  addPreviewToken(tokenId);
  activateTokenLayer();
  clearTimeout(_pingTimers.get(tokenId));
  _pingTimers.set(tokenId, setTimeout(() => {
    _pingTimers.delete(tokenId);
    removePreviewToken(tokenId);
    activateTokenLayer();
  }, PING_REVEAL_MS));

  
  canvas.ping({ x: token.center?.x ?? token.x, y: token.center?.y ?? token.y });
  return true;
};


const REVIVE_HL = 'dsct-hover-preview-hl';


let _activePreview = null;

export const clearRevivalPreview = () => {
  const active = _activePreview;
  _activePreview = null;
  active?.hide();
};

export const clearRevivalPreviewIfOrphaned = () => {
  if (_activePreview && !_activePreview.el.isConnected) clearRevivalPreview();
};


let _watchingForOrphans = false;
const _watchForOrphans = () => {
  if (_watchingForOrphans) return;
  _watchingForOrphans = true;
  document.addEventListener('pointermove', () => {
    if (_activePreview && !_activePreview.el.isConnected) clearRevivalPreview();
  }, { capture: true, passive: true });
};

export const installRevivalHoverPreview = (el, getTokenIds) => {
  let shown = [];
  _watchForOrphans();

  const hide = () => {
    for (const id of shown) removePreviewToken(id);
    shown = [];
    activateTokenLayer();
    if (canvas.interface?.grid?.highlightLayers?.[REVIVE_HL]) canvas.interface.grid.clearHighlightLayer(REVIVE_HL);
  };

  el.addEventListener('mouseenter', () => {

    clearRevivalPreview();
    shown = (getTokenIds() ?? []).filter(id => canvas?.tokens?.get(id));
    if (!shown.length) return;

    _activePreview = { el, hide };
    for (const id of shown) addPreviewToken(id);
    activateTokenLayer();

    const grid = canvas.interface.grid;
    if (!grid.highlightLayers?.[REVIVE_HL]) grid.addHighlightLayer(REVIVE_HL);
    grid.clearHighlightLayer(REVIVE_HL);

    for (const id of shown) {
      const t = canvas.tokens.get(id);
      if (!t) continue;
      const w = Math.max(1, Math.round(t.document.width));
      const h = Math.max(1, Math.round(t.document.height));
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          grid.highlightPosition(REVIVE_HL, {
            x: Math.floor(t.x / canvas.grid.size) * canvas.grid.size + (dx * canvas.grid.size),
            y: Math.floor(t.y / canvas.grid.size) * canvas.grid.size + (dy * canvas.grid.size),
            color: 0x00FF00, border: 0x00AA00,
          });
        }
      }
    }
  });

  el.addEventListener('mouseleave', () => {
    if (_activePreview?.el === el) _activePreview = null;
    hide();
  });
};
