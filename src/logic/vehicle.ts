// A car the ninja drives: simple arcade physics with drifting and bumping into buildings.

import { CAR } from '../config';
import { groundHeight, isInSea, type City } from './city';
import { clamp } from './geom';

export interface DriveInput {
  throttle: number; // -1..1 (negative = brake / reverse)
  steer: number; // -1..1 (positive = right)
  handbrake: boolean;
}

const WHEELBASE = 2.8;
const BODY_RADIUS = 1.05;

export class DrivenCar {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  steer = 0;
  /** Seconds since the last crash (for sounds). */
  lastImpact = 0;
  sunk = false;

  constructor(private readonly city: City) {}

  get forwardSpeed(): number {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  place(x: number, z: number, yaw: number, speed = 0): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = Math.sin(yaw) * speed;
    this.vz = Math.cos(yaw) * speed;
    this.y = groundHeight(x, z);
    this.sunk = false;
  }

  /** Returns the impact speed if we hit something this step (0 otherwise). */
  step(dt: number, input: DriveInput): number {
    this.lastImpact += dt;
    if (this.sunk) {
      this.vx *= 0.9;
      this.vz *= 0.9;
      return 0;
    }
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    let fwd = this.vx * fx + this.vz * fz;
    let side = this.vx * rx + this.vz * rz;

    // Engine and brakes.
    if (input.throttle > 0) {
      fwd += input.throttle * CAR.accel * dt * (fwd < 0 ? 2 : 1);
    } else if (input.throttle < 0) {
      if (fwd > 0.5) fwd += input.throttle * CAR.brake * dt;
      else fwd = Math.max(-CAR.reverseSpeed, fwd + input.throttle * CAR.accel * 0.7 * dt);
    } else {
      fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 3 * dt);
    }
    fwd = clamp(fwd, -CAR.reverseSpeed, CAR.maxSpeed);
    if (input.handbrake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 10 * dt);

    // Steering: less at high speed so it stays controllable.
    const maxSteer = CAR.steer * (1 - Math.min(0.55, (Math.abs(fwd) / CAR.maxSpeed) * 0.7));
    this.steer += (input.steer * maxSteer - this.steer) * Math.min(1, dt * 8);
    const yawRate = (fwd / WHEELBASE) * Math.tan(this.steer);
    this.yaw -= yawRate * dt;

    // Tyres: kill sideways sliding (less with the handbrake → drift).
    const grip = input.handbrake ? CAR.driftGrip : CAR.grip;
    side -= side * Math.min(1, grip * dt);

    const nfx = Math.sin(this.yaw);
    const nfz = Math.cos(this.yaw);
    const nrx = -nfz;
    const nrz = nfx;
    this.vx = nfx * fwd + nrx * side;
    this.vz = nfz * fwd + nrz * side;

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const impact = this.collide();
    const ground = groundHeight(this.x, this.z);
    this.y +=
      (Math.max(ground, this.y > ground + 0.5 ? this.y - 9.8 * dt : ground) - this.y) *
      Math.min(1, dt * 12);
    if (isInSea(this.x, this.z)) {
      this.sunk = true;
      this.y = ground;
    }
    return impact;
  }

  /** Two circles (front and back) against the buildings. */
  private collide(): number {
    let impact = 0;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    for (const off of [1.35, -1.35]) {
      const cx = this.x + fx * off;
      const cz = this.z + fz * off;
      const r = BODY_RADIUS;
      this.city.grid.query(cx - r, cz - r, cx + r, cz + r, (b) => {
        if (b.minY > this.y + 1.5 || b.maxY < this.y + 0.3) return;
        const px = clamp(cx, b.minX, b.maxX);
        const pz = clamp(cz, b.minZ, b.maxZ);
        const dx = cx - px;
        const dz = cz - pz;
        const d = Math.hypot(dx, dz);
        if (d >= r) return;
        let nx: number;
        let nz: number;
        if (d < 1e-4) {
          // Centre inside: push out along the shortest axis.
          const opts = [
            [cx - b.minX, -1, 0],
            [b.maxX - cx, 1, 0],
            [cz - b.minZ, 0, -1],
            [b.maxZ - cz, 0, 1],
          ] as const;
          const best = [...opts].sort((a, c) => a[0] - c[0])[0]!;
          nx = best[1];
          nz = best[2];
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const push = r - d;
        this.x += nx * push;
        this.z += nz * push;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          impact = Math.max(impact, -vn);
          // Bounce a little and lose speed.
          this.vx -= vn * nx * 1.3;
          this.vz -= vn * nz * 1.3;
          this.vx *= 0.8;
          this.vz *= 0.8;
        }
      });
    }
    if (impact > 3) this.lastImpact = 0;
    return impact;
  }
}
