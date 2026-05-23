const M = 'draw-steel-combat-tools';

let _hoveredTokenId = null;
let _controlledTokenIds = new Set();

function _refreshAllRegionVisibility() {
  canvas.regions?.placeables.forEach(r => r.renderFlags?.set({ refreshVisibility: true }));
}

function _injectVisibilityUI(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector('.dsct-attached-vis-header')) return;

  const doc = app.document;
  const hasAttachment = !!doc.attachment?.token;
  const extra = doc.getFlag(M, 'visibilityExtra') ?? {};

  const visibilityGroup = root.querySelector('[name="visibility"]')?.closest('.form-group');
  if (!visibilityGroup) return;

  const section = document.createElement('div');
  section.className = `dsct-attached-vis-section${hasAttachment ? '' : ' dsct-no-attachment'}`;

  const header = document.createElement('div');
  header.className = 'dsct-attached-vis-header';
  header.textContent = game.i18n.localize('DSCT.label.attachedVisibility');
  section.appendChild(header);

  const options = [
    { key: 'combatTurn',      label: 'DSCT.label.visExtraCombatTurn' },
    { key: 'controlledToken', label: 'DSCT.label.visExtraControlled' },
    { key: 'hoverToken',      label: 'DSCT.label.visExtraHover' },
  ];

  for (const { key, label } of options) {
    const group = document.createElement('div');
    group.className = 'form-group';

    const lbl = document.createElement('label');
    lbl.textContent = game.i18n.localize(label);

    const fields = document.createElement('div');
    fields.className = 'form-fields';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!extra[key];
    input.disabled = !hasAttachment;
    fields.appendChild(input);

    group.appendChild(lbl);
    group.appendChild(fields);
    section.appendChild(group);

    input.addEventListener('change', () => {
      const curr = doc.getFlag(M, 'visibilityExtra') ?? {};
      doc.setFlag(M, 'visibilityExtra', { ...curr, [key]: input.checked });
    });
  }

  visibilityGroup.after(section);
}

export function registerRegionVisibilityHooks() {
  if (!globalThis.libWrapper) {
    console.warn('DSCT | region-visibility | libWrapper not found -- dynamic region visibility skipped');
    return;
  }

  libWrapper.register(
    M,
    'foundry.canvas.placeables.Region.prototype._refreshVisibility',
    function(wrapped, ...args) {
      wrapped(...args);

      const mesh = this.layer._highlights.children.find(m => m.region === this);
      if (!mesh || mesh.visible) return;
      if (!game.user.isGM && this.document.hidden) return;

      const extra = this.document.getFlag(M, 'visibilityExtra') ?? {};
      if (!extra.combatTurn && !extra.controlledToken && !extra.hoverToken) return;

      const tokenId = this.document.attachment?.token?.id ?? null;
      if (!tokenId) return;

      if (extra.combatTurn      && (game.combat?.combatant?.tokenId ?? null) === tokenId) { mesh.visible = true; return; }
      if (extra.controlledToken && _controlledTokenIds.has(tokenId))                      { mesh.visible = true; return; }
      if (extra.hoverToken      && _hoveredTokenId === tokenId)                           { mesh.visible = true; return; }
    },
    'WRAPPER'
  );

  Hooks.on('updateRegion', (doc, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${M}.visibilityExtra`)) return;
    doc.object?.renderFlags?.set({ refreshVisibility: true });
  });

  Hooks.on('hoverToken', (token, hovered) => {
    _hoveredTokenId = hovered ? token.id : null;
    _refreshAllRegionVisibility();
  });

  Hooks.on('controlToken', (token, controlled) => {
    if (controlled) _controlledTokenIds.add(token.id);
    else _controlledTokenIds.delete(token.id);
    _refreshAllRegionVisibility();
  });

  
  
  
  Hooks.on('updateCombat', (_combat, changes) => {
    if ('turn' in changes) _refreshAllRegionVisibility();
  });

  Hooks.on('deleteCombat', _refreshAllRegionVisibility);

  
  Hooks.on('canvasReady', () => {
    _hoveredTokenId = null;
    _controlledTokenIds.clear();
  });

  Hooks.on('renderRegionConfig', _injectVisibilityUI);
}
