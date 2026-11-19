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
