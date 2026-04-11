/**
 * Returns true if two wall segments touch or cross (shared endpoint OR intersection).
 * Uses the parametric cross-product method; collinear/parallel walls with a shared
 * endpoint are caught by the explicit endpoint equality fallback.
 */
const wallsTouch = (a, b) => {
  const [ax1, ay1, ax2, ay2] = a.c;
  const [bx1, by1, bx2, by2] = b.c;
  const rx = ax2 - ax1, ry = ay2 - ay1;
  const sx = bx2 - bx1, sy = by2 - by1;
  const rxs = rx * sy - ry * sx;
  if (Math.abs(rxs) < 1e-10) {
    // Parallel: only connected if they share an endpoint exactly
    return (ax1 === bx1 && ay1 === by1) || (ax1 === bx2 && ay1 === by2) ||
           (ax2 === bx1 && ay2 === by1) || (ax2 === bx2 && ay2 === by2);
  }
  const qpx = bx1 - ax1, qpy = by1 - ay1;
  const t = (qpx * sy - qpy * sx) / rxs;
  const u = (qpx * ry - qpy * rx) / rxs;
  const EPS = 1e-10;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
};

/**
 * Flood-fill selection of walls connected to the currently controlled walls.
 * Two walls are considered connected if they share an endpoint or their segments
 * geometrically intersect.  If addToSelection is true the result is merged with
 * the existing selection; otherwise the selection is replaced.
 */
const selectConnectedWalls = (addToSelection = false) => {
  const controlled = canvas.walls.controlled;
  if (!controlled.length) {
    ui.notifications.warn('Select at least one wall first.');
    return;
  }

  const allWalls = canvas.scene.walls.contents;

  // Precompute adjacency list (O(N²), fast for typical scene sizes)
  const adj = new Map();
  for (const w of allWalls) adj.set(w.id, new Set());
  for (let i = 0; i < allWalls.length; i++) {
    for (let j = i + 1; j < allWalls.length; j++) {
      if (wallsTouch(allWalls[i], allWalls[j])) {
        adj.get(allWalls[i].id).add(allWalls[j].id);
        adj.get(allWalls[j].id).add(allWalls[i].id);
      }
    }
  }

  // BFS from all currently selected walls
  const visited = new Set(controlled.map(w => w.id));
  const queue   = [...visited];
  while (queue.length) {
    const id = queue.shift();
    for (const neighborId of (adj.get(id) ?? [])) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      queue.push(neighborId);
    }
  }

  // Apply selection
  if (!addToSelection) canvas.walls.releaseAll();
  for (const placeable of canvas.walls.placeables) {
    if (visited.has(placeable.id) && !placeable.controlled)
      placeable.control({ releaseOthers: false });
  }

  ui.notifications.info(`Selected ${visited.size} connected wall${visited.size !== 1 ? 's' : ''}.`);
};

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
      'dsct-wall': { name: 'dsct-wall', title: 'Wall Builder', icon: 'fas fa-dungeon', button: true, visible: game.user.isGM && S('showWallBuilderButton'), onClick: () => game.modules.get('draw-steel-combat-tools')?.api?.wallBuilder() },
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
