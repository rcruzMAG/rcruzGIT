// Procedurally synthesized ambience for the environments — looping beds
// (waves, crowd, leaves) and one-shot events (T-rex, yodel, TV, cracks).
// Every sound returns a handle with setGain()/stop() so the environment can
// drive volume by listener proximity. Zero audio assets.

import { audio } from './effects.js';

function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function looped(ctx, build) {
  // build(input) -> output node chain fed by looping noise
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 3);
  src.loop = true;
  const master = ctx.createGain();
  master.gain.value = 0;
  const out = build(src) || src;
  out.connect(master).connect(ctx.destination);
  src.start();
  return {
    setGain(g, t = 0.4) { master.gain.setTargetAtTime(g, ctx.currentTime, t); },
    stop() {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => { try { src.stop(); } catch {} master.disconnect(); }, 1200);
    },
  };
}

// ---------------------------------------------------------------- loops

export function oceanLoop() {
  const ctx = audio();
  const handle = looped(ctx, (src) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain(); lfoG.gain.value = 240;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    const swellLfo = ctx.createOscillator(); swellLfo.frequency.value = 0.07;
    const swell = ctx.createGain(); swell.gain.value = 0.5;
    const swellAmt = ctx.createGain(); swellAmt.gain.value = 0.35;
    swellLfo.connect(swellAmt).connect(swell.gain);
    swellLfo.start();
    src.connect(lp).connect(swell);
    return swell;
  });
  return handle;
}

export function crowdLoop() {
  const ctx = audio();
  // murmuring crowd: band-passed noise with syllabic wobble
  const handle = looped(ctx, (src) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 1.1;
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 950; bp2.Q.value = 1.4;
    const wob = ctx.createOscillator(); wob.type = 'sine'; wob.frequency.value = 3.1;
    const wobG = ctx.createGain(); wobG.gain.value = 0.16;
    const amp = ctx.createGain(); amp.gain.value = 0.55;
    wob.connect(wobG).connect(amp.gain); wob.start();
    src.connect(bp).connect(bp2).connect(amp);
    return amp;
  });
  return handle;
}

export function leavesLoop() {
  const ctx = audio();
  const handle = looped(ctx, (src) => {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const gustLfo = ctx.createOscillator(); gustLfo.frequency.value = 0.16;
    const amp = ctx.createGain(); amp.gain.value = 0.4;
    const gustAmt = ctx.createGain(); gustAmt.gain.value = 0.3;
    gustLfo.connect(gustAmt).connect(amp.gain); gustLfo.start();
    src.connect(hp).connect(amp);
    return amp;
  });
  return handle;
}

export function windLoop() {
  const ctx = audio();
  const handle = looped(ctx, (src) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain(); lfoG.gain.value = 170;
    lfo.connect(lfoG).connect(bp.frequency); lfo.start();
    src.connect(bp);
    return bp;
  });
  return handle;
}

// Per-NPC chitchat: soft syllabic babble, volume driven externally by distance.
export function chatterLoop(pitch = 1) {
  const ctx = audio();
  const handle = looped(ctx, (src) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = (380 + Math.random() * 320) * pitch; bp.Q.value = 4;
    const syl = ctx.createOscillator(); syl.type = 'square'; syl.frequency.value = 3.4 + Math.random() * 1.6;
    const sylG = ctx.createGain(); sylG.gain.value = 0.42;
    const amp = ctx.createGain(); amp.gain.value = 0.45;
    syl.connect(sylG).connect(amp.gain); syl.start();
    src.connect(bp).connect(amp);
    return amp;
  });
  return handle;
}

// Bird ambience: repeating chirps, gain set externally by proximity.
export function birdVoice() {
  const ctx = audio();
  const master = ctx.createGain(); master.gain.value = 0;
  master.connect(ctx.destination);
  let alive = true;
  function chirp() {
    if (!alive) return;
    const n = 2 + Math.floor(Math.random() * 3);
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = 2400 + Math.random() * 1800;
      const t = t0 + i * 0.14;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.4), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.14);
    }
    setTimeout(chirp, 800 + Math.random() * 2600);
  }
  chirp();
  return {
    setGain(g) { master.gain.setTargetAtTime(g, ctx.currentTime, 0.15); },
    stop() { alive = false; master.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(() => master.disconnect(), 800); },
  };
}

// ---------------------------------------------------------------- one-shots

export function trexRoar(distance01 = 0) {
  // distance01: 0 = right here, 1 = far away
  const ctx = audio();
  const t = ctx.currentTime;
  const dur = 2.4;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(72, t);
  o.frequency.exponentialRampToValueAtTime(38, t + dur * 0.8);
  const o2 = ctx.createOscillator(); o2.type = 'square';
  o2.frequency.setValueAtTime(55, t);
  o2.frequency.exponentialRampToValueAtTime(30, t + dur);
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, dur);
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 220; nf.Q.value = 0.7;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 900 - distance01 * 650;           // farther = muffled
  const g = ctx.createGain();
  const vol = 0.85 * (1 - distance01 * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.25);
  g.gain.setValueAtTime(vol, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(lp); o2.connect(lp); noise.connect(nf).connect(lp);
  lp.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur); o2.start(t); o2.stop(t + dur); noise.start(t);
}

export function yodel() {
  const ctx = audio();
  const t0 = ctx.currentTime + 0.05;
  // alternating chest/head pitches, run through echo delays for the valley
  const notes = [392, 523, 392, 659, 523, 784, 659, 523, 392];
  const o = ctx.createOscillator(); o.type = 'triangle';
  const g = ctx.createGain(); g.gain.value = 0;
  notes.forEach((f, i) => {
    const t = t0 + i * 0.16;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.22, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.14);
  });
  const tEnd = t0 + notes.length * 0.16;
  g.gain.linearRampToValueAtTime(0, tEnd + 0.1);
  const echo1 = ctx.createDelay(); echo1.delayTime.value = 0.5;
  const echo2 = ctx.createDelay(); echo2.delayTime.value = 1.05;
  const e1g = ctx.createGain(); e1g.gain.value = 0.4;
  const e2g = ctx.createGain(); e2g.gain.value = 0.18;
  o.connect(g);
  g.connect(ctx.destination);
  g.connect(echo1).connect(e1g).connect(ctx.destination);
  g.connect(echo2).connect(e2g).connect(ctx.destination);
  o.start(t0); o.stop(tEnd + 2);
}

export function groundCrack() {
  const ctx = audio();
  const t = ctx.currentTime;
  for (let i = 0; i < 5; i++) {
    const tt = t + i * (0.08 + Math.random() * 0.07);
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, 0.12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + Math.random() * 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 - i * 0.05, tt);
    g.gain.exponentialRampToValueAtTime(0.001, tt + 0.12);
    noise.connect(lp).connect(g).connect(ctx.destination);
    noise.start(tt);
  }
  // deep rumble underneath
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 0.85);
}

export function fallingScream() {
  const ctx = audio();
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(640, t);
  o.frequency.exponentialRampToValueAtTime(170, t + 1.5);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  const vib = ctx.createOscillator(); vib.frequency.value = 9;
  const vibG = ctx.createGain(); vibG.gain.value = 24;
  vib.connect(vibG).connect(o.frequency); vib.start(t);
  o.connect(lp).connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 1.55); vib.stop(t + 1.55);
}

export function tvBlip(durationSec = 3) {
  const ctx = audio();
  const t = ctx.currentTime;
  // static hiss bed
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, durationSec);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
  const ng = ctx.createGain(); ng.gain.value = 0.05;
  noise.connect(hp).connect(ng).connect(ctx.destination);
  noise.start(t);
  // jaunty random jingle on top
  const steps = Math.floor(durationSec / 0.21);
  const scale = [523, 587, 659, 784, 880, 1046];
  for (let i = 0; i < steps; i++) {
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = scale[Math.floor(Math.random() * scale.length)];
    const g = ctx.createGain();
    const tt = t + i * 0.21;
    g.gain.setValueAtTime(0.08, tt);
    g.gain.exponentialRampToValueAtTime(0.002, tt + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(tt); o.stop(tt + 0.2);
  }
}

export function tidalRumble(durationSec = 6) {
  const ctx = audio();
  const t = ctx.currentTime;
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, durationSec); noise.loop = false;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(180, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + durationSec * 0.55);
  lp.frequency.exponentialRampToValueAtTime(220, t + durationSec);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + durationSec * 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
  noise.connect(lp).connect(g).connect(ctx.destination);
  noise.start(t);
}
