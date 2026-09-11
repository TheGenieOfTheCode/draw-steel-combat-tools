import { getSetting, getModuleApi } from '../../helpers.mjs';
import { chooseKeywords } from '../choose-effect.mjs';

const M = 'draw-steel-combat-tools';

const _INT_EFFECT_ABILITY = {
  name: "I'm No Threat",
  img: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
  type: 'abilityModifier',
  system: { end: { roll: '1d10 + @combat.save.bonus' }, filters: { keywords: ['strike'] } },
  changes: [{ key: 'power.roll.edges', mode: 2, value: '1', priority: null }],
  disabled: false,
  duration: { startTime: 0, combat: null, seconds: null, rounds: null, turns: null, startRound: null, startTurn: null, expiry: 'turnEnd' },
  description: '', tint: '#ffffff', transfer: false, statuses: [], sort: 0, flags: { [M]: { effectType: 'int' } },
};

const _INT_EFFECT_PASSIVE = {
  name: "I'm No Threat (Disengage)",
  img: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
  type: 'base',
  system: { end: { roll: '1d10 + @combat.save.bonus' }, filters: { keywords: [] } },
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

class ImNoThreatPanel extends ds.applications.api.DSApplication {
  constructor(actor) {
    super();
    this._actor          = actor;
    this._illusionActive = !!actor.effects.find(e => e.getFlag(M, 'effectType') === 'int');
    this._disguiseName   = null;
    this._activeId       = null;
    this._updateMimicPreview();
    this._initVictoryHook();
  }

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/ability-automation.hbs' },
  };

  static DEFAULT_OPTIONS = {
    id: 'im-no-threat-panel',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.ImNoThreat', minimizable: false, resizable: true },
    position: { width: 296, height: 'auto' },
    actions: {
      'revert':       ImNoThreatPanel._onRevert,
      'apply-random': ImNoThreatPanel._onApplyRandom,
      'apply-animal': ImNoThreatPanel._onApplyAnimal,
      'apply-mimic':  ImNoThreatPanel._onApplyMimic,
    },
  };

  static async _onRevert(_event, _target) {
    await this._endIllusion(false);
  }

  static async _onApplyRandom(_event, _target) {
    const animals = getAnimals();
    await this._applyAnimalDisguise(animals[Math.floor(Math.random() * animals.length)]);
  }

  static async _onApplyAnimal(_event, target) {
    const animal = getAnimals().find(a => a.id === target.dataset.animalId);
    if (!animal) return;
    if (this._illusionActive && this._activeId === animal.id) { await this._endIllusion(false); return; }
    await this._applyAnimalDisguise(animal);
  }

  static async _onApplyMimic(_event, _target) {
    if (this._illusionActive && this._activeId === 'mimic') { await this._endIllusion(false); return; }
    await this._applyMimic();
  }

  _getToken() { return canvas.tokens.placeables.find(t => t.document.actorId === this._actor.id || t.actor?.id === this._actor.id); }

  _guardSingleToken() {
    const token = this._getToken();
    if (!token) { ui.notifications.error(game.i18n.localize('DSCT.notice.int.tokenNotFound')); return null; }
    if (canvas.tokens.placeables.filter(t => t.actor?.id === this._actor.id).length > 1) {
      ui.notifications.error(game.i18n.format('DSCT.notice.int.multipleTokens', { name: this._actor.name })); return null;
    }
    return token;
  }

  _updateMimicPreview() {
    const target    = game.users.contents.flatMap(u => [...u.targets]).find(t => t.actor?.id !== this._actor.id);
    this._mimicSrc  = target?.document.texture.src ?? null;
    this._mimicName = target?.name ?? null;
  }

  _refreshText() {
    if (!this.rendered) return;
    const illusion = this._illusionActive;
    const token    = this._getToken();
    const isHero   = this._actor.type === 'hero';
    const insight  = isHero ? (this._actor.system.hero.primary.value ?? 0) : (game.actors.malice?.value ?? 0);
    const el       = (id) => this.element.querySelector(id);

    const statusEl = el('#int-status-label');
    if (statusEl) { statusEl.textContent = illusion ? (this._disguiseName ?? '') : game.i18n.localize('DSCT.panel.int.noIllusion'); statusEl.classList.toggle('active', illusion); }

    const hintEl = el('#int-revert-hint');
    if (hintEl) hintEl.classList.toggle('dsct-hidden', !illusion);

    const previewImg = el('#int-preview-img');
    if (previewImg) {
      previewImg.src            = this._previewSrc ?? this._actor.prototypeToken.texture.src;
      previewImg.dataset.action = illusion ? 'revert' : '';
      previewImg.classList.toggle('active', illusion);
    }

    const mimicNameEl = el('#int-mimic-name');
    if (mimicNameEl) { mimicNameEl.textContent = this._mimicName ?? game.i18n.localize('DSCT.panel.int.noTarget'); mimicNameEl.classList.toggle('active', !!this._mimicName); }

    const mimicImgEl = el('#int-mimic-img');
    if (mimicImgEl) mimicImgEl.src = this._mimicSrc ?? INT_DEFAULT_ICON;

    const insightEl = el('#int-insight-count');
    if (insightEl) insightEl.textContent = `(${insight})`;

    const isFree = freeMimicsByActor.has(this._actor.id);
    const costEl = el('#int-mimic-cost');
    const freeEl = el('#int-mimic-free');
    if (costEl) costEl.classList.toggle('dsct-hidden', isFree);
    if (freeEl) freeEl.classList.toggle('dsct-hidden', !isFree);
  }

  _initVictoryHook() {
    if (!window._imNoThreatVictoryHook) {
      window._imNoThreatVictoryHook = Hooks.on('updateActor', async (actor, changes) => {
        if (actor.id !== this._actor.id) return;
        if (changes.system?.hero?.victories === undefined) return;
        const usedAt = actor.getFlag('world', INT_OOC_FLAG);
        if (usedAt === undefined || usedAt === null) return;
        await actor.unsetFlag('world', INT_OOC_FLAG);
        ui.notifications.info(game.i18n.format('DSCT.notice.int.outOfCombatAgain', { name: actor.name }));
      });
    }
  }

  async _prepareContext(_options) {
    const token      = this._getToken();
    const currentSrc = token?.document.texture.src ?? this._actor.prototypeToken.texture.src;
    const illusion   = this._illusionActive;
    const isHero     = this._actor.type === 'hero';
    const insight    = isHero ? (this._actor.system.hero.primary.value ?? 0) : (game.actors.malice?.value ?? 0);
    const priLabel   = isHero ? (this._actor.system.hero.primary.label ?? 'Insight') : 'Malice';
    const mimicSrc   = this._mimicSrc ?? INT_DEFAULT_ICON;
    const isFree     = freeMimicsByActor.has(this._actor.id);
    return {
      currentSrc, illusion,
      statusLabel: illusion ? (this._disguiseName ?? '') : game.i18n.localize('DSCT.panel.int.noIllusion'),
      mimicSrc, mimicName: this._mimicName,
      isFree, priLabel, insight,
      animals: getAnimals(),
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);

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

    window._endHarlequinIllusion = async (withSurge = false) => this._endIllusion(withSurge);
  }

  async _applyAnimalDisguise(animal) {
    const token = this._guardSingleToken();
    if (!token) return;
    if (this._illusionActive) await this._endIllusion(false);
    await token.document.update({ ...snapAppearance(this._actor.prototypeToken), 'texture.src': animal.src, 'texture.scaleX': 1, 'texture.scaleY': 1 });
    const name = `${animal.emoji} ${animal.name}`;
    this._previewSrc = animal.src;
    await this._activateIllusion(name, animal.id);
    const animalMsg = await ChatMessage.create({ content: game.i18n.format('DSCT.chat.int.animalDisguise', { name: this._actor.name, disguise: name }), flags: { [M]: { intIllusion: { actorId: this._actor.id } } } });
    this._illusionMsgId = animalMsg?.id ?? null;
  }

  async _applyMimic() {
    if (!this._mimicSrc) { ui.notifications.error(game.i18n.localize('DSCT.notice.int.noMimicTarget')); return; }

    const freeMimic = freeMimicsByActor.has(this._actor.id);
    const inCombat  = !!game.combat?.active;

    const isHero = this._actor.type === 'hero';
    if (!freeMimic) {
      if (isHero) {
        if (inCombat) {
          if (this._actor.system.hero.primary.value < 1) { ui.notifications.error(game.i18n.format('DSCT.notice.int.notEnoughInsight', { name: this._actor.name })); return; }
        } else {
          const usedAt = this._actor.getFlag('world', INT_OOC_FLAG);
          if (usedAt !== undefined && usedAt !== null && this._actor.system.hero.victories === usedAt) { ui.notifications.error(game.i18n.localize('DSCT.notice.int.alreadyUsedOutsideCombat')); return; }
        }
      } else {
        if ((game.actors.malice?.value ?? 0) < 1) { ui.notifications.error(game.i18n.localize('DSCT.notice.int.notEnoughMalice')); return; }
      }
    }

    const targetToken = game.users.contents.flatMap(u => [...u.targets]).find(t => t.actor?.id !== this._actor.id);
    if (!targetToken) { ui.notifications.error(game.i18n.localize('DSCT.notice.int.noMimicTarget')); return; }

    const token = this._guardSingleToken();
    if (!token) return;

    const dist = canvas.grid.measurePath([{ x: token.center.x, y: token.center.y }, { x: targetToken.center.x, y: targetToken.center.y }]).distance;
    if (dist > 10) { ui.notifications.warn(game.i18n.format('DSCT.notice.int.targetTooFar', { name: targetToken.name, dist })); return; }

    const mySize     = this._actor.system.combat.size;
    const targetSize = targetToken.actor.system.combat.size;
    if (sizeRank(targetSize) > sizeRank(mySize) + 1) { ui.notifications.warn(game.i18n.format('DSCT.notice.int.targetTooLarge', { name: targetToken.name, targetSize: fmtSize(targetSize), mySize: fmtSize(mySize) })); return; }

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
    await token.document.update(snapAppearance(targetToken.document));
    this._previewSrc = targetToken.document.texture.src;
    await this._activateIllusion(targetToken.name, 'mimic');

    const mimicMsg = await ChatMessage.create({ content: game.i18n.format('DSCT.chat.int.mimic', { name: this._actor.name, target: targetToken.name }), flags: { [M]: { intIllusion: { actorId: this._actor.id } } } });
    this._illusionMsgId = mimicMsg?.id ?? null;
  }

  async _activateIllusion(name, id) {
    const intIcon = getSetting('imNoThreatEffectIcon') || INT_DEFAULT_ICON;
    await this._actor.createEmbeddedDocuments('ActiveEffect', [
      { ...foundry.utils.deepClone(_INT_EFFECT_ABILITY), img: intIcon },
      { ...foundry.utils.deepClone(_INT_EFFECT_PASSIVE), img: intIcon },
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
      if (!chooseKeywords(item, message).has('strike')) return;
      await this._endIllusion(true);
    });
  }

  _clearIllusionState() { this._illusionActive = false; this._disguiseName = null; this._activeId = null; this._illusionMsgId = null; this._previewSrc = null; }

  async _endIllusion(withSurge = false) {
    revertingActors.add(this._actor.id);
    const token = this._getToken();
    if (token) await token.document.update(snapAppearance(this._actor.prototypeToken));
    for (const e of this._actor.effects.filter(e => e.getFlag(M, 'effectType') === 'int')) await e.delete();
    revertingActors.delete(this._actor.id);

    if (this._illusionMsgId) {
      const illusionMsg = game.messages.get(this._illusionMsgId);
      if (illusionMsg) await illusionMsg.setFlag(M, 'intIllusionEnded', true);
    }

    if (withSurge) {
      await this._actor.update({ 'system.hero.surges': (this._actor.system.hero.surges ?? 0) + 1 });
      await ChatMessage.create({ content: game.i18n.format('DSCT.chat.int.illusionShatters', { name: this._actor.name }) });
    }

    if (window._harlequinIllusionRollHook) { Hooks.off('createChatMessage', window._harlequinIllusionRollHook); window._harlequinIllusionRollHook = null; }
    this._clearIllusionState();
    ui.notifications.info(game.i18n.format('DSCT.notice.int.illusionEnded', { name: this._actor.name }));
    this._refreshText();
  }

  async close(options = {}) {
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
  if (!target) { ui.notifications.error(game.i18n.localize('DSCT.notice.int.noTarget')); return; }
  const existing = foundry.applications.instances.get('im-no-threat-panel');
  if (existing) existing.close();
  else new ImNoThreatPanel(target).render({ force: true });
};

export const INT_ANIMAL_DEFAULTS = [
  { id: 'bullfrog',  name: 'Bullfrog',  src: 'icons/creatures/amphibians/bullfrog-glowing-green.webp',         emoji: '🐸' },
  { id: 'chicken',   name: 'Chicken',   src: 'icons/creatures/birds/chicken-hen-white.webp',                   emoji: '🐔' },
  { id: 'crab',      name: 'Crab',      src: 'icons/creatures/fish/crab-blue-purple.webp',                     emoji: '🦀' },
  { id: 'cat',       name: 'Cat',       src: 'icons/creatures/mammals/cat-hunched-glowing-red.webp',           emoji: '🐱' },
  { id: 'dog',       name: 'Dog',       src: 'icons/creatures/mammals/dog-husky-white-blue.webp',              emoji: '🐕' },
  { id: 'rat',       name: 'Rat',       src: 'icons/creatures/mammals/rodent-rat-diseaed-gray.webp',           emoji: '🐀' },
  { id: 'rabbit',    name: 'Rabbit',    src: 'icons/creatures/mammals/rabbit-movement-glowing-green.webp',     emoji: '🐇' },
  { id: 'chameleon', name: 'Chameleon', src: 'icons/creatures/reptiles/chameleon-camouflage-green-brown.webp', emoji: '🦎' },
];

export const getAnimals = () => {
  const stored = game.settings.get(M, 'intAnimals');
  return (Array.isArray(stored) && stored.length) ? stored : INT_ANIMAL_DEFAULTS;
};

const INT_EMOJI_LIST = [
  ['🐕','dog puppy canine'],          ['🐈','cat kitten feline'],
  ['🐭','mouse rodent'],              ['🐹','hamster rodent'],
  ['🐰','rabbit bunny hare'],         ['🐇','rabbit bunny hare'],
  ['🐶','dog canine'],                ['🐩','poodle dog'],
  ['🦮','guide dog service'],         ['🐱','cat feline'],
  ['🐈‍⬛','black cat feline'],
  ['🦊','fox'],                       ['🐻','bear'],
  ['🐼','panda bear'],                ['🐨','koala'],
  ['🐯','tiger'],                     ['🦁','lion'],
  ['🐮','cow bull bovine'],           ['🐷','pig hog pork'],
  ['🐴','horse'],                     ['🦄','unicorn horse'],
  ['🐺','wolf'],                      ['🐗','boar pig wild'],
  ['🐵','monkey'],                    ['🙈','monkey see no evil'],
  ['🙉','monkey hear no evil'],       ['🙊','monkey speak no evil'],
  ['🦍','gorilla ape'],               ['🦧','orangutan ape'],
  ['🦣','mammoth elephant'],          ['🐘','elephant'],
  ['🦏','rhinoceros rhino'],          ['🦛','hippo rhinoceros'],
  ['🐪','camel dromedary'],           ['🐫','camel bactrian hump'],
  ['🦒','giraffe'],                   ['🦘','kangaroo'],
  ['🦬','bison buffalo'],             ['🐃','water buffalo bovine'],
  ['🐂','bull ox bovine'],            ['🐄','cow bovine'],
  ['🐎','horse equine'],              ['🐖','pig hog'],
  ['🐏','ram sheep'],                 ['🐑','sheep ewe lamb'],
  ['🦙','llama'],                     ['🐐','goat'],
  ['🦌','deer stag reindeer'],        ['🦝','raccoon'],
  ['🦨','skunk'],                     ['🦡','badger'],
  ['🦫','beaver'],                    ['🦦','otter'],
  ['🦥','sloth'],                     ['🐁','mouse rodent'],
  ['🐀','rat rodent'],                ['🐿️','chipmunk squirrel'],
  ['🦔','hedgehog'],                  ['🐅','tiger big cat'],
  ['🐆','leopard cheetah panther'],   ['🦓','zebra'],
  ['🦍','gorilla primate'],
  ['🐔','chicken hen'],               ['🐧','penguin'],
  ['🐦','bird'],                      ['🐤','chick baby bird'],
  ['🦆','duck waterfowl'],            ['🦅','eagle raptor'],
  ['🦉','owl'],                       ['🦇','bat'],
  ['🦜','parrot'],                    ['🦢','swan'],
  ['🦩','flamingo'],                  ['🕊️','dove pigeon peace'],
  ['🐓','rooster chicken'],           ['🦃','turkey'],
  ['🦤','dodo bird'],                 ['🦚','peacock'],
  ['🪶','feather bird'],              ['🐦‍⬛','raven crow black bird'],
  ['🐸','frog toad amphibian bullfrog'], ['🐢','turtle tortoise'],
  ['🐍','snake serpent'],             ['🦎','lizard reptile chameleon'],
  ['🦖','dinosaur t-rex'],            ['🦕','dinosaur sauropod brontosaurus'],
  ['🐊','crocodile alligator'],       ['🐲','dragon'],
  ['🐉','dragon'],
  ['🐙','octopus'],                   ['🦑','squid'],
  ['🦐','shrimp prawn'],              ['🦞','lobster'],
  ['🦀','crab'],                      ['🐡','blowfish puffer'],
  ['🐠','tropical fish'],             ['🐟','fish'],
  ['🐬','dolphin'],                   ['🐋','whale'],
  ['🐳','whale'],                     ['🦈','shark'],
  ['🦭','seal'],
  ['🐝','bee honeybee'],              ['🪱','worm'],
  ['🐛','caterpillar bug larva'],     ['🦋','butterfly'],
  ['🐌','snail'],                     ['🐞','ladybug ladybird beetle'],
  ['🐜','ant'],                       ['🦟','mosquito'],
  ['🦗','cricket grasshopper'],       ['🦂','scorpion'],
  ['🕷️','spider'],              ['🪲','beetle bug'],
  ['🪳','cockroach bug'],             ['🦠','microbe germ bacteria virus'],
  ['🌿','herb plant leaf'],           ['🍄','mushroom fungus'],
  ['🐚','shell spiral'],              ['🌺','flower hibiscus'],
  ['🌸','blossom cherry flower'],     ['🌻','sunflower'],
  ['🌹','rose flower'],               ['🌵','cactus'],
  ['🌲','tree pine evergreen'],       ['🌳','tree deciduous'],
  ['🍀','clover shamrock'],           ['🪸','coral reef'],
  ['🌾','sheaf wheat grain'],         ['🪨','rock stone'],
  ['🐲','dragon fantasy'],            ['🦄','unicorn'],
  ['👻','ghost spirit'],              ['💀','skull death'],
  ['☠️','skull crossbones poison'], ['🎭','masks theater drama'],
  ['🃏','joker card wild'],           ['🎩','top hat magic'],
  ['🪄','magic wand'],               ['🔮','crystal ball magic'],
  ['🧙','wizard mage sorcerer'],      ['🧝','elf'],
  ['🧟','zombie undead'],             ['🧛','vampire'],
  ['🧜','mermaid fish human'],        ['🧚','fairy'],
  ['⚔️','sword crossed weapons'],   ['🗡️','dagger knife'],
  ['🏹','bow arrow archery'],         ['🛡️','shield defense'],
  ['🪃','boomerang'],                 ['🔱','trident'],
  ['🔥','fire flame'],                ['💧','water drop'],
  ['❄️','snowflake ice cold'],      ['⚡','lightning bolt electric'],
  ['🌊','wave water ocean'],          ['🌙','moon crescent night'],
  ['⭐','star'],                         ['🌟','glowing star'],
  ['💫','dizzy star'],                ['🌈','rainbow'],
  ['🌪️','tornado wind'],        ['☁️','cloud'],
  ['🌑','new moon dark'],             ['☀️','sun'],
  ['🎲','dice random'],               ['🎪','circus tent'],
  ['🥚','egg'],                       ['🪹','nest'],
  ['🦴','bone'],                      ['🐾','paw footprint'],
  ['🌀','cyclone spiral'],            ['👁️','eye watching'],
  ['🫀','heart organ'],               ['🧠','brain mind'],
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
    `<button type="button" class="dsct-emoji-btn" title="${e}" data-emoji="${e}">${e}</button>`
  ).join('');
};

const _getOrCreatePicker = () => {
  if (_pickerEl) return _pickerEl;

  const el  = document.createElement('div');
  el.id     = 'dsct-int-emoji-picker';
  el.className = 'dsct-emoji-picker';

  el.innerHTML = `
    <input id="dsct-int-epicker-search" type="text" placeholder="Search emojis" class="dsct-emoji-picker-search">
    <div id="dsct-int-epicker-grid" class="dsct-emoji-grid"></div>`;

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

const DEFAULT_ICON = 'icons/creatures/mammals/humanoid-fox-cat-archer.webp';
const buildRow = (idx, animal) => `
  <tr>
    <td>
      <button type="button" class="dsct-int-icon-pick" data-idx="${idx}" title="Click to change icon">
        <img src="${animal.src || DEFAULT_ICON}" class="dsct-wb-icon-img">
      </button>
      <input type="hidden" name="src-${idx}"  value="${animal.src || DEFAULT_ICON}">
      <input type="hidden" name="anid-${idx}" value="${animal.id}">
    </td>
    <td>
      <input type="text" name="name-${idx}" value="${animal.name}" placeholder="Name" class="dsct-name-input">
    </td>
    <td>
      <button type="button" class="dsct-int-emoji-trigger" data-idx="${idx}" title="Pick emoji">
        ${animal.emoji || '+'}
      </button>
      <input type="hidden" name="emoji-${idx}" value="${animal.emoji ?? ''}">
    </td>
    <td>
      <button type="button" class="dsct-int-delete-animal dsct-delete-btn" title="Remove animal">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </td>
  </tr>`;

export class ImNoThreatSettingsMenu extends ds.applications.api.DSApplication {
  static DEFAULT_OPTIONS = {
    id:       'dsct-int-settings',
    classes:  ['draw-steel'],
    window:   { title: 'DSCT.panel.title.ImNoThreatSettings', minimizable: false, resizable: true },
    position: { width: 480, height: 'auto' },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/settings/ability-automation.hbs' },
  };

  async _prepareContext(_options) {
    const animals = getAnimals();
    return {
      rowsHTML: animals.map((a, idx) => buildRow(idx, a)).join(''),
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
    const el = this.element;

    el.addEventListener('click', e => {
      const pickBtn = e.target.closest('.dsct-int-icon-pick');
      if (pickBtn) {
        const idx = pickBtn.dataset.idx;
        new FilePicker({
          type:     'imagevideo',
          current:  el.querySelector(`[name="src-${idx}"]`)?.value || '',
          callback: (path) => {
            el.querySelector(`[name="src-${idx}"]`).value = path;
            pickBtn.querySelector('img').src = path;
          },
        }).browse();
        return;
      }

      const emojiBtn = e.target.closest('.dsct-int-emoji-trigger');
      if (emojiBtn) {
        const idx = emojiBtn.dataset.idx;
        _openPicker(emojiBtn, (emoji) => {
          el.querySelector(`[name="emoji-${idx}"]`).value = emoji;
          emojiBtn.textContent = emoji;
        });
        return;
      }

      const delBtn = e.target.closest('.dsct-int-delete-animal');
      if (delBtn) delBtn.closest('tr').remove();
    });

    el.querySelector('#dsct-int-add-btn')?.addEventListener('click', () => {
      const tbody  = el.querySelector('#dsct-int-animal-tbody');
      const rows   = [...tbody.querySelectorAll('tr')];
      const maxIdx = Math.max(-1, ...rows.map(tr => {
        const inp = tr.querySelector('[name^="anid-"]');
        return inp ? (parseInt(inp.name.replace('anid-', '')) || 0) : -1;
      }));
      tbody.innerHTML += buildRow(maxIdx + 1, { id: foundry.utils.randomID(), name: '', src: DEFAULT_ICON, emoji: '' });
    });

    el.querySelector('#dsct-int-reset-btn')?.addEventListener('click', async () => {
      await game.settings.set(M, 'intAnimals', []);
      ui.notifications.info(game.i18n.localize('DSCT.notice.int.animalsReset'));
      this.render({ force: true });
    });

    el.querySelector('#dsct-int-save-btn')?.addEventListener('click', async () => {
      await this._doSave();
      this.close();
    });

    Hooks.once('closeImNoThreatSettingsMenu', () => _closePicker());
  }

  async _doSave() {
    const el        = this.element;
    const animals   = [];
    const seenNames = new Set();

    el.querySelectorAll('#dsct-int-animal-tbody tr').forEach(tr => {
      const name  = (tr.querySelector('[name^="name-"]')?.value  ?? '').trim();
      const src   =  tr.querySelector('[name^="src-"]')?.value   || DEFAULT_ICON;
      const emoji = (tr.querySelector('[name^="emoji-"]')?.value ?? '').trim();
      const id    =  tr.querySelector('[name^="anid-"]')?.value  || foundry.utils.randomID();
      if (!name) return;
      if (seenNames.has(name)) { ui.notifications.warn(game.i18n.format('DSCT.notice.int.duplicateAnimal', { name })); return; }
      seenNames.add(name);
      animals.push({ id, name, src, emoji });
    });

    await game.settings.set(M, 'intAnimals', animals);
    Hooks.callAll('dsct.intAnimalsUpdated');
    ui.notifications.info(game.i18n.localize('DSCT.notice.int.animalSettingsSaved'));
    foundry.utils.debouncedReload();
  }
}

export const registerImNoThreatHooks = () => {
  Hooks.on('renderChatMessageHTML', (msg, el) => {
    let _ba = null;
    const btnArea = () => {
      if (!_ba) {
        _ba = el.querySelector('.message-part-buttons');
        if (!_ba) {
          _ba = document.createElement('div');
          _ba.className = 'message-part-buttons';
          (el.querySelector('.message-content') ?? el).appendChild(_ba);
        }
      }
      return _ba;
    };
    const dsid = msg.getFlag(M, 'abilityDsid');

    if (getSetting('imNoThreatEnabled') && dsid === 'im-no-threat') {
      const actorId       = msg.speaker?.actor ?? null;
      const spendDetected = !!(actorId && msg.flavor?.toLowerCase().startsWith('spent '));
      const mimicUsed     = !!msg.getFlag('draw-steel-combat-tools', 'intFreeMimicUsed');

      if (spendDetected && !mimicUsed && !grantedMimicMsgs.has(msg.id)) {
        freeMimicsByActor.set(actorId, msg.id);
        grantedMimicMsgs.add(msg.id);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-im-no-threat-btn';
      btn.innerHTML = `<i class="fa-solid fa-masks-theater"></i> ${game.i18n.localize('DSCT.button.imNoThreat')}`;
      btn.style.cssText = 'cursor:pointer;';
      btn.addEventListener('click', (e) => { e.preventDefault(); getModuleApi(false)?.imNoThreat(game.actors.get(actorId) ?? null); });
      btnArea().appendChild(btn);

      if (spendDetected) {
        const badge = document.createElement('div');
        badge.className = 'dsct-int-spend-badge';
        if (mimicUsed) {
          badge.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize('DSCT.button.freeMimicUsed')}`;
          badge.style.cssText = 'margin-top:4px;font-size:0.82em;opacity:0.4;padding:2px 0;';
        } else {
          badge.innerHTML = `<i class="fa-solid fa-bolt"></i> ${game.i18n.localize('DSCT.button.spentInsight')}`;
          badge.style.cssText = 'margin-top:4px;font-size:0.82em;opacity:0.7;padding:2px 0;';
        }
        btnArea().appendChild(badge);
      }
    }

    if (msg.getFlag(M, 'intIllusion')) {
      const ended = !!msg.getFlag(M, 'intIllusionEnded');
      if (ended) {
        const notice = document.createElement('div');
        notice.className = 'dsct-int-broken';
        notice.innerHTML = `<em>${game.i18n.localize('DSCT.button.illusionBroken')}</em>`;
        notice.style.cssText = 'margin-top:6px;opacity:0.6;font-size:0.9em;';
        btnArea().appendChild(notice);
      } else {
        const actorId = msg.getFlag(M, 'intIllusion')?.actorId;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsct-int-end-btn';
        btn.innerHTML = `<i class="fa-solid fa-masks-theater"></i> ${game.i18n.localize('DSCT.button.endIllusion')}`;
        btn.style.cssText = 'cursor:pointer;margin-top:4px;';
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const actor = game.actors.get(actorId);
          if (!actor) return;
          const panel = foundry.applications.instances.get('im-no-threat-panel');
          if (panel?._actor?.id === actorId) await panel._endIllusion(false);
          else if (window._endHarlequinIllusion) await window._endHarlequinIllusion(false);
        });
        btnArea().appendChild(btn);
      }
    }
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
      if (tokenDoc) await tokenDoc.update(snapAppearance(actor.prototypeToken));
      const panel = foundry.applications.instances.get('im-no-threat-panel');
      if (panel?._actor?.id === actor.id) { panel._clearIllusionState(); panel._refreshText(); }
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
      if (tokenDoc) await tokenDoc.update(snapAppearance(actor.prototypeToken));
      for (const e of illusionEffects) await e.delete();
      const panel = foundry.applications.instances.get('im-no-threat-panel');
      if (panel?._actor?.id === actor.id) panel.close();
      ended++;
    }
    if (ended) ui.notifications.info(game.i18n.format('DSCT.notice.int.illusionsEndedSettings', { count: ended, s: ended > 1 ? 's' : '' }));
  });
};
