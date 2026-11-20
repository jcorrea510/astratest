/**
 * Visuals + colliders for the East River side: stone sea walls and a river esplanade along Eastbank, wooden piers,
 * Eastbank Green, and the two suspension bridges (granite-style towers, main cables, hangers) that stand on the
 * deck paths built in buildExpansion. Everything goes into the chunked trim builders (a handful of draw calls).
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { type CityMap, EAST_BRIDGE_TOWERS, EAST_BRIDGE_ZS, EAST_DECK_Y, EAST_RIVER, EAST_SHORE, HARBOR_X, pathHeightAt, SIDEWALK } from './citymap';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_ROUGH, T_PAINT } from './builders';
import { Rng } from '../core/rng';
import { EAST_PARK, EAST_PIERS, EAST_RIVERPARK } from './eastside';
import { registerBench } from './benches';

const C = (h: string) => new THREE.Color(h);
export interface EastCtx {
  root: THREE.Object3D; physics: Physics; city: CityMap; trim: Chunked<TrimBuilder>;
  paveMat: THREE.Material; grassMat: THREE.Material;
  addTree: (x: number, y: number, z: number, yaw: number, s: number, rr: Rng) => void;
  addPalm: (x: number, y: number, z: number, yaw: number, rr: Rng, collide?: boolean) => void;
}

export function buildEast(o: EastCtx) {
  const { physics, city, trim } = o;
  const stone = C('#6f6b64'), cap = C('#a9a498'), walk = C('#d3cec2'), steel = C('#4b5258'), wood = C('#6a4d37');
  const nearRoad = (x: number, z: number, m: number) => city.paths.some(p => p.pts.some(q => Math.hypot(q.x - x, q.z - z) < p.half + SIDEWALK + m));

  // ---- sea walls (the wall box sits on the land side of the edge line) and the river esplanade
  const wallZ = (x: number, z0: number, z1: number, face: 1 | -1, esplanade: boolean) => {
    for (let z = z0; z < z1; z += 40) {
      const l = Math.min(40, z1 - z), c = z + l / 2, t = trim.at(x, c);
      t.box(x + face * 0.4, -1.6, c, 0.8, 3.2, l, 0, stone, T_STONE); t.box(x + face * 0.25, 0.1, c, 1.4, 0.3, l, 0, cap, T_STONE);
      if (esplanade) t.box(x + face * 3, 0.0, c, 6, 0.1, l, 0, walk, T_STONE);
    }
    for (let z = z0 + 3; z < z1; z += 6) if (!nearRoad(x, z, 4)) { const t = trim.at(x, z); t.box(x + face * 0.3, 0.55, z, 0.12, 1.1, 0.12, 0, steel, T_METAL); t.box(x + face * 0.3, 1.0, z + 3, 0.1, 0.1, 6, 0, steel, T_METAL); }
  };
  const wallX = (z: number, x0: number, x1: number, face: 1 | -1) => {
    for (let x = x0; x < x1; x += 40) { const l = Math.min(40, x1 - x), c = x + l / 2, t = trim.at(c, z); t.box(c, -1.6, z + face * 0.4, l, 3.2, 0.8, 0, stone, T_STONE); t.box(c, 0.1, z + face * 0.25, l, 0.3, 1.4, 0, cap, T_STONE); }
    for (let x = x0 + 3; x < x1; x += 6) if (!nearRoad(x, z, 4)) { const t = trim.at(x, z); t.box(x, 0.55, z + face * 0.3, 0.12, 1.1, 0.12, 0, steel, T_METAL); t.box(x + 3, 1.0, z + face * 0.3, 6, 0.1, 0.1, 0, steel, T_METAL); }
  };
  wallZ(EAST_SHORE.x0, EAST_SHORE.z0, EAST_SHORE.z1, 1, true); // river bank
  wallZ(EAST_SHORE.x1, EAST_SHORE.z0, EAST_SHORE.z1, -1, false); // far (sea) edge
  wallX(EAST_SHORE.z1, EAST_SHORE.x0, EAST_SHORE.x1, -1); // south coast
  wallX(EAST_RIVER.z0, HARBOR_X, EAST_SHORE.x0, -1); // north bank of the widened river (Fort Calder side)

  // ---- piers into the river
  EAST_PIERS.forEach((z, k) => {
    const len = 38, w = 10, x0 = EAST_SHORE.x0 + 2, cx = x0 - len / 2;
    if (z < EAST_SHORE.z0 + 20) return;
    const t = trim.at(cx, z);
    t.box(cx, -0.25, z, len, 0.4, w, 0, wood, [0.9, 0, 2, 0]);
    physics.addStaticBox(cx, -0.25, z, len / 2, 0.25, w / 2);
    for (let x = x0 - 4; x > x0 - len; x -= 8) for (const dz of [-w / 2 + 0.5, w / 2 - 0.5]) t.cyl(x, -6, z + dz, 0.3, 0.3, 5.7, 8, C('#3f2f22'), T_ROUGH);
    t.box(x0 - len + 0.2, 0.55, z, 0.12, 1.1, w, 0, steel, T_METAL);
    // a few crates and bollards on the pier
    if (k % 2 === 0) { t.box(cx + 4, 0.7, z - 2, 2.2, 1.4, 2.2, 0.3, C('#8a5a32'), T_ROUGH); physics.addStaticBox(cx + 4, 0.7, z - 2, 1.1, 0.7, 1.1, 0.3); }
    for (const dz of [-w / 2 + 0.6, w / 2 - 0.6]) t.cyl(x0 - len + 1.5, 0.05, z + dz, 0.22, 0.28, 0.6, 8, C('#2f3236'), T_METAL);
  });

  // ---- Eastbank Green
  {
    const r = new Rng(4410), P = EAST_PARK, cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2, t = trim.at(cx, cz);
    t.box(cx, 0.02, cz, P.x1 - P.x0, 0.06, 4.2, 0, C('#b7ab95'), T_STONE);
    t.box(cx, 0.02, cz, 4.2, 0.06, P.z1 - P.z0, 0, C('#b7ab95'), T_STONE);
    for (let i = 0; i < 40; i++) {
      const x = r.range(P.x0 + 3, P.x1 - 3), z = r.range(P.z0 + 3, P.z1 - 3);
      if (Math.abs(x - cx) < 5 || Math.abs(z - cz) < 5) continue;
      o.addTree(x, -0.05, z, r.range(0, 6.28), r.range(1.0, 1.6), r);
    }
    for (const [dx, dz] of [[-12, 3.2], [12, 3.2], [-12, -3.2], [12, -3.2]]) { t.box(cx + dx, 0.45, cz + dz, 1.8, 0.1, 0.55, 0, C('#6b4a32'), T_ROUGH); t.box(cx + dx, 0.2, cz + dz, 1.6, 0.4, 0.4, 0, C('#8f8a80'), T_STONE); }
    // a fountain at the crossing
    t.cyl(cx, 0.05, cz, 3.4, 3.4, 0.6, 20, C('#b9b2a4'), T_STONE); t.cyl(cx, 0.5, cz, 2.9, 2.9, 0.2, 20, C('#2f8aa0'), [0.06, 0.2, 0, 0]);
    physics.addStaticCylinder(cx, 0.4, cz, 0.5, 3.4);
    // promenade trees along the river esplanade
    for (let z = EAST_SHORE.z0 + 30; z < EAST_SHORE.z1 - 20; z += 26) if (!nearRoad(EAST_SHORE.x0 + 7, z, 6) && !EAST_PIERS.some(pz => Math.abs(pz - z) < 9)) o.addTree(EAST_SHORE.x0 + 7, -0.05, z, r.range(0, 6.28), r.range(0.9, 1.3), r);
  }

  waterfront(o, nearRoad);

  // ---- suspension bridges
  for (const bz of EAST_BRIDGE_ZS) suspension(o, bz);
}

/** River esplanade life: lamps, benches and plane trees along the whole bank, pier sheds and stacked containers, and a riverside park. */
function waterfront(o: EastCtx, nearRoad: (x: number, z: number, m: number) => boolean) {
  const { physics, trim } = o;
  const r = new Rng(5521), X = EAST_SHORE.x0;
  const lamp = C('#2b2e31'), warm = C('#fff1d6');
  const pierAt = (z: number, m: number) => EAST_PIERS.some(pz => Math.abs(pz - z) < m);
  const bridgeAt = (z: number) => EAST_BRIDGE_ZS.some(bz => Math.abs(bz - z) < 14);
  for (let z = EAST_SHORE.z0 + 16; z < EAST_SHORE.z1 - 12; z += 18) {
    if (nearRoad(X + 4, z, 2) || pierAt(z, 9) || bridgeAt(z)) continue;
    const t = trim.at(X, z);
    t.cyl(X + 5.4, 0.0, z, 0.07, 0.05, 4.2, 8, lamp, T_METAL); t.beam(X + 5.4, 4.1, z, X + 4.4, 4.3, z, 0.05, 0.05, lamp, T_METAL); t.box(X + 4.3, 4.3, z, 0.7, 0.12, 0.3, 0, C('#202325'), T_METAL); t.box(X + 4.3, 4.23, z, 0.5, 0.03, 0.2, 0, warm, [0.4, 0, 3, 5]);
    if (Math.round(z / 18) % 2 === 0) { registerBench(X + 3.2, 0, z + 4, Math.PI / 2); t.box(X + 3.2, 0.45, z + 4, 0.55, 0.1, 1.8, 0, C('#6b4a32'), T_ROUGH); t.box(X + 3.0, 0.7, z + 4, 0.08, 0.5, 1.8, 0, C('#6b4a32'), T_ROUGH, 0.2); t.box(X + 3.2, 0.2, z + 4, 0.4, 0.4, 1.6, 0, C('#8f8a80'), T_STONE); }
    else if (!nearRoad(X + 8, z + 9, 6)) o.addTree(X + 8, -0.05, z + 9, r.range(0, 6.28), r.range(1.0, 1.4), r);
  }
  // pier sheds and container stacks (every other pier)
  const boxCols = ['#b23a2e', '#2f5d8a', '#c98a2b', '#3f7a4a', '#7a7d80'].map(c => C(c));
  EAST_PIERS.forEach((z, k) => {
    if (z < EAST_SHORE.z0 + 20) return;
    const x0 = X + 2, len = 38;
    const t = trim.at(x0 - len / 2, z);
    if (k % 2 === 1) {
      const sx = x0 - 14, sz = 20, sw = 7;
      t.box(sx, 3.2, z, sz, 6.2, sw, 0, C('#8d8b84'), T_ROUGH); t.box(sx, 6.5, z, sz + 0.6, 0.35, sw + 0.8, 0, C('#5d6a70'), T_METAL);
      t.box(sx + sz / 2 + 0.03, 2.0, z, 0.06, 3.4, 4.2, 0, C('#4a4f52'), T_METAL);
      physics.addStaticBox(sx, 3.2, z, sz / 2, 3.2, sw / 2);
    } else {
      for (let c = 0; c < 6; c++) { const cx = x0 - 8 - (c % 3) * 6.4, cz = z + (c < 3 ? -2.4 : 2.4); t.box(cx, 1.3 + (c === 1 ? 2.6 : 0), cz, 6.0, 2.5, 2.4, 0, boxCols[(c + k) % 5], T_METAL); }
      physics.addStaticBox(x0 - 14.4, 1.3, z, 9.6, 1.3, 4.8);
      t.box(x0 - 14.4, 3.9, z - 2.4, 6.0, 2.5, 2.4, 0, boxCols[(k + 2) % 5], T_METAL);
    }
  });
  // Brookhaven Landing: lawn, curving paths, trees, benches, a gazebo and a lawn-edge walk
  const P = EAST_RIVERPARK, cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2, w = P.x1 - P.x0, d = P.z1 - P.z0, t = trim.at(cx, cz);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), o.grassMat); lawn.position.set(cx, 0.035, cz); lawn.receiveShadow = true; o.root.add(lawn);
  t.box(cx, 0.045, cz, 4, 0.04, d - 4, 0, C('#cfc6b2'), T_STONE); t.box(cx, 0.047, cz, w - 4, 0.04, 4, 0, C('#cfc6b2'), T_STONE);
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; t.box(cx + Math.cos(a) * 7, 0.045, cz + Math.sin(a) * 7, 4.5, 0.04, 1.8, -a + Math.PI / 2, C('#cfc6b2'), T_STONE); }
  for (let i = 0; i < 26; i++) { const x = r.range(P.x0 + 3, P.x1 - 3), z = r.range(P.z0 + 3, P.z1 - 3); if (Math.abs(x - cx) < 5 || Math.abs(z - cz) < 5) continue; o.addTree(x, -0.05, z, r.range(0, 6.28), r.range(1.0, 1.7), r); }
  for (const [bx, bz] of [[-6, 6], [6, 6], [-6, -6], [6, -6]]) { registerBench(cx + bx, 0, cz + bz, Math.atan2(-bx, -bz)); t.box(cx + bx, 0.45, cz + bz, 1.8, 0.1, 0.55, 0, C('#6b4a32'), T_ROUGH); t.box(cx + bx, 0.2, cz + bz, 1.6, 0.4, 0.4, 0, C('#8f8a80'), T_STONE); }
  // gazebo at the crossing
  t.cyl(cx, 0.05, cz, 3.8, 3.8, 0.35, 10, C('#c9c2b3'), T_STONE);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; t.cyl(cx + Math.cos(a) * 3.3, 0.4, cz + Math.sin(a) * 3.3, 0.1, 0.1, 3.3, 6, C('#f0ece2'), T_PAINT); }
  t.cyl(cx, 3.7, cz, 4.3, 0.3, 1.6, 10, C('#2f6a5a'), T_PAINT);
  physics.addStaticCylinder(cx, 0.4, cz, 0.4, 3.8);
  for (const sx of [-1, 1]) for (let z = P.z0 + 6; z < P.z1; z += 16) { t.cyl(cx + sx * (w / 2 - 2), 0, z, 0.07, 0.05, 4.2, 8, lamp, T_METAL); t.sphere(cx + sx * (w / 2 - 2), 4.3, z, 0.22, warm, [0.4, 0, 3, 5]); }
}

function suspension(o: EastCtx, bz: number) {
  const { physics, city, trim } = o;
  const path = city.paths.find(p => p.kind === 'freeway' && p.pts[0].x > 500 && p.pts[0].x < 540 && Math.abs(p.pts[0].z - bz) < 2 && p.pts[p.pts.length - 1].x > 700);
  if (!path) return;
  const deckAt = (x: number) => pathHeightAt(path, x, bz).y;
  const granite = C('#8c8780'), graniteDark = C('#6d6963'), cable = C('#3c3f43'), tie = C('#5a5f64');
  const [t0, t1] = EAST_BRIDGE_TOWERS;
  const legZ = path.half + 1.9, topY = EAST_DECK_Y + 32, baseY = -7, hgt = topY - baseY;
  // towers: two granite legs, portal cross-beams, caps and an aircraft light
  for (const tx of [t0, t1]) {
    const tb = trim.at(tx, bz);
    for (const sg of [-1, 1]) {
      const z = bz + sg * legZ;
      tb.box(tx, baseY + hgt / 2, z, 3.0, hgt, 3.6, 0, granite, T_STONE);
      tb.box(tx, topY + 0.6, z, 3.6, 1.2, 4.2, 0, graniteDark, T_STONE);
      tb.box(tx, -0.5, z, 5.6, 1.4, 6.4, 0, graniteDark, T_STONE); // pile cap / fender at the waterline
      physics.addStaticBox(tx, baseY + hgt / 2, z, 1.5, hgt / 2, 1.8);
    }
    for (const y of [EAST_DECK_Y + 11, EAST_DECK_Y + 21, topY - 1.2]) tb.box(tx, y, bz, 2.4, 1.7, legZ * 2 - 2.6, 0, granite, T_STONE);
    // gothic-ish portal: a diagonal brace under each cross-beam
    for (const y of [EAST_DECK_Y + 11, EAST_DECK_Y + 21]) for (const sg of [-1, 1]) tb.beam(tx, y - 1.0, bz + sg * (legZ - 1.6), tx, y - 4.5, bz + sg * (legZ * 0.45), 1.0, 1.0, graniteDark, T_STONE);
    tb.sphere(tx, topY + 1.8, bz, 0.35, C('#ff3020'), [0.4, 0, 4, 3]);
  }
  // pedestrian walkways on both outboard sides of the deck (outside the tower legs), with railings and brackets; they follow the deck profile
  {
    const step = 10, steel2 = C('#59626a'), walk2 = C('#cfc9bc'), rail = C('#aeb4b8');
    for (const sg of [-1, 1]) {
      const zIn = path.half + 3.9, zOut = path.half + 6.3, zc = bz + sg * (zIn + zOut) / 2;
      let prev: { x: number; y: number } | null = null;
      for (let x = 535; x <= 735; x += step) {
        const y = deckAt(x) + 0.15;
        if (prev) {
          const a = prev, b = { x, y }, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y), pitch = Math.atan2(b.y - a.y, b.x - a.x);
          if (Math.max(a.y, b.y) > 0.2) { // built from the shore so people can walk up onto it
            const tb = trim.at(mx, zc);
            tb.beam(a.x, a.y - 0.25, zc, b.x, b.y - 0.25, zc, zOut - zIn, 0.5, walk2, T_STONE);
            for (const zr of [bz + sg * (zIn + 0.08), bz + sg * (zOut - 0.08)]) {
              tb.beam(a.x, a.y + 1.1, zr, b.x, b.y + 1.1, zr, 0.1, 0.1, rail, T_METAL);
              tb.beam(a.x, a.y + 0.55, zr, b.x, b.y + 0.55, zr, 0.05, 0.05, rail, T_METAL);
              for (let k = 0; k <= 4; k++) { const t = k / 4, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t; tb.box(px, py + 0.55, zr, 0.08, 1.1, 0.08, 0, rail, T_METAL); }
              const rc = physics.addStaticBox(mx, my + 0.55, zr, len / 2, 0.55, 0.06); rc.setRotation({ x: 0, y: 0, z: Math.sin(pitch / 2), w: Math.cos(pitch / 2) });
            }
            const wc = physics.addStaticBox(mx, my - 0.25, zc, len / 2, 0.25, (zOut - zIn) / 2); wc.setRotation({ x: 0, y: 0, z: Math.sin(pitch / 2), w: Math.cos(pitch / 2) });
            // bracket back to the deck edge
            tb.beam(mx, my - 0.5, bz + sg * (zIn + 0.4), mx, my - 2.1, bz + sg * (path.half + 0.7), 0.2, 0.2, steel2, T_METAL);
          }
        }
        prev = { x, y };
      }
    }
  }
  // main cables: side spans straight to the anchorages, main span sagging between the towers
  const anchorW = 541, anchorE = 740;
  for (const sg of [-1, 1]) {
    const z = bz + sg * legZ, tb = trim.at((t0 + t1) / 2, z);
    const pts: { x: number; y: number }[] = [];
    pts.push({ x: anchorW, y: deckAt(anchorW) + 1.4 });
    for (let k = 1; k <= 4; k++) { const t = k / 5; pts.push({ x: anchorW + (t0 - anchorW) * t, y: (deckAt(anchorW) + 1.4) + (topY + 0.2 - deckAt(anchorW) - 1.4) * Math.pow(t, 1.15) }); }
    const mid = (t0 + t1) / 2, span = (t1 - t0) / 2, low = EAST_DECK_Y + 3.2;
    for (let k = 0; k <= 16; k++) { const x = t0 + (t1 - t0) * k / 16, u = (x - mid) / span; pts.push({ x, y: low + (topY + 0.2 - low) * u * u }); }
    for (let k = 1; k <= 4; k++) { const t = k / 5, ye = deckAt(anchorE) + 1.4; pts.push({ x: t1 + (anchorE - t1) * t, y: topY + 0.2 + (ye - topY - 0.2) * Math.pow(t, 1.15) }); }
    pts.push({ x: anchorE, y: deckAt(anchorE) + 1.4 });
    for (let i = 1; i < pts.length; i++) tb.beam(pts[i - 1].x, pts[i - 1].y, z, pts[i].x, pts[i].y, z, 0.55, 0.55, cable, T_METAL);
    // hangers from the cable down to the deck edge
    const yAt = (x: number) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i].x) { const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x || 1); return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t; } return pts[pts.length - 1].y; };
    for (let x = anchorW + 6; x < anchorE - 4; x += 5) {
      if (Math.abs(x - t0) < 3 || Math.abs(x - t1) < 3) continue;
      const yc = yAt(x), yd = deckAt(x) + 0.9;
      if (yc - yd < 1) continue;
      tb.beam(x, yc, z, x, yd, z, 0.1, 0.1, tie, T_METAL);
    }
    // anchorage blocks
    for (const ax of [anchorW, anchorE]) { tb.box(ax, 1.2, z, 5, 2.4, 3.2, 0, graniteDark, T_STONE); physics.addStaticBox(ax, 1.2, z, 2.5, 1.2, 1.6); }
  }
}
