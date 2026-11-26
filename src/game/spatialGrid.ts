/** Tiny reusable spatial hash on the XZ plane (no per-query allocation). Items are binned at build time; callers do the exact test. */
export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  constructor(readonly cell = 32) {}
  private key(cx: number, cz: number) { return ((cx + 32768) << 16) | (cz + 32768); }
  clear() { for (const a of this.cells.values()) { a.length = 0; this.pool.push(a); } this.cells.clear(); }
  insert(item: T, x: number, z: number) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let a = this.cells.get(k);
    if (!a) { a = this.pool.pop() ?? []; this.cells.set(k, a); }
    a.push(item);
  }
  /** Appends every item whose cell overlaps the square [x±r, z±r] to `out` (callers filter exactly). */
  query(x: number, z: number, r: number, out: T[]): T[] {
    const c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const a = this.cells.get(this.key(i, j)); if (a) for (let n = 0; n < a.length; n++) out.push(a[n]); }
    return out;
  }
}
