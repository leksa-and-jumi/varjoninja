// Third-person camera that orbits the ninja, avoids walls and widens with speed.

import * as THREE from 'three';
import { CAMERA } from '../config';
import type { City } from '../logic/city';
import { clamp, damp } from '../logic/geom';

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.15;
  private distance: number = CAMERA.distance;
  private focus = new THREE.Vector3();
  private fov: number = CAMERA.fov;
  private shake = 0;
  /** Extra distance (e.g. while driving). */
  zoom = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly city: City,
  ) {}

  look(dx: number, dy: number, sensitivity: number): void {
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

  update(dt: number, target: THREE.Vector3, speed: number, instant = false): void {
    if (instant) this.focus.copy(target);
    const k = 1 - Math.exp(-16 * dt);
    this.focus.lerp(target, k);

    const wanted = Math.max(1.5, CAMERA.distance + this.zoom + Math.min(4, speed * 0.05));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // Over-the-shoulder offset to the right.
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const origin = this.focus.clone().addScaledVector(right, 0.55);

    // Pull in when a building is between the ninja and the camera.
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
    this.camera.lookAt(origin.x, origin.y + 0.3, origin.z);

    const targetFov = CAMERA.fov + CAMERA.speedFov * clamp((speed - 12) / 40, 0, 1);
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
