import { runTransform } from './transformation.mjs';
import { getSetting, getModuleApi, monsterFilter as filter } from '../helpers.mjs';

const M        = 'draw-steel-combat-tools';
const _abyssal = filter.keyword('abyssal');
const _minion  = filter.organization('minion');
const _horde   = filter.organization('horde');

export const triggerAbyssalEvolution = () => runTransform(
  (t) => !t.document.hidden && _minion(t.actor) && _abyssal(t.actor),
  (tok) => game.actors
    .filter(a => a.type === 'npc' && _horde(a) && _abyssal(a) && filter.sameLevel(tok)(a))
    .sort((a, b) => a.name.localeCompare(b.name)),
  'DSCT.panel.title.AbyssalEvolution',
  { color: 0x9900cc, hint: 'Click an abyssal minion to evolve. Right-click to cancel.' }
);

export const registerMaliceInjectors = () => {
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

    if (getSetting('abyssalEvolutionEnabled') && dsid === 'abyssal-evolution') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-abyssal-evo-btn';
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${game.i18n.localize('DSCT.button.abyssalEvolution')}`;
      btn.style.cssText = 'cursor:pointer;';
      btn.addEventListener('click', (e) => { e.preventDefault(); getModuleApi(false)?.abyssalEvolution(); });
      btnArea().appendChild(btn);
    }
  });
};
