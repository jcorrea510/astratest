/** Procedural vehicle models: every kind builds, stays inside its triangle budget and exposes doors / panes / seats. */
import { describe, it, expect } from 'vitest';
import { getTemplate } from './build';
import { VEHICLES, type VehicleKind } from '../specs';
import { wheelSoup } from './parts';
import { SHAPES } from '../shapes';

describe('procedural vehicle models', () => {
  for (const kind of Object.keys(VEHICLES) as VehicleKind[]) {
    it(`${kind} builds three LODs with doors, panes and seats`, { timeout: 60000 }, () => {
      const t = getTemplate(kind);
      const hi = t.lods[0].body.attributes.position.count / 3, lo = t.lods[1].body.attributes.position.count / 3;
      const glass = (t.lods[0].glass?.attributes.position.count ?? 0) / 3;
      process.stdout.write(`MODEL ${kind.padEnd(11)} hi ${hi} lo ${lo} glass ${glass} wheel ${wheelSoup(SHAPES[kind], 0).tris} doors ${t.doors.length} panes ${t.panes.map(p => p.name).join(',')}\n`);
      expect(hi).toBeLessThan(42000);
      expect(lo).toBeLessThan(hi * 0.5);
      expect(lo).toBeLessThan(3200);
      const far = t.lods[2].body.attributes.position.count / 3;
      expect(far).toBeLessThan(kind === 'tank' ? 1000 : 700); expect(far).toBeGreaterThan(40);
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
