import { getSetting, getItemDsid } from '../helpers.mjs';
import { isHiddenFrom, isConcealed, hasHiddenEcho } from '../conditions/stealth.mjs';
import { isCompletelyBeneath, coverWithBurrow } from '../conditions/burrow.mjs';
import { stealthTraits } from '../conditions/stealth-traits.mjs';
import { sizeRankG } from '../conditions/grab.mjs';
import { getStrikeType, isCrossfadeStrike, getCrossfadeEdgeForAbility } from './class-shadow/crossfade.mjs';
import { chooseKeywords } from './choose-effect.mjs';
import { areaOriginFor } from './area-picker.mjs';
import { richTip, tipAttrs, tipFor } from '../chat-tips.mjs';

let _pillIdCounter = 0;
const mkId = (s) => `dsct-p-${++_pillIdCounter}-${s}`;

function pill(id, kind, amount, reason, src, scope, dsNative = false) {
  return { id, kind, amount, reason, src, srcTokenId: null, srcTokenIds: [], srcAbility: null, scope, enabled: true, custom: false, dsNative };
}

