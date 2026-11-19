/**
 * GPS routing: follows the lane graph (roads, ramps, the freeway bridge) from the player's position to a waypoint,
 * so the drawn route never cuts across water, buildings or terrain. Built on routeField (reverse Dijkstra).
 */
import { type CityMap, type V2, routeField } from './citymap';

function closestOnLane(lane: { points: V2[]; cum: number[] }, x: number, z: number) {
  let d = Infinity, s = 0;
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1], b = lane.points[i];
    const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const dd = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
    if (dd < d) { d = dd; s = lane.cum[i - 1] + Math.sqrt(l2) * t; }
  }
  return { d, s };
}
function pointAt(lane: { points: V2[]; cum: number[] }, s: number): V2 {
  const c = lane.cum; let i = 1;
  while (i < c.length - 1 && c[i] < s) i++;
  const a = lane.points[i - 1], b = lane.points[i], t = Math.max(0, Math.min(1, (s - c[i - 1]) / ((c[i] - c[i - 1]) || 1)));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Road-following polyline from (fx,fz) to (tx,tz); undefined when the target cannot be reached by road. */
export function gpsRoute(city: CityMap, fx: number, fz: number, tx: number, tz: number): V2[] | undefined {
  const field = routeField(city, tx, tz);
  // start: the lane (either direction) with the least remaining distance, among lanes close to the player
  let start = -1, startS = 0, best = Infinity;
  for (const l of city.lanes) {
    if (l.connector) continue;
    const { d, s } = closestOnLane(l, fx, fz);
    if (d > 45) continue;
    const cost = d * 2 + (field[l.id] - s);
    if (cost < best) { best = cost; start = l.id; startS = s; }
  }
  if (start < 0 || !Number.isFinite(best)) return undefined;
  const out: V2[] = [{ x: fx, z: fz }];
  let cur = city.lanes[start], s0 = startS;
  for (let step = 0; step < 400; step++) {
    const nexts = cur.next;
    let nb = -1, nd = Infinity;
    for (const n of nexts) if (field[n] < nd) { nd = field[n]; nb = n; }
    const terminal = nb < 0 || !Number.isFinite(nd) || cur.length + nd > field[cur.id] + 0.5; // the lane itself is the cheapest way to the target
    if (terminal) {
      const { s } = closestOnLane(cur, tx, tz);
      const sEnd = Math.max(s0, s);
      for (let i = 0; i < cur.points.length; i++) if (cur.cum[i] > s0 && cur.cum[i] < sEnd) out.push(cur.points[i]);
      out.push(pointAt(cur, sEnd));
      break;
    }
    out.push(pointAt(cur, s0));
    for (let i = 0; i < cur.points.length; i++) if (cur.cum[i] > s0) out.push(cur.points[i]);
    cur = city.lanes[nb]; s0 = 0;
  }
  out.push({ x: tx, z: tz });
  return out;
}

/** Throttled per-frame wrapper: recomputes when the player or waypoint moved, at most a few times per second. */
export class GpsRouter {
  private key = ''; private route: V2[] | undefined; private t = -1;
  constructor(private city: CityMap) {}
  get(now: number, fx: number, fz: number, tx: number, tz: number): V2[] | undefined {
    const k = `${Math.round(fx / 6)},${Math.round(fz / 6)}>${Math.round(tx)},${Math.round(tz)}`;
    if (k === this.key && now - this.t < 3) return this.route;
    if (k !== this.key && this.t >= 0 && now - this.t < 0.4 && this.key.split('>')[1] === k.split('>')[1]) return this.route;
    this.key = k; this.t = now; this.route = gpsRoute(this.city, fx, fz, tx, tz);
    return this.route;
  }
}
