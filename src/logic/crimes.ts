// Trouble in the city. Crimes come from the clock and a seed, so every player in the same room
// sees the same crime in the same place without any messages. Only "solved" is sent.

import { MISSIONS } from '../config';
import type { City } from './city';
import { hash, Rng } from './rng';

export type CrimeKind = 'mugger' | 'gang' | 'carThief' | 'cat';

export interface Crime {
  /** Unique id: the time slot. */
  id: number;
  kind: CrimeKind;
  x: number;
  y: number;
  z: number;
  /** Block where it happens (sidewalk crimes). */
  block: number;
  /** Thug count for gangs. */
  count: number;
  startsAt: number;
  endsAt: number;
}

export const CRIME_INFO: Record<
  CrimeKind,
  { title: string; hint: string; reward: number; icon: string }
> = {
  mugger: {
    title: 'Laukkuvaras!',
    hint: 'Ota varas kiinni ennen kuin hän pääsee karkuun.',
    reward: 100,
    icon: '👜',
  },
  gang: { title: 'Jengi riehuu!', hint: 'Pysäytä kaikki jengiläiset.', reward: 200, icon: '👊' },
  carThief: {
    title: 'Autovaras!',
    hint: 'Pysäytä varastettu auto ja ota varas kiinni.',
    reward: 250,
    icon: '🚗',
  },
  cat: {
    title: 'Kissa katolla!',
    hint: 'Kiipeä katolle ja pelasta kissa.',
    reward: 150,
    icon: '🐱',
  },
};

/** How many crime slots overlap (each crime lasts this many intervals). */
const OVERLAP = 3;

export function crimeForSlot(city: City, slot: number, seed: number): Crime {
  const rng = new Rng(hash(slot, seed, 7777));
  const kinds: CrimeKind[] = ['mugger', 'gang', 'carThief', 'cat', 'mugger', 'gang'];
  const kind = rng.pick(kinds);
  const interval = MISSIONS.crimeInterval;
  const startsAt = slot * interval;
  const endsAt = startsAt + interval * OVERLAP;
  const buildingBlocks = city.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'buildings');
  const { b, i } = rng.pick(buildingBlocks);

  if (kind === 'cat') {
    // On the roof edge of a building that is not too tall.
    const candidates = city.buildings.filter((bd) => bd.height < 70);
    const bd = rng.pick(candidates.length ? candidates : city.buildings);
    const top = bd.boxes[bd.boxes.length - 1]!;
    const onX = rng.chance(0.5);
    const x = onX
      ? rng.range(top.minX + 2, top.maxX - 2)
      : rng.chance(0.5)
        ? top.minX + 0.6
        : top.maxX - 0.6;
    const z = onX
      ? rng.chance(0.5)
        ? top.minZ + 0.6
        : top.maxZ - 0.6
      : rng.range(top.minZ + 2, top.maxZ - 2);
    return { id: slot, kind, x, y: top.maxY, z, block: i, count: 1, startsAt, endsAt };
  }
  const x = (b.minX + b.maxX) / 2;
  const z = (b.minZ + b.maxZ) / 2;
  return {
    id: slot,
    kind,
    x,
    y: 0,
    z,
    block: i,
    count: kind === 'gang' ? rng.int(3, 5) : 1,
    startsAt,
    endsAt,
  };
}

/** Crimes going on right now (seconds since epoch). */
export function activeCrimes(
  city: City,
  nowSec: number,
  seed: number,
  solved: ReadonlySet<number>,
): Crime[] {
  const slot = Math.floor(nowSec / MISSIONS.crimeInterval);
  const out: Crime[] = [];
  for (let s = slot - OVERLAP + 1; s <= slot; s++) {
    if (solved.has(s)) continue;
    const c = crimeForSlot(city, s, seed);
    if (nowSec >= c.startsAt && nowSec < c.endsAt) out.push(c);
  }
  return out;
}

/** Hero rank from total hero points. */
export function heroRank(points: number): { title: string; next: number | null } {
  const ranks: [number, string][] = [
    [0, 'Ninjaoppilas'],
    [300, 'Katujen suojelija'],
    [900, 'Varjosoturi'],
    [2000, 'Kaupungin sankari'],
    [4000, 'Varjomestari'],
    [8000, 'Legendaarinen Varjoninja'],
  ];
  let title = ranks[0]![1];
  let next: number | null = null;
  for (let i = 0; i < ranks.length; i++) {
    if (points >= ranks[i]![0]) {
      title = ranks[i]![1];
      next = ranks[i + 1]?.[0] ?? null;
    }
  }
  return { title, next };
}
