import { describe, expect, it } from 'vitest';
import { generateCity } from './city';
import {
  closestLoop,
  hitPerson,
  loopLength,
  loopPoint,
  makePerson,
  stepPerson,
  type PersonContext,
} from './people';
import { Rng } from './rng';

const city = generateCity();
const block = city.blocks.findIndex((b) => b.kind === 'buildings');

function ctx(over: Partial<PersonContext> = {}): PersonContext {
  return {
    dt: 1 / 60,
    city,
    rng: new Rng(1),
    px: 9999,
    py: 0,
    pz: 9999,
    playerTargetable: true,
    wanted: 0,
    ...over,
  };
}

describe('people', () => {
  it('walk around the block on the sidewalk', () => {
    const b = city.blocks[block]!;
    const len = loopLength(b);
    for (let t = 0; t < len; t += 7) {
      const p = loopPoint(b, t);
      expect(Math.abs(closestLoop(b, p.x, p.z) - t)).toBeLessThan(0.01);
    }
  });

  it('fly when hit and get up again', () => {
    const p = makePerson('civ', 3, block, 5, city);
    hitPerson(p, 5, 1, 0, 6);
    expect(p.state).toBe('flying');
    const c = ctx();
    for (let i = 0; i < 60 * 3; i++) stepPerson(p, c);
    expect(['getup', 'panic', 'walk']).toContain(p.state);
  });

  it('stay down when knocked out', () => {
    const p = makePerson('thug', 3, block, 5, city);
    hitPerson(p, 999, 1, 0, 6);
    const c = ctx();
    for (let i = 0; i < 60 * 3; i++) stepPerson(p, c);
    expect(p.state).toBe('down');
    expect(p.hp).toBe(0);
  });

  it('thugs chase and strike the ninja', () => {
    const p = makePerson('thug', 3, block, 5, city);
    p.hostile = true;
    let struck = false;
    for (let i = 0; i < 60 * 6; i++) {
      const ev = stepPerson(p, ctx({ px: p.x + 1.2, py: p.y, pz: p.z }));
      if (ev.strike) struck = true;
    }
    expect(struck).toBe(true);
  });
});
