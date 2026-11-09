// Shader-patched materials for the city. Windows, road markings and lamp light pools are
// drawn in the shader from the world position, so the whole city needs very few textures.

import * as THREE from 'three';
import { BUILDING, CITY, CITY_HALF, CITY_PITCH } from '../config';

/** Uniforms shared by every city material (updated once per frame). */
export const cityUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

const COMMON = /* glsl */ `
uniform float uNight;
uniform float uTime;
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
`;

const LAMPS = /* glsl */ `
// Warm light pools under the street lamps (lamps sit on a regular grid along every road).
float lampPool(vec2 p) {
  float pitch = ${CITY_PITCH.toFixed(3)};
  float half_ = ${CITY_HALF.toFixed(3)};
  float step_ = pitch / 3.0;
  float side = ${(CITY.roadWidth / 2 - 1.2).toFixed(3)};
  float light = 0.0;
  for (int axis = 0; axis < 2; axis++) {
    vec2 q = axis == 0 ? p : p.yx;
    // Distance to the nearest road line across, and to the nearest lamp along.
    float across = q.x + half_;
    float line = clamp(floor(across / pitch + 0.5), 0.0, ${CITY.blocks.toFixed(1)}) * pitch;
    float dx = abs(across - line);
    float along = q.y + half_;
    float t = along / step_;
    float dz = (fract(t) - 0.5) * step_;
    float inside = step(0.0, along) * step(along, pitch * ${CITY.blocks.toFixed(1)});
    float d = length(vec2(dx - side, dz));
    light = max(light, inside * exp(-d * d * 0.028));
  }
  return light;
}
`;

function patch(
  material: THREE.MeshStandardMaterial,
  name: string,
  vertexDecl: string,
  vertexMain: string,
  fragmentDecl: string,
  fragmentColor: string,
  fragmentAfter: string,
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\n${vertexDecl}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n${vertexMain}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vWorldPos;\n${COMMON}\n${fragmentDecl}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentColor}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${fragmentAfter}`,
      );
  };
  material.customProgramCacheKey = () => name;
  return material;
}

/**
 * Buildings. Per-vertex attributes:
 *  aFaceUv = (metres along the face, metres above the street)
 *  aFace  = (face width, seed, facade, tint)
 *  aSpan  = (box bottom, box top)
 */
export function createBuildingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 1 });
  return patch(
    m,
    'building',
    `attribute vec4 aFace; attribute vec2 aSpan; attribute vec2 aFaceUv; varying vec4 vFace; varying vec2 vSpan; varying vec2 vFaceUv; varying vec3 vObjNormal;`,
    `vFace = aFace; vSpan = aSpan; vFaceUv = aFaceUv; vObjNormal = normal;`,
    /* glsl */ `
varying vec4 vFace; varying vec2 vSpan; varying vec2 vFaceUv; varying vec3 vObjNormal;
float bWindow; float bLit; vec3 bLitColor; float bRough; float bMetal;
vec3 facadeColor(float facade, float tint) {
  if (facade < 0.5) return mix(vec3(0.42, 0.55, 0.62), vec3(0.55, 0.62, 0.66), tint);          // glass frame
  if (facade < 1.5) return mix(vec3(0.62, 0.6, 0.56), vec3(0.78, 0.74, 0.66), tint);          // office stone
  if (facade < 2.5) return mix(vec3(0.52, 0.24, 0.18), vec3(0.7, 0.42, 0.3), tint);            // brick
  if (facade < 3.5) return mix(vec3(0.86, 0.86, 0.84), vec3(0.62, 0.7, 0.76), tint);           // modern panels
  return mix(vec3(0.45, 0.47, 0.5), vec3(0.6, 0.55, 0.45), tint);                               // warehouse
}
vec3 glassColor(float facade, float tint) {
  if (facade < 0.5) return mix(vec3(0.05, 0.16, 0.24), vec3(0.08, 0.22, 0.2), tint);
  return vec3(0.07, 0.09, 0.12);
}
`,
    /* glsl */ `
{
  float W = vFace.x; float seed = vFace.y; float facade = vFace.z; float tint = vFace.w;
  bWindow = 0.0; bLit = 0.0; bLitColor = vec3(1.0, 0.78, 0.48); bRough = 0.85; bMetal = 0.0;
  vec3 base = facadeColor(facade, tint);
  if (vObjNormal.y > 0.5) {
    // Roof: gravel with a lighter parapet line near the edges.
    float n = vnoise(vWorldPos.xz * 1.7) * 0.5 + vnoise(vWorldPos.xz * 0.21) * 0.5;
    base = mix(vec3(0.17, 0.17, 0.18), vec3(0.26, 0.25, 0.24), n);
    diffuseColor.rgb = base;
  } else {
    float u = vFaceUv.x; float v = vFaceUv.y;
    float floorH = facade < 0.5 ? 4.0 : ${BUILDING.floorHeight.toFixed(2)};
    float groundH = ${BUILDING.groundFloorHeight.toFixed(2)};
    float cellW = facade < 0.5 ? 1.9 : facade < 1.5 ? 3.0 : facade < 2.5 ? 2.6 : facade < 3.5 ? 3.4 : 6.0;
    float cols = max(1.0, floor(W / cellW + 0.5));
    float cw = W / cols;
    float cu = fract(u / cw);
    float col = floor(u / cw);
    float top = vSpan.y;
    vec3 wall = base;
    // Subtle large-scale dirt / variation so walls are not flat.
    wall *= 0.9 + 0.12 * vnoise(vec2(u * 0.15, v * 0.08) + seed);
    if (facade > 1.5 && facade < 2.5) {
      // Brick rows.
      float bv = fract(v / 0.32); float bu = fract(u / 0.7 + step(0.5, fract(v / 0.64)) * 0.5);
      float mortar = max(step(bv, 0.08), step(bu, 0.04));
      wall = mix(wall * (0.88 + 0.2 * h21(floor(vec2(u / 0.7, v / 0.32)))), vec3(0.7, 0.66, 0.6), mortar * 0.6);
    }
    float inWin = 0.0;
    float row = 0.0;
    if (v < groundH && vSpan.x < 0.5) {
      // Street level: big shop windows with a dark frame.
      inWin = step(0.06, cu) * step(cu, 0.94) * step(0.5, v) * step(v, groundH - 1.1);
      row = -1.0;
      float band = step(groundH - 0.9, v) * step(v, groundH - 0.25);
      wall = mix(wall, wall * 0.55, band);
    } else if (v < top - 1.2) {
      float fv = (v - groundH) / floorH;
      row = floor(fv);
      float cv = fract(fv);
      if (facade < 0.5) inWin = step(0.04, cu) * step(cu, 0.96) * step(0.06, cv) * step(cv, 0.97);
      else if (facade < 1.5) inWin = step(0.16, cu) * step(cu, 0.84) * step(0.25, cv) * step(cv, 0.82);
      else if (facade < 2.5) {
        inWin = step(0.26, cu) * step(cu, 0.74) * step(0.22, cv) * step(cv, 0.78);
        float sill = step(0.24, cu) * step(cu, 0.76) * step(0.16, cv) * step(cv, 0.22);
        wall = mix(wall, vec3(0.78, 0.74, 0.68), sill);
      } else if (facade < 3.5) inWin = step(0.03, cu) * step(cu, 0.97) * step(0.3, cv) * step(cv, 0.85);
      else inWin = step(0.3, cu) * step(cu, 0.7) * step(0.55, cv) * step(cv, 0.78) * step(0.5, h21(vec2(col, seed)));
      // Vertical stripes between window columns on stone offices.
      if (facade > 0.5 && facade < 1.5) wall *= 1.0 - 0.12 * step(abs(cu - 0.5), 0.36) * (1.0 - inWin);
    } else {
      // Cornice at the top of each box.
      wall = mix(wall * 0.75, wall * 1.1, step(top - 0.5, v));
    }
    bWindow = inWin;
    // Night: some windows are lit. Which ones depends on the building and the room.
    float rnd = h21(vec2(col + seed * 0.37, row * 1.31 + seed));
    float litChance = mix(0.0, row < 0.0 ? 0.6 : 0.38, uNight);
    bLit = inWin * step(rnd, litChance);
    float hue = h21(vec2(row, col * 3.1 + seed));
    bLitColor = hue < 0.6 ? vec3(1.0, 0.78, 0.48) : hue < 0.85 ? vec3(0.9, 0.93, 1.0) : vec3(0.65, 0.85, 1.0);
    if (row < 0.0) bLitColor = vec3(1.0, 0.85, 0.6);
    // Inside a window: dark glass that reflects the sky; a little interior variation.
    vec3 glass = glassColor(facade, tint) * (0.75 + 0.5 * h21(vec2(col, row + seed)));
    diffuseColor.rgb = mix(wall, glass, inWin);
    bRough = mix(facade > 2.5 && facade < 3.5 ? 0.55 : 0.88, 0.06, inWin);
    bMetal = mix(0.0, facade < 0.5 ? 0.85 : 0.6, inWin);
  }
}
`,
    /* glsl */ `
roughnessFactor = bRough;
metalnessFactor = bMetal;
float flicker = 0.85 + 0.15 * h21(floor(vWorldPos.xy * 0.3) + floor(vWorldPos.zy * 0.3));
totalEmissiveRadiance += bLit * bLitColor * 0.9 * flicker * (0.55 + 0.45 * smoothstep(0.0, 1.0, fract(vFaceUv.y / 3.6)));
`,
  );
}

/**
 * Streets, sidewalks, parks and the promenade. Attribute aKind:
 * 0 = road plane, 1 = sidewalk + lot, 2 = park, 3 = plaza.
 */
export function createGroundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const half = CITY.roadWidth / 2;
  return patch(
    m,
    'ground',
    `attribute float aKind; attribute vec4 aBlock; varying float vKind; varying vec4 vBlock;`,
    `vKind = aKind; vBlock = aBlock;`,
    /* glsl */ `
varying float vKind; varying vec4 vBlock;
float gLamp;
${LAMPS}
`,
    /* glsl */ `
{
  vec2 p = vWorldPos.xz;
  float pitch = ${CITY_PITCH.toFixed(3)};
  float H = ${CITY_HALF.toFixed(3)};
  float halfRoad = ${half.toFixed(3)};
  float edge = H + halfRoad;
  vec3 col;
  if (vKind < 0.5) {
    // Distance to the nearest road centre line, for each direction.
    vec2 q = p + H;
    vec2 lineIdx = clamp(floor(q / pitch + 0.5), 0.0, ${CITY.blocks.toFixed(1)});
    vec2 d = q - lineIdx * pitch;
    vec2 ad = abs(d);
    bool inCity = abs(p.x) <= edge && abs(p.y) <= edge;
    float n = vnoise(p * 2.3) * 0.5 + vnoise(p * 0.13) * 0.5;
    col = mix(vec3(0.16, 0.165, 0.17), vec3(0.23, 0.23, 0.235), n);
    // Tyre tracks: slightly darker in the middle of each lane.
    if (inCity) {
      bool alongZ = ad.x <= halfRoad && ad.y > halfRoad;
      bool alongX = ad.y <= halfRoad && ad.x > halfRoad;
      float mark = 0.0;
      vec3 markCol = vec3(0.92);
      if (alongZ || alongX) {
        float across = alongZ ? d.x : d.y;
        float along = alongZ ? ad.y : ad.x;
        float alongPos = alongZ ? p.y : p.x;
        float aa = abs(across);
        if (along < halfRoad + 4.0) {
          // Zebra crossing.
          mark = step(0.5, fract(across / 1.1)) * step(aa, halfRoad - 0.6) * step(halfRoad + 0.6, along);
        } else {
          float yellow = step(0.1, aa) * step(aa, 0.26);
          if (yellow > 0.0) { mark = 1.0; markCol = vec3(0.95, 0.75, 0.15); }
          float dash = step(abs(aa - ${CITY.laneWidth.toFixed(2)}), 0.08) * step(fract(alongPos / 9.0), 0.5);
          float edgeLine = step(abs(aa - (halfRoad - 0.55)), 0.08);
          mark = max(mark, max(dash, edgeLine));
        }
        mark *= 0.75 + 0.25 * vnoise(p * 6.0);
      }
      col = mix(col, markCol, mark);
    } else {
      // Outside the street grid: promenade stones.
      vec2 t = fract(p / 1.5);
      float joint = max(step(t.x, 0.03), step(t.y, 0.03));
      col = mix(vec3(0.62, 0.58, 0.52), vec3(0.5, 0.47, 0.42), joint) * (0.85 + 0.25 * vnoise(p * 0.7));
    }
  } else {
    // Block: sidewalk ring, then lot ground / park / plaza.
    float dEdge = min(min(p.x - vBlock.x, vBlock.z - p.x), min(p.y - vBlock.y, vBlock.w - p.y));
    vec2 t = fract(p / 1.25);
    float joint = max(step(t.x, 0.04), step(t.y, 0.04));
    vec3 tiles = mix(vec3(0.46, 0.45, 0.43), vec3(0.36, 0.35, 0.34), joint) * (0.88 + 0.2 * vnoise(p * 0.9));
    if (dEdge < 0.3) tiles = vec3(0.55, 0.54, 0.52); // curb stone
    if (dEdge < ${CITY.sidewalkWidth.toFixed(2)} || vKind < 1.5) {
      col = tiles;
      if (vKind < 1.5 && dEdge >= ${CITY.sidewalkWidth.toFixed(2)}) {
        col = mix(vec3(0.42, 0.41, 0.4), vec3(0.5, 0.49, 0.47), vnoise(p * 0.5)); // lot concrete
      }
    } else if (vKind < 2.5) {
      vec2 c = (vBlock.xy + vBlock.zw) * 0.5;
      vec2 r = abs(p - c);
      float path = step(min(r.x, r.y), 2.6);
      float g = vnoise(p * 0.35) * 0.6 + vnoise(p * 3.0) * 0.4;
      vec3 grass = mix(vec3(0.2, 0.38, 0.13), vec3(0.33, 0.52, 0.18), g);
      col = mix(grass, vec3(0.62, 0.55, 0.42) * (0.9 + 0.2 * vnoise(p)), path);
    } else {
      vec2 c = (vBlock.xy + vBlock.zw) * 0.5;
      float rr = length(p - c);
      float ring = step(0.5, fract(rr / 3.0));
      col = mix(vec3(0.72, 0.68, 0.6), vec3(0.62, 0.57, 0.5), ring) * (0.9 + 0.15 * vnoise(p * 1.3));
    }
  }
  diffuseColor.rgb = col;
  gLamp = lampPool(p);
}
`,
    /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.42) * gLamp * uNight * 1.1;
`,
  );
}

export function createWaterMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.05, 0.22, 0.3),
    roughness: 0.08,
    metalness: 0.1,
    envMapIntensity: 1.2,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\n${COMMON}`)
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  vec2 p = vWorldPos.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(cos(p.x * 0.11 + t * 0.9), sin(p.y * 0.13 - t * 0.7)) * 0.12;
  g += vec2(sin(p.x * 0.37 - p.y * 0.21 + t * 1.6), cos(p.y * 0.41 + p.x * 0.17 + t * 1.3)) * 0.06;
  g += (vec2(vnoise(p * 0.9 + t * 0.5), vnoise(p * 0.9 - t * 0.4 + 7.0)) - 0.5) * 0.12;
  vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => 'water';
  return m;
}
