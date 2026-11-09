import { describe, expect, it } from 'vitest';
import { CITY, CITY_HALF } from '../config';
import { generateCity, groundHeight, isInSea, isOnRoad, roadLine } from './city';
import { pointInBox } from './geom';

describe('city', () => {
  const city = generateCity();

  it('is the same every time (same seed)', () => {
    const again = generateCity();
    expect(again.buildings.length).toBe(city.buildings.length);
    expect(again.buildings[10]!.height).toBe(city.buildings[10]!.height);
  });

  it('has a block for every grid cell, with parks and plazas', () => {
    expect(city.blocks.length).toBe(CITY.blocks * CITY.blocks);
    expect(city.blocks.some((b) => b.kind === 'park')).toBe(true);
    expect(city.blocks.some((b) => b.kind === 'plaza')).toBe(true);
  });

  it('keeps buildings off the roads', () => {
    for (const b of city.buildings) {
      for (const bx of b.boxes) {
        const cx = (bx.minX + bx.maxX) / 2;
        const cz = (bx.minZ + bx.maxZ) / 2;
        expect(isOnRoad(cx, cz)).toBe(false);
      }
    }
  });

  it('has taller buildings downtown than in the outskirts', () => {
    const avg = (d: string) => {
      const list = city.buildings.filter((b) => b.district === d);
      return list.reduce((s, b) => s + b.height, 0) / list.length;
    };
    expect(avg('downtown')).toBeGreaterThan(avg('outskirts') * 2);
  });

  it('knows roads, sidewalks and the sea', () => {
    expect(isOnRoad(roadLine(3), 5)).toBe(true);
    expect(groundHeight(roadLine(3), 5)).toBe(0);
    expect(
      groundHeight(roadLine(3) + CITY.roadWidth / 2 + 1, roadLine(3) + CITY.roadWidth / 2 + 1),
    ).toBe(CITY.sidewalkHeight);
    expect(isInSea(CITY_HALF + 200, 0)).toBe(true);
    expect(isInSea(0, 0)).toBe(false);
  });

  it('finds buildings with a ray', () => {
    const b = city.buildings.find((x) => x.height > 50)!;
    const box = b.boxes[0]!;
    const z = (box.minZ + box.maxZ) / 2;
    const hit = city.grid.raycast({ x: box.minX - 20, y: 10, z }, { x: 1, y: 0, z: 0 }, 100);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeLessThanOrEqual(20.001);
    expect(hit!.nx).toBe(-1);
  });

  it('puts collectibles above rooftops', () => {
    for (const c of city.collectibles) {
      const inside = city.colliders.some((b) => pointInBox(b, c.x, c.y, c.z));
      expect(inside).toBe(false);
    }
  });
});
