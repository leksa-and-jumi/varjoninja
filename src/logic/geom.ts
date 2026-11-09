// Tiny vector and box helpers for the pure game logic (no Three.js here, so it is easy to test).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function box(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Box {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent smoothing: move `current` toward `target` with the given sharpness. */
export function damp(current: number, target: number, sharpness: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-sharpness * dt));
}

/** Shortest signed difference between two angles. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current: number, target: number, sharpness: number, dt: number): number {
  return current + angleDiff(current, target) * (1 - Math.exp(-sharpness * dt));
}

export function pointInBox(b: Box, x: number, y: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}

export function closestPointOnBox(b: Box, p: Vec3): Vec3 {
  return {
    x: clamp(p.x, b.minX, b.maxX),
    y: clamp(p.y, b.minY, b.maxY),
    z: clamp(p.z, b.minZ, b.maxZ),
  };
}

export interface RayHit {
  t: number;
  /** Surface normal of the face that was hit (axis aligned). */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Ray against box (slab method). `dir` need not be normalised; t is in units of dir.
 * Returns null if the ray misses or starts inside the box.
 */
export function rayBox(o: Vec3, dir: Vec3, b: Box, maxT: number): RayHit | null {
  let tMin = 0;
  let tMax = maxT;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const axes: [number, number, number, number, 0 | 1 | 2][] = [
    [o.x, dir.x, b.minX, b.maxX, 0],
    [o.y, dir.y, b.minY, b.maxY, 1],
    [o.z, dir.z, b.minZ, b.maxZ, 2],
  ];
  for (const [origin, d, lo, hi, axis] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (origin < lo || origin > hi) return null;
      continue;
    }
    let t1 = (lo - origin) / d;
    let t2 = (hi - origin) / d;
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = axis === 0 ? sign : 0;
      ny = axis === 1 ? sign : 0;
      nz = axis === 2 ? sign : 0;
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (nx === 0 && ny === 0 && nz === 0) return null; // started inside
  return { t: tMin, nx, ny, nz };
}
