const _pickCanvasToken = (candidates, color, hint) => new Promise(resolve => {
  const GS     = canvas.grid.size;
  const hlName = 'dsct-transform-hl';
  canvas.interface.grid.highlightLayers[hlName]?.destroy();
  canvas.interface.grid.addHighlightLayer(hlName);
  for (const t of candidates) {
    const w  = Math.max(1, Math.round(t.document.width));
    const h  = Math.max(1, Math.round(t.document.height));
    const gx = Math.round(t.document.x / GS);
    const gy = Math.round(t.document.y / GS);
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++)
      canvas.interface.grid.highlightPosition(hlName, { x: (gx + dx) * GS, y: (gy + dy) * GS, color, border: 0xffffff });
  }
  const notif   = ui.notifications.info(hint, { permanent: true });
  const cleanup = () => {
    ui.notifications.remove(notif);
    canvas.interface.grid.destroyHighlightLayer(hlName);
    canvas.stage.off('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('contextmenu', onCancel);
  };
  const onClick = (ev) => {
    if (ev.data.originalEvent.button !== 0) return;
    const pos = ev.data.getLocalPosition(canvas.app.stage);
    const hit = candidates.find(t => {
      const tw = t.document.width * GS;
      const th = t.document.height * GS;
      return pos.x >= t.x && pos.x < t.x + tw && pos.y >= t.y && pos.y < t.y + th;
    });
    if (!hit) return;
    cleanup();
    resolve(hit);
  };
  const onKey    = (ev) => { if (ev.key === 'Escape') { cleanup(); resolve(null); } };
  const onCancel = (ev) => { ev.preventDefault(); cleanup(); resolve(null); };
  canvas.stage.on('mousedown', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('contextmenu', onCancel);
});

class TransformPicker extends ds.applications.api.DSApplication {
  constructor(actors, title, resolve) {
    super();
    this._actors      = actors;
    this._windowTitle = title;
    this._resolve     = resolve;
  }

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/transformation.hbs' },
  };

  static DEFAULT_OPTIONS = {
    id: 'dsct-transform-picker',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.Transform', minimizable: false, resizable: false },
    position: { width: 296, height: 'auto' },
    actions: {
      'pick-actor': TransformPicker._onPickActor,
    },
  };

  get title() {
    return this._windowTitle ?? game.i18n.localize('DSCT.panel.title.Transform');
  }

  async _prepareContext(_options) {
    return {
      actors: this._actors.map(a => ({
        id:   a.id,
        name: a.name,
        img:  a.prototypeToken?.texture?.src ?? a.img,
      })),
    };
  }

  _onRender(_context, _options) {
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);
  }

  static async _onPickActor(_event, target) {
    const actor   = game.actors.get(target.dataset.actorId);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(actor ?? null);
    await this.close();
  }

  async close(options = {}) {
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(null);
    return super.close(options);
  }
}

export const openTransformPicker = (actors, title) =>
  new Promise(resolve => new TransformPicker(actors, title, resolve).render({ force: true }));

export const runTransform = async (target, actors, title = 'Transform', { color = 0x00aaff, hint } = {}) => {
  let token;

  if (target instanceof foundry.canvas.placeables.Token || (target && typeof target === 'object' && target.document)) {
    token = target;
  } else if (typeof target === 'string') {
    token = canvas.tokens.placeables.find(t => t.id === target);
    if (!token) { ui.notifications.warn('Transform: token not found.'); return; }
  } else {
    const filterFn   = typeof target === 'function' ? target : null;
    const candidates = canvas.tokens.placeables.filter(t => !t.document.hidden && (!filterFn || filterFn(t)));
    if (!candidates.length) { ui.notifications.warn('Transform: no valid tokens on canvas.'); return; }
    token = await _pickCanvasToken(candidates, color, hint ?? 'Click a token to transform. Right-click to cancel.');
    if (!token) return;
  }

  let actorList;
  if (Array.isArray(actors)) {
    actorList = actors.filter(Boolean);
  } else if (typeof actors === 'function') {
    const result = await actors(token);
    actorList = (Array.isArray(result) ? result : []).filter(Boolean);
  } else {
    actorList = [];
  }

  if (!actorList.length) { ui.notifications.warn('Transform: no actors to transform into.'); return; }

  const resolvedTitle = game.i18n.localize(title);
  const newActor = await openTransformPicker(actorList, resolvedTitle);
  if (!newActor) return;

  const protoImg = newActor.prototypeToken?.texture?.src ?? newActor.img;
  await token.document.update({
    actorId:       newActor.id,
    name:          newActor.name,
    'texture.src': protoImg,
    actorLink:     newActor.prototypeToken?.actorLink ?? false,
  });
  const combatant = game.combat?.combatants.find(c => c.tokenId === token.id);
  if (combatant) await combatant.update({ actorId: newActor.id, name: newActor.name, img: protoImg });
  return token;
};
