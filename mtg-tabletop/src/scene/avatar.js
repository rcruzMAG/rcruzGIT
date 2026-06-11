// Player avatars seated around the table. The face is a screen panel that
// shows the player's live webcam feed (via WebRTC) when available, otherwise
// a drawn face for the chosen avatar preset.

import * as THREE from 'three';
import { TABLE_Y } from './world.js';

export const AVATAR_PRESETS = [
  { name: 'Mage',     emoji: '🧙', body: 0x4a5fa8, trim: 0x2c3a6e, hat: 'cone' },
  { name: 'Knight',   emoji: '🛡️', body: 0x8a8f99, trim: 0x5c6068, hat: 'crest' },
  { name: 'Druid',    emoji: '🌿', body: 0x4d7c43, trim: 0x2e5430, hat: 'leaf' },
  { name: 'Warlock',  emoji: '💀', body: 0x5d3a6e, trim: 0x33203d, hat: 'horns' },
];

function drawIdleFace(name, preset) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1b1e24'); g.addColorStop(1, '#0e1014');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  // simple friendly face
  ctx.fillStyle = '#e9e7e2';
  ctx.beginPath(); ctx.arc(88, 104, 14, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(168, 104, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#14161a';
  ctx.beginPath(); ctx.arc(92, 106, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(172, 106, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e9e7e2'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(128, 142, 38, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
  ctx.fillStyle = '#97938c'; ctx.font = '600 20px Inter, Arial'; ctx.textAlign = 'center';
  ctx.fillText('CAM OFF', 128, 226);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeAvatar(seat, name, presetIdx) {
  const preset = AVATAR_PRESETS[presetIdx % AVATAR_PRESETS.length];
  const group = new THREE.Group();
  group.name = 'avatar_' + seat.index;

  const bodyMat = new THREE.MeshStandardMaterial({ color: preset.body, roughness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({ color: preset.trim, roughness: 0.6, metalness: 0.25 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x18191e, roughness: 0.5, metalness: 0.3 });

  // torso (seated)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 8, 18), bodyMat);
  torso.position.y = 0.92;
  // shoulders pad
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 10, 22), trimMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.13;
  // arms resting toward table
  const armGeo = new THREE.CapsuleGeometry(0.05, 0.3, 6, 12);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.24, 0.97, -0.12);
  armL.rotation.set(Math.PI / 2.6, 0, 0.5);
  const armR = armL.clone();
  armR.position.x = 0.24; armR.rotation.z = -0.5;

  // head: rounded box "monitor" with screen face on the front
  const head = new THREE.Group();
  head.name = 'head';
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.3, 0.24), skinMat);
  skull.geometry.translate(0, 0, 0);
  const screenMat = new THREE.MeshBasicMaterial({ map: drawIdleFace(name, preset), toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.26), screenMat);
  screen.position.z = -0.1225;
  screen.rotation.y = Math.PI;
  screen.name = 'faceScreen';
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.29, 0.012), trimMat);
  bezel.position.z = -0.119;
  head.add(skull, bezel, screen);

  // hat per preset
  let hat = null;
  if (preset.hat === 'cone') {
    hat = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 16), trimMat);
    hat.position.y = 0.29;
  } else if (preset.hat === 'crest') {
    hat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.28), trimMat);
    hat.position.y = 0.21;
  } else if (preset.hat === 'leaf') {
    hat = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2), trimMat);
    hat.position.y = 0.16; hat.scale.set(1.6, 0.8, 1.6);
  } else if (preset.hat === 'horns') {
    hat = new THREE.Group();
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 10), trimMat);
      horn.position.set(0.12 * s, 0.16, 0);
      horn.rotation.z = -0.5 * s;
      hat.add(horn);
    }
  }
  if (hat) head.add(hat);
  head.position.y = 1.36;

  // name tag sprite
  const tagCv = document.createElement('canvas');
  tagCv.width = 512; tagCv.height = 96;
  const tctx = tagCv.getContext('2d');
  tctx.font = '600 44px Inter, Arial';
  tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
  tctx.fillStyle = 'rgba(10,11,14,0.65)';
  const tw = Math.min(490, tctx.measureText(name).width + 48);
  tctx.beginPath(); tctx.roundRect(256 - tw / 2, 12, tw, 72, 18); tctx.fill();
  tctx.fillStyle = '#e9e7e2';
  tctx.fillText(name, 256, 50);
  const tagTex = new THREE.CanvasTexture(tagCv);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthWrite: false }));
  tag.scale.set(0.7, 0.13, 1);
  tag.position.y = 1.66;
  tag.raycast = () => {}; // sprites need raycaster.camera; exclude from hit tests

  group.add(torso, collar, armL, armR, head, tag);
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });

  // position at seat, facing the table center
  group.position.copy(seat.position);
  group.lookAt(0, 0, 0);
  group.rotateY(Math.PI); // model faces -z; flip so screen faces center

  const api = {
    group, head, screen, seat,
    idleTex: screenMat.map,
    hitTimer: 0, talkPhase: Math.random() * 10,

    setVideo(videoEl) {
      if (videoEl) {
        const vt = new THREE.VideoTexture(videoEl);
        vt.colorSpace = THREE.SRGBColorSpace;
        screenMat.map = vt;
      } else {
        screenMat.map = api.idleTex;
      }
      screenMat.needsUpdate = true;
    },

    // comedic knockback when hit by a projectile
    hit(dir) {
      api.hitTimer = 1;
      api.hitDir = dir.clone();
    },

    update(dt, t) {
      // idle sway / breathing
      const sway = Math.sin(t * 1.4 + api.talkPhase) * 0.02;
      head.rotation.z = sway;
      head.rotation.x = Math.sin(t * 0.9 + api.talkPhase) * 0.03;
      torso.scale.y = 1 + Math.sin(t * 2 + api.talkPhase) * 0.008;
      if (api.hitTimer > 0) {
        api.hitTimer = Math.max(0, api.hitTimer - dt * 2.2);
        const k = api.hitTimer;
        head.rotation.x += -k * Math.sin(k * 14) * 0.5;
        head.position.y = 1.36 + k * 0.05 * Math.sin(k * 20);
      }
    },
  };
  group.userData.avatar = api;
  return api;
}
