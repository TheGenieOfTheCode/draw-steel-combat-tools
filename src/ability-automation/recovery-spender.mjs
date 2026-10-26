import { askConsent } from '../helpers.mjs';
import { _othersCandidates } from '../compat/dstd-compat.mjs';
import { runMultiTokenPicker } from './target-picker.mjs';

const L = (key, data) => game.i18n.format(`DSCT.FlatEffect.Heal.ally.${key}`, data ?? {});

export async function recoverySpender(source, { targetActor, casterActor, ability = null, range = 10 }) {
  if (source === 'target') return targetActor ?? null;
  if (source !== 'ally') return casterActor ?? null;
  const targetToken = targetActor?.getActiveTokens?.()?.[0] ?? null;
  const casterToken = casterActor?.getActiveTokens?.()?.[0] ?? null;
  const candidates = _othersCandidates({ mode: 'pick', origin: 'target', range, disposition: 'ally', count: 1, includeSelf: false },
    { sourceToken: casterToken, targetTokens: [targetToken].filter(Boolean), ability })
    .filter((t) => (t.actor?.system?.recoveries?.value ?? 0) > 0);
  if (!candidates.length) {
    ui.notifications.warn(L('none', { range, target: targetActor?.name ?? '' }));
    return null;
  }
  const [chosen] = (await runMultiTokenPicker({ candidates, maxTargets: 1, hint: L('pick', { range, target: targetActor?.name ?? '' }) })) ?? [];
  if (!chosen?.actor) return null;
  const agreed = await askConsent(chosen.actor, {
    content: L('ask', { name: chosen.name, target: targetActor?.name ?? '', ability: ability?.name ?? '' }),
    yes: L('yes'), no: L('no'), yesDone: L('yesDone', { name: chosen.name }), noDone: L('noDone', { name: chosen.name }),
  });
  if (!agreed) {
    ui.notifications.info(L('declined', { name: chosen.name }));
    return null;
  }
  return chosen.actor;
}
