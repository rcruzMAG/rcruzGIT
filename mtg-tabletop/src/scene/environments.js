// Switchable environments around the table. Any player can change the scene;
// the choice is synced through the server. Every environment is strictly
// audiovisual — events never touch the table, its props, or any card.
//
//  tavern       — the original dark den (default)
//  living_room  — cozy room; the TV flicks on for 3 s at ≥5 min random intervals
//  beach        — sun glare when you look up, birds with proximity audio,
//                 wave/bird ambience, a tidal wave every 5 minutes
//  market       — asian night market; crowd chatter bed + passerby NPCs whose
//                 chitchat gets louder the closer they walk
//  mountain     — summit table; passing birds, echoing yodels and unlucky
//                 hikers falling off (cracking ground), all ≥5 min intervals
//  jungle       — rustling leaves and a T-rex roaring at varying distance
//                 at ≥5 min random intervals
//
// Set `window.__envFast = true` before joining to compress the long timers
// (minutes → seconds) when testing.

import * as THREE from 'three';
import { canvasTexture, woodTexture, TABLE_Y } from './world.js';
import {
  oceanLoop, crowdLoop, leavesLoop, windLoop, chatterLoop, birdVoice,
  trexRoar, yodel, groundCrack, fallingScream, tvBlip, tidalRumble,
} from './ambience.js';

export const ENVIRONMENTS = {
  tavern: 'Tavern',
  living_room: 'Living Room',
  beach: 'Beachside',
  market: 'Asian Marketplace',
  mountain: 'Mountain Peak',
  jungle: 'Jungle',
};

const timeScale = () => (window.__envFast ? 1 / 60 : 1);

// ------------------------------------------------------------------ helpers

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
}

function groundDisc(color, radius = 22) {
  const tex = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, 512, 512, 5);
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 48),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function skyDome(topColor, bottomColor) {
  const tex = canvasTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, topColor); g.addColorStop(1, bottomColor);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, 16, 256);
  const m = new THREE.Mesh(new THREE.SphereGeometry(48, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
  return m;
}

// minimal walking NPC: body + head + bobbing
function makeNpc(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.55, 6, 12), mat(color));
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), mat(0xc9a685, { roughness: 0.7 }));
  head.position.y = 1.42;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.1, 12), mat(0xa8946a));
  hat.position.y = 1.53;
  g.add(body, head, hat);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// flapping bird: body + two wing triangles
function makeBird() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), mat(0x3a3f4a, { roughness: 0.6 }));
  body.rotation.x = Math.PI / 2;
  const wingGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0.06), new THREE.Vector3(0, 0, -0.06), new THREE.Vector3(0.34, 0, 0),
  ]);
  wingGeo.setIndex([0, 1, 2]); wingGeo.computeVertexNormals();
  const wmat = mat(0x4a505c, { side: THREE.DoubleSide, roughness: 0.6 });
  const wl = new THREE.Mesh(wingGeo, wmat);
  const wr = new THREE.Mesh(wingGeo, wmat); wr.scale.x = -1;
  g.add(body, wl, wr);
  g.userData.wings = [wl, wr];
  return g;
}

class Birds {
  constructor(group) {
    this.group = group;
    this.birds = [];
  }
  spawn() {
    const mesh = makeBird();
    const a = Math.random() * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(a) * 26, 3.5 + Math.random() * 4, Math.sin(a) * 26);
    const b = a + Math.PI + (Math.random() - 0.5) * 1.4;
    const to = new THREE.Vector3(Math.cos(b) * 26, 3 + Math.random() * 4, Math.sin(b) * 26);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.group.add(mesh);
    this.birds.push({ mesh, from, to, t: 0, speed: 0.028 + Math.random() * 0.02, voice: birdVoice(), flap: Math.random() * 9 });
  }
  update(dt, camera) {
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.t += dt * b.speed;
      b.mesh.position.lerpVectors(b.from, b.to, b.t);
      b.mesh.position.y += Math.sin(b.t * Math.PI) * 1.6; // gentle arc
      b.flap += dt * 11;
      const w = Math.sin(b.flap) * 0.8;
      b.mesh.userData.wings[0].rotation.x = w;
      b.mesh.userData.wings[1].rotation.x = -w;
      const d = b.mesh.position.distanceTo(camera.position);
      b.voice.setGain(Math.min(0.6, 3.5 / (1 + d * d * 0.06)));
      if (b.t >= 1) {
        b.voice.stop();
        this.group.remove(b.mesh);
        this.birds.splice(i, 1);
      }
    }
  }
  dispose() { for (const b of this.birds) b.voice.stop(); this.birds = []; }
}

// ------------------------------------------------------------------ manager

export class EnvironmentManager {
  constructor(scene, tableRadius) {
    this.scene = scene;
    this.tableRadius = tableRadius;
    this.current = null;
    this.name = null;
    this.glareEl = document.getElementById('glare');
  }

  set(name) {
    if (name === this.name || !BUILDERS[name]) return;
    this.disposeCurrent();
    this.name = name;
    const group = new THREE.Group();
    group.name = 'environment';
    this.scene.add(group);
    const env = BUILDERS[name]({
      group,
      scene: this.scene,
      lights: this.scene.userData.lights,
      tableRadius: this.tableRadius,
    });
    env.group = group;
    env.timers ??= [];
    env.elapsed = 0;
    // first occurrence also respects the minimum interval
    for (const t of env.timers) t.next = (t.min + Math.random() * t.jitter) * timeScale();
    this.current = env;
  }

  disposeCurrent() {
    if (!this.current) return;
    this.current.dispose?.();
    for (const l of this.current.loops || []) l.stop();
    this.scene.remove(this.current.group);
    this.current.group.traverse(o => {
      o.geometry?.dispose?.();
    });
    if (this.glareEl) this.glareEl.style.opacity = '0';
    this.current = null;
    this.name = null;
  }

  update(dt, camera) {
    const env = this.current;
    if (!env) return;
    env.elapsed += dt;
    for (const t of env.timers) {
      if (env.elapsed >= t.next) {
        t.next = env.elapsed + (t.min + Math.random() * t.jitter) * timeScale();
        t.fn();
      }
    }
    env.update?.(dt, camera);
  }
}

// ------------------------------------------------------------------ builders

const BUILDERS = {

  // ----- the original dark den
  tavern({ group, scene, lights }) {
    scene.background = new THREE.Color(0x0c0e12);
    scene.fog = new THREE.Fog(0x0c0e12, 14, 30);
    lights.key.intensity = 220; lights.fill.intensity = 0.55; lights.rim.intensity = 0.5;

    const floorTex = woodTexture('#3a2c1d', '#241a10');
    floorTex.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 8, 48, 1, true),
      mat(0x191b20, { side: THREE.BackSide, roughness: 0.95 }));
    wall.position.y = 4;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.55, 32, 1, true),
      mat(0x232323, { metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }));
    shade.position.y = 4.45;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16),
      mat(0xffffff, { emissive: 0xffd9a0, emissiveIntensity: 6 }));
    bulb.position.y = 4.25;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3.4), mat(0x111111));
    cord.position.y = 6.3;
    group.add(floor, wall, shade, bulb, cord);
    return {};
  },

  // ----- living room: TV turns itself on for 3 s, ≥5 min random interval
  living_room({ group, scene, lights }) {
    scene.background = new THREE.Color(0x171310);
    scene.fog = null;
    lights.key.intensity = 190; lights.fill.intensity = 0.8; lights.rim.intensity = 0.3;

    const W = 11, D = 9, H = 3.4;
    const wallMat = mat(0x6e5f4e, { roughness: 0.96 });
    const floorTex = woodTexture('#6a4f31', '#4a3621');
    floorTex.repeat.set(5, 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xd8d2c4));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
    group.add(floor, ceil);
    for (const [w, x, z, ry] of [[W, 0, -D / 2, 0], [W, 0, D / 2, Math.PI], [D, -W / 2, 0, Math.PI / 2], [D, W / 2, 0, -Math.PI / 2]]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
      wall.position.set(x, H / 2, z); wall.rotation.y = ry;
      group.add(wall);
    }
    // rug under the table
    const rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), mat(0x7a3b35, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.005;
    group.add(rug);
    // sofa
    const sofa = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 1), mat(0x35495e));
    base.position.y = 0.3;
    const backRest = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 0.25), mat(0x2e4052));
    backRest.position.set(0, 0.75, 0.38);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 1), mat(0x2e4052));
      arm.position.set(1.42 * s, 0.62, 0);
      sofa.add(arm);
    }
    sofa.add(base, backRest);
    sofa.position.set(0, 0, D / 2 - 0.7);
    group.add(sofa);
    // bookshelf
    const shelf = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.34), mat(0x4a3621));
    frame.position.y = 1.1;
    shelf.add(frame);
    for (let r = 0; r < 4; r++) for (let b = 0; b < 7; b++) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3 + Math.random() * 0.1, 0.2),
        mat(new THREE.Color().setHSL(Math.random(), 0.45, 0.4)));
      book.position.set(-0.65 + b * 0.2, 0.5 + r * 0.5, 0.06);
      shelf.add(book);
    }
    shelf.position.set(-W / 2 + 0.25, 0, -1.5);
    shelf.rotation.y = Math.PI / 2;
    group.add(shelf);
    // floor lamp
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.6), mat(0x222222, { metalness: 0.7 }));
    lampPole.position.set(W / 2 - 0.8, 0.8, D / 2 - 0.8);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 16, 1, true),
      mat(0xd8c9a0, { emissive: 0xffd9a0, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
    lampShade.position.set(W / 2 - 0.8, 1.65, D / 2 - 0.8);
    const lampLight = new THREE.PointLight(0xffd9a0, 6, 7);
    lampLight.position.set(W / 2 - 0.8, 1.6, D / 2 - 0.8);
    group.add(lampPole, lampShade, lampLight);

    // TV on a stand against the wall opposite the sofa
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.45), mat(0x2a2018));
    stand.position.set(0, 0.2, -D / 2 + 0.45);
    const tvFrame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 0.07), mat(0x0a0a0a, { roughness: 0.4 }));
    tvFrame.position.set(0, 1.05, -D / 2 + 0.4);
    const tvCv = document.createElement('canvas');
    tvCv.width = 256; tvCv.height = 144;
    const tvCtx = tvCv.getContext('2d');
    tvCtx.fillStyle = '#050505'; tvCtx.fillRect(0, 0, 256, 144);
    const tvTex = new THREE.CanvasTexture(tvCv);
    const screenMat = new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.84), screenMat);
    screen.position.set(0, 1.05, -D / 2 + 0.44);
    const tvGlow = new THREE.PointLight(0x88aaff, 0, 6);
    tvGlow.position.set(0, 1.2, -D / 2 + 1);
    group.add(stand, tvFrame, screen, tvGlow);

    let tvAnim = null;
    function tvOn() {
      tvBlip(3);
      tvGlow.intensity = 5;
      let frames = 0;
      tvAnim = setInterval(() => {
        // random "channel" frames: color bars / noise / shapes
        for (let i = 0; i < 7; i++) {
          tvCtx.fillStyle = `hsl(${Math.random() * 360 | 0} 70% ${30 + Math.random() * 40 | 0}%)`;
          tvCtx.fillRect(Math.random() * 256, Math.random() * 144, 40 + Math.random() * 120, 20 + Math.random() * 70);
        }
        tvTex.needsUpdate = true;
        tvGlow.color.setHSL(Math.random(), 0.5, 0.6);
        if (++frames > 10) tvOff();
      }, 280);
    }
    function tvOff() {
      clearInterval(tvAnim); tvAnim = null;
      tvCtx.fillStyle = '#050505'; tvCtx.fillRect(0, 0, 256, 144);
      tvTex.needsUpdate = true;
      tvGlow.intensity = 0;
    }

    return {
      timers: [{ min: 300, jitter: 180, fn: tvOn }],   // ≥ 5 minutes, on for 3 s
      dispose() { if (tvAnim) clearInterval(tvAnim); },
    };
  },

  // ----- beachside
  beach({ group, scene, lights, tableRadius }) {
    scene.background = new THREE.Color(0x9fd2ee);
    scene.fog = new THREE.Fog(0xbfe2f2, 30, 46);
    lights.key.intensity = 90; lights.fill.intensity = 1.6; lights.rim.intensity = 0.2;

    group.add(skyDome('#4d9fe0', '#cfeaf5'));
    group.add(groundDisc('#d9c391', 24));
    // ocean ring beyond the sand
    const ocean = new THREE.Mesh(new THREE.RingGeometry(15, 46, 48),
      new THREE.MeshStandardMaterial({ color: 0x2e7fa8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.95 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.12;
    group.add(ocean);
    // sun + its light
    const sunDir = new THREE.Vector3(0.45, 0.78, -0.42).normalize();
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
    sun.position.copy(sunDir).multiplyScalar(42);
    const sunLight = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sunLight.position.copy(sunDir).multiplyScalar(20);
    group.add(sun, sunLight);
    // palms
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const r = 9 + Math.random() * 4;
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.4, 8), mat(0x8a6a42));
      trunk.position.y = 1.7; trunk.rotation.z = 0.18;
      palm.add(trunk);
      for (let f = 0; f < 6; f++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.9, 5), mat(0x3f7c3a));
        frond.position.set(0.3, 3.4, 0);
        frond.rotation.z = Math.PI / 2 + 0.45;
        frond.rotation.y = (f / 6) * Math.PI * 2;
        palm.add(frond);
      }
      palm.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      palm.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(palm);
    }
    // tidal wave wall (hidden until the event); never crosses into the table area
    const wave = new THREE.Mesh(
      new THREE.CylinderGeometry(20, 20, 5, 48, 1, true, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x3a93bd, transparent: true, opacity: 0, roughness: 0.2, side: THREE.DoubleSide }));
    wave.position.y = -3;
    group.add(wave);
    let waveT = -1;

    const birds = new Birds(group);
    const loops = [oceanLoop()];
    loops[0].setGain(0.5);

    const glareEl = document.getElementById('glare');

    return {
      loops,
      timers: [
        { min: 5, jitter: 9, fn: () => { if (birds.birds.length < 5) birds.spawn(); } },
        { min: 300, jitter: 0, fn: () => { waveT = 0; tidalRumble(7); } },  // every 5 minutes
      ],
      update(dt, camera) {
        birds.update(dt, camera);
        // sun glare when looking up toward the sun
        if (glareEl) {
          const fwd = camera.getWorldDirection(new THREE.Vector3());
          const k = Math.max(0, fwd.dot(sunDir));
          glareEl.style.opacity = String(Math.pow(k, 6) * 0.85);
        }
        // tidal wave: rises far out, sweeps inward, dissolves before the sand —
        // pure spectacle, nothing on the table is touched
        if (waveT >= 0) {
          waveT += dt / 7;
          const k = Math.min(1, waveT);
          const radius = 34 - k * 22;            // stops ~12 u out, beyond the sand line
          wave.scale.setScalar(radius / 20);
          wave.position.y = -3 + Math.sin(k * Math.PI) * 5.4;
          wave.material.opacity = Math.sin(k * Math.PI) * 0.85;
          wave.rotation.y += dt * 0.1;
          if (waveT >= 1) { waveT = -1; wave.material.opacity = 0; }
        }
      },
      dispose() { birds.dispose(); if (glareEl) glareEl.style.opacity = '0'; },
    };
  },

  // ----- asian marketplace
  market({ group, scene, lights, tableRadius }) {
    scene.background = new THREE.Color(0x131017);
    scene.fog = new THREE.Fog(0x131017, 16, 34);
    lights.key.intensity = 170; lights.fill.intensity = 0.7; lights.rim.intensity = 0.4;

    group.add(groundDisc('#5a4a3a', 24));
    // stalls in a ring around the players
    const stallR = tableRadius + 6.5;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.25;
      const stall = new THREE.Group();
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 0.8), mat(0x6a4a2a));
      counter.position.y = 0.45;
      const canopyTex = canvasTexture((ctx, w, h) => {
        const colors = [['#b03a30', '#e8d9b0'], ['#2a6a4a', '#e8d9b0'], ['#b07a20', '#7a2a30']][i % 3];
        for (let s = 0; s < 8; s++) { ctx.fillStyle = colors[s % 2]; ctx.fillRect(s * w / 8, 0, w / 8, h); }
      }, 256, 64);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 1.3),
        new THREE.MeshStandardMaterial({ map: canopyTex, roughness: 0.9 }));
      canopy.position.y = 2.1; canopy.rotation.x = 0.16;
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1), mat(0x4a3a26));
        pole.position.set(1.05 * s, 1.05, 0.5);
        stall.add(pole);
      }
      // produce crates
      for (let cI = 0; cI < 3; cI++) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.24, 0.4), mat(0x8a6a42));
        crate.position.set(-0.6 + cI * 0.6, 1.02, 0);
        const goods = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
          mat([0xc04a30, 0xd8a020, 0x4a8a30][cI % 3]));
        goods.position.set(-0.6 + cI * 0.6, 1.18, 0);
        stall.add(crate, goods);
      }
      stall.add(counter, canopy);
      stall.position.set(Math.cos(a) * stallR, 0, Math.sin(a) * stallR);
      stall.lookAt(0, 0, 0);
      stall.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(stall);
      // hanging lantern
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10),
        mat(0xff5a3a, { emissive: 0xff6a30, emissiveIntensity: 2.4 }));
      lantern.position.set(Math.cos(a) * (stallR - 1), 2.5, Math.sin(a) * (stallR - 1));
      const lLight = new THREE.PointLight(0xff7a40, 3, 6);
      lLight.position.copy(lantern.position);
      group.add(lantern, lLight);
    }

    const loops = [crowdLoop()];
    loops[0].setGain(0.4);

    // passerby NPCs walking behind the players
    const npcs = [];
    function spawnNpc() {
      if (npcs.length >= 5) return;
      const mesh = makeNpc(new THREE.Color().setHSL(Math.random(), 0.45, 0.42));
      const a = Math.random() * Math.PI * 2;
      const r = tableRadius + 2.6 + Math.random() * 2.4;   // behind the seats
      const arc = (0.8 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1);
      mesh.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      group.add(mesh);
      npcs.push({ mesh, a, r, arc, t: 0, speed: 0.06 + Math.random() * 0.05, voice: chatterLoop(0.8 + Math.random() * 0.5), bob: Math.random() * 7 });
    }

    return {
      loops,
      timers: [{ min: 4, jitter: 10, fn: spawnNpc }],
      update(dt, camera) {
        for (let i = npcs.length - 1; i >= 0; i--) {
          const n = npcs[i];
          n.t += dt * n.speed;
          const a = n.a + n.arc * n.t;
          const prev = n.mesh.position.clone();
          n.mesh.position.set(Math.cos(a) * n.r, 0, Math.sin(a) * n.r);
          n.bob += dt * 7;
          n.mesh.position.y = Math.abs(Math.sin(n.bob)) * 0.04;
          n.mesh.lookAt(n.mesh.position.clone().add(n.mesh.position.clone().sub(prev).setY(0)));
          // chitchat louder the closer they pass
          const d = n.mesh.position.distanceTo(camera.position);
          n.voice.setGain(Math.min(0.5, 2.6 / (1 + d * d * 0.12)));
          if (n.t >= 1) {
            n.voice.stop();
            group.remove(n.mesh);
            npcs.splice(i, 1);
          }
        }
      },
      dispose() { for (const n of npcs) n.voice.stop(); },
    };
  },

  // ----- mountain peak
  mountain({ group, scene, lights, tableRadius }) {
    scene.background = new THREE.Color(0xa8c8e8);
    scene.fog = new THREE.Fog(0xc8daea, 24, 46);
    lights.key.intensity = 110; lights.fill.intensity = 1.4; lights.rim.intensity = 0.6;

    group.add(skyDome('#5a8fd0', '#dcebf5'));
    // summit plateau with a hard edge to fall off
    const plateauR = tableRadius + 6;
    const plateau = new THREE.Mesh(new THREE.CylinderGeometry(plateauR, plateauR * 0.8, 3, 24), mat(0x8a8d93));
    plateau.position.y = -1.5;
    plateau.receiveShadow = true;
    const snow = new THREE.Mesh(new THREE.CircleGeometry(plateauR * 0.998, 24), mat(0xe8edf2, { roughness: 0.85 }));
    snow.rotation.x = -Math.PI / 2;
    snow.position.y = 0.012;
    snow.receiveShadow = true;
    group.add(plateau, snow);
    // distant peaks
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(4 + Math.random() * 4, 9 + Math.random() * 7, 7),
        mat(0x6f7782));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 7), mat(0xe8edf2));
      peak.position.set(Math.cos(a) * 32, -2 + Math.random() * 2, Math.sin(a) * 32);
      cap.position.copy(peak.position).add(new THREE.Vector3(0, (9 + 7) / 2 - 1.4, 0));
      group.add(peak, cap);
    }
    // clouds drifting below the summit
    const clouds = [];
    for (let i = 0; i < 6; i++) {
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 1.6, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, fog: false }));
      cloud.scale.y = 0.32;
      cloud.position.set((Math.random() - 0.5) * 50, -3 - Math.random() * 3, (Math.random() - 0.5) * 50);
      clouds.push(cloud);
      group.add(cloud);
    }
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.8);
    sunLight.position.set(8, 16, 6);
    group.add(sunLight);

    const birds = new Birds(group);
    const loops = [windLoop()];
    loops[0].setGain(0.3);

    // an unlucky hiker wanders to the edge, the ground cracks, and off they go
    const fallers = [];
    function hikerFalls() {
      const mesh = makeNpc(new THREE.Color().setHSL(Math.random(), 0.5, 0.45));
      const a = Math.random() * Math.PI * 2;
      mesh.position.set(Math.cos(a) * (plateauR - 0.4), 0, Math.sin(a) * (plateauR - 0.4));
      mesh.lookAt(Math.cos(a) * plateauR * 2, 0, Math.sin(a) * plateauR * 2);
      group.add(mesh);
      groundCrack();
      // cracked-ground decal at their feet
      const crack = new THREE.Mesh(new THREE.CircleGeometry(0.5, 7),
        new THREE.MeshBasicMaterial({ color: 0x2a2d33, transparent: true, opacity: 0.65 }));
      crack.rotation.x = -Math.PI / 2;
      crack.position.set(mesh.position.x, 0.02, mesh.position.z);
      group.add(crack);
      fallers.push({ mesh, crack, t: 0, dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), screamed: false });
    }

    return {
      loops,
      timers: [
        { min: 6, jitter: 10, fn: () => { if (birds.birds.length < 4) birds.spawn(); } },
        { min: 300, jitter: 240, fn: yodel },        // echoing yodel, ≥ 5 min
        { min: 300, jitter: 300, fn: hikerFalls },   // somebody falls, ≥ 5 min
      ],
      update(dt, camera) {
        birds.update(dt, camera);
        for (const c of clouds) {
          c.position.x += dt * 0.35;
          if (c.position.x > 28) c.position.x = -28;
        }
        for (let i = fallers.length - 1; i >= 0; i--) {
          const f = fallers[i];
          f.t += dt;
          if (f.t < 1.1) {
            // teeter on the cracking edge
            f.mesh.rotation.z = Math.sin(f.t * 14) * 0.12 * f.t;
          } else {
            if (!f.screamed) { f.screamed = true; fallingScream(); }
            const k = f.t - 1.1;
            f.mesh.position.addScaledVector(f.dir, dt * 1.4);
            f.mesh.position.y -= 9.8 * k * dt;
            f.mesh.rotation.x += dt * 5;
            f.crack.material.opacity = Math.max(0, 0.65 - k * 0.3);
          }
          if (f.mesh.position.y < -16) {
            group.remove(f.mesh); group.remove(f.crack);
            fallers.splice(i, 1);
          }
        }
      },
      dispose() { birds.dispose(); },
    };
  },

  // ----- jungle
  jungle({ group, scene, lights }) {
    scene.background = new THREE.Color(0x0c130b);
    scene.fog = new THREE.Fog(0x14210f, 9, 26);
    lights.key.intensity = 150; lights.fill.intensity = 0.9; lights.rim.intensity = 0.25;
    lights.fill.color.set(0x3a5a30);

    group.add(groundDisc('#27361c', 24));
    // dense tree ring
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 7 + Math.random() * 13;
      const tree = new THREE.Group();
      const h = 3.5 + Math.random() * 3.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, h, 7), mat(0x4a3a26));
      trunk.position.y = h / 2;
      tree.add(trunk);
      for (let c = 0; c < 3; c++) {
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.9, 8, 7),
          mat(new THREE.Color().setHSL(0.3, 0.4, 0.16 + Math.random() * 0.1)));
        canopy.position.set((Math.random() - 0.5) * 1.2, h - 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 1.2);
        tree.add(canopy);
      }
      // hanging vine
      if (Math.random() < 0.5) {
        const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, h * 0.6, 5), mat(0x35502a));
        vine.position.set(0.5, h * 0.6, 0);
        tree.add(vine);
      }
      tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      tree.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(tree);
    }
    // ferns near the table
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4.5 + Math.random() * 3;
      const fern = new THREE.Group();
      for (let l = 0; l < 5; l++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.7, 4), mat(0x3f6a30));
        leaf.position.y = 0.3;
        leaf.rotation.z = 0.7;
        leaf.rotation.y = (l / 5) * Math.PI * 2;
        fern.add(leaf);
      }
      fern.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      group.add(fern);
    }
    // shafts of light
    const shaft = new THREE.SpotLight(0xcfe8a0, 60, 0, 0.3, 0.6);
    shaft.position.set(5, 12, -4);
    group.add(shaft, shaft.target);

    const loops = [leavesLoop()];
    loops[0].setGain(0.35);

    return {
      loops,
      // a T-rex roars somewhere out there — varying distance, ≥ 5 min apart
      timers: [{ min: 300, jitter: 240, fn: () => trexRoar(Math.random()) }],
      update() {},
    };
  },
};
