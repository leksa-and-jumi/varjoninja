// Post-processing: ambient occlusion (soft contact shadows in corners and under people),
// glow (bloom) for lit windows, lamps and sirens, then tone mapping.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class PostFx {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private renderPass: RenderPass;
  private ao: GTAOPass | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    samples: number,
    ambientOcclusion: boolean,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
    });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (ambientOcclusion) {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.updateGtaoMaterial({
        radius: 1.4,
        distanceExponent: 1.5,
        thickness: 2,
        scale: 1.2,
        samples: 12,
      });
      this.ao.blendIntensity = 0.85;
      // Half resolution is plenty for soft shadows and saves a lot of time on big screens.
      const setAoSize = this.ao.setSize.bind(this.ao);
      this.ao.setSize = (w: number, h: number) => setAoSize(Math.ceil(w / 2), Math.ceil(h / 2));
      this.ao.setSize(size.x, size.y);
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
    if (this.ao) this.ao.camera = camera;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  /** Stronger glow at night. */
  setNight(night: number): void {
    // The daytime sky is very bright before tone mapping: only real lights should glow.
    this.bloom.strength = 0.3 + night * 0.35;
    this.bloom.threshold = 3 - night * 1.7;
  }

  render(): void {
    this.composer.render();
  }
}
