import { describe, it, expect } from 'vitest';
import { ATTRACT_SHOTS, shotCamera } from './attract';
import { generateCity } from '../world/citymap';

const city = generateCity();

/** True when the world point (x,y,z) is inside a building lot's box (lots rotate about their centre). */
function insideLot(x: number, y: number, z: number): boolean {
  for (const l of city.lots) {
    if (y > l.height || l.height < 4) continue;
    const dx = x - l.x, dz = z - l.z, c = Math.cos(-l.rot), s = Math.sin(-l.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < l.w / 2 && Math.abs(lz) < l.d / 2) return true;
  }
  return false;
}

describe('title flyover', () => {
  it('has shots with sane timing and fov', () => {
    expect(ATTRACT_SHOTS.length).toBeGreaterThanOrEqual(5);
    for (const s of ATTRACT_SHOTS) { expect(s.duration).toBeGreaterThan(6); expect(s.fov).toBeGreaterThan(35); expect(s.fov).toBeLessThan(70); }
  });
  it('never puts the camera inside a building or a wall in its first 18 m of view', () => {
    for (const s of ATTRACT_SHOTS) {
      for (let t = 0; t <= s.duration; t += 0.5) {
        const c = shotCamera(s, t);
        const d = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        for (let m = 0; m <= 18; m += 1.5) {
          const k = m / len;
          expect(insideLot(c.pos[0] + d[0] * k, c.pos[1] + d[1] * k, c.pos[2] + d[2] * k), `${s.name} t=${t} m=${m}`).toBe(false);
        }
      }
    }
  });
  it('first shot is a wide establishing view, not a close wall', () => {
    const s = ATTRACT_SHOTS[0], c = shotCamera(s, 0);
    expect(Math.hypot(c.look[0] - c.pos[0], c.look[2] - c.pos[2])).toBeGreaterThan(150);
  });
});
