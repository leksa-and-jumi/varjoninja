// The ninja on screen: body pose, the rope and the fluttering headband tails.

import * as THREE from 'three';
import type { Mode } from '../logic/player';
import { poseFor, type AnimInput, type AnimMode } from './animator';
import { outfitById, type Outfit } from '../logic/outfits';
import { CharacterView, ninjaLook, type Look, type NinjaColors } from './characters';

/** The ninja's look: own colours, or a bought outfit (which brings its own colours). */
export function ninjaLookFor(colors: NinjaColors, outfitId: string | null): Look {
  const o = outfitById(outfitId);
  if (!o) return ninjaLook(colors);
  return ninjaLook({ suit: o.suit, accent: o.accent, mask: o.mask }, undefined, {
    pattern: o.pattern,
    patternColor: new THREE.Color(o.patternColor),
    glow: o.glow,
    metal: o.metal,
  });
}

export interface NinjaState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  mode: Mode;
  anchor: THREE.Vector3 | null;
  zipTarget: THREE.Vector3 | null;
  sprint: boolean;
  /** Seconds since the last double jump (for the flip). */
  sinceDoubleJump: number;
  attack?: AnimInput['attack'];
  hurt: number;
}

const TAIL_POINTS = 7;
const TAIL_SEG = 0.09;

/** One headband tail: a little chain of points that trails in the wind. */
class Tail {
  points: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  constructor(start: THREE.Vector3) {
    for (let i = 0; i < TAIL_POINTS; i++) {
      this.points.push(start.clone());
      this.prev.push(start.clone());
    }
  }

  step(anchor: THREE.Vector3, wind: THREE.Vector3, dt: number): void {
    this.points[0]!.copy(anchor);
    this.prev[0]!.copy(anchor);
    for (let i = 1; i < TAIL_POINTS; i++) {
      const p = this.points[i]!;
      const q = this.prev[i]!;
      const vx = (p.x - q.x) * 0.9;
      const vy = (p.y - q.y) * 0.9;
      const vz = (p.z - q.z) * 0.9;
      q.copy(p);
      p.x += vx + wind.x * dt * dt;
      p.y += vy + (wind.y - 6) * dt * dt;
      p.z += vz + wind.z * dt * dt;
    }
    for (let k = 0; k < 3; k++) {
      for (let i = 1; i < TAIL_POINTS; i++) {
        const a = this.points[i - 1]!;
        const b = this.points[i]!;
        const d = a.distanceTo(b) || 1e-6;
        const corr = (d - TAIL_SEG) / d;
        if (i === 1) b.lerp(a, corr);
        else {
          const half = corr * 0.5;
          const dx = (b.x - a.x) * half;
          const dy = (b.y - a.y) * half;
          const dz = (b.z - a.z) * half;
          a.x += dx;
          a.y += dy;
          a.z += dz;
          b.x -= dx;
          b.y -= dy;
          b.z -= dz;
        }
      }
    }
  }
}

export class NinjaView {
  readonly character: CharacterView;
  private phase = 0;
  private rope: THREE.Mesh;
  private ropeShown = 0;
  private lastAnchor: THREE.Vector3 | null = null;
  private tails: Tail[] = [];
  private tailMesh: THREE.Mesh;
  private tailGeo: THREE.BufferGeometry;
  private tailMat: THREE.MeshStandardMaterial;
  private pitch = 0;
  private time = 0;
  private bodyUp = new THREE.Vector3(0, 1, 0);

  /** The outfit being worn (null = own colours). */
  outfit: Outfit | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    colors: NinjaColors,
    outfitId: string | null = null,
  ) {
    this.character = new CharacterView(ninjaLookFor(colors, outfitId));
    scene.add(this.character.root);

    const ropeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true);
    ropeGeo.translate(0, 0.5, 0);
    ropeGeo.rotateX(Math.PI / 2); // along +Z
    this.rope = new THREE.Mesh(
      ropeGeo,
      new THREE.MeshStandardMaterial({ color: 0xe8e2d0, emissive: 0x332f24, roughness: 0.6 }),
    );
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    scene.add(this.rope);

    this.tailGeo = new THREE.BufferGeometry();
    const verts = new Float32Array(2 * TAIL_POINTS * 2 * 3);
    this.tailGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const idx: number[] = [];
    for (let t = 0; t < 2; t++) {
      const base = t * TAIL_POINTS * 2;
      for (let i = 0; i < TAIL_POINTS - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.tailGeo.setIndex(idx);
    this.tailMat = new THREE.MeshStandardMaterial({
      color: colors.accent,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    this.tailMesh = new THREE.Mesh(this.tailGeo, this.tailMat);
    this.tailMesh.frustumCulled = false;
    this.tailMesh.castShadow = true;
    scene.add(this.tailMesh);
    this.setColors(colors, outfitId);
  }

  setColors(colors: NinjaColors, outfitId: string | null = null): void {
    this.outfit = outfitById(outfitId);
    this.character.setLook(ninjaLookFor(colors, outfitId));
    const o = this.outfit;
    this.tailMat.color.set(o ? o.accent : colors.accent);
    // Glowing outfits have glowing headband tails too.
    this.tailMat.emissive.set(o && o.glow > 0 ? o.patternColor : '#000000');
    this.tailMat.emissiveIntensity = o ? o.glow * 1.5 : 0;
  }

  setVisible(v: boolean): void {
    this.character.root.visible = v;
    this.tailMesh.visible = v;
    if (!v) this.rope.visible = false;
  }

  /** World position of the rope hand. */
  handPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.character.bonePosition('hand.R', out);
  }

  update(s: NinjaState, dt: number): void {
    this.time += dt;
    const root = this.character.root;
    root.position.copy(s.pos);
    root.rotation.y = s.yaw;

    const hSpeed = Math.hypot(s.vel.x, s.vel.z);
    let mode: AnimMode = 'idle';
    switch (s.mode) {
      case 'ground':
        mode = hSpeed < 0.6 ? 'idle' : hSpeed < 3 ? 'walk' : hSpeed > 13 ? 'sprint' : 'run';
        break;
      case 'air':
        mode = 'air';
        break;
      case 'wall':
        mode = 'wall';
        break;
      case 'swing':
        mode = 'swing';
        break;
      case 'zip':
        mode = 'zip';
        break;
      case 'swim':
        mode = 'swim';
        break;
      case 'drive':
        mode = 'sit';
        break;
    }
    const stride = mode === 'walk' ? 1.4 : mode === 'sprint' ? 3.6 : 2.5;
    if (mode === 'wall') this.phase += (Math.abs(s.vel.y) * dt * Math.PI * 2) / 1.6;
    else if (mode === 'swim') this.phase += dt * 4;
    else this.phase += (hSpeed * dt * Math.PI * 2) / stride;

    // Directions in character space (undo the facing turn).
    const toLocal = (w: THREE.Vector3) =>
      w.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -s.yaw);
    let ropeDir: THREE.Vector3 | undefined;
    if (s.anchor)
      ropeDir = toLocal(
        s.anchor
          .clone()
          .sub(s.pos)
          .setY(s.anchor.y - s.pos.y - 1.4),
      ).normalize();
    let zipDir: THREE.Vector3 | undefined;
    if (s.zipTarget) zipDir = toLocal(s.zipTarget.clone().sub(s.pos)).normalize();

    const flipT = s.sinceDoubleJump / 0.45;
    const result = poseFor({
      mode,
      phase: this.phase,
      time: this.time,
      vy: s.vel.y,
      ropeDir: ropeDir ? new THREE.Vector3(0, 1, 0).lerp(ropeDir, 0.25).normalize() : undefined,
      zipDir,
      flip: mode === 'air' && flipT < 1 ? flipT : undefined,
      attack: s.attack,
      hurt: s.hurt,
      ninja: true,
    });
    this.character.hipsOffset = result.hips;
    this.character.applyPose(result.pose, result.sharpness, dt);

    // Whole body: flips and swimming pitch, and leaning into the rope while swinging.
    const body = this.character.body;
    if (result.pitch !== 0 && mode === 'air') {
      this.pitch = result.pitch;
    } else {
      this.pitch = THREE.MathUtils.lerp(
        this.pitch % (Math.PI * 2),
        result.pitch,
        1 - Math.exp(-10 * dt),
      );
    }
    const wantUp = new THREE.Vector3(0, 1, 0);
    if (ropeDir)
      wantUp
        .copy(ropeDir)
        .lerp(new THREE.Vector3(0, 1, 0), 0.25)
        .normalize();
    this.bodyUp.lerp(wantUp, 1 - Math.exp(-10 * dt)).normalize();
    const lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.bodyUp);
    // Pivot flips around the waist, not the feet.
    const pivot = mode === 'swim' ? 0 : 1;
    const q = lean.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch),
    );
    // Tornado kick: two full spins.
    if (s.attack?.move === 'tornado' && s.attack.t > 0.05 && s.attack.t < 0.65) {
      const spin = ((s.attack.t - 0.05) / 0.6) * Math.PI * 4;
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
    }
    body.quaternion.copy(q);
    body.position.set(0, pivot, 0).sub(new THREE.Vector3(0, pivot, 0).applyQuaternion(q));
    if (mode === 'swim') body.position.y += 0.9;

    this.updateRope(s, dt);
    this.updateTails(s, dt);
  }

  private updateRope(s: NinjaState, dt: number): void {
    const target = s.anchor ?? s.zipTarget;
    if (!target) {
      this.ropeShown = Math.max(0, this.ropeShown - dt * 12);
      if (this.ropeShown <= 0 || !this.lastAnchor) {
        this.rope.visible = false;
        return;
      }
    } else {
      if (!this.lastAnchor || this.lastAnchor.distanceToSquared(target) > 0.01) {
        if (!this.rope.visible) this.ropeShown = 0;
        this.lastAnchor = target.clone();
      }
      this.ropeShown = Math.min(1, this.ropeShown + dt * 10);
    }
    const hand = this.handPosition(new THREE.Vector3());
    const end = this.lastAnchor!;
    const full = hand.distanceTo(end);
    const len = full * this.ropeShown;
    this.rope.visible = len > 0.05;
    this.rope.position.copy(hand);
    this.rope.lookAt(end);
    this.rope.scale.set(1, 1, len);
  }

  private updateTails(s: NinjaState, dt: number): void {
    const head = this.character;
    const knot = head.bonePosition('head', new THREE.Vector3());
    // The knot sits at the back of the head.
    const back = new THREE.Vector3(0, 0.16, -0.13).applyQuaternion(
      head.root.quaternion.clone().multiply(head.body.quaternion),
    );
    knot.add(back);
    if (this.tails.length === 0) {
      this.tails = [new Tail(knot), new Tail(knot)];
    }
    const wind = s.vel.clone().multiplyScalar(-4);
    wind.y += 2;
    const side = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let k = 0; k < steps; k++) {
      this.tails[0]!.step(knot.clone().addScaledVector(side, 0.025), wind, dt / steps);
      this.tails[1]!.step(
        knot.clone().addScaledVector(side, -0.025),
        wind.clone().add(new THREE.Vector3(0, -1.5, 0)),
        dt / steps,
      );
    }
    const pos = this.tailGeo.getAttribute('position') as THREE.BufferAttribute;
    const width = 0.035;
    this.tails.forEach((tail, t) => {
      for (let i = 0; i < TAIL_POINTS; i++) {
        const p = tail.points[i]!;
        const w = width * (1 - (i / TAIL_POINTS) * 0.4);
        const k = (t * TAIL_POINTS + i) * 2;
        pos.setXYZ(k, p.x, p.y + w, p.z);
        pos.setXYZ(k + 1, p.x, p.y - w, p.z);
      }
    });
    pos.needsUpdate = true;
    this.tailGeo.computeVertexNormals();
  }

  dispose(): void {
    this.character.dispose();
    this.scene.remove(this.rope, this.tailMesh);
  }
}
