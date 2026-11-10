// The city of Varjosaari: a square island with a grid of streets. Everything comes from
// the seed, so every player builds exactly the same city without any network traffic.

import { BUILDING, CITY, CITY_HALF, CITY_PITCH, MISSIONS } from '../config';
import { box, rayBox, type Box, type RayHit, type Vec3 } from './geom';
import { Rng } from './rng';

export type District = 'downtown' | 'midtown' | 'outskirts';
export type BlockKind = 'buildings' | 'park' | 'plaza';

/** Facade look: picked in the building shader. */
export enum Facade {
  Glass = 0,
  Office = 1,
  Brick = 2,
  Modern = 3,
  Warehouse = 4,
}

export interface Building {
  id: number;
  /** Stacked boxes, bottom first (setbacks make towers narrower near the top). */
  boxes: Box[];
  facade: Facade;
  /** 0..1, picks the colour within the facade's palette. */
  tint: number;
  seed: number;
  district: District;
  /** Top of the highest box. */
  height: number;
  /** Low walls around the roof edges. */
  parapets: Box[];
}

export type PropKind = 'ac' | 'waterTower' | 'antenna' | 'helipad' | 'billboard';

export interface RoofProp {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  /** Rotation around Y. */
  rot: number;
  size: number;
}

export interface CityBlock {
  ix: number;
  iz: number;
  kind: BlockKind;
  /** Curb edges (the sidewalk starts here). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  district: District;
}

export interface Placed {
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export interface City {
  blocks: CityBlock[];
  buildings: Building[];
  /** Every solid box (buildings + rooftop props); index = collider id. */
  colliders: Box[];
  roofProps: RoofProp[];
  lamps: Placed[];
  trees: Placed[];
  benches: Placed[];
  trafficLights: Placed[];
  collectibles: Vec3[];
  grid: ColliderGrid;
}

/** Road centre line coordinate for road index i (0..blocks). */
export function roadLine(i: number): number {
  return -CITY_HALF + i * CITY_PITCH;
}

/** Nearest road index to a coordinate (clamped to the grid). */
export function nearestRoad(v: number): number {
  return Math.max(0, Math.min(CITY.blocks, Math.round((v + CITY_HALF) / CITY_PITCH)));
}

/** Distance from the nearest road centre line along one axis. */
export function distToRoadLine(v: number): number {
  return Math.abs(v - roadLine(nearestRoad(v)));
}

export function isOnRoad(x: number, z: number): boolean {
  const half = CITY.roadWidth / 2;
  const inside = Math.abs(x) <= CITY_HALF + half && Math.abs(z) <= CITY_HALF + half;
  return inside && (distToRoadLine(x) <= half || distToRoadLine(z) <= half);
}

/** Height of the walkable ground (sidewalks are a little higher than the road). */
export function groundHeight(x: number, z: number): number {
  const edge = CITY_HALF + CITY.roadWidth / 2;
  if (Math.abs(x) > edge + CITY.shoreWidth || Math.abs(z) > edge + CITY.shoreWidth) {
    return CITY.seaLevel - 3; // sea floor
  }
  if (Math.abs(x) > edge || Math.abs(z) > edge) return CITY.sidewalkHeight; // promenade
  return isOnRoad(x, z) ? 0 : CITY.sidewalkHeight;
}

export function isInSea(x: number, z: number): boolean {
  const edge = CITY_HALF + CITY.roadWidth / 2 + CITY.shoreWidth;
  return Math.abs(x) > edge || Math.abs(z) > edge;
}

function districtOf(cx: number, cz: number): District {
  const d = Math.max(Math.abs(cx), Math.abs(cz)) / CITY_HALF;
  if (d < 0.32) return 'downtown';
  if (d < 0.68) return 'midtown';
  return 'outskirts';
}

function pickFacade(rng: Rng, district: District, height: number): Facade {
  if (district === 'downtown')
    return height > 120 ? Facade.Glass : rng.pick([Facade.Glass, Facade.Office, Facade.Modern]);
  if (district === 'midtown')
    return rng.pick([Facade.Office, Facade.Brick, Facade.Modern, Facade.Glass]);
  return rng.pick([Facade.Brick, Facade.Brick, Facade.Warehouse, Facade.Modern]);
}

function pickHeight(rng: Rng, district: District, centrality: number): number {
  const range = BUILDING[district];
  // Taller toward the middle of the district, with a few surprise towers.
  const t = Math.pow(rng.next(), 1.6) * 0.75 + centrality * 0.25;
  const h = range.min + (range.max - range.min) * Math.min(1, t);
  const floors = Math.max(2, Math.round((h - BUILDING.groundFloorHeight) / BUILDING.floorHeight));
  return BUILDING.groundFloorHeight + floors * BUILDING.floorHeight;
}

interface Lot {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function splitLots(rng: Rng, b: Lot, district: District): Lot[] {
  const a = CITY.alleyWidth;
  const mx = (b.minX + b.maxX) / 2;
  const mz = (b.minZ + b.maxZ) / 2;
  const halfX: Lot[] = [
    { minX: b.minX, minZ: b.minZ, maxX: mx - a / 2, maxZ: b.maxZ },
    { minX: mx + a / 2, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ },
  ];
  const quarters: Lot[] = [];
  for (const sx of [0, 1]) {
    for (const sz of [0, 1]) {
      quarters.push({
        minX: sx ? mx + a / 2 : b.minX,
        maxX: sx ? b.maxX : mx - a / 2,
        minZ: sz ? mz + a / 2 : b.minZ,
        maxZ: sz ? b.maxZ : mz - a / 2,
      });
    }
  }
  const roll = rng.next();
  if (district === 'downtown') {
    if (roll < 0.45) return [b];
    if (roll < 0.8) return halfX;
    return quarters;
  }
  if (roll < 0.15) return [b];
  if (roll < 0.45) {
    // Two halves, split either way.
    if (rng.chance(0.5)) return halfX;
    return [
      { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: mz - a / 2 },
      { minX: b.minX, minZ: mz + a / 2, maxX: b.maxX, maxZ: b.maxZ },
    ];
  }
  return quarters;
}

function makeBuilding(
  rng: Rng,
  id: number,
  lot: Lot,
  district: District,
  centrality: number,
): Building {
  const setback = rng.range(0, district === 'downtown' ? 3 : 1.5);
  const base = box(
    lot.minX + setback,
    0,
    lot.minZ + setback,
    lot.maxX - setback,
    0,
    lot.maxZ - setback,
  );
  const height = pickHeight(rng, district, centrality);
  const facade = pickFacade(rng, district, height);
  const boxes: Box[] = [];
  const w = base.maxX - base.minX;
  const d = base.maxZ - base.minZ;

  if (height > 60 && Math.min(w, d) > 24 && rng.chance(0.75)) {
    // Tower with setbacks.
    const tiers = height > 140 ? 3 : 2;
    let bottom = 0;
    let inset = 0;
    for (let t = 0; t < tiers; t++) {
      const top =
        t === tiers - 1 ? height : snapFloor(height * (tiers === 3 ? [0.45, 0.78][t]! : 0.62));
      boxes.push(
        box(
          base.minX + inset,
          bottom,
          base.minZ + inset,
          base.maxX - inset,
          top,
          base.maxZ - inset,
        ),
      );
      bottom = top;
      inset += rng.range(3, Math.min(w, d) * 0.14);
    }
  } else if (district !== 'downtown' && height < 40 && rng.chance(0.35) && w > 20) {
    // L-shaped low building: main part + a lower wing.
    const split = base.minX + w * rng.range(0.45, 0.6);
    boxes.push(box(base.minX, 0, base.minZ, split, height, base.maxZ));
    const wingH = snapFloor(height * rng.range(0.5, 0.8));
    boxes.push(box(split, 0, base.minZ, base.maxX, wingH, base.minZ + d * rng.range(0.45, 0.7)));
  } else {
    boxes.push(box(base.minX, 0, base.minZ, base.maxX, height, base.maxZ));
  }

  return {
    id,
    boxes,
    facade,
    tint: rng.next(),
    seed: rng.int(0, 1 << 20),
    district,
    height: Math.max(...boxes.map((b) => b.maxY)),
    parapets: boxes.flatMap((b) => parapetsFor(b)),
  };
}

export const PARAPET = { height: 1.1, thickness: 0.35 } as const;

/** Four thin walls along the roof edge of a box. */
function parapetsFor(b: Box): Box[] {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  if (w < 8 || d < 8) return [];
  const { height: h, thickness: t } = PARAPET;
  const y0 = b.maxY;
  const y1 = b.maxY + h;
  return [
    box(b.minX, y0, b.minZ, b.maxX, y1, b.minZ + t),
    box(b.minX, y0, b.maxZ - t, b.maxX, y1, b.maxZ),
    box(b.minX, y0, b.minZ + t, b.minX + t, y1, b.maxZ - t),
    box(b.maxX - t, y0, b.minZ + t, b.maxX, y1, b.maxZ - t),
  ];
}

function snapFloor(h: number): number {
  const floors = Math.max(1, Math.round((h - BUILDING.groundFloorHeight) / BUILDING.floorHeight));
  return BUILDING.groundFloorHeight + floors * BUILDING.floorHeight;
}

function addRoofProps(rng: Rng, b: Building, props: RoofProp[], colliders: Box[]): void {
  for (const roof of b.boxes) {
    // Only roofs that are not covered by a higher tier.
    const covered = b.boxes.some((o) => o !== roof && o.minY >= roof.maxY - 0.01);
    const w = roof.maxX - roof.minX;
    const d = roof.maxZ - roof.minZ;
    const y = roof.maxY;
    if (covered) {
      // Ledge between tiers: a couple of AC units.
      if (rng.chance(0.5)) addAc(rng, roof, y, props, colliders);
      continue;
    }
    const acCount = rng.int(1, Math.max(1, Math.floor((w * d) / 260)));
    for (let i = 0; i < acCount; i++) addAc(rng, roof, y, props, colliders);

    const cx = (roof.minX + roof.maxX) / 2;
    const cz = (roof.minZ + roof.maxZ) / 2;
    if (b.facade === Facade.Brick && rng.chance(0.55) && w > 12) {
      const x = rng.range(roof.minX + 4, roof.maxX - 4);
      const z = rng.range(roof.minZ + 4, roof.maxZ - 4);
      props.push({ kind: 'waterTower', x, y, z, rot: 0, size: 1 });
      colliders.push(box(x - 2.2, y, z - 2.2, x + 2.2, y + 8.5, z + 2.2));
    } else if (b.height > 120 && rng.chance(0.6)) {
      const h = rng.range(14, 34);
      props.push({ kind: 'antenna', x: cx, y, z: cz, rot: 0, size: h });
      colliders.push(box(cx - 0.6, y, cz - 0.6, cx + 0.6, y + h, cz + 0.6));
    } else if (b.height > 70 && w > 26 && d > 26 && rng.chance(0.4)) {
      props.push({ kind: 'helipad', x: cx, y, z: cz, rot: 0, size: Math.min(w, d) * 0.6 });
    }
    if (b.district !== 'downtown' && b.height < 50 && rng.chance(0.18) && w > 16) {
      // Billboard facing a street.
      const alongX = rng.chance(0.5);
      const x = alongX ? cx : rng.chance(0.5) ? roof.minX + 1 : roof.maxX - 1;
      const z = alongX ? (rng.chance(0.5) ? roof.minZ + 1 : roof.maxZ - 1) : cz;
      props.push({
        kind: 'billboard',
        x,
        y,
        z,
        rot: alongX ? 0 : Math.PI / 2,
        size: Math.min(14, (alongX ? w : d) * 0.7),
      });
    }
  }
}

function addAc(rng: Rng, roof: Box, y: number, props: RoofProp[], colliders: Box[]): void {
  const w = roof.maxX - roof.minX;
  const d = roof.maxZ - roof.minZ;
  if (w < 8 || d < 8) return;
  const x = rng.range(roof.minX + 2.5, roof.maxX - 2.5);
  const z = rng.range(roof.minZ + 2.5, roof.maxZ - 2.5);
  const s = rng.range(1, 1.8);
  props.push({ kind: 'ac', x, y, z, rot: 0, size: s });
  colliders.push(box(x - s, y, z - s * 0.7, x + s, y + s * 1.1, z + s * 0.7));
}

export function generateCity(seed: number = CITY.seed): City {
  const rng = new Rng(seed);
  const blocks: CityBlock[] = [];
  const buildings: Building[] = [];
  const colliders: Box[] = [];
  const roofProps: RoofProp[] = [];
  const lamps: Placed[] = [];
  const trees: Placed[] = [];
  const benches: Placed[] = [];
  const trafficLights: Placed[] = [];
  const n = CITY.blocks;
  const halfRoad = CITY.roadWidth / 2;

  // Parks and a plaza: fixed, recognisable places.
  const parks = new Set(['2,6', '3,6', '7,2', '6,7']);
  const plazas = new Set(['4,4', '5,5']);

  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const minX = roadLine(ix) + halfRoad;
      const maxX = roadLine(ix + 1) - halfRoad;
      const minZ = roadLine(iz) + halfRoad;
      const maxZ = roadLine(iz + 1) - halfRoad;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const district = districtOf(cx, cz);
      const key = `${ix},${iz}`;
      const kind: BlockKind = parks.has(key) ? 'park' : plazas.has(key) ? 'plaza' : 'buildings';
      blocks.push({ ix, iz, kind, minX, minZ, maxX, maxZ, district });

      const sw = CITY.sidewalkWidth;
      const inner: Lot = { minX: minX + sw, minZ: minZ + sw, maxX: maxX - sw, maxZ: maxZ - sw };

      if (kind === 'buildings') {
        const centrality = 1 - Math.max(Math.abs(cx), Math.abs(cz)) / CITY_HALF;
        for (const lot of splitLots(rng, inner, district)) {
          const b = makeBuilding(rng, buildings.length, lot, district, centrality);
          buildings.push(b);
          colliders.push(...b.boxes, ...b.parapets);
          addRoofProps(rng, b, roofProps, colliders);
        }
      } else if (kind === 'park') {
        const count = rng.int(26, 36);
        for (let i = 0; i < count; i++) {
          const x = rng.range(inner.minX + 2, inner.maxX - 2);
          const z = rng.range(inner.minZ + 2, inner.maxZ - 2);
          // Keep the crossing paths free.
          if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
          trees.push({ x, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.4) });
        }
        for (const [dx, dz, rot] of [
          [6, 0, -Math.PI / 2],
          [-6, 0, Math.PI / 2],
          [0, 6, Math.PI],
          [0, -6, 0],
        ] as const) {
          benches.push({ x: cx + dx, z: cz + dz, rot, scale: 1 });
        }
      } else {
        // Plaza: a few trees around a fountain in the middle.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          trees.push({ x: cx + Math.cos(a) * 18, z: cz + Math.sin(a) * 18, rot: a, scale: 1.1 });
        }
      }

      // Street trees along the sidewalks (not downtown, where it is all concrete).
      if (district !== 'downtown' || kind !== 'buildings') {
        const step = 14;
        for (let t = minX + 8; t < maxX - 6; t += step) {
          trees.push({ x: t, z: minZ + 1.6, rot: rng.range(0, 6), scale: rng.range(0.7, 0.95) });
          trees.push({ x: t, z: maxZ - 1.6, rot: rng.range(0, 6), scale: rng.range(0.7, 0.95) });
        }
      }
    }
  }

  // Street lamps along every road segment, both sides, facing the road.
  const lampStep = CITY_PITCH / 3;
  for (let i = 0; i <= n; i++) {
    const line = roadLine(i);
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < 3; k++) {
        const along = roadLine(j) + lampStep * (k + 0.5);
        for (const side of [-1, 1]) {
          const off = line + side * (halfRoad + 0.6);
          // Lamps along roads that run in Z (x is fixed) and roads that run in X.
          lamps.push({ x: off, z: along, rot: side > 0 ? Math.PI : 0, scale: 1 });
          lamps.push({ x: along, z: off, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2, scale: 1 });
        }
      }
    }
  }

  // Traffic lights on two corners of every inner intersection.
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      const x = roadLine(i);
      const z = roadLine(j);
      const o = halfRoad + 0.8;
      trafficLights.push({ x: x + o, z: z + o, rot: 0, scale: 1 });
      trafficLights.push({ x: x - o, z: z - o, rot: Math.PI, scale: 1 });
    }
  }

  // Golden shuriken collectibles on rooftops (highest first: the best ones are hard to reach).
  const collectibles: Vec3[] = [];
  const tops = [...buildings].sort(() => rng.next() - 0.5).slice(0, MISSIONS.collectibles);
  for (const b of tops) {
    const top = b.boxes[b.boxes.length - 1]!;
    // A free spot on the roof (not inside an AC unit, water tower or antenna).
    for (let tries = 0; tries < 20; tries++) {
      const x = rng.range(top.minX + 2, top.maxX - 2);
      const z = rng.range(top.minZ + 2, top.maxZ - 2);
      const y = top.maxY + 1.4;
      const blocked = colliders.some(
        (c) =>
          x > c.minX - 1 &&
          x < c.maxX + 1 &&
          z > c.minZ - 1 &&
          z < c.maxZ + 1 &&
          y > c.minY - 1 &&
          y < c.maxY + 1,
      );
      if (!blocked) {
        collectibles.push({ x, y, z });
        break;
      }
    }
  }

  const grid = new ColliderGrid(colliders);
  return {
    blocks,
    buildings,
    colliders,
    roofProps,
    lamps,
    trees,
    benches,
    trafficLights,
    collectibles,
    grid,
  };
}

/** Uniform grid over the city so collision checks only look at nearby boxes. */
export class ColliderGrid {
  static readonly CELL = 24;
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private stampValue = 1;

  constructor(readonly boxes: Box[]) {
    this.stamp = new Uint32Array(boxes.length);
    boxes.forEach((b, i) => {
      for (let cx = this.cell(b.minX); cx <= this.cell(b.maxX); cx++) {
        for (let cz = this.cell(b.minZ); cz <= this.cell(b.maxZ); cz++) {
          const key = this.key(cx, cz);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(i);
        }
      }
    });
  }

  private cell(v: number): number {
    return Math.floor(v / ColliderGrid.CELL);
  }

  private key(cx: number, cz: number): number {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  /** Calls `fn` once for every box overlapping the XZ rectangle. */
  query(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    fn: (b: Box, index: number) => void,
  ): void {
    this.stampValue++;
    if (this.stampValue === 0xffffffff) {
      this.stamp.fill(0);
      this.stampValue = 1;
    }
    for (let cx = this.cell(minX); cx <= this.cell(maxX); cx++) {
      for (let cz = this.cell(minZ); cz <= this.cell(maxZ); cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === this.stampValue) continue;
          this.stamp[i] = this.stampValue;
          fn(this.boxes[i]!, i);
        }
      }
    }
  }

  /** First box hit by the ray from `o` along unit `dir`, up to `maxDist`. */
  raycast(o: Vec3, dir: Vec3, maxDist: number): (RayHit & { index: number }) | null {
    const ex = o.x + dir.x * maxDist;
    const ez = o.z + dir.z * maxDist;
    let best: (RayHit & { index: number }) | null = null;
    // A long ray across many cells: just query its bounding rectangle (cheap enough here).
    this.query(
      Math.min(o.x, ex),
      Math.min(o.z, ez),
      Math.max(o.x, ex),
      Math.max(o.z, ez),
      (b, i) => {
        const hit = rayBox(o, dir, b, best ? best.t : maxDist);
        if (hit && (!best || hit.t < best.t)) best = { ...hit, index: i };
      },
    );
    return best;
  }
}
