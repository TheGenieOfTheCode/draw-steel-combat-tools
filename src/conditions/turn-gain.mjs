import { registerEffectFlag } from '../effect-flag-picker.mjs';

const M = 'draw-steel-combat-tools';
const KEY = 'turnGainBonus';
const _pending = new Map();

export function registerTurnGain() {
  registerEffectFlag('actor', {
    key: `flags.${M}.${KEY}`, category: 'rolls', type: 'add', value: '1',
    label: 'DSCT.effectFlags.turnGainBonus.label',
    description: 'DSCT.effectFlags.turnGainBonus.description',
    values: 'DSCT.effectFlags.turnGainBonus.values',
  });
  libWrapper.register(M, 'ds.data.Actor.HeroModel.prototype.updateResource', function (wrapped, delta, ...rest) {
    const bonus = _pending.get(this.parent?.uuid);
    if (!bonus) return wrapped(delta, ...rest);
    _pending.delete(this.parent.uuid);
    return wrapped(delta + bonus, ...rest);
  }, 'WRAPPER');
  libWrapper.register(M, 'ds.data.Actor.HeroModel.prototype._onStartTurn', async function (wrapped, ...args) {
    const actor = this.parent;
    const bonus = Number(actor?.flags?.[M]?.[KEY]) || 0;
    if (bonus) _pending.set(actor.uuid, bonus);
    try { await wrapped(...args); }
    finally {
      if (bonus && _pending.delete(actor.uuid)) await actor.modifyTokenAttribute('hero.primary.value', bonus, true, false);
    }
    if (bonus) ui.notifications.info(game.i18n.format('DSCT.turnGain.notice', { name: actor.name, n: bonus, resource: actor.system.coreResource?.name ?? '' }));
  }, 'WRAPPER');
}
