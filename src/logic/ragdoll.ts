// Ragdoll ("sätkynukke"): a knocked-out person becomes a bunch of points joined by sticks.
// Gravity, the street and walls move the points; the character's bones then follow them,
// so every fall looks different. Pure logic (verlet integration), no Three.js.

import type { Vec3 } from './geom';

/** Joint points, in this order. */
export const JOINTS = [
  'pelvis',
  'chest',
  'neck',
  'headTop',
  'shoulderL',
  'elbowL',
  'wristL',
  'handL',
  'shoulderR',
  'elbowR',
  'wristR',
  'handR',
  'hipL',
  'kneeL',
  'ankleL',
  'toeL',
  'hipR',
  'kneeR',
  'ankleR',
  'toeR',
] as const;
export type Joint = (typeof JOINTS)[number];

const J = (name: Joint) => JOINTS.indexOf(name);

/** Sticks between joints. The extra ones keep the body from folding up like paper. */
const STICKS: [Joint, Joint][] = [
  ['pelvis', 'chest'],
  ['chest', 'neck'],
  ['neck', 'headTop'],
  ['chest', 'shoulderL'],
  ['chest', 'shoulderR'],
  ['shoulderL', 'shoulderR'],
  ['shoulderL', 'elbowL'],
  ['elbowL', 'wristL'],
  ['wristL', 'handL'],
  ['shoulderR', 'elbowR'],
  ['elbowR', 'wristR'],
  ['wristR', 'handR'],
  ['pelvis', 'hipL'],
  ['pelvis', 'hipR'],
  ['hipL', 'hipR'],
  ['hipL', 'kneeL'],
  ['kneeL', 'ankleL'],
  ['ankleL', 'toeL'],
  ['hipR', 'kneeR'],
  ['kneeR', 'ankleR'],
  ['ankleR', 'toeR'],
  // Torso braces.
  ['shoulderL', 'hipL'],
  ['shoulderR', 'hipR'],
  ['shoulderL', 'hipR'],
  ['shoulderR', 'hipL'],
  ['neck', 'shoulderL'],
  ['neck', 'shoulderR'],
  ['chest', 'headTop'],
];

/** Loose limits: knees and elbows can bend, but limbs can't fold flat into themselves. */
const MIN_STICKS: [Joint, Joint, number][] = [
  ['shoulderL', 'wristL', 0.55],
  ['shoulderR', 'wristR', 0.55],
  ['hipL', 'ankleL', 0.6],
  ['hipR', 'ankleR', 0.6],
  ['kneeL', 'kneeR', 0.12],
  ['headTop', 'pelvis', 0.7],
];

const GRAVITY = 24;
const RADIUS = 0.08;
const FRICTION = 0.75;

export interface RagdollWorld {
  /** Height of the floor under a point. */
  floor(x: number, y: number, z: number): number;
  /** Push a point out of walls (changes p in place). */
  pushOut(p: Vec3): void;
}

export class Ragdoll {
  readonly pos: Vec3[];
  private prev: Vec3[];
  private sticks: { a: number; b: number; len: number }[];
  private mins: { a: number; b: number; len: number }[];
  /** Seconds of (almost) no movement. */
  private still = 0;
  asleep = false;

  /** `points` are the joint positions at the moment of the knockout (same order as JOINTS). */
  constructor(points: Vec3[]) {
    this.pos = points.map((p) => ({ ...p }));
    this.prev = points.map((p) => ({ ...p }));
    const dist = (a: number, b: number) => {
      const p = this.pos[a]!;
      const q = this.pos[b]!;
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    };
    this.sticks = STICKS.map(([a, b]) => ({ a: J(a), b: J(b), len: dist(J(a), J(b)) }));
    this.mins = MIN_STICKS.map(([a, b, k]) => ({ a: J(a), b: J(b), len: dist(J(a), J(b)) * k }));
  }

  point(name: Joint): Vec3 {
    return this.pos[J(name)]!;
  }

  /**
   * Throw the body. `vel` is the push; the upper body gets more of it so the person tumbles,
   * and `spin` adds a random twist so no two falls look the same.
   */
  push(vel: Vec3, spin: number, random: () => number): void {
    const dt = 1 / 60;
    this.pos.forEach((p, i) => {
      const q = this.prev[i]!;
      const name = JOINTS[i]!;
      const upper =
        name === 'headTop' || name === 'neck' || name === 'chest' || name.startsWith('shoulder');
      const k = upper
        ? 1.15
        : name.startsWith('hip') || name === 'pelvis'
          ? 0.9
          : 0.8 + random() * 0.5;
      const jitter = () => (random() - 0.5) * spin;
      q.x = p.x - (vel.x * k + jitter()) * dt;
      q.y = p.y - (vel.y * k + jitter() * 0.5) * dt;
      q.z = p.z - (vel.z * k + jitter()) * dt;
    });
    this.asleep = false;
    this.still = 0;
  }

  step(dt: number, world: RagdollWorld): void {
    if (this.asleep) return;
    let motion = 0;
    for (let i = 0; i < this.pos.length; i++) {
      const p = this.pos[i]!;
      const q = this.prev[i]!;
      const vx = (p.x - q.x) * 0.995;
      const vy = (p.y - q.y) * 0.995;
      const vz = (p.z - q.z) * 0.995;
      q.x = p.x;
      q.y = p.y;
      q.z = p.z;
      p.x += vx;
      p.y += vy - GRAVITY * dt * dt;
      p.z += vz;
      motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let iter = 0; iter < 6; iter++) {
      for (const s of this.sticks) this.solve(s.a, s.b, s.len, false);
      for (const s of this.mins) this.solve(s.a, s.b, s.len, true);
      for (let i = 0; i < this.pos.length; i++) this.collide(i, world);
    }
    // Friction on the ground: points touching the floor lose sideways speed.
    for (let i = 0; i < this.pos.length; i++) {
      const p = this.pos[i]!;
      if (p.y > world.floor(p.x, p.y, p.z) + RADIUS + 0.01) continue;
      const q = this.prev[i]!;
      q.x = p.x - (p.x - q.x) * FRICTION;
      q.z = p.z - (p.z - q.z) * FRICTION;
    }
    // Fall asleep when it has stopped moving (saves time with many knocked-out people).
    if (motion / this.pos.length < 0.002) this.still += dt;
    else this.still = 0;
    if (this.still > 0.8) this.asleep = true;
  }

  private solve(a: number, b: number, len: number, minOnly: boolean): void {
    const p = this.pos[a]!;
    const q = this.pos[b]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    if (minOnly && d >= len) return;
    const diff = ((d - len) / d) * 0.5;
    p.x += dx * diff;
    p.y += dy * diff;
    p.z += dz * diff;
    q.x -= dx * diff;
    q.y -= dy * diff;
    q.z -= dz * diff;
  }

  private collide(i: number, world: RagdollWorld): void {
    const p = this.pos[i]!;
    world.pushOut(p);
    const floor = world.floor(p.x, p.y, p.z) + RADIUS;
    if (p.y < floor) {
      p.y = floor;
      // No bouncing: the fall stops at the floor.
      const q = this.prev[i]!;
      if (q.y < p.y) q.y = p.y;
    }
  }

  /** Middle of the body (for puffs of smoke and the map). */
  centre(): Vec3 {
    return { ...this.point('pelvis') };
  }
}
