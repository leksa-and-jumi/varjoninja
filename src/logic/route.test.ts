import { describe, expect, it } from 'vitest';
import { generateCity, isOnRoad, roadLine } from './city';
import { curbPointNear, routeBetween, routeLength } from './route';

describe('routes', () => {
  const city = generateCity();

  it('finds a curb point on the road next to a spot', () => {
    const b = city.blocks[23]!;
    const p = curbPointNear(b.minX + 3, (b.minZ + b.maxZ) / 2);
    expect(isOnRoad(p.x, p.z)).toBe(true);
  });

  it('drives only along roads, in straight pieces', () => {
    const a = curbPointNear(roadLine(1) + 20, roadLine(2) + 2);
    const b = curbPointNear(roadLine(7) + 3, roadLine(8) + 30);
    const r = routeBetween(a, b);
    for (let k = 1; k < r.length; k++) {
      const p = r[k - 1]!;
      const q = r[k]!;
      // Each piece is along one axis.
      expect(Math.min(Math.abs(p.x - q.x), Math.abs(p.z - q.z))).toBeLessThan(3.5);
      for (let t = 0; t <= 1; t += 0.1) {
        expect(isOnRoad(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)).toBe(true);
      }
    }
    expect(routeLength(r)).toBeGreaterThan(0);
  });

  it('every hospital has its doors on the sidewalk and a stop on the road', () => {
    expect(city.hospitals.length).toBe(2);
    for (const h of city.hospitals) {
      expect(isOnRoad(h.stopX, h.stopZ)).toBe(true);
      expect(isOnRoad(h.doorX, h.doorZ)).toBe(false);
      expect(city.buildings[h.building]!.hospital).toBe(true);
    }
  });
});
