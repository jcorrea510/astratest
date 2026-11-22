import { describe, it, expect } from 'vitest';
import { adaptStep, newDyn } from './renderer';

/** Round 8: on the Mac, driving at 30-40 fps froze ~every second: the adaptive resolution resized (reallocating every
 * full-screen buffer) on each crossing of 33 ms, and the resize's own stall made it cross again. */
describe('adaptive resolution never thrashes', () => {
  it('frame times wobbling around 33 ms with periodic hitches resize at most once per 6 s', () => {
    const s = newDyn(); s.scale = 0.8; let now = 0, resizes = 0;
    for (let i = 0; i < 60 * 40; i++) { const dt = i % 45 === 0 ? 180 : 28 + (i % 7) * 2.2; now += dt; if (adaptStep(s, dt, now, true)) resizes++; }
    expect(resizes).toBeLessThanOrEqual(Math.ceil(now / 6000));
    expect(resizes).toBeLessThanOrEqual(3);
  });
  it('a single long hitch does not change the resolution', () => {
    const s = newDyn(); let now = 0, resizes = 0;
    for (let i = 0; i < 600; i++) { const dt = i === 300 ? 240 : 16; now += dt; if (adaptStep(s, dt, now, true)) resizes++; }
    expect(resizes).toBe(0);
  });
  it('still steps down under sustained load and back up with headroom', () => {
    const s = newDyn(); let now = 0;
    for (let i = 0; i < 60 * 30; i++) { now += 30; adaptStep(s, 30, now, true); }
    expect(s.scale).toBeLessThan(1);
    const low = s.scale;
    for (let i = 0; i < 60 * 60; i++) { now += 11; adaptStep(s, 11, now, true); }
    expect(s.scale).toBeGreaterThan(low);
  });
});
