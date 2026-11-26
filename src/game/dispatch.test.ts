import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Dispatch } from './dispatch';
import { generateCity, ARMY_BASE, samplePath } from '../world/citymap';
import { DISPATCH_HOLD, CALL_DELAY } from './police';

const city = generateCity();
const D = new Dispatch(city, {} as never, {} as never, {} as never);
const at = (kind: 'army' | 'tank' | 'police' | 'swat') => {
  const o = D.originLane(kind)!; const sp = { x: 0, z: 0, dx: 0, dz: 0 }; samplePath(o.lane, o.s, sp); return sp;
};
describe('dispatch origins', () => {
  it('army and tank start at the Fort Calder gate, not near the player', () => {
    for (const k of ['army', 'tank'] as const) {
      const p = at(k);
      expect(Math.hypot(p.x - ARMY_BASE.x1, p.z - ARMY_BASE.gateZ)).toBeLessThan(60);
    }
  });
  it('police and swat roll out from the precinct', () => {
    expect(Math.hypot(at('swat').x - 22.8, at('swat').z - 113.9)).toBeLessThan(40);
  });
  it('army takes over 30 s to reach downtown', () => {
    expect(D.eta('army', new THREE.Vector3(0, 0, 0))).toBeGreaterThan(30);
  });
  it('no unit can reach the scene within 15 s of the first crime', () => {
    expect(CALL_DELAY.civ[0] + DISPATCH_HOLD).toBeGreaterThanOrEqual(15);
    expect(CALL_DELAY.cop + DISPATCH_HOLD).toBeGreaterThanOrEqual(15);
  });
});

import { HELI_MIN_DIST, REINFORCE_MIN, reinforceHidden, heliSpawnY } from './dispatch';
import { HeatState } from './police';
describe('police helicopter arrival', () => {
  it('enters far from the player, never inside the camera view, heading in from the precinct side', () => {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    for (const [px, pz, yaw] of [[0, 0, 0], [300, -200, 2], [40, 108, 4], [-400, 500, 1]]) {
      const p = new THREE.Vector3(px, 0, pz);
      cam.position.set(px, 2, pz); cam.rotation.set(0, yaw, 0); cam.updateMatrixWorld(); cam.updateMatrixWorld(true);
      const sp = D.heliSpawnPoint(p, cam);
      expect(Math.hypot(sp.x - p.x, sp.z - p.z)).toBeGreaterThanOrEqual(HELI_MIN_DIST - 0.01);
      const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      expect(f.containsPoint(sp)).toBe(false);
    }
  });
  it('a convoy gate 1 km away may sit inside the camera frustum (beyond the draw distance): it is still hidden, so the army really starts at Fort Calder', () => {
    expect(reinforceHidden(1100, 1100, true)).toBe(true);
    expect(reinforceHidden(300, 300, true)).toBe(false); // on screen at street range
    expect(reinforceHidden(300, 300, false)).toBe(true);
    expect(reinforceHidden(60, 60, false)).toBe(false); // too near
  });
  it('enters above any tower under its spawn point (it was wrecked inside a 130 m block on the first step and respawned every frame)', () => {
    expect(heliSpawnY(56, [0, 0, 0, 0, 0])).toBe(56); // open ground: the default altitude
    expect(heliSpawnY(56, [20, 137, 90, 0, 40])).toBe(137 + 14); // clears the tallest rooftop under the rotor disc
    expect(heliSpawnY(56, [])).toBe(56);
  });
  it('reinforcements keep a minimum distance bigger than the street view', () => { expect(REINFORCE_MIN).toBeGreaterThanOrEqual(120); });
});
describe('brandishing a gun at an officer', () => {
  it('is worth two stars straight away', () => { const h = new HeatState(); h.add('brandish'); expect(h.heat).toBe(2); });
});

describe('arrest scene with a dead officer (CI: dead officers kept forever)', () => {
  it('ends the scene and releases the officer instead of keeping the corpse persistent', () => {
    const stops: string[] = [];
    const cop = { alive: false, persistent: true, brain: 'arrest', char: { isDisposed: false, human: { stopAction: (n: string) => stops.push(n) } } };
    const d = Object.create(Dispatch.prototype) as Dispatch;
    Object.assign(d, { arrest: { cop, t: 1, tase: false, pre: 2, yaw: 0, base: new THREE.Vector3() }, pendingArrest: null, dragT: 0 });
    const player = { health: 10, maxHealth: 100 } as never;
    d.updateArrest(1 / 30, player);
    expect(d.arrest).toBeNull();
    expect(cop.persistent).toBe(false);
    expect((player as { health: number }).health).toBe(10); // the dead officer's scene no longer touches the suspect
  });
});
