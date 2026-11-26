import { describe, expect, it } from 'vitest';
import { boxDistXZ, chunkCull } from './farLod';

const box = { minX: 0, maxX: 128, minZ: 0, maxZ: 128, maxY: 10 };
describe('chunk culling (R14)', () => {
  it('box distance is 0 inside and tighter than a sphere for corners', () => {
    expect(boxDistXZ(box, 50, 50)).toBe(0);
    expect(boxDistXZ(box, 138, 64)).toBe(10);
    expect(boxDistXZ(box, 131, 132)).toBe(5);
  });
  it('casts only near the player; small chunks cast less far', () => {
    expect(chunkCull(box, 0, 0, 200, 64, 500, 54, false).cast).toBe(false);
    expect(chunkCull(box, 0, 0, 160, 64, 500, 54, false).cast).toBe(true);
    expect(chunkCull(box, 0, 0, 160, 64, 500, 54, true).cast).toBe(true);
    expect(chunkCull(box, 0, 0, 180, 64, 500, 54, true).cast).toBe(false);
  });
  it('tall chunks keep casting from further away; invisible never casts', () => {
    const tall = { ...box, maxY: 150 };
    expect(chunkCull(tall, 0, 0, 200, 64, 500, 54, false).cast).toBe(true);
    expect(chunkCull(tall, 900, 0, 900, 64, 500, 54, false)).toEqual({ visible: false, cast: false });
  });
});

import { chunkCull as cc, FINE_REACH, HYST } from './farLod';
describe('building LOD hysteresis', () => {
  const box = { minX: 100, maxX: 110, minZ: 0, maxZ: 10, maxY: 20 };
  it('a visible fine chunk stays visible 8% past its reach, a hidden one waits', () => {
    const x = 100 - FINE_REACH * 1.04;
    expect(cc(box, x, 5, x, 5, FINE_REACH, 60, true, true).visible).toBe(true);
    expect(cc(box, x, 5, x, 5, FINE_REACH, 60, true, false).visible).toBe(false);
    expect(HYST).toBeGreaterThan(1);
  });
});
