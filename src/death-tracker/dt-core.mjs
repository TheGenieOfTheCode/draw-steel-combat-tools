import { getSetting, getModuleApi } from '../helpers.mjs';
import { dropKey } from '../ctlib.mjs';

export const DT_ID = 'draw-steel-combat-tools';
export const LEGACY_ID = 'draw-steel-combat-tools';
const COMBAT_TOOLS_ID = 'draw-steel-combat-tools';

export const setting = (key) => getSetting(key);
export const dtSocket = () => getModuleApi(false)?.socket;

const own = (doc) => doc?.flags?.[DT_ID];
const old = (doc) => (LEGACY_ID === DT_ID ? undefined : doc?.flags?.[LEGACY_ID]);

export const readFlag = (doc, key) => own(doc)?.[key] ?? old(doc)?.[key];

export const readFlags = (doc) => {
  const legacy = old(doc);
  const current = own(doc);
  if (!legacy) return current;
  if (!current) return legacy;
  return { ...legacy, ...current };
};

export const writeFlag = (doc, key, value) => doc.setFlag(DT_ID, key, value);

export const dropFlags = (doc, ...keys) => {
  const out = { [DT_ID]: Object.fromEntries(keys.map((k) => [k, dropKey()])) };
  const legacy = old(doc);
  const stale = legacy ? keys.filter((k) => k in legacy) : [];
  if (stale.length) out[LEGACY_ID] = Object.fromEntries(stale.map((k) => [k, dropKey()]));
  return out;
};

export const clearFlag = (doc, key) => doc.update({ flags: dropFlags(doc, key) });

export const combatToolsFlag = (doc, key) => doc?.flags?.[COMBAT_TOOLS_ID]?.[key];
