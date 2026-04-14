import { registerInjector, getSetting, getModuleApi, getItemDsid, palette, injectPanelChrome } from './helpers.mjs';

const M = 'draw-steel-combat-tools';

// -- I'm No Threat panel --

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
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'int' } },
};

const _INT_EFFECT_PASSIVE = {
  name: "I'm No Threat (Disengage)",
  img: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
  type: 'base',
  system: { end: { type: '', roll: '1d10 + @combat.save.bonus' }, filters: { keywords: [] } },
  changes: [{ key: 'system.movement.disengage', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'int' } },
};


const INT_OOC_FLAG     = 'imNoThreatOOCVictories';
const INT_DEFAULT_ICON = 'icons/creatures/mammals/humanoid-fox-cat-archer.webp';

const revertingActors = new Set();


const sizeRank = (size) => size.value >= 2 ? size.value + 2 : ({ T: 0, S: 1, M: 2, L: 3 })[size.letter] ?? 2;
const fmtSize  = (size) => size.value >= 2 ? `${size.value}` : `${size.value}${size.letter}`;

const snapAppearance = (doc) => ({
  width: doc.width, height: doc.height, rotation: doc.rotation ?? 0,
  'texture.src': doc.texture.src,
  'texture.anchorX': doc.texture.anchorX ?? 0.5,
  'texture.anchorY': doc.texture.anchorY ?? 0.5,
  'texture.scaleX': doc.texture.scaleX ?? 1,
  'texture.scaleY': doc.texture.scaleY ?? 1,
  'texture.rotation': doc.texture.rotation ?? 0,
  'texture.tint': doc.texture.tint ?? '#ffffff',
  'texture.alphaThreshold': doc.texture.alphaThreshold ?? 0.75,
  'ring.enabled': doc.ring?.enabled ?? false,
  'ring.colors.ring': doc.ring?.colors?.ring ?? '#ffffff',
  'ring.colors.background': doc.ring?.colors?.background ?? '#ffffff',
  'ring.effects': doc.ring?.effects ?? 0,
  'ring.subject.scale': doc.ring?.subject?.scale ?? 1,
  'ring.subject.texture': doc.ring?.subject?.texture ?? '',
});

const freeMimicsByActor  = new Map();
const grantedMimicMsgs = new Set();

class ImNoThreatPanel extends Application {
  constructor(actor) {
    super();
    this._actor          = actor;
    this._illusionActive = !!actor.effects.find(e => e.getFlag(M, 'effectType') === 'int');
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
    const p        = palette();

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

    const isFree   = freeMimicsByActor.has(this._actor.id);
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
    injectPanelChrome(this.options.id);
    const p = palette();

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
            background:${p.bgBtn};border:1px solid ${p.border};color:${p.text};">?? Random</button>

          <div data-action="apply-mimic"
            style="flex:1.4;display:flex;align-items:center;gap:${_s(5)}px;cursor:pointer;
            padding:${_s(4)}px ${_s(6)}px;border-radius:${_s(3)}px;border:1px solid ${p.border};background:${p.bgBtn};">
            <img id="int-mimic-img" src="${mimicSrc}"
              style="width:${_s(32)}px;height:${_s(32)}px;border-radius:${_s(2)}px;flex-shrink:0;object-fit:contain;pointer-events:none;">
            <div style="pointer-events:none;min-width:0;">
              <div style="font-size:${_s(8)}px;color:${p.mimicLabel};">?? Mimic</div>
              <div id="int-mimic-name"
                style="font-size:${_s(8)}px;color:${this._mimicName ? p.textMimic : p.textMimicDim};word-break:break-word;">
                ${this._mimicName ?? 'No Target'}
              </div>
              <div id="int-mimic-cost" style="font-size:${_s(7)}px;color:${p.textDim};display:${freeMimicsByActor.has(this._actor.id) ? 'none' : ''};">
                1 ${priLabel} <span id="int-insight-count">(${insight})</span>
              </div>
              <div id="int-mimic-free" style="font-size:${_s(7)}px;color:${p.accent};display:${freeMimicsByActor.has(this._actor.id) ? '' : 'none'};">
                ? Free (spent Insight)
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
      if (effect.getFlag(M, 'effectType') !== 'int' || effect.parent?.id !== this._actor.id) return;
      const remaining = this._actor.effects.filter(e => e.getFlag(M, 'effectType') === 'int' && e.id !== effect.id);
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
    await token.document.update({ ...snapAppearance(this._actor.prototypeToken), 'texture.src': animal.src, 'texture.scaleX': 1, 'texture.scaleY': 1 }, { animate: false });
    const name = `${animal.emoji} ${animal.name}`;
    await this._activateIllusion(name, animal.id);
    const animalMsg = await ChatMessage.create({ content: `<strong>I'm No Threat</strong> <em>${this._actor.name} takes on the appearance of a <strong>${name}</strong>.</em><br><br>Strikes gain an edge, and Disengage gains +1 distance.`, flags: { [M]: { intIllusion: { actorId: this._actor.id } } } });
    this._illusionMsgId = animalMsg?.id ?? null;
  }

  async _applyMimic() {
    if (!this._mimicSrc) { ui.notifications.error('No target selected to mimic.'); return; }

    const freeMimic = freeMimicsByActor.has(this._actor.id);
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
    if (sizeRank(targetSize) > sizeRank(mySize) + 1) { ui.notifications.warn(`${targetToken.name} is too large to mimic (size ${fmtSize(targetSize)} vs ${fmtSize(mySize)}).`); return; }

    if (freeMimic) {
      const spendMsgId = freeMimicsByActor.get(this._actor.id);
      freeMimicsByActor.delete(this._actor.id);
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
    await token.document.update({ ...snapAppearance(targetToken.document), 'texture.scaleX': 1, 'texture.scaleY': 1 }, { animate: false });
    await this._activateIllusion(targetToken.name, 'mimic');

    const mimicMsg = await ChatMessage.create({ content: `<strong>I'm No Threat</strong> <em>${this._actor.name} appears as <strong>${targetToken.name}</strong>, their allies may mistake ${this._actor.name} for the real thing.</em><br><br>This illusion covers your entire body, including clothing and armor, and alters your voice to sound like that of the creature. You gain an edge on tests made to convince the creature's allies that you are the creature.<br><br>Strikes gain an edge, and Disengage gains +1 distance.`, flags: { [M]: { intIllusion: { actorId: this._actor.id } } } });
    this._illusionMsgId = mimicMsg?.id ?? null;
  }

  async _activateIllusion(name, id) {
    await this._actor.createEmbeddedDocuments('ActiveEffect', [
      foundry.utils.deepClone(_INT_EFFECT_ABILITY),
      foundry.utils.deepClone(_INT_EFFECT_PASSIVE),
    ]);
    this._illusionActive = true;
    this._disguiseName   = name;
    this._activeId       = id;
    this._illusionMsgId  = null;
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

  _clearIllusionState() { this._illusionActive = false; this._disguiseName = null; this._activeId = null; this._illusionMsgId = null; }

  async _endIllusion(withSurge = false) {
    revertingActors.add(this._actor.id);
    const token = this._getToken();
    if (token) await token.document.update(snapAppearance(this._actor.prototypeToken), { animate: false });
    for (const e of this._actor.effects.filter(e => e.getFlag(M, 'effectType') === 'int')) await e.delete();
    revertingActors.delete(this._actor.id);

    if (this._illusionMsgId) {
      const illusionMsg = game.messages.get(this._illusionMsgId);
      if (illusionMsg) await illusionMsg.setFlag(M, 'intIllusionEnded', true);
    }

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

// -- Mark button helper --

const markButtonHTML = (maxTargets, override) => {
  const noun = maxTargets === 1 ? 'Mark' : `${maxTargets} Marks`;
  return `<i class="fa-solid fa-crosshairs"></i> Apply ${noun}${override ? ' (Override)' : ''}`;
};

// -- Ability-specific chat-message injectors --

export const registerAbilityInjectors = () => {

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

  registerInjector(function injectImNoThreatButton(msg, { el, buttons, content }) {
    if (!getSetting('imNoThreatEnabled')) return;
    if (msg.getFlag('draw-steel-combat-tools', 'abilityDsid') !== 'im-no-threat') return;
    if (el.querySelector('.dsct-im-no-threat-btn')) return;

    const actorId = msg.speaker?.actor ?? null;

    const M_FLAG = 'draw-steel-combat-tools';
    const spendDetected = !!(actorId && msg.flavor?.toLowerCase().startsWith('spent '));
    const mimicUsed     = !!msg.getFlag(M_FLAG, 'intFreeMimicUsed');

    if (spendDetected && !mimicUsed && !grantedMimicMsgs.has(msg.id)) {
      freeMimicsByActor.set(actorId, msg.id);
      grantedMimicMsgs.add(msg.id);
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

  registerInjector(function injectIntIllusionButton(msg, { el, content }) {
    if (!msg.getFlag(M, 'intIllusion')) return;
    const ended = !!msg.getFlag(M, 'intIllusionEnded');

    if (ended) {
      if (el.querySelector('.dsct-int-broken')) return;
      el.querySelector('.dsct-int-end-btn')?.remove();
      const notice = document.createElement('div');
      notice.className = 'dsct-int-broken';
      notice.innerHTML = '<em>Illusion Broken.</em>';
      notice.style.cssText = 'margin-top:6px;opacity:0.6;font-size:0.9em;';
      (content ?? el).appendChild(notice);
      return;
    }

    if (el.querySelector('.dsct-int-end-btn')) return;
    const actorId = msg.getFlag(M, 'intIllusion')?.actorId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-int-end-btn';
    btn.innerHTML = '<i class="fa-solid fa-masks-theater"></i> End Illusion';
    btn.style.cssText = 'cursor:pointer;margin-top:4px;';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const actor = game.actors.get(actorId);
      if (!actor) return;
      const panel = Object.values(ui.windows).find(w => w.id === 'im-no-threat-panel' && w._actor?.id === actorId);
      if (panel) await panel._endIllusion(false);
      else if (window._endHarlequinIllusion) await window._endHarlequinIllusion(false);
    });
    (content ?? el).appendChild(btn);
  });

  Hooks.on('deleteActiveEffect', async (effect) => {
    if (effect.getFlag(M, 'effectType') !== 'int') return;
    const actor = effect.parent;
    if (!actor) return;
    if (revertingActors.has(actor.id)) return;
    revertingActors.add(actor.id);
    try {
      const remaining = [...actor.effects].filter(e => e.getFlag(M, 'effectType') === 'int');
      for (const e of remaining) await e.delete();
      const tokenDoc = canvas.scene?.tokens.find(t => t.actorId === actor.id);
      if (tokenDoc) await tokenDoc.update(snapAppearance(actor.prototypeToken), { animate: false });
      const panel = Object.values(ui.windows).find(w => w.id === 'im-no-threat-panel' && w._actor?.id === actor.id);
      if (panel) { panel._clearIllusionState(); panel._refreshText(); }
    } finally {
      revertingActors.delete(actor.id);
    }
  });

  Hooks.on('dsct.intAnimalsUpdated', async () => {
    let ended = 0;
    for (const actor of game.actors) {
      const illusionEffects = [...actor.effects].filter(e => e.getFlag(M, 'effectType') === 'int');
      if (!illusionEffects.length) continue;
      const tokenDoc = canvas.scene?.tokens.find(t => t.actorId === actor.id);
      if (tokenDoc) await tokenDoc.update(snapAppearance(actor.prototypeToken), { animate: false });
      for (const e of illusionEffects) await e.delete();
      const panel = Object.values(ui.windows).find(w => w.id === 'im-no-threat-panel' && w._actor?.id === actor.id);
      if (panel) panel.close();
      ended++;
    }
    if (ended) ui.notifications.info(`I'm No Threat: ended ${ended} active illusion${ended > 1 ? 's' : ''} due to settings change.`);
  });

};

// -- I'm No Threat Settings --


export const INT_ANIMAL_DEFAULTS = [
  { id: 'bullfrog',  name: 'Bullfrog',  src: 'icons/creatures/amphibians/bullfrog-glowing-green.webp',         emoji: '??' },
  { id: 'chicken',   name: 'Chicken',   src: 'icons/creatures/birds/chicken-hen-white.webp',                   emoji: '??' },
  { id: 'crab',      name: 'Crab',      src: 'icons/creatures/fish/crab-blue-purple.webp',                     emoji: '??' },
  { id: 'cat',       name: 'Cat',       src: 'icons/creatures/mammals/cat-hunched-glowing-red.webp',           emoji: '??' },
  { id: 'dog',       name: 'Dog',       src: 'icons/creatures/mammals/dog-husky-white-blue.webp',              emoji: '??' },
  { id: 'rat',       name: 'Rat',       src: 'icons/creatures/mammals/rodent-rat-diseaed-gray.webp',           emoji: '??' },
  { id: 'rabbit',    name: 'Rabbit',    src: 'icons/creatures/mammals/rabbit-movement-glowing-green.webp',     emoji: '??' },
  { id: 'chameleon', name: 'Chameleon', src: 'icons/creatures/reptiles/chameleon-camouflage-green-brown.webp', emoji: '??' },
];

export const getAnimals = () => {
  const stored = game.settings.get(M, 'intAnimals');
  return (Array.isArray(stored) && stored.length) ? stored : INT_ANIMAL_DEFAULTS;
};


const INT_EMOJI_LIST = [
  ['??','dog puppy canine'],          ['??','cat kitten feline'],
  ['??','mouse rodent'],              ['??','hamster rodent'],
  ['??','rabbit bunny hare'],         ['??','rabbit bunny hare'],
  ['??','dog canine'],                ['??','poodle dog'],
  ['??','guide dog service'],         ['??','cat feline'],
  ['????','black cat feline'],
  ['??','fox'],                       ['??','bear'],
  ['??','panda bear'],                ['??','koala'],
  ['??','tiger'],                     ['??','lion'],
  ['??','cow bull bovine'],           ['??','pig hog pork'],
  ['??','horse'],                     ['??','unicorn horse'],
  ['??','wolf'],                      ['??','boar pig wild'],
  ['??','monkey'],                    ['??','monkey see no evil'],
  ['??','monkey hear no evil'],       ['??','monkey speak no evil'],
  ['??','gorilla ape'],               ['??','orangutan ape'],
  ['??','mammoth elephant'],          ['??','elephant'],
  ['??','rhinoceros rhino'],          ['??','rhinoceros rhino'],
  ['??','camel dromedary'],           ['??','camel bactrian hump'],
  ['??','giraffe'],                   ['??','kangaroo'],
  ['??','bison buffalo'],             ['??','water buffalo bovine'],
  ['??','bull ox bovine'],            ['??','cow bovine'],
  ['??','horse equine'],              ['??','pig hog'],
  ['??','ram sheep'],                 ['??','sheep ewe lamb'],
  ['??','llama'],                     ['??','goat'],
  ['??','deer stag reindeer'],        ['??','raccoon'],
  ['??','skunk'],                     ['??','badger'],
  ['??','beaver'],                    ['??','otter'],
  ['??','sloth'],                     ['??','mouse rodent'],
  ['??','rat rodent'],                ['???','chipmunk squirrel'],
  ['??','hedgehog'],                  ['??','tiger big cat'],
  ['??','leopard cheetah panther'],   ['??','zebra'],
  ['??','gorilla primate'],
  ['??','chicken hen'],               ['??','penguin'],
  ['??','bird'],                      ['??','chick baby bird'],
  ['??','duck waterfowl'],            ['??','eagle raptor'],
  ['??','owl'],                       ['??','bat'],
  ['??','parrot'],                    ['??','swan'],
  ['??','flamingo'],                  ['???','dove pigeon peace'],
  ['??','rooster chicken'],           ['??','turkey'],
  ['??','dodo bird'],                 ['??','peacock'],
  ['??','feather bird'],              ['????','raven crow black bird'],
  ['??','frog toad amphibian bullfrog'], ['??','turtle tortoise'],
  ['??','snake serpent'],             ['??','lizard reptile chameleon'],
  ['??','dinosaur t-rex'],            ['??','dinosaur sauropod brontosaurus'],
  ['??','crocodile alligator'],       ['??','dragon'],
  ['??','dragon'],
  ['??','octopus'],                   ['??','squid'],
  ['??','shrimp prawn'],              ['??','lobster'],
  ['??','crab'],                      ['??','blowfish puffer'],
  ['??','tropical fish'],             ['??','fish'],
  ['??','dolphin'],                   ['??','whale'],
  ['??','whale'],                     ['??','shark'],
  ['??','seal'],
  ['??','bee honeybee'],              ['??','worm'],
  ['??','caterpillar bug larva'],     ['??','butterfly'],
  ['??','snail'],                     ['??','ladybug ladybird beetle'],
  ['??','ant'],                       ['??','mosquito'],
  ['??','cricket grasshopper'],       ['??','scorpion'],
  ['???','spider'],                   ['??','beetle bug'],
  ['??','cockroach bug'],             ['??','microbe germ bacteria virus'],
  ['??','herb plant leaf'],           ['??','mushroom fungus'],
  ['??','shell spiral'],              ['??','flower hibiscus'],
  ['??','blossom cherry flower'],     ['??','sunflower'],
  ['??','rose flower'],               ['??','cactus'],
  ['??','tree pine evergreen'],       ['??','tree deciduous'],
  ['??','clover shamrock'],           ['??','coral reef'],
  ['??','sheaf wheat grain'],         ['??','rock stone'],
  ['??','dragon fantasy'],            ['??','unicorn'],
  ['??','ghost spirit'],              ['??','skull death'],
  ['??','skull crossbones poison'],   ['??','masks theater drama'],
  ['??','joker card wild'],           ['??','top hat magic'],
  ['??','magic wand'],               ['??','crystal ball magic'],
  ['??','wizard mage sorcerer'],      ['??','elf'],
  ['??','zombie undead'],             ['??','vampire'],
  ['??','mermaid fish human'],        ['??','fairy'],
  ['??','sword crossed weapons'],     ['???','dagger knife'],
  ['??','bow arrow archery'],         ['???','shield defense'],
  ['??','boomerang'],                 ['??','trident'],
  ['??','fire flame'],                ['??','water drop'],
  ['??','snowflake ice cold'],        ['?','lightning bolt electric'],
  ['??','wave water ocean'],          ['??','moon crescent night'],
  ['?','star'],                      ['??','glowing star'],
  ['??','dizzy star'],                ['??','rainbow'],
  ['???','tornado wind'],             ['??','cloud'],
  ['??','new moon dark'],             ['??','sun'],
  ['??','dice random'],               ['??','circus tent'],
  ['??','egg'],                       ['??','nest'],
  ['??','bone'],                      ['??','paw footprint'],
  ['??','cyclone spiral'],            ['???','eye watching'],
  ['??','heart organ'],               ['??','brain mind'],
];

let _pickerEl   = null;
let _pickerCb   = null;
let _outsideOff = null;

const _buildGrid = (filter) => {
  const q    = filter.toLowerCase().trim();
  const list = q ? INT_EMOJI_LIST.filter(([, n]) => n.includes(q)) : INT_EMOJI_LIST;
  const grid = document.getElementById('dsct-int-epicker-grid');
  if (!grid) return;
  grid.innerHTML = list.map(([e]) =>
    `<button type="button" class="dsct-int-ep-btn" title="${e}"
      style="font-size:20px;line-height:1;padding:4px;border:1px solid transparent;border-radius:4px;
             background:none;cursor:pointer;width:34px;height:34px;"
      onmouseover="this.style.borderColor='var(--dsct-ep-accent,#7a50c0)'"
      onmouseout="this.style.borderColor='transparent'"
      data-emoji="${e}">${e}</button>`
  ).join('');
};

const _getOrCreatePicker = () => {
  if (_pickerEl) return _pickerEl;
  const p   = document.body.classList.contains('theme-dark');
  const bg  = p ? '#0e0c14' : '#f0eef8';
  const bdr = p ? '#2a2040' : '#b0a8cc';
  const bo  = p ? '#4a3870' : '#7060a8';
  const txt = p ? '#8a88a0' : '#3a3060';
  const btn = p ? '#1a1628' : '#dbd8ec';

  const el  = document.createElement('div');
  el.id     = 'dsct-int-emoji-picker';
  el.style.cssText = [
    `position:fixed;z-index:10000;display:none`,
    `background:${bg};border:1px solid ${bo};border-radius:6px`,
    `box-shadow:0 4px 18px rgba(0,0,0,0.5);padding:8px`,
    `width:280px;font-family:Georgia,serif`,
  ].join(';');
  el.style.setProperty('--dsct-ep-accent', '#7a50c0');

  el.innerHTML = `
    <input id="dsct-int-epicker-search" type="text" placeholder="Search emojis�"
      style="width:100%;box-sizing:border-box;padding:5px 8px;margin-bottom:6px;
             background:${btn};border:1px solid ${bdr};border-radius:4px;
             color:${txt};font-family:Georgia,serif;font-size:0.9em;outline:none;">
    <div id="dsct-int-epicker-grid"
      style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;
             max-height:220px;overflow-y:auto;"></div>`;

  document.body.appendChild(el);

  el.querySelector('#dsct-int-epicker-search').addEventListener('input', (e) => {
    _buildGrid(e.target.value);
  });

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (!btn) return;
    if (_pickerCb) _pickerCb(btn.dataset.emoji);
    _closePicker();
  });

  _pickerEl = el;
  return el;
};

const _closePicker = () => {
  if (_pickerEl) _pickerEl.style.display = 'none';
  if (_outsideOff) { document.removeEventListener('mousedown', _outsideOff); _outsideOff = null; }
  _pickerCb = null;
};

const _openPicker = (triggerEl, onSelect) => {
  const el = _getOrCreatePicker();
  _pickerCb = onSelect;

  const searchEl = el.querySelector('#dsct-int-epicker-search');
  searchEl.value = '';
  _buildGrid('');

  el.style.display = 'block';
  const tr  = triggerEl.getBoundingClientRect();
  const vh  = window.innerHeight;
  const top = tr.bottom + 4 + el.offsetHeight > vh
    ? Math.max(0, tr.top - el.offsetHeight - 4)
    : tr.bottom + 4;
  const left = Math.min(tr.left, window.innerWidth - el.offsetWidth - 8);
  el.style.top  = `${top}px`;
  el.style.left = `${Math.max(8, left)}px`;

  setTimeout(() => searchEl.focus(), 0);

  if (_outsideOff) document.removeEventListener('mousedown', _outsideOff);
  _outsideOff = (e) => {
    if (!el.contains(e.target) && e.target !== triggerEl) _closePicker();
  };
  document.addEventListener('mousedown', _outsideOff);
};


// -- Settings UI --

const DEFAULT_ICON = 'icons/creatures/mammals/humanoid-fox-cat-archer.webp';
const buildRow = (idx, animal, p) => `
  <tr>
    <td style="text-align:center;padding:4px 6px;">
      <button type="button" class="dsct-int-icon-pick" data-idx="${idx}" title="Click to change icon"
        style="width:34px;height:34px;padding:2px;border-radius:3px;cursor:pointer;
               background:${p.bgBtn};border:1px solid ${p.border};
               display:inline-flex;align-items:center;justify-content:center;">
        <img src="${animal.src || DEFAULT_ICON}" style="width:28px;height:28px;object-fit:contain;pointer-events:none;border-radius:2px;">
      </button>
      <input type="hidden" name="src-${idx}"  value="${animal.src || DEFAULT_ICON}">
      <input type="hidden" name="anid-${idx}" value="${animal.id}">
    </td>
    <td style="padding:4px 6px;">
      <input type="text" name="name-${idx}" value="${animal.name}" placeholder="Name�"
        style="width:100%;box-sizing:border-box;text-align:center;background:${p.bgBtn};border:1px solid ${p.border};
               color:${p.accent};font-weight:bold;border-radius:3px;padding:4px 6px;">
    </td>
    <td style="text-align:center;padding:4px 6px;">
      <button type="button" class="dsct-int-emoji-trigger" data-idx="${idx}" title="Pick emoji"
        style="width:52px;height:34px;font-size:20px;cursor:pointer;border-radius:3px;
               background:${p.bgBtn};border:1px solid ${p.border};
               display:inline-flex;align-items:center;justify-content:center;">
        ${animal.emoji || '+'}
      </button>
      <input type="hidden" name="emoji-${idx}" value="${animal.emoji ?? ''}">
    </td>
    <td style="text-align:center;padding:4px 6px;">
      <button type="button" class="dsct-int-delete-animal" title="Remove animal"
        style="padding:3px 8px;border-radius:3px;cursor:pointer;background:${p.bgBtn};
               border:1px solid ${p.border};color:${p.textDim};">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </td>
  </tr>`;

export class ImNoThreatSettingsMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:         "I'm No Threat: Animal Settings",
      id:            'dsct-int-settings',
      width:         480,
      height:        'auto',
      closeOnSubmit: true,
    });
  }

  getData() {
    return { animals: getAnimals() };
  }

  async _renderInner(data) {
    const { animals } = data;
    const p = palette();

    const styleId = 'dsct-int-settings-style';
    const styleEl = document.getElementById(styleId)
      ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    styleEl.textContent = `
      #dsct-int-settings .window-content { background:${p.bg}; color:${p.text}; font-family:Georgia,serif; }
      #dsct-int-settings { border:1px solid ${p.borderOuter}; box-shadow:0 0 14px rgba(0,0,0,0.45); }
      #dsct-int-settings .window-header { background:${p.bg}; border-bottom:1px solid ${p.border}; color:${p.accent}; }
      #dsct-int-settings .window-header a { color:${p.textDim}; }
      #dsct-int-settings .window-header a:hover { color:${p.text}; }
      #dsct-int-settings input[type="text"] {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text};
        border-radius:3px; padding:4px 6px; font-family:Georgia,serif;
      }
      #dsct-int-settings input:focus { border-color:${p.accent}; outline:none; }
      #dsct-int-settings th {
        color:${p.textLabel}; text-transform:uppercase; font-size:0.75em; letter-spacing:0.6px;
        border-bottom:1px solid ${p.border}; padding:6px 8px; text-align:center; font-weight:bold;
      }
      #dsct-int-settings td { border-bottom:1px solid ${p.border}22; }
      #dsct-int-settings button {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text};
        border-radius:3px; cursor:pointer; padding:5px 14px; font-family:Georgia,serif;
      }
      #dsct-int-settings button:hover { border-color:${p.accent}; color:${p.accent}; }
      #dsct-int-settings .dsct-int-delete-animal:hover { border-color:#cc4444 !important; color:#cc4444 !important; }
      #dsct-int-settings .dsct-int-icon-pick:hover  { border-color:${p.accent} !important; }
      #dsct-int-settings .dsct-int-emoji-trigger:hover { border-color:${p.accent} !important; }
      #dsct-int-settings #dsct-int-save-btn { border-color:${p.accent}; color:${p.accent}; }
      #dsct-int-settings .dsct-int-table-scroll { max-height:360px; overflow-y:auto; }
    `;

    const rows = animals.map((a, idx) => buildRow(idx, a, p)).join('');

    return $(`<div style="padding:14px;">
      <div class="dsct-int-table-scroll">
        <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
          <thead>
            <tr>
              <th title="Icon shown in the I'm No Threat panel.">Icon</th>
              <th>Name</th>
              <th title="Emoji shown on the panel button (click to pick).">Emoji</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="dsct-int-animal-tbody">${rows}</tbody>
        </table>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px;">
        <button type="button" id="dsct-int-add-btn"   style="flex:1;"><i class="fa-solid fa-plus"></i> Add Animal</button>
        <button type="button" id="dsct-int-reset-btn" style="flex:1;"><i class="fa-solid fa-rotate-left"></i> Reset Defaults</button>
        <button type="button" id="dsct-int-save-btn"  style="flex:1;"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.on('click', '.dsct-int-icon-pick', function () {
      const idx = $(this).data('idx');
      new FilePicker({
        type:     'imagevideo',
        current:  html.find(`[name="src-${idx}"]`).val() || '',
        callback: (path) => {
          html.find(`[name="src-${idx}"]`).val(path);
          $(this).find('img').attr('src', path);
        },
      }).browse();
    });

    html.on('click', '.dsct-int-emoji-trigger', function () {
      const idx     = $(this).data('idx');
      const trigger = this;
      _openPicker(trigger, (emoji) => {
        html.find(`[name="emoji-${idx}"]`).val(emoji);
        $(trigger).text(emoji);
      });
    });

    html.on('click', '.dsct-int-delete-animal', function () {
      $(this).closest('tr').remove();
    });

    html.find('#dsct-int-add-btn').on('click', () => {
      const p = palette();
      const tbody = html.find('#dsct-int-animal-tbody');
      const maxIdx = Math.max(-1, ...tbody.find('tr').map((_, tr) => {
        const inp = $(tr).find('[name^="anid-"]')[0];
        return inp ? (parseInt(inp.name.replace('anid-', '')) || 0) : -1;
      }).get());
      const idx = maxIdx + 1;
      tbody.append(buildRow(idx, { id: foundry.utils.randomID(), name: '', src: DEFAULT_ICON, emoji: '' }, p));
    });

    html.find('#dsct-int-reset-btn').on('click', async () => {
      await game.settings.set(M, 'intAnimals', []);
      ui.notifications.info("I'm No Threat animals reset to defaults.");
      this.render(true);
    });

    html.find('#dsct-int-save-btn').on('click', async () => {
      await this._doSave(html);
      this.close();
    });

    Hooks.once('closeImNoThreatSettingsMenu', () => _closePicker());
  }

  async _doSave(html) {
    const animals   = [];
    const seenNames = new Set();

    html.find('#dsct-int-animal-tbody tr').each((_, tr) => {
      const name  = ($(tr).find('[name^="name-"]').val()  ?? '').trim();
      const src   =  $(tr).find('[name^="src-"]').val()   || DEFAULT_ICON;
      const emoji = ($(tr).find('[name^="emoji-"]').val() ?? '').trim();
      const id    =  $(tr).find('[name^="anid-"]').val()  || foundry.utils.randomID();
      if (!name) return;
      if (seenNames.has(name)) { ui.notifications.warn(`Duplicate animal name "${name}" - skipping.`); return; }
      seenNames.add(name);
      animals.push({ id, name, src, emoji });
    });

    await game.settings.set(M, 'intAnimals', animals);
    Hooks.callAll('dsct.intAnimalsUpdated');
    ui.notifications.info("I'm No Threat animal settings saved. Reloading...");
    foundry.utils.debouncedReload();
  }

  async _updateObject() {}
}