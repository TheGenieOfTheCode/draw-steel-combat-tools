const M = 'draw-steel-combat-tools';

export const INT_ANIMAL_DEFAULTS = [
  { id: 'bullfrog',  name: 'Bullfrog',  src: 'icons/creatures/amphibians/bullfrog-glowing-green.webp',         emoji: '🐸' },
  { id: 'chicken',   name: 'Chicken',   src: 'icons/creatures/birds/chicken-hen-white.webp',                   emoji: '🐔' },
  { id: 'crab',      name: 'Crab',      src: 'icons/creatures/fish/crab-blue-purple.webp',                     emoji: '🦀' },
  { id: 'cat',       name: 'Cat',       src: 'icons/creatures/mammals/cat-hunched-glowing-red.webp',           emoji: '🐱' },
  { id: 'dog',       name: 'Dog',       src: 'icons/creatures/mammals/dog-husky-white-blue.webp',              emoji: '🐶' },
  { id: 'rat',       name: 'Rat',       src: 'icons/creatures/mammals/rodent-rat-diseaed-gray.webp',           emoji: '🐀' },
  { id: 'rabbit',    name: 'Rabbit',    src: 'icons/creatures/mammals/rabbit-movement-glowing-green.webp',     emoji: '🐇' },
  { id: 'chameleon', name: 'Chameleon', src: 'icons/creatures/reptiles/chameleon-camouflage-green-brown.webp', emoji: '🦎' },
];

export const getAnimals = () => {
  const stored = game.settings.get(M, 'intAnimals');
  return (Array.isArray(stored) && stored.length) ? stored : INT_ANIMAL_DEFAULTS;
};

// ── Emoji picker ──────────────────────────────────────────────────────────────

// Each entry: [emoji, space-separated search terms]
const INT_EMOJI_LIST = [
  // Domestic animals
  ['🐶','dog puppy canine'],          ['🐱','cat kitten feline'],
  ['🐭','mouse rodent'],              ['🐹','hamster rodent'],
  ['🐰','rabbit bunny hare'],         ['🐇','rabbit bunny hare'],
  ['🐕','dog canine'],                ['🐩','poodle dog'],
  ['🦮','guide dog service'],         ['🐈','cat feline'],
  ['🐈‍⬛','black cat feline'],
  // Wild mammals
  ['🦊','fox'],                       ['🐻','bear'],
  ['🐼','panda bear'],                ['🐨','koala'],
  ['🐯','tiger'],                     ['🦁','lion'],
  ['🐮','cow bull bovine'],           ['🐷','pig hog pork'],
  ['🐴','horse'],                     ['🦄','unicorn horse'],
  ['🐺','wolf'],                      ['🐗','boar pig wild'],
  ['🐵','monkey'],                    ['🙈','monkey see no evil'],
  ['🙉','monkey hear no evil'],       ['🙊','monkey speak no evil'],
  ['🦍','gorilla ape'],               ['🦧','orangutan ape'],
  ['🦣','mammoth elephant'],          ['🐘','elephant'],
  ['🦛','rhinoceros rhino'],          ['🦏','rhinoceros rhino'],
  ['🐪','camel dromedary'],           ['🐫','camel bactrian hump'],
  ['🦒','giraffe'],                   ['🦘','kangaroo'],
  ['🦬','bison buffalo'],             ['🐃','water buffalo bovine'],
  ['🐂','bull ox bovine'],            ['🐄','cow bovine'],
  ['🐎','horse equine'],              ['🐖','pig hog'],
  ['🐏','ram sheep'],                 ['🐑','sheep ewe lamb'],
  ['🦙','llama'],                     ['🐐','goat'],
  ['🦌','deer stag reindeer'],        ['🦝','raccoon'],
  ['🦨','skunk'],                     ['🦡','badger'],
  ['🦫','beaver'],                    ['🦦','otter'],
  ['🦥','sloth'],                     ['🐁','mouse rodent'],
  ['🐀','rat rodent'],                ['🐿️','chipmunk squirrel'],
  ['🦔','hedgehog'],                  ['🐅','tiger big cat'],
  ['🐆','leopard cheetah panther'],   ['🦓','zebra'],
  ['🦍','gorilla primate'],
  // Birds
  ['🐔','chicken hen'],               ['🐧','penguin'],
  ['🐦','bird'],                      ['🐤','chick baby bird'],
  ['🦆','duck waterfowl'],            ['🦅','eagle raptor'],
  ['🦉','owl'],                       ['🦇','bat'],
  ['🦜','parrot'],                    ['🦢','swan'],
  ['🦩','flamingo'],                  ['🕊️','dove pigeon peace'],
  ['🐓','rooster chicken'],           ['🦃','turkey'],
  ['🦤','dodo bird'],                 ['🦚','peacock'],
  ['🪶','feather bird'],              ['🐦‍⬛','raven crow black bird'],
  // Reptiles & amphibians
  ['🐸','frog toad amphibian bullfrog'], ['🐢','turtle tortoise'],
  ['🐍','snake serpent'],             ['🦎','lizard reptile chameleon'],
  ['🦖','dinosaur t-rex'],            ['🦕','dinosaur sauropod brontosaurus'],
  ['🐊','crocodile alligator'],       ['🐉','dragon'],
  ['🐲','dragon'],
  // Sea creatures
  ['🐙','octopus'],                   ['🦑','squid'],
  ['🦐','shrimp prawn'],              ['🦞','lobster'],
  ['🦀','crab'],                      ['🐡','blowfish puffer'],
  ['🐠','tropical fish'],             ['🐟','fish'],
  ['🐬','dolphin'],                   ['🐳','whale'],
  ['🐋','whale'],                     ['🦈','shark'],
  ['🦭','seal'],
  // Insects & bugs
  ['🐝','bee honeybee'],              ['🪱','worm'],
  ['🐛','caterpillar bug larva'],     ['🦋','butterfly'],
  ['🐌','snail'],                     ['🐞','ladybug ladybird beetle'],
  ['🐜','ant'],                       ['🦟','mosquito'],
  ['🦗','cricket grasshopper'],       ['🦂','scorpion'],
  ['🕷️','spider'],                   ['🪲','beetle bug'],
  ['🪳','cockroach bug'],             ['🦠','microbe germ bacteria virus'],
  // Nature / plants
  ['🌿','herb plant leaf'],           ['🍄','mushroom fungus'],
  ['🐚','shell spiral'],              ['🌺','flower hibiscus'],
  ['🌸','blossom cherry flower'],     ['🌻','sunflower'],
  ['🌹','rose flower'],               ['🌵','cactus'],
  ['🌲','tree pine evergreen'],       ['🌳','tree deciduous'],
  ['🍀','clover shamrock'],           ['🪸','coral reef'],
  ['🌾','sheaf wheat grain'],         ['🪨','rock stone'],
  // Fantasy & magic
  ['🐉','dragon fantasy'],            ['🦄','unicorn'],
  ['👻','ghost spirit'],              ['💀','skull death'],
  ['☠️','skull crossbones poison'],   ['🎭','masks theater drama'],
  ['🃏','joker card wild'],           ['🎩','top hat magic'],
  ['🪄','magic wand'],               ['🔮','crystal ball magic'],
  ['🧙','wizard mage sorcerer'],      ['🧝','elf'],
  ['🧟','zombie undead'],             ['🧛','vampire'],
  ['🧜','mermaid fish human'],        ['🧚','fairy'],
  // Combat & adventure
  ['⚔️','sword crossed weapons'],     ['🗡️','dagger knife'],
  ['🏹','bow arrow archery'],         ['🛡️','shield defense'],
  ['🪃','boomerang'],                 ['🔱','trident'],
  // Elements & celestial
  ['🔥','fire flame'],                ['💧','water drop'],
  ['❄️','snowflake ice cold'],        ['⚡','lightning bolt electric'],
  ['🌊','wave water ocean'],          ['🌙','moon crescent night'],
  ['⭐','star'],                      ['🌟','glowing star'],
  ['💫','dizzy star'],                ['🌈','rainbow'],
  ['🌪️','tornado wind'],             ['☁️','cloud'],
  ['🌑','new moon dark'],             ['☀️','sun'],
  // Misc fun
  ['🎲','dice random'],               ['🎪','circus tent'],
  ['🥚','egg'],                       ['🪺','nest'],
  ['🦴','bone'],                      ['🐾','paw footprint'],
  ['🌀','cyclone spiral'],            ['👁️','eye watching'],
  ['🫀','heart organ'],               ['🧠','brain mind'],
];

// Singleton picker state
let _pickerEl   = null;
let _pickerCb   = null;
let _outsideOff = null;

const _buildGrid = (filter) => {
  const q    = filter.toLowerCase().trim();
  const list = q ? INT_EMOJI_LIST.filter(([, n]) => n.includes(q)) : INT_EMOJI_LIST;
  const grid = document.getElementById('dsct-int-epicker-grid');
  if (!grid) return;
  grid.innerHTML = list.map(([e]) =>
    `<button type="button" class="dsct-int-ep-btn" title="${e}"
      style="font-size:20px;line-height:1;padding:4px;border:1px solid transparent;border-radius:4px;
             background:none;cursor:pointer;width:34px;height:34px;"
      onmouseover="this.style.borderColor='var(--dsct-ep-accent,#7a50c0)'"
      onmouseout="this.style.borderColor='transparent'"
      data-emoji="${e}">${e}</button>`
  ).join('');
};

const _getOrCreatePicker = () => {
  if (_pickerEl) return _pickerEl;
  const p   = document.body.classList.contains('theme-dark');
  const bg  = p ? '#0e0c14' : '#f0eef8';
  const bdr = p ? '#2a2040' : '#b0a8cc';
  const bo  = p ? '#4a3870' : '#7060a8';
  const txt = p ? '#8a88a0' : '#3a3060';
  const btn = p ? '#1a1628' : '#dbd8ec';

  const el  = document.createElement('div');
  el.id     = 'dsct-int-emoji-picker';
  el.style.cssText = [
    `position:fixed;z-index:10000;display:none`,
    `background:${bg};border:1px solid ${bo};border-radius:6px`,
    `box-shadow:0 4px 18px rgba(0,0,0,0.5);padding:8px`,
    `width:280px;font-family:Georgia,serif`,
  ].join(';');
  el.style.setProperty('--dsct-ep-accent', '#7a50c0');

  el.innerHTML = `
    <input id="dsct-int-epicker-search" type="text" placeholder="Search emojis…"
      style="width:100%;box-sizing:border-box;padding:5px 8px;margin-bottom:6px;
             background:${btn};border:1px solid ${bdr};border-radius:4px;
             color:${txt};font-family:Georgia,serif;font-size:0.9em;outline:none;">
    <div id="dsct-int-epicker-grid"
      style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;
             max-height:220px;overflow-y:auto;"></div>`;

  document.body.appendChild(el);

  el.querySelector('#dsct-int-epicker-search').addEventListener('input', (e) => {
    _buildGrid(e.target.value);
  });

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (!btn) return;
    if (_pickerCb) _pickerCb(btn.dataset.emoji);
    _closePicker();
  });

  _pickerEl = el;
  return el;
};

const _closePicker = () => {
  if (_pickerEl) _pickerEl.style.display = 'none';
  if (_outsideOff) { document.removeEventListener('mousedown', _outsideOff); _outsideOff = null; }
  _pickerCb = null;
};

const _openPicker = (triggerEl, onSelect) => {
  const el = _getOrCreatePicker();
  _pickerCb = onSelect;

  // Reset search and populate grid
  const searchEl = el.querySelector('#dsct-int-epicker-search');
  searchEl.value = '';
  _buildGrid('');

  // Position below the trigger, flip up if too close to bottom
  el.style.display = 'block';
  const tr  = triggerEl.getBoundingClientRect();
  const vh  = window.innerHeight;
  const top = tr.bottom + 4 + el.offsetHeight > vh
    ? Math.max(0, tr.top - el.offsetHeight - 4)
    : tr.bottom + 4;
  const left = Math.min(tr.left, window.innerWidth - el.offsetWidth - 8);
  el.style.top  = `${top}px`;
  el.style.left = `${Math.max(8, left)}px`;

  // Focus search after positioning
  setTimeout(() => searchEl.focus(), 0);

  // Close on outside click
  if (_outsideOff) document.removeEventListener('mousedown', _outsideOff);
  _outsideOff = (e) => {
    if (!el.contains(e.target) && e.target !== triggerEl) _closePicker();
  };
  document.addEventListener('mousedown', _outsideOff);
};

// ── Settings UI ───────────────────────────────────────────────────────────────

const DEFAULT_ICON = 'icons/creatures/mammals/humanoid-fox-cat-archer.webp';

const palette = () => document.body.classList.contains('theme-dark') ? {
  bg: '#0e0c14', bgBtn: '#1a1628',
  border: '#2a2040', borderOuter: '#4a3870',
  text: '#8a88a0', textDim: '#3a3050', textLabel: '#4a3870',
  accent: '#7a50c0',
} : {
  bg: '#f0eef8', bgBtn: '#dbd8ec',
  border: '#b0a8cc', borderOuter: '#7060a8',
  text: '#3a3060', textDim: '#8880aa', textLabel: '#5040a0',
  accent: '#7a50c0',
};

const buildRow = (idx, animal, p) => `
  <tr>
    <td style="text-align:center;padding:4px 6px;">
      <button type="button" class="dsct-int-icon-pick" data-idx="${idx}" title="Click to change icon"
        style="width:34px;height:34px;padding:2px;border-radius:3px;cursor:pointer;
               background:${p.bgBtn};border:1px solid ${p.border};
               display:inline-flex;align-items:center;justify-content:center;">
        <img src="${animal.src || DEFAULT_ICON}" style="width:28px;height:28px;object-fit:contain;pointer-events:none;border-radius:2px;">
      </button>
      <input type="hidden" name="src-${idx}"  value="${animal.src || DEFAULT_ICON}">
      <input type="hidden" name="anid-${idx}" value="${animal.id}">
    </td>
    <td style="padding:4px 6px;">
      <input type="text" name="name-${idx}" value="${animal.name}" placeholder="Name…"
        style="width:100%;box-sizing:border-box;text-align:center;background:${p.bgBtn};border:1px solid ${p.border};
               color:${p.accent};font-weight:bold;border-radius:3px;padding:4px 6px;">
    </td>
    <td style="text-align:center;padding:4px 6px;">
      <button type="button" class="dsct-int-emoji-trigger" data-idx="${idx}" title="Pick emoji"
        style="width:52px;height:34px;font-size:20px;cursor:pointer;border-radius:3px;
               background:${p.bgBtn};border:1px solid ${p.border};
               display:inline-flex;align-items:center;justify-content:center;">
        ${animal.emoji || '＋'}
      </button>
      <input type="hidden" name="emoji-${idx}" value="${animal.emoji ?? ''}">
    </td>
    <td style="text-align:center;padding:4px 6px;">
      <button type="button" class="dsct-int-delete-animal" title="Remove animal"
        style="padding:3px 8px;border-radius:3px;cursor:pointer;background:${p.bgBtn};
               border:1px solid ${p.border};color:${p.textDim};">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </td>
  </tr>`;

export class ImNoThreatSettingsMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:         "I'm No Threat: Animal Settings",
      id:            'dsct-int-settings',
      width:         480,
      height:        'auto',
      closeOnSubmit: true,
    });
  }

  getData() {
    return { animals: getAnimals() };
  }

  async _renderInner(data) {
    const { animals } = data;
    const p = palette();

    const styleId = 'dsct-int-settings-style';
    const styleEl = document.getElementById(styleId)
      ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    styleEl.textContent = `
      #dsct-int-settings .window-content { background:${p.bg}; color:${p.text}; font-family:Georgia,serif; }
      #dsct-int-settings { border:1px solid ${p.borderOuter}; box-shadow:0 0 14px rgba(0,0,0,0.45); }
      #dsct-int-settings .window-header { background:${p.bg}; border-bottom:1px solid ${p.border}; color:${p.accent}; }
      #dsct-int-settings .window-header a { color:${p.textDim}; }
      #dsct-int-settings .window-header a:hover { color:${p.text}; }
      #dsct-int-settings input[type="text"] {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text};
        border-radius:3px; padding:4px 6px; font-family:Georgia,serif;
      }
      #dsct-int-settings input:focus { border-color:${p.accent}; outline:none; }
      #dsct-int-settings th {
        color:${p.textLabel}; text-transform:uppercase; font-size:0.75em; letter-spacing:0.6px;
        border-bottom:1px solid ${p.border}; padding:6px 8px; text-align:center; font-weight:bold;
      }
      #dsct-int-settings td { border-bottom:1px solid ${p.border}22; }
      #dsct-int-settings button {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text};
        border-radius:3px; cursor:pointer; padding:5px 14px; font-family:Georgia,serif;
      }
      #dsct-int-settings button:hover { border-color:${p.accent}; color:${p.accent}; }
      #dsct-int-settings .dsct-int-delete-animal:hover { border-color:#cc4444 !important; color:#cc4444 !important; }
      #dsct-int-settings .dsct-int-icon-pick:hover  { border-color:${p.accent} !important; }
      #dsct-int-settings .dsct-int-emoji-trigger:hover { border-color:${p.accent} !important; }
      #dsct-int-settings #dsct-int-save-btn { border-color:${p.accent}; color:${p.accent}; }
      #dsct-int-settings .dsct-int-table-scroll { max-height:360px; overflow-y:auto; }
    `;

    const rows = animals.map((a, idx) => buildRow(idx, a, p)).join('');

    return $(`<div style="padding:14px;">
      <div class="dsct-int-table-scroll">
        <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
          <thead>
            <tr>
              <th title="Icon shown in the I'm No Threat panel.">Icon</th>
              <th>Name</th>
              <th title="Emoji shown on the panel button (click to pick).">Emoji</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="dsct-int-animal-tbody">${rows}</tbody>
        </table>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px;">
        <button type="button" id="dsct-int-add-btn"   style="flex:1;"><i class="fa-solid fa-plus"></i> Add Animal</button>
        <button type="button" id="dsct-int-reset-btn" style="flex:1;"><i class="fa-solid fa-rotate-left"></i> Reset Defaults</button>
        <button type="button" id="dsct-int-save-btn"  style="flex:1;"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Icon FilePicker
    html.on('click', '.dsct-int-icon-pick', function () {
      const idx = $(this).data('idx');
      new FilePicker({
        type:     'imagevideo',
        current:  html.find(`[name="src-${idx}"]`).val() || '',
        callback: (path) => {
          html.find(`[name="src-${idx}"]`).val(path);
          $(this).find('img').attr('src', path);
        },
      }).browse();
    });

    // Emoji picker trigger
    html.on('click', '.dsct-int-emoji-trigger', function () {
      const idx     = $(this).data('idx');
      const trigger = this;
      _openPicker(trigger, (emoji) => {
        html.find(`[name="emoji-${idx}"]`).val(emoji);
        $(trigger).text(emoji);
      });
    });

    // Delete row
    html.on('click', '.dsct-int-delete-animal', function () {
      $(this).closest('tr').remove();
    });

    // Add blank row
    html.find('#dsct-int-add-btn').on('click', () => {
      const p = palette();
      const tbody = html.find('#dsct-int-animal-tbody');
      const maxIdx = Math.max(-1, ...tbody.find('tr').map((_, tr) => {
        const inp = $(tr).find('[name^="anid-"]')[0];
        return inp ? (parseInt(inp.name.replace('anid-', '')) || 0) : -1;
      }).get());
      const idx = maxIdx + 1;
      tbody.append(buildRow(idx, { id: foundry.utils.randomID(), name: '', src: DEFAULT_ICON, emoji: '' }, p));
    });

    // Reset to defaults
    html.find('#dsct-int-reset-btn').on('click', async () => {
      await game.settings.set(M, 'intAnimals', []);
      ui.notifications.info("I'm No Threat animals reset to defaults.");
      this.render(true);
    });

    // Save
    html.find('#dsct-int-save-btn').on('click', async () => {
      await this._doSave(html);
      this.close();
    });

    // Close picker when the settings window closes
    Hooks.once('closeImNoThreatSettingsMenu', () => _closePicker());
  }

  async _doSave(html) {
    const animals   = [];
    const seenNames = new Set();

    html.find('#dsct-int-animal-tbody tr').each((_, tr) => {
      const name  = ($(tr).find('[name^="name-"]').val()  ?? '').trim();
      const src   =  $(tr).find('[name^="src-"]').val()   || DEFAULT_ICON;
      const emoji = ($(tr).find('[name^="emoji-"]').val() ?? '').trim();
      const id    =  $(tr).find('[name^="anid-"]').val()  || foundry.utils.randomID();
      if (!name) return;
      if (seenNames.has(name)) { ui.notifications.warn(`Duplicate animal name "${name}" - skipping.`); return; }
      seenNames.add(name);
      animals.push({ id, name, src, emoji });
    });

    await game.settings.set(M, 'intAnimals', animals);
    Hooks.callAll('dsct.intAnimalsUpdated');
    ui.notifications.info("I'm No Threat animal settings saved. Reloading...");
    foundry.utils.debouncedReload();
  }

  async _updateObject() {}
}
