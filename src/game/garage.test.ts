import { describe, it, expect } from 'vitest';
import { repairPrice, GARAGE_PAINTS } from './garage';

describe('garages (Round 7)', () => {
  it('repairs cost more the worse the car is; a perfect car costs nothing', () => {
    expect(repairPrice(1)).toBe(0);
    expect(repairPrice(0.9)).toBeLessThan(repairPrice(0.3));
    expect(repairPrice(1, true)).toBeGreaterThan(0);
  });
  it('offers a dozen distinct named colours', () => {
    expect(GARAGE_PAINTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(GARAGE_PAINTS.map(p => p[0])).size).toBe(GARAGE_PAINTS.length);
  });
});
