/**
 * The island's East River quay (between the Cannery avenue and the river, Harbor Drive in the middle): warehouses and container
 * yards west of the drive, a planted riverside esplanade with lamps, benches, pavilions and timber piers east of it.
 * Everything goes into the shared trim/facade chunks (a handful of draw calls); colliders are plain boxes.
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { Rng } from '../core/rng';
import { type CityMap, AVENUES, CURB_HEIGHT, HARBOR_X, SIDEWALK } from './citymap';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_ROUGH, T_PAINT, T_NIGHTGLOW } from './builders';
import { type BuildCtx, warehouse, streetBuilding } from './buildings';
import { distToPath } from './westside';
import { RAMPS } from '../game/places';

const C = (h: string) => new THREE.Color(h);
const CRANES = [40, 150, 290, 470, 640, 800];
export interface QuayCtx { ctx: BuildCtx; physics: Physics; city: CityMap; trim: Chunked<TrimBuilder>; addTree: (x: number, y: number, z: number, yaw: number, s: number, rr: Rng) => void }

/** Z extent of the quay and the drive's x. */
export const QUAY = { x0: AVENUES[AVENUES.length - 1] + 9, driveX: 522, z0: -40, z1: 905 };

export function buildQuay(o: QuayCtx) {
  const { ctx, physics, city, trim } = o;
  const r = new Rng(60931);
  const roads = city.paths.filter(p => p.pts.some(q => q.x > QUAY.x0 - 10 && q.x < HARBOR_X + 5));
  const clear = (x: number, z: number, m: number) => !roads.some(p => distToPath(p, x, z) < p.half + SIDEWALK + m)
    && !CRANES.some(cz => Math.abs(z - cz) < 13 + m && x < 495 && x > 462)
    && !RAMPS.some(rp => Math.hypot(rp.x - x, rp.z - z) < 42 + m)
    && !city.intersections.some(i => i.ix >= 0 && Math.abs(i.x - x) < i.halfX + 8 + m && Math.abs(i.z - z) < i.halfZ + 8 + m);
  // ramps join the avenue to the drive along z = 100, 400, 700 (see Harbor Drive Ramp): keep their corridors open
  const rampZ = [100, 400, 700];
  const nearRamp = (z: number, half: number) => rampZ.some(rz => Math.abs(rz - z) < half + 13);
  const placed: { x: number; z: number; hw: number; hd: number }[] = [];
  const free = (x: number, z: number, hw: number, hd: number) => !placed.some(p => Math.abs(p.x - x) < p.hw + hw + 1 && Math.abs(p.z - z) < p.hd + hd + 1);

  // ---- warehouses west of the drive (front doors face the drive, east)
  for (let z = QUAY.z0; z < QUAY.z1 - 40;) {
    const w = r.range(30, 46), d = r.range(20, 26), cx = 480 + d / 2 + r.range(0, 4), cz = z + w / 2;
    z += w + r.range(3, 7);
    if (nearRamp(cz, w / 2) || !clear(cx, cz, 2) || !clear(cx, cz - w * 0.45, 2) || !clear(cx, cz + w * 0.45, 2) || !clear(cx - d / 2, cz, 2) || !clear(cx + d / 2, cz, 2) || !free(cx, cz, d / 2, w / 2)) continue;
    warehouse(ctx, { cx, cz, w, d, base: CURB_HEIGHT, h: r.range(8.5, 11.5), seed: r.int(0, 1e9), yaw: Math.PI / 2 });
    placed.push({ x: cx, z: cz, hw: d / 2, hd: w / 2 });
  }
  // ---- container yards between and behind them (west edge strip beside the avenue, x 464..478)
  const cols = ['#a8402c', '#2f5f7f', '#c48a2b', '#3f6f4a', '#6a3a5f', '#c8c8c0', '#7f2f2a', '#2a4d6a'].map(c => C(c));
  for (let z = QUAY.z0 + 10; z < QUAY.z1 - 20; z += 5.2) {
    if (!clear(470, z, 1) || nearRamp(z, 3) || r.chance(0.25)) continue;
    if (!free(471, z, 6.4, 1.3)) continue;
    const stack = r.int(1, 3), tb = trim.at(471, z), col = r.pick(cols);
    for (let k = 0; k < stack; k++) { tb.box(471, CURB_HEIGHT + 1.3 + k * 2.6, z, 12.2, 2.5, 2.4, 0, col, T_METAL); tb.box(471, CURB_HEIGHT + 1.3 + k * 2.6, z, 12.25, 0.12, 2.45, 0, C('#2e3134'), T_METAL); }
    physics.addStaticBox(471, CURB_HEIGHT + stack * 1.3, z, 6.1, stack * 1.3, 1.2);
    placed.push({ x: 471, z, hw: 6.2, hd: 1.4 });
  }
  // ---- verge trees + lamps along both sides of the drive
  for (let z = QUAY.z0 + 6; z < QUAY.z1; z += 14) {
    for (const sx of [-1, 1]) {
      const x = QUAY.driveX + sx * 14.5;
      if (!clear(x, z, 0.5) || nearRamp(z, 2)) continue;
      if (Math.round(z / 14) % 2) o.addTree(x, CURB_HEIGHT - 0.05, z, r.range(0, 6.28), r.range(0.9, 1.3), r);
      else { const tb = trim.at(x, z); tb.cyl(x, CURB_HEIGHT, z, 0.08, 0.05, 4.4, 8, C('#2b2e31'), T_METAL); tb.sphere(x, CURB_HEIGHT + 4.5, z, 0.24, C('#fff1d6'), T_NIGHTGLOW(5)); physics.addStaticCylinder(x, CURB_HEIGHT + 2.2, z, 2.2, 0.1); }
    }
  }
  // ---- riverside esplanade (east of the drive): pavilions, benches, trees, lamps, timber piers
  const edgeX = HARBOR_X;
  const tbAt = (z: number) => trim.at(edgeX - 8, z);
  for (let z = QUAY.z0 + 10; z < QUAY.z1 - 10; z += 9) {
    if (!clear(edgeX - 3, z, 1)) continue;
    const tb = tbAt(z);
    tb.cyl(edgeX - 2.2, CURB_HEIGHT, z, 0.07, 0.05, 4.2, 8, C('#2b2e31'), T_METAL); tb.sphere(edgeX - 2.2, CURB_HEIGHT + 4.3, z, 0.22, C('#fff1d6'), T_NIGHTGLOW(5));
    physics.addStaticCylinder(edgeX - 2.2, CURB_HEIGHT + 2.1, z, 2.1, 0.1);
    const k = Math.round(z / 9) % 4;
    if (k === 1) { tb.box(edgeX - 4, CURB_HEIGHT + 0.45, z + 3, 0.55, 0.1, 1.8, 0, C('#6b4a32'), T_ROUGH); tb.box(edgeX - 4.2, CURB_HEIGHT + 0.7, z + 3, 0.08, 0.5, 1.8, 0, C('#6b4a32'), T_ROUGH, 0.2); tb.box(edgeX - 4, CURB_HEIGHT + 0.2, z + 3, 0.4, 0.4, 1.6, 0, C('#8f8a80'), T_STONE); }
    else if (k === 3 && clear(edgeX - 7, z, 3)) o.addTree(edgeX - 7, CURB_HEIGHT - 0.05, z, r.range(0, 6.28), r.range(1.0, 1.4), r);
  }
  // waterfront row between the drive and the esplanade: loft mid-rises and harbour sheds side by side (fronts to the drive)
  const pierZ: number[] = []; for (let z = QUAY.z0 + 60; z < QUAY.z1 - 60; z += 150) pierZ.push(z);
  for (let z = QUAY.z0 + 4; z < QUAY.z1 - 30;) {
    const loft = r.chance(0.55), w = loft ? r.range(18, 28) : r.range(20, 30), d = loft ? 13 : 11, cx = 543.5, cz = z + w / 2;
    z += w + r.range(2.5, 5);
    if (nearRamp(cz, w / 2) || pierZ.some(pz => Math.abs(pz - cz) < w / 2 + 7) || !clear(cx, cz, 3) || !clear(cx, cz - w / 2, 3) || !clear(cx, cz + w / 2, 3)) continue;
    if (loft) {
      const floors = r.int(4, 8), seed = r.int(0, 1e9);
      streetBuilding(ctx, { cx, cz, yaw: Math.PI / 2, w, d, base: CURB_HEIGHT, floors, floorH: 3.5, groundH: 4.4, mat: r.int(0, 3), color: C(r.pick(['#8a5a45', '#7a6a58', '#6d7076', '#8f7f66'])), seed, ground: 'lobby', winW: 1.5, winH: 2.1, sill: 0.8, cellW: 3.2, cornice: 'simple', fireEscape: r.chance(0.4), lit: 0.7, exposed: [true, true, true, true], roofItems: 2, awning: false, brand: seed % 32, balconies: false, trimColor: C('#c9c3b4') });
    } else warehouse(ctx, { cx, cz, w, d, base: CURB_HEIGHT, h: r.range(6, 8.5), seed: r.int(0, 1e9), yaw: Math.PI / 2 });
  }
  // static parked box trucks and flatbeds along the drive's west verge and in the yards, plus chain-link fences round the container yards
  const truckCols = ['#b8452f', '#f0f0ea', '#2f5d8a', '#e0b030', '#4c7a52'].map(c => C(c));
  for (let z = QUAY.z0 + 30; z < QUAY.z1 - 30; z += r.range(26, 44)) {
    const x = r.chance(0.5) ? 509.5 : 477.5;
    if (!clear(x, z, 3) || nearRamp(z, 6) || !free(x, z, 1.6, 4.5)) continue;
    const tb = trim.at(x, z), col = r.pick(truckCols), y = CURB_HEIGHT;
    tb.box(x, y + 1.7, z - 1.2, 2.5, 2.7, 5.6, 0, col, T_PAINT); tb.box(x, y + 1.15, z + 2.9, 2.3, 1.9, 1.9, 0, C('#2b3238'), T_PAINT); tb.box(x, y + 1.6, z + 3.5, 2.1, 0.8, 0.7, 0, C('#1a2630'), T_METAL);
    tb.box(x, y + 0.55, z, 2.4, 0.3, 8.6, 0, C('#1d1f21'), T_METAL);
    for (const sx of [-1, 1]) for (const sz of [-2.4, 0.6, 3.1]) tb.cyl(x + sx * 1.2, y + 0.5, z + sz, 0.5, 0.5, 0.35, 10, C('#121314'), T_METAL, 0, 0, Math.PI / 2);
    physics.addStaticBox(x, y + 1.4, z, 1.3, 1.4, 4.3);
    placed.push({ x, z, hw: 1.6, hd: 4.5 });
  }
  for (let z0 = QUAY.z0 + 10; z0 < QUAY.z1 - 60; z0 += 90) {
    const z1 = z0 + 56; if ([z0, (z0 + z1) / 2, z1].some(zz => nearRamp(zz, 4) || !clear(465, zz, 0.5))) continue;
    const tb = trim.at(470, (z0 + z1) / 2), fc = C('#9aa0a4');
    for (const fx of [464.5, 478.5]) { tb.box(fx, CURB_HEIGHT + 1.1, (z0 + z1) / 2, 0.05, 2.2, z1 - z0, 0, C('#b8bcbe'), [0.5, 0.3, 5, 0]); for (let zz = z0; zz <= z1; zz += 4) tb.cyl(fx, CURB_HEIGHT, zz, 0.05, 0.05, 2.3, 6, fc, T_METAL); }
    for (const zz of [z0, z1]) tb.box(471.5, CURB_HEIGHT + 1.1, zz, 14, 2.2, 0.05, 0, C('#b8bcbe'), [0.5, 0.3, 5, 0]);
  }
  // more gantry cranes down the quay (the first three are in citybuild)
  for (const cz of [470, 640, 800]) {
    if (nearRamp(cz, 12)) continue;
    const tb = trim.at(476, cz), col = C('#c9622a'), x = 476;
    for (const dx of [-7, 7]) for (const dz of [-6, 6]) { tb.box(x + dx, 17.1, cz + dz, 1.2, 34, 1.2, 0, col, T_PAINT); physics.addStaticBox(x + dx, 17, cz + dz, 0.6, 17, 0.6); }
    for (const dz of [-6, 6]) for (let y = 6; y < 32; y += 6.5) tb.beam(x - 7, y, cz + dz, x + 7, y + 6, cz + dz, 0.3, 0.3, col, T_PAINT);
    tb.box(x, 33.5, cz, 16, 3, 13.5, 0, col, T_PAINT); tb.box(x + 22, 34, cz, 66, 2.4, 2.4, 0, col, T_PAINT); tb.box(x - 2, 37, cz, 6, 4, 5, 0, C('#e8e2d0'), T_PAINT);
    tb.sphere(x + 55, 35.4, cz, 0.25, C('#ff3020'), [0.4, 0, 4, 3]);
  }
  // timber piers into the river with a lamp pair, moored crates and bollards
  const wood = C('#6a4d37'), piles = C('#3f2f22');
  for (let z = QUAY.z0 + 60; z < QUAY.z1 - 60; z += 150) {
    if (!clear(edgeX - 2, z, 4) || nearRamp(z, 6)) continue;
    const len = 36, w = 9, cx = edgeX + len / 2 - 2, tb = trim.at(cx, z);
    if (z > 880 || (z > 100 && z < 130)) continue;
    tb.box(cx, -0.25, z, len, 0.4, w, 0, wood, [0.9, 0, 2, 0]);
    physics.addStaticBox(cx, -0.25, z, len / 2, 0.25, w / 2);
    for (let x = edgeX; x < edgeX + len - 2; x += 8) for (const dz of [-w / 2 + 0.5, w / 2 - 0.5]) tb.cyl(x, -6, z + dz, 0.3, 0.3, 5.7, 8, piles, T_ROUGH);
    for (const dz of [-w / 2 + 0.6, w / 2 - 0.6]) { tb.cyl(edgeX + len - 3, 0, z + dz, 0.22, 0.28, 0.6, 8, C('#2f3236'), T_METAL); tb.cyl(edgeX + 6, 0, z + dz, 0.07, 0.05, 4, 8, C('#2b2e31'), T_METAL); tb.sphere(edgeX + 6, 4.1, z + dz, 0.2, C('#fff1d6'), T_NIGHTGLOW(5)); }
    for (let c = 0; c < 3; c++) tb.box(edgeX + 14 + c * 3.4, 0.7, z + (c % 2 ? 1.5 : -1.5), 2.2, 1.4, 2.2, 0.2 * c, C(['#8a5a32', '#2f5d8a', '#b23a2e'][c]), T_PAINT);
    physics.addStaticBox(edgeX + 18, 0.7, z, 5.5, 0.7, 2.5);
  }
}
