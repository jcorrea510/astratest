import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { signalLampColors, signalOffColors } from './signalColors';

/** three's AgX-free stand-in for "does it keep its hue": channel ratio after a Reinhard-style roll-off. */
const tm = (c: THREE.Color) => [c.r, c.g, c.b].map(v => v / (1 + v));

describe('signal lamp colours', () => {
  it('Round 7: without bloom every lamp keeps its hue after clipping to [0,1]', () => {
    const c = signalLampColors(false), clip = (v: number) => Math.min(1, v);
    for (const col of [c.red, c.yellow, c.green]) for (const v of [col.r, col.g, col.b]) expect(v).toBeLessThanOrEqual(1);
    expect(clip(c.red.r) - Math.max(c.red.g, c.red.b)).toBeGreaterThan(0.5);
    expect(clip(c.green.g) - Math.max(c.green.r, c.green.b)).toBeGreaterThan(0.4);
    expect(c.yellow.r - c.yellow.b).toBeGreaterThan(0.5); expect(c.yellow.g - c.yellow.b).toBeGreaterThan(0.4);
  });
  it('Round 13 (owner: "traffic lights look bad in the daytime"): by day a lit lamp stays a saturated colour, not a white blob', () => {
    const c = signalLampColors(true, 0);
    const [r, g, b] = tm(c.red); expect(r - Math.max(g, b)).toBeGreaterThan(0.6);
    const [gr, gg, gb] = tm(c.green); expect(gg - gr).toBeGreaterThan(0.55); expect(gg).toBeGreaterThan(gb);
    const [yr, yg, yb] = tm(c.yellow); expect(yr).toBeGreaterThan(yg); expect(yg - yb).toBeGreaterThan(0.4);
    for (const col of [c.red, c.yellow, c.green]) expect(Math.max(col.r, col.g, col.b)).toBeLessThan(4); // the old 14 washed out
  });
  it('at night the lamps are brighter (bloom halo) than by day', () => {
    expect(signalLampColors(true, 1).red.r).toBeGreaterThan(signalLampColors(true, 0).red.r * 1.8);
  });
  it('unlit lenses are tinted glass (red, amber, green), darker at night', () => {
    const [r, a, g] = signalOffColors(0);
    expect(r.r).toBeGreaterThan(r.g * 3); expect(a.r).toBeGreaterThan(a.b * 3); expect(g.g).toBeGreaterThan(g.r * 2);
    expect(signalOffColors(1)[0].r).toBeLessThan(r.r);
  });
});
