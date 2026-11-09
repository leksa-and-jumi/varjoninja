// Friends in the same room: smooth movement between the few updates per second we get.

import * as THREE from 'three';
import { MODES, type NetColors, type NetState } from '../logic/protocol';
import { CarView, CAR_COLORS, CAR_MODELS } from '../render/carView';
import { NinjaView } from '../render/ninjaView';
import type { Mode } from '../logic/player';
import type { AnimInput } from '../render/animator';

const ATTACKS: NonNullable<AnimInput['attack']>['move'][] = [
  'punchR',
  'punchL',
  'kick',
  'throw',
  'diveKick',
];

interface Snapshot {
  t: number;
  s: NetState;
}

interface Remote {
  id: number;
  colors: NetColors;
  view: NinjaView;
  car: CarView | null;
  carKey: string;
  snaps: Snapshot[];
  pos: THREE.Vector3;
  yaw: number;
  attackStart: number;
  lastAttack: number;
}

/** Interpolate this far in the past, so there is usually a newer snapshot to move toward. */
const DELAY = 160;

export class Remotes {
  private players = new Map<number, Remote>();

  constructor(private readonly scene: THREE.Scene) {}

  get count(): number {
    return this.players.size;
  }

  add(id: number, colors: NetColors): void {
    const existing = this.players.get(id);
    if (existing) {
      existing.colors = colors;
      existing.view.setColors({ suit: colors[0], accent: colors[1], mask: colors[2] });
      return;
    }
    const view = new NinjaView(this.scene, { suit: colors[0], accent: colors[1], mask: colors[2] });
    view.setVisible(false);
    this.players.set(id, {
      id,
      colors,
      view,
      car: null,
      carKey: '',
      snaps: [],
      pos: new THREE.Vector3(),
      yaw: 0,
      attackStart: 0,
      lastAttack: -1,
    });
  }

  remove(id: number): void {
    const r = this.players.get(id);
    if (!r) return;
    r.view.dispose();
    r.car?.dispose();
    this.players.delete(id);
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  state(id: number, s: NetState, now: number): void {
    const r = this.players.get(id);
    if (!r) return;
    r.snaps.push({ t: now, s });
    if (r.snaps.length > 12) r.snaps.shift();
    if (s.attack !== r.lastAttack) {
      r.lastAttack = s.attack;
      r.attackStart = now;
    }
  }

  /** Positions for the map. */
  get positions(): { x: number; z: number; color: string }[] {
    return [...this.players.values()]
      .filter((r) => r.snaps.length)
      .map((r) => ({ x: r.pos.x, z: r.pos.z, color: r.colors[1] }));
  }

  update(now: number, dt: number): void {
    const t = now - DELAY;
    for (const r of this.players.values()) {
      if (r.snaps.length === 0) continue;
      // Find the two snapshots around time t.
      let a = r.snaps[0]!;
      let b = a;
      for (const sn of r.snaps) {
        if (sn.t <= t) a = sn;
        if (sn.t >= t) {
          b = sn;
          break;
        }
        b = sn;
      }
      const s = b.s;
      const target = new THREE.Vector3();
      if (b.t > a.t) {
        const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
        target.set(
          a.s.x + (b.s.x - a.s.x) * k,
          a.s.y + (b.s.y - a.s.y) * k,
          a.s.z + (b.s.z - a.s.z) * k,
        );
      } else {
        // No newer data: keep moving with the last speed for a moment.
        const ahead = Math.min(0.3, (t - b.t) / 1000);
        target.set(b.s.x + b.s.vx * ahead, b.s.y + b.s.vy * ahead, b.s.z + b.s.vz * ahead);
      }
      if (r.pos.lengthSq() === 0 || r.pos.distanceTo(target) > 30) r.pos.copy(target);
      else r.pos.lerp(target, 1 - Math.exp(-20 * dt));
      r.yaw +=
        (((s.yaw - r.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-14 * dt));

      const mode = MODES[s.mode] as Mode;
      const driving = mode === 'drive' && s.car >= 0;
      const key = driving ? `${s.car}:${s.carColor}` : '';
      if (key !== r.carKey) {
        r.car?.dispose();
        r.car = null;
        r.carKey = key;
        if (driving) {
          r.car = new CarView(
            CAR_MODELS[s.car] ?? 'sedan',
            CAR_COLORS[s.carColor] ?? CAR_COLORS[0]!,
          );
          this.scene.add(r.car.root);
        }
      }
      r.view.setVisible(!driving);
      if (r.car) r.car.update(r.pos.x, r.pos.y, r.pos.z, r.yaw, Math.hypot(s.vx, s.vz), 0, dt);
      const attackT = (now - r.attackStart) / 450;
      r.view.update(
        {
          pos: r.pos.clone(),
          vel: new THREE.Vector3(s.vx, s.vy, s.vz),
          yaw: r.yaw,
          mode,
          anchor: s.ax !== null ? new THREE.Vector3(s.ax, s.ay!, s.az!) : null,
          zipTarget: null,
          sprint: Math.hypot(s.vx, s.vz) > 13,
          sinceDoubleJump: 99,
          attack:
            s.attack >= 0 && attackT < 1
              ? { move: ATTACKS[s.attack] ?? 'punchR', t: attackT }
              : undefined,
          hurt: 0,
        },
        dt,
      );
    }
  }
}

export { ATTACKS };
