// On-demand Scryfall card import. Decklists are resolved through the
// /cards/collection batch endpoint (75 identifiers per request), converted to
// the engine's card format, and cached in memory + on disk — the full card
// database is never stored, only the cards players actually use.
//
// Supported imports:
//   · any creature (cost, P/T, plus the keywords the engine implements)
//   · lands that tap for a single color (incl. all basics)
//   · instants/sorceries whose oracle text matches a supported effect pattern
// Anything else is reported back as an unsupported-card error.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '.scryfall-cache.json');
const API = 'https://api.scryfall.com';
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'PlanarTable/1.0 (3D MTG tabletop)',
};

const SUPPORTED_KEYWORDS = ['flying', 'haste', 'vigilance', 'reach', 'trample', 'deathtouch', 'lifelink'];

// name(lower) -> converted def, or { error } for known-unsupported cards
const cache = new Map();
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  for (const [k, v] of Object.entries(raw)) cache.set(k, v);
} catch { /* no cache yet */ }

let saveTimer = null;
function persistCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)), () => {});
  }, 1500);
}

// ------------------------------------------------------------------ parsing

// "4 Lightning Strike" / "4x Lightning Strike" / "Lightning Strike"
// A "Sideboard" / "// Sideboard" line switches to the sideboard section.
export function parseDecklist(text) {
  const main = [], side = [];
  let target = main;
  for (let line of String(text).split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^(\/\/\s*)?sideboard\b/i.test(line)) { target = side; continue; }
    const m = line.match(/^(\d+)x?\s+(.+)$/) || [null, '1', line];
    const count = Math.min(99, parseInt(m[1], 10) || 1);
    // strip set/collector suffixes like "(M21) 161"
    const name = m[2].replace(/\s*\([A-Z0-9]{2,5}\)\s*[\w-]*\s*$/i, '').trim();
    if (name) target.push({ name, count });
  }
  return { main, side };
}

// ------------------------------------------------------------------ convert

function parseManaCost(str) {
  if (!str) return {};
  const cost = {};
  for (const sym of str.match(/\{[^}]+\}/g) || []) {
    const s = sym.slice(1, -1);
    if (/^\d+$/.test(s)) cost.generic = (cost.generic || 0) + parseInt(s, 10);
    else if (['W', 'U', 'B', 'R', 'G'].includes(s)) cost[s] = (cost[s] || 0) + 1;
    else if (s === 'C') cost.generic = (cost.generic || 0) + 1;
    else cost.generic = (cost.generic || 0) + 1;   // X / hybrid / phyrexian → approximated as generic
  }
  return cost;
}

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
function num(s) { return NUM_WORDS[s] ?? parseInt(s, 10); }

// Map simple oracle text to an engine effect. Returns null if unsupported.
function parseSpellEffect(oracle) {
  const t = oracle.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = t.match(/deals? (\d+) damage to any target/i)))
    return { kind: 'damage', amount: +m[1], targets: ['any'] };
  if ((m = t.match(/deals? (\d+) damage to target creature or pla(?:yer|neswalker)/i)))
    return { kind: 'damage', amount: +m[1], targets: ['any'] };
  if ((m = t.match(/deals? (\d+) damage to target creature/i)))
    return { kind: 'damage', amount: +m[1], targets: ['creature'] };
  if ((m = t.match(/deals? (\d+) damage to target player/i)))
    return { kind: 'damage', amount: +m[1], targets: ['player'] };
  if ((m = t.match(/^draw (\w+) cards?\.?$/i)))
    return { kind: 'draw', amount: num(m[1]), targets: [] };
  if ((m = t.match(/^you gain (\d+) life\. draw a card\.?$/i)))
    return { kind: 'lifegain_draw', amount: +m[1], targets: [] };
  if ((m = t.match(/^you gain (\d+) life\.?$/i)))
    return { kind: 'lifegain', amount: +m[1], targets: [] };
  if (/^destroy target creature\.?$/i.test(t))
    return { kind: 'destroy', targets: ['creature'] };
  if (/^exile target creature\.?$/i.test(t))
    return { kind: 'exile', targets: ['creature'] };
  if (/^counter target spell\.?$/i.test(t))
    return { kind: 'counter', targets: ['spell'] };
  if (/^counter target creature spell\.?$/i.test(t))
    return { kind: 'counter', onlyCreature: true, targets: ['spell'] };
  if ((m = t.match(/^target creature gets \+(\d+)\/\+(\d+) until end of turn\.?$/i)))
    return { kind: 'pump', power: +m[1], toughness: +m[2], targets: ['creature'] };
  if ((m = t.match(/^creatures you control get \+(\d+)\/\+(\d+) until end of turn\.?$/i)))
    return { kind: 'pump_all', power: +m[1], toughness: +m[2], targets: [] };
  if ((m = t.match(/target player loses (\d+) life and you gain \1 life/i)))
    return { kind: 'drain', amount: +m[1], targets: ['player'] };
  return null;
}

function convertCard(sc) {
  const face = sc.card_faces?.[0] && !sc.mana_cost ? sc.card_faces[0] : sc;
  const typeLine = (sc.type_line || face.type_line || '').toLowerCase();
  const oracle = face.oracle_text || sc.oracle_text || '';
  const name = sc.name;
  const id = 'sf_' + sc.id;
  const imageUrl = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || null;
  const colors = face.colors?.length ? face.colors : (sc.color_identity || []);
  const color = colors.length === 1 ? colors[0] : (colors.length === 0 ? 'C' : colors[0]);

  const base = { id, name, imageUrl, color, text: oracle, scryfall: true };

  if (typeLine.includes('land')) {
    // single-color tap lands only (covers all basics + many duals' first mode)
    const m = oracle.match(/\{T\}: Add \{([WUBRG])\}/i) ||
      (/^basic land/i.test(sc.type_line) && { 1: { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }[name.split(' ').pop()] });
    if (!m || !m[1]) return { error: `${name}: only lands that tap for a single color are supported` };
    return { ...base, types: ['land'], subtype: sc.type_line, mana: m[1].toUpperCase(), cost: undefined };
  }

  const cost = parseManaCost(face.mana_cost || sc.mana_cost);

  if (typeLine.includes('creature')) {
    const p = parseInt(face.power ?? sc.power, 10);
    const tns = parseInt(face.toughness ?? sc.toughness, 10);
    if (Number.isNaN(p) || Number.isNaN(tns)) return { error: `${name}: */* stats are not supported` };
    const keywords = (sc.keywords || []).map(k => k.toLowerCase()).filter(k => SUPPORTED_KEYWORDS.includes(k));
    return {
      ...base, types: ['creature'], subtype: sc.type_line.split('—')[1]?.trim() || '',
      cost, power: p, toughness: tns, keywords,
      cantBlock: /can't block/i.test(oracle),
      // unsupported abilities are kept as flavor text; the creature plays as
      // its stats + supported keywords
    };
  }

  if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
    const effect = parseSpellEffect(oracle);
    if (!effect) return { error: `${name}: effect not supported by the engine yet` };
    return { ...base, types: [typeLine.includes('instant') ? 'instant' : 'sorcery'], cost, effect };
  }

  return { error: `${name}: ${sc.type_line} cards are not supported yet` };
}

// ------------------------------------------------------------------ fetch

async function fetchCollection(names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 75) {
    const batch = names.slice(i, i + 75);
    const res = await fetch(`${API}/cards/collection`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    const json = await res.json();
    for (const card of json.data || []) out.set(card.name.toLowerCase(), card);
    // also map by requested name for fuzzy-ish hits (split cards etc.)
    for (const nf of json.not_found || []) out.set(nf.name.toLowerCase(), null);
  }
  return out;
}

// Resolve a decklist text into { deck, sideboard, defs, errors }.
export async function resolveDecklist(text) {
  const { main, side } = parseDecklist(text);
  if (!main.length) return { errors: ['Decklist is empty'] };
  const totalMain = main.reduce((s, e) => s + e.count, 0);
  if (totalMain < 40) return { errors: [`Deck needs at least 40 cards (got ${totalMain})`] };
  if (totalMain > 250) return { errors: ['Deck too large (max 250)'] };

  const wanted = [...new Set([...main, ...side].map(e => e.name.toLowerCase()))];
  const misses = wanted.filter(n => !cache.has(n));
  if (misses.length) {
    const fetched = await fetchCollection(misses);
    for (const n of misses) {
      const sc = fetched.get(n);
      cache.set(n, sc ? convertCard(sc) : { error: `Card not found on Scryfall: "${n}"` });
    }
    persistCache();
  }

  const errors = [];
  const defs = {};
  const build = (entries) => {
    const ids = [];
    for (const { name, count } of entries) {
      const def = cache.get(name.toLowerCase());
      if (!def || def.error) { errors.push(def?.error || `Not found: ${name}`); continue; }
      defs[def.id] = def;
      for (let i = 0; i < count; i++) ids.push(def.id);
    }
    return ids;
  };
  const deck = build(main);
  const sideboard = build(side);
  if (errors.length) return { errors: [...new Set(errors)] };
  return { deck, sideboard, defs, errors: [] };
}
