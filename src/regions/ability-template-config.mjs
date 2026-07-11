import { getModuleApi, safeDelete } from '../helpers.mjs';

const M  = 'draw-steel-combat-tools';
const DS = 'draw-steel';


async function _syncTemplateRegionToItem(region) {
  const abilityItemUuid = region.getFlag(M, 'abilityItemUuid');
  if (!abilityItemUuid) return;
  const item = await fromUuid(abilityItemUuid);
  if (!item || !item.isOwner) return;
  await item.setFlag(M, 'templateRegionData', region.toObject());
}

async function _openTemplateConfig(item) {
  let region = null;
  const existingUuid = item.getFlag(M, 'templateRegionUuid');
  if (existingUuid) region = await fromUuid(existingUuid);

  if (!region) {
    const scene = canvas.scene ?? game.scenes.active;
    if (!scene) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.noSceneForTemplate'));
      return;
    }

    
    const stored = foundry.utils.deepClone(item.getFlag(M, 'templateRegionData') ?? {});
    delete stored._id;

    const createData = foundry.utils.mergeObject(
      {
        name:          `[Template] ${item.name}`,
        shapes:        [],
        color:         game.user.color,
        visibility:    CONST.REGION_VISIBILITY.ALWAYS,
        highlightMode: 'coverage',
      },
      stored,
      { inplace: false }
    );

    
    foundry.utils.setProperty(createData, `flags.${M}.isAbilityTemplate`, true);
    foundry.utils.setProperty(createData, `flags.${M}.abilityItemUuid`,   item.uuid);

    const actor   = item.actor;
    const tokenId = !stored.attachment?.token
      ? (canvas.tokens.controlled.find(t => t.actor === actor) ?? actor?.getActiveTokens()?.[0])?.id ?? null
      : null;

    let regionUuid;
    if (game.user.isGM) {
      const [doc] = await scene.createEmbeddedDocuments('Region', [createData]);
      if (tokenId) await doc.update({ 'attachment.token': tokenId });
      regionUuid = doc.uuid;
    } else {
      const socket = getModuleApi(false)?.socket;
      if (!socket) { ui.notifications.warn('DSCT: Socket not available.'); return; }
      regionUuid = await socket.executeAsGM('dsct.createTemplateRegion', scene.uuid, createData, tokenId, game.user.id);
    }

    await item.setFlag(M, 'templateRegionUuid', regionUuid);
    region = await fromUuid(regionUuid);
    
    if (!region) {
      await new Promise(r => setTimeout(r, 300));
      region = await fromUuid(regionUuid);
    }
  }

  if (!region) { ui.notifications.warn('DSCT: Could not find template region.'); return; }
  region.sheet.render(true);
}

function _injectConfigButton(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector('.dsct-template-config-btn-wrap')) return;
  if (!app.document?.isOwner) return;

  const item = app.document;
  if (!item?.system?.hasTemplate) return;

  const typeField = root.querySelector('[name="system.distance.type"]');
  if (!typeField) return;
  const typeGroup = typeField.closest('.form-group');
  if (!typeGroup) return;

  const wrap = document.createElement('div');
  wrap.className = 'dsct-template-config-btn-wrap';

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'dsct-template-config-btn';
  btn.innerHTML = `<i class="fa-solid fa-sliders"></i> ${game.i18n.localize('DSCT.button.configureTemplate')}`;
  btn.addEventListener('click', () => _openTemplateConfig(item));

  wrap.appendChild(btn);
  typeGroup.before(wrap);
}


function _registerPlaceRegionPatch() {
  libWrapper.register(
    M,
    'foundry.canvas.layers.RegionLayer.prototype.placeRegion',
    async function(wrapped, regionData, options) {
      const abilitySourceUuid = regionData?.flags?.[DS]?.abilitySource;
      if (abilitySourceUuid) {
        try {
          const item         = await fromUuid(abilitySourceUuid);
          const templateData = item?.getFlag(M, 'templateRegionData');

          if (templateData) {
            if (templateData.color         !== undefined) regionData.color         = templateData.color;
            if (templateData.visibility    !== undefined) regionData.visibility    = templateData.visibility;
            if (templateData.highlightMode !== undefined) regionData.highlightMode = templateData.highlightMode;

            if (templateData.behaviors?.length) {
              regionData.behaviors = templateData.behaviors.map(({ _id, ...b }) => b);
            }

            const tplFlags = foundry.utils.deepClone(templateData.flags ?? {});
            if (tplFlags[M]) {
              delete tplFlags[M].isAbilityTemplate;
              delete tplFlags[M].abilityItemUuid;
            }
            regionData.flags = foundry.utils.mergeObject(
              tplFlags,
              regionData.flags ?? {},
              { inplace: false }
            );
          }

          if (options?.attachToToken && regionData.shapes?.length) {
            const actor    = item?.actor;
            const tokenDoc = actor?.token ?? actor?.getActiveTokens()?.[0]?.document;
            if (tokenDoc) {
              const src   = tokenDoc._source;
              const shape = regionData.shapes[0];
              if (shape.type === 'emanation' && shape.base) {
                regionData.shapes[0] = {
                  ...shape,
                  base: { ...shape.base, x: src.x, y: src.y, width: src.width, height: src.height, shape: src.shape },
                };
              }
              regionData.attachment = { token: tokenDoc.id };
              regionData.levels     = [src.level];
              regionData.hidden     = tokenDoc.hidden;
              const [region] = await canvas.scene.createEmbeddedDocuments('Region', [regionData]);
              return region ?? null;
            }
          }
        } catch (e) {
          console.warn('DSCT | ability-template-config | failed to process:', e);
        }
      }
      return wrapped(regionData, options);
    },
    
    'MIXED'
  );
}

async function _onDeleteItem(item) {
  const templateUuid = item.getFlag?.(M, 'templateRegionUuid');
  if (!templateUuid) return;
  try {
    const region = await fromUuid(templateUuid);
    if (region) await safeDelete(region);
  } catch (_) {  }
}

export function registerAbilityTemplateConfigHooks() {
  if (!globalThis.libWrapper) {
    console.warn('DSCT | ability-template-config | libWrapper not found -- template config skipped');
    return;
  }

  _registerPlaceRegionPatch();

  Hooks.on('updateRegion',         (doc)  => _syncTemplateRegionToItem(doc));
  Hooks.on('createRegionBehavior', (doc)  => _syncTemplateRegionToItem(doc.parent));
  Hooks.on('updateRegionBehavior', (doc)  => _syncTemplateRegionToItem(doc.parent));
  Hooks.on('deleteRegionBehavior', (doc)  => _syncTemplateRegionToItem(doc.parent));

  Hooks.on('renderDrawSteelItemSheet', _injectConfigButton);
  Hooks.on('deleteItem',      _onDeleteItem);
}
