import { it, expect } from 'vitest';
import * as THREE from 'three';
import { assignLights, lightScore, LightPool } from './lightPool';

// Round 11 (owner: Medium ran at 30 fps on an M1 Air): 14 always-on point lights became a pool of a few real ones
it('scores fall with distance past the range and are 0 for dark or far lights', () => {
  expect(lightScore(0, 1, 1, 20)).toBe(0);
  expect(lightScore(28, 1, 5, 22)).toBeGreaterThan(lightScore(28, 1, 40, 22));
  expect(lightScore(28, 1, 200, 22)).toBe(0);
  expect(lightScore(10, 3, 10, 12)).toBeGreaterThan(lightScore(10, 1, 10, 12));
});
it('the best n lights win; a holder keeps its light unless clearly beaten (no flicker between equal lamps)', () => {
  expect(assignLights([5, 9, 1, 7], [-1, -1])).toEqual([1, 3]);
  expect(assignLights([5, 9, 1, 6.5], [0, 1])).toEqual([0, 1]); // 6.5 is not 1.35x better than 5
  expect(assignLights([5, 9, 1, 8], [0, 1])).toEqual([3, 1]);
  expect(assignLights([0, 9, 1, 0], [0, 3])).toEqual([1, 2]); // dark holders give their lights up
});
it('the scene only ever holds the pool lights, whatever the number of virtual ones', () => {
  const scene = new THREE.Scene(), pool = new LightPool(scene); pool.setCount(3);
  const v = Array.from({ length: 12 }, (_, i) => { const l = new THREE.PointLight(0xffffff, 10, 20, 1.6); l.position.set(i * 5, 3, 0); return pool.add(l); });
  pool.update(new THREE.Vector3(0, 0, 0));
  let n = 0; scene.traverse(o => { if ((o as THREE.PointLight).isPointLight) n++; }); expect(n).toBe(3);
  const lit = pool.real.map(r => r.position.x).sort((a, b) => a - b); expect(lit).toEqual([0, 5, 10]);
  v[0].intensity = 0; pool.update(new THREE.Vector3(0, 0, 0));
  expect(pool.real.map(r => r.position.x).sort((a, b) => a - b)).toEqual([5, 10, 15]);
});
