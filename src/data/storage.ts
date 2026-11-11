// What is remembered on this device: the ninja's colours, hero points, found shurikens and settings.
// No names or other personal data.

import { STORAGE } from '../config';
import { isLang, type Lang } from '../i18n';
import type { NinjaColors } from '../render/characters';

export interface Profile {
  colors: NinjaColors;
  /** Hero points to spend in the outfit shop. */
  heroPoints: number;
  /** All hero points ever earned (the rank). */
  earned: number;
  /** Bought outfits, and the one being worn (null = own colours). */
  owned: string[];
  outfit: string | null;
  collected: number[];
  solvedCount: number;
}

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  volume: number;
  sensitivity: number;
  showHelp: boolean;
  language: Lang;
}

export const DEFAULT_COLORS: NinjaColors = { suit: '#1b1c22', accent: '#d42a2a', mask: '#1b1c22' };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the game still works, it just forgets.
  }
}

export function loadProfile(): Profile {
  const p = read<Profile>(STORAGE.profile, {
    colors: DEFAULT_COLORS,
    heroPoints: 0,
    earned: -1,
    owned: [],
    outfit: null,
    collected: [],
    solvedCount: 0,
  });
  // Profiles from before the shop: everything earned so far counts for the rank.
  if (p.earned < p.heroPoints) p.earned = p.heroPoints;
  if (!Array.isArray(p.owned)) p.owned = [];
  return p;
}

export function saveProfile(p: Profile): void {
  write(STORAGE.profile, p);
}

export function loadSettings(): Settings {
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const s = read<Settings>(STORAGE.settings, {
    quality: touch ? 'low' : 'high',
    volume: 0.8,
    sensitivity: 1,
    showHelp: true,
    language: 'fi',
  });
  if (!isLang(s.language)) s.language = 'fi';
  return s;
}

export function saveSettings(s: Settings): void {
  write(STORAGE.settings, s);
}
