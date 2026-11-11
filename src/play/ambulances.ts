// Ambulances: a while after someone is knocked out, an ambulance drives over, two paramedics
// carry them to it on a stretcher, and they are taken to the nearest hospital. A little later
// the patient walks out of the hospital, healthy again.
//
// Everything here is local to this player (no network messages).

import * as THREE from 'three';
import { AMBULANCE } from '../config';
import type { City, Hospital } from '../logic/city';
import type { Person, PersonKind } from '../logic/people';
import { Rng } from '../logic/rng';
import { crossingAround, curbPointNear, routeBetween, type Point } from '../logic/route';
import { dampAngle } from '../logic/geom';
import { poseFor, type AnimMode } from '../render/animator';
import { CarView } from '../render/carView';
import { CharacterView, civilianLook, REGION, type Look } from '../render/characters';

/** Someone in the ambulance or in hospital. */
interface Patient {
  kind: PersonKind;
  seed: number;
}

interface Medic {
  view: CharacterView;
  x: number;
  z: number;
  y: number;
  yaw: number;
  phase: number;
  mode: AnimMode;
}

type Phase = 'toScene' | 'fetch' | 'kneel' | 'carry' | 'load' | 'toHospital' | 'unload' | 'leave';

interface Ambulance {
  view: CarView;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  route: Point[];
  phase: Phase;
  timer: number;
  hospital: Hospital;
  /** People still waiting at the scene, and the one being picked up now. */
  waiting: Person[];
  current: Person | null;
  carried: CharacterView | null;
  stretcher: THREE.Mesh;
  medics: Medic[];
  aboard: Patient[];
  parkX: number;
  parkZ: number;
}

export interface AmbulanceHooks {
  /** Knocked-out people who are waiting for help (lying down, not yet taken). */
  waitingPeople(): Person[];
  /** Take a person out of the world (they are now on the stretcher). */
  takePerson(p: Person): void;
  /** A healed patient walks out of the hospital door. */
  release(patient: Patient, x: number, z: number, hospital: Hospital): void;
  lookOf(kind: PersonKind, seed: number): Look;
  sparkle(x: number, y: number, z: number): void;
}

function medicLook(seed: number): Look {
  const look = civilianLook(seed);
  look.palette[REGION.top] = new THREE.Color(0xf4f4f2);
  look.palette[REGION.forearm] = new THREE.Color(0xf4f4f2);
  look.palette[REGION.bottom] = new THREE.Color(0x1f5a3a);
  look.palette[REGION.belt] = new THREE.Color(0x1a1a1a);
  look.palette[REGION.shoes] = new THREE.Color(0x111111);
  look.accessories = ['hairShort', 'belt'];
  return look;
}

export class Ambulances {
  private list: Ambulance[] = [];
  private hospitalQueue: { patient: Patient; at: number; hospital: Hospital }[] = [];
  private assigned = new Set<number>();
  private rng = new Rng(7331);
  private time = 0;
  private stretcherGeo = new THREE.BoxGeometry(0.62, 0.1, 2.0);
  private stretcherMat = new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.6 });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly city: City,
    private readonly hooks: AmbulanceHooks,
  ) {}

  get active(): boolean {
    return this.list.length > 0;
  }

  /** Positions for traffic to keep away from. */
  obstacles(): Point[] {
    return this.list.map((a) => ({ x: a.x, z: a.z }));
  }

  private nearestHospital(x: number, z: number): Hospital {
    return [...this.city.hospitals].sort(
      (a, b) => Math.hypot(a.stopX - x, a.stopZ - z) - Math.hypot(b.stopX - x, b.stopZ - z),
    )[0]!;
  }

  update(dt: number, px: number, pz: number): void {
    this.time += dt;
    this.dispatch(px, pz);
    for (const a of this.list) this.step(a, dt);
    this.list = this.list.filter((a) => {
      const done = a.phase === 'leave' && a.timer > 6;
      if (done) this.remove(a);
      return !done;
    });
    // Healed patients walk out.
    this.hospitalQueue = this.hospitalQueue.filter((q) => {
      if (this.time < q.at) return true;
      const h = q.hospital;
      if (Math.hypot(h.doorX - px, h.doorZ - pz) < AMBULANCE.releaseRadius) {
        this.hooks.release(q.patient, h.doorX + this.rng.range(-1.5, 1.5), h.doorZ, h);
        this.hooks.sparkle(h.doorX, 1.2, h.doorZ);
      }
      return false;
    });
  }

  private dispatch(px: number, pz: number): void {
    if (this.list.length >= AMBULANCE.max) return;
    const waiting = this.hooks.waitingPeople().filter((p) => !this.assigned.has(p.id));
    const due = waiting.find(
      (p) =>
        (p.rescueAt ?? Infinity) <= this.time &&
        Math.hypot(p.x - px, p.z - pz) < AMBULANCE.serviceRadius,
    );
    if (!due) return;
    // Pick up everyone lying close to each other on the same trip.
    const group = waiting.filter((p) => Math.hypot(p.x - due.x, p.z - due.z) < 18).slice(0, 4);
    for (const p of group) this.assigned.add(p.id);
    const park = curbPointNear(due.x, due.z);
    const start = crossingAround(
      due.x,
      due.z,
      AMBULANCE.spawnDistance,
      this.rng.range(0, Math.PI * 2),
    );
    const route = routeBetween(start, park);
    const view = new CarView('ambulance', '#d62828');
    this.scene.add(view.root);
    const stretcher = new THREE.Mesh(this.stretcherGeo, this.stretcherMat);
    stretcher.visible = false;
    stretcher.castShadow = true;
    this.scene.add(stretcher);
    const first = route[0]!;
    const next = route[1] ?? park;
    this.list.push({
      view,
      x: first.x,
      z: first.z,
      yaw: Math.atan2(next.x - first.x, next.z - first.z),
      speed: 0,
      route: route.slice(1),
      phase: 'toScene',
      timer: 0,
      hospital: this.nearestHospital(due.x, due.z),
      waiting: group,
      current: null,
      carried: null,
      stretcher,
      medics: [],
      aboard: [],
      parkX: park.x,
      parkZ: park.z,
    });
  }

  /** Drive along the route. Returns true when the last point is reached. */
  private drive(a: Ambulance, dt: number): boolean {
    const target = a.route[0];
    if (!target) {
      a.speed = Math.max(0, a.speed - 20 * dt);
      return true;
    }
    const dx = target.x - a.x;
    const dz = target.z - a.z;
    const d = Math.hypot(dx, dz);
    const last = a.route.length === 1;
    // Slow down for corners and for the final stop.
    const wanted = last
      ? Math.min(AMBULANCE.speed, d * 1.2 + 1)
      : Math.min(AMBULANCE.speed, 6 + d * 0.8);
    a.speed += Math.max(-25 * dt, Math.min(8 * dt, wanted - a.speed));
    const step = Math.min(d, a.speed * dt);
    if (d > 0.01) {
      a.x += (dx / d) * step;
      a.z += (dz / d) * step;
      a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 6, dt);
    }
    if (d < 0.6) a.route.shift();
    return false;
  }

  private rear(a: Ambulance, back = 3.6): Point {
    return { x: a.x - Math.sin(a.yaw) * back, z: a.z - Math.cos(a.yaw) * back };
  }

  private spawnMedics(a: Ambulance): void {
    const r = this.rear(a);
    a.medics = [0, 1].map((k) => {
      const view = new CharacterView(medicLook(this.rng.int(1, 1e9)));
      this.scene.add(view.root);
      return {
        view,
        x: r.x + (k ? 0.5 : -0.5),
        z: r.z,
        y: 0.05,
        yaw: a.yaw + Math.PI,
        phase: 0,
        mode: 'idle' as AnimMode,
      };
    });
  }

  /** Walk a medic toward a point. Returns true when there. */
  private walk(
    m: Medic,
    tx: number,
    tz: number,
    dt: number,
    speed: number = AMBULANCE.medicSpeed,
  ): boolean {
    const dx = tx - m.x;
    const dz = tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) return true;
    const s = Math.min(d, speed * dt);
    m.x += (dx / d) * s;
    m.z += (dz / d) * s;
    m.yaw = dampAngle(m.yaw, Math.atan2(dx, dz), 8, dt);
    m.phase += (s * Math.PI * 2) / 1.4;
    return false;
  }

  private step(a: Ambulance, dt: number): void {
    a.timer += dt;
    switch (a.phase) {
      case 'toScene':
        if (this.drive(a, dt) && a.speed < 0.2) {
          a.phase = 'fetch';
          a.timer = 0;
          this.spawnMedics(a);
        }
        break;
      case 'fetch': {
        if (!a.current) {
          // Next patient (someone may have been taken away meanwhile).
          a.waiting = a.waiting.filter((p) => !p.gone);
          a.current = a.waiting.shift() ?? null;
          if (!a.current) {
            this.startToHospital(a);
            break;
          }
        }
        const p = a.current;
        const [m1, m2] = a.medics;
        const there1 = this.walk(m1!, p.x + 0.7, p.z, dt);
        const there2 = this.walk(m2!, p.x - 0.7, p.z, dt);
        m1!.mode = there1 ? 'kneel' : 'walk';
        m2!.mode = there2 ? 'kneel' : 'walk';
        if (there1 && there2) {
          m1!.yaw = Math.atan2(p.x - m1!.x, p.z - m1!.z);
          m2!.yaw = Math.atan2(p.x - m2!.x, p.z - m2!.z);
          a.phase = 'kneel';
          a.timer = 0;
        }
        break;
      }
      case 'kneel':
        if (a.timer > AMBULANCE.kneelTime) {
          const p = a.current!;
          // Onto the stretcher.
          a.carried = new CharacterView(this.hooks.lookOf(p.kind, p.seed));
          this.scene.add(a.carried.root);
          a.aboard.push({ kind: p.kind, seed: p.seed });
          this.hooks.takePerson(p);
          a.stretcher.visible = true;
          a.phase = 'carry';
          a.timer = 0;
        }
        break;
      case 'carry': {
        const r = this.rear(a, 4.2);
        const [lead, back] = a.medics;
        lead!.mode = 'carry';
        back!.mode = 'carry';
        const there = this.walk(lead!, r.x, r.z, dt, AMBULANCE.medicSpeed * 0.8);
        // The second medic holds the other end of the stretcher.
        const ly = lead!.yaw;
        back!.x = lead!.x - Math.sin(ly) * 2.3;
        back!.z = lead!.z - Math.cos(ly) * 2.3;
        back!.yaw = ly;
        back!.phase = lead!.phase + Math.PI;
        if (there) {
          a.phase = 'load';
          a.timer = 0;
        }
        break;
      }
      case 'load':
        if (a.timer > 0.8) {
          a.carried?.dispose();
          a.carried = null;
          a.stretcher.visible = false;
          a.current = null;
          a.phase = 'fetch';
        }
        break;
      case 'toHospital':
        if (this.drive(a, dt) && a.speed < 0.2) {
          a.phase = 'unload';
          a.timer = 0;
        }
        break;
      case 'unload':
        if (a.timer > 1.5) {
          for (const patient of a.aboard) {
            this.hospitalQueue.push({
              patient,
              at: this.time + AMBULANCE.hospitalTime,
              hospital: a.hospital,
            });
          }
          a.aboard = [];
          a.phase = 'leave';
          a.timer = 0;
          // Drive on down the street.
          a.route = [{ x: a.x + Math.sin(a.yaw) * 80, z: a.z + Math.cos(a.yaw) * 80 }];
        }
        break;
      case 'leave':
        this.drive(a, dt);
        break;
    }
    this.render(a, dt);
  }

  private startToHospital(a: Ambulance): void {
    for (const m of a.medics) m.view.dispose();
    a.medics = [];
    const h = a.hospital;
    const from = curbPointNear(a.x, a.z, 0);
    const to = { x: h.stopX, z: h.stopZ, axis: 'x' as const };
    a.route = routeBetween(from, to).slice(1);
    a.phase = 'toHospital';
    a.timer = 0;
  }

  private render(a: Ambulance, dt: number): void {
    a.view.update(a.x, 0, a.z, a.yaw, a.speed, 0, dt);
    for (const m of a.medics) {
      m.view.root.position.set(m.x, CITY_FLOOR, m.z);
      m.view.root.rotation.y = m.yaw;
      const r = poseFor({ mode: m.mode, phase: m.phase, time: this.time, vy: 0, ninja: false });
      m.view.hipsOffset = r.hips;
      m.view.applyPose(r.pose, r.sharpness, dt);
    }
    if (a.stretcher.visible && a.medics.length === 2) {
      const [lead, back] = a.medics;
      const mx = (lead!.x + back!.x) / 2;
      const mz = (lead!.z + back!.z) / 2;
      a.stretcher.position.set(mx, 0.85, mz);
      a.stretcher.rotation.y = lead!.yaw;
      if (a.carried) {
        // Lying on the stretcher, feet first.
        const c = a.carried;
        c.root.position.set(mx - Math.sin(lead!.yaw) * 0.9, 0.95, mz - Math.cos(lead!.yaw) * 0.9);
        c.root.rotation.y = lead!.yaw + Math.PI;
        const r = poseFor({ mode: 'down', phase: 0, time: this.time, vy: 0, ninja: false });
        c.applyPose(r.pose, 10, dt);
        c.body.rotation.x = -Math.PI / 2;
      }
    } else if (a.carried && a.current) {
      a.carried.root.visible = false;
    }
  }

  private remove(a: Ambulance): void {
    a.view.dispose();
    for (const m of a.medics) m.view.dispose();
    a.carried?.dispose();
    this.scene.remove(a.stretcher);
  }
}

/** Sidewalk height (medics walk on the sidewalk and street; close enough). */
const CITY_FLOOR = 0.1;
