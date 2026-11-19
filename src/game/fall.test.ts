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
