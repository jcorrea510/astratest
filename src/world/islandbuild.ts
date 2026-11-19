/**
 * Manhattan-island shoreline: seawalls and esplanades along the stepped coast, piers into the western river, and
 * the bridges that carry the four west streets across it. Visual trims merge into the city chunks; the bridge decks
 * and parapets are static colliders (the river itself has no ground until the seabed).
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { type CityMap, type PathRoad, islandShore, WEST_RIVER, MAINLAND_Z1, SIDEWALK } from './citymap';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_ROUGH } from './builders';

const C = (h: string) => new THREE.Color(h);
export function bridgeSegments(city: CityMap): { path: PathRoad; a: THREE.Vector3; b: THREE.Vector3 }[] {
  const out: { path: PathRoad; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  for (const p of city.paths) {
    if (p.kind !== 'street') continue;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1], b = p.pts[i];
      if (Math.max(a.x, b.x) < WEST_RIVER.x0 - 6 || Math.min(a.x, b.x) > WEST_RIVER.x1 + 6) continue;
      out.push({ path: p, a: new THREE.Vector3(a.x, 0, a.z), b: new THREE.Vector3(b.x, 0, b.z) });
    }
  }
  return out;
}

export function buildIsland(o: { physics: Physics; city: CityMap; trim: Chunked<TrimBuilder>; northEdge: number; southEdge: number }) {
  const { physics, city, trim } = o;
  const stone = C('#6f6b64'), cap = C('#a9a498'), walk = C('#d3cec2'), steel = C('#4b5258'), deck = C('#5d5b58'), paint = C('#7d8a93');
  const nearBridge = (x: number, z: number) => city.paths.some(p => p.kind === 'street' && p.pts.some(q => Math.hypot(q.x - x, q.z - z) < p.half + SIDEWALK + 6));
  // ---- seawalls + esplanade along the stepped coast
  const wall = (x: number, z0: number, z1: number, face: 1 | -1) => { // vertical wall along z at x; face = side where the water is
    const len = z1 - z0, cz = (z0 + z1) / 2;
    for (let z = z0; z < z1; z += 40) { const l = Math.min(40, z1 - z), c = z + l / 2; trim.at(x, c).box(x + face * 0.4, -1.6, c, 0.8, 3.2, l, 0, stone, T_STONE); trim.at(x, c).box(x + face * 0.25, 0.1, c, 1.4, 0.3, l, 0, cap, T_STONE); }
    void len; void cz;
    for (let z = z0 + 3; z < z1; z += 6) if (!nearBridge(x, z)) { const t = trim.at(x, z); t.box(x + face * 0.3, 0.55, z, 0.12, 1.1, 0.12, 0, steel, T_METAL); t.box(x + face * 0.3, 1.0, z + 3, 0.1, 0.1, 6, 0, steel, T_METAL); }
  };
  const hwall = (z: number, x0: number, x1: number, face: 1 | -1) => {
    for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x += 40) { const l = Math.min(40, Math.max(x0, x1) - x), c = x + l / 2; trim.at(c, z).box(c, -1.6, z + face * 0.4, l, 3.2, 0.8, 0, stone, T_STONE); trim.at(c, z).box(c, 0.1, z + face * 0.25, l, 0.3, 1.4, 0, cap, T_STONE); }
    for (let x = Math.min(x0, x1) + 3; x < Math.max(x0, x1); x += 6) { const t = trim.at(x, z); t.box(x, 0.55, z + face * 0.3, 0.12, 1.1, 0.12, 0, steel, T_METAL); t.box(x + 3, 1.0, z + face * 0.3, 6, 0.1, 0.1, 0, steel, T_METAL); }
  };
  for (const s of islandShore(o.northEdge, o.southEdge)) {
    if (s.x0 === s.x1) { wall(s.x0, s.z0, s.z1, -1); for (let z = s.z0; z < s.z1; z += 40) { const l = Math.min(40, s.z1 - z); trim.at(s.x0, z).box(s.x0 + 3, 0.0, z + l / 2, 6, 0.1, l, 0, walk, T_STONE); } }
    else { hwall(s.z0, s.x0, s.x1, 1); for (let x = Math.min(s.x0, s.x1); x < Math.max(s.x0, s.x1); x += 40) { const l = Math.min(40, Math.max(s.x0, s.x1) - x); trim.at(x, s.z0).box(x + l / 2, 0.0, s.z0 - 3, l, 0.1, 6, 0, walk, T_STONE); } }
  }
  // mainland bank across the river and its southern coast
  wall(WEST_RIVER.x0, o.northEdge, MAINLAND_Z1, 1);
  hwall(MAINLAND_Z1, -1060, WEST_RIVER.x0, -1);
  // ---- piers into the river (wooden decks on piles)
  for (const z of [-110, 90, 300, 500]) {
    const x0 = WEST_RIVER.x1 - 2, len = 40, w = 11, cx = x0 - len / 2;
    trim.at(cx, z).box(cx, -0.25, z, len, 0.4, w, 0, C('#6a4d37'), [0.9, 0, 2, 0]);
    physics.addStaticBox(cx, -0.25, z, len / 2, 0.25, w / 2);
    for (let x = x0 - 4; x > x0 - len; x -= 8) for (const dz of [-w / 2 + 0.5, w / 2 - 0.5]) trim.at(x, z).cyl(x, -6, z + dz, 0.3, 0.3, 5.7, 8, C('#3f2f22'), T_ROUGH);
    trim.at(cx, z).box(x0 - len + 0.2, 0.55, z, 0.12, 1.1, w, 0, steel, T_METAL);
  }
  // ---- bridges
  const segs = bridgeSegments(city);
  const piers = new Set<string>();
  for (const { path: p, a, b } of segs) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) + 0.6, yaw = -Math.atan2(dz, dx);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, half = p.half + SIDEWALK + 0.4;
    const t = trim.at(cx, cz);
    t.box(cx, -0.5, cz, len, 0.9, half * 2, yaw, deck, T_STONE);
    t.box(cx, -1.5, cz, len, 1.0, half * 0.5, yaw, steel, T_METAL); // central girder
    physics.addStaticBox(cx, -0.5, cz, len / 2, 0.45, half, yaw);
    const nx = -dz / (len - 0.6), nz = dx / (len - 0.6);
    for (const sg of [-1, 1]) {
      const px = cx + nx * half * sg, pz = cz + nz * half * sg;
      t.box(px, 0.62, pz, len, 0.95, 0.35, yaw, paint, T_PAINT_LOCAL);
      t.box(px, 1.15, pz, len, 0.12, 0.5, yaw, steel, T_METAL);
      physics.addStaticBox(px, 0.55, pz, len / 2, 0.55, 0.18, yaw);
    }
    const key = `${p.id}:${Math.round(cx / 22)}`;
    if (!piers.has(key) && cx > WEST_RIVER.x0 + 4 && cx < WEST_RIVER.x1 - 4) {
      piers.add(key);
      t.cyl(cx, -7, cz, 1.7, 1.4, 6.3, 12, C('#7b776f'), T_STONE);
      t.box(cx, -0.95, cz, 2.2, 0.7, half * 1.6, yaw + Math.PI / 2, C('#6a665f'), T_STONE);
      physics.addStaticCylinder(cx, -3.5, cz, 3.5, 1.5);
    }
  }
}
const T_PAINT_LOCAL: [number, number, number, number] = [0.6, 0, 0, 0];
