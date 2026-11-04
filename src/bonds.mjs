import { safeUpdate } from './ctlib.mjs';
import { registerEffectFlag } from './effect-flag-picker.mjs';

const M = 'draw-steel-combat-tools';
const L = (k, data) => (data ? game.i18n.format(`DSCT.bond.${k}`, data) : game.i18n.localize(`DSCT.bond.${k}`));
const RECOVERY_MODELS = ['hero', 'retainer'];

const bondOf = (actor) => {
  const b = actor?.flags?.[M]?.bond;
  return b?.group ? b : null;
};

const recoveriesLeft = (actor) => Number(actor?.system?.recoveries?.value) || 0;

export function bondMates(actor) {
  const bond = bondOf(actor);
  if (!bond) return [];
  const pool = new Set(game.actors?.contents ?? []);
  for (const token of canvas?.scene?.tokens ?? []) if (!token.actorLink && token.actor) pool.add(token.actor);
  return [...pool].filter((a) => a !== actor && a.uuid !== actor.uuid && bondOf(a)?.group === bond.group);
}

const donorsFor = (actor) => {
  const own = recoveriesLeft(actor) > 0 ? [actor] : [];
  if (!bondOf(actor)?.shareRecoveries) return own;
  return [...own, ...bondMates(actor).filter((a) => recoveriesLeft(a) > 0)];
};

export const recoveriesAvailable = (actor) => donorsFor(actor).reduce((n, a) => n + recoveriesLeft(a), 0);

async function pickDonor(actor, donors) {
  if (donors.length === 1) return donors[0];
  const esc = foundry.utils.escapeHTML;
  return foundry.applications.api.DialogV2.wait({
    window: { title: L('pickTitle', { name: actor.name }), icon: 'fa-solid fa-link' },
    content: `<p>${esc(L('pickBody', { name: actor.name }))}</p>`,
    buttons: donors.map((d, i) => ({
      action: `d${i}`, label: L('pickOption', { name: d.name, n: recoveriesLeft(d) }), default: d === actor,
      callback: () => d,
    })),
    rejectClose: false,
  }).catch(() => null);
}

export async function takeRecovery(actor, updateOptions = {}) {
  const donors = donorsFor(actor);
  if (!donors.length) return null;
  const donor = await pickDonor(actor, donors);
  if (!donor) return null;
  await safeUpdate(donor, { 'system.recoveries.value': recoveriesLeft(donor) - 1 }, updateOptions);
  if (donor !== actor) ui.notifications.info(L('spentFrom', { name: actor.name, donor: donor.name }));
  return donor;
}

const refresh = foundry.utils.debounce((actors) => {
  for (const a of actors) {
    a.reset();
    if (a.sheet?.rendered) a.sheet.render();
  }
}, 50);

const touchesBond = (effect) => [...(effect?.system?.changes ?? []), ...(effect?.changes ?? [])]
  .some((c) => String(c?.key ?? '').startsWith(`flags.${M}.bond.`));

function refreshBond(actor) {
  const mates = bondMates(actor);
  if (mates.length) refresh(mates);
}

export function registerBonds() {
  const def = (name, type, value) => ({
    key: `flags.${M}.bond.${name}`, category: 'bond', type, value,
    label: `DSCT.effectFlags.bond.${name}.label`,
    description: `DSCT.effectFlags.bond.${name}.description`,
    values: `DSCT.effectFlags.bond.${name}.values`,
  });
  registerEffectFlag('actor', def('group', 'override', 'bloodbound-band'));
  registerEffectFlag('actor', def('shareRecoveryValue', 'override', 'true'));
  registerEffectFlag('actor', def('shareRecoveries', 'override', 'true'));

  if (!game.modules.get('lib-wrapper')?.active) return;
  for (const type of RECOVERY_MODELS) {
    if (!CONFIG.Actor.dataModels?.[type]?.prototype?.spendRecovery) continue;
    
    libWrapper.register(M, `CONFIG.Actor.dataModels.${type}.prototype.prepareDerivedData`, function (wrapped, ...args) {
      const result = wrapped(...args);
      const rec = this.recoveries;
      if (!rec) return result;
      rec.ownValue = rec.recoveryValue;
      if (bondOf(this.parent)?.shareRecoveryValue) {
        for (const mate of bondMates(this.parent)) {
          const theirs = mate.system?.recoveries?.ownValue ?? mate.system?.recoveries?.recoveryValue ?? 0;
          if (theirs > rec.recoveryValue) rec.recoveryValue = theirs;
        }
      }
      return result;
    }, 'WRAPPER');
    libWrapper.register(M, `CONFIG.Actor.dataModels.${type}.prototype.spendRecovery`, async function (wrapped, ...args) {
      const actor = this.parent;
      if (!bondOf(actor)?.shareRecoveries || donorsFor(actor).every((d) => d === actor)) return wrapped(...args);
      const donor = await takeRecovery(actor);
      if (!donor) return actor;
      return actor.modifyTokenAttribute('stamina', this.recoveries.recoveryValue, true);
    }, 'MIXED');
  }

  for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, (effect) => {
      const actor = effect?.parent;
      if (actor?.documentName !== 'Actor' || !touchesBond(effect)) return;
      
      refresh([actor, ...bondMates(actor), ...(game.actors?.contents ?? []).filter((a) => bondOf(a))]);
    });
  }
  Hooks.on('updateActor', (actor, changes) => {
    if (!bondOf(actor)) return;
    if (foundry.utils.hasProperty(changes, 'system.stamina') || foundry.utils.hasProperty(changes, 'system.recoveries')) refreshBond(actor);
  });
  Hooks.once('ready', () => refresh((game.actors?.contents ?? []).filter((a) => bondOf(a))));
}
