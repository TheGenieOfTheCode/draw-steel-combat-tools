const MACRO_FOLDER_NAME = 'Draw Steel: Combat Tools';

const MACRO_SETTINGS = {
  'DSCT: Judgement':     'judgementAutomation',
  'DSCT: Mark':          'markAutomation',
  'DSCT: Aid Attack':    'aidAttackAutomation',
  "DSCT: I'm No Threat": 'imNoThreatEnabled',
};

export const installMacros = async ({ silent = false } = {}) => {
  if (!game.user.isGM) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.gmOnly')); return; }

  const pack = game.packs.get('draw-steel-combat-tools.macros');
  if (!pack) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.packNotFound')); return; }

  const M = 'draw-steel-combat-tools';

  let rootFolder = game.folders.find(f => f.type === 'Macro' && f.name === MACRO_FOLDER_NAME);
  if (!rootFolder) rootFolder = await Folder.create({ name: MACRO_FOLDER_NAME, type: 'Macro' });

  const folderMap = new Map();
  for (const pf of (pack.folders ?? [])) {
    let wf = game.folders.find(f => f.type === 'Macro' && f.name === pf.name && f.folder?.id === rootFolder.id);
    if (!wf) {
      wf = await Folder.create({ name: pf.name, type: 'Macro', folder: rootFolder.id, sort: pf.sort, color: pf.color });
    } else if (wf.color !== pf.color) {
      await wf.update({ color: pf.color });
    }
    folderMap.set(pf.id, wf);
  }

  
  
  const RENAMED = { 'DSCT: Show Line of Sight': 'DSCT: Show Line of Effect' };
  const ours = new Set([rootFolder.id, ...[...folderMap.values()].map(f => f.id)]);
  let renamed = 0;
  for (const [was, now] of Object.entries(RENAMED)) {
    for (const macro of game.macros.filter(m => m.name === was && ours.has(m.folder?.id))) {
      await macro.update({ name: now });
      renamed++;
    }
  }

  const docs = await pack.getDocuments();
  let created = 0, updated = 0, skipped = 0, removed = 0;

  for (const doc of docs) {
    const settingKey   = MACRO_SETTINGS[doc.name];
    const isDisabled   = settingKey && game.settings.get(M, settingKey) === false;
    const compFolderId = doc.toObject().folder;
    const targetFolder = compFolderId ? (folderMap.get(compFolderId) ?? rootFolder) : rootFolder;

    let exists      = game.macros.find(m => m.name === doc.name && m.folder?.id === targetFolder.id);
    const inRoot    = !exists && targetFolder.id !== rootFolder.id
      ? game.macros.find(m => m.name === doc.name && m.folder?.id === rootFolder.id)
      : null;

    if (isDisabled) {
      if (exists)  { await exists.delete();  removed++; }
      if (inRoot)  { await inRoot.delete();  removed++; }
      continue;
    }

    if (inRoot) {

      await inRoot.update({ folder: targetFolder.id, command: doc.command, img: doc.img });
      updated++;
      continue;
    }

    if (exists) {
      if (exists.command !== doc.command || exists.img !== doc.img) {
        await exists.update({ command: doc.command, img: doc.img });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    await Macro.create({ name: doc.name, type: 'script', img: doc.img, command: doc.command, folder: targetFolder.id });
    created++;
  }

  const parts = [`${created} created`, `${updated} updated`, `${skipped} up to date`];
  if (renamed) parts.push(`${renamed} renamed`);
  if (removed) parts.push(`${removed} removed`);
  const summary = `DSCT | Macros: ${parts.join(', ')}. Folder: "${MACRO_FOLDER_NAME}".`;
  if (silent) console.log(summary);
  else ui.notifications.info(summary);
};

export const distributeAbilities = async () => {
  if (!game.user.isGM) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.gmOnlyDistribute')); return; }

  const MAX_SAFE    = 15;
  const pack        = game.packs.get('draw-steel.abilities');
  const EXCLUDE_IDS = new Set(['melee-free-strike', 'ranged-free-strike', 'heal', 'catch-breath']);

  if (!pack) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.abilitiesPackNotFound')); return; }

  const index     = await pack.getIndex({ fields: ['system._dsid', 'folder'] });
  const knockback = index.find(i => i.system?._dsid === 'knockback');
  if (!knockback?.folder) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.knockbackNotFound')); return; }

  const toAdd = index.filter(i => i.folder === knockback.folder && !EXCLUDE_IDS.has(i.system?._dsid));

  if (toAdd.length > MAX_SAFE) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DSCT.dialog.unusualItemCount.title') },
      content: game.i18n.format('DSCT.dialog.unusualItemCount.body', { count: toAdd.length, max: MAX_SAFE }),
      rejectClose: false,
    });
    if (!proceed) { ui.notifications.info(game.i18n.localize('DSCT.notice.macros.cancelled')); return; }
  }

  const sourceDocs = await Promise.all(toAdd.map(i => pack.getDocument(i._id)));

  let added = 0, skipped = 0;
  for (const actor of game.actors) {
    const actorDsids = new Set(actor.items.map(i => i.system?._dsid ?? i.toObject().system?._dsid));
    const missing    = sourceDocs.filter(d => !actorDsids.has(d.system?._dsid));
    if (!missing.length) { skipped++; continue; }
    await actor.createEmbeddedDocuments('Item', missing.map(d => d.toObject()));
    added++;
  }

  ui.notifications.info(game.i18n.format('DSCT.notice.macros.updatedActors', { added, s: added !== 1 ? 's' : '', skipped }));
};

const ENH_FLAG = 'draw-steel-combat-tools';

export const ENHANCED_PACK = 'draw-steel-combat-tools.enhanced-abilities';

export const ENHANCED_PACKS = [ENHANCED_PACK, 'draw-steel-combat-tools.enhanced-features'];

const enhancedPacks = () => ENHANCED_PACKS.map(id => game.packs.get(id)).filter(Boolean);

async function enhancedDocuments() {
  const out = [];
  for (const pack of enhancedPacks()) out.push(...await pack.getDocuments());
  return out;
}

export function enhancedStamp(data) {
  const text = JSON.stringify({ n: data.name, i: data.img, s: data.system, e: data.effects ?? [] });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const enhancedKey = (type, dsid) => (dsid ? `${type}:${dsid}` : null);

let _docIndex = null;

export async function enhancedDocIndex() {
  if (_docIndex) return _docIndex;
  const map = new Map();
  for (const doc of await enhancedDocuments()) {
    const key = enhancedKey(doc.type, doc.system?._dsid);
    if (key) map.set(key, doc);
  }
  _docIndex = map;
  return map;
}

const _syncEffects = async (item, effects) => {
  const existing = item.effects.map(e => e.id);
  if (existing.length) await item.deleteEmbeddedDocuments('ActiveEffect', existing);
  if (effects.length) await item.createEmbeddedDocuments('ActiveEffect', effects, { keepId: true });
};

export const isSwapCandidate = (item) =>
  !!item && !item.getFlag(ENH_FLAG, 'enhancedLock') && !item.getFlag(ENH_FLAG, 'enhanced');

let _swapPrompt = null;

export const confirmSwaps = async (candidates) => {
  if (!candidates.length) return true;
  const mode = game.settings.get(ENH_FLAG, 'enhancedSwapMode');
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  if (_swapPrompt) return _swapPrompt;

  _swapPrompt = (async () => {
    const TE = foundry.applications.ux.TextEditor.implementation;
    
    const enrich = async (item) => {
      try { return await TE.enrichHTML(`@UUID[${item.uuid}]{${item.name}}`); }
      catch { return foundry.utils.escapeHTML(item.name); }
    };
    const L = (k) => game.i18n.localize(`DSCT.dialog.enhancedSwap.${k}`);

    const byOwner = new Map();
    for (const c of candidates) {
      if (!byOwner.has(c.owner)) byOwner.set(c.owner, []);
      byOwner.get(c.owner).push(c.item);
    }

    const MAX = 40;
    let shown = 0, hidden = 0;
    const blocks = [];
    for (const [owner, items] of byOwner) {
      const room = Math.max(0, MAX - shown);
      hidden += Math.max(0, items.length - room);
      const listed = items.slice(0, room);
      shown += listed.length;
      if (!listed.length) continue;
      const links = await Promise.all(listed.map(enrich));
      blocks.push(`<li><strong>${foundry.utils.escapeHTML(owner)}</strong><ul>${links.map(l => `<li>${l}</li>`).join('')}</ul></li>`);
    }
    if (hidden) blocks.push(`<li>${game.i18n.format('DSCT.dialog.enhancedSwap.andMore', { count: hidden })}</li>`);

    const content = `
      <p>${L('body')}</p>
      <ul class="dsct-swap-list">${blocks.join('')}</ul>
      <p class="hint">${L('note')}</p>
      <div class="form-group dsct-prompt-remember">
        <label><input type="checkbox" id="dsct-swap-remember" checked> ${L('remember')}</label>
      </div>`;

    const remembered = (html) => {
      const root = html instanceof HTMLElement ? html : (html?.[0] ?? null);
      return !!root?.querySelector('#dsct-swap-remember')?.checked;
    };

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: L('title') },
      position: { width: 560 },
      content,
      buttons: [
        { action: 'yes', label: L('yes'), default: true, callback: (_e, _b, d) => ({ ok: true,  remember: remembered(d.element) }) },
        { action: 'no',  label: L('no'),                 callback: (_e, _b, d) => ({ ok: false, remember: remembered(d.element) }) },
      ],
      rejectClose: false,
    });

    const ok = !!result?.ok;
    if (result?.remember) await game.settings.set(ENH_FLAG, 'enhancedSwapMode', ok ? 'always' : 'never');
    return ok;
  })();

  try { return await _swapPrompt; }
  finally { _swapPrompt = null; }
};

export const applyEnhanced = async (item, doc, { allowSwap = true } = {}) => {
  if (!item || !doc) return false;
  if (item.getFlag(ENH_FLAG, 'enhancedLock')) return false;
  if (!allowSwap && !item.getFlag(ENH_FLAG, 'enhanced')) return false;
  const data = doc.toObject();
  const hash = enhancedStamp(data);
  if (item.getFlag(ENH_FLAG, 'enhancedHash') === hash) return false;

  
  
  const flags = { enhanced: true, enhancedHash: hash };
  if (!item.getFlag(ENH_FLAG, 'enhanced')) flags.enhancedSwapped = true;

  await item.update({ name: data.name, img: data.img, system: data.system }, { recursive: false });
  await _syncEffects(item, data.effects ?? []);
  await item.update({ flags: { [ENH_FLAG]: flags } });
  return true;
};

export const swapEnhancedItem = async (item) => {
  if (!item || item.pack || item.parent?.pack) return false;
  const index = await enhancedDocIndex();
  const doc = index.get(enhancedKey(item.type, item.system?._dsid));
  if (!doc) return false;

  const owner = item.parent?.name ?? game.i18n.localize('DSCT.dialog.enhancedSwap.sidebar');
  const allowSwap = isSwapCandidate(item)
    ? await confirmSwaps([{ item, doc, owner }])
    : true;

  const changed = await applyEnhanced(item, doc, { allowSwap });
  if (changed) console.log(`DSCT | enhanced | swapped ${item.name} on ${owner} for the enhanced version.`);
  return changed;
};

const _stamped = (doc) => {
  const data = doc.toObject();
  foundry.utils.setProperty(data, 'flags.draw-steel-combat-tools.enhancedHash', enhancedStamp(data));
  return data;
};

const _prereqDsids = (doc) => {
  const raw = doc?.system?.prerequisites?.dsid;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Array.from(raw);
};

export function isUniversalEnhanced(doc) {
  const p = doc?.system?.prerequisites ?? {};
  
  if (doc?.flags?.["draw-steel-combat-tools"]?.enhancedSpecific) return false;
  return !_prereqDsids(doc).length && !String(p.value ?? '').trim() && !p.level;
}

const _meetsPrereq = (actor, dsids) => {
  if (!dsids.length) return true;
  const owned = new Set(actor.items.map(i => i.system?._dsid).filter(Boolean));
  return dsids.some(d => owned.has(d));
};

export const cleanupEnhancedAbilities = async ({ apply = false } = {}) => {
  const empty = { removed: 0, kept: 0, actors: [], keptActors: [] };
  if (!game.user.isGM) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.gmOnlyDistribute')); return empty; }
  if (!enhancedPacks().length) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.enhancedPackNotFound')); return empty; }

  const gated = (await enhancedDocuments())
    .filter(d => d.system?._dsid && !isUniversalEnhanced(d))
    .map(d => ({ dsid: d.system._dsid, name: d.name, prereq: _prereqDsids(d) }));
  if (!gated.length) return empty;

  const seen = new Set();
  const targets = [];
  for (const actor of game.actors) if (!seen.has(actor.id) && seen.add(actor.id)) targets.push(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      const actor = token.actorLink ? null : token.actor;
      if (actor && !seen.has(actor.uuid) && seen.add(actor.uuid)) targets.push(actor);
    }
  }

  const out = { removed: 0, kept: 0, actors: [], keptActors: [] };
  for (const actor of targets) {
    const doomed = [];
    for (const entry of gated) {
      const mine = actor.items.filter(i => i.system?._dsid === entry.dsid
        && i.getFlag(ENH_FLAG, 'enhanced')
        && !i.getFlag(ENH_FLAG, 'enhancedSwapped'));
      if (!mine.length) continue;
      if (_meetsPrereq(actor, entry.prereq)) { out.kept += mine.length; out.keptActors.push(`${actor.name}: ${entry.name}`); continue; }
      doomed.push(...mine.map(i => i.id));
      out.actors.push(`${actor.name}: ${entry.name}`);
    }
    if (!doomed.length) continue;
    out.removed += doomed.length;
    if (apply) {
      try { await actor.deleteEmbeddedDocuments('Item', doomed); }
      catch (err) { console.warn(`DSCT | enhanced cleanup | could not clean ${actor.name}:`, err); }
    }
  }

  const head = apply ? 'DSCT | enhanced cleanup | removed' : 'DSCT | enhanced cleanup | would remove';
  console.log(`${head} ${out.removed} item(s) from ${new Set(out.actors.map(a => a.split(':')[0])).size} actor(s); kept ${out.kept} on actors that qualify.`);
  if (out.actors.length) console.log('DSCT | enhanced cleanup | affected:', out.actors);
  if (out.keptActors.length) console.log('DSCT | enhanced cleanup | kept (actor qualifies):', out.keptActors);
  ui.notifications.info(`DSCT: ${apply ? 'removed' : 'found'} ${out.removed} misplaced enhanced ability copies, kept ${out.kept} on actors that qualify. See the console for the list.`);
  return out;
};

export const distributeEnhancedAbilities = async ({ actors = null, silent = false } = {}) => {
  const none = { added: 0, skipped: 0 };
  if (!game.user.isGM) { if (!silent) ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.gmOnlyDistribute')); return none; }
  if (!enhancedPacks().length) { if (!silent) ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.enhancedPackNotFound')); return none; }

  const docs = (await enhancedDocuments()).filter(d => d.system?._dsid);
  const wanted = (a) => a && !['party', 'object'].includes(a.type);

  const givenOut = docs.filter(isUniversalEnhanced);

  let targets = actors;
  if (!targets) {
    targets = game.actors.filter(wanted);
    for (const scene of game.scenes) {
      for (const token of scene.tokens) {
        if (!token.actorLink && wanted(token.actor)) targets.push(token.actor);
      }
    }
  }

  
  
  
  const index   = await enhancedDocIndex();
  const swapped = [];

  const matches = (item) => index.get(enhancedKey(item.type, item.system?._dsid)) ?? null;

  const sidebarLabel = game.i18n.localize('DSCT.dialog.enhancedSwap.sidebar');
  const candidates = [];
  for (const actor of targets) {
    for (const item of actor.items) {
      const doc = matches(item);
      if (doc && isSwapCandidate(item)) candidates.push({ item, doc, owner: actor.name });
    }
  }
  if (!actors) {
    for (const item of game.items) {
      const doc = matches(item);
      if (doc && isSwapCandidate(item)) candidates.push({ item, doc, owner: sidebarLabel });
    }
  }
  const allowSwap = await confirmSwaps(candidates);

  const refresh = async (actor) => {
    let touched = false;
    for (const item of [...actor.items]) {
      const doc = matches(item);
      if (!doc) continue;
      const wasEnhanced = !!item.getFlag(ENH_FLAG, 'enhanced');
      if (!await applyEnhanced(item, doc, { allowSwap })) continue;
      if (!wasEnhanced) swapped.push(`${actor.name}: ${doc.name}`);
      touched = true;
    }
    return touched;
  };

  let added = 0, skipped = 0, failed = 0, refreshed = 0;
  for (const actor of targets) {
    const have = new Set(actor.items.map(i => i.system?._dsid));
    const missing = givenOut.filter(d => !have.has(d.system._dsid));
    try {
      if (await refresh(actor)) refreshed++;
      if (!missing.length) { skipped++; continue; }
      await actor.createEmbeddedDocuments('Item', missing.map(_stamped));
      added++;
    } catch (err) {
      failed++;
      console.warn(`DSCT | enhanced abilities | could not add to ${actor.name}:`, err);
    }
  }

  if (!actors) {
    for (const item of [...game.items]) {
      const doc = matches(item);
      if (!doc) continue;
      const wasEnhanced = !!item.getFlag(ENH_FLAG, 'enhanced');
      try {
        if (await applyEnhanced(item, doc, { allowSwap }) && !wasEnhanced) swapped.push(`${sidebarLabel}: ${doc.name}`);
      } catch (err) {
        failed++;
        console.warn(`DSCT | enhanced abilities | could not swap the sidebar copy of ${item.name}:`, err);
      }
    }
  }

  if (swapped.length) console.log('DSCT | enhanced | swapped for the enhanced version:', swapped);
  if (!silent) {
    ui.notifications.info(game.i18n.format('DSCT.notice.macros.updatedActors', { added, s: added !== 1 ? 's' : '', skipped }));
    if (refreshed) ui.notifications.info(game.i18n.format('DSCT.notice.macros.enhancedRefreshed', { refreshed }));
    if (swapped.length) ui.notifications.info(game.i18n.format('DSCT.notice.macros.enhancedSwapped', { swapped: swapped.length }));
    if (failed) ui.notifications.warn(game.i18n.format('DSCT.notice.macros.enhancedFailed', { failed }));
  }
  return { added, skipped, failed, refreshed, swapped: swapped.length };
};

export class EnhancedAbilitiesMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: 'Add Enhanced Abilities', template: null });
  }
  async _render() {
    await distributeEnhancedAbilities();
  }
  async _updateObject() {}
}

export class InstallMacrosMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: 'Install DSCT Macros', template: null });
  }
  async _render() {
    await installMacros();
  }
  async _updateObject() {}
}
