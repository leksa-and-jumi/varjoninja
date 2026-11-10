// Poses in code: running, swinging, climbing, punching… Each frame the game asks for a pose
// and the character blends toward it.

import * as THREE from 'three';
import { ARM_REST, rot, type Pose } from './characters';

export type AnimMode =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'air'
  | 'swing'
  | 'zip'
  | 'wall'
  | 'swim'
  | 'sit'
  | 'carry'
  | 'kneel'
  | 'down'
  | 'panic'
  | 'cower';

/** Hits, throws and the three finishing moves. */
export type AttackMove =
  'punchR' | 'punchL' | 'kick' | 'throw' | 'diveKick' | 'tornado' | 'dash' | 'uppercut';

export interface AnimInput {
  mode: AnimMode;
  /** Gait phase in radians (advance with distance travelled). */
  phase: number;
  time: number;
  vy: number;
  /** Direction from the shoulder toward the rope anchor, in character space. */
  ropeDir?: THREE.Vector3;
  /** Direction to the zip target, in character space. */
  zipDir?: THREE.Vector3;
  /** 0..1 progress of a front flip (double jump). */
  flip?: number;
  /** Current attack: which move and 0..1 progress. */
  attack?: { move: AttackMove; t: number };
  /** 0..1, flinch after being hit. */
  hurt?: number;
  /** Ninja style (arms back when sprinting) versus normal people. */
  ninja: boolean;
}

export interface PoseResult {
  pose: Pose;
  hips: number;
  /** Whole-body rotation around the facing direction (pitch forward, roll sideways). */
  pitch: number;
  roll: number;
  sharpness: number;
}

const tmpQ = new THREE.Quaternion();

/** Rotation that turns the upper arm from its rest direction to point along `dir`. */
function aimArm(side: 'L' | 'R', dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(ARM_REST[side], tmpV.copy(dir).normalize());
}
const tmpV = new THREE.Vector3();
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function gait(
  pose: Pose,
  phase: number,
  amount: number,
  knee: number,
  arms: number,
  armDown: number,
): number {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  pose['thigh.L'] = rot(-s * amount - 0.1 * amount);
  pose['thigh.R'] = rot(s * amount - 0.1 * amount);
  pose['shin.L'] = rot(0.15 + knee * Math.max(0, c));
  pose['shin.R'] = rot(0.15 + knee * Math.max(0, -c));
  pose['foot.L'] = rot(-0.2 * s * amount);
  pose['foot.R'] = rot(0.2 * s * amount);
  pose['upperArm.L'] = rot(s * arms, 0, -armDown);
  pose['upperArm.R'] = rot(-s * arms, 0, armDown);
  pose['forearm.L'] = rot(-0.5 - arms * 0.6);
  pose['forearm.R'] = rot(-0.5 - arms * 0.6);
  return -Math.abs(c) * 0.06 * amount;
}

export function poseFor(a: AnimInput): PoseResult {
  const pose: Pose = {};
  let hips = 0;
  let pitch = 0;
  const roll = 0;
  let sharpness = 14;
  const breathe = Math.sin(a.time * 2.2);

  switch (a.mode) {
    case 'idle': {
      pose.chest = rot(0.03 * breathe);
      pose['upperArm.L'] = rot(0.05, 0, -0.5);
      pose['upperArm.R'] = rot(0.05, 0, 0.5);
      pose['forearm.L'] = rot(-0.35);
      pose['forearm.R'] = rot(-0.35);
      if (a.ninja) {
        // Ready stance: knees bent, fists up a little.
        pose['thigh.L'] = rot(-0.35, 0, 0.12);
        pose['thigh.R'] = rot(-0.1, 0, -0.12);
        pose['shin.L'] = rot(0.55);
        pose['shin.R'] = rot(0.35);
        pose['upperArm.L'] = rot(-0.35, 0, -0.45);
        pose['upperArm.R'] = rot(-0.15, 0, 0.45);
        pose['forearm.L'] = rot(-1.5);
        pose['forearm.R'] = rot(-1.3);
        pose.spine = rot(0.08, 0.15);
        hips = -0.07 + 0.01 * breathe;
      }
      sharpness = 8;
      break;
    }
    case 'walk':
      hips = gait(pose, a.phase, 0.45, 0.7, 0.35, 0.5);
      pose.spine = rot(0.04);
      sharpness = 10;
      break;
    case 'run':
      hips = gait(pose, a.phase, 0.85, 1.5, 0.75, 0.6);
      pose.spine = rot(0.18);
      pose.head = rot(-0.1);
      break;
    case 'sprint':
      hips = gait(pose, a.phase, 1.05, 1.9, 0.6, 0.6);
      pose.spine = rot(0.42);
      pose.head = rot(-0.35);
      if (a.ninja) {
        // Arms swept back.
        pose['upperArm.L'] = rot(1.25, 0, -0.35);
        pose['upperArm.R'] = rot(1.25, 0, 0.35);
        pose['forearm.L'] = rot(0.1);
        pose['forearm.R'] = rot(0.1);
      }
      break;
    case 'panic':
      hips = gait(pose, a.phase, 0.9, 1.4, 0, 0);
      pose['upperArm.L'] = aimArm('L', v(0.5, 1, 0.15 + 0.3 * Math.sin(a.time * 14)));
      pose['upperArm.R'] = aimArm('R', v(-0.5, 1, 0.15 + 0.3 * Math.cos(a.time * 13)));
      pose['forearm.L'] = rot(-0.4);
      pose['forearm.R'] = rot(-0.4);
      pose.spine = rot(0.1);
      break;
    case 'cower':
      pose.spine = rot(0.55);
      pose.neck = rot(0.3);
      pose['thigh.L'] = rot(-1.2, 0, 0.2);
      pose['thigh.R'] = rot(-1.2, 0, -0.2);
      pose['shin.L'] = rot(2.2);
      pose['shin.R'] = rot(2.2);
      pose['upperArm.L'] = aimArm('L', v(0.1, 0.9, 0.6));
      pose['upperArm.R'] = aimArm('R', v(-0.1, 0.9, 0.6));
      pose['forearm.L'] = rot(-2);
      pose['forearm.R'] = rot(-2);
      hips = -0.5;
      sharpness = 8;
      break;
    case 'air': {
      if (a.vy > 1) {
        pose['thigh.L'] = rot(-1.2);
        pose['shin.L'] = rot(1.8);
        pose['thigh.R'] = rot(-0.35);
        pose['shin.R'] = rot(1.1);
        pose['upperArm.L'] = rot(-0.6, 0, 0.5);
        pose['upperArm.R'] = rot(0.5, 0, -0.1);
        pose['forearm.L'] = rot(-0.8);
        pose.spine = rot(0.1);
      } else {
        // Falling: arms out, legs ready to land.
        const flail = Math.sin(a.time * 9) * 0.15;
        pose['thigh.L'] = rot(-0.5 + flail);
        pose['shin.L'] = rot(0.9);
        pose['thigh.R'] = rot(-0.2 - flail);
        pose['shin.R'] = rot(0.6);
        pose['upperArm.L'] = rot(0, 0, 1.1 + flail);
        pose['upperArm.R'] = rot(0, 0, -1.1 + flail);
        pose['forearm.L'] = rot(-0.3);
        pose['forearm.R'] = rot(-0.3);
        pose.spine = rot(-0.1);
      }
      if (a.flip !== undefined && a.flip < 1) {
        // Tucked front flip.
        pitch = a.flip * Math.PI * 2;
        pose['thigh.L'] = rot(-1.9);
        pose['thigh.R'] = rot(-1.9);
        pose['shin.L'] = rot(2.3);
        pose['shin.R'] = rot(2.3);
        pose.spine = rot(0.5);
        hips = 0.35;
        sharpness = 25;
      }
      break;
    }
    case 'swing': {
      const dir = a.ropeDir ?? v(0, 1, 0);
      pose['upperArm.R'] = aimArm('R', dir);
      pose['forearm.R'] = rot(0);
      pose['upperArm.L'] = rot(-0.4, 0, 0.9);
      pose['forearm.L'] = rot(-0.9);
      pose['thigh.L'] = rot(-0.65);
      pose['shin.L'] = rot(1.1);
      pose['thigh.R'] = rot(-0.15);
      pose['shin.R'] = rot(0.5);
      pose.spine = rot(0.05);
      sharpness = 18;
      break;
    }
    case 'zip': {
      const dir = a.zipDir ?? v(0, 0.3, 1);
      pose['upperArm.R'] = aimArm('R', dir);
      pose['upperArm.L'] = aimArm('L', dir.clone().add(v(0.2, 0, 0)));
      pose['forearm.L'] = rot(0);
      pose['forearm.R'] = rot(0);
      pose['thigh.L'] = rot(0.2);
      pose['thigh.R'] = rot(0.35);
      pose['shin.L'] = rot(0.3);
      pose['shin.R'] = rot(0.6);
      sharpness = 20;
      break;
    }
    case 'wall': {
      const s = Math.sin(a.phase);
      pose['upperArm.L'] = aimArm('L', v(0.35, 0.6 + 0.6 * s, 0.35));
      pose['upperArm.R'] = aimArm('R', v(-0.35, 0.6 - 0.6 * s, 0.35));
      pose['forearm.L'] = rot(-0.5 - 0.5 * Math.max(0, -s));
      pose['forearm.R'] = rot(-0.5 - 0.5 * Math.max(0, s));
      pose['thigh.L'] = rot(-0.4 - 0.8 * Math.max(0, -s), 0, 0.15);
      pose['thigh.R'] = rot(-0.4 - 0.8 * Math.max(0, s), 0, -0.15);
      pose['shin.L'] = rot(0.6 + 1.0 * Math.max(0, -s));
      pose['shin.R'] = rot(0.6 + 1.0 * Math.max(0, s));
      pose.head = rot(-0.4);
      sharpness = 16;
      break;
    }
    case 'swim': {
      pitch = 1.35;
      const p = a.phase;
      pose['upperArm.L'] = rot(-p % (Math.PI * 2), 0, -0.3);
      pose['upperArm.R'] = rot(-(p + Math.PI) % (Math.PI * 2), 0, 0.3);
      pose['thigh.L'] = rot(Math.sin(p * 2) * 0.3);
      pose['thigh.R'] = rot(-Math.sin(p * 2) * 0.3);
      pose.head = rot(-0.9);
      sharpness = 10;
      break;
    }
    case 'carry': {
      // Walking with both hands holding a stretcher in front.
      hips = gait(pose, a.phase, 0.4, 0.7, 0, 0);
      pose['upperArm.L'] = aimArm('L', v(0.15, -0.6, 0.7));
      pose['upperArm.R'] = aimArm('R', v(-0.15, -0.6, 0.7));
      pose['forearm.L'] = rot(-0.5);
      pose['forearm.R'] = rot(-0.5);
      pose.spine = rot(0.08);
      sharpness = 10;
      break;
    }
    case 'kneel':
      // Kneeling down to help someone.
      pose['thigh.L'] = rot(-1.5, 0, 0.1);
      pose['shin.L'] = rot(1.6);
      pose['thigh.R'] = rot(-0.2, 0, -0.1);
      pose['shin.R'] = rot(2.2);
      pose.spine = rot(0.5);
      pose['upperArm.L'] = aimArm('L', v(0.1, -0.8, 0.6));
      pose['upperArm.R'] = aimArm('R', v(-0.1, -0.8, 0.6));
      hips = -0.55;
      sharpness = 7;
      break;
    case 'sit':
      pose['thigh.L'] = rot(-1.45, 0, 0.08);
      pose['thigh.R'] = rot(-1.45, 0, -0.08);
      pose['shin.L'] = rot(1.4);
      pose['shin.R'] = rot(1.4);
      pose['upperArm.L'] = aimArm('L', v(0.25, -0.2, 1));
      pose['upperArm.R'] = aimArm('R', v(-0.25, -0.2, 1));
      hips = -0.42;
      break;
    case 'down':
      // Lying on the back, seeing stars.
      pitch = -Math.PI / 2;
      pose['upperArm.L'] = rot(0, 0, 1.3);
      pose['upperArm.R'] = rot(0, 0, -1.3);
      pose['thigh.L'] = rot(-0.2, 0, 0.25);
      pose['thigh.R'] = rot(-0.4, 0, -0.2);
      pose['shin.L'] = rot(0.4);
      pose['shin.R'] = rot(0.8);
      pose.head = rot(0, 0.5 * Math.sin(a.time * 1.5));
      sharpness = 7;
      break;
  }

  if (a.attack) applyAttack(pose, a.attack.move, a.attack.t);
  if (a.hurt && a.hurt > 0) {
    pose.spine = (pose.spine ?? new THREE.Quaternion())
      .clone()
      .multiply(tmpQ.copy(rot(-0.5 * a.hurt)));
    pose.head = rot(-0.4 * a.hurt);
  }
  return { pose, hips, pitch, roll, sharpness };
}

function applyAttack(pose: Pose, move: NonNullable<AnimInput['attack']>['move'], t: number): void {
  // Wind up (t < 0.3), strike (0.3..0.6), recover.
  const strike = t < 0.3 ? -t / 0.3 : t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  const s = Math.max(0, strike);
  const w = Math.max(0, -strike);
  switch (move) {
    case 'punchR':
      pose.chest = rot(0, -0.6 * s + 0.4 * w);
      pose['upperArm.R'] = s > 0 ? aimArm('R', v(-0.08, 0.15, 1)) : rot(0.6, 0, 0.3);
      pose['forearm.R'] = rot(s > 0 ? 0 : -1.8);
      pose['upperArm.L'] = rot(-0.6, 0, -0.4);
      pose['forearm.L'] = rot(-1.8);
      break;
    case 'punchL':
      pose.chest = rot(0, 0.6 * s - 0.4 * w);
      pose['upperArm.L'] = s > 0 ? aimArm('L', v(0.08, 0.15, 1)) : rot(0.6, 0, -0.3);
      pose['forearm.L'] = rot(s > 0 ? 0 : -1.8);
      pose['upperArm.R'] = rot(-0.6, 0, 0.4);
      pose['forearm.R'] = rot(-1.8);
      break;
    case 'kick':
      pose['thigh.R'] = rot(-1.7 * s + 0.3 * w, 0, -0.2 * s);
      pose['shin.R'] = rot(s > 0 ? 0.05 : 1.6);
      pose['thigh.L'] = rot(-0.2);
      pose['shin.L'] = rot(0.4);
      pose.spine = rot(-0.35 * s, 0.3 * s);
      pose['upperArm.L'] = rot(-0.4, 0, 1.0);
      pose['upperArm.R'] = rot(0.3, 0, -1.0);
      break;
    case 'diveKick':
      pose['thigh.R'] = rot(-1.2);
      pose['shin.R'] = rot(0);
      pose['thigh.L'] = rot(-0.6);
      pose['shin.L'] = rot(1.6);
      pose['upperArm.L'] = rot(0, 0, 1.2);
      pose['upperArm.R'] = rot(0, 0, -1.2);
      pose.spine = rot(-0.3);
      break;
    case 'throw':
      pose['upperArm.R'] = s > 0 ? aimArm('R', v(-0.1, 0.25, 1)) : aimArm('R', v(-0.6, 0.6, -0.4));
      pose['forearm.R'] = rot(s > 0 ? 0 : -1.2);
      pose.chest = rot(0, -0.4 * s + 0.5 * w);
      break;
    case 'tornado':
      // Spinning kick: one leg straight out to the side, arms wide (the spin is added by NinjaView).
      pose['thigh.R'] = rot(-0.3, 0, -1.45);
      pose['shin.R'] = rot(0.05);
      pose['thigh.L'] = rot(-1.1);
      pose['shin.L'] = rot(1.7);
      pose['upperArm.L'] = rot(0, 0, 1.3);
      pose['upperArm.R'] = rot(0, 0, -1.3);
      pose.spine = rot(0, 0, 0.35);
      break;
    case 'dash':
      if (t < 0.2) {
        // Crouch, ready to spring.
        pose['thigh.L'] = rot(-1.1);
        pose['thigh.R'] = rot(-0.6);
        pose['shin.L'] = rot(1.7);
        pose['shin.R'] = rot(1.6);
        pose['upperArm.L'] = rot(1.2, 0, -0.3);
        pose['upperArm.R'] = rot(1.2, 0, 0.3);
        pose.spine = rot(0.7);
      } else {
        // Lunge and slash.
        pose['thigh.L'] = rot(-1.2);
        pose['shin.L'] = rot(0.8);
        pose['thigh.R'] = rot(0.7);
        pose['shin.R'] = rot(0.4);
        pose['upperArm.R'] = aimArm('R', v(-0.15, 0.05, 1));
        pose['forearm.R'] = rot(0);
        pose['upperArm.L'] = rot(1.1, 0, -0.4);
        pose.spine = rot(0.55);
        pose.head = rot(-0.4);
      }
      break;
    case 'uppercut':
      if (t < 0.22) {
        pose['thigh.L'] = rot(-1.1);
        pose['thigh.R'] = rot(-1.1);
        pose['shin.L'] = rot(1.9);
        pose['shin.R'] = rot(1.9);
        pose['upperArm.R'] = rot(0.8, 0, 0.2);
        pose['forearm.R'] = rot(-1.6);
        pose.spine = rot(0.5);
      } else {
        // Fist to the sky, one knee up.
        pose['upperArm.R'] = aimArm('R', v(-0.12, 1, 0.25));
        pose['forearm.R'] = rot(0);
        pose['upperArm.L'] = rot(0.4, 0, 0.6);
        pose['thigh.L'] = rot(-1.5);
        pose['shin.L'] = rot(1.7);
        pose['thigh.R'] = rot(0.15);
        pose.spine = rot(-0.2);
        pose.head = rot(-0.3);
      }
      break;
  }
}
