/**
 * Visuals + colliders for the western extension: sidewalks along the curved streets, plazas/park/roundabout island,
 * landmarks (clock tower, cathedral, lighthouse, water tower) and tree cover. Landmarks go into the chunked trim
 * builders (so they cull with the rest of the city); everything is a handful of draw calls.
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { CityMap } from './citymap';
import { SIDEWALK } from './citymap';
import { Rng } from '../core/rng';
import { type Chunked, type TrimBuilder, T_PAINT, T_STONE, T_METAL, T_GLOW, T_NIGHTGLOW, T_ROUGH, T_GLASS } from './builders';
import type { ChunkInstancer } from './geometry';
import { ribbon, ribbonGeo, type Ribbon } from './expansion';
import { WEST_PLAZAS, WEST_LANDMARKS, WEST, distToPath, type Landmark } from './westside';

const C = (h: string) => new THREE.Color(h);
export interface WestCtx {
  root: THREE.Object3D; physics: Physics; city: CityMap; trim: Chunked<TrimBuilder>; props: ChunkInstancer;
  paveMat: THREE.Material; grassMat: THREE.Material;
  addTree: (x: number, y: number, z: number, yaw: number, s: number, rr: Rng) => void;
  addPalm: (x: number, y: number, z: number, yaw: number, rr: Rng, collide?: boolean) => void;
}

function flatDisc(r: number, cx: number, cz: number, y: number, uvScale: number, color?: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 56).rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv, n = p.count;
  for (let i = 0; i < n; i++) { p.setXYZ(i, p.getX(i) + cx, y, p.getZ(i) + cz); uv.setXY(i, p.getX(i) / uvScale, p.getZ(i) / uvScale); }
  if (color) { const col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  return g;
}

export function buildWest(o: WestCtx) {
  const { root, physics, city, trim } = o;
  // ---- sidewalks along the curved streets (flat; the road ribbon is 3 cm above the ground, walks 5 cm)
  const walks: Ribbon = { pos: [], nor: [], uv: [], col: [] };
  const west = city.paths.filter(p => p.kind === 'street');
  const concrete = C('#d6d2c8');
  for (const p of west) for (const sg of [-1, 1]) ribbon(walks, p.pts, sg * p.half, sg * (p.half + SIDEWALK), 0.05, concrete);
  const wm = new THREE.Mesh(ribbonGeo(walks), o.paveMat); wm.receiveShadow = true; root.add(wm);
  // ---- plazas, park, roundabout island
  const paved: THREE.BufferGeometry[] = [], green: THREE.BufferGeometry[] = [];
  const rr = new Rng(2025);
  for (const pl of WEST_PLAZAS) {
    const tb = trim.at(pl.x, pl.z);
    if (pl.kind === 'plaza') {
      paved.push(flatDisc(pl.r, pl.x, pl.z, 0.06, 6, C('#e8dcc4')));
      paved.push(flatDisc(pl.r * 0.45, pl.x, pl.z, 0.075, 5, C('#c8b99a')));
      // fountain
      tb.cyl(pl.x, 0.06, pl.z, 3.6, 3.6, 0.7, 24, C('#b9b2a4'), T_STONE); tb.cyl(pl.x, 0.5, pl.z, 3.1, 3.1, 0.25, 24, C('#2f8aa0'), T_GLASS);
      tb.cyl(pl.x, 0.6, pl.z, 0.5, 0.35, 2.4, 10, C('#cfc8ba'), T_STONE); tb.cyl(pl.x, 2.9, pl.z, 1.5, 0.4, 0.5, 14, C('#cfc8ba'), T_STONE);
      physics.addStaticCylinder(pl.x, 0.5, pl.z, 0.6, 3.6);
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + 0.3, x = pl.x + Math.cos(a) * (pl.r - 3), z = pl.z + Math.sin(a) * (pl.r - 3); o.addTree(x, 0.05, z, a, 1.0 + rr.range(0, 0.4), rr); }
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, x = pl.x + Math.cos(a) * (pl.r * 0.68), z = pl.z + Math.sin(a) * (pl.r * 0.68); tb.box(x, 0.45, z, 1.8, 0.1, 0.55, -a, C('#6b4a32'), T_ROUGH); tb.box(x, 0.2, z, 1.6, 0.4, 0.4, -a, C('#8f8a80'), T_STONE); }
    } else if (pl.kind === 'park') {
      green.push(flatDisc(pl.r, pl.x, pl.z, 0.05, 7));
      paved.push(flatDisc(pl.r * 0.18, pl.x, pl.z, 0.065, 5, C('#d9cfb8')));
      for (let k = 0; k < 46; k++) { const a = rr.range(0, 6.283), d = Math.sqrt(rr.next()) * (pl.r - 4); if (d < pl.r * 0.2) continue; o.addTree(pl.x + Math.cos(a) * d, 0.04, pl.z + Math.sin(a) * d, a, rr.range(0.9, 1.7), rr); }
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, x = pl.x + Math.cos(a) * pl.r * 0.25, z = pl.z + Math.sin(a) * pl.r * 0.25; tb.box(x, 0.45, z, 1.8, 0.1, 0.55, -a, C('#6b4a32'), T_ROUGH); tb.box(x, 0.2, z, 1.6, 0.4, 0.4, -a, C('#8f8a80'), T_STONE); }
      // bandstand
      tb.cyl(pl.x, 0.05, pl.z, 4.2, 4.2, 0.5, 8, C('#c9c2b3'), T_STONE); for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; tb.cyl(pl.x + Math.cos(a) * 3.6, 0.5, pl.z + Math.sin(a) * 3.6, 0.1, 0.1, 3.4, 6, C('#f0ece2'), T_PAINT); }
      tb.cyl(pl.x, 3.9, pl.z, 4.6, 0.3, 1.5, 8, C('#2f7a6a'), T_PAINT); physics.addStaticCylinder(pl.x, 0.5, pl.z, 0.5, 4.2);
    } else {
      // roundabout island: grass, stone kerb, flower ring, clock tower lives in the middle
      green.push(flatDisc(pl.r, pl.x, pl.z, 0.08, 7));
      tb.cyl(pl.x, 0.0, pl.z, pl.r + 0.6, pl.r + 0.6, 0.22, 40, C('#cfc9bd'), T_STONE); // kerb disc under the grass edge
      for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; o.addTree(pl.x + Math.cos(a) * (pl.r - 4), 0.08, pl.z + Math.sin(a) * (pl.r - 4), a, 1.0, rr); }
      physics.addStaticCylinder(pl.x, 0.15, pl.z, 0.2, pl.r + 0.6);
    }
  }
  const pm = new THREE.Mesh(mergeFlat(paved), o.paveMat); pm.receiveShadow = true; root.add(pm);
  const gm = new THREE.Mesh(mergeFlat(green), o.grassMat); gm.receiveShadow = true; root.add(gm);
  // ---- landmarks
  for (const lm of WEST_LANDMARKS) landmark(o, lm);
  // ---- tree cover on open ground (clear of streets, buildings and plazas)
  const lots = city.lots.filter(l => l.blockId < 0);
  const tr = new Rng(8123);
  let placed = 0;
  for (let k = 0; k < 3000 && placed < 340; k++) {
    const x = tr.range(WEST.x0 + 8, WEST.x1 - 10), z = tr.range(WEST.z0 + 6, WEST.z1 - 14);
    if (west.some(p => distToPath(p, x, z) < p.half + SIDEWALK + 3)) continue;
    if (lots.some(l => Math.hypot(l.x - x, l.z - z) < Math.hypot(l.w, l.d) / 2 + 2.5)) continue;
    if (WEST_PLAZAS.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 2) || WEST_LANDMARKS.some(l => Math.hypot(l.x - x, l.z - z) < 24)) continue;
    o.addTree(x, -0.05, z, tr.range(0, 6.28), tr.range(0.9, 1.6), tr); placed++;
  }
  // far-west boundary wall (invisible) and a low stone sea wall where the coast road meets the beach is not needed (beach slopes)
  physics.addStaticBox(WEST.x0 - 24, 12, (WEST.z0 + WEST.z1) / 2, 2, 30, (WEST.z1 - WEST.z0) / 2 + 40);
}

function mergeFlat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  let base = 0; const hasCol = parts.every(g => g.attributes.color);
  for (const g of parts) {
    const p = g.attributes.position, u = g.attributes.uv, c = g.attributes.color, n = p.count;
    for (let i = 0; i < n; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(0, 1, 0); uv.push(u.getX(i), u.getY(i)); if (hasCol) col.push(c.getX(i), c.getY(i), c.getZ(i)); }
    const ix = g.index!; for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base); base += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (hasCol) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx); out.computeBoundingSphere(); return out;
}

function landmark(o: WestCtx, lm: Landmark) {
  const { physics } = o, tb = o.trim.at(lm.x, lm.z);
  const c = Math.cos(lm.yaw), s = Math.sin(lm.yaw);
  const W = (lx: number, lz: number) => [lm.x + lx * c + lz * s, lm.z - lx * s + lz * c] as const;
  const box = (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, col: THREE.Color, t = T_STONE) => { const [x, z] = W(lx, lz); tb.box(x, y, z, sx, sy, sz, lm.yaw, col, t); };
  const col = (lx: number, y: number, lz: number, hx: number, hy: number, hz: number) => { const [x, z] = W(lx, lz); physics.addStaticBox(x, y, z, hx, hy, hz, lm.yaw); };
  const stone = C('#c9bfa9'), dark = C('#9a8f7d'), copper = C('#3f8f7a');
  if (lm.kind === 'clock') {
    box(0, 3.5, 0, 9, 7, 9, stone); box(0, 7.3, 0, 10, 0.6, 10, dark); col(0, 3.5, 0, 4.5, 3.5, 4.5);
    box(0, 17, 0, 6, 20, 6, stone); col(0, 17, 0, 3, 10, 3);
    for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) box(dx, 17, dz, 0.7, 20, 0.7, dark);
    box(0, 28.2, 0, 8, 1.2, 8, dark);
    // four lit clock faces
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const [x, z] = W(Math.sin(yaw) * 3.1, Math.cos(yaw) * 3.1);
      tb.cyl(x, 22.4, z, 2.3, 2.3, 0.18, 24, C('#f4efe0'), T_NIGHTGLOW(1.2), lm.yaw + yaw, Math.PI / 2, 0);
    }
    const [rx, rz] = W(0, 0);
    tb.cyl(rx, 29.4, rz, 5.2, 0.15, 7.5, 4, copper, T_METAL, lm.yaw + Math.PI / 4);
    tb.sphere(rx, 37.2, rz, 0.5, C('#e8c25a'), T_METAL);
    physics.addStaticCylinder(rx, 18, rz, 18, 3.2);
  } else if (lm.kind === 'cathedral') {
    box(0, 9, 0, 16, 18, 26, stone); col(0, 9, 0, 8, 9, 13);
    box(0, 18.4, 0, 17, 0.8, 27, dark);
    // gabled roof as two pitched slabs
    { const [x, z] = W(0, 0); tb.box(x - c * 4.2, 21.6, z + s * 4.2, 9.6, 0.5, 27.4, lm.yaw, C('#6f5a4a'), T_ROUGH, 0, 0.62); tb.box(x + c * 4.2, 21.6, z - s * 4.2, 9.6, 0.5, 27.4, lm.yaw, C('#6f5a4a'), T_ROUGH, 0, -0.62); }
    for (const sx of [-1, 1]) {
      box(sx * 6.5, 15, 14, 5, 30, 5, stone); col(sx * 6.5, 15, 14, 2.5, 15, 2.5);
      box(sx * 6.5, 30.3, 14, 5.8, 0.8, 5.8, dark);
      const [x, z] = W(sx * 6.5, 14); tb.cyl(x, 30.7, z, 3.6, 0.1, 13, 4, copper, T_METAL, lm.yaw + Math.PI / 4);
      box(sx * 6.5, 25, 16.55, 1.6, 4, 0.2, C('#6aa6d8'), T_NIGHTGLOW(1.4));
    }
    // rose window and door
    { const [x, z] = W(0, 16.5); tb.cyl(x, 18, z, 3.4, 3.4, 0.2, 24, C('#d98fa4'), T_NIGHTGLOW(1.5), lm.yaw, Math.PI / 2, 0); tb.cyl(x, 18, z, 3.6, 3.6, 0.12, 24, dark, T_STONE, lm.yaw, Math.PI / 2, 0); }
    box(0, 3, 13.1, 4, 6, 0.4, C('#4a3426'), T_ROUGH); box(0, 6.6, 13.1, 5, 0.7, 0.6, dark);
    for (const sz of [-8, -3, 2, 7]) for (const sx of [-1, 1]) box(sx * 8.05, 10, sz, 0.15, 6, 1.4, C('#5a8fc8'), T_NIGHTGLOW(1.1));
    box(0, 0.6, 15.5, 11, 1.2, 4, dark);
  } else if (lm.kind === 'lighthouse') {
    box(0, 2.2, 0, 11, 4.4, 9, C('#efe9dc'), T_PAINT); col(0, 2.2, 0, 5.5, 2.2, 4.5);
    const [x, z] = W(0, 0);
    tb.box(x, 5.2, z, 12, 0.7, 10, lm.yaw, C('#a63d33'), T_PAINT);
    const bands = 6;
    for (let k = 0; k < bands; k++) { const r0 = 3.4 - k * 0.2, r1 = 3.4 - (k + 1) * 0.2; tb.cyl(x, 5 + k * 5, z, r0, r1, 5, 16, k % 2 ? C('#b5362d') : C('#f1ede4'), T_PAINT); }
    tb.cyl(x, 35, z, 3.4, 3.4, 0.5, 16, C('#2d2f33'), T_METAL);
    tb.cyl(x, 35.5, z, 1.9, 1.9, 2.6, 12, C('#fff3c0'), T_GLOW(3.2));
    tb.cyl(x, 38.1, z, 2.6, 0.1, 2.4, 12, C('#b5362d'), T_PAINT);
    physics.addStaticCylinder(x, 17.5, z, 17.5, 3.4);
  } else {
    const [x, z] = W(0, 0);
    for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) tb.beam(x + dx, 0, z + dz, x + dx * 0.8, 15, z + dz * 0.8, 0.5, 0.5, C('#5a5f66'), T_METAL);
    tb.cyl(x, 15, z, 5.4, 5.4, 6.5, 16, C('#7a4a2f'), T_ROUGH); tb.cyl(x, 21.5, z, 5.6, 0.2, 3.2, 16, C('#4a4f55'), T_METAL);
    physics.addStaticCylinder(x, 8, z, 8, 3.8);
  }
}
