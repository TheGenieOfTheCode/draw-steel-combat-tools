import { getSetting } from '../helpers.mjs';
import { L, markFor } from './overview.mjs';

const M = 'draw-steel-combat-tools';
const FLAG = 'ignoredWarning';
const LOOKBACK = 15;

const _party = () => game.actors?.party ?? game.actors?.find(a => a.type === 'party') ?? null;

const _label = (kind, key) => {
  const raw = kind === 'skills' ? ds.CONFIG.skills?.list?.[key]?.label : ds.CONFIG.languages?.[key]?.label;
  return raw && game.i18n.has(raw) ? L(raw) : key;
};

function _offenders(party) {
  const actor = game.user.character;
  if (!party || !actor) return [];

  const docs = [actor, ...[...(actor.items ?? [])].filter(i => i.type === 'follower')];
  const out = [];

  for (const doc of docs) {
    for (const [kind, path] of [['skills', 'system.skills.value'], ['languages', 'system.languages.value']]) {
      for (const key of (foundry.utils.getProperty(doc, path) ?? [])) {
        if (markFor(party, kind, key) !== 'ignored') continue;
        out.push({ key, kind, label: _label(kind, key), from: doc === actor ? null : doc.name });
      }
    }
  }
  return out;
}

const _recentWarning = () =>
  game.messages.contents.slice(-LOOKBACK).reverse().find(m => m.getFlag(M, FLAG));

async function _check() {
  if (game.user.isGM) return;
  if (!getSetting('partyToolsEnabled') || !getSetting('partyIgnoredWarning')) return;

  const offenders = _offenders(_party());
  if (!offenders.length) return;

  const digest = offenders.map(o => `${o.kind}:${o.key}`).sort().join('|');
  const prior = _recentWarning();
  if (prior?.getFlag(M, FLAG) === digest) return;

  const names = offenders
    .map(o => (o.from ? L('DSCT.party.followerOf', { name: o.label, owner: o.from }) : o.label))
    .join(', ');
  const payload = {
    content: `<p>${L('DSCT.party.ignoredWarning', { names })}</p>`,
    flags: { [M]: { [FLAG]: digest } },
  };

  
  
  
  if (prior) {
    try {
      if (game.messages.contents.at(-1)?.id === prior.id) return void await prior.update(payload);
      await prior.delete();
    } catch (err) {
      console.warn('DSCT | ignored warning | could not clear the previous warning:', err);
    }
  }

  await ChatMessage.create({ ...payload, whisper: [game.user.id] });
}

export function registerIgnoredWarning() {
  Hooks.once('ready', () => { _check().catch(err => console.warn('DSCT | ignored warning |', err)); });

  
  Hooks.on('updateActor', (actor, changed) => {
    if (actor.type !== 'party') return;
    if (!foundry.utils.hasProperty(changed, `flags.${M}.overview`)) return;
    _check().catch(err => console.warn('DSCT | ignored warning |', err));
  });
}
