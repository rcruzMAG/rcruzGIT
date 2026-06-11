// Scryfall importer test: decklist parsing (offline) + live resolution.
// Run: node server/scryfall.test.js

import { parseDecklist, resolveDecklist } from './scryfall.js';

let failures = 0;
const assert = (c, m) => { c ? console.log('  ✓ ' + m) : (failures++, console.error('  ✗ ' + m)); };

console.log('— decklist parsing —');
const parsed = parseDecklist(`
# my deck
17 Mountain
4x Lightning Strike
Shock (M21) 159

Sideboard
3 Shock
`);
assert(parsed.main.length === 3, 'three main entries');
assert(parsed.main[0].count === 17 && parsed.main[0].name === 'Mountain', '17 Mountain');
assert(parsed.main[1].count === 4 && parsed.main[1].name === 'Lightning Strike', '4x syntax');
assert(parsed.main[2].count === 1 && parsed.main[2].name === 'Shock', 'set/collector suffix stripped, default count 1');
assert(parsed.side.length === 1 && parsed.side[0].count === 3, 'sideboard section');

console.log('— live resolution (requires network) —');
const result = await resolveDecklist(`
17 Mountain
8 Shock
4 Lightning Strike
4 Grizzly Bears
4 Fugitive Wizard
3 Murder
Sideboard
2 Cancel
`);
if (result.errors.length) {
  console.log('  (skipping live checks: ' + result.errors.join('; ') + ')');
} else {
  assert(result.deck.length === 40, `deck has 40 cards (got ${result.deck.length})`);
  assert(result.sideboard.length === 2, 'sideboard has 2 cards');
  const defs = Object.values(result.defs);
  const mountain = defs.find(d => d.name === 'Mountain');
  assert(mountain?.types.includes('land') && mountain.mana === 'R', 'Mountain → red source');
  const bears = defs.find(d => d.name === 'Grizzly Bears');
  assert(bears?.power === 2 && bears?.toughness === 2, 'Grizzly Bears 2/2');
  const strike = defs.find(d => d.name === 'Lightning Strike');
  assert(strike?.effect?.kind === 'damage' && strike.effect.amount === 3 && strike.effect.targets[0] === 'any',
    'Lightning Strike → 3 damage any target');
  const murder = defs.find(d => d.name === 'Murder');
  assert(murder?.effect?.kind === 'destroy', 'Murder → destroy creature');
  const cancel = defs.find(d => d.name === 'Cancel');
  assert(cancel?.effect?.kind === 'counter', 'Cancel → counterspell');
  assert(defs.every(d => d.imageUrl), 'all defs carry Scryfall images');

  // unsupported cards are reported, not silently broken
  const bad = await resolveDecklist('40 Black Lotus\n4 Tarmogoyf');
  assert(bad.errors.length > 0, 'unsupported cards produce errors: ' + (bad.errors[0] || ''));

  // cache hit path
  const again = await resolveDecklist('40 Mountain');
  assert(again.deck.length === 40 && !again.errors.length, 'cached re-resolution works');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll scryfall checks passed.');
process.exit(failures ? 1 : 0);
