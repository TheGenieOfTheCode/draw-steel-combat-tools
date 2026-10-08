import { getSetting, getItemDsid } from '../helpers.mjs';
import { isPrimaryGM, safeUpdate } from '../ctlib.mjs';
import { MARK_ABILITY_CONFIG } from '../ability-automation/class-tactician/mark.mjs';

const M = 'draw-steel-combat-tools';
const APPLY = /\[\[\/apply\s+([^\]\s]+)[^\]]*\]\]\{([^}]+)\}/g;
const KINDS = new Set(['judged', 'marked']);

const enabled = () => getSetting('conditionsEnabled') && getSetting('judgedMarkedLifetimes');

function textOf(item) {
  const s = item?.system;
  if (!s) return '';
  const effects = [...(s.effects?.contents ?? Object.values(s.effects ?? {}))].map((e) => e.description ?? '').join(' ');
  return `${s.description?.value ?? ''} ${effects}`;
}

function kindIn(item, effect) {
  for (const m of textOf(item).matchAll(APPLY)) {
    const label = m[2].trim().toLowerCase();
    if (KINDS.has(label) && (m[1] === effect.id || item.effects?.get(m[1])?.name === effect.name)) return label;
  }
  return null;
}

const abilityFor = (actor, kind) => actor?.items.find((i) => i.type === 'ability'
  && [...textOf(i).matchAll(APPLY)].some((m) => m[2].trim().toLowerCase() === kind)) ?? null;

async function infoOf(effect) {
  if (effect.parent?.documentName !== 'Actor') return null;
  const judgement = effect.flags?.[M]?.judgement;
  if (judgement) return { kind: 'judged', owner: game.actors.get(judgement.actorId) ?? null, dsid: 'judgement' };
  const mark = effect.flags?.[M]?.mark;
  if (mark) return { kind: 'marked', owner: game.actors.get(mark.actorId) ?? null, dsid: mark.isMarkAbility ? 'mark' : mark.dsid };
  if (!effect.origin) return null;
  const source = await fromUuid(effect.origin).catch(() => null);
  if (source?.documentName !== 'Item' || source.type !== 'ability') return null;
  const kind = kindIn(source, effect);
  return kind ? { kind, owner: source.actor ?? null, dsid: getItemDsid(source) } : null;
}

function everyActor() {
  const actors = new Set(game.actors.filter((a) => a.prototypeToken?.actorLink !== false));
  for (const c of game.combat?.combatants ?? []) if (c.actor) actors.add(c.actor);
  for (const t of canvas?.tokens?.placeables ?? []) if (t.actor) actors.add(t.actor);
  return [...actors];
}

const createdAt = (effect) => effect._stats?.createdTime ?? 0;
const sameActor = (a, b) => !!a && !!b && (a === b || a.uuid === b.uuid || (a.id === b.id && !a.isToken && !b.isToken));

async function allOfKind(kind) {
  const out = [];
  for (const actor of everyActor()) {
    for (const effect of actor.effects) {
      const info = await infoOf(effect);
      if (info?.kind === kind) out.push({ effect, info });
    }
  }
  return out;
}

async function settle(effect) {
  const info = await infoOf(effect);
  if (!info?.owner) return;
  const all = await allOfKind(info.kind);
  const doomed = new Set();

  if (info.kind === 'judged') {
    for (const { effect: e, info: o } of all) if (sameActor(o.owner, info.owner)) doomed.add(e);
  } else {
    for (const { effect: e } of all) if (e.parent === effect.parent) doomed.add(e);
    const config = MARK_ABILITY_CONFIG[info.dsid];
    if (config?.override) {
      const anticipation = info.dsid === 'mark' && info.owner.items.some((i) => getItemDsid(i) === 'anticipation');
      const max = anticipation ? Math.max(config.maxTargets, 2) : config.maxTargets;
      const mine = all.filter(({ effect: e, info: o }) => o.dsid === 'mark' && sameActor(o.owner, info.owner) && e.parent !== effect.parent)
        .map(({ effect: e }) => e).sort((a, b) => createdAt(b) - createdAt(a));
      for (const e of mine.slice(Math.max(0, max - 1))) doomed.add(e);
    }
  }
  doomed.delete(effect);
  for (const e of doomed) if (createdAt(e) > createdAt(effect)) doomed.delete(e);
  if (!doomed.size) return;
  console.log(`${M} | ${info.owner.name}'s new ${info.kind} effect on ${effect.parent.name} ends ${doomed.size} older one(s)`);
  for (const e of doomed) await e.delete().catch(() => {});
}

function creditFor(kind, target) {
  const has = (actor) => actor && actor !== target && abilityFor(actor, kind);
  const pick = (actors) => {
    const found = [...new Set(actors)].filter(has);
    return found.length === 1 ? found[0] : null;
  };
  const actor = (has(game.user.character) ? game.user.character : null)
    ?? pick((game.combat?.combatants ?? []).map((c) => c.actor))
    ?? pick((canvas?.tokens?.placeables ?? []).map((t) => t.actor));
  return actor ? abilityFor(actor, kind) : null;
}

async function onCreated(effect, userId) {
  if (!enabled()) return;
  if (userId === game.user.id) {
    const info = await infoOf(effect);
    if (info && !info.owner) {
      const ability = creditFor(info.kind, effect.parent);
      if (ability) await safeUpdate(effect, { origin: ability.uuid });
      return;
    }
  }
  if (isPrimaryGM()) await settle(effect);
}

export function registerJudgedMarked() {
  Hooks.on('createActiveEffect', (effect, _options, userId) => { onCreated(effect, userId); });
  Hooks.on('updateActiveEffect', (effect, changes) => {
    if (enabled() && isPrimaryGM() && 'origin' in changes) settle(effect);
  });
}
