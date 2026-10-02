

const ctlibIndex = () => {
  const tag = [...document.querySelectorAll('script[type="module"][src]')]
    .find((s) => /\/draw-steel-ctlib\/(?:.*\/)?src\/main\.mjs(?:[?#]|$)/.test(s.src));
  return tag ? new URL('index.mjs', tag.src).href : new URL('../../draw-steel-ctlib/src/index.mjs', import.meta.url).href;
};

const lib = await import(ctlibIndex());

export const {
  BASE_MATERIALS, COVER_KEY, DAMAGE_TYPES, activateFaces, damageTypeIconHTML, damageTypeLabel, CTLIB_SCOPE, DELETE_MARKER, DSTD, DSTD_PANEL, DSTD_ROW, GRID, LEGACY_SCOPE, LOE_KEY,
  MATERIAL_ALPHA, MATERIAL_ICONS, MATERIAL_RULES, MATERIAL_RULE_DEFAULTS, MULTI_GRAB_LIMITS, SIGHT_SAMPLE_COUNT,
  STEALTH_WORKFLOW_READY, SettingsSubmenu, WALL_RESTRICTIONS, WALL_RESTRICTION_DEFAULTS, activateTokenLayer,
  addPreviewToken, addTags, applicationSignature, armCoverImmunity, atLeastHalfBlocked, beginPickerOverlay,
  blocksLoeForEnemies, burrowAdjacent, burrowBlocksLineOfEffect, burrowDepth, canCurrentlyFly, canForcedMoveTarget,
  chooseFreeSquare, clampOutsetPoints, clearPickerArrows, clearPreviewTokens, concealingRegions, config,
  cornersAreOutside, cornersNeedClamping, coverImmunityGrantor, coverObstaclesFor, coveredInSquare, ctlibFlag,
  damageBatch, describePanelDecorators, disarmCoverImmunity, dropKey, dropKeyOverSocket, endPickerOverlay,
  footprintCoverCells, footprintDistFromBounds, fullCoverBlockersFor, getActingActor, getAllMaterials, getByTag,
  getCustomMaterials, getItemDsid, getItemRange, getMaterial, getMaterialAlpha, getMaterialIcon, getSquadGroup,
  getTags, getTokenById, getValidTargets, hitToken, getWallBlockBottom, getWallBlockTileAt, getWallBlockTop, getWallBlockWalls,
  getWindowById, grantsCoverBehind, grantsCoverImmunity, gridDist, gridEq, groundElevation, hasCover, hasFly,
  hasSightToSquare, hasSightToToken, hasTags, highestCharacteristic, initPalette, isBurrowing, isCompletelyBeneath,
  isOnGround, isOpenDoorWall, isPreviewToken, isRaisedDeadVisible, isSelfAndSelf, loeBlockersFor, loeRangeBlocked,
  loeRangeCap, monsterFilter, normalizeCollection, parsePowerRollState, pickCanvasTarget, rangeEnforced,
  refreshLoeCornerMode, registerPanelDecorator, registerStatusGroup, removePickerArrow, removePickerTarget,
  removePreviewToken, removeTags, replayUndo, revealPickerUi, reviveDropKeys, runColoredTokenPicker,
  safeCreateEmbedded, safeDelete, safeSetFlag, safeTeleport, safeToggleStatusEffect, safeUnsetFlag, safeUpdate,
  seenPlainlyInSquare, segmentBlockedByCover, segmentBlocksSight, segmentsIntersect, services, setPickerArrow,
  setPickerTarget, setRaisedDeadVisible, sightBlockPoint, sightLinesToToken, sightOriginPoints, sightSamplePoints,
  sightSamples, sizeRank, snapStamina, spaceSamplePoints, squareIsConcealed, stackedPrompt, tierOf, tileAt,
  tileIsOpenDoor, toCenter, toGrid, toWorld, tokFootprintDist, tokenAt, tokenCoverMode, touchesGround, undoDamage,
  visibleSquareCorners, visibleTargetCorners, wallBetween, wallBlocksMovement, wallGrantsCover
} = lib;
