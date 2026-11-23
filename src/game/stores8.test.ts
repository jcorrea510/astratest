import { describe, it, expect } from 'vitest';
import { clerkFightChance } from './storeExtras';

describe('Round 8 stores', () => {
  it('a punched clerk usually fights back (gun-store clerks almost always)', () => {
    expect(clerkFightChance('convenience')).toBeGreaterThan(0.5);
    expect(clerkFightChance('guns')).toBeGreaterThan(clerkFightChance('convenience'));
  });
});

import { boxLoot } from './storeExtras';
it('Round 9: a deposit box holds $250-$900 (x Regular multiplier)', () => {
  expect(boxLoot(0)).toBe(250); expect(boxLoot(1)).toBe(900); expect(boxLoot(0.5, 1.6)).toBeGreaterThan(800);
});
