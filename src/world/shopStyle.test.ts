import { describe, it, expect } from 'vitest';
import { shopStyleOfBrand } from './shopStyle';
import { BRANDS } from '../render/materials';
describe('shop interior style follows the sign', () => {
  it('laundry signs get the laundromat style (11), liquor gets liquor (2), every brand maps', () => {
    const i = (n: string) => BRANDS.findIndex(b => b.name === n);
    expect(shopStyleOfBrand(i('ORBIT LAUNDRY'))).toBe(11);
    expect(shopStyleOfBrand(i('SUDS & DUDS'))).toBe(11);
    expect(shopStyleOfBrand(i('HARBOR LIQUOR'))).toBe(2);
    expect(shopStyleOfBrand(i('GOLDLEAF JEWELERS'))).toBe(3);
    for (let k = 0; k < BRANDS.length; k++) expect(shopStyleOfBrand(k)).toBeGreaterThanOrEqual(0);
  });
});
