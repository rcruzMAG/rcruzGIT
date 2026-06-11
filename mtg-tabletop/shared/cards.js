// Built-in starter card set + preconstructed decks.
// Card shape:
//   id, name, types[], subtype, cost {W,U,B,R,G,C generic}, color,
//   power/toughness (creatures), keywords[], text,
//   effect (instants/sorceries): { kind, amount, targets:[targetSpec] }
// Target specs: 'any' (creature or player), 'creature', 'player', 'spell'

export const CARDS = {};
function def(card) { CARDS[card.id] = card; return card; }

// Dynamic registry: cards resolved from Scryfall at runtime are registered
// here (server-side at import, client-side from the defs the server sends).
// This keeps the built-in set tiny — the full card pool stays on Scryfall.
export function registerCards(defs) {
  for (const [id, card] of Object.entries(defs || {})) CARDS[id] = card;
}

// ---------------------------------------------------------------- lands
for (const [id, name, color] of [
  ['plains', 'Plains', 'W'], ['island', 'Island', 'U'], ['swamp', 'Swamp', 'B'],
  ['mountain', 'Mountain', 'R'], ['forest', 'Forest', 'G'],
]) {
  def({ id, name, types: ['land'], subtype: 'Basic Land', color, mana: color,
        text: `{T}: Add {${color}}.` });
}

// ---------------------------------------------------------------- creatures
def({ id: 'goblin_raider', name: 'Goblin Raider', types: ['creature'], subtype: 'Goblin Warrior',
      cost: { R: 1, generic: 1 }, color: 'R', power: 2, toughness: 2, keywords: [],
      text: "Can't block." , cantBlock: true });
def({ id: 'flame_zealot', name: 'Flame Zealot', types: ['creature'], subtype: 'Human Berserker',
      cost: { R: 1 }, color: 'R', power: 2, toughness: 1, keywords: ['haste'],
      text: 'Haste' });
def({ id: 'ember_drake', name: 'Ember Drake', types: ['creature'], subtype: 'Drake',
      cost: { R: 2, generic: 2 }, color: 'R', power: 3, toughness: 2, keywords: ['flying'],
      text: 'Flying' });
def({ id: 'cinder_giant', name: 'Cinder Giant', types: ['creature'], subtype: 'Giant',
      cost: { R: 2, generic: 3 }, color: 'R', power: 5, toughness: 4, keywords: [],
      text: '' });
def({ id: 'kindled_hurler', name: 'Kindled Hurler', types: ['creature'], subtype: 'Goblin Shaman',
      cost: { R: 1, generic: 2 }, color: 'R', power: 3, toughness: 2, keywords: [],
      etb: { kind: 'damage', amount: 1, targets: ['any'] },
      text: 'When this creature enters, it deals 1 damage to any target.' });

def({ id: 'glade_sentinel', name: 'Glade Sentinel', types: ['creature'], subtype: 'Elf Warrior',
      cost: { G: 1 }, color: 'G', power: 1, toughness: 2, keywords: ['vigilance'],
      text: 'Vigilance' });
def({ id: 'bramble_bear', name: 'Bramble Bear', types: ['creature'], subtype: 'Bear',
      cost: { G: 1, generic: 1 }, color: 'G', power: 2, toughness: 2, keywords: [],
      text: '' });
def({ id: 'canopy_stalker', name: 'Canopy Stalker', types: ['creature'], subtype: 'Spider',
      cost: { G: 1, generic: 2 }, color: 'G', power: 2, toughness: 4, keywords: ['reach'],
      text: 'Reach' });
def({ id: 'elder_wurm', name: 'Elder Wurm', types: ['creature'], subtype: 'Wurm',
      cost: { G: 2, generic: 4 }, color: 'G', power: 6, toughness: 6, keywords: ['trample'],
      text: 'Trample' });
def({ id: 'verdant_healer', name: 'Verdant Healer', types: ['creature'], subtype: 'Dryad Druid',
      cost: { G: 1, generic: 1 }, color: 'G', power: 1, toughness: 3, keywords: [],
      etb: { kind: 'lifegain', amount: 3, targets: [] },
      text: 'When this creature enters, you gain 3 life.' });

def({ id: 'dawn_recruit', name: 'Dawn Recruit', types: ['creature'], subtype: 'Human Soldier',
      cost: { W: 1 }, color: 'W', power: 1, toughness: 2, keywords: [],
      text: '' });
def({ id: 'gryff_rider', name: 'Gryff Rider', types: ['creature'], subtype: 'Human Knight',
      cost: { W: 1, generic: 2 }, color: 'W', power: 2, toughness: 2, keywords: ['flying'],
      text: 'Flying' });
def({ id: 'shield_captain', name: 'Shield Captain', types: ['creature'], subtype: 'Human Soldier',
      cost: { W: 2, generic: 1 }, color: 'W', power: 3, toughness: 3, keywords: ['vigilance'],
      text: 'Vigilance' });
def({ id: 'sun_seraph', name: 'Sun Seraph', types: ['creature'], subtype: 'Angel',
      cost: { W: 2, generic: 3 }, color: 'W', power: 4, toughness: 4, keywords: ['flying', 'lifelink'],
      text: 'Flying, lifelink' });

def({ id: 'tide_apprentice', name: 'Tide Apprentice', types: ['creature'], subtype: 'Merfolk Wizard',
      cost: { U: 1 }, color: 'U', power: 1, toughness: 1, keywords: [],
      etb: { kind: 'draw', amount: 1, targets: [] },
      text: 'When this creature enters, draw a card.' });
def({ id: 'frost_sentry', name: 'Frost Sentry', types: ['creature'], subtype: 'Elemental',
      cost: { U: 1, generic: 1 }, color: 'U', power: 2, toughness: 3, keywords: ['vigilance'],
      text: 'Vigilance' });
def({ id: 'cloud_djinn', name: 'Cloud Djinn', types: ['creature'], subtype: 'Djinn',
      cost: { U: 2, generic: 2 }, color: 'U', power: 3, toughness: 3, keywords: ['flying'],
      text: 'Flying' });

def({ id: 'crypt_ghoul', name: 'Crypt Ghoul', types: ['creature'], subtype: 'Zombie',
      cost: { B: 1 }, color: 'B', power: 2, toughness: 1, keywords: [],
      text: '' });
def({ id: 'gutter_skulker', name: 'Gutter Skulker', types: ['creature'], subtype: 'Rat Rogue',
      cost: { B: 1, generic: 1 }, color: 'B', power: 2, toughness: 1, keywords: ['deathtouch'],
      text: 'Deathtouch' });
def({ id: 'bog_stalker', name: 'Bog Stalker', types: ['creature'], subtype: 'Horror',
      cost: { B: 1, generic: 2 }, color: 'B', power: 3, toughness: 3, keywords: [],
      text: '' });
def({ id: 'dread_vampire', name: 'Dread Vampire', types: ['creature'], subtype: 'Vampire',
      cost: { B: 2, generic: 2 }, color: 'B', power: 4, toughness: 3, keywords: ['lifelink'],
      text: 'Lifelink' });

// ---------------------------------------------------------------- spells
def({ id: 'shock', name: 'Shock', types: ['instant'], cost: { R: 1 }, color: 'R',
      effect: { kind: 'damage', amount: 2, targets: ['any'] },
      text: 'Shock deals 2 damage to any target.' });
def({ id: 'lightning_strike', name: 'Lightning Strike', types: ['instant'], cost: { R: 1, generic: 1 }, color: 'R',
      effect: { kind: 'damage', amount: 3, targets: ['any'] },
      text: 'Lightning Strike deals 3 damage to any target.' });
def({ id: 'giant_growth', name: 'Giant Growth', types: ['instant'], cost: { G: 1 }, color: 'G',
      effect: { kind: 'pump', power: 3, toughness: 3, targets: ['creature'] },
      text: 'Target creature gets +3/+3 until end of turn.' });
def({ id: 'rabid_bite', name: 'Rabid Bite', types: ['sorcery'], cost: { G: 1, generic: 1 }, color: 'G',
      effect: { kind: 'fight_oneway', targets: ['friendly_creature', 'enemy_creature'] },
      text: 'Target creature you control deals damage equal to its power to target creature you don’t control.' });
def({ id: 'divination', name: 'Divination', types: ['sorcery'], cost: { U: 1, generic: 2 }, color: 'U',
      effect: { kind: 'draw', amount: 2, targets: [] },
      text: 'Draw two cards.' });
def({ id: 'cancel', name: 'Cancel', types: ['instant'], cost: { U: 2, generic: 1 }, color: 'U',
      effect: { kind: 'counter', targets: ['spell'] },
      text: 'Counter target spell.' });
def({ id: 'essence_scatter', name: 'Essence Scatter', types: ['instant'], cost: { U: 1, generic: 1 }, color: 'U',
      effect: { kind: 'counter', onlyCreature: true, targets: ['spell'] },
      text: 'Counter target creature spell.' });
def({ id: 'murder', name: 'Murder', types: ['instant'], cost: { B: 2, generic: 1 }, color: 'B',
      effect: { kind: 'destroy', targets: ['creature'] },
      text: 'Destroy target creature.' });
def({ id: 'duress_bolt', name: 'Grim Bargain', types: ['sorcery'], cost: { B: 1, generic: 1 }, color: 'B',
      effect: { kind: 'drain', amount: 2, targets: ['player'] },
      text: 'Target player loses 2 life and you gain 2 life.' });
def({ id: 'pacify', name: 'Banishing Light', types: ['sorcery'], cost: { W: 1, generic: 2 }, color: 'W',
      effect: { kind: 'exile', targets: ['creature'] },
      text: 'Exile target creature.' });
def({ id: 'inspired_charge', name: 'Inspired Charge', types: ['instant'], cost: { W: 2, generic: 2 }, color: 'W',
      effect: { kind: 'pump_all', power: 2, toughness: 1, targets: [] },
      text: 'Creatures you control get +2/+1 until end of turn.' });
def({ id: 'revitalize', name: 'Revitalize', types: ['instant'], cost: { W: 1, generic: 1 }, color: 'W',
      effect: { kind: 'lifegain_draw', amount: 3, targets: [] },
      text: 'You gain 3 life. Draw a card.' });

// ---------------------------------------------------------------- decks
function deck(entries) {
  const list = [];
  for (const [id, n] of entries) for (let i = 0; i < n; i++) list.push(id);
  return list;
}

// 40-card limited-style decks: 17 lands + 23 spells. Quick, swingy games.
export const DECKS = {
  red_aggro: {
    name: 'Mono-Red Blitz', color: 'R',
    cards: deck([
      ['mountain', 17], ['flame_zealot', 4], ['goblin_raider', 4], ['kindled_hurler', 3],
      ['ember_drake', 3], ['cinder_giant', 2], ['shock', 4], ['lightning_strike', 3],
    ]),
  },
  green_stompy: {
    name: 'Green Stompy', color: 'G',
    cards: deck([
      ['forest', 17], ['glade_sentinel', 4], ['bramble_bear', 4], ['verdant_healer', 3],
      ['canopy_stalker', 3], ['elder_wurm', 2], ['giant_growth', 4], ['rabid_bite', 3],
    ]),
  },
  white_weenie: {
    name: 'White Order', color: 'W',
    cards: deck([
      ['plains', 17], ['dawn_recruit', 4], ['gryff_rider', 4], ['shield_captain', 3],
      ['sun_seraph', 2], ['pacify', 3], ['inspired_charge', 3], ['revitalize', 4],
    ]),
  },
  blue_tempo: {
    name: 'Azure Tempo', color: 'U',
    cards: deck([
      ['island', 17], ['tide_apprentice', 4], ['frost_sentry', 4], ['cloud_djinn', 4],
      ['divination', 4], ['cancel', 3], ['essence_scatter', 4],
    ]),
  },
  black_control: {
    name: 'Black Attrition', color: 'B',
    cards: deck([
      ['swamp', 17], ['crypt_ghoul', 4], ['gutter_skulker', 4], ['bog_stalker', 4],
      ['dread_vampire', 4], ['murder', 4], ['duress_bolt', 3],
    ]),
  },
};

// Small default sideboards so the zone is populated even without imports.
DECKS.red_aggro.sideboard = deck([['shock', 2], ['cinder_giant', 2], ['ember_drake', 1]]);
DECKS.green_stompy.sideboard = deck([['rabid_bite', 2], ['elder_wurm', 1], ['canopy_stalker', 2]]);
DECKS.white_weenie.sideboard = deck([['pacify', 2], ['revitalize', 1], ['sun_seraph', 2]]);
DECKS.blue_tempo.sideboard = deck([['essence_scatter', 2], ['cancel', 2], ['cloud_djinn', 1]]);
DECKS.black_control.sideboard = deck([['murder', 2], ['duress_bolt', 2], ['dread_vampire', 1]]);

// Safety: pad/trim to exactly 40 with the deck's basic land.
const BASIC_BY_COLOR = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };
for (const d of Object.values(DECKS)) {
  const basic = BASIC_BY_COLOR[d.color];
  while (d.cards.length < 40) d.cards.push(basic);
  d.cards.length = 40;
}

export function manaCostString(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.generic) parts.push(String(cost.generic));
  for (const c of ['W', 'U', 'B', 'R', 'G']) for (let i = 0; i < (cost[c] || 0); i++) parts.push(c);
  return parts.join('');
}

export function manaValue(cost) {
  if (!cost) return 0;
  return (cost.generic || 0) + ['W', 'U', 'B', 'R', 'G', 'C']
    .reduce((s, c) => s + (cost[c] || 0), 0);
}
