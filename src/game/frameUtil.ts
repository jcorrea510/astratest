/** Pure per-frame helpers for the main loop (kept out of game.ts so tests stay light). */
/** True when this rAF callback should be skipped to hold 60 fps on a 120 Hz display (gap since last frame, EMA of rAF gaps; ms). */
export function shouldSkipRaf(gap: number, ema: number): boolean { return ema < 10 && gap < 12; }
/** The `n` lamp heads nearest to `p`, nearest first, without sorting (or allocating) the whole list. `out` is reused. */
export function nearestLamps(heads: readonly { x: number; y: number; z: number }[], p: { x: number; y: number; z: number }, n: number, out: { i: number; d: number }[] = []): { i: number; d: number }[] {
  out.length = 0;
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i], dx = h.x - p.x, dy = h.y - p.y, dz = h.z - p.z, d = dx * dx + dy * dy + dz * dz;
    if (out.length === n && d >= out[n - 1].d) continue;
    let k = out.length < n ? out.length : n - 1;
    if (out.length < n) out.push({ i, d }); else { out[k].i = i; out[k].d = d; }
    while (k > 0 && out[k - 1].d > out[k].d) { const t = out[k - 1]; out[k - 1] = out[k]; out[k] = t; k--; }
  }
  return out;
}
