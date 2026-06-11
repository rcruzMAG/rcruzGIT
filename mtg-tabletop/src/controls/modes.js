// Camera + input modes.
//
// PLAY (primary): first-person from your seat. No movement — a subtle
//   cursor-driven look keeps the table framed. Mouse picks cards/targets.
// FPS (secondary, Tab): pointer-locked free look from the same seat with the
//   antics arsenal (gun / knife / sandal / table slam). Esc/Tab returns.
// SPECTATOR: pointer-locked free-fly (WASD + Space/Shift).

import * as THREE from 'three';
import { EYE_HEIGHT } from '../scene/world.js';
import { makeWeaponViewmodels, sfx } from '../scene/effects.js';

export class SeatRig {
  constructor(camera, seat) {
    this.camera = camera;
    this.seat = seat;
    this.baseYaw = Math.atan2(seat.position.x, seat.position.z); // face table center
    this.yaw = 0; this.pitch = -0.42;       // look down at the table
    this.targetYaw = 0; this.targetPitch = -0.42;
    camera.position.copy(seat.eye);
  }

  // soft look (play mode): cursor position nudges the view
  softLook(nx, ny) {
    this.targetYaw = -nx * 0.5;
    this.targetPitch = -0.42 - ny * 0.34;
  }

  // hard look (fps mode): pointer-lock deltas
  hardLook(dx, dy) {
    this.yaw -= dx * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0024, -1.2, 0.6);
    this.targetYaw = this.yaw; this.targetPitch = this.pitch;
  }

  update(dt, smooth = true) {
    if (smooth) {
      this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 6);
      this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 6);
    }
    this.camera.position.copy(this.seat.eye);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.baseYaw + this.yaw);
    this.camera.rotateX(this.pitch);
  }
}

// ------------------------------------------------------------------ weapons

export class WeaponRig {
  constructor(camera, effects, net) {
    this.camera = camera;
    this.effects = effects;
    this.net = net;
    this.group = new THREE.Group();
    camera.add(this.group);
    const models = makeWeaponViewmodels();
    this.models = models;
    for (const m of Object.values(models)) { m.visible = false; this.group.add(m); }
    models.gun.position.set(0.22, -0.18, -0.42);
    models.knife.position.set(0.22, -0.16, -0.4);
    models.knife.rotation.x = -0.4;
    models.sandal.position.set(0.22, -0.17, -0.42);
    models.sandal.rotation.z = 0.3;
    this.current = 'gun';
    this.kick = 0; this.slamT = 0; this.throwT = 0;
    this.setVisible(false);
  }

  setVisible(v) {
    for (const [k, m] of Object.entries(this.models)) m.visible = v && k === this.current;
  }

  equip(name) {
    this.current = name;
    this.setVisible(true);
    document.querySelectorAll('#weaponHud .wpn').forEach(el =>
      el.classList.toggle('sel', el.dataset.w === name));
  }

  fire() {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const origin = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.3);
    origin.y -= 0.05;
    if (this.current === 'gun') {
      this.kick = 1;
      const muzzle = this.models.gun.getObjectByName('muzzle');
      muzzle.material.opacity = 0.9;
      setTimeout(() => { muzzle.material.opacity = 0; }, 60);
      this.effects.fireGun(origin, dir);
      this.net?.antic({ kind: 'gun', origin: origin.toArray(), dir: dir.toArray() });
    } else {
      this.throwT = 1;
      const kind = this.current;
      setTimeout(() => {
        this.effects.throwProjectile(kind, origin, dir);
        this.net?.antic({ kind: 'throw', weapon: kind, origin: origin.toArray(), dir: dir.toArray() });
      }, 90);
    }
  }

  slam() {
    if (this.slamT > 0) return;
    this.slamT = 1;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const point = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir.setY(0).normalize(), 0.9);
    setTimeout(() => {
      this.effects.tableSlam(point);
      this.net?.antic({ kind: 'slam', point: point.toArray() });
    }, 140);
  }

  update(dt) {
    // recoil
    if (this.kick > 0) {
      this.kick = Math.max(0, this.kick - dt * 7);
      this.group.position.z = 0.06 * this.kick;
      this.group.rotation.x = 0.12 * this.kick;
    }
    // throw wind-up: weapon dips then snaps forward (and briefly hides)
    if (this.throwT > 0) {
      this.throwT = Math.max(0, this.throwT - dt * 3.2);
      const k = this.throwT;
      const m = this.models[this.current];
      if (m && this.current !== 'gun') {
        m.visible = k < 0.25 || k > 0.92 ? false : true;
        m.position.z = -0.4 - (1 - k) * 0.3;
        m.rotation.x = -0.4 - (1 - k) * 1.4;
        if (this.throwT === 0) { m.visible = true; m.position.z = -0.4; m.rotation.x = -0.4; }
      }
    }
    // slam: both "arms" (the whole rig) rise and crash down
    if (this.slamT > 0) {
      this.slamT = Math.max(0, this.slamT - dt * 2.6);
      const k = this.slamT;
      const up = Math.sin(Math.min(1, (1 - k) * 2.4) * Math.PI);
      this.group.position.y = up * 0.16 - (k < 0.5 ? (0.5 - k) * 0.1 : 0);
      this.group.rotation.x = up * 0.5;
      if (this.slamT === 0) { this.group.position.y = 0; this.group.rotation.x = 0; }
    }
  }
}

// ------------------------------------------------------------------ mode manager

export class Controls {
  constructor(dom, camera, rig, weaponRig) {
    this.dom = dom;
    this.camera = camera;
    this.rig = rig;             // SeatRig (players) — null for spectators
    this.weaponRig = weaponRig;
    this.mode = 'play';         // 'play' | 'fps' | 'spectator'
    this.isSpectator = !rig;
    this.keys = new Set();
    this.onPick = null;         // (event) in play mode
    this.onHover = null;
    this.mouseN = { x: 0, y: 0 };

    // spectator state: spawn outside the table, looking at it
    this.flyPos = new THREE.Vector3(3, 2.2, 3);
    this.flyYaw = Math.atan2(this.flyPos.x, this.flyPos.z);
    this.flyPitch = -0.35;

    dom.addEventListener('mousemove', (e) => {
      this.mouseN.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouseN.y = (e.clientY / innerHeight) * 2 - 1;
      if (document.pointerLockElement === dom) {
        if (this.mode === 'fps') this.rig.hardLook(e.movementX, e.movementY);
        else if (this.mode === 'spectator') {
          this.flyYaw -= e.movementX * 0.0024;
          this.flyPitch = THREE.MathUtils.clamp(this.flyPitch - e.movementY * 0.0024, -1.5, 1.5);
        }
      } else if (this.mode === 'play' && this.rig) {
        this.rig.softLook(this.mouseN.x, this.mouseN.y);
        this.onHover?.(e);
      }
    });

    dom.addEventListener('click', (e) => {
      if (this.mode === 'play') this.onPick?.(e);
      else if (this.mode === 'fps' && document.pointerLockElement === dom) this.weaponRig.fire();
      else if ((this.mode === 'fps' || this.mode === 'spectator') && document.pointerLockElement !== dom) {
        dom.requestPointerLock();
      }
    });

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys.add(e.code);
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!this.isSpectator) this.setMode(this.mode === 'fps' ? 'play' : 'fps');
      }
      if (this.mode === 'fps') {
        if (e.code === 'Digit1') this.weaponRig.equip('gun');
        if (e.code === 'Digit2') this.weaponRig.equip('knife');
        if (e.code === 'Digit3') this.weaponRig.equip('sandal');
        if (e.code === 'KeyF') this.weaponRig.slam();
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== dom && this.mode === 'fps') {
        // Esc exits pointer lock → drop back to play mode
        this.setMode('play');
      }
    });
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.toggle('fps', mode === 'fps');
    document.body.classList.toggle('spectator', mode === 'spectator');
    if (mode === 'fps' || mode === 'spectator') {
      this.dom.requestPointerLock?.();
      this.weaponRig?.setVisible(mode === 'fps');
      if (mode === 'fps') this.weaponRig.equip(this.weaponRig.current);
    } else {
      if (document.pointerLockElement === this.dom) document.exitPointerLock();
      this.weaponRig?.setVisible(false);
    }
  }

  update(dt) {
    if (this.mode === 'spectator') {
      const speed = this.keys.has('ShiftLeft') ? 1.6 : 4.2;
      const fwd = new THREE.Vector3(-Math.sin(this.flyYaw), 0, -Math.cos(this.flyYaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      if (this.keys.has('KeyW')) this.flyPos.addScaledVector(fwd, speed * dt);
      if (this.keys.has('KeyS')) this.flyPos.addScaledVector(fwd, -speed * dt);
      if (this.keys.has('KeyD')) this.flyPos.addScaledVector(right, speed * dt);
      if (this.keys.has('KeyA')) this.flyPos.addScaledVector(right, -speed * dt);
      if (this.keys.has('Space')) this.flyPos.y += speed * dt;
      if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) this.flyPos.y -= speed * dt;
      this.flyPos.y = Math.max(0.3, Math.min(7, this.flyPos.y));
      const r = Math.hypot(this.flyPos.x, this.flyPos.z);
      if (r > 14) { this.flyPos.x *= 14 / r; this.flyPos.z *= 14 / r; }
      this.camera.position.copy(this.flyPos);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.flyYaw);
      this.camera.rotateX(this.flyPitch);
    } else if (this.rig) {
      this.rig.update(dt, this.mode === 'play');
    }
    this.weaponRig?.update(dt);
  }
}
