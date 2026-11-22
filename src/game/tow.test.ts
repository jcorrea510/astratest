import { it, expect } from 'vitest';
import { towAbandoned } from './traffic';
it('an abandoned car in a driving lane is towed out of sight; kerb-parked or visible ones stay (Round 8)', () => {
  expect(towAbandoned(20, 60, false, () => 0.4)).toBe(true);
  expect(towAbandoned(20, 60, false, () => 1.4)).toBe(false); // at the kerb
  expect(towAbandoned(20, 60, true, () => 0.4)).toBe(false); // the player can see it
  expect(towAbandoned(20, 20, false, () => 0.4)).toBe(false); // right next to the player
  expect(towAbandoned(5, 60, false, () => 0.4)).toBe(false); // only just stopped
});
