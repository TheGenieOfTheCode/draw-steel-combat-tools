import { setTip, tipFor } from './chat-tips.mjs';

export function markManualText(root) {
  for (const el of root?.querySelectorAll?.('.dsct-manual:not([data-dsct-tip])') ?? []) setTip(el, tipFor('manual'));
}

export function registerManualText() {
  const mark = (_doc, html) => markManualText(html instanceof HTMLElement ? html : html?.[0]);
  Hooks.on('renderChatMessageHTML', mark);
  Hooks.on('renderDrawSteelItemSheet', mark);
  Hooks.on('renderJournalEntrySheet', mark);
}
