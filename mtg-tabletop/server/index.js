// Game server: serves the client, manages rooms (host/join/spectate),
// runs the authoritative MTG engine per room, relays FPS-antics events,
// and acts as the WebRTC signaling broker for camera/mic feeds.

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGame, applyAction, viewFor, drainEvents } from '../shared/engine.js';
import { DECKS, registerCards } from '../shared/cards.js';
import { resolveDecklist } from './scryfall.js';

const ENV_NAMES = ['tavern', 'living_room', 'beach', 'market', 'mountain', 'jungle'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.argv.includes('--dev');
const PORT = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ------------------------------------------------------------------ rooms

const rooms = new Map(); // code -> room

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function room(code) { return rooms.get((code || '').toUpperCase()); }

function broadcast(r, msg, except = null) {
  const data = JSON.stringify(msg);
  for (const m of [...r.players, ...r.spectators]) {
    if (m.ws !== except && m.ws.readyState === 1) m.ws.send(data);
  }
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function roomInfo(r) {
  return {
    code: r.code,
    maxSeats: r.maxSeats,
    started: !!r.game,
    environment: r.environment,
    players: r.players.map(p => ({
      id: p.id, name: p.name, seat: p.seat, avatar: p.avatar, deck: p.deck,
      deckLabel: p.customDeck ? `Custom · ${p.customDeck.deck.length} cards` : (DECKS[p.deck]?.name ?? ''),
      isHost: p.id === r.hostId, connected: p.ws.readyState === 1,
      camOn: p.camOn, micOn: p.micOn, isBot: !!p.isBot,
    })),
    spectators: r.spectators.map(s => ({ id: s.id, name: s.name })),
  };
}

function broadcastRoom(r) { broadcast(r, { type: 'room', room: roomInfo(r) }); }

function broadcastGame(r) {
  if (!r.game) return;
  const events = drainEvents(r.game);
  for (const m of [...r.players, ...r.spectators]) {
    send(m.ws, {
      type: 'game',
      view: viewFor(r.game, m.seat ?? -1),
      events,
    });
  }
}

// Bots: auto-keep, auto-pass, auto-discard, declare nothing. Lets a single
// human test the full loop ("Add practice bot" in the lobby).
function runBots(r) {
  if (!r.game || r.game.phase === 'over') return;
  let acted = true;
  let guard = 0;
  while (acted && guard++ < 200) {
    acted = false;
    for (const p of r.players) {
      if (!p.isBot) continue;
      const g = r.game;
      const seat = p.seat;
      if (g.phase === 'mulligan' && !g.players[seat].keptHand) {
        applyAction(g, seat, { type: 'keepHand' }); acted = true; continue;
      }
      if (g.pending && g.pending.type === 'discard' && g.pending.player === seat) {
        const ids = g.players[seat].hand.slice(0, g.pending.count).map(c => c.instId);
        applyAction(g, seat, { type: 'discard', instIds: ids }); acted = true; continue;
      }
      if (g.phase === 'playing' && g.priority === seat) {
        if (g.step === 'combat_attackers' && g.activePlayer === seat && g.combat && !g.combat.declaredAttackers) {
          applyAction(g, seat, { type: 'declareAttackers', attackers: [] });
        } else if (g.step === 'combat_blockers' && g.combat && g.combat.defender === seat && !g.combat.declaredBlockers) {
          applyAction(g, seat, { type: 'declareBlockers', blocks: {} });
        } else {
          applyAction(g, seat, { type: 'passPriority' });
        }
        acted = true;
      }
    }
  }
}

// ------------------------------------------------------------------ ws

let nextClientId = 1;

wss.on('connection', (ws) => {
  const client = { id: 'p' + (nextClientId++), ws, room: null, role: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handle(client, msg); } catch (e) {
      send(ws, { type: 'error', error: 'Server error: ' + e.message });
      console.error(e);
    }
  });

  ws.on('close', () => {
    const r = client.room;
    if (!r) return;
    r.spectators = r.spectators.filter(s => s.ws !== ws);
    const p = r.players.find(p => p.ws === ws);
    if (p) {
      if (r.game) {
        // keep seat for reconnect-less simplicity; concede if game running
        applyAction(r.game, p.seat, { type: 'concede' });
        runBots(r);
        broadcastGame(r);
        p.disconnected = true;
      } else {
        r.players = r.players.filter(x => x !== p);
        r.players.forEach((x, i) => { x.seat = i; });
      }
    }
    broadcast(r, { type: 'peerLeft', id: client.id });
    if (r.players.every(p => p.disconnected || p.isBot) && r.spectators.length === 0) {
      rooms.delete(r.code);
    } else {
      broadcastRoom(r);
    }
  });
});

function handle(client, msg) {
  const ws = client.ws;
  switch (msg.type) {
    case 'host': {
      const code = makeCode();
      const maxSeats = Math.min(6, Math.max(2, msg.maxSeats || 2));
      const r = {
        code, maxSeats, hostId: client.id,
        players: [], spectators: [], game: null,
        environment: 'tavern', cardDefs: {},
      };
      rooms.set(code, r);
      joinAsPlayer(client, r, msg);
      break;
    }
    case 'join': {
      const r = room(msg.code);
      if (!r) return send(ws, { type: 'error', error: 'Room not found' });
      if (r.game) return send(ws, { type: 'error', error: 'Game already started — join as spectator' });
      if (r.players.length >= r.maxSeats) return send(ws, { type: 'error', error: 'Table is full' });
      joinAsPlayer(client, r, msg);
      break;
    }
    case 'spectate': {
      const r = room(msg.code);
      if (!r) return send(ws, { type: 'error', error: 'Room not found' });
      const spec = { id: client.id, name: msg.name || 'Spectator', ws, seat: -1 };
      r.spectators.push(spec);
      client.room = r; client.role = 'spectator';
      send(ws, { type: 'joined', id: client.id, role: 'spectator', room: roomInfo(r), cardDefs: r.cardDefs });
      if (r.game) send(ws, { type: 'game', view: viewFor(r.game, -1), events: [] });
      broadcastRoom(r);
      break;
    }
    case 'addBot': {
      const r = client.room;
      if (!r || r.hostId !== client.id || r.game) return;
      if (r.players.length >= r.maxSeats) return;
      const decks = Object.keys(DECKS);
      r.players.push({
        id: 'bot' + Math.random().toString(36).slice(2, 7),
        name: 'Goldfish Bot', seat: r.players.length, isBot: true,
        ws: { readyState: 0, send() {} },
        avatar: Math.floor(Math.random() * 4),
        deck: decks[Math.floor(Math.random() * decks.length)],
        camOn: false, micOn: false,
      });
      broadcastRoom(r);
      break;
    }
    case 'setProfile': {
      const r = client.room;
      const p = r?.players.find(p => p.id === client.id);
      if (!p) return;
      if (msg.avatar != null) p.avatar = msg.avatar;
      if (msg.deck && DECKS[msg.deck]) p.deck = msg.deck;
      if (msg.camOn != null) p.camOn = !!msg.camOn;
      if (msg.micOn != null) p.micOn = !!msg.micOn;
      broadcastRoom(r);
      break;
    }
    case 'start': {
      const r = client.room;
      if (!r || r.hostId !== client.id) return send(ws, { type: 'error', error: 'Only the host can start' });
      if (r.game) return;
      if (r.players.length < 2) return send(ws, { type: 'error', error: 'Need at least 2 players (add a bot to practice)' });
      // collect Scryfall defs from custom decks so all clients can render them
      r.cardDefs = {};
      for (const p of r.players) {
        if (p.customDeck) Object.assign(r.cardDefs, p.customDeck.defs);
      }
      r.game = createGame(r.players.map(p => ({
        id: p.id, name: p.name,
        deck: p.customDeck ? p.customDeck.deck : DECKS[p.deck || 'red_aggro'].cards,
        sideboard: p.customDeck ? p.customDeck.sideboard : (DECKS[p.deck || 'red_aggro'].sideboard || []),
      })));
      r.players.forEach((p, i) => { p.seat = i; });
      broadcast(r, { type: 'gameStarted', room: roomInfo(r), cardDefs: r.cardDefs });
      runBots(r);
      broadcastGame(r);
      break;
    }
    // Import a decklist via Scryfall (on-demand card data, server-side cache).
    case 'importDeck': {
      const r = client.room;
      const p = r?.players.find(p => p.id === client.id);
      if (!p || r.game) return;
      resolveDecklist(msg.list).then((result) => {
        if (result.errors.length) {
          return send(ws, { type: 'deckImported', ok: false, errors: result.errors.slice(0, 8) });
        }
        registerCards(result.defs);   // engine needs the defs server-side
        p.customDeck = result;
        send(ws, {
          type: 'deckImported', ok: true,
          count: result.deck.length, sideboard: result.sideboard.length,
        });
        broadcastRoom(r);
      }).catch((e) => {
        send(ws, { type: 'deckImported', ok: false, errors: ['Scryfall unreachable: ' + e.message] });
      });
      break;
    }
    // Any player (or spectator) can change the scene around the table.
    case 'setEnv': {
      const r = client.room;
      if (!r || !ENV_NAMES.includes(msg.name)) return;
      r.environment = msg.name;
      broadcast(r, { type: 'env', name: msg.name, by: nameOf(r, client.id) }, ws);
      break;
    }
    case 'action': {
      const r = client.room;
      if (!r || !r.game) return;
      const p = r.players.find(p => p.id === client.id);
      if (!p) return;
      const result = applyAction(r.game, p.seat, msg.action);
      if (!result.ok) return send(ws, { type: 'actionError', error: result.error });
      runBots(r);
      broadcastGame(r);
      break;
    }
    // Ephemeral table antics: gunshots, thrown knives/sandals, table slams,
    // emotes. Pure cosmetics — relayed to everyone else, never touch game state.
    case 'antic': {
      const r = client.room;
      if (!r) return;
      broadcast(r, { type: 'antic', from: client.id, seat: seatOf(r, client.id), antic: msg.antic }, ws);
      break;
    }
    // WebRTC signaling relay for camera/mic feeds (mesh topology).
    case 'rtc': {
      const r = client.room;
      if (!r) return;
      const target = [...r.players, ...r.spectators].find(m => m.id === msg.to);
      if (target) send(target.ws, { type: 'rtc', from: client.id, data: msg.data });
      break;
    }
    case 'chat': {
      const r = client.room;
      if (!r) return;
      broadcast(r, { type: 'chat', from: client.id, seat: seatOf(r, client.id), name: nameOf(r, client.id), text: String(msg.text).slice(0, 300) });
      break;
    }
  }
}

function seatOf(r, id) { const p = r.players.find(p => p.id === id); return p ? p.seat : -1; }
function nameOf(r, id) {
  const m = [...r.players, ...r.spectators].find(m => m.id === id);
  return m ? m.name : '?';
}

function joinAsPlayer(client, r, msg) {
  const p = {
    id: client.id, name: (msg.name || 'Planeswalker').slice(0, 24), ws: client.ws,
    seat: r.players.length, avatar: msg.avatar ?? 0,
    deck: DECKS[msg.deck] ? msg.deck : 'red_aggro',
    camOn: false, micOn: false,
  };
  r.players.push(p);
  client.room = r; client.role = 'player';
  send(client.ws, { type: 'joined', id: client.id, role: 'player', seat: p.seat, room: roomInfo(r) });
  broadcastRoom(r);
}

// ------------------------------------------------------------------ http

// Scryfall's image CDN sends no CORS headers, so card scans are proxied
// through us (same-origin for the WebGL textures). Browser-cacheable.
const imgCache = new Map(); // url -> {buf, type}
app.get('/cardimg', async (req, res) => {
  let url;
  try { url = new URL(String(req.query.u || '')); } catch { return res.status(400).end(); }
  if (url.hostname !== 'cards.scryfall.io') return res.status(403).end();
  try {
    let entry = imgCache.get(url.href);
    if (!entry) {
      const r = await fetch(url, { headers: { 'User-Agent': 'PlanarTable/1.0' } });
      if (!r.ok) return res.status(r.status).end();
      entry = { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
      if (imgCache.size > 600) imgCache.delete(imgCache.keys().next().value);
      imgCache.set(url.href, entry);
    }
    res.set('Content-Type', entry.type);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(entry.buf);
  } catch {
    res.status(502).end();
  }
});

if (DEV) {
  // Run Vite as middleware so `npm run dev` is a single process.
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: path.join(__dirname, '..'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`MTG Tabletop ${DEV ? '(dev) ' : ''}running at http://localhost:${PORT}`);
});
