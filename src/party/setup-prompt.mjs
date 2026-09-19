import { getSetting } from '../helpers.mjs';
import { L, partyMembers } from './overview.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'partySetup';
const LOOKBACK = 15;
const COMPANION = 'draw-steel-companion.companion';

const _party = () => game.actors?.party ?? game.actors?.find(a => a.type === 'party') ?? null;

export function expectedMembers() {
  const out = new Map();

  for (const user of game.users.filter(u => !u.isGM)) {
    const actor = user.character;
    if (actor && !actor.inCompendium && !actor.isToken) out.set(actor.id, actor);
  }

  
  
  for (const actor of game.actors) {
    if (actor.type !== COMPANION) continue;
    const mentor = actor.system?.retainer?.mentor;
    if (mentor && out.has(mentor.id)) out.set(actor.id, actor);
  }

  return [...out.values()];
}

const _askedRecently = () =>
  game.messages.contents.slice(-LOOKBACK).some(m => m.getFlag(M, FLAG));

const _missingFrom = (party) => {
  const current = party ? partyMembers(party) : [];
  return expectedMembers().filter(a => !current.some(m => m.id === a.id));
};

export async function runPartySetup(messageId = null) {
  if (!game.user.isGM) return;

  const wanted = expectedMembers();
  if (!wanted.length) return ui.notifications.warn(L('DSCT.party.setupNoHeroes'));

  let party = _party();
  if (!party) {
    party = await Actor.create({ name: L('DSCT.party.defaultName'), type: 'party' });
    if (!party) return;
  }
  if (!game.actors.party) await game.actors.setParty(party);

  const added = _missingFrom(party).length;
  await party.system.addMembers(wanted);

  const message = messageId ? game.messages.get(messageId) : null;
  if (message) {
    await message.update({
      content: `<p>${L('DSCT.party.setupDone', { count: added, name: party.name })}</p>`,
      [`flags.${M}.${FLAG}`]: 'done',
    });
  }
  party.sheet?.render({ force: true });
}

function _installButton() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (message.getFlag(M, FLAG) !== true) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const host = root?.querySelector('.message-content');
    if (!host || host.querySelector('.dsct-party-setup-btn')) return;
    if (!game.user.isGM) return;

    const footer = document.createElement('footer');
    footer.className = 'message-part-buttons';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsct-party-setup-btn';
    button.innerHTML = `<i class="fa-solid fa-users"></i> ${_party() ? L('DSCT.party.setupFill') : L('DSCT.party.setupCreate')}`;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await runPartySetup(message.id); }
      catch (err) { console.warn('DSCT | party setup |', err); button.disabled = false; }
    });

    footer.append(button);
    host.append(footer);
  });
}

function _allowCompanions() {
  if (!game.modules.get('draw-steel-companion')?.active) return;
  try { ds.data.Actor.PartyModel?.ALLOWED_ACTOR_TYPES?.add(COMPANION); }
  catch (err) { console.warn('DSCT | party setup | could not allow companions as members:', err); }
}

export function registerPartySetupPrompt() {
  _installButton();
  Hooks.once('setup', _allowCompanions);

  Hooks.once('ready', async () => {
    if (!game.user.isGM) return;
    if (!getSetting('partyToolsEnabled') || !getSetting('partySetupPrompt')) return;
    if (_askedRecently()) return;

    const party = _party();
    const missing = _missingFrom(party);
    if (!missing.length) return;

    let body;
    if (!party) body = L('DSCT.party.setupMissing');
    else if (!partyMembers(party).length) body = L('DSCT.party.setupEmpty');
    else body = L('DSCT.party.setupPartial', { names: missing.map(a => a.name).join(', ') });

    await ChatMessage.create({
      content: `<p>${body}</p>`,
      whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
      flags: { [M]: { [FLAG]: true } },
    });
  });
}
