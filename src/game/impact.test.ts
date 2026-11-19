import { describe, it, expect } from 'vitest';
import { pedImpact, MPH } from './impact';

describe('pedestrian vehicle impacts', () => {
  it('above 25 mph is lethal at every roll, 15 mph hurts without always killing', () => {
    for (const r of [0, 0.5, 1]) expect(pedImpact(26 * MPH, 0, r).damage).toBeGreaterThanOrEqual(100);
    const d15 = pedImpact(15 * MPH, 0, 0.5).damage;
    expect(d15).toBeGreaterThan(25); expect(d15).toBeLessThan(80);
    expect(pedImpact(5 * MPH).damage).toBeLessThan(15);
  });
  it('scales the launch: brush, aside, onto the hood, over the car', () => {
    expect(pedImpact(2).outcome).toBe('brush');
    expect(pedImpact(5.5).outcome).toBe('aside');
    expect(pedImpact(10).outcome).toBe('hood');
    expect(pedImpact(16).outcome).toBe('over');
    expect(pedImpact(16).up).toBeGreaterThan(pedImpact(10).up);
    expect(pedImpact(10, 0.9).outcome).toBe('aside'); // clipped by the corner: knocked aside
    expect(pedImpact(10, -0.9).side).toBeLessThan(0);
  });
  it('dents the car on a real hit', () => {
    expect(pedImpact(12).carDamage).toBeGreaterThan(25);
    expect(pedImpact(3).carDamage).toBeLessThan(25);
  });
});
