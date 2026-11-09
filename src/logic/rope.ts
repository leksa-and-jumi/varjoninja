// Picking the point the rope sticks to.

import { ROPE } from '../config';
import type { City } from './city';
import { closestPointOnBox, distance, pointInBox, type Box, type Vec3 } from './geom';

export interface Anchor {
  point: Vec3;
  /** True when the player aimed at it; false when auto-aim chose it. */
  aimed: boolean;
}

/** Pushes a point that is inside a box out to the nearest side face (never the floor). */
function toSurface(b: Box, p: Vec3): Vec3 {
  if (!pointInBox(b, p.x, p.y, p.z)) return closestPointOnBox(b, p);
  const options = [
    { d: p.x - b.minX, q: { x: b.minX, y: p.y, z: p.z } },
    { d: b.maxX - p.x, q: { x: b.maxX, y: p.y, z: p.z } },
    { d: p.z - b.minZ, q: { x: p.x, y: p.y, z: b.minZ } },
    { d: b.maxZ - p.z, q: { x: p.x, y: p.y, z: b.maxZ } },
  ];
  options.sort((a, b2) => a.d - b2.d);
  return options[0]!.q;
}

/**
 * Where should the rope go?
 * 1. If the crosshair points at a building within range, there (if it is high enough).
 * 2. Otherwise auto-aim: a spot up and ahead in the travel direction, on the nearest building.
 */
export function findSwingAnchor(
  city: City,
  pos: Vec3,
  travel: Vec3,
  aimOrigin: Vec3,
  aimDir: Vec3,
): Anchor | null {
  const hit = city.grid.raycast(aimOrigin, aimDir, ROPE.range);
  if (hit) {
    const point = {
      x: aimOrigin.x + aimDir.x * hit.t,
      y: aimOrigin.y + aimDir.y * hit.t,
      z: aimOrigin.z + aimDir.z * hit.t,
    };
    if (point.y > pos.y + ROPE.minAnchorRise && distance(point, pos) < ROPE.range) {
      return { point, aimed: true };
    }
  }

  // Auto-aim: use the travel direction, or the aim direction when standing still.
  let fx = travel.x;
  let fz = travel.z;
  let len = Math.hypot(fx, fz);
  if (len < 3) {
    fx = aimDir.x;
    fz = aimDir.z;
    len = Math.hypot(fx, fz);
  }
  if (len < 1e-6) return null;
  fx /= len;
  fz /= len;

  const target: Vec3 = {
    x: pos.x + fx * ROPE.autoAhead,
    y: pos.y + ROPE.autoUp,
    z: pos.z + fz * ROPE.autoAhead,
  };
  const r = ROPE.range * 0.6;
  let best: Vec3 | null = null;
  let bestScore = Infinity;
  city.grid.query(target.x - r, target.z - r, target.x + r, target.z + r, (b) => {
    const p = toSurface(b, target);
    // The rope wants to grab high up, and in front of us.
    if (p.y < pos.y + ROPE.minAnchorRise) return;
    const ahead = (p.x - pos.x) * fx + (p.z - pos.z) * fz;
    if (ahead < 2) return;
    const d = distance(p, pos);
    if (d > ROPE.range) return;
    const score = distance(p, target) - Math.min(ahead, 30) * 0.2;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  });
  return best ? { point: best, aimed: false } : null;
}

/** Point the zip (grapple pull) goes to: only where the crosshair points. */
export function findZipTarget(
  city: City,
  aimOrigin: Vec3,
  aimDir: Vec3,
): (Vec3 & { nx: number; nz: number; top: boolean }) | null {
  const hit = city.grid.raycast(aimOrigin, aimDir, ROPE.range);
  if (!hit) return null;
  const b = city.colliders[hit.index]!;
  const p = {
    x: aimOrigin.x + aimDir.x * hit.t,
    y: aimOrigin.y + aimDir.y * hit.t,
    z: aimOrigin.z + aimDir.z * hit.t,
  };
  // Hitting a wall close to the top: go to the roof edge instead.
  const top = hit.ny > 0.5 || b.maxY - p.y < 4;
  if (top && hit.ny < 0.5) p.y = b.maxY;
  return { ...p, nx: hit.nx, nz: hit.nz, top };
}
