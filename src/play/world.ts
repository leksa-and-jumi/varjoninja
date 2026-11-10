// Everything alive in the city besides the ninja: people, cars, crimes, police and fights.

import * as THREE from 'three';
import { AMBULANCE, CITY, COMBAT, PEDS, PLAYER, POLICE, TRAFFIC } from '../config';
import { Ambulances } from './ambulances';
import { Decals } from '../render/decals';
import { groundHeight, isOnRoad, type City } from '../logic/city';
import { activeCrimes, CRIME_INFO, type Crime, type CrimeKind } from '../logic/crimes';
import { t, type TextKey } from '../i18n';
import { angleDiff, type Vec3 } from '../logic/geom';
import {
  closestLoop,
  hitPerson,
  loopLength,
  makePerson,
  nearestBlock,
  setState,
  stepPerson,
  type Person,
  type PersonKind,
} from '../logic/people';
import type { PlayerBody } from '../logic/player';
import { hash, Rng } from '../logic/rng';
import { Ragdoll, type RagdollWorld } from '../logic/ragdoll';
import { spawnCar, stepCar, type TrafficCar } from '../logic/traffic';
import { DrivenCar, type DriveInput } from '../logic/vehicle';
import { poseFor, type AnimInput, type AnimMode } from '../render/animator';
import { CarView, CAR_COLORS, type CarModel } from '../render/carView';
import { animateCat, makeCat } from '../render/catView';
import { CharacterView, civilianLook, policeLook, thugLook, type Look } from '../render/characters';
import type { Effects } from '../render/effects';
import { makeBeacon, shurikenGeometry, updateBeacon } from '../render/markers';

export type SoundName =
  | 'punch'
  | 'kick'
  | 'whoosh'
  | 'hurt'
  | 'ko'
  | 'coin'
  | 'reward'
  | 'shuriken'
  | 'smoke'
  | 'carHit'
  | 'horn'
  | 'meow'
  | 'carDoor'
  | 'finisher';

export interface WorldCallbacks {
  notify(title: string, text: string, icon: string): void;
  reward(points: number, text: string): void;
  sound(name: SoundName, at?: Vec3): void;
  crimeSolved(id: number): void;
  shake(amount: number): void;
  playerKnockedOut(): void;
  /** A finishing move started: show its name. */
  finisher(kind: FinisherKind): void;
}

export type FinisherKind = 'tornado' | 'dash' | 'uppercut';

/** Length of each finishing move (seconds of game time) and when it lands. */
const FINISHERS: Record<FinisherKind, { duration: number; hitAt: number }> = {
  tornado: { duration: 0.95, hitAt: 0.42 },
  dash: { duration: 0.75, hitAt: 0.24 },
  uppercut: { duration: 0.95, hitAt: 0.22 },
};

interface Finisher {
  kind: FinisherKind;
  t: number;
  target: Person;
  hit: boolean;
  dirX: number;
  dirZ: number;
}

type AttackMove = NonNullable<AnimInput['attack']>['move'];

interface Attack {
  move: AttackMove;
  t: number;
  duration: number;
  hitDone: boolean;
}

interface CarEntity {
  traffic: TrafficCar;
  view: CarView | null;
  model: CarModel;
  color: string;
  /** Stopped after being kicked, seconds left. */
  stunned: number;
  siren: boolean;
  thiefCrime: number;
  hp: number;
  honk: number;
}

interface Parked {
  car: DrivenCar;
  view: CarView;
  model: CarModel;
  color: string;
}

interface Shuriken {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  stuck: boolean;
}

interface CrimeScene {
  crime: Crime;
  spawned: boolean;
  people: number[];
  cat: THREE.Group | null;
  beacon: THREE.Mesh;
  announced: boolean;
}

const CRIME_TEXT: Record<CrimeKind, TextKey> = {
  mugger: 'crimeMugger',
  gang: 'crimeGang',
  carThief: 'crimeCarThief',
  cat: 'crimeCat',
};

export function crimeTitle(kind: CrimeKind): string {
  return t(CRIME_TEXT[kind]);
}

function crimeHint(kind: CrimeKind): string {
  return t(`${CRIME_TEXT[kind]}Hint` as TextKey);
}

const LOOK_CACHE = new Map<string, Look>();
export function lookFor(kind: PersonKind, seed: number): Look {
  const key = `${kind}:${seed}`;
  let look = LOOK_CACHE.get(key);
  if (!look) {
    look = kind === 'civ' ? civilianLook(seed) : kind === 'cop' ? policeLook(seed) : thugLook(seed);
    if (LOOK_CACHE.size > 400) LOOK_CACHE.clear();
    LOOK_CACHE.set(key, look);
  }
  return look;
}

export class World {
  people: Person[] = [];
  private views = new Map<number, CharacterView>();
  private viewPool: CharacterView[] = [];
  private phases = new Map<number, number>();
  /** Knocked-out people that fall like rag dolls (by person id). */
  private ragdolls = new Map<number, Ragdoll>();
  private ragdollWorld: RagdollWorld;
  private ambulances: Ambulances;
  private decals: Decals;
  /** Knocked-out people who already left a stain. */
  private bled = new Set<number>();
  cars: CarEntity[] = [];
  private carPool = new Map<CarModel, CarView[]>();
  parked: Parked[] = [];
  driving: Parked | null = null;
  private shurikens: Shuriken[] = [];
  private shurikenMesh: THREE.InstancedMesh;
  private scenes = new Map<number, CrimeScene>();
  solved = new Set<number>();
  private collectMesh: THREE.InstancedMesh;
  collected = new Set<number>();
  private rng = new Rng(Date.now() & 0xffff);
  private time = 0;

  // Ninja combat and health
  hp: number = PLAYER.maxHealth;
  private sinceHurt = 99;
  hurtFlash = 0;
  attack: Attack | null = null;
  finisher: Finisher | null = null;
  /** Real seconds of slow motion left (after a finishing move lands). */
  private slowmo = 0;
  private lastFinisher: FinisherKind | null = null;
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  shurikenCooldown = 0;
  smokeCooldown = 0;
  wanted = 0;
  private wantedTimer = 0;
  heroPoints = 0;
  /** All points ever earned (the rank does not drop when shopping). */
  earned = 0;
  /** Seed shared by everyone in the room (crimes). */
  roomSeed = 1;
  private clockOffset = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly city: City,
    private readonly fx: Effects,
    private readonly cb: WorldCallbacks,
  ) {
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xb8c0c8,
      metalness: 0.9,
      roughness: 0.25,
    });
    this.shurikenMesh = new THREE.InstancedMesh(shurikenGeometry(0.22), starMat, 24);
    this.shurikenMesh.count = 0;
    this.shurikenMesh.frustumCulled = false;
    scene.add(this.shurikenMesh);

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffc83d,
      metalness: 1,
      roughness: 0.2,
      emissive: 0x6a4300,
      emissiveIntensity: 0.6,
    });
    this.collectMesh = new THREE.InstancedMesh(
      shurikenGeometry(0.7),
      goldMat,
      city.collectibles.length,
    );
    this.collectMesh.frustumCulled = false;
    scene.add(this.collectMesh);

    this.decals = new Decals(scene);
    this.ambulances = new Ambulances(scene, city, {
      waitingPeople: () => this.people.filter((p) => p.hp <= 0 && !p.gone),
      takePerson: (p) => {
        p.gone = true;
        p.quiet = true;
      },
      release: (patient, x, z) => {
        // Back on their feet, walking off from the hospital doors.
        const block = nearestBlock(this.city, x, z);
        const b = this.city.blocks[block]!;
        const p = this.addPerson(patient.kind, block, closestLoop(b, x, z), patient.seed);
        p.x = x;
        p.z = z;
        p.y = CITY.sidewalkHeight;
        p.hostile = false;
        p.runner = false;
        p.crime = -1;
      },
      lookOf: (kind, seed) => lookFor(kind, seed),
      sparkle: (x, y, z) => this.fx.sparkle(x, y, z, new THREE.Color(0.5, 1, 0.6)),
    });
    this.ragdollWorld = {
      floor: (x, y, z) => {
        let floor = groundHeight(x, z);
        city.grid.query(x, z, x, z, (b) => {
          if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= y + 0.3)
            floor = Math.max(floor, b.maxY);
        });
        return floor;
      },
      pushOut: (p) => {
        city.grid.query(p.x, p.z, p.x, p.z, (b) => {
          if (p.x <= b.minX || p.x >= b.maxX || p.z <= b.minZ || p.z >= b.maxZ) return;
          if (p.y <= b.minY || p.y >= b.maxY - 0.3) return;
          // Inside a wall: out through the nearest side.
          const opts = [
            [p.x - b.minX, -1, 0],
            [b.maxX - p.x, 1, 0],
            [p.z - b.minZ, 0, -1],
            [b.maxZ - p.z, 0, 1],
          ] as const;
          const best = [...opts].sort((a, c) => a[0] - c[0])[0]!;
          p.x += best[1] * (best[0] + 0.02);
          p.z += best[2] * (best[0] + 0.02);
        });
      },
    };
  }

  /** Turn a knocked-out person into a rag doll, thrown with velocity `vel`. */
  private startRagdoll(p: Person, vel: Vec3, spin: number): void {
    const v = this.views.get(p.id);
    if (!v) return;
    v.root.updateMatrixWorld(true);
    const points = v.jointPositions();
    const r = new Ragdoll(points);
    r.push(vel, spin, () => this.rng.next());
    v.startRagdoll(points);
    this.ragdolls.set(p.id, r);
    p.state = 'down';
    p.stateTime = 0;
  }

  /** Server clock offset (ms) so crimes match between players. */
  setClockOffset(ms: number): void {
    this.clockOffset = ms;
  }

  nowSec(): number {
    return (Date.now() + this.clockOffset) / 1000;
  }

  // --- People ---------------------------------------------------------------------------

  private addPerson(
    kind: PersonKind,
    block: number,
    loop: number,
    seed = this.rng.int(1, 1e9),
  ): Person {
    const p = makePerson(kind, seed, block, loop, this.city);
    this.people.push(p);
    return p;
  }

  private viewFor(p: Person): CharacterView {
    let v = this.views.get(p.id);
    if (!v) {
      const look = lookFor(p.kind, p.seed);
      v = this.viewPool.pop();
      if (v) v.setLook(look);
      else v = new CharacterView(look);
      this.scene.add(v.root);
      this.views.set(p.id, v);
    }
    return v;
  }

  private releaseView(id: number): void {
    this.ragdolls.delete(id);
    const v = this.views.get(id);
    if (!v) return;
    v.endRagdoll();
    v.root.removeFromParent();
    this.views.delete(id);
    this.phases.delete(id);
    if (this.viewPool.length < 30) this.viewPool.push(v);
    else v.dispose();
  }

  private spawnCivilians(px: number, pz: number, night: number): void {
    const civs = this.people.filter((p) => p.kind === 'civ').length;
    const want = Math.round(PEDS.max * (1 - night * 0.45));
    for (let i = 0; i < 3 && civs + i < want; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(this.people.length < 10 ? 10 : 60, PEDS.spawnRadius);
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      const block = nearestBlock(this.city, x, z);
      const b = this.city.blocks[block]!;
      if (Math.abs(x) > 500 || Math.abs(z) > 500) continue;
      const loop = closestLoop(b, x, z) + this.rng.range(-5, 5);
      this.addPerson('civ', block, (loop + loopLength(b)) % loopLength(b));
    }
  }

  private spawnCops(px: number, pz: number): void {
    const cops = this.people.filter((p) => p.kind === 'cop' && p.hp > 0).length;
    const want = Math.min(8, this.wanted * POLICE.officersPerStar);
    if (cops >= want) return;
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(40, 65);
    const block = nearestBlock(this.city, px + Math.cos(a) * r, pz + Math.sin(a) * r);
    const b = this.city.blocks[block]!;
    const cop = this.addPerson(
      'cop',
      block,
      closestLoop(b, px + Math.cos(a) * r, pz + Math.sin(a) * r),
    );
    setState(cop, 'chase');
  }

  /** Make everyone near a spot run away. */
  private scare(x: number, z: number, radius: number): void {
    for (const p of this.people) {
      if (p.kind !== 'civ' || p.state === 'flying' || p.state === 'down') continue;
      if (Math.hypot(p.x - x, p.z - z) > radius) continue;
      p.threatX = x;
      p.threatZ = z;
      setState(p, this.rng.chance(0.25) ? 'cower' : 'panic');
    }
  }

  private addWanted(n: number): void {
    const before = this.wanted;
    this.wanted = Math.min(POLICE.maxStars, this.wanted + n);
    this.wantedTimer = 0;
    if (before === 0 && this.wanted > 0) {
      this.cb.notify(t('policeComing'), t('policeComingText'), '🚓');
    }
  }

  // --- Cars --------------------------------------------------------------------------------

  private carView(model: CarModel, color: string): CarView {
    const pool = this.carPool.get(model);
    const v = pool?.pop() ?? new CarView(model, color);
    if (model !== 'taxi' && model !== 'police' && model !== 'ambulance') v.paint.color.set(color);
    this.scene.add(v.root);
    return v;
  }

  private releaseCarView(v: CarView): void {
    v.root.removeFromParent();
    let pool = this.carPool.get(v.model);
    if (!pool) this.carPool.set(v.model, (pool = []));
    if (pool.length < 12) pool.push(v);
    else v.dispose();
  }

  private spawnTraffic(px: number, pz: number): void {
    const count = this.cars.length;
    if (count >= TRAFFIC.maxCars) return;
    const min = count < TRAFFIC.maxCars / 2 && this.time < 3 ? 15 : 110;
    const t = spawnCar(this.rng, px, pz, min, TRAFFIC.spawnRadius);
    if (!t) return;
    // Don't spawn on top of another car.
    if (this.cars.some((c) => Math.hypot(c.traffic.x - t.x, c.traffic.z - t.z) < 10)) return;
    const roll = this.rng.next();
    const model: CarModel =
      roll < 0.45
        ? 'sedan'
        : roll < 0.62
          ? 'taxi'
          : roll < 0.8
            ? 'van'
            : roll < 0.92
              ? 'sports'
              : 'police';
    const color = this.rng.pick(CAR_COLORS);
    this.cars.push({
      traffic: t,
      view: null,
      model,
      color,
      stunned: 0,
      siren: false,
      thiefCrime: -1,
      hp: 3,
      honk: 0,
    });
  }

  // --- Ninja actions -----------------------------------------------------------------------

  /** Targets the ninja can attack: alive people. */
  private targets(): Person[] {
    return this.people.filter((p) => !p.gone && p.hp > 0 && p.state !== 'down');
  }

  /** Game speed: slow motion right after a finishing move lands. */
  get timeScale(): number {
    return this.slowmo > 0 ? 0.3 : 1;
  }

  startAttack(player: PlayerBody, aimYaw: number): void {
    if (this.driving || this.finisher) return;
    if (this.attack && !this.attack.hitDone) {
      this.queued = true;
      return;
    }
    if (this.attack && this.attack.t < this.attack.duration * 0.6) {
      this.queued = true;
      return;
    }
    const inAir = player.mode === 'air' || player.mode === 'swing' || player.mode === 'zip';
    const target = this.findTarget(player, aimYaw, inAir ? 16 : COMBAT.lungeRange, inAir);
    if (inAir) {
      if (target) {
        // Dive kick down onto the target.
        player.anchor = null;
        player.setMode('air');
        this.attack = { move: 'diveKick', t: 0, duration: 0.9, hitDone: false };
        this.aimDive(player, target);
        this.cb.sound('whoosh');
        return;
      }
      this.attack = { move: 'kick', t: 0, duration: 0.5, hitDone: false };
      this.cb.sound('whoosh');
      return;
    }
    this.combo = this.comboTimer > 0 ? (this.combo + 1) % 3 : 0;
    const move: AttackMove = this.combo === 0 ? 'punchR' : this.combo === 1 ? 'punchL' : 'kick';
    this.attack = { move, t: 0, duration: move === 'kick' ? 0.55 : 0.4, hitDone: false };
    if (target) {
      // Turn and lunge toward the target.
      const dx = target.x - player.pos.x;
      const dz = target.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      player.yaw = Math.atan2(dx, dz);
      if (d > 1.6 && player.mode === 'ground') {
        const sp = Math.min(16, (d - 1.2) * 6);
        player.vel.x = (dx / d) * sp;
        player.vel.z = (dz / d) * sp;
      }
    } else {
      player.yaw = aimYaw;
    }
    this.cb.sound('whoosh');
  }

  private aimDive(player: PlayerBody, t: Person): void {
    const dx = t.x - player.pos.x;
    const dy = t.y + 0.9 - player.pos.y;
    const dz = t.z - player.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    player.vel.x = (dx / d) * 28;
    player.vel.y = (dy / d) * 28;
    player.vel.z = (dz / d) * 28;
    player.yaw = Math.atan2(dx, dz);
  }

  private findTarget(
    player: PlayerBody,
    aimYaw: number,
    range: number,
    below: boolean,
  ): Person | null {
    let best: Person | null = null;
    let bestScore = Infinity;
    for (const p of this.targets()) {
      const dx = p.x - player.pos.x;
      const dz = p.z - player.pos.z;
      const dy = p.y - player.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > range || (below && (dy > 2 || Math.hypot(d, dy) > range))) continue;
      if (!below && Math.abs(dy) > 2) continue;
      const off = Math.abs(angleDiff(aimYaw, Math.atan2(dx, dz)));
      if (off > 1.3) continue;
      // Prefer bad guys, then closeness and how well we aim.
      const score = d + off * 4 + (p.kind === 'civ' ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  private landHits(player: PlayerBody, move: AttackMove): void {
    const fx = Math.sin(player.yaw);
    const fz = Math.cos(player.yaw);
    const reach = move === 'diveKick' ? 2.2 : COMBAT.punchRange;
    const cx = player.pos.x + fx * 0.9;
    const cz = player.pos.z + fz * 0.9;
    const dmg =
      move === 'kick' ? COMBAT.hitDamage[2] : move === 'diveKick' ? 32 : COMBAT.hitDamage[0];
    const force = move === 'kick' ? 11 : move === 'diveKick' ? 13 : 4.5;
    let hitAny = false;
    for (const p of this.targets()) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (Math.hypot(dx, dz) > reach || Math.abs(p.y - player.pos.y) > 1.8) continue;
      const toward = Math.atan2(p.x - player.pos.x, p.z - player.pos.z);
      if (
        move !== 'diveKick' &&
        Math.abs(angleDiff(player.yaw, toward)) > COMBAT.punchArc &&
        Math.hypot(dx, dz) > 1
      )
        continue;
      // The last hit on a bad guy becomes a finishing move.
      const badGuy = p.kind === 'thug' || (p.kind === 'cop' && this.wanted > 0);
      if (badGuy && p.hp <= dmg && player.mode === 'ground' && move !== 'diveKick') {
        this.startFinisher(player, p);
        return;
      }
      this.damagePerson(p, dmg, p.x - player.pos.x, p.z - player.pos.z, force);
      hitAny = true;
    }
    // Kicking cars stops them (and a thief's car takes damage).
    for (const c of this.cars) {
      const d = Math.hypot(c.traffic.x - cx, c.traffic.z - cz);
      if (d > 3) continue;
      this.hitCar(c, cx, player.pos.y + 1, cz);
      hitAny = true;
    }
    if (hitAny) {
      this.cb.sound(move === 'punchR' || move === 'punchL' ? 'punch' : 'kick');
      this.cb.shake(move === 'kick' || move === 'diveKick' ? 0.35 : 0.15);
    }
  }

  private startFinisher(player: PlayerBody, target: Person): void {
    // Never the same move twice in a row.
    const kinds = (['tornado', 'dash', 'uppercut'] as const).filter((k) => k !== this.lastFinisher);
    const kind = this.rng.pick(kinds);
    this.lastFinisher = kind;
    const dx = target.x - player.pos.x;
    const dz = target.z - player.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.finisher = { kind, t: 0, target, hit: false, dirX: dx / len, dirZ: dz / len };
    this.attack = { move: kind, t: 0, duration: FINISHERS[kind].duration, hitDone: true };
    this.queued = false;
    player.yaw = Math.atan2(dx, dz);
    player.vel.x = 0;
    player.vel.z = 0;
    // The target freezes in surprise.
    setState(target, 'cower');
    target.threatX = player.pos.x;
    target.threatZ = player.pos.z;
    this.cb.finisher(kind);
    this.cb.sound('finisher');
  }

  private updateFinisher(dt: number, player: PlayerBody): void {
    const f = this.finisher;
    if (!f) return;
    const before = f.t;
    f.t += dt;
    const spec = FINISHERS[f.kind];
    const target = f.target;
    const crossed = (at: number) => before < at && f.t >= at;
    switch (f.kind) {
      case 'tornado':
        if (crossed(0.04)) {
          player.vel.y = 7.5;
          player.setMode('air');
        }
        if (f.t < spec.hitAt) {
          player.vel.x = f.dirX * 2;
          player.vel.z = f.dirZ * 2;
        }
        break;
      case 'dash': {
        if (f.t < 0.15) {
          player.vel.x = 0;
          player.vel.z = 0;
        } else if (f.t < 0.34) {
          // Shoot through the target, leaving shadows behind.
          player.vel.x = f.dirX * 40;
          player.vel.z = f.dirZ * 40;
          this.fx.puff(
            player.pos.x,
            player.pos.y + 0.6,
            player.pos.z,
            3,
            new THREE.Color(0.25, 0.2, 0.35),
            0.4,
          );
        } else {
          player.vel.x *= 0.85;
          player.vel.z *= 0.85;
        }
        break;
      }
      case 'uppercut':
        if (f.t < spec.hitAt) {
          player.vel.x = 0;
          player.vel.z = 0;
        }
        if (crossed(spec.hitAt)) {
          player.vel.y = 11;
          player.setMode('air');
        }
        break;
    }
    if (!f.hit && f.t >= spec.hitAt) {
      f.hit = true;
      const side = this.rng.chance(0.5) ? 1 : -1;
      const throwVel: Vec3 =
        f.kind === 'tornado'
          ? { x: f.dirX * 20, y: 9, z: f.dirZ * 20 }
          : f.kind === 'dash'
            ? { x: -f.dirZ * 6 * side - f.dirX * 2, y: 9, z: f.dirX * 6 * side - f.dirZ * 2 }
            : { x: f.dirX * 3, y: 20, z: f.dirZ * 3 };
      const hp = target.hp;
      this.damagePerson(target, hp + 1, f.dirX, f.dirZ, 12, throwVel);
      this.fx.impact(target.x, target.y + 1.2, target.z);
      this.cb.sound('kick');
      this.cb.shake(0.7);
      this.slowmo = 0.55;
    }
    if (f.t >= spec.duration) {
      this.finisher = null;
      this.attack = null;
    }
  }

  private hitCar(c: CarEntity, x: number, y: number, z: number): void {
    c.stunned = 4;
    c.traffic.speed = 0;
    this.fx.sparks(x, y, z);
    this.cb.sound('carHit');
    if (c.thiefCrime >= 0) {
      c.hp--;
      if (c.hp <= 0) this.stopThiefCar(c);
    }
  }

  damagePerson(
    p: Person,
    dmg: number,
    dx: number,
    dz: number,
    force: number,
    throwVel?: Vec3,
  ): void {
    const innocent = p.kind === 'civ' || (p.kind === 'cop' && this.wanted === 0);
    const ko = hitPerson(p, dmg, dx, dz, force);
    if (ko) {
      const dl = Math.hypot(dx, dz) || 1;
      this.fx.blood(p.x, p.y + 1.1, p.z, dx / dl, dz / dl);
      // An ambulance will come for them in a minute or two.
      p.rescueAt = this.time + this.rng.range(AMBULANCE.minWait, AMBULANCE.maxWait);
      // Knocked out: fly like a rag doll, a little differently every time.
      const len = Math.hypot(dx, dz) || 1;
      // A real hit knocks you over rather than sending you flying (finishing moves still do).
      const vel = throwVel ?? {
        x: (dx / len) * (1.5 + force * 0.45),
        y: 0.8 + force * 0.12,
        z: (dz / len) * (1.5 + force * 0.45),
      };
      this.startRagdoll(p, vel, throwVel ? this.rng.range(3, 8) : this.rng.range(0.8, 2.5));
    }
    this.fx.sparks(p.x, p.y + 1.2, p.z);
    if (innocent) {
      this.addWanted(POLICE.starPerInnocentHit);
      this.scare(p.x, p.z, 18);
    } else if (p.kind === 'thug') {
      this.scare(p.x, p.z, 12);
    }
    if (p.kind === 'cop') this.addWanted(1);
    if (ko) this.cb.sound('ko', p);
  }

  throwShuriken(player: PlayerBody, origin: Vec3, aim: Vec3): void {
    if (this.shurikenCooldown > 0 || this.driving) return;
    this.shurikenCooldown = COMBAT.shurikenCooldown;
    // Auto-aim: the bad guy closest to the crosshair, if any.
    const from = { x: player.pos.x, y: player.pos.y + 1.4, z: player.pos.z };
    let dir = { ...aim };
    let best = 0.22;
    for (const p of this.targets()) {
      if (p.kind === 'civ') continue;
      const tx = p.x - origin.x;
      const ty = p.y + 1.1 - origin.y;
      const tz = p.z - origin.z;
      const d = Math.hypot(tx, ty, tz);
      if (d > 60) continue;
      const cos = (tx * aim.x + ty * aim.y + tz * aim.z) / d;
      const ang = Math.acos(Math.min(1, cos));
      if (ang < best) {
        best = ang;
        const fx = p.x - from.x;
        const fy = p.y + 1.1 - from.y;
        const fz = p.z - from.z;
        const fd = Math.hypot(fx, fy, fz);
        dir = { x: fx / fd, y: fy / fd, z: fz / fd };
      }
    }
    this.shurikens.push({
      ...from,
      vx: dir.x * COMBAT.shurikenSpeed,
      vy: dir.y * COMBAT.shurikenSpeed,
      vz: dir.z * COMBAT.shurikenSpeed,
      life: 2.5,
      stuck: false,
    });
    if (this.shurikens.length > 24) this.shurikens.shift();
    this.attack = { move: 'throw', t: 0, duration: 0.35, hitDone: true };
    player.yaw = Math.atan2(dir.x, dir.z);
    this.cb.sound('shuriken');
  }

  smokeBomb(player: PlayerBody): void {
    if (this.smokeCooldown > 0) return;
    this.smokeCooldown = COMBAT.smokeCooldown;
    const p = player.pos;
    this.fx.puff(p.x, p.y + 0.3, p.z, 60, new THREE.Color(0.55, 0.55, 0.62), 6);
    this.cb.sound('smoke');
    for (const q of this.people) {
      if (q.state === 'down' || q.state === 'flying') continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) > COMBAT.smokeRadius) continue;
      q.threatX = p.x;
      q.threatZ = p.z;
      setState(q, 'cower');
    }
    if (this.wanted > 0) {
      this.wanted--;
      this.wantedTimer = 0;
    }
  }

  hurtPlayer(dmg: number, fromX: number, fromZ: number, player: PlayerBody): void {
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHurt = 0;
    this.hurtFlash = 1;
    this.cb.sound('hurt');
    this.cb.shake(0.4);
    const dx = player.pos.x - fromX;
    const dz = player.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    if (player.mode === 'ground') {
      player.vel.x += (dx / d) * 5;
      player.vel.z += (dz / d) * 5;
    }
    if (this.hp <= 0) this.cb.playerKnockedOut();
  }

  resetAfterKnockout(): void {
    this.hp = PLAYER.maxHealth;
    this.wanted = 0;
    for (const p of this.people) {
      if (p.kind === 'cop') p.gone = true;
      if (p.state === 'chase' || p.state === 'windup') setState(p, 'walk');
    }
  }

  // --- Cars: entering and driving ----------------------------------------------------------

  /** Enter the nearest car (F). Returns true if the ninja is now driving. */
  enterCar(player: PlayerBody): boolean {
    let best: { kind: 'traffic' | 'parked'; i: number; d: number } | null = null;
    this.cars.forEach((c, i) => {
      const d = Math.hypot(c.traffic.x - player.pos.x, c.traffic.z - player.pos.z);
      if (d < 4.5 && c.thiefCrime < 0 && (!best || d < best.d)) best = { kind: 'traffic', i, d };
    });
    this.parked.forEach((p, i) => {
      const d = Math.hypot(p.car.x - player.pos.x, p.car.z - player.pos.z);
      if (d < 4.5 && !p.car.sunk && (!best || d < best.d)) best = { kind: 'parked', i, d };
    });
    if (!best) return false;
    const b = best as { kind: 'traffic' | 'parked'; i: number; d: number };
    if (b.kind === 'traffic') {
      const c = this.cars[b.i]!;
      this.cars.splice(b.i, 1);
      const car = new DrivenCar(this.city);
      car.place(c.traffic.x, c.traffic.z, c.traffic.yaw, c.traffic.speed * 0.3);
      const view = c.view ?? this.carView(c.model, c.color);
      this.driving = { car, view, model: c.model, color: c.color };
      // The driver hops out and runs.
      const side = { x: -Math.cos(c.traffic.yaw) * 2, z: Math.sin(c.traffic.yaw) * 2 };
      const block = nearestBlock(this.city, c.traffic.x, c.traffic.z);
      const driver = this.addPerson('civ', block, 0);
      driver.x = c.traffic.x + side.x;
      driver.z = c.traffic.z + side.z;
      driver.threatX = player.pos.x;
      driver.threatZ = player.pos.z;
      setState(driver, 'panic');
    } else {
      this.driving = this.parked.splice(b.i, 1)[0]!;
    }
    player.setMode('drive');
    player.anchor = null;
    this.attack = null;
    this.cb.sound('carDoor');
    return true;
  }

  exitCar(player: PlayerBody): void {
    const d = this.driving;
    if (!d) return;
    this.driving = null;
    this.parked.push(d);
    const yaw = d.car.yaw;
    // Step out on the left side.
    player.teleport(
      { x: d.car.x + Math.cos(yaw) * 1.8, y: d.car.y + 0.3, z: d.car.z - Math.sin(yaw) * 1.8 },
      yaw,
    );
    player.vel.x = d.car.vx * 0.5;
    player.vel.z = d.car.vz * 0.5;
    if (this.parked.length > 6) {
      const old = this.parked.shift()!;
      this.releaseCarView(old.view);
    }
    this.cb.sound('carDoor');
  }

  driveStep(dt: number, input: DriveInput, player: PlayerBody): void {
    const d = this.driving;
    if (!d) return;
    const impact = d.car.step(dt, input);
    if (impact > 6) {
      this.cb.sound('carHit');
      this.cb.shake(Math.min(1, impact / 25));
      this.fx.sparks(
        d.car.x + Math.sin(d.car.yaw) * 2,
        d.car.y + 0.8,
        d.car.z + Math.cos(d.car.yaw) * 2,
      );
    }
    player.pos.x = d.car.x;
    player.pos.y = d.car.y;
    player.pos.z = d.car.z;
    player.vel.x = d.car.vx;
    player.vel.z = d.car.vz;
    player.yaw = d.car.yaw;
    if (d.car.sunk) {
      this.exitCar(player);
      return;
    }
    // Running into people and other cars.
    const sp = d.car.speed;
    for (const p of this.targets()) {
      const dx = p.x - d.car.x;
      const dz = p.z - d.car.z;
      if (Math.hypot(dx, dz) < 2 && sp > 4 && Math.abs(p.y - d.car.y) < 1.5) {
        this.damagePerson(p, sp * 1.6, d.car.vx, d.car.vz, Math.min(16, sp * 0.6));
        this.cb.sound('carHit');
      }
    }
    for (const c of this.cars) {
      const dx = c.traffic.x - d.car.x;
      const dz = c.traffic.z - d.car.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3 && dist > 0.01) {
        const vn = (d.car.vx * dx + d.car.vz * dz) / dist;
        if (vn > 2) {
          d.car.vx -= (dx / dist) * vn * 1.2;
          d.car.vz -= (dz / dist) * vn * 1.2;
          this.hitCar(c, (c.traffic.x + d.car.x) / 2, d.car.y + 0.8, (c.traffic.z + d.car.z) / 2);
          this.cb.shake(0.3);
        }
        // Keep apart.
        d.car.x -= (dx / dist) * (3 - dist) * 0.5;
        d.car.z -= (dz / dist) * (3 - dist) * 0.5;
      }
    }
  }

  // --- Crimes ------------------------------------------------------------------------------

  private stopThiefCar(c: CarEntity): void {
    const crime = c.thiefCrime;
    c.thiefCrime = -1;
    c.stunned = 9999;
    c.traffic.speed = 0;
    this.fx.puff(c.traffic.x, 1.2, c.traffic.z, 30, new THREE.Color(0.3, 0.3, 0.32));
    const block = nearestBlock(this.city, c.traffic.x, c.traffic.z);
    const thief = this.addPerson('thug', block, 0);
    thief.x = c.traffic.x - Math.cos(c.traffic.yaw) * 2;
    thief.z = c.traffic.z + Math.sin(c.traffic.yaw) * 2;
    thief.crime = crime;
    thief.runner = true;
    setState(thief, 'flee');
    const scene = this.scenes.get(crime);
    scene?.people.push(thief.id);
    this.cb.notify(t('carStopped'), t('carStoppedText'), '🏃');
  }

  private spawnCrime(sc: CrimeScene, px: number, pz: number): void {
    const c = sc.crime;
    sc.spawned = true;
    const b = this.city.blocks[c.block]!;
    const len = loopLength(b);
    const loop = closestLoop(b, px, pz);
    switch (c.kind) {
      case 'mugger': {
        const victim = this.addPerson('civ', c.block, (loop + len / 2) % len);
        victim.threatX = victim.x + 1;
        victim.threatZ = victim.z;
        setState(victim, 'cower');
        const thief = this.addPerson('thug', c.block, (loop + len / 2 + 1.5) % len, hash(c.id, 1));
        thief.crime = c.id;
        thief.runner = true;
        setState(thief, 'idle');
        sc.people.push(thief.id);
        break;
      }
      case 'gang': {
        for (let i = 0; i < c.count; i++) {
          const t = this.addPerson(
            'thug',
            c.block,
            (loop + len / 2 + i * 2.2) % len,
            hash(c.id, i),
          );
          t.crime = c.id;
          t.hostile = true;
          setState(t, 'idle');
          sc.people.push(t.id);
        }
        break;
      }
      case 'carThief': {
        const t = spawnCar(this.rng, c.x, c.z, 0, 120);
        if (!t) {
          sc.spawned = false;
          return;
        }
        t.cruise = 24;
        t.speed = 20;
        this.cars.push({
          traffic: t,
          view: null,
          model: 'sports',
          color: '#e3242b',
          stunned: 0,
          siren: false,
          thiefCrime: c.id,
          hp: 3,
          honk: 0,
        });
        break;
      }
      case 'cat': {
        const cat = makeCat();
        cat.position.set(c.x, c.y, c.z);
        cat.rotation.y = this.rng.range(0, Math.PI * 2);
        this.scene.add(cat);
        sc.cat = cat;
        break;
      }
    }
  }

  private despawnCrime(sc: CrimeScene): void {
    for (const id of sc.people) {
      const p = this.people.find((q) => q.id === id);
      if (p) p.gone = true;
    }
    sc.people = [];
    for (const c of this.cars) if (c.thiefCrime === sc.crime.id) c.thiefCrime = -2; // drives away
    if (sc.cat) {
      this.scene.remove(sc.cat);
      sc.cat = null;
    }
    sc.spawned = false;
  }

  /** Called when a crime is solved here or by a friend. */
  markSolved(id: number, byMe: boolean): void {
    if (this.solved.has(id)) return;
    this.solved.add(id);
    const sc = this.scenes.get(id);
    if (sc) {
      const info = CRIME_INFO[sc.crime.kind];
      if (byMe) {
        this.cb.reward(
          info.reward,
          t('solved', { icon: info.icon, title: crimeTitle(sc.crime.kind) }),
        );
        this.cb.crimeSolved(id);
      } else {
        this.cb.notify(
          t('friendSolved'),
          t('friendSolvedText', { icon: info.icon, title: crimeTitle(sc.crime.kind) }),
          '🤝',
        );
      }
      if (sc.cat) {
        this.fx.sparkle(sc.cat.position.x, sc.cat.position.y + 0.5, sc.cat.position.z);
        this.scene.remove(sc.cat);
        sc.cat = null;
      }
      this.scene.remove(sc.beacon);
      // Knocked-out thugs stay until the ambulance takes them; the rest walk off as usual.
      for (const pid of sc.people) {
        const p = this.people.find((q) => q.id === pid);
        if (p && p.hp > 0) p.gone = true;
      }
      this.scenes.delete(id);
    }
  }

  get crimes(): Crime[] {
    return [...this.scenes.values()].map((s) => s.crime);
  }

  private updateCrimes(px: number, py: number, pz: number): void {
    const now = this.nowSec();
    const active = activeCrimes(this.city, now, this.roomSeed, this.solved);
    const activeIds = new Set(active.map((c) => c.id));
    for (const c of active) {
      if (this.scenes.has(c.id)) continue;
      const beacon = makeBeacon(c.kind === 'cat' ? 0x5fd3ff : 0xff4a3d);
      beacon.position.set(c.x, c.kind === 'cat' ? c.y : 0, c.z);
      this.scene.add(beacon);
      this.scenes.set(c.id, {
        crime: c,
        spawned: false,
        people: [],
        cat: null,
        beacon,
        announced: false,
      });
    }
    for (const [id, sc] of this.scenes) {
      if (!activeIds.has(id)) {
        this.despawnCrime(sc);
        this.scene.remove(sc.beacon);
        this.scenes.delete(id);
        continue;
      }
      const c = sc.crime;
      updateBeacon(sc.beacon, this.time);
      if (!sc.announced) {
        sc.announced = true;
        const info = CRIME_INFO[c.kind];
        this.cb.notify(`${crimeTitle(c.kind)}!`, crimeHint(c.kind), info.icon);
      }
      const dist = Math.hypot(c.x - px, c.z - pz);
      if (!sc.spawned && dist < 160) this.spawnCrime(sc, px, pz);
      else if (sc.spawned && dist > 260 && c.kind !== 'carThief') this.despawnCrime(sc);
      if (!sc.spawned) continue;

      if (c.kind === 'cat' && sc.cat) {
        animateCat(sc.cat, this.time);
        if (
          Math.hypot(sc.cat.position.x - px, sc.cat.position.y - py, sc.cat.position.z - pz) < 2.2
        ) {
          this.cb.sound('meow');
          this.markSolved(c.id, true);
        }
        continue;
      }
      // Mugger: starts running when the ninja comes close.
      for (const pid of sc.people) {
        const p = this.people.find((q) => q.id === pid);
        if (p && p.runner && p.state === 'idle' && Math.hypot(p.x - px, p.z - pz) < 28)
          setState(p, 'flee');
      }
      const crew = sc.people
        .map((pid) => this.people.find((q) => q.id === pid))
        .filter((p): p is Person => !!p);
      const carStill = this.cars.some((car) => car.thiefCrime === c.id);
      if (crew.length > 0 && !carStill && crew.every((p) => p.hp <= 0)) this.markSolved(c.id, true);
    }
  }

  // --- Main update -------------------------------------------------------------------------

  update(dt: number, player: PlayerBody, night: number, camera: THREE.Camera): void {
    this.time += dt;
    const px = player.pos.x;
    const py = player.pos.y;
    const pz = player.pos.z;
    this.shurikenCooldown = Math.max(0, this.shurikenCooldown - dt);
    this.smokeCooldown = Math.max(0, this.smokeCooldown - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.sinceHurt += dt;
    if (this.sinceHurt > PLAYER.regenDelay)
      this.hp = Math.min(PLAYER.maxHealth, this.hp + PLAYER.regenPerSecond * dt);

    // Slow motion counts real time (dt here is already slowed down).
    this.slowmo = Math.max(0, this.slowmo - dt / this.timeScale);
    this.updateFinisher(dt, player);

    // Attack timing.
    if (this.attack && !this.finisher) {
      const a = this.attack;
      a.t += dt;
      if (a.move === 'diveKick') {
        if (!a.hitDone) {
          for (const p of this.targets()) {
            if (Math.hypot(p.x - px, p.y + 0.8 - py, p.z - pz) < 2) {
              this.landHits(player, 'diveKick');
              a.hitDone = true;
              player.vel.x *= 0.2;
              player.vel.z *= 0.2;
              player.vel.y = 7;
              break;
            }
          }
          if (player.mode === 'ground' && !a.hitDone) {
            this.landHits(player, 'diveKick');
            a.hitDone = true;
          }
        }
      } else if (!a.hitDone && a.t >= a.duration * 0.42) {
        a.hitDone = true;
        this.landHits(player, a.move);
      }
      if (a.t >= a.duration) {
        this.attack = null;
        this.comboTimer = COMBAT.comboWindow;
        if (this.queued) {
          this.queued = false;
          this.startAttack(player, player.yaw);
        }
      }
    }

    this.updateCrimes(px, py, pz);
    this.spawnCivilians(px, pz, night);
    if (this.wanted > 0) this.spawnCops(px, pz);

    // People
    const targetable = !this.driving && player.mode !== 'swim';
    let copsNear = false;
    for (const p of this.people) {
      const d = Math.hypot(p.x - px, p.z - pz);
      const rag = this.ragdolls.get(p.id);
      if (rag) {
        // The rag doll moves the body; the person just follows its middle.
        for (let k = 0, n = Math.ceil(dt * 60); k < n; k++) rag.step(dt / n, this.ragdollWorld);
        const c = rag.centre();
        p.x = c.x;
        p.z = c.z;
        p.y = this.ragdollWorld.floor(c.x, c.y, c.z);
        p.stateTime += dt;
        if (rag.asleep && !this.bled.has(p.id)) {
          // A small stain where they lie.
          this.bled.add(p.id);
          const chest = rag.point('chest');
          this.decals.add(
            chest.x,
            this.ragdollWorld.floor(chest.x, chest.y, chest.z),
            chest.z,
            this.rng.range(0.9, 1.4),
          );
        }
        if (p.crime < 0 && d > PEDS.despawnRadius) p.gone = true;
        continue;
      }
      const ev = stepPerson(p, {
        dt,
        city: this.city,
        rng: this.rng,
        px,
        py,
        pz,
        playerTargetable: targetable,
        wanted: this.wanted,
      });
      if (ev.strike) this.hurtPlayer(p.kind === 'cop' ? 6 : 8, p.x, p.z, player);
      if (p.kind === 'cop' && p.state === 'chase' && Math.hypot(d, p.y - py) < 35) copsNear = true;
      // Knocked-out people wait for the ambulance; far away people are forgotten.
      if (p.crime < 0 && d > PEDS.despawnRadius) p.gone = true;
      if (p.kind === 'cop' && this.wanted === 0 && d > 70) p.gone = true;
      if (p.runner && p.hp > 0 && d > 140) {
        // The thief got away.
        p.gone = true;
        this.cb.notify(t('thiefEscaped'), t('thiefEscapedText'), '💨');
      }
      // Don't walk through the ninja.
      if (!this.driving && d < 0.7 && Math.abs(p.y - py) < 1.5 && p.state !== 'down') {
        const k = (0.7 - d) / Math.max(0.01, d);
        p.x += (p.x - px) * k;
        p.z += (p.z - pz) * k;
      }
    }
    for (const p of this.people) {
      if (p.gone) {
        if (this.views.has(p.id) && !p.quiet) this.fx.puff(p.x, p.y + 0.5, p.z, 10);
        this.releaseView(p.id);
      }
    }
    this.people = this.people.filter((p) => !p.gone);

    // Police stars fade when no officer is close.
    if (this.wanted > 0) {
      this.wantedTimer += copsNear ? dt * 0.25 : dt;
      if (this.wantedTimer > POLICE.starDecay) {
        this.wantedTimer = 0;
        this.wanted--;
        if (this.wanted === 0) this.cb.notify(t('policeGaveUp'), t('policeGaveUpText'), '😮‍💨');
      }
    }

    this.ambulances.update(dt, px, pz);
    this.decals.update(dt);
    this.updateCars(dt, player, night);
    this.updateShurikens(dt);
    this.updateCollectibles(dt, px, py, pz);
    this.renderPeople(dt, camera);
  }

  private updateCars(dt: number, player: PlayerBody, night: number): void {
    const px = player.pos.x;
    const pz = player.pos.z;
    this.spawnTraffic(px, pz);
    const onFoot = !this.driving;
    for (const c of this.cars) {
      const t = c.traffic;
      if (c.stunned > 0) {
        c.stunned -= dt;
        t.speed = Math.max(0, t.speed - 20 * dt);
        if (c.stunned <= 0 && c.thiefCrime === -1) c.stunned = 0;
      } else {
        // What is in front of us?
        const fx = Math.sin(t.yaw);
        const fz = Math.cos(t.yaw);
        let ahead = Infinity;
        const look = (x: number, z: number, width: number) => {
          const dx = x - t.x;
          const dz = z - t.z;
          const along = dx * fx + dz * fz;
          const side = Math.abs(-dx * fz + dz * fx);
          if (along > 0 && along < 30 && side < width) ahead = Math.min(ahead, along);
        };
        for (const o of this.cars) if (o !== c) look(o.traffic.x, o.traffic.z, 1.6);
        for (const p of this.parked) look(p.car.x, p.car.z, 1.8);
        for (const a of this.ambulances.obstacles()) look(a.x, a.z, 2);
        if (this.driving) look(this.driving.car.x, this.driving.car.z, 1.8);
        if (onFoot && player.pos.y < 2) look(px, pz, 1.6);
        for (const p of this.people) if (isOnRoad(p.x, p.z)) look(p.x, p.z, 1.4);
        if (c.thiefCrime >= 0) ahead = Infinity; // the thief doesn't stop for anyone
        stepCar(t, dt, this.rng, ahead);
        if (ahead < 9 && t.speed < 2) {
          c.honk -= dt;
          if (c.honk <= 0) {
            c.honk = this.rng.range(3, 8);
            if (Math.hypot(t.x - px, t.z - pz) < 40)
              this.cb.sound('horn', { x: t.x, y: 1, z: t.z });
          }
        }
        // A speeding car hits a ninja standing on the road.
        if (
          onFoot &&
          t.speed > 8 &&
          Math.hypot(px - (t.x + fx * 1.5), pz - (t.z + fz * 1.5)) < 1.6 &&
          player.pos.y < 1.5
        ) {
          player.vel.x = fx * t.speed * 0.7;
          player.vel.z = fz * t.speed * 0.7;
          player.vel.y = 8;
          player.setMode('air');
          this.hurtPlayer(10, t.x, t.z, player);
          t.speed *= 0.3;
        }
      }
      c.siren = c.model === 'police' && this.wanted >= 2;
    }
    // Remove far away cars (but not a thief's car while its crime is on).
    this.cars = this.cars.filter((c) => {
      const far = Math.hypot(c.traffic.x - px, c.traffic.z - pz) > TRAFFIC.despawnRadius;
      if (far && c.thiefCrime >= 0) {
        // Escaped thief: keep it near by wrapping, the beacon follows it.
        return true;
      }
      if (far && c.view) {
        this.releaseCarView(c.view);
        c.view = null;
      }
      return !far;
    });
    // Views
    for (const c of this.cars) {
      if (!c.view) c.view = this.carView(c.model, c.color);
      c.view.update(
        c.traffic.x,
        0,
        c.traffic.z,
        c.traffic.yaw,
        c.traffic.speed,
        c.traffic.turn ? 0.3 : 0,
        dt,
      );
      if (c.thiefCrime >= 0) {
        const sc = this.scenes.get(c.thiefCrime);
        if (sc) {
          sc.crime.x = c.traffic.x;
          sc.crime.z = c.traffic.z;
          sc.beacon.position.set(c.traffic.x, 0, c.traffic.z);
        }
      }
    }
    for (const p of this.parked) {
      p.car.step(dt, { throttle: 0, steer: 0, handbrake: true });
      p.view.update(p.car.x, p.car.y, p.car.z, p.car.yaw, p.car.forwardSpeed, 0, dt);
    }
    if (this.driving) {
      const d = this.driving;
      d.view.update(d.car.x, d.car.y, d.car.z, d.car.yaw, d.car.forwardSpeed, d.car.steer, dt);
    }
    void night;
  }

  get sirenOn(): boolean {
    return this.cars.some((c) => c.siren) || this.ambulances.active;
  }

  private updateShurikens(dt: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (const s of this.shurikens) {
      s.life -= dt;
      if (!s.stuck) {
        const steps = 4;
        for (let k = 0; k < steps && !s.stuck; k++) {
          s.x += (s.vx * dt) / steps;
          s.y += (s.vy * dt) / steps;
          s.z += (s.vz * dt) / steps;
          s.vy -= (3 * dt) / steps;
          for (const p of this.targets()) {
            if (
              Math.abs(p.x - s.x) < 0.6 &&
              Math.abs(p.z - s.z) < 0.6 &&
              s.y > p.y &&
              s.y < p.y + 1.9
            ) {
              this.damagePerson(p, COMBAT.shurikenDamage, s.vx, s.vz, 3);
              this.cb.sound('punch');
              s.life = 0;
              s.stuck = true;
              break;
            }
          }
          for (const c of this.cars) {
            if (Math.hypot(c.traffic.x - s.x, c.traffic.z - s.z) < 2 && s.y < 1.8) {
              this.hitCar(c, s.x, s.y, s.z);
              s.stuck = true;
              s.life = Math.min(s.life, 0.5);
              break;
            }
          }
          this.city.grid.query(s.x, s.z, s.x, s.z, (b) => {
            if (
              s.y > b.minY &&
              s.y < b.maxY &&
              s.x > b.minX &&
              s.x < b.maxX &&
              s.z > b.minZ &&
              s.z < b.maxZ
            )
              s.stuck = true;
          });
          if (s.y < 0.05) s.stuck = true;
        }
      }
      if (s.life <= 0) continue;
      const spin = s.stuck ? 0 : this.time * 30;
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, spin));
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
      this.shurikenMesh.setMatrixAt(n++, m);
    }
    this.shurikens = this.shurikens.filter((s) => s.life > 0);
    this.shurikenMesh.count = n;
    this.shurikenMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCollectibles(_dt: number, px: number, py: number, pz: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.city.collectibles.forEach((c, i) => {
      if (this.collected.has(i)) {
        m.makeScale(0, 0, 0);
      } else {
        if (Math.hypot(c.x - px, c.y - (py + 1), c.z - pz) < 2) {
          this.collected.add(i);
          this.fx.sparkle(c.x, c.y, c.z);
          this.cb.sound('coin');
          this.cb.reward(
            25,
            t('goldenShuriken', { n: this.collected.size, total: this.city.collectibles.length }),
          );
        }
        q.setFromEuler(new THREE.Euler(0, this.time * 2 + i, 0));
        m.compose(
          new THREE.Vector3(c.x, c.y + Math.sin(this.time * 2 + i) * 0.2, c.z),
          q,
          new THREE.Vector3(1, 1, 1),
        );
      }
      this.collectMesh.setMatrixAt(i, m);
    });
    this.collectMesh.instanceMatrix.needsUpdate = true;
  }

  private renderPeople(dt: number, camera: THREE.Camera): void {
    const cam = camera.position;
    for (const p of this.people) {
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d > 110) {
        this.releaseView(p.id);
        continue;
      }
      const v = this.viewFor(p);
      v.setShadow(d < 45);
      const rag = this.ragdolls.get(p.id);
      if (rag) {
        v.applyRagdoll(rag.pos);
        const head = rag.point('headTop');
        if (rag.asleep) this.fx.dizzy(head.x, head.y + 0.25, head.z, this.time);
        continue;
      }
      v.root.position.set(p.x, p.y, p.z);
      v.root.rotation.y = p.yaw;
      const speed = Math.hypot(p.vx, p.vz);
      let phase = this.phases.get(p.id) ?? p.seed % 7;
      phase += (speed * dt * Math.PI * 2) / (speed > 3 ? 2.4 : 1.3);
      this.phases.set(p.id, phase);
      let mode: AnimMode = speed > 3 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
      let attack: AnimInput['attack'];
      switch (p.state) {
        case 'panic':
          mode = p.kind === 'civ' ? 'panic' : 'run';
          break;
        case 'flee':
          mode = 'run';
          break;
        case 'cower':
          mode = 'cower';
          break;
        case 'windup':
          attack = { move: 'punchR', t: Math.min(0.29, p.stateTime * 0.6) };
          break;
        case 'strike':
          attack = { move: 'punchR', t: 0.3 + Math.min(0.69, p.stateTime * 1.8) };
          break;
        case 'flying':
          mode = 'air';
          break;
        case 'down':
          mode = 'down';
          if (p.hp <= 0) this.fx.dizzy(p.x, p.y + 0.35, p.z, this.time);
          break;
      }
      // Far people: update the pose less often.
      if (d > 50 && (Math.floor(this.time * 30) + p.id) % 2 === 0) continue;
      const r = poseFor({ mode, phase, time: this.time + p.seed, vy: p.vy, attack, ninja: false });
      v.hipsOffset = r.hips;
      v.applyPose(r.pose, r.sharpness, d > 50 ? dt * 2 : dt);
      v.body.rotation.x = THREE.MathUtils.lerp(v.body.rotation.x, r.pitch, 1 - Math.exp(-8 * dt));
      v.body.position.y = mode === 'down' ? 0.12 : 0;
    }
  }

  /** Map data for the HUD. */
  get mapPeople(): { x: number; z: number; kind: PersonKind; hostile: boolean }[] {
    return this.people
      .filter((p) => p.kind !== 'civ' && p.hp > 0)
      .map((p) => ({
        x: p.x,
        z: p.z,
        kind: p.kind,
        hostile: p.hostile || p.runner || (p.kind === 'cop' && this.wanted > 0),
      }));
  }

  get seaLevel(): number {
    return CITY.seaLevel;
  }
}
