// Scene construction: renderer, lighting, room, and a table that resizes to
// the number of seats. Exposes seat transforms used for cameras and avatars.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

  buildRoom(scene);
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

// ------------------------------------------------------------------ room

function buildRoom(scene) {
  const floorTex = woodTexture('#3a2c1d', '#241a10');
  floorTex.repeat.set(6, 6);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // surrounding wall cylinder, dark tavern feel
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 8, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x191b20, roughness: 0.95, side: THREE.BackSide }),
  );
  wall.position.y = 4;
  scene.add(wall);

  // hanging lamp above the table
  const lampGroup = new THREE.Group();
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 0.55, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }),
  );
  shade.position.y = 4.45;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 6 }),
  );
  bulb.position.y = 4.25;
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  cord.position.y = 6.3;
  lampGroup.add(shade, bulb, cord);
  scene.add(lampGroup);
}

// ------------------------------------------------------------------ table

// Returns { group, seats: [{position, angle, lookAt}], radius } sized for n players.
export function buildTable(scene, nSeats) {
  const group = new THREE.Group();
  group.name = 'table';

  // table radius grows with the seat count
  const radius = nSeats <= 2 ? 1.55 : 1.25 + nSeats * 0.3;
  const rimR = radius + 0.12;

  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.08 });
  const felt = new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.97, metalness: 0 });

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.97, 0.09, 64), wood);
  rim.position.y = TABLE_Y - 0.045;
  rim.castShadow = rim.receiveShadow = true;

  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.012, 64), felt);
  top.position.y = TABLE_Y;
  top.receiveShadow = true;
  top.name = 'tabletop';

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, TABLE_Y - 0.1, 24), wood);
  column.position.y = (TABLE_Y - 0.1) / 2;
  column.castShadow = true;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.72, 0.08, 32), wood);
  foot.position.y = 0.04;
  foot.castShadow = foot.receiveShadow = true;

  group.add(rim, top, column, foot);

  // seats around the table
  const seats = [];
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2c2218, roughness: 0.8 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x4a2630, roughness: 0.95 });
  for (let i = 0; i < nSeats; i++) {
    const angle = (i / nSeats) * Math.PI * 2 + Math.PI / 2; // seat 0 faces -Z side
    const dist = rimR + 0.55;
    const pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    seats.push({
      index: i,
      angle,
      position: pos.clone(),
      eye: new THREE.Vector3(pos.x, EYE_HEIGHT, pos.z),
      lookAt: new THREE.Vector3(0, TABLE_Y + 0.1, 0),
    });

    const chair = new THREE.Group();
    const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.5), cushionMat);
    seatMesh.position.y = 0.52;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.07), chairMat);
    back.position.set(0, 0.86, 0.235);
    for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.52), chairMat);
      leg.position.set(lx, 0.26, lz);
      chair.add(leg);
    }
    chair.add(seatMesh, back);
    chair.position.copy(pos).add(new THREE.Vector3(Math.cos(angle) * 0.22, 0, Math.sin(angle) * 0.22));
    chair.lookAt(0, 0.5, 0);
    chair.traverse(o => { o.castShadow = true; });
    group.add(chair);
  }

  // loose props that react to table slams (dice + a beer mug). Cards never join this set.
  const props = [];
  const diceMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), diceMat);
    const a = Math.random() * Math.PI * 2, r = radius * (0.55 + Math.random() * 0.3);
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
  mug.position.set(radius * 0.7, TABLE_Y, -radius * 0.45);
  mug.userData.rest = mug.position.clone();
  mug.traverse(o => { o.castShadow = true; });
  props.push(mug);
  group.add(mug);

  scene.add(group);
  return { group, seats, radius, surface: top, props };
}
