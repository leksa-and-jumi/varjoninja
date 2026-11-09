// Car models made in Blender (public/models/car_*.glb): paint colour, spinning wheels,
// headlights at night and flashing police lights.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type CarModel = 'sedan' | 'taxi' | 'police' | 'van' | 'sports';
export const CAR_MODELS: CarModel[] = ['sedan', 'taxi', 'police', 'van', 'sports'];

const templates = new Map<CarModel, THREE.Object3D>();

export async function loadCarModels(baseUrl: string): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    CAR_MODELS.map(async (m) => {
      const gltf = await loader.loadAsync(`${baseUrl}models/car_${m}.glb`);
      templates.set(m, gltf.scene);
    }),
  );
}

export const CAR_COLORS = [
  '#c0392b',
  '#2e86de',
  '#f5f6fa',
  '#1e272e',
  '#27ae60',
  '#8e44ad',
  '#e67e22',
  '#7f8c8d',
  '#f1c40f',
  '#16a085',
];

/** Shared light materials, so all cars switch their lights with one change. */
const shared = {
  headlight: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff2d0,
    emissiveIntensity: 0.3,
  }),
  taillight: new THREE.MeshStandardMaterial({
    color: 0x660808,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.3,
  }),
  sirenRed: new THREE.MeshStandardMaterial({
    color: 0x660000,
    emissive: 0xff1010,
    emissiveIntensity: 0.2,
  }),
  sirenBlue: new THREE.MeshStandardMaterial({
    color: 0x000a55,
    emissive: 0x2050ff,
    emissiveIntensity: 0.2,
  }),
  sign: new THREE.MeshStandardMaterial({
    color: 0xffd23f,
    emissive: 0xffc020,
    emissiveIntensity: 0.4,
  }),
};

export function updateCarLights(night: number, time: number, sirenOn: boolean): void {
  shared.headlight.emissiveIntensity = 0.3 + night * 5;
  shared.taillight.emissiveIntensity = 0.4 + night * 3;
  shared.sign.emissiveIntensity = 0.4 + night * 2;
  const flash = Math.floor(time * 6) % 2 === 0;
  shared.sirenRed.emissiveIntensity = sirenOn ? (flash ? 8 : 0.2) : 0.2;
  shared.sirenBlue.emissiveIntensity = sirenOn ? (flash ? 0.2 : 8) : 0.2;
}

export class CarView {
  readonly root: THREE.Object3D;
  private wheels: THREE.Object3D[] = [];
  private frontWheels: THREE.Object3D[] = [];
  private spin = 0;
  readonly paint: THREE.MeshStandardMaterial;

  constructor(
    readonly model: CarModel,
    color: string,
  ) {
    const t = templates.get(model);
    if (!t) throw new Error(`car model ${model} not loaded`);
    this.root = t.clone(true);
    this.paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 });
    if (model === 'taxi') this.paint.color.set('#f4c20d');
    if (model === 'police') this.paint.color.set('#1f3b73');
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        const name = (mesh.material as THREE.Material).name;
        if (name === 'paint') mesh.material = this.paint;
        else if (name === 'headlight') mesh.material = shared.headlight;
        else if (name === 'taillight') mesh.material = shared.taillight;
        else if (name === 'siren_red') mesh.material = shared.sirenRed;
        else if (name === 'siren_blue') mesh.material = shared.sirenBlue;
        else if (name === 'sign') mesh.material = shared.sign;
      }
      if (o.name.startsWith('wheel_')) {
        this.wheels.push(o);
        if (o.name.endsWith('fl') || o.name.endsWith('fr')) this.frontWheels.push(o);
      }
    });
  }

  /** Place the car; `speed` spins the wheels, `steer` turns the front wheels. */
  update(
    x: number,
    y: number,
    z: number,
    yaw: number,
    speed: number,
    steer: number,
    dt: number,
  ): void {
    this.root.position.set(x, y, z);
    // The model's front (Blender -Y) is +Z after export, the same as yaw 0.
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / 0.35;
    for (const w of this.wheels) {
      w.rotation.set(0, 0, 0);
      w.rotateX(this.spin);
    }
    for (const w of this.frontWheels) {
      w.rotation.set(0, 0, 0);
      w.rotateY(-steer);
      w.rotateX(this.spin);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.paint.dispose();
  }
}
