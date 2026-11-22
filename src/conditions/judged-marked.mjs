import { getSetting, getItemDsid, hasSightToToken } from '../helpers.mjs';
import { isPrimaryGM, safeUpdate } from '../ctlib.mjs';
import { MARK_ABILITY_CONFIG } from '../ability-automation/class-tactician/mark.mjs';

const M = 'draw-steel-combat-tools';
const APPLY = /\[\[\/apply\s+([^\]\s]+)[^\]]*\]\]\{([^}]+)\}/g;
const KINDS = new Set(['judged', 'marked']);

const enabled = () => getSetting('conditionsEnabled') && getSetting('judgedMarkedLifetimes');
const kindOfLabel = (label) => {
  const l = label.trim().toLowerCase();
  return l === 'mark' ? 'marked' : l;
};

function textOf(item) {
  const s = item?.system;
  if (!s) return '';
  const effects = [...(s.effects?.contents ?? Object.values(s.effects ?? {}))].map((e) => e.description ?? '').join(' ');
  return `${s.description?.value ?? ''} ${effects}`;
}

function kindIn(item, effect) {
  for (const m of textOf(item).matchAll(APPLY)) {
    const label = kindOfLabel(m[2]);
    if (KINDS.has(label) && (m[1] === effect.id || item.effects?.get(m[1])?.name === effect.name)) return label;
  }
  return null;
}

const abilityFor = (actor, kind) => actor?.items.find((i) => i.type === 'ability'
  && [...textOf(i).matchAll(APPLY)].some((m) => kindOfLabel(m[2]) === kind)) ?? null;

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
const SAME_USE_MS = 2000;
const fallen = (actor) => !!actor && (actor.statuses?.has('dead') || (actor.type !== 'hero' && Number(actor.system?.stamina?.value ?? 1) <= 0));
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
    if (config?.override && !effect.flags?.[M]?.mark?.reapply) {
      const anticipation = info.dsid === 'mark' && info.owner.items.some((i) => getItemDsid(i) === 'anticipation');
      const max = anticipation ? Math.max(config.maxTargets, 2) : config.maxTargets;
      const mine = all.filter(({ effect: e, info: o }) => o.dsid === 'mark' && sameActor(o.owner, info.owner) && e.parent !== effect.parent)
        .map(({ effect: e }) => e)
        .filter((e) => Math.abs(createdAt(e) - createdAt(effect)) >= SAME_USE_MS)
        .sort((a, b) => createdAt(b) - createdAt(a));
      const down = mine.filter((e) => fallen(e.parent));
      for (const e of (down.length ? down : mine.slice(Math.max(0, max - 1)))) doomed.add(e);
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

const SOURCE_DYING = 'sourceDying';
const systemEndsOnSourceDying = () => !!CONFIG.ActiveEffect.dataModels?.base?.schema?.fields?.end?.fields?.sourceDying;

function sourceActorOf(effect) {
  const mark = effect.flags?.[M]?.mark;
  if (mark?.actorId) return game.actors.get(mark.actorId) ?? null;
  const origin = effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
  return origin?.documentName === 'Actor' ? origin : origin?.actor ?? null;
}

function isMarkEffect(effect) {
  if (effect.flags?.[M]?.mark) return true;
  const holder = effect.parent?.documentName === 'Item' ? effect.parent
    : (effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null);
  return holder?.documentName === 'Item' && holder.type === 'ability' && kindIn(holder, effect) === 'marked';
}

export function fallenMarkOf(effect) {
  const mark = effect.flags?.[M]?.mark;
  if (mark) return mark.actorId ? { ownerId: mark.actorId, dsid: mark.isMarkAbility ? 'mark' : mark.dsid } : null;
  if (!isMarkEffect(effect)) return null;
  const owner = sourceActorOf(effect);
  const origin = effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
  return owner ? { ownerId: owner.id, dsid: getItemDsid(origin) || 'mark' } : null;
}

const endsWithSource = (effect) => !!effect.getFlag(M, SOURCE_DYING) || isMarkEffect(effect);

function addSourceDyingToggle(app, element) {
  if (systemEndsOnSourceDying() || !enabled()) return;
  const name = `flags.${M}.${SOURCE_DYING}`;
  const after = element.querySelector('[name="system.end.roll"]')?.closest('.form-group');
  if (!after || element.querySelector(`[name="${name}"]`)) return;
  const mark = isMarkEffect(app.document);
  const row = document.createElement('div');
  row.className = 'form-group dsct-source-dying';
  row.innerHTML = `<label>${game.i18n.localize('DSCT.tip.sourceDyingLabel')}</label><div class="form-fields"><input type="checkbox" name="${name}"></div>`;
  const box = row.querySelector('input');
  box.checked = mark || !!app.document.getFlag(M, SOURCE_DYING);
  if (mark) {
    box.disabled = true;
    row.dataset.tooltip = game.i18n.localize('DSCT.tip.sourceDyingMark');
  }
  after.after(row);
}

function isExpiryEvent(wrapped, event, context) {
  if (event !== SOURCE_DYING) return wrapped(event, context);
  if (systemEndsOnSourceDying() && wrapped(event, context)) return true;
  return enabled() && !!context?.source && endsWithSource(this) && sameActor(sourceActorOf(this), context.source);
}

const MARK_EDGE_KEY = 'system.combat.targetModifiers.edges';
const markEdgeOf = (effect) => (effect.changes ?? []).filter((c) => c.key === MARK_EDGE_KEY).reduce((n, c) => n + (Number(c.value) || 0), 0);

export const rollerTokenOf = (actor) => (actor ? canvas.tokens?.controlled.find((t) => t.actor === actor) ?? actor.getActiveTokens?.()[0] ?? null : null);

export function markEdgeChecks(roller, target) {
  if (!getSetting('conditionsEnabled') || !target?.actor) return [];
  const out = [];
  for (const effect of target.actor.appliedEffects ?? []) {
    if (!isMarkEffect(effect)) continue;
    const amount = markEdgeOf(effect);
    const tactician = amount > 0 ? sourceActorOf(effect) : null;
    if (!tactician) continue;
    const tacToken = tactician.getActiveTokens?.()[0] ?? null;
    let why = null;
    if (!tacToken) why = 'noTactician';
    else if (!hasSightToToken(tacToken, target)) why = 'noLoeTarget';
    else if (roller && !sameActor(roller.actor, tactician)) {
      if (roller.document.disposition !== tacToken.document.disposition) why = 'notAlly';
      else if (!hasSightToToken(tacToken, roller)) why = 'noLoeRoller';
    }
    out.push({ effect, amount, tactician, tacToken, why });
  }
  return out;
}

const _targetModifierSteps = [];
export const addTargetModifierStep = (step) => { _targetModifierSteps.push(step); };

function withoutBlockedMarks(wrapped, target) {
  let call = wrapped;
  for (const step of _targetModifierSteps) {
    const inner = call;
    call = (t) => step.call(this, inner, t);
  }
  const mods = call(target);
  for (const c of markEdgeChecks(rollerTokenOf(this.actor), target)) if (c.why) mods.edges = Math.max(0, (mods.edges ?? 0) - c.amount);
  return mods;
}

export function registerJudgedMarked() {
  libWrapper.register(M, 'CONFIG.ActiveEffect.documentClass.prototype.isExpiryEvent', isExpiryEvent, 'MIXED');
  Hooks.once('ready', () => libWrapper.register(M, 'CONFIG.Item.dataModels.ability.prototype.getTargetModifiers', withoutBlockedMarks, 'WRAPPER'));
  Hooks.on('createActiveEffect', (effect, _options, userId) => { onCreated(effect, userId); });
  Hooks.on('renderActiveEffectConfig', addSourceDyingToggle);
  Hooks.on('updateActor', (actor, changes, options) => {
    if (systemEndsOnSourceDying() || !enabled()) return;
    const before = options.ds?.previousStamina?.value;
    if (before === undefined || changes.system?.stamina?.value === undefined) return;
    const dying = Number(ds.CONST.staminaEffects?.dying?.threshold ?? 0);
    if (before > dying && actor.system.stamina.value <= dying) foundry.documents.ActiveEffect.registry.refresh(SOURCE_DYING, { source: actor });
  });
  Hooks.on('updateActiveEffect', (effect, changes) => {
    if (enabled() && isPrimaryGM() && 'origin' in changes) settle(effect);
  });
}
