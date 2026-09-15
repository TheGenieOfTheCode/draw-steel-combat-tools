const M = 'draw-steel-combat-tools';

const REGISTRY = { actor: [], ability: [] };

export function registerEffectFlag(group, def) {
  const list = REGISTRY[group] ?? (REGISTRY[group] = []);
  if (list.some(d => d.key === def.key)) return;
  list.push({ type: 'add', value: 'true', priority: null, ...def });
}

export const effectFlags = (group) => [...(REGISTRY[group] ?? [])];

const L = (k, data) => (data ? game.i18n.format(k, data) : game.i18n.localize(k));

const _groupFor = (effect) => (effect?.type === 'abilityModifier' ? 'ability' : 'actor');

function _rowInputs(li) {
  return {
    key: li.querySelector('.key input'),
    type: li.querySelector('.type select'),
    value: li.querySelector('.value input'),
    priority: li.querySelector('.priority input'),
  };
}

function _typeLabel(select, type) {
  const opt = select ? Array.from(select.options).find(o => o.value === type) : null;
  return opt?.textContent?.trim() || type;
}

function _content(defs, typeSelect) {
  const byCategory = new Map();
  for (const def of defs) {
    const cat = def.category ?? '';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(def);
  }
  const esc = foundry.utils.escapeHTML;
  let options = '';
  for (const [cat, list] of byCategory) {
    const label = cat ? esc(L(`DSCT.effectFlags.groups.${cat}`)) : '';
    if (label) options += `<optgroup label="${label}">`;
    for (const def of list) options += `<option value="${esc(def.key)}">${esc(L(def.label))}</option>`;
    if (label) options += '</optgroup>';
  }
  const first = defs[0];
  return `
    <div class="dsct-flag-picker">
      <div class="form-group">
        <label>${esc(L('DSCT.effectFlags.pick'))}</label>
        <div class="form-fields"><select name="flag">${options}</select></div>
      </div>
      <div class="dsct-flag-info">
        <p class="dsct-flag-desc">${esc(L(first.description))}</p>
        <dl>
          <dt>${esc(L('DSCT.effectFlags.key'))}</dt><dd><code class="dsct-flag-key">${esc(first.key)}</code></dd>
          <dt>${esc(L('DSCT.effectFlags.type'))}</dt><dd class="dsct-flag-type">${esc(_typeLabel(typeSelect, first.type))}</dd>
          <dt>${esc(L('DSCT.effectFlags.values'))}</dt><dd class="dsct-flag-values">${esc(L(first.values))}</dd>
        </dl>
      </div>
    </div>`;
}

async function _pick(defs, typeSelect) {
  let chosen = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: L('DSCT.effectFlags.title'), icon: 'fas fa-toolbox' },
    classes: ['dsct-flag-picker-dialog'],
    position: { width: 400 },
    content: _content(defs, typeSelect),
    buttons: [
      {
        action: 'apply', label: L('DSCT.effectFlags.apply'), icon: 'fas fa-check', default: true,
        callback: (_ev, _btn, dialog) => dialog.element.querySelector('select[name="flag"]')?.value ?? null,
      },
      { action: 'cancel', label: L('DSCT.effectFlags.cancel'), icon: 'fas fa-times' },
    ],
    render: (_ev, dialog) => {
      const root = dialog.element;
      const select = root.querySelector('select[name="flag"]');
      const show = () => {
        const def = defs.find(d => d.key === select.value);
        if (!def) return;
        root.querySelector('.dsct-flag-desc').textContent = L(def.description);
        root.querySelector('.dsct-flag-key').textContent = def.key;
        root.querySelector('.dsct-flag-type').textContent = _typeLabel(typeSelect, def.type);
        root.querySelector('.dsct-flag-values').textContent = L(def.values);
      };
      select?.addEventListener('change', show);
    },
    rejectClose: false,
  });
  if (typeof result === 'string') chosen = defs.find(d => d.key === result) ?? null;
  return chosen;
}

function _fill(li, def) {
  const { key, type, value, priority } = _rowInputs(li);
  const set = (input, v) => {
    if (!input || v === undefined || v === null) return;
    input.value = String(v);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(key, def.key);
  if (type && Array.from(type.options).some(o => o.value === def.type)) set(type, def.type);
  set(value, def.value);
  if (def.priority !== null && def.priority !== undefined) set(priority, def.priority);
}

function _decorate(app, root) {
  const group = _groupFor(app.document);
  const defs = effectFlags(group);
  if (!defs.length) return;

  const rows = root.querySelectorAll('section.tab.changes li[data-index]');
  for (const li of rows) {
    const keyDiv = li.querySelector('.key');
    if (!keyDiv || keyDiv.querySelector('.dsct-flag-pick')) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsct-flag-pick';
    btn.dataset.tooltip = L('DSCT.effectFlags.button');
    btn.setAttribute('aria-label', L('DSCT.effectFlags.button'));
    btn.innerHTML = '<i class="fas fa-toolbox"></i>';
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const def = await _pick(defs, _rowInputs(li).type);
      if (def) _fill(li, def);
    });
    keyDiv.classList.add('dsct-has-flag-pick');
    keyDiv.prepend(btn);
  }
}

export function registerEffectFlagPicker() {
  Hooks.on('renderActiveEffectConfig', (app, element) => {
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    try { _decorate(app, root); }
    catch (err) { console.warn(`DSCT | effect flag picker |`, err); }
  });
}
