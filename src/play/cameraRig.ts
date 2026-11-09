// Third-person camera that orbits the ninja, avoids walls and widens with speed.
// In a car it switches to a chase camera that stays behind the car and looks down the road.

import * as THREE from 'three';
import { CAMERA, CAR_CAMERA } from '../config';
import type { City } from '../logic/city';
import { angleDiff, clamp, damp, dampAngle } from '../logic/geom';

export interface CarTarget {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Signed speed along the car (negative = reversing). */
  forwardSpeed: number;
}

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.15;
  private distance: number = CAMERA.distance;
  private focus = new THREE.Vector3();
  private fov: number = CAMERA.fov;
  private shake = 0;
  /** Extra distance (menus use this for a wider or closer view). */
  zoom = 0;
  /** Seconds since the player last turned the camera by hand. */
  private sinceLook = 99;
  private inCar = false;
  /** 0 = close chase view, 1 = far chase view (C key). */
  carView = 0;
  private carPitch = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly city: City,
  ) {}

  look(dx: number, dy: number, sensitivity: number): void {
    if (dx !== 0 || dy !== 0) this.sinceLook = 0;
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch + dy * sensitivity, CAMERA.minPitch, CAMERA.maxPitch);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Forward direction on the ground plane (where W walks). */
  groundForward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  /** Snap behind a direction (e.g. after a respawn). */
  snapBehind(facing: number): void {
    this.yaw = facing + Math.PI;
  }

  toggleCarView(): void {
    this.carView = (this.carView + 1) % CAR_CAMERA.distances.length;
  }

  update(dt: number, target: THREE.Vector3, speed: number, instant = false): void {
    if (this.inCar) {
      // Back on foot: keep looking the same way, at the normal height.
      this.inCar = false;
      this.pitch = 0.15;
    }
    this.sinceLook += dt;
    if (instant) this.focus.copy(target);
    const k = 1 - Math.exp(-16 * dt);
    this.focus.lerp(target, k);

    const wanted = Math.max(1.5, CAMERA.distance + this.zoom + Math.min(4, speed * 0.05));
    const dir = this.direction();
    // Over-the-shoulder offset to the right.
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const origin = this.focus.clone().addScaledVector(right, 0.55);
    this.place(dt, origin, dir, wanted, origin.clone().setY(origin.y + 0.3));
    this.setFov(dt, CAMERA.fov + CAMERA.speedFov * clamp((speed - 12) / 40, 0, 1));
  }

  /** Chase camera for driving. */
  updateCar(dt: number, car: CarTarget): void {
    const speed = Math.abs(car.forwardSpeed);
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    // Look ahead of the car: more road is visible the faster you go.
    const ahead = clamp(car.forwardSpeed * CAR_CAMERA.lookAhead, -2, CAR_CAMERA.maxLookAhead);
    const target = new THREE.Vector3(
      car.x + fx * ahead,
      car.y + CAR_CAMERA.height,
      car.z + fz * ahead,
    );
    if (!this.inCar) {
      // Just got in: swing straight behind the car.
      this.inCar = true;
      this.yaw = car.yaw + Math.PI;
      this.carPitch = CAR_CAMERA.pitch;
      this.focus.copy(target);
    }
    this.sinceLook += dt;
    this.focus.lerp(target, 1 - Math.exp(-12 * dt));

    // Turned by hand: stay there a moment, then drift back behind the car.
    const behind = car.yaw + Math.PI;
    if (this.sinceLook > CAR_CAMERA.returnDelay) {
      const sharp = CAR_CAMERA.follow * (0.4 + Math.min(1, speed / 15));
      this.yaw = dampAngle(this.yaw, behind, sharp, dt);
      this.pitch = damp(this.pitch, CAR_CAMERA.pitch, 2, dt);
    }
    // Keep yaw near `behind` so angles don't wrap around.
    this.yaw = behind + angleDiff(behind, this.yaw);
    this.carPitch = clamp(this.pitch, -0.1, 0.9);

    const base = CAR_CAMERA.distances[this.carView] ?? CAR_CAMERA.distances[0];
    const wanted = base + Math.min(4, speed * 0.08);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.carPitch),
      Math.sin(this.carPitch),
      Math.cos(this.yaw) * Math.cos(this.carPitch),
    );
    const lookAt = this.focus.clone().setY(this.focus.y + 0.2);
    this.place(dt, this.focus.clone(), dir, wanted, lookAt);
    this.setFov(dt, CAR_CAMERA.fov + CAR_CAMERA.speedFov * clamp((speed - 10) / 30, 0, 1));
  }

  private direction(): THREE.Vector3 {
    return new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  /** Put the camera `wanted` metres from `origin` along `dir`, closer if a building is in the way. */
  private place(
    dt: number,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    wanted: number,
    lookAt: THREE.Vector3,
  ): void {
    const hit = this.city.grid.raycast(origin, dir, wanted + 0.4);
    const allowed = hit ? Math.max(0.8, hit.t - 0.4) : wanted;
    this.distance = allowed < this.distance ? allowed : damp(this.distance, allowed, 4, dt);

    const pos = origin.clone().addScaledVector(dir, this.distance);
    pos.y = Math.max(pos.y, 0.6);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.35;
      pos.x += (Math.random() - 0.5) * s;
      pos.y += (Math.random() - 0.5) * s;
      pos.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(lookAt);
  }

  private setFov(dt: number, target: number): void {
    this.fov = damp(this.fov, target, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
