
import { installRevivalHoverPreview, pingDeadToken, clearRevivalPreview, clearRevivalPreviewIfOrphaned } from './defeated-token-visibility.mjs';
import { captainCandidates, reassignSquadCaptain } from '../squad-hud.mjs';

const M = 'draw-steel-combat-tools';

const _open = new Set();
const _openKey = (msgId, key) => `${msgId}:${key}`;

const _sectionsOf = (deaths) => {
  const byKey = new Map();
  for (const d of deaths) {
    const groupId = d.groupId ?? d.captainOf ?? null;
    const key = groupId ? `g:${groupId}` : `n:${d.name}`;
    if (!byKey.has(key)) {
      byKey.set(key, { key, groupId, label: d.groupName || d.name, isGroup: !!groupId, deaths: [] });
    }
    byKey.get(key).deaths.push(d);
  }
  return [...byKey.values()];
};

const _summary = (deaths) => {
  const fallen = deaths.filter(d => !d.isObject).length;
  const wrecked = deaths.length - fallen;
  const line = (n, one, many) => !n ? null
    : (n === 1 ? game.i18n.localize(one) : game.i18n.format(many, { count: n }));
  return [
    line(fallen, 'DSCT.chat.dt.summaryFallenOne', 'DSCT.chat.dt.summaryFallen'),
    line(wrecked, 'DSCT.chat.dt.summaryDestroyedOne', 'DSCT.chat.dt.summaryDestroyed'),
  ].filter(Boolean).join(' ');
};

const _stillDown = (id) => {
  const defeated = CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
  return !!canvas?.tokens?.get(id)?.actor?.statuses?.has(defeated);
};

const _portrait = (death, { isCaptain = false } = {}) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = isCaptain ? 'dsct-death-token is-captain' : 'dsct-death-token';
  btn.dataset.tokenId = death.tokenId;
  btn.dataset.tooltip = game.i18n.format(
    isCaptain && game.user.isGM ? 'DSCT.tooltip.pingDeadCaptain' : 'DSCT.tooltip.pingDead',
    { name: death.name },
  );

  const img = document.createElement('img');
  img.className = 'dsct-death-art';
  img.src = death.img || 'icons/svg/mystery-man.svg';
  img.alt = death.name;
  btn.appendChild(img);

  if (isCaptain) {
    const crown = document.createElement('i');
    crown.className = 'fa-solid fa-crown dsct-death-crown';
    btn.appendChild(crown);
  }

  
  if (!_stillDown(death.tokenId)) btn.classList.add('is-risen');

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!await pingDeadToken(death.tokenId)) {
      ui.notifications.warn(game.i18n.format('DSCT.notice.dt.tokenGone', { name: death.name }));
    }
  });

  
  if (isCaptain) {
    btn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!game.user.isGM) return;
      const group = game.combat?.groups?.get(death.captainOf);
      if (!group) {
        ui.notifications.info(game.i18n.localize('DSCT.notice.squads.squadGone'));
        return;
      }
      if (!captainCandidates(death.captainOf).length) {
        ui.notifications.info(game.i18n.format('DSCT.notice.squads.noCaptainCandidates', { group: group.name }));
        return;
      }
      await reassignSquadCaptain(death.captainOf);
      refreshDeathCards();
    });
  }

  installRevivalHoverPreview(btn, () => [death.tokenId]);

  return btn;
};

const _ranks = (section) => {
  const captain = section.deaths.filter(d => d.captainOf === section.groupId);
  const rest = section.deaths.filter(d => !captain.includes(d));
  return [
    { key: 'captain', label: 'DSCT.chat.dt.rankCaptain', deaths: captain, captain: true },
    { key: 'minions', label: 'DSCT.chat.dt.rankMinions', deaths: rest.filter(d => d.isMinion) },
    { key: 'others',  label: 'DSCT.chat.dt.rankOthers',  deaths: rest.filter(d => !d.isMinion) },
  ].filter(r => r.deaths.length);
};

const _ranksInto = (wrap, section) => {
  const ranks = section.isGroup ? _ranks(section) : [{ key: 'flat', label: null, deaths: section.deaths }];
  const labelled = ranks.length > 1;

  for (const rank of ranks) {
    if (labelled && rank.label) {
      const head = document.createElement('div');
      head.className = 'dsct-death-rank';
      head.textContent = game.i18n.localize(rank.label);
      wrap.appendChild(head);
    }
    const list = document.createElement('div');
    list.className = rank.captain ? 'dsct-death-tokens is-captain-row' : 'dsct-death-tokens';
    for (const d of rank.deaths) list.appendChild(_portrait(d, { isCaptain: !!rank.captain }));
    wrap.appendChild(list);
  }
};

const _section = (msg, section, { canRevive, revive }) => {
  const wrap = document.createElement('details');
  wrap.className = 'dsct-death-section';
  wrap.open = _open.has(_openKey(msg.id, section.key));

  const hdr = document.createElement('summary');
  hdr.className = 'dsct-death-section-hdr';

  const chevron = document.createElement('i');
  chevron.className = 'fa-solid fa-chevron-right dsct-death-chevron';
  hdr.appendChild(chevron);

  const label = document.createElement('span');
  label.className = 'dsct-death-section-label';
  label.textContent = section.label;
  hdr.appendChild(label);

  const down = section.deaths.filter(d => _stillDown(d.tokenId));

  const badge = document.createElement('span');
  badge.className = 'dsct-death-badge';
  badge.textContent = String(section.deaths.length);
  hdr.appendChild(badge);

  
  if (canRevive && section.isGroup && down.length === section.deaths.length && down.length > 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-death-revive-group';
    btn.dataset.tooltip = game.i18n.localize('DSCT.tooltip.reviveGroup');
    btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i>`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      await revive(down.map(d => d.tokenId));
    });
    installRevivalHoverPreview(btn, () => down.map(d => d.tokenId));
    hdr.appendChild(btn);
  }

  hdr.addEventListener('click', () => {
    
    const key = _openKey(msg.id, section.key);
    if (wrap.open) _open.delete(key); else _open.add(key);
  });
  installRevivalHoverPreview(hdr, () => down.map(d => d.tokenId));

  wrap.appendChild(hdr);

  _ranksInto(wrap, section);

  return wrap;
};

const _cardLink = (cause) => {
  const note = document.createElement('p');
  note.className = 'dsct-undo-elsewhere';
  const label = game.i18n.localize('DSCT.chat.dt.undoFromCard');
  const card = cause.messageId ? game.messages.get(cause.messageId) : null;
  if (!card) { note.textContent = label; return note; }

  const link = document.createElement('a');
  link.textContent = label;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const row = document.querySelector(`#chat-log [data-message-id="${card.id}"], .chat-log [data-message-id="${card.id}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('dsct-card-found');
    setTimeout(() => row.classList.remove('dsct-card-found'), 1600);
  });
  note.appendChild(link);
  return note;
};

const _args = new Map();

export const refreshDeathCards = () => {
  
  clearRevivalPreview();
  for (const card of document.querySelectorAll('.dsct-death-card')) {
    const row = card.closest('[data-message-id]');
    const id = row?.dataset?.messageId;
    const msg = id ? game.messages.get(id) : null;
    const args = id ? _args.get(id) : null;
    if (msg && args) renderDeathMessage(msg, row, args);
  }
};

export const registerDeathCardRefresh = () => {
  const refresh = foundry.utils.debounce(() => refreshDeathCards(), 300);
  const onStatus = (effect) => { if ([...(effect.statuses ?? [])].includes('dead')) refresh(); };
  Hooks.on('deleteActiveEffect', onStatus);
  Hooks.on('createActiveEffect', onStatus);
  Hooks.on('deleteChatMessage', (msg) => {
    _args.delete(msg.id);
    for (const key of [..._open]) if (key.startsWith(`${msg.id}:`)) _open.delete(key);
    
    setTimeout(clearRevivalPreviewIfOrphaned, 0);
  });
};

export const renderDeathMessage = (msg, el, args) => {
  const { deaths, cause, canRevive, revive } = args;
  _args.set(msg.id, args);
  const host = el.querySelector('.message-content') ?? el;

  const card = document.createElement('div');
  card.className = 'dsct-death-card';

  const head = document.createElement('div');
  head.className = 'dsct-death-head';

  const skull = document.createElement('i');
  skull.className = 'fa-solid fa-skull dsct-death-skull';
  head.appendChild(skull);

  
  const title = document.createElement('span');
  title.className = 'dsct-death-title';
  title.textContent = _summary(deaths);
  head.appendChild(title);

  const count = document.createElement('span');
  count.className = 'dsct-death-count';
  count.textContent = String(deaths.length);
  head.appendChild(count);

  card.appendChild(head);

  const sections = _sectionsOf(deaths);
  for (const s of sections) card.appendChild(_section(msg, s, { canRevive, revive }));

  const foot = document.createElement('div');
  foot.className = 'dsct-death-foot';

  
  const linked = cause.messageId ? game.messages.get(cause.messageId) : null;
  if (cause.dstd || linked) {
    foot.appendChild(_cardLink(cause));
  } else if (canRevive) {
    const down = deaths.filter(d => _stillDown(d.tokenId)).map(d => d.tokenId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-undo-death';
    btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize(sections.length > 1 || deaths.length > 1 ? 'DSCT.button.undoAllDeaths' : 'DSCT.button.undo')}`;
    btn.disabled = !down.length;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      await revive(deaths.filter(d => _stillDown(d.tokenId)).map(d => d.tokenId));
    });
    installRevivalHoverPreview(btn, () => deaths.filter(d => _stillDown(d.tokenId)).map(d => d.tokenId));
    foot.appendChild(btn);
  }

  if (foot.childElementCount) card.appendChild(foot);

  host.replaceChildren(card);
};
