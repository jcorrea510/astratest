import { describe, it, expect } from 'vitest';
import { decapitates } from './combat';
import { WEAPONS } from './weapons';
import { BLEED_MAX, BLOOD_SPLAT_MAX, BLOOD_POOL_MAX } from '../render/blood';

describe('gore (Round 7)', () => {
  it('heavy rounds can take a head off, pistols and fists cannot', () => {
    expect(decapitates(WEAPONS.shotgun)).toBe(true);
    expect(decapitates(WEAPONS.sniper)).toBe(true);
    expect(decapitates(WEAPONS.pistol)).toBe(false);
    expect(decapitates(WEAPONS.fists)).toBe(false);
  });
  it('gore budgets stay hard-capped (Round 9)', () => {
    expect(BLEED_MAX).toBeLessThanOrEqual(12); expect(BLOOD_SPLAT_MAX).toBeLessThanOrEqual(400); expect(BLOOD_POOL_MAX).toBeLessThanOrEqual(40);
  });
});
