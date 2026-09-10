import { getSetting, sightOriginPoints } from './helpers.mjs';

function _unionLargest(paths) {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const solution = [];
  const fill = ClipperLib.PolyFillType.pftPositive;
  clipper.Execute(ClipperLib.ClipType.ctUnion, solution, fill, fill);
  if (!solution.length) return null;

  
  
  
  let best = null, bestArea = -1;
  for (const path of solution) {
    const area = Math.abs(ClipperLib.Clipper.Area(path));
    if (area > bestArea) { bestArea = area; best = path; }
  }
  return best;
}

function _makeCornerSweep(Base) {
  return class DsctCornerSweepPolygon extends Base {
    
    _compute() {
      super._compute();

      
      if (this._dsctCornerSub) return;
      if (!getSetting('trueDrawSteelLos')) return;
      if (this.config?.type !== 'sight') return;
      if (typeof ClipperLib === 'undefined') return;

      const token = this.config.source?.object;
      if (!token?.document || !canvas?.grid) return;
      if (this.points.length < 6) return;

      try {
        const paths = [this.toClipperPoints()];
        for (const origin of sightOriginPoints(token).slice(1)) {
          const poly = new this.constructor();
          poly._dsctCornerSub = true;
          poly.initialize(
            { x: origin.x, y: origin.y, elevation: this.origin.elevation },
            { ...this.config, boundaryShapes: [...(this.config.boundaryShapes ?? [])] },
          );
          poly.compute();
          if (poly.points.length >= 6) paths.push(poly.toClipperPoints());
        }
        if (paths.length < 2) return;

        const merged = _unionLargest(paths);
        
        if (merged?.length) this.points = PIXI.Polygon.fromClipperPoints(merged).points;
      } catch (err) {
        console.warn('DSCT | corner vision sweep failed, falling back to the plain sweep:', err);
      }
    }
  };
}

export function registerCornerVision() {
  Hooks.once('canvasInit', () => {
    const backends = CONFIG?.Canvas?.polygonBackends;
    const Base = backends?.sight;
    if (!Base) {
      console.warn('DSCT | corner vision | no sight polygon backend found, skipped');
      return;
    }
    backends.sight = _makeCornerSweep(Base);
    if (getSetting('debugMode')) console.log(`DSCT | corner vision | sight backend wrapped (${Base.name})`);
  });
}
