import { selectConnectedWalls } from './wall-builder.mjs';

const addTools = (control, tools) => {
  if (!control) return;
  if (Array.isArray(control.tools)) {
    control.tools.push(...Object.values(tools));
  } else {
    let orderIndex = Object.keys(control.tools).length;
    for (const [key, tool] of Object.entries(tools)) {
      tool.order = orderIndex++;
      control.tools[key] = tool;
    }
  }
};

export const registerModuleButtons = () => {
  Hooks.on('getSceneControlButtons', (controls) => {
    const tokenControl = controls.tokens || controls.token;
    const wallControl  = controls.walls  || controls.wall;
    const S = (key) => game.settings.get('draw-steel-combat-tools', key);

    addTools(tokenControl, {
      'dsct-grab': {
        name: 'dsct-grab',
        title: 'Grab Panel',
        icon: 'fas fa-hand-rock',
        button: true,
        visible: S('grabEnabled') && S('showGrabButton'),
        onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.grabPanel()
      },
      'dsct-forced-movement': {
        name: 'dsct-forced-movement',
        title: 'Forced Movement',
        icon: 'fas fa-arrows-alt',
        button: true,
        visible: S('forcedMovementEnabled') && S('showForcedMovementButton'),
        onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.forcedMovementUI()
      },
      'dsct-teleport': {
        name: 'dsct-teleport',
        title: 'Teleport',
        icon: 'fa-solid fa-person-through-window',
        button: true,
        visible: S('teleportEnabled') && S('showTeleportButton'),
        onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.teleportUI()
      },
      'dsct-pwk': {
        name: 'dsct-pwk',
        title: 'Power Word: Kill',
        icon: 'fas fa-skull',
        button: true,
        visible: game.user.isGM && S('showPowerWordKillButton') && S('deathTrackerEnabled'),
        onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.powerWordKill()
      },
      'dsct-dc': {
        name: 'dsct-dc',
        title: 'Damage & Conditions',
        icon: 'fas fa-bolt',
        button: true,
        visible: S('showDamageConditionsButton'),
        onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.damageConditionsUI()
      },
    });

    addTools(wallControl, {
      'dsct-wall': {
        name: 'dsct-wall',
        title: 'Wall Builder',
        icon: 'fas fa-dungeon',
        button: true,
        visible: game.user.isGM && S('showWallBuilderButton'),
        onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.wallBuilder()
      },
      'dsct-select-connected': {
        name: 'dsct-select-connected',
        title: 'Select Connected Walls (Shift: add to selection)',
        icon: 'fas fa-project-diagram',
        button: true,
        visible: true,
        onClick: (event) => selectConnectedWalls(event?.shiftKey ?? false),
      },
    });
  });
};
