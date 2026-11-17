import { services } from './ctlib.mjs';

const M = 'draw-steel-combat-tools';

export const liveApplies = (message) => {
  if (!message) return 0;
  let n = 0;
  for (const st of Object.values(message.getFlag?.(M, 'adv') ?? {})) n += Object.keys(st?.applied ?? {}).length;
  for (const m of game.messages) {
    const f = m.flags?.[M];
    if (f?.isFmUndo && f.contextMessageId === message.id && !f.isUndone && !f.noMove) n++;
  }
  return n;
};

services.provide('liveApplies', liveApplies);
