// People in the city: walkers on the sidewalks, thugs who cause trouble and police officers.
// Pure logic: the body (gravity, buildings) and a small brain for each kind.

import { CITY, PEDS } from '../config';
import { groundHeight, type City, type CityBlock } from './city';
import { angleDiff, clamp, dampAngle } from './geom';
import { Rng } from './rng';

export type PersonKind = 'civ' | 'thug' | 'cop';
export type PersonState =
  | 'walk'
  | 'idle'
  | 'panic'
  | 'cower'
  | 'chase'
  | 'windup'
  | 'strike'
  | 'flee'
  | 'flying'
  | 'down'
  | 'getup';

export interface Person {
  id: number;
  kind: PersonKind;
  seed: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  state: PersonState;
  stateTime: number;
  hp: number;
  maxHp: number;
  /** Sidewalk loop: which block, where on its loop, and which way. */
  block: number;
  loop: number;
  loopDir: 1 | -1;
  walkSpeed: number;
  /** Where the danger is (for panicking). */
  threatX: number;
  threatZ: number;
  /** Crime this person belongs to (thugs), or -1. */
  crime: number;
  /** Fights the ninja when close. */
  hostile: boolean;
  /** Runs away from the ninja instead of fighting (e.g. a bag thief). */
  runner: boolean;
  attackCooldown: number;
  /** Set when the person should be removed (after a puff of smoke). */
  gone: boolean;
}

const SIDEWALK_INSET = 2.4;
const RADIUS = 0.35;

function loopRect(b: CityBlock): { x0: number; z0: number; x1: number; z1: number } {
  return {
    x0: b.minX + SIDEWALK_INSET,
    z0: b.minZ + SIDEWALK_INSET,
    x1: b.maxX - SIDEWALK_INSET,
    z1: b.maxZ - SIDEWALK_INSET,
  };
}

export function loopLength(b: CityBlock): number {
  const r = loopRect(b);
  return 2 * (r.x1 - r.x0 + (r.z1 - r.z0));
}

/** Point on a block's sidewalk loop (clockwise seen from above, starting at the min corner). */
export function loopPoint(b: CityBlock, t: number): { x: number; z: number; yaw: number } {
  const r = loopRect(b);
  const w = r.x1 - r.x0;
  const h = r.z1 - r.z0;
  const p = ((t % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
  if (p < w) return { x: r.x0 + p, z: r.z0, yaw: Math.PI / 2 };
  if (p < w + h) return { x: r.x1, z: r.z0 + (p - w), yaw: 0 };
  if (p < 2 * w + h) return { x: r.x1 - (p - w - h), z: r.z1, yaw: -Math.PI / 2 };
  return { x: r.x0, z: r.z1 - (p - 2 * w - h), yaw: Math.PI };
}

/** Closest loop position to a point. */
export function closestLoop(b: CityBlock, x: number, z: number): number {
  const r = loopRect(b);
  const w = r.x1 - r.x0;
  const h = r.z1 - r.z0;
  const cx = clamp(x, r.x0, r.x1);
  const cz = clamp(z, r.z0, r.z1);
  const d = [Math.abs(cz - r.z0), Math.abs(cx - r.x1), Math.abs(cz - r.z1), Math.abs(cx - r.x0)];
  const side = d.indexOf(Math.min(...d));
  if (side === 0) return cx - r.x0;
  if (side === 1) return w + (cz - r.z0);
  if (side === 2) return w + h + (r.x1 - cx);
  return 2 * w + h + (r.z1 - cz);
}

export function nearestBlock(city: City, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  city.blocks.forEach((b, i) => {
    const cx = clamp(x, b.minX, b.maxX);
    const cz = clamp(z, b.minZ, b.maxZ);
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

let nextId = 1;

export function makePerson(
  kind: PersonKind,
  seed: number,
  block: number,
  loop: number,
  city: City,
): Person {
  const rng = new Rng(seed);
  const b = city.blocks[block]!;
  const p = loopPoint(b, loop);
  const maxHp = kind === 'thug' ? 45 : kind === 'cop' ? 50 : PEDS.maxHealth;
  return {
    id: nextId++,
    kind,
    seed,
    x: p.x,
    y: CITY.sidewalkHeight,
    z: p.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: p.yaw,
    state: 'walk',
    stateTime: rng.range(0, 3),
    hp: maxHp,
    maxHp,
    block,
    loop,
    loopDir: rng.chance(0.5) ? 1 : -1,
    walkSpeed: PEDS.walkSpeed * rng.range(0.8, 1.2),
    threatX: 0,
    threatZ: 0,
    crime: -1,
    hostile: false,
    runner: false,
    attackCooldown: 0,
    gone: false,
  };
}

export function setState(p: Person, s: PersonState): void {
  if (p.state === s) return;
  p.state = s;
  p.stateTime = 0;
}

/** Knock a person: damage, push and send them flying a little. Returns true if knocked out. */
export function hitPerson(
  p: Person,
  damage: number,
  dirX: number,
  dirZ: number,
  force: number,
): boolean {
  if (p.state === 'down' && p.hp <= 0) return false;
  p.hp = Math.max(0, p.hp - damage);
  const len = Math.hypot(dirX, dirZ) || 1;
  p.vx = (dirX / len) * force;
  p.vz = (dirZ / len) * force;
  p.vy = 3 + force * 0.35;
  p.y += 0.05;
  p.yaw = Math.atan2(-dirX, -dirZ); // fall backward, facing the hitter
  setState(p, 'flying');
  return p.hp <= 0;
}

export interface PersonContext {
  dt: number;
  city: City;
  rng: Rng;
  /** Ninja position, and whether the ninja can be attacked right now. */
  px: number;
  py: number;
  pz: number;
  playerTargetable: boolean;
  /** Police stars (cops chase when > 0). */
  wanted: number;
}

export interface PersonEvents {
  /** The person struck at the ninja (and was close enough to hit). */
  strike: boolean;
  /** Just landed after flying. */
  landed: boolean;
}

export function stepPerson(p: Person, ctx: PersonContext): PersonEvents {
  const ev: PersonEvents = { strike: false, landed: false };
  const { dt } = ctx;
  p.stateTime += dt;
  p.attackCooldown = Math.max(0, p.attackCooldown - dt);
  const dxP = ctx.px - p.x;
  const dzP = ctx.pz - p.z;
  const distP = Math.hypot(dxP, dzP);
  const yawToPlayer = Math.atan2(dxP, dzP);
  let moveX = 0;
  let moveZ = 0;
  let speed = 0;

  switch (p.state) {
    case 'walk': {
      const b = ctx.city.blocks[p.block]!;
      p.loop += p.loopDir * p.walkSpeed * dt;
      const t = loopPoint(b, p.loop);
      // Walk toward the loop point (so after being pushed we find our way back).
      moveX = t.x - p.x;
      moveZ = t.z - p.z;
      speed = p.walkSpeed * (Math.hypot(moveX, moveZ) > 1.5 ? 1.6 : 1);
      if (p.kind === 'civ' && ctx.rng.chance(dt * 0.03)) setState(p, 'idle');
      if (p.hostile && ctx.playerTargetable && distP < 18 && !p.runner) setState(p, 'chase');
      if (p.kind === 'cop' && ctx.wanted > 0 && ctx.playerTargetable && distP < 60)
        setState(p, 'chase');
      break;
    }
    case 'idle':
      if (p.stateTime > 4) setState(p, 'walk');
      break;
    case 'panic': {
      // Run away from the danger, then calm down.
      moveX = p.x - p.threatX;
      moveZ = p.z - p.threatZ;
      speed = PEDS.runSpeed;
      if (p.stateTime > 6) {
        p.block = nearestBlock(ctx.city, p.x, p.z);
        p.loop = closestLoop(ctx.city.blocks[p.block]!, p.x, p.z);
        setState(p, 'walk');
      }
      break;
    }
    case 'cower':
      p.yaw = dampAngle(p.yaw, Math.atan2(p.threatX - p.x, p.threatZ - p.z), 6, dt);
      if (p.stateTime > 3) setState(p, 'panic');
      break;
    case 'flee': {
      moveX = -dxP;
      moveZ = -dzP;
      speed = PEDS.runSpeed * 1.05;
      break;
    }
    case 'chase': {
      if (!ctx.playerTargetable || (p.kind === 'cop' && ctx.wanted === 0) || distP > 70) {
        setState(p, 'walk');
        p.block = nearestBlock(ctx.city, p.x, p.z);
        p.loop = closestLoop(ctx.city.blocks[p.block]!, p.x, p.z);
        break;
      }
      if (distP > 1.5) {
        moveX = dxP;
        moveZ = dzP;
        speed = PEDS.runSpeed * (p.kind === 'cop' ? 1.05 : 0.95);
      } else {
        p.yaw = dampAngle(p.yaw, yawToPlayer, 10, dt);
      }
      if (distP < 1.9 && p.attackCooldown <= 0 && Math.abs(ctx.py - p.y) < 1.5)
        setState(p, 'windup');
      break;
    }
    case 'windup':
      // Telegraph the attack so the ninja can dodge.
      p.yaw = dampAngle(p.yaw, yawToPlayer, 8, dt);
      if (p.stateTime > 0.5) {
        setState(p, 'strike');
        const facing = Math.abs(angleDiff(p.yaw, yawToPlayer)) < 0.9;
        if (distP < 2.3 && facing && ctx.playerTargetable && Math.abs(ctx.py - p.y) < 1.6)
          ev.strike = true;
        p.attackCooldown = 1.1 + ctx.rng.range(0, 0.6);
      }
      break;
    case 'strike':
      if (p.stateTime > 0.35) setState(p, 'chase');
      break;
    case 'flying':
      break;
    case 'down':
      break;
    case 'getup':
      if (p.stateTime > 0.7) {
        if (p.kind === 'civ') {
          p.threatX = ctx.px;
          p.threatZ = ctx.pz;
          setState(p, 'panic');
        } else if (p.runner) setState(p, 'flee');
        else setState(p, 'chase');
      }
      break;
  }

  // Body physics.
  const airborne = p.state === 'flying';
  if (airborne) {
    p.vy -= 22 * dt;
  } else if (p.state !== 'down' && p.state !== 'getup') {
    const len = Math.hypot(moveX, moveZ);
    const tx = len > 0.01 ? (moveX / len) * speed : 0;
    const tz = len > 0.01 ? (moveZ / len) * speed : 0;
    const k = Math.min(1, dt * 10);
    p.vx += (tx - p.vx) * k;
    p.vz += (tz - p.vz) * k;
    if (speed > 0.1 && len > 0.01) p.yaw = dampAngle(p.yaw, Math.atan2(tx, tz), 10, dt);
  } else {
    p.vx *= Math.max(0, 1 - dt * 6);
    p.vz *= Math.max(0, 1 - dt * 6);
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y += p.vy * dt;
  pushOutOfBuildings(p, ctx.city);

  const floor = floorBelow(ctx.city, p.x, p.y + 0.4, p.z);
  if (p.y <= floor) {
    p.y = floor;
    p.vy = 0;
    if (airborne) {
      // Lie down a moment (or for good when knocked out).
      ev.landed = true;
      setState(p, 'down');
    }
  } else if (!airborne && p.y > floor + 0.3) {
    // Walked off an edge.
    setState(p, 'flying');
  } else if (!airborne) {
    p.y = floor;
  }
  // Knocked down but still has health: get up after a short while.
  if (p.state === 'down' && p.hp > 0 && p.stateTime > 1.1) setState(p, 'getup');
  return ev;
}

function floorBelow(city: City, x: number, y: number, z: number): number {
  let floor = groundHeight(x, z);
  city.grid.query(x - RADIUS, z - RADIUS, x + RADIUS, z + RADIUS, (b) => {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= y)
      floor = Math.max(floor, b.maxY);
  });
  return floor;
}

function pushOutOfBuildings(p: Person, city: City): void {
  city.grid.query(p.x - RADIUS, p.z - RADIUS, p.x + RADIUS, p.z + RADIUS, (b) => {
    if (p.y + 1.6 < b.minY || p.y >= b.maxY - 0.05) return;
    const cx = clamp(p.x, b.minX, b.maxX);
    const cz = clamp(p.z, b.minZ, b.maxZ);
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= RADIUS) return;
    if (d < 1e-5) {
      // Inside: out through the nearest side.
      const opts = [
        [p.x - b.minX, -1, 0],
        [b.maxX - p.x, 1, 0],
        [p.z - b.minZ, 0, -1],
        [b.maxZ - p.z, 0, 1],
      ] as const;
      const best = [...opts].sort((a, c) => a[0] - c[0])[0]!;
      p.x += best[1] * (best[0] + RADIUS);
      p.z += best[2] * (best[0] + RADIUS);
      return;
    }
    p.x = cx + (dx / d) * RADIUS;
    p.z = cz + (dz / d) * RADIUS;
    const vn = (p.vx * dx + p.vz * dz) / d;
    if (vn < 0) {
      p.vx -= (vn * dx) / d;
      p.vz -= (vn * dz) / d;
    }
  });
}
