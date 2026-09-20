import { getSetting } from '../helpers.mjs';
import { L, partyContributors, tallyHolders, markFor } from './overview.mjs';

let _leveling = null;

const _advKind = (keys) =>
  keys.some(k => k in (ds.CONFIG.skills?.list ?? {})) ? 'skills'
  : keys.some(k => k in (ds.CONFIG.languages ?? {})) ? 'languages'
  : null;

function _annotateTraitPicks(root) {
  const box = root?.querySelector('multi-checkbox[name="choices"]');
  if (!box || box.dataset.dsctHinted) return;

  const labels = [...box.querySelectorAll('label.checkbox')];
  const kind = _advKind(labels.map(l => l.querySelector('input')?.value).filter(Boolean));
  if (!kind) return;

  const party = game.actors?.party ?? null;
  
  
  const contributors = partyContributors(party).filter(c => c.isFollower || c.id !== _leveling?.id);
  const tally = tallyHolders(contributors, kind === 'skills' ? 'system.skills.value' : 'system.languages.value');

  box.dataset.dsctHinted = '1';

  const blocked = new Set();
  const lockIgnored = !game.user.isGM && !getSetting('partyPlayersCanPickIgnored');

  for (const label of labels) {
    const key = label.querySelector('input')?.value;
    if (!key) continue;

    const mark = party ? markFor(party, kind, key) : null;
    if (lockIgnored && mark === 'ignored') blocked.add(key);
    if (mark === 'preferred') label.classList.add('dsct-adv-preferred');
    if (mark === 'ignored') label.classList.add('dsct-adv-ignored');

    const holders = tally.get(key) ?? [];
    if (!holders.length && !mark) continue;

    const badge = document.createElement('span');
    badge.className = 'dsct-adv-badge';
    if (mark) {
      const icon = document.createElement('i');
      icon.className = `fa-solid ${mark === 'preferred' ? 'fa-star' : 'fa-ban'}`;
      icon.dataset.tooltip = L(mark === 'preferred' ? 'DSCT.party.preferredTip' : 'DSCT.party.ignoredTip');
      badge.append(icon);
    }
    if (holders.length) {
      const count = document.createElement('span');
      count.className = 'dsct-adv-count';
      count.textContent = String(holders.length);
      count.dataset.tooltip = L('DSCT.party.alreadyHave', { names: holders.join(', ') });
      badge.append(count);
    }
    label.append(badge);
  }

  if (!blocked.size) return;

  
  
  const lock = () => {
    for (const key of blocked) box._disabledOptions.add(key);
    box._refresh();
  };
  box.addEventListener('change', lock);
  lock();
}

export function registerAdvancementHints() {
  for (const hook of ['renderChainConfigurationDialog', 'renderFillTraitDialog']) {
    Hooks.on(hook, (app) => { _leveling = app?.actor ?? null; });
    Hooks.on(hook.replace('render', 'close'), () => { _leveling = null; });
  }

  Hooks.on('renderDSDialog', (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    try { _annotateTraitPicks(root); }
    catch (err) { console.warn('DSCT | advancement hints |', err); }
  });
}
