import { describe, expect, it } from 'vitest';
import { JOINTS, Ragdoll, type RagdollWorld } from './ragdoll';
import { Rng } from './rng';

/** A standing person, roughly: joints stacked like the character model. */
function standing(): { x: number; y: number; z: number }[] {
  const at: Record<string, [number, number, number]> = {
    pelvis: [0, 0.98, 0],
    chest: [0, 1.33, 0],
    neck: [0, 1.52, 0],
    headTop: [0, 1.82, 0],
    shoulderL: [0.2, 1.43, 0],
    elbowL: [0.37, 1.2, 0],
    wristL: [0.52, 1.0, 0],
    handL: [0.57, 0.92, 0],
    shoulderR: [-0.2, 1.43, 0],
    elbowR: [-0.37, 1.2, 0],
    wristR: [-0.52, 1.0, 0],
    handR: [-0.57, 0.92, 0],
    hipL: [0.1, 0.94, 0],
    kneeL: [0.1, 0.52, 0.01],
    ankleL: [0.11, 0.1, -0.02],
    toeL: [0.11, 0.03, 0.14],
    hipR: [-0.1, 0.94, 0],
    kneeR: [-0.1, 0.52, 0.01],
    ankleR: [-0.11, 0.1, -0.02],
    toeR: [-0.11, 0.03, 0.14],
  };
  return JOINTS.map((j) => {
    const [x, y, z] = at[j]!;
    return { x, y, z };
  });
}

const flat: RagdollWorld = { floor: () => 0, pushOut: () => {} };

describe('ragdoll', () => {
  it('falls down and lies on the floor', () => {
    const r = new Ragdoll(standing());
    r.push({ x: 8, y: 4, z: 0 }, 2, () => 0.5);
    for (let i = 0; i < 60 * 4; i++) r.step(1 / 60, flat);
    for (const p of r.pos) expect(p.y).toBeGreaterThanOrEqual(0);
    expect(r.point('headTop').y).toBeLessThan(0.6);
    expect(r.point('pelvis').x).toBeGreaterThan(0.5);
  });

  it('keeps arms and legs attached', () => {
    const r = new Ragdoll(standing());
    const rng = new Rng(3);
    r.push({ x: 0, y: 12, z: -10 }, 6, () => rng.next());
    for (let i = 0; i < 60 * 3; i++) r.step(1 / 60, flat);
    const d = (a: (typeof JOINTS)[number], b: (typeof JOINTS)[number]) => {
      const p = r.point(a);
      const q = r.point(b);
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    };
    expect(d('kneeL', 'ankleL')).toBeCloseTo(0.42, 1);
    expect(d('shoulderR', 'elbowR')).toBeCloseTo(0.29, 1);
  });

  it('falls differently with a different random twist', () => {
    const a = new Ragdoll(standing());
    const b = new Ragdoll(standing());
    const ra = new Rng(1);
    const rb = new Rng(2);
    a.push({ x: 6, y: 5, z: 0 }, 6, () => ra.next());
    b.push({ x: 6, y: 5, z: 0 }, 6, () => rb.next());
    for (let i = 0; i < 120; i++) {
      a.step(1 / 60, flat);
      b.step(1 / 60, flat);
    }
    expect(Math.abs(a.point('headTop').z - b.point('headTop').z)).toBeGreaterThan(0.02);
  });

  it('goes to sleep when still', () => {
    const r = new Ragdoll(standing());
    r.push({ x: 2, y: 0, z: 0 }, 0, () => 0.5);
    for (let i = 0; i < 60 * 8; i++) r.step(1 / 60, flat);
    expect(r.asleep).toBe(true);
  });
});
