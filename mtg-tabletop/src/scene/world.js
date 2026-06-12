// Scene construction: renderer, lighting, room, and a table that resizes to
// the number of seats. Exposes seat transforms used for cameras and avatars.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { place } from './assets.js';

export const TABLE_Y = 0.98;            // table surface height
export const EYE_HEIGHT = 1.42;         // seated first-person eye height

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e12);
  scene.fog = new THREE.Fog(0x0c0e12, 14, 30);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // --- lighting: warm key over the table, cool fill, rim
  const key = new THREE.SpotLight(0xffe3b3, 220, 0, Math.PI / 3.1, 0.45, 1.6);
  key.position.set(0, 5.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.HemisphereLight(0x33404f, 0x14110d, 0.55);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x6f87b8, 0.5);
  rim.position.set(-6, 4, -7);
  scene.add(rim);

  // environments (src/scene/environments.js) retune these per scene preset
  scene.userData.lights = { key, fill, rim };
  return scene;
}

// ------------------------------------------------------------------ textures

function canvasTexture(draw, w = 512, h = 512, repeat = 1) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function woodTexture(base = '#5b4128', streak = '#3e2b18') {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(${20 + Math.random() * 30 | 0},${14 + Math.random() * 20 | 0},8,${0.08 + Math.random() * 0.22})`;
      ctx.lineWidth = 1 + Math.random() * 4;
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6 + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
    ctx.fillStyle = streak; ctx.globalAlpha = 0.12;
    for (let i = 0; i < 12; i++) {
      const y = Math.random() * h;
      ctx.fillRect(0, y, w, 2 + Math.random() * 10);
    }
    ctx.globalAlpha = 1;
  }, 1024, 1024);
}

function feltTexture(tint = '#1d3a2e') {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 22;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    // subtle vignette ring
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, 1024, 1024);
}

// Build a tangent-space normal map from a canvas texture's luminance (the
// procedural wood/felt drawings double as height maps). Cached per texture.
const normalCache = new Map();
export function normalFor(tex, strength = 2) {
  if (normalCache.has(tex)) return normalCache.get(tex);
  const src = tex.image;
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const hgt = (x, y) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (hgt(x - 1, y) - hgt(x + 1, y)) * strength;
      const dy = (hgt(x, y - 1) - hgt(x, y + 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      img.data[i] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const ntex = new THREE.CanvasTexture(out);
  ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
  ntex.repeat.copy(tex.repeat);
  ntex.anisotropy = 8;
  normalCache.set(tex, ntex);
  return ntex;
}

// procedural texture helpers shared with the environments module
export { canvasTexture, woodTexture, feltTexture };

// ------------------------------------------------------------------ table

// Table shape rule: a square for 2–4 players, then an n-sided regular polygon
// with one flat side per player for 5+. Each seat faces the middle of a side.
// Returns { group, seats, radius (inradius), sideHalf, surface, props }.
export function buildTable(scene, nSeats) {
  const group = new THREE.Group();
  group.name = 'table';

  const sides = nSeats <= 4 ? 4 : nSeats;
  let circR, inR;
  if (nSeats <= 4) {
    inR = 1.35 + nSeats * 0.14;            // square half-width
    circR = inR / Math.cos(Math.PI / 4);
  } else {
    circR = 1.05 + nSeats * 0.34;
    inR = circR * Math.cos(Math.PI / sides);
  }
  const sideHalf = circR * Math.sin(Math.PI / sides); // half length of one flat side
  // rotate the prism so face centers (not corners) point at seat angles k·2π/sides
  const thetaStart = -Math.PI / sides;

  const woodMap = woodTexture();
  const wood = new THREE.MeshStandardMaterial({
    map: woodMap, normalMap: normalFor(woodMap, 2.4), normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.55, metalness: 0.08,
  });
  const feltMap = feltTexture();
  const felt = new THREE.MeshStandardMaterial({
    map: feltMap, normalMap: normalFor(feltMap, 1.2), normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.97, metalness: 0,
  });

  const rimScale = 1 + 0.12 / circR;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(circR * rimScale, circR * rimScale * 0.97, 0.09, sides, 1, false, thetaStart),
    wood);
  rim.position.y = TABLE_Y - 0.045;
  rim.castShadow = rim.receiveShadow = true;

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(circR, circR, 0.012, sides, 1, false, thetaStart),
    felt);
  top.position.y = TABLE_Y;
  top.receiveShadow = true;
  top.name = 'tabletop';

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, TABLE_Y - 0.1, 24), wood);
  column.position.y = (TABLE_Y - 0.1) / 2;
  column.castShadow = true;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(inR * 0.42, inR * 0.46, 0.08, sides, 1, false, thetaStart), wood);
  foot.position.y = 0.04;
  foot.castShadow = foot.receiveShadow = true;

  group.add(rim, top, column, foot);

  // seat angles: one flat side per seat; on the square, 2 players sit opposite,
  // 3 players take three of the four sides
  const seatAngles =
    nSeats === 2 ? [0, Math.PI] :
    nSeats === 3 ? [0, Math.PI / 2, Math.PI] :
    Array.from({ length: nSeats }, (_, i) => (i / sides) * Math.PI * 2);

  const seats = [];
  for (let i = 0; i < nSeats; i++) {
    const angle = seatAngles[i];
    const dist = inR + 0.12 + 0.55;
    // angles are measured like the cylinder geometry: x = sin, z = cos
    const pos = new THREE.Vector3(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
    seats.push({
      index: i,
      angle,
      position: pos.clone(),
      eye: new THREE.Vector3(pos.x, EYE_HEIGHT, pos.z),
      lookAt: new THREE.Vector3(0, TABLE_Y + 0.1, 0),
    });

    // modeled chair (Kenney furniture kit, CC0), seat facing the table
    const chairPos = pos.clone().add(new THREE.Vector3(Math.sin(angle) * 0.22, 0, Math.cos(angle) * 0.22));
    place(group, 'chairCushion', {
      at: chairPos, targetHeight: 0.92, lookAtCenter: true, flip: true,
    });
  }

  // loose props that react to table slams (dice + a beer mug). Cards never join this set.
  const props = [];
  const diceMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), diceMat);
    const a = Math.random() * Math.PI * 2, r = inR * (0.25 + Math.random() * 0.25);
    die.position.set(Math.cos(a) * r, TABLE_Y + 0.03, Math.sin(a) * r);
    die.rotation.set(Math.random(), Math.random(), Math.random());
    die.castShadow = true;
    die.userData.rest = die.position.clone();
    props.push(die);
    group.add(die);
  }
  const mug = new THREE.Group();
  const mugBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.13, 20),
    new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 0.3, metalness: 0.1 }));
  mugBody.position.y = 0.065;
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.02, 20),
    new THREE.MeshStandardMaterial({ color: 0xf2ead3, roughness: 0.8 }));
  foam.position.y = 0.135;
  mug.add(mugBody, foam);
  mug.position.set(inR * 0.32, TABLE_Y, -inR * 0.2);
  mug.userData.rest = mug.position.clone();
  mug.traverse(o => { o.castShadow = true; });
  props.push(mug);
  group.add(mug);

  scene.add(group);
  return { group, seats, radius: inR, sideHalf, surface: top, props };
}
