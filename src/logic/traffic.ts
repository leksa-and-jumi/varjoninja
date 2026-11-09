// City traffic: cars drive on the right in two lanes, and choose a way at every crossing.

import { CITY, TRAFFIC } from '../config';
import { roadLine } from './city';
import { Rng } from './rng';

export type Axis = 'x' | 'z';

export interface LaneRef {
  /** Which way the road runs. */
  axis: Axis;
  /** Road index 0..blocks (its centre line is roadLine(line)). */
  line: number;
  /** +1 or -1 along the axis. */
  dir: 1 | -1;
  /** 0 = inner lane (next to the yellow line), 1 = outer lane. */
  lane: 0 | 1;
}

export interface Turn {
  p0x: number;
  p0z: number;
  p1x: number;
  p1z: number;
  p2x: number;
  p2z: number;
  t: number;
  length: number;
  next: LaneRef;
  /** Coordinate along the new road at the end of the turn. */
  nextS: number;
}

export interface TrafficCar {
  lane: LaneRef;
  /** Coordinate along the road axis. */
  s: number;
  speed: number;
  cruise: number;
  turn: Turn | null;
  x: number;
  z: number;
  yaw: number;
  /** The next crossing (road index across) we have already decided about. */
  decidedAt: number | null;
}

export function laneOffset(lane: 0 | 1): number {
  return CITY.laneWidth * (lane + 0.5);
}

/** Point on a lane at coordinate s. */
export function lanePoint(l: LaneRef, s: number): { x: number; z: number } {
  const off = laneOffset(l.lane);
  const line = roadLine(l.line);
  // Right of the driving direction: (-fz, fx).
  if (l.axis === 'z') return { x: line - l.dir * off, z: s };
  return { x: s, z: line + l.dir * off };
}

export function laneYaw(l: LaneRef): number {
  // yaw 0 faces +Z.
  if (l.axis === 'z') return l.dir > 0 ? 0 : Math.PI;
  return l.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

/** Index of the next crossing road ahead of s in the driving direction, or null at the end. */
export function nextCrossing(l: LaneRef, s: number): number | null {
  const half = CITY.roadWidth / 2;
  for (let j = 0; j <= CITY.blocks; j++) {
    const k = l.dir > 0 ? j : CITY.blocks - j;
    const entry = roadLine(k) - l.dir * (half + 1);
    if ((s - entry) * l.dir < 0) return k;
  }
  return null;
}

function quadLength(t: Omit<Turn, 't' | 'length' | 'next' | 'nextS'>): number {
  let len = 0;
  let px = t.p0x;
  let pz = t.p0z;
  for (let i = 1; i <= 8; i++) {
    const u = i / 8;
    const x = (1 - u) * (1 - u) * t.p0x + 2 * (1 - u) * u * t.p1x + u * u * t.p2x;
    const z = (1 - u) * (1 - u) * t.p0z + 2 * (1 - u) * u * t.p1z + u * u * t.p2z;
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return len;
}

/** Options at crossing `k`: straight, left or right, if those roads exist. */
export function crossingOptions(l: LaneRef, k: number): LaneRef[] {
  const out: LaneRef[] = [];
  const n = CITY.blocks;
  // Straight: the road continues past the crossing.
  const beyond = k + l.dir;
  if (beyond >= 0 && beyond <= n) out.push({ ...l });
  const other: Axis = l.axis === 'x' ? 'z' : 'x';
  for (const nd of [1, -1] as const) {
    // The cross road must continue in direction nd from our road line.
    const target = l.line + nd;
    if (target < 0 || target > n) continue;
    // Right turn = turning toward our right-hand side.
    const fx = l.axis === 'x' ? l.dir : 0;
    const fz = l.axis === 'z' ? l.dir : 0;
    const rx = -fz;
    const rz = fx;
    const ndx = other === 'x' ? nd : 0;
    const ndz = other === 'z' ? nd : 0;
    const isRight = ndx * rx + ndz * rz > 0;
    out.push({ axis: other, line: k, dir: nd, lane: isRight ? 1 : 0 });
  }
  return out;
}

export function makeTurn(from: LaneRef, s: number, to: LaneRef): Turn {
  const half = CITY.roadWidth / 2;
  const p0 = lanePoint(from, s);
  const crossAt = roadLine(to.line);
  const fromLine = roadLine(from.line);
  const exitS = fromLine + to.dir * (half + 1);
  const p2 = lanePoint(to, exitS);
  // Corner: where the two lane lines meet.
  const p1 = from.axis === 'z' ? { x: p0.x, z: p2.z } : { x: p2.x, z: p0.z };
  void crossAt;
  const base = { p0x: p0.x, p0z: p0.z, p1x: p1.x, p1z: p1.z, p2x: p2.x, p2z: p2.z };
  return { ...base, t: 0, length: quadLength(base), next: to, nextS: exitS };
}

export function spawnCar(
  rng: Rng,
  nearX: number,
  nearZ: number,
  minDist: number,
  maxDist: number,
): TrafficCar | null {
  for (let tries = 0; tries < 20; tries++) {
    const axis: Axis = rng.chance(0.5) ? 'x' : 'z';
    const line = rng.int(0, CITY.blocks);
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane: 0 | 1 = rng.chance(0.5) ? 0 : 1;
    const l: LaneRef = { axis, line, dir, lane };
    const along = (axis === 'z' ? nearZ : nearX) + rng.range(-maxDist, maxDist);
    const lim = roadLine(CITY.blocks) - 2;
    const s = Math.max(-lim, Math.min(lim, along));
    // Not inside a crossing.
    const half = CITY.roadWidth / 2;
    const rel = s - roadLine(Math.round((s - roadLine(0)) / (roadLine(1) - roadLine(0))));
    if (Math.abs(rel) < half + 2) continue;
    const p = lanePoint(l, s);
    const d = Math.hypot(p.x - nearX, p.z - nearZ);
    if (d < minDist || d > maxDist) continue;
    const cruise = TRAFFIC.cruiseSpeed * rng.range(0.8, 1.15);
    return {
      lane: l,
      s,
      speed: cruise,
      cruise,
      turn: null,
      x: p.x,
      z: p.z,
      yaw: laneYaw(l),
      decidedAt: null,
    };
  }
  return null;
}

/**
 * Moves one car. `blockedAhead` is the distance to the nearest obstacle in front (Infinity if free).
 */
export function stepCar(car: TrafficCar, dt: number, rng: Rng, blockedAhead: number): void {
  // Speed: slow down for whatever is in front, and in turns.
  let target = car.turn ? car.cruise * 0.55 : car.cruise;
  if (blockedAhead < Infinity) {
    const room = blockedAhead - TRAFFIC.followGap;
    target = Math.min(target, Math.max(0, room * 1.2));
  }
  const accel = target > car.speed ? 6 : 16;
  car.speed += Math.max(-accel * dt, Math.min(accel * dt, target - car.speed));
  const move = car.speed * dt;

  if (car.turn) {
    const t = car.turn;
    t.t += move / Math.max(1, t.length);
    if (t.t >= 1) {
      car.lane = t.next;
      car.s = t.nextS + (t.t - 1) * t.length * t.next.dir;
      car.turn = null;
      car.decidedAt = null;
    } else {
      const u = t.t;
      const x = (1 - u) * (1 - u) * t.p0x + 2 * (1 - u) * u * t.p1x + u * u * t.p2x;
      const z = (1 - u) * (1 - u) * t.p0z + 2 * (1 - u) * u * t.p1z + u * u * t.p2z;
      const dx = 2 * (1 - u) * (t.p1x - t.p0x) + 2 * u * (t.p2x - t.p1x);
      const dz = 2 * (1 - u) * (t.p1z - t.p0z) + 2 * u * (t.p2z - t.p1z);
      car.x = x;
      car.z = z;
      car.yaw = Math.atan2(dx, dz);
      return;
    }
  } else {
    const before = car.s;
    car.s += move * car.lane.dir;
    const k = nextCrossing(car.lane, before);
    if (k !== null) {
      const half = CITY.roadWidth / 2;
      const entry = roadLine(k) - car.lane.dir * (half + 1);
      if ((car.s - entry) * car.lane.dir >= 0) {
        const options = crossingOptions(car.lane, k);
        const straight = options.find((o) => o.axis === car.lane.axis);
        const turns = options.filter((o) => o.axis !== car.lane.axis);
        const choice =
          straight && (turns.length === 0 || rng.chance(0.55))
            ? straight
            : turns.length
              ? rng.pick(turns)
              : null;
        if (!choice) {
          // Dead end (should not happen on a full grid): turn around.
          car.lane = { ...car.lane, dir: car.lane.dir > 0 ? -1 : 1 };
        } else if (choice.axis !== car.lane.axis) {
          car.turn = makeTurn(car.lane, entry, choice);
          car.s = entry;
          return;
        }
      }
    }
  }
  const p = lanePoint(car.lane, car.s);
  car.x = p.x;
  car.z = p.z;
  car.yaw = laneYaw(car.lane);
}
