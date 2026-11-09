import { describe, expect, it } from 'vitest';
import { allTables, t } from './i18n';

describe('texts', () => {
  it('every language has every text, and the same placeholders', () => {
    const { fi, en, th } = allTables();
    for (const key of Object.keys(fi) as (keyof typeof fi)[]) {
      const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const other of [en, th]) {
        expect(other[key], key).toBeTruthy();
        expect(holes(other[key]), key).toBe(holes(fi[key]));
      }
    }
  });

  it('fills in placeholders', () => {
    expect(t('players', { n: 2 }, 'en')).toBe('2 players');
    expect(t('goldenShuriken', { n: 1, total: 40 }, 'fi')).toBe('Kultainen shuriken 1/40');
  });
});
