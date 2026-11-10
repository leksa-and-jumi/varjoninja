import '@fontsource/bangers/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import '@fontsource/noto-sans-thai/thai-600.css';
import '@fontsource/noto-sans-thai/thai-800.css';
import './style.css';
import * as THREE from 'three';
import { Sounds } from './audio/sounds';
import {
  loadProfile,
  loadSettings,
  saveProfile,
  saveSettings,
  type Settings,
} from './data/storage';
import { Game, QUALITY } from './game';
import { timeOfDay } from './logic/daytime';
import {
  MODES,
  makeRoomCode,
  normalizeRoomCode,
  isValidRoomCode,
  roomSeed,
  type NetColors,
} from './logic/protocol';
import { RoomClient } from './net/room';
import { ATTACKS, Remotes } from './play/remotes';
import { CAR_COLORS, CAR_MODELS, loadCarModels } from './render/carView';
import { loadCharacterModel, type NinjaColors } from './render/characters';
import { Hud } from './ui/hud';
import { setLang, t } from './i18n';
import { Menus } from './ui/menus';
import { isTouchDevice, TouchControls } from './ui/touch';

const toNet = (c: NinjaColors): NetColors => [c.suit, c.accent, c.mask];

async function main(): Promise<void> {
  const container = document.getElementById('game')!;
  const ui = document.getElementById('ui')!;
  const profile = loadProfile();
  let settings = loadSettings();
  setLang(settings.language);
  const sounds = new Sounds();
  sounds.setVolume(settings.volume);

  const menus = new Menus(ui, profile.colors, settings, {
    play: () => startPlaying(null),
    host: () => startPlaying(makeRoomCode()),
    join: (code) => {
      const c = normalizeRoomCode(code);
      if (!isValidRoomCode(c)) {
        menus.setJoinError(t('joinError'));
        return;
      }
      startPlaying(c);
    },
    colors: (c) => {
      profile.colors = c;
      saveProfile(profile);
      game.ninja.setColors(c);
      room?.setColors(toNet(c));
    },
    settings: (s: Settings) => {
      settings = s;
      saveSettings(s);
      sounds.setVolume(s.volume);
      game.sensitivity = s.sensitivity;
      hud.setHelp(s.showHelp && !touch);
    },
    resume: () => resume(),
    quit: () => quit(),
    click: () => {
      sounds.unlock();
      sounds.play('ui');
    },
    invite: () => {
      if (!room && !connectRoom(makeRoomCode())) return;
      if (room) menus.showInvite(room.code, inviteLink(room.code));
    },
    language: (l) => {
      settings.language = l;
      saveSettings(settings);
      setLang(l);
      hud.refreshTexts();
    },
    outfit: (open) => {
      if (open) {
        stateBeforeOutfit = game.state === 'pause' ? 'pause' : 'title';
        game.state = 'outfit';
      } else {
        game.state = stateBeforeOutfit;
      }
    },
  });
  let stateBeforeOutfit: 'title' | 'pause' = 'title';

  await Promise.all([
    loadCharacterModel(import.meta.env.BASE_URL),
    loadCarModels(import.meta.env.BASE_URL),
  ]);
  const game = new Game(container, profile.colors, QUALITY[settings.quality]);
  game.sensitivity = settings.sensitivity;
  game.world.heroPoints = profile.heroPoints;
  for (const i of profile.collected) game.world.collected.add(i);

  const hud = new Hud(ui, game.city);
  const touch = isTouchDevice();
  const touchControls = new TouchControls(ui, game.input);
  game.input.touchMode = touch;
  hud.setHelp(settings.showHelp && !touch);
  const remotes = new Remotes(game.scene);
  let room: RoomClient | null = null;
  let clockOffset = 0;

  // --- Hooks from the game -------------------------------------------------------------------
  game.callbacks = {
    ...game.callbacks,
    notify: (title, text, icon) => {
      hud.notify(title, text, icon);
      sounds.play('alarm');
    },
    reward: (points, text) => {
      hud.reward(points, text);
      sounds.play('reward');
      profile.heroPoints = game.world.heroPoints;
      profile.collected = [...game.world.collected];
      saveProfile(profile);
    },
    sound: (name, at) => sounds.play(name, at),
    crimeSolved: (id) => {
      profile.solvedCount++;
      saveProfile(profile);
      room?.solved(id);
    },
    finisher: (kind) => {
      const key =
        kind === 'tornado'
          ? 'finisherTornado'
          : kind === 'dash'
            ? 'finisherDash'
            : 'finisherUppercut';
      hud.finisher(t(key));
    },
    knockedOut: () => {
      menus.showKo(true);
      setTimeout(() => menus.showKo(false), 2500);
    },
  };
  game.onEvents.push((ev) => {
    const p = game.player.pos;
    if (ev.ropeShot) sounds.play('rope', p);
    if (ev.zipped) sounds.play('zip', p);
    if (ev.jumped || ev.doubleJumped) sounds.play('jump', p);
    if (ev.landed > 12) {
      sounds.play('land', p);
      game.rig.addShake(Math.min(0.5, ev.landed / 60));
    }
    if (ev.splashed) {
      sounds.play('splash', p);
      game.fx.splash(p.x, p.y + 1, p.z);
    }
  });

  // --- Starting, pausing ------------------------------------------------------------------
  /** Join (or start) a room. Returns false if multiplayer is not available. */
  function connectRoom(code: string): boolean {
    if (!RoomClient.available()) {
      hud.notify(t('noMultiplayer'), t('playingAlone'), '📡');
      return false;
    }
    room?.close();
    remotes.clear();
    game.world.roomSeed = roomSeed(code);
    room = new RoomClient(code, toNet(profile.colors), {
      status: (s) => {
        if (s === 'open') hud.notify(t('connected'), t('tellCode', { code }), '👥');
        if (s === 'closed') hud.notify(t('disconnected'), t('retrying'), '📡');
        if (s === 'full') hud.notify(t('roomFull'), t('playingAlone'), '🚪');
      },
      message: (m) => {
        const now = performance.now();
        switch (m.t) {
          case 'welcome':
            clockOffset = m.time - Date.now();
            game.world.setClockOffset(clockOffset);
            for (const [id, c] of m.players) remotes.add(id, c);
            for (const c of m.solved) game.world.solved.add(c);
            break;
          case 'join':
            remotes.add(m.id, m.colors);
            hud.notify(t('friendJoined'), t('solveTogether'), '🥷');
            break;
          case 'leave':
            remotes.remove(m.id);
            hud.notify(t('friendLeft'), '', '👋');
            break;
          case 'state':
            remotes.state(m.id, m.s, now);
            break;
          case 'solved':
            game.world.markSolved(m.crime, false);
            break;
          case 'smoke':
            game.fx.puff(m.x, m.y + 0.3, m.z, 50, new THREE.Color(0.55, 0.55, 0.62), 6);
            break;
        }
      },
    });
    room.connect();
    return true;
  }

  function inviteLink(code: string): string {
    return `${location.origin}${location.pathname}?huone=${encodeURIComponent(code)}`;
  }

  function startPlaying(code: string | null): void {
    sounds.unlock();
    menus.showTitle(false);
    hud.show(true);
    touchControls.show(touch);
    game.state = 'play';
    game.input.reset();
    if (!touch) void game.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    if (code) connectRoom(code);
    if (game.world.heroPoints === 0) {
      hud.bigMessage('VARJOSAARI', t('welcome'));
    }
  }

  function pause(): void {
    if (game.state !== 'play') return;
    game.state = 'pause';
    menus.showPause(true);
    touchControls.show(false);
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  function resume(): void {
    menus.showPause(false);
    game.state = 'play';
    touchControls.show(touch);
    game.input.reset();
    if (!touch) void game.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  }

  function quit(): void {
    menus.showPause(false);
    room?.close();
    room = null;
    remotes.clear();
    game.world.roomSeed = 1;
    clockOffset = 0;
    game.world.setClockOffset(0);
    hud.show(false);
    touchControls.show(false);
    if (game.world.driving) game.world.exitCar(game.player);
    game.respawn();
    game.state = 'title';
    menus.showTitle(true);
  }

  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && game.state === 'play' && !touch) pause();
  });

  // --- Every frame ---------------------------------------------------------------------------
  game.onFrame.push((dt) => {
    const inp = game.input;
    if (game.state === 'play') {
      if (inp.pressed('pause')) pause();
      if (inp.pressed('map')) hud.toggleBigMap();
    }
    // Keys outside the play state.
    if (game.state === 'pause' && inp.pressed('pause')) resume();

    const p = game.player;
    const w = game.world;
    const cam = game.camera.position;
    sounds.listener = { x: cam.x, y: cam.y, z: cam.z };
    sounds.update(
      p.speed,
      !!w.driving,
      w.driving?.car.forwardSpeed ?? 0,
      w.sirenOn || w.wanted >= 2,
      game.sky.state.night,
    );

    const now = performance.now();
    remotes.update(now, dt);
    if (room) {
      const d = w.driving;
      room.tick(
        {
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z,
          yaw: p.yaw,
          mode: MODES.indexOf(p.mode),
          vx: p.vel.x,
          vy: p.vel.y,
          vz: p.vel.z,
          ax: p.anchor?.x ?? null,
          ay: p.anchor?.y ?? null,
          az: p.anchor?.z ?? null,
          car: d ? CAR_MODELS.indexOf(d.model) : -1,
          carColor: d ? Math.max(0, CAR_COLORS.indexOf(d.color)) : 0,
          attack: w.attack ? ATTACKS.indexOf(w.attack.move) : -1,
        },
        now,
      );
    }

    if (game.state === 'play' || game.state === 'pause') {
      const nearCar =
        !w.driving &&
        (w.cars.some((c) => Math.hypot(c.traffic.x - p.pos.x, c.traffic.z - p.pos.z) < 4.5) ||
          w.parked.some((c) => Math.hypot(c.car.x - p.pos.x, c.car.z - p.pos.z) < 4.5));
      hud.update({
        hp: w.hp,
        heroPoints: w.heroPoints,
        wanted: w.wanted,
        tod: timeOfDay(Date.now() + clockOffset, game.timeOffset),
        x: p.pos.x,
        z: p.pos.z,
        yaw: p.yaw,
        camYaw: game.rig.yaw,
        crimes: w.crimes,
        people: w.mapPeople,
        friends: remotes.positions,
        shurikenCooldown: w.shurikenCooldown,
        smokeCooldown: w.smokeCooldown,
        hurt: w.hurtFlash,
        speed: p.speed,
        nearCar,
        driving: !!w.driving,
        roomCode: room?.code ?? null,
        players: remotes.count + 1,
        collected: w.collected.size,
        totalCollectibles: game.city.collectibles.length,
        aimTarget: game.aimTarget && !w.driving,
      });
    }
  });
  game.clockOffset = () => clockOffset;
  game.onSmoke = (x, y, z) => room?.smoke(x, y, z);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && game.state === 'play') {
      settings.showHelp = !settings.showHelp;
      saveSettings(settings);
      hud.setHelp(settings.showHelp && !touch);
    }
  });

  // Opened from an invite link: offer to join the friend's game.
  const invited = normalizeRoomCode(new URLSearchParams(location.search).get('huone') ?? '');
  if (isValidRoomCode(invited)) menus.setInvited(invited);

  menus.hideLoading();
  menus.showTitle(true);
  game.state = 'title';
  game.start();
  if (import.meta.env.DEV) (window as unknown as { __game: () => Game }).__game = () => game;
}

void main();
