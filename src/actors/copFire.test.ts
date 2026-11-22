import { describe, it, expect } from 'vitest';
import { npcFireTiming } from './npc';

describe('police fire cadence (Round 8: cops shot far too slowly)', () => {
  it('a cop with a pistol fires at least ~2 rounds a second on average', () => {
    for (const r of [0, 0.5, 0.99]) {
      const t = npcFireTiming(true, false, 0.18, 0, r);
      const cycle = (t.burst - 1) * t.between + t.pause;
      expect(t.burst / cycle, `r=${r}`).toBeGreaterThan(2);
    }
  });
  it('gang members keep the slower, looser cadence', () => {
    const t = npcFireTiming(false, false, 0.18, 0, 0.5);
    expect(t.burst).toBe(1); expect(t.pause).toBeGreaterThan(1);
  });
});
