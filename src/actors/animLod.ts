/**
 * Animation LOD policy (Round 12 perf). Pure and unit tested.
 * State machines, damage, death and knockdown run every frame elsewhere: only POSE work is thinned here (the gun IK follows the skeleton updates: it re-solves only on a frame the skeleton was re-posed).
 */

/**
 * Seconds of accumulated time before a person's skeleton is evaluated again (0 = every frame). Off screen: 2.5 Hz. On screen: every
 * frame within 8 m (a stepped pose is visible on a 120 Hz screen at fist-fight range), 30 Hz to 65 m (20 Hz when standing still), then 20 Hz / 10 Hz with distance. Positions and heading still follow every frame; only the pose steps.
 */
/** On-screen people closer than this always animate every frame. */
export const ANIM_FULL_RATE_M = 8;
export function animEvery(dist: number, inView: boolean, ragdoll: boolean, still = false): number {
  if (!inView && !ragdoll) return 0.4;
  const e = dist > 90 ? 0.1 : dist > 65 ? 0.05 : dist > ANIM_FULL_RATE_M ? 0.025 : 0;
  return still && !ragdoll && dist > ANIM_FULL_RATE_M ? Math.max(e, 0.05) : e; // someone standing still (a ring of officers around the suspect): the idle loop only breathes, 20 Hz is enough
}
