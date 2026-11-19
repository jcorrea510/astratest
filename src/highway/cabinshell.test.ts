import { describe, it, expect } from 'vitest';
import { getTemplate } from '../vehicles/models/build';
import { K } from '../vehicles/models/kinds';
import { CAR_CHOICES } from './hud';
import { cabinFrame, stripFrontGreenhouse } from './cabinshell';
import { eyePoint, COCKPIT_FOV, COCKPIT_PITCH } from './cockpit';

const D = 180 / Math.PI;
describe('first-person cabin framing (every highway car)', () => {
  it('A-pillar base sits out at the window corner, windshield header above the view, mirrors cut from the shell', () => {
    for (const k of CAR_CHOICES) {
      const t = getTemplate(k), f = cabinFrame(k), E = eyePoint(t.seats[0], f, t.roofY);
      // pillar base: well left of the line of sight (it used to land near screen centre)
      const base = Math.atan2(f.base.x + 0.02 - E.x, f.base.z - 0.03 - E.z) * D;
      expect(base, k).toBeGreaterThan(20);
      // eye clears the dash and stays under the header; the header is near or above the top of the view
      expect(E.y - f.belt, k).toBeGreaterThan(0.1);
      const header = Math.atan2(f.top.y - E.y, f.top.z - E.z) * D;
      expect(header, k).toBeGreaterThan(COCKPIT_FOV / 2 - COCKPIT_PITCH * D - 14);
      // the body's own A-pillars / door mirrors are gone from the cockpit shell
      const g = stripFrontGreenhouse(t.lods[0].body, f.belt, f.zCut), kind = g.getAttribute('aKind'), P = g.getAttribute('position');
      let mirrors = 0, pillar = 0;
      for (let i = 0; i < P.count; i++) {
        if (Math.round(kind.getX(i)) === K.MIRROR) mirrors++;
        if (P.getY(i) > f.belt + 0.15 && P.getZ(i) > f.zCut + 0.15 && Math.abs(P.getX(i)) < f.base.x) pillar++;
      }
      expect(mirrors, k).toBe(0);
      expect(pillar, k).toBe(0);
    }
  }, 120_000);
});
