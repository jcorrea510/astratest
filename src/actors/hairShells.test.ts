import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SHELL_HAIR, hairShellGeometry } from './hairShells';
import type { BodyBase } from './humanAssets';
import type { HairStyle } from './look';

/** A stand-in head: a sphere scalp (head-space radius 1) in a frame like the real body's. */
function fakeBase(): BodyBase {
  const half = new THREE.Vector3(0.095, 0.115, 0.11), center = new THREE.Vector3(0, 1.62, 0);
  const g = new THREE.SphereGeometry(1, 48, 32);
  g.scale(half.x, half.y, half.z).translate(center.x, center.y, center.z);
  return { scalp: g, head: { center, half, joint: center.clone() }, boneNames: ['DEF-head'] } as unknown as BodyBase;
}

/** Triangle budgets [near, far]: the Round 12 counts on this stand-in head plus 15%. */
const BASE: Record<string, [number, number]> = {
  short: [15290, 3058], crew: [9174, 3058], fade: [9664, 2416], buzz: [4587, 3058], slick: [12232, 3058], curly: [21406, 3058],
  afro: [34122, 3102], cornrows: [9174, 3058], braids: [9174, 3058], ponytail: [10703, 3058], bun: [14735, 3634],
};
const base = fakeBase();
const geo = (s: HairStyle, far: boolean) => hairShellGeometry(base, s, false, far)!;

describe('hair shell budgets', () => {
  it('has a budget for every shell style', () => {
    expect([...SHELL_HAIR].sort()).toEqual(Object.keys(BASE).sort());
  });
  it('triangle counts stay within 15% of Round 12, and the far LOD stays about 3k', () => {
    for (const s of SHELL_HAIR) {
      const [near, far] = BASE[s], g = geo(s, false), f = geo(s, true);
      expect(g.index!.count / 3, s + ' near').toBeLessThanOrEqual(near * 1.15);
      expect(f.index!.count / 3, s + ' far').toBeLessThanOrEqual(far * 1.15);
      expect(f.index!.count, s + ' far is cheaper').toBeLessThan(g.index!.count);
    }
  });
  it('layer depths stay in 0..1 and the far LOD has at most core + 2 distinct layers', () => {
    for (const s of SHELL_HAIR) {
      const layers = (g: THREE.BufferGeometry) => { const a = g.getAttribute('hs'), set = new Set<number>(); for (let i = 0; i < a.count; i++) set.add(Math.round(a.getZ(i) * 1000)); return set; };
      const n = layers(geo(s, false)), f = layers(geo(s, true));
      for (const l of n) { expect(l).toBeGreaterThanOrEqual(0); expect(l).toBeLessThanOrEqual(1000); }
      expect(f.size, s).toBeLessThanOrEqual(3);
      expect(n.size, s).toBeLessThanOrEqual(23);
    }
  });
});
