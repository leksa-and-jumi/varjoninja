// Driving routes along the street grid (for ambulances): straight lines between crossings.

import { CITY, CITY_HALF } from '../config';
import { nearestRoad, roadLine } from './city';

export interface Point {
  x: number;
  z: number;
}

/** The closest spot on a street to a point, nudged toward that point's side of the road. */
export function curbPointNear(x: number, z: number, side = 3): Point & { axis: 'x' | 'z' } {
  const lim = CITY_HALF;
  const cx = Math.max(-lim, Math.min(lim, x));
  const cz = Math.max(-lim, Math.min(lim, z));
  const lineX = roadLine(nearestRoad(cx));
  const lineZ = roadLine(nearestRoad(cz));
  const dx = Math.abs(cx - lineX);
  const dz = Math.abs(cz - lineZ);
  if (dz <= dx) {
    // Road running along X (z fixed).
    return { x: cx, z: lineZ + Math.sign(cz - lineZ || 1) * side, axis: 'x' };
  }
  return { x: lineX + Math.sign(cx - lineX || 1) * side, z: cz, axis: 'z' };
}

/** Crossing (road indices) nearest to a point that lies on a road. */
function crossingOf(p: Point & { axis: 'x' | 'z' }): { i: number; j: number } {
  return { i: nearestRoad(p.x), j: nearestRoad(p.z) };
}

/**
 * Route from one curb point to another: along the first road to a crossing, along the grid
 * (first in X, then in Z) to the crossing next to the target road, then to the target.
 */
export function routeBetween(
  from: Point & { axis: 'x' | 'z' },
  to: Point & { axis: 'x' | 'z' },
): Point[] {
  const a = crossingOf(from);
  const b = crossingOf(to);
  const pts: Point[] = [{ x: from.x, z: from.z }];
  pts.push({ x: roadLine(a.i), z: roadLine(a.j) });
  if (a.i !== b.i) pts.push({ x: roadLine(b.i), z: roadLine(a.j) });
  if (a.j !== b.j) pts.push({ x: roadLine(b.i), z: roadLine(b.j) });
  pts.push({ x: to.x, z: to.z });
  // Drop points that are (almost) the same.
  return pts.filter(
    (p, k) => k === 0 || Math.hypot(p.x - pts[k - 1]!.x, p.z - pts[k - 1]!.z) > 0.5,
  );
}

/** Total length of a route. */
export function routeLength(route: Point[]): number {
  let len = 0;
  for (let k = 1; k < route.length; k++) {
    len += Math.hypot(route[k]!.x - route[k - 1]!.x, route[k]!.z - route[k - 1]!.z);
  }
  return len;
}

/** A crossing roughly `dist` metres from a point (where an ambulance appears). */
export function crossingAround(
  x: number,
  z: number,
  dist: number,
  angle: number,
): Point & { axis: 'x' | 'z' } {
  const tx = x + Math.cos(angle) * dist;
  const tz = z + Math.sin(angle) * dist;
  const i = Math.max(0, Math.min(CITY.blocks, nearestRoad(tx)));
  const j = Math.max(0, Math.min(CITY.blocks, nearestRoad(tz)));
  return { x: roadLine(i), z: roadLine(j), axis: 'x' };
}
