/**
 * Movement / collision-sweep LOD for fighters (Round 12 perf). Pure and unit tested.
 * Brains, damage, death and knockdown still run every frame: only the kinematic move + sweep is batched, with the skipped dt accumulated.
 */

/**
 * Frames between two collision sweeps of an officer / gang member. The controller shape-casts along the whole accumulated step, so a longer
 * step is as safe as several short ones; only the position resolution gets coarser (0.1 s at most), which nobody sees off screen or far away.
 * On screen: every frame within 3 m, every 2nd to 40 m, every 3rd beyond. Off screen: every 2nd within 12 m, every 4th to 40 m, every 6th beyond.
 */
export function sweepEvery(distSq: number, inView: boolean): number {
  if (distSq > 80 * 80) return 6;
  if (inView) return distSq > 40 * 40 ? 3 : distSq > 3 * 3 ? 2 : 1;
  return distSq > 40 * 40 ? 6 : distSq > 12 * 12 ? 4 : 2;
}

/** True when this fighter sweeps this frame (staggered by id so the load spreads evenly over frames). */
export function sweepNow(tick: number, id: number, every: number): boolean {
  return every <= 1 || (tick + id) % every === 0;
}

/**
 * Splits an accumulated step so no single sweep travels more than `maxTravel` metres (smaller than the capsule radius, so a fast
 * mover cannot tunnel through a wall). Returns the number of equal sub-steps; the caller sweeps each with dt / n.
 */
export function sweepSubsteps(dt: number, speed: number, maxTravel: number, maxSteps = 6): number {
  if (!(dt > 0) || !(speed > 0)) return 1;
  return Math.max(1, Math.min(maxSteps, Math.ceil(dt * speed / maxTravel)));
}
