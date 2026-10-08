const lib = globalThis.ctlib;
if (!lib) {
  const why = 'Draw Steel: Combat Tools needs Draw Steel: CTLib 1.2.0 or later, active in this world.';
  Hooks.once('ready', () => ui.notifications.error(why, { permanent: true }));
  throw new Error(why);
}

export const {
  BASE_MATERIALS, COVER_KEY, DAMAGE_TYPES, activateFaces, damageTypeIconHTML, damageTypeLabel, CTLIB_SCOPE, DELETE_MARKER, DSTD, DSTD_PANEL, DSTD_ROW, GRID, LEGACY_SCOPE, LOE_KEY,
  MATERIAL_ALPHA, MATERIAL_ICONS, MATERIAL_RULES, MATERIAL_RULE_DEFAULTS, MULTI_GRAB_LIMITS, SIGHT_SAMPLE_COUNT,
  STEALTH_WORKFLOW_READY, WALL_RESTRICTIONS, WALL_RESTRICTION_DEFAULTS, activateTokenLayer,
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

export const SettingsSubmenu = lib.settingsSubmenu?.() ?? lib.SettingsSubmenu;

export const primaryGM = lib.primaryGM ?? (() => game.users.activeGM ?? null);
export const isPrimaryGM = lib.isPrimaryGM ?? (() => !!game.users.activeGM?.isSelf);
export const executeAsDirector = lib.executeAsDirector
  ?? ((socket, handler, ...args) => (socket ? socket.executeAsGM(handler, ...args) : Promise.resolve(undefined)));
