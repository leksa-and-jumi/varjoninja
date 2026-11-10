// Particles: smoke puffs, hit sparks, splashes and pickup sparkles. One draw call for all.

import * as THREE from 'three';

const MAX = 1200;

interface Particle {
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
}

export class Effects {
  private points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private parts: (Particle | null)[] = new Array(MAX).fill(null);
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vAlpha = alpha; vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 600.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.2, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    p: Omit<Particle, 'maxLife'>,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.parts[i] = { ...p, maxLife: p.life };
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.size[i] = p.size;
    this.alpha[i] = 1;
  }

  /** Soft smoke (smoke bombs, people vanishing, car crashes). */
  puff(
    x: number,
    y: number,
    z: number,
    count = 14,
    color = new THREE.Color(0.75, 0.75, 0.8),
    spread = 2,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * spread;
      this.spawn(x + Math.cos(a) * 0.3, y + Math.random() * 0.8, z + Math.sin(a) * 0.3, color, {
        life: 0.9 + Math.random() * 0.8,
        vx: Math.cos(a) * s,
        vy: 0.6 + Math.random() * 1.2,
        vz: Math.sin(a) * s,
        size: 0.6 + Math.random() * 0.6,
        grow: 1.4,
        gravity: -0.3,
        drag: 2,
      });
    }
  }

  /** Bright sparks when a hit lands. */
  sparks(x: number, y: number, z: number, color = new THREE.Color(1, 0.85, 0.4), count = 12): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const s = 4 + Math.random() * 5;
      this.spawn(x, y, z, color, {
        life: 0.25 + Math.random() * 0.2,
        vx: Math.cos(a) * Math.cos(b) * s,
        vy: Math.sin(b) * s + 2,
        vz: Math.sin(a) * Math.cos(b) * s,
        size: 0.12,
        grow: -0.2,
        gravity: 12,
        drag: 3,
      });
    }
  }

  splash(x: number, y: number, z: number): void {
    const c = new THREE.Color(0.8, 0.9, 1);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.spawn(x, y, z, c, {
        life: 0.6 + Math.random() * 0.4,
        vx: Math.cos(a) * s,
        vy: 4 + Math.random() * 4,
        vz: Math.sin(a) * s,
        size: 0.18,
        grow: 0.1,
        gravity: 14,
        drag: 0.5,
      });
    }
  }

  /** Big comic-book burst for finishing moves. */
  impact(x: number, y: number, z: number): void {
    const colors = [
      new THREE.Color(1, 0.95, 0.6),
      new THREE.Color(1, 0.6, 0.15),
      new THREE.Color(1, 1, 1),
    ];
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const s = 7 + Math.random() * 9;
      this.spawn(x, y, z, colors[i % 3]!, {
        life: 0.3 + Math.random() * 0.25,
        vx: Math.cos(a) * Math.cos(b) * s,
        vy: Math.sin(b) * s,
        vz: Math.sin(a) * Math.cos(b) * s,
        size: 0.25 + Math.random() * 0.35,
        grow: -0.6,
        gravity: 0,
        drag: 5,
      });
    }
    // A quick bright flash in the middle.
    this.spawn(x, y, z, new THREE.Color(1, 1, 0.9), {
      life: 0.18,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 2.4,
      grow: 6,
      gravity: 0,
      drag: 0,
    });
  }

  /** Golden sparkles for pickups and rewards. */
  sparkle(x: number, y: number, z: number, color = new THREE.Color(1, 0.85, 0.2)): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3;
      this.spawn(x, y, z, color, {
        life: 0.7 + Math.random() * 0.5,
        vx: Math.cos(a) * s,
        vy: 2 + Math.random() * 4,
        vz: Math.sin(a) * s,
        size: 0.22,
        grow: -0.15,
        gravity: 4,
        drag: 1.5,
      });
    }
  }

  /** Little stars circling a knocked-out head. */
  dizzy(x: number, y: number, z: number, t: number): void {
    if (Math.random() > 0.25) return;
    const a = t * 5 + Math.random() * 6;
    this.spawn(x + Math.cos(a) * 0.35, y, z + Math.sin(a) * 0.35, new THREE.Color(1, 0.95, 0.4), {
      life: 0.4,
      vx: -Math.sin(a) * 1.2,
      vy: 0.2,
      vz: Math.cos(a) * 1.2,
      size: 0.13,
      grow: 0,
      gravity: 0,
      drag: 0,
    });
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.parts[i] = null;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.gravity * dt;
      this.pos[i * 3]! += p.vx * dt;
      this.pos[i * 3 + 1]! += p.vy * dt;
      this.pos[i * 3 + 2]! += p.vz * dt;
      this.size[i] = Math.max(0.01, this.size[i]! + p.grow * dt);
      this.alpha[i] = Math.min(1, (p.life / p.maxLife) * 1.5);
    }
    for (const name of ['position', 'color', 'size', 'alpha'])
      this.geo.getAttribute(name).needsUpdate = true;
  }
}
