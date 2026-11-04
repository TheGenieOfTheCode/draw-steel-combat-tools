
import { TIP_CLASS, richTip, tipFrom, setTip, tipAttrs, pillTip } from './ctlib.mjs';

export { TIP_CLASS, richTip, setTip, tipAttrs, pillTip };

export const tipFor = (key, opts) => tipFrom(`DSCT.tip.${key}`, opts);

export function registerChatTips() {
  Handlebars.registerHelper('dsctTip', (key, options) => {
    const { title, category, body, ...data } = options?.hash ?? {};
    return new Handlebars.SafeString(tipAttrs(tipFor(key, { title, category, body, data })));
  });
}
