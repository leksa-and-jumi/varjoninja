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

/** Heavier body, lighter hands and feet: the limbs flop around the torso. */
const MASS: Record<Joint, number> = {
  pelvis: 3,
  chest: 3,
  neck: 1.5,
  headTop: 1.6,
  shoulderL: 1.5,
  shoulderR: 1.5,
  elbowL: 0.8,
  elbowR: 0.8,
  wristL: 0.5,
  wristR: 0.5,
  handL: 0.4,
  handR: 0.4,
  hipL: 2,
  hipR: 2,
  kneeL: 1.2,
  kneeR: 1.2,
  ankleL: 0.7,
  ankleR: 0.7,
  toeL: 0.4,
  toeR: 0.4,
};

/** Knees bend forward and elbows backward, never the other way. */
const HINGES: { top: Joint; mid: Joint; end: Joint; dir: 1 | -1 }[] = [
  { top: 'hipL', mid: 'kneeL', end: 'ankleL', dir: 1 },
  { top: 'hipR', mid: 'kneeR', end: 'ankleR', dir: 1 },
  { top: 'shoulderL', mid: 'elbowL', end: 'wristL', dir: -1 },
  { top: 'shoulderR', mid: 'elbowR', end: 'wristR', dir: -1 },
];

const GRAVITY = 24;
/** How much of the speed is kept when hitting the floor hard (a small bounce). */
const BOUNCE = 0.25;
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
  private inv = JOINTS.map((j) => 1 / MASS[j]);
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
      this.hinges();
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
    // The lighter point moves more.
    const wa = this.inv[a]!;
    const wb = this.inv[b]!;
    const diff = (d - len) / d / (wa + wb);
    p.x += dx * diff * wa;
    p.y += dy * diff * wa;
    p.z += dz * diff * wa;
    q.x -= dx * diff * wb;
    q.y -= dy * diff * wb;
    q.z -= dz * diff * wb;
  }

  /** Keep knees and elbows bending the natural way. */
  private hinges(): void {
    const P = (j: Joint) => this.pos[JOINTS.indexOf(j)]!;
    const hl = P('hipL');
    const hr = P('hipR');
    const pel = P('pelvis');
    const ch = P('chest');
    // Body forward = left × up.
    const lx = hl.x - hr.x;
    const ly = hl.y - hr.y;
    const lz = hl.z - hr.z;
    const ux = ch.x - pel.x;
    const uy = ch.y - pel.y;
    const uz = ch.z - pel.z;
    let fx = ly * uz - lz * uy;
    let fy = lz * ux - lx * uz;
    let fz = lx * uy - ly * ux;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    for (const h of HINGES) {
      const a = P(h.top);
      const m = P(h.mid);
      const b = P(h.end);
      // Closest point to the joint on the line top→end.
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const sz = b.z - a.z;
      const sl = sx * sx + sy * sy + sz * sz || 1;
      const t = Math.max(
        0,
        Math.min(1, ((m.x - a.x) * sx + (m.y - a.y) * sy + (m.z - a.z) * sz) / sl),
      );
      const ox = m.x - (a.x + sx * t);
      const oy = m.y - (a.y + sy * t);
      const oz = m.z - (a.z + sz * t);
      const side = (ox * fx + oy * fy + oz * fz) * h.dir;
      if (side < 0.01) {
        const push = (0.01 - side) * h.dir;
        m.x += fx * push;
        m.y += fy * push;
        m.z += fz * push;
      }
    }
  }

  private collide(i: number, world: RagdollWorld): void {
    const p = this.pos[i]!;
    world.pushOut(p);
    const floor = world.floor(p.x, p.y, p.z) + RADIUS;
    if (p.y < floor) {
      // A hard landing bounces a little; a soft one just stops.
      const q = this.prev[i]!;
      const vy = p.y - q.y;
      p.y = floor;
      q.y = vy < -0.06 ? p.y + vy * BOUNCE : Math.max(q.y, p.y);
    }
  }

  /** Middle of the body (for puffs of smoke and the map). */
  centre(): Vec3 {
    return { ...this.point('pelvis') };
  }
}
