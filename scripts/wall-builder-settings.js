export const MATERIAL_RULE_DEFAULTS = {
  glass: { cost: 1, damage: 3 },
  wood:  { cost: 3, damage: 5 },
  stone: { cost: 6, damage: 8 },
  metal: { cost: 9, damage: 11 },
};

export const WALL_RESTRICTION_DEFAULTS = {
  glass: { move: 20, sight: 0,  light: 0,  sound: 0 },
  wood:  { move: 20, sight: 10, light: 20, sound: 0 },
  stone: { move: 20, sight: 10, light: 20, sound: 0 },
  metal: { move: 20, sight: 10, light: 20, sound: 0 },
};

const MATERIALS = ['glass', 'wood', 'stone', 'metal'];

export class WallBuilderSettingsMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:         'Wall Builder Settings',
      id:            'dsct-wall-builder-settings',
      width:         480,
      height:        'auto',
      closeOnSubmit: true,
    });
  }

  getData() {
    return {
      materials:        MATERIALS,
      rules:            game.settings.get('draw-steel-combat-tools', 'materialRules'),
      restrictions:     game.settings.get('draw-steel-combat-tools', 'wallRestrictions'),
      defaultMaterial:  game.settings.get('draw-steel-combat-tools', 'wbDefaultMaterial'),
      defaultHeightBot: game.settings.get('draw-steel-combat-tools', 'wbDefaultHeightBottom'),
      defaultHeightTop: game.settings.get('draw-steel-combat-tools', 'wbDefaultHeightTop'),
    };
  }

  async _renderInner(data) {
    const { materials, rules, restrictions, defaultMaterial, defaultHeightBot, defaultHeightTop } = data;

    const matRows = materials.map(mat => `
      <tr>
        <td style="padding:4px 8px;text-transform:capitalize;font-weight:bold;">${mat}</td>
        <td style="padding:4px 8px;"><input type="number" name="cost-${mat}" value="${rules[mat].cost}" min="1" max="20" style="width:60px;"/></td>
        <td style="padding:4px 8px;"><input type="number" name="damage-${mat}" value="${rules[mat].damage}" min="1" max="30" style="width:60px;"/></td>
        <td style="padding:4px 8px;"><input type="number" name="move-${mat}" value="${restrictions[mat].move}" min="0" max="20" step="10" style="width:60px;"/></td>
        <td style="padding:4px 8px;"><input type="number" name="sight-${mat}" value="${restrictions[mat].sight}" min="0" max="20" step="10" style="width:60px;"/></td>
        <td style="padding:4px 8px;"><input type="number" name="light-${mat}" value="${restrictions[mat].light}" min="0" max="20" step="10" style="width:60px;"/></td>
        <td style="padding:4px 8px;"><input type="number" name="sound-${mat}" value="${restrictions[mat].sound}" min="0" max="20" step="10" style="width:60px;"/></td>
      </tr>
    `).join('');

    const matOptions = materials.map(m =>
      `<option value="${m}" ${defaultMaterial === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
    ).join('');

    return $(`<div style="padding:8px;">
      <h3 style="margin-bottom:4px;">Material Properties</h3>
      <p style="font-size:0.8em;color:#888;margin-bottom:8px;">
        Cost: squares of momentum needed to break through. Damage: dealt on break-through.
        Wall restrictions use Foundry's 0–20 scale (0 = open, 20 = fully blocked).
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:0.85em;">
        <thead>
          <tr style="border-bottom:1px solid #aaa;">
            <th style="padding:4px 8px;text-align:left;">Material</th>
            <th style="padding:4px 8px;">Cost</th>
            <th style="padding:4px 8px;">Damage</th>
            <th style="padding:4px 8px;">Move</th>
            <th style="padding:4px 8px;">Sight</th>
            <th style="padding:4px 8px;">Light</th>
            <th style="padding:4px 8px;">Sound</th>
          </tr>
        </thead>
        <tbody>${matRows}</tbody>
      </table>

      <h3 style="margin:16px 0 4px;">Wall Builder Defaults</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:0.9em;">
        <div>
          <label style="display:block;margin-bottom:2px;">Default Material</label>
          <select name="defaultMaterial" style="width:100%;">${matOptions}</select>
        </div>
        <div>
          <label style="display:block;margin-bottom:2px;">Default Height Bottom</label>
          <input type="number" name="defaultHeightBot" value="${defaultHeightBot}" placeholder="(none)" style="width:100%;"/>
        </div>
        <div>
          <label style="display:block;margin-bottom:2px;">Default Height Top</label>
          <input type="number" name="defaultHeightTop" value="${defaultHeightTop}" placeholder="(none)" style="width:100%;"/>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button type="button" id="dsct-wb-reset" style="padding:4px 12px;">Reset to Defaults</button>
        <button type="submit" style="padding:4px 12px;">Save</button>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('#dsct-wb-reset').on('click', async () => {
      await game.settings.set('draw-steel-combat-tools', 'materialRules',        foundry.utils.deepClone(MATERIAL_RULE_DEFAULTS));
      await game.settings.set('draw-steel-combat-tools', 'wallRestrictions',     foundry.utils.deepClone(WALL_RESTRICTION_DEFAULTS));
      await game.settings.set('draw-steel-combat-tools', 'wbDefaultMaterial',    'stone');
      await game.settings.set('draw-steel-combat-tools', 'wbDefaultHeightBottom', '');
      await game.settings.set('draw-steel-combat-tools', 'wbDefaultHeightTop',    '');
      ui.notifications.info('Wall Builder settings reset to defaults.');
      this.render(true);
    });
  }

  async _updateObject(event, formData) {
    const rules        = foundry.utils.deepClone(game.settings.get('draw-steel-combat-tools', 'materialRules'));
    const restrictions = foundry.utils.deepClone(game.settings.get('draw-steel-combat-tools', 'wallRestrictions'));

    for (const mat of MATERIALS) {
      rules[mat].cost         = parseInt(formData[`cost-${mat}`])   || rules[mat].cost;
      rules[mat].damage       = parseInt(formData[`damage-${mat}`]) || rules[mat].damage;
      restrictions[mat].move  = parseInt(formData[`move-${mat}`])   ?? restrictions[mat].move;
      restrictions[mat].sight = parseInt(formData[`sight-${mat}`])  ?? restrictions[mat].sight;
      restrictions[mat].light = parseInt(formData[`light-${mat}`])  ?? restrictions[mat].light;
      restrictions[mat].sound = parseInt(formData[`sound-${mat}`])  ?? restrictions[mat].sound;
    }

    await game.settings.set('draw-steel-combat-tools', 'materialRules',        rules);
    await game.settings.set('draw-steel-combat-tools', 'wallRestrictions',     restrictions);
    await game.settings.set('draw-steel-combat-tools', 'wbDefaultMaterial',    formData.defaultMaterial);
    await game.settings.set('draw-steel-combat-tools', 'wbDefaultHeightBottom', formData.defaultHeightBot ?? '');
    await game.settings.set('draw-steel-combat-tools', 'wbDefaultHeightTop',    formData.defaultHeightTop ?? '');

    ui.notifications.info('Wall Builder settings saved.');
  }
}
