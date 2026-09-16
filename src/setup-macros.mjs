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

export const ENHANCED_PACK = 'draw-steel-combat-tools.enhanced-abilities';

export function enhancedStamp(data) {
  const text = JSON.stringify({ n: data.name, i: data.img, s: data.system });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

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
  const pack = game.packs.get(ENHANCED_PACK);
  if (!pack) { ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.enhancedPackNotFound')); return empty; }

  const gated = (await pack.getDocuments())
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
      const mine = actor.items.filter(i => i.system?._dsid === entry.dsid && i.getFlag('draw-steel-combat-tools', 'enhanced'));
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
  const pack = game.packs.get(ENHANCED_PACK);
  if (!pack) { if (!silent) ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.enhancedPackNotFound')); return none; }

  const docs = (await pack.getDocuments()).filter(d => d.system?._dsid);
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

  
  
  
  const refresh = async (actor) => {
    let touched = false;
    for (const doc of docs) {
      const mine = actor.items.find(i => i.system?._dsid === doc.system._dsid);
      if (!mine || !mine.getFlag('draw-steel-combat-tools', 'enhanced') || mine.getFlag('draw-steel-combat-tools', 'enhancedLock')) continue;
      const data = doc.toObject();
      const hash = enhancedStamp(data);
      if (mine.getFlag('draw-steel-combat-tools', 'enhancedHash') === hash) continue;
      await mine.update({ name: data.name, img: data.img, system: data.system }, { recursive: false });
      await mine.setFlag('draw-steel-combat-tools', 'enhancedHash', hash);
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
  if (!silent) {
    ui.notifications.info(game.i18n.format('DSCT.notice.macros.updatedActors', { added, s: added !== 1 ? 's' : '', skipped }));
    if (refreshed) ui.notifications.info(game.i18n.format('DSCT.notice.macros.enhancedRefreshed', { refreshed }));
    if (failed) ui.notifications.warn(game.i18n.format('DSCT.notice.macros.enhancedFailed', { failed }));
  }
  return { added, skipped, failed, refreshed };
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
