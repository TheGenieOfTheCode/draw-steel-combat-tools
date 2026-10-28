import { registerEnricherKind } from './advanced-enrichers.mjs';

const getSocket = () => game.modules.get('draw-steel-combat-tools')?.api?.socket ?? null;

const ICONS = { freestrike: 'fa-hand-back-fist', maneuver: 'fa-hand', main: 'fa-burst', signature: 'fa-star', heroic: 'fa-fire' };
const SHORT = {
  freestrike: { strike: true },
  maneuver: { type: ['maneuver', 'freeManeuver'] },
  main: { type: ['main'] },
  signature: { category: 'signature' },
  heroic: { category: 'heroic' },
};
const FREE_STRIKES = ['melee-free-strike', 'ranged-free-strike'];
const FILTER_KEYS = ['type', 'category', 'keyword', 'tag'];

const hasTag = (item, tag) => { try { return !!globalThis.ctlib?.hasTags?.(item, tag); } catch { return false; } };

export function parseSpec(spec) {
  const filter = {};
  let named = null;
  for (const word of String(spec).split(/\s+/).filter(Boolean)) {
    const [key, value] = word.split('=');
    if (value !== undefined && FILTER_KEYS.includes(key)) filter[key] = key === 'type' ? value.split(',') : value;
    else if (SHORT[word]) Object.assign(filter, SHORT[word]);
    else named = word;
  }
  return { filter, named };
}

export function matches(item, filter) {
  if (item.type !== 'ability') return false;
  const sys = item.system ?? {};
  if (filter.strike && !(FREE_STRIKES.includes(sys._dsid) || hasTag(item, 'free-strike'))) return false;
  if (filter.type && !filter.type.includes(sys.type)) return false;
  if (filter.category && sys.category !== filter.category) return false;
  if (filter.keyword && !(sys.keywords?.has?.(filter.keyword) ?? [...(sys.keywords ?? [])].includes(filter.keyword))) return false;
  if (filter.tag && !hasTag(item, filter.tag)) return false;
  return true;
}
const say = (key, data = {}) => game.i18n.format(`DSCT.grantAction.${key}`, data);
const GRANT_WAIT = 120000;

function markNextUse(actor) {
  const hook = Hooks.on('preCreateChatMessage', (message) => {
    const use = [...(message.system?.parts?.contents ?? [])].find((p) => p.type === 'abilityUse');
    if (!use || (message.speaker?.actor !== actor.id && ChatMessage.getSpeakerActor(message.speaker) !== actor)) return;
    message.updateSource({ 'flags.draw-steel-ctlib.granted': true });
    Hooks.off('preCreateChatMessage', hook);
  });
  setTimeout(() => Hooks.off('preCreateChatMessage', hook), GRANT_WAIT);
}

async function pick(actor, filter) {
  const items = actor.items.filter((i) => matches(i, filter));
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  const id = await foundry.applications.api.DialogV2.wait({
    window: { title: say('pickTitle', { name: actor.name }) },
    buttons: items.map((i) => ({ action: i.id, label: i.name })),
    rejectClose: false,
  }).catch(() => null);
  return items.find((i) => i.id === id) ?? null;
}

export async function useGranted({ actorUuid, what }) {
  const actor = fromUuidSync(actorUuid);
  if (!actor) return false;
  const { filter, named } = parseSpec(what);
  const onlyStrike = filter.strike && Object.keys(filter).length === 1;
  if (onlyStrike && !actor.items.some((i) => i.type === 'ability' && hasTag(i, 'free-strike'))) {
    const strike = game.modules.get('draw-steel-triggers')?.api?.freeStrike;
    markNextUse(actor);
    if (strike) return !!(await strike(actor, 'melee'));
    const item = actor.items.find((i) => i.system?._dsid === 'melee-free-strike');
    if (item) return !!(await item.system.use());
    return !!(await actor.system?.performFreeStrike?.());
  }
  const item = named
    ? actor.items.find((i) => i.type === 'ability' && (i.system?._dsid === named || i.name.toLowerCase() === named.replace(/-/g, ' ')))
    : await pick(actor, filter);
  if (!item) return void ui.notifications.warn(say('none', { name: actor.name }));
  markNextUse(actor);
  return !!(await item.system.use());
}

function ownerOf(actor) {
  return game.users.find((u) => !u.isGM && u.active && actor.testUserPermission(u, 'OWNER')) ?? null;
}

async function grantTo(doc, what) {
  const actor = doc?.actor;
  if (!actor) return;
  const payload = { actorUuid: actor.uuid, what };
  const owner = ownerOf(actor);
  if (actor.isOwner && (!owner || owner.isSelf)) return useGranted(payload);
  if (owner) return getSocket()?.executeAsUser('dsct.useGranted', owner.id, payload);
  return getSocket()?.executeAsGM('dsct.useGranted', payload);
}

function recipients(link) {
  if (link.dataset.recipient === 'target') return [...game.user.targets].map((t) => t.document);
  const message = game.messages.get(link.closest('[data-message-id]')?.dataset.messageId ?? '');
  const sp = message?.speaker;
  const spoke = sp?.token ? game.scenes.get(sp.scene)?.tokens.get(sp.token) : null;
  const self = spoke ?? canvas.tokens?.controlled[0]?.document ?? game.user.character?.getActiveTokens?.()[0]?.document;
  return self ? [self] : [];
}

async function onClick(event) {
  event.preventDefault();
  const link = event.currentTarget;
  const docs = recipients(link);
  if (!docs.length) return void ui.notifications.warn(say(link.dataset.recipient === 'target' ? 'noTargets' : 'noMover'));
  for (const doc of docs) await grantTo(doc, link.dataset.dsctGrant);
}

export function registerGrantEnricher() {
  CONFIG.TextEditor.enrichers.push({
    id: 'dsct.grant',
    pattern: /\[\[\/grant(?<config> [^\]]*?)?]](?!])(?:{(?<label>[^}]+)})?/gi,
    enricher: async (match) => {
      const words = (match.groups.config ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
      const recipient = words.includes('target') || words.includes('targets') ? 'target' : 'self';
      const what = words.filter((w) => !['target', 'targets', 'self'].includes(w)).join(' ');
      if (!what) return null;
      const { filter, named } = parseSpec(what);
      const short = Object.keys(SHORT).find((k) => what === k);
      const name = short ? say(short) : named ? named.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : say('filtered');
      if (!short && !named && !Object.keys(filter).length) return null;
      const label = match.groups.label ?? say(recipient === 'target' ? 'labelTarget' : 'label', { name });
      return ds.applications.ux.helpers.createLink(label, { dsctGrant: what, recipient, tooltip: say(recipient === 'target' ? 'tipTarget' : 'tip', { name }) },
        { icon: ICONS[short] ?? 'fa-bolt' });
    },
    onRender: (element) => element.querySelector('a')?.addEventListener('click', onClick),
  });
}

const grantKind = (recipient) => ({
  id: recipient === 'targets' ? 'grantActionTargets' : 'grantAction',
  recipient,
  chipIcon: (a) => ICONS[a.dataset.dsctGrant] ?? 'fa-bolt',
  test: (ec, a) => ec.getAttribute('enricher') === 'dsct.grant' && ((a?.dataset.recipient === 'target') === (recipient === 'targets')),
  async applyMany(ctx, docs) {
    const out = {};
    for (const doc of docs) if (await grantTo(doc, ctx.a.dataset.dsctGrant)) out[doc.uuid] = { at: Date.now() };
    return out;
  },
});

export function registerGrantKinds() {
  registerEnricherKind('dsct.grant', grantKind('speaker'));
  registerEnricherKind('dsct.grant', grantKind('targets'));
}
