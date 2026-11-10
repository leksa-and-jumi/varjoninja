// Sky, sun, moon, stars, fog and the reflection map, all following the time of day.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunState, type SunState } from '../logic/daytime';
import { Rng } from '../logic/rng';

const DAY_FOG = new THREE.Color(0xa9c4d8);
const DUSK_FOG = new THREE.Color(0xd99a6c);
const NIGHT_FOG = new THREE.Color(0x0b1424);

export class SkyView {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x50483e, 1);
  readonly sky = new Sky();
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvNight = -1;
  private lastEnvSunY = -2;
  state: SunState = sunState(0.4);
  private shadowTexel = 1;
  private lightBasis = new THREE.Matrix4();
  private lightBasisInv = new THREE.Matrix4();

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    shadowSize: number,
  ) {
    this.sky.scale.setScalar(9000);
    this.scene.add(this.sky);
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u['turbidity']!.value = 2.6;
      u['rayleigh']!.value = 1.2;
      u['mieCoefficient']!.value = 0.004;
      u['mieDirectionalG']!.value = 0.85;
    }
    this.envSky.scale.setScalar(100);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun.castShadow = shadowSize > 0;
    if (shadowSize > 0) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const cam = this.sun.shadow.camera;
      // Bigger shadow maps cover more of the city (long building shadows across the streets).
      const ext = shadowSize >= 4096 ? 140 : 100;
      this.shadowTexel = (ext * 2) / shadowSize;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 1;
      cam.far = 900;
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 0.35;
    }
    scene.add(this.sun, this.sun.target, this.hemi);

    this.stars = makeStars();
    scene.add(this.stars);
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(60, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff6e0, fog: false }),
    );
    scene.add(this.moon);
    scene.fog = new THREE.FogExp2(DAY_FOG.clone(), 0.0011);
  }

  /** Call every frame with the time of day and the point the shadows should cover. */
  update(tod: number, focus: THREE.Vector3): void {
    const s = (this.state = sunState(tod));
    const sunDir = new THREE.Vector3(s.x, s.y, s.z);
    this.sky.material.uniforms['sunPosition']!.value.copy(sunDir);
    this.sky.position.copy(focus);

    // At night, light comes from the moon (opposite the sun) and is blue and dim.
    const lightDir = s.y > -0.05 ? sunDir : sunDir.clone().negate();
    const dayLight = THREE.MathUtils.smoothstep(s.y, -0.05, 0.25);
    const sunColor = new THREE.Color(1, 0.97, 0.9).lerp(new THREE.Color(1, 0.62, 0.35), s.dusk);
    if (s.y <= -0.05) sunColor.setRGB(0.55, 0.65, 1);
    this.sun.color.copy(sunColor);
    this.sun.intensity = s.y > -0.05 ? 0.3 + 2.3 * dayLight : 0.3 * s.night;
    // Snap the shadow camera to whole shadow-map texels, so shadow edges don't shimmer
    // while the ninja moves.
    this.lightBasis.lookAt(lightDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.lightBasisInv.copy(this.lightBasis).invert();
    const snapped = focus.clone().applyMatrix4(this.lightBasisInv);
    snapped.x = Math.round(snapped.x / this.shadowTexel) * this.shadowTexel;
    snapped.y = Math.round(snapped.y / this.shadowTexel) * this.shadowTexel;
    snapped.applyMatrix4(this.lightBasis);
    this.sun.position.copy(snapped).addScaledVector(lightDir, 400);
    this.sun.target.position.copy(snapped);
    // Moonlit nights: dim but never pitch black.
    this.hemi.intensity = 0.45 + 0.1 * dayLight;
    this.hemi.color.setRGB(0.75, 0.85, 1).lerp(new THREE.Color(0.32, 0.4, 0.68), s.night);
    this.hemi.groundColor.setRGB(0.35, 0.32, 0.28).lerp(new THREE.Color(0.08, 0.08, 0.12), s.night);

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color
      .copy(DAY_FOG)
      .lerp(DUSK_FOG, s.dusk * 0.8)
      .lerp(NIGHT_FOG, s.night);
    fog.density = 0.0009 + s.night * 0.0004;

    const starMat = this.stars.material as THREE.PointsMaterial;
    starMat.opacity = s.night;
    this.stars.visible = s.night > 0.01;
    this.stars.position.copy(focus);
    this.moon.position.copy(focus).addScaledVector(sunDir, -4000);
    this.moon.visible = s.y < 0.1;

    // Reflection map: re-render only when the sky changed enough.
    if (Math.abs(s.night - this.lastEnvNight) > 0.04 || Math.abs(s.y - this.lastEnvSunY) > 0.04) {
      this.lastEnvNight = s.night;
      this.lastEnvSunY = s.y;
      this.envSky.material.uniforms['sunPosition']!.value.copy(sunDir);
      // A night sky is black in the Sky shader: brighten the reflections a little with fog colour.
      this.envScene.background = s.night > 0.5 ? fog.color.clone().multiplyScalar(2) : null;
      this.envSky.visible = s.night < 0.95;
      const target = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      this.envTarget?.dispose();
      this.envTarget = target;
      this.scene.environment = target.texture;
    }
    // The sky is very bright before tone mapping, so reflections are kept subtle.
    this.scene.environmentIntensity = 0.06 + 0.06 * dayLight;
  }
}

function makeStars(): THREE.Points {
  const rng = new Rng(42);
  const pos: number[] = [];
  for (let i = 0; i < 1600; i++) {
    const u = rng.next() * 2 - 1;
    const a = rng.next() * Math.PI * 2;
    const y = Math.abs(u);
    const r = Math.sqrt(1 - y * y);
    pos.push(Math.cos(a) * r * 5000, y * 5000, Math.sin(a) * r * 5000);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    fog: false,
    depthWrite: false,
  });
  return new THREE.Points(g, m);
}
