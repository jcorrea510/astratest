import { describe, it, expect } from 'vitest';
import { pedActivity, carActivity, isNight, districtNightFactor } from './schedule';
describe('schedule', () => {
  it('is quiet at 3 AM and busy at rush hour', () => {
    expect(pedActivity(3)).toBeLessThan(0.2); expect(pedActivity(18)).toBeGreaterThan(0.95);
    expect(carActivity(3)).toBeLessThan(0.3); expect(carActivity(17.5)).toBeGreaterThan(0.95);
    expect(pedActivity(27)).toBeCloseTo(pedActivity(3));
  });
  it('night and nightlife', () => {
    expect(isNight(23)).toBe(true); expect(isNight(12)).toBe(false);
    expect(districtNightFactor('strand', 23)).toBeGreaterThan(districtNightFactor('financial', 23));
    expect(districtNightFactor('financial', 12)).toBe(1);
  });
});
