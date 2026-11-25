import { describe, it, expect } from 'vitest';
import { skipFarTick, farIdleVehicle, farParkedHeli } from './farLod';

describe('far logic LOD', () => {
  it('near agents never skip; far agents run once every N ticks, staggered by id', () => {
    for (let t = 0; t < 12; t++) expect(skipFarTick(10 * 10, 50, 4, t, 3)).toBe(false);
    const far = 200 * 200;
    let ran = 0; for (let t = 0; t < 40; t++) if (!skipFarTick(far, 50, 4, t, 1)) ran++;
    expect(ran).toBe(10);
    // two agents with different ids do not run on the same ticks
    const a: number[] = [], b: number[] = [];
    for (let t = 0; t < 8; t++) { if (!skipFarTick(far, 50, 4, t, 0)) a.push(t); if (!skipFarTick(far, 50, 4, t, 1)) b.push(t); }
    expect(a.some(t => b.includes(t))).toBe(false);
  });
  it('only far, slow, undriven vehicles may sleep', () => {
    expect(farIdleVehicle(1000 * 1000, 0.3)).toBe(true);
    expect(farIdleVehicle(100 * 100, 0)).toBe(false); // near: stays live
    expect(farIdleVehicle(1000 * 1000, 30 * 30)).toBe(false); // rolling fast: leave it alone
  });
  it('a parked chopper far away skips flight code; a running or wrecked one does not', () => {
    const parked = { engineOn: false, destroyed: false, rotor: 0, driver: null };
    expect(farParkedHeli(900 * 900, parked)).toBe(true);
    expect(farParkedHeli(50 * 50, parked)).toBe(false);
    expect(farParkedHeli(900 * 900, { ...parked, engineOn: true })).toBe(false);
    expect(farParkedHeli(900 * 900, { ...parked, rotor: 0.4 })).toBe(false);
    expect(farParkedHeli(900 * 900, { ...parked, driver: {} })).toBe(false);
  });
});
