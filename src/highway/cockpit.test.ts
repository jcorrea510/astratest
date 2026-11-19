import { describe, it, expect } from 'vitest';
import { wheelFrac, needleAngle, WHEEL_LOCK_RAD } from './cockpit';

describe('cockpit gauges and wheel', () => {
  it('wheel lock is +-450 degrees (2.5 turns lock to lock)', () => {
    expect((WHEEL_LOCK_RAD * 180) / Math.PI).toBeCloseTo(450, 5);
  });
  it('wheel turns clearly even at highway speed where the road-wheel lock is tiny', () => {
    expect(wheelFrac(0.03, 1)).toBeCloseTo(0.2, 5);
    expect(wheelFrac(-0.03, -1)).toBeCloseTo(-0.2, 5);
    expect(wheelFrac(0.9, 1)).toBeCloseTo(0.9, 5);
    expect(wheelFrac(0, 0)).toBe(0);
  });
  it('needles sweep 270 degrees and clamp', () => {
    expect(needleAngle(0) - needleAngle(1)).toBeCloseTo((270 * Math.PI) / 180, 5);
    expect(needleAngle(2)).toBe(needleAngle(1));
  });
});
