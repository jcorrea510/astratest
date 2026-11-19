import { describe, expect, it } from 'vitest';
import { generateCity, surfaceAt } from '../world/citymap';
import { safeSavePos } from './save';
import { PLACES } from './places';

const home = { x: PLACES.safehouse.x, z: PLACES.safehouse.z, yaw: 1 };

describe('safeSavePos', () => {
  const city = generateCity();
  const surf = (x: number, z: number) => surfaceAt(city, x, z);
  it('keeps a valid street / pavement position', () => {
    const r = safeSavePos({ x: home.x, z: home.z, yaw: 0.5 }, surf, home);
    expect(surf(home.x, home.z)).toMatch(/road|sidewalk|park/);
    expect(r.moved).toBe(false);
  });
  it('moves a position inside a building lot onto valid ground', () => {
    let lot: { x: number; z: number } | null = null;
    for (const b of city.blocks) { const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2; if (surf(x, z) === 'lot') { lot = { x, z }; break; } }
    expect(lot).not.toBeNull();
    const r = safeSavePos({ ...lot!, yaw: 2 }, surf, home);
    expect(r.moved).toBe(true);
    expect(['road', 'sidewalk', 'park']).toContain(surf(r.x, r.z));
    expect(Math.hypot(r.x - lot!.x, r.z - lot!.z)).toBeLessThan(160);
    expect(r.yaw).toBe(2);
  });
  it('falls back to the safehouse in the open sea or on NaN', () => {
    expect(safeSavePos({ x: 99999, z: 99999, yaw: 0 }, surf, home)).toMatchObject({ x: home.x, z: home.z, moved: true });
    expect(safeSavePos({ x: NaN, z: 0, yaw: 0 }, surf, home).moved).toBe(true);
  });
});
