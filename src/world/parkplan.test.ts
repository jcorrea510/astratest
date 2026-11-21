import { describe, it, expect } from 'vitest';
import { generateCity } from './citymap';
import { Rng } from '../core/rng';
import { planPark, onLake, isLakeBlock, LAKE_POOLS } from './parkplan';

describe('park lake placement', () => {
  const city = generateCity();
  const lakeBlock = city.blocks.find(isLakeBlock)!;
  it('the city has the lake park', () => { expect(lakeBlock).toBeTruthy(); });
  it('no bench, lamp, shrub or path piece sits on the water (any seed)', () => {
    for (let seed = 0; seed < 40; seed++) {
      const p = planPark(lakeBlock, new Rng(seed * 31 + 7));
      expect(p.lake).toBe(true);
      for (const b of p.benches) expect(onLake(p.cx, p.cz, b.x, b.z, 1.6), `bench ${b.x},${b.z}`).toBe(false);
      for (const l of p.lights) expect(onLake(p.cx, p.cz, l.x, l.z, 1), 'lamp').toBe(false);
      for (const s of p.shrubs) expect(onLake(p.cx, p.cz, s.x, s.z, 0.5), 'shrub').toBe(false);
      // path boxes: sample along each piece; every sample (and its half-width) is dry
      for (const [a, b] of p.pathsX) for (let x = a; x <= b; x += 0.5) for (const dz of [-2.1, 0, 2.1]) expect(onLake(p.cx, p.cz, x, p.cz + dz), `east-west path ${x}`).toBe(false);
      for (const [a, b] of p.pathsZ) for (let z = a; z <= b; z += 0.5) for (const dx of [-2.1, 0, 2.1]) expect(onLake(p.cx, p.cz, p.cx + dx, z), `north-south path ${z}`).toBe(false);
    }
  });
  it('the paths are cut by the lake and the lake sits inside its park', () => {
    const p = planPark(lakeBlock, new Rng(7));
    expect(p.pathsX.length).toBeGreaterThanOrEqual(2); expect(p.pathsZ.length).toBeGreaterThanOrEqual(2);
    for (const [dx, dz, r] of LAKE_POOLS) { expect(Math.abs(dx) + r).toBeLessThan((lakeBlock.x1 - lakeBlock.x0) / 2 - 4); expect(Math.abs(dz) + r).toBeLessThan((lakeBlock.z1 - lakeBlock.z0) / 2 - 4); }
  });
  it('other parks keep their full cross paths and benches', () => {
    for (const b of city.blocks) if (b.kind === 'park' && !isLakeBlock(b)) { const p = planPark(b, new Rng(3)); expect(p.pathsX).toHaveLength(1); expect(p.benches.length).toBe(10); }
  });
});
