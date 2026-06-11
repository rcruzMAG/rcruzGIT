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

  // ----- the original dark den, now with beams, barrels and candle sconces
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

    // ceiling beams
    const beamMat = new THREE.MeshStandardMaterial({ map: woodTexture('#2e2114', '#1c130a'), roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 28), beamMat);
      beam.position.set(-8 + i * 4, 7.2, 0);
      group.add(beam);
    }
    // barrels along the wall
    const barrelMat = new THREE.MeshStandardMaterial({ map: woodTexture('#4a3320', '#2c1d10'), roughness: 0.8 });
    const hoopMat = mat(0x2a2a2e, { metalness: 0.8, roughness: 0.4 });
    for (let i = 0; i < 6; i++) {
      const a = 0.5 + i * 0.42;
      const barrel = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 14), barrelMat);
      body.scale.x = 1.12; body.position.y = 0.5;
      for (const hy of [0.18, 0.82]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.02, 6, 18), hoopMat);
        hoop.rotation.x = Math.PI / 2; hoop.position.y = hy; hoop.scale.x = 1.12;
        barrel.add(hoop);
      }
      barrel.add(body);
      barrel.position.set(Math.cos(a) * 13.5, 0, Math.sin(a) * 13.5);
      if (i % 3 === 2) { barrel.position.y = 1.02; barrel.position.x -= 0.1; } // stacked
      barrel.traverse(o => { if (o.isMesh) o.castShadow = true; });
      group.add(barrel);
    }
    // candle sconces with flickering glow
    const sconces = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.9;
      const x = Math.cos(a) * 15.2, z = Math.sin(a) * 15.2;
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), hoopMat);
      bracket.position.set(x, 2.6, z);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8),
        mat(0xffdd99, { emissive: 0xffaa40, emissiveIntensity: 4 }));
      flame.position.set(x, 2.85, z);
      const glow = new THREE.PointLight(0xff9a40, 2.6, 7, 1.6);
      glow.position.set(x, 2.9, z);
      group.add(bracket, flame, glow);
      sconces.push({ glow, flame, phase: Math.random() * 9 });
    }
    // framed "paintings"
    for (let i = 0; i < 3; i++) {
      const a = 2.2 + i * 1.6;
      const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 0.06), mat(0x6a5128, { metalness: 0.4, roughness: 0.5 }));
      const art = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8),
        mat(new THREE.Color().setHSL(0.07 + i * 0.1, 0.35, 0.25)));
      frameMesh.position.set(Math.cos(a) * 15.6, 3, Math.sin(a) * 15.6);
      frameMesh.lookAt(0, 3, 0);
      art.position.copy(frameMesh.position).addScaledVector(frameMesh.getWorldDirection(new THREE.Vector3()), 0.04);
      art.lookAt(0, 3, 0);
      group.add(frameMesh, art);
    }

    return {
      update(dt, _camera) {
        const t = performance.now() / 1000;
        for (const s of sconces) {
          const f = 0.75 + Math.sin(t * 11 + s.phase) * 0.12 + Math.sin(t * 23 + s.phase * 2) * 0.08;
          s.glow.intensity = 2.6 * f;
          s.flame.material.emissiveIntensity = 4 * f;
        }
      },
    };
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

    // window with daylight pouring in + curtains
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 2.6), mat(0xd8d2c4));
    winFrame.position.set(W / 2 - 0.04, 1.8, 0);
    const winPane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xcfe4f5, fog: false }));
    winPane.position.set(W / 2 - 0.1, 1.8, 0);
    winPane.rotation.y = -Math.PI / 2;
    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.06), mat(0xd8d2c4));
    mullionV.position.set(W / 2 - 0.08, 1.8, 0);
    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 2.5), mat(0xd8d2c4));
    mullionH.position.set(W / 2 - 0.08, 1.8, 0);
    const dayLight = new THREE.DirectionalLight(0xeaf2ff, 1.1);
    dayLight.position.set(W / 2 + 4, 3.4, 0.5);
    dayLight.target.position.set(0, 0.6, 0);
    for (const s of [-1, 1]) {
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.9, 6, 1), mat(0x8a4438, { roughness: 1, side: THREE.DoubleSide }));
      const cp = curtain.geometry.attributes.position;
      for (let v = 0; v < cp.count; v++) cp.setX(v, cp.getX(v) + Math.sin(cp.getY(v) * 6) * 0.03);
      curtain.position.set(W / 2 - 0.14, 1.85, 1.5 * s);
      curtain.rotation.y = -Math.PI / 2;
      group.add(curtain);
    }
    group.add(winFrame, winPane, mullionV, mullionH, dayLight, dayLight.target);

    // framed pictures, plant, coffee table
    for (const [px, pz, ry, hue] of [[-2.4, -D / 2 + 0.04, 0, 0.6], [2.4, -D / 2 + 0.04, 0, 0.08]]) {
      const pic = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.05), mat(0x3a2c1c));
      pic.position.set(px, 2, pz); pic.rotation.y = ry;
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.56), mat(new THREE.Color().setHSL(hue, 0.4, 0.45)));
      art.position.set(px, 2, pz + 0.035);
      group.add(pic, art);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.4, 12), mat(0x9a5a35));
    pot.position.set(-W / 2 + 0.6, 0.2, D / 2 - 0.6);
    group.add(pot);
    for (let l = 0; l < 7; l++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.85, 5), mat(0x3f6a35));
      leaf.position.set(-W / 2 + 0.6, 0.75, D / 2 - 0.6);
      leaf.rotation.z = 0.55; leaf.rotation.y = (l / 7) * Math.PI * 2;
      group.add(leaf);
    }
    const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.5),
      new THREE.MeshStandardMaterial({ map: woodTexture('#5a4026', '#3a2818'), roughness: 0.4 }));
    coffeeTable.position.set(0, 0.34, D / 2 - 1.7);
    for (const [lx, lz] of [[-0.48, -0.18], [0.48, -0.18], [-0.48, 0.18], [0.48, 0.18]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32), mat(0x2a2018));
      leg.position.set(lx, 0.16, D / 2 - 1.7 + lz);
      group.add(leg);
    }
    const books = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.22), mat(0x7a3b35));
    books.position.set(-0.2, 0.42, D / 2 - 1.7);
    books.rotation.y = 0.3;
    group.add(coffeeTable, books);

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
    // animated ocean ring beyond the sand: vertex waves + glossy water
    const oceanGeo = new THREE.RingGeometry(15, 46, 64, 12);
    const ocean = new THREE.Mesh(oceanGeo,
      new THREE.MeshStandardMaterial({ color: 0x2e7fa8, roughness: 0.16, metalness: 0.25, transparent: true, opacity: 0.96 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.12;
    const oceanBase = oceanGeo.attributes.position.array.slice();
    group.add(ocean);
    // foam line where water meets sand
    const foam = new THREE.Mesh(new THREE.RingGeometry(14.7, 15.6, 64),
      new THREE.MeshBasicMaterial({ color: 0xeef6f4, transparent: true, opacity: 0.55 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.06;
    group.add(foam);
    // sun + halo sprite + warm light (with shadows)
    const sunDir = new THREE.Vector3(0.45, 0.78, -0.42).normalize();
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
    sun.position.copy(sunDir).multiplyScalar(42);
    const haloCv = document.createElement('canvas');
    haloCv.width = haloCv.height = 128;
    const hctx = haloCv.getContext('2d');
    const hg = hctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    hg.addColorStop(0, 'rgba(255,246,214,0.9)'); hg.addColorStop(0.4, 'rgba(255,236,180,0.25)'); hg.addColorStop(1, 'rgba(255,236,180,0)');
    hctx.fillStyle = hg; hctx.fillRect(0, 0, 128, 128);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(haloCv), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(16);
    halo.position.copy(sun.position);
    const sunLight = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sunLight.position.copy(sunDir).multiplyScalar(20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -8; sunLight.shadow.camera.right = 8;
    sunLight.shadow.camera.top = 8; sunLight.shadow.camera.bottom = -8;
    group.add(sun, halo, sunLight);
    // a few drifting clouds
    const clouds = [];
    for (let i = 0; i < 5; i++) {
      const cloud = new THREE.Group();
      for (let b = 0; b < 4; b++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random(), 9, 7),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, fog: false }));
        puff.position.set(b * 1.4 - 2 + Math.random(), Math.random() * 0.5, Math.random());
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set((Math.random() - 0.5) * 60, 13 + Math.random() * 6, (Math.random() - 0.5) * 60);
      clouds.push(cloud);
      group.add(cloud);
    }
    // palms with gentle sway
    const palms = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const r = 9 + Math.random() * 4;
      const palm = new THREE.Group();
      // curved trunk from stacked segments
      let segY = 0, lean = 0;
      for (let s = 0; s < 6; s++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.10 - s * 0.008, 0.13 - s * 0.008, 0.62, 8),
          mat(0x8a6a42, { map: null }));
        lean += 0.05;
        seg.position.set(lean * segY * 0.35, segY + 0.3, 0);
        seg.rotation.z = lean;
        segY += 0.58;
        seg.castShadow = true;
        palm.add(seg);
      }
      const crown = new THREE.Group();
      for (let f = 0; f < 8; f++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.13, 2.2, 4), mat(0x3f7c3a));
        frond.position.y = 0.1;
        frond.rotation.z = Math.PI / 2 + 0.38 + Math.random() * 0.2;
        frond.rotation.y = (f / 8) * Math.PI * 2;
        frond.castShadow = true;
        crown.add(frond);
      }
      // coconuts
      for (let c = 0; c < 3; c++) {
        const nut = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat(0x5a4226));
        nut.position.set(Math.cos(c * 2.1) * 0.18, -0.05, Math.sin(c * 2.1) * 0.18);
        crown.add(nut);
      }
      crown.position.set(lean * segY * 0.35, segY + 0.15, 0);
      palm.add(crown);
      palm.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      palm.rotation.y = Math.random() * Math.PI * 2;
      palms.push({ palm, crown, phase: Math.random() * 9 });
      group.add(palm);
    }
    // beach umbrella + towels + rocks + distant sailboat
    const umb = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9), mat(0xd8d2c4));
    pole.position.y = 0.95;
    const canopyTex = canvasTexture((ctx, w, h) => {
      for (let s = 0; s < 10; s++) { ctx.fillStyle = s % 2 ? '#e8e2d2' : '#c2473a'; ctx.fillRect(s * w / 10, 0, w / 10, h); }
    }, 256, 64);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.5, 12, 1, true),
      new THREE.MeshStandardMaterial({ map: canopyTex, roughness: 0.85, side: THREE.DoubleSide }));
    canopy.position.y = 1.85;
    umb.add(pole, canopy);
    umb.position.set(7.5, 0, 5.5);
    umb.rotation.z = 0.12;
    umb.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(umb);
    for (const [tx, tz, c] of [[6.6, 6.3, 0x3a6ea5], [8.4, 6.4, 0xc2473a]]) {
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6), mat(c, { roughness: 1 }));
      towel.rotation.x = -Math.PI / 2;
      towel.rotation.z = Math.random();
      towel.position.set(tx, 0.012, tz);
      group.add(towel);
    }
    for (let i = 0; i < 7; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.25, 0), mat(0x8d8a80));
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 4;
      rock.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      group.add(rock);
    }
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.2, 2.6, 6, 1), mat(0x7a3b30));
    hull.rotation.z = Math.PI / 2; hull.scale.y = 0.5;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4), mat(0x5a4226));
    mast.position.y = 1.2;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8),
      mat(0xf2ead8, { side: THREE.DoubleSide }));
    sail.position.set(0.4, 1.3, 0);
    boat.add(hull, mast, sail);
    boat.position.set(-26, 0.1, -18);
    group.add(boat);
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
        const t = performance.now() / 1000;
        // rolling ocean swell (vertex waves) + breathing foam line
        const pos = ocean.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = oceanBase[i * 3], y = oceanBase[i * 3 + 1];
          pos.setZ(i, Math.sin(x * 0.35 + t * 1.1) * 0.12 + Math.cos(y * 0.3 + t * 0.8) * 0.1);
        }
        pos.needsUpdate = true;
        ocean.geometry.computeVertexNormals();
        foam.material.opacity = 0.4 + Math.sin(t * 0.7) * 0.18;
        foam.scale.setScalar(1 + Math.sin(t * 0.7) * 0.012);
        // palm sway, cloud drift, boat bobbing
        for (const p of palms) {
          p.palm.rotation.z = Math.sin(t * 0.8 + p.phase) * 0.025;
          p.crown.rotation.y += dt * 0.05;
        }
        for (const c of clouds) {
          c.position.x += dt * 0.5;
          if (c.position.x > 34) c.position.x = -34;
        }
        boat.position.y = 0.1 + Math.sin(t * 0.9) * 0.08;
        boat.rotation.z = Math.sin(t * 0.7) * 0.05;
        boat.position.x += dt * 0.12;
        if (boat.position.x > 30) boat.position.x = -30;
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
    }

    // swinging paper lanterns on cords
    const lanterns = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * (stallR - 1.2), 3.1, Math.sin(a) * (stallR - 1.2));
      const cordMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6), mat(0x2a2018));
      cordMesh.position.y = -0.3;
      const color = [0xff5a3a, 0xffb03a, 0xff3a6a][i % 3];
      const paper = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 12),
        mat(color, { emissive: color, emissiveIntensity: 2.2 }));
      paper.scale.y = 1.25;
      paper.position.y = -0.72;
      const lLight = new THREE.PointLight(color, 2.6, 6, 1.4);
      lLight.position.y = -0.72;
      pivot.add(cordMesh, paper, lLight);
      lanterns.push({ pivot, phase: Math.random() * 9 });
      group.add(pivot);
    }
    // string lights between stalls: little warm bulbs along sagging curves
    const bulbGeo = new THREE.SphereGeometry(0.035, 6, 6);
    const bulbMat = mat(0xffd9a0, { emissive: 0xffc070, emissiveIntensity: 3 });
    for (let i = 0; i < 7; i++) {
      const a1 = (i / 7) * Math.PI * 2 + 0.25, a2 = ((i + 1) / 7) * Math.PI * 2 + 0.25;
      const p1 = new THREE.Vector3(Math.cos(a1) * stallR, 2.4, Math.sin(a1) * stallR);
      const p2 = new THREE.Vector3(Math.cos(a2) * stallR, 2.4, Math.sin(a2) * stallR);
      for (let b = 1; b < 9; b++) {
        const k = b / 9;
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.lerpVectors(p1, p2, k);
        bulb.position.y -= Math.sin(k * Math.PI) * 0.45;  // sag
        group.add(bulb);
      }
    }
    // food-stall steam wisps
    const steamMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.25, depthWrite: false });
    const steams = [];
    const steamA = 0.25;
    for (let i = 0; i < 4; i++) {
      const wisp = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), steamMat.clone());
      wisp.position.set(Math.cos(steamA) * stallR, 1.3, Math.sin(steamA) * stallR);
      steams.push({ wisp, t: i / 4 });
      group.add(wisp);
    }
    // worn rugs and clay pots around the walkway
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = tableRadius + 2 + Math.random() * 3;
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(1 + Math.random(), 0.7),
        mat(new THREE.Color().setHSL(Math.random() * 0.1, 0.5, 0.3), { roughness: 1 }));
      rug.rotation.x = -Math.PI / 2;
      rug.rotation.z = Math.random() * Math.PI;
      rug.position.set(Math.cos(a) * r, 0.012, Math.sin(a) * r);
      group.add(rug);
      const potMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.3, 10), mat(0x8a5a35));
      potMesh.position.set(Math.cos(a) * r + 0.6, 0.15, Math.sin(a) * r);
      potMesh.castShadow = true;
      group.add(potMesh);
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
        const t = performance.now() / 1000;
        for (const l of lanterns) {
          l.pivot.rotation.x = Math.sin(t * 1.3 + l.phase) * 0.1;
          l.pivot.rotation.z = Math.cos(t * 1.1 + l.phase) * 0.1;
        }
        for (const s of steams) {
          s.t += dt * 0.4;
          if (s.t > 1) s.t -= 1;
          s.wisp.position.y = 1.3 + s.t * 1.2;
          s.wisp.material.opacity = 0.28 * Math.sin(s.t * Math.PI);
          s.wisp.lookAt(camera.position);
        }
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
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -9; sunLight.shadow.camera.right = 9;
    sunLight.shadow.camera.top = 9; sunLight.shadow.camera.bottom = -9;
    group.add(sunLight);

    // boulders along the plateau rim
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.5, 0), mat(0x73777f));
      rk.position.set(Math.cos(a) * (plateauR - 0.7), 0.2, Math.sin(a) * (plateauR - 0.7));
      rk.rotation.set(Math.random(), Math.random(), Math.random());
      rk.castShadow = true;
      group.add(rk);
    }
    // summit flag, flapping in the wind
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 2.4), mat(0x4a3a26));
    flagPole.position.set(plateauR - 1.6, 1.2, -1.2);
    const flagGeo = new THREE.PlaneGeometry(0.9, 0.55, 8, 3);
    const flag = new THREE.Mesh(flagGeo, mat(0xc2473a, { side: THREE.DoubleSide, roughness: 1 }));
    flag.position.set(plateauR - 1.6 + 0.47, 2.1, -1.2);
    const flagBase = flagGeo.attributes.position.array.slice();
    group.add(flagPole, flag);
    // gently falling snow
    const SNOW = 350;
    const snowPos = new Float32Array(SNOW * 3);
    const snowVel = new Float32Array(SNOW);
    for (let i = 0; i < SNOW; i++) {
      snowPos[i * 3] = (Math.random() - 0.5) * 26;
      snowPos[i * 3 + 1] = Math.random() * 9;
      snowPos[i * 3 + 2] = (Math.random() - 0.5) * 26;
      snowVel[i] = 0.4 + Math.random() * 0.6;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    group.add(snowPts);

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
        const t = performance.now() / 1000;
        for (const c of clouds) {
          c.position.x += dt * 0.35;
          if (c.position.x > 28) c.position.x = -28;
        }
        // flapping flag
        const fp = flag.geometry.attributes.position;
        for (let i = 0; i < fp.count; i++) {
          const x = flagBase[i * 3];
          fp.setZ(i, Math.sin(x * 7 - t * 9) * 0.05 * (x + 0.45));
        }
        fp.needsUpdate = true;
        // snowfall with slight drift
        const sp = snowPts.geometry.attributes.position;
        for (let i = 0; i < SNOW; i++) {
          let y = sp.getY(i) - snowVel[i] * dt;
          if (y < 0) y = 9;
          sp.setY(i, y);
          sp.setX(i, sp.getX(i) + Math.sin(t * 0.8 + i) * dt * 0.18);
        }
        sp.needsUpdate = true;
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
    // shafts of light + visible god-ray cones
    const shaft = new THREE.SpotLight(0xcfe8a0, 60, 0, 0.3, 0.6);
    shaft.position.set(5, 12, -4);
    group.add(shaft, shaft.target);
    for (const [sx, sz] of [[5, -4], [-6, 3], [2, 7]]) {
      const ray = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 11, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xd8eaa0, transparent: true, opacity: 0.05, depthWrite: false,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        }));
      ray.position.set(sx, 5.5, sz);
      group.add(ray);
    }
    // ground mist
    const mist = new THREE.Mesh(new THREE.CircleGeometry(20, 32),
      new THREE.MeshBasicMaterial({ color: 0x3a5a3a, transparent: true, opacity: 0.16, depthWrite: false }));
    mist.rotation.x = -Math.PI / 2;
    mist.position.y = 0.35;
    group.add(mist);
    // fireflies
    const FLIES = 90;
    const flyPos = new Float32Array(FLIES * 3);
    const flySeed = new Float32Array(FLIES);
    for (let i = 0; i < FLIES; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 11;
      flyPos[i * 3] = Math.cos(a) * r;
      flyPos[i * 3 + 1] = 0.4 + Math.random() * 2.4;
      flyPos[i * 3 + 2] = Math.sin(a) * r;
      flySeed[i] = Math.random() * 10;
    }
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
    const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({
      color: 0xc8ff7a, size: 0.06, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    group.add(flies);

    const loops = [leavesLoop()];
    loops[0].setGain(0.35);

    return {
      loops,
      // a T-rex roars somewhere out there — varying distance, ≥ 5 min apart
      timers: [{ min: 300, jitter: 240, fn: () => trexRoar(Math.random()) }],
      update(dt) {
        const t = performance.now() / 1000;
        const fp = flies.geometry.attributes.position;
        for (let i = 0; i < FLIES; i++) {
          fp.setX(i, fp.getX(i) + Math.sin(t * 0.7 + flySeed[i]) * dt * 0.25);
          fp.setY(i, fp.getY(i) + Math.cos(t * 0.9 + flySeed[i] * 2) * dt * 0.18);
          fp.setZ(i, fp.getZ(i) + Math.cos(t * 0.6 + flySeed[i]) * dt * 0.25);
        }
        fp.needsUpdate = true;
        flies.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.35;
        mist.material.opacity = 0.13 + Math.sin(t * 0.4) * 0.05;
      },
    };
  },
};
