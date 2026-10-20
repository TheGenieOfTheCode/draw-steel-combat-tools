

export const compactPillHTML = (shortHTML, bodyHTML) =>
  `${shortHTML ? `<span class="dsct-pill-short" aria-hidden="true">${shortHTML}</span>` : ''}<span class="dsct-pill-body">${bodyHTML}</span>`;

export const applyCompactPills = (on) => {
  document.body.classList.toggle('dsct-compact-pills', !!on);
  if (!on) closePill();
};

let openPill = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function setOpen(pill, open) {
  for (const a of pill.getAnimations()) a.cancel();
  const from = pill.getBoundingClientRect();
  pill.classList.toggle('dsct-pill-open', open);
  if ((globalThis.ctlib?.reducedEffects?.() ?? reducedMotion.matches) || !pill.isConnected) return;
  const to = pill.getBoundingClientRect();
  if (Math.abs(to.width - from.width) < 1 && Math.abs(to.height - from.height) < 1) return;
  pill.classList.add('dsct-pill-growing');
  const anim = pill.animate([
    { width: `${from.width}px`, height: `${from.height}px` },
    { width: `${to.width}px`, height: `${to.height}px` },
  ], { duration: open ? 160 : 120, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
  const done = () => pill.classList.remove('dsct-pill-growing');
  anim.addEventListener('finish', done);
  anim.addEventListener('cancel', done);
}

const closePill = () => {
  if (openPill?.isConnected) setOpen(openPill, false);
  openPill = null;
};

document.addEventListener('pointerover', (event) => {
  if (!document.body.classList.contains('dsct-compact-pills')) return;
  const pill = event.target.closest?.('.chat-message .dsct-source-pill');
  if (pill?.querySelector(':scope > .dsct-pill-short')) {
    if (pill === openPill) return;
    closePill();
    setOpen(pill, true);
    openPill = pill;
    return;
  }
  if (openPill && !(openPill.isConnected && openPill.parentElement?.contains(event.target))) closePill();
});
document.documentElement.addEventListener('pointerleave', closePill);
