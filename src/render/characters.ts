// People: the ninja, city folk, police and thugs all share one rigged body made in Blender
// (public/models/character.glb). Colours come from a per-character palette, and every pose is
// made in code by turning bones, so there are no animation files.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { damp } from '../logic/geom';
import { Rng } from '../logic/rng';

/** Region numbers stored in the model's UV x (see blender/build_models.py). */
export const REGION = {
  skin: 0,
  top: 1,
  bottom: 2,
  shoes: 3,
  belt: 4,
  head: 5,
  eyes: 6,
  hands: 7,
  forearm: 8,
  neck: 9,
  face: 10,
  hair: 11,
  hat: 12,
  accent: 13,
} as const;
const REGION_COUNT = 14;

export type Accessory =
  'hairShort' | 'hairLong' | 'cap' | 'policeHat' | 'headband' | 'belt' | 'sword';
const ACCESSORIES: Accessory[] = [
  'hairShort',
  'hairLong',
  'cap',
  'policeHat',
  'headband',
  'belt',
  'sword',
];

export interface Look {
  palette: THREE.Color[];
  accessories: Accessory[];
  /** Body proportions. */
  scale: number;
  width: number;
}

export interface NinjaColors {
  suit: string;
  accent: string;
  mask: string;
}

export const SKIN_TONES = ['#f1c7a6', '#e0ac85', '#c68863', '#9a6544', '#6e4430', '#f5d5bd'];

export function ninjaLook(c: NinjaColors, skin = SKIN_TONES[1]!): Look {
  const suit = new THREE.Color(c.suit);
  const accent = new THREE.Color(c.accent);
  const mask = new THREE.Color(c.mask);
  const p = new Array(REGION_COUNT).fill(null).map(() => suit.clone());
  p[REGION.skin] = new THREE.Color(skin);
  p[REGION.face] = new THREE.Color(skin);
  p[REGION.bottom] = suit.clone().multiplyScalar(0.82);
  p[REGION.shoes] = new THREE.Color(0x15161a);
  p[REGION.belt] = accent.clone();
  p[REGION.accent] = accent.clone();
  p[REGION.head] = mask.clone();
  p[REGION.neck] = mask.clone();
  p[REGION.eyes] = new THREE.Color(0x101014);
  p[REGION.hands] = new THREE.Color(0x1d1e22);
  return { palette: p, accessories: ['headband', 'belt', 'sword'], scale: 1, width: 1 };
}

const SHIRTS = [
  '#d64545',
  '#3f7fd9',
  '#f2c14e',
  '#4caf7a',
  '#f08a4b',
  '#8e6bd6',
  '#ececec',
  '#2d3e50',
  '#e86fa8',
  '#5fc4c9',
];
const PANTS = ['#2f3e5c', '#3b3b3b', '#6b5a45', '#1f2a44', '#7d7f86', '#4a5d3a'];
const HAIR = ['#2b1d14', '#5a3a22', '#c9a15a', '#151515', '#8a4b2a', '#b9b9b9'];

export function civilianLook(seed: number): Look {
  const rng = new Rng(seed);
  const skin = new THREE.Color(rng.pick(SKIN_TONES));
  const shirt = new THREE.Color(rng.pick(SHIRTS));
  const pants = new THREE.Color(rng.pick(PANTS));
  const p = new Array(REGION_COUNT).fill(null).map(() => skin.clone());
  p[REGION.top] = shirt;
  p[REGION.forearm] = rng.chance(0.5) ? shirt.clone() : skin.clone();
  p[REGION.bottom] = pants;
  p[REGION.belt] = pants.clone().multiplyScalar(0.7);
  p[REGION.shoes] = new THREE.Color(rng.pick(['#222222', '#f2f2f2', '#6b3f22', '#33415c']));
  p[REGION.eyes] = new THREE.Color(0x15110f);
  p[REGION.hair] = new THREE.Color(rng.pick(HAIR));
  p[REGION.hat] = new THREE.Color(rng.pick(SHIRTS));
  p[REGION.accent] = p[REGION.hat]!.clone().multiplyScalar(0.7);
  const acc: Accessory[] = [
    rng.pick(['hairShort', 'hairShort', 'hairLong', 'hairLong', 'cap'] as const),
  ];
  return {
    palette: p,
    accessories: acc,
    scale: rng.range(0.9, 1.06),
    width: rng.range(0.92, 1.15),
  };
}

export function policeLook(seed: number): Look {
  const look = civilianLook(seed);
  const navy = new THREE.Color(0x1d2c4a);
  look.palette[REGION.top] = new THREE.Color(0x2c4a7a);
  look.palette[REGION.forearm] = new THREE.Color(0x2c4a7a);
  look.palette[REGION.bottom] = navy.clone();
  look.palette[REGION.belt] = new THREE.Color(0x111111);
  look.palette[REGION.shoes] = new THREE.Color(0x111111);
  look.palette[REGION.hat] = navy.clone();
  look.palette[REGION.accent] = new THREE.Color(0x111111);
  look.accessories = ['policeHat', 'belt'];
  return look;
}

export function thugLook(seed: number): Look {
  const look = civilianLook(seed);
  const rng = new Rng(seed + 5);
  const hoodie = new THREE.Color(rng.pick(['#5b1f2a', '#3a2a5c', '#24402f', '#333333']));
  look.palette[REGION.top] = hoodie;
  look.palette[REGION.forearm] = hoodie.clone();
  look.palette[REGION.bottom] = new THREE.Color(0x222428);
  look.palette[REGION.hat] = new THREE.Color(0x1a1a1a);
  look.palette[REGION.accent] = new THREE.Color(0xd4a017);
  look.accessories = ['cap'];
  look.width = rng.range(1.05, 1.2);
  return look;
}

function paletteMaterial(look: Look): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  const uniforms = { uPalette: { value: look.palette.map((c) => c.clone()) } };
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uPalette'] = uniforms.uPalette;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = uv.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vRegion;\nuniform vec3 uPalette[${REGION_COUNT}];`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n{ int r = int(clamp(floor(vRegion), 0.0, ${REGION_COUNT - 1}.0)); diffuseColor.rgb *= uPalette[r]; }`,
      );
  };
  m.customProgramCacheKey = () => 'palette-character';
  m.userData['palette'] = uniforms.uPalette;
  return m;
}

// --- Loading ------------------------------------------------------------------------------

let template: THREE.Object3D | null = null;

export async function loadCharacterModel(baseUrl: string): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(`${baseUrl}models/character.glb`);
  template = gltf.scene;
}

// --- Poses ----------------------------------------------------------------------------------

export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'upperArm.L'
  | 'forearm.L'
  | 'hand.L'
  | 'upperArm.R'
  | 'forearm.R'
  | 'hand.R'
  | 'thigh.L'
  | 'shin.L'
  | 'foot.L'
  | 'thigh.R'
  | 'shin.R'
  | 'foot.R';

const BONES: BoneName[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArm.L',
  'forearm.L',
  'hand.L',
  'upperArm.R',
  'forearm.R',
  'hand.R',
  'thigh.L',
  'shin.L',
  'foot.L',
  'thigh.R',
  'shin.R',
  'foot.R',
];

/** Rotations for each bone, in character space (x = pitch forward/back, y = twist, z = sideways). */
export type Pose = Partial<Record<BoneName, THREE.Quaternion>>;

const tmpEuler = new THREE.Euler();
export function rot(x = 0, y = 0, z = 0): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(tmpEuler.set(x, y, z, 'YXZ'));
}

/** Rest direction of the upper arms in character space (A-pose, pointing out and down). */
export const ARM_REST = {
  L: new THREE.Vector3(0.17, -0.23, 0.01).normalize(),
  R: new THREE.Vector3(-0.17, -0.23, 0.01).normalize(),
};

interface BoneRig {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  parentRest: THREE.Quaternion;
  parentRestInv: THREE.Quaternion;
  current: THREE.Quaternion;
}

/** One person in the world. */
export class CharacterView {
  readonly root = new THREE.Group();
  /** Turns with the facing direction; poses tilt it (flips, lying down). */
  readonly body = new THREE.Group();
  private rig = new Map<BoneName, BoneRig>();
  private material: THREE.MeshStandardMaterial;
  private accessories = new Map<Accessory, THREE.Object3D>();
  private hipsRestY = 0;
  hipsOffset = 0;
  private hipsCurrent = 0;
  private meshes: THREE.Mesh[] = [];

  constructor(look: Look) {
    if (!template) throw new Error('character model not loaded');
    const model = SkeletonUtils.clone(template);
    this.material = paletteMaterial(look);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        mesh.material = this.material;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
      }
      const acc = ACCESSORIES.find((a) => o.name === a);
      if (acc) this.accessories.set(acc, o);
    });
    for (const [name, obj] of this.accessories) obj.visible = look.accessories.includes(name);
    model.scale.set(look.width * look.scale, look.scale, look.scale);
    this.body.add(model);
    this.root.add(this.body);

    // Rest orientation of each bone relative to the model root.
    model.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion();
    model.getWorldQuaternion(rootInv).invert();
    for (const name of BONES) {
      // GLTFLoader drops dots from node names (upperArm.L → upperArmL).
      const bone = model.getObjectByName(name.replace('.', '')) as THREE.Bone | undefined;
      if (!bone) continue;
      const parentRest = new THREE.Quaternion();
      bone.parent!.getWorldQuaternion(parentRest);
      parentRest.premultiply(rootInv);
      this.rig.set(name, {
        bone,
        rest: bone.quaternion.clone(),
        parentRest,
        parentRestInv: parentRest.clone().invert(),
        current: new THREE.Quaternion(),
      });
    }
    this.hipsRestY = this.rig.get('hips')?.bone.position.y ?? 0;
  }

  setShadow(on: boolean): void {
    for (const m of this.meshes) m.castShadow = on;
  }

  setPaletteColor(region: number, color: THREE.Color): void {
    const u = this.material.userData['palette'] as { value: THREE.Color[] };
    u.value[region]!.copy(color);
  }

  setLook(look: Look): void {
    const u = this.material.userData['palette'] as { value: THREE.Color[] };
    look.palette.forEach((c, i) => u.value[i]!.copy(c));
    for (const [name, obj] of this.accessories) obj.visible = look.accessories.includes(name);
  }

  /** World position of a bone (for the rope hand, hits, the headband tails). */
  bonePosition(name: BoneName, out: THREE.Vector3, tailOffset = 0): THREE.Vector3 {
    const r = this.rig.get(name);
    if (!r) return out.copy(this.root.position);
    if (tailOffset) return r.bone.localToWorld(out.set(0, tailOffset, 0));
    return r.bone.getWorldPosition(out);
  }

  /** Blend toward the pose (sharpness = how fast) and apply it to the bones. */
  applyPose(pose: Pose, sharpness: number, dt: number): void {
    const t = 1 - Math.exp(-sharpness * dt);
    for (const [name, r] of this.rig) {
      const target = pose[name] ?? IDENTITY;
      r.current.slerp(target, t);
      // local = parentRest⁻¹ · R · parentRest · rest
      r.bone.quaternion
        .copy(r.parentRestInv)
        .multiply(r.current)
        .multiply(r.parentRest)
        .multiply(r.rest);
    }
    this.hipsCurrent = damp(this.hipsCurrent, this.hipsOffset, sharpness, dt);
    const hips = this.rig.get('hips');
    if (hips) hips.bone.position.y = this.hipsRestY + this.hipsCurrent;
  }

  dispose(): void {
    this.material.dispose();
    this.root.removeFromParent();
  }
}

const IDENTITY = new THREE.Quaternion();
