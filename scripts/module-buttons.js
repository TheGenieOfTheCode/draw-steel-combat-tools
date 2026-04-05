export const registerModuleButtons = () => {
  Hooks.on('getSceneControlButtons', (controls) => {
    const tokenControl = controls.tokens || controls.token;
    if (!tokenControl) return;

    const getApi = () => game.modules.get('draw-steel-combat-tools')?.api;
    const S = (key) => game.settings.get('draw-steel-combat-tools', key);

    const myTools = {
      'dsct-grab': {
        name: 'dsct-grab',
        title: 'Grab Panel',
        icon: 'fas fa-hand-rock',
        button: true,
        visible: S('grabEnabled') && S('showGrabButton'),
        onClick: () => getApi()?.grabPanel()
      },
      'dsct-forced-movement': {
        name: 'dsct-forced-movement',
        title: 'Forced Movement',
        icon: 'fas fa-arrows-alt',
        button: true,
        visible: S('forcedMovementEnabled') && S('showForcedMovementButton'),
        onClick: () => getApi()?.forcedMovementUI()
      },
      'dsct-teleport': {
        name: 'dsct-teleport',
        title: 'Teleport',
        icon: 'fa-solid fa-person-through-window',
        button: true,
        visible: S('teleportEnabled') && S('showTeleportButton'),
        onClick: () => getApi()?.teleportUI()
      },
      'dsct-wall': {
        name: 'dsct-wall',
        title: 'Wall Builder',
        icon: 'fas fa-dungeon',
        button: true,
        visible: game.user.isGM && S('showWallBuilderButton'),
        onClick: () => getApi()?.wallBuilder()
      },
      'dsct-pwk': {
        name: 'dsct-pwk',
        title: 'Power Word: Kill',
        icon: 'fas fa-skull',
        button: true,
        visible: game.user.isGM && S('showPowerWordKillButton'),
        onClick: () => getApi()?.powerWordKill()
      }
    };

    if (Array.isArray(tokenControl.tools)) {
      tokenControl.tools.push(...Object.values(myTools));
    } else {
      let orderIndex = Object.keys(tokenControl.tools).length;
      for (const [key, tool] of Object.entries(myTools)) {
        tool.order = orderIndex++;
        tokenControl.tools[key] = tool;
      }
    }
  });
};
