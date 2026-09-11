import { getSetting, hasCover, safeDelete, safeUpdate } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';

const PARKED = {
  INVISIBLE: 'dsctUnusedInvisible',
  BURROW: 'dsctUnusedBurrow',
};

export const STEALTH_STATUSES = {
  dsctHidden: {
    name: 'DSCT.status.hidden',
    img: 'icons/svg/cowled.svg',
  },
  dsctConcMagic: {
    name: 'DSCT.status.concealedMagical',
    img: 'icons/svg/aura.svg',
  },
  dsctConcMundane: {
    name: 'DSCT.status.concealedMundane',
    img: 'icons/svg/light-off.svg',
  },
};

export const HIDDEN = 'dsctHidden';
export const CONCEALED = ['dsctConcMagic', 'dsctConcMundane'];

export const isConcealed = (token) => {
  const statuses = token?.actor?.statuses;
  if (!statuses) return false;
  return statuses.has('invisible') || CONCEALED.some(id => statuses.has(id));
};

function _syncInvisibilityFilter(token) {
  if (!token?.mesh) return;
  const wanted = token.actor?.statuses?.has('invisible') ?? false;
  try {
    token._configureFilterEffect(PARKED.INVISIBLE, wanted);
  } catch (err) {
    console.warn('DSCT | stealth | could not sync the invisibility filter:', err);
  }
}

function _syncActorTokens(actor) {
  for (const token of actor?.getActiveTokens?.() ?? []) _syncInvisibilityFilter(token);
}

export function registerStealthSystem() {
  if (!getSetting('stealthSystemEnabled')) return;

  CONFIG.specialStatusEffects.INVISIBLE = PARKED.INVISIBLE;
  CONFIG.specialStatusEffects.BURROW = PARKED.BURROW;

  for (const [id, value] of Object.entries(STEALTH_STATUSES)) {
    CONFIG.statusEffects[id] = { id, _id: id.padEnd(16, '0'), order: 2, ...value };
  }

  registerHiddenTracking();
  Hooks.on('drawToken', _syncInvisibilityFilter);
  for (const hook of ['createActiveEffect', 'deleteActiveEffect', 'updateActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const actor = effect?.parent;
      if (actor?.documentName === 'Actor') _syncActorTokens(actor);
    });
  }
}

const FLAG = 'hiddenFrom';

const _hiddenEffect = (token) =>
  token?.actor?.appliedEffects?.find(e => e.statuses?.has(HIDDEN)) ?? null;

export function hiddenFrom(token) {
  const effect = _hiddenEffect(token);
  if (!effect) return new Set();

  const ids = effect.getFlag(M, FLAG);
  if (Array.isArray(ids)) return new Set(ids);
  return new Set(canvas.tokens.placeables.filter(t => t.id !== token.id).map(t => t.id));
}

export const isHiddenFrom = (token, observer) =>
  !!observer && hiddenFrom(token).has(observer.id);

export function proposeHide(token) {
  if (!token) return [];
  const disposition = token.document.disposition;
  return canvas.tokens.placeables
    .filter(other => other.id !== token.id && other.actor)
    .filter(other => other.document.disposition !== disposition)
    .filter(other => isConcealed(token) || hasCover(other, token))
    .map(other => other.id);
}

export async function setHiddenFrom(token, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  const effect = _hiddenEffect(token);

  if (!list.length) {
    if (effect) await safeDelete(effect);
    return [];
  }

  if (effect) await safeUpdate(effect, { [`flags.${M}.${FLAG}`]: list });
  else await token.actor?.toggleStatusEffect?.(HIDDEN, { active: true })
    .then(() => safeUpdate(_hiddenEffect(token), { [`flags.${M}.${FLAG}`]: list }));

  return list;
}

export const hide = (token, ids = null) => setHiddenFrom(token, ids ?? proposeHide(token));

export async function reveal(token, observerIds = null) {
  if (!observerIds) return setHiddenFrom(token, []);
  const remaining = [...hiddenFrom(token)].filter(id => !observerIds.includes(id));
  return setHiddenFrom(token, remaining);
}

export async function recheckHidden(moved) {
  if (!game.users.activeGM?.isSelf) return;
  if (!moved) return;

  const trace = [];
  const hiders = canvas.tokens.placeables.filter(t => _hiddenEffect(t));
  for (const hider of hiders) {
    if (hider !== moved && !hiddenFrom(hider).has(moved.id)) { trace.push(`${hider.name}: not affected by ${moved.name} moving`); continue; }

    const concealed = isConcealed(hider);
    const spotted = [];

    for (const id of hiddenFrom(hider)) {
      const observer = canvas.tokens.get(id);
      if (!observer) continue;
      if (concealed || hasCover(observer, hider)) { trace.push(`${hider.name}: still hidden from ${observer.name} (concealed=${concealed}, cover=${hasCover(observer, hider)})`); continue; }
      spotted.push(observer);
    }

    if (!spotted.length) continue;
    trace.push(`${hider.name}: spotted by ${spotted.map(o => o.name).join(", ")}`);
    await reveal(hider, spotted.map(o => o.id));

    ChatMessage.create({
      content: game.i18n.format('DSCT.chat.stealth.spotted', {
        name: hider.name,
        by: spotted.map(o => o.name).join(', '),
      }),
      whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
    });
  }
  return trace;
}

const _moveLog = [];
export const moveLog = () => [..._moveLog];

export function registerHiddenTracking() {
  Hooks.on('updateToken', async (doc, change) => {
    const keys = Object.keys(change).filter(k => k !== '_id').join(', ');
    const note = (what) => {
      if (!getSetting('debugMode')) return;
      _moveLog.push(`${doc.name}: ${keys || '(nothing)'} -> ${what}`);
      if (_moveLog.length > 12) _moveLog.shift();
    };

    if (!('x' in change || 'y' in change || 'elevation' in change)) return note('not a move');

    const token = doc.object;
    if (!token) return note('no placeable');

    try {
      
      
      if (doc.rendered && token.movementAnimationPromise) {
        await token.movementAnimationPromise.catch(() => {});
      }

      const trace = await recheckHidden(token);
      note(trace ? (trace.join(' / ') || 'ran, nothing to do') : 'bailed before looking');
    } catch (err) {
      note(`THREW ${err.message}`);
    }
  });
}
