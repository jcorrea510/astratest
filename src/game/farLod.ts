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

/** The slice of a Rapier rigid body that parking needs (kept structural so this file stays pure and testable). */
export interface ParkableBody { isSleeping(): boolean; sleep(): void; setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void; gravityScale(): number; setGravityScale(s: number, wake: boolean): void }

/**
 * Freezes (`parked` true) or releases a far-away parked helicopter. Sleeping alone is not enough: the static colliders around
 * a far pad are streamed out, and disabling the roof it stands on wakes the body, which then sinks through where the roof was
 * (0.4 m by the time the player flew in, so the skids were embedded and take-off never happened). Gravity is switched off
 * while it is frozen and restored the moment the player is near again.
 */
export function parkHeliBody(b: ParkableBody, parked: boolean) {
  if (parked) {
    if (b.gravityScale() !== 0) b.setGravityScale(0, false);
    b.setLinvel({ x: 0, y: 0, z: 0 }, false);
    if (!b.isSleeping()) b.sleep();
  } else if (b.gravityScale() !== 1) b.setGravityScale(1, true);
}
