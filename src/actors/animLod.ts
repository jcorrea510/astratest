/**
 * Animation LOD policy (Round 12 perf). Pure and unit tested.
 * State machines, damage, death and knockdown run every frame elsewhere: only POSE work is thinned here (the gun IK follows the skeleton updates: it re-solves only on a frame the skeleton was re-posed).
 */

/**
 * Seconds of accumulated time before a person's skeleton is evaluated again (0 = every frame). Off screen: 2.5 Hz. On screen: every
 * frame within 2.5 m, 30 Hz to 65 m, then 20 Hz / 10 Hz with distance. Positions and heading still follow every frame; only the pose steps.
 */
export function animEvery(dist: number, inView: boolean, ragdoll: boolean): number {
  if (!inView && !ragdoll) return 0.4;
  return dist > 90 ? 0.1 : dist > 65 ? 0.05 : dist > 2.5 ? 0.025 : 0;
}
