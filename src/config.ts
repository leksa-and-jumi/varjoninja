// All game constants live here. Pure file: the room server (worker) imports it too.
// Units: metres, seconds, radians.

export const CITY = {
  /** Blocks per side (the city is a square island). */
  blocks: 10,
  /** Size of one city block from curb to curb. */
  blockSize: 72,
  /** Width of the asphalt between blocks. */
  roadWidth: 16,
  laneWidth: 3.6,
  sidewalkWidth: 5,
  sidewalkHeight: 0.18,
  /** Gap between buildings that share a block. */
  alleyWidth: 5,
  /** Promenade between the outer road and the sea. */
  shoreWidth: 30,
  seaLevel: -1.2,
  /** Shared seed so every player sees the same city. */
  seed: 20261109,
} as const;

/** Distance between road centre lines. */
export const CITY_PITCH = CITY.blockSize + CITY.roadWidth;
/** Half the width of the whole street grid (outer road centre lines at ±CITY_HALF). */
export const CITY_HALF = (CITY.blocks * CITY_PITCH) / 2;

export const BUILDING = {
  floorHeight: 3.6,
  groundFloorHeight: 5,
  /** Height ranges by district. */
  downtown: { min: 70, max: 230 },
  midtown: { min: 28, max: 85 },
  outskirts: { min: 10, max: 32 },
} as const;

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  runSpeed: 9,
  sprintSpeed: 17,
  groundAccel: 70,
  airAccel: 14,
  gravity: 24,
  jumpSpeed: 10,
  doubleJumpSpeed: 9.5,
  maxFallSpeed: 60,
  /** Climbing straight up a wall. */
  wallRunSpeed: 13,
  /** Hop when reaching the top of a wall. */
  vaultSpeed: 9,
  wallJumpSpeed: 11,
  maxHealth: 100,
  regenDelay: 4,
  regenPerSecond: 12,
  /** Falling faster than this hurts (a ninja lands softly otherwise). */
  safeLandingSpeed: 999,
} as const;

export const ROPE = {
  /** How far the rope reaches. */
  range: 110,
  /** Auto-aim: look this far ahead and this high for a swing point. */
  autoAhead: 28,
  autoUp: 34,
  /** The anchor must be at least this much above the ninja. */
  minAnchorRise: 6,
  /** Rope starts a little shorter than the distance, so the swing tightens. */
  attachShorten: 0.93,
  minLength: 8,
  /** Pumping the swing with forward input. */
  swingAccel: 16,
  maxSpeed: 46,
  /** Boost added when letting go at the bottom of a swing. */
  releaseBoost: 4,
  /** Zip: pull straight to the aimed point. */
  zipSpeed: 52,
  zipCooldown: 0.4,
} as const;

export const CAMERA = {
  distance: 6.2,
  height: 1.7,
  fov: 68,
  /** Extra field of view at full speed. */
  speedFov: 22,
  mouseSensitivity: 0.0023,
  touchSensitivity: 0.006,
  minPitch: -1.2,
  maxPitch: 1.25,
} as const;

/** Chase camera while driving. */
export const CAR_CAMERA = {
  /** Distance behind the car: close and far view (C switches). */
  distances: [8.5, 13],
  height: 1.7,
  /** Looking slightly down at the car. */
  pitch: 0.2,
  /** How quickly the camera swings back behind the car. */
  follow: 3.5,
  /** Seconds after turning the camera by hand before it swings back. */
  returnDelay: 1.4,
  /** Look this many seconds of travel ahead of the car… */
  lookAhead: 0.18,
  /** …but at most this many metres. */
  maxLookAhead: 6,
  fov: 70,
  speedFov: 16,
} as const;

export const COMBAT = {
  punchRange: 2.4,
  punchArc: 1.2,
  /** Seconds between combo hits. */
  comboWindow: 0.55,
  hitDamage: [12, 12, 22],
  lungeRange: 7,
  shurikenSpeed: 55,
  shurikenDamage: 20,
  shurikenCooldown: 0.35,
  smokeCooldown: 12,
  smokeRadius: 9,
  smokeDuration: 5,
} as const;

export const DAY = {
  /** One full day takes this many real seconds. */
  length: 16 * 60,
  /** Time of day (0..1) when a new game starts: late morning. */
  start: 0.38,
} as const;

export const TRAFFIC = {
  maxCars: 34,
  spawnRadius: 190,
  despawnRadius: 240,
  cruiseSpeed: 13,
  /** Gap kept to the car in front. */
  followGap: 7,
} as const;

export const PEDS = {
  max: 46,
  spawnRadius: 120,
  despawnRadius: 160,
  walkSpeed: 1.45,
  runSpeed: 5.5,
  maxHealth: 30,
  /** Knocked out people lie down this long, then disappear in a puff. */
  knockoutTime: 6,
} as const;

export const POLICE = {
  /** Stars added for hurting someone who did nothing wrong. */
  starPerInnocentHit: 1,
  maxStars: 5,
  /** Without being seen, one star drops this often. */
  starDecay: 14,
  sightRange: 60,
  officersPerStar: 2,
} as const;

export const CAR = {
  maxSpeed: 42,
  reverseSpeed: 12,
  accel: 18,
  brake: 30,
  steer: 0.6,
  grip: 6,
  driftGrip: 1.8,
  length: 4.6,
  width: 2,
} as const;

export const NET = {
  /** Player state is sent at most this often (messages / second). */
  sendRate: 8,
  /** And only if the ninja moved this much (m) or turned (rad). */
  moveDeadZone: 0.08,
  turnDeadZone: 0.05,
  /** Even standing still, send a heartbeat this often (s). */
  heartbeat: 4,
  maxPlayers: 6,
  /** Room server limits per player (messages / second, burst). */
  rateLimit: 16,
  rateBurst: 30,
} as const;

export const MISSIONS = {
  /** A new crime appears this often (s) when none is active nearby. */
  crimeInterval: 45,
  crimeRadius: 260,
  raceRings: 10,
  collectibles: 40,
} as const;

export const STORAGE = {
  profile: 'varjoninja.profile.v1',
  settings: 'varjoninja.settings.v1',
} as const;
