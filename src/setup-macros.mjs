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

export const distributeEnhancedAbilities = async ({ actors = null, silent = false } = {}) => {
  const none = { added: 0, skipped: 0 };
  if (!game.user.isGM) { if (!silent) ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.gmOnlyDistribute')); return none; }
  const pack = game.packs.get(ENHANCED_PACK);
  if (!pack) { if (!silent) ui.notifications.warn(game.i18n.localize('DSCT.notice.macros.enhancedPackNotFound')); return none; }

  const docs = (await pack.getDocuments()).filter(d => d.system?._dsid);
  const wanted = (a) => a && !['party', 'object'].includes(a.type);

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
      if (!mine?.system?.effects) continue;
      const src = doc.toObject().system?.effects ?? {};
      const update = {};
      for (const [id, data] of Object.entries(src)) {
        if (!String(data?.type ?? '').startsWith('dsct.')) continue;
        if (mine.system.effects.get?.(id) ?? mine.system.effects[id]) continue;
        update[`system.effects.${id}`] = data;
      }
      if (!Object.keys(update).length) continue;
      await mine.update(update);
      touched = true;
    }
    return touched;
  };

  let added = 0, skipped = 0, failed = 0, refreshed = 0;
  for (const actor of targets) {
    const have = new Set(actor.items.map(i => i.system?._dsid));
    const missing = docs.filter(d => !have.has(d.system._dsid));
    try {
      if (await refresh(actor)) refreshed++;
      if (!missing.length) { skipped++; continue; }
      await actor.createEmbeddedDocuments('Item', missing.map(d => d.toObject()));
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
