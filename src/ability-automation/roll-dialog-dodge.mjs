import { getSetting } from '../helpers.mjs';

const PAD = 12;
const GROWTH = 16;
const STEP = 24;
const PRIMARY_WEIGHT = 1000;
const SECONDARY_WEIGHT = 10;

const boxOf = (el) => {
  const r = el?.getBoundingClientRect?.();
  return r?.width && r?.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
};

const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
  * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

function tokenBox(token) {
  const { x, y, width, height } = token.bounds;
  const a = canvas.clientCoordinatesFromCanvas({ x, y });
  const b = canvas.clientCoordinatesFromCanvas({ x: x + width, y: y + height });
  return { l: a.x - PAD, t: a.y - PAD, r: b.x + PAD, b: b.y + PAD };
}

function watchedTokens(app) {
  const tokens = new Set();
  const add = (token) => { if (token?.visible && token.scene === canvas.scene) tokens.add(token); };
  const current = game.combat?.combatant;
  if (current) {
    const group = current.group;
    const members = group?.members?.size > 1 ? [...group.members] : [current];
    for (const member of members) if (!member.isDefeated) add(member.token?.object);
  }
  for (const token of game.user.targets) add(token);
  for (const target of Object.values(app.options?.context?.targets ?? {})) {
    add(target?.token?.object ?? (target?.tokenUuid ? fromUuidSync(target.tokenUuid)?.object : null));
  }
  return [...tokens];
}

function uiBoxes(app) {
  const boxes = [];
  const add = (el) => { const box = boxOf(el); if (box) boxes.push(box); };
  add(ui.sidebar?.expanded ? ui.sidebar.element : document.getElementById('sidebar-tabs'));
  for (const el of document.getElementById('chat-notifications')?.children ?? []) add(el);
  for (const other of foundry.applications.instances.values()) {
    if (other !== app && other.rendered && !other.minimized && other.hasFrame) add(other.element);
  }
  return boxes;
}

function dodge(app) {
  if (!canvas?.ready || !app.element) return;
  const primary = watchedTokens(app).map(tokenBox);
  const secondary = uiBoxes(app);
  const start = boxOf(app.element);
  if (!start) return;
  const width = start.r - start.l;
  const height = start.b - start.t + GROWTH;
  const middle = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const hits = (l, t) => {
    const box = { l, t, r: l + width, b: t + height };
    let sum = 0;
    for (const r of primary) sum += overlap(box, r) * PRIMARY_WEIGHT;
    for (const r of secondary) sum += overlap(box, r) * SECONDARY_WEIGHT;
    return sum;
  };
  const cost = (l, t) => hits(l, t) + Math.hypot(l + width / 2 - middle.x, t + height / 2 - middle.y);
  const maxLeft = Math.max(0, window.innerWidth - width);
  const maxTop = Math.max(0, window.innerHeight - height);
  const centred = { l: Math.round(maxLeft / 2), t: Math.round(maxTop / 2) };
  let best = { ...centred, cost: cost(centred.l, centred.t) };
  for (let t = 0; t <= maxTop; t += STEP) {
    for (let l = 0; l <= maxLeft; l += STEP) {
      const c = cost(l, t);
      if (c < best.cost) best = { l, t, cost: c };
    }
  }
  if (Math.abs(best.l - start.l) >= 1 || Math.abs(best.t - start.t) >= 1) app.setPosition({ left: best.l, top: best.t });
}

function whenSettled(app, done) {
  let last = -1;
  let still = 0;
  let frames = 0;
  const tick = () => {
    if (!app.rendered) return done();
    const height = app.element.offsetHeight;
    still = height === last ? still + 1 : 0;
    last = height;
    if (still >= 2 || ++frames > 20) return done();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function registerRollDialogDodge() {
  Hooks.on('renderRollDialog', (app, element, _context, options) => {
    if (!options?.isFirstRender) return;
    if (!getSetting('abilityAutomationEnabled') || !getSetting('rollDialogDodge')) return;
    element.style.opacity = '0';
    whenSettled(app, () => {
      try { if (app.rendered) dodge(app); } catch (err) { console.warn('DSCT | roll window could not move out of the way', err); }
      element.style.opacity = '';
    });
  });
}
