/**
 * Crash deformation of a car body (R6-X). Pure geometry work on a car's private copy of the lod-0 body:
 *  - a spatial grid of the undamaged vertices (cached per template) finds the vertices near a contact in O(local),
 *  - vertices are pushed into the car along the impact direction with a crinkled falloff, total displacement per
 *    vertex clamped, normals tilted only for the touched triangles (the body is a triangle soup: 3 vertices per tri),
 *  - panel effects: the hood buckles up at the windshield base, the bumper droops and hangs, nose/tail crush.
 * Cost per hit is a few thousand vertices; nothing is allocated per vertex.
 */
import * as THREE from 'three';

export interface CrumpleInfo {
  /** undamaged positions (shared, read-only) and skin indices */
  orig: Float32Array; skin: Float32Array | Uint16Array;
  skip: Set<number>;
  front: number; rear: number; halfW: number;
  /** hood deck: z of the windshield base and surface height */
  hoodZ0: number; deckY: number;
  bumperTop: number;
}
const CELL = 0.4;
class Grid {
  cells = new Map<number, number[]>();
  constructor(public info: CrumpleInfo) {
    const o = info.orig, n = o.length / 3;
    for (let i = 0; i < n; i++) {
      if (info.skip.has(Number(info.skin[i * 4]))) continue;
      const k = key(Math.floor(o[i * 3] / CELL), Math.floor(o[i * 3 + 1] / CELL), Math.floor(o[i * 3 + 2] / CELL));
      let c = this.cells.get(k); if (!c) { c = []; this.cells.set(k, c); } c.push(i);
    }
  }
  query(x: number, y: number, z: number, r: number, out: number[]) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) { const l = this.cells.get(key(a, b, c)); if (l) for (let i = 0; i < l.length; i++) out.push(l[i]); }
  }
}
const key = (a: number, b: number, c: number) => ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512);
const grids = new WeakMap<Float32Array, Grid>();
/** deterministic per-position noise in [-1, 1] (so split vertices at the same spot move together) */
function noise(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 40) * 12.9898 + Math.round(y * 40) * 78.233 + Math.round(z * 40) * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
const MAX_D = 0.62;

export class Crumpler {
  /** accumulated panel state 0..1 */
  hood = 0; bumperF = 0; bumperR = 0; front = 0; rear = 0; left = 0; right = 0;
  private grid: Grid;
  private idx: number[] = [];
  private triMark = new Map<number, number>();
  constructor(private info: CrumpleInfo, private pos: THREE.BufferAttribute, private nrm: THREE.BufferAttribute) {
    let g = grids.get(info.orig); if (!g) { g = new Grid(info); grids.set(info.orig, g); } this.grid = g;
  }
  /** max distance any vertex is displaced from the undamaged shape */
  maxDisplacement(): number {
    const p = this.pos.array as Float32Array, o = this.info.orig; let m = 0;
    for (let i = 0; i < p.length; i += 3) { const d = Math.hypot(p[i] - o[i], p[i + 1] - o[i + 1], p[i + 2] - o[i + 2]); if (d > m) m = d; }
    return m;
  }
  /**
   * lp: contact point (body space), dirIn: unit direction the metal moves (into the car), energy ~0..1.4.
   * Returns the number of vertices moved.
   */
  hit(lp: THREE.Vector3, dirIn: THREE.Vector3, energy: number): number {
    const info = this.info, P = this.pos.array as Float32Array, N = this.nrm.array as Float32Array, O = info.orig;
    const e = Math.min(1.4, energy);
    const R = 0.75 + 0.85 * Math.min(1, e);
    const push = Math.min(0.5, 0.045 + 0.4 * e);
    this.grid.query(lp.x, lp.y, lp.z, R, this.idx);
    const touched = this.triMark; touched.clear();
    let moved = 0;
    for (const i of this.idx) {
      const ox = O[i * 3], oy = O[i * 3 + 1], oz = O[i * 3 + 2];
      const d = Math.hypot(ox - lp.x, (oy - lp.y) * 1.25, oz - lp.z);
      if (d > R) continue;
      const w = (1 - d / R) ** 1.5, nz = noise(ox, oy, oz);
      const k = push * w * (1 + 0.5 * nz);
      let x = P[i * 3] + dirIn.x * k + nz * k * 0.22, y = P[i * 3 + 1] + dirIn.y * k * 0.6 - Math.abs(nz) * k * 0.12, z = P[i * 3 + 2] + dirIn.z * k + noise(oz, ox, oy) * k * 0.2;
      // clamp the total displacement from the undamaged position
      const dx = x - ox, dy = y - oy, dz = z - oz, dl = Math.hypot(dx, dy, dz);
      if (dl > MAX_D) { const s = MAX_D / dl; x = ox + dx * s; y = oy + dy * s; z = oz + dz * s; }
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; moved++;
      touched.set((i / 3) | 0, 1);
    }
    this.retilt(touched);
    // panel state: which end / side took it
    const wgt = Math.min(1, e);
    if (dirIn.z < -0.45 && lp.z > 0) { this.front = Math.min(1, this.front + wgt * 0.5); this.bumperF = Math.min(1, this.bumperF + wgt * 0.6); this.hood = Math.min(1, this.hood + wgt * 0.55); }
    else if (dirIn.z > 0.45 && lp.z < 0) { this.rear = Math.min(1, this.rear + wgt * 0.5); this.bumperR = Math.min(1, this.bumperR + wgt * 0.6); }
    if (dirIn.x > 0.5) this.right = Math.min(1, this.right + wgt * 0.5); else if (dirIn.x < -0.5) this.left = Math.min(1, this.left + wgt * 0.5);
    this.pos.needsUpdate = true; this.nrm.needsUpdate = true;
    void N;
    return moved;
  }
  /** Tilts the normals of touched triangles by the change of their face normal. */
  private retilt(tris: Map<number, number>) {
    const P = this.pos.array as Float32Array, N = this.nrm.array as Float32Array, O = this.info.orig;
    for (const t of tris.keys()) {
      const a = t * 9;
      const nn = faceN(P, a), no = faceN(O, a);
      for (let v = 0; v < 3; v++) {
        const j = a + v * 3;
        const x = N[j] + (nn[0] - no[0]) * 1.4, y = N[j + 1] + (nn[1] - no[1]) * 1.4, z = N[j + 2] + (nn[2] - no[2]) * 1.4, l = Math.hypot(x, y, z) || 1;
        N[j] = x / l; N[j + 1] = y / l; N[j + 2] = z / l;
      }
    }
  }
  /**
   * Buckles the hood up at the windshield base and droops the bumper according to the accumulated state
   * (call after hit(); applies only the part not applied yet).
   */
  private hoodDone = 0; private bumpDone = 0; private bumpDoneR = 0;
  panels(sideSign: number) {
    const info = this.info, P = this.pos.array as Float32Array, O = info.orig;
    const dH = this.hood - this.hoodDone, dB = this.bumperF - this.bumpDone, dBR = this.bumperR - this.bumpDoneR;
    if (dH < 0.02 && dB < 0.02 && dBR < 0.02) return;
    this.hoodDone = this.hood; this.bumpDone = this.bumperF; this.bumpDoneR = this.bumperR;
    const touched = this.triMark; touched.clear();
    const n = O.length / 3, z0 = info.hoodZ0, zf = info.front, hw = info.halfW;
    for (let i = 0; i < n; i++) {
      const ox = O[i * 3], oy = O[i * 3 + 1], oz = O[i * 3 + 2];
      let dy = 0, dz = 0, dx = 0;
      if (dH >= 0.02 && oz > z0 - 0.05 && oy > info.deckY - 0.16 && Math.abs(ox) < hw * 0.98) {
        const u = Math.min(1, Math.max(0, (zf - oz) / Math.max(0.5, zf - z0))); // 0 at the nose, 1 at the windshield base
        const bump = Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.8;
        dy += dH * (0.2 * bump + 0.05 * u) * (1 + 0.25 * noise(ox, oy, oz));
        dz -= dH * 0.16 * (1 - u) * (1 + 0.3 * noise(oz, oy, ox));
      }
      if (dB >= 0.02 && oz > zf - 0.55 && oy < info.bumperTop + 0.03) {
        const side = 0.5 + 0.5 * Math.sign(ox * sideSign || 1) * Math.min(1, Math.abs(ox) / hw); // one end sags more
        dy -= dB * 0.2 * side * (0.5 + 0.5 * (zf - oz < 0.2 ? 1 : 0.5)); dx += Math.sign(ox) * dB * 0.03; dz -= dB * 0.07;
      }
      if (dBR >= 0.02 && oz < info.rear + 0.55 && oy < info.bumperTop + 0.03) {
        const side = 0.5 + 0.5 * Math.sign(ox * sideSign || 1) * Math.min(1, Math.abs(ox) / hw);
        dy -= dBR * 0.2 * side; dz += dBR * 0.07;
      }
      if (dy === 0 && dz === 0 && dx === 0) continue;
      let x = P[i * 3] + dx, y = P[i * 3 + 1] + dy, z = P[i * 3 + 2] + dz;
      const ex = x - ox, ey = y - oy, ez = z - oz, l = Math.hypot(ex, ey, ez);
      if (l > MAX_D + 0.15) { const s = (MAX_D + 0.15) / l; x = ox + ex * s; y = oy + ey * s; z = oz + ez * s; }
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; touched.set((i / 3) | 0, 1);
    }
    this.retilt(touched);
    this.pos.needsUpdate = true; this.nrm.needsUpdate = true;
  }
}
function faceN(a: Float32Array, o: number): [number, number, number] {
  const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
