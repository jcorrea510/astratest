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
import { HEADLIGHT_CD, headlightAt } from './vehicles';
import { HEAD_LENS, BEAM_OPACITY } from '../vehicles/vehicle';
describe('Round 13 (owner: "headlights shine too bright when reflecting, it\'s hard to see")', () => {
  it('the low-beam pool is a few times the street lighting near the car and fades out by ~25 m, not a blinding patch', () => {
    const old = (d: number) => 420 / Math.pow(d, 1.1);
    expect(headlightAt(5)).toBeLessThan(old(5) / 2.5);
    expect(headlightAt(10)).toBeLessThan(12);
    expect(headlightAt(25)).toBeLessThan(2);
    expect(headlightAt(5)).toBeGreaterThan(8); // still lights the road in front of the car
    expect(HEADLIGHT_CD).toBeLessThan(420);
  });
  it('the headlamp lens and the painted road pool are toned down too', () => {
    expect(HEAD_LENS).toBeLessThan(2.2);
    expect(BEAM_OPACITY).toBeLessThanOrEqual(0.25);
  });
});
