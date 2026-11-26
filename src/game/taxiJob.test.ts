import { describe, it, expect } from 'vitest';
import { jobFare, pickFareDest } from './taxiJob';
import { taxiFare, skipFare } from './taxiRide';

describe('Round 7 taxis', () => {
  it('a taxi job pays more for longer trips and tips a quick drive', () => {
    expect(jobFare(500, 999).fare).toBeGreaterThan(jobFare(250, 999).fare);
    expect(jobFare(400, 999).tip).toBe(0);
    expect(jobFare(400, 30).tip).toBeGreaterThan(0);
    expect(jobFare(400, 30).fare + jobFare(400, 30).tip).toBeGreaterThanOrEqual(40); // a starting player earns real money
  });
  it('riding as a passenger costs a flag drop plus distance; skipping costs extra', () => {
    expect(taxiFare(0)).toBe(4);
    expect(taxiFare(1000)).toBe(24);
    expect(skipFare(500)).toBeGreaterThan(0);
  });
  it('a fare always gets a drop-off when one kerb lane in a thousand is in range (it used to give up after 60 random tries)', () => {
    const lane = (x: number, kerb = true) => ({ points: [{ x, z: 0 }, { x, z: 100 }], cum: [0, 100], length: 100, lane: kerb ? 1 : 0, lanes: 2 });
    const lanes = [...Array.from({ length: 999 }, (_, i) => lane(i % 2 ? 50 : 2000)), lane(400)];
    for (let k = 0; k < 20; k++) {
      const d = pickFareDest(lanes, { x: 0, z: 50 }, Math.random);
      expect(d).not.toBeNull(); expect(d!.x).toBe(400); expect(d!.z).toBeCloseTo(50);
    }
    // nothing in the ring: the farthest kerb lane under 650 m rather than no fare at all
    expect(pickFareDest([lane(50), lane(120), lane(120, false), lane(2000)], { x: 0, z: 50 })!.x).toBe(120);
    expect(pickFareDest([lane(2000)], { x: 0, z: 50 })).toBeNull();
  });
});
