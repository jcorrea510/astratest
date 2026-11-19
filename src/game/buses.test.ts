import { describe, it, expect } from 'vitest';
import { generateCity, routeField } from '../world/citymap';
import { buildBusRoutes, buildStopProps } from './buses';
import { VEHICLES } from '../vehicles/specs';
import { layoutFor, SHAPES } from '../vehicles/shapes';

const city = generateCity();
describe('city buses', () => {
  it('is a long heavy 12 m vehicle with a door on the kerb side', () => {
    const l = layoutFor('bus');
    expect(l.half[2] * 2).toBeGreaterThan(10.5);
    expect(VEHICLES.bus.mass).toBeGreaterThan(8000);
    expect(SHAPES.bus.doors.length).toBe(1);
  });
  it('builds drivable closed loop routes with kerb stops', () => {
    const routes = buildBusRoutes(city, 3);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    for (const r of routes) {
      expect(r.stops.length).toBe(4);
      for (let i = 0; i < 4; i++) {
        const nx = r.stops[(i + 1) % 4], f = routeField(city, nx.x, nx.z);
        expect(f[r.stops[i].lane], `route ${r.id} leg ${i}`).toBeLessThan(900);
      }
    }
  });
  it('stop props sit on the pavement, beyond the lane, and merge to three meshes', () => {
    const r = buildBusRoutes(city, 1)[0];
    for (const s of r.stops) expect(Math.hypot(s.px - s.x, s.pz - s.z)).toBeGreaterThan(2.5);
    const g = buildStopProps(r.stops);
    for (const geo of [g.metal, g.glass, g.sign]) expect(geo.attributes.position.count).toBeGreaterThan(24 * r.stops.length);
  });
});
