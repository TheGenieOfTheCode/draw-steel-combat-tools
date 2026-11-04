import { getSetting, getTokenById, safeDelete, cleansed } from '../helpers.mjs';
import { safeCreateEmbedded } from '../ctlib.mjs';
import { runForcedMovement } from '../forced-movement/forced-movement-engine.mjs';
import { executeTeleport, executeTeleswap } from '../teleport.mjs';
import { runSourcePicker } from '../ability-automation/target-picker.mjs';
import { richTip, setTip } from '../chat-tips.mjs';
import { resolveTokenRefs, refList } from './refs.mjs';

const L = (k, data) => data ? game.i18n.format(`DSCT.ctEnricher.${k}`, data) : game.i18n.localize(`DSCT.ctEnricher.${k}`);
const H = () => ds.applications.ux.helpers;

const formulaOf = (parts, options) => ds.rolls.DSRoll.replaceFormulaData(parts.join(' ').trim(),
  options.rollData ?? options.relativeTo?.getRollData?.() ?? {});

const validFormula = (formula) => {
  if (!formula) return false;
  try { return Roll.validate(formula.replace(/@[\w.]+/g, '1')); } catch { return false; }
};

const shownDistance = (formula) => (/@/.test(formula) ? formula : total(formula));

const formatted = (key, data, formula, icon) => {
  const link = document.createElement('a');
  link.className = 'roll-link';
  link.innerHTML = L(key, { ...data, formula: H().createLink(formula, {}, { tag: 'span', icon }).outerHTML });
  return link;
};

const build = (label, dataset, { key, data = {}, formula, icon }) => {
  if (label) return H().createLink(label, dataset, { icon });
  const link = formula != null ? formatted(key, data, formula, icon) : H().createLink(L(key, data), {}, { icon });
  H().addDataset(link, dataset);
  return link;
};

const total = (formula) => {
  try { return new Roll(formula).evaluateSync({ strict: false }).total; } catch { return Number(formula) || 0; }
};

const controlled = () => canvas.tokens?.controlled ?? [];

const plainTip = (link) => setTip(link, richTip({
  title: link.textContent.trim(), category: L(`category.${link.dataset.type}`), body: link.dataset.dsctDetail ?? '',
}));

const needSelection = (key = 'needSelection') => void ui.notifications.warn(L(key));

export const FORCED_ICONS = { push: 'fa-right-long', pull: 'fa-left-long', slide: 'fa-arrows-left-right' };
const FORCED_FLAGS = {
  vertical: 'vertical', ignorestability: 'ignore-stability', nocollision: 'no-collision-damage', fast: 'fast-auto-path',
  nomovercollision: 'no-mover-collision-damage', noobstaclecollision: 'no-obstacle-collision-damage', safely: 'safely',
};

const forced = {
  id: 'dsct.forced',
  pattern: /\[\[\/(?<type>push|pull|slide)(?<config> .*?)?]](?!])(?:{(?<label>[^}]+)})?/gi,
  async enricher(match, options) {
    const type = match.groups.type.toLowerCase();
    const c = H().parseConfig(match.groups.config ?? '');
    const props = new Set();
    const parts = c.distance != null ? [String(c.distance)] : (c.formula != null ? [String(c.formula)] : []);
    for (const value of c.values) {
      const flag = FORCED_FLAGS[value.toLowerCase()];
      if (flag) props.add(flag);
      else parts.push(value);
    }
    if (c.vertical === true) props.add('vertical');
    if (c.ignoreStability === true || c.stability === false) props.add('ignore-stability');
    if (c.collision === false) props.add('no-collision-damage');
    if (c.safely === true) props.add('safely');
    const formula = formulaOf(parts, options);
    if (!validFormula(formula)) return null;
    const cfg = ds.CONFIG.abilities.forcedMovement[type];
    const movement = game.i18n.localize(props.has('vertical') ? cfg.vertical : cfg.label);
    const dataset = { type: 'forced', movement: type, formula, properties: [...props].join(','), fallReduction: c.fall ?? '' };
    dataset.dsctDetail = [L('forcedDetail', { movement, n: shownDistance(formula) }), ...[...props].map((p) => L(`forcedProp.${p}`))].join(' ');
    const link = build(match.groups.label, dataset, { key: 'forced', data: { movement }, formula, icon: FORCED_ICONS[type] });
    plainTip(link);
    return link;
  },
  onRender(element) {
    const a = element.querySelector('a');
    a?.addEventListener('click', async (event) => {
      event.preventDefault();
      const d = a.dataset;
      const props = new Set((d.properties ?? '').split(',').filter(Boolean));
      const distance = total(d.formula);
      await runForcedMovement({
        movement: d.movement, distance: String(distance), properties: props,
        verticalDistance: props.has('vertical') ? distance : 0, fallReduction: Number(d.fallReduction) || 0,
      });
    });
  },
};

const TELEPORT_ICONS = { swap: 'fa-people-arrows', adjacent: 'fa-person-through-window', '': 'fa-person-through-window' };

const teleport = {
  id: 'dsct.teleport',
  pattern: /\[\[\/(?<type>teleport|teleswap)(?<config> .*?)?]](?!])(?:{(?<label>[^}]+)})?/gi,
  async enricher(match, options) {
    const c = H().parseConfig(match.groups.config ?? '');
    let mode = match.groups.type.toLowerCase() === 'teleswap' ? 'swap' : (c.mode ?? '');
    const parts = c.distance != null ? [String(c.distance)] : [];
    let color = c.color ?? null;
    let animate = typeof c.animate === 'boolean' ? c.animate : null;
    let duration = Number.isFinite(c.duration) ? c.duration : null;
    let source = c.source ?? null;
    
    for (const value of c.values) {
      const lower = value.toLowerCase();
      if (lower === 'swap' || lower === 'teleswap') mode = 'swap';
      else if (lower === 'adjacent') mode = 'adjacent';
      else if (lower === 'true' || lower === 'false') animate = lower === 'true';
      else if (value.startsWith('#')) color = value;
      else if (/^[\d@(]|^[+\-*/]$/.test(value)) {
        if (parts.length && /^\d+$/.test(value) && /^\d+$/.test(parts.at(-1)) && duration == null) duration = Number(value);
        else parts.push(value);
      } else source = value;
    }
    const formula = formulaOf(parts, options);
    if (!validFormula(formula)) return null;
    const dataset = { type: 'teleport', formula, mode, color: color ?? '', animate: animate == null ? '' : String(animate), duration: duration ?? '', source: source ?? '' };
    const key = mode === 'swap' ? 'teleswap' : (mode === 'adjacent' ? 'teleportAdjacent' : 'teleport');
    dataset.dsctDetail = L(`${key}Detail`, { n: shownDistance(formula) });
    const link = build(match.groups.label, dataset, { key, formula, icon: TELEPORT_ICONS[mode] ?? TELEPORT_ICONS[''] });
    plainTip(link);
    return link;
  },
  onRender(element) {
    const a = element.querySelector('a');
    a?.addEventListener('click', async (event) => {
      event.preventDefault();
      const opts = teleportOptions(a);
      let token = fixedSource(a);
      if (a.dataset.source && !token) return void ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.sourceNotFound'));
      if (!token && event.shiftKey && !opts.mode) {
        const targets = [...game.user.targets];
        if (targets.length > 1) return void ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noShiftTarget'));
        token = targets[0] ?? (getSetting('abilityAutomationEnabled') ? await runSourcePicker() : null);
        if (!token) return void ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noShiftTarget'));
      }
      if (!token) {
        if (controlled().length !== 1) return void ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.mustSelectOne'));
        token = controlled()[0];
      }
      const partner = opts.mode ? await pickPartner(token) : null;
      if (opts.mode && !partner) return;
      await teleportToken(token, opts, partner);
    });
  },
};

export const pickPartner = async (token, candidates = [...game.user.targets]) => {
  const others = candidates.filter((t) => t && t.id !== token.id);
  const partner = others.length === 1 ? others[0] : (getSetting('abilityAutomationEnabled') ? await runSourcePicker() : null);
  if (!partner) return void ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.needTarget'));
  if (partner.id === token.id) return void ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.sameToken'));
  return partner;
};

export const teleportOptions = (a) => {
  const saved = game.user.getFlag('draw-steel-combat-tools', 'tpSettings') ?? { dist: 5, anim: true, color: '#a030ff', duration: 600 };
  const d = a.dataset;
  return {
    distance: total(d.formula) || saved.dist,
    animate: d.animate ? d.animate === 'true' : (saved.anim ?? true),
    color: d.color || saved.color || '#a030ff',
    duration: d.duration ? (Number(d.duration) || 600) : (saved.duration ?? 600),
    mode: d.mode || '',
  };
};

export const fixedSource = (a) => {
  const id = a.dataset.source;
  if (!id) return null;
  return resolveTokenRefs(id)[0]?.object ?? getTokenById(refList(id)[0]) ?? null;
};

export const teleportToken = async (token, opts, partner = null) => {
  if (opts.mode === 'swap' && partner) return executeTeleswap(token, partner, opts.distance, opts.animate, opts.color, opts.duration);
  if (opts.mode === 'adjacent' && partner) return executeTeleport(token, opts.distance, opts.animate, opts.color, opts.duration, { adjacentTo: partner });
  return executeTeleport(token, opts.distance, opts.animate, opts.color, opts.duration);
};

const cleanse = {
  id: 'dsct.cleanse',
  pattern: /\[\[\/(?<type>cleanse)(?<config> .*?)?]](?!])(?:{(?<label>[^}]+)})?/gi,
  async enricher(match) {
    const c = H().parseConfig(match.groups.config ?? '');
    const expiry = new Set();
    const statuses = new Set();
    const keywords = new Set();
    let all = c.all === true;
    for (const value of c.values) {
      const lower = value.toLowerCase();
      if (lower === 'all') all = true;
      else if (lower === 'save') expiry.add('save');
      else if (lower === 'turn' || lower === 'eot') expiry.add('turnEnd');
      else if (CONFIG.statusEffects.some((s) => s.id === lower)) statuses.add(lower);
      else if (ds.CONFIG.abilities.keywords[lower]) keywords.add(lower);
      else return null;
    }
    if (!expiry.size && !statuses.size && !keywords.size) { expiry.add('turnEnd'); expiry.add('save'); }
    const spec = { expiryFilter: [...expiry], statusFilter: [...statuses], all };
    const dataset = { type: 'cleanse', expiry: spec.expiryFilter.join(','), statuses: spec.statusFilter.join(','), keywords: [...keywords].join(','), all: all ? 'true' : '' };
    const statusNames = [...statuses].map((s) => game.i18n.localize(CONFIG.statusEffects.find((e) => e.id === s)?.name ?? s));
    const endNames = [...expiry].map((ev) => Object.values(ds.CONFIG.effectEnds ?? {}).find((c) => c.expiryEvent === ev)?.label).filter(Boolean);
    const keywordNames = [...keywords].map((k) => ds.CONFIG.abilities.keywords[k]?.label ?? k);
    const list = game.i18n.getListFormatter({ type: 'disjunction' }).format([...statusNames, ...endNames.map((n) => game.i18n.localize(n)), ...keywordNames]);
    let key = all ? 'cleanseAll' : 'cleanse';
    if (statusNames.length === 1) key = all ? 'cleanseAllStatus' : 'cleanseStatus';
    else if (statusNames.length > 1) key = all ? 'cleanseAllStatuses' : 'cleanseStatuses';
    const standard = !statuses.size && expiry.size === 2;
    dataset.dsctDetail = L(standard ? (all ? 'cleanseDetailAllStandard' : 'cleanseDetailStandard') : (all ? 'cleanseDetailAll' : 'cleanseDetail'), { what: list });
    const link = build(match.groups.label, dataset, { key, data: { status: statusNames[0] ?? '' }, icon: 'fa-broom' });
    plainTip(link);
    return link;
  },
  onRender(element) {
    const a = element.querySelector('a');
    a?.addEventListener('click', async (event) => {
      event.preventDefault();
      const actors = [...new Set(controlled().map((t) => t.actor).filter(Boolean))];
      if (!actors.length) return needSelection();
      for (const actor of actors) await cleanseActor(actor, cleanseSpec(a));
    });
  },
};

export const cleanseSpec = (a) => ({
  expiry: new Set((a.dataset.expiry ?? '').split(',').filter(Boolean)),
  statuses: new Set((a.dataset.statuses ?? '').split(',').filter(Boolean)),
  keywords: new Set((a.dataset.keywords ?? '').split(',').filter(Boolean)),
  all: a.dataset.all === 'true',
});

const imposedBy = (ae, actor) => {
  const src = ae.origin ? fromUuidSync(ae.origin, { strict: false }) : null;
  if (!src?.system?.keywords || (src.parent === actor && src.type !== 'ability')) return new Set();
  return new Set(src.system.keywords);
};

export const cleanseMatches = (actor, { expiry, statuses, keywords = new Set(), keep = new Set() }) => {
  const has = (ae, set) => [...(ae.statuses ?? [])].some((s) => set.has(s));
  const ofKind = (ae) => (expiry.size || statuses.size
    ? (expiry.size && expiry.has(ae.duration?.expiry)) || (statuses.size && has(ae, statuses))
    : keywords.size > 0);
  const fromKeyword = (ae) => !keywords.size || [...imposedBy(ae, actor)].some((k) => keywords.has(k));
  return actor?.effects.filter((ae) => !has(ae, keep) && ofKind(ae) && fromKeyword(ae)) ?? [];
};

export const cleanseActor = async (actor, spec) => {
  const { all } = spec;
  const candidates = cleanseMatches(actor, spec);
  if (!candidates.length) {
    ui.notifications.warn(game.i18n.format('DSCT.FlatEffect.Cleanse.noMatch', { name: actor.name }));
    return null;
  }
  let chosen = all ? candidates : (candidates.length === 1 ? candidates : null);
  if (!chosen) {
    const options = candidates.map((e) => `<option value="${e.id}">${foundry.utils.escapeHTML(e.name)}</option>`).join('');
    const id = await foundry.applications.api.DialogV2.prompt({
      window: { title: L('cleanseChoose', { name: actor.name }) },
      content: `<div class="form-group"><select name="effect">${options}</select></div>`,
      ok: { callback: (_e, button) => button.form.elements.effect.value },
      rejectClose: false,
    });
    if (!id) return null;
    chosen = candidates.filter((e) => e.id === id);
  }
  const removed = chosen.map((e) => e.toObject());
  for (const effect of chosen) await safeDelete(effect, cleansed());
  return removed;
};

export const restoreCleansed = async (actor, removed) => {
  if (removed?.length) await safeCreateEmbedded(actor, 'ActiveEffect', removed);
};

export function registerCtEnrichers() {
  CONFIG.TextEditor.enrichers.push(forced, teleport, cleanse);
}
