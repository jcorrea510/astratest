import { describe, it, expect } from 'vitest';
import { Inventory, WEAPONS, WEAPON_ORDER, CATEGORY_ORDER, falloffAt } from './weapons';

describe('weapon defs', () => {
  it('has 18+ guns across every wheel category, each with original names and sane numbers', () => {
    const guns = WEAPON_ORDER.filter(id => !WEAPONS[id].melee && WEAPONS[id].cat !== 'throw');
    expect(guns.length).toBeGreaterThanOrEqual(15);
    for (const c of CATEGORY_ORDER) expect(WEAPON_ORDER.some(id => WEAPONS[id].cat === c)).toBe(true);
    const names = new Set(WEAPON_ORDER.map(id => WEAPONS[id].name)); expect(names.size).toBe(WEAPON_ORDER.length);
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id]; expect(w.id).toBe(id);
      if (w.melee) continue;
      expect(w.clip).toBeGreaterThan(0); expect(w.interval).toBeGreaterThan(0); expect(w.range).toBeGreaterThan(10);
      expect(w.auto).toBe(w.mode === 'auto');
      if (w.mode === 'burst') expect(w.burst).toBeGreaterThan(1);
    }
    expect(WEAPONS.sniper.scope).toBeGreaterThan(0); expect(WEAPONS.marksman.scope).toBeGreaterThan(0);
    expect(WEAPONS.rpg.projectile).toBe('rocket'); expect(WEAPONS.grenade.projectile).toBe('frag');
  });
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
    expect(shots).toBeGreaterThanOrEqual(12);
  });
  it('burst weapons fire exactly a burst per trigger pull', () => {
    const inv = new Inventory(); inv.give('carbine', 90); inv.select('carbine'); inv.cooldown = 0;
    inv.pull(); let shots = 0;
    for (let f = 0; f < 30; f++) { inv.tick(1 / 60); if (inv.burstLeft > 0 && inv.fire()) shots++; }
    expect(shots).toBe(3);
  });
  it('category picks and scrolling, throwables count down and disappear', () => {
    const inv = new Inventory(); inv.give('pistol', 30); inv.give('revolver', 12); inv.give('grenade', 2);
    expect(inv.inCategory('pistol')).toEqual(['pistol', 'revolver']);
    expect(inv.categoryPick('pistol')).toBe('pistol');
    expect(inv.cycleCategory('pistol', 1)).toBe('revolver'); expect(inv.categoryPick('pistol')).toBe('revolver');
    expect(inv.select('grenade')).toBe(true); expect(inv.total()).toBe(2);
    inv.cooldown = 0; expect(inv.fire()).toBe(true); inv.tick(1); inv.cooldown = 0; expect(inv.fire()).toBe(true);
    expect(inv.total()).toBe(0); expect(inv.owned()).not.toContain('grenade');
  });
  it('loads old saves with unknown / missing weapons', () => {
    const inv = new Inventory(); inv.load({ weapons: { pistol: { owned: true, clip: 5, reserve: 10 }, laser: { owned: true, clip: 1, reserve: 1 } }, current: 'pistol' });
    expect(inv.current).toBe('pistol'); expect(inv.weapons.sniper.owned).toBe(false); expect(inv.weapons.fists.owned).toBe(true);
  });
});
