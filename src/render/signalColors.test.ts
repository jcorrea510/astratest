import { describe, it, expect } from 'vitest';
import { signalLampColors } from './signalColors';

describe('signal lamp colours (Round 7: Low showed white lights)', () => {
  it('without bloom every lamp keeps its hue after clipping to [0,1]', () => {
    const c = signalLampColors(false), clip = (v: number) => Math.min(1, v);
    for (const col of [c.red, c.yellow, c.green]) for (const v of [col.r, col.g, col.b]) expect(v).toBeLessThanOrEqual(1);
    expect(clip(c.red.r) - Math.max(c.red.g, c.red.b)).toBeGreaterThan(0.5);
    expect(clip(c.green.g) - Math.max(c.green.r, c.green.b)).toBeGreaterThan(0.4);
    expect(c.yellow.r - c.yellow.b).toBeGreaterThan(0.5); expect(c.yellow.g - c.yellow.b).toBeGreaterThan(0.4);
  });
  it('the old HDR green clips to near white, which is why Low needs its own set', () => {
    const g = signalLampColors(true).green; expect(Math.min(1, g.r) + Math.min(1, g.g) + Math.min(1, g.b)).toBeGreaterThan(2.9);
  });
});
