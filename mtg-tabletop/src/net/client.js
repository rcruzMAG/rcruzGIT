// Thin WebSocket client with typed message handlers.

export class NetClient {
  constructor() {
    this.handlers = {};
    this.id = null;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('Cannot reach the game server'));
    });
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'joined') this.id = msg.id;
      this.handlers[msg.type]?.(msg);
    };
    this.ws.onclose = () => this.handlers.disconnected?.();
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  send(msg) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  host(opts) { this.send({ type: 'host', ...opts }); }
  join(opts) { this.send({ type: 'join', ...opts }); }
  spectate(opts) { this.send({ type: 'spectate', ...opts }); }
  start() { this.send({ type: 'start' }); }
  addBot() { this.send({ type: 'addBot' }); }
  setProfile(p) { this.send({ type: 'setProfile', ...p }); }
  action(action) { this.send({ type: 'action', action }); }
  antic(antic) { this.send({ type: 'antic', antic }); }
  rtc(to, data) { this.send({ type: 'rtc', to, data }); }
  importDeck(list) { this.send({ type: 'importDeck', list }); }
  setEnv(name) { this.send({ type: 'setEnv', name }); }
}
