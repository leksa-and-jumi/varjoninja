import { describe, expect, it } from 'vitest';
import { CAR } from '../config';
import { generateCity, roadLine } from './city';
import { DrivenCar } from './vehicle';

const city = generateCity();

describe('driven car', () => {
  it('speeds up but not past the top speed', () => {
    const c = new DrivenCar(city);
    c.place(roadLine(4) - 2, roadLine(4) + 20, 0);
    for (let i = 0; i < 60 * 10; i++) c.step(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    expect(c.speed).toBeLessThanOrEqual(CAR.maxSpeed + 0.01);
  });

  it('bounces off buildings instead of driving through', () => {
    const b = city.buildings.find((x) => x.boxes.length === 1 && x.height > 20)!;
    const box = b.boxes[0]!;
    const c = new DrivenCar(city);
    c.place(box.minX - 6, (box.minZ + box.maxZ) / 2, Math.PI / 2, 20);
    for (let i = 0; i < 120; i++) c.step(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    expect(c.x).toBeLessThan(box.minX);
  });
});
