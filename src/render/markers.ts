// Floating markers: crime beacons, golden shurikens and the shuriken projectiles.

import * as THREE from 'three';

/** A four-point throwing star. */
export function shurikenGeometry(size = 0.25): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const points = 4;
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? size : size * 0.32;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, size * 0.12, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: size * 0.12,
    bevelEnabled: true,
    bevelSize: size * 0.04,
    bevelThickness: size * 0.04,
    bevelSegments: 1,
  });
  g.center();
  return g;
}

/** Tall glowing column that marks a crime from far away. */
export function makeBeacon(color: THREE.ColorRepresentation): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(1.2, 1.2, 140, 16, 1, true);
  geo.translate(0, 70, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying float vY; varying vec2 vUv; void main(){ vY = position.y; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uTime; varying float vY; varying vec2 vUv;
      void main(){ float a = (1.0 - smoothstep(0.0, 140.0, vY)) * 0.55; a *= 0.7 + 0.3 * sin(vY * 0.25 - uTime * 4.0); gl_FragColor = vec4(uColor * 2.0, a); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

export function updateBeacon(m: THREE.Mesh, time: number): void {
  (m.material as THREE.ShaderMaterial).uniforms['uTime']!.value = time;
}
