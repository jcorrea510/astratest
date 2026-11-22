import { describe, it, expect } from 'vitest';
import { decapitates } from './combat';
import { WEAPONS } from './weapons';

describe('gore (Round 7)', () => {
  it('heavy rounds can take a head off, pistols and fists cannot', () => {
    expect(decapitates(WEAPONS.shotgun)).toBe(true);
    expect(decapitates(WEAPONS.sniper)).toBe(true);
    expect(decapitates(WEAPONS.pistol)).toBe(false);
    expect(decapitates(WEAPONS.fists)).toBe(false);
  });
});
