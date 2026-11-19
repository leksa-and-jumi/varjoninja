import { describe, expect, it } from 'vitest';
import { CAR, VEHICLES } from '../config';
import { generateCity, roadLine } from './city';
import { DrivenCar, vehicleGap } from './vehicle';

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

  it('mopeds are slower than sports cars and buses are slowest', () => {
    // Speed after a short full-throttle burst on a straight road.
    const top = (model: string) => {
      const c = new DrivenCar(city, model);
      c.place(roadLine(4) - 2, roadLine(4) + 20, 0);
      for (let i = 0; i < 60 * 1.5; i++)
        c.step(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      return c.speed;
    };
    expect(top('moped')).toBeLessThan(top('sports'));
    expect(top('bus')).toBeLessThan(top('moped'));
  });

  it('a bus is long: something at its back end touches it', () => {
    const bus = VEHICLES.bus!;
    const moped = VEHICLES.moped!;
    // A moped 5 m behind the bus centre touches the bus; 5 m to the side does not.
    expect(vehicleGap(0, 0, 0, bus, 0, -5, 0, moped).gap).toBeLessThan(0);
    expect(vehicleGap(0, 0, 0, bus, 5, 0, 0, moped).gap).toBeGreaterThan(0);
    const g = vehicleGap(0, 0, 0, bus, 0, -5, 0, moped);
    expect(g.nz).toBeLessThan(0);
  });
});
