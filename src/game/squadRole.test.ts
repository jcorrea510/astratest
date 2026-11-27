import { describe, it, expect } from 'vitest';
import { chooseSquadRole } from './police';

const tally = (hp: number) => { const c: Record<string, number> = {}; for (let i = 0; i < 120; i++) { const r = chooseSquadRole(i, hp); c[r] = (c[r] ?? 0) + 1; } return c; };
describe('chooseSquadRole', () => {
  it('mixes roles for regular officers: 1/3 flanker, 1/4 suppressor, some breacher, rest default', () => {
    const c = tally(100);
    expect(c.flanker).toBe(40); expect(c.suppressor).toBe(30); expect(c.breacher).toBeGreaterThan(0); expect(c.default).toBeGreaterThan(0);
  });
  it('heavily armed officers breach most often', () => {
    const h = tally(150), r = tally(100);
    expect(h.breacher).toBeGreaterThan(r.breacher); expect(h.breacher).toBeGreaterThanOrEqual(h.flanker);
  });
  it('is deterministic and tolerates negative sequence numbers', () => {
    expect(chooseSquadRole(5, 100)).toBe(chooseSquadRole(5, 100));
    expect(chooseSquadRole(-1, 100)).toBeDefined();
  });
});
