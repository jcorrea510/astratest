/** LOD selection (pure) and per-kind triangle / draw-call budgets. */
import { describe, it, expect } from 'vitest';
import type { BufferGeometry } from 'three';
import { pickLod, LOD_MID, underShadowShown } from './vehicle';
import { getTemplate } from './models/build';
import { VEHICLES, type VehicleKind } from './specs';

describe('pickLod', () => {
  it('near is detailed, mid is lod 1, far is lod 2', () => {
    expect(pickLod(3, 0)).toBe(0); expect(pickLod(30, 0)).toBe(1); expect(pickLod(120, 0)).toBe(2);
  });
  it('has hysteresis around the boundaries', () => {
    expect(pickLod(LOD_MID * 0.95, 0)).toBe(0); expect(pickLod(LOD_MID * 0.95, 1)).toBe(1);
    expect(pickLod(LOD_MID * 0.8, 1)).toBe(0);
    expect(pickLod(64, 1)).toBe(1); expect(pickLod(60, 2)).toBe(2); expect(pickLod(55, 2)).toBe(1);
  });
  it('zoom (narrow FOV) and long vehicles keep detail longer; the player stays lod 0', () => {
    expect(pickLod(18, 0, { fovDeg: 62 })).toBe(1); expect(pickLod(18, 0, { fovDeg: 35 })).toBe(0);
    expect(pickLod(16, 0, { size: 1 })).toBe(1); expect(pickLod(16, 0, { size: 1.6 })).toBe(0);
    expect(pickLod(500, 2, { player: true })).toBe(0);
  });
});

describe('vehicle budgets', () => {
  for (const kind of Object.keys(VEHICLES) as VehicleKind[]) {
    it(`${kind}: tris and draw calls per LOD`, { timeout: 60000 }, () => {
      const t = getTemplate(kind), tri = (g: BufferGeometry | null) => (g ? g.attributes.position.count / 3 : 0);
      const l = t.lods.map(x => ({ tris: tri(x.body) + tri(x.glass), calls: 1 + (x.glass ? 1 : 0) }));
      process.stdout.write(`BUDGET ${kind.padEnd(11)} ${l.map((x, i) => `L${i} ${x.tris}t/${x.calls}dc`).join('  ')}  ratio ${(l[1].tris / l[0].tris).toFixed(3)} ${(l[2].tris / l[0].tris).toFixed(3)}\n`);
      for (const x of l) expect(x.calls).toBeLessThanOrEqual(2); // body + glass, merged by material
      if (kind !== 'tank') { expect(l[1].tris).toBeLessThan(l[0].tris / 4); expect(l[2].tris).toBeLessThan(l[0].tris / 15); }
    });
  }
});

describe('contact shadow under a car (27 Nov busy-corner budget)', () => {
  it('near and mid cars keep it, far cars and flipped or airborne cars drop it', () => {
    expect(underShadowShown(true, 1, 0)).toBe(true);
    expect(underShadowShown(true, 1, 1)).toBe(true);
    expect(underShadowShown(true, 1, 2)).toBe(false);
    expect(underShadowShown(false, 1, 0)).toBe(false);
    expect(underShadowShown(true, 0.2, 0)).toBe(false);
  });
});
