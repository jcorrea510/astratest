/** Procedural vehicle models: every kind builds, stays inside its triangle budget and exposes doors / panes / seats. */
import { describe, it, expect } from 'vitest';
import { getTemplate } from './build';
import { VEHICLES, type VehicleKind } from '../specs';
import { wheelSoup } from './parts';
import { SHAPES } from '../shapes';

function area(g: import('three').BufferGeometry | null): number {
  if (!g) return 0;
  const p = g.attributes.position.array as Float32Array; let a = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

describe('procedural vehicle models', () => {
  for (const kind of Object.keys(VEHICLES) as VehicleKind[]) {
    it(`${kind} builds three LODs with doors, panes and seats`, { timeout: 60000 }, () => {
      const t = getTemplate(kind);
      const hi = t.lods[0].body.attributes.position.count / 3, lo = t.lods[1].body.attributes.position.count / 3;
      const glass = (t.lods[0].glass?.attributes.position.count ?? 0) / 3;
      process.stdout.write(`MODEL ${kind.padEnd(11)} hi ${hi} lo ${lo} glass ${glass} wheel ${wheelSoup(SHAPES[kind], 0).tris} doors ${t.doors.length} panes ${t.panes.map(p => p.name).join(',')}\n`);
      expect(hi).toBeLessThan(52000); // R13-W6: was 42000 before the detailed wheels, calipers and small parts (budget: < 1.3x per kind, see parts.test.ts)
      expect(lo).toBeLessThan(hi * 0.5);
      expect(lo).toBeLessThan(2700 + t.wheelBones.length * 240);
      const far = t.lods[2].body.attributes.position.count / 3;
      expect(far).toBeLessThan(kind === 'tank' ? 1200 : 1050 + t.wheelBones.length * 140); expect(far).toBeGreaterThan(40);
      // far / mid wheels stay round (clustering them with the body squashed them into slivers: far cars seemed to float)
      for (const l of [1, 2]) if (SHAPES[kind].type !== 'tank') {
        const g = t.lods[l].body, P = g.attributes.position.array as Float32Array, SI = g.attributes.skinIndex.array as Uint16Array;
        let lo = Infinity, hi = -Infinity, lz = Infinity, hz = -Infinity;
        for (let i = 0; i < SI.length / 4; i++) if (SI[i * 4] === t.wheelBones[0]) { lo = Math.min(lo, P[i * 3 + 1]); hi = Math.max(hi, P[i * 3 + 1]); lz = Math.min(lz, P[i * 3 + 2]); hz = Math.max(hz, P[i * 3 + 2]); }
        expect(hi - lo).toBeGreaterThan(SHAPES[kind].R * 1.9); expect(hz - lz).toBeGreaterThan(SHAPES[kind].R * 1.9);
      }
      // the far model keeps (nearly) all its glass: decimating it too hard left see-through cabins on far-crowd cars (R6-V)
      if (t.lods[1].glass) expect(area(t.lods[2].glass)).toBeGreaterThan(area(t.lods[1].glass) * 0.8);
      expect(t.doors.length).toBe(SHAPES[kind].doors.length * 2);
      if (kind !== 'tank') {
        expect(t.panes.some(p => p.name === 'windshield')).toBe(true);
        // driver door is on the left (+x) and holds the front-left pane
        const d0 = t.doors[0];
        expect(d0.side).toBe('left'); expect(d0.hinge.x).toBeGreaterThan(0);
        expect(t.panes.find(p => p.name === 'front-left')?.bone).toBe(d0.bone);
        expect(t.seats[0].x).toBeGreaterThan(0);
        expect(t.seats[0].door).toBe(0);
      }
      // geometry is finite
      const p = t.lods[0].body.attributes.position.array as Float32Array;
      for (let i = 0; i < p.length; i += 97) expect(Number.isFinite(p[i])).toBe(true);
    });
  }
});
