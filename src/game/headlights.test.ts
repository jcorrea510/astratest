import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickHeadlightCars } from './vehicles';

const car = (x: number) => ({ headOn: true, destroyed: false, position: new THREE.Vector3(x, 0, 0) });
describe('headlight beams (Round 8: reflections flickered at night)', () => {
  it('a car keeps its beam while another is only slightly nearer (no hopping)', () => {
    const a = car(30), b = car(28), L = new THREE.Vector3();
    expect(pickHeadlightCars([a, b], [a], L, null, 1)).toEqual([a]);
    expect(pickHeadlightCars([a, b], [b], L, null, 1)).toEqual([b]);
  });
  it('a clearly nearer car takes it over; the player car always has one', () => {
    const a = car(60), b = car(20), me = car(80), L = new THREE.Vector3();
    expect(pickHeadlightCars([a, b], [a], L, null, 1)).toEqual([b]);
    expect(pickHeadlightCars([a, b, me], [a, b], L, me, 1)).toEqual([me]);
  });
});
