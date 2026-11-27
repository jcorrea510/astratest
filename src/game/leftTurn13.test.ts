import { it, expect } from 'vitest';
import { mayClearLeft, leftClearing, willStopForSignal, LEFT_CLEAR_MIN, LEFT_PATIENCE, BOX_EDGE, signalCap } from './trafficRules';

// Round 13 (owner: "cars aren't going on green lights, the ones in the left lane")
it('the left turner first at its line takes the amber to turn (it got only the first 0.8 s of a 3 s amber)', () => {
  expect(mayClearLeft('yellow', 2.0, 0.6, 0)).toBe(true); // 2 s of amber left: old rule (yl > 2.2) held it
  expect(mayClearLeft('yellow', 1.6, -1.5, 0.5)).toBe(true);
  expect(mayClearLeft('yellow', LEFT_CLEAR_MIN - 0.1, 0.6, 0)).toBe(false); // too late to reach the box before the red
  expect(mayClearLeft('green', 10, 0.6, 0)).toBe(false); // on green the normal gap check applies
  expect(mayClearLeft('red', 2, 0.6, 0)).toBe(false); // never starts on red
  expect(mayClearLeft('yellow', 2.5, 8, 0)).toBe(false); // not first at the line
  expect(mayClearLeft('yellow', 2.5, -BOX_EDGE, 0)).toBe(false);
});
it('oncoming cars stopping for their own amber no longer block the turn; ones that cannot stop still do', () => {
  expect(willStopForSignal('yellow', 40, 14, 2.5)).toBe(true); // 40 m out at 14 m/s: brakes for the amber
  expect(willStopForSignal('red', 12, 6)).toBe(true);
  expect(willStopForSignal('yellow', 8, 14, 2.5)).toBe(false); // dilemma zone: carries on through, so it still counts
  expect(signalCap('yellow', 8, 14, 2.5)).toBe(Infinity);
  expect(willStopForSignal('green', 40, 14)).toBe(false);
  expect(willStopForSignal('red', -3, 8)).toBe(false); // already in the box
});
it('patience on green is about half a cycle, not three cycles', () => {
  expect(LEFT_PATIENCE).toBeLessThanOrEqual(20);
});

it('a left turner still standing behind its line when the red comes waits for green (it kept its amber go)', () => {
  expect(leftClearing('yellow', 2.0, 0.6, 0, false)).toBe(true); // takes the amber from the line
  expect(leftClearing('red', 0, 0.9, 0, true)).toBe(false); // held behind the line, now red: stays
  expect(leftClearing('red', 0, -2, 3, true)).toBe(true); // already over the line: finishes the turn
  expect(leftClearing('red', 0, 0.4, 3, true)).toBe(true); // rolling over the line as it turns red: committed
  expect(leftClearing('green', 9, 0.5, 0, true)).toBe(false);
});
