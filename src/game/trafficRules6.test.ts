import { describe, it, expect } from 'vitest';
import { signalCap, stopSignCap, stopSpeed, turnSide, oncomingConflict, MAX_DECEL } from './trafficRules';

/** Simulates a car braking to the cap each step (decel limited to 7 m/s²) and returns where it ends relative to the line. */
function approach(state: 'red' | 'yellow', d0: number, v0: number) {
  let d = d0, v = v0;
  for (let i = 0; i < 2000; i++) {
    const cap = signalCap(state, d, v);
    v += Math.max(-7 / 30, Math.min(2.6 / 30, Math.min(cap, 14) - v)); v = Math.max(0, v);
    d -= v / 30; if (v < 0.01 && cap < 1) break;
  }
  return d;
}
describe('signal stopping', () => {
  it('green never limits', () => expect(signalCap('green', 3, 15)).toBe(Infinity));
  it('a car at speed halts before the line on red from any sensible distance', () => {
    for (const v of [6, 10, 13]) for (const d of [stopSpeed(0) + (v * v) / (2 * 6) + 1, 40, 70]) expect(approach('red', d, v)).toBeGreaterThan(-0.6);
  });
  it('amber: a car that can stop does, one in the dilemma zone clears', () => {
    expect(signalCap('yellow', 30, 12)).toBeLessThan(Infinity);
    expect(signalCap('yellow', 8, 13)).toBe(Infinity); // 13²/11 = 15 m needed
    expect(signalCap('yellow', 25, 13)).toBeLessThan(Infinity);
    expect(MAX_DECEL).toBeGreaterThan(3);
  });
  it('a car that overshot the line and stands still stays put on red; a rolling one clears the box', () => {
    expect(signalCap('red', -3, 0.2)).toBe(0);
    expect(signalCap('red', -3, 6)).toBe(Infinity);
    expect(signalCap('red', -9, 0.2)).toBe(Infinity);
  });
});
describe('stop signs', () => {
  it('halts, waits a beat, goes when clear, never deadlocks', () => {
    expect(stopSignCap(20, 10, 0, true)).toBeGreaterThan(5);
    expect(stopSignCap(0.4, 0.1, 0, true)).toBe(0);
    expect(stopSignCap(0.4, 0, 1, true)).toBe(0);
    expect(stopSignCap(0.4, 0, 1.6, false)).toBe(0);
    expect(stopSignCap(0.4, 0, 1.6, true)).toBe(Infinity);
    expect(stopSignCap(0.4, 0, 6.5, false)).toBe(Infinity);
  });
});
describe('left turns', () => {
  it('classifies turns (x is left of a +z heading)', () => {
    expect(turnSide(0, 1, 1, 0)).toBe(1); // +x is the driver's left when heading +z (game convention)
    expect(turnSide(0, 1, -1, 0)).toBe(-1);
    expect(turnSide(0, 1, 0, 1)).toBe(0);
  });
  it('waits for a fast oncoming car, ignores slow, departed or off-axis ones', () => {
    expect(oncomingConflict(0, 25, 0, -1, 12, 0, 1)).toBe(true);
    expect(oncomingConflict(0, 25, 0, -1, 3, 0, 1)).toBe(false); // would take 8 s
    expect(oncomingConflict(0, -10, 0, -1, 12, 0, 1)).toBe(false); // already past
    expect(oncomingConflict(15, 25, 0, -1, 12, 0, 1)).toBe(false); // other street
    expect(oncomingConflict(0, 25, 0, 1, 12, 0, 1)).toBe(false); // same direction
  });
});

import { describe as d2, it as i2, expect as e2 } from 'vitest';
import { signalCap as sc2 } from './trafficRules';
d2('R6-T amber timing', () => {
  i2('late amber that would turn red before the line: brakes hard instead of running it', () => {
    // 20 m out at 8 m/s cannot stop comfortably, would need 2.5 s but only 0.5 s of amber is left
    e2(sc2('yellow', 5.5, 8, 0.4)).toBeLessThan(Infinity);
    e2(sc2('yellow', 4, 8, 2)).toBe(Infinity); // reaches the line in time
    e2(sc2('yellow', 3, 12, 0.1)).toBe(Infinity); // genuinely too close to stop at any rate
  });
});
import { spawnSafeAtSignal as safeSpawn } from './trafficRules';
d2('R6-T spawn at signals', () => {
  i2('no spawning into a changing light close to the line', () => {
    e2(safeSpawn('yellow', 'red', 30)).toBe(false);
    e2(safeSpawn('green', 'red', 30)).toBe(false);
    e2(safeSpawn('green', 'green', 30)).toBe(true);
    e2(safeSpawn('red', 'red', 100)).toBe(true);
  });
});
