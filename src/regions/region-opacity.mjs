const M = 'draw-steel-combat-tools';

function _injectOpacityUI(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector('.dsct-region-opacity-group')) return;

  const doc = app.document;
  const current = doc.getFlag(M, 'regionOpacity') ?? 0.5;

  const group = document.createElement('div');
  group.className = 'form-group dsct-region-opacity-group';
  group.innerHTML = `
    <label>${game.i18n.localize('DSCT.label.regionOpacity')}</label>
    <div class="form-fields">
      <input type="range" min="0" max="1" step="0.05" value="${current}" style="flex:1;">
      <span class="dsct-opacity-display" style="min-width:3.5em;text-align:right;">${Math.round(current * 100)}%</span>
    </div>
  `;

  const input = group.querySelector('input');
  const display = group.querySelector('.dsct-opacity-display');

  input.addEventListener('input', () => {
    display.textContent = `${Math.round(parseFloat(input.value) * 100)}%`;
  });
  input.addEventListener('change', () => {
    doc.setFlag(M, 'regionOpacity', parseFloat(input.value));
  });

  const colorGroup = root.querySelector('[name="color"]')?.closest('.form-group');
  if (colorGroup) colorGroup.after(group);
  else (root.querySelector('form') ?? root).appendChild(group);
}

function _injectExcludeSourceUI(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector('.dsct-exclude-source-group')) return;

  const doc = app.document;
  
  const rawShapes = doc.toObject().shapes ?? [];
  const auraShape = rawShapes.find(s => s.type === 'emanation' && s.base != null);
  if (!auraShape) return;

  const group = document.createElement('div');
  group.className = 'form-group dsct-exclude-source-group';
  group.innerHTML = `
    <label>${game.i18n.localize('DSCT.label.excludeSourceSpace')}</label>
    <div class="form-fields">
      <input type="checkbox" ${auraShape.base.hole ? 'checked' : ''}>
    </div>
    <p class="hint">${game.i18n.localize('DSCT.label.excludeSourceSpaceHint')}</p>
  `;

  group.querySelector('input').addEventListener('change', async (e) => {
    const newShapes = doc.toObject().shapes.map(s => {
      if (s.type === 'emanation' && s.base != null) s.base.hole = e.target.checked;
      return s;
    });
    await doc.update({ shapes: newShapes });
  });

  const colorGroup = root.querySelector('[name="color"]')?.closest('.form-group');
  if (colorGroup) colorGroup.after(group);
  else (root.querySelector('form') ?? root).appendChild(group);
}

export function registerRegionOpacityHooks() {
  if (!globalThis.libWrapper) {
    console.warn('DSCT | region-opacity | libWrapper not found -- region opacity patch skipped');
    return;
  }

  libWrapper.register(
    M,
    'foundry.canvas.placeables.Region.prototype._refreshState',
    function(wrapped, ...args) {
      wrapped(...args);
      const opacity = this.document.getFlag(M, 'regionOpacity') ?? 0.5;
      const mesh = this.layer._highlights.children.find(m => m.region === this);
      if (mesh) mesh.alpha = opacity;
    },
    'WRAPPER'
  );

  Hooks.on('renderRegionConfig', _injectOpacityUI);
  Hooks.on('renderRegionConfig', _injectExcludeSourceUI);

}
