// A little blood on the ground where someone was knocked out. It fades away after a few
// minutes. (Allowed by the parent on 2026-11-10: small stains only, nothing gory.)

import * as THREE from 'three';
import { BLOOD } from '../config';

interface Decal {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  age: number;
}

function splatTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  g.fillStyle = '#6e0a0a';
  // A blob made of overlapping circles, with a few drops around it.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 22;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 14 + rnd() * 18, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 40 + rnd() * 18;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rnd() * 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Decals {
  private list: Decal[] = [];
  private textures: THREE.CanvasTexture[] = [1, 2, 3, 4].map((k) => splatTexture(k * 7919));
  private geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(private readonly scene: THREE.Scene) {}

  /** A stain of `size` metres on the ground at (x, y, z). */
  add(x: number, y: number, z: number, size: number): void {
    if (this.list.length >= BLOOD.maxStains) this.drop(this.list[0]!);
    const material = new THREE.MeshStandardMaterial({
      map: this.textures[Math.floor(Math.random() * this.textures.length)]!,
      transparent: true,
      depthWrite: false,
      roughness: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(this.geo, material);
    mesh.position.set(x, y + 0.015, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(size);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.list.push({ mesh, material, age: 0 });
  }

  private drop(d: Decal): void {
    this.scene.remove(d.mesh);
    d.material.dispose();
    this.list = this.list.filter((x) => x !== d);
  }

  update(dt: number): void {
    for (const d of [...this.list]) {
      d.age += dt;
      // Full colour for a while, then it fades and is gone after BLOOD.lifetime.
      const fadeStart = BLOOD.lifetime - BLOOD.fade;
      d.material.opacity =
        d.age < fadeStart ? 0.9 : Math.max(0, 0.9 * (1 - (d.age - fadeStart) / BLOOD.fade));
      if (d.age >= BLOOD.lifetime) this.drop(d);
    }
  }
}
