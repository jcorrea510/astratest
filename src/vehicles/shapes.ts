/**
 * Body shapes of every vehicle model (pure data, no three.js): proportions, deck line, greenhouse, doors,
 * lamps and trim. The procedural builder (models/build.ts) turns these into meshes; layoutFor() turns them into
 * the physics layout (wheels, collider) so the headless handling tests drive the same cars the game shows.
 *
 * Frames: +z forward, +x = LEFT (driver side), y up. Shape heights are metres above the ground; z is metres from
 * the middle of the wheelbase. The vehicle body frame sits GROUND below that (ground at y = GROUND).
 */
import type { VehicleLayout, WheelDef } from './vehiclePhysics';
import { VEHICLES, type VehicleKind } from './specs';

export const GROUND = -0.35;
export type RimStyle = 'spoke5' | 'multi' | 'steel' | 'hubcap' | 'mesh' | 'chrome' | 'truck' | 'race' | 'twin';
/** Lamp/grille area on the nose or tail: centre |x|, centre y, half width, half height, superellipse exponent. */
export interface Lamp { x: number; y: number; w: number; h: number; p?: number }
export interface Greenhouse {
  /** windshield base z, backlight base z, roof front / rear edge z */
  zA: number; zC: number; zR1: number; zR2: number;
  /** roof height, roof half width, extra inset of the window base from the deck edge, plan exponents of base and roof */
  roof: number; roofW: number; inset: number; pB: number; pR: number;
  /** B-pillar centre z and half width; where the last side window ends; for 4 doors, where the rear door glass ends */
  zB: number; bw: number; winEnd: number;
  /** windshield edge and rear-glass edge as plan-normal angles (deg from forward) */
  wsAngle: number; rearAngle: number;
  /** share of the side height that is glass (above it: door frame / roof rail) */
  glassTop: number;
  open?: boolean; blackPillars?: boolean; frameless?: boolean;
}
export interface CarShape {
  type: 'car' | 'pickup' | 'boxvan' | 'truck' | 'tank';
  L: number; W: number; zOff: number; wb: number; axles?: number[];
  R: number; tw: number; rim: RimStyle; rimColor: string; arch: number;
  clear: number; endRise: number;
  /** deck line (hood, beltline, trunk) as (z, y) from the tail to the nose */
  top: [number, number][];
  /** bottom / shoulder rounding radii, tumblehome, side bulge, plan superellipse exponent, nose / tail set-back at the top, bumper bulge, waist pinch */
  rb: number; rs: number; tumble: number; bulge: number; plan: number; noseIn: number; tailIn: number; bump: number; pinch: number;
  gh: Greenhouse | null;
  /** door z ranges per row (mirrored left/right) */
  doors: [number, number][];
  head: Lamp[]; tail: Lamp[]; grille: Lamp & { style: number; chrome?: boolean }; intake?: Lamp;
  bumper: 'paint' | 'black' | 'chrome'; bumperF: [number, number]; bumperR: [number, number];
  interior: string; seatRows: number;
  extras: string[];
  /** glass darkness 0..1, livery id, paint metallic 0..1 */
  tint: number; livery: number; metallic: number;
  /** cargo/bed/box: z range and top */
  cargo?: { z0: number; z1: number; y0: number; y1: number; hw: number };
}
const base: CarShape = {
  type: 'car', L: 4.78, W: 1.8, zOff: -0.08, wb: 2.72, R: 0.32, tw: 0.21, rim: 'spoke5', rimColor: '#b9bec4', arch: 0.075,
  clear: 0.19, endRise: 0.1,
  top: [[-2.47, 0.91], [-2.3, 0.99], [-1.5, 1.01], [0, 0.98], [1.0, 0.96], [1.75, 0.9], [2.31, 0.81]],
  rb: 0.08, rs: 0.085, tumble: 0.035, bulge: 0.018, plan: 5.5, noseIn: 0.13, tailIn: 0.07, bump: 0.035, pinch: 0,
  gh: { zA: 1.0, zC: -1.5, zR1: 0.22, zR2: -0.95, roof: 1.46, roofW: 0.64, inset: 0.03, pB: 5, pR: 5, zB: -0.05, bw: 0.055, winEnd: -1.02, wsAngle: 60, rearAngle: 138, glassTop: 0.9 },
  doors: [[-0.01, 0.95], [-1.02, -0.09]],
  head: [{ x: 0.6, y: 0.69, w: 0.23, h: 0.075, p: 3 }], tail: [{ x: 0.66, y: 0.85, w: 0.2, h: 0.07, p: 4 }],
  grille: { x: 0, y: 0.63, w: 0.34, h: 0.065, p: 4, style: 0 }, intake: { x: 0, y: 0.37, w: 0.46, h: 0.055, p: 6 },
  bumper: 'paint', bumperF: [0.24, 0.55], bumperR: [0.3, 0.62],
  interior: '#3a3a3d', seatRows: 2, extras: ['wipers', 'handles'], tint: 0.25, livery: 0, metallic: 0.7,
};
const sh = (o: Partial<CarShape>, gh?: Partial<Greenhouse> | null): CarShape => ({ ...base, ...o, gh: gh === null ? null : { ...base.gh!, ...(o.gh ?? {}), ...(gh ?? {}) } });

const fullsize = sh({
  L: 5.38, W: 1.98, zOff: -0.17, wb: 2.91, R: 0.34, tw: 0.225, rim: 'multi', plan: 7.5, rs: 0.075, noseIn: 0.08, tailIn: 0.05, tumble: 0.04,
  top: [[-2.86, 0.94], [-2.66, 1.03], [-1.75, 1.05], [0, 1.0], [1.12, 0.98], [1.9, 0.92], [2.52, 0.84]],
  doors: [[0.03, 1.08], [-1.16, -0.06]], clear: 0.2,
  head: [{ x: 0.66, y: 0.75, w: 0.21, h: 0.075, p: 6 }], tail: [{ x: 0.7, y: 0.86, w: 0.2, h: 0.09, p: 6 }],
  grille: { x: 0, y: 0.73, w: 0.4, h: 0.085, p: 7, style: 0, chrome: true }, intake: { x: 0, y: 0.4, w: 0.3, h: 0.05, p: 6 },
  bumperF: [0.26, 0.6], bumperR: [0.3, 0.64], extras: ['wipers', 'handles', 'rubstrip'], metallic: 0.5,
}, { zA: 1.12, zC: -1.72, zR1: 0.3, zR2: -1.05, roof: 1.47, roofW: 0.7, zB: -0.02, winEnd: -1.12, wsAngle: 60, rearAngle: 125, pB: 5, pR: 7 });

/** Round 7: a body scaled from another (length / width / height factors): proportions, deck line, greenhouse, lamps, cargo. */
function scaled(o: CarShape, kL: number, kW: number, kH: number, extra: Partial<CarShape> = {}): CarShape {
  const L = (l: Lamp) => ({ ...l, y: l.y * kH });
  const gh = o.gh ? { ...o.gh, zA: o.gh.zA * kL, zC: o.gh.zC * kL, zR1: o.gh.zR1 * kL, zR2: o.gh.zR2 * kL, zB: o.gh.zB * kL, winEnd: o.gh.winEnd * kL, roof: o.gh.roof * kH, roofW: o.gh.roofW * kW } : null;
  return {
    ...o, L: o.L * kL, W: o.W * kW, zOff: o.zOff * kL, wb: o.wb * kL, R: o.R * Math.min(1, kH), tw: o.tw * kW, clear: o.clear * kH,
    top: o.top.map(([z, y]) => [z * kL, y * kH] as [number, number]), doors: o.doors.map(([a, b]) => [a * kL, b * kL] as [number, number]),
    head: o.head.map(L), tail: o.tail.map(L), grille: { ...o.grille, y: o.grille.y * kH }, intake: o.intake ? L(o.intake) : undefined,
    bumperF: [o.bumperF[0] * kH, o.bumperF[1] * kH], bumperR: [o.bumperR[0] * kH, o.bumperR[1] * kH], gh,
    cargo: o.cargo ? { z0: o.cargo.z0 * kL, z1: o.cargo.z1 * kL, y0: o.cargo.y0 * kH, y1: o.cargo.y1 * kH, hw: o.cargo.hw * kW } : undefined,
    ...extra,
  };
}
export const SHAPES = {
  sedan: base,
  hatch: sh({
    L: 3.86, W: 1.68, zOff: 0.08, wb: 2.45, R: 0.29, tw: 0.185, rim: 'hubcap', rimColor: '#a9adb2', plan: 4.6, noseIn: 0.14, tailIn: 0.03,
    top: [[-1.85, 0.95], [-1.72, 1.0], [-1.5, 1.0], [0, 0.95], [0.9, 0.92], [1.5, 0.85], [2.01, 0.76]], clear: 0.16,
    doors: [[-0.04, 0.82], [-0.92, -0.12]],
    head: [{ x: 0.55, y: 0.72, w: 0.2, h: 0.08, p: 3 }], tail: [{ x: 0.66, y: 0.92, w: 0.1, h: 0.13, p: 3 }],
    grille: { x: 0, y: 0.66, w: 0.26, h: 0.045, p: 4, style: 1 }, intake: { x: 0, y: 0.38, w: 0.4, h: 0.06, p: 6 },
    bumper: 'paint', bumperF: [0.22, 0.55], bumperR: [0.25, 0.6], metallic: 0.3,
  }, { zA: 0.86, zC: -1.72, zR1: 0.1, zR2: -1.38, roof: 1.44, roofW: 0.6, zB: -0.08, winEnd: -1.1, wsAngle: 58, rearAngle: 128, pB: 4.5, pR: 5 }),
  wagon: sh({
    L: 4.9, W: 1.82, zOff: -0.12, wb: 2.78, R: 0.32, rim: 'multi', plan: 6, tailIn: 0.02,
    top: [[-2.57, 0.95], [-2.45, 1.0], [-1.5, 1.01], [0, 0.98], [1.05, 0.95], [1.8, 0.86], [2.33, 0.76]],
    doors: [[0.0, 0.98], [-1.06, -0.1]], extras: ['wipers', 'handles', 'rails'],
    tail: [{ x: 0.7, y: 0.95, w: 0.09, h: 0.17, p: 4 }], metallic: 0.5,
  }, { zA: 1.05, zC: -2.45, zR1: 0.15, zR2: -2.3, roof: 1.48, roofW: 0.64, zB: -0.06, winEnd: -2.05, wsAngle: 58, rearAngle: 108, pR: 6 }),
  coupe: sh({
    L: 4.42, W: 1.82, zOff: -0.02, wb: 2.64, R: 0.33, tw: 0.235, rim: 'spoke5', rimColor: '#c9ccd0', plan: 4.4, noseIn: 0.14, tailIn: 0.05, rs: 0.1, clear: 0.15,
    top: [[-2.23, 0.86], [-2.05, 0.95], [-1.4, 0.97], [0, 0.92], [0.78, 0.88], [1.5, 0.77], [2.19, 0.66]],
    doors: [[-0.62, 0.7]], seatRows: 2,
    head: [{ x: 0.6, y: 0.64, w: 0.22, h: 0.06, p: 2.6 }], tail: [{ x: 0.64, y: 0.82, w: 0.2, h: 0.055, p: 3 }],
    grille: { x: 0, y: 0.55, w: 0.18, h: 0.05, p: 3, style: 1 }, intake: { x: 0, y: 0.33, w: 0.5, h: 0.07, p: 5 },
    extras: ['wipers', 'handles', 'lip', 'exhaust2'], metallic: 0.8, bumperF: [0.2, 0.5], bumperR: [0.26, 0.58],
  }, { zA: 0.78, zC: -1.55, zR1: -0.02, zR2: -0.72, roof: 1.3, roofW: 0.56, zB: -0.66, bw: 0.03, winEnd: -1.12, wsAngle: 54, rearAngle: 118, pB: 3.2, pR: 4, glassTop: 0.97, frameless: true }),
  taxi: { ...fullsize, rim: 'hubcap', livery: 2, extras: [...fullsize.extras, 'taxisign'], metallic: 0 },
  police: { ...fullsize, rim: 'steel', rimColor: '#2a2b2d', livery: 1, extras: [...fullsize.extras, 'lightbar', 'pushbar', 'antenna', 'spot'], metallic: 0 },
  fullsize,
  luxury: sh({
    ...fullsize, L: 5.62, W: 2.0, zOff: -0.2, wb: 3.06, R: 0.34, rim: 'chrome', rimColor: '#dfe3e6', plan: 8, noseIn: 0.06, tailIn: 0.03,
    top: [[-2.99, 0.97], [-2.8, 1.04], [-1.85, 1.05], [0, 1.0], [1.2, 0.98], [2.0, 0.93], [2.61, 0.86]],
    doors: [[0.05, 1.13], [-1.22, -0.05]], interior: '#8a6e52', bumper: 'paint',
    head: [{ x: 0.68, y: 0.76, w: 0.18, h: 0.09, p: 8 }], tail: [{ x: 0.9, y: 0.84, w: 0.06, h: 0.2, p: 8 }],
    grille: { x: 0, y: 0.74, w: 0.4, h: 0.1, p: 10, style: 2, chrome: true }, intake: { x: 0, y: 0.42, w: 0.36, h: 0.04, p: 6 },
    extras: ['wipers', 'handles', 'chromebelt', 'rubstrip', 'ornament', 'exhaust2'], metallic: 0.8,
  }, { zA: 1.2, zC: -1.85, zR1: 0.25, zR2: -1.2, roof: 1.46, roofW: 0.7, zB: -0.02, winEnd: -1.18, wsAngle: 62, rearAngle: 126, pB: 6, pR: 8 }),
  muscle: sh({
    L: 4.86, W: 1.92, zOff: -0.02, wb: 2.78, R: 0.34, tw: 0.25, rim: 'mesh', rimColor: '#3a3c40', plan: 7, noseIn: 0.03, tailIn: 0.03, rs: 0.07, clear: 0.16,
    top: [[-2.45, 0.96], [-2.32, 1.03], [-1.5, 1.04], [0, 0.98], [0.55, 0.95], [1.6, 0.94], [2.41, 0.87]],
    doors: [[-0.72, 0.55]], seatRows: 2,
    head: [{ x: 0.66, y: 0.82, w: 0.1, h: 0.1, p: 2 }], tail: [{ x: 0.62, y: 0.88, w: 0.24, h: 0.07, p: 8 }],
    grille: { x: 0, y: 0.8, w: 0.58, h: 0.11, p: 8, style: 1 }, intake: { x: 0, y: 0.42, w: 0.5, h: 0.05, p: 6 },
    extras: ['wipers', 'handles', 'scoop', 'ducktail', 'exhaust2'], livery: 4, metallic: 0.2, bumperF: [0.25, 0.55], bumperR: [0.28, 0.62],
  }, { zA: 0.58, zC: -1.5, zR1: -0.22, zR2: -0.86, roof: 1.33, roofW: 0.62, zB: -0.76, bw: 0.03, winEnd: -1.15, wsAngle: 55, rearAngle: 122, pB: 5, pR: 6, glassTop: 0.95 }),
  super: sh({
    L: 4.52, W: 2.0, zOff: 0.12, wb: 2.66, R: 0.34, tw: 0.27, rim: 'race', rimColor: '#1e1f22', plan: 4.2, noseIn: 0.02, tailIn: 0.04, rs: 0.09, clear: 0.12, endRise: 0.04,
    top: [[-2.14, 0.9], [-2.0, 0.98], [-1.5, 0.98], [-0.6, 0.88], [0.4, 0.8], [1.4, 0.64], [2.38, 0.46]],
    doors: [[-0.7, 0.86]], seatRows: 1, pinch: 0.05,
    head: [{ x: 0.66, y: 0.6, w: 0.22, h: 0.04, p: 2.4 }], tail: [{ x: 0.62, y: 0.84, w: 0.26, h: 0.035, p: 4 }],
    grille: { x: 0, y: 0.32, w: 0.6, h: 0.06, p: 6, style: 1 }, intake: { x: 0, y: 0.25, w: 0.3, h: 0.02, p: 6 },
    bumperF: [0.16, 0.4], bumperR: [0.2, 0.5], extras: ['wipers', 'sideintake', 'wing', 'exhaust2', 'diffuser'], metallic: 0.85,
  }, { zA: 0.98, zC: -1.7, zR1: 0.05, zR2: -0.55, roof: 1.13, roofW: 0.55, zB: -0.72, bw: 0.03, winEnd: -1.0, wsAngle: 50, rearAngle: 120, pB: 3, pR: 3.5, glassTop: 0.97, frameless: true, blackPillars: true }),
  convertible: sh({
    L: 4.6, W: 1.8, zOff: -0.05, wb: 2.7, R: 0.33, tw: 0.225, rim: 'multi', rimColor: '#c9ccd0', plan: 5, noseIn: 0.13, tailIn: 0.05, clear: 0.16,
    top: [[-2.35, 0.88], [-2.2, 0.96], [-1.4, 0.98], [0, 0.94], [0.95, 0.91], [1.7, 0.8], [2.25, 0.7]],
    doors: [[-0.6, 0.85]], seatRows: 2, interior: '#b48a62',
    head: [{ x: 0.58, y: 0.66, w: 0.22, h: 0.065, p: 2.8 }], tail: [{ x: 0.64, y: 0.84, w: 0.2, h: 0.06, p: 4 }],
    grille: { x: 0, y: 0.58, w: 0.22, h: 0.05, p: 3, style: 0, chrome: true }, extras: ['wipers', 'handles', 'boot', 'exhaust2'], metallic: 0.8,
  }, { zA: 0.92, zC: -1.45, zR1: 0.32, zR2: -1.2, roof: 1.27, roofW: 0.62, zB: -0.62, bw: 0.03, winEnd: -1.1, wsAngle: 56, rearAngle: 125, open: true, glassTop: 1, frameless: true }),
  pickup: sh({
    type: 'pickup', L: 5.46, W: 2.0, zOff: -0.13, wb: 3.35, R: 0.39, tw: 0.255, rim: 'truck', rimColor: '#c3c6ca', plan: 9, noseIn: 0.04, tailIn: 0.0, rs: 0.06, rb: 0.06, clear: 0.34, endRise: 0.08, tumble: 0.025,
    top: [[-2.86, 1.12], [-2.6, 1.14], [-0.6, 1.15], [0, 1.15], [0.95, 1.14], [1.9, 1.13], [2.6, 1.08]],
    doors: [[-0.48, 0.93]], seatRows: 1, interior: '#4a4844',
    head: [{ x: 0.72, y: 0.98, w: 0.17, h: 0.1, p: 7 }], tail: [{ x: 0.93, y: 0.96, w: 0.04, h: 0.16, p: 8 }],
    grille: { x: 0, y: 0.92, w: 0.5, h: 0.16, p: 10, style: 3, chrome: true }, intake: { x: 0, y: 0.52, w: 0.3, h: 0.04, p: 6 },
    bumper: 'chrome', bumperF: [0.4, 0.68], bumperR: [0.45, 0.68], extras: ['wipers', 'handles', 'flares'], metallic: 0.5,
    cargo: { z0: -2.82, z1: -0.68, y0: 0.74, y1: 1.15, hw: 0.9 },
  }, { zA: 0.98, zC: -0.62, zR1: 0.42, zR2: -0.55, roof: 1.88, roofW: 0.8, zB: -0.55, bw: 0.03, winEnd: -0.42, wsAngle: 66, rearAngle: 150, pB: 8, pR: 9, glassTop: 0.93 }),
  suv: sh({
    L: 5.0, W: 2.0, zOff: -0.08, wb: 2.95, R: 0.39, tw: 0.25, rim: 'multi', rimColor: '#c3c6ca', plan: 8, noseIn: 0.07, tailIn: 0.0, rs: 0.07, clear: 0.33, endRise: 0.06, tumble: 0.03,
    top: [[-2.58, 1.12], [-2.45, 1.17], [0, 1.17], [1.0, 1.15], [1.8, 1.12], [2.42, 1.04]],
    doors: [[0.04, 1.0], [-1.02, -0.05]], interior: '#3c3a38',
    head: [{ x: 0.68, y: 1.02, w: 0.2, h: 0.09, p: 5 }], tail: [{ x: 0.86, y: 1.12, w: 0.07, h: 0.17, p: 6 }],
    grille: { x: 0, y: 0.98, w: 0.44, h: 0.12, p: 8, style: 0, chrome: true }, intake: { x: 0, y: 0.56, w: 0.4, h: 0.05, p: 6 },
    bumper: 'black', bumperF: [0.4, 0.75], bumperR: [0.42, 0.72], extras: ['wipers', 'handles', 'rails', 'flares', 'steps'], metallic: 0.5,
  }, { zA: 1.04, zC: -2.5, zR1: 0.38, zR2: -2.4, roof: 1.9, roofW: 0.82, zB: -0.03, winEnd: -2.12, wsAngle: 62, rearAngle: 112, pB: 6, pR: 8, glassTop: 0.92 }),
  minivan: sh({
    L: 5.06, W: 1.95, zOff: -0.05, wb: 3.0, R: 0.33, tw: 0.22, rim: 'hubcap', rimColor: '#b2b6bb', plan: 6, noseIn: 0.1, tailIn: 0.0, clear: 0.2,
    top: [[-2.58, 1.0], [-2.45, 1.05], [0, 1.04], [1.05, 1.0], [1.85, 0.9], [2.48, 0.78]],
    doors: [[0.12, 1.12], [-1.15, 0.02]], interior: '#5a5550',
    head: [{ x: 0.62, y: 0.8, w: 0.24, h: 0.08, p: 3 }], tail: [{ x: 0.86, y: 1.05, w: 0.07, h: 0.2, p: 6 }],
    grille: { x: 0, y: 0.74, w: 0.3, h: 0.06, p: 6, style: 0, chrome: true }, extras: ['wipers', 'handles', 'rails'], metallic: 0.5,
  }, { zA: 1.25, zC: -2.52, zR1: 0.2, zR2: -2.4, roof: 1.76, roofW: 0.76, zB: 0.06, winEnd: -2.15, wsAngle: 60, rearAngle: 112, pB: 4.5, pR: 6 }),
  van: sh({
    type: 'boxvan', L: 6.1, W: 2.06, zOff: -0.55, wb: 3.6, R: 0.4, tw: 0.24, rim: 'steel', rimColor: '#d5d7d9', plan: 9, noseIn: 0.12, tailIn: 0, clear: 0.33, endRise: 0.05, rs: 0.06,
    top: [[-3.6, 1.05], [-1.0, 1.08], [0.6, 1.12], [1.6, 1.2], [2.1, 1.15], [2.5, 1.04]],
    doors: [[0.75, 1.62]], seatRows: 1, interior: '#4a4844',
    head: [{ x: 0.7, y: 0.96, w: 0.2, h: 0.09, p: 6 }], tail: [{ x: 0.92, y: 0.75, w: 0.06, h: 0.15, p: 8 }],
    grille: { x: 0, y: 0.9, w: 0.46, h: 0.11, p: 8, style: 0 }, bumper: 'black', bumperF: [0.38, 0.66], bumperR: [0.4, 0.62],
    extras: ['wipers', 'handles', 'mudflaps'], metallic: 0, tint: 0.2,
    cargo: { z0: -3.58, z1: 0.62, y0: 1.04, y1: 2.95, hw: 1.13 },
  }, { zA: 1.7, zC: 0.68, zR1: 0.95, zR2: 0.72, roof: 2.25, roofW: 0.92, zB: 0.7, bw: 0.02, winEnd: 0.76, wsAngle: 64, rearAngle: 170, pB: 7, pR: 9, glassTop: 0.92 }),
  race: sh({
    L: 4.55, W: 1.98, zOff: -0.02, wb: 2.64, R: 0.34, tw: 0.28, rim: 'race', rimColor: '#d8b44a', plan: 4.4, noseIn: 0.12, tailIn: 0.05, rs: 0.1, clear: 0.1, endRise: 0.04, pinch: 0.03,
    top: [[-2.29, 0.84], [-2.1, 0.92], [-1.4, 0.95], [0, 0.9], [0.78, 0.86], [1.5, 0.74], [2.25, 0.6]],
    doors: [[-0.62, 0.7]], seatRows: 1, interior: '#1c1c1e',
    head: [{ x: 0.62, y: 0.6, w: 0.22, h: 0.055, p: 2.6 }], tail: [{ x: 0.66, y: 0.8, w: 0.2, h: 0.05, p: 3 }],
    grille: { x: 0, y: 0.48, w: 0.3, h: 0.06, p: 3, style: 1 }, intake: { x: 0, y: 0.26, w: 0.62, h: 0.07, p: 6 },
    bumperF: [0.15, 0.45], bumperR: [0.2, 0.5], extras: ['wipers', 'flares', 'bigwing', 'splitter', 'exhaust2', 'cage', 'pins'], livery: 3, metallic: 0.3, tint: 0.1,
  }, { zA: 0.8, zC: -1.5, zR1: -0.02, zR2: -0.74, roof: 1.27, roofW: 0.56, zB: -0.66, bw: 0.03, winEnd: -1.1, wsAngle: 54, rearAngle: 118, pB: 3.2, pR: 4, glassTop: 0.97, frameless: true }),
  fbi: sh({ tint: 0.85, rim: 'steel', rimColor: '#1b1c1e', extras: ['wipers', 'handles', 'rails', 'flares', 'steps', 'pushbar', 'grillelights', 'antenna'], metallic: 0.2, bumper: 'black' }),
  swat: sh({
    type: 'boxvan', L: 6.0, W: 2.3, zOff: -0.45, wb: 3.5, R: 0.46, tw: 0.3, rim: 'truck', rimColor: '#222326', plan: 10, noseIn: 0.06, tailIn: 0, clear: 0.42, endRise: 0.04, rs: 0.05, tumble: 0.02,
    top: [[-3.45, 1.25], [-1.0, 1.27], [0.6, 1.3], [1.6, 1.36], [2.1, 1.32], [2.55, 1.22]],
    doors: [[0.75, 1.6]], seatRows: 1, interior: '#2a2a2a',
    head: [{ x: 0.78, y: 1.12, w: 0.16, h: 0.08, p: 6 }], tail: [{ x: 1.02, y: 0.95, w: 0.06, h: 0.13, p: 8 }],
    grille: { x: 0, y: 1.08, w: 0.52, h: 0.14, p: 10, style: 3 }, bumper: 'black', bumperF: [0.48, 0.8], bumperR: [0.5, 0.75],
    extras: ['wipers', 'handles', 'pushbar', 'lightbar', 'steps', 'slits'], metallic: 0, tint: 0.8, livery: 5,
    cargo: { z0: -3.42, z1: 0.62, y0: 1.24, y1: 2.85, hw: 1.2 },
  }, { zA: 1.7, zC: 0.68, zR1: 1.05, zR2: 0.72, roof: 2.42, roofW: 1.0, zB: 0.7, bw: 0.02, winEnd: 0.76, wsAngle: 66, rearAngle: 170, pB: 9, pR: 10, glassTop: 0.88 }),
  army: sh({
    type: 'truck', L: 7.0, W: 2.45, zOff: 0.1, wb: 4.6, axles: [2.4, -1.3, -2.65], R: 0.53, tw: 0.36, rim: 'truck', rimColor: '#4b5236', plan: 12, noseIn: 0.04, tailIn: 0, clear: 0.55, endRise: 0.02, rs: 0.04, rb: 0.04, tumble: 0.0, bulge: 0,
    top: [[-3.4, 1.42], [-0.2, 1.42], [0.6, 1.62], [1.6, 1.66], [3.0, 1.6], [3.6, 1.5]],
    doors: [[0.72, 1.6]], seatRows: 1, interior: '#3a3c30',
    head: [{ x: 0.82, y: 1.36, w: 0.1, h: 0.1, p: 2 }], tail: [{ x: 1.08, y: 1.05, w: 0.06, h: 0.06, p: 6 }],
    grille: { x: 0, y: 1.3, w: 0.6, h: 0.18, p: 12, style: 2 }, bumper: 'black', bumperF: [0.62, 0.88], bumperR: [0.62, 0.84],
    extras: ['wipers', 'handles', 'canvas', 'spare'], metallic: 0, tint: 0.2, livery: 6,
    cargo: { z0: -3.4, z1: 0.55, y0: 1.42, y1: 3.15, hw: 1.22 },
  }, { zA: 1.62, zC: 0.62, zR1: 1.5, zR2: 0.66, roof: 2.72, roofW: 1.08, zB: 0.65, bw: 0.02, winEnd: 0.7, wsAngle: 70, rearAngle: 170, pB: 12, pR: 12, glassTop: 0.86, inset: 0.03 }),
  bus: sh({
    type: 'boxvan', L: 11.6, W: 2.55, zOff: -0.3, wb: 6.4, R: 0.5, tw: 0.3, rim: 'truck', rimColor: '#cfd2d4', plan: 14, noseIn: 0.05, tailIn: 0, clear: 0.42, endRise: 0.03, rs: 0.05, tumble: 0.01,
    top: [[-6.08, 1.2], [-1.0, 1.2], [3.0, 1.22], [4.5, 1.25], [5.2, 1.2], [5.5, 1.1]],
    doors: [[3.4, 4.9]], seatRows: 1, interior: '#3a3a3c',
    head: [{ x: 0.95, y: 0.82, w: 0.2, h: 0.1, p: 6 }], tail: [{ x: 1.1, y: 1.0, w: 0.07, h: 0.2, p: 8 }],
    grille: { x: 0, y: 0.7, w: 0.5, h: 0.12, p: 8, style: 0 }, bumper: 'black', bumperF: [0.4, 0.7], bumperR: [0.42, 0.7],
    extras: ['wipers', 'handles', 'mudflaps', 'busglass'], metallic: 0, tint: 0.35,
    cargo: { z0: -6.08, z1: 3.0, y0: 0.6, y1: 3.05, hw: 1.26 },
  }, { zA: 5.3, zC: 3.0, zR1: 5.15, zR2: 3.1, roof: 3.05, roofW: 1.15, zB: 3.35, bw: 0.02, winEnd: 3.5, wsAngle: 82, rearAngle: 170, pB: 14, pR: 14, glassTop: 0.92 }),
  tank: sh({
    type: 'tank', L: 7.0, W: 2.5, zOff: 0, wb: 4.2, R: 0.42, tw: 0.62, rim: 'steel', rimColor: '#4b5236', plan: 14, noseIn: 0.75, tailIn: 0.25, rs: 0.05, rb: 0.03, tumble: 0, bulge: 0, clear: 0.48, endRise: 0.15,
    top: [[-3.5, 1.55], [-3.0, 1.72], [2.4, 1.72], [3.5, 1.3]],
    doors: [], seatRows: 1, interior: '#2a2c24',
    head: [{ x: 1.0, y: 1.32, w: 0.07, h: 0.06, p: 2 }], tail: [{ x: 1.05, y: 1.45, w: 0.05, h: 0.04, p: 6 }],
    grille: { x: 0, y: 1.0, w: 0.01, h: 0.01, p: 4, style: 1 }, bumper: 'paint', bumperF: [0, 0], bumperR: [0, 0],
    extras: ['tracks', 'turret'], metallic: 0, tint: 0.2, livery: 7,
  }, null),
} as Record<VehicleKind, CarShape>;
// Round 7 variety (scaled from their nearest relatives, with their own trim)
SHAPES.crossover = scaled(SHAPES.suv, 0.89, 0.92, 0.9, { rim: 'spoke5', rimColor: '#c3c6ca', extras: ['wipers', 'handles', 'rails', 'flares'], metallic: 0.6 });
SHAPES.citycar = scaled(SHAPES.hatch, 0.9, 0.96, 1.02, { rim: 'hubcap', seatRows: 2, metallic: 0.25 });
SHAPES.sportsedan = { ...SHAPES.sedan, rim: 'spoke5', rimColor: '#3a3c40', clear: 0.15, extras: [...SHAPES.sedan.extras, 'lip', 'exhaust2'], metallic: 0.85, tint: 0.45 };
/** Fills shared data a few kinds borrow from others. */
SHAPES.fbi = { ...SHAPES.suv, ...SHAPES.fbi, top: SHAPES.suv.top, L: SHAPES.suv.L, W: SHAPES.suv.W, zOff: SHAPES.suv.zOff, wb: SHAPES.suv.wb, R: SHAPES.suv.R, tw: SHAPES.suv.tw,
  plan: SHAPES.suv.plan, noseIn: SHAPES.suv.noseIn, tailIn: 0, rs: SHAPES.suv.rs, clear: SHAPES.suv.clear, endRise: SHAPES.suv.endRise, tumble: SHAPES.suv.tumble, doors: SHAPES.suv.doors,
  head: SHAPES.suv.head, tail: SHAPES.suv.tail, grille: { ...SHAPES.suv.grille, chrome: false }, intake: SHAPES.suv.intake, bumperF: SHAPES.suv.bumperF, bumperR: SHAPES.suv.bumperR, gh: SHAPES.suv.gh, interior: '#232323' };

/** Axle z positions (front first). */
export function axlesOf(s: CarShape): number[] { return s.axles ?? [s.wb / 2, -s.wb / 2]; }
export function bodyEnds(s: CarShape): [number, number] { return [s.zOff - s.L / 2, s.zOff + s.L / 2]; }

/** Physics layout matching the procedural body: wheels at rest put the ground at y = GROUND in the body frame. */
export function layoutFor(kind: VehicleKind): VehicleLayout {
  const s = SHAPES[kind], spec = VEHICLES[kind];
  const axles = axlesOf(s), n = axles.length * 2;
  const k = spec.stiffness * 1.8;
  const sl = Math.max(spec.suspRest - 20 / (n * k), spec.suspRest - spec.suspTravel);
  const wy = GROUND + s.R - spec.suspRest * 0.8 + sl;
  const tx = s.type === 'tank' ? s.W / 2 + 0.2 : s.W / 2 - s.tw / 2 - 0.035;
  const wheels: WheelDef[] = [];
  axles.forEach((z, i) => { for (const left of [true, false]) wheels.push({ x: left ? tx : -tx, y: wy, z, front: i === 0, left }); });
  const [zr, zf] = bodyEnds(s);
  const topY = s.type === 'tank' ? 2.3 : Math.max(s.gh ? s.gh.roof : 0, ...s.top.map(p => p[1]), s.cargo ? s.cargo.y1 : 0);
  const bottom = GROUND + s.clear + 0.05, top = GROUND + topY * 0.94;
  const hy = (top - bottom) / 2;
  return { half: [(s.type === 'tank' ? s.W / 2 + 0.45 : s.W / 2) * 0.97, hy, (zf - zr) / 2 * 0.97], centerY: bottom + hy, wheels, radius: s.R, zCenter: (zf + zr) / 2 };
}
export interface SeatDef { x: number; y: number; z: number; door: number }
/** Hip points (body frame) of every seat: 0 driver (front left), 1 front passenger, 2 rear left, 3 rear right. */
export function seatsFor(kind: VehicleKind): SeatDef[] {
  const s = SHAPES[kind];
  const gh = s.gh;
  const zB = gh ? gh.zB : 0;
  const hipY = GROUND + s.clear + (s.type === 'car' ? 0.3 : 0.42) + (kind === 'super' || kind === 'race' ? -0.06 : 0);
  // Round 8: 2-door cars have long doors (B-pillar far back): seat the driver from the windshield like a sedan, not from the pillar
  // (they sat ~0.5 m back, at the rear bench, with the wheel floating far from the dash)
  const fz = s.type === 'car' ? (s.doors.length > 1 ? zB + 0.18 : Math.max(zB + 0.28, gh ? Math.min(gh.zA - 0.95, gh.zR1 - 0.12) : zB + 0.28)) : (gh ? gh.zC + 0.45 : 0);
  const sx = s.W / 2 * (s.seatRows === 1 && s.type !== 'car' ? 0.5 : 0.42);
  const out: SeatDef[] = [{ x: sx, y: hipY, z: fz, door: s.doors.length ? 0 : -1 }, { x: -sx, y: hipY, z: fz, door: s.doors.length ? 1 : -1 }];
  if (s.seatRows > 1) {
    // rear bench: behind the front seats but inside the cabin (2+2 coupes sit lower and further forward)
    const rz = Math.max(fz - 0.88, (gh ? gh.zC : fz - 1) + 0.62), two = s.doors.length > 1;
    const ry = hipY + (two ? 0.03 : -0.04);
    out.push({ x: sx * 0.95, y: ry, z: rz, door: two ? 2 : 0 }, { x: -sx * 0.95, y: ry, z: rz, door: two ? 3 : 1 });
  }
  return out;
}
