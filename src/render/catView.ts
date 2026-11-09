// A small cat made from simple shapes (the rooftop rescue).

import * as THREE from 'three';

export function makeCat(): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xe08a3c, roughness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf6efe4, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), fur);
  body.scale.set(0.8, 0.75, 1.3);
  body.position.y = 0.25;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), white);
  chest.position.set(0, 0.24, 0.2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), fur);
  head.position.set(0, 0.45, 0.28);
  const ears = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 8), fur);
    e.position.set(s * 0.08, 0.59, 0.27);
    return e;
  });
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dark);
    e.position.set(s * 0.055, 0.47, 0.41);
    return e;
  });
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.45, 8), fur);
  tail.position.set(0, 0.42, -0.3);
  tail.rotation.x = -0.6;
  tail.name = 'tail';
  const legs = [
    [-0.08, 0.16],
    [0.08, 0.16],
    [-0.08, -0.16],
    [0.08, -0.16],
  ].map(([x, z]) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 6), white);
    l.position.set(x!, 0.09, z!);
    return l;
  });
  g.add(body, chest, head, ...ears, ...eyes, tail, ...legs);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Wag the tail and bob a little. */
export function animateCat(cat: THREE.Group, t: number): void {
  const tail = cat.getObjectByName('tail');
  if (tail) tail.rotation.z = Math.sin(t * 4) * 0.5;
  cat.position.y += Math.sin(t * 3) * 0.002;
}
