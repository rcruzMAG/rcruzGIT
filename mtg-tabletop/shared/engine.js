// Core Magic: The Gathering rules engine (Arena-style core rules).
// Authoritative: runs on the server. Clients send actions, receive redacted views.
//
// Implemented: zones (library/hand/battlefield/graveyard/exile/stack), London-lite
// mulligans, full turn/phase/step structure, priority passing (APNAP), the stack
// with responses and counterspells, land-per-turn, auto-tap mana payment plus
// manual tapping, summoning sickness, combat (attackers/blockers, flying/reach,
// first-strike-free simultaneous damage, trample, deathtouch, lifelink, vigilance,
// haste, can't-block), ETB triggers, state-based actions (lethal damage, zero
// toughness, life <= 0, empty-library draw), cleanup discard, multiplayer
// free-for-all with per-combat defending player, concession.

import { CARDS, manaValue } from './cards.js';

export const STEPS = [
  'untap', 'upkeep', 'draw',
  'main1',
  'combat_begin', 'combat_attackers', 'combat_blockers', 'combat_damage', 'combat_end',
  'main2',
  'end', 'cleanup',
];

const COLORS = ['W', 'U', 'B', 'R', 'G'];

let instCounter = 1;
function newInstId() { return 'c' + (instCounter++); }

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeInstance(cardId, owner) {
  return { instId: newInstId(), cardId, owner };
}

// ------------------------------------------------------------------ creation

export function createGame(players) {
  // players: [{id, name, deck: [cardId...], sideboard?: [cardId...] }]
  const state = {
    players: players.map((p, i) => ({
      id: p.id, name: p.name, seat: i,
      life: 20,
      library: shuffle(p.deck.map(cid => makeInstance(cid, i))),
      sideboard: (p.sideboard || []).map(cid => makeInstance(cid, i)),
      hand: [], battlefield: [], graveyard: [], exile: [],
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      landsPlayed: 0, mulligans: 0, keptHand: false,
      lost: false, drawnFromEmpty: false,
    })),
    stack: [],            // [{instId, cardId, controller, targets, isAbility, effect, fromHand}]
    turn: 1,
    activePlayer: 0,
    step: 'main1',
    phase: 'mulligan',    // 'mulligan' | 'playing' | 'over'
    priority: null,       // seat index holding priority
    passes: [],           // seats that passed since last action
    combat: null,         // {defender, attackers:[instId], blocks:{attackerInst:[blockerInsts]}}
    pending: null,        // {type:'discard', player, count}
    winner: null,
    log: [],
    events: [],           // transient, drained after each broadcast
  };
  for (const p of state.players) {
    drawCards(state, p.seat, 7, true);
  }
  log(state, null, 'Game started. Decide your opening hands.');
  return state;
}

function log(state, seat, msg) {
  state.log.push({ seat, msg, t: Date.now() });
  if (state.log.length > 200) state.log.shift();
  state.events.push({ type: 'log', seat, msg });
}

function emit(state, ev) { state.events.push(ev); }

// ------------------------------------------------------------------ helpers

function player(state, seat) { return state.players[seat]; }
function card(cardId) { return CARDS[cardId]; }

function alivePlayers(state) { return state.players.filter(p => !p.lost); }

function findPermanent(state, instId) {
  for (const p of state.players) {
    const perm = p.battlefield.find(c => c.instId === instId);
    if (perm) return { perm, controller: p.seat };
  }
  return null;
}

function effPower(perm) {
  const c = card(perm.cardId);
  return (c.power || 0) + (perm.pumpPower || 0) + (perm.counters || 0);
}
function effToughness(perm) {
  const c = card(perm.cardId);
  return (c.toughness || 0) + (perm.pumpToughness || 0) + (perm.counters || 0);
}
function hasKw(perm, kw) { return (card(perm.cardId).keywords || []).includes(kw); }

function nextSeatFrom(state, seat) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const s = (seat + i) % n;
    if (!state.players[s].lost) return s;
  }
  return seat;
}

// ------------------------------------------------------------------ drawing

function drawCards(state, seat, n, silent = false) {
  const p = player(state, seat);
  for (let i = 0; i < n; i++) {
    const c = p.library.pop();
    if (!c) { p.drawnFromEmpty = true; break; }
    p.hand.push(c);
  }
  if (!silent) emit(state, { type: 'draw', seat, count: n });
}

// ------------------------------------------------------------------ priority

function givePriority(state, seat) {
  state.priority = seat;
  state.passes = [];
}

function resetPriorityAfterAction(state, seat) {
  // After taking an action, that player keeps/receives priority.
  state.passes = [];
  state.priority = seat;
}

function allPassed(state) {
  return alivePlayers(state).every(p => state.passes.includes(p.seat));
}

function passPriority(state, seat) {
  if (!state.passes.includes(seat)) state.passes.push(seat);
  if (!allPassed(state)) {
    // next alive player in turn order gets priority
    let s = nextSeatFrom(state, seat);
    while (state.passes.includes(s)) s = nextSeatFrom(state, s);
    state.priority = s;
    return;
  }
  // everyone passed
  if (state.stack.length > 0) {
    resolveTopOfStack(state);
    if (state.phase === 'over') return;
    givePriority(state, state.activePlayer);
  } else {
    advanceStep(state);
  }
}

// ------------------------------------------------------------------ mana

function untappedLands(p) {
  return p.battlefield.filter(c => card(c.cardId).types.includes('land') && !c.tapped);
}

function canPay(state, seat, cost) {
  if (!cost) return true;
  const p = player(state, seat);
  const pool = { ...p.manaPool };
  const lands = untappedLands(p).map(l => card(l.cardId).mana);
  // colored requirements first
  for (const c of COLORS) {
    let need = cost[c] || 0;
    while (need > 0 && pool[c] > 0) { pool[c]--; need--; }
    while (need > 0) {
      const idx = lands.indexOf(c);
      if (idx === -1) return false;
      lands.splice(idx, 1); need--;
    }
  }
  const generic = cost.generic || 0;
  const available = lands.length + COLORS.reduce((s, c) => s + pool[c], 0) + pool.C;
  return available >= generic;
}

function payCost(state, seat, cost) {
  // Auto-tapper: drain pool first, then tap lands. Returns tapped instIds.
  if (!cost) return [];
  const p = player(state, seat);
  const tapped = [];
  const tapLandOf = (color) => {
    const land = untappedLands(p).find(l => card(l.cardId).mana === color);
    if (!land) return false;
    land.tapped = true; tapped.push(land.instId);
    return true;
  };
  for (const c of COLORS) {
    let need = cost[c] || 0;
    while (need > 0 && p.manaPool[c] > 0) { p.manaPool[c]--; need--; }
    while (need > 0) { tapLandOf(c); need--; }
  }
  let generic = cost.generic || 0;
  // pool first (any color), then lands (prefer colors least needed later — simple: any)
  for (const c of [...COLORS, 'C']) {
    while (generic > 0 && p.manaPool[c] > 0) { p.manaPool[c]--; generic--; }
  }
  while (generic > 0) {
    const land = untappedLands(p)[0];
    if (!land) break;
    land.tapped = true; tapped.push(land.instId);
    generic--;
  }
  if (tapped.length) emit(state, { type: 'tap', seat, instIds: tapped });
  return tapped;
}

function emptyManaPools(state) {
  for (const p of state.players) for (const k of Object.keys(p.manaPool)) p.manaPool[k] = 0;
}

// ------------------------------------------------------------------ steps

function advanceStep(state) {
  emptyManaPools(state);
  const idx = STEPS.indexOf(state.step);
  let next = STEPS[idx + 1];

  // skip empty combat sub-steps
  if (next === 'combat_blockers' && (!state.combat || state.combat.attackers.length === 0)) {
    state.combat = null;
    next = 'main2';
  }

  if (!next) { startNextTurn(state); return; }
  beginStep(state, next);
}

function beginStep(state, step) {
  state.step = step;
  emit(state, { type: 'step', step, activePlayer: state.activePlayer });
  const ap = player(state, state.activePlayer);

  switch (step) {
    case 'untap': {
      for (const perm of ap.battlefield) {
        perm.tapped = false;
        perm.summoningSick = false;
      }
      // no priority during untap
      advanceStep(state);
      return;
    }
    case 'draw': {
      if (state.turn === 1 && state.activePlayer === firstAliveSeat(state) && state.players.length === 2) {
        log(state, state.activePlayer, `${ap.name} skips their first draw.`);
      } else {
        drawCards(state, state.activePlayer, 1);
        log(state, state.activePlayer, `${ap.name} draws a card.`);
      }
      checkStateBasedActions(state);
      if (state.phase === 'over') return;
      givePriority(state, state.activePlayer);
      return;
    }
    case 'combat_attackers': {
      state.combat = { defender: null, attackers: [], blocks: {}, declaredAttackers: false, declaredBlockers: false };
      givePriority(state, state.activePlayer);
      return;
    }
    case 'combat_blockers': {
      givePriority(state, state.activePlayer);
      return;
    }
    case 'combat_damage': {
      dealCombatDamage(state);
      if (state.phase === 'over') return;
      givePriority(state, state.activePlayer);
      return;
    }
    case 'combat_end': {
      state.combat = null;
      givePriority(state, state.activePlayer);
      return;
    }
    case 'cleanup': {
      // damage wears off, "until end of turn" effects end
      for (const p of state.players) {
        for (const perm of p.battlefield) {
          perm.damage = 0; perm.pumpPower = 0; perm.pumpToughness = 0;
        }
      }
      if (ap.hand.length > 7) {
        state.pending = { type: 'discard', player: state.activePlayer, count: ap.hand.length - 7 };
        emit(state, { type: 'pending', pending: state.pending });
        return; // wait for discard action
      }
      startNextTurn(state);
      return;
    }
    default: {
      givePriority(state, state.activePlayer);
    }
  }
}

function firstAliveSeat(state) { return alivePlayers(state)[0].seat; }

function startNextTurn(state) {
  const next = nextSeatFrom(state, state.activePlayer);
  if (next <= state.activePlayer) state.turn++;
  state.activePlayer = next;
  const ap = player(state, next);
  ap.landsPlayed = 0;
  state.combat = null;
  log(state, next, `— Turn ${state.turn}: ${ap.name} —`);
  emit(state, { type: 'newTurn', seat: next, turn: state.turn });
  beginStep(state, 'untap');
}

// ------------------------------------------------------------------ stack

function resolveTopOfStack(state) {
  const item = state.stack.pop();
  if (!item) return;
  emit(state, { type: 'resolve', instId: item.instId, cardId: item.cardId });
  const c = card(item.cardId);
  const controller = player(state, item.controller);

  if (item.countered) {
    controller.graveyard.push({ instId: item.instId, cardId: item.cardId, owner: item.controller });
    log(state, item.controller, `${c.name} was countered.`);
    return;
  }

  if (item.isAbility) {
    applyEffect(state, item.controller, item.effect, item.targets, c.name);
  } else if (c.types.includes('creature')) {
    const perm = {
      instId: item.instId, cardId: item.cardId, owner: item.controller,
      tapped: false, summoningSick: !( (c.keywords||[]).includes('haste') ),
      damage: 0, pumpPower: 0, pumpToughness: 0, counters: 0,
    };
    controller.battlefield.push(perm);
    log(state, item.controller, `${c.name} enters the battlefield.`);
    emit(state, { type: 'enterBattlefield', seat: item.controller, instId: item.instId, cardId: item.cardId });
    if (c.etb) {
      // ETB triggers with no/auto targets resolve immediately; targeted ETBs were
      // chosen at cast time (stored on the stack item).
      applyEffect(state, item.controller, c.etb, item.etbTargets || [], c.name);
    }
  } else {
    applyEffect(state, item.controller, c.effect, item.targets, c.name);
    controller.graveyard.push({ instId: item.instId, cardId: item.cardId, owner: item.controller });
  }
  checkStateBasedActions(state);
}

function applyEffect(state, controllerSeat, effect, targets, sourceName) {
  if (!effect) return;
  const ctl = player(state, controllerSeat);
  const t0 = targets && targets[0];

  const resolveCreature = (t) => (t && t.type === 'creature') ? findPermanent(state, t.instId) : null;

  switch (effect.kind) {
    case 'damage': {
      if (!t0) break;
      if (t0.type === 'player') {
        const tp = player(state, t0.seat);
        tp.life -= effect.amount;
        log(state, controllerSeat, `${sourceName} deals ${effect.amount} damage to ${tp.name}.`);
        emit(state, { type: 'damagePlayer', seat: t0.seat, amount: effect.amount });
      } else {
        const f = resolveCreature(t0);
        if (f) {
          f.perm.damage += effect.amount;
          log(state, controllerSeat, `${sourceName} deals ${effect.amount} damage to ${card(f.perm.cardId).name}.`);
          emit(state, { type: 'damageCreature', instId: f.perm.instId, amount: effect.amount });
        }
      }
      break;
    }
    case 'drain': {
      if (t0 && t0.type === 'player') {
        const tp = player(state, t0.seat);
        tp.life -= effect.amount;
        ctl.life += effect.amount;
        log(state, controllerSeat, `${sourceName}: ${tp.name} loses ${effect.amount} life, ${ctl.name} gains ${effect.amount}.`);
      }
      break;
    }
    case 'draw': {
      drawCards(state, controllerSeat, effect.amount);
      log(state, controllerSeat, `${ctl.name} draws ${effect.amount} card(s).`);
      break;
    }
    case 'lifegain': {
      ctl.life += effect.amount;
      log(state, controllerSeat, `${ctl.name} gains ${effect.amount} life.`);
      break;
    }
    case 'lifegain_draw': {
      ctl.life += effect.amount;
      drawCards(state, controllerSeat, 1);
      log(state, controllerSeat, `${ctl.name} gains ${effect.amount} life and draws a card.`);
      break;
    }
    case 'pump': {
      const f = resolveCreature(t0);
      if (f) {
        f.perm.pumpPower += effect.power;
        f.perm.pumpToughness += effect.toughness;
        log(state, controllerSeat, `${card(f.perm.cardId).name} gets +${effect.power}/+${effect.toughness}.`);
        emit(state, { type: 'pump', instId: f.perm.instId });
      }
      break;
    }
    case 'pump_all': {
      for (const perm of ctl.battlefield) {
        if (card(perm.cardId).types.includes('creature')) {
          perm.pumpPower += effect.power;
          perm.pumpToughness += effect.toughness;
        }
      }
      log(state, controllerSeat, `${ctl.name}'s creatures get +${effect.power}/+${effect.toughness}.`);
      break;
    }
    case 'destroy': {
      const f = resolveCreature(t0);
      if (f) destroyPermanent(state, f.perm.instId, `${sourceName} destroys`);
      break;
    }
    case 'exile': {
      const f = resolveCreature(t0);
      if (f) {
        const p = player(state, f.controller);
        p.battlefield = p.battlefield.filter(c => c.instId !== f.perm.instId);
        player(state, f.perm.owner).exile.push({ instId: f.perm.instId, cardId: f.perm.cardId, owner: f.perm.owner });
        log(state, controllerSeat, `${sourceName} exiles ${card(f.perm.cardId).name}.`);
        emit(state, { type: 'exile', instId: f.perm.instId });
      }
      break;
    }
    case 'fight_oneway': {
      const a = resolveCreature(targets[0]);
      const b = resolveCreature(targets[1]);
      if (a && b) {
        b.perm.damage += effPower(a.perm);
        if (hasKw(a.perm, 'deathtouch')) b.perm.deathtouched = true;
        log(state, controllerSeat, `${card(a.perm.cardId).name} bites ${card(b.perm.cardId).name}.`);
      }
      break;
    }
    case 'counter': {
      if (t0 && t0.type === 'spell') {
        const item = state.stack.find(s => s.instId === t0.instId);
        if (item && !item.isAbility) {
          if (effect.onlyCreature && !card(item.cardId).types.includes('creature')) break;
          item.countered = true;
          log(state, controllerSeat, `${sourceName} counters ${card(item.cardId).name}.`);
          emit(state, { type: 'countered', instId: item.instId });
        }
      }
      break;
    }
  }
}

function destroyPermanent(state, instId, why) {
  const f = findPermanent(state, instId);
  if (!f) return;
  const p = player(state, f.controller);
  p.battlefield = p.battlefield.filter(c => c.instId !== instId);
  player(state, f.perm.owner).graveyard.push({ instId, cardId: f.perm.cardId, owner: f.perm.owner });
  log(state, f.controller, `${why ? why + ' ' : ''}${card(f.perm.cardId).name}${why ? '' : ' dies'}.`);
  emit(state, { type: 'dies', instId, seat: f.controller });
}

// ------------------------------------------------------------------ SBAs

function checkStateBasedActions(state) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of state.players) {
      for (const perm of [...p.battlefield]) {
        const c = card(perm.cardId);
        if (!c.types.includes('creature')) continue;
        if (effToughness(perm) <= 0 ||
            (perm.damage >= effToughness(perm) && effToughness(perm) > 0) ||
            (perm.deathtouched && perm.damage > 0)) {
          destroyPermanent(state, perm.instId);
          changed = true;
        }
      }
    }
    for (const p of state.players) {
      if (!p.lost && (p.life <= 0 || p.drawnFromEmpty)) {
        p.lost = true;
        log(state, p.seat, `${p.name} loses the game.`);
        emit(state, { type: 'playerLost', seat: p.seat });
        changed = true;
      }
    }
  }
  const alive = alivePlayers(state);
  if (alive.length <= 1 && state.phase !== 'over') {
    state.phase = 'over';
    state.winner = alive.length ? alive[0].seat : null;
    log(state, state.winner, alive.length ? `${alive[0].name} wins the game!` : 'Draw.');
    emit(state, { type: 'gameOver', winner: state.winner });
  }
}

// ------------------------------------------------------------------ combat

function dealCombatDamage(state) {
  const combat = state.combat;
  if (!combat) return;
  const ap = player(state, state.activePlayer);
  const def = player(state, combat.defender);

  for (const atkId of combat.attackers) {
    const fa = findPermanent(state, atkId);
    if (!fa) continue;
    const attacker = fa.perm;
    const blockers = (combat.blocks[atkId] || [])
      .map(bid => findPermanent(state, bid)).filter(Boolean).map(f => f.perm);

    const atkPower = effPower(attacker);
    if (blockers.length === 0) {
      def.life -= atkPower;
      if (hasKw(attacker, 'lifelink')) ap.life += atkPower;
      emit(state, { type: 'combatDamagePlayer', from: atkId, seat: combat.defender, amount: atkPower });
      log(state, state.activePlayer, `${card(attacker.cardId).name} hits ${def.name} for ${atkPower}.`);
    } else {
      // assign lethal to each blocker in order; trample excess to player
      let remaining = atkPower;
      for (const b of blockers) {
        const lethal = Math.max(0, effToughness(b) - b.damage);
        const assign = hasKw(attacker, 'deathtouch') ? Math.min(remaining, Math.max(1, Math.min(1, lethal)))
                                                     : Math.min(remaining, lethal || remaining);
        const dealt = blockers.indexOf(b) === blockers.length - 1 && !hasKw(attacker, 'trample')
          ? remaining : assign;
        b.damage += dealt;
        if (hasKw(attacker, 'deathtouch') && dealt > 0) b.deathtouched = true;
        remaining -= dealt;
        emit(state, { type: 'combatClash', attacker: atkId, blocker: b.instId, amount: dealt });
        if (remaining <= 0) break;
      }
      if (remaining > 0 && hasKw(attacker, 'trample')) {
        def.life -= remaining;
        if (hasKw(attacker, 'lifelink')) ap.life += remaining;
        log(state, state.activePlayer, `${card(attacker.cardId).name} tramples ${def.name} for ${remaining}.`);
      }
      // blockers hit back simultaneously
      let back = 0;
      for (const b of blockers) {
        back += effPower(b);
        if (hasKw(b, 'deathtouch') && effPower(b) > 0) attacker.deathtouched = true;
        if (hasKw(b, 'lifelink')) player(state, combat.defender).life += effPower(b);
      }
      attacker.damage += back;
      if (hasKw(attacker, 'lifelink')) {
        const dealtTotal = Math.min(atkPower, blockers.reduce((s, b) => s + effToughness(b), 0));
        ap.life += Math.max(0, dealtTotal);
      }
      log(state, state.activePlayer,
        `${card(attacker.cardId).name} fights ${blockers.map(b => card(b.cardId).name).join(', ')}.`);
    }
  }
  checkStateBasedActions(state);
}

// ------------------------------------------------------------------ actions

export function applyAction(state, seat, action) {
  const fail = (error) => ({ ok: false, error });
  const p = player(state, seat);
  if (!p) return fail('Unknown player');
  if (state.phase === 'over' && action.type !== 'chat') return fail('Game is over');
  if (p.lost && !['concede', 'chat'].includes(action.type)) return fail('You are out of the game');

  switch (action.type) {
    // -------------------------------------------------- mulligan phase
    case 'keepHand': {
      if (state.phase !== 'mulligan' || p.keptHand) return fail('Cannot keep now');
      p.keptHand = true;
      log(state, seat, `${p.name} keeps ${p.hand.length} cards.`);
      maybeStartGame(state);
      return ok(state);
    }
    case 'mulligan': {
      if (state.phase !== 'mulligan' || p.keptHand) return fail('Cannot mulligan now');
      p.mulligans++;
      p.library.push(...p.hand.splice(0));
      shuffle(p.library);
      drawCards(state, seat, Math.max(1, 7 - p.mulligans), true);
      log(state, seat, `${p.name} mulligans to ${p.hand.length}.`);
      emit(state, { type: 'mulligan', seat });
      return ok(state);
    }

    // -------------------------------------------------- pending choices
    case 'discard': {
      const pend = state.pending;
      if (!pend || pend.type !== 'discard' || pend.player !== seat) return fail('Nothing to discard');
      const ids = action.instIds || [];
      if (ids.length !== pend.count) return fail(`Discard exactly ${pend.count} card(s)`);
      for (const id of ids) {
        const idx = p.hand.findIndex(c => c.instId === id);
        if (idx === -1) return fail('Card not in hand');
        const [c] = p.hand.splice(idx, 1);
        p.graveyard.push(c);
      }
      log(state, seat, `${p.name} discards ${ids.length} card(s).`);
      state.pending = null;
      startNextTurn(state);
      return ok(state);
    }

    // -------------------------------------------------- priority actions
    case 'passPriority': {
      if (state.phase !== 'playing') return fail('Not in game');
      if (state.priority !== seat) return fail('You do not have priority');
      if (needsDeclaration(state, seat)) return fail('Declare attackers/blockers first (or declare none)');
      passPriority(state, seat);
      return ok(state);
    }

    case 'playLand': {
      const err = checkSorcerySpeed(state, seat);
      if (err) return fail(err);
      if (p.landsPlayed >= 1) return fail('Already played a land this turn');
      const idx = p.hand.findIndex(c => c.instId === action.instId);
      if (idx === -1) return fail('Card not in hand');
      const c = card(p.hand[idx].cardId);
      if (!c.types.includes('land')) return fail('Not a land');
      const [inst] = p.hand.splice(idx, 1);
      p.battlefield.push({ ...inst, tapped: false, summoningSick: false, damage: 0, pumpPower: 0, pumpToughness: 0, counters: 0 });
      p.landsPlayed++;
      log(state, seat, `${p.name} plays ${c.name}.`);
      emit(state, { type: 'enterBattlefield', seat, instId: inst.instId, cardId: inst.cardId, isLand: true });
      resetPriorityAfterAction(state, seat);
      return ok(state);
    }

    case 'tapForMana': {
      if (state.phase !== 'playing') return fail('Not in game');
      const f = findPermanent(state, action.instId);
      if (!f || f.controller !== seat) return fail('Not your permanent');
      const c = card(f.perm.cardId);
      if (!c.mana || f.perm.tapped) return fail('Cannot tap that for mana');
      f.perm.tapped = true;
      p.manaPool[c.mana]++;
      emit(state, { type: 'tap', seat, instIds: [action.instId] });
      return ok(state);
    }

    case 'castSpell': {
      if (state.phase !== 'playing') return fail('Not in game');
      if (state.priority !== seat) return fail('You do not have priority');
      const idx = p.hand.findIndex(c => c.instId === action.instId);
      if (idx === -1) return fail('Card not in hand');
      const inst = p.hand[idx];
      const c = card(inst.cardId);
      if (c.types.includes('land')) return fail('Use play land for lands');
      const isInstant = c.types.includes('instant');
      if (!isInstant) {
        const err = checkSorcerySpeed(state, seat);
        if (err) return fail(err);
      }
      if (!canPay(state, seat, c.cost)) return fail('Not enough mana');
      const targetSpec = c.effect ? c.effect.targets : (c.etb ? c.etb.targets : []);
      const targets = action.targets || [];
      const terr = validateTargets(state, seat, targetSpec || [], targets);
      if (terr) return fail(terr);

      payCost(state, seat, c.cost);
      p.hand.splice(idx, 1);
      const stackItem = { instId: inst.instId, cardId: inst.cardId, controller: seat, targets };
      if (c.etb && c.etb.targets && c.etb.targets.length) stackItem.etbTargets = targets;
      state.stack.push(stackItem);
      log(state, seat, `${p.name} casts ${c.name}.`);
      emit(state, { type: 'cast', seat, instId: inst.instId, cardId: inst.cardId, targets });
      resetPriorityAfterAction(state, seat);
      return ok(state);
    }

    case 'declareAttackers': {
      if (state.step !== 'combat_attackers') return fail('Not the declare attackers step');
      if (seat !== state.activePlayer) return fail('Only the active player attacks');
      if (state.combat.declaredAttackers) return fail('Attackers already declared');
      const ids = action.attackers || [];
      const defender = ids.length ? action.defender : null;
      if (ids.length) {
        if (defender == null || defender === seat || !state.players[defender] || state.players[defender].lost) {
          return fail('Choose a valid defending player');
        }
        for (const id of ids) {
          const f = findPermanent(state, id);
          if (!f || f.controller !== seat) return fail('Not your creature');
          const c = card(f.perm.cardId);
          if (!c.types.includes('creature')) return fail('Not a creature');
          if (f.perm.tapped) return fail(`${c.name} is tapped`);
          if (f.perm.summoningSick && !hasKw(f.perm, 'haste')) return fail(`${c.name} has summoning sickness`);
        }
        for (const id of ids) {
          const f = findPermanent(state, id);
          f.perm.attacking = true;
          if (!hasKw(f.perm, 'vigilance')) f.perm.tapped = true;
        }
      }
      state.combat.attackers = ids;
      state.combat.defender = defender;
      state.combat.declaredAttackers = true;
      log(state, seat, ids.length
        ? `${p.name} attacks ${player(state, defender).name} with ${ids.length} creature(s).`
        : `${p.name} declares no attackers.`);
      emit(state, { type: 'attackers', seat, attackers: ids, defender });
      givePriority(state, state.activePlayer);
      return ok(state);
    }

    case 'declareBlockers': {
      if (state.step !== 'combat_blockers') return fail('Not the declare blockers step');
      if (!state.combat || seat !== state.combat.defender) return fail('You are not the defending player');
      if (state.combat.declaredBlockers) return fail('Blockers already declared');
      const blocks = action.blocks || {}; // {attackerInstId: [blockerInstIds]}
      const used = new Set();
      for (const [atkId, blockerIds] of Object.entries(blocks)) {
        if (!state.combat.attackers.includes(atkId)) return fail('Invalid attacker');
        const fa = findPermanent(state, atkId);
        for (const bid of blockerIds) {
          if (used.has(bid)) return fail('A creature can only block one attacker');
          used.add(bid);
          const fb = findPermanent(state, bid);
          if (!fb || fb.controller !== seat) return fail('Not your creature');
          const bc = card(fb.perm.cardId);
          if (!bc.types.includes('creature')) return fail('Not a creature');
          if (fb.perm.tapped) return fail(`${bc.name} is tapped`);
          if (bc.cantBlock) return fail(`${bc.name} can't block`);
          if (fa && hasKw(fa.perm, 'flying') && !hasKw(fb.perm, 'flying') && !hasKw(fb.perm, 'reach')) {
            return fail(`${bc.name} can't block a flyer`);
          }
        }
      }
      for (const bid of used) {
        const fb = findPermanent(state, bid);
        if (fb) fb.perm.blocking = true;
      }
      state.combat.blocks = blocks;
      state.combat.declaredBlockers = true;
      log(state, seat, used.size ? `${p.name} blocks with ${used.size} creature(s).` : `${p.name} declares no blockers.`);
      emit(state, { type: 'blockers', seat, blocks });
      givePriority(state, state.activePlayer);
      return ok(state);
    }

    case 'concede': {
      p.lost = true;
      log(state, seat, `${p.name} concedes.`);
      checkStateBasedActions(state);
      if (state.phase !== 'over' && state.priority === seat) passPriority(state, seat);
      return ok(state);
    }

    default:
      return fail('Unknown action: ' + action.type);
  }
}

function ok(state) { return { ok: true }; }

function maybeStartGame(state) {
  if (state.players.every(p => p.keptHand)) {
    state.phase = 'playing';
    state.activePlayer = 0;
    state.turn = 1;
    log(state, 0, `— Turn 1: ${state.players[0].name} —`);
    emit(state, { type: 'gameBegin' });
    beginStep(state, 'untap');
  }
}

function checkSorcerySpeed(state, seat) {
  if (state.phase !== 'playing') return 'Not in game';
  if (state.priority !== seat) return 'You do not have priority';
  if (state.activePlayer !== seat) return 'Only on your own turn';
  if (state.step !== 'main1' && state.step !== 'main2') return 'Only during your main phase';
  if (state.stack.length > 0) return 'The stack must be empty';
  return null;
}

function needsDeclaration(state, seat) {
  if (state.step === 'combat_attackers' && seat === state.activePlayer && state.combat && !state.combat.declaredAttackers) return true;
  if (state.step === 'combat_blockers' && state.combat && seat === state.combat.defender && !state.combat.declaredBlockers) return true;
  return false;
}

function validateTargets(state, seat, specs, targets) {
  if (specs.length !== targets.length) {
    return specs.length ? `This spell needs ${specs.length} target(s)` : 'This spell takes no targets';
  }
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i], t = targets[i];
    if (spec === 'any') {
      if (t.type === 'player') { if (!state.players[t.seat] || state.players[t.seat].lost) return 'Invalid player target'; }
      else if (t.type === 'creature') { if (!findPermanent(state, t.instId)) return 'Invalid creature target'; }
      else return 'Invalid target';
    } else if (spec === 'creature' || spec === 'friendly_creature' || spec === 'enemy_creature') {
      if (t.type !== 'creature') return 'Target must be a creature';
      const f = findPermanent(state, t.instId);
      if (!f || !card(f.perm.cardId).types.includes('creature')) return 'Invalid creature target';
      if (spec === 'friendly_creature' && f.controller !== seat) return 'Must target your own creature';
      if (spec === 'enemy_creature' && f.controller === seat) return "Must target an opponent's creature";
    } else if (spec === 'player') {
      if (t.type !== 'player' || !state.players[t.seat] || state.players[t.seat].lost) return 'Invalid player target';
    } else if (spec === 'spell') {
      if (t.type !== 'spell' || !state.stack.find(s => s.instId === t.instId)) return 'Invalid spell target';
    }
  }
  return null;
}

// ------------------------------------------------------------------ views

// Redact hidden information per player. Spectators get seat = -1.
export function viewFor(state, seat) {
  return {
    phase: state.phase,
    turn: state.turn,
    step: state.step,
    activePlayer: state.activePlayer,
    priority: state.priority,
    pending: state.pending,
    winner: state.winner,
    combat: state.combat,
    stack: state.stack.map(s => ({
      instId: s.instId, cardId: s.cardId, controller: s.controller,
      targets: s.targets, countered: !!s.countered,
    })),
    log: state.log.slice(-60),
    players: state.players.map(p => ({
      id: p.id, name: p.name, seat: p.seat, life: p.life, lost: p.lost,
      mulligans: p.mulligans, keptHand: p.keptHand,
      librarySize: p.library.length,
      handSize: p.hand.length,
      hand: p.seat === seat ? p.hand : p.hand.map(c => ({ instId: c.instId, hidden: true })),
      battlefield: p.battlefield,
      graveyard: p.graveyard,
      exile: p.exile,
      sideboard: p.seat === seat ? p.sideboard : undefined,  // hidden zone: owner only
      sideboardSize: p.sideboard.length,
      manaPool: p.manaPool,
      landsPlayed: p.landsPlayed,
    })),
  };
}

export function drainEvents(state) {
  const ev = state.events;
  state.events = [];
  return ev;
}
