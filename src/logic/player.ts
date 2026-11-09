// The ninja's body: running, jumping, climbing walls, swinging on the rope and zipping.
// Pure logic (no Three.js), so it can be tested and also used for other characters.

import { CITY, PLAYER, ROPE } from '../config';
import { groundHeight, isInSea, type City } from './city';
import { clamp, damp, dampAngle, type Vec3 } from './geom';
import { findSwingAnchor, findZipTarget } from './rope';

export type Mode = 'ground' | 'air' | 'wall' | 'swing' | 'zip' | 'swim' | 'drive';

export interface PlayerInput {
  /** Wanted movement direction in world XZ (length 0..1), already turned by the camera. */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jumpPressed: boolean;
  ropeHeld: boolean;
  zipPressed: boolean;
  /** Camera position and look direction (unit) for aiming. */
  aimOrigin: Vec3;
  aimDir: Vec3;
}

export const emptyInput = (): PlayerInput => ({
  moveX: 0,
  moveZ: 0,
  sprint: false,
  jumpPressed: false,
  ropeHeld: false,
  zipPressed: false,
  aimOrigin: { x: 0, y: 0, z: 0 },
  aimDir: { x: 0, y: 0, z: 1 },
});

/** Things that happened this step, for sounds and effects. */
export interface StepEvents {
  jumped: boolean;
  doubleJumped: boolean;
  landed: number; // landing speed, 0 = none
  ropeShot: boolean;
  ropeReleased: boolean;
  zipped: boolean;
  wallStart: boolean;
  vaulted: boolean;
  splashed: boolean;
}

const noEvents = (): StepEvents => ({
  jumped: false,
  doubleJumped: false,
  landed: 0,
  ropeShot: false,
  ropeReleased: false,
  zipped: false,
  wallStart: false,
  vaulted: false,
  splashed: false,
});

interface Contact {
  nx: number;
  nz: number;
  /** Top of the wall we touch. */
  top: number;
}

export class PlayerBody {
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  mode: Mode = 'air';
  /** Facing angle around Y (0 = +Z). */
  yaw = 0;
  /** Lean for the animation (radians, + = forward). */
  lean = 0;
  airJumps = 1;
  anchor: Vec3 | null = null;
  ropeLength = 0;
  zipTarget: (Vec3 & { top: boolean; nx: number; nz: number }) | null = null;
  wall: Contact | null = null;
  /** Time spent in the current mode. */
  modeTime = 0;
  private zipCooldown = 0;
  private wallContact: Contact | null = null;
  private ropeWasHeld = false;
  /** Short window after leaving a wall where wall-running is not restarted. */
  private wallLock = 0;

  constructor(private readonly city: City) {}

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeTime = 0;
  }

  teleport(p: Vec3, yaw = this.yaw): void {
    this.pos = { ...p };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = yaw;
    this.anchor = null;
    this.zipTarget = null;
    this.setMode('air');
  }

  step(dt: number, input: PlayerInput): StepEvents {
    const ev = noEvents();
    if (this.mode === 'drive') return ev;
    this.modeTime += dt;
    this.zipCooldown = Math.max(0, this.zipCooldown - dt);
    this.wallLock = Math.max(0, this.wallLock - dt);

    const wishLen = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    const wishX = wishLen > 0.01 ? input.moveX / Math.hypot(input.moveX, input.moveZ) : 0;
    const wishZ = wishLen > 0.01 ? input.moveZ / Math.hypot(input.moveX, input.moveZ) : 0;

    // --- Rope: press to shoot, release to let go -----------------------------------
    const ropePressed = input.ropeHeld && !this.ropeWasHeld;
    this.ropeWasHeld = input.ropeHeld;
    if (ropePressed && this.mode !== 'swim') {
      const anchor = findSwingAnchor(this.city, this.pos, this.vel, input.aimOrigin, input.aimDir);
      if (anchor) {
        this.anchor = anchor.point;
        const d = Math.hypot(
          this.pos.x - anchor.point.x,
          this.pos.y + 1.2 - anchor.point.y,
          this.pos.z - anchor.point.z,
        );
        this.ropeLength = Math.max(ROPE.minLength, d * ROPE.attachShorten);
        this.setMode('swing');
        ev.ropeShot = true;
        // Standing on the ground: a little hop so the swing can start.
        if (this.vel.y < 4) this.vel.y = Math.max(this.vel.y, 6);
      }
    }
    if (this.mode === 'swing' && !input.ropeHeld) {
      this.releaseRope(ev);
    }

    // --- Zip: pull straight to the crosshair -----------------------------------------
    if (input.zipPressed && this.zipCooldown <= 0 && this.mode !== 'swim') {
      const t = findZipTarget(this.city, input.aimOrigin, input.aimDir);
      if (t) {
        this.zipTarget = t;
        this.anchor = null;
        this.setMode('zip');
        this.zipCooldown = ROPE.zipCooldown;
        ev.zipped = true;
      }
    }

    switch (this.mode) {
      case 'ground':
        this.stepGround(dt, input, wishX, wishZ, wishLen, ev);
        break;
      case 'air':
        this.stepAir(dt, input, wishX, wishZ, wishLen, ev);
        break;
      case 'wall':
        this.stepWall(dt, input, wishX, wishZ, wishLen, ev);
        break;
      case 'swing':
        this.stepSwing(dt, input, wishX, wishZ, wishLen, ev);
        break;
      case 'zip':
        this.stepZip(dt, ev);
        break;
      case 'swim':
        this.stepSwim(dt, input, wishX, wishZ, wishLen, ev);
        break;
    }
    return ev;
  }

  private releaseRope(ev: StepEvents): void {
    if (!this.anchor) return;
    // A boost in the travel direction makes long swing chains feel great.
    const h = this.horizontalSpeed;
    if (h > 1) {
      this.vel.x += (this.vel.x / h) * ROPE.releaseBoost;
      this.vel.z += (this.vel.z / h) * ROPE.releaseBoost;
    }
    this.vel.y += ROPE.releaseBoost * 0.7;
    this.anchor = null;
    this.airJumps = 1;
    this.setMode('air');
    ev.ropeReleased = true;
  }

  private faceVelocity(dt: number, sharpness: number): void {
    if (this.horizontalSpeed > 0.5) {
      this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), sharpness, dt);
    }
  }

  private stepGround(
    dt: number,
    input: PlayerInput,
    wx: number,
    wz: number,
    wl: number,
    ev: StepEvents,
  ): void {
    const target = input.sprint ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    const tx = wx * target * wl;
    const tz = wz * target * wl;
    const a = PLAYER.groundAccel * dt;
    this.vel.x += clamp(tx - this.vel.x, -a, a);
    this.vel.z += clamp(tz - this.vel.z, -a, a);
    this.vel.y = 0;
    if (wl > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), 14, dt);
    this.lean = damp(this.lean, wl * (input.sprint ? 0.35 : 0.15), 8, dt);

    if (input.jumpPressed) {
      this.vel.y = PLAYER.jumpSpeed;
      this.airJumps = 1;
      this.setMode('air');
      ev.jumped = true;
    }
    this.move(dt, ev);
    if (this.mode === 'ground' && !this.isGrounded()) {
      // Small steps down (curbs) keep you on the ground; bigger drops start a fall.
      const floor = this.groundBelow(this.pos.x, this.pos.y + 0.05, this.pos.z);
      if (this.pos.y - floor < 0.45) this.pos.y = floor;
      else this.setMode('air');
    }
    this.tryStartWall(input, wx, wz, wl, ev);
  }

  private stepAir(
    dt: number,
    input: PlayerInput,
    wx: number,
    wz: number,
    wl: number,
    ev: StepEvents,
  ): void {
    this.vel.y = Math.max(-PLAYER.maxFallSpeed, this.vel.y - PLAYER.gravity * dt);
    // Air control: steer, but never brake the momentum from a swing.
    const h = this.horizontalSpeed;
    const control = PLAYER.airAccel * dt * wl;
    this.vel.x += wx * control;
    this.vel.z += wz * control;
    const newH = this.horizontalSpeed;
    const cap = Math.max(h, PLAYER.sprintSpeed);
    if (newH > cap) {
      this.vel.x *= cap / newH;
      this.vel.z *= cap / newH;
    }
    this.faceVelocity(dt, 5);
    this.lean = damp(this.lean, clamp(-this.vel.y * 0.02, -0.4, 0.4), 4, dt);

    if (input.jumpPressed && this.airJumps > 0) {
      this.airJumps--;
      this.vel.y = PLAYER.doubleJumpSpeed;
      if (wl > 0.1) {
        // Double jump also turns you toward the stick.
        const keep = Math.max(this.horizontalSpeed, PLAYER.runSpeed);
        this.vel.x = wx * keep;
        this.vel.z = wz * keep;
      }
      ev.doubleJumped = true;
    }
    this.move(dt, ev);
    this.tryStartWall(input, wx, wz, wl, ev);
  }

  private tryStartWall(
    _input: PlayerInput,
    wx: number,
    wz: number,
    wl: number,
    ev: StepEvents,
  ): void {
    const c = this.wallContact;
    if (!c || this.wallLock > 0 || wl < 0.3) return;
    if (this.mode !== 'ground' && this.mode !== 'air') return;
    // Push into the wall to climb it (when on the ground you need to be sprinting or near it).
    const into = -(wx * c.nx + wz * c.nz);
    if (into < 0.55) return;
    if (c.top - this.pos.y < 0.6) return;
    this.wall = c;
    this.setMode('wall');
    this.airJumps = 1;
    ev.wallStart = true;
  }

  private stepWall(
    dt: number,
    input: PlayerInput,
    wx: number,
    wz: number,
    wl: number,
    ev: StepEvents,
  ): void {
    const w = this.wall!;
    this.yaw = dampAngle(this.yaw, Math.atan2(-w.nx, -w.nz), 20, dt);
    this.lean = damp(this.lean, 0, 10, dt);
    const into = wl > 0.1 ? -(wx * w.nx + wz * w.nz) : 0;

    if (input.jumpPressed) {
      // Wall jump: away from the wall and up.
      this.vel.x = w.nx * PLAYER.wallJumpSpeed;
      this.vel.z = w.nz * PLAYER.wallJumpSpeed;
      this.vel.y = PLAYER.jumpSpeed * 0.85;
      this.yaw = Math.atan2(w.nx, w.nz);
      this.wall = null;
      this.wallLock = 0.35;
      this.setMode('air');
      ev.jumped = true;
      return;
    }
    if (into < 0.2) {
      // Let go: slide off.
      this.wall = null;
      this.wallLock = 0.2;
      this.setMode('air');
      return;
    }
    // Run up, also sliding sideways with the stick.
    const sideX = -w.nz;
    const sideZ = w.nx;
    const side = (wx * sideX + wz * sideZ) * 6;
    this.vel.x = -w.nx * 2 + sideX * side;
    this.vel.z = -w.nz * 2 + sideZ * side;
    this.vel.y = PLAYER.wallRunSpeed * (input.sprint ? 1.25 : 1);
    this.move(dt, ev);

    // Reached the top: hop over the edge onto the roof.
    if (this.pos.y > w.top - 0.3) {
      this.vel.y = PLAYER.vaultSpeed;
      this.vel.x = -w.nx * 6;
      this.vel.z = -w.nz * 6;
      this.wall = null;
      this.wallLock = 0.3;
      this.setMode('air');
      ev.vaulted = true;
      return;
    }
    if (!this.wallContact) {
      // The wall ended (a window ledge or corner): keep the momentum.
      this.wall = null;
      this.setMode('air');
    }
  }

  private stepSwing(
    dt: number,
    _input: PlayerInput,
    wx: number,
    wz: number,
    wl: number,
    ev: StepEvents,
  ): void {
    const a = this.anchor!;
    this.vel.y -= PLAYER.gravity * dt;
    // Pump with the stick (only the part along the swing plane matters).
    this.vel.x += wx * ROPE.swingAccel * dt * wl;
    this.vel.z += wz * ROPE.swingAccel * dt * wl;

    const sp = this.speed;
    if (sp > ROPE.maxSpeed) {
      const k = ROPE.maxSpeed / sp;
      this.vel.x *= k;
      this.vel.y *= k;
      this.vel.z *= k;
    }
    this.move(dt, ev);
    if ((this.mode as Mode) !== 'swing') return; // landed or hit something

    // Rope constraint: the hand (1.2 m above the feet) stays within the rope length.
    const hx = this.pos.x - a.x;
    const hy = this.pos.y + 1.2 - a.y;
    const hz = this.pos.z - a.z;
    const d = Math.hypot(hx, hy, hz);
    if (d > this.ropeLength) {
      const nx = hx / d;
      const ny = hy / d;
      const nz = hz / d;
      this.pos.x = a.x + nx * this.ropeLength;
      this.pos.y = a.y + ny * this.ropeLength - 1.2;
      this.pos.z = a.z + nz * this.ropeLength;
      const radial = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
      if (radial > 0) {
        this.vel.x -= radial * nx;
        this.vel.y -= radial * ny;
        this.vel.z -= radial * nz;
      }
    }
    // Slowly reel in a long rope so swings don't scrape the street.
    const floor = groundHeight(this.pos.x, this.pos.z);
    if (a.y - this.ropeLength < floor + 3) {
      this.ropeLength = Math.max(ROPE.minLength, this.ropeLength - 14 * dt);
    }
    this.faceVelocity(dt, 6);
    this.lean = damp(this.lean, clamp(this.horizontalSpeed * 0.012, 0, 0.5), 5, dt);
    // Swinging past the anchor and above it: let go automatically (it would look odd).
    if (hy > this.ropeLength * 0.2 && this.vel.y > 0) this.releaseRope(ev);
  }

  private stepZip(dt: number, ev: StepEvents): void {
    const t = this.zipTarget!;
    const dx = t.x - this.pos.x;
    const dy = t.y - (this.pos.y + 1.2);
    const dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1.5 || this.modeTime > 3) {
      this.finishZip(ev);
      return;
    }
    const sp = Math.min(ROPE.zipSpeed, 8 + this.modeTime * 120);
    this.vel.x = (dx / d) * sp;
    this.vel.y = (dy / d) * sp;
    this.vel.z = (dz / d) * sp;
    this.faceVelocity(dt, 12);
    this.lean = damp(this.lean, 0.5, 8, dt);
    this.move(dt, ev);
    if ((this.mode as Mode) !== 'zip') return;
    if (this.wallContact && d < 4) this.finishZip(ev);
  }

  private finishZip(ev: StepEvents): void {
    const t = this.zipTarget!;
    this.zipTarget = null;
    this.airJumps = 1;
    if (t.top) {
      // Pop up over the roof edge.
      this.vel.x = -t.nx * 6;
      this.vel.z = -t.nz * 6;
      this.vel.y = PLAYER.vaultSpeed;
      ev.vaulted = true;
    } else {
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
      this.vel.y = 3;
    }
    this.setMode('air');
  }

  private stepSwim(
    dt: number,
    input: PlayerInput,
    wx: number,
    wz: number,
    wl: number,
    ev: StepEvents,
  ): void {
    const speed = input.sprint ? 6 : 4;
    this.vel.x = damp(this.vel.x, wx * speed * wl, 3, dt);
    this.vel.z = damp(this.vel.z, wz * speed * wl, 3, dt);
    this.vel.y = 0;
    this.pos.y = damp(this.pos.y, CITY.seaLevel - 1.1, 6, dt);
    if (wl > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), 6, dt);
    this.move(dt, ev);
    if (!isInSea(this.pos.x, this.pos.z)) {
      // Climb out onto the promenade.
      this.pos.y = groundHeight(this.pos.x, this.pos.z);
      this.setMode('ground');
    } else if (input.jumpPressed) {
      this.vel.y = PLAYER.jumpSpeed;
      this.setMode('air');
      ev.jumped = true;
    }
  }

  private isGrounded(): boolean {
    return this.groundBelow(this.pos.x, this.pos.y + 0.05, this.pos.z) >= this.pos.y - 0.08;
  }

  /** Highest floor (street or roof) under the point. */
  private groundBelow(x: number, y: number, z: number): number {
    let floor = groundHeight(x, z);
    const r = PLAYER.radius;
    this.city.grid.query(x - r, z - r, x + r, z + r, (b) => {
      if (
        x + r > b.minX &&
        x - r < b.maxX &&
        z + r > b.minZ &&
        z - r < b.maxZ &&
        b.maxY <= y + 0.01
      ) {
        floor = Math.max(floor, b.maxY);
      }
    });
    return floor;
  }

  /** Moves by velocity, one axis at a time, pushing out of buildings. */
  private move(dt: number, ev: StepEvents): void {
    const steps = Math.max(1, Math.ceil((this.speed * dt) / 0.5));
    const h = dt / steps;
    this.wallContact = null;
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', this.vel.x * h);
      this.moveAxis('z', this.vel.z * h);
      this.moveY(this.vel.y * h, ev);
    }
    this.checkSea(ev);
  }

  private moveAxis(axis: 'x' | 'z', delta: number): void {
    if (delta === 0) return;
    const p = this.pos;
    const r = PLAYER.radius;
    const next = p[axis] + delta;
    const nx = axis === 'x' ? next : p.x;
    const nz = axis === 'z' ? next : p.z;
    let blocked = false;
    let stop = next;
    let top = 0;
    this.city.grid.query(nx - r, nz - r, nx + r, nz + r, (b) => {
      const overlaps =
        nx + r > b.minX &&
        nx - r < b.maxX &&
        nz + r > b.minZ &&
        nz - r < b.maxZ &&
        p.y + PLAYER.height > b.minY &&
        p.y < b.maxY - 0.01;
      if (!overlaps) return;
      // Small ledges (AC units, curbs on roofs) are stepped over.
      if (b.maxY - p.y < 0.5 && (this.mode === 'ground' || this.mode === 'swing')) {
        p.y = b.maxY;
        return;
      }
      blocked = true;
      top = Math.max(top, b.maxY);
      if (delta > 0) stop = Math.min(stop, (axis === 'x' ? b.minX : b.minZ) - r - 0.001);
      else stop = Math.max(stop, (axis === 'x' ? b.maxX : b.maxZ) + r + 0.001);
    });
    // The step-up above may have changed our height: also step onto the sidewalk.
    p[axis] = blocked ? stop : next;
    if (blocked) {
      const n = delta > 0 ? -1 : 1;
      this.wallContact = {
        nx: axis === 'x' ? n : 0,
        nz: axis === 'z' ? n : 0,
        top,
      };
      this.vel[axis] = 0;
      if (this.mode === 'swing' || this.mode === 'zip') {
        // Bonk: keep a bit of the other velocity, but don't stick.
        this.vel.y *= 0.9;
      }
    }
  }

  private moveY(delta: number, ev: StepEvents): void {
    const p = this.pos;
    const r = PLAYER.radius;
    if (delta <= 0) {
      const floor = this.groundBelow(p.x, p.y + 0.3, p.z);
      const next = p.y + delta;
      if (next <= floor) {
        const landingSpeed = -this.vel.y;
        p.y = floor;
        if (this.mode === 'air' || this.mode === 'swing' || this.mode === 'zip') {
          if (this.mode === 'swing') this.anchor = null;
          this.setMode('ground');
          ev.landed = Math.max(ev.landed, landingSpeed);
          this.airJumps = 1;
        }
        this.vel.y = 0;
      } else {
        p.y = next;
      }
      return;
    }
    // Going up: bump the head on overhangs.
    const next = p.y + delta;
    let ceiling = Infinity;
    this.city.grid.query(p.x - r, p.z - r, p.x + r, p.z + r, (b) => {
      if (
        p.x + r > b.minX &&
        p.x - r < b.maxX &&
        p.z + r > b.minZ &&
        p.z - r < b.maxZ &&
        b.minY >= p.y + PLAYER.height - 0.01
      ) {
        ceiling = Math.min(ceiling, b.minY);
      }
    });
    if (next + PLAYER.height > ceiling) {
      p.y = ceiling - PLAYER.height;
      this.vel.y = 0;
    } else {
      p.y = next;
    }
  }

  private checkSea(ev: StepEvents): void {
    if (this.mode === 'swim') return;
    if (isInSea(this.pos.x, this.pos.z) && this.pos.y < CITY.seaLevel - 0.6) {
      this.anchor = null;
      this.zipTarget = null;
      this.setMode('swim');
      ev.splashed = true;
    }
  }
}
