import { describe, it, expect } from 'vitest';
import { projectedRadiusPx, AO_DEFAULT } from './post';
import { QUALITY } from '../core/settings';

describe('Round 12 post effects', () => {
  it('AO radius shrinks with distance', () => {
    const near = projectedRadiusPx(1, -5, 1.6, 720), far = projectedRadiusPx(1, -50, 1.6, 720);
    expect(near).toBeCloseTo(far * 10, 5);
  });
  it('AO is off on Low and fades out before the fog', () => {
    expect(QUALITY.low.ao).toBe(0);
    expect(QUALITY.medium.ao).toBeGreaterThan(0);
    expect(QUALITY.high.ao).toBeGreaterThanOrEqual(QUALITY.medium.ao);
    expect(AO_DEFAULT.fadeFar).toBeLessThan(QUALITY.medium.drawDistance);
  });
});
