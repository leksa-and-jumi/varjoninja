// Car models made in Blender (public/models/car_*.glb): paint colour, spinning wheels,
// headlights at night and flashing police lights.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_VERSION, vehicleSpec } from '../config';

export type CarModel =
  | 'sedan'
  | 'taxi'
  | 'police'
  | 'van'
  | 'sports'
  | 'ambulance'
  | 'suv'
  | 'pickup'
  | 'bus'
  | 'mini'
  | 'moped';
/** Append only: the index is sent between players. */
export const CAR_MODELS: CarModel[] = [
  'sedan',
  'taxi',
  'police',
  'van',
  'sports',
  'ambulance',
  'suv',
  'pickup',
  'bus',
  'mini',
  'moped',
];

/** Where the rider sits on a moped: behind the centre (metres, model space +Z is forward). */
export const MOPED_SEAT_BACK = 0.3;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const spinQ = new THREE.Quaternion();
const steerQ = new THREE.Quaternion();

const templates = new Map<CarModel, THREE.Object3D>();

export async function loadCarModels(baseUrl: string): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    CAR_MODELS.map(async (m) => {
      const gltf = await loader.loadAsync(`${baseUrl}models/car_${m}.glb?v=${MODEL_VERSION}`);
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
  private frontWheels = new Set<THREE.Object3D>();
  /** Each wheel's rest rotation from the model (its axle points sideways). */
  private wheelRest = new Map<THREE.Object3D, THREE.Quaternion>();
  private spin = 0;
  private wheelRadius = 0.35;
  private lastYaw: number | null = null;
  /** Sideways lean into turns (two-wheelers), radians; positive leans right. */
  lean = 0;
  /** A kicked moped lies on its side. */
  fallen = false;
  readonly twoWheeler: boolean;
  /** A rider sits here (child of the root), for mopeds. */
  readonly seat = new THREE.Object3D();
  readonly paint: THREE.MeshStandardMaterial;

  constructor(
    readonly model: CarModel,
    color: string,
  ) {
    const t = templates.get(model);
    if (!t) throw new Error(`car model ${model} not loaded`);
    this.root = t.clone(true);
    this.paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 });
    this.twoWheeler = vehicleSpec(model).twoWheeler;
    this.wheelRadius = model === 'moped' ? 0.24 : model === 'bus' ? 0.5 : 0.36;
    this.seat.position.set(0, 0, -MOPED_SEAT_BACK);
    this.root.add(this.seat);
    if (model === 'taxi') this.paint.color.set('#f4c20d');
    if (model === 'police') this.paint.color.set('#1f3b73');
    if (model === 'ambulance') this.paint.color.set('#d62828');
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
        this.wheelRest.set(o, o.quaternion.clone());
        if (o.name.endsWith('fl') || o.name.endsWith('fr') || o.name === 'wheel_f')
          this.frontWheels.add(o);
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
    if (this.twoWheeler) {
      // Lean into turns like a real scooter: tan(lean) = speed · turn rate / g.
      let rate = 0;
      if (this.lastYaw !== null && dt > 0) {
        const d = ((yaw - this.lastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        rate = d / dt;
      }
      const want = this.fallen
        ? 1.35
        : Math.max(-0.55, Math.min(0.55, Math.atan((-speed * rate) / 9.8)));
      this.lean += (want - this.lean) * Math.min(1, dt * 6);
      this.root.rotation.z = this.lean;
    }
    this.lastYaw = yaw;
    this.spin += (speed * dt) / this.wheelRadius;
    // Spin around the axle (the car's sideways X axis), then steer the front wheels.
    spinQ.setFromAxisAngle(X_AXIS, this.spin);
    steerQ.setFromAxisAngle(Y_AXIS, -steer);
    for (const w of this.wheels) {
      w.quaternion.copy(this.wheelRest.get(w)!).premultiply(spinQ);
      if (this.frontWheels.has(w)) w.quaternion.premultiply(steerQ);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.paint.dispose();
  }
}
