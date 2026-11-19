/** Every bench in the city (street, park, esplanade, bus stops): pedestrians walk to them and sit. Filled while the world is built. */
export interface Bench { x: number; y: number; z: number; /** direction a sitter faces (yaw, +z = 0) */ yaw: number; occupied: boolean }
export const BENCHES: Bench[] = [];
export function registerBench(x: number, y: number, z: number, yaw: number) { BENCHES.push({ x, y, z, yaw, occupied: false }); }
/** Nearest free bench to a point within `maxDist`, or null. */
export function nearestFreeBench(x: number, z: number, y: number, maxDist: number): Bench | null {
  let best: Bench | null = null, bd = maxDist * maxDist;
  for (const b of BENCHES) { if (b.occupied || Math.abs(b.y - y) > 2.5) continue; const d = (b.x - x) ** 2 + (b.z - z) ** 2; if (d < bd) { bd = d; best = b; } }
  return best;
}
