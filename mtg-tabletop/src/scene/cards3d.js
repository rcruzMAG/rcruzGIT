// 3D card meshes with procedurally drawn faces, zone layout, and tweened
// motion so every draw/cast/tap/death reads as a physical card movement.

import * as THREE from 'three';
import { CARDS, manaCostString } from '../../shared/cards.js';
import { TABLE_Y } from './world.js';

export const CARD_W = 0.126;   // ~ poker card at table scale
export const CARD_H = 0.176;
export const CARD_T = 0.0012;

const COLOR_THEME = {
  W: { frame: '#d8d2bc', accent: '#f5efd9', art: ['#e8d9a8', '#b09b62'] },
  U: { frame: '#27496d', accent: '#9fc3e8', art: ['#3a6ea5', '#142c45'] },
  B: { frame: '#2b2630', accent: '#9a8fa8', art: ['#4a4252', '#171219'] },
  R: { frame: '#7a2e1f', accent: '#e8a48a', art: ['#b5482a', '#3f150b'] },
  G: { frame: '#2e5430', accent: '#a8cf9d', art: ['#4d7c43', '#16290f'] },
  C: { frame: '#5a5a5a', accent: '#cccccc', art: ['#888888', '#333333'] },
};

const faceCache = new Map();
let cardBackTex = null;

function drawArt(ctx, x, y, w, h, theme, seedStr) {
  // deterministic pseudo-art per card id: layered blobs + sparkles
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, theme.art[0]); g.addColorStop(1, theme.art[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(${rand() * 255 | 0},${rand() * 255 | 0},${rand() * 255 | 0},0.18)`;
    ctx.ellipse(x + rand() * w, y + rand() * h, 20 + rand() * w * 0.4, 14 + rand() * h * 0.4, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 22; i++) {
    const s = 1 + rand() * 2.4;
    ctx.fillRect(x + rand() * w, y + rand() * h, s, s);
  }
}

export function cardFaceTexture(cardId) {
  if (faceCache.has(cardId)) return faceCache.get(cardId);
  const c = CARDS[cardId];
  const theme = COLOR_THEME[c.color] || COLOR_THEME.C;
  const W = 360, H = 504;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // frame
  ctx.fillStyle = '#0d0b08'; ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 8, 8, W - 16, H - 16, 16); ctx.fillStyle = theme.frame; ctx.fill();

  // title bar
  roundRect(ctx, 20, 20, W - 40, 40, 8);
  ctx.fillStyle = 'rgba(8,8,8,0.78)'; ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.font = 'bold 20px Georgia, serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, c.name, W - 130), 30, 41);

  // mana cost pips
  const cost = manaCostString(c.cost);
  let px = W - 32;
  const pipColors = { W: '#f5efd9', U: '#79b3e0', B: '#8d8398', R: '#e0765a', G: '#7cb86b' };
  for (let i = cost.length - 1; i >= 0; i--) {
    const ch = cost[i];
    ctx.beginPath(); ctx.arc(px, 40, 13, 0, Math.PI * 2);
    ctx.fillStyle = pipColors[ch] || '#c9c5bb'; ctx.fill();
    ctx.fillStyle = '#181410'; ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center'; ctx.fillText(ch, px, 41); ctx.textAlign = 'left';
    px -= 28;
  }

  // art box
  drawArt(ctx, 24, 70, W - 48, 190, theme, cardId);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.strokeRect(24, 70, W - 48, 190);

  // type line
  roundRect(ctx, 20, 268, W - 40, 32, 6); ctx.fillStyle = 'rgba(8,8,8,0.72)'; ctx.fill();
  ctx.fillStyle = theme.accent; ctx.font = 'italic 15px Georgia, serif';
  const typeLine = c.types.map(t => t[0].toUpperCase() + t.slice(1)).join(' ') + (c.subtype ? ' — ' + c.subtype : '');
  ctx.fillText(fitText(ctx, typeLine, W - 60), 30, 285);

  // rules text
  roundRect(ctx, 20, 308, W - 40, H - 308 - 24, 8);
  ctx.fillStyle = 'rgba(244,240,228,0.92)'; ctx.fill();
  ctx.fillStyle = '#241f18'; ctx.font = '16px Georgia, serif';
  wrapText(ctx, c.text || '', 32, 334, W - 64, 21);

  // P/T box
  if (c.power != null) {
    roundRect(ctx, W - 96, H - 56, 72, 34, 8);
    ctx.fillStyle = theme.frame; ctx.fill();
    ctx.strokeStyle = '#0d0b08'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#14110c'; ctx.font = 'bold 22px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText(`${c.power}/${c.toughness}`, W - 60, H - 38);
    ctx.textAlign = 'left';
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  faceCache.set(cardId, tex);
  return tex;
}

function cardBackTexture() {
  if (cardBackTex) return cardBackTex;
  const cv = document.createElement('canvas');
  cv.width = 360; cv.height = 504;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1d1610'; ctx.fillRect(0, 0, 360, 504);
  roundRect(ctx, 14, 14, 332, 476, 14);
  const g = ctx.createRadialGradient(180, 252, 30, 180, 252, 260);
  g.addColorStop(0, '#6b4a23'); g.addColorStop(1, '#2a1d10');
  ctx.fillStyle = g; ctx.fill();
  // five-point mana star
  ctx.strokeStyle = '#c9a35e'; ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 4 / 5);
    const x = 180 + Math.cos(a) * 110, y = 252 + Math.sin(a) * 110;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.arc(180, 252, 130, 0, Math.PI * 2); ctx.stroke();
  cardBackTex = new THREE.CanvasTexture(cv);
  cardBackTex.colorSpace = THREE.SRGBColorSpace;
  cardBackTex.anisotropy = 8;
  return cardBackTex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, text, maxW) {
  while (ctx.measureText(text).width > maxW && text.length > 3) text = text.slice(0, -2) + '…';
  return text;
}
function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    if (ctx.measureText(line + w).width > maxW) { ctx.fillText(line, x, y); line = w + ' '; y += lineH; }
    else line += w + ' ';
  }
  ctx.fillText(line, x, y);
}

// ------------------------------------------------------------------ meshes

const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xddd6c4, roughness: 0.8 });

export function makeCardMesh(cardId) {
  // hidden card (unknown) renders back on both sides
  const faceTex = cardId ? cardFaceTexture(cardId) : cardBackTexture();
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.62, metalness: 0.02 });
  const backMat = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.62 });
  // box faces: +x, -x, +y(top), -y(bottom), +z, -z
  const mesh = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, faceMat, backMat, edgeMat, edgeMat]);
  mesh.castShadow = true;
  mesh.userData.cardId = cardId;
  return mesh;
}

// ------------------------------------------------------------------ tweens

const activeTweens = [];

export function tween(obj, to, dur = 0.35, opts = {}) {
  // cancel existing tween on the same object
  const i = activeTweens.findIndex(t => t.obj === obj);
  if (i !== -1) activeTweens.splice(i, 1);
  const from = {
    pos: obj.position.clone(),
    quat: obj.quaternion.clone(),
    scale: obj.scale.clone(),
  };
  const target = {
    pos: to.pos ? to.pos.clone() : from.pos.clone(),
    quat: to.quat ? to.quat.clone() : from.quat.clone(),
    scale: to.scale ? to.scale.clone() : from.scale.clone(),
  };
  activeTweens.push({ obj, from, to: target, t: 0, dur, arc: opts.arc || 0, onDone: opts.onDone, ease: opts.ease || easeOutCubic });
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export function updateTweens(dt) {
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    const tw = activeTweens[i];
    tw.t += dt / tw.dur;
    const k = tw.ease(Math.min(1, tw.t));
    tw.obj.position.lerpVectors(tw.from.pos, tw.to.pos, k);
    if (tw.arc) tw.obj.position.y += Math.sin(k * Math.PI) * tw.arc;  // lift mid-flight
    tw.obj.quaternion.slerpQuaternions(tw.from.quat, tw.to.quat, k);
    tw.obj.scale.lerpVectors(tw.from.scale, tw.to.scale, k);
    if (tw.t >= 1) {
      activeTweens.splice(i, 1);
      tw.onDone?.();
    }
  }
}

// ------------------------------------------------------------------ zone layout

// Computes world transforms for every visible card given a game view, then
// reconciles a mesh pool keyed by instId, tweening cards between zones.
export class CardTable {
  constructor(scene, tableRadius, seats, mySeat) {
    this.scene = scene;
    this.radius = tableRadius;
    this.seats = seats;
    this.mySeat = mySeat;         // -1 for spectators
    this.meshes = new Map();      // instId -> mesh
    this.group = new THREE.Group();
    this.group.name = 'cards';
    scene.add(this.group);
    this.hovered = null;
    this.selected = new Set();    // instIds highlighted (attackers, targets…)
    this.camera = null;
  }

  // Per-seat local frame: origin at table edge in front of seat, +z toward center.
  seatFrame(seatIdx) {
    const seat = this.seats[seatIdx % this.seats.length];
    const toCenter = new THREE.Vector3(0, 0, 0).sub(seat.position).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCenter);
    const edge = seat.position.clone().setY(TABLE_Y).addScaledVector(toCenter, 0.62);
    // yaw such that the card's top edge (local -z) points toward table center,
    // i.e. the card reads upright from this seat
    return { origin: edge, fwd: toCenter, right, yaw: Math.atan2(-toCenter.x, -toCenter.z) };
  }

  placeFlat(frame, dx, dz, tapped = false, faceUp = true, lift = 0) {
    const pos = frame.origin.clone()
      .addScaledVector(frame.right, dx)
      .addScaledVector(frame.fwd, dz);
    pos.y = TABLE_Y + 0.004 + lift;
    // BoxGeometry +y face carries the card face; X-flip turns it face down
    const e = new THREE.Euler(faceUp ? 0 : Math.PI, frame.yaw + (tapped ? -Math.PI / 2 : 0), 0, 'YXZ');
    return { pos, quat: new THREE.Quaternion().setFromEuler(e) };
  }

  layout(view, opts = {}) {
    const wanted = new Map(); // instId -> {cardId, transform, zone, dur, arc}
    const n = view.players.length;

    for (const p of view.players) {
      const frame = this.seatFrame(p.seat);
      const isMe = p.seat === this.mySeat;

      // ---- battlefield: lands row near edge, creatures row toward center
      const lands = p.battlefield.filter(c => CARDS[c.cardId].types.includes('land'));
      const creats = p.battlefield.filter(c => !CARDS[c.cardId].types.includes('land'));
      layoutRow(lands, 0.10, this.radius);
      layoutRow(creats, 0.34, this.radius);
      function layoutRow(row, dz, radius) {
        const gap = Math.min(CARD_W + 0.02, (radius * 1.1) / Math.max(1, row.length));
        row.forEach((perm, i) => {
          const dx = (i - (row.length - 1) / 2) * gap;
          wanted.set(perm.instId, {
            cardId: perm.cardId, zone: 'battlefield', perm,
            dx, dz, tapped: !!perm.tapped, seat: p.seat,
          });
        });
      }

      // ---- library: face-down stack left of play area
      const libHeight = Math.min(p.librarySize, 30);
      if (libHeight > 0) {
        wanted.set('lib_' + p.seat, {
          cardId: null, zone: 'library', seat: p.seat,
          dx: -this.radius * 0.62, dz: 0.10, stack: libHeight,
        });
      }
      // ---- graveyard: face-up pile right of play area
      const top = p.graveyard[p.graveyard.length - 1];
      if (top) {
        wanted.set('gy_' + p.seat, {
          cardId: top.cardId, zone: 'graveyard', seat: p.seat,
          dx: this.radius * 0.62, dz: 0.10, stack: Math.min(p.graveyard.length, 20),
        });
      }

      // ---- hand
      if (isMe) {
        // own hand handled by HandFan (attached near camera)
      } else {
        // opponents: face-down fan hovering at their chest
        p.hand.forEach((c, i) => {
          const k = i - (p.hand.length - 1) / 2;
          const pos = this.seats[p.seat].position.clone();
          pos.y = TABLE_Y + 0.28;
          pos.addScaledVector(frame.fwd, -0.30);
          pos.addScaledVector(frame.right, k * 0.05);
          const e = new THREE.Euler(-Math.PI / 2.6, frame.yaw + Math.PI + k * 0.1, 0, 'YXZ');
          wanted.set(c.instId, {
            cardId: null, zone: 'oppHand', seat: p.seat,
            custom: { pos, quat: new THREE.Quaternion().setFromEuler(e) },
          });
        });
      }
    }

    // ---- the stack: floating spiral above table center
    view.stack.forEach((s, i) => {
      const a = i * 0.7;
      const pos = new THREE.Vector3(Math.cos(a) * 0.12 * i, TABLE_Y + 0.42 + i * 0.07, Math.sin(a) * 0.12 * i);
      const facing = this.camera ? Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z) : 0;
      const e = new THREE.Euler(-Math.PI / 2.4, facing, 0, 'YXZ');
      wanted.set(s.instId, {
        cardId: s.cardId, zone: 'stack',
        custom: { pos, quat: new THREE.Quaternion().setFromEuler(e) },
      });
    });

    this.reconcile(wanted);
    return wanted;
  }

  reconcile(wanted) {
    // remove meshes no longer present (sink into table = to graveyard/exile feel)
    for (const [id, mesh] of [...this.meshes]) {
      if (!wanted.has(id)) {
        this.meshes.delete(id);
        tween(mesh, { pos: mesh.position.clone().setY(mesh.position.y - 0.05), scale: new THREE.Vector3(0.6, 0.6, 0.6) }, 0.3, {
          onDone: () => this.group.remove(mesh),
        });
      }
    }
    for (const [id, w] of wanted) {
      let mesh = this.meshes.get(id);
      const needRebuild = mesh && mesh.userData.cardId !== w.cardId;
      if (needRebuild) { this.group.remove(mesh); this.meshes.delete(id); mesh = null; }
      let transform;
      if (w.custom) transform = w.custom;
      else {
        const frame = this.seatFrame(w.seat);
        transform = this.placeFlat(frame, w.dx, w.dz, w.tapped, w.zone !== 'library');
        if (w.stack) transform.pos.y += w.stack * 0.0016;
      }
      if (!mesh) {
        mesh = makeCardMesh(w.cardId);
        // new cards appear from their owner's deck position for a draw/cast feel
        const frame = this.seatFrame(w.seat ?? 0);
        mesh.position.copy(frame.origin).addScaledVector(frame.right, -this.radius * 0.62);
        mesh.position.y = TABLE_Y + 0.06;
        this.group.add(mesh);
        this.meshes.set(id, mesh);
        tween(mesh, transform, 0.5, { arc: 0.12 });
      } else {
        const moved = mesh.position.distanceToSquared(transform.pos) > 1e-6 ||
                      Math.abs(mesh.quaternion.dot(transform.quat)) < 0.99999;
        if (moved) tween(mesh, transform, 0.4, { arc: w.zone === 'battlefield' ? 0.05 : 0 });
      }
      if (w.stack != null && w.zone === 'library') mesh.scale.setY(Math.max(1, w.stack * 1.4));
      mesh.userData.zoneInfo = w;
      mesh.userData.instId = id;
    }
  }

  setHighlight(instId, on, color = 0xffcf6e) {
    const mesh = this.meshes.get(instId);
    if (!mesh) return;
    for (const m of mesh.material) {
      if (m.map && m !== mesh.material[3]) m.emissive = new THREE.Color(on ? color : 0x000000), m.emissiveIntensity = on ? 0.35 : 0;
    }
  }
}
