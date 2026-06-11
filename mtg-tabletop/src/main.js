// App orchestration: lobby → world boot → game loop.

import * as THREE from 'three';
import { createRenderer, createScene, buildTable, TABLE_Y } from './scene/world.js';
import { CardTable, updateTweens, cardFaceTexture } from './scene/cards3d.js';
import { HandFan } from './scene/hand.js';
import { makeAvatar, AVATAR_PRESETS } from './scene/avatar.js';
import { Effects, sfx } from './scene/effects.js';
import { SeatRig, WeaponRig, Controls } from './controls/modes.js';
import { EnvironmentManager, ENVIRONMENTS } from './scene/environments.js';
import { NetClient } from './net/client.js';
import { MediaMesh } from './net/media.js';
import { Hud } from './ui/hud.js';
import { CARDS, DECKS, registerCards } from '../shared/cards.js';

const $ = (s) => document.querySelector(s);

// ===================================================================== lobby

const net = new NetClient();
const media = new MediaMesh(net);

let myRole = null;     // 'player' | 'spectator'
let mySeat = -1;
let roomInfo = null;
let selectedAvatar = 0;

function setupLobby() {
  const picks = $('#avatarPicks');
  AVATAR_PRESETS.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'avatar-pick' + (i === 0 ? ' sel' : '');
    d.textContent = p.emoji;
    d.title = p.name;
    d.onclick = () => {
      selectedAvatar = i;
      picks.querySelectorAll('.avatar-pick').forEach((el, j) => el.classList.toggle('sel', j === i));
      if (roomInfo) net.setProfile({ avatar: i });
    };
    picks.appendChild(d);
  });
  const deckSel = $('#inDeck');
  for (const [id, d] of Object.entries(DECKS)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = d.name;
    deckSel.appendChild(o);
  }

  const err = (m) => { $('#lobbyError').textContent = m; $('#lobbyError2').textContent = m; };
  const profile = () => ({
    name: $('#inName').value.trim() || 'Planeswalker',
    avatar: selectedAvatar,
    deck: deckSel.value,
  });

  $('#btnHost').onclick = async () => {
    try { await net.ready; } catch (e) { return err(e.message); }
    net.host({ ...profile(), maxSeats: +$('#inSeats').value });
  };
  $('#btnJoin').onclick = async () => {
    try { await net.ready; } catch (e) { return err(e.message); }
    const code = $('#inCode').value.trim().toUpperCase();
    if (code.length !== 4) return err('Enter the 4-letter room code');
    net.join({ ...profile(), code });
  };
  $('#btnSpectate').onclick = async () => {
    try { await net.ready; } catch (e) { return err(e.message); }
    const code = $('#inCode').value.trim().toUpperCase();
    if (code.length !== 4) return err('Enter the 4-letter room code');
    net.spectate({ name: profile().name, code });
  };
  $('#btnStart').onclick = () => net.start();
  $('#btnAddBot').onclick = () => net.addBot();
  $('#btnImportDeck').onclick = () => {
    const list = $('#inDecklist').value.trim();
    if (!list) return;
    $('#importStatus').textContent = 'Resolving via Scryfall…';
    net.importDeck(list);
  };
  net.on('deckImported', (m) => {
    if (m.ok) {
      $('#importStatus').textContent = `✓ Imported ${m.count} cards` + (m.sideboard ? ` + ${m.sideboard} sideboard` : '');
      $('#importStatus').style.color = 'var(--teal)';
    } else {
      $('#importStatus').textContent = m.errors.join(' · ');
      $('#importStatus').style.color = 'var(--red)';
    }
  });

  net.on('error', (m) => err(m.error));
  net.on('joined', (m) => {
    myRole = m.role;
    mySeat = m.role === 'player' ? m.seat : -1;
    roomInfo = m.room;
    if (m.cardDefs) registerCards(m.cardDefs);
    $('#lobbyHome').classList.add('hidden');
    $('#lobbyRoom').classList.remove('hidden');
    renderRoom();
    if (m.room.started && myRole === 'spectator') enterWorld();
  });
  net.on('room', (m) => {
    roomInfo = m.room;
    const me = roomInfo.players.find(p => p.id === net.id);
    if (me) mySeat = me.seat;
    renderRoom();
    if (world) world.syncRoom();
    media.syncPeers(allPeerIds());
  });
  net.on('gameStarted', (m) => {
    roomInfo = m.room;
    if (m.cardDefs) registerCards(m.cardDefs);
    const me = roomInfo.players.find(p => p.id === net.id);
    if (me) mySeat = me.seat;
    enterWorld();
  });
  net.on('disconnected', () => hud?.toast('Disconnected from server'));
}

function allPeerIds() {
  if (!roomInfo) return [];
  return [
    ...roomInfo.players.filter(p => !p.isBot).map(p => p.id),
    ...roomInfo.spectators.map(s => s.id),
  ];
}

function renderRoom() {
  $('#roomCode').textContent = roomInfo.code;
  $('#roomMeta').textContent =
    `${roomInfo.players.length}/${roomInfo.maxSeats} seats · table scales to player count · spectators: ${roomInfo.spectators.length}`;
  const list = $('#seatList');
  list.innerHTML = '';
  roomInfo.players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'seat-row';
    row.innerHTML = `<span>${AVATAR_PRESETS[p.avatar % AVATAR_PRESETS.length].emoji} ${escapeHtml(p.name)}` +
      `${p.isHost ? '<span class="tag">host</span>' : ''}${p.isBot ? '<span class="tag">bot</span>' : ''}</span>` +
      `<span style="color:var(--muted)">${escapeHtml(p.deckLabel ?? DECKS[p.deck]?.name ?? '')}</span>`;
    list.appendChild(row);
  });
  const meHost = roomInfo.players.find(p => p.id === net.id && p.isHost);
  $('#btnStart').classList.toggle('hidden', !meHost);
  $('#btnAddBot').classList.toggle('hidden', !meHost || roomInfo.started);
  $('#btnStart').disabled = roomInfo.players.length < 2;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ===================================================================== world

let world = null;
let hud = null;
let view = null;

const ui = {
  mode: 'idle',            // idle | targeting | attack | block | discard
  targeting: null,         // {instId, cardName, specs, chosen[]}
  attack: { set: new Set(), defender: null },
  block: { selected: null, map: {} },
  discardSel: new Set(),
  fullControl: false,
  lastAutoPassKey: '',
};

function enterWorld() {
  $('#lobby').classList.add('hidden');
  hud = new Hud();
  hud.show();
  if (myRole === 'spectator') {
    $('#modeHint').innerHTML = '<b>WASD</b> fly · <b>Space/C</b> up/down · <b>Click</b> to capture mouse · <b>Esc</b> release';
  }

  const renderer = createRenderer($('#app'));
  const scene = createScene(renderer);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 60);
  scene.add(camera);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const nSeats = roomInfo.players.length;
  const table = buildTable(scene, nSeats);
  const effects = new Effects(scene, table);
  const cardTable = new CardTable(scene, table, mySeat);
  cardTable.camera = camera;

  // switchable environment around the table (synced for everyone)
  const envMgr = new EnvironmentManager(scene, table.radius);
  envMgr.set(roomInfo.environment || 'tavern');
  setupEnvMenu(envMgr);

  // avatars (own avatar exists for others/spectators, hidden locally)
  const avatarsBySeat = new Map();
  const avatarsById = new Map();
  function syncRoom() {
    for (const p of roomInfo.players) {
      if (!avatarsBySeat.has(p.seat)) {
        const av = makeAvatar(table.seats[p.seat], p.name, p.avatar ?? 0);
        scene.add(av.group);
        avatarsBySeat.set(p.seat, av);
        avatarsById.set(p.id, av);
        if (p.seat === mySeat) av.group.visible = false;
      }
    }
    effects.avatars = [...avatarsBySeat.values()].filter(a => a.group.visible);
  }
  syncRoom();

  media.onPeerVideo = (peerId, videoEl) => avatarsById.get(peerId)?.setVideo(videoEl);
  media.syncPeers(allPeerIds());

  // controls
  const isPlayer = myRole === 'player';
  const rig = isPlayer ? new SeatRig(camera, table.seats[mySeat]) : null;
  const weaponRig = isPlayer ? new WeaponRig(camera, effects, net) : null;
  const controls = new Controls(renderer.domElement, camera, rig, weaponRig);
  if (!isPlayer) controls.setMode('spectator');

  const hand = isPlayer ? new HandFan(scene, camera) : null;

  world = {
    renderer, scene, camera, table, effects, cardTable, hand, controls, rig,
    avatarsBySeat, avatarsById, syncRoom, envMgr,
  };

  setupPicking();
  setupSettingsPanel();
  setupGameNet();

  // render loop
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    controls.update(dt);
    updateTweens(dt);
    hand?.update(dt);
    for (const av of avatarsBySeat.values()) av.update(dt, t);
    effects.update(dt);
    envMgr.update(dt, camera);
    effects.applyShake(camera, t);
    renderer.render(scene, camera);
  });
}

function setupEnvMenu(envMgr) {
  const menu = $('#envMenu');
  menu.innerHTML = '';
  for (const [key, label] of Object.entries(ENVIRONMENTS)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      net.setEnv(key);
      envMgr.set(key);          // apply immediately for the requester
      menu.classList.add('hidden');
      refreshEnvMenu();
    };
    menu.appendChild(b);
  }
  function refreshEnvMenu() {
    [...menu.children].forEach((b, i) => {
      const key = Object.keys(ENVIRONMENTS)[i];
      b.classList.toggle('primary', key === envMgr.name);
    });
  }
  $('#envBtn').onclick = () => { menu.classList.toggle('hidden'); refreshEnvMenu(); };
  net.on('env', (m) => {
    envMgr.set(m.name);
    refreshEnvMenu();
    hud?.toast(`${m.by} changed the scene to ${ENVIRONMENTS[m.name]}`);
  });
}

// ===================================================================== game net

function setupGameNet() {
  net.on('game', (msg) => {
    view = msg.view;
    onGameUpdate(msg.events || []);
  });
  net.on('actionError', (m) => hud.toast(m.error));
  net.on('antic', (m) => replayAntic(m));
}

function onGameUpdate(events) {
  hud.render(view, mySeat);
  world.cardTable.layout(view);
  if (world.hand && mySeat >= 0) {
    const me = view.players[mySeat];
    world.hand.setCards(me.hand.filter(c => !c.hidden));
  }

  for (const ev of events) {
    if (ev.type === 'enterBattlefield') sfx.cardPlace();
    if (ev.type === 'cast') sfx.whoosh();
    if (ev.type === 'damagePlayer' && ev.seat === mySeat) flashScreen('rgba(180,30,20,0.25)');
    if (ev.type === 'gameOver') showGameOver(ev.winner);
    if (ev.type === 'newTurn') {
      // entering my own turn cancels stale combat UI state
      ui.attack = { set: new Set(), defender: null };
      ui.block = { selected: null, map: {} };
      ui.targeting = null;
      ui.mode = 'idle';
    }
  }

  refreshCombatHighlights();
  renderInteraction();
  maybeAutoPass();
}

function showGameOver(winnerSeat) {
  const el = $('#gameOver');
  el.classList.remove('hidden');
  const winner = winnerSeat != null ? view.players[winnerSeat] : null;
  $('#gameOverTitle').textContent = winner
    ? (winnerSeat === mySeat ? 'Victory!' : `${winner.name} wins`)
    : 'Draw';
  $('#gameOverSub').textContent = 'The table thanks you for not flipping it.';
}

function flashScreen(color) {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;inset:0;background:${color};pointer-events:none;z-index:40;transition:opacity .5s;`;
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 600);
}

// Arena-style auto-priority: pass automatically when there is plainly nothing
// for you to do, stop at your main phases, attack declaration, blocks, and
// whenever anything is on the stack. "Full control" disables it.
function maybeAutoPass() {
  if (!view || myRole !== 'player' || ui.fullControl) return;
  if (view.phase !== 'playing' || view.priority !== mySeat) return;
  const me = view.players[mySeat];
  if (me.lost) return;

  // Stack handling: stop when an opponent's spell is on top (you may respond),
  // but auto-yield past your own spells so they resolve without extra clicks.
  const top = view.stack[view.stack.length - 1];
  if (top && top.controller !== mySeat) return;
  if (view.pending) return;
  const myTurn = view.activePlayer === mySeat;
  const mustDeclareAttack = view.step === 'combat_attackers' && myTurn && view.combat && !view.combat.declaredAttackers;
  const mustDeclareBlock = view.step === 'combat_blockers' && view.combat && view.combat.defender === mySeat && !view.combat.declaredBlockers;
  if (mustDeclareAttack || mustDeclareBlock) return;

  const stops = myTurn ? ['main1', 'main2'] : [];
  if (stops.includes(view.step)) return;

  // de-dupe: only auto-pass once per unique game moment
  const key = `${view.turn}|${view.step}|${view.stack.length}|${view.activePlayer}`;
  if (ui.lastAutoPassKey === key) return;
  ui.lastAutoPassKey = key;
  setTimeout(() => net.action({ type: 'passPriority' }), 140);
}

// ===================================================================== interaction

function setupPicking() {
  const raycaster = new THREE.Raycaster();
  const { camera, cardTable, hand, controls } = world;

  function pickAll(e) {
    raycaster.setFromCamera(new THREE.Vector2(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    ), camera);
    const handId = hand ? hand.raycast(raycaster) : null;
    let tableHit = null;
    const hits = raycaster.intersectObjects([...cardTable.meshes.values()], false);
    if (hits.length) tableHit = hits[0].object.userData;
    let avatarSeat = null;
    for (const [seat, av] of world.avatarsBySeat) {
      if (!av.group.visible) continue;
      if (raycaster.intersectObject(av.group, true).length) { avatarSeat = seat; break; }
    }
    return { handId, tableHit, avatarSeat };
  }

  controls.onHover = (e) => {
    if (!hand || !view) return;
    const { handId } = pickAll(e);
    hand.hovered = handId;
    document.body.style.cursor = handId ? 'pointer' : 'default';
  };

  controls.onPick = (e) => {
    if (!view || myRole !== 'player') return;
    const me = view.players[mySeat];
    const { handId, tableHit, avatarSeat } = pickAll(e);

    // ----- discard selection
    if (view.pending?.type === 'discard' && view.pending.player === mySeat) {
      if (handId) {
        if (ui.discardSel.has(handId)) ui.discardSel.delete(handId);
        else if (ui.discardSel.size < view.pending.count) ui.discardSel.add(handId);
        hand.selected = ui.discardSel;
        renderInteraction();
      }
      return;
    }

    // ----- targeting a spell
    if (ui.targeting) {
      const spec = ui.targeting.specs[ui.targeting.chosen.length];
      let target = null;
      if (tableHit?.zoneInfo?.zone === 'battlefield') {
        const perm = tableHit.zoneInfo.perm;
        const isCreature = CARDS[perm.cardId].types.includes('creature');
        if (isCreature && spec !== 'player' && spec !== 'spell') {
          if (spec === 'friendly_creature' && tableHit.zoneInfo.seat !== mySeat) return hud.toast('Target one of your creatures');
          if (spec === 'enemy_creature' && tableHit.zoneInfo.seat === mySeat) return hud.toast("Target an opponent's creature");
          target = { type: 'creature', instId: perm.instId };
        }
      } else if (tableHit?.zoneInfo?.zone === 'stack' && spec === 'spell') {
        target = { type: 'spell', instId: tableHit.instId };
      } else if (avatarSeat != null && (spec === 'any' || spec === 'player')) {
        target = { type: 'player', seat: avatarSeat };
      }
      if (!target) return;
      ui.targeting.chosen.push(target);
      if (ui.targeting.chosen.length === ui.targeting.specs.length) {
        net.action({ type: 'castSpell', instId: ui.targeting.instId, targets: ui.targeting.chosen });
        ui.targeting = null; ui.mode = 'idle';
      }
      renderInteraction();
      return;
    }

    // ----- attack declaration
    if (canDeclareAttackers()) {
      if (tableHit?.zoneInfo?.zone === 'battlefield' && tableHit.zoneInfo.seat === mySeat) {
        const perm = tableHit.zoneInfo.perm;
        const c = CARDS[perm.cardId];
        if (c.types.includes('creature')) {
          if (perm.tapped) return hud.toast(`${c.name} is tapped`);
          if (perm.summoningSick && !(c.keywords || []).includes('haste')) return hud.toast(`${c.name} has summoning sickness`);
          if (ui.attack.set.has(perm.instId)) ui.attack.set.delete(perm.instId);
          else ui.attack.set.add(perm.instId);
          refreshCombatHighlights();
          renderInteraction();
          return;
        }
      }
      if (avatarSeat != null && avatarSeat !== mySeat) {
        ui.attack.defender = avatarSeat;
        renderInteraction();
        return;
      }
    }

    // ----- block declaration
    if (canDeclareBlockers()) {
      if (tableHit?.zoneInfo?.zone === 'battlefield') {
        const perm = tableHit.zoneInfo.perm;
        if (tableHit.zoneInfo.seat === mySeat && CARDS[perm.cardId].types.includes('creature')) {
          ui.block.selected = ui.block.selected === perm.instId ? null : perm.instId;
          // clicking a blocker again clears its assignment
          for (const k of Object.keys(ui.block.map)) {
            ui.block.map[k] = ui.block.map[k].filter(id => id !== perm.instId || ui.block.selected === perm.instId);
          }
          refreshCombatHighlights();
          renderInteraction();
          return;
        }
        if (view.combat?.attackers.includes(perm.instId) && ui.block.selected) {
          for (const k of Object.keys(ui.block.map)) {
            ui.block.map[k] = ui.block.map[k].filter(id => id !== ui.block.selected);
          }
          (ui.block.map[perm.instId] ??= []).push(ui.block.selected);
          ui.block.selected = null;
          refreshCombatHighlights();
          renderInteraction();
          return;
        }
      }
    }

    // ----- idle: hand plays + tapping lands
    if (handId && view.phase === 'playing') {
      const inst = me.hand.find(c => c.instId === handId);
      if (!inst) return;
      const c = CARDS[inst.cardId];
      if (c.types.includes('land')) {
        net.action({ type: 'playLand', instId: handId });
      } else {
        const specs = (c.effect?.targets) || (c.etb?.targets) || [];
        if (specs.length === 0) {
          net.action({ type: 'castSpell', instId: handId, targets: [] });
        } else {
          ui.targeting = { instId: handId, cardName: c.name, specs, chosen: [] };
          ui.mode = 'targeting';
          renderInteraction();
        }
      }
      return;
    }
    if (view.phase === 'mulligan') return;

    if (tableHit?.zoneInfo?.zone === 'battlefield' && tableHit.zoneInfo.seat === mySeat) {
      const perm = tableHit.zoneInfo.perm;
      const c = CARDS[perm.cardId];
      if (c.mana && !perm.tapped) net.action({ type: 'tapForMana', instId: perm.instId });
    }
  };
}

function canDeclareAttackers() {
  return view?.step === 'combat_attackers' && view.activePlayer === mySeat &&
    view.combat && !view.combat.declaredAttackers;
}
function canDeclareBlockers() {
  return view?.step === 'combat_blockers' && view.combat &&
    view.combat.defender === mySeat && !view.combat.declaredBlockers;
}

function refreshCombatHighlights() {
  const ct = world.cardTable;
  if (!view) return;
  for (const [id] of ct.meshes) {
    if (id.startsWith('lib_') || id.startsWith('gy_')) continue;
    let on = false, color = 0xffcf6e;
    if (ui.attack.set.has(id)) { on = true; color = 0xe05038; }
    if (view.combat?.attackers?.includes(id)) { on = true; color = 0xe05038; }
    if (ui.block.selected === id) { on = true; color = 0x5ecfc4; }
    for (const arr of Object.values(ui.block.map)) if (arr.includes(id)) { on = true; color = 0x5ecfc4; }
    if (view.combat?.blocks) {
      for (const arr of Object.values(view.combat.blocks)) if (arr.includes(id)) { on = true; color = 0x5ecfc4; }
    }
    ct.setHighlight(id, on, color);
  }
}

function renderInteraction() {
  if (!hud || !view) return;
  const actions = [];
  let prompt = '';

  if (myRole !== 'player') {
    hud.setPrompt(view.phase === 'playing' ? '' : 'Spectating');
    hud.setActions([]);
    return;
  }
  const me = view.players[mySeat];

  if (view.phase === 'over') {
    hud.setPrompt(''); hud.setActions([]);
    return;
  }

  if (view.phase === 'mulligan') {
    if (!me.keptHand) {
      prompt = `Opening hand (${me.hand.length} cards) — keep or mulligan?`;
      actions.push({ label: 'Keep hand', primary: true, onClick: () => net.action({ type: 'keepHand' }) });
      actions.push({ label: `Mulligan to ${Math.max(1, 6 - me.mulligans)}`, onClick: () => net.action({ type: 'mulligan' }) });
    } else {
      prompt = 'Waiting for other players…';
    }
  } else if (view.pending?.type === 'discard' && view.pending.player === mySeat) {
    prompt = `Discard ${view.pending.count} card(s) — click cards in hand`;
    actions.push({
      label: `Discard ${ui.discardSel.size}/${view.pending.count}`,
      primary: true,
      disabled: ui.discardSel.size !== view.pending.count,
      onClick: () => {
        net.action({ type: 'discard', instIds: [...ui.discardSel] });
        ui.discardSel = new Set();
        if (world.hand) world.hand.selected = ui.discardSel;
      },
    });
  } else if (ui.targeting) {
    const spec = ui.targeting.specs[ui.targeting.chosen.length];
    const what = { any: 'any target', creature: 'a creature', friendly_creature: 'your creature',
                   enemy_creature: "an opponent's creature", player: 'a player', spell: 'a spell on the stack' }[spec];
    prompt = `${ui.targeting.cardName}: choose ${what}`;
    actions.push({ label: 'Cancel', onClick: () => { ui.targeting = null; ui.mode = 'idle'; renderInteraction(); } });
  } else if (canDeclareAttackers()) {
    const opponents = view.players.filter(p => p.seat !== mySeat && !p.lost);
    if (opponents.length === 1) ui.attack.defender = opponents[0].seat;
    const defName = ui.attack.defender != null ? view.players[ui.attack.defender].name : '—';
    prompt = ui.attack.set.size
      ? `Attacking ${defName} with ${ui.attack.set.size} creature(s)` +
        (opponents.length > 1 ? ' (click an avatar to switch defender)' : '')
      : 'Click your creatures to attack' + (opponents.length > 1 ? ', click an avatar to choose who' : '');
    actions.push({
      label: ui.attack.set.size ? `⚔ Attack with ${ui.attack.set.size}` : 'No attacks',
      primary: true,
      disabled: ui.attack.set.size > 0 && ui.attack.defender == null,
      onClick: () => {
        net.action({ type: 'declareAttackers', attackers: [...ui.attack.set], defender: ui.attack.defender });
        ui.attack = { set: new Set(), defender: null };
      },
    });
  } else if (canDeclareBlockers()) {
    const assigned = Object.values(ui.block.map).reduce((s, a) => s + a.length, 0);
    prompt = ui.block.selected
      ? 'Now click the attacker to block'
      : `Click a creature to block with (${assigned} assigned)`;
    actions.push({
      label: assigned ? `🛡 Confirm ${assigned} block(s)` : 'No blocks',
      primary: true,
      onClick: () => {
        net.action({ type: 'declareBlockers', blocks: ui.block.map });
        ui.block = { selected: null, map: {} };
      },
    });
  } else if (view.phase === 'playing' && view.priority === mySeat) {
    const myTurn = view.activePlayer === mySeat;
    if (view.stack.length > 0) {
      const top = view.stack[view.stack.length - 1];
      prompt = `${CARDS[top.cardId].name} is on the stack — respond or resolve`;
      actions.push({ label: 'Resolve / Pass', primary: true, onClick: () => net.action({ type: 'passPriority' }) });
    } else if (myTurn && view.step === 'main1') {
      prompt = 'Main phase — play lands and spells';
      actions.push({ label: '⚔ To Combat', primary: true, onClick: () => net.action({ type: 'passPriority' }) });
    } else if (myTurn && view.step === 'main2') {
      prompt = 'Second main phase';
      actions.push({ label: 'End Turn', primary: true, onClick: () => net.action({ type: 'passPriority' }) });
    } else {
      prompt = `Priority: ${view.step.replace('_', ' ')}`;
      actions.push({ label: 'Pass', primary: true, onClick: () => net.action({ type: 'passPriority' }) });
    }
  } else if (view.phase === 'playing') {
    prompt = view.activePlayer === mySeat ? '' : `${view.players[view.activePlayer].name}'s turn…`;
  }

  if (view.phase === 'playing' && !me.lost) {
    actions.push({
      label: ui.fullControl ? 'Full control: ON' : 'Full control: off',
      onClick: () => { ui.fullControl = !ui.fullControl; renderInteraction(); },
    });
    actions.push({ label: 'Concede', danger: true, onClick: () => {
      if (confirm('Concede the game?')) net.action({ type: 'concede' });
    } });
  }

  hud.setPrompt(prompt);
  hud.setActions(actions);

  // life chips double as player targets
  hud.onPlayerClick = (seat) => {
    if (ui.targeting) {
      const spec = ui.targeting.specs[ui.targeting.chosen.length];
      if (spec === 'any' || spec === 'player') {
        ui.targeting.chosen.push({ type: 'player', seat });
        if (ui.targeting.chosen.length === ui.targeting.specs.length) {
          net.action({ type: 'castSpell', instId: ui.targeting.instId, targets: ui.targeting.chosen });
          ui.targeting = null; ui.mode = 'idle';
        }
        renderInteraction();
      }
    } else if (canDeclareAttackers() && seat !== mySeat) {
      ui.attack.defender = seat;
      renderInteraction();
    }
  };
}

// ===================================================================== antics

function replayAntic(m) {
  const { effects, avatarsBySeat, camera } = world;
  const a = m.antic;
  const v = (arr) => new THREE.Vector3(...arr);
  if (a.kind === 'gun') {
    effects.fireGun(v(a.origin), v(a.dir));
    maybeFlinch(v(a.origin), v(a.dir));
  } else if (a.kind === 'throw') {
    effects.throwProjectile(a.weapon, v(a.origin), v(a.dir));
  } else if (a.kind === 'slam') {
    effects.tableSlam(v(a.point));
  }
}

// remote shot aimed at me → screen flash (my own avatar is invisible locally)
function maybeFlinch(origin, dir) {
  if (myRole !== 'player') return;
  const toMe = world.camera.position.clone().sub(origin);
  const along = toMe.dot(dir);
  if (along <= 0) return;
  const closest = origin.clone().addScaledVector(dir, along);
  if (closest.distanceTo(world.camera.position) < 0.45) {
    flashScreen('rgba(200,40,30,0.35)');
    sfx.bonk();
  }
}

// ===================================================================== settings

function setupSettingsPanel() {
  const panel = $('#settings');
  $('#settingsBtn').onclick = () => panel.classList.toggle('hidden');

  const camBtn = $('#btnCam'), micBtn = $('#btnMic'), deafBtn = $('#btnDeafen');
  const selCam = $('#selCam'), selMic = $('#selMic');

  async function refreshDevices() {
    const { cams, mics } = await media.listDevices();
    fillSelect(selCam, cams, 'Camera');
    fillSelect(selMic, mics, 'Microphone');
  }
  function fillSelect(sel, list, label) {
    const cur = sel.value;
    sel.innerHTML = '';
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `${label} ${i + 1}`;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  }
  refreshDevices();

  camBtn.onclick = async () => {
    try {
      await media.setCam(!media.camOn, selCam.value || undefined);
      camBtn.textContent = `📷 Camera: ${media.camOn ? 'on' : 'off'}`;
      net.setProfile({ camOn: media.camOn });
      refreshDevices();
      // show own feed on own (hidden-locally) avatar so spectators/others see it via RTC;
      // additionally mirror locally if our avatar is visible (spectator-hosted edge case)
      const myAv = world?.avatarsById.get(net.id);
      if (myAv) myAv.setVideo(media.camOn ? media.localVideoEl : null);
    } catch (e) { hud.toast('Camera unavailable: ' + e.message); }
  };
  micBtn.onclick = async () => {
    try {
      await media.setMic(!media.micOn, selMic.value || undefined);
      micBtn.textContent = `🎙 Mic: ${media.micOn ? 'on' : 'off'}`;
      net.setProfile({ micOn: media.micOn });
      refreshDevices();
    } catch (e) { hud.toast('Microphone unavailable: ' + e.message); }
  };
  deafBtn.onclick = () => {
    media.setDeafened(!media.deafened);
    deafBtn.textContent = `🔊 Incoming audio: ${media.deafened ? 'muted' : 'on'}`;
  };
  selCam.onchange = () => { if (media.camOn) media.switchDevice('video', selCam.value).catch(e => hud.toast(e.message)); };
  selMic.onchange = () => { if (media.micOn) media.switchDevice('audio', selMic.value).catch(e => hud.toast(e.message)); };
}

// ===================================================================== boot

setupLobby();
