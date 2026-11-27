/** Physical drive-in custom garages across Port Meridian (pure data, shared by world build, session flow, and tests). Openings face north (-z). */
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
  { name: 'Glow Garage', cx: -182, zf: 114, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#2a2e35', accent: '#38e8ff', signBg: '#121826', signFg: '#54f0ff', sign: 'GLOW GARAGE', sub: 'CUSTOMS  ·  REPAIR  ·  RESPRAY' },
  { name: 'Fuel Stop Service', cx: -224, zf: 172, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#31363c', accent: '#25d48a', signBg: '#0d2219', signFg: '#42f2a6', sign: 'FUEL STOP SERVICE', sub: 'BODYWORK  ·  PAINT  ·  TRADE-IN' },
  { name: 'Brickline Customs', cx: -100, zf: -286, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#352b28', accent: '#ff6e42', signBg: '#1e1210', signFg: '#ff8a5c', sign: 'BRICKLINE CUSTOMS', sub: 'RESTORATION  ·  PAINT  ·  BUYBACK' },
  { name: 'Apex Auto Works', cx: 200, zf: 314, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#262b34', accent: '#5aa2ff', signBg: '#0e1728', signFg: '#7ab8ff', sign: 'APEX AUTO WORKS', sub: 'PERFORMANCE  ·  PAINT  ·  SERVICE' },
  { name: 'Bayshore Performance', cx: -100, zf: 614, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#2d2b32', accent: '#f5a855', signBg: '#1a1510', signFg: '#ffc278', sign: 'BAYSHORE GARAGE', sub: 'REPAIR  ·  RESPRAY  ·  APPRAISAL' },
  { name: 'Harborline Motors', cx: 400, zf: 114, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#2c3033', accent: '#f5c23b', signBg: '#191711', signFg: '#ffd65c', sign: 'HARBORLINE MOTORS', sub: 'DOCKS SERVICE  ·  PAINT  ·  SALES' },
  { name: 'Strandline Garage', cx: 200, zf: 864, w: 10.6, d: 13.6, h: 5.2, openW: 5.6, openH: 3.85, wall: '#343330', accent: '#ff7096', signBg: '#22121b', signFg: '#ff8fae', sign: 'STRANDLINE CUSTOMS', sub: 'COASTAL AUTO  ·  PAINT  ·  TRADE' },
];

/** Where the car is parked while the menu is open (hall centre line, facing the back wall). */
export function bayPark(b: BaySpec) { return { x: b.cx, z: b.zf + 6.6, yaw: 0 }; }

/** Footprint rectangle (outer walls) plus a margin. */
export function bayRect(b: BaySpec, m = 0) { return { x0: b.cx - b.w / 2 - m, x1: b.cx + b.w / 2 + m, z0: b.zf - m, z1: b.zf + b.d + m }; }

/** True when a point falls inside any garage hall footprint or its north approach driveway across the sidewalk. */
export function nearBayDriveway(x: number, z: number, extraX = 2.6): boolean {
  return BAYS.some(b => Math.abs(x - b.cx) < b.w / 2 + extraX && z > b.zf - 12 && z < b.zf + b.d + 3);
}

/** Index of the bay whose hall interior contains the point (-1: none). The margin keeps a car straddling the door out. */
export function bayAt(x: number, z: number): number {
  return BAYS.findIndex(b => Math.abs(x - b.cx) < b.w / 2 - 1.1 && z > b.zf + 2.0 && z < b.zf + b.d - 0.9);
}
