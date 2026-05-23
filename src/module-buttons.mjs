import { getSetting } from './helpers.mjs';
import { selectConnectedWalls } from './forced-movement/wall-builder.mjs';

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

const DSCT_GROUP_TOOLS = ['dsct-grab', 'dsct-forced-movement', 'dsct-teleport', 'dsct-dc', 'dsct-hide-defeated'];

export const registerModuleButtons = () => {
  Hooks.on('renderSceneControls', (app, html) => {
    if (game.release.generation <= 12) return;
    if (!getSetting('toolboxEnabled')) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const toolsPanel = root?.querySelector('#scene-controls-tools');
    if (!toolsPanel) return;

    const getDirectChild = (el) => {
      let node = el;
      while (node && node.parentElement !== toolsPanel) node = node.parentElement;
      return node ?? null;
    };

    const containers = DSCT_GROUP_TOOLS
      .map(n => getDirectChild(toolsPanel.querySelector(`[data-tool="${n}"]`)))
      .filter(Boolean);
    if (!containers.length) return;

    const expanded = window._dsctGroupExpanded ?? false;

    const wrapper = document.createElement('div');
    wrapper.className = 'dsct-sub-group' + (expanded ? '' : ' dsct-collapsed');

    const parentBtn = document.createElement('button');
    parentBtn.type = 'button';
    parentBtn.className = 'icon control ui-control button fas fa-tools' + (expanded ? ' active' : '');
    parentBtn.setAttribute('data-tool', 'dsct-group');
    parentBtn.setAttribute('data-tooltip', 'Combat Toolbox');
    parentBtn.setAttribute('role', 'button');
    parentBtn.setAttribute('aria-pressed', String(expanded));

    parentBtn.addEventListener('click', () => {
      window._dsctGroupExpanded = !window._dsctGroupExpanded;
      wrapper.classList.toggle('dsct-collapsed', !window._dsctGroupExpanded);
      parentBtn.classList.toggle('active', window._dsctGroupExpanded);
      parentBtn.setAttribute('aria-pressed', String(window._dsctGroupExpanded));
    });

    const firstContainer = containers[0];
    toolsPanel.insertBefore(parentBtn, firstContainer);
    toolsPanel.insertBefore(wrapper, firstContainer);
    for (const el of containers) wrapper.appendChild(el);
  });

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
        visible: S('conditionsEnabled') && S('grabEnabled') && S('showGrabButton'),
        onChange: () => game.modules.get('draw-steel-combat-tools')?.api?.grabPanel()
      },
      'dsct-forced-movement': {
        name: 'dsct-forced-movement',
        title: 'Forced Movement',
        icon: 'fas fa-arrows-alt',
        button: true,
        visible: S('forcedMovementEnabled') && S('showForcedMovementButton'),
        onChange: () => game.modules.get('draw-steel-combat-tools')?.api?.forcedMovementUI()
      },
      'dsct-teleport': {
        name: 'dsct-teleport',
        title: 'Teleport',
        icon: 'fa-solid fa-person-through-window',
        button: true,
        visible: S('teleportEnabled') && S('showTeleportButton'),
        onChange: () => game.modules.get('draw-steel-combat-tools')?.api?.teleportUI()
      },
      'dsct-dc': {
        name: 'dsct-dc',
        title: 'Damage & Conditions',
        icon: 'fas fa-fire',
        button: true,
        visible: S('conditionsEnabled') && S('showDamageConditionsButton'),
        onChange: () => game.modules.get('draw-steel-combat-tools')?.api?.damageConditionsUI()
      },
    });

    addTools(wallControl, {
      'dsct-wall': {
        name: 'dsct-wall',
        title: 'Wall Builder',
        icon: 'fas fa-dungeon',
        button: true,
        visible: game.user.isGM && S('showWallBuilderButton'),
        onChange: () => game.modules.get('draw-steel-combat-tools')?.api?.wallBuilder()
      },
      'dsct-select-connected': {
        name: 'dsct-select-connected',
        title: 'Select Connected Walls (Shift: add to selection)',
        icon: 'fas fa-project-diagram',
        button: true,
        visible: true,
        onChange: (event) => selectConnectedWalls(event?.shiftKey ?? false),
      },
    });
  });
};
