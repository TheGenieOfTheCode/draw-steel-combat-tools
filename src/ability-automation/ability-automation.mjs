import { getSetting, getModuleApi } from '../helpers.mjs';
import { applyTaunted, applyFrightened } from '../conditions/conditions.mjs';
import { registerImNoThreatHooks } from './class-shadow/im-no-threat.mjs';
import { registerJudgementHooks } from './class-censor/judgement.mjs';
import { registerMarkHooks, MARK_ABILITY_CONFIG } from './class-tactician/mark.mjs';

export { openImNoThreatPanel, ImNoThreatSettingsMenu, getAnimals, INT_ANIMAL_DEFAULTS } from './class-shadow/im-no-threat.mjs';
export { MARK_ABILITY_CONFIG } from './class-tactician/mark.mjs';

const M = 'draw-steel-combat-tools';

export const registerAbilityInjectors = () => {
  registerImNoThreatHooks();
  registerJudgementHooks();
  registerMarkHooks();

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    let _ba = null;
    const btnArea = () => {
      if (!_ba) {
        _ba = el.querySelector('.message-part-buttons');
        const created = !_ba;
        if (!_ba) {
          _ba = document.createElement('div');
          _ba.className = 'message-part-buttons';
          (el.querySelector('.message-content') ?? el).appendChild(_ba);
        }
        if (getSetting('debugMode')) console.log(`DSCT | DSP-debug | ability-automation btnArea: ${created ? 'CREATED' : 'FOUND'} .message-part-buttons`, _ba, 'parent:', _ba.parentElement, 'el classes:', el.className);
      }
      return _ba;
    };
    const dsid = msg.getFlag(M, 'abilityDsid');

    const hasDstd = !!game.modules.get('draw-steel-target-damage')?.active;
    if (getSetting('neutralizeEnrichers') && (dsid || !hasDstd)) {
      const srcTknId = msg.speaker?.token ?? null;
      const actor    = msg.speaker?.actor ? game.actors.get(msg.speaker.actor) : null;
      const seen     = new Set();
      const cache    = window._dsctEnricherCache ?? (window._dsctEnricherCache = new Map());
      const cached   = [];

      const processEnrichers = () => {
        for (const wrapper of el.querySelectorAll('[enricher="ds.apply"]')) {
          const link     = wrapper.querySelector('a');
          const type     = link?.dataset?.type;
          const statusId = type === 'status' ? (link?.dataset?.status ?? null) : null;
          const endStr   = link?.dataset?.end ?? null;
          const label    = link?.textContent?.trim() ?? wrapper.textContent?.trim() ?? '';

          if (!statusId) {
            const dsctOwnsAbility =
              (getSetting('judgementAutomation') && dsid === 'judgement') ||
              (getSetting('markAutomation') && dsid in MARK_ABILITY_CONFIG);
            if (!dsctOwnsAbility) continue;
          }

          if (statusId && !cached.some(e => e.statusId === statusId)) {
            cached.push({ statusId, endStr, label });
          }

          const span = document.createElement('span');
          span.textContent = label;
          wrapper.replaceWith(span);

          if (hasDstd || !statusId || seen.has(statusId)) continue;
          seen.add(statusId);
          if (btnArea().querySelector(`[data-dsct-enrich-status="${statusId}"]`)) continue;

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dsct-taunted-btn';
          btn.dataset.dsctEnrichStatus = statusId;
          btn.innerHTML = `<i class="fa-solid fa-person-rays"></i> Apply ${label}`;
          btn.style.cssText = 'cursor:pointer;';
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const targets = [...game.user.targets];
            if (!targets.length) { ui.notifications.warn('No targets selected.'); return; }
            for (const t of targets) {
              if (statusId === 'taunted' && actor)         await applyTaunted(t, actor, srcTknId, endStr);
              else if (statusId === 'frightened' && actor) await applyFrightened(t, actor, srcTknId, endStr);
              else {
                const tmp = await CONFIG.ActiveEffect.documentClass.fromStatusEffect(statusId).catch(() => null);
                if (tmp) {
                  const data = foundry.utils.mergeObject(tmp.toObject(), { transfer: true });
                  if (endStr && ds?.CONFIG?.effectEnds?.[endStr])
                    data.duration = { expiry: ds.CONFIG.effectEnds[endStr].expiryEvent };
                  await t.actor.createEmbeddedDocuments('ActiveEffect', [data]);
                }
              }
            }
          });
          btnArea().appendChild(btn);
        }
        if (cached.length) cache.set(msg.id, cached);
      };

      processEnrichers();
      const enrichObs = new MutationObserver(processEnrichers);
      enrichObs.observe(el, { childList: true, subtree: true });
      setTimeout(() => enrichObs.disconnect(), 3000);
    }

    if (getSetting('aidAttackAutomation') && dsid === 'aid-attack') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-aid-attack-btn';
      btn.innerHTML = '<i class="fa-solid fa-handshake"></i> Aid Attack';
      btn.style.cssText = 'cursor:pointer;';
      btn.addEventListener('click', (e) => { e.preventDefault(); getModuleApi(false)?.aidAttack(); });
      btnArea().appendChild(btn);
    }
  });
};
