// Special ninja outfits bought with hero points (Julius's prices: 200, 500, 800 and 1000).

export type OutfitId = 'tiger' | 'lightning' | 'dragon' | 'legend';

/** How the suit is drawn in the character shader. */
export enum Pattern {
  None = 0,
  Tiger = 1,
  Lightning = 2,
  Scales = 3,
  Legend = 4,
}

export interface Outfit {
  id: OutfitId;
  price: number;
  /** Text key for the name (src/i18n.ts). */
  nameKey: 'outfitTiger' | 'outfitLightning' | 'outfitDragon' | 'outfitLegend';
  suit: string;
  accent: string;
  mask: string;
  pattern: Pattern;
  /** Colour of the stripes / veins / scales / light bands. */
  patternColor: string;
  /** 0..1: how much the pattern and the eyes glow. */
  glow: number;
  /** 0..1: shiny metal suit. */
  metal: number;
  /** Golden sparkles floating around the ninja. */
  aura: boolean;
}

/** Append only: ids are saved on the device and sent to friends. */
export const OUTFITS: Outfit[] = [
  {
    id: 'tiger',
    price: 200,
    nameKey: 'outfitTiger',
    suit: '#e8781e',
    accent: '#111111',
    mask: '#e8781e',
    pattern: Pattern.Tiger,
    patternColor: '#151010',
    glow: 0,
    metal: 0,
    aura: false,
  },
  {
    id: 'lightning',
    price: 500,
    nameKey: 'outfitLightning',
    suit: '#141b3d',
    accent: '#38e1ff',
    mask: '#141b3d',
    pattern: Pattern.Lightning,
    patternColor: '#4fe8ff',
    glow: 1,
    metal: 0.2,
    aura: false,
  },
  {
    id: 'dragon',
    price: 800,
    nameKey: 'outfitDragon',
    suit: '#8c0f16',
    accent: '#f0b429',
    mask: '#5e0a0f',
    pattern: Pattern.Scales,
    patternColor: '#f0b429',
    glow: 0.5,
    metal: 0.55,
    aura: false,
  },
  {
    id: 'legend',
    price: 1000,
    nameKey: 'outfitLegend',
    suit: '#d9a520',
    accent: '#fff3c4',
    mask: '#b8860b',
    pattern: Pattern.Legend,
    patternColor: '#fff6d8',
    glow: 1,
    metal: 0.9,
    aura: true,
  },
];

export function outfitById(id: string | null | undefined): Outfit | null {
  return OUTFITS.find((o) => o.id === id) ?? null;
}

export function isOutfitId(v: unknown): v is OutfitId {
  return typeof v === 'string' && OUTFITS.some((o) => o.id === v);
}

export type BuyResult =
  { ok: true; points: number } | { ok: false; reason: 'owned' | 'tooExpensive' };

/** Try to buy an outfit with hero points. */
export function buyOutfit(id: OutfitId, points: number, owned: readonly string[]): BuyResult {
  const o = outfitById(id)!;
  if (owned.includes(id)) return { ok: false, reason: 'owned' };
  if (points < o.price) return { ok: false, reason: 'tooExpensive' };
  return { ok: true, points: points - o.price };
}
