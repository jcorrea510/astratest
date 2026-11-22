import { it, expect } from 'vitest';
import { panicRadiusScale } from './population';
it('sustained shooting spreads the panic further (Round 8: people should run like crazy)', () => {
  expect(panicRadiusScale(1)).toBe(1);
  expect(panicRadiusScale(3)).toBeGreaterThan(1.2);
  expect(panicRadiusScale(8)).toBeGreaterThan(panicRadiusScale(3));
});
