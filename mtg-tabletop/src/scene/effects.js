// Table-antics effects: weapon viewmodels, projectiles (knife/sandal), gun
// tracers, the table slam shockwave, and WebAudio-generated sound effects.
// All purely cosmetic — none of this ever touches card meshes or game state.

import * as THREE from 'three';
import { TABLE_Y } from './world.js';

// ------------------------------------------------------------------ audio

let actx = null;
export function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

export const sfx = {
  gunshot() {
    const ctx = audio();
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, 4400, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
    noise.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    noise.connect(lp).connect(g).connect(ctx.destination);
    noise.start(t);
  },
  whoosh() {
    const ctx = audio();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.35);
  },
  bonk() {
    const ctx = audio();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.22);
  },
  slam() {
    const ctx = audio();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.32);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(ctx.destination);
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, 2600, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    noise.buffer = buf;
    const ng = ctx.createGain(); ng.gain.value = 0.3;
    noise.connect(ng).connect(ctx.destination);
    o.start(t); o.stop(t + 0.5); noise.start(t);
  },
  cardPlace() {
    const ctx = audio();
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, 900, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    noise.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.value = 0.12;
    noise.connect(f).connect(g).connect(ctx.destination);
    noise.start(t);
  },
};

// ------------------------------------------------------------------ viewmodels

export function makeWeaponViewmodels() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.35, metalness: 0.85 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.8 });
  const blade = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.18, metalness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 });
  const sole = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 });

  // hand cannon
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.24, 14), metal);
  barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.14;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.14), metal);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.05), grip);
  handle.position.set(0, -0.08, 0.05); handle.rotation.x = 0.3;
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0 }));
  muzzle.position.z = -0.27; muzzle.name = 'muzzle';
  gun.add(barrel, body, handle, muzzle);

  // throwing knife
  const knife = new THREE.Group();
  const kBlade = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.16, 4), blade);
  kBlade.rotation.x = -Math.PI / 2; kBlade.position.z = -0.1;
  const kHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), grip);
  kHandle.rotation.x = Math.PI / 2; kHandle.position.z = 0.02;
  knife.add(kBlade, kHandle);

  // the sandal of justice
  const sandal = new THREE.Group();
  const soleMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.13, 4, 10), sole);
  soleMesh.rotation.x = Math.PI / 2; soleMesh.scale.set(1, 0.28, 1);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 14, Math.PI), leather);
  strap.rotation.set(0, Math.PI / 2, 0); strap.position.y = 0.012;
  sandal.add(soleMesh, strap);

  return { gun, knife, sandal };
}

export function makeProjectileMesh(kind) {
  const { gun, knife, sandal } = makeWeaponViewmodels();
  if (kind === 'knife') return knife;
  if (kind === 'sandal') return sandal;
  return knife;
}

// ------------------------------------------------------------------ effects manager

export class Effects {
  constructor(scene, table) {
    this.scene = scene;
    this.table = table;       // {props, radius}
    this.projectiles = [];
    this.tracers = [];
    this.rings = [];
    this.propsAnim = [];
    this.shake = 0;
    this.avatars = [];        // filled by main: avatar APIs for hit detection
  }

  // --- gun: hitscan tracer
  fireGun(origin, dir) {
    sfx.gunshot();
    const end = origin.clone().addScaledVector(dir, 18);
    let hit = this.raycastAvatars(origin, dir);
    if (hit) {
      end.copy(hit.point);
      hit.avatar.hit(dir);
      setTimeout(() => sfx.bonk(), 60);
    }
    const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.12 });
    this.shake = Math.max(this.shake, 0.25);
  }

  // --- thrown projectiles with gravity + spin
  throwProjectile(kind, origin, dir, speed = 9) {
    sfx.whoosh();
    const mesh = makeProjectileMesh(kind);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, kind,
      vel: dir.clone().multiplyScalar(speed).add(new THREE.Vector3(0, kind === 'sandal' ? 2.2 : 1.2, 0)),
      spin: kind === 'sandal' ? 14 : 22,
      life: 4,
    });
  }

  raycastAvatars(origin, dir) {
    const ray = new THREE.Raycaster(origin, dir, 0.3, 30);
    let best = null;
    for (const av of this.avatars) {
      const hits = ray.intersectObject(av.group, true);
      if (hits.length && (!best || hits[0].distance < best.distance)) {
        best = { distance: hits[0].distance, point: hits[0].point, avatar: av };
      }
    }
    return best;
  }

  // --- table slam: shockwave ring + camera shake + bounce loose props.
  // Cards are NOT in table.props, so they stay perfectly still — rules first.
  tableSlam(atPoint) {
    sfx.slam();
    this.shake = Math.max(this.shake, 1);
    const ringGeo = new THREE.RingGeometry(0.05, 0.09, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(atPoint?.x ?? 0, TABLE_Y + 0.01, atPoint?.z ?? 0);
    this.scene.add(ring);
    this.rings.push({ ring, life: 0.6 });

    for (const prop of this.table.props) {
      this.propsAnim.push({
        prop,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      });
    }
  }

  update(dt) {
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin * dt;
      p.life -= dt;

      // avatar hit?
      const speed = p.vel.length();
      if (speed > 0.5) {
        const hit = this.raycastAvatars(p.mesh.position, p.vel.clone().normalize());
        if (hit && hit.distance < speed * dt + 0.15) {
          hit.avatar.hit(p.vel.clone().normalize());
          sfx.bonk();
          p.vel.multiplyScalar(-0.2);
          p.vel.y = 1.5;
        }
      }
      // floor
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
        p.vel.x *= 0.6; p.vel.z *= 0.6;
        p.spin *= 0.5;
      }
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12);
      if (t.life <= 0) { this.scene.remove(t.line); this.tracers.splice(i, 1); }
    }
    // slam rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / 0.6;
      r.ring.scale.setScalar(1 + k * 14);
      r.ring.material.opacity = 0.8 * (1 - k);
      if (r.life <= 0) { this.scene.remove(r.ring); this.rings.splice(i, 1); }
    }
    // bouncing props
    for (let i = this.propsAnim.length - 1; i >= 0; i--) {
      const a = this.propsAnim[i];
      a.vel.y -= 12 * dt;
      a.prop.position.addScaledVector(a.vel, dt);
      a.prop.rotation.x += a.spin.x * dt;
      a.prop.rotation.z += a.spin.z * dt;
      const restY = a.prop.userData.rest.y;
      if (a.prop.position.y <= restY && a.vel.y < 0) {
        if (Math.abs(a.vel.y) < 0.4) {
          a.prop.position.y = restY;
          this.propsAnim.splice(i, 1);
        } else {
          a.prop.position.y = restY;
          a.vel.y = Math.abs(a.vel.y) * 0.4;
          a.spin.multiplyScalar(0.5);
        }
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  // applied by main loop after camera positioning
  applyShake(camera, t) {
    if (this.shake <= 0) return;
    const k = this.shake * this.shake;
    camera.position.x += Math.sin(t * 71) * 0.02 * k;
    camera.position.y += Math.cos(t * 89) * 0.018 * k;
    camera.rotation.z += Math.sin(t * 47) * 0.01 * k;
  }
}
