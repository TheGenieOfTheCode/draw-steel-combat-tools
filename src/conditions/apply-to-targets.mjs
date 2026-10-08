import { getSetting, getModuleApi } from '../helpers.mjs';
import { executeAsDirector } from '../ctlib.mjs';

const LINK = 'enriched-content[enricher="ds.apply"] a.roll-link';
const enabled = () => getSetting('applyToTargets') !== false;

export async function applyEnricherPayload(payload) {
  const AE = CONFIG.ActiveEffect.documentClass;
  const noStack = !payload.stacking;
  const temp = payload.type === 'custom'
    ? (await fromUuid(payload.uuid))?.clone({}, { keepId: noStack, addSource: true })
    : await AE.fromStatusEffect(payload.status);
  if (!temp) return 0;
  const keepInitiative = !game.combats.isDefaultInitiativeMode;
  const origin = payload.origin ? fromUuidSync(payload.origin) : null;
  const originActor = origin?.documentName === 'Actor' ? origin : origin?.actor;
  let combatant = payload.originDuration ? game.combat?.getCombatantsByActor(originActor)[0] ?? '' : null;
  const toDelete = [];
  const toCreate = [];
  const seen = new Set();
  for (const uuid of payload.actorUuids ?? []) {
    const actor = await fromUuid(uuid);
    if (!actor || seen.has(actor)) continue;
    seen.add(actor);
    combatant ??= game.combat?.getCombatantsByActor(actor)[0];
    const updates = { start: AE.getEffectStart(), transfer: true, origin: payload.origin };
    if (payload.end) updates.duration = { expiry: ds.CONFIG.effectEnds[payload.end]?.expiryEvent };
    if (combatant) {
      updates.start.combatant = combatant;
      if (keepInitiative) updates.start.initiative = combatant.initiative;
    }
    const createData = foundry.utils.mergeObject(temp.toObject(), updates);
    if (actor.effects.get(temp.id)) toDelete.push({ action: 'delete', parent: actor, documentName: 'ActiveEffect', ids: [temp.id] });
    toCreate.push({ action: 'create', parent: actor, documentName: 'ActiveEffect', data: [createData], keepId: noStack });
  }
  await foundry.documents.modifyBatch(toDelete);
  await foundry.documents.modifyBatch(toCreate);
  return toCreate.length;
}

async function applyToTargets(link) {
  const tokens = [...game.user.targets].filter((t) => t.actor);
  if (!tokens.length) return void ui.notifications.warn(game.i18n.localize('DSCT.applyToTargets.noTargets'));
  const d = link.dataset;
  const payload = {
    type: d.type, uuid: d.uuid, status: d.status, origin: d.origin, end: d.end,
    stacking: d.stacking ?? '', originDuration: d.originDuration ?? '',
    actorUuids: [...new Set(tokens.map((t) => t.actor.uuid))],
  };
  const local = game.user.isGM || tokens.every((t) => t.actor.isOwner);
  if (local) await applyEnricherPayload(payload);
  else await executeAsDirector(getModuleApi(false)?.socket, 'dsct.applyToTargets', payload);
  if (d.type === 'custom') {
    const name = (await fromUuid(d.uuid))?.name ?? '';
    for (const t of tokens) {
      canvas.interface.createScrollingText(t.center, game.i18n.format('DRAW_STEEL.EDITOR.Enrichers.ApplyEffect.CreateText', { name }),
        { fill: 'white', fontSize: 32, stroke: 0x000000, strokeThickness: 4 });
    }
  }
}

function addTooltipLine() {
  const i = CONFIG.TextEditor.enrichers.findIndex((e) => e.id === 'ds.apply');
  if (i < 0) return;
  const cfg = CONFIG.TextEditor.enrichers[i];
  const inner = cfg.enricher;
  CONFIG.TextEditor.enrichers[i] = {
    ...cfg,
    enricher: async function (match, options) {
      const el = await inner.call(this, match, options);
      const a = el?.matches?.('a') ? el : el?.querySelector?.('a');
      if (a && enabled()) {
        const line = game.i18n.localize('DSCT.applyToTargets.tooltip');
        a.dataset.tooltip = a.dataset.tooltip ? `${a.dataset.tooltip}<br>${line}` : line;
      }
      return el;
    },
  };
}

export function registerApplyToTargets() {
  addTooltipLine();
  const shift = (on) => document.body.classList.toggle('dsct-shift-targets', on && enabled());
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Shift') shift(true); });
  window.addEventListener('keyup', (ev) => { if (ev.key === 'Shift') shift(false); });
  window.addEventListener('blur', () => shift(false));
  document.addEventListener('click', (ev) => {
    if (!ev.shiftKey || !enabled()) return;
    const link = ev.target.closest?.(LINK);
    if (!link) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    applyToTargets(link);
  }, true);
}
