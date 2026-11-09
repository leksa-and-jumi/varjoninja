import { describe, expect, it } from 'vitest';
import { CITY } from '../config';
import { isOnRoad, roadLine } from './city';
import { crossingOptions, lanePoint, spawnCar, stepCar, type LaneRef } from './traffic';
import { Rng } from './rng';

describe('traffic', () => {
  it('drives on the right side of the road', () => {
    const north: LaneRef = { axis: 'z', line: 3, dir: 1, lane: 0 };
    const p = lanePoint(north, 10);
    // Facing +Z, the right-hand side is -X.
    expect(p.x).toBeLessThan(roadLine(3));
    const east: LaneRef = { axis: 'x', line: 3, dir: 1, lane: 1 };
    expect(lanePoint(east, 10).z).toBeGreaterThan(roadLine(3));
  });

  it('offers no straight road at the edge of the city', () => {
    const l: LaneRef = { axis: 'z', line: 0, dir: 1, lane: 0 };
    const opts = crossingOptions(l, CITY.blocks);
    expect(opts.every((o) => o.axis === 'x')).toBe(true);
    expect(opts.length).toBeGreaterThan(0);
  });

  it('keeps cars on roads for a long drive', () => {
    const rng = new Rng(5);
    for (let n = 0; n < 10; n++) {
      const car = spawnCar(rng, 0, 0, 0, 300)!;
      expect(car).not.toBeNull();
      for (let i = 0; i < 60 * 40; i++) {
        stepCar(car, 1 / 60, rng, Infinity);
        expect(isOnRoad(car.x, car.z)).toBe(true);
      }
    }
  });

  it('stops behind an obstacle', () => {
    const rng = new Rng(1);
    const car = spawnCar(rng, 0, 0, 0, 200)!;
    for (let i = 0; i < 120; i++) stepCar(car, 1 / 60, rng, 5);
    expect(car.speed).toBeLessThan(0.5);
  });
});
