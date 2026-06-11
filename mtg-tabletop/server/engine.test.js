// Engine smoke test: drives a full scripted game through the rules engine.
// Run: node server/engine.test.js

import { createGame, applyAction, viewFor, STEPS } from '../shared/engine.js';
import { DECKS, CARDS } from '../shared/cards.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
}
function act(state, seat, action, expectOk = true) {
  const r = applyAction(state, seat, action);
  if (!!r.ok !== expectOk) {
    failures++;
    console.error(`  ✗ action ${action.type} by seat ${seat}: expected ok=${expectOk}, got`, r);
  }
  return r;
}

console.log('— deck integrity —');
for (const [id, d] of Object.entries(DECKS)) {
  assert(d.cards.length === 40, `${id} has 40 cards`);
  assert(d.cards.every(c => CARDS[c]), `${id} only references defined cards`);
}

console.log('— game setup & mulligan —');
const g = createGame([
  { id: 'a', name: 'Alice', deck: [...DECKS.red_aggro.cards] },
  { id: 'b', name: 'Bob', deck: [...DECKS.green_stompy.cards] },
]);
assert(g.phase === 'mulligan', 'starts in mulligan phase');
assert(g.players[0].hand.length === 7 && g.players[1].hand.length === 7, 'both drew 7');

act(g, 0, { type: 'mulligan' });
assert(g.players[0].hand.length === 6, 'mulligan redraws 6');
act(g, 0, { type: 'keepHand' });
act(g, 1, { type: 'keepHand' });
assert(g.phase === 'playing', 'game begins after keeps');
assert(g.step === 'upkeep' || g.step === 'main1' || g.step === 'draw', 'turn structure started: ' + g.step);

// helper: pass both players until a condition or safety limit
function passUntil(cond, limit = 200) {
  let guard = 0;
  while (!cond() && guard++ < limit) {
    const seat = g.priority;
    const r = applyAction(g, seat, { type: 'passPriority' });
    if (!r.ok) {
      // need a declaration first
      if (g.step === 'combat_attackers') applyAction(g, seat, { type: 'declareAttackers', attackers: [] });
      else if (g.step === 'combat_blockers') applyAction(g, seat, { type: 'declareBlockers', blocks: {} });
      else if (g.pending?.type === 'discard') {
        const p = g.players[g.pending.player];
        applyAction(g, g.pending.player, { type: 'discard', instIds: p.hand.slice(0, g.pending.count).map(c => c.instId) });
      } else { console.error('  ✗ stuck:', r.error, g.step); failures++; break; }
    }
  }
  return guard < limit;
}

console.log('— lands & mana —');
assert(passUntil(() => g.step === 'main1'), 'reached main1');
const alice = g.players[0];
// force a known hand: put a mountain, a flame zealot and a shock in hand
function plant(seat, cardIds) {
  const p = g.players[seat];
  for (const cid of cardIds) {
    const idx = p.library.findIndex(c => c.cardId === cid);
    if (idx !== -1) p.hand.push(...p.library.splice(idx, 1));
  }
}
plant(0, ['mountain', 'mountain', 'flame_zealot', 'shock']);
const mtn = alice.hand.find(c => c.cardId === 'mountain');
act(g, 0, { type: 'playLand', instId: mtn.instId });
assert(alice.battlefield.some(c => c.cardId === 'mountain'), 'mountain on battlefield');
const mtn2 = alice.hand.find(c => c.cardId === 'mountain');
act(g, 0, { type: 'playLand', instId: mtn2.instId }, false); // second land should fail
assert(alice.landsPlayed === 1, 'one land per turn enforced');

console.log('— casting with auto-tap, summoning sickness —');
const zealot = alice.hand.find(c => c.cardId === 'flame_zealot');
act(g, 0, { type: 'castSpell', instId: zealot.instId, targets: [] });
assert(g.stack.length === 1, 'creature spell on stack');
assert(alice.battlefield.find(c => c.cardId === 'mountain').tapped, 'auto-tapped the mountain');
act(g, 0, { type: 'passPriority' });
act(g, 1, { type: 'passPriority' });
assert(g.stack.length === 0 && alice.battlefield.some(c => c.cardId === 'flame_zealot'), 'creature resolved to battlefield');
const z = alice.battlefield.find(c => c.cardId === 'flame_zealot');
assert(z.summoningSick === false, 'haste creature not summoning sick');

console.log('— combat: haste attacker hits face —');
assert(passUntil(() => g.step === 'combat_attackers' && g.activePlayer === 0), 'reached attackers step');
act(g, 0, { type: 'declareAttackers', attackers: [z.instId], defender: 1 });
assert(z.tapped, 'attacker tapped');
const lifeBefore = g.players[1].life;
assert(passUntil(() => g.step === 'main2'), 'combat resolved to main2');
assert(g.players[1].life === lifeBefore - 2, `unblocked 2/1 dealt 2 (life ${g.players[1].life})`);

console.log('— second-land and tapped-mana restrictions —');
plant(0, ['mountain']);
const mtn3 = alice.hand.find(c => c.cardId === 'mountain');
act(g, 0, { type: 'playLand', instId: mtn3.instId }, false);       // 2nd land this turn → illegal
const shockEarly = alice.hand.find(c => c.cardId === 'shock');
if (!shockEarly) plant(0, ['shock']);
const shock = alice.hand.find(c => c.cardId === 'shock');
// only land is still tapped from casting the zealot → cannot pay
act(g, 0, { type: 'castSpell', instId: shock.instId, targets: [{ type: 'player', seat: 1 }] }, false);

console.log('— instants, targeting & the stack (next turn) —');
assert(passUntil(() => g.activePlayer === 0 && g.step === 'main1' && g.turn >= 2), "reached Alice's next main phase");
const mtn4 = alice.hand.find(c => c.cardId === 'mountain');
act(g, 0, { type: 'playLand', instId: mtn4.instId });
const life2 = g.players[1].life;
act(g, 0, { type: 'castSpell', instId: shock.instId, targets: [{ type: 'player', seat: 1 }] });
act(g, 0, { type: 'passPriority' });
act(g, 1, { type: 'passPriority' });
assert(g.players[1].life === life2 - 2, 'shock dealt 2 to player');
assert(alice.graveyard.some(c => c.cardId === 'shock'), 'shock in graveyard');

console.log('— blocking & mutual lethal damage —');
// give bob a bear, alice attacks with the zealot into it this turn
const bob = g.players[1];
bob.battlefield.push({ instId: 'bear1', cardId: 'bramble_bear', owner: 1, tapped: false, summoningSick: false, damage: 0, pumpPower: 0, pumpToughness: 0, counters: 0 });
assert(passUntil(() => g.activePlayer === 0 && g.step === 'combat_attackers'), 'reached attack step');
const z2 = alice.battlefield.find(c => c.cardId === 'flame_zealot');
act(g, 0, { type: 'declareAttackers', attackers: [z2.instId], defender: 1 });
act(g, 0, { type: 'passPriority' });
act(g, 1, { type: 'passPriority' });
assert(g.step === 'combat_blockers', 'now in blockers step');
act(g, 1, { type: 'declareBlockers', blocks: { [z2.instId]: ['bear1'] } });
assert(passUntil(() => g.step === 'main2'), 'combat finished');
assert(!alice.battlefield.some(c => c.cardId === 'flame_zealot'), '2/1 died to 2/2 blocker');
assert(alice.graveyard.some(c => c.cardId === 'flame_zealot'), 'dead creature in graveyard');
assert(!bob.battlefield.some(c => c.cardId === 'bramble_bear'), '2/2 also died to 2 lethal damage');
assert(bob.graveyard.some(c => c.cardId === 'bramble_bear'), 'bear in graveyard');

console.log('— view redaction —');
const v0 = viewFor(g, 0);
const v1 = viewFor(g, 1);
assert(v0.players[1].hand.every(c => c.hidden), "opponent's hand hidden");
assert(v0.players[0].hand.every(c => c.cardId), 'own hand visible');
assert(viewFor(g, -1).players.every(p => p.hand.every(c => c.hidden)), 'spectator sees no hands');

console.log('— concession ends game —');
act(g, 1, { type: 'concede' });
assert(g.phase === 'over' && g.winner === 0, 'Alice wins after Bob concedes');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll engine checks passed.');
process.exit(failures ? 1 : 0);
