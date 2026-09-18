const PICKER_ATTR = 'data-color-picker';
const CONFIG_JSON = '{"format":"hex","alphaChannel":false}';

export const colorPickerActive = () => game.modules.get('color-picker')?.active && typeof ColorPicker !== 'undefined';

export function upgradeColorFields(root, selector = 'input[name$=".color"], input[name="color"]') {
  const el = root instanceof HTMLElement ? root : root?.[0];
  if (!el) return;

  let touched = false;
  for (const input of el.querySelectorAll(selector)) {
    if (input.hasAttribute(PICKER_ATTR)) continue;
    input.setAttribute(PICKER_ATTR, CONFIG_JSON);
    input.type = 'text';
    touched = true;
  }
  if (!touched) return;

  
  if (colorPickerActive()) ColorPicker.install();
}

export function registerColorFields() {
  Hooks.on('renderApplicationV2', (_app, html) => {
    try { upgradeColorFields(html); }
    catch (err) { console.warn('DSCT | color field |', err); }
  });
}
