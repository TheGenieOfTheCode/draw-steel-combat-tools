import { BASE_MATERIALS, getCustomMaterials, getMaterialIcon, getMaterialAlpha } from './helpers.js';

export const MATERIAL_RULE_DEFAULTS = {
  glass: { cost: 1, damage: 3,  alpha: 0.1 },
  wood:  { cost: 3, damage: 5,  alpha: 0.8 },
  stone: { cost: 6, damage: 8,  alpha: 0.8 },
  metal: { cost: 9, damage: 11, alpha: 0.8 },
};

export const WALL_RESTRICTION_DEFAULTS = {
  glass: { move: 20, sight: 0,  light: 0,  sound: 0 },
  wood:  { move: 20, sight: 10, light: 20, sound: 0 },
  stone: { move: 20, sight: 10, light: 20, sound: 0 },
  metal: { move: 20, sight: 10, light: 20, sound: 0 },
};

const CUSTOM_MATERIAL_DEFAULTS = { cost: 3, damage: 5, alpha: 0.8, move: 20, sight: 10, light: 20, sound: 0 };
const DEFAULT_ICON = 'icons/commodities/stone/paver-brick-brown.webp';

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

const RESTRICT_LABELS = { 0: 'None', 10: 'Limited', 20: 'Blocked' };
const M = 'draw-steel-combat-tools';

const restrictSelect = (fieldName, currentVal, values = [0, 10, 20]) =>
  `<select name="${fieldName}" style="width:90px;">${
    values.map(v => `<option value="${v}" ${currentVal === v ? 'selected' : ''}>${RESTRICT_LABELS[v]}</option>`).join('')
  }</select>`;

const buildRow = (idx, origName, isBase, iconSrc, r, rs, p) => {
  const icon  = iconSrc || DEFAULT_ICON;
  const alpha = r.alpha ?? CUSTOM_MATERIAL_DEFAULTS.alpha;
  return `
    <tr>
      <td style="text-align:center;padding:4px 6px;">
        <button type="button" class="dsct-icon-pick" data-idx="${idx}" title="Click to change icon"
          style="width:34px;height:34px;padding:2px;border-radius:3px;cursor:pointer;
                 background:${p.bgBtn};border:1px solid ${p.border};
                 display:inline-flex;align-items:center;justify-content:center;">
          <img src="${icon}" style="width:28px;height:28px;object-fit:contain;pointer-events:none;border-radius:2px;">
        </button>
        <input type="hidden" name="icon-${idx}"     value="${icon}">
        <input type="hidden" name="origname-${idx}" value="${origName}">
        <input type="hidden" name="isbase-${idx}"   value="${isBase}">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="number" name="opacity-${idx}" value="${alpha}" min="0" max="1" step="0.05"
          style="width:52px;text-align:center;">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="text" name="matname-${idx}" value="${origName}" placeholder="name…"
          style="width:100%;box-sizing:border-box;text-align:center;background:${p.bgBtn};border:1px solid ${p.border};
                 color:${p.accent};font-weight:bold;border-radius:3px;padding:4px 6px;">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="number" name="cost-${idx}"   value="${r.cost}"   min="1" max="20" style="width:52px;text-align:center;">
      </td>
      <td style="text-align:center;padding:4px 6px;">
        <input type="number" name="damage-${idx}" value="${r.damage}" min="1" max="30" style="width:52px;text-align:center;">
      </td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`move-${idx}`,  rs.move,  [0, 20])}</td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`sight-${idx}`, rs.sight)}</td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`light-${idx}`, rs.light)}</td>
      <td style="text-align:center;padding:4px 6px;">${restrictSelect(`sound-${idx}`, rs.sound)}</td>
      <td style="text-align:center;padding:4px 6px;">
        ${!isBase
          ? `<button type="button" class="dsct-delete-mat" title="Remove material"
               style="padding:3px 8px;border-radius:3px;cursor:pointer;background:${p.bgBtn};
                      border:1px solid ${p.border};color:${p.textDim};">
               <i class="fa-solid fa-trash-can"></i>
             </button>`
          : ''}
      </td>
    </tr>`;
};

export class WallBuilderSettingsMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:         'Wall Builder Settings',
      id:            'dsct-wall-builder-settings',
      width:         950,
      height:        'auto',
      closeOnSubmit: true,
    });
  }

  getData() {
    const customs = getCustomMaterials();
    return {
      allMaterials:    [...BASE_MATERIALS, ...customs.map(m => m.name)],
      customs,
      rules:           game.settings.get(M, 'materialRules'),
      restrictions:    game.settings.get(M, 'wallRestrictions'),
      defaultMaterial: game.settings.get(M, 'wbDefaultMaterial'),
      defaultHeightBot: game.settings.get(M, 'wbDefaultHeightBottom'),
      defaultHeightTop: game.settings.get(M, 'wbDefaultHeightTop'),
    };
  }

  async _renderInner(data) {
    const { allMaterials, customs, rules, restrictions, defaultMaterial, defaultHeightBot, defaultHeightTop } = data;
    const p = palette();

    const styleId = 'dsct-wbs-style';
    const styleEl = document.getElementById(styleId)
      ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: styleId }));
    styleEl.textContent = `
      #dsct-wall-builder-settings .window-content { background:${p.bg}; color:${p.text}; font-family:Georgia,serif; }
      #dsct-wall-builder-settings { border:1px solid ${p.borderOuter}; box-shadow:0 0 14px rgba(0,0,0,0.45); }
      #dsct-wall-builder-settings .window-header { background:${p.bg}; border-bottom:1px solid ${p.border}; color:${p.accent}; }
      #dsct-wall-builder-settings .window-header a { color:${p.textDim}; }
      #dsct-wall-builder-settings .window-header a:hover { color:${p.text}; }
      #dsct-wall-builder-settings input[type="number"],
      #dsct-wall-builder-settings input[type="text"],
      #dsct-wall-builder-settings select {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text}; border-radius:3px; padding:4px 6px;
        font-family:Georgia,serif;
      }
      #dsct-wall-builder-settings input:focus,
      #dsct-wall-builder-settings select:focus { border-color:${p.accent}; outline:none; }
      #dsct-wall-builder-settings th {
        color:${p.textLabel}; text-transform:uppercase; font-size:0.75em; letter-spacing:0.6px;
        border-bottom:1px solid ${p.border}; padding:6px 8px; text-align:center; font-weight:bold;
        position:sticky; top:0; z-index:1; background:${p.bg};
      }
      #dsct-wall-builder-settings td { border-bottom:1px solid ${p.border}22; }
      #dsct-wall-builder-settings h3 {
        color:${p.accent}; border-bottom:1px solid ${p.border}; padding-bottom:5px;
        font-size:0.8em; text-transform:uppercase; letter-spacing:0.7px; margin-bottom:10px;
      }
      #dsct-wall-builder-settings .dsct-field-label {
        display:block; margin-bottom:4px; font-size:0.75em; text-transform:uppercase; letter-spacing:0.5px; color:${p.textLabel};
      }
      #dsct-wall-builder-settings button {
        background:${p.bgBtn}; border:1px solid ${p.border}; color:${p.text};
        border-radius:3px; cursor:pointer; padding:5px 14px; font-family:Georgia,serif;
      }
      #dsct-wall-builder-settings button:hover { border-color:${p.accent}; color:${p.accent}; }
      #dsct-wall-builder-settings .dsct-delete-mat:hover { border-color:#cc4444 !important; color:#cc4444 !important; }
      #dsct-wall-builder-settings .dsct-icon-pick:hover { border-color:${p.accent} !important; }
      #dsct-wall-builder-settings #dsct-wb-save-btn { border-color:${p.accent}; color:${p.accent}; }
      #dsct-wall-builder-settings .dsct-table-scroll {
        ${allMaterials.length >= 6 ? 'max-height:270px; overflow-y:auto;' : ''}
      }
    `;

    const matRows = allMaterials.map((mat, idx) => {
      const isBase  = BASE_MATERIALS.includes(mat);
      const custom  = customs.find(m => m.name === mat);
      const iconSrc = isBase ? getMaterialIcon(mat) : (custom?.icon || '');
      const rBase   = rules[mat]        ?? MATERIAL_RULE_DEFAULTS.stone;
      const r       = { ...rBase, alpha: rBase.alpha ?? getMaterialAlpha(mat) };
      const rs      = restrictions[mat] ?? WALL_RESTRICTION_DEFAULTS.stone;
      return buildRow(idx, mat, isBase, iconSrc, r, rs, p);
    }).join('');

    const matOptions = allMaterials.map(m =>
      `<option value="${m}" ${defaultMaterial === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
    ).join('');

    return $(`<div style="padding:14px;">
      <div class="dsct-table-scroll">
        <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
          <thead>
            <tr>
              <th title="Icon shown on the canvas tile for this material.">Icon</th>
              <th title="Opacity of the canvas tile (0 = invisible, 1 = fully opaque).">Opacity</th>
              <th>Name</th>
              <th title="Squares of forced-movement momentum required to break through this material.">Break Cost</th>
              <th title="Damage dealt to a creature when they crash through this material.">Break Damage</th>
              <th title="Whether this material blocks physical movement through it.">Movement</th>
              <th title="Whether this material blocks line of sight for vision.">Vision</th>
              <th title="Whether this material blocks light from passing through.">Light</th>
              <th title="Whether this material blocks sound from passing through.">Sound</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="dsct-wb-mat-tbody">${matRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:20px;">Wall Builder Defaults</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:0.9em;">
        <div>
          <label class="dsct-field-label">Default Material</label>
          <select name="defaultMaterial" style="width:100%;">${matOptions}</select>
        </div>
        <div>
          <label class="dsct-field-label">Default Height Bottom</label>
          <input type="number" name="defaultHeightBot" value="${defaultHeightBot}" placeholder="(none)" style="width:100%;box-sizing:border-box;">
        </div>
        <div>
          <label class="dsct-field-label">Default Height Top</label>
          <input type="number" name="defaultHeightTop" value="${defaultHeightTop}" placeholder="(none)" style="width:100%;box-sizing:border-box;">
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px;">
        <button type="button" id="dsct-wb-add-mat-btn" style="flex:1;"><i class="fa-solid fa-plus"></i> Add Material</button>
        <button type="button" id="dsct-wb-reset-btn"   style="flex:1;"><i class="fa-solid fa-rotate-left"></i> Reset Defaults</button>
        <button type="button" id="dsct-wb-save-btn"    style="flex:1;"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Icon filepicker - event delegation covers dynamically added rows too
    html.on('click', '.dsct-icon-pick', function () {
      const idx = $(this).data('idx');
      new FilePicker({
        type:     'imagevideo',
        current:  html.find(`[name="icon-${idx}"]`).val() || '',
        callback: (path) => {
          html.find(`[name="icon-${idx}"]`).val(path);
          $(this).find('img').attr('src', path);
        },
      }).browse();
    });

    // Delete row - DOM only, no re-render
    html.on('click', '.dsct-delete-mat', function () {
      $(this).closest('tr').remove();
    });

    // Add new blank row
    html.find('#dsct-wb-add-mat-btn').on('click', () => {
      const p = palette();
      const maxIdx = Math.max(-1, ...html.find('#dsct-wb-mat-tbody tr').map((_, tr) => {
        const inp = $(tr).find('[name^="origname-"]')[0];
        return inp ? (parseInt(inp.name.replace('origname-', '')) || 0) : -1;
      }).get());
      const idx = maxIdx + 1;
      const newRow = buildRow(idx, '', false, DEFAULT_ICON, MATERIAL_RULE_DEFAULTS.stone, WALL_RESTRICTION_DEFAULTS.stone, p);
      html.find('#dsct-wb-mat-tbody').append(newRow);
    });

    // Reset to defaults
    html.find('#dsct-wb-reset-btn').on('click', async () => {
      await game.settings.set(M, 'materialRules',         foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS));
      await game.settings.set(M, 'wallRestrictions',      foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS));
      await game.settings.set(M, 'customMaterials',       []);
      await game.settings.set(M, 'wbDefaultMaterial',     'stone');
      await game.settings.set(M, 'wbDefaultHeightBottom', '');
      await game.settings.set(M, 'wbDefaultHeightTop',    '');
      ui.notifications.info('Wall Builder settings reset to defaults.');
      this.render(true);
    });

    // Save - reads directly from DOM to avoid FormApplication serialization quirks
    html.find('#dsct-wb-save-btn').on('click', async () => {
      await this._doSave(html);
      this.close();
    });
  }

  async _doSave(html) {
    const intOr = (v, def) => { const n = parseInt(v); return isNaN(n) ? def : n; };

    // Collect all row indices present in the current DOM
    const indices = [];
    html.find('#dsct-wb-mat-tbody tr').each((_, tr) => {
      const inp = $(tr).find('[name^="origname-"]')[0];
      if (inp) indices.push(parseInt(inp.name.replace('origname-', '')));
    });

    const newRules        = {};
    const newRestrictions = {};
    const newCustoms      = [];
    const seenNames       = new Set();

    for (const i of indices) {
      const origName = html.find(`[name="origname-${i}"]`).val() ?? '';
      const isBase   = html.find(`[name="isbase-${i}"]`).val()   === 'true';
      const rawName  = (html.find(`[name="matname-${i}"]`).val() ?? origName).trim();
      const name     = rawName || origName;
      if (!name) continue;
      if (seenNames.has(name)) { ui.notifications.warn(`Duplicate material name "${name}" - skipping.`); continue; }
      seenNames.add(name);

      const rawAlpha = parseFloat(html.find(`[name="opacity-${i}"]`).val());
      newRules[name] = {
        cost:   intOr(html.find(`[name="cost-${i}"]`).val(),   MATERIAL_RULE_DEFAULTS.stone.cost),
        damage: intOr(html.find(`[name="damage-${i}"]`).val(), MATERIAL_RULE_DEFAULTS.stone.damage),
        alpha:  isNaN(rawAlpha) ? CUSTOM_MATERIAL_DEFAULTS.alpha : Math.min(1, Math.max(0, rawAlpha)),
      };
      newRestrictions[name] = {
        move:  intOr(html.find(`[name="move-${i}"]`).val(),  WALL_RESTRICTION_DEFAULTS.stone.move),
        sight: intOr(html.find(`[name="sight-${i}"]`).val(), WALL_RESTRICTION_DEFAULTS.stone.sight),
        light: intOr(html.find(`[name="light-${i}"]`).val(), WALL_RESTRICTION_DEFAULTS.stone.light),
        sound: intOr(html.find(`[name="sound-${i}"]`).val(), WALL_RESTRICTION_DEFAULTS.stone.sound),
      };
      if (!isBase) newCustoms.push({ name, icon: html.find(`[name="icon-${i}"]`).val() || '' });
    }

    await game.settings.set(M, 'materialRules',         newRules);
    await game.settings.set(M, 'wallRestrictions',      newRestrictions);
    await game.settings.set(M, 'customMaterials',       newCustoms);
    await game.settings.set(M, 'wbDefaultMaterial',     html.find('[name="defaultMaterial"]').val()  ?? 'stone');
    await game.settings.set(M, 'wbDefaultHeightBottom', html.find('[name="defaultHeightBot"]').val() ?? '');
    await game.settings.set(M, 'wbDefaultHeightTop',    html.find('[name="defaultHeightTop"]').val() ?? '');

    ui.notifications.info('Wall Builder settings saved.');
  }

  // FormApplication requires _updateObject - stub it out since Save is handled manually above.
  async _updateObject() {}
}
