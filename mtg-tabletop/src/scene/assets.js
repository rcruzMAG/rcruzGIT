// CC0 model loading (Kenney furniture/nature/pirate kits, vendored in
// public/assets/models). Cached GLTF scenes, cloned per placement, with
// size normalization so kit scales don't matter at call sites.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();   // name -> Promise<{scene, size}>

export function loadModel(name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((resolve, reject) => {
      loader.load(`/assets/models/${name}.glb`, (gltf) => {
        const scene = gltf.scene;
        scene.traverse(o => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) o.material.roughness ??= 0.9;
          }
        });
        const box = new THREE.Box3().setFromObject(scene);
        resolve({ scene, size: box.getSize(new THREE.Vector3()), min: box.min.clone() });
      }, undefined, reject);
    }));
  }
  return cache.get(name);
}

// Place a model into `parent`. Options:
//   at: Vector3 (ground position) · rotY · scale (uniform multiplier)
//   targetHeight / targetWidth: normalize the model's bbox to this size first
//   lookAtCenter: rotate so the model's +z faces the world origin
// Loading is async: a group is returned synchronously and filled when ready.
export function place(parent, name, opts = {}) {
  const holder = new THREE.Group();
  if (opts.at) holder.position.copy(opts.at);
  if (opts.rotY != null) holder.rotation.y = opts.rotY;
  parent.add(holder);
  loadModel(name).then(({ scene, size, min }) => {
    const model = scene.clone(true);
    let s = opts.scale ?? 1;
    if (opts.targetHeight) s *= opts.targetHeight / size.y;
    else if (opts.targetWidth) s *= opts.targetWidth / Math.max(size.x, size.z);
    model.scale.setScalar(s);
    model.position.y = -min.y * s;   // rest the model on the holder's origin
    holder.add(model);
    if (opts.lookAtCenter) {
      holder.lookAt(0, holder.position.y, 0);
      if (opts.flip) holder.rotateY(Math.PI);   // kits whose forward axis is -z
    }
    opts.onReady?.(holder, model);
  }).catch(() => { /* missing model: silently keep the empty holder */ });
  return holder;
}
