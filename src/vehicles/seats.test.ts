import { describe, it, expect } from 'vitest';
import { seatsFor, SHAPES } from './shapes';
import type { VehicleKind } from './specs';

describe('seats (Round 8)', () => {
  it('2-door drivers sit as close to the windshield as a sedan driver, not at the rear bench', () => {
    const gap = (k: VehicleKind) => SHAPES[k].gh!.zA - seatsFor(k)[0].z;
    const ref = gap('sedan');
    for (const k of ['coupe', 'muscle', 'convertible', 'super'] as VehicleKind[]) {
      expect(gap(k), k).toBeLessThan(ref + 0.2);
      expect(SHAPES[k].gh!.zR1 - seatsFor(k)[0].z, `${k} head under the roof`).toBeGreaterThan(0.05);
    }
  });
  it('rear bench stays behind the front seats', () => {
    for (const k of ['coupe', 'muscle', 'convertible', 'sedan'] as VehicleKind[]) {
      const s = seatsFor(k); if (s.length > 2) expect(s[2].z, k).toBeLessThan(s[0].z - 0.5);
    }
  });
});
