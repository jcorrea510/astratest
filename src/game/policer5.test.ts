import { describe, it, expect } from 'vitest';
import { isSpeeding, ranRedLight, HeatState } from './police';
import { signalState } from '../world/citymap';

const inter = { id: 0, ix: 0, iz: 0, x: 0, z: 0, halfX: 8, halfZ: 8, offset: 0, signalized: true };
describe('traffic violations', () => {
  it('speeding means more than 15 mph (6.7 m/s) over the limit', () => {
    expect(isSpeeding(14 + 5, 14)).toBe(false);
    expect(isSpeeding(14 + 7, 14)).toBe(true);
    expect(isSpeeding(-30, 14)).toBe(true);
  });
  it('running a red light = entering the junction box on red, not on green', () => {
    let tRed = -1, tGreen = -1;
    for (let t = 0; t < 200 && (tRed < 0 || tGreen < 0); t += 0.5) { const s = signalState(inter, 'z', t); if (s === 'red' && tRed < 0) tRed = t; if (s === 'green' && tGreen < 0) tGreen = t; }
    const city = { intersections: [inter] };
    expect(ranRedLight(city, 0, -12, 0, -6, tRed)).toBe(true);
    expect(ranRedLight(city, 0, -12, 0, -6, tGreen)).toBe(false);
    expect(ranRedLight(city, 0, -6, 0, -2, tRed)).toBe(false); // already inside
  });
  it('a witnessed traffic violation is one star', () => {
    const h = new HeatState(); h.add('traffic'); expect(h.heat).toBe(1);
  });
  it('the search timer does not run while the player is seen (helicopter spotlight counts)', () => {
    const h = new HeatState(); h.add('copAttack');
    const p = { x: 0, y: 0, z: 0, distanceTo: () => 1000 } as never;
    for (let i = 0; i < 100; i++) h.tick(1, true, p);
    expect(h.heat).toBe(2); expect(h.unseenT).toBe(0);
    let lost = false; for (let i = 0; i < 60 && !lost; i++) lost = h.tick(1, false, p);
    expect(lost).toBe(true);
  });
});
