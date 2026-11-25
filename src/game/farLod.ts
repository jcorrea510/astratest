/** Logic LOD helpers (Round 12 perf): things far from the player think less often or not at all. Pure, unit tested. */

/**
 * True when this tick should be skipped: beyond `near` metres (squared distance `d2` against near²) an agent only runs every
 * `every`-th tick, staggered by its id so they do not all land on the same frame. The skipped time is accumulated by the caller.
 */
export function skipFarTick(d2: number, near: number, every: number, tick: number, id: number): boolean {
  return d2 > near * near && (tick + id) % every !== 0;
}

/** An undriven vehicle far from the player that is almost at rest: its body can sleep (no tyre rays, no solver cost). */
export function farIdleVehicle(d2: number, speed2: number, far = 250, slow = 2): boolean {
  return d2 > far * far && speed2 < slow * slow;
}

/** A helicopter parked on its pad (rotor stopped, nobody aboard) far away needs no flight code at all. */
export function farParkedHeli(d2: number, p: { engineOn: boolean; destroyed: boolean; rotor: number; driver: unknown }, far = 250): boolean {
  return d2 > far * far && !p.engineOn && !p.destroyed && p.rotor <= 0 && !p.driver;
}
