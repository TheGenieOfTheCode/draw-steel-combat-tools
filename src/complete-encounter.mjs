import { getSetting } from './helpers.mjs';

export const registerCompleteEncounterHooks = () => {
  Hooks.on('renderApplicationV2', (app, element) => {
    const el = element instanceof HTMLElement ? element : app.element;
    if (!el?.classList?.contains('complete-encounter')) return;
    const mode = getSetting('completeEncounterMode');
    if (mode === 'accept') {
      const ok = el.querySelector('button[data-action="ok"]') ?? el.querySelector('form button[type="submit"]');
      setTimeout(() => ok?.click(), 50);
    } else if (mode === 'skip') {
      setTimeout(() => app.close(), 50);
    }
  });
};
