// Day and night. Time comes from the wall clock, so every player sees the same sky
// without sending any messages.

import { DAY } from '../config';

/** Time of day 0..1 (0.25 sunrise, 0.5 noon, 0.75 sunset). */
export function timeOfDay(nowMs: number, offset = 0): number {
  const t = nowMs / 1000 / DAY.length + DAY.start + offset;
  return t - Math.floor(t);
}

export interface SunState {
  /** Unit vector toward the sun. */
  x: number;
  y: number;
  z: number;
  /** 0 = full day, 1 = deep night. */
  night: number;
  /** 0..1, strongest at sunrise and sunset (orange sky). */
  dusk: number;
}

export function sunState(tod: number): SunState {
  const angle = (tod - 0.25) * Math.PI * 2; // 0 at sunrise, π/2 at noon
  const elevation = Math.sin(angle);
  // The sun travels east → west, tilted a little to the south.
  const x = Math.cos(angle);
  const y = elevation;
  const z = -0.35;
  const len = Math.hypot(x, y, z);
  const night = smoothstep(0.12, -0.18, elevation);
  const dusk = Math.max(0, 1 - Math.abs(elevation) / 0.28) * (1 - night * 0.6);
  return { x: x / len, y: y / len, z: z / len, night, dusk };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** "klo 14:05" style clock for the HUD. */
export function clockText(tod: number): string {
  const minutes = Math.floor(tod * 24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
