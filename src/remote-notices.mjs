

import { getSetting } from './helpers.mjs';

const M = 'draw-steel-combat-tools';
const CACHE = 'remoteNoticeCache';

const SOURCE = 'https://raw.githubusercontent.com/TheGenieOfTheCode/draw-steel-combat-tools/main/notices.json';

const TIMEOUT_MS = 6000;

const SCHEMA = 1;

let _payload = null;

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

const httpsOnly = (v) => (typeof v === 'string' && v.startsWith('https://') ? v.slice(0, 300) : null);

const versionOnly = (v) => {
  const version = text(v, 40);
  return /^\d+(\.\d+)*$/.test(version) ? version : null;
};

const cleanList = (list) => (Array.isArray(list) ? list : [])
  .slice(0, 50)
  .map((e) => ({
    id: text(e?.id, 120),
    title: text(e?.title, 120),
    reason: text(e?.reason, 500),
    version: versionOnly(e?.version),
    url: httpsOnly(e?.url),
  }))
  .filter((e) => /^[a-z0-9][a-z0-9._-]*$/i.test(e.id));

const clean = (raw) => {
  if (!raw || typeof raw !== 'object' || raw.schema !== SCHEMA) return null;

  const version = versionOnly(raw?.latest?.version);
  const latest = version ? { version, url: httpsOnly(raw?.latest?.url) } : null;

  return { schema: SCHEMA, latest, recommends: cleanList(raw.recommends), conflicts: cleanList(raw.conflicts) };
};

const readCache = () => {
  const raw = game.settings.get(M, CACHE);
  return (raw && typeof raw === 'object' && raw.data) ? clean(raw.data) : null;
};

export const remoteNotices = () => _payload;

export const refreshRemoteNotices = async () => {
  
  _payload = readCache();
  if (!getSetting('onlineNoticeCheck')) return _payload;

  try {
    
    const res = await fetch(`${SOURCE}?at=${Date.now()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = clean(await res.json());
    if (!data) throw new Error('the payload was not in a shape this version understands');

    _payload = data;
    if (game.users.activeGM?.isSelf) await game.settings.set(M, CACHE, { at: Date.now(), data });
  } catch (err) {
    console.warn('DSCT | online notices | could not check, using what we already had:', err);
  }
  return _payload;
};
