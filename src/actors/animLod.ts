/**
 * Animation LOD policy (Round 12 perf). Pure and unit tested.
 * State machines, damage, death and knockdown run every frame elsewhere: only POSE work (the two-hand gun IK, and skinning) is thinned here.
 */

/** Frames between two gun-hold IK solves for an armed NPC: every frame up close, thinner with distance, rare when off screen. */
export function holdEvery(distSq: number, inView: boolean): number {
  if (!inView) return 24;
  if (distSq < 8 * 8) return 1;
  if (distSq < 25 * 25) return 2;
  return 4;
}

/** True when this NPC solves the gun hold this frame (staggered by id so they do not all land on the same frame). */
export function holdNow(tick: number, id: number, every: number): boolean {
  return every <= 1 || (tick + id) % every === 0;
}
