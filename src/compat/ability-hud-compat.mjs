import { getSetting } from '../helpers.mjs';

const M = 'draw-steel-combat-tools';
const HUD_ID = 'draw-steel-ability-hud';

const _hudActor = () => {
  const token = canvas.tokens?.controlled?.[0];
  const tokenActor = token?.actor ?? null;
  if (!game.user.isGM) {
    try {
      if (game.settings.get(HUD_ID, 'alwaysVisiblePlayers')) {
        if (tokenActor && token.isOwner) return tokenActor;
        return game.user.character ?? null;
      }
    } catch (_) {  }
  }
  return tokenActor;
};

const OURS = new Set(['dsct-hide', 'dsct-search']);

const _sectionsOf = (root, buttonId) =>
  [...(root.querySelector(`.dsahud-button[data-button-id="${buttonId}"] .dsahud-popup`)?.querySelectorAll('.dsahud-section') ?? [])];

const _titled = (sections, key) => {
  const label = game.i18n.localize(key);
  return sections.find(s => s.querySelector('.dsahud-section-title')?.textContent?.trim() === label) ?? null;
};

const _isOurs = (button) => {
  const uuid = button.dataset.tooltipUuid;
  if (!uuid) return false;
  try { return OURS.has(fromUuidSync(uuid)?.system?._dsid); }
  catch { return false; }
};

function _regroupManeuvers(root) {
  const sections = _sectionsOf(root, 'maneuver');
  if (!sections.length) return;

  const special = _titled(sections, 'DSAHUD.Sections.SpecialManeuver');
  if (!special) return;

  const moving = [...special.querySelectorAll('.dsahud-action')].filter(_isOurs);
  if (!moving.length) return;

  let basic = _titled(sections, 'DSAHUD.Sections.BasicManeuver');
  if (!basic) {
    basic = document.createElement('div');
    basic.className = 'dsahud-section';
    basic.innerHTML = `<div class="dsahud-section-title">${game.i18n.localize('DSAHUD.Sections.BasicManeuver')}</div><div class="dsahud-section-items"></div>`;

    const homebrew = _titled(sections, 'DSAHUD.Sections.HomebrewManeuver');
    const free     = _titled(sections, 'DSAHUD.Sections.FreeManeuver');
    if (homebrew) homebrew.before(basic);
    else (free ?? special).after(basic);
  }

  const items = basic.querySelector('.dsahud-section-items');
  if (!items) return;
  for (const button of moving) items.prepend(button);

  if (!special.querySelector('.dsahud-action')) special.remove();
}

export const registerAbilityHudCompat = () => {
  Hooks.once('ready', () => {
    if (!game.modules.get(HUD_ID)?.active) return;

    Hooks.on('renderAbilityHud', (_app, html) => {
      const root = html instanceof HTMLElement ? html : html?.[0];
      if (!root) return;
      try { _regroupManeuvers(root); }
      catch (err) { console.warn('DSCT | abilityHud compat | could not regroup the maneuvers:', err); }
    });

    
    
    
    Hooks.on('canvasReady', () => Hooks.callAll('dsahud.refresh', {}));
    setTimeout(() => Hooks.callAll('dsahud.refresh', {}), 2000);

    Hooks.on('renderAbilityHud', (_app, html) => {
      const dbg = getSetting('debugMode');
      if (!game.combat?.started) { if (dbg) console.log('DSCT | abilityHud compat | skip: no started combat'); return; }
      const actor = _hudActor();
      if (!actor) { if (dbg) console.log('DSCT | abilityHud compat | skip: no HUD actor'); return; }
      const root = html instanceof HTMLElement ? html : html?.[0];
      const btn = root?.querySelector('.dsahud-button[data-button-id="triggered-action"]');
      if (!btn) { if (dbg) console.log(`DSCT | abilityHud compat | skip: no triggered-action button for ${actor.name}`); return; }
      const effects = actor.effects.filter(e => e.getFlag(M, 'effectType') === 'triggered-action');
      if (!effects.length) { if (dbg) console.log(`DSCT | abilityHud compat | no tracker effect on ${actor.name}, native behavior`); return; }
      
      
      const spent = effects.every(e => e.disabled);
      if (effects.length > 1 && dbg) console.warn(`DSCT | abilityHud compat | ${actor.name} has ${effects.length} triggered-action effects`);
      btn.classList.add('dsct-ta-tracked');
      btn.classList.toggle('dsahud-tracking-spent', spent);
      btn.classList.toggle('dsahud-tracking-available', !spent);
      if (dbg) console.log(`DSCT | abilityHud compat | triggered button ${spent ? 'spent' : 'available'} for ${actor.name} (${effects.length} effect(s))`);
    });
  });
};
