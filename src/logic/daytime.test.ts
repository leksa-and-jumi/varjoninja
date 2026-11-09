import { describe, expect, it } from 'vitest';
import { clockText, sunState } from './daytime';

describe('day and night', () => {
  it('sun is up at noon and down at midnight', () => {
    expect(sunState(0.5).y).toBeGreaterThan(0.8);
    expect(sunState(0.5).night).toBe(0);
    expect(sunState(0).night).toBe(1);
  });

  it('shows a clock', () => {
    expect(clockText(0.5)).toBe('12:00');
    expect(clockText(0.75)).toBe('18:00');
  });
});
