// What is remembered on this device: the ninja's colours, hero points, found shurikens and settings.
// No names or other personal data.

import { STORAGE } from '../config';
import type { NinjaColors } from '../render/characters';

export interface Profile {
  colors: NinjaColors;
  heroPoints: number;
  collected: number[];
  solvedCount: number;
}

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  volume: number;
  sensitivity: number;
  showHelp: boolean;
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
  return read<Profile>(STORAGE.profile, {
    colors: DEFAULT_COLORS,
    heroPoints: 0,
    collected: [],
    solvedCount: 0,
  });
}

export function saveProfile(p: Profile): void {
  write(STORAGE.profile, p);
}

export function loadSettings(): Settings {
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return read<Settings>(STORAGE.settings, {
    quality: touch ? 'low' : 'high',
    volume: 0.8,
    sensitivity: 1,
    showHelp: true,
  });
}

export function saveSettings(s: Settings): void {
  write(STORAGE.settings, s);
}
