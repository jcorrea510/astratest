import { it, expect } from 'vitest';
import { envRebuildDue } from './renderer';
it('the sky reflection map is rebuilt about every 45 real seconds, not every 6 (Round 8 hitch)', () => {
  expect(envRebuildDue(12, -99)).toBe(true);
  expect(envRebuildDue(12.1, 12)).toBe(false);
  expect(envRebuildDue(12.5, 12)).toBe(false);
  expect(envRebuildDue(12.8, 12)).toBe(true);
  expect(envRebuildDue(0.3, 23.5)).toBe(true); // across midnight
  expect(envRebuildDue(20, 12)).toBe(true); // the sandbox set the clock
});
