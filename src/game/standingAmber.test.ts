import { describe, it, expect } from 'vitest';
import { signalCap, skipSignalNearTarget, BOX_EDGE } from './trafficRules';

describe('standing start on amber (traffic6 bus that entered the junction after the red)', () => {
  it('a standing car whose centre is past its stop point, short of the box, holds when the amber is nearly spent', () => {
    expect(signalCap('yellow', -(BOX_EDGE + 0.6), 0, 1.0)).toBe(0); // the bus: dStop -5.5, 1 s of amber left
    expect(signalCap('yellow', -2, 0.3, 3)).toBe(0);
  });
  it('still goes with plenty of amber, from green, or when already rolling', () => {
    expect(signalCap('yellow', -2, 0, 6)).toBe(Infinity);
    expect(signalCap('green', -2, 0, 1)).toBe(Infinity);
    expect(signalCap('yellow', -2, 4, 1)).toBe(Infinity); // rolling: the dilemma-zone rule applies, not the standing hold
  });
});

describe('goto car near its target still obeys a close stop line (bus creeping through red, lane 600)', () => {
  it('signals apply within 25 m of the line, not mid-block', () => {
    expect(skipSignalNearTarget(2.6)).toBe(false);
    expect(skipSignalNearTarget(-5.5)).toBe(false);
    expect(skipSignalNearTarget(60)).toBe(true);
  });
});
