const DURATION = 900;
const RISE = 34;

let _layer = null;

function _ensureLayer() {
  if (_layer && !_layer.destroyed && _layer.parent) return _layer;
  _layer = new PIXI.Container();
  _layer.eventMode = 'none';
  canvas.controls.addChild(_layer);
  return _layer;
}

export function playDetected(spotterId, hiderId) {
  const spotter = canvas.tokens.get(spotterId);
  const hider = canvas.tokens.get(hiderId);
  if (!spotter || !hider) return;

  const layer = _ensureLayer();
  const group = new PIXI.Container();
  layer.addChild(group);

  const line = new PIXI.Graphics();
  group.addChild(line);

  const mark = new PIXI.Text('!', {
    fontFamily: 'Signika, sans-serif',
    fontSize: 44,
    fontWeight: 'bold',
    fill: 0xd04040,
    stroke: 0x000000,
    strokeThickness: 6,
  });
  mark.anchor.set(0.5, 1);
  group.addChild(mark);

  const startY = spotter.y - 4;
  let elapsed = 0;

  const step = () => {
    
    if (!group || group.destroyed || !_layer || _layer.destroyed) return _stop();

    elapsed += canvas.app.ticker.deltaMS;
    const t = Math.min(1, elapsed / DURATION);

    
    const fade = t < 0.33 ? 1 : 1 - ((t - 0.33) / 0.67);

    if (spotter.destroyed || hider.destroyed) return _stop();

    mark.position.set(spotter.center.x, startY - RISE * t);
    mark.alpha = fade;

    line.clear();
    line.lineStyle(4, 0xd04040, 0.5 * fade);
    line.moveTo(spotter.center.x, spotter.center.y);
    line.lineTo(hider.center.x, hider.center.y);

    if (t >= 1) _stop();
  };

  const _stop = () => {
    canvas.app.ticker.remove(step);
    if (group && !group.destroyed) group.destroy({ children: true });
  };

  canvas.app.ticker.add(step);
}
