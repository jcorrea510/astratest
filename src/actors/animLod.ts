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

/**
 * Round 14 perf: body + extras level of detail by camera distance, with hysteresis (pure, unit tested).
 * Body levels: 0 full (< 8 m), 1 ~3000 tris, 2 ~1200, 3 ~600 (the crowd body). Extras (hair shells, scanned hair/beard, hats, garments):
 * 'full' near, 'cheap' (two-layer solid hair, no strands) mid, 'none' far where the shader-painted body carries the look.
 */
export const BODY_LOD_TRIS = [Infinity, 3000, 1200, 600] as const;
export const BODY_LOD_EDGES: readonly number[] = [8, 22, 50]; // metres: 0|1, 1|2, 2|3
export const EXTRAS_FULL_M = 12, EXTRAS_NONE_M = 32;
export const LOD_HYST = 0.15; // a level only changes once the person is 15% past the edge

export function bodyLodFor(dist: number, prev: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  let l = prev;
  while (l < 3 && dist > (BODY_LOD_EDGES[l] ?? 1e9) * (1 + LOD_HYST)) l++;
  while (l > 0 && dist < (BODY_LOD_EDGES[l - 1] ?? 0) * (1 - LOD_HYST)) l--;
  return l as 0 | 1 | 2 | 3;
}

/** 0 = full extras, 1 = cheap far hair + simple garments, 2 = none. Hidden (off screen) people draw nothing. */
export function extrasLodFor(dist: number, inView: boolean, prev: 0 | 1 | 2): 0 | 1 | 2 {
  if (!inView) return 2;
  let l = prev === 2 && dist < EXTRAS_NONE_M ? 1 : prev;
  if (l === 0 && dist > EXTRAS_FULL_M * (1 + LOD_HYST)) l = 1;
  else if (l === 1 && dist < EXTRAS_FULL_M * (1 - LOD_HYST)) l = 0;
  if (l < 2 && dist > EXTRAS_NONE_M * (1 + LOD_HYST)) l = 2;
  if (l === 2 && dist < EXTRAS_NONE_M * (1 - LOD_HYST)) l = 1;
  return l as 0 | 1 | 2;
}
