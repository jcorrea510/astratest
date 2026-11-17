import { describe, it, expect } from 'vitest';
import { Inventory, WEAPONS, falloffAt } from './weapons';

describe('weapon tuning', () => {
  it('damage falls off with range', () => {
    expect(falloffAt(WEAPONS.shotgun, 5)).toBe(1);
    expect(falloffAt(WEAPONS.shotgun, 40)).toBeCloseTo(0.2);
    expect(falloffAt(WEAPONS.rifle, 100)).toBeLessThan(1);
    expect(falloffAt(WEAPONS.rifle, 100)).toBeGreaterThan(0.75);
  });
  it('shotgun reloads shell by shell and can be interrupted', () => {
    const inv = new Inventory(); inv.give('shotgun', 12); inv.select('shotgun'); inv.cooldown = 0;
    inv.fire(); inv.cooldown = 0; inv.fire(); inv.cooldown = 0;
    expect(inv.state.clip).toBe(4);
    expect(inv.startReload()).toBe(true);
    inv.tick(WEAPONS.shotgun.reloadStart + WEAPONS.shotgun.shellReload + 0.01);
    expect(inv.state.clip).toBe(5); expect(inv.reloading).toBe(true); expect(inv.shellsLoaded).toBe(1);
    expect(inv.fire()).toBe(true); // interrupts the reload
    expect(inv.reloading).toBe(false); expect(inv.state.clip).toBe(4);
  });
  it('automatic weapons hold their cyclic rate at 30 fps', () => {
    const inv = new Inventory(); inv.give('smg', 200); inv.select('smg'); inv.cooldown = 0;
    let shots = 0; for (let f = 0; f < 30; f++) { inv.tick(1 / 30); if (inv.fire()) shots++; }
    expect(shots).toBeGreaterThanOrEqual(13); // ~1 s at 0.07 s per round (frame-quantised)
  });
});
