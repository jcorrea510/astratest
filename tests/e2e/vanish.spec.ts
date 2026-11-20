import { test, expect, type Page } from '@playwright/test';
import { watch, boot, clean } from './helpers';

/**
 * Regression for the owner's #1 complaint: "I drive up to a car / person / bus and it disappears".
 * The player drives (scripted, along the lane graph at city speed) through a full crowd on the high preset. Every frame
 * we list everything a viewer could see within 60 m and inside the camera view: real people, real vehicles, far-crowd
 * people/cars/buses and curbside parked cars. Anything that was there one frame and is gone the next must have been
 * handed over (a new person/car of the same class appears where it stood); otherwise it vanished in front of the player.
 */
test.describe.configure({ mode: 'serial' });

export async function driveAndWatch(page: Page, opts: { seconds: number; speed: number; quality: string; seed?: number }) {
  return page.evaluate(({ seconds, speed, quality, seed }) => {
    const g = (window as any).__game, cam = g.renderer.camera;
    g.renderer.setQuality(quality); g.clockRunning = false; g.hour = 13; g.trafficCap = null; g.pedCap = null;
    // deterministic lane walk: start on a long downtown lane, keep taking the first successor lane
    let rs = seed ?? 7; const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
    const lanes = g.city.lanes as any[];
    let lane = lanes.filter(l => !l.connector && l.length > 80 && !l.ys).sort((a, b) => Math.hypot(a.points[0].x + 41, a.points[0].z - 9) - Math.hypot(b.points[0].x + 41, b.points[0].z - 9))[0];
    let s = 2;
    const at = (l: any, d: number) => {
      const P = l.points, C = l.cum; let i = 1; while (i < P.length - 1 && C[i] < d) i++;
      const f = Math.max(0, Math.min(1, (d - C[i - 1]) / Math.max(1e-6, C[i] - C[i - 1])));
      return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * f, z: P[i - 1].z + (P[i].z - P[i - 1].z) * f, dx: P[i].x - P[i - 1].x, dz: P[i].z - P[i - 1].z };
    };
    const place = () => { const p = at(lane, s); g.player.place(p.x, 0.25, p.z, Math.atan2(p.dx, p.dz)); };
    place(); g.prewarm?.();
    for (let i = 0; i < 150; i++) { g.frame(1 / 30, false); } // let the city fill around the start
    g.crowd.debug = [];
    const ids = new WeakMap<object, number>(); let nid = 1; const idOf = (o: object) => { let v = ids.get(o); if (!v) { v = nid++; ids.set(o, v); } return v; };
    const inView = (x: number, y: number, z: number) => {
      // camera-space test (no THREE import needed): project into clip space with a margin
      const v = cam.position.clone().set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -0.5) return false; // behind the lens
      const c = v.clone().applyMatrix4(cam.projectionMatrix);
      return Math.abs(c.x) < 0.95 && Math.abs(c.y) < 0.95;
    };
    type E = { key: string; cls: 'ped' | 'car'; src: string; x: number; z: number; d: number };
    const snapshot = (): Map<string, E> => {
      cam.updateMatrixWorld(true);
      const out = new Map<string, E>(), cx = cam.position.x, cz = cam.position.z;
      const add = (key: string, cls: 'ped' | 'car', src: string, x: number, y: number, z: number) => {
        const d = Math.hypot(x - cx, z - cz); if (d > 60 || d < 3) return;
        if (!inView(x, y + (cls === 'car' ? 0.8 : 1.0), z)) return;
        out.set(key, { key, cls, src, x, z, d });
      };
      for (const n of g.pop.npcs) {
        if (n.brain === 'inside' || n.char.inVehicle || !n.alive) continue;
        const h = n.char.human; if (!h.root.visible || !h.mesh.visible) continue;
        add('p' + n.id, 'ped', 'real-ped', n.char.pos.x, n.char.pos.y, n.char.pos.z);
      }
      for (const v of g.vehicles.list) { if (!v.group.visible) continue; add('v' + v.id, 'car', v.kind === 'bus' ? 'real-bus' : v.parked ? 'real-parked' : 'real-car', v.position.x, v.position.y, v.position.z); }
      const cr = g.crowd;
      for (const p of cr.peds) add('cp' + idOf(p), 'ped', 'crowd-ped', p.x, p.y ?? 0, p.z);
      for (const c of cr.cars) add('cc' + idOf(c), 'car', c.bus ? 'crowd-bus' : 'crowd-car', c.x, 0, c.z);
      for (const sl of cr.visSlots ?? []) if (!sl.taken && !sl.real) add('cs' + idOf(sl), 'car', 'crowd-parked', sl.x, 0, sl.z);
      return out;
    };
    const events: any[] = []; const bySrc: Record<string, number> = {};
    // far-model (crowd) cars / people drawn within 20 m of the camera: the owner's "boxy cars up close"
    const nearFar: any[] = []; let nearFarN = 0;
    const checkNearFar = (f: number) => {
      const cx = cam.position.x, cz = cam.position.z, cr = g.crowd;
      for (const c of cr.cars) { const d = Math.hypot(c.x - cx, c.z - cz); if (d < 20 && inView(c.x, 0.8, c.z)) { nearFarN++; if (nearFar.length < 10) nearFar.push({ f, cls: c.bus ? 'bus' : 'car', d: +d.toFixed(1), why: cr.failWhy, real: g.traffic.cars.length }); } }
      for (const p of cr.peds) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < 20 && inView(p.x, (p.y ?? 0) + 1, p.z)) { nearFarN++; if (nearFar.length < 10) nearFar.push({ f, cls: 'ped', d: +d.toFixed(1) }); } }
    };
    let prev = snapshot(), frames = 0, maxSeen = 0;
    const dt = 1 / 30, n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      s += speed * dt;
      while (s > lane.length) { s -= lane.length; const nx = lane.next; lane = lanes[nx.length ? nx[Math.floor(rnd() * nx.length)] : lane.id]; if (!nx.length) { s = 0; break; } }
      place();
      g.frame(dt, false); frames++;
      const cur = snapshot(); maxSeen = Math.max(maxSeen, cur.size); if (i > 30) checkNearFar(i);
      for (const [k, e] of prev) {
        if (cur.has(k)) continue;
        // still around but now out of view / range / behind? not a vanish
        const still = snapshotHas(k);
        if (still) continue;
        // handed over: something new of the same class appeared where it was
        const r = e.cls === 'ped' ? 2.5 : 5;
        let ok = false;
        for (const [k2, e2] of cur) if (!prev.has(k2) && e2.cls === e.cls && Math.hypot(e2.x - e.x, e2.z - e.z) < r) { ok = true; break; }
        if (ok) continue;
        bySrc[e.src] = (bySrc[e.src] ?? 0) + 1;
        if (events.length < 40) events.push({ f: i, src: e.src, d: +e.d.toFixed(1), x: +e.x.toFixed(1), z: +e.z.toFixed(1), why: g.crowd.debug.filter((r: any) => Math.hypot(r.x - e.x, r.z - e.z) < 3).map((r: any) => r.why + (r.inView ? '/v' : '')).join(',') });
      }
      prev = cur; g.crowd.debug.length = 0;
    }
    function snapshotHas(k: string): boolean {
      // the entity still exists and is drawn (it only left the 60 m / view window)
      const kind = k[0] === 'p' ? 'p' : k[0] === 'v' ? 'v' : k.slice(0, 2), id = Number(k.replace(/^[a-z]+/, ''));
      if (kind === 'p') { const n = g.pop.npcs.find((m: any) => m.id === id); return !!n && n.alive && n.brain !== 'inside' && !n.char.inVehicle && n.char.human.root.visible && n.char.human.mesh.visible && !viewNear(n.char.pos.x, n.char.pos.z, n.char.pos.y + 1); }
      if (kind === 'v') { const v = g.vehicles.list.find((m: any) => m.id === id); return !!v && v.group.visible && !viewNear(v.position.x, v.position.z, v.position.y + 0.8); }
      const cr = g.crowd; const list = kind === 'cp' ? cr.peds : kind === 'cc' ? cr.cars : (cr.visSlots ?? []).filter((x: any) => !x.taken && !x.real);
      const o = list.find((x: any) => ids.get(x) === id); return !!o && !viewNear(o.x, o.z, kind === 'cp' ? (o.y ?? 0) + 1 : 0.8);
    }
    function viewNear(x: number, z: number, y: number) { const d = Math.hypot(x - cam.position.x, z - cam.position.z); return d <= 60 && d >= 3 && inView(x, y, z); }
    const tot = Object.values(bySrc).reduce((a, b) => a + b, 0);
    return { frames, nearFarN, nearFar, vanished: tot, bySrc, events, maxSeen, real: { peds: g.pop.npcs.length, cars: g.traffic.cars.length, vehicles: g.vehicles.list.length }, crowd: { peds: g.crowd.peds.length, cars: g.crowd.cars.length }, stats: g.crowd.stats };
  }, opts);
}

test('driving through a full crowd on high: nothing within 60 m in view vanishes without a hand-over', async ({ page }) => {
  test.setTimeout(900_000);
  const p = watch(page);
  await boot(page);
  const r = await driveAndWatch(page, { seconds: 70, speed: 13, quality: 'high' });
  console.log('VANISH', JSON.stringify(r));
  expect(r.maxSeen).toBeGreaterThan(10); // the street really was busy
  expect(r.vanished, JSON.stringify(r.events.slice(0, 12))).toBe(0);
  expect(r.nearFarN, JSON.stringify(r.nearFar)).toBe(0); // no far-model car / person drawn within 20 m in view
  clean(p);
});
