// Your own hand: a fan of full-size 3D cards floating between you and the
// table edge, following the camera so it always reads like cards in hand.

import * as THREE from 'three';
import { makeCardMesh, CARD_W } from './cards3d.js';

export class HandFan {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = 'hand';
    scene.add(this.group);
    this.meshes = new Map();   // instId -> mesh
    this.order = [];
    this.hovered = null;
    this.selected = new Set(); // for discard picking
    this.visible = true;
  }

  setCards(cards) {
    // cards: [{instId, cardId}]
    const ids = new Set(cards.map(c => c.instId));
    for (const [id, mesh] of [...this.meshes]) {
      if (!ids.has(id)) { this.group.remove(mesh); this.meshes.delete(id); }
    }
    for (const c of cards) {
      if (!this.meshes.has(c.instId)) {
        const mesh = makeCardMesh(c.cardId);
        mesh.userData.instId = c.instId;
        mesh.userData.inHand = true;
        // spawn slightly below view; the layout pass floats it up
        mesh.position.set(0, -0.5, 0);
        this.group.add(mesh);
        this.meshes.set(c.instId, mesh);
      }
    }
    this.order = cards.map(c => c.instId);
  }

  update(dt) {
    const n = this.order.length;
    if (!n) { this.group.visible = false; return; }
    this.group.visible = this.visible;

    // anchor the fan to the camera
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const camQuat = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    const flatFwd = fwd.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(flatFwd, new THREE.Vector3(0, 1, 0)).negate();

    const anchor = camPos.clone().addScaledVector(flatFwd, 0.52);
    anchor.y = camPos.y - 0.33;

    const spread = Math.min(0.085, 0.5 / n);
    this.order.forEach((id, i) => {
      const mesh = this.meshes.get(id);
      if (!mesh) return;
      const k = i - (n - 1) / 2;
      const isHover = this.hovered === id;
      const isSel = this.selected.has(id);
      const target = anchor.clone()
        .addScaledVector(right, k * spread)
        .addScaledVector(flatFwd, Math.abs(k) * -0.012 + (isHover ? -0.07 : 0));
      target.y += -Math.abs(k) * 0.008 + (isHover ? 0.09 : 0) + (isSel ? 0.05 : 0);

      // tilt the face toward the camera with the title edge upright
      const yaw = Math.atan2(-flatFwd.x, -flatFwd.z);
      const e = new THREE.Euler(Math.PI / 2 - 0.62, yaw, k * -0.06, 'YXZ');
      const tq = new THREE.Quaternion().setFromEuler(e);

      mesh.position.lerp(target, Math.min(1, dt * 14));
      mesh.quaternion.slerp(tq, Math.min(1, dt * 14));
      const s = isHover ? 1.45 : 1;
      mesh.scale.lerp(new THREE.Vector3(s, 1, s), Math.min(1, dt * 12));

      for (const m of mesh.material) {
        // only per-mesh face/back materials — the edge material is shared
        if (m.map && m.emissive !== undefined) {
          m.emissive = new THREE.Color(isSel ? 0xb04030 : (isHover ? 0x8a6a30 : 0x000000));
          m.emissiveIntensity = isSel || isHover ? 0.4 : 0;
        }
      }
    });
  }

  raycast(raycaster) {
    const hits = raycaster.intersectObjects([...this.meshes.values()], false);
    return hits.length ? hits[0].object.userData.instId : null;
  }
}
