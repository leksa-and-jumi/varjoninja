import { describe, expect, it } from 'vitest';
import { buyOutfit, OUTFITS } from './outfits';

describe('outfit shop', () => {
  it('has the four prices Julius chose', () => {
    expect(OUTFITS.map((o) => o.price)).toEqual([200, 500, 800, 1000]);
  });

  it('buying takes the points, and only once', () => {
    expect(buyOutfit('tiger', 250, [])).toEqual({ ok: true, points: 50 });
    expect(buyOutfit('tiger', 250, ['tiger'])).toEqual({ ok: false, reason: 'owned' });
    expect(buyOutfit('legend', 999, [])).toEqual({ ok: false, reason: 'tooExpensive' });
  });
});
