//This whole thing is just because I don't want to continue trying to figure out compendiums, I will eventually and then this will be depracated.

const MACRO_FOLDER_NAME = 'Draw Steel: Combat Tools';

const MACROS = [
  {
    name: 'DSCT: Forced Movement Panel',
    img: 'icons/skills/movement/arrows-up-trio-red.webp',
    command:
`// Opens or closes the Forced Movement panel.
// Select one token (the source/pusher) and target one token (the creature being moved).
// Configure type (Push / Pull / Slide), distance, and optional vertical movement in the panel.
game.modules.get('draw-steel-combat-tools').api.forcedMovementUI();`
  },
  {
    name: 'DSCT: Forced Movement (Direct)',
    img: 'icons/skills/movement/arrows-up-trio-red.webp',
    command:
`// Executes forced movement directly without opening the panel.
// Requires one targeted token (the creature to move). Optionally control one token to act as the source for range checks.
//
// Array format: [type, distance, bonusCreatureDmg, bonusObjectDmg, verticalHeight,
//                fallReduction, noFallDamage, ignoreStability, noCollisionDamage,
//                keywords, range, fastMove]
//
// Simple push - target a token then run:
await game.modules.get('draw-steel-combat-tools').api.forcedMovement(['Push', 3]);

// Pull 2 squares with 2 squares of vertical lift, no fall damage:
// await game.modules.get('draw-steel-combat-tools').api.forcedMovement(['Pull', 2, 0, 0, 2, 0, true]);

// Programmatic use with explicit token IDs (e.g. from another macro or script):
// await game.modules.get('draw-steel-combat-tools').api.forcedMovement({
//   type: 'Push', distance: 3,
//   targetId: targetToken.id,
//   sourceId: sourceToken.id,
//   verticalHeight: 0,
//   suppressMessage: false
// });`
  },
  {
    name: 'DSCT: Grab Panel',
    img: 'icons/skills/melee/hand-grip-sword-orange.webp',
    command:
`// Opens or closes the Grab panel.
// Use the panel to initiate grabs, monitor active grabs, and release grabbed tokens.
game.modules.get('draw-steel-combat-tools').api.grabPanel();`
  },
  {
    name: 'DSCT: Grab (Direct)',
    img: 'icons/skills/melee/hand-grip-sword-orange.webp',
    command:
`// Initiates a grab between two tokens programmatically.
// Control one token (the grabber) and target one token (the target).
const grabber = canvas.tokens.controlled[0];
const target  = [...game.user.targets][0];
if (!grabber || !target) {
  ui.notifications.warn('Select one token (grabber) and target one token.');
} else {
  await game.modules.get('draw-steel-combat-tools').api.grab(grabber, target);
}`
  },
  {
    name: 'DSCT: End Grab',
    img: 'icons/skills/melee/hand-grip-sword-orange.webp',
    command:
`// Ends an active grab on the targeted or controlled grabbed token.
// Target or select the token that is currently being grabbed, then run.
const token = [...game.user.targets][0] ?? canvas.tokens.controlled[0];
if (!token) {
  ui.notifications.warn('Target or select the grabbed token.');
} else {
  await game.modules.get('draw-steel-combat-tools').api.endGrab(token.id);
}`
  },
  {
    name: 'DSCT: Revive',
    img: 'icons/magic/life/heart-cross-strong-flame-green.webp',
    command:
`// Opens the Revive UI. GM only.
// Skulls on the canvas are highlighted green. Click one or more to select them (they turn blue),
// then press ENTER to revive all selected creatures. Right-Click or Escape to cancel.
game.modules.get('draw-steel-combat-tools').api.revive();`
  },
  {
    name: 'DSCT: Power Word Kill',
    img: 'icons/magic/death/skull-horned-goat-pentagram-red.webp',
    command:
`// Opens the Power Word Kill UI. GM only.
// Target one or more tokens to instantly kill them, triggering the death animation and placing skull markers for any eligible creatures.
game.modules.get('draw-steel-combat-tools').api.powerWordKill();`
  },
  {
    name: 'DSCT: Judgement',
    img: 'icons/magic/death/skull-humanoid-white-red.webp',
    command:
`// Applies the Judgement effect to the targeted token. Target exactly one token then run.
// When the judged target dies, a prompt appears to use a free triggered action to apply Judgement to a new target.
await game.modules.get('draw-steel-combat-tools').api.judgement();`
  },
  {
    name: 'DSCT: Mark',
    img: 'icons/skills/targeting/crosshair-pointed-orange.webp',
    command:
`// Applies the Mark effect to the targeted token(s) using the Mark ability (DSID: mark).
// Target one token (or two if the actor has Anticipation), then run.
// When a marked target dies, a prompt appears to use a free triggered action to mark a new target within 10 squares.
// Reusing this macro clears any previous marks placed by the Mark ability and applies fresh ones.
await game.modules.get('draw-steel-combat-tools').api.mark({ maxTargets: 1, override: true, dsid: 'mark' });`
  },
  {
    name: 'DSCT: Aid Attack',
    img: 'icons/skills/social/diplomacy-handshake-blue.webp',
    command:
`// Applies the Aid Attack edge to a target. Select one token (the aider) and target one token (the creature being aided against).
// The edge automatically clears after the next ability roll is made against that target, or when combat ends.
await game.modules.get('draw-steel-combat-tools').api.aidAttack();`
  },
  {
    name: 'DSCT: Teleport Panel',
    img: 'icons/magic/movement/trail-streak-pink.webp',
    command:
`// Opens or closes the Teleport panel.
// Select one or more tokens, configure color and animation in the panel, then click a destination on the canvas.
game.modules.get('draw-steel-combat-tools').api.teleportUI();`
  },
  {
    name: 'DSCT: Teleport (Direct)',
    img: 'icons/magic/movement/trail-streak-pink.webp',
    command:
`// Teleports the selected (or specified) token without opening the panel.
// After running, click a valid destination square on the canvas.
//
// distance  - maximum teleport range in squares
// colorHex  - phase-out colour as a hex string (e.g. '#a030ff' for purple, '#00ccff' for cyan)
//             set animate: false to skip the colour effect entirely
// duration  - length of the phase-in/out animation in milliseconds
// sourceId  - (optional) explicit token ID; omit to use the currently controlled token
await game.modules.get('draw-steel-combat-tools').api.teleport({
  distance: 5,
  animate:  true,
  colorHex: '#a030ff',
  duration: 600,
  // sourceId: 'paste-token-id-here',
});`
  },
  {
    name: 'DSCT: Apply Squad Labels',
    img: 'icons/environment/people/group.webp',
    command:
`// Manually applies squad label icons to all current combatants.
// Normally runs automatically at combat start when Auto-Apply Squad Labels is enabled. Useful for applying labels mid-combat after adding new combatants.
await game.modules.get('draw-steel-combat-tools').api.squadLabels();`
  },
  {
    name: 'DSCT: Rename Squads',
    img: 'icons/environment/people/group.webp',
    command:
`// Auto-renames all squad groups based on their current members.
// Useful for keeping squad names tidy after adding or removing combatants mid-encounter.
await game.modules.get('draw-steel-combat-tools').api.renameSquads();`
  },
  {
    name: 'DSCT: Apply Triggered Action Trackers',
    img: 'icons/magic/symbols/runes-star-magenta.webp',
    command:
`// Manually applies the Unspent Triggered Action tracker to combatants.
// Normally runs automatically at combat start when the setting is enabled.
// Uses the "Triggered Action Tracker Targets" module setting by default.
// Pass an explicit mode to override: 'ALL', 'HEROES', 'NPCS', or 'TARGETED'.
await game.modules.get('draw-steel-combat-tools').api.triggeredActions();`
  },
  {
    name: 'DSCT: Distribute Abilities',
    img: 'icons/sundries/books/book-red-exclamation.webp',
    command:
`// Distributes forced movement abilities (Knockback, etc.) from the Draw Steel compendium to every actor that doesn't already have them.
// Safe to run multiple times - actors that already have all abilities are skipped automatically. GM only.
await game.modules.get('draw-steel-combat-tools').api.distributeAbilities();`
  },
  {
    name: 'DSCT: Fall',
    img: 'icons/magic/control/debuff-energy-snare-purple-pink.webp',
    command:
`// Applies fall damage and drops the selected or targeted token to the ground.
// Respects fly speed, prone status, and speed 0 (a grounded flyer still falls).
// Useful when a creature ends up airborne outside of normal forced movement.
const token = canvas.tokens.controlled[0] ?? [...game.user.targets][0] ?? null;
if (!token) { ui.notifications.warn('Select or target a token first.'); return; }
await game.modules.get('draw-steel-combat-tools').api.fall(token, 0, { silent: false });`
  },
  {
    name: 'DSCT: Burst Teleport',
    img: 'icons/magic/movement/trail-streak-pink.webp',
    command:
`// Teleports every token within a burst area to a new position inside that same area.
// Control the caster token (burst center), then run.
//
// radius        - burst size in squares (e.g. 2 = Burst 2, a 5×5 area around the caster)
// filter        - which tokens to include: 'all' (default), 'hero' (heroes only), 'npc' (NPCs only)
// excludeSource - if true, the caster token is excluded from the teleport queue (default false)
// sourceId      - (optional) explicit token ID for the caster; omit to use the controlled token
//
// How it works:
//   1. All matching non-dead tokens within the burst are added to the queue.
//   2. Click a highlighted token to choose who teleports next.
//   3. Click a valid (purple) square in the burst to place them there.
//   4. Repeat until done, or press Escape to finish early.
//      Escape during token selection ends the sequence.
//      Escape during destination selection skips that token.
await game.modules.get('draw-steel-combat-tools').api.burstTeleport({
  radius: 2,
  filter: 'all',
  excludeSource: false,
  // sourceId: 'paste-token-id-here',
});`
  },
  {
    name: 'DSCT: Apply Frightened',
    img: 'icons/svg/terror.svg',
    command:
`// Applies the Frightened condition (DSCT version) to all targeted tokens.
// Control the source token (the creature causing fear) and target the affected creatures.
//
// duration - controls when the condition expires:
//   'turn'      → End of the target's next turn
//   'encounter' → End of the encounter (no save)
//   'save'      → Save ends (encounter roll: 1d10 + save bonus)
//   null        → Defaults to save ends
const duration = 'save';

const sourceToken = canvas.tokens.controlled[0];
const targets     = [...game.user.targets];
if (!sourceToken) { ui.notifications.warn('Control the source token (the frightening creature).'); return; }
if (!targets.length) { ui.notifications.warn('Target one or more tokens to apply Frightened to.'); return; }

const api = game.modules.get('draw-steel-combat-tools').api;
for (const t of targets) {
  await api.applyFrightened(t, sourceToken.actor, sourceToken.id, duration);
}`
  },
  {
    name: 'DSCT: Convert Walls',
    img: 'icons/environment/settlement/fence-stone-brick.webp',
    command:
`// Converts selected canvas walls into DSCT obstacle tiles. GM only.
// Switch to the Walls layer (W key), select the walls you want to convert,
// then run this macro. Each grid square covered by ≥ 50% of a wall gets
// an invisible obstacle tile. Walls spanning multiple squares are tagged for
// lazy splitting at collision time during forced movement.
//
// material     - 'stone' | 'wood' | 'glass' | 'metal' (or any custom material)
// heightBottom / heightTop - wall elevation range (omit for unlimited)
// invisible    - true (default): tiles are alpha 0 (collision only); false: show material texture
// stable       - true (default): prevents Infinity-height bugs when elevation is unset
await game.modules.get('draw-steel-combat-tools').api.convertWalls('stone');
// await game.modules.get('draw-steel-combat-tools').api.convertWalls('wood', 0, 3, true, true);
// await game.modules.get('draw-steel-combat-tools').api.convertWalls('stone', '', '', false, false); // visible, unstable`
  },
  {
    name: 'DSCT: Apply Taunted',
    img: 'systems/draw-steel/assets/icons/flag-banner-fold-fill.svg',
    command:
`// Applies the Taunted condition (DSCT version) to all targeted tokens.
// Control the source token (the creature doing the taunting) and target the affected creatures.
//
// duration - controls when the condition expires:
//   'turn'      → End of the target's next turn
//   'encounter' → End of the encounter (no save)
//   'save'      → Save ends (encounter roll: 1d10 + save bonus)
//   null        → Defaults to save ends
const duration = 'save';

const sourceToken = canvas.tokens.controlled[0];
const targets     = [...game.user.targets];
if (!sourceToken) { ui.notifications.warn('Control the source token (the taunting creature).'); return; }
if (!targets.length) { ui.notifications.warn('Target one or more tokens to apply Taunted to.'); return; }

const api = game.modules.get('draw-steel-combat-tools').api;
for (const t of targets) {
  await api.applyTaunted(t, sourceToken.actor, sourceToken.id, duration);
}`
  },
  {
    name: "DSCT: I'm No Threat",
    img: 'icons/creatures/mammals/humanoid-fox-cat-archer.webp',
    command:
`// Opens the I'm No Threat panel for the selected or targeted token.
// Control or target the Harlequin actor, then run.
// The panel tracks OOC victories, manages the I'm No Threat illusion effect, and handles the Harlequin Illusion roll.
const token = canvas.tokens.controlled[0] ?? [...game.user.targets][0] ?? null;
const actor = token?.actor ?? null;
game.modules.get('draw-steel-combat-tools').api.imNoThreat(actor);`
  },
];

const MACRO_SETTINGS = {
  'DSCT: Judgement':     'judgementAutomation',
  'DSCT: Mark':          'markAutomation',
  'DSCT: Aid Attack':    'aidAttackAutomation',
  "DSCT: I'm No Threat": 'imNoThreatEnabled',
};

export const installMacros = async ({ silent = false } = {}) => {
  if (!game.user.isGM) { ui.notifications.warn('Only the GM can install DSCT macros.'); return; }

  let folder = game.folders.find(f => f.type === 'Macro' && f.name === MACRO_FOLDER_NAME);
  if (!folder) folder = await Folder.create({ name: MACRO_FOLDER_NAME, type: 'Macro' });

  const M = 'draw-steel-combat-tools';

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;

  for (const data of MACROS) {
    const settingKey = MACRO_SETTINGS[data.name];
    const isDisabled = settingKey && game.settings.get(M, settingKey) === false;

    const exists = game.macros.find(m => m.name === data.name && m.folder?.id === folder.id);

    if (isDisabled) {
      if (exists) { await exists.delete(); removed++; }
      continue;
    }

    if (exists) {
      if (exists.command !== data.command || exists.img !== data.img) {
        await exists.update({ command: data.command, img: data.img });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }
    await Macro.create({ name: data.name, type: 'script', img: data.img, command: data.command, folder: folder.id });
    created++;
  }

  const parts = [`${created} created`, `${updated} updated`, `${skipped} up to date`];
  if (removed) parts.push(`${removed} removed`);
  const summary = `DSCT | Macros: ${parts.join(', ')}. Folder: "${MACRO_FOLDER_NAME}".`;
  if (silent) console.log(summary);
  else ui.notifications.info(summary);
};

export const distributeAbilities = async () => {
  if (!game.user.isGM) { ui.notifications.warn('Only the GM can distribute abilities.'); return; }

  const MAX_SAFE    = 15;
  const pack        = game.packs.get('draw-steel.abilities');
  const EXCLUDE_IDS = new Set(['melee-free-strike', 'ranged-free-strike', 'heal', 'catch-breath']);

  if (!pack) { ui.notifications.warn('Could not find the draw-steel.abilities compendium.'); return; }

  const index     = await pack.getIndex({ fields: ['system._dsid', 'folder'] });
  const knockback = index.find(i => i.system?._dsid === 'knockback');
  if (!knockback?.folder) { ui.notifications.warn('Could not find Knockback in the abilities pack.'); return; }

  const toAdd = index.filter(i => i.folder === knockback.folder && !EXCLUDE_IDS.has(i.system?._dsid));

  if (toAdd.length > MAX_SAFE) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Unusual Item Count' },
      content: `<p>This operation is about to add <strong>${toAdd.length} items</strong> to every actor sheet, which is more than expected (max ${MAX_SAFE}). Something may have gone wrong.</p><p>Proceed anyway?</p>`,
      rejectClose: false,
    });
    if (!proceed) { ui.notifications.info('Cancelled.'); return; }
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

  ui.notifications.info(`Done. Updated ${added} actor(s), skipped ${skipped} (already complete).`);
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
