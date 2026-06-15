import { getSetting } from '../../helpers.mjs';

function _hasNullFeature(actor) {
  return !!actor?.items.some(i => i.name.toLowerCase().includes('psionic martial arts'));
}

export function isNullGrabIntuitionActive(actor) {
  if (!getSetting('conditionsEnabled')) return false;
  if (!getSetting('nullGrabIntuition')) return false;
  return _hasNullFeature(actor);
}

export function nullIntuitionScore(actor) {
  return actor?.system?.characteristics?.intuition?.value ?? 0;
}

export function isNullSpeedExemptActive(actor) {
  if (!isNullGrabIntuitionActive(actor)) return false;
  if (!getSetting('homebrewOptions')) return false;
  if (!getSetting('psionicMartialArts')) return false;
  return true;
}
