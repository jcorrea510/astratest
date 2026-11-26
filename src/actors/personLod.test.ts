import { describe, it, expect } from 'vitest';
import { bodyLodFor, extrasLodFor, BODY_LOD_TRIS } from './animLod';

describe('person detail LOD', () => {
  it('steps down with distance and has hysteresis', () => {
    expect(bodyLodFor(3, 0)).toBe(0);
    expect(bodyLodFor(9, 0)).toBe(0);
    expect(bodyLodFor(10, 0)).toBe(1);
    expect(bodyLodFor(7.5, 1)).toBe(1);
    expect(bodyLodFor(6.5, 1)).toBe(0);
    expect(bodyLodFor(30, 0)).toBe(2);
    expect(bodyLodFor(200, 0)).toBe(3);
    expect(bodyLodFor(1, 3)).toBe(0);
  });
  it('triangle budget falls steeply per level', () => {
    for (let i = 2; i < BODY_LOD_TRIS.length; i++) expect(BODY_LOD_TRIS[i]).toBeLessThanOrEqual(BODY_LOD_TRIS[i - 1] / 2);
    expect(BODY_LOD_TRIS[3]).toBeLessThanOrEqual(600);
  });
  it('extras: full near, cheap mid, none far or hidden', () => {
    expect(extrasLodFor(5, true, 0)).toBe(0);
    expect(extrasLodFor(20, true, 0)).toBe(1);
    expect(extrasLodFor(13, true, 1)).toBe(1);
    expect(extrasLodFor(40, true, 1)).toBe(2);
    expect(extrasLodFor(33, true, 2)).toBe(2);
    expect(extrasLodFor(5, false, 0)).toBe(2);
    expect(extrasLodFor(5, true, 2)).toBe(0);
  });
});
