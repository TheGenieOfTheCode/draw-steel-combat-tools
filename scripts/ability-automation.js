import { registerInjector, getSetting, getModuleApi, getItemDsid } from './helpers.js';
import { getAnimals } from './im-no-threat-settings.js';

// ── I'm No Threat panel ───────────────────────────────────────────────────────

const _INT_SCALE = 1.3;
const _s = (n) => Math.round(n * _INT_SCALE);

const _INT_EFFECT_ABILITY = {
  name: "I'm No Threat",
  img: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
  type: 'abilityModifier',
  system: { end: { type: 'turn', roll: '1d10 + @combat.save.bonus' }, filters: { keywords: ['strike'] } },
  changes: [{ key: 'power.roll.edges', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: {},
};

const _INT_EFFECT_PASSIVE = {
  name: "I'm No Threat (Disengage)",
  img: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
  type: 'base',
  system: { end: { type: '', roll: '1d10 + @combat.save.bonus' }, filters: { keywords: [] } },
  changes: [{ key: 'system.movement.disengage', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: {},
};

const INT_ORIGIN       = 'dsct-im-no-threat';
const INT_OOC_FLAG     = 'imNoThreatOOCVictories';
const INT_DEFAULT_ICON = 'icons/creatures/mammals/humanoid-fox-cat-archer.webp';

// Tracks actors currently being reverted by the panel or settings hook, to prevent the
// deleteActiveEffect hook from double-deleting effects that are already being cleaned up.
const _intRevertingActors = new Set();

const _intIsDark  = () => document.body.classList.contains('theme-dark');
const _intPalette = () => _intIsDark() ? {
  bg: '#0e0c14', bgInner: '#0a0810', bgBtn: '#1a1628',
  border: '#2a2040', borderPanel: '#1e1a24', borderOuter: '#4a3870',
  text: '#8a88a0', textDim: '#3a3050', textLabel: '#4a3870',
  textActive: '#c0a8e8', textMimic: '#9a7a5a', textMimicDim: '#3a3050',
  accent: '#7a50c0', mimicLabel: '#6a5080', animalLabel: '#6a5a8a', closeFg: '#6a5a8a',
} : {
  bg: '#f0eef8', bgInner: '#e4e0f0', bgBtn: '#dbd8ec',
  border: '#b0a8cc', borderPanel: '#c8c0e0', borderOuter: '#7060a8',
  text: '#3a3060', textDim: '#8880aa', textLabel: '#5040a0',
  textActive: '#4030a0', textMimic: '#7a5a30', textMimicDim: '#9088b0',
  accent: '#7a50c0', mimicLabel: '#5a4070', animalLabel: '#6a5a8a', closeFg: '#7060a8',
};

const _intSizeRank = (size) => size.value >= 2 ? size.value + 2 : ({ T: 0, S: 1, M: 2, L: 3 })[size.letter] ?? 2;
const _intFmtSize  = (size) => size.value >= 2 ? `${size.value}` : `${size.value}${size.letter}`;

const _intGetAppearance = (doc) => ({
  width: doc.width, height: doc.height, rotation: doc.rotation ?? 0,
  'texture.src':            doc.texture.src,
  'texture.anchorX':        doc.texture.anchorX        ?? 0.5,
  'texture.anchorY':        doc.texture.anchorY        ?? 0.5,
  'texture.scaleX':         doc.texture.scaleX         ?? 1,
  'texture.scaleY':         doc.texture.scaleY         ?? 1,
  'texture.rotation':       doc.texture.rotation       ?? 0,
  'texture.tint':           doc.texture.tint           ?? '#ffffff',
  'texture.alphaThreshold': doc.texture.alphaThreshold ?? 0.75,
  'ring.enabled':           doc.ring?.enabled          ?? false,
  'ring.colors.ring':       doc.ring?.colors?.ring     ?? '#ffffff',
  'ring.colors.background': doc.ring?.colors?.background ?? '#ffffff',
  'ring.effects':           doc.ring?.effects          ?? 0,
  'ring.subject.scale':     doc.ring?.subject?.scale   ?? 1,
  'ring.subject.texture':   doc.ring?.subject?.texture ?? '',
});

// Maps actorId -> msgId for actors with a free Mimic pending (from spending Insight on I'm No Threat)
const _intFreeMimics  = new Map();
// message IDs already processed for free-mimic granting, so re-renders don't re-add
const _intGrantedMsgs = new Set();

class ImNoThreatPanel extends Application {
  constructor(actor) {
    super();
    this._actor          = actor;
    this._illusionActive = !!actor.effects.find(e => e.origin === INT_ORIGIN);
    this._disguiseName   = null;
    this._activeId       = null;
    this._html           = null;
    this._updateMimicPreview();
    this._initVictoryHook();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'im-no-threat-panel', title: "I'm No Threat", template: null,
      width: _s(228), height: 'auto', resizable: false, minimizable: false,
    });
  }

  _getToken() { return canvas.tokens.placeables.find(t => t.document.actorId === this._actor.id || t.actor?.id === this._actor.id); }

  _guardSingleToken() {
    const token = this._getToken();
    if (!token) { ui.notifications.error('Token not found on scene.'); return null; }
    if (canvas.tokens.placeables.filter(t => t.actor?.id === this._actor.id).length > 1) {
      ui.notifications.error(`Multiple tokens for ${this._actor.name} found - remove duplicates first.`); return null;
    }
    return token;
  }

  _updateMimicPreview() {
    const target    = game.users.contents.flatMap(u => [...u.targets]).find(t => t.actor?.id !== this._actor.id);
    this._mimicSrc  = target?.document.texture.src ?? null;
    this._mimicName = target?.name ?? null;
  }

  _refreshText() {
    if (!this._html) return;
    const illusion = this._illusionActive;
    const token    = this._getToken();
    const isHero   = this._actor.type === 'hero';
    const insight  = isHero ? (this._actor.system.hero.primary.value ?? 0) : (game.actors.malice?.value ?? 0);
    const el       = (id) => this._html.find(id)[0];
    const p        = _intPalette();

    const statusEl = el('#int-status-label');
    if (statusEl) { statusEl.textContent = illusion ? (this._disguiseName ?? '') : 'No illusion active'; statusEl.style.color = illusion ? p.textActive : p.textDim; }

    const hintEl = el('#int-revert-hint');
    if (hintEl) hintEl.style.display = illusion ? 'block' : 'none';

    const previewImg = el('#int-preview-img');
    if (previewImg) {
      previewImg.src               = token?.document.texture.src ?? this._actor.prototypeToken.texture.src;
      previewImg.style.borderColor = illusion ? p.accent : p.border;
      previewImg.style.cursor      = illusion ? 'pointer' : 'default';
      previewImg.dataset.action    = illusion ? 'revert' : '';
    }

    const mimicNameEl = el('#int-mimic-name');
    if (mimicNameEl) { mimicNameEl.textContent = this._mimicName ?? 'No Target'; mimicNameEl.style.color = this._mimicName ? p.textMimic : p.textMimicDim; }

    const mimicImgEl = el('#int-mimic-img');
    if (mimicImgEl) mimicImgEl.src = this._mimicSrc ?? INT_DEFAULT_ICON;

    const insightEl = el('#int-insight-count');
    if (insightEl) insightEl.textContent = `(${insight})`;

    const isFree   = _intFreeMimics.has(this._actor.id);
    const costEl   = el('#int-mimic-cost');
    const freeEl   = el('#int-mimic-free');
    if (costEl) costEl.style.display = isFree ? 'none' : '';
    if (freeEl) freeEl.style.display = isFree ? '' : 'none';

    const wrap = el('#int-drag-handle');
    if (wrap) wrap.style.background = p.bg;

    const preview = el('#int-preview-wrap');
    if (preview) { preview.style.background = p.bgInner; preview.style.borderColor = p.borderPanel; }
  }

  _initVictoryHook() {
    if (!window._imNoThreatVictoryHook) {
      window._imNoThreatVictoryHook = Hooks.on('updateActor', async (actor, changes) => {
        if (actor.id !== this._actor.id) return;
        if (changes.system?.hero?.victories === undefined) return;
        const usedAt = actor.getFlag('world', INT_OOC_FLAG);
        if (usedAt === undefined || usedAt === null) return;
        await actor.unsetFlag('world', INT_OOC_FLAG);
        ui.notifications.info(`${actor.name} can use I'm No Threat outside of combat again.`);
      });
    }
  }

  async _renderInner() {
    const styleId = 'im-no-threat-style';
    const styleEl = document.getElementById(styleId) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    const p = _intPalette();
    styleEl.textContent = `
      #im-no-threat-panel .window-content { padding:0; background:${p.bg}; }
      #im-no-threat-panel { border:1px solid ${p.borderOuter}; border-radius:3px; box-shadow:0 0 12px rgba(0,0,0,0.4); }
      #im-no-threat-panel .window-header { display:none !important; }
      #im-no-threat-panel .window-content { border-radius:3px; }
      #im-no-threat-panel [data-action]:hover { filter: brightness(1.1); }
    `;

    const token      = this._getToken();
    const currentSrc = token?.document.texture.src ?? this._actor.prototypeToken.texture.src;
    const illusion   = this._illusionActive;
    const isHero     = this._actor.type === 'hero';
    const insight    = isHero ? (this._actor.system.hero.primary.value ?? 0) : (game.actors.malice?.value ?? 0);
    const priLabel   = isHero ? (this._actor.system.hero.primary.label ?? 'Insight') : 'Malice';
    const mimicSrc   = this._mimicSrc ?? INT_DEFAULT_ICON;

    const animalBtns = getAnimals().map(a => `
      <div data-action="apply-animal" data-animal-id="${a.id}"
        style="display:flex;flex-direction:column;align-items:center;gap:${_s(2)}px;cursor:pointer;
        padding:${_s(3)}px;border-radius:${_s(3)}px;border:1px solid ${p.border};background:transparent;">
        <img src="${a.src}" style="width:${_s(40)}px;height:${_s(40)}px;border-radius:${_s(2)}px;pointer-events:none;object-fit:contain;">
        <div style="font-size:${_s(7)}px;color:${p.animalLabel};pointer-events:none;text-align:center;">${a.name}</div>
      </div>`).join('');

    return $(`
      <div style="padding:${_s(8)}px;background:${p.bg};font-family:Georgia,serif;border-radius:${_s(3)}px;cursor:move;" id="int-drag-handle">

        <div style="display:flex;align-items:center;gap:${_s(6)}px;margin-bottom:${_s(6)}px;">
          <button data-action="close-window"
            style="width:${_s(16)}px;height:${_s(16)}px;flex-shrink:0;cursor:pointer;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.closeFg};border-radius:2px;
            display:flex;align-items:center;justify-content:center;font-size:${_s(9)}px;padding:0;"
            onmouseover="this.style.color='${p.textActive}'" onmouseout="this.style.color='${p.closeFg}'">x</button>
          <div style="font-size:${_s(8)}px;text-transform:uppercase;letter-spacing:0.8px;color:${p.textLabel};">I'm No Threat</div>
        </div>

        <div id="int-preview-wrap" style="display:flex;align-items:center;gap:${_s(8)}px;padding:${_s(6)}px;margin-bottom:${_s(6)}px;
          border:1px solid ${p.borderPanel};border-radius:${_s(3)}px;background:${p.bgInner};">
          <img id="int-preview-img" src="${currentSrc}" data-action="${illusion ? 'revert' : ''}"
            style="width:${_s(52)}px;height:${_s(52)}px;border-radius:${_s(3)}px;object-fit:contain;flex-shrink:0;
            border:2px solid ${illusion ? p.accent : p.border};
            cursor:${illusion ? 'pointer' : 'default'};background:${p.bgBtn};">
          <div style="flex:1;min-width:0;">
            <div style="font-size:${_s(8)}px;text-transform:uppercase;letter-spacing:0.5px;color:${p.textDim};">Appearance</div>
            <div id="int-status-label"
              style="font-size:${_s(10)}px;color:${illusion ? p.textActive : p.textDim};margin-top:${_s(2)}px;word-break:break-word;">
              ${illusion ? (this._disguiseName ?? '') : 'No illusion active'}
            </div>
            <div id="int-revert-hint"
              style="font-size:${_s(8)}px;color:${p.textDim};margin-top:${_s(2)}px;display:${illusion ? 'block' : 'none'};">
              Click image to revert
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:${_s(3)}px;margin-bottom:${_s(6)}px;">
          ${animalBtns}
        </div>

        <div style="display:flex;gap:${_s(3)}px;">
          <button data-action="apply-random"
            style="flex:1;padding:${_s(5)}px ${_s(3)}px;border-radius:${_s(3)}px;cursor:pointer;font-size:${_s(9)}px;
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.text};">🎲 Random</button>

          <div data-action="apply-mimic"
            style="flex:1.4;display:flex;align-items:center;gap:${_s(5)}px;cursor:pointer;
            padding:${_s(4)}px ${_s(6)}px;border-radius:${_s(3)}px;border:1px solid ${p.border};background:${p.bgBtn};">
            <img id="int-mimic-img" src="${mimicSrc}"
              style="width:${_s(32)}px;height:${_s(32)}px;border-radius:${_s(2)}px;flex-shrink:0;object-fit:contain;pointer-events:none;">
            <div style="pointer-events:none;min-width:0;">
              <div style="font-size:${_s(8)}px;color:${p.mimicLabel};">🎭 Mimic</div>
              <div id="int-mimic-name"
                style="font-size:${_s(8)}px;color:${this._mimicName ? p.textMimic : p.textMimicDim};word-break:break-word;">
                ${this._mimicName ?? 'No Target'}
              </div>
              <div id="int-mimic-cost" style="font-size:${_s(7)}px;color:${p.textDim};display:${_intFreeMimics.has(this._actor.id) ? 'none' : ''};">
                1 ${priLabel} <span id="int-insight-count">(${insight})</span>
              </div>
              <div id="int-mimic-free" style="font-size:${_s(7)}px;color:${p.accent};display:${_intFreeMimics.has(this._actor.id) ? '' : 'none'};">
                ✦ Free (spent Insight)
              </div>
            </div>
          </div>
        </div>

      </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._html = html;

    const appEl = html[0].closest('.app');
    if (appEl) {
      const saved = window._imNoThreatPanelPos;
      appEl.style.left = saved ? `${saved.left}px` : '10px';
      appEl.style.top  = saved ? `${saved.top}px`  : `${Math.round(window.innerHeight / 2 - 150)}px`;

      html[0].addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || e.target.closest('[data-action]')) return;
        e.preventDefault();
        const startX = e.clientX - appEl.offsetLeft;
        const startY = e.clientY - appEl.offsetTop;
        const onMove = (ev) => { appEl.style.left = `${ev.clientX - startX}px`; appEl.style.top = `${ev.clientY - startY}px`; };
        const onUp   = () => {
          window._imNoThreatPanelPos = { left: parseInt(appEl.style.left), top: parseInt(appEl.style.top) };
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    if (this._hookActor)  Hooks.off('updateActor',        this._hookActor);
    if (this._hookTarget) Hooks.off('targetToken',        this._hookTarget);
    if (this._hookEffect) Hooks.off('deleteActiveEffect', this._hookEffect);

    this._hookActor  = Hooks.on('updateActor',        (actor)  => { if (actor.id === this._actor.id) this._refreshText(); });
    this._hookTarget = Hooks.on('targetToken',        ()       => { this._updateMimicPreview(); this._refreshText(); });
    this._hookEffect = Hooks.on('deleteActiveEffect', (effect) => {
      if (effect.origin !== INT_ORIGIN || effect.parent?.id !== this._actor.id) return;
      const remaining = this._actor.effects.filter(e => e.origin === INT_ORIGIN && e.id !== effect.id);
      if (!remaining.length) { this._clearIllusionState(); this._refreshText(); }
    });

    this._themeObserver = new MutationObserver(() => this._refreshText());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    html.on('click', '[data-action]', async (e) => {
      const action = e.currentTarget.dataset.action;
      if (!action) return;
      if (action === 'close-window') { this.close(); return; }
      if (action === 'revert')       { await this._endIllusion(false); return; }
      if (action === 'apply-random') { const animals = getAnimals(); await this._applyAnimalDisguise(animals[Math.floor(Math.random() * animals.length)]); return; }
      if (action === 'apply-animal') {
        const animal = getAnimals().find(a => a.id === e.currentTarget.dataset.animalId);
        if (!animal) return;
        if (this._illusionActive && this._activeId === animal.id) { await this._endIllusion(false); return; }
        await this._applyAnimalDisguise(animal);
        return;
      }
      if (action === 'apply-mimic') {
        if (this._illusionActive && this._activeId === 'mimic') { await this._endIllusion(false); return; }
        await this._applyMimic();
        return;
      }
    });

    window._endHarlequinIllusion = async (withSurge = false) => this._endIllusion(withSurge);
  }

  async _applyAnimalDisguise(animal) {
    const token = this._guardSingleToken();
    if (!token) return;
    if (this._illusionActive) await this._endIllusion(false);
    await token.document.update({ ..._intGetAppearance(this._actor.prototypeToken), 'texture.src': animal.src, 'texture.scaleX': 1, 'texture.scaleY': 1 }, { animate: false });
    const name = `${animal.emoji} ${animal.name}`;
    await this._activateIllusion(name, animal.id);
    await ChatMessage.create({ content: `<strong>I'm No Threat</strong> <em>${this._actor.name} takes on the appearance of a <strong>${name}</strong>.</em><br><br>Strikes gain an edge, and Disengage gains +1 distance.` });
  }

  async _applyMimic() {
    if (!this._mimicSrc) { ui.notifications.error('No target selected to mimic.'); return; }

    const freeMimic = _intFreeMimics.has(this._actor.id);
    const inCombat  = !!game.combat?.active;

    const isHero = this._actor.type === 'hero';
    if (!freeMimic) {
      if (isHero) {
        if (inCombat) {
          if (this._actor.system.hero.primary.value < 1) { ui.notifications.error(`${this._actor.name} doesn't have enough Insight to mimic a target.`); return; }
        } else {
          const usedAt = this._actor.getFlag('world', INT_OOC_FLAG);
          if (usedAt !== undefined && usedAt !== null && this._actor.system.hero.victories === usedAt) { ui.notifications.error('Already used outside of combat since last victory.'); return; }
        }
      } else {
        if ((game.actors.malice?.value ?? 0) < 1) { ui.notifications.error(`Not enough Malice to use Mimic.`); return; }
      }
    }

    const targetToken = game.users.contents.flatMap(u => [...u.targets]).find(t => t.actor?.id !== this._actor.id);
    if (!targetToken) { ui.notifications.error('No target selected to mimic.'); return; }

    const token = this._guardSingleToken();
    if (!token) return;

    const dist = canvas.grid.measurePath([{ x: token.center.x, y: token.center.y }, { x: targetToken.center.x, y: targetToken.center.y }]).distance;
    if (dist > 10) { ui.notifications.warn(`${targetToken.name} is beyond the 10 square range (${dist} squares away).`); return; }

    const mySize     = this._actor.system.combat.size;
    const targetSize = targetToken.actor.system.combat.size;
    if (_intSizeRank(targetSize) > _intSizeRank(mySize) + 1) { ui.notifications.warn(`${targetToken.name} is too large to mimic (size ${_intFmtSize(targetSize)} vs ${_intFmtSize(mySize)}).`); return; }

    if (freeMimic) {
      const spendMsgId = _intFreeMimics.get(this._actor.id);
      _intFreeMimics.delete(this._actor.id);
      if (spendMsgId) game.messages.get(spendMsgId)?.setFlag('draw-steel-combat-tools', 'intFreeMimicUsed', true);
    } else if (isHero && inCombat) {
      await this._actor.update({ 'system.hero.primary.value': this._actor.system.hero.primary.value - 1 });
    } else if (isHero) {
      await this._actor.setFlag('world', INT_OOC_FLAG, this._actor.system.hero.victories);
    } else {
      const malice = game.actors.malice;
      if (malice) await game.settings.set('draw-steel', 'malice', { value: Math.max(0, malice.value - 1) });
    }

    if (this._illusionActive) await this._endIllusion(false);
    await token.document.update({ ..._intGetAppearance(targetToken.document), 'texture.scaleX': 1, 'texture.scaleY': 1 }, { animate: false });
    await this._activateIllusion(targetToken.name, 'mimic');

    await ChatMessage.create({ content: `<strong>I'm No Threat</strong> <em>${this._actor.name} appears as <strong>${targetToken.name}</strong>, their allies may mistake ${this._actor.name} for the real thing.</em><br><br>This illusion covers your entire body, including clothing and armor, and alters your voice to sound like that of the creature. You gain an edge on tests made to convince the creature's allies that you are the creature.<br><br>Strikes gain an edge, and Disengage gains +1 distance.` });
  }

  async _activateIllusion(name, id) {
    const abilityData = foundry.utils.deepClone(_INT_EFFECT_ABILITY); abilityData.origin = INT_ORIGIN;
    const passiveData = foundry.utils.deepClone(_INT_EFFECT_PASSIVE); passiveData.origin = INT_ORIGIN;
    await this._actor.createEmbeddedDocuments('ActiveEffect', [abilityData, passiveData]);
    this._illusionActive = true;
    this._disguiseName   = name;
    this._activeId       = id;
    this._refreshText();

    if (window._harlequinIllusionRollHook) Hooks.off('createChatMessage', window._harlequinIllusionRollHook);
    window._harlequinIllusionRollHook = Hooks.on('createChatMessage', async (message) => {
      if (message.speaker.actor !== this._actor.id) return;
      const parts = message.system?.parts?.contents;
      if (!parts) return;
      const abilityResult = parts.find(p => p.type === 'abilityResult');
      if (!abilityResult?.abilityUuid) return;
      const item = await fromUuid(abilityResult.abilityUuid);
      if (!item?.system?.keywords?.has('strike')) return;
      await this._endIllusion(true);
    });
  }

  _clearIllusionState() { this._illusionActive = false; this._disguiseName = null; this._activeId = null; }

  async _endIllusion(withSurge = false) {
    _intRevertingActors.add(this._actor.id);
    const token = this._getToken();
    if (token) await token.document.update(_intGetAppearance(this._actor.prototypeToken), { animate: false });
    for (const e of this._actor.effects.filter(e => e.origin === INT_ORIGIN)) await e.delete();
    _intRevertingActors.delete(this._actor.id);

    if (withSurge) {
      await this._actor.update({ 'system.hero.surges': (this._actor.system.hero.surges ?? 0) + 1 });
      await ChatMessage.create({ content: `<strong>I'm No Threat</strong> <em>${this._actor.name}'s illusion shatters, the enemy never saw it coming!</em> ${this._actor.name} gains a <strong>Surge</strong>.` });
    }

    if (window._harlequinIllusionRollHook) { Hooks.off('createChatMessage', window._harlequinIllusionRollHook); window._harlequinIllusionRollHook = null; }
    this._clearIllusionState();
    ui.notifications.info(`${this._actor.name}'s illusion ended.`);
    this._refreshText();
  }

  async close(options) {
    if (this._hookActor)     Hooks.off('updateActor',        this._hookActor);
    if (this._hookTarget)    Hooks.off('targetToken',        this._hookTarget);
    if (this._hookEffect)    Hooks.off('deleteActiveEffect', this._hookEffect);
    if (this._themeObserver) this._themeObserver.disconnect();
    return super.close(options);
  }
}

export const openImNoThreatPanel = (actor = null) => {
  const target = actor
    ?? game.user.character
    ?? canvas.tokens.controlled[0]?.actor
    ?? [...game.user.targets][0]?.actor;
  if (!target) { ui.notifications.error("Select or target a token to open I'm No Threat."); return; }
  const existing = Object.values(ui.windows).find(w => w.id === 'im-no-threat-panel');
  if (existing) existing.close();
  else new ImNoThreatPanel(target).render(true);
};

// ── Mark button helper ────────────────────────────────────────────────────────

// Build the innerHTML for a mark button.
// "Apply Mark", "Apply 2 Marks", "Apply 3 Marks (Override)", etc.
const markButtonHTML = (maxTargets, override) => {
  const noun = maxTargets === 1 ? 'Mark' : `${maxTargets} Marks`;
  return `<i class="fa-solid fa-crosshairs"></i> Apply ${noun}${override ? ' (Override)' : ''}`;
};

// ── Ability-specific chat-message injectors ───────────────────────────────────
//
// Each injector is registered once via registerAbilityInjectors() (called from
// registerChatHooks) and fires on every renderChatMessageHTML event.
// Each checks its own setting so it can be toggled independently.

export const registerAbilityInjectors = () => {

  // Inject an "Apply Judgement" button on Judgement ability messages.
  registerInjector(function injectJudgementButton(msg, { el, buttons, content }) {
    if (!getSetting('judgementAutomation')) return;
    if (msg.getFlag('draw-steel-combat-tools', 'abilityDsid') !== 'judgement') return;
    if (el.querySelector('.dsct-judgement-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-judgement-btn';
    btn.innerHTML = '<i class="fa-solid fa-skull-crossbones"></i> Apply Judgement';
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', (e) => { e.preventDefault(); getModuleApi(false)?.judgement(); });
    (buttons ?? content ?? el).appendChild(btn);
  });

  // Inject an "Apply Mark" button on mark death-reminder messages.
  // Each reminder corresponds to exactly one fallen mark, so maxTargets is always 1.
  // Once clicked the message is flagged as used and the button is removed.
  registerInjector(function injectMarkReminderButton(msg, { el, buttons, content }) {
    if (!getSetting('markAutomation')) return;
    const reminder = msg.getFlag('draw-steel-combat-tools', 'markReminder');
    if (!reminder) return;
    if (msg.getFlag('draw-steel-combat-tools', 'markReminderUsed')) return;
    if (el.querySelector('.dsct-mark-reminder-btn')) return;

    const { dsid, isMarkAbility, sourceActorId } = reminder;
    const reminderActor   = game.actors.get(sourceActorId);
    const reminderAnticip = isMarkAbility && (reminderActor?.items.some(i => getItemDsid(i) === 'anticipation') ?? false);
    const reminderMax     = reminderAnticip ? 2 : 1;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-mark-reminder-btn';
    btn.innerHTML = markButtonHTML(reminderMax, isMarkAbility);
    btn.style.cssText = 'cursor:pointer;margin-top:4px;';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      let maxTargets = 1, override = false;
      if (isMarkAbility) {
        const actor = game.actors.get(sourceActorId);
        maxTargets = actor?.items.some(i => getItemDsid(i) === 'anticipation') ? 2 : 1;
        override   = true;
      }
      await getModuleApi(false)?.mark({ maxTargets, override, dsid, sourceActorId });
      await msg.setFlag('draw-steel-combat-tools', 'markReminderUsed', true);
      btn.remove();
    });
    (buttons ?? content ?? el).appendChild(btn);
  });

  // Inject an "Apply Mark" button on abilities that apply the Mark condition.
  // maxTargets controls how many the button allows; override: true means the Mark ability clears
  // its own previous marks when reused. Anticipation (for "mark") is resolved inside applyMark.
  const MARK_ABILITY_CONFIG = {
    'mark':                   { maxTargets: 1, override: true  },
    'mind-game':              { maxTargets: 1, override: false },
    'fog-of-war':             { maxTargets: 2, override: false },
    'targets-of-opportunity': { maxTargets: 2, override: false },
    'battle-plan':            { maxTargets: 3, override: false },
    'hustle':                 { maxTargets: 2, override: false },
    'no-escape':              { maxTargets: 1, override: false },
    'that-one-is-mine':       { maxTargets: 1, override: false },
  };
  registerInjector(function injectMarkButton(msg, { el, buttons, content }) {
    if (!getSetting('markAutomation')) return;
    const dsid   = msg.getFlag('draw-steel-combat-tools', 'abilityDsid');
    const config = MARK_ABILITY_CONFIG[dsid];
    if (!config) return;
    if (el.querySelector('.dsct-mark-btn')) return;

    const speakerActor   = game.actors.get(msg.speaker?.actor);
    const speakerAnticip = dsid === 'mark' && (speakerActor?.items.some(i => getItemDsid(i) === 'anticipation') ?? false);
    const effectiveMax   = speakerAnticip ? Math.max(config.maxTargets, 2) : config.maxTargets;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-mark-btn';
    btn.innerHTML = markButtonHTML(effectiveMax, config.override);
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      getModuleApi(false)?.mark({ ...config, dsid, sourceActorId: msg.speaker?.actor ?? null });
    });
    (buttons ?? content ?? el).appendChild(btn);
  });

  // Inject an "Aid Attack" button on Aid Attack ability messages.
  registerInjector(function injectAidAttackButton(msg, { el, buttons, content }) {
    if (!getSetting('aidAttackAutomation')) return;
    if (msg.getFlag('draw-steel-combat-tools', 'abilityDsid') !== 'aid-attack') return;
    if (el.querySelector('.dsct-aid-attack-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-aid-attack-btn';
    btn.innerHTML = '<i class="fa-solid fa-handshake"></i> Aid Attack';
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', (e) => { e.preventDefault(); getModuleApi(false)?.aidAttack(); });
    (buttons ?? content ?? el).appendChild(btn);
  });

  // Inject an "I'm No Threat" panel button on I'm No Threat ability messages.
  registerInjector(function injectImNoThreatButton(msg, { el, buttons, content }) {
    if (!getSetting('imNoThreatEnabled')) return;
    if (msg.getFlag('draw-steel-combat-tools', 'abilityDsid') !== 'im-no-threat') return;
    if (el.querySelector('.dsct-im-no-threat-btn')) return;

    const actorId = msg.speaker?.actor ?? null;

    const M_FLAG = 'draw-steel-combat-tools';
    const spendDetected = !!(actorId && msg.flavor?.toLowerCase().startsWith('spent '));
    const mimicUsed     = !!msg.getFlag(M_FLAG, 'intFreeMimicUsed');

    // Auto-grant on first render of a spend message; skip if already consumed or re-render
    if (spendDetected && !mimicUsed && !_intGrantedMsgs.has(msg.id)) {
      _intFreeMimics.set(actorId, msg.id);
      _intGrantedMsgs.add(msg.id);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-im-no-threat-btn';
    btn.innerHTML = '<i class="fa-solid fa-masks-theater"></i> I\'m No Threat';
    btn.style.cssText = 'cursor:pointer;';
    btn.addEventListener('click', (e) => { e.preventDefault(); getModuleApi(false)?.imNoThreat(game.actors.get(actorId) ?? null); });

    const container = buttons ?? content ?? el;
    container.appendChild(btn);

    if (spendDetected) {
      const badge = document.createElement('div');
      badge.className = 'dsct-int-spend-badge';
      if (mimicUsed) {
        badge.innerHTML = '<i class="fa-solid fa-check"></i> Free Mimic used';
        badge.style.cssText = 'margin-top:4px;font-size:0.82em;opacity:0.4;padding:2px 0;';
      } else {
        badge.innerHTML = '<i class="fa-solid fa-bolt"></i> Spent Insight: Free Mimic ready';
        badge.style.cssText = 'margin-top:4px;font-size:0.82em;opacity:0.7;padding:2px 0;';
      }
      container.appendChild(badge);
    }
  });

  // If a player manually deletes an I'm No Threat effect from their sheet, revert their token.
  Hooks.on('deleteActiveEffect', async (effect) => {
    if (effect.origin !== INT_ORIGIN) return;
    const actor = effect.parent;
    if (!actor) return;
    if (_intRevertingActors.has(actor.id)) return;
    _intRevertingActors.add(actor.id);
    try {
      // Delete any sibling INT_ORIGIN effects that are still present
      const remaining = [...actor.effects].filter(e => e.origin === INT_ORIGIN);
      for (const e of remaining) await e.delete();
      const tokenDoc = canvas.scene?.tokens.find(t => t.actorId === actor.id);
      if (tokenDoc) await tokenDoc.update(_intGetAppearance(actor.prototypeToken), { animate: false });
      const panel = Object.values(ui.windows).find(w => w.id === 'im-no-threat-panel' && w._actor?.id === actor.id);
      if (panel) { panel._clearIllusionState(); panel._refreshText(); }
    } finally {
      _intRevertingActors.delete(actor.id);
    }
  });

  // End all active I'm No Threat illusions when the animal settings are saved,
  // so no disguise persists that uses a removed or changed animal.
  Hooks.on('dsct.intAnimalsUpdated', async () => {
    let ended = 0;
    for (const actor of game.actors) {
      const illusionEffects = [...actor.effects].filter(e => e.origin === INT_ORIGIN);
      if (!illusionEffects.length) continue;
      const tokenDoc = canvas.scene?.tokens.find(t => t.actorId === actor.id);
      if (tokenDoc) await tokenDoc.update(_intGetAppearance(actor.prototypeToken), { animate: false });
      for (const e of illusionEffects) await e.delete();
      const panel = Object.values(ui.windows).find(w => w.id === 'im-no-threat-panel' && w._actor?.id === actor.id);
      if (panel) panel.close();
      ended++;
    }
    if (ended) ui.notifications.info(`I'm No Threat: ended ${ended} active illusion${ended > 1 ? 's' : ''} due to settings change.`);
  });

};
