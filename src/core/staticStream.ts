/**
 * Static-collider streaming (Round 12 perf): the city has ~13k small static colliders (lamp posts, benches, building boxes,
 * trees...). Rapier's broad-phase / query pipeline cost grows with their number even when everything is asleep (1.6 ms of
 * a 3 ms physics step, plus every tyre / sweep / aim ray). Only the ones near the player can ever touch anything, so the
 * rest are switched off (collider.setEnabled(false)) and switched back on as the player approaches.
 *
 * Pure bookkeeping over a coarse grid; the physics wrapper supplies how to actually enable/disable a collider.
 */
export interface StreamEntry<T> { c: T; cell: number; /** what the rest of the game asked for (setEnabled calls) */ user: boolean; /** inside the streamed radius */ near: boolean }

export class StaticStream<T extends object> {
  private cells = new Map<number, StreamEntry<T>[]>();
  private active = new Set<number>(); // cells whose colliders are switched on
  private entries = new WeakMap<T, StreamEntry<T>>();
  private lx = NaN; private lz = NaN;
  /** colliders switched off right now (stats / tests) */ off = 0; total = 0;
  constructor(
    private apply: (c: T, on: boolean) => void,
    private alive: (c: T) => boolean = () => true,
    readonly cellSize = 64, readonly enableR = 330, readonly disableR = 380, readonly minMove = 12,
  ) {}
  private key(ix: number, iz: number) { return (ix + 512) * 1024 + (iz + 512); }
  add(c: T, x: number, z: number) {
    const ix = Math.floor(x / this.cellSize), iz = Math.floor(z / this.cellSize), k = this.key(ix, iz);
    const e: StreamEntry<T> = { c, cell: k, user: true, near: true };
    let list = this.cells.get(k); if (!list) { list = []; this.cells.set(k, list); }
    list.push(e); this.entries.set(c, e); this.active.add(k); this.total++;
    return e;
  }
  /** Interposed on collider.setEnabled: returns the state to really apply (a streamed-out collider stays off). */
  intercept(c: T, on: boolean): boolean {
    const e = this.entries.get(c);
    if (!e) return on;
    e.user = on;
    return on && e.near;
  }
  /** Squared distance from a point to a cell's rectangle. */
  private cellDist2(k: number, x: number, z: number) {
    const ix = Math.floor(k / 1024) - 512, iz = (k % 1024) - 512, s = this.cellSize;
    const dx = Math.max(ix * s - x, 0, x - (ix + 1) * s), dz = Math.max(iz * s - z, 0, z - (iz + 1) * s);
    return dx * dx + dz * dz;
  }
  private setCell(k: number, near: boolean) {
    const list = this.cells.get(k); if (!list) return;
    for (const e of list) {
      if (e.near === near) continue;
      e.near = near;
      if (!this.alive(e.c)) continue; // removed by the game (a broken lamp...)
      if (near) { if (e.user) { this.apply(e.c, true); this.off--; } } else if (e.user) { this.apply(e.c, false); this.off++; }
    }
  }
  /** Switches colliders by distance to the focus point. Cheap when the focus has barely moved. Returns true when it did work. */
  update(x: number, z: number, force = false): boolean {
    if (!force && (x - this.lx) ** 2 + (z - this.lz) ** 2 < this.minMove * this.minMove) return false;
    this.lx = x; this.lz = z;
    const r = this.enableR, s = this.cellSize, r2 = r * r, d2 = this.disableR * this.disableR;
    for (let ix = Math.floor((x - r) / s); ix <= Math.floor((x + r) / s); ix++) {
      for (let iz = Math.floor((z - r) / s); iz <= Math.floor((z + r) / s); iz++) {
        const k = this.key(ix, iz);
        if (!this.cells.has(k) || this.active.has(k) || this.cellDist2(k, x, z) > r2) continue;
        this.active.add(k); this.setCell(k, true);
      }
    }
    for (const k of this.active) {
      if (this.cellDist2(k, x, z) <= d2) continue;
      this.active.delete(k); this.setCell(k, false);
    }
    return true;
  }
  /** Number of colliders currently switched on by the stream. */
  get on() { return this.total - this.off; }
}
