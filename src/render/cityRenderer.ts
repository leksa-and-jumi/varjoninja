// Builds the Three.js meshes for the whole city from the generated city data.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, CITY_HALF } from '../config';
import type { Building, City, CityBlock, Placed, RoofProp } from '../logic/city';
import type { Box } from '../logic/geom';
import { Rng } from '../logic/rng';
import { createBuildingMaterial, createGroundMaterial, createWaterMaterial } from './materials';

export interface CityView {
  root: THREE.Group;
  /** Materials whose glow follows the night (lamp heads, billboards…). */
  nightMaterials: { material: THREE.MeshStandardMaterial; strength: number }[];
  water: THREE.Mesh;
  /** Blinking red aircraft lights on antennas. */
  beacons: THREE.InstancedMesh | null;
}

/** Geometry buffers for a list of building boxes. */
function buildingGeometry(buildings: Building[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const faceUv: number[] = [];
  const face: number[] = [];
  const span: number[] = [];
  const index: number[] = [];

  const quad = (
    corners: [number, number, number][],
    n: [number, number, number],
    width: number,
    b: Building,
    bx: Box,
  ) => {
    const start = pos.length / 3;
    // corners: bottom-left, bottom-right, top-right, top-left (seen from outside)
    const us = [0, width, width, 0];
    corners.forEach((c, i) => {
      pos.push(...c);
      nrm.push(...n);
      faceUv.push(n[1] > 0.5 ? c[0] : us[i]!, n[1] > 0.5 ? c[2] : c[1]);
      face.push(width, b.seed % 997, b.facade, b.tint);
      span.push(bx.minY, bx.maxY);
    });
    index.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  for (const b of buildings) {
    for (const bx of b.boxes) {
      const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = bx;
      // +Z face (looking from +Z toward -Z, left is -X)
      quad(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [0, 0, 1],
        x1 - x0,
        b,
        bx,
      );
      // -Z face
      quad(
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
        [0, 0, -1],
        x1 - x0,
        b,
        bx,
      );
      // +X face
      quad(
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
        ],
        [1, 0, 0],
        z1 - z0,
        b,
        bx,
      );
      // -X face
      quad(
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
        [-1, 0, 0],
        z1 - z0,
        b,
        bx,
      );
      // Roof
      quad(
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
        [0, 1, 0],
        x1 - x0,
        b,
        bx,
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFaceUv', new THREE.Float32BufferAttribute(faceUv, 2));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 4));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function kindNumber(b: CityBlock): number {
  return b.kind === 'buildings' ? 1 : b.kind === 'park' ? 2 : 3;
}

/** Raised block slabs (sidewalk + lot) with curb sides. */
function blockGeometry(blocks: CityBlock[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = CITY.sidewalkHeight;
  for (const b of blocks) {
    const g = new THREE.BoxGeometry(b.maxX - b.minX, h, b.maxZ - b.minZ, 1, 1, 1);
    g.translate((b.minX + b.maxX) / 2, h / 2, (b.minZ + b.maxZ) / 2);
    g.deleteAttribute('uv');
    const count = g.getAttribute('position').count;
    g.setAttribute(
      'aKind',
      new THREE.Float32BufferAttribute(new Array(count).fill(kindNumber(b)), 1),
    );
    const blockAttr: number[] = [];
    for (let i = 0; i < count; i++) blockAttr.push(b.minX, b.minZ, b.maxX, b.maxZ);
    g.setAttribute('aBlock', new THREE.Float32BufferAttribute(blockAttr, 4));
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

function roadGeometry(): THREE.BufferGeometry {
  const size = (CITY_HALF + CITY.roadWidth / 2 + CITY.shoreWidth) * 2;
  const g = new THREE.PlaneGeometry(size, size, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  const count = g.getAttribute('position').count;
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Array(count).fill(0), 1));
  g.setAttribute('aBlock', new THREE.Float32BufferAttribute(new Array(count * 4).fill(0), 4));
  return g;
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: Placed[],
  y: (p: Placed) => number,
  colors?: (p: Placed, i: number) => THREE.Color,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot);
    s.setScalar(it.scale);
    p.set(it.x, y(it), it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, colors(it, i));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function canvasTexture(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Four made-up ads, drawn once into one texture (each billboard shows one quarter). */
function billboardTexture(): THREE.CanvasTexture {
  const ads: [string, string, string, string][] = [
    ['NINJA-PIZZA', '🍕 Nopein kotiinkuljetus', '#ffcf3a', '#c4232c'],
    ['VARJOSAARI', '🏝️ Kaunein kaupunki', '#1f8fd6', '#ffffff'],
    ['SUPERJÄÄTELÖ', '🍦 Kylmää ja makeaa', '#ff7eb6', '#3b1b55'],
    ['KÖYSI-KAUPPA', '🪢 Vahvin köysi', '#3ecf8e', '#0b2d22'],
  ];
  return canvasTexture(1024, 1024, (c) => {
    ads.forEach(([title, sub, bg, fg], i) => {
      const y = i * 256;
      const grad = c.createLinearGradient(0, y, 1024, y + 256);
      grad.addColorStop(0, bg);
      grad.addColorStop(1, shade(bg, -40));
      c.fillStyle = grad;
      c.fillRect(0, y, 1024, 256);
      c.fillStyle = fg;
      c.font = '900 110px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(title, 512, y + 135);
      c.font = '600 48px system-ui, sans-serif';
      c.fillText(sub, 512, y + 210);
    });
  });
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

function helipadTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (c) => {
    c.fillStyle = '#3a3d42';
    c.fillRect(0, 0, 512, 512);
    c.strokeStyle = '#f2c94c';
    c.lineWidth = 22;
    c.beginPath();
    c.arc(256, 256, 220, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '900 300px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('H', 256, 270);
  });
}

function treeGeometries(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3, 6);
  trunk.translate(0, 1.5, 0);
  const rng = new Rng(7);
  const blobs: THREE.BufferGeometry[] = [];
  for (const [x, y, z, r] of [
    [0, 4.2, 0, 2.1],
    [0.9, 3.6, 0.4, 1.4],
    [-0.8, 3.7, -0.5, 1.5],
    [0.2, 5.3, -0.2, 1.3],
  ] as const) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    const p = s.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 1 + rng.range(-0.12, 0.12);
      p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k + y, p.getZ(i) * k + z);
    }
    blobs.push(s);
  }
  const crown = mergeGeometries(blobs.map((b) => b.toNonIndexed()))!;
  crown.computeVertexNormals();
  return { trunk, crown };
}

function lampGeometries(): { pole: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 7.5, 8);
  pole.translate(0, 3.75, 0);
  const arm = new THREE.BoxGeometry(2.2, 0.12, 0.12);
  arm.translate(1.05, 7.4, 0);
  const base = new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8);
  base.translate(0, 0.3, 0);
  const head = new THREE.BoxGeometry(0.9, 0.18, 0.42);
  head.translate(2.1, 7.32, 0);
  return { pole: mergeGeometries([pole, arm, base])!, head };
}

function trafficLightGeometries(): { pole: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  const pole = new THREE.CylinderGeometry(0.1, 0.12, 4.2, 8);
  pole.translate(0, 2.1, 0);
  const housing = new THREE.BoxGeometry(0.45, 1.3, 0.4);
  housing.translate(0, 4.6, 0);
  const lights: THREE.BufferGeometry[] = [];
  for (const y of [5.0, 4.6, 4.2]) {
    const l = new THREE.CircleGeometry(0.13, 12);
    l.translate(0, y, 0.21);
    lights.push(l);
    const back = l.clone();
    back.rotateY(Math.PI);
    lights.push(back);
  }
  return { pole: mergeGeometries([pole, housing])!, lights: mergeGeometries(lights)! };
}

function benchGeometry(): THREE.BufferGeometry {
  const seat = new THREE.BoxGeometry(2, 0.1, 0.5);
  seat.translate(0, 0.48, 0);
  const back = new THREE.BoxGeometry(2, 0.5, 0.08);
  back.translate(0, 0.8, -0.22);
  const legs = [-0.85, 0.85].map((x) => {
    const l = new THREE.BoxGeometry(0.08, 0.48, 0.45);
    l.translate(x, 0.24, 0);
    return l;
  });
  return mergeGeometries([seat, back, ...legs])!;
}

function roofPropMeshes(props: RoofProp[], view: CityView): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x3b3f45,
    roughness: 0.6,
    metalness: 0.5,
  });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });

  const byKind = (k: RoofProp['kind']) => props.filter((p) => p.kind === k);
  const asPlaced = (p: RoofProp): Placed => ({ x: p.x, z: p.z, rot: p.rot, scale: p.size });

  // AC units: a box with a fan on top.
  const ac = byKind('ac');
  if (ac.length) {
    const body = new THREE.BoxGeometry(2, 1.1, 1.4);
    body.translate(0, 0.55, 0);
    const fan = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 12);
    fan.translate(0.45, 1.12, 0);
    const mesh = instanced(
      mergeGeometries([body, fan])!,
      metal,
      ac.map(asPlaced),
      (p) => props.find((q) => q.x === p.x && q.z === p.z)!.y,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }

  // Water towers: wooden tank on metal legs with a cone roof.
  const towers = byKind('waterTower');
  if (towers.length) {
    const tank = new THREE.CylinderGeometry(2.1, 2.1, 3.6, 16);
    tank.translate(0, 5.2, 0);
    const legs = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const l = new THREE.CylinderGeometry(0.1, 0.12, 3.4, 6);
      l.translate(Math.cos(a) * 1.6, 1.7, Math.sin(a) * 1.6);
      return l;
    });
    const roof = new THREE.ConeGeometry(2.4, 1.6, 16);
    roof.translate(0, 7.8, 0);
    const placed = towers.map(asPlaced).map((p) => ({ ...p, scale: 1 }));
    const yOf = (p: Placed) => towers.find((q) => q.x === p.x && q.z === p.z)!.y;
    for (const [g, m] of [
      [tank, wood],
      [mergeGeometries(legs)!, darkMetal],
      [roof, darkMetal],
    ] as const) {
      const mesh = instanced(g, m, placed, yOf);
      mesh.castShadow = true;
      out.push(mesh);
    }
  }

  // Antennas with a blinking red light at the top.
  const antennas = byKind('antenna');
  if (antennas.length) {
    const g = new THREE.CylinderGeometry(0.15, 0.4, 1, 6);
    g.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(g, darkMetal, antennas.length);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0xff2020,
      emissiveIntensity: 3,
    });
    const beacon = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      lightMat,
      antennas.length,
    );
    const m = new THREE.Matrix4();
    antennas.forEach((a, i) => {
      m.makeScale(1, a.size, 1).setPosition(a.x, a.y, a.z);
      mesh.setMatrixAt(i, m);
      m.makeTranslation(a.x, a.y + a.size, a.z);
      beacon.setMatrixAt(i, m);
    });
    mesh.computeBoundingSphere();
    beacon.computeBoundingSphere();
    out.push(mesh, beacon);
    view.beacons = beacon;
  }

  // Helipads: a flat painted disc.
  const pads = byKind('helipad');
  if (pads.length) {
    const tex = helipadTexture();
    const g = new THREE.CircleGeometry(0.5, 32);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    const mesh = new THREE.InstancedMesh(g, mat, pads.length);
    const m = new THREE.Matrix4();
    pads.forEach((p, i) => {
      m.makeScale(p.size, 1, p.size).setPosition(p.x, p.y + 0.03, p.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    out.push(mesh);
  }

  // Billboards: steel frame + glowing ad.
  const boards = byKind('billboard');
  if (boards.length) {
    const tex = billboardTexture();
    const adMat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.6,
    });
    view.nightMaterials.push({ material: adMat, strength: 0.9 });
    const frameMat = darkMetal;
    boards.forEach((b, i) => {
      const w = b.size;
      const group = new THREE.Group();
      const adGeo = new THREE.PlaneGeometry(w, w * 0.25);
      // Pick one quarter of the texture.
      const uv = adGeo.getAttribute('uv');
      const q = i % 4;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (q + 1 - uv.getY(k)) * 0.25);
      const front = new THREE.Mesh(adGeo, adMat);
      front.position.set(0, 4.5, 0.12);
      const back = front.clone();
      back.rotation.y = Math.PI;
      back.position.z = -0.12;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, w * 0.25 + 0.4, 0.2), frameMat);
      frame.position.y = 4.5;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 3, 0.15), frameMat);
      legs.position.y = 1.5;
      group.add(frame, front, back, legs);
      group.position.set(b.x, b.y, b.z);
      group.rotation.y = b.rot;
      group.traverse((o) => (o.castShadow = true));
      out.push(group);
    });
  }
  return out;
}

function fountain(block: CityBlock): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.8 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 0.9, 40, 1, true), stone);
  basin.position.y = 0.45;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(7.1, 0.3, 8, 48), stone);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.9;
  const water = new THREE.Mesh(new THREE.CircleGeometry(7, 40), createWaterMaterial());
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.7;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 3, 16), stone);
  pillar.position.y = 1.5;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.8, 0.6, 24), stone);
  bowl.position.y = 3.1;
  g.add(basin, rim, water, pillar, bowl);
  g.position.set((block.minX + block.maxX) / 2, CITY.sidewalkHeight, (block.minZ + block.maxZ) / 2);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

/** Low hills far away, so the horizon is not empty. */
function distantHills(): THREE.Mesh {
  const rng = new Rng(99);
  const segments = 96;
  const radius = 2600;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const h =
      60 + Math.abs(Math.sin(a * 3.1) * 120 + Math.sin(a * 7.3 + 1) * 60) + rng.range(0, 30);
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pos.push(x, -5, z, x * 1.02, h, z * 1.02);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({
    color: 0x4d6b5a,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(g, m);
}

export function buildCityView(city: City): CityView {
  const root = new THREE.Group();
  root.name = 'city';
  const view: CityView = { root, nightMaterials: [], water: null!, beacons: null };

  // Buildings, one mesh per city block so the camera and shadow passes can skip far blocks.
  const buildingMat = createBuildingMaterial();
  const byBlock = new Map<string, Building[]>();
  for (const b of city.buildings) {
    const f = b.boxes[0]!;
    const key = `${Math.floor((f.minX + CITY_HALF) / 90)},${Math.floor((f.minZ + CITY_HALF) / 90)}`;
    let list = byBlock.get(key);
    if (!list) byBlock.set(key, (list = []));
    list.push(b);
  }
  for (const list of byBlock.values()) {
    const mesh = new THREE.Mesh(buildingGeometry(list), buildingMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  const groundMat = createGroundMaterial();
  const roads = new THREE.Mesh(roadGeometry(), groundMat);
  roads.receiveShadow = true;
  const blocks = new THREE.Mesh(blockGeometry(city.blocks), groundMat);
  blocks.receiveShadow = true;
  root.add(roads, blocks);

  // The sea and the quay wall around the island.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), createWaterMaterial());
  water.rotation.x = -Math.PI / 2;
  water.position.y = CITY.seaLevel;
  root.add(water);
  view.water = water;
  const edge = CITY_HALF + CITY.roadWidth / 2 + CITY.shoreWidth;
  const quayMat = new THREE.MeshStandardMaterial({ color: 0x8d877c, roughness: 0.95 });
  for (let i = 0; i < 4; i++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(edge * 2 + 2, 6, 1), quayMat);
    const a = (i * Math.PI) / 2;
    wall.position.set(
      Math.sin(a) * (edge + 0.5),
      CITY.sidewalkHeight - 3,
      Math.cos(a) * (edge + 0.5),
    );
    wall.rotation.y = a;
    root.add(wall);
  }
  // Railing along the promenade.
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x2f3438,
    roughness: 0.4,
    metalness: 0.7,
  });
  for (let i = 0; i < 4; i++) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(edge * 2, 0.08, 0.08), railMat);
    const a = (i * Math.PI) / 2;
    rail.position.set(Math.sin(a) * (edge - 0.3), 1.1, Math.cos(a) * (edge - 0.3));
    rail.rotation.y = a;
    root.add(rail);
  }
  root.add(distantHills());

  // Trees
  const { trunk, crown } = treeGeometries();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const rng = new Rng(3);
  const treeY = () => CITY.sidewalkHeight;
  const trunks = instanced(trunk, trunkMat, city.trees, treeY);
  const crowns = instanced(crown, crownMat, city.trees, treeY, () =>
    new THREE.Color().setHSL(rng.range(0.22, 0.33), rng.range(0.45, 0.6), rng.range(0.22, 0.32)),
  );
  for (const m of [trunks, crowns]) {
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }

  // Street lamps
  const { pole, head } = lampGeometries();
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x30353b,
    roughness: 0.5,
    metalness: 0.6,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    emissive: 0xffc070,
    emissiveIntensity: 0,
  });
  view.nightMaterials.push({ material: headMat, strength: 6 });
  const lampY = () => CITY.sidewalkHeight;
  const poles = instanced(pole, poleMat, city.lamps, lampY);
  poles.castShadow = true;
  root.add(poles, instanced(head, headMat, city.lamps, lampY));

  // Traffic lights (the colours cycle in the light material; cars in this city drive politely).
  const tl = trafficLightGeometries();
  root.add(instanced(tl.pole, poleMat, city.trafficLights, lampY));
  const tlLights = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0x33ff66,
    emissiveIntensity: 2,
  });
  root.add(instanced(tl.lights, tlLights, city.trafficLights, lampY));

  // Benches
  root.add(
    instanced(
      benchGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 }),
      city.benches,
      lampY,
    ),
  );

  for (const block of city.blocks) if (block.kind === 'plaza') root.add(fountain(block));
  for (const o of roofPropMeshes(city.roofProps, view)) root.add(o);

  return view;
}
