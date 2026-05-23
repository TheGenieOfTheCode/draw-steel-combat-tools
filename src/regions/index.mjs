import { registerRegionOpacityHooks } from './region-opacity.mjs';
import { registerRegionVisibilityHooks } from './region-visibility.mjs';
import { registerAbilityTemplateConfigHooks } from './ability-template-config.mjs';
import { registerRegionEffectBehaviors } from './region-effects.mjs';

Hooks.once('init', () => {
  registerRegionOpacityHooks();
  registerRegionVisibilityHooks();
  registerAbilityTemplateConfigHooks();
  registerRegionEffectBehaviors();
});

Hooks.once('socketlib.ready', () => {
  const socket = game.modules.get('draw-steel-combat-tools').api?.socket;
  if (!socket) return;
  socket.register('dsct.createTemplateRegion', async (sceneUuid, createData, tokenId, userId) => {
    const scene = await fromUuid(sceneUuid);
    if (!scene) return null;
    if (userId) createData.ownership = { default: 0, [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
    const [region] = await scene.createEmbeddedDocuments('Region', [createData]);
    if (tokenId) await region.update({ 'attachment.token': tokenId });
    return region.uuid;
  });
});
