const sceneOf = (message) => game.scenes.get(message?.speaker?.scene) ?? canvas.scene ?? null;

const tokenOfActor = (actor, scene) => {
  if (actor.isToken) return actor.token;
  for (const s of [scene, canvas.scene]) {
    const tokens = s?.tokens.filter((t) => t.actorId === actor.id) ?? [];
    const found = tokens.find((t) => t.actorLink) ?? tokens[0];
    if (found) return found;
  }
  return null;
};

const resolveOne = (ref, scene) => {
  const doc = ref.includes('.') ? fromUuidSync(ref) : (scene?.tokens.get(ref) ?? game.actors.get(ref));
  if (doc?.documentName === 'Token') return doc;
  if (doc?.documentName === 'Actor') return tokenOfActor(doc, scene);
  return null;
};

export const refList = (raw) => String(raw ?? '').replace(/[[\]"]/g, ' ').split(/[\s,]+/).filter(Boolean);

export const resolveTokenRefs = (raw, { message = null, relative = {} } = {}) => {
  const scene = sceneOf(message);
  const out = [];
  for (const ref of refList(raw)) {
    const docs = ref.startsWith('@') ? (relative[ref.slice(1).toLowerCase()]?.() ?? []) : [resolveOne(ref, scene)];
    for (const doc of docs) if (doc && !out.includes(doc)) out.push(doc);
  }
  return out;
};
