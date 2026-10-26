import { registerEffectFlag } from '../effect-flag-picker.mjs';

const M = 'draw-steel-combat-tools';
const KEY = 'reactiveTests';

const reactiveSource = (uuid) => !!(uuid && fromUuidSync(uuid, { strict: false })?.system?.power?.roll?.reactive);

export function registerReactiveTests() {
  for (const name of ['edges', 'banes']) {
    registerEffectFlag('actor', {
      key: `flags.${M}.${KEY}.${name}`, category: 'rolls', type: 'add', value: '1',
      label: `DSCT.effectFlags.reactiveTests.${name}.label`,
      description: `DSCT.effectFlags.reactiveTests.${name}.description`,
      values: `DSCT.effectFlags.reactiveTests.${name}.values`,
    });
  }
  libWrapper.register(M, 'ds.data.Actor.CreatureModel.prototype.rollCharacteristic', function (wrapped, characteristic, config = {}, ...rest) {
    
    config = { ...config };
    for (const k of ['edges', 'banes']) if (typeof config[k] === 'string') config[k] = Number(config[k]) || 0;
    const mods = this.parent?.flags?.[M]?.[KEY];
    const edges = Number(mods?.edges) || 0;
    const banes = Number(mods?.banes) || 0;
    if ((!edges && !banes) || !reactiveSource(config.resultSource)) return wrapped(characteristic, config, ...rest);
    ui.notifications.info(game.i18n.format('DSCT.reactiveTests.notice', { name: this.parent.name, edges, banes }));
    return wrapped(characteristic, { ...config, edges: (config.edges ?? 0) + edges, banes: (config.banes ?? 0) + banes }, ...rest);
  }, 'WRAPPER');
}
