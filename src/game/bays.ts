/** Round 9: the two physical garages (pure data, shared by the building code, the session flow and the tests). The opening faces north (-z). */
export interface BaySpec {
  name: string;
  /** hall centre x and the z of the front face (the roll-up door line) */
  cx: number; zf: number;
  /** outer width, depth and wall height */
  w: number; d: number; h: number;
  /** door opening */
  openW: number; openH: number;
  wall: string; accent: string; signBg: string; signFg: string; sign: string; sub: string;
}
export const BAYS: BaySpec[] = [
  { name: 'Glow Garage', cx: -182, zf: 114, w: 9.6, d: 13, h: 4.8, openW: 5.2, openH: 3.7, wall: '#b9b4a8', accent: '#7ff3ff', signBg: '#2a1e3f', signFg: '#7ff3ff', sign: 'GLOW GARAGE', sub: 'REPAIR  ·  RESPRAY  ·  TRADE-IN' },
  { name: 'Fuel Stop service bay', cx: -224, zf: 172, w: 9.6, d: 13, h: 4.8, openW: 5.2, openH: 3.7, wall: '#d6d3ca', accent: '#17a86b', signBg: '#0f7b4f', signFg: '#f6f3e8', sign: 'FUEL STOP SERVICE', sub: 'REPAIR  ·  RESPRAY  ·  TRADE-IN' },
];
/** Where the car is parked while the menu is open (hall centre line, facing the back wall). */
export function bayPark(b: BaySpec) { return { x: b.cx, z: b.zf + 6.4, yaw: 0 }; }
/** Footprint rectangle (outer walls) plus a margin. */
export function bayRect(b: BaySpec, m = 0) { return { x0: b.cx - b.w / 2 - m, x1: b.cx + b.w / 2 + m, z0: b.zf - m, z1: b.zf + b.d + m }; }
/** Index of the bay whose hall interior contains the point (-1: none). The margin keeps a car straddling the door out. */
export function bayAt(x: number, z: number): number {
  return BAYS.findIndex(b => Math.abs(x - b.cx) < b.w / 2 - 1.0 && z > b.zf + 2.0 && z < b.zf + b.d - 0.8);
}
