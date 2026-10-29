import { GRID as getGRID } from '../helpers.mjs';
import { _passesDispositionFilter } from '../regions/region-effects.mjs';
import { landingSurfaceAt, fallDamageFor, footprintCells } from './forced-movement-collision.mjs';

const M = 'draw-steel-combat-tools';

const isCondition = (id) => !!id && id in (ds.CONFIG.conditions ?? {});

const effectGivesCondition = (uuid) => {
  const effect = uuid ? fromUuidSync(uuid) : null;
  return [...(effect?.statuses ?? [])].some(isCondition);
};

const entersOrMoves = (events) => {
  const { TOKEN_ENTER, TOKEN_MOVE_IN } = CONST.REGION_EVENTS;
  return [...(events ?? [])].some((e) => e === TOKEN_ENTER || e === TOKEN_MOVE_IN);
};

const harmKind = (b) => {
  const s = b.system;
  switch (b.type) {
    case `${M}.damageEvents`:       return 'events';
    case `${M}.statusEffectEvents`: return isCondition(s.statusId) && s.action !== 'remove' ? 'events' : null;
    case `${M}.activeEffectEvents`: return ['add', 'enable'].includes(s.action) && effectGivesCondition(s.uuid) ? 'events' : null;
    case `${M}.statusEffect`:       return isCondition(s.statusId) ? 'enter' : null;
    case `${M}.activeEffect`:       return effectGivesCondition(s.uuid) ? 'enter' : null;
    default:                        return null;
  }
};

export const harmfulRegionsAt = (tokenDoc, grid, elev, { passing = false, already = null } = {}) => {
  const GRID = getGRID();
  const out = [];
  const pos = { x: grid.x * GRID, y: grid.y * GRID, elevation: elev };
  for (const region of tokenDoc.parent?.regions ?? []) {
    const harms = region.behaviors.filter((b) => !b.disabled && harmKind(b)
      && _passesDispositionFilter(b.system, { data: { token: tokenDoc } })
      && (!passing || harmKind(b) === 'enter' || entersOrMoves(b.system.events))
      && (!already?.has(region.id) || (harmKind(b) === 'events' && [...(b.system.events ?? [])].includes(CONST.REGION_EVENTS.TOKEN_MOVE_IN))));
    if (harms.length && tokenDoc.testInsideRegion(region, pos)) out.push(region);
  }
  const terrainAt = globalThis.ctlib?.terrainAt;
  if (terrainAt) {
    const size = tokenDoc.width ?? 1;
    for (const c of footprintCells(grid.x, grid.y, size)) {
      const hit = terrainAt(tokenDoc.parent, { x: (c.x + 0.5) * GRID, y: (c.y + 0.5) * GRID, elevation: elev }).damaging;
      if (hit.length) { out.push(...hit); break; }
    }
  }
  return out;
};

export const harmfulFallAt = (grid, elev, { agility = 0, fallReduction = 0, noFallDamage = false, canFly = false, terrain } = {}) => {
  if (canFly || noFallDamage) return false;
  const { surface } = landingSurfaceAt(grid, elev, Infinity, terrain);
  return elev > surface && fallDamageFor(elev - surface, agility, fallReduction).damage > 0;
};

export const harmfulSlam = (dist, { noFallDamage = false, canFly = false } = {}) =>
  !canFly && !noFallDamage && fallDamageFor(dist, 0, 0, { slam: true }).damage > 0;

export const landingElevation = (grid, elev, canFly, terrain) => {
  if (canFly) return elev;
  const { surface } = landingSurfaceAt(grid, elev, Infinity, terrain);
  return elev > surface ? surface : elev;
};

export const startingRegions = (tokenDoc) => new Set((tokenDoc.parent?.regions ?? [])
  .filter((r) => tokenDoc.testInsideRegion(r)).map((r) => r.id));
