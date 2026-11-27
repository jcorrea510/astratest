import { describe, expect, it } from 'vitest';
import { NECK_SURFACE_MAX, neckRadius, topHem } from './humanMaterial';
import { HOOD_TUCK, hoodOffset } from './humanAssets';

// Round 14 regressions (owner, people close-ups): jagged hoodie collar with skin poking through, ragged hoodie hem.
describe('garment edges', () => {
  it('collarless necklines clear the neck surface so the neck never flips between skin and cloth', () => {
    for (const t of ['tee', 'longsleeve', 'hoodie'] as const) expect(neckRadius(t)).toBeGreaterThan(NECK_SURFACE_MAX + 0.004);
  });
  it('long tops end above the torso/leg region border (measured leg top ~0.17 of the torso)', () => {
    for (const t of ['hoodie', 'jacket', 'suit', 'tee', 'longsleeve'] as const) expect(topHem(t, 0.276, 0.173)).toBeGreaterThan(0.173);
    expect(topHem('dress', 0.276, 0.173)).toBeLessThan(0); // the skirt piece carries a dress
    expect(topHem('shirt', 0.276, 0.173)).toBeCloseTo(0.256, 5); // short-hemmed tops unchanged
  });
  it('the hood stays on the back, below the neckline, with every border tucked under the hoodie (0.02 thick)', () => {
    expect(hoodOffset(true, 0.95, 0.5)).toBe(-1); // front
    expect(hoodOffset(true, 1.02, -0.8)).toBe(-1); // neck skin
    expect(hoodOffset(false, 0.95, -0.8)).toBe(-1); // arm
    for (const [c, nz] of [[0.801, -0.8], [0.994, -0.8], [0.95, 0.049]]) expect(hoodOffset(true, c, nz)).toBeLessThan(0.02);
    expect(hoodOffset(true, 0.95, -0.8)).toBeGreaterThan(HOOD_TUCK + 0.03); // a soft roll in the middle
  });
});
