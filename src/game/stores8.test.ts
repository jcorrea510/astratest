import { describe, it, expect } from 'vitest';
import { clerkFightChance } from './storeExtras';

describe('Round 8 stores', () => {
  it('a punched clerk usually fights back (gun-store clerks almost always)', () => {
    expect(clerkFightChance('convenience')).toBeGreaterThan(0.5);
    expect(clerkFightChance('guns')).toBeGreaterThan(clerkFightChance('convenience'));
  });
});
