import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Crumpler, type CrumpleInfo } from './crumple';

/** A flat grid of triangles facing +z (front face of a car) at z = 2, 3 m wide, 1.2 m tall. */
function frontWall() {
  const P: number[] = [], N: number[] = [], S: number[] = [];
  const nx = 24, ny = 10, w = 3, h = 1.2;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x0 = -w / 2 + (i / nx) * w, x1 = -w / 2 + ((i + 1) / nx) * w, y0 = 0.2 + (j / ny) * h, y1 = 0.2 + ((j + 1) / ny) * h;
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) { P.push(x, y, 2); N.push(0, 0, 1); S.push(0, 0, 0, 0); }
  }
  const pos = new THREE.BufferAttribute(new Float32Array(P), 3), nrm = new THREE.BufferAttribute(new Float32Array(N), 3);
  const orig = new Float32Array(P);
  const info: CrumpleInfo = { orig, skin: new Uint16Array(S), skip: new Set(), front: 2, rear: -2, halfW: 0.9, hoodZ0: 0.6, deckY: 0.8, bumperTop: 0.5 };
  return { pos, nrm, info, orig };
}

describe('Crumpler', () => {
  it('pushes vertices near the contact inward by more than 5 cm and leaves far ones alone', () => {
    const { pos, nrm, info, orig } = frontWall();
    const c = new Crumpler(info, pos, nrm);
    const moved = c.hit(new THREE.Vector3(0, 0.6, 2), new THREE.Vector3(0, 0, -1), 0.4);
    expect(moved).toBeGreaterThan(20);
    const P = pos.array as Float32Array;
    let best = 0, far = 0;
    for (let i = 0; i < P.length; i += 3) {
      const d = Math.hypot(P[i] - orig[i], P[i + 1] - orig[i + 1], P[i + 2] - orig[i + 2]);
      if (Math.hypot(orig[i], orig[i + 1] - 0.6) < 0.3) best = Math.max(best, d); if (Math.abs(orig[i]) > 1.3) far = Math.max(far, d);
    }
    expect(best).toBeGreaterThan(0.05);
    expect(best).toBeLessThanOrEqual(0.55 + 1e-4);
    expect(far).toBe(0);
  });
  it('clamps repeated hits to the maximum displacement and keeps normals unit length', () => {
    const { pos, nrm, info } = frontWall();
    const c = new Crumpler(info, pos, nrm);
    for (let i = 0; i < 40; i++) c.hit(new THREE.Vector3(0, 0.6, 2), new THREE.Vector3(0, 0, -1), 1.4);
    expect(c.maxDisplacement()).toBeLessThanOrEqual(0.55 + 1e-3);
    const N = nrm.array as Float32Array;
    for (let i = 0; i < N.length; i += 3) expect(Math.hypot(N[i], N[i + 1], N[i + 2])).toBeCloseTo(1, 3);
  });
  it('a frontal hit raises hood and bumper state and buckles the hood up', () => {
    const { pos, nrm, info, orig } = frontWall();
    const c = new Crumpler(info, pos, nrm);
    c.hit(new THREE.Vector3(0, 0.6, 2), new THREE.Vector3(0, 0, -1), 1);
    expect(c.hood).toBeGreaterThan(0.3); expect(c.bumperF).toBeGreaterThan(0.3);
    const before = Array.from(pos.array as Float32Array);
    c.panels(1);
    const P = pos.array as Float32Array;
    let changed = 0; for (let i = 0; i < P.length; i++) if (Math.abs(P[i] - before[i]) > 1e-5) changed++;
    expect(changed).toBeGreaterThan(0);
    void orig;
  });
  it('a 40 mph hit moves panels at most ~0.38 m and never flips a normal away from its original side', () => {
    const { pos, nrm, info } = frontWall();
    const c = new Crumpler(info, pos, nrm);
    c.hit(new THREE.Vector3(0, 0.6, 2), new THREE.Vector3(0, 0, -1), 1.2);
    expect(c.maxDisplacement()).toBeLessThanOrEqual(0.4);
    const N = nrm.array as Float32Array;
    for (let i = 0; i < N.length; i += 3) expect(N[i + 2]).toBeGreaterThan(0.2);
  });
});
