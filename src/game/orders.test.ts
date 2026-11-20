import { describe, it, expect } from 'vitest';
import { complianceChance, radialPick, type ComplyCtx } from './orders';

const base: ComplyCtx = { role: 'civilian', nerve: 0.5, gunAimed: false, gunOut: false, hurt: false, heat: 0, dist: 4 };
describe('order compliance', () => {
  it('police and gang members never comply', () => {
    for (const role of ['police', 'gang'] as const) expect(complianceChance('kneel', { ...base, role, gunAimed: true })).toBe(0);
  });
  it('a gun in the face works on most civilians, bare hands on few', () => {
    expect(complianceChance('kneel', { ...base, gunAimed: true })).toBeGreaterThan(0.8);
    expect(complianceChance('kneel', base)).toBeLessThan(0.2);
    expect(complianceChance('kneel', { ...base, gunAimed: true, nerve: 1 })).toBeGreaterThan(0.6);
  });
  it('timid people obey more than brave ones; far away or a car ride is harder', () => {
    expect(complianceChance('kneel', { ...base, nerve: 0 })).toBeGreaterThan(complianceChance('kneel', { ...base, nerve: 1 }));
    expect(complianceChance('kneel', { ...base, gunAimed: true, dist: 14 })).toBeLessThan(complianceChance('kneel', { ...base, gunAimed: true }));
    expect(complianceChance('car', { ...base, gunAimed: true })).toBeLessThan(complianceChance('kneel', { ...base, gunAimed: true }));
  });
  it('"beat it" is always welcome, "get out" nearly always obeyed', () => {
    expect(complianceChance('beat', base)).toBe(1);
    expect(complianceChance('out', base)).toBeGreaterThanOrEqual(0.9);
  });
  it('stays in 0..0.97', () => {
    const p = complianceChance('kneel', { ...base, gunAimed: true, hurt: true, heat: 5, nerve: 0 });
    expect(p).toBeLessThanOrEqual(0.97); expect(p).toBeGreaterThan(0.9);
  });
});
describe('radial menu pick', () => {
  it('maps pointer directions to entries clockwise from the top', () => {
    expect(radialPick(4, 0, -40)).toBe(0); expect(radialPick(4, 40, 0)).toBe(1); expect(radialPick(4, 0, 40)).toBe(2); expect(radialPick(4, -40, 0)).toBe(3);
    expect(radialPick(5, 0, -40)).toBe(0);
  });
  it('ignores a pointer inside the dead zone', () => { expect(radialPick(4, 3, 3)).toBe(-1); });
});
