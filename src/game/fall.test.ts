import { describe, it, expect } from 'vitest';
import { fallDamage } from './player';

describe('fall damage', () => {
  it('is zero for hops and curb drops, hurts from a few metres, kills from rooftops', () => {
    expect(fallDamage(8)).toBe(0);     // a jump back down
    expect(fallDamage(14)).toBe(0);    // ~2.8 m drop
    expect(fallDamage(18)).toBeGreaterThan(15);
    expect(fallDamage(18)).toBeLessThan(40);
    expect(fallDamage(30)).toBeGreaterThanOrEqual(100); // terminal-ish: lethal at 100 health
  });
  it('a forward roll soaks up part of it', () => { expect(fallDamage(22, true)).toBeLessThan(fallDamage(22)); });
});

import { MOVE, fallImpactScale } from './player';
describe('realistic gravity', () => {
  it('a standing jump peaks near half a metre to three quarters and a 5 m drop still hurts', () => {
    const g = MOVE.gravity, v = MOVE.jumpSpeed, band = 1.5;
    const h = (v * v - band * band) / (2 * g) + (band * band) / (2 * g * MOVE.hangScale);
    expect(h).toBeGreaterThan(0.45); expect(h).toBeLessThan(0.8);
    const impact = Math.sqrt(2 * MOVE.gravity * MOVE.fallScale * 5);
    expect(fallDamage(impact * fallImpactScale())).toBeGreaterThan(15);
    expect(fallDamage(Math.sqrt(2 * MOVE.gravity * MOVE.fallScale * 2.5) * fallImpactScale())).toBe(0);
  });
});
