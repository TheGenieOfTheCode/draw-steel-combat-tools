import { getSetting, segmentBlocksSight, spaceSamplePoints, clampOutsetPoints, tokFootprintDist, hasSightToToken, atLeastHalfBlocked } from '../helpers.mjs';
import { registerEffectFlag } from '../effect-flag-picker.mjs';

const M = 'draw-steel-combat-tools';
export const TRAIT_KEY = 'stealth';
const FLAG_ROOT = `flags.${M}.${TRAIT_KEY}`;

export const COVER_COUNTS = ['', 'allies', 'creatures'];

export const coverRank = (v) => Math.max(0, COVER_COUNTS.indexOf(v ?? ''));
export const widestCover = (a, b) => (coverRank(a) >= coverRank(b) ? (a ?? '') : (b ?? ''));

const _actorOf = (subject) => subject?.actor ?? (subject?.documentName === 'Actor' ? subject : null);

const on = (v) => v === true || v === 1 || /^(true|1|yes|on)$/i.test(String(v ?? '').trim());

export function stealthTraits(subject) {
  const out = {
    hideWhileObserved: false,
    keepsHidden: false,
    movementKeeps: new Set(),
    coverCounts: '',
    maintain: '',
    cannotBeHiddenFrom: [],
    cannotHide: false,
    ignoresConcealmentBane: false,
    ignoresCoverBane: false,
    concealmentBaneDoubled: false,
    any: false,
  };
  const f = _actorOf(subject)?.flags?.[M]?.[TRAIT_KEY];
  if (!f || typeof f !== 'object') return out;

  if (on(f.hideWhileObserved)) out.hideWhileObserved = true;
  if (on(f.keepsHidden)) out.keepsHidden = true;
  if (on(f.moveFreely)) out.movementKeeps.add('any');
  if (on(f.moveThroughOccupied)) out.movementKeeps.add('occupied');
  if (on(f.creaturesAreCover)) out.coverCounts = 'creatures';
  else if (on(f.alliesAreCover)) out.coverCounts = 'allies';
  if (on(f.staysHiddenAnywhere)) out.maintain = 'always';
  if (on(f.cannotBeHiddenFrom)) out.cannotBeHiddenFrom.push(Math.max(0, Number(f.cannotBeHiddenRange) || 0));
  if (on(f.cannotHide)) out.cannotHide = true;
  if (on(f.ignoresConcealmentBane)) out.ignoresConcealmentBane = true;
  if (on(f.ignoresCoverBane)) out.ignoresCoverBane = true;
  if (on(f.concealmentBaneDoubled)) out.concealmentBaneDoubled = true;

  out.any = out.hideWhileObserved || out.keepsHidden || out.movementKeeps.size > 0
    || !!out.coverCounts || !!out.maintain || out.cannotBeHiddenFrom.length > 0
    || out.cannotHide || out.ignoresConcealmentBane || out.ignoresCoverBane || out.concealmentBaneDoubled;
  return out;
}

export const forbiddenToHide = (subject) => stealthTraits(subject).cannotHide || exposedNow(subject);

const _changesOf = (effect) => [...(effect.system?.changes ?? []), ...(effect.changes ?? [])];


const _applierToken = (effect) => {
  const tokenId = effect.getFlag?.(M, 'flatAppliedSource')?.tokenId;
  if (tokenId && canvas.tokens?.get(tokenId)) return canvas.tokens.get(tokenId);
  const origin = effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
  const actor = origin?.documentName === 'Actor' ? origin : origin?.actor ?? origin?.parent?.actor ?? null;
  return actor?.getActiveTokens?.()?.[0] ?? null;
};


export function exposedNow(subject) {
  const actor = _actorOf(subject);
  const token = subject?.actor ? subject : actor?.getActiveTokens?.()?.[0];
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled) continue;
    const changes = _changesOf(effect);
    if (!changes.some(c => String(c?.key ?? '').endsWith(`${TRAIT_KEY}.exposed`) && on(c.value))) continue;
    const range = Math.max(0, Number(changes.find(c => String(c?.key ?? '').endsWith(`${TRAIT_KEY}.exposedRange`))?.value) || 0);
    if (!range) return true;
    const applier = _applierToken(effect);
    if (applier && token && tokFootprintDist(applier, token) < range * canvas.grid.distance) return true;
  }
  return false;
}

export function huntedBy(hider) {
  const actor = _actorOf(hider);
  const out = [];
  for (const effect of (actor?.effects ?? [])) {
    if (effect.disabled) continue;
    const changes = [...(effect.system?.changes ?? []), ...(effect.changes ?? [])];
    if (!changes.some(c => String(c?.key ?? '').endsWith(`${TRAIT_KEY}.observedBy`) && on(c.value))) continue;
    const tokenId = effect.getFlag?.(M, 'flatAppliedSource')?.tokenId;
    if (tokenId) out.push(tokenId);
  }
  return out;
}

export function observerBlocksHiding(observer, hider) {
  if (observer?.id && huntedBy(hider).includes(observer.id)) return true;
  if (exposedNow(hider)) return true;

  const ranges = stealthTraits(observer).cannotBeHiddenFrom;
  if (!ranges.length) return false;
  if (ranges.includes(0)) return true;

  const dist = tokFootprintDist(observer, hider);
  return ranges.some(r => dist < r * canvas.grid.distance);
}

const _rectOf = (token) => {
  const GS = canvas.grid.size;
  const doc = token.document;
  return {
    x: doc.x,
    y: doc.y,
    w: Math.max(1, Math.round(doc.width)) * GS,
    h: Math.max(1, Math.round(doc.height)) * GS,
  };
};

const _segmentCrossesRect = (a, b, r) => {
  const inside = (p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const edges = [
    [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
    [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }],
    [{ x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
    [{ x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }],
  ];
  return edges.some(([c, d]) => foundry.utils.lineSegmentIntersects(a, b, c, d));
};

function _blockers(observer, hider, mode) {
  const side = hider.document?.disposition;
  return (canvas.tokens?.placeables ?? [])
    .filter(t => t.id !== hider.id && t.id !== observer.id && t.actor)
    .filter(t => !t.document.hidden)
    .filter(t => mode === 'creatures' || t.document.disposition === side)
    .map(_rectOf);
}

export function coverCountingCreatures(observer, hider, mode) {
  if (!mode || !observer || !hider) return false;
  if (!hasSightToToken(observer, hider)) return false;

  const blockers = _blockers(observer, hider, mode);
  if (!blockers.length) return false;

  const o = _rectOf(observer);
  const h = _rectOf(hider);
  const _pts = (r) => clampOutsetPoints(
    spaceSamplePoints(r.x, r.y, r.w, r.h),
    { x: r.x + r.w / 2, y: r.y + r.h / 2 },
  ).slice(1);

  const corners = _pts(h);
  const origins = getSetting('trueDrawSteelLos')
    ? _pts(o)
    : [{ x: o.x + o.w / 2, y: o.y + o.h / 2 }];

  let best = 0;
  for (const origin of origins) {
    let seen = 0;
    for (const corner of corners) {
      if (segmentBlocksSight(origin, corner)) continue;
      if (blockers.some(r => _segmentCrossesRect(origin, corner, r))) continue;
      seen++;
    }
    if (seen > best) best = seen;
  }
  return atLeastHalfBlocked(best, corners.length);
}

const FLAGS = [
  'hideWhileObserved', 'keepsHidden', 'moveFreely', 'moveThroughOccupied',
  'alliesAreCover', 'creaturesAreCover', 'staysHiddenAnywhere', 'cannotBeHiddenFrom',
  'cannotHide', 'ignoresConcealmentBane', 'ignoresCoverBane', 'concealmentBaneDoubled', 'observedBy', 'exposed',
];

export function registerStealthTraits() {
  const def = (name, extra = {}) => ({
    key: `${FLAG_ROOT}.${name}`,
    category: 'stealth',
    label: `DSCT.effectFlags.stealth.${name}.label`,
    description: `DSCT.effectFlags.stealth.${name}.description`,
    values: `DSCT.effectFlags.stealth.${name}.values`,
    ...extra,
  });
  for (const name of FLAGS) registerEffectFlag('actor', def(name));
  registerEffectFlag('actor', def('cannotBeHiddenRange', { type: 'override', value: '2' }));
  registerEffectFlag('actor', def('exposedRange', { type: 'override', value: '20' }));
  registerEffectFlag('actor', def('searchBanes', { type: 'add', value: '1' }));
  registerEffectFlag('actor', def('searchEdges', { type: 'add', value: '1' }));
}
