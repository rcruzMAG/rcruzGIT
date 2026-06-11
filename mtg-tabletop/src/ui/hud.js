// DOM HUD: phase tracker, player chips, mana pool, prompt + action buttons,
// and the game log. Pure rendering — interaction state lives in main.js.

import { STEPS } from '../../shared/engine.js';

const STEP_LABELS = {
  untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'Main 1',
  combat_begin: 'Combat', combat_attackers: 'Attack', combat_blockers: 'Block',
  combat_damage: 'Damage', combat_end: 'End Cbt', main2: 'Main 2',
  end: 'End', cleanup: 'Cleanup',
};
const MANA_COLORS = { W: '#f5efd9', U: '#79b3e0', B: '#8d8398', R: '#e0765a', G: '#7cb86b', C: '#c9c5bb' };

const $ = (sel) => document.querySelector(sel);

export class Hud {
  constructor() {
    this.phaseBar = $('#phaseBar');
    this.playersHud = $('#playersHud');
    this.manaHud = $('#manaHud');
    this.prompt = $('#promptLine');
    this.actionBar = $('#actionBar');
    this.logEl = $('#log');
    this.toastEl = $('#toast');
    this.lastLogLen = 0;
    this.onPlayerClick = null;

    // build phase dots once
    this.turnLabel = $('#turnLabel');
    for (const s of STEPS) {
      if (s === 'untap' || s === 'cleanup' || s === 'combat_begin' || s === 'combat_end') continue;
      const dot = document.createElement('div');
      dot.className = 'phase-dot';
      dot.dataset.step = s;
      dot.textContent = STEP_LABELS[s];
      this.phaseBar.appendChild(dot);
    }
  }

  show() { $('#hud').classList.remove('hidden'); }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show', 'panel');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  setPrompt(text) {
    this.prompt.classList.toggle('hidden', !text);
    this.prompt.textContent = text || '';
  }

  setActions(actions) {
    // actions: [{label, primary, danger, onClick, disabled}]
    this.actionBar.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      if (a.danger) b.className = 'danger';
      b.disabled = !!a.disabled;
      b.onclick = a.onClick;
      this.actionBar.appendChild(b);
    }
  }

  render(view, mySeat) {
    // phase bar
    this.turnLabel.textContent = `Turn ${view.turn} · ${view.players[view.activePlayer]?.name ?? ''}`;
    for (const dot of this.phaseBar.querySelectorAll('.phase-dot')) {
      const grouped = {
        combat_begin: 'combat_attackers', combat_end: 'combat_damage',
        untap: 'upkeep', cleanup: 'end',
      }[view.step] || view.step;
      dot.classList.toggle('active', dot.dataset.step === grouped);
    }

    // player chips
    this.playersHud.innerHTML = '';
    for (const p of view.players) {
      const chip = document.createElement('div');
      chip.className = 'pl-chip panel';
      if (p.seat === view.activePlayer) chip.classList.add('active-turn');
      if (p.seat === view.priority && view.phase === 'playing') chip.classList.add('priority');
      if (p.lost) chip.classList.add('lost');
      chip.innerHTML = `<span class="life">${p.life}</span><span class="nm">${esc(p.name)}${p.seat === mySeat ? ' (you)' : ''}</span>` +
        `<span style="color:var(--muted); font-size:11px">✋${p.handSize} 📚${p.librarySize}</span>`;
      chip.onclick = () => this.onPlayerClick?.(p.seat);
      chip.dataset.seat = p.seat;
      this.playersHud.appendChild(chip);
    }

    // mana pool
    if (mySeat >= 0 && view.players[mySeat]) {
      const pool = view.players[mySeat].manaPool;
      const pips = Object.entries(pool).filter(([, n]) => n > 0);
      this.manaHud.classList.toggle('hidden', pips.length === 0);
      this.manaHud.innerHTML = '';
      for (const [c, n] of pips) {
        for (let i = 0; i < n; i++) {
          const pip = document.createElement('div');
          pip.className = 'mana-pip';
          pip.style.background = MANA_COLORS[c];
          pip.textContent = c;
          this.manaHud.appendChild(pip);
        }
      }
    }

    // log
    if (view.log.length !== this.lastLogLen) {
      this.lastLogLen = view.log.length;
      this.logEl.innerHTML = view.log.slice(-40).map(l =>
        `<div class="${l.seat === mySeat ? 'me' : ''}">${esc(l.msg)}</div>`).join('');
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
