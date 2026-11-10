const M = 'draw-steel-combat-tools';

export const RESTART = Symbol('restart');

const _steps = [];
let _installed = false;

export function beforeAbilityUse(order, step) {
  _steps.push({ order, step });
  _steps.sort((a, b) => a.order - b.order);
  if (_installed || !game.modules.get('lib-wrapper')?.active) return;
  _installed = true;
  libWrapper.register(M, 'ds.data.Item.AbilityModel.prototype.use', async function (wrapped, ...args) {
    for (const { step } of _steps) {
      if (await step(this) === RESTART) return this.parent.system.use(...args);
    }
    return wrapped(...args);
  }, 'MIXED');
}
