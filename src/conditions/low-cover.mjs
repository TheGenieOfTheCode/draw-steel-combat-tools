import { getSetting, wallGrantsCover, tokenCoverMode } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';

const L = (k) => game.i18n.localize(`DSCT.lowCover.${k}`);

const MODES = ['none', 'low', 'full'];

function _injectWallField(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector('.dsct-low-cover')) return;
  if (!getSetting('lowCoverEnabled')) return;

  const wall = app.document;
  if (!wall) return;

  
  
  
  const loe = root.querySelector(`[name="flags.draw-steel.blocksLineOfEffect"]`);
  const anchor = loe?.closest('.form-group')
    ?? root.querySelector('[name="sight"]')?.closest('.form-group');
  if (!anchor) return;

  const on = wallGrantsCover(wall);

  const group = document.createElement('div');
  group.className = 'form-group dsct-low-cover';
  group.innerHTML = `
    <label>${L('wall.label')}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.${M}.lowCover"${on ? ' checked' : ''}>
    </div>
    <p class="hint">${L('wall.hint')}</p>`;

  anchor.after(group);

  
  
  const box = group.querySelector('input');
  box?.addEventListener('change', () => {
    if (box.checked && loe) loe.checked = false;
  });
  loe?.addEventListener('change', () => {
    if (loe.checked && box) box.checked = false;
  });
}

const LOW_COVER_TOOL = 'dsctLowCover';

const _safeCreateData = (tool) => {
  try { return tool?.createData ?? null; }
  catch { return null; }
};

function _registerWallTool(controls) {
  if (!getSetting('lowCoverEnabled')) return;
  const walls = controls.walls;
  if (!walls?.tools || walls.tools[LOW_COVER_TOOL]) return;

  const solid = walls.tools.solid ?? walls.tools.terrain;
  if (!solid) return;

  
  
  for (const [name, tool] of Object.entries(walls.tools)) {
    if (name === LOW_COVER_TOOL) continue;
    const data = _safeCreateData(tool);
    if (!data) continue;
    foundry.utils.setProperty(data, `flags.${M}.lowCover`, false);
  }

  const s = CONST.EDGE_SENSE_TYPES ?? CONST.WALL_SENSE_TYPES;
  walls.tools[LOW_COVER_TOOL] = {
    name: LOW_COVER_TOOL,
    order: (solid.order ?? 3) + 0.5,
    title: 'DSCT.lowCover.tool.title',
    icon: 'fa-solid fa-fence',
    button: true,

    get createData() {
      return foundry.utils.mergeObject(foundry.utils.deepClone(_safeCreateData(solid) ?? {}), {
        light: s.NONE, sight: s.NONE, sound: s.NONE, move: s.NONE,
        flags: {
          [M]: { lowCover: true },
          'draw-steel': { blocksLineOfEffect: false },
        },
      }, { inplace: false });
    },
    onChange: foundry.applications.sheets.palette.WallPalette?.onClickPreset
      ?? solid.onChange,
  };
}

function _injectActorField(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector('.dsct-cover-mode')) return;
  if (!getSetting('lowCoverEnabled')) return;
  if (app.isPlayMode) return;

  const actor = app.document;
  if (!actor?.isOwner) return;

  const host = root.querySelector('section[data-tab="stats"] fieldset')
    ?? root.querySelector('section[data-tab="details"] fieldset')
    ?? root.querySelector('fieldset');
  if (!host) return;

  const current = tokenCoverMode(actor);
  const options = MODES
    .map(m => `<option value="${m}"${m === current ? ' selected' : ''}>${L(`mode.${m}`)}</option>`)
    .join('');

  const group = document.createElement('div');
  group.className = 'form-group dsct-cover-mode';
  group.innerHTML = `
    <label>${L('actor.label')}</label>
    <div class="form-fields"><select class="dsct-cover-select">${options}</select></div>
    <p class="hint">${L(actor.system?.isObject ? 'actor.hintObject' : 'actor.hint')}</p>`;

  host.appendChild(group);

  group.querySelector('.dsct-cover-select')?.addEventListener('change', (event) => {
    actor.setFlag(M, 'cover', event.currentTarget.value)
      .catch(err => console.warn('DSCT | low cover |', err));
  });
}

export function registerLowCover() {
  Hooks.on('getSceneControlButtons', _registerWallTool);
  Hooks.on('renderWallConfig', _injectWallField);
  for (const hook of ['renderDrawSteelActorSheet', 'renderDrawSteelObjectSheet']) {
    Hooks.on(hook, _injectActorField);
  }
}
