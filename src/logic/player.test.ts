import { describe, expect, it } from 'vitest';
import { CITY, PLAYER } from '../config';
import { generateCity, roadLine } from './city';
import { emptyInput, PlayerBody, type PlayerInput } from './player';

const city = generateCity();
const DT = 1 / 120;

function run(p: PlayerBody, seconds: number, input: Partial<PlayerInput> = {}): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    p.step(DT, {
      ...emptyInput(),
      ...input,
      jumpPressed: i === 0 && !!input.jumpPressed,
      zipPressed: i === 0 && !!input.zipPressed,
    });
  }
}

/** A spot in the middle of a road, far from buildings. */
const street = { x: roadLine(4), y: 0, z: roadLine(4) + 40 };

describe('ninja body', () => {
  it('falls and lands on the street', () => {
    const p = new PlayerBody(city);
    p.teleport({ ...street, y: 10 });
    run(p, 2);
    expect(p.mode).toBe('ground');
    expect(p.pos.y).toBeCloseTo(0, 3);
  });

  it('runs at sprint speed', () => {
    const p = new PlayerBody(city);
    p.teleport(street);
    run(p, 1.5, { moveZ: 1, sprint: true });
    expect(p.horizontalSpeed).toBeCloseTo(PLAYER.sprintSpeed, 0);
  });

  it('jumps and double jumps higher', () => {
    const p = new PlayerBody(city);
    p.teleport(street);
    run(p, 0.1);
    run(p, 0.3, { jumpPressed: true });
    const afterOne = p.pos.y;
    run(p, 0.01, { jumpPressed: true });
    run(p, 0.3);
    expect(p.pos.y).toBeGreaterThan(afterOne);
    expect(p.airJumps).toBe(0);
  });

  it('climbs a wall when running into it', () => {
    const b = city.buildings.find((x) => x.height > 40 && x.boxes.length === 1)!;
    const box = b.boxes[0]!;
    const z = (box.minZ + box.maxZ) / 2;
    const p = new PlayerBody(city);
    p.teleport({ x: box.minX - 3, y: CITY.sidewalkHeight, z });
    run(p, 1.2, { moveX: 1, sprint: true });
    expect(p.mode).toBe('wall');
    const y = p.pos.y;
    run(p, 0.5, { moveX: 1 });
    expect(p.pos.y).toBeGreaterThan(y + 3);
  });

  it('swings on the rope and keeps the rope length', () => {
    const b = city.buildings.find((x) => x.height > 60 && x.boxes.length === 1)!;
    const box = b.boxes[0]!;
    const p = new PlayerBody(city);
    p.teleport({ x: box.minX - 12, y: 30, z: (box.minZ + box.maxZ) / 2 });
    const aim = {
      aimOrigin: { x: box.minX - 12, y: 31, z: (box.minZ + box.maxZ) / 2 },
      aimDir: { x: 0.8, y: 0.6, z: 0 },
    };
    run(p, 0.01, { ...aim, ropeHeld: true });
    expect(p.mode).toBe('swing');
    const a = p.anchor!;
    run(p, 0.5, { ...aim, ropeHeld: true });
    const d = Math.hypot(p.pos.x - a.x, p.pos.y + 1.2 - a.y, p.pos.z - a.z);
    expect(d).toBeLessThanOrEqual(p.ropeLength + 0.05);
    run(p, 0.01, { ...aim, ropeHeld: false });
    expect(p.mode).not.toBe('swing');
  });

  it('never ends up inside a building', () => {
    const p = new PlayerBody(city);
    p.teleport({ ...street, y: 1 });
    for (let k = 0; k < 8; k++) {
      run(p, 0.8, { moveX: Math.cos(k), moveZ: Math.sin(k), sprint: true });
      const inside = city.colliders.some(
        (b) =>
          p.pos.x > b.minX + 0.05 &&
          p.pos.x < b.maxX - 0.05 &&
          p.pos.z > b.minZ + 0.05 &&
          p.pos.z < b.maxZ - 0.05 &&
          p.pos.y + 0.5 > b.minY &&
          p.pos.y + 0.5 < b.maxY,
      );
      expect(inside).toBe(false);
    }
  });
});
