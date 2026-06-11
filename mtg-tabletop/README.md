# Planar Table — a 3D browser tabletop for Magic: The Gathering

A Tabletop Simulator-style 3D multiplayer game in the browser, specialized for
Magic: The Gathering. Players sit at fixed first-person seats around a table
that scales with the player count, play real games of Magic through a
server-authoritative rules engine, see each other's webcam feeds on their
avatars' faces — and, when diplomacy fails, switch to a secondary FPS mode to
shoot, throw knives, hurl sandals, and slam the table.

![Seated play](docs/seated-play.png)
![Four player table](docs/table-4p.png)

## Quick start

```bash
cd mtg-tabletop
npm install
npm start          # builds the client and serves at http://localhost:8080
# or, during development:
npm run dev        # same server with Vite middleware (no build step, hot reload)
```

Open `http://localhost:8080`, **Host game** (2–6 seats), share the 4-letter
room code; friends **Join as player** or **Join as spectator**. The host can
also **Add practice bot** to try things solo.

`npm test` runs the rules-engine smoke test. `npm run test:visual` drives the
whole game in headless Chrome and writes screenshots to `screens/`
(requires `npm i --no-save puppeteer` first, and the server running).

## How it plays

### Primary mode — playing Magic (the cards come first)
Your view is locked to your seat in first person; the cursor gently steers the
camera. Click cards in your hand fan to play lands or cast spells, click your
lands to tap them for mana (an Arena-style auto-tapper also pays costs
automatically), click creatures to declare attackers/blockers, click avatars or
life chips to choose targets and defenders.

The rules engine is server-authoritative and implements the core of Magic the
way MTG Arena does:

- Zones: library, hand, battlefield, graveyard, exile, and **the stack**
- London-style opening hands with mulligans, hidden information properly
  redacted per player (opponents and spectators never receive your hand)
- Full turn structure: untap → upkeep → draw → main 1 → combat
  (begin/attackers/blockers/damage/end) → main 2 → end → cleanup with
  discard-to-7
- Priority passing with Arena-style auto-yield (stops at your main phases,
  combat declarations, and whenever an opponent's spell is on the stack;
  a **Full control** toggle disables all auto-passing)
- Casting at sorcery/instant speed, counterspells, targeting validation,
  one-land-per-turn, mana pools that empty between steps
- Combat with summoning sickness, haste, flying/reach, vigilance, trample,
  deathtouch, lifelink, can't-block, multi-blocker damage assignment
- State-based actions: lethal damage, zero toughness, life loss, decking
- Multiplayer free-for-all (2–6 players): pick the defending player each combat
- ETB triggers, life gain/drain, card draw, pumps, destruction, exile
- Win/loss, concession, and spectator-safe views

Cards animate physically — drawn from the deck stack with an arc, cast onto a
floating stack spiral above the table, tap by rotating sideways, die by
sinking away — generic but lively motion on every game action.

The included set is a self-contained starter cube (5 colors, ~30 cards) with
five prebuilt 40-card decks. It is **not** the full Magic card pool — the
engine implements the core Arena ruleset, and new cards are added as data in
`shared/cards.js`.

### Secondary mode — table antics (press **Tab**)

![FPS mode](docs/fps-mode.png)

Pointer-locked FPS view from your seat (you still can't leave your chair —
just like Tabletop Simulator, the table is your world):

- **1** Hand Cannon (hitscan, tracer, muzzle flash, recoil)
- **2** Throwing Knife (spinning projectile with gravity)
- **3** Sandal of Justice (the classic chancla, arcs beautifully)
- **F** Table slam — shockwave ring, screen shake, the dice and beer mug jump…
  **but cards on the table are explicitly excluded from the physics** — the
  game state is sacred
- Hits bonk opponents' avatars (comedic head knockback + sound); getting shot
  flashes your screen
- All effects are broadcast to everyone at the table and are purely cosmetic —
  they can never alter the game

Press **Esc** or **Tab** to go back to your cards.

### Spectators
Join any room as a spectator: free-fly FPS movement (**WASD + Space/C**, click
to capture the mouse) around the room. Spectators see the full table but no
hidden hands.

![Spectator](docs/spectator.png)

### Avatars, camera & voice
- Pick one of four avatar presets in the lobby (Mage / Knight / Druid / Warlock)
- Each avatar's face is a screen: when a player enables their camera, their
  **live webcam feed renders on their avatar's face** (WebRTC mesh, no media
  ever passes through the game server — it only brokers signaling)
- ⚙ A/V panel: camera on/off, microphone on/off, **switch camera/microphone
  device live** (`replaceTrack`), and mute incoming audio

## Architecture

```
mtg-tabletop/
├── shared/            # used by BOTH server and client
│   ├── cards.js       #   card database + prebuilt decks
│   └── engine.js      #   the MTG rules engine (authoritative on the server)
├── server/
│   ├── index.js       # express + ws: rooms, engine host, antics relay,
│   │                  # WebRTC signaling, practice bots, static serving
│   ├── engine.test.js # rules-engine smoke test (node)
│   └── visual.test.js # headless-Chrome end-to-end screenshot test
└── src/               # three.js client
    ├── scene/         # world/table/seats, card meshes + tweens, hand fan,
    │                  # avatars (video faces), antics effects + WebAudio sfx
    ├── controls/      # seat rig, play/FPS/spectator modes, weapon viewmodels
    ├── net/           # ws client, WebRTC media mesh
    └── ui/            # HUD (phases, life, mana, prompts, log)
```

- The server owns the game state. Clients send `{type:'action', …}` messages;
  the engine validates them (you can't cheat from the client) and everyone
  receives a per-player **redacted view** plus animation events.
- Antics (`gun`/`throw`/`slam`) are a separate ephemeral channel that never
  touches the engine.
- Rendering aims at "max efficient but modern": ACES filmic tone mapping,
  PCF soft shadows, PMREM environment lighting, procedural PBR wood/felt
  textures and procedurally drawn card faces (zero external assets — works
  fully offline), pixel-ratio capping, and a single draw call per card.
