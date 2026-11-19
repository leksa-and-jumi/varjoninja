// People: the ninja, city folk, police and thugs all share one rigged body made in Blender
// (public/models/character.glb). Colours come from a per-character palette, and every pose is
// made in code by turning bones, so there are no animation files.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_VERSION } from '../config';
import { damp, type Vec3 } from '../logic/geom';
import { JOINTS, type Joint } from '../logic/ragdoll';
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
  eyeWhite: 14,
  nose: 15,
  ears: 16,
  sole: 17,
  brows: 18,
  mouth: 19,
  iris: 20,
  jacket: 21,
} as const;
const REGION_COUNT = 22;

export type Accessory =
  | 'hairShort'
  | 'hairLong'
  | 'hairBun'
  | 'hairCurly'
  | 'cap'
  | 'policeHat'
  | 'headband'
  | 'belt'
  | 'sword';
const ACCESSORIES: Accessory[] = [
  'hairShort',
  'hairLong',
  'hairBun',
  'hairCurly',
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
  /** Special outfit look (patterns, glow, metal). */
  style?: SuitStyle;
  /** Everyday clothes: what kind of shirt, trousers and so on. */
  clothes?: Clothes;
}

/** Clothing styles drawn by the shader (see CLOTHES_DETAIL). */
export interface Clothes {
  /** 0 = plain shirt, 1 = stripes, 2 = checks. */
  shirtPattern: number;
  /** Open jacket over the shirt (jacket colour in the palette). */
  jacket: boolean;
  /** 0 = trousers, 1 = jeans, 2 = shorts. */
  pants: number;
  /** Rosy cheeks and skin tone variation (people, not masks). */
  blush: number;
  /** Fabric detail strength (0 for smooth suits). */
  fabric: number;
}

const PLAIN_CLOTHES: Clothes = { shirtPattern: 0, jacket: false, pants: 0, blush: 0, fabric: 0.6 };

export interface SuitStyle {
  pattern: number;
  patternColor: THREE.Color;
  glow: number;
  metal: number;
}

const NO_STYLE: SuitStyle = { pattern: 0, patternColor: new THREE.Color(0), glow: 0, metal: 0 };

/** Shared by every character material: time for animated patterns. */
export const characterUniforms = { uTime: { value: 0 } };

export interface NinjaColors {
  suit: string;
  accent: string;
  mask: string;
}

export const SKIN_TONES = ['#f1c7a6', '#e0ac85', '#c68863', '#9a6544', '#6e4430', '#f5d5bd'];

export function ninjaLook(c: NinjaColors, skin = SKIN_TONES[1]!, style?: SuitStyle): Look {
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
  p[REGION.eyes] = new THREE.Color(0x050506);
  p[REGION.iris] = new THREE.Color(0x3b2618);
  p[REGION.hands] = new THREE.Color(0x1d1e22);
  // The mask covers nose, ears and mouth; only the eyes and brows show.
  p[REGION.eyeWhite] = new THREE.Color(0xf1efe9);
  p[REGION.nose] = mask.clone();
  p[REGION.ears] = mask.clone();
  p[REGION.mouth] = mask.clone();
  p[REGION.brows] = new THREE.Color(0x1a1410);
  p[REGION.sole] = new THREE.Color(0x0b0b0d);
  return { palette: p, accessories: ['headband', 'belt', 'sword'], scale: 1, width: 1, style };
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
  // Pupil, and a coloured iris around it.
  p[REGION.eyes] = new THREE.Color(0x050506);
  p[REGION.iris] = new THREE.Color(
    rng.pick(['#5a3a22', '#3b2618', '#3f6f9f', '#4f7a45', '#7a6a3a', '#2a1c12']),
  );
  p[REGION.hair] = new THREE.Color(rng.pick(HAIR));
  p[REGION.eyeWhite] = new THREE.Color(0xf1efe9);
  p[REGION.brows] = p[REGION.hair]!.clone().multiplyScalar(0.8);
  p[REGION.mouth] = skin.clone().lerp(new THREE.Color(0x9c4a4a), 0.45);
  p[REGION.nose] = skin.clone();
  p[REGION.sole] = new THREE.Color(0x1a1a1a);
  p[REGION.hat] = new THREE.Color(rng.pick(SHIRTS));
  p[REGION.accent] = p[REGION.hat]!.clone().multiplyScalar(0.7);
  const acc: Accessory[] = [
    rng.pick([
      'hairShort',
      'hairShort',
      'hairLong',
      'hairLong',
      'hairBun',
      'hairCurly',
      'cap',
    ] as const),
  ];
  const clothes: Clothes = {
    shirtPattern: rng.pick([0, 0, 0, 1, 2]),
    jacket: rng.chance(0.3),
    pants: rng.pick([0, 1, 1, 1, 2]),
    blush: 1,
    fabric: 1,
  };
  p[REGION.jacket] = new THREE.Color(
    rng.pick(['#2b2f36', '#5b4636', '#1f3550', '#6b6f75', '#7a2f2f', '#3d4a32']),
  );
  if (clothes.pants === 1)
    p[REGION.bottom] = new THREE.Color(rng.pick(['#2f4f7a', '#3a5f8f', '#22344f', '#4a6d96']));
  if (clothes.jacket) p[REGION.forearm] = p[REGION.jacket]!.clone();
  return {
    palette: p,
    accessories: acc,
    scale: rng.range(0.9, 1.06),
    width: rng.range(0.92, 1.15),
    clothes,
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
  look.clothes = { shirtPattern: 0, jacket: false, pants: 0, blush: 1, fabric: 1 };
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

/**
 * Clothes on the body, decided per pixel from the rest pose position (model space, metres:
 * y up, x = character's left), so hems and sleeves are straight lines.
 */
const BODY_REGIONS = /* glsl */ `
uniform vec4 uClothes; // shirt pattern, jacket, pants, blush
uniform float uFabric;
float armT(vec3 p) {
  // Arm: how far from the shoulder (0) to the wrist (1).
  vec2 sh = vec2(0.205, 1.43);
  vec2 wr = vec2(0.52, 1.0);
  vec2 d = wr - sh;
  return dot(vec2(abs(p.x), p.y) - sh, d) / dot(d, d);
}
int bodyRegion(vec3 p) {
  float ax = abs(p.x);
  bool jacket = uClothes.y > 0.5;
  if (p.y > 1.5 && ax < 0.09) return ${REGION.neck};
  if (p.y < 0.035) return ${REGION.sole};
  if (p.y < 0.14) return ${REGION.shoes};
  if (ax > 0.24 && p.y > 0.75) {
    float t = armT(p);
    if (t > 1.0) return ${REGION.hands};
    if (t > 0.48) return ${REGION.forearm};
    return jacket ? ${REGION.jacket} : ${REGION.top};
  }
  // Shorts end above the knee.
  if (uClothes.z > 1.5 && p.y < 0.6) return ${REGION.skin};
  if (p.y < 0.9) return ${REGION.bottom};
  if (p.y < 0.985) return jacket ? ${REGION.jacket} : ${REGION.belt};
  // Open jacket: the shirt shows in a strip down the front.
  if (jacket && !(p.z > 0.02 && ax < 0.055 + (p.y - 1.0) * 0.06)) return ${REGION.jacket};
  return ${REGION.top};
}
`;

/** Fabric, folds, seams, patterns, rosy cheeks and hair shine: details that make people look real. */
const CLOTHES_DETAIL = /* glsl */ `
float clothH = 0.0;
float hairShine = 0.0;
{
  vec3 p = vRest;
  float ax = abs(p.x);
  // Fade fine detail out when it would be smaller than a pixel.
  float fine = 1.0 - smoothstep(0.004, 0.02, length(fwidth(p)));
  bool shirt = cRegion == ${REGION.top} || (cRegion == ${REGION.forearm} && uClothes.y < 0.5);
  bool jacketPart = cRegion == ${REGION.jacket};
  bool trousers = cRegion == ${REGION.bottom};
  if ((shirt || jacketPart || trousers) && uFabric > 0.0) {
    // Woven fabric.
    float weave = sin(p.x * 900.0) * sin(p.y * 900.0 + p.z * 900.0);
    diffuseColor.rgb *= 1.0 + 0.035 * weave * fine * uFabric;
    // Folds: around the waist, at the elbows and behind the knees.
    float waist = smoothstep(0.16, 0.0, abs(p.y - 1.03)) * sin(p.y * 160.0 + sin(p.x * 30.0) * 2.0);
    float t = armT(p);
    float elbow = (ax > 0.24) ? smoothstep(0.14, 0.0, abs(t - 0.5)) * sin(t * 90.0 + p.z * 40.0) : 0.0;
    float knee = trousers ? smoothstep(0.12, 0.0, abs(p.y - 0.5)) * sin(p.y * 140.0 + p.x * 20.0) : 0.0;
    float ankle = trousers ? smoothstep(0.1, 0.0, p.y - 0.16) * sin(p.y * 200.0 + p.z * 30.0) : 0.0;
    clothH = (waist * 0.6 + elbow + knee * 0.8 + ankle * 0.7) * uFabric;
    diffuseColor.rgb *= 1.0 - 0.07 * max(0.0, -clothH);
    // Seams: down the sides and over the shoulders.
    float side = (1.0 - smoothstep(0.0, 0.006, abs(p.z))) * step(0.12, ax) * step(ax, 0.25);
    float shoulder = (1.0 - smoothstep(0.0, 0.006, abs(p.y - 1.445))) * step(0.12, ax) * step(ax, 0.24);
    diffuseColor.rgb *= 1.0 - 0.25 * max(side, shoulder) * fine * uFabric;
  }
  if (shirt) {
    // Collar and stripes or checks.
    float collar = smoothstep(1.465, 1.485, p.y) * step(ax, 0.1);
    diffuseColor.rgb *= 1.0 - 0.18 * collar;
    if (uClothes.x > 0.5 && uClothes.x < 1.5) {
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + 0.35, step(0.5, fract(p.y * 18.0)) * 0.6);
    } else if (uClothes.x > 1.5) {
      float c = step(0.5, fract(p.y * 14.0)) + step(0.5, fract((p.x + p.z) * 14.0));
      diffuseColor.rgb *= 0.75 + 0.18 * c;
    }
  }
  if (jacketPart) {
    // Jacket edge along the opening, and slightly shinier fabric.
    float edge = 1.0 - smoothstep(0.0, 0.01, abs(ax - (0.055 + (p.y - 1.0) * 0.06)));
    diffuseColor.rgb *= 1.0 - 0.3 * edge * step(0.02, p.z);
  }
  if (trousers && uClothes.z > 0.5 && uClothes.z < 1.5) {
    // Jeans: diagonal twill, lighter worn fronts and orange stitching on the outer seam.
    float twill = sin((p.y + p.x + p.z) * 700.0);
    diffuseColor.rgb *= 1.0 + 0.06 * twill * fine;
    float wear = smoothstep(0.0, 0.08, p.z) * (smoothstep(0.25, 0.5, p.y) * smoothstep(0.85, 0.55, p.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + 0.05, wear * 0.45);
    float stitch = (1.0 - smoothstep(0.0, 0.004, abs(p.z - 0.004))) * step(0.13, ax) * step(0.5, fract(p.y * 120.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.5, 0.2), stitch * fine * 0.8);
  }
  if (cRegion == ${REGION.shoes}) {
    // Sneakers: a white sole band and laces on top.
    float band = smoothstep(0.035, 0.04, p.y) * smoothstep(0.06, 0.055, p.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), band);
    float laces = step(0.06, p.y) * step(p.y, 0.12) * step(0.03, p.z) * step(0.5, fract(p.y * 90.0)) * step(abs(abs(p.x) - 0.11), 0.018);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), laces * fine * 0.7);
  }
  // Skin: rosy cheeks (not on masks).
  if (uClothes.w > 0.0 && (cRegion == ${REGION.head} || cRegion == ${REGION.face} || cRegion == ${REGION.skin} || cRegion == ${REGION.neck})) {
    vec2 cheekL = vec2(p.x - 0.055, p.y - 1.665);
    vec2 cheekR = vec2(p.x + 0.055, p.y - 1.665);
    float blush = (exp(-dot(cheekL, cheekL) / 0.0006) + exp(-dot(cheekR, cheekR) / 0.0006)) * smoothstep(0.03, 0.09, p.z);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.82, 0.8), blush * 0.55 * uClothes.w);
  }
  if (cRegion == ${REGION.hair}) {
    // Strands: fine lines running from the crown, and a soft shine.
    float a = atan(p.x, p.z);
    float strands = sin(a * 120.0 + p.y * 30.0) * 0.5 + 0.5;
    diffuseColor.rgb *= 0.82 + 0.3 * strands * fine;
    hairShine = 1.0;
  }
}
`;

/** Outfit patterns on the suit (tiger stripes, lightning, dragon scales, golden light). */
/** Bump the surface normal by a height value (folds), using screen-space derivatives. */
const BUMP = /* glsl */ `
vec3 clothBump(vec3 pos, vec3 n, float h) {
  vec3 dx = dFdx(pos);
  vec3 dy = dFdy(pos);
  vec3 r1 = cross(dy, n);
  vec3 r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}
`;

const SUIT_STYLE = /* glsl */ `
uniform vec4 uStyle; // pattern, glow, metal, -
uniform vec3 uPatternColor;
uniform float uTime;
bool isSuit(int r) {
  return r == ${REGION.top} || r == ${REGION.bottom} || r == ${REGION.forearm} || r == ${REGION.head} ||
    r == ${REGION.neck} || r == ${REGION.nose} || r == ${REGION.ears} || r == ${REGION.mouth};
}
`;

const SUIT_COLOR = /* glsl */ `
vec3 suitGlow = vec3(0.0);
bool suitPart = isSuit(cRegion);
{
  int pattern = int(uStyle.x + 0.5);
  float glow = uStyle.y;
  vec3 p = vRest;
  if (suitPart && pattern == 1) {
    float s = sin(p.y * 22.0 + sin(p.x * 14.0 + p.z * 9.0) * 2.2 + sin(p.x * 9.0 + p.z * 7.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, uPatternColor, smoothstep(0.5, 0.75, s));
  } else if (suitPart && pattern == 2) {
    float v = abs(sin(p.y * 16.0 + sin(p.x * 20.0) * 1.5 + sin(p.z * 17.0 + p.y * 5.0) * 1.2));
    float vein = 1.0 - smoothstep(0.0, 0.09, v);
    float pulse = 0.6 + 0.4 * sin(uTime * 6.0 + p.y * 10.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uPatternColor, vein);
    suitGlow += uPatternColor * vein * pulse * 2.5 * glow;
  } else if (suitPart && pattern == 3) {
    vec2 q = vec2((p.x + p.z) * 18.0, p.y * 22.0);
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 f = fract(q) - vec2(0.5, 0.0);
    // Thin golden rims around red scales.
    float edge = 1.0 - smoothstep(0.0, 0.07, abs(length(f) - 0.45));
    diffuseColor.rgb = mix(diffuseColor.rgb, uPatternColor, edge * 0.9);
    suitGlow += uPatternColor * edge * 0.35 * glow;
  } else if (suitPart && pattern == 4) {
    float band = smoothstep(0.8, 1.0, sin(p.y * 7.0 - uTime * 2.5 + sin(p.x * 6.0) * 0.6));
    diffuseColor.rgb = mix(diffuseColor.rgb, uPatternColor, band * 0.6);
    // The whole suit glows softly golden, with bright light running up it.
    suitGlow += uPatternColor * band * 1.8 * glow + diffuseColor.rgb * 0.35 * glow;
  }
  // Glowing eyes and headband / belt on the fancy outfits.
  if (glow > 0.0 && (cRegion == ${REGION.eyes} || cRegion == ${REGION.iris})) suitGlow += uPatternColor * 2.5 * glow;
  if (glow > 0.0 && (cRegion == ${REGION.accent} || cRegion == ${REGION.belt})) suitGlow += diffuseColor.rgb * 0.7 * glow;
}
`;

function clothesVector(c: Clothes | undefined): THREE.Vector4 {
  const k = c ?? PLAIN_CLOTHES;
  return new THREE.Vector4(k.shirtPattern, k.jacket ? 1 : 0, k.pants, k.blush);
}

function paletteMaterial(look: Look): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  const st = look.style ?? NO_STYLE;
  const uniforms = {
    uPalette: { value: look.palette.map((c) => c.clone()) },
    uStyle: { value: new THREE.Vector4(st.pattern, st.glow, st.metal, 0) },
    uPatternColor: { value: st.patternColor.clone() },
    uClothes: { value: clothesVector(look.clothes) },
    uFabric: { value: (look.clothes ?? PLAIN_CLOTHES).fabric },
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uPalette'] = uniforms.uPalette;
    shader.uniforms['uStyle'] = uniforms.uStyle;
    shader.uniforms['uPatternColor'] = uniforms.uPatternColor;
    shader.uniforms['uClothes'] = uniforms.uClothes;
    shader.uniforms['uFabric'] = uniforms.uFabric;
    shader.uniforms['uTime'] = characterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nflat varying float vRegion;\nvarying vec3 vRest;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRegion = uv.x;\nvRest = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nflat varying float vRegion;\nvarying vec3 vRest;\nuniform vec3 uPalette[${REGION_COUNT}];\n${BODY_REGIONS}\n${SUIT_STYLE}\n${BUMP}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\nint cRegion = vRegion > 29.5 ? bodyRegion(vRest) : int(clamp(floor(vRegion), 0.0, ${REGION_COUNT - 1}.0));\ndiffuseColor.rgb *= uPalette[cRegion];\n${CLOTHES_DETAIL}\n${SUIT_COLOR}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\nif (suitPart && uStyle.z > 0.0) { metalnessFactor = uStyle.z; roughnessFactor = mix(roughnessFactor, 0.28, uStyle.z); }\nif (hairShine > 0.0) roughnessFactor = 0.42;\nif (cRegion == ${REGION.eyeWhite} || cRegion == ${REGION.iris} || cRegion == ${REGION.eyes}) roughnessFactor = 0.15;\nif (cRegion == ${REGION.mouth}) roughnessFactor = 0.45;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nif (clothH != 0.0) normal = clothBump(-vViewPosition, normal, clothH * 0.004);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += suitGlow;',
      );
  };
  m.customProgramCacheKey = () => 'palette-character';
  m.userData['palette'] = uniforms.uPalette;
  m.userData['style'] = uniforms;
  return m;
}

// --- Loading ------------------------------------------------------------------------------

let template: THREE.Object3D | null = null;

export async function loadCharacterModel(baseUrl: string): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(
    `${baseUrl}models/character.glb?v=${MODEL_VERSION}`,
  );
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
  private hipsRest = new THREE.Vector3();
  private ragdoll: RagdollBone[] | null = null;
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
    this.hipsRest.copy(this.rig.get('hips')?.bone.position ?? new THREE.Vector3());
  }

  get isRagdoll(): boolean {
    return this.ragdoll !== null;
  }

  /** Where the ragdoll joints are right now (JOINTS order), taken from the current pose. */
  jointPositions(): Vec3[] {
    const at = (b: BoneName) => this.bonePosition(b, new THREE.Vector3());
    const pelvis = at('hips');
    const chest = at('chest');
    const neck = at('neck');
    const up = neck.clone().sub(chest).normalize();
    const headTop = neck.clone().addScaledVector(up, 0.3 * this.root.scale.y * this.scale);
    const foot = new THREE.Vector3(0, -0.06, 0.15)
      .multiplyScalar(this.scale)
      .applyQuaternion(this.bodyWorldQuat());
    const side = (s: 'L' | 'R') => {
      const shoulder = at(`upperArm.${s}`);
      const elbow = at(`forearm.${s}`);
      const wrist = at(`hand.${s}`);
      const hand = wrist.clone().add(
        wrist
          .clone()
          .sub(elbow)
          .normalize()
          .multiplyScalar(0.1 * this.scale),
      );
      const hip = at(`thigh.${s}`);
      const knee = at(`shin.${s}`);
      const ankle = at(`foot.${s}`);
      return { shoulder, elbow, wrist, hand, hip, knee, ankle, toe: ankle.clone().add(foot) };
    };
    const l = side('L');
    const r = side('R');
    const list: Record<Joint, THREE.Vector3> = {
      pelvis,
      chest,
      neck,
      headTop,
      shoulderL: l.shoulder,
      elbowL: l.elbow,
      wristL: l.wrist,
      handL: l.hand,
      shoulderR: r.shoulder,
      elbowR: r.elbow,
      wristR: r.wrist,
      handR: r.hand,
      hipL: l.hip,
      kneeL: l.knee,
      ankleL: l.ankle,
      toeL: l.toe,
      hipR: r.hip,
      kneeR: r.knee,
      ankleR: r.ankle,
      toeR: r.toe,
    };
    return JOINTS.map((j) => ({ x: list[j].x, y: list[j].y, z: list[j].z }));
  }

  private bodyWorldQuat(): THREE.Quaternion {
    return this.body.getWorldQuaternion(new THREE.Quaternion());
  }

  private get scale(): number {
    return this.body.children[0]?.scale.y ?? 1;
  }

  /** Switch to ragdoll mode: remember how each bone sits relative to the joint points now. */
  startRagdoll(points: Vec3[]): void {
    this.root.updateMatrixWorld(true);
    this.ragdoll = RAGDOLL_BONES.flatMap((def): RagdollBone[] => {
      const r = this.rig.get(def.bone);
      if (!r) return [];
      const world = r.bone.getWorldQuaternion(new THREE.Quaternion());
      if (def.sideA) {
        const frame = frameOf(points, def);
        return [{ def, rig: r, offset: frame.invert().multiply(world), dir0: null }];
      }
      return [{ def, rig: r, offset: world, dir0: dirOf(points, def).clone() }];
    });
  }

  /** Move the bones to follow the ragdoll points. */
  applyRagdoll(points: Vec3[]): void {
    if (!this.ragdoll) return;
    const hips = this.rig.get('hips');
    if (hips?.bone.parent) {
      const p = points[JOINTS.indexOf('pelvis')]!;
      hips.bone.position.copy(hips.bone.parent.worldToLocal(new THREE.Vector3(p.x, p.y, p.z)));
    }
    const parentWorld = new THREE.Quaternion();
    for (const rb of this.ragdoll) {
      // Torso: full frame. Limbs: the smallest turn from where the bone pointed at the start.
      const want = rb.dir0
        ? new THREE.Quaternion()
            .setFromUnitVectors(rb.dir0, dirOf(points, rb.def))
            .multiply(rb.offset)
        : frameOf(points, rb.def).multiply(rb.offset);
      rb.rig.bone.parent!.getWorldQuaternion(parentWorld);
      rb.rig.bone.quaternion.copy(parentWorld.invert().multiply(want));
      rb.rig.bone.updateMatrixWorld(true);
    }
  }

  /** Back to normal animation (e.g. when the view is reused for someone else). */
  endRagdoll(): void {
    this.ragdoll = null;
    const hips = this.rig.get('hips');
    if (hips) hips.bone.position.copy(this.hipsRest);
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
    const s = this.material.userData['style'] as {
      uStyle: { value: THREE.Vector4 };
      uPatternColor: { value: THREE.Color };
    };
    const st = look.style ?? NO_STYLE;
    s.uStyle.value.set(st.pattern, st.glow, st.metal, 0);
    s.uPatternColor.value.copy(st.patternColor);
    const c = this.material.userData['style'] as {
      uClothes: { value: THREE.Vector4 };
      uFabric: { value: number };
    };
    c.uClothes.value.copy(clothesVector(look.clothes));
    c.uFabric.value = (look.clothes ?? PLAIN_CLOTHES).fabric;
    for (const [name, obj] of this.accessories) obj.visible = look.accessories.includes(name);
    this.endRagdoll();
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
    if (hips) {
      hips.bone.position.copy(this.hipsRest);
      hips.bone.position.y = this.hipsRestY + this.hipsCurrent;
    }
  }

  dispose(): void {
    this.material.dispose();
    this.root.removeFromParent();
  }
}

const IDENTITY = new THREE.Quaternion();

// --- Ragdoll bones --------------------------------------------------------------------------

interface RagdollBoneDef {
  bone: BoneName;
  /** The bone points from joint `from` toward joint `to`… */
  from: Joint;
  to: Joint;
  /** …and (torso bones) its sideways direction follows these two joints, so it can't twist. */
  sideA?: Joint;
  sideB?: Joint;
}

interface RagdollBone {
  def: RagdollBoneDef;
  rig: BoneRig;
  /** Torso: bone rotation relative to its joint frame. Limbs: the bone's world rotation at the start. */
  offset: THREE.Quaternion;
  /** Limbs: the bone direction at the start. */
  dir0: THREE.Vector3 | null;
}

/** Parents first, so every bone sees its parent's new rotation. */
const RAGDOLL_BONES: RagdollBoneDef[] = [
  { bone: 'hips', from: 'pelvis', to: 'chest', sideA: 'hipL', sideB: 'hipR' },
  { bone: 'spine', from: 'pelvis', to: 'chest', sideA: 'shoulderL', sideB: 'shoulderR' },
  { bone: 'chest', from: 'chest', to: 'neck', sideA: 'shoulderL', sideB: 'shoulderR' },
  { bone: 'neck', from: 'neck', to: 'headTop', sideA: 'shoulderL', sideB: 'shoulderR' },
  { bone: 'head', from: 'neck', to: 'headTop', sideA: 'shoulderL', sideB: 'shoulderR' },
  { bone: 'upperArm.L', from: 'shoulderL', to: 'elbowL' },
  { bone: 'forearm.L', from: 'elbowL', to: 'wristL' },
  { bone: 'hand.L', from: 'wristL', to: 'handL' },
  { bone: 'upperArm.R', from: 'shoulderR', to: 'elbowR' },
  { bone: 'forearm.R', from: 'elbowR', to: 'wristR' },
  { bone: 'hand.R', from: 'wristR', to: 'handR' },
  { bone: 'thigh.L', from: 'hipL', to: 'kneeL' },
  { bone: 'shin.L', from: 'kneeL', to: 'ankleL' },
  { bone: 'foot.L', from: 'ankleL', to: 'toeL' },
  { bone: 'thigh.R', from: 'hipR', to: 'kneeR' },
  { bone: 'shin.R', from: 'kneeR', to: 'ankleR' },
  { bone: 'foot.R', from: 'ankleR', to: 'toeR' },
];

const fx = new THREE.Vector3();
const fy = new THREE.Vector3();
const fz = new THREE.Vector3();
const fm = new THREE.Matrix4();

const dirTmp = new THREE.Vector3();

/** Unit direction of a bone from its joint points. */
function dirOf(points: Vec3[], d: RagdollBoneDef): THREE.Vector3 {
  const a = points[JOINTS.indexOf(d.from)]!;
  const b = points[JOINTS.indexOf(d.to)]!;
  return dirTmp.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
}

/** A rotation frame from joint points: y along the bone, x toward the side joints. */
function frameOf(points: Vec3[], d: RagdollBoneDef): THREE.Quaternion {
  const p = (j: Joint) => points[JOINTS.indexOf(j)]!;
  fy.copy(dirOf(points, d));
  const s = p(d.sideA!);
  const t = p(d.sideB!);
  fx.set(s.x - t.x, s.y - t.y, s.z - t.z);
  fx.addScaledVector(fy, -fx.dot(fy)).normalize();
  fz.crossVectors(fx, fy);
  fm.makeBasis(fx, fy, fz);
  return new THREE.Quaternion().setFromRotationMatrix(fm);
}
