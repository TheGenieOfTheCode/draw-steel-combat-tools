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

export class InstallMacrosMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { title: 'Install DSCT Macros', template: null });
  }
  async _render() {
    await installMacros();
  }
  async _updateObject() {}
}
