import { getSetting, getModuleApi } from '../../helpers.mjs';
import { flagJudgementTriggersUsed } from '../tactical-effects.mjs';
import { applyTaunted } from '../../conditions/conditions.mjs';

const M = 'draw-steel-combat-tools';

const _speakerActor = (msg) => {
  const tokenDoc = msg.speaker?.token ? canvas?.tokens?.get(msg.speaker.token)?.document : null;
  return tokenDoc?.actor ?? (msg.speaker?.actor ? game.actors.get(msg.speaker.actor) : null) ?? null;
};

export const registerJudgementHooks = () => {
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

    if (getSetting('judgementAutomation') && dsid === 'judgement' && !game.modules.get('draw-steel-target-damage')?.active) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-judgement-btn';
      btn.innerHTML = '<i class="fa-solid fa-skull-crossbones"></i> Apply Judgement';
      btn.style.cssText = 'cursor:pointer;';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        getModuleApi(false)?.judgement({ sourceActorId: _speakerActor(msg)?.id ?? null });
      });
      btnArea().appendChild(btn);
    }

    if (getSetting('judgementAutomation')) {
      const fallenFlag = msg.getFlag(M, 'judgementFallen');
      if (fallenFlag && (game.user.id === fallenFlag.userId || game.user.isGM)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dsct-judgement-btn';
        btn.innerHTML = '<i class="fa-solid fa-skull-crossbones"></i> Apply Judgement';
        btn.style.cssText = 'cursor:pointer;';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          getModuleApi(false)?.judgement({ sourceActorId: fallenFlag.actorId ?? null });
        });
        btnArea().appendChild(btn);
      }
    }

    if (getSetting('judgementAutomation')) {
      const t2flag = msg.getFlag(M, 'judgementBaneReminder');
      if (t2flag) {
        const baneUsed    = !!msg.getFlag(M, 'judgementBaneUsed');
        const baneDeclined = !!msg.getFlag(M, 'judgementBaneDeclined');
        const triggerUsed = !!msg.getFlag(M, 'judgementTriggerUsed');

        if (baneUsed) {
          const canceled = !!msg.getFlag(M, 'judgementBaneCanceled');
          const notice = document.createElement('div');
          notice.className = 'dsct-undo-status';
          notice.textContent = canceled
            ? game.i18n.localize('DSCT.chat.tactical.judgementBaneCanceled')
            : game.i18n.localize('DSCT.chat.tactical.judgementBaneImposed');
          btnArea().appendChild(notice);
        } else if (baneDeclined || triggerUsed) {
          const notice = document.createElement('div');
          notice.className = 'dsct-undo-status';
          notice.textContent = baneDeclined
            ? game.i18n.localize('DSCT.chat.tactical.judgementBaneDeclined')
            : game.i18n.localize('DSCT.chat.tactical.judgementTriggerUsed');
          btnArea().appendChild(notice);
        } else {
          const { actorId } = t2flag;
          const lockData = msg.getFlag(M, 'judgementBaneLock');

          if (lockData) {
            const remaining = lockData.lockUntil - Date.now();
            if (remaining > 0) {
              const countdownEl = document.createElement('div');
              countdownEl.style.cssText = 'font-size:0.85em;opacity:0.7;margin-bottom:4px;';
              countdownEl.textContent = game.i18n.format('DSCT.chat.tactical.judgementBaneLockCountdown', { seconds: Math.ceil(remaining / 1000) });
              btnArea().appendChild(countdownEl);
              const interval = setInterval(() => {
                const rem = lockData.lockUntil - Date.now();
                if (rem <= 0) { countdownEl.remove(); clearInterval(interval); }
                else countdownEl.textContent = game.i18n.format('DSCT.chat.tactical.judgementBaneLockCountdown', { seconds: Math.ceil(rem / 1000) });
              }, 500);
            }
          }

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dsct-judgement-btn';
          btn.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${game.i18n.localize('DSCT.button.judgementImposeBane')}`;
          btn.style.cssText = 'cursor:pointer;';
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            const api = getModuleApi(false);
            if (api?.socket) await api.socket.executeForEveryone('dsct.injectJudgementBane', { actorId, tokenId: t2flag.tokenId ?? null });
            if (msg.isOwner || game.user.isGM) {
              await msg.setFlag(M, 'judgementBaneUsed', true);
            } else if (api?.socket) {
              await api.socket.executeAsGM('dsct.updateDocument', msg.uuid, { [`flags.${M}.judgementBaneUsed`]: true });
            }
            await flagJudgementTriggersUsed(actorId);
          });
          btnArea().appendChild(btn);

          const declineBtn = document.createElement('button');
          declineBtn.type = 'button';
          declineBtn.className = 'dsct-judgement-btn';
          declineBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${game.i18n.localize('DSCT.button.judgementDecline')}`;
          declineBtn.style.cssText = 'cursor:pointer;';
          declineBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            declineBtn.disabled = true;
            const api = getModuleApi(false);
            if (msg.isOwner || game.user.isGM) {
              await msg.setFlag(M, 'judgementBaneDeclined', true);
            } else if (api?.socket) {
              await api.socket.executeAsGM('dsct.updateDocument', msg.uuid, { [`flags.${M}.judgementBaneDeclined`]: true });
            }
          });
          btnArea().appendChild(declineBtn);
        }
      }
    }

    if (getSetting('judgementAutomation')) {
      const t3flag = msg.getFlag(M, 'judgementT3Reminder');
      if (t3flag) {
        const { censorActorId, judgedTokenIds, censorUserId } = t3flag;
        if (game.user.id === censorUserId || game.user.isGM) {
          const t3Used = !!msg.getFlag(M, 'judgementT3Used');
          if (t3Used) {
            const status = document.createElement('div');
            status.className = 'dsct-undo-status';
            status.textContent = game.i18n.localize('DSCT.chat.tactical.judgementTauntedApplied');
            btnArea().appendChild(status);
          } else {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dsct-judgement-btn';
            btn.innerHTML = `<i class="fa-solid fa-flag"></i> ${game.i18n.localize('DSCT.button.judgementApplyTaunted')}`;
            btn.style.cssText = 'cursor:pointer;';
            btn.addEventListener('click', async (e) => {
              e.preventDefault();
              btn.disabled = true;
              const api = getModuleApi(false);
              const censorActor = game.actors.get(censorActorId);
              if (!censorActor) return;
              if ((censorActor.system.hero.primary.value ?? 0) < 1) {
                ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.notEnoughWrath'));
                btn.disabled = false;
                return;
              }
              await censorActor.update({ 'system.hero.primary.value': censorActor.system.hero.primary.value - 1 });
              const censorToken = canvas.tokens.placeables.find(t => t.actor?.id === censorActorId);
              for (const tokenId of judgedTokenIds) {
                const token = canvas.tokens.placeables.find(t => t.id === tokenId);
                if (token) await applyTaunted(token, censorActor, censorToken?.id ?? null, 'turnEnd');
              }
              if (msg.isOwner || game.user.isGM) {
                await msg.setFlag(M, 'judgementT3Used', true);
              } else if (api?.socket) {
                await api.socket.executeAsGM('dsct.updateDocument', msg.uuid, { [`flags.${M}.judgementT3Used`]: true });
              }
            });
            btnArea().appendChild(btn);
          }
        }
      }
    }

    if (getSetting('judgementAutomation')) {
      const t4flag = msg.getFlag(M, 'judgementPotencyReminder');
      if (t4flag) {
        const potencyUsed = !!msg.getFlag(M, 'judgementPotencyUsed');
        const triggerUsed = !!msg.getFlag(M, 'judgementTriggerUsed');
        if (potencyUsed) {
        } else if (triggerUsed) {
          const notice = document.createElement('div');
          notice.className = 'dsct-undo-status';
          notice.textContent = game.i18n.localize('DSCT.chat.tactical.judgementTriggerUsed');
          btnArea().appendChild(notice);
        } else {
          const { censorActorId, judgedActorId, judgedName, censorName } = t4flag;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dsct-judgement-btn';
          btn.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${game.i18n.localize('DSCT.button.judgementSpendWrath')}`;
          btn.style.cssText = 'cursor:pointer;';
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            const censorActor = censorActorId ? game.actors.get(censorActorId) : null;
            if (!censorActor) { ui.notifications.warn('Censor actor not found.'); return; }
            if ((censorActor.system.hero.primary.value ?? 0) < 1) {
              ui.notifications.warn(game.i18n.localize('DSCT.notice.tactical.notEnoughWrath'));
              btn.disabled = false;
              return;
            }
            await censorActor.update({ 'system.hero.primary.value': censorActor.system.hero.primary.value - 1 });
            await msg.update({ content: game.i18n.format('DSCT.chat.tactical.judgementPotencyUsed', { name: judgedName, censorName }) });
            await msg.setFlag(M, 'judgementPotencyUsed', true);
            if (judgedActorId) await flagJudgementTriggersUsed(judgedActorId);
          });
          btnArea().appendChild(btn);
        }
      }
    }
  });
};
