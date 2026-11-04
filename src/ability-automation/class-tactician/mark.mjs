import { getSetting, getModuleApi, getItemDsid } from '../../helpers.mjs';
import { safeUpdate } from '../../ctlib.mjs';

const M = 'draw-steel-combat-tools';

const markButtonHTML = (maxTargets, override) => {
  const noun = maxTargets === 1 ? 'Mark' : `${maxTargets} Marks`;
  return `<i class="fa-solid fa-crosshairs"></i> Apply ${noun}${override ? ' (Override)' : ''}`;
};

export const MARK_ABILITY_CONFIG = {
  'mark':                   { maxTargets: 1, override: true  },
  'mind-game':              { maxTargets: 1, override: false },
  'fog-of-war':             { maxTargets: 2, override: false },
  'targets-of-opportunity': { maxTargets: 2, override: false },
  'battle-plan':            { maxTargets: 3, override: false },
  'hustle':                 { maxTargets: 2, override: false },
  'no-escape':              { maxTargets: 1, override: false },
  'that-one-is-mine':       { maxTargets: 1, override: false },
};

export const registerMarkHooks = () => {
  Hooks.on('renderChatMessageHTML', (msg, el) => {
    let _ba = null;
    const btnArea = () => {
      if (!_ba) {
        _ba = el.querySelector('.message-part-buttons');
        if (!_ba) {
          _ba = document.createElement('div');
          _ba.className = 'message-part-buttons';
          (el.querySelector('.message-content') ?? el).appendChild(_ba);
        }
      }
      return _ba;
    };
    const dsid = msg.getFlag(M, 'abilityDsid');

    if (getSetting('markAutomation') && !game.modules.get('draw-steel-target-damage')?.active) {
      const reminder = msg.getFlag('draw-steel-combat-tools', 'markReminder');
      if (reminder && !msg.getFlag('draw-steel-combat-tools', 'markReminderUsed')) {
        const { dsid: rDsid, isMarkAbility, sourceActorId } = reminder;
        const reminderActor   = game.actors.get(sourceActorId);
        const reminderAnticip = isMarkAbility && (reminderActor?.items.some(i => getItemDsid(i) === 'anticipation') ?? false);
        const reminderMax     = reminderAnticip ? 2 : 1;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsct-mark-reminder-btn';
        btn.innerHTML = markButtonHTML(reminderMax, isMarkAbility);
        btn.style.cssText = 'cursor:pointer;margin-top:4px;';
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          let maxTargets = 1, override = false;
          if (isMarkAbility) {
            const actor = game.actors.get(sourceActorId);
            maxTargets = actor?.items.some(i => getItemDsid(i) === 'anticipation') ? 2 : 1;
            override   = true;
          }
          await getModuleApi(false)?.mark({ maxTargets, override, dsid: rDsid, sourceActorId });
          if (msg.isOwner) await msg.setFlag(M, 'markReminderUsed', true);
          else await safeUpdate(msg, { [`flags.${M}.markReminderUsed`]: true });
        });
        btnArea().appendChild(btn);
      }
    }

    if (getSetting('markAutomation') && MARK_ABILITY_CONFIG[dsid]) {
      const config         = MARK_ABILITY_CONFIG[dsid];
      const speakerActor   = game.actors.get(msg.speaker?.actor);
      const speakerAnticip = dsid === 'mark' && (speakerActor?.items.some(i => getItemDsid(i) === 'anticipation') ?? false);
      const effectiveMax   = speakerAnticip ? Math.max(config.maxTargets, 2) : config.maxTargets;

      const injectNormalMarkBtn = () => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsct-mark-btn';
        btn.innerHTML = markButtonHTML(effectiveMax, config.override);
        btn.style.cssText = 'cursor:pointer;';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          getModuleApi(false)?.mark({ ...config, dsid, sourceActorId: msg.speaker?.actor ?? null });
        });
        btnArea().appendChild(btn);
      };

      if (!game.modules.get('draw-steel-target-damage')?.active) {
        injectNormalMarkBtn();
      } else {
        setTimeout(() => {
          if (el.querySelector('.draw-steel-target-damage-target-row')) return;
          injectNormalMarkBtn();
          const obs = new MutationObserver(() => {
            if (el.querySelector('.draw-steel-target-damage-target-row')) {
              el.querySelector('.dsct-mark-btn')?.remove();
              obs.disconnect();
            }
          });
          obs.observe(el, { childList: true, subtree: true });
          setTimeout(() => obs.disconnect(), 3000);
        }, 0);
      }
    }
  });
};
