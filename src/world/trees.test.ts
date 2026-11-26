import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { treeGeos, palmGeos, shrubGeos } from './props';

const tris = (g: THREE.BufferGeometry) => g.attributes.position.count / 3;
/** Round-12 per-seed totals (trunk + leaves) before the realism pass; R14 denser canopy: within 2x. */
const OLD_TOTAL: Record<number, number> = { 100: 200, 101: 280, 102: 240, 103: 280 };

describe('street trees (R13 W5)', () => {
  for (let s = 0; s < 4; s++) {
    it(`tree ${s}: triangle budget, bounds, branch structure under the crown`, () => {
      const t = treeGeos(100 + s);
      const total = tris(t.trunk) + tris(t.leaves);
      expect(total).toBeLessThanOrEqual(OLD_TOTAL[100 + s] * 2.0);
      const bb = t.leaves.boundingBox!;
      expect(bb.max.y).toBeLessThan(10); expect(bb.min.y).toBeGreaterThan(1.8); // trunk and limbs visible beneath the crown
      expect(bb.max.x - bb.min.x).toBeLessThan(10); expect(bb.max.z - bb.min.z).toBeLessThan(10);
      const tb = t.trunk.boundingBox!;
      expect(tb.min.y).toBeGreaterThanOrEqual(0); expect(tb.max.y).toBeGreaterThan(3);
      const pos = t.trunk.attributes.position; let wide = 0; // root flare: base wider than the upper trunk
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.05) wide = Math.max(wide, Math.hypot(pos.getX(i), pos.getZ(i)));
      expect(wide).toBeGreaterThan(0.3);
    });
    it(`tree ${s}: vertex colours darken into the crown and stay finite`, () => {
      const col = treeGeos(100 + s).leaves.attributes.color; let lo = 9, hi = 0;
      for (let i = 0; i < col.count; i++) { const g = col.getY(i); expect(Number.isFinite(g)).toBe(true); lo = Math.min(lo, g); hi = Math.max(hi, g); }
      expect(hi / lo).toBeGreaterThan(1.5); expect(hi).toBeLessThan(1.5);
    });
  }
  it('palms and shrubs keep their budgets', () => {
    const p = palmGeos(200);
    expect(tris(p.trunk) + tris(p.leaves)).toBeLessThan(330);
    expect(tris(shrubGeos(300).leaves)).toBeLessThanOrEqual(26);
  });
});
