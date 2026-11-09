import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../config';
import { generateCity } from './city';
import { activeCrimes, crimeForSlot, heroRank } from './crimes';

const city = generateCity();

describe('crimes', () => {
  it('are the same for everyone with the same seed', () => {
    expect(crimeForSlot(city, 1000, 7)).toEqual(crimeForSlot(city, 1000, 7));
  });

  it('a few are going on at once, and solved ones disappear', () => {
    const now = 1000 * MISSIONS.crimeInterval + 5;
    const list = activeCrimes(city, now, 7, new Set());
    expect(list.length).toBe(3);
    const solved = new Set([list[0]!.id]);
    expect(activeCrimes(city, now, 7, solved).length).toBe(2);
  });

  it('ranks grow with hero points', () => {
    expect(heroRank(0).title).toBe('Ninjaoppilas');
    expect(heroRank(10000).next).toBeNull();
  });
});
