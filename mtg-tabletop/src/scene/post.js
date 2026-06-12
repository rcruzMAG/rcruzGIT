// Post-processing chain: MSAA render target → GTAO (ambient occlusion) →
// subtle bloom (sells the emissives: lanterns, candles, TV, fireflies, sun)
// → output (ACES tone mapping + sRGB). One toggleable unit so weaker GPUs
// can fall back to the bare renderer.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;

    const size = renderer.getSize(new THREE.Vector2()).multiplyScalar(renderer.getPixelRatio());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(renderer, target);

    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({
      radius: 0.28, distanceExponent: 1.6, thickness: 1,
      scale: 1.1, samples: 12, distanceFallOff: 1,
    });
    this.gtao.blendIntensity = 0.9;
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(size, 0.24, 0.5, 0.9);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
