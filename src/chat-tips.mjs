

let _active = null;

export const TIP_CLASS = 'draw-steel dsct-rich-tip';

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ''));

export function richTip({ title = '', category = '', body = '', html = '' } = {}) {
  const head = `<header class="metadata"><h3 class="name">${esc(title)}</h3>${category ? `<aside class="category"><h4>${esc(category)}</h4></aside>` : ''}</header>`;
  const content = html || (body ? `<p>${esc(body)}</p>` : '');
  return head + (content ? `<section class="content dsct-tip">${content}</section>` : '');
}

export function tipFor(key, { title, category, body, data = {} } = {}) {
  const loc = (part) => {
    const id = `DSCT.tip.${key}.${part}`;
    return game.i18n.has(id) ? game.i18n.format(id, data) : '';
  };
  return { title: title ?? loc('title'), category: category ?? loc('category'), body: body ?? loc('body') };
}

export function setTip(el, spec) {
  if (!el) return el;
  const html = typeof spec === 'string' ? spec : richTip(spec);
  if (el.dataset.dsctTip === html) return el;
  el.dataset.dsctTip = html;
  el.dataset.dsctTipClass = TIP_CLASS;
  delete el.dataset.tooltip;
  el.removeAttribute('title');
  if (_active === el) _open(el);
  return el;
}

export function pillTip({ title = '', category = '', src = '', hint = '' } = {}) {
  const lines = [src ? game.i18n.format('DSCT.tip.pillFrom', { source: src }) : '', hint].filter(Boolean);
  return richTip({ title, category, html: lines.map((line) => `<p>${esc(line)}</p>`).join('') });
}

export function richBarButtons(category) {
  for (const button of document.querySelectorAll('#dsct-picker-topbar .dsct-picker-extra[data-tooltip]')) {
    const label = [...button.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    setTip(button, { title: label, category, body: button.dataset.tooltip });
  }
}

export const tipAttrs = (spec) => {
  const html = typeof spec === 'string' ? spec : richTip(spec);
  return `data-dsct-tip="${esc(html)}" data-dsct-tip-class="${TIP_CLASS}"`;
};

function _dodge(el) {
  const tip = game.tooltip?.tooltip;
  const card = el.closest('.chat-message');
  if (!tip || !card) return;
  const left = card.getBoundingClientRect().left - tip.offsetWidth - 10;
  if (left >= 8) tip.style.left = `${left}px`;
}

function _open(el) {
  _active = el;
  const inChat = !!el.closest('.chat-message');
  game.tooltip.activate(el, { html: el.dataset.dsctTip, cssClass: el.dataset.dsctTipClass, direction: inChat ? 'LEFT' : undefined });
  if (inChat) requestAnimationFrame(() => { if (_active === el) _dodge(el); });
}

function _close() {
  _active = null;
  game.tooltip.deactivate();
}

function _bind(doc) {
  doc.body.addEventListener('pointerover', (event) => {
    const el = event.target.closest?.('[data-dsct-tip]');
    if (el && el !== _active && el.dataset.dsctTip) setTimeout(() => { if (el.matches(':hover')) _open(el); }, 0);
  }, { passive: true });
  doc.body.addEventListener('pointerout', (event) => {
    if (!_active || _active.contains(event.relatedTarget)) return;
    if (event.target.closest?.('[data-dsct-tip]') === _active) _close();
  }, { passive: true });
}

export function registerChatTips() {
  Handlebars.registerHelper('dsctTip', (key, options) => {
    const { title, category, body, ...data } = options?.hash ?? {};
    return new Handlebars.SafeString(tipAttrs(tipFor(key, { title, category, body, data })));
  });
  _bind(document);
  Hooks.on('openDetachedWindow', (_id, win) => { if (win?.document?.body) _bind(win.document); });
}
