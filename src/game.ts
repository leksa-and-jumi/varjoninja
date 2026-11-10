// The game: owns the renderer, the world and the main loop.

import * as THREE from 'three';
import { CITY, CITY_HALF, CAMERA, ROPE } from './config';
import { generateCity, roadLine, type Building, type City } from './logic/city';
import { timeOfDay } from './logic/daytime';
import { emptyInput, PlayerBody, type PlayerInput, type StepEvents } from './logic/player';
import { CameraRig } from './play/cameraRig';
import { buildCityView, type CityView } from './render/cityRenderer';
import { cityUniforms } from './render/materials';
import { NinjaView } from './render/ninjaView';
import { PostFx } from './render/postfx';
import { SkyView } from './render/sky';
import type { NinjaColors } from './render/characters';
import { Input } from './ui/input';
import { World, type WorldCallbacks } from './play/world';
import { Effects } from './render/effects';
import { updateCarLights } from './render/carView';

export interface Quality {
  pixelRatio: number;
  shadows: number;
  samples: number;
}

export const QUALITY: Record<'low' | 'medium' | 'high', Quality> = {
  low: { pixelRatio: 0.75, shadows: 0, samples: 0 },
  medium: { pixelRatio: 1, shadows: 1024, samples: 2 },
  high: { pixelRatio: Math.min(window.devicePixelRatio, 2), shadows: 2048, samples: 4 },
};

const FIXED_DT = 1 / 120;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly city: City;
  readonly cityView: CityView;
  readonly sky: SkyView;
  readonly post: PostFx;
  readonly rig: CameraRig;
  readonly input: Input;
  readonly player: PlayerBody;
  readonly ninja: NinjaView;
  readonly fx: Effects;
  readonly world: World;
  /** title = menu with the city running, play = playing, pause = everything stops. */
  state: 'title' | 'outfit' | 'play' | 'pause' = 'title';
  /** Mouse sensitivity multiplier (settings). */
  sensitivity = 1;
  /** Crosshair points at something the rope can grab. */
  aimTarget = false;
  /** Server clock minus ours (ms), so friends share the same sky. */
  clockOffset: () => number = () => 0;
  onSmoke: ((x: number, y: number, z: number) => void) | null = null;
  /** Extra time-of-day shift (debug / tests). */
  timeOffset = 0;
  private accumulator = 0;
  private last = performance.now();
  private elapsed = 0;
  private sinceDoubleJump = 99;
  private playerInput: PlayerInput = emptyInput();
  /** Hooks for the HUD, sounds and the network (set by main). */
  callbacks: WorldCallbacks & { knockedOut(): void } = {
    notify: () => {},
    reward: () => {},
    sound: () => {},
    crimeSolved: () => {},
    shake: () => {},
    playerKnockedOut: () => {},
    finisher: () => {},
    knockedOut: () => {},
  };
  /** Camera comes closer during a finishing move. */
  private finisherZoom = 0;
  private koTimer = 0;
  /** Listeners for step events (sounds, effects). */
  onEvents: ((ev: StepEvents) => void)[] = [];
  onFrame: ((dt: number) => void)[] = [];

  constructor(
    container: HTMLElement,
    colors: NinjaColors,
    readonly quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = quality.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      6000,
    );
    this.city = generateCity(CITY.seed);
    this.cityView = buildCityView(this.city);
    this.scene.add(this.cityView.root);
    this.sky = new SkyView(this.scene, this.renderer, quality.shadows);
    this.post = new PostFx(this.renderer, this.scene, this.camera, quality.samples);
    this.rig = new CameraRig(this.camera, this.city);
    this.input = new Input(this.renderer.domElement);

    this.player = new PlayerBody(this.city);
    this.ninja = new NinjaView(this.scene, colors);
    this.fx = new Effects(this.scene);
    const cb: WorldCallbacks = {
      notify: (title, text, icon) => this.callbacks.notify(title, text, icon),
      reward: (points, text) => {
        this.world.heroPoints += points;
        this.callbacks.reward(points, text);
      },
      sound: (name, at) => this.callbacks.sound(name, at),
      crimeSolved: (id) => this.callbacks.crimeSolved(id),
      shake: (a) => this.rig.addShake(a),
      playerKnockedOut: () => this.knockedOut(),
      finisher: (kind) => this.callbacks.finisher(kind),
    };
    this.world = new World(this.scene, this.city, this.fx, cb);
    this.respawn();

    window.addEventListener('resize', () => this.resize());
  }

  get paused(): boolean {
    return this.state !== 'play';
  }

  /** Start on a rooftop with a view: higher than its neighbours, not far from the centre. */
  respawn(): void {
    const top = (b: Building) => b.boxes[b.boxes.length - 1]!;
    const centre = (b: Building) => {
      const t = top(b);
      return { x: (t.minX + t.maxX) / 2, z: (t.minZ + t.maxZ) / 2 };
    };
    let best: Building | null = null;
    let bestScore = -Infinity;
    for (const b of this.city.buildings) {
      if (b.boxes.length !== 1 || b.height < 45 || b.height > 120) continue;
      const c = centre(b);
      const dist = Math.hypot(c.x, c.z);
      if (dist > 260) continue;
      let higher = 0;
      for (const o of this.city.buildings) {
        if (o === b) continue;
        const oc = centre(o);
        if (Math.hypot(oc.x - c.x, oc.z - c.z) < 70) higher = Math.max(higher, o.height - b.height);
      }
      const score = -higher * 2 - dist * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) {
      const t = top(best);
      const c = centre(best);
      // Face the city centre, standing a few steps from the edge.
      const yaw = Math.atan2(-c.x, -c.z);
      const x = c.x + Math.sin(yaw) * ((t.maxX - t.minX) / 2 - 4);
      const z = c.z + Math.cos(yaw) * ((t.maxZ - t.minZ) / 2 - 4);
      this.player.teleport({ x, y: t.maxY + 0.1, z }, yaw);
      this.rig.snapBehind(yaw);
    } else {
      this.player.teleport({ x: roadLine(5), y: 0.5, z: roadLine(5) + 30 }, Math.PI);
      this.rig.snapBehind(Math.PI);
    }
    this.player.setMode('ground');
    this.rig.pitch = 0.12;
    this.rig.update(0, this.focusPoint(), 0, true);
  }

  private knockedOut(): void {
    if (this.koTimer > 0) return;
    this.koTimer = 2.5;
    this.callbacks.knockedOut();
  }

  private focusPoint(): THREE.Vector3 {
    const p = this.player.pos;
    return new THREE.Vector3(p.x, p.y + 1.6, p.z);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  private readInput(): void {
    const inp = this.input;
    const sens =
      (inp.touchMode ? CAMERA.touchSensitivity : CAMERA.mouseSensitivity) * this.sensitivity;
    if (!this.paused) this.rig.look(inp.lookX, inp.lookY, sens);

    const mv = this.paused ? { x: 0, y: 0 } : inp.move();
    const f = this.rig.groundForward();
    // Right = forward turned 90° clockwise seen from above.
    const rx = -f.z;
    const rz = f.x;
    const pi = this.playerInput;
    pi.moveX = f.x * mv.y + rx * mv.x;
    pi.moveZ = f.z * mv.y + rz * mv.x;
    pi.sprint = inp.held.has('sprint');
    pi.jumpPressed = !this.paused && inp.pressed('jump');
    pi.ropeHeld = !this.paused && inp.held.has('rope');
    pi.zipPressed = !this.paused && inp.pressed('zip');
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    pi.aimOrigin = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    pi.aimDir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.city.grid.raycast(pi.aimOrigin, pi.aimDir, ROPE.range);
    this.aimTarget =
      !!hit && pi.aimOrigin.y + pi.aimDir.y * hit.t > this.player.pos.y + ROPE.minAnchorRise;
    if (this.paused || this.koTimer > 0) return;

    const w = this.world;
    if (inp.pressed('car')) {
      if (w.driving) w.exitCar(this.player);
      else w.enterCar(this.player);
    }
    if (w.driving) return;
    const aimYaw = Math.atan2(dir.x, dir.z);
    if (inp.pressed('attack'))
      w.startAttack(this.player, inp.locked || inp.touchMode ? aimYaw : this.player.yaw);
    if (inp.pressed('shuriken')) w.throwShuriken(this.player, pi.aimOrigin, pi.aimDir);
    if (inp.pressed('smoke') && w.smokeCooldown <= 0) {
      w.smokeBomb(this.player);
      const p = this.player.pos;
      this.onSmoke?.(p.x, p.y, p.z);
    }
  }

  frame(): void {
    const now = performance.now();
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += realDt;
    this.readInput();
    // Game time runs slower right after a finishing move lands (slow motion).
    const dt = realDt * this.world.timeScale;
    if (this.world.finisher) {
      // The finishing move moves the ninja; the player just watches.
      const pi = this.playerInput;
      pi.moveX = 0;
      pi.moveZ = 0;
      pi.jumpPressed = false;
      pi.ropeHeld = false;
      pi.zipPressed = false;
    }

    if (this.koTimer > 0) {
      this.koTimer -= dt;
      if (this.koTimer <= 0) {
        this.world.resetAfterKnockout();
        if (this.world.driving) this.world.exitCar(this.player);
        this.respawn();
      }
    }
    if (this.state === 'title' || this.state === 'outfit') {
      // Menus: the ninja just stands there.
      this.player.step(dt, {
        ...emptyInput(),
        aimDir: this.playerInput.aimDir,
        aimOrigin: this.playerInput.aimOrigin,
      });
    } else if (!this.paused) {
      this.accumulator += dt;
      let first = true;
      const mv = this.input.move();
      const driveInput = {
        throttle: mv.y,
        steer: mv.x,
        handbrake: this.input.held.has('jump'),
      };
      while (this.accumulator >= FIXED_DT) {
        this.accumulator -= FIXED_DT;
        if (this.world.driving) {
          this.world.driveStep(FIXED_DT, driveInput, this.player);
          continue;
        }
        const ev = this.player.step(FIXED_DT, this.playerInput);
        if (first) {
          // One-shot buttons only count once per frame.
          this.playerInput.jumpPressed = false;
          this.playerInput.zipPressed = false;
          first = false;
        }
        if (ev.doubleJumped) this.sinceDoubleJump = 0;
        for (const fn of this.onEvents) fn(ev);
      }
    }
    this.sinceDoubleJump += dt;
    if (this.state !== 'pause') {
      this.world.update(dt, this.player, this.sky.state.night, this.camera);
      this.fx.update(dt);
    }
    for (const fn of this.onFrame) fn(dt);

    const p = this.player;
    this.ninja.update(
      {
        pos: new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z),
        vel: new THREE.Vector3(p.vel.x, p.vel.y, p.vel.z),
        yaw: p.yaw,
        mode: p.mode,
        anchor: p.anchor ? new THREE.Vector3(p.anchor.x, p.anchor.y, p.anchor.z) : null,
        zipTarget: p.zipTarget
          ? new THREE.Vector3(p.zipTarget.x, p.zipTarget.y, p.zipTarget.z)
          : null,
        sprint: this.playerInput.sprint,
        sinceDoubleJump: this.sinceDoubleJump,
        attack: this.world.attack
          ? { move: this.world.attack.move, t: this.world.attack.t / this.world.attack.duration }
          : undefined,
        hurt: this.world.hurtFlash,
      },
      dt,
    );
    this.ninja.setVisible(!this.world.driving);

    this.finisherZoom +=
      ((this.world.finisher ? -2.2 : 0) - this.finisherZoom) * Math.min(1, realDt * 5);
    this.rig.zoom = this.finisherZoom;
    if (this.state === 'title') {
      // Slow turn around the ninja on the rooftop.
      this.rig.yaw += dt * 0.06;
      this.rig.pitch = 0.18;
      this.rig.zoom = 2.5;
    } else if (this.state === 'outfit') {
      // Close-up from the front.
      this.rig.yaw = p.yaw + 0.5;
      this.rig.pitch = 0.05;
      this.rig.zoom = -3;
    }
    const d = this.world.driving;
    if (d && this.state === 'play') {
      if (this.input.pressed('camera')) this.rig.toggleCarView();
      this.rig.updateCar(dt, {
        x: d.car.x,
        y: d.car.y,
        z: d.car.z,
        yaw: d.car.yaw,
        forwardSpeed: d.car.forwardSpeed,
      });
    } else {
      this.rig.update(dt, this.focusPoint(), this.paused ? 0 : p.speed);
    }
    const tod = timeOfDay(Date.now() + this.clockOffset(), this.timeOffset);
    this.sky.update(tod, this.focusPoint());
    const night = this.sky.state.night;
    cityUniforms.uNight.value = night;
    cityUniforms.uTime.value = this.elapsed;
    for (const { material, strength } of this.cityView.nightMaterials)
      material.emissiveIntensity = night * strength;
    if (this.cityView.beacons) {
      const m = this.cityView.beacons.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = (Math.sin(this.elapsed * 3) > 0.6 ? 4 : 0.2) * (0.3 + night);
    }
    updateCarLights(night, this.elapsed, this.world.sirenOn);
    this.post.setNight(night);
    this.post.render();
    this.input.endFrame();
  }

  /** Keep the island in view when far out at sea. */
  static isFarAway(x: number, z: number): boolean {
    return Math.max(Math.abs(x), Math.abs(z)) > CITY_HALF + 600;
  }
}
