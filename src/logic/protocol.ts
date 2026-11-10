// Messages between the game and the room server. Short JSON arrays keep them small.
// No names or chat: a player is only a set of ninja colours.

import { NET } from '../config';

export const MODES = ['ground', 'air', 'wall', 'swing', 'zip', 'swim', 'drive'] as const;
export type NetMode = (typeof MODES)[number];

/** Colours as three hex strings: suit, accent, mask. */
export type NetColors = [string, string, string];

export interface NetState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: number;
  vx: number;
  vy: number;
  vz: number;
  /** Rope anchor, or null. */
  ax: number | null;
  ay: number | null;
  az: number | null;
  /** Car model index while driving (-1 = on foot) and paint colour index. */
  car: number;
  carColor: number;
  /** Attack move index (-1 = none). */
  attack: number;
}

export type ClientMessage =
  | { t: 'hello'; colors: NetColors }
  | { t: 'state'; s: NetState }
  | { t: 'solved'; crime: number }
  | { t: 'smoke'; x: number; y: number; z: number };

export type ServerMessage =
  | { t: 'welcome'; id: number; time: number; players: [number, NetColors][]; solved: number[] }
  | { t: 'join'; id: number; colors: NetColors }
  | { t: 'leave'; id: number }
  | { t: 'state'; id: number; s: NetState }
  | { t: 'solved'; crime: number; by: number }
  | { t: 'smoke'; id: number; x: number; y: number; z: number }
  | { t: 'full' };

const round = (v: number, k = 100) => Math.round(v * k) / k;

// --- Encoding -------------------------------------------------------------------------------

function stateArray(s: NetState): (number | null)[] {
  return [
    round(s.x),
    round(s.y),
    round(s.z),
    round(s.yaw),
    s.mode,
    round(s.vx, 10),
    round(s.vy, 10),
    round(s.vz, 10),
    s.ax === null ? null : round(s.ax, 10),
    s.ay === null ? null : round(s.ay, 10),
    s.az === null ? null : round(s.az, 10),
    s.car,
    s.carColor,
    s.attack,
  ];
}

export function encodeClient(m: ClientMessage): string {
  switch (m.t) {
    case 'hello':
      return JSON.stringify(['h', m.colors]);
    case 'state':
      return JSON.stringify(['s', ...stateArray(m.s)]);
    case 'solved':
      return JSON.stringify(['c', m.crime]);
    case 'smoke':
      return JSON.stringify(['k', round(m.x, 10), round(m.y, 10), round(m.z, 10)]);
  }
}

export function encodeServer(m: ServerMessage): string {
  switch (m.t) {
    case 'welcome':
      return JSON.stringify(['w', m.id, m.time, m.players, m.solved]);
    case 'join':
      return JSON.stringify(['j', m.id, m.colors]);
    case 'leave':
      return JSON.stringify(['l', m.id]);
    case 'state':
      return JSON.stringify(['s', m.id, ...stateArray(m.s)]);
    case 'solved':
      return JSON.stringify(['c', m.crime, m.by]);
    case 'smoke':
      return JSON.stringify(['k', m.id, m.x, m.y, m.z]);
    case 'full':
      return JSON.stringify(['f']);
  }
}

// --- Decoding (never trust the other side) ---------------------------------------------------

const isNum = (v: unknown, lim = 1e5): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function parseState(a: unknown[]): NetState | null {
  if (a.length !== 14) return null;
  const [x, y, z, yaw, mode, vx, vy, vz, ax, ay, az, car, carColor, attack] = a;
  if (!isNum(x, 5000) || !isNum(y, 2000) || !isNum(z, 5000) || !isNum(yaw, 100)) return null;
  if (!isNum(mode) || !Number.isInteger(mode) || mode < 0 || mode >= MODES.length) return null;
  if (!isNum(vx, 500) || !isNum(vy, 500) || !isNum(vz, 500)) return null;
  const anchorOk =
    (ax === null && ay === null && az === null) ||
    (isNum(ax, 5000) && isNum(ay, 2000) && isNum(az, 5000));
  if (!anchorOk) return null;
  if (
    !isNum(car, 10) ||
    !Number.isInteger(car) ||
    !isNum(carColor, 100) ||
    !Number.isInteger(carColor)
  )
    return null;
  if (!isNum(attack, 10) || !Number.isInteger(attack)) return null;
  return {
    x,
    y,
    z,
    yaw,
    mode,
    vx,
    vy,
    vz,
    ax: ax as number | null,
    ay: ay as number | null,
    az: az as number | null,
    car,
    carColor,
    attack,
  };
}

function parseColors(v: unknown): NetColors | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isColor)) return null;
  return [v[0], v[1], v[2]] as NetColors;
}

export function parseClient(raw: string): ClientMessage | null {
  if (raw.length > 512) return null;
  let a: unknown;
  try {
    a = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(a) || typeof a[0] !== 'string') return null;
  switch (a[0]) {
    case 'h': {
      const colors = parseColors(a[1]);
      return colors ? { t: 'hello', colors } : null;
    }
    case 's': {
      const s = parseState(a.slice(1));
      return s ? { t: 'state', s } : null;
    }
    case 'c':
      return isNum(a[1], 1e10) && Number.isInteger(a[1]) ? { t: 'solved', crime: a[1] } : null;
    case 'k':
      return isNum(a[1], 5000) && isNum(a[2], 2000) && isNum(a[3], 5000)
        ? { t: 'smoke', x: a[1], y: a[2], z: a[3] }
        : null;
  }
  return null;
}

export function parseServer(raw: string): ServerMessage | null {
  let a: unknown;
  try {
    a = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(a)) return null;
  switch (a[0]) {
    case 'w': {
      if (!isNum(a[1], 1e9) || !isNum(a[2], 1e14) || !Array.isArray(a[3]) || !Array.isArray(a[4]))
        return null;
      const players: [number, NetColors][] = [];
      for (const p of a[3] as unknown[]) {
        if (!Array.isArray(p)) continue;
        const c = parseColors(p[1]);
        if (isNum(p[0], 1e9) && c) players.push([p[0], c]);
      }
      return {
        t: 'welcome',
        id: a[1],
        time: a[2],
        players,
        solved: (a[4] as unknown[]).filter((n): n is number => isNum(n, 1e10)),
      };
    }
    case 'j': {
      const c = parseColors(a[2]);
      return isNum(a[1], 1e9) && c ? { t: 'join', id: a[1], colors: c } : null;
    }
    case 'l':
      return isNum(a[1], 1e9) ? { t: 'leave', id: a[1] } : null;
    case 's': {
      const s = parseState(a.slice(2));
      return isNum(a[1], 1e9) && s ? { t: 'state', id: a[1], s } : null;
    }
    case 'c':
      return isNum(a[1], 1e10) && isNum(a[2], 1e9) ? { t: 'solved', crime: a[1], by: a[2] } : null;
    case 'k':
      return isNum(a[1], 1e9) && isNum(a[2], 5000) && isNum(a[3], 2000) && isNum(a[4], 5000)
        ? { t: 'smoke', id: a[1], x: a[2], y: a[3], z: a[4] }
        : null;
    case 'f':
      return { t: 'full' };
  }
  return null;
}

// --- Room codes -------------------------------------------------------------------------------

const WORDS = [
  'NINJA',
  'VARJO',
  'KUU',
  'TAHTI',
  'KATTO',
  'KOYSI',
  'SALAMA',
  'TUULI',
  'KETTU',
  'HAUKKA',
  'TIIKERI',
  'LOHI',
  'PILVI',
  'MYRSKY',
  'KISSA',
  'KOMEETTA',
];

export function makeRoomCode(rand: () => number = Math.random): string {
  const w = () => WORDS[Math.floor(rand() * WORDS.length)]!;
  const n = Math.floor(rand() * 90) + 10;
  return `${w()}-${w()}-${n}`;
}

/**
 * Clean up a typed code: upper case, Ä→A and Ö→O (older codes had them, and they are easy to
 * type without), spaces and other separators become single dashes.
 */
export function normalizeRoomCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/Ä/g, 'A')
    .replace(/Ö/g, 'O')
    .replace(/Å/g, 'A')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-ZÄÖ]{2,10}-[A-ZÄÖ]{2,10}-\d{2}$/.test(code);
}

/** Seed for the room's crimes. */
export function roomSeed(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const LIMITS = { maxPlayers: NET.maxPlayers, rate: NET.rateLimit, burst: NET.rateBurst };
