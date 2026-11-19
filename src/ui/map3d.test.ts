import { describe, expect, it } from 'vitest';
import { Buildings3D } from './map3d';
import { generateCity } from '../world/citymap';

describe('Buildings3D', () => {
  const city = generateCity();
  const b = new Buildings3D(city);
  it('has one extruded building per lot, with sane heights and footprints', () => {
    expect(b.list.length).toBe(city.lots.length);
    for (const x of b.list) { expect(x.h).toBeGreaterThanOrEqual(5); expect(x.p.length).toBe(8); }
    expect(Math.max(...b.list.map(x => x.h))).toBeGreaterThan(60);
  });
  it('sorts back to front along the view axis', () => {
    const o = b.sorted(0.5), s = Math.sin(0.5), c = Math.cos(0.5);
    for (let i = 1; i < o.length; i++) expect(o[i].cx * s + o[i].cz * c).toBeGreaterThanOrEqual(o[i - 1].cx * s + o[i - 1].cz * c);
  });
});
