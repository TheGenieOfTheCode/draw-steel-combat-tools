

const MODULE_ID = 'draw-steel-combat-tools';

export const LIBWRAPPER  = 'lib-wrapper';
export const DSTD        = 'draw-steel-target-damage';
export const QUICKSTRIKE = 'ds-quick-strike';

const DEP_LABELS = {
  [LIBWRAPPER]:  'libWrapper',
  [DSTD]:        'Target Damage',
  [QUICKSTRIKE]: 'Quick Strike',
};

const lw = (level, why) => ({ id: LIBWRAPPER, level, why });
const td = (level, why) => ({ id: DSTD, level, why });

const SETTING_DEPS = {
  

  forcedMovementEnabled: [lw('inert', 'the forced movement buttons are added by patching the system ability effect, so none appear in chat.')],
  appliedEffectEnabled:  [lw('inert', 'the applied effect buttons are added by patching the system ability effect, so none appear in chat.')],
  applyDamageEnabled:    [lw('inert', 'the damage roll button is added by patching the system, so it never appears.')],

  trueDrawSteelLos: [lw('inert', 'vision is changed by patching the sight polygon backend and the token document, none of which happens.')],

  squadSimultaneousTurns: [lw('inert', 'squad turns are grouped by patching the combat tracker, so turns stay individual.')],
  squadGlowMarker:        [lw('inert', 'the turn marker is drawn by patching the token, so no marker appears.')],
  squadGlowMarkerColored: [lw('inert', 'this colours the squad turn marker, which is not drawn at all.')],
  pairSimultaneousTurns:  [lw('reduced', 'mentor and retainer still activate together, but the pairing is not reflected in the combat tracker.')],

  squadHudEnabled:          [lw('inert', 'the floating health bar replaces the token bar by patching it, so it never appears.')],
  squadHudScale:            [lw('inert', 'this sizes the squad health bar, which is not drawn at all.')],
  squadHudPlayerVisibility: [lw('inert', 'this controls who sees the squad health bar, which is not drawn at all.')],
  stickbugMode:             [lw('inert', 'this belongs to the squad health bar, which is not drawn at all.')],

  
  grabEnabled:       [lw('reduced', 'the Damage and Conditions panel still applies it, but toggling the condition from the token HUD will not run the automation.')],
  frightenedEnabled: [lw('reduced', 'the Damage and Conditions panel still applies it, but toggling the condition from the token HUD will not run the automation.')],
  tauntedEnabled:    [lw('reduced', 'the Damage and Conditions panel still applies it, but toggling the condition from the token HUD will not run the automation.')],

  

  squadTargetBonus:        [td('inert', 'the extra free strike damage is written into the Target Damage panel, which is not there.')],
  groupActionsEnabled:     [td('inert', 'group actions coordinate their damage through the Target Damage panel.')],
  playerCanUndoDstdDeaths: [td('inert', 'this governs the undo button on the Target Damage panel.')],
  dstdQuickFmButton:       [td('inert', 'the quick button is added to the Target Damage panel.')],

  dstdRollPills:        [td('inert', 'roll modifier pills are rendered inside the Target Damage panel.')],
  dstdRollEditor:       [td('inert', 'the roll modifier editor is opened from the Target Damage panel.')],
  pillDamageEditor:     [td('inert', 'damage modifier pills are rendered inside the Target Damage panel.')],
  skipPillEditor:       [td('inert', 'this changes how the damage pill editor opens, and that editor lives in the Target Damage panel.')],
  multiplierOverride:   [td('inert', 'this applies to damage pills, which are rendered inside the Target Damage panel.')],
  noMultiplierStacking: [td('inert', 'this applies to damage pills, which are rendered inside the Target Damage panel.')],

  flatEffectsEnabled: [td('reduced', 'flat effects still work and post their own buttons, but they do not get full per-target rows with apply, undo and edit.')],

  

  stealthSystemEnabled: [lw('reduced', 'the statuses and the hiding rules still work, but burrowing creatures keep sorting under the map and the fade that marks them as underground never appears.')],
  coverBaneEnabled:      [td('reduced', 'the bane still appears in the roll window, but there is no Target Damage panel for it to carry through to.')],

  quickStrikeCompat: [{ id: QUICKSTRIKE, level: 'inert', why: 'this only adjusts DSCT behaviour for the Quick Strike module.' }],
};

export function depStatus(id) {
  const mod = game.modules?.get(id);
  if (mod?.active) return 'active';
  
  if (id === LIBWRAPPER && globalThis.libWrapper) return 'active';
  if (mod) return 'installed';
  return 'missing';
}

export function depsFor(key) {
  const entries = SETTING_DEPS[key];
  if (!entries?.length) return [];
  return entries.map(({ id, level, why }) => {
    const state = depStatus(id);
    const label = DEP_LABELS[id] ?? id;
    const head  = state === 'active'
      ? `${label} is active.`
      : state === 'installed'
        ? `${label} is installed but not enabled in this world.`
        : `${label} is not installed.`;
    
    
    const tail = state === 'active'
      ? (level === 'inert' ? 'This setting needs it.' : 'It uses this module for part of what it does.')
      : (level === 'inert' ? `This setting does nothing until it is: ${why}` : `Partly unavailable: ${why}`);
    return {
      id, label, state, level,
      isActive:    state === 'active',
      isInstalled: state === 'installed',
      isMissing:   state === 'missing',
      isReduced:   level === 'reduced',
      tooltip: `${head} ${tail}`,
    };
  });
}

export function hasUnmetDeps() {
  return Object.values(SETTING_DEPS).flat().some(({ id }) => depStatus(id) !== 'active');
}

export async function postFirstRunNotice() {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, 'firstRunNoticeShown')) return;

  const state = depStatus(LIBWRAPPER);
  
  
  await game.settings.set(MODULE_ID, 'firstRunNoticeShown', true);
  if (state === 'active') return;

  const advice = state === 'installed'
    ? 'It is installed but not enabled in this world. Enable it under Manage Modules.'
    : 'It is not installed. You can find it in the module browser as "libWrapper".';

  await ChatMessage.create({
    whisper: [game.user.id],
    content: `
      <div class="dsct-firstrun">
        <p><strong>Draw Steel: Combat Tools</strong> works best with <strong>libWrapper</strong>, which is not currently active.</p>
        <p>${advice}</p>
        <p>Without it, forced movement buttons, squad turns, the squad health bar, the condition automations driven from the token HUD, and the line of sight options do nothing at all. Everything else keeps working.</p>
        <p>Settings that need another module are badged in the DSCT menus, so you can see at a glance which ones are affected and why.</p>
      </div>`,
  });
}
