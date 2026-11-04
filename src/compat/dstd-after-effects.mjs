import { registerPanelDecorator } from '../ctlib.mjs';

const WRAP = 'dsct-after-effects';

export function registerDstdAfterEffects() {
  registerPanelDecorator({ id: 'combat-tools-after-effects', priority: 950, ignore: [`.${WRAP}`], decorate: ({ root, panel }) => {
    if (!panel) return;
    
    const moved = root?.querySelector(`.${WRAP}`);
    if (moved) { if (panel.nextElementSibling !== moved) panel.after(moved); return; }
    const after = root?.querySelector('section.effect.after');
    if (!after?.textContent.trim()) return;
    const embed = after.closest('[data-subtype]') ?? after.parentElement;
    const wrap = document.createElement(embed.tagName);
    wrap.className = `${embed.className} ${WRAP}`;
    if (embed.dataset.subtype) wrap.dataset.subtype = embed.dataset.subtype;
    wrap.append(after);
    panel.after(wrap);
  } });
}
