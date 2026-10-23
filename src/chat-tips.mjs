

let _active = null;

function _dodge(el) {
  const tip = game.tooltip?.tooltip;
  const card = el.closest('.chat-message');
  if (!tip || !card) return;
  const left = card.getBoundingClientRect().left - tip.offsetWidth - 10;
  if (left >= 8) tip.style.left = `${left}px`;
}

function _open(el) {
  _active = el;
  game.tooltip.activate(el, { html: el.dataset.dsctTip, cssClass: el.dataset.dsctTipClass, direction: 'LEFT' });
  requestAnimationFrame(() => { if (_active === el) _dodge(el); });
}

function _close() {
  _active = null;
  game.tooltip.deactivate();
}

export function registerChatTips() {
  
  document.body.addEventListener('pointerover', (event) => {
    const el = event.target.closest?.('[data-dsct-tip]');
    if (el && el !== _active && el.dataset.dsctTip) setTimeout(() => { if (el.matches(':hover')) _open(el); }, 0);
  }, { passive: true });
  document.body.addEventListener('pointerout', (event) => {
    if (!_active || _active.contains(event.relatedTarget)) return;
    if (event.target.closest?.('[data-dsct-tip]') === _active) _close();
  }, { passive: true });
}
