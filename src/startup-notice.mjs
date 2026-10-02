

import { getSetting } from './helpers.mjs';
import { remoteNotices, refreshRemoteNotices } from './remote-notices.mjs';

const M = 'draw-steel-combat-tools';
const STATE = 'startupNoticeState';

const REPO = 'https://github.com/TheGenieOfTheCode/draw-steel-combat-tools';
const LINKS = {
  notes: `${REPO}/releases/latest`,
  wiki:  `${REPO}/wiki`,
  kofi:  'https://ko-fi.com/genieofthecode',
};

const self = () => game.modules.get(M);

const listed = (kind) => remoteNotices()?.[kind] ?? [...(self()?.relationships?.[kind] ?? [])];

const newerVersion = () => {
  const latest = remoteNotices()?.latest;
  if (!latest?.version) return null;
  if (!foundry.utils.isNewerVersion(latest.version, self().version)) return null;
  return latest;
};

const localTitle = (id) => {
  const key = `DSCT.recommend.${id}`;
  const text = game.i18n.localize(key);
  return text === key ? id : text;
};

const recommended = () => {
  const out = [];
  for (const rel of listed('recommends')) {
    const installed = game.modules.get(rel.id);
    const behind = !!(installed?.active && rel.version && foundry.utils.isNewerVersion(rel.version, installed.version));
    out.push({
      id:      rel.id,
      reason:  rel.reason ?? '',
      title:   installed?.title || rel.title || localTitle(rel.id),
      state:   !installed ? 'missing' : (!installed.active ? 'off' : (behind ? 'outdated' : 'on')),
      version: rel.version ?? null,
      have:    installed?.version ?? null,
      url:     rel.url ?? null,
    });
  }
  return out;
};

const worthMentioning = () => recommended().filter((r) => r.state === 'missing' || r.state === 'off');

const outdated = () => recommended().filter((r) => r.state === 'outdated');

const updateKeys = () => [
  ...outdated().map((r) => `${r.id}@${r.version}`),
  ...(newerVersion() ? [`${M}@${newerVersion().version}`] : []),
];

const conflicting = () => {
  const out = [];
  for (const rel of listed('conflicts')) {
    const installed = game.modules.get(rel.id);
    if (!installed?.active) continue;
    out.push({
      id:     rel.id,
      reason: rel.reason ?? '',
      title:  installed.title || rel.title || localTitle(rel.id),
      issues: installed.bugs || installed.url || null,
    });
  }
  return out;
};

const anythingToSay = () => worthMentioning().length > 0 || conflicting().length > 0 || updateKeys().length > 0;

const signature = () => [
  ...recommended().map((r) => r.id),
  ...listed('conflicts').map((r) => `!${r.id}`),
  ...(newerVersion() ? [`v${newerVersion().version}`] : []),
].sort().join(',');

const readState = () => {
  const raw = getSetting(STATE);
  return (raw && typeof raw === 'object') ? raw : {};
};

const shouldPost = () => {
  if (!anythingToSay()) return false;
  const seen = readState();
  if (!seen.version) return true;
  if (seen.remind) return true;
  const announced = new Set(Array.isArray(seen.updates) ? seen.updates : []);
  if (updateKeys().some((k) => !announced.has(k))) return true;
  return seen.version !== self().version && seen.signature !== signature();
};

const button = (href, icon, label, cls) => {
  const a = document.createElement('a');
  a.className = `dsct-startup-btn${cls ? ` ${cls}` : ''}`;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = `<i class="${icon}"></i>`;
  a.append(document.createTextNode(label));
  return a;
};

const buildCard = () => {
  const card = document.createElement('div');
  card.className = 'dsct-startup';

  const head = document.createElement('div');
  head.className = 'dsct-startup-head';
  head.textContent = game.i18n.format('DSCT.chat.startup.title', { version: self().version });
  card.append(head);

  const updateRow = (message, url) => {
    const row = document.createElement('p');
    row.className = 'dsct-startup-update';
    row.innerHTML = '<i class="fa-solid fa-circle-arrow-up"></i>';
    row.append(document.createTextNode(message));
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = game.i18n.localize('DSCT.chat.startup.updateLink');
      row.append(document.createTextNode(' '), a);
    }
    card.append(row);
  };

  const update = newerVersion();
  if (update) updateRow(game.i18n.format('DSCT.chat.startup.update', { version: update.version }), update.url);
  for (const r of outdated()) {
    updateRow(game.i18n.format('DSCT.chat.startup.moduleUpdate', { title: r.title, version: r.version, have: r.have }), r.url);
  }

  if (worthMentioning().length) {
    const blurb = document.createElement('p');
    blurb.className = 'dsct-startup-blurb';
    blurb.textContent = game.i18n.localize('DSCT.chat.startup.blurb');
    card.append(blurb);
  }

  const list = document.createElement('ul');
  list.className = 'dsct-startup-list';
  for (const r of worthMentioning()) {
    const li = document.createElement('li');
    li.className = `dsct-startup-mod is-${r.state}`;

    const name = document.createElement('span');
    name.className = 'dsct-startup-name';
    name.textContent = r.title;
    li.append(name);

    const tag = document.createElement('span');
    tag.className = 'dsct-startup-state';
    tag.textContent = game.i18n.localize(`DSCT.chat.startup.state.${r.state}`);
    li.append(tag);

    if (r.reason) {
      const why = document.createElement('p');
      why.className = 'dsct-startup-why';
      why.textContent = r.reason;
      li.append(why);
    }
    list.append(li);
  }
  if (list.childElementCount) card.append(list);

  for (const c of conflicting()) {
    const warn = document.createElement('div');
    warn.className = 'dsct-startup-clash';

    const head = document.createElement('p');
    head.className = 'dsct-startup-clash-head';
    head.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    head.append(document.createTextNode(game.i18n.format('DSCT.chat.startup.clash', { title: c.title })));
    warn.append(head);

    if (c.reason) {
      const why = document.createElement('p');
      why.className = 'dsct-startup-why';
      why.textContent = c.reason;
      warn.append(why);
    }

    const ask = document.createElement('p');
    ask.className = 'dsct-startup-why';
    if (c.issues) {
      const a = document.createElement('a');
      a.href = c.issues;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = game.i18n.localize('DSCT.chat.startup.clashAskLink');
      
      ask.append(document.createTextNode(game.i18n.localize('DSCT.chat.startup.clashAsk') + ' ('), a, document.createTextNode(').'));
    } else {
      ask.textContent = game.i18n.format('DSCT.chat.startup.clashAskPlain', { title: c.title });
    }
    warn.append(ask);
    card.append(warn);
  }

  const row = document.createElement('div');
  row.className = 'dsct-startup-links';
  row.append(
    button(LINKS.notes, 'fa-solid fa-scroll', game.i18n.localize('DSCT.chat.startup.notes')),
    button(LINKS.wiki, 'fa-solid fa-book-open', game.i18n.localize('DSCT.chat.startup.wiki')),
    button(LINKS.kofi, 'fa-solid fa-mug-hot', game.i18n.localize('DSCT.chat.startup.kofi'), 'is-kofi'),
  );
  card.append(row);

  
  const again = document.createElement('p');
  again.className = 'dsct-startup-again';
  const link = document.createElement('a');
  link.dataset.action = 'dsctRemindAgain';
  link.textContent = game.i18n.localize('DSCT.chat.startup.remind');
  again.append(link);
  card.append(again);

  return card.outerHTML;
};

const RECENT = 15;

const post = async () => {
  const state = { version: self().version, signature: signature(), updates: updateKeys(), remind: false };
  await game.settings.set(M, STATE, state);

  
  const stale = game.messages.contents.slice(-RECENT).filter((m) => m.getFlag(M, 'startupNotice'));
  if (stale.length) await ChatMessage.deleteDocuments(stale.map((m) => m.id));
  await ChatMessage.create({
    content: buildCard(),
    whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
    flags: { [M]: { startupNotice: true } },
  });
};

export const showStartupNotice = async ({ force = true } = {}) => {
  if (!game.user.isGM) return null;
  await refreshRemoteNotices();
  if (!force && !shouldPost()) return null;
  if (!anythingToSay()) {
    ui.notifications.info(game.i18n.localize('DSCT.notice.startup.nothingToSay'));
    return null;
  }
  await post();
  return true;
};

export const registerStartupNotice = () => {
  Hooks.on('renderChatMessageHTML', (msg, html) => {
    if (!msg.getFlag(M, 'startupNotice')) return;
    const link = html.querySelector('[data-action="dsctRemindAgain"]');
    if (!link) return;

    
    if (!game.user.isGM) { link.closest('.dsct-startup-again')?.remove(); return; }

    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const asked = link.classList.toggle('is-asked');
      await game.settings.set(M, STATE, { ...readState(), remind: asked });
      link.textContent = game.i18n.localize(asked ? 'DSCT.chat.startup.remindOn' : 'DSCT.chat.startup.remind');
    });
  });

  Hooks.once('ready', async () => {
    
    if (!game.users.activeGM?.isSelf) return;
    await refreshRemoteNotices();
    if (!shouldPost()) return;
    try { await post(); }
    catch (err) { console.warn('DSCT | startup notice | could not post:', err); }
  });
};
