/** Wheel / small-part geometry guarantees (R13-W6): proportions, caliper placement, per-kind triangle budget. */
import { describe, it, expect, vi } from 'vitest';
import { getTemplate } from './build';
import { wheelSoup, caliperSoup, mirrorSoup, handleSoup, wiperSoup, exhaustTip, antennaSoup } from './parts';
import { SHAPES } from '../shapes';
import { VEHICLES, type VehicleKind } from '../specs';
import { K } from './kinds';
import type { Soup } from './soup';

function bounds(s: Soup) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < s.d.length; i += 14) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], s.d[i + k]); b.max[k] = Math.max(b.max[k], s.d[i + k]); }
  return b;
}
/** high-LOD body triangles before the R13-W6 parts pass */
const BASE: Record<string, number> = {
  crossover: 35744, citycar: 35110, sportsedan: 33954, hatch: 35009, sedan: 33572, fullsize: 36423, luxury: 39829, wagon: 36787, coupe: 32012, muscle: 38061,
  super: 31314, convertible: 30657, pickup: 32879, suv: 36184, minivan: 35758, van: 36004, race: 32138, taxi: 35319, police: 39067, fbi: 38764, swat: 33681, army: 37516, bus: 34411, tank: 9602,
};

describe('wheel and parts geometry', () => {
  for (const kind of Object.keys(VEHICLES) as VehicleKind[]) {
    const s = SHAPES[kind];
    it(`${kind}: wheel fills its arch with correct proportions`, () => {
      const w = wheelSoup(s, 0), b = bounds(w);
      expect(b.max[1] - b.min[1]).toBeGreaterThan(s.R * 1.98); expect(b.max[1] - b.min[1]).toBeLessThan(s.R * 2.02);
      expect(b.max[2] - b.min[2]).toBeGreaterThan(s.R * 1.98);
      expect(b.max[0] - b.min[0]).toBeGreaterThan(s.tw * 0.98); expect(b.max[0] - b.min[0]).toBeLessThan(s.tw + 0.06); // tyre width, rim lip slightly proud
      expect(w.tris).toBeLessThan(2400); // R14 budget: ~50% of the R13 wheel (3.0-5.0k)
      expect(w.d.every(Number.isFinite)).toBe(true);
    });
    it(`${kind}: brake caliper sits inside the tyre, only behind open alloy spokes`, () => {
      const c = caliperSoup(s);
      if (['hubcap', 'steel', 'truck'].includes(s.rim) || s.type === 'tank') { expect(c.tris).toBe(0); return; }
      expect(c.tris).toBeGreaterThan(40);
      const b = bounds(c), rr = s.R * 0.8;
      expect(Math.max(Math.abs(b.min[1]), Math.abs(b.max[1]), Math.abs(b.min[2]), Math.abs(b.max[2]))).toBeLessThan(rr);
      expect(b.max[0]).toBeLessThan(s.tw / 2 - 0.03); expect(b.min[0]).toBeGreaterThan(-s.tw / 2);
    });
    it(`${kind}: model stays within 1.3x of the pre-pass triangle count`, { timeout: 60000 }, () => {
      const hi = getTemplate(kind).lods[0].body.attributes.position.count / 3;
      expect(hi).toBeLessThan(BASE[kind] * 1.3);
    });
  }
  it('wheel uv contract: tread v in 0..1, sidewall v = 2 + x/hw', () => {
    const s = SHAPES.sedan, w = wheelSoup(s, 0);
    let tread = 0, side = 0;
    for (let i = 0; i < w.d.length; i += 14) {
      if (w.d[i + 12] !== K.RUBBER) continue;
      const v = w.d[i + 7], r = Math.hypot(w.d[i + 1], w.d[i + 2]);
      if (r > s.R - 0.004) { tread++; expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      else { side++; expect(v).toBeCloseTo(2 + w.d[i] / (s.tw / 2), 5); }
    }
    expect(tread).toBeGreaterThan(100); expect(side).toBeGreaterThan(400);
  });
  it('small parts build finite, non-empty geometry', () => {
    const paint = { kind: K.PAINT }, trim = { kind: K.TRIM, color: '#141416' };
    for (const part of [mirrorSoup(1, 0.9, 1, 0, paint, trim), handleSoup(-1, 0.9, 0.8, 0.3, paint), wiperSoup(0.3, 1, 0.5, 0.1, 0.05, trim), exhaustTip(0.3, 0.3, -2), antennaSoup(0, 1.2, -1)]) {
      expect(part.tris).toBeGreaterThan(10); expect(part.d.every(Number.isFinite)).toBe(true);
    }
    expect(bounds(antennaSoup(0, 1.2, -1)).max[1]).toBeGreaterThan(1.2 + 0.7);
  });
});

describe('console stays clean', () => {
  // Round 13-14 wheels called toNonIndexed() on an ExtrudeGeometry (already non-indexed): three.js warned once per
  // wheel build, and the warnings failed every e2e test that checks for a clean console.
  it('building every vehicle template and wheel logs no warnings', () => {
    const warn = vi.spyOn(console, 'warn');
    for (const kind of Object.keys(VEHICLES) as VehicleKind[]) { getTemplate(kind); for (const l of [0, 1, 2]) wheelSoup(SHAPES[kind], l); }
    for (const rim of ['spoke5', 'multi', 'steel', 'hubcap', 'mesh', 'chrome', 'truck', 'race', 'twin'] as const) wheelSoup({ ...SHAPES.sedan, rim }, 0);
    expect(warn.mock.calls.map(c => String(c[0]))).toEqual([]);
    warn.mockRestore();
  });
});
