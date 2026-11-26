/**
 * Movement / collision-sweep LOD for fighters (Round 12 perf). Pure and unit tested.
 * Brains, damage, death and knockdown still run every frame: only the kinematic move + sweep is batched, with the skipped dt accumulated.
 */

/** Frames between two collision sweeps of an officer / gang member: every frame within ~12 m on screen, every 2nd on screen to 80 m and off screen within 40 m, every 4th beyond. */
export function sweepEvery(distSq: number, inView: boolean): number {
  if (distSq > 80 * 80) return 4;
  if (!inView) return distSq > 40 * 40 ? 4 : 2;
  return distSq > 12 * 12 ? 2 : 1;
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
