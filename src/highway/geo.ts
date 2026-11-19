/** Tiny geometry accumulator for the highway scenery: flat-shaded quads/boxes with vertex colours, merged into one BufferGeometry. */
import * as THREE from 'three';

export type V3 = [number, number, number];
const c = new THREE.Color();
export function rgb(hex: string | number): V3 { c.set(hex as THREE.ColorRepresentation); return [c.r, c.g, c.b]; }

export class Geo {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  /** per-vertex surface kind (vehicle shader attribute aKind); only emitted when `withKinds` */
  kinds: number[] = []; curKind = 0; withKinds = false;
  get empty(): boolean { return this.idx.length === 0; }
  private vert(p: V3, n: V3, color: V3, u = 0, v = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.kinds.push(this.curKind); this.col.push(color[0], color[1], color[2]); this.uv.push(u, v);
    return i;
  }
  /** Quad p0..p3 in order around the face; `hint` (a point on the outer side) decides which way it faces. */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, color: V3, hint?: V3, uvs?: [number, number][]): void {
    const a = p0, d = p2; let b = p1, e = p3;
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = e[0] - a[0], vy = e[1] - a[1], vz = e[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (hint) {
      const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4, cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4, cz = (p0[2] + p1[2] + p2[2] + p3[2]) / 4;
      if (nx * (hint[0] - cx) + ny * (hint[1] - cy) + nz * (hint[2] - cz) < 0) { b = p3; e = p1; ux = b[0] - a[0]; uy = b[1] - a[1]; uz = b[2] - a[2]; vx = e[0] - a[0]; vy = e[1] - a[1]; vz = e[2] - a[2]; nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; if (uvs) uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; }
    }
    const l = Math.hypot(nx, ny, nz) || 1, n: V3 = [nx / l, ny / l, nz / l];
    const t = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    const i0 = this.vert(a, n, color, t[0][0], t[0][1]), i1 = this.vert(b, n, color, t[1][0], t[1][1]), i2 = this.vert(d, n, color, t[2][0], t[2][1]), i3 = this.vert(e, n, color, t[3][0], t[3][1]);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  /** Oriented box: centre, axes (unit), half sizes along the axes. */
  box(cx: number, cy: number, cz: number, ax: V3, ay: V3, az: V3, hx: number, hy: number, hz: number, color: V3, skipBottom = true): void {
    const P = (sx: number, sy: number, sz: number): V3 => [
      cx + ax[0] * hx * sx + ay[0] * hy * sy + az[0] * hz * sz,
      cy + ax[1] * hx * sx + ay[1] * hy * sy + az[1] * hz * sz,
      cz + ax[2] * hx * sx + ay[2] * hy * sy + az[2] * hz * sz];
    const ctr: V3 = [cx, cy, cz];
    this.quad(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), color, [cx + ay[0] * 9, cy + ay[1] * 9, cz + ay[2] * 9]);
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), color, [cx + az[0] * 9, cy + az[1] * 9, cz + az[2] * 9]);
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), color, [cx - az[0] * 9, cy - az[1] * 9, cz - az[2] * 9]);
    this.quad(P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), color, [cx + ax[0] * 9, cy + ax[1] * 9, cz + ax[2] * 9]);
    this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), color, [cx - ax[0] * 9, cy - ax[1] * 9, cz - ax[2] * 9]);
    if (!skipBottom) this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), color, [cx - ay[0] * 9, cy - ay[1] * 9, cz - ay[2] * 9]);
    void ctr;
  }
  /** Cylinder along the x axis (wheels). */
  cylX(cx: number, cy: number, cz: number, r: number, len: number, color: V3, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const y0 = cy + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, y1 = cy + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.quad([cx - len / 2, y0, z0], [cx + len / 2, y0, z0], [cx + len / 2, y1, z1], [cx - len / 2, y1, z1], color, [cx, cy + Math.cos(am) * 9, cz + Math.sin(am) * 9]);
    }
    for (const sg of [-1, 1]) for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.quad([cx + sg * len / 2, cy, cz], [cx + sg * len / 2, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r], [cx + sg * len / 2, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r], [cx + sg * len / 2, cy, cz], color, [cx + sg * 9, cy, cz]);
    }
  }
  /** Cone (tree) with `n` sides around +y. */
  cone(cx: number, cy: number, cz: number, r: number, h: number, color: V3, n = 5, tip = 0.0): void {
    const top: V3 = [cx, cy + h, cz];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0: V3 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], p1: V3 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
      const am = (a0 + a1) / 2;
      const col: V3 = [color[0] * (0.85 + 0.15 * Math.cos(am)), color[1] * (0.85 + 0.15 * Math.cos(am)), color[2] * (0.85 + 0.15 * Math.cos(am))];
      this.quad(p0, p1, top, top, col, [cx + Math.cos(am) * 9, cy + 1 + tip, cz + Math.sin(am) * 9]);
    }
  }
  /** Smooth grid strip (terrain, road): rows of `cols` points, vertex normals computed afterwards. */
  grid(points: V3[][], colors: V3[][] | V3, uvs?: [number, number][][]): void {
    const rows = points.length, cols = points[0].length, base = this.pos.length / 3;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const col = Array.isArray(colors[0]) ? (colors as V3[][])[r][k] : (colors as V3);
      const uv = uvs ? uvs[r][k] : [0, 0];
      this.vert(points[r][k], [0, 1, 0], col, uv[0], uv[1]);
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
      const a = base + r * cols + k, b = a + 1, d = a + cols, e = d + 1;
      this.idx.push(a, b, d, b, e, d);
    }
  }
  build(smooth = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withKinds) g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kinds, 1));
    g.setIndex(this.idx);
    if (smooth) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
