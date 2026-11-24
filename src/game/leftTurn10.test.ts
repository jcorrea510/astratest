import { it, expect } from 'vitest';
import { signalCap, lineStop, oncomingConflict, stopSpeed, BOX_EDGE, PEDAL_LAG, MAX_DECEL } from './trafficRules';

// Round 10 (owner: "cars run red lights when trying to make left turns, which causes a lot of the crashes")
it('a car that rolled over the bar on red stops on the crosswalk when it can, instead of entering the junction', () => {
  expect(signalCap('red', -1.5, 3.2)).toBe(0); // was Infinity: "across the line and rolling" let it through
  expect(signalCap('red', -1.5, 4.5)).toBe(0);
  // one that truly cannot stop short of the box carries on (stopping in the middle is worse)
  const v = 7; expect(v * v / (2 * MAX_DECEL)).toBeGreaterThan(-2 + BOX_EDGE - 0.3);
  expect(signalCap('red', -2, v)).toBe(Infinity);
  expect(signalCap('red', -BOX_EDGE - 1, 3)).toBe(Infinity); // already in the box: clear it
});
it('a left turner (amber treated as "stop if you can") stops for the amber instead of slowing into the red', () => {
  expect(signalCap('yellow', 5, 8, 0)).toBeLessThan(8); // committed before (8 m/s * 2.5 s amber reaches the line)
  expect(signalCap('yellow', 5, 8, 2.5)).toBe(Infinity);
});
it('the stop curve allows for the pedal lag, so the car halts at the bar and not 1-2 m past it', () => {
  expect(lineStop(0.4)).toBe(0);
  expect(lineStop(1.2)).toBe(0); // the last ~metre is braked to a standstill
  expect(lineStop(20)).toBeCloseTo(stopSpeed(19.6) - PEDAL_LAG, 5);
  expect(signalCap('red', 1.2, 2)).toBe(0);
});
it('left-turn gap check sees an oncoming car 4 s out on a fast road (it ignored anything past 60 m)', () => {
  expect(oncomingConflict(0, 70, 0, -1, 16, 0, 1)).toBe(true);
  expect(oncomingConflict(8.5, 40, 0, -1, 12, 0, 1)).toBe(true); // Broadway's far lane
  expect(oncomingConflict(15, 40, 0, -1, 12, 0, 1)).toBe(false); // a parallel street
});
