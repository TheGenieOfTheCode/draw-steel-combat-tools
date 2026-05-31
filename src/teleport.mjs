import {
  hasTags, GRID as getGRID, toGrid, toWorld, gridDist,
  tokenAt, tileAt, safeUpdate, replayUndo, getWallBlockTop,
  applyDamage, safeToggleStatusEffect, getSetting, canCurrentlyFly, applyFall, snapStamina,
  getTokenById, getWindowById, pickCanvasTarget, confirmFall,
} from './helpers.mjs';
import { endGrab, applyGrab } from './conditions/grab.mjs';
import { runSourcePicker } from './ability-automation/target-picker.mjs';


const chooseTeleportSquare = (sourceToken, maxDist) => new Promise((resolve) => {
  const GRID    = getGRID();
  const w       = sourceToken.document.width ?? 1;
  const h       = sourceToken.document.height ?? 1;
  const tg      = toGrid(sourceToken.document);
  const srcElev = sourceToken.document.elevation ?? 0;

  const checkArea = (startX, startY) => {
     let landedOnObject = null;

     
     for (const t of canvas.tokens.placeables) {
         if (t.id === sourceToken.id) continue;
         if (t.actor?.statuses?.has('dead')) continue; 

         const tGrid = toGrid(t.document);
         const tw = t.document.width ?? 1;
         const th = t.document.height ?? 1;
         
         if (startX < tGrid.x + tw && startX + w > tGrid.x && 
             startY < tGrid.y + th && startY + h > tGrid.y) {
             
             const typeStr1 = t.actor?.type?.toLowerCase() || '';
             const typeStr2 = t.actor?.system?.type?.value?.toLowerCase() || '';
             const typeStr3 = t.actor?.system?.type?.toLowerCase() || '';
             const typeStr4 = t.actor?.system?.creatureType?.toLowerCase() || '';
             const isObj = typeStr1 === 'object' || typeStr2 === 'object' || typeStr3 === 'object' || typeStr4 === 'object';
             
             if (isObj) {
                 landedOnObject = t; 
             } else {
                 return { free: false }; 
             }
         }
     }


     let landedOnWallTop = null;
     for (let ix = 0; ix < w; ix++) {
         for (let iy = 0; iy < h; iy++) {
             const cx = startX + ix;
             const cy = startY + iy;
             const tile = tileAt(cx, cy);

             if (tile && hasTags(tile, 'obstacle') && !hasTags(tile, 'broken')) {
                 const wallTop = getWallBlockTop(tile);
                 if (wallTop !== null) {
                     const surfaceElev = wallTop - 1;
                     if (surfaceElev > srcElev + maxDist) return { free: false };
                     if (landedOnWallTop === null || surfaceElev > landedOnWallTop) {
                         landedOnWallTop = surfaceElev;
                     }
                 } else {
                     return { free: false };
                 }
             }
         }
     }

     let targetElev = 0;
     let isOnTerrain = false;

     if (landedOnObject) {
         const objElev   = landedOnObject.document.elevation ?? 0;
         const bonusElev = Math.min(landedOnObject.document.width ?? 1, landedOnObject.document.height ?? 1);
         targetElev  = objElev + bonusElev;
         isOnTerrain = true;
     } else if (landedOnWallTop !== null) {
         targetElev  = landedOnWallTop;
         isOnTerrain = true;
     }

     const drop       = srcElev - targetElev;
     const willFall   = drop > maxDist;
     const arrivalElev = willFall ? srcElev - maxDist : targetElev;

     return { free: true, isOnTerrain, targetElev, willFall, arrivalElev };
  };

  const candidates = [];
  for (let dx = -maxDist; dx <= maxDist; dx++) {
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      if (dx === 0 && dy === 0) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist > maxDist) continue;
      const x = tg.x + dx;
      const y = tg.y + dy;
      const area = checkArea(x, y);
      if (area.free) {
        candidates.push({ x, y, isOnTerrain: area.isOnTerrain, targetElev: area.targetElev, willFall: area.willFall, arrivalElev: area.arrivalElev });
      }
    }
  }

  if (candidates.length === 0) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noValidDestinations'));
      resolve(null);
      return;
  }

  const graphics = new PIXI.Graphics();
  canvas.app.stage.addChild(graphics);

  const redraw = (hoverGrid) => {
    graphics.clear();

    const rangeCells  = new Map();
    for (const g of candidates) {
      for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < h; iy++) {
          const key = `${g.x + ix},${g.y + iy}`;
          if (!rangeCells.has(key)) rangeCells.set(key, g.isOnTerrain);
          else if (g.isOnTerrain) rangeCells.set(key, true);
        }
      }
    }

    for (const [key, onTerrain] of rangeCells) {
      const [cx, cy] = key.split(',').map(Number);
      graphics.beginFill(onTerrain ? 0x00d4ff : 0xaa33ff, 0.2);
      graphics.drawRect(cx * GRID, cy * GRID, GRID, GRID);
      graphics.endFill();
    }

    if (hoverGrid) {
      const color = hoverGrid.isOnTerrain ? 0x00d4ff : 0xaa33ff;
      graphics.beginFill(color, 0.5);
      graphics.drawRect(hoverGrid.x * GRID, hoverGrid.y * GRID, GRID * w, GRID * h);
      graphics.endFill();
    }
  };

  const overlay = new PIXI.Container();
  overlay.interactive = true;
  overlay.hitArea = new PIXI.Rectangle(0, 0, canvas.dimensions.width, canvas.dimensions.height);
  canvas.app.stage.addChild(overlay);
  let hoverGrid = null;

  const onMove = (e) => {
    const pos  = e.data.getLocalPosition(canvas.app.stage);
    const gpos = toGrid(pos);
    hoverGrid  = candidates.find(g => 
         gpos.x >= g.x && gpos.x < g.x + w && 
         gpos.y >= g.y && gpos.y < g.y + h
    ) ?? null;
    redraw(hoverGrid);
  };

  const onClick = (e) => {
    if (e.data.button === 2) { if (getSetting('cancelOnRightClick')) { cleanup(); resolve(null); } return; }
    const pos  = e.data.getLocalPosition(canvas.app.stage);
    const gpos = toGrid(pos);
    const chosen = candidates.find(g =>
         gpos.x >= g.x && gpos.x < g.x + w &&
         gpos.y >= g.y && gpos.y < g.y + h
    );
    if (!chosen) return;
    cleanup();
    resolve(chosen);
  };

  const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
  const onContextMenu = (e) => { e.preventDefault(); };

  let tpNotif = null;
  const cleanup = () => {
    overlay.off('pointermove', onMove);
    overlay.off('pointerdown', onClick);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('contextmenu', onContextMenu);
    canvas.app.stage.removeChild(overlay);
    canvas.app.stage.removeChild(graphics);
    graphics.destroy();
    overlay.destroy();
    if (tpNotif) { ui.notifications.remove(tpNotif); tpNotif = null; }
  };

  overlay.on('pointermove', onMove);
  overlay.on('pointerdown', onClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('contextmenu', onContextMenu);
  redraw(null);
  tpNotif = ui.notifications.info(game.i18n.format('DSCT.notice.tp.chooseDestination', { name: sourceToken.name }), { permanent: true });
});

const executeTeleport = async (token, distance, animate, colorHex, animDuration = 600) => {
   const chosenGrid = await chooseTeleportSquare(token, distance);
   if (!chosenGrid) return; 

   const origWorld = { x: token.document.x, y: token.document.y, elevation: token.document.elevation ?? 0 };
   const origAlpha = token.document.alpha;
   const origTint  = token.document.texture.tint || null;
   
   
   const destElev = chosenGrid.targetElev !== null ? chosenGrid.targetElev : 0;
   const targetWorld = { ...toWorld(chosenGrid), elevation: destElev };
   const actualDist = gridDist(toGrid(origWorld), chosenGrid);

   const actor = token.actor;
   const removedGrabs    = [];
   const removedStatuses = [];

   if (actor) {
     if (window._activeGrabs) {
       for (const [grabbedId, grab] of [...window._activeGrabs.entries()]) {
         if (grabbedId === token.id || grab.grabberTokenId === token.id) {
           removedGrabs.push({ grabberTokenId: grab.grabberTokenId, grabbedTokenId: grab.grabbedTokenId });
           await endGrab(grabbedId, { silent: false });
         }
       }
     }
     for (const status of ['grabbed', 'restrained', 'prone']) {
       if (actor.statuses?.has(status)) {
         removedStatuses.push(status);
         await safeToggleStatusEffect(actor, status, { active: false });
       }
     }
   }

   if (animate) {
       await safeUpdate(token.document, { alpha: 0.2, 'texture.tint': colorHex }, { animation: { duration: animDuration } });
       await new Promise(r => setTimeout(r, animDuration));
   }

   const staminaSnap = (chosenGrid.willFall && actor) ? snapStamina(actor) : null;

   const arrivalElev = chosenGrid.willFall ? chosenGrid.arrivalElev : targetWorld.elevation;
   await safeUpdate(token.document, { x: targetWorld.x, y: targetWorld.y, elevation: arrivalElev }, { isUndo: true });

   let fallDmg = 0, fallDist = 0, effectiveFall = 0, fallCancelled = false;
   if (chosenGrid.willFall) {
     let doFall = true;
     if (getSetting('fallConfirmation')) {
       const agility    = actor?.system?.characteristics?.agility?.value ?? 0;
       const pFallDist  = arrivalElev - (chosenGrid.targetElev ?? 0);
       const pEffective = Math.max(0, pFallDist - agility);
       const pDmg       = (canCurrentlyFly(actor) || pEffective < 2) ? 0 : Math.min(pEffective * 2, getSetting('fallDamageCap'));
       doFall = await confirmFall(token, pFallDist, pEffective, pDmg);
     }
     if (doFall) {
       ({ dmg: fallDmg, fallDist, effectiveFall } = await applyFall(token, targetWorld.elevation, { skipConfirm: true }));
     } else {
       fallCancelled = true;
     }
   }

   if (animate) {
       await safeUpdate(token.document, { alpha: origAlpha, 'texture.tint': origTint }, { animation: { duration: animDuration } });
       await new Promise(r => setTimeout(r, animDuration));
   }

   const oldMoveId = token.document.getFlag('draw-steel-combat-tools', 'lastTpMoveId');
   if (oldMoveId) {
     const oldMsg = game.messages.contents.find(m => m.getFlag('draw-steel-combat-tools', 'moveId') === oldMoveId);
     if (oldMsg) await safeUpdate(oldMsg, { 'flags.draw-steel-combat-tools.isExpired': true });
   }

   const moveId = foundry.utils.randomID();
   await safeUpdate(token.document, { 'flags.draw-steel-combat-tools.lastTpMoveId': moveId });

   const undoLog = [];

   if (staminaSnap) {
     undoLog.push({
       op: 'stamina', uuid: actor.uuid,
       prevTemp: staminaSnap.prevTemp, prevValue: staminaSnap.prevValue,
       squadGroupUuid: staminaSnap.squadGroup?.uuid ?? null,
       prevSquadHP: staminaSnap.prevSquadHP,
     });
   }

   undoLog.push({
     op: 'update', uuid: token.document.uuid,
     data: { x: origWorld.x, y: origWorld.y, elevation: origWorld.elevation, alpha: origAlpha, 'texture.tint': origTint },
     options: { isUndo: true }
   });

   const grabbedTokenIds = new Set(removedGrabs.map(g => g.grabbedTokenId));
   for (const status of removedStatuses) {
     if (status === 'grabbed' && grabbedTokenIds.has(token.id)) continue;
     undoLog.push({ op: 'status', uuid: actor.uuid, effectId: status, active: true });
   }

   const elevNote = chosenGrid.isOnTerrain ? ` (Elevation ${destElev})` : (destElev === 0 && origWorld.elevation !== 0 ? ` (Returned to Ground)` : '');
   let fallNote = '';
   if (chosenGrid.willFall && !fallCancelled) {
     const effectivePart = effectiveFall !== fallDist ? ` (${effectiveFall} effective after Agility)` : '';
     fallNote = fallDmg > 0
       ? ` Falls ${fallDist} square${fallDist !== 1 ? 's' : ''}${effectivePart}, taking <strong>${fallDmg}</strong> damage.`
       : ` Falls ${fallDist} square${fallDist !== 1 ? 's' : ''}${effectivePart} - not enough to deal damage.`;
   }

   await ChatMessage.create({
       content: game.i18n.format('DSCT.chat.tp.teleported', { name: token.name, dist: actualDist, s: actualDist !== 1 ? 's' : '' }) + `${elevNote}.${fallNote}`,
       flags: {
           'draw-steel-combat-tools': {
               isTpUndo: true, isUndone: false, undoLog, moveId,
               targetTokenId: token.id, targetSceneId: canvas.scene.id, finalPos: targetWorld,
               grabsToRestore: removedGrabs,
           }
       }
   });
};

export async function runTeleport(macroArgs = []) {
  if (typeof macroArgs === 'object' && !Array.isArray(macroArgs) && Object.keys(macroArgs).length > 0) {
    const { distance, sourceId, animate = true, colorHex = "#a030ff", duration = 600 } = macroArgs;
    const source = (sourceId ? getTokenById(sourceId) : null) ?? (canvas.tokens.controlled.length === 1 ? canvas.tokens.controlled[0] : null);
    if (!source) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.sourceNotFound')); return; }
    await executeTeleport(source, distance || 5, animate, colorHex, duration);
  } else {
    toggleTeleportPanel();
  }
}


export class TeleportPanel extends ds.applications.api.DSApplication {
  constructor() {
    super();
    this._sourceToken  = null;
    this._pinnedSource = null;
    this._targetToken  = null;
    this._shiftHeld    = false;
    this._updatePreview();
  }

  static DEFAULT_OPTIONS = {
    id: 'dsct-tp-panel',
    classes: ['draw-steel'],
    window: { title: 'DSCT.panel.title.Teleport', minimizable: false, resizable: true },
    position: { width: 264, height: 'auto' },
    actions: {
      'execute-tp': TeleportPanel._onExecuteTp,
    },
  };

  static PARTS = {
    form: { template: 'modules/draw-steel-combat-tools/templates/panels/teleport.hbs' },
  };

  _updatePreview() {
    const controlled = canvas.tokens.controlled;
    if (controlled.length === 1) {
      this._sourceToken  = controlled[0];
      this._pinnedSource = null;
    } else if (this._pinnedSource) {
      this._sourceToken = canvas.tokens.placeables.find(t => t.id === this._pinnedSource.id) ?? null;
      if (!this._sourceToken) this._pinnedSource = null;
    } else {
      this._sourceToken = null;
    }
    const targets = [...game.user.targets];
    this._targetToken = targets.length === 1 ? targets[0] : null;
  }

  _refreshPanel() {
    if (!this.rendered) return;
    this._updatePreview();

    const token   = (this._shiftHeld && this._targetToken) ? this._targetToken : this._sourceToken;
    const noLabel = this._shiftHeld ? game.i18n.localize('DSCT.panel.tp.noTarget') : 'Select exactly 1 token';
    const img  = this.element.querySelector('#tp-source-img');
    const name = this.element.querySelector('#tp-source-name');
    if (img)  img.src = token?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    if (name) { name.textContent = token?.name ?? noLabel; name.classList.toggle('dim', !token); }
  }

  async _prepareContext(_options) {
    this._updatePreview();
    const sourceSrc   = this._sourceToken?.document.texture.src ?? 'icons/svg/mystery-man.svg';
    const sourceLabel = this._sourceToken?.name ?? 'Select exactly 1 token';
    const saved = game.user.getFlag('draw-steel-combat-tools', 'tpSettings') ?? { dist: 5, anim: true, color: '#a030ff', duration: 600 };
    return {
      sourceSrc,
      sourceLabel,
      sourceSelected: !!this._sourceToken,
      dist: saved.dist,
      anim: saved.anim,
      color: saved.color,
      duration: saved.duration,
    };
  }

  async _saveSettings() {
    const dist     = parseInt(this.element.querySelector('#tp-dist')?.value) || 5;
    const anim     = this.element.querySelector('#tp-anim')?.checked;
    const color    = this.element.querySelector('#tp-color')?.value || '#a030ff';
    const duration = parseInt(this.element.querySelector('#tp-duration')?.value) || 600;
    await game.user.setFlag('draw-steel-combat-tools', 'tpSettings', { dist, anim, color, duration });
  }

  static async _onExecuteTp(event) {
    if (event?.shiftKey && !this._targetToken) {
      ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noShiftTarget'));
      return;
    }

    let token;
    if (event?.shiftKey) {
      token = this._targetToken;
    } else {
      if (!this._sourceToken) {
        if (!getSetting('abilityAutomationEnabled')) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.mustSelectOne')); return; }
        const picked = await runSourcePicker();
        if (!picked) return;
        this._pinnedSource = picked;
        this._sourceToken  = picked;
        this._refreshPanel();
      }
      token = this._sourceToken;
    }

    const dist     = parseInt(this.element.querySelector('#tp-dist')?.value) || 5;
    const animate  = this.element.querySelector('#tp-anim')?.checked;
    const color    = this.element.querySelector('#tp-color')?.value || '#a030ff';
    const duration = parseInt(this.element.querySelector('#tp-duration')?.value) || 600;
    await this._saveSettings();
    await executeTeleport(token, dist, animate, color, duration);
  }

  _onRender(_context, _options) {
    if (typeof ColorPicker !== 'undefined') ColorPicker.install();
    setTimeout(() => this.setPosition({ height: 'auto' }), 0);

    if (this._hookControl) Hooks.off('controlToken', this._hookControl);
    this._hookControl = Hooks.on('controlToken', () => this._refreshPanel());

    if (this._hookTarget) Hooks.off('targetToken', this._hookTarget);
    this._hookTarget = Hooks.on('targetToken', () => this._refreshPanel());

    this._themeObserver = new MutationObserver(() => this._refreshPanel());
    this._themeObserver.observe(document.body, { attributeFilter: ['class'] });

    this._onShiftDown = (e) => {
      if (!e.shiftKey || this._shiftHeld) return;
      this._shiftHeld = true;
      this._refreshPanel();
    };
    this._onShiftUp = (e) => {
      if (e.shiftKey || !this._shiftHeld) return;
      this._shiftHeld = false;
      this._refreshPanel();
    };
    document.addEventListener('keydown', this._onShiftDown);
    document.addEventListener('keyup',   this._onShiftUp);

    const animCheck = this.element.querySelector('#tp-anim');
    const animOpts  = this.element.querySelector('#tp-anim-options');

    animCheck?.addEventListener('change', () => {
      animOpts.classList.toggle('disabled', !animCheck.checked);
      animOpts.querySelectorAll('input').forEach(el => el.disabled = !animCheck.checked);
      this._saveSettings();
    });

    this.element.querySelectorAll('input').forEach(el => el.addEventListener('change', () => this._saveSettings()));
  }

  async close(options = {}) {
    if (this._hookControl)   Hooks.off('controlToken', this._hookControl);
    if (this._hookTarget)    Hooks.off('targetToken',  this._hookTarget);
    if (this._themeObserver) this._themeObserver.disconnect();
    if (this._onShiftDown)   document.removeEventListener('keydown', this._onShiftDown);
    if (this._onShiftUp)     document.removeEventListener('keyup',   this._onShiftUp);
    return super.close(options);
  }
}

export const toggleTeleportPanel = () => {
  const existing = getWindowById('dsct-tp-panel');
  if (existing) {
    existing.close();
  } else {
    new TeleportPanel().render({ force: true });
  }
};


const burstCells = (tok, radius) => {
  const tg = toGrid(tok.document);
  const w  = tok.document.width  ?? 1;
  const h  = tok.document.height ?? 1;
  const cells = new Set();
  for (let dx = -radius; dx < w + radius; dx++)
    for (let dy = -radius; dy < h + radius; dy++)
      cells.add(`${tg.x + dx},${tg.y + dy}`);
  return cells;
};

const tokensInBurst = (sourceToken, radius, filter = 'all', excludeSource = false) => {
  const burst = burstCells(sourceToken, radius);
  return canvas.tokens.placeables.filter(t => {
    if (t.actor?.statuses?.has('dead') || t.hidden) return false;
    if (excludeSource && t.id === sourceToken.id) return false;
    if (filter === 'hero' && t.actor?.type !== 'hero') return false;
    if (filter === 'npc'  && t.actor?.type !== 'npc')  return false;
    const tg = toGrid(t.document);
    const w  = t.document.width  ?? 1;
    const h  = t.document.height ?? 1;
    for (let ix = 0; ix < w; ix++)
      for (let iy = 0; iy < h; iy++)
        if (burst.has(`${tg.x + ix},${tg.y + iy}`)) return true;
    return false;
  });
};

const pickBurstToken = (sourceToken, radius, eligible) => {
  const GRID  = getGRID();
  const burst = burstCells(sourceToken, radius);

  return pickCanvasTarget({
    hint: `Click the token to teleport next (${eligible.length} remaining). Right-Click to finish.`,
    hitTest: (pos) => {
      const gpos = toGrid(pos);
      return eligible.find(t => {
        const tg = toGrid(t.document);
        const tw = t.document.width  ?? 1;
        const th = t.document.height ?? 1;
        return gpos.x >= tg.x && gpos.x < tg.x + tw && gpos.y >= tg.y && gpos.y < tg.y + th;
      }) ?? null;
    },
    draw: (gfx, hover) => {
      for (const cell of burst) {
        const [cx, cy] = cell.split(',').map(Number);
        gfx.beginFill(0x8844ff, 0.12);
        gfx.lineStyle(0);
        gfx.drawRect(cx * GRID, cy * GRID, GRID, GRID);
        gfx.endFill();
      }
      for (const t of eligible) {
        const tg = toGrid(t.document);
        const tw = t.document.width  ?? 1;
        const th = t.document.height ?? 1;
        const isHover = t === hover;
        gfx.lineStyle(isHover ? 3 : 2, isHover ? 0xffffff : 0x8844ff, 1);
        gfx.beginFill(0x8844ff, isHover ? 0.35 : 0.1);
        gfx.drawRect(tg.x * GRID, tg.y * GRID, tw * GRID, th * GRID);
        gfx.endFill();
      }
    },
  });
};

const pickBurstDestination = (sourceToken, radius, movingToken, claimed) => {
  const GRID  = getGRID();
  const burst = burstCells(sourceToken, radius);
  const w     = movingToken.document.width  ?? 1;
  const h     = movingToken.document.height ?? 1;

  const candidates = [];
  outer: for (const cell of burst) {
    const [cx, cy] = cell.split(',').map(Number);
    for (let ix = 0; ix < w; ix++) {
      for (let iy = 0; iy < h; iy++) {
        const key = `${cx + ix},${cy + iy}`;
        if (!burst.has(key) || claimed.has(key)) continue outer;
        for (const t of canvas.tokens.placeables) {
          if (t.id === movingToken.id) continue;
          if (t.actor?.statuses?.has('dead')) continue;
          const tg = toGrid(t.document);
          const tw = t.document.width  ?? 1;
          const th = t.document.height ?? 1;
          if (cx + ix >= tg.x && cx + ix < tg.x + tw &&
              cy + iy >= tg.y && cy + iy < tg.y + th) continue outer;
        }
      }
    }
    candidates.push({ x: cx, y: cy });
  }

  if (!candidates.length) {
    ui.notifications.warn(game.i18n.format('DSCT.notice.tp.noValidBurst', { name: movingToken.name }));
    return Promise.resolve(null);
  }

  return pickCanvasTarget({
    hint: `Choose where ${movingToken.name} teleports within the burst. Right-Click to skip.`,
    hitTest: (pos) => {
      const gpos = toGrid(pos);
      return candidates.find(c =>
        gpos.x >= c.x && gpos.x < c.x + w && gpos.y >= c.y && gpos.y < c.y + h
      ) ?? null;
    },
    draw: (gfx, hover) => {
      for (const c of candidates) {
        const isHover = c === hover;
        gfx.lineStyle(isHover ? 2 : 0, 0xffffff, 1);
        gfx.beginFill(0x8844ff, isHover ? 0.55 : 0.25);
        gfx.drawRect(c.x * GRID, c.y * GRID, GRID * w, GRID * h);
        gfx.endFill();
      }
    },
  });
};

export const runBurstTeleport = async ({ sourceId, radius = 2, filter = 'all', excludeSource = false } = {}) => {
  const source = (sourceId ? getTokenById(sourceId) : null)
              ?? (canvas.tokens.controlled.length === 1 ? canvas.tokens.controlled[0] : null);
  if (!source) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noBurstSource')); return; }

  const remaining = tokensInBurst(source, radius, filter, excludeSource);
  if (!remaining.length) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noBurstTargets')); return; }

  const claimed = new Set(); 

  while (remaining.length > 0) {
    const moving = remaining.length === 1
      ? remaining[0]
      : await pickBurstToken(source, radius, remaining);

    if (!moving) break; 

    remaining.splice(remaining.indexOf(moving), 1);

    const dest = await pickBurstDestination(source, radius, moving, claimed);
    if (dest === null) continue; 

    for (let ix = 0; ix < (moving.document.width  ?? 1); ix++)
      for (let iy = 0; iy < (moving.document.height ?? 1); iy++)
        claimed.add(`${dest.x + ix},${dest.y + iy}`);

    const destWorld = toWorld(dest);
    await safeUpdate(moving.document, { x: destWorld.x, y: destWorld.y }, { isUndo: true });

    if (getSetting('debugMode')) console.log(`DSCT | BurstTeleport | Moved ${moving.name} to grid (${dest.x},${dest.y})`);
  }
};

export const registerTeleportHooks = () => {
  const safeEval = (expr) => {
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return NaN;
    try { return Function('"use strict"; return (' + expr + ')')(); } catch { return NaN; }
  };

  const resolveLabel = (tmpl, spent) => {
    const s = tmpl.replace(/@spend/gi, String(spent));
    return s.replace(/\d+(?:\s*[+\-*/]\s*(?:\([^)]*\)|\d+))+/g, sub => {
      const val = safeEval(sub);
      return Number.isFinite(val) ? String(Math.round(val)) : sub;
    });
  };

  CONFIG.TextEditor.enrichers.push({
    id:      'dsct.teleport',
    pattern: /\[\[\/teleport(?<args>[^\]]*?)?\]\](?:\{(?<label>[^}]+)\})?/gi,
    onRender: (element) => {
      const a = element.querySelector('a.roll-link');
      if (!a) return;

      if (a.dataset.formula || a.dataset.labelTemplate) {
        const msgEl = element.closest('[data-message-id]');
        const msg   = msgEl ? game.messages.get(msgEl.dataset.messageId) : null;
        const m     = msg?.flavor?.match(/^Spent (\d+)/i);
        const spent = m ? parseInt(m[1]) : 0;
        const base  = parseInt(a.dataset.dist);
        if (a.dataset.formula) {
          const val = safeEval(a.dataset.formula.replace(/@spend/gi, String(spent)));
          if (Number.isFinite(val)) a.dataset.dist = String(Math.round(val));
        }
        const total = parseInt(a.dataset.dist);
        if (a.dataset.labelTemplate) {
          a.innerHTML = `<i class="fa-solid fa-person-through-window"></i> ${resolveLabel(a.dataset.labelTemplate, spent)}`;
        } else if (total !== base) {
          const name = a.dataset.fixedName ?? null;
          a.innerHTML = `<i class="fa-solid fa-person-through-window"></i> Teleport ${name ? `${name} ` : ''}${total} square${total !== 1 ? 's' : ''}`;
        }
      }

      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const saved  = game.user.getFlag('draw-steel-combat-tools', 'tpSettings') ?? { dist: 5, anim: true, color: '#a030ff', duration: 600 };
        const fDist  = parseInt(a.dataset.dist)     || saved.dist;
        const fAnim  = a.dataset.animate  !== undefined ? a.dataset.animate === 'true' : (saved.anim     ?? true);
        const fColor = a.dataset.color    ?? saved.color   ?? '#a030ff';
        const fDur   = a.dataset.duration !== undefined ? (parseInt(a.dataset.duration) || 600) : (saved.duration ?? 600);
        const fSrcId = a.dataset.sourceId;

        let token;
        if (fSrcId) {
          if (fSrcId.startsWith('Actor.')) {
            const actor = game.actors.get(fSrcId.replace('Actor.', ''));
            token = actor?.getActiveTokens()?.[0] ?? null;
          } else {
            token = getTokenById(fSrcId);
          }
          if (!token) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.sourceNotFound')); return; }
        } else if (e.shiftKey) {
          const targets = [...game.user.targets];
          if (targets.length !== 1) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.noShiftTarget')); return; }
          token = targets[0];
        } else {
          const controlled = canvas.tokens.controlled;
          if (controlled.length !== 1) { ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.mustSelectOne')); return; }
          token = controlled[0];
        }

        await executeTeleport(token, fDist, fAnim, fColor, fDur);
      });
    },
    enricher: async (match, options) => {
      const raw = (match.groups?.args ?? '').trim().split(/\s+/).filter(Boolean);

      const CHAR_MAP = { '@r': 'reason', '@m': 'might', '@a': 'agility', '@i': 'intuition', '@p': 'presence', '@v': 'vitality' };
      let dist = null, animate = undefined, colorHex = undefined, duration = undefined, sourceId = undefined;
      let distFormula = null;

      for (const val of raw) {
        if (/@/.test(val)) { distFormula = val; continue; }
        if (val === 'true' || val === 'false') { animate = val === 'true'; continue; }
        if (val.startsWith('#'))               { colorHex = val;           continue; }
        const num = parseInt(val);
        if (!isNaN(num)) { if (dist === null) { dist = num; } else { duration = num; } continue; }
        sourceId = val;
      }

      const actor = options?.relativeTo?.actor ?? null;
      let resolvedFormula = null;
      if (distFormula) {
        resolvedFormula = distFormula.replace(/@([rmaiPv])/gi, (_, ch) => {
          const key     = CHAR_MAP['@' + ch.toLowerCase()];
          const charVal = key ? (actor?.system?.characteristics?.[key]?.value ?? null) : null;
          return charVal != null ? String(charVal) : `@${ch}`;
        });
        const evaluated = safeEval(resolvedFormula.replace(/@spend/gi, '0'));
        if (Number.isFinite(evaluated)) dist = Math.round(evaluated);
      }

      if (!dist) {
        const span = document.createElement('span');
        span.textContent = match[0];
        return span;
      }

      let fixedName = null;
      if (sourceId) {
        if (sourceId.startsWith('Actor.')) {
          fixedName = game.actors.get(sourceId.replace('Actor.', ''))?.name ?? null;
        } else {
          fixedName = canvas.scene?.tokens.get(sourceId)?.name ?? null;
        }
      }

      const a = document.createElement('a');
      a.className = 'roll-link';
      a.dataset.dist = dist;
      if (animate  !== undefined) a.dataset.animate   = String(animate);
      if (colorHex !== undefined) a.dataset.color     = colorHex;
      if (duration !== undefined) a.dataset.duration  = duration;
      if (sourceId !== undefined) a.dataset.sourceId  = sourceId;
      if (fixedName)              a.dataset.fixedName = fixedName;
      if (resolvedFormula && /@spend/i.test(resolvedFormula)) a.dataset.formula = resolvedFormula;

      const customLabel = match.groups?.label?.trim() ?? null;
      let labelTemplate = null;
      if (customLabel) {
        labelTemplate = customLabel.replace(/@([rmaiPv])/gi, (_, ch) => {
          const key = CHAR_MAP['@' + ch.toLowerCase()];
          const val = key ? (actor?.system?.characteristics?.[key]?.value ?? null) : null;
          return val != null ? String(val) : `@${ch}`;
        });
        a.dataset.labelTemplate = labelTemplate;
      }
      const displayLabel = labelTemplate != null ? resolveLabel(labelTemplate, 0) : null;
      a.innerHTML = `<i class="fa-solid fa-person-through-window"></i> ${displayLabel ?? `Teleport ${fixedName ? `${fixedName} ` : ''}${dist} square${dist !== 1 ? 's' : ''}`}`;
      if (!fixedName) a.title = game.i18n.localize('DSCT.panel.tp.enricherHint');

      return a;
    },
  });

  Hooks.on('renderChatMessageHTML', (msg, el) => {
    if (!msg.getFlag('draw-steel-combat-tools', 'isTpUndo')) return;

    const isUndone   = msg.getFlag('draw-steel-combat-tools', 'isUndone');
    const moveId     = msg.getFlag('draw-steel-combat-tools', 'moveId');
    const targetId   = msg.getFlag('draw-steel-combat-tools', 'targetTokenId');
    const sceneId    = msg.getFlag('draw-steel-combat-tools', 'targetSceneId');
    const finalPos   = msg.getFlag('draw-steel-combat-tools', 'finalPos');

    let isExpired = getSetting('undoExpirationCheck') ? (msg.getFlag('draw-steel-combat-tools', 'isExpired') ?? false) : false;

    if (!isExpired && getSetting('undoExpirationCheck')) {
      if (canvas.scene?.id === sceneId) {
        const token = canvas.scene.tokens.get(targetId);
        if (token) {
          const lastMoveId = token.getFlag('draw-steel-combat-tools', 'lastTpMoveId');
          if (lastMoveId && lastMoveId !== moveId) {
            isExpired = true;
          } else if (finalPos) {
            const isDead = token.actor?.statuses?.has('dead') || token.hidden;
            if (!isDead && (token.x !== finalPos.x || token.y !== finalPos.y || (token.elevation ?? 0) !== finalPos.elevation)) {
              isExpired = true;
            }
          }
        } else {
          isExpired = true;
        }
      } else {
        isExpired = true;
      }
    }

    let btnArea = el.querySelector('.message-part-buttons');
    if (!btnArea) {
      btnArea = document.createElement('div');
      btnArea.className = 'message-part-buttons';
      (el.querySelector('.message-content') ?? el).appendChild(btnArea);
    }

    if (isUndone) {
      const div = document.createElement('div');
      div.className = 'dsct-undo-status';
      div.textContent = '(Teleport Undone)';
      btnArea.appendChild(div);
    } else if (isExpired) {
      const div = document.createElement('div');
      div.className = 'dsct-undo-status';
      div.textContent = '(Undo Expired)';
      btnArea.appendChild(div);
    } else if (game.user.isGM || msg.isAuthor) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsct-undo-tp';
      btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Undo Teleport';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const token = canvas.scene.tokens.get(targetId);
        if (token && finalPos) {
          const isDead = token.actor?.statuses?.has('dead') || token.hidden;
          const lastMoveId = token.getFlag('draw-steel-combat-tools', 'lastTpMoveId');
          if (getSetting('undoExpirationCheck') && ((lastMoveId && lastMoveId !== moveId) || (!isDead && (token.x !== finalPos.x || token.y !== finalPos.y || (token.elevation ?? 0) !== finalPos.elevation)))) {
            ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.undoExpiredMoved'));
            await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isExpired': true });
            return;
          }
        } else if (!token && getSetting('undoExpirationCheck')) {
          ui.notifications.warn(game.i18n.localize('DSCT.notice.tp.undoExpiredGone'));
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isExpired': true });
          return;
        }
        const undoLog = msg.getFlag('draw-steel-combat-tools', 'undoLog');
        if (undoLog) {
          await safeUpdate(msg, { 'flags.draw-steel-combat-tools.isUndone': true });
          await replayUndo(undoLog);
          const grabsToRestore = msg.getFlag('draw-steel-combat-tools', 'grabsToRestore') ?? [];
          for (const { grabberTokenId, grabbedTokenId } of grabsToRestore) {
            const grabberTok = getTokenById(grabberTokenId);
            const grabbedTok = getTokenById(grabbedTokenId);
            if (grabberTok && grabbedTok) await applyGrab(grabberTok, grabbedTok);
          }
          ui.notifications.info(game.i18n.localize('DSCT.notice.tp.teleportReversed'));
        }
      });
      btnArea.appendChild(btn);
    }
  });
};