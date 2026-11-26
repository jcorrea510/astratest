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

/**
 * Seconds of accumulated time before a person's skeleton is evaluated again (0 = every frame). Off screen: 2.5 Hz. On screen: every
 * frame within 12 m, 30 Hz to 65 m, then 20 Hz / 10 Hz with distance. Positions and heading still follow every frame; only the pose steps.
 */
export function animEvery(dist: number, inView: boolean, ragdoll: boolean): number {
  if (!inView && !ragdoll) return 0.4;
  return dist > 90 ? 0.1 : dist > 65 ? 0.05 : dist > 12 ? 0.025 : 0;
}
