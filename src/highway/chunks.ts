/**
 * Streamed road chunks. Each chunk is CL metres of highway (carriageways, median barrier, rails, sound walls, lamps, signs,
 * overpasses, an occasional exit ramp, terrain and trees) built from a handful of merged meshes, so the whole visible road is ~40 draw calls.
 * Chunks are built on demand ahead of the player and disposed behind; positions are kept relative to a floating origin.
 */
import * as THREE from 'three';
import { Geo, rgb, type V3 } from './geo';
import { roadAt, hash, terrainOffset, heightAt, INNER, OUTER, SHOULDER, RAIL_U, MEDIAN_HALF, STEP, NL, LANE_W, type RoadPoint } from './road';
import { DASH_CYCLE, cellUV } from './textures';

export const CL = 96;
const ROWS = CL / STEP;

export interface ChunkMats { road: THREE.Material; ground: THREE.Material; struct: THREE.Material; lamp: THREE.Material; glow: THREE.Material; sign: THREE.Material; shade: THREE.Material }
export interface Chunk { index: number; origin: THREE.Vector3; group: THREE.Group; lit: boolean; geos: THREE.BufferGeometry[] }

const GRASS: V3[] = [rgb('#3d4a2a'), rgb('#46552f'), rgb('#37452a'), rgb('#4b4a30')];
const DIRT = rgb('#5a5040'), GRAVEL = rgb('#6d675b'), CONCRETE = rgb('#9a978f'), CONCRETE_D = rgb('#77746d'), STEEL = rgb('#a9afb3'), POLE = rgb('#6c7174');
const LAMP_HOT = rgb('#ffcf8a');

interface Frame { p: RoadPoint; r: V3; f: V3; up: V3 }
function frameAt(s: number): Frame {
  const p = roadAt(s), ct = Math.cos(p.theta), st = Math.sin(p.theta);
  const r: V3 = [ct, 0, st];
  const fl = Math.hypot(1, p.slope), f: V3 = [st / fl, p.slope / fl, -ct / fl];
  // up = right x forward... right-handed: up = r x f? check with r=(1,0,0), f=(0,0,-1): r x f = (0*-1-0*0, 0*0-1*-1, 0) = (0,1,0)
  const up: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { p, r, f, up };
}

export class ChunkBuilder {
  constructor(private mats: ChunkMats) {}

  build(index: number): Chunk {
    const s0 = index * CL, o0 = roadAt(s0);
    const origin = new THREE.Vector3(o0.x, o0.y, o0.z);
    const local = (s: number, u: number, h = 0): V3 => {
      const f = frameAt(s);
      return [f.p.x + f.r[0] * u - origin.x, f.p.y + h - origin.y, f.p.z + f.r[2] * u - origin.z];
    };
    const rowsS: number[] = []; for (let j = 0; j <= ROWS; j++) rowsS.push(s0 + j * STEP);
    const lit = hash(Math.floor(index / 3), 11) > 0.3;

    // ---- asphalt
    const road = new Geo();
    {
      const pts: V3[][] = [], uvs: [number, number][][] = [];
      const v0 = ((s0 / DASH_CYCLE) % 1 + 1) % 1;
      rowsS.forEach((s, j) => {
        pts.push([local(s, -SHOULDER), local(s, SHOULDER)]);
        const v = v0 + (j * STEP) / DASH_CYCLE; uvs.push([[0, v], [1, v]]);
      });
      road.grid(pts, [1, 1, 1], uvs);
    }
    // ---- terrain + trees + ramp (vertex coloured, one material)
    const ground = new Geo();
    const cols = [SHOULDER - 0.2, 21.4, 25, 34, 60, 110, 200, 330];
    {
      for (const sg of [-1, 1]) {
        const pts: V3[][] = [], colors: V3[][] = [];
        rowsS.forEach(s => {
          const rowP: V3[] = [], rowC: V3[] = [];
          cols.forEach((a, k) => {
            const u = sg * a;
            rowP.push(local(s, u, k === 0 ? -0.02 : terrainOffset(s, u)));
            const n = hash(Math.floor(s / 40) * 7 + k * 3 + (sg > 0 ? 1 : 0), 21);
            const g = GRASS[Math.floor(n * 4) % 4];
            rowC.push(k <= 1 ? GRAVEL : k === 2 ? DIRT : g);
          });
          pts.push(rowP); colors.push(rowC);
        });
        if (sg < 0) { pts.forEach(r => r.reverse()); colors.forEach(r => r.reverse()); } // keep triangles facing up
        ground.grid(pts, colors);
      }
    }
    // trees
    for (let t = 0; t < 46; t++) {
      const hs = hash(index * 131 + t, 31), hu = hash(index * 131 + t, 32), hr = hash(index * 131 + t, 33), side = hash(index * 131 + t, 34) < 0.5 ? -1 : 1;
      const s = s0 + hs * CL, a = 27 + Math.pow(hu, 1.6) * 150;
      if (hash(Math.floor((s0 + hs * CL) / 70), 41 + (side > 0 ? 1 : 0)) < 0.25) continue; // clearings
      const p = local(s, side * a, terrainOffset(s, side * a) - 0.4);
      const sc = 0.8 + hr * 0.9, g = 0.65 + hr * 0.3;
      ground.cone(p[0], p[1], p[2], 1.9 * sc, 7.5 * sc, [0.07 * g, 0.16 * g, 0.07 * g], 5);
    }
    // ---- structure: median barrier, guard rails, posts, sound wall, poles, gantries, overpass
    const st = new Geo(), lampG = new Geo(), glowG = new Geo(), signG = new Geo(), shadeG = new Geo();
    const profile: [number, number][] = [[-0.3, 0], [-0.22, 0.25], [-0.1, 0.81], [0.1, 0.81], [0.22, 0.25], [0.3, 0]];
    for (let j = 0; j < ROWS; j++) {
      const sa = rowsS[j], sb = rowsS[j + 1];
      const col = (Math.floor(sa / 4) % 2 === 0) ? CONCRETE : CONCRETE_D;
      for (let e = 0; e < profile.length - 1; e++) {
        const [u0, h0] = profile[e], [u1, h1] = profile[e + 1];
        st.quad(local(sa, u0, h0), local(sb, u0, h0), local(sb, u1, h1), local(sa, u1, h1), col, local((sa + sb) / 2, (u0 + u1) / 2 + (e < 2 ? -3 : e > 2 ? 3 : 0), (h0 + h1) / 2 + (e === 2 ? 3 : 0)));
      }
      // W-beam guard rails on both outer edges
      for (const sg of [-1, 1]) {
        const ramp = this.hasRamp(index) && sg > 0 && j > 1 && j < 17;
        if (ramp) continue;
        const u = sg * RAIL_U;
        st.quad(local(sa, u, 0.55), local(sb, u, 0.55), local(sb, u, 0.93), local(sa, u, 0.93), STEEL, local((sa + sb) / 2, u - sg * 3, 0.75));
        st.quad(local(sa, u, 0.55), local(sb, u, 0.55), local(sb, u, 0.93), local(sa, u, 0.93), STEEL, local((sa + sb) / 2, u + sg * 3, 0.75));
        if (j % 1 === 0) {
          const f = frameAt(sa);
          const p = local(sa, u + sg * 0.12, 0.4);
          st.box(p[0], p[1], p[2], f.r, f.up, f.f, 0.05, 0.42, 0.05, POLE);
        }
      }
    }
    // sound wall along one side of some chunks
    if (hash(Math.floor(index / 2), 51) < 0.28) {
      const sg = hash(Math.floor(index / 2), 52) < 0.7 ? 1 : -1, u = sg * (RAIL_U + 2.2);
      for (let j = 0; j < ROWS; j++) {
        if (this.hasRamp(index) && sg > 0) break;
        const sa = rowsS[j], sb = rowsS[j + 1], panel = Math.floor(sa / 6) % 2 ? rgb('#8d8a82') : rgb('#7f7c76');
        const inner = sg > 0 ? u - 0.18 : u + 0.18, outer = sg > 0 ? u + 0.18 : u - 0.18;
        st.quad(local(sa, inner, 0), local(sb, inner, 0), local(sb, inner, 4.4), local(sa, inner, 4.4), panel, local((sa + sb) / 2, inner - sg * 4, 2.2));
        st.quad(local(sa, outer, 0), local(sb, outer, 0), local(sb, outer, 4.4), local(sa, outer, 4.4), panel, local((sa + sb) / 2, outer + sg * 4, 2.2));
        st.quad(local(sa, inner, 4.4), local(sb, inner, 4.4), local(sb, outer, 4.4), local(sa, outer, 4.4), panel, local((sa + sb) / 2, u, 9));
      }
    }
    // median light poles with two arms; sodium pools on the road
    if (lit) {
      for (const k of [0.125, 0.625]) {
        const s = s0 + k * CL, f = frameAt(s);
        const b = local(s, 0, 0);
        st.box(b[0], b[1] + 5.2, b[2], f.r, [0, 1, 0], f.f, 0.13, 5.2, 0.13, POLE);
        for (const sg of [-1, 1]) {
          const a = local(s, sg * 2.3, 10.15);
          st.box(a[0], a[1], a[2], f.r, [0, 1, 0], f.f, 2.3, 0.07, 0.07, POLE);
          const l = local(s, sg * 4.5, 10.05);
          lampG.box(l[0], l[1], l[2], f.r, [0, 1, 0], f.f, 0.7, 0.07, 0.28, LAMP_HOT, false);
          const gc = local(s, sg * 7.2, 0.05);
          this.pool(glowG, gc, f, 24, 30);
        }
      }
    }
    // overhead sign gantries (before exits and now and then)
    const gantry = this.hasRamp(index + 1) ? 0 : hash(index, 61) < 0.2 ? 1 + Math.floor(hash(index, 62) * 3) : -1;
    if (gantry >= 0) {
      const s = s0 + 40, f = frameAt(s);
      for (const u of [1.1, OUTER + 3.4]) { const b = local(s, u, 0); st.box(b[0], b[1] + 3.6, b[2], f.r, [0, 1, 0], f.f, 0.2, 3.7, 0.2, POLE); }
      const t = local(s, (1.1 + OUTER + 3.4) / 2, 7.1);
      st.box(t[0], t[1], t[2], f.r, [0, 1, 0], f.f, (OUTER + 3.4 - 1.1) / 2, 0.22, 0.28, POLE);
      const [u0, v0, u1, v1] = cellUV(gantry === 3 ? 3 : gantry);
      const w = 5.2, uc = gantry === 1 ? 6 : 11;
      signG.quad(local(s - 0.3, uc - w / 2, 4.9), local(s - 0.3, uc + w / 2, 4.9), local(s - 0.3, uc + w / 2, 4.9 + w / 2), local(s - 0.3, uc - w / 2, 4.9 + w / 2), [1, 1, 1], local(s - 5, uc, 5.5), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      // sign lighting strip
      const l = local(s - 0.5, uc, 4.75); lampG.box(l[0], l[1], l[2], f.r, [0, 1, 0], f.f, w * 0.4, 0.04, 0.08, rgb('#fff4d8'), false);
    }
    // roadside signs
    if (hash(index, 71) < 0.35) {
      const s = s0 + 20 + hash(index, 72) * 60, f = frameAt(s), cellI = 4 + Math.floor(hash(index, 73) * 4);
      const [u0, v0, u1, v1] = cellUV(cellI), uu = SHOULDER + 2.3;
      const b = local(s, uu, 0); st.box(b[0], b[1] + 1.4, b[2], f.r, [0, 1, 0], f.f, 0.05, 1.4, 0.05, POLE);
      signG.quad(local(s - 0.08, uu - 0.9, 1.8), local(s - 0.08, uu + 0.9, 1.8), local(s - 0.08, uu + 0.9, 2.25 + 1.8), local(s - 0.08, uu - 0.9, 2.25 + 1.8), [1, 1, 1], local(s - 5, uu, 2.5), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      void v1;
    }
    // overpass
    if (index >= 3 && hash(index, 81) < 0.17 && gantry < 0 && !this.hasRamp(index)) this.overpass(st, shadeG, local, s0 + CL / 2, origin);
    // exit ramp
    if (this.hasRamp(index)) this.ramp(ground, local, s0, index);

    const mk = (g: Geo, mat: THREE.Material, smooth: boolean, name: string): THREE.Mesh | null => {
      if (g.empty) return null;
      const m = new THREE.Mesh(g.build(smooth), mat); m.name = name; m.matrixAutoUpdate = true; m.frustumCulled = true; return m;
    };
    const group = new THREE.Group(), geos: THREE.BufferGeometry[] = [];
    const meshes = [mk(road, this.mats.road, true, 'road'), mk(ground, this.mats.ground, true, 'ground'), mk(st, this.mats.struct, false, 'struct'), mk(lampG, this.mats.lamp, false, 'lamps'), mk(glowG, this.mats.glow, false, 'glow'), mk(signG, this.mats.sign, false, 'signs'), mk(shadeG, this.mats.shade, false, 'shade')];
    for (const m of meshes) if (m) { group.add(m); geos.push(m.geometry); }
    meshes[0]!.receiveShadow = false;
    if (meshes[4]) meshes[4].renderOrder = 3;
    if (meshes[6]) meshes[6].renderOrder = 2;
    return { index, origin, group, lit, geos };
  }

  private pool(g: Geo, c: V3, f: Frame, w: number, l: number): void {
    const hw = w / 2, hl = l / 2, col: V3 = [1, 0.8, 0.5];
    const P = (a: number, b: number): V3 => [c[0] + f.r[0] * a + f.f[0] * b, c[1] + f.r[1] * a + f.f[1] * b + 0.04, c[2] + f.r[2] * a + f.f[2] * b];
    g.quad(P(-hw, -hl), P(hw, -hl), P(hw, hl), P(-hw, hl), col, [c[0], c[1] + 5, c[2]]);
  }
  private hasRamp(index: number): boolean { return index >= 4 && hash(index, 91) < 0.1 && hash(index - 1, 91) >= 0.1 && hash(index + 1, 91) >= 0.1; }

  private ramp(g: Geo, local: (s: number, u: number, h?: number) => V3, s0: number, index: number): void {
    const n = 22, rows: V3[][] = [], cols: V3[][] = [];
    const asphalt = rgb('#303236'), paint = rgb('#cfcfc8');
    const half = 2.9;
    for (let j = 0; j <= n; j++) {
      const t = j / n, s = s0 + 6 + t * 90, e = t * t * (3 - 2 * t);
      const uc = OUTER + 2.6 + 40 * e + (hash(index, 92) - 0.5) * 6 * e;
      const roadY = heightAt(s);
      const gY = roadY + terrainOffset(s, uc) + 0.2;
      const sink = 3.5 * Math.max(0, (t - 0.7) / 0.3);
      const hh = (roadY + (gY - roadY) * e) - roadY - sink;
      const widen = 1 + (1 - Math.min(1, t * 4)) * 0.4;
      rows.push([local(s, uc - half * widen - 0.2, hh + 0.03), local(s, uc - half * widen, hh + 0.05), local(s, uc + half * widen, hh + 0.05), local(s, uc + half * widen + 0.2, hh + 0.03)]);
      cols.push([paint, asphalt, asphalt, paint]);
    }
    g.grid(rows, cols);
  }

  private overpass(st: Geo, shade: Geo, local: (s: number, u: number, h?: number) => V3, s: number, origin: THREE.Vector3): void {
    const f = frameAt(s), deckBottom = Math.max(heightAt(s - 8), heightAt(s + 8)) + 6.2;
    const hs = 6.5, halfW = 27; // deck depth (along s) and half width
    const hY = (y: number) => y - origin.y;
    const concrete = rgb('#8f8c85'), dark = rgb('#4a4c50'), pierC = rgb('#7d7a74');
    const c = local(s, 0, 0);
    // deck slab + road surface + parapets
    st.box(c[0], hY(deckBottom + 0.55), c[2], f.r, [0, 1, 0], f.f, halfW, 0.55, hs, concrete, false);
    st.box(c[0], hY(deckBottom + 1.12), c[2], f.r, [0, 1, 0], f.f, halfW - 0.2, 0.04, hs - 1.2, dark);
    for (const sg of [-1, 1]) {
      const b = local(s + sg * (hs - 0.2), 0, 0);
      st.box(b[0], hY(deckBottom + 1.65), b[2], f.r, [0, 1, 0], f.f, halfW, 0.5, 0.2, concrete);
    }
    // piers: one in the median, two outside the rails
    for (const u of [0, -23.5, 23.5]) {
      const b = local(s, u, 0), w = u === 0 ? 0.95 : 0.8;
      st.box(b[0], hY(deckBottom - 3.85), b[2], f.r, [0, 1, 0], f.f, w, 4.2, 1.5, pierC);
    }
    // soft shadow under the bridge
    const a: V3 = local(s - hs * 1.6, -SHOULDER, 0.06), b: V3 = local(s - hs * 1.6, SHOULDER, 0.06), cc: V3 = local(s + hs * 1.6, SHOULDER, 0.06), d: V3 = local(s + hs * 1.6, -SHOULDER, 0.06);
    shade.quad(a, b, cc, d, [0, 0, 0], [a[0], a[1] + 5, a[2]]);
  }

  dispose(c: Chunk): void { for (const g of c.geos) g.dispose(); }
}
void NL; void LANE_W; void INNER; void MEDIAN_HALF;
