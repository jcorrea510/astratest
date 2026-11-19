/**
 * Everyday behaviour inside walk-in stores (store-local metres: x along the counter, z from the back wall to the door).
 * Shoppers wander the front aisle, stop at shelves to look and pick things up, queue at the till, pay and leave;
 * new ones come in through the door. Pure helpers here; Robbery runs the steering and animation.
 */
export type ShopSt = 'walk' | 'look' | 'queue' | 'pay' | 'leave' | 'enter';
export interface ShopLife { st: ShopSt; t: number; wx: number; wz: number; stuck: number; lastD: number; arrive: number; buys: boolean }
/** walkable shopping strip in front of the shelves */
export const AISLE = { x0: -4.4, x1: 2.1, z0: 2.0, z1: 4.0 };
export const DOOR_IN = { x: 3.1, z: 4.2 }, DOOR_OUT = { x: 3.1, z: 8.5 };
/** queue spots beside the till (first in line at index 0) */
export const queueSpot = (i: number) => ({ x: -1.9, z: 2.3 + i * 0.85 });
export const PAY_SPOT = { x: -3.0, z: 2.1 };
export const WALK_SPEED = 1.35;

export function aisleWaypoint(rnd: () => number, from?: { x: number; z: number }): { x: number; z: number } {
  for (let k = 0; k < 6; k++) {
    const x = AISLE.x0 + rnd() * (AISLE.x1 - AISLE.x0), z = AISLE.z0 + rnd() * (AISLE.z1 - AISLE.z0);
    if (!from || Math.hypot(x - from.x, z - from.z) > 1.2) return { x, z };
  }
  return { x: AISLE.x0 + rnd() * (AISLE.x1 - AISLE.x0), z: AISLE.z0 + rnd() * (AISLE.z1 - AISLE.z0) };
}
export const newLife = (st: ShopSt, rnd: () => number): ShopLife => ({ st, t: 1 + rnd() * 2, wx: 0, wz: 0, stuck: 0, lastD: 99, arrive: 0, buys: rnd() < 0.45 });
