import { DSTD, registerPanelDecorator } from '../ctlib.mjs';

export const applyHideApplyWord = (on) => document.body.classList.toggle('dsct-hide-apply-word', !!on);

const _prefix = (key, slot) => {
  const text = game.i18n.localize(key);
  const at = text.indexOf(slot);
  return at > 0 ? text.slice(0, at) : null;
};

let _prefixes = null;
const prefixes = () => _prefixes ??= [...new Set([
  _prefix('DSTD.Chat.ApplyStatus', '{name}'),
  _prefix('DSCT.button.applyCondition', '{label}'),
])].filter((p) => p?.trim());

function _wrap(button) {
  if (button.querySelector('.dsct-apply-word')) return;
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim()) continue;
    const lead = node.data.match(/^\s*/)[0];
    const rest = node.data.slice(lead.length);
    const prefix = prefixes().find((p) => rest.startsWith(p));
    if (!prefix) return;
    const word = document.createElement('span');
    word.className = 'dsct-apply-word';
    word.textContent = lead + prefix;
    node.parentNode.insertBefore(word, node);
    node.data = rest.slice(prefix.length);
    return;
  }
}

export function registerDstdApplyWord() {
  registerPanelDecorator({ id: 'combat-tools-apply-word', priority: 900, watch: 'any', retry: [400, 1200], decorate: ({ root }) => {
    for (const button of root?.querySelectorAll(`.${DSTD}-action-button`) ?? []) {
      if (!button.closest('.dsct-dstd-global-row')) _wrap(button);
    }
  } });
}
