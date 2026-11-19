import { describe, it, expect } from 'vitest';
import { bulletDrop, flightTime, isShallow, muzzleVelocity, penetration, reflect, roundPower } from './ballistics';
import { WEAPONS } from './weapons';

describe('ballistics', () => {
  it('rifles and snipers drop at range, pistols stay hitscan', () => {
    const sn = muzzleVelocity(WEAPONS.sniper), pi = muzzleVelocity(WEAPONS.pistol ?? Object.values(WEAPONS).find(w => w.cat === 'pistol')!);
    expect(sn).toBeGreaterThan(700); expect(pi).toBe(0);
    expect(bulletDrop(sn, 40)).toBe(0);
    expect(bulletDrop(sn, 300)).toBeGreaterThan(0.5);
    expect(bulletDrop(720, 300)).toBeGreaterThan(bulletDrop(sn, 300));
    expect(flightTime(sn, 300)).toBeGreaterThan(0.3);
  });
  it('penetrates glass, wood and car panels but not masonry', () => {
    const rifle = roundPower(WEAPONS.carbine), pellet = roundPower(WEAPONS.shotgun ?? Object.values(WEAPONS).find(w => w.cat === 'shotgun')!);
    expect(penetration('glass', 5).pass).toBe(true);
    expect(penetration('wood', rifle)).toMatchObject({ pass: true });
    expect(penetration('vehicle', rifle).pass).toBe(true);
    expect(penetration('vehicle', rifle).mul).toBeLessThan(0.7);
    expect(penetration('vehicle', 10).pass).toBe(false);
    expect(penetration('concrete', 999).pass).toBe(false);
    expect(penetration('vehicle', pellet).pass).toBe(false);
  });
  it('detects grazing angles and reflects', () => {
    expect(isShallow(1, -0.1, 0, 0, 1, 0)).toBe(true);
    expect(isShallow(0, -1, 0, 0, 1, 0)).toBe(false);
    const o = { x: 0, y: 0, z: 0 }; reflect({ x: 1, y: -0.2, z: 0 }, { x: 0, y: 1, z: 0 }, o);
    expect(o.y).toBeCloseTo(0.2); expect(o.x).toBe(1);
  });
});
