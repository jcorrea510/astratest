/**
 * Round-6 additions: object sounds (store bell, cash drawer, car doors, crashes, surface footsteps). Same rules as sfx.ts:
 * scheduled self-stopping sources only. Metadata lives in sfx.ts (EXTRA_META) so the table stays in one place.
 */
import { type SfxArgs, burst, tone, click, tinkles, mx, R, saturator } from './sfx';

type Recipe = (a: SfxArgs) => number;
export type StepSurface = 'concrete' | 'grass' | 'gravel' | 'metal' | 'wood' | 'sand';
export const STEP_SURFACES: readonly StepSurface[] = ['concrete', 'grass', 'gravel', 'metal', 'wood', 'sand'];

/** A shoe on a surface: low heel thump + a surface-specific top (scrape, blades, ring, knock). */
function step(a: SfxArgs, s: StepSurface): number {
  const { kit: k, out, t, p } = a;
  const heel = tone(k, out, t, { f: (s === 'wood' ? 140 : 95) * p, f2: 55, peak: s === 'sand' || s === 'grass' ? 0.1 : 0.2, a: 0.002, dec: 0.045 });
  switch (s) {
    case 'concrete': return mx(heel, burst(k, out, t, { type: 'lowpass', f: R(k, 700, 1000) * p, peak: 0.4, a: 0.002, dec: 0.06, color: 'pink' }), burst(k, out, t + 0.003, { type: 'bandpass', f: R(k, 2400, 3400), q: 1.6, peak: 0.1, a: 0.0008, dec: 0.02 }));
    case 'grass': return mx(heel, burst(k, out, t, { type: 'bandpass', f: R(k, 1500, 2300) * p, q: 0.6, peak: 0.22, a: 0.012, dec: 0.12, color: 'pink' }), burst(k, out, t, { type: 'lowpass', f: 420, peak: 0.2, a: 0.004, dec: 0.07, color: 'brown' }));
    case 'gravel': { let e = mx(heel, burst(k, out, t, { type: 'lowpass', f: 900, peak: 0.2, a: 0.002, dec: 0.05, color: 'pink' })); for (let i = 0; i < 7; i++) e = mx(e, click(k, out, t + i * R(k, 0.006, 0.016), R(k, 2200, 5200), R(k, 0.05, 0.16), 0.012)); return e; }
    case 'metal': return mx(heel, burst(k, out, t, { type: 'lowpass', f: 900 * p, peak: 0.3, a: 0.001, dec: 0.05, color: 'pink' }), tone(k, out, t, { f: R(k, 780, 1150), peak: 0.07, a: 0.0006, dec: 0.22 }), tone(k, out, t, { f: R(k, 1700, 2400), peak: 0.04, a: 0.0006, dec: 0.15 }));
    case 'wood': return mx(heel, tone(k, out, t, { f: R(k, 210, 300) * p, f2: 150, peak: 0.28, a: 0.001, dec: 0.09 }), burst(k, out, t, { type: 'bandpass', f: R(k, 1200, 1700), q: 1.2, peak: 0.16, a: 0.0008, dec: 0.04 }));
    case 'sand': return mx(heel, burst(k, out, t, { type: 'highpass', f: 1800, peak: 0.12, a: 0.015, dec: 0.15, color: 'white' }), burst(k, out, t, { type: 'lowpass', f: 380, peak: 0.16, a: 0.005, dec: 0.08, color: 'brown' }));
  }
}

/** Car body hit: sine thump + metal-band crunch + bent-panel ring; `hard` adds glass shards and a longer rattle. */
function crunch(a: SfxArgs, power: number): number {
  const { kit: k, out, t, p } = a;
  const sat = saturator(k, out, 2.5 + 2 * power, k.hard, 0.45);
  let e = tone(k, out, t, { f: (70 + 25 * (1 - power)) * p, f2: 30, glideDur: 0.18, peak: 0.55 + 0.55 * power, a: 0.0015, dec: 0.2 + 0.25 * power });
  e = mx(e, burst(k, sat, t, { type: 'bandpass', f: (650 + 400 * (1 - power)) * p, q: 0.6, peak: 0.55 + 0.35 * power, a: 0.0012, dec: 0.12 + 0.3 * power }));
  e = mx(e, burst(k, out, t + 0.004, { type: 'bandpass', f: 2800 * p, q: 0.8, peak: 0.18 + 0.12 * power, a: 0.001, dec: 0.1 + 0.1 * power }));
  const rings = 2 + Math.round(power * 4);
  for (let i = 0; i < rings; i++) e = mx(e, tone(k, out, t + R(k, 0.005, 0.1 + 0.18 * power), { f: R(k, 300, 1500), peak: 0.05 + 0.05 * power, a: 0.0008, dec: R(k, 0.08, 0.3) }));
  if (power > 0.45) e = mx(e, tinkles(k, out, t + 0.03, 6 + Math.round(8 * power), 0.3 + 0.4 * power, 0.1 + 0.08 * power, 2000, 6500));
  e = mx(e, burst(k, out, t + 0.15, { type: 'bandpass', f: 1200, q: 1.5, peak: 0.07 * power, a: 0.01, dec: 0.3 + 0.4 * power }));
  return e;
}

export const EXTRA2_RECIPES = {
  // shop door chime: two bright bell strikes with inharmonic partials (the spring-mounted brass bell over a door)
  storeBell: ({ kit: k, out, t, p }: SfxArgs) => {
    let e = t;
    for (const [i, f] of [[0, 2093], [0.16, 1568]] as const) for (const [m, a] of [[1, 0.2], [2.76, 0.09], [5.4, 0.04]] as const) e = mx(e, tone(k, out, t + i, { f: f * m * p, peak: a, a: 0.0008, dec: m === 1 ? 0.9 : 0.35 }));
    return mx(e, click(k, out, t, 3600, 0.12, 0.01));
  },
  // cash drawer: button click, spring ratchet, drawer thunk and a coin rattle
  registerDrawer: ({ kit: k, out, t, p }: SfxArgs) => {
    let e = click(k, out, t, 3200 * p, 0.35, 0.02);
    e = mx(e, burst(k, out, t + 0.02, { type: 'bandpass', f: 1800, f2: 3400, glideDur: 0.16, q: 2, peak: 0.12, a: 0.01, dec: 0.18 }));
    e = mx(e, tone(k, out, t + 0.2, { f: 120 * p, f2: 62, peak: 0.55, a: 0.002, dec: 0.13 }), burst(k, out, t + 0.2, { type: 'lowpass', f: 800, peak: 0.45, a: 0.001, dec: 0.1, color: 'pink' }));
    e = mx(e, click(k, out, t + 0.24, 2400, 0.2, 0.03), tinkles(k, out, t + 0.24, 7, 0.22, 0.09, 3200, 7000));
    return e;
  },
  carDoorOpen: ({ kit: k, out, t, p }: SfxArgs) => mx(click(k, out, t, 2200 * p, 0.4, 0.02), tone(k, out, t + 0.045, { f: 130 * p, f2: 85, peak: 0.28, a: 0.002, dec: 0.1 }), burst(k, out, t + 0.05, { type: 'lowpass', f: 700, peak: 0.2, a: 0.002, dec: 0.07, color: 'pink' })),
  // heavy door: latch clack, then the dull slam of a steel panel and the rubber seal
  carDoorClose: ({ kit: k, out, t, p }: SfxArgs) => mx(tone(k, out, t, { f: 100 * p, f2: 48, peak: 0.85, a: 0.002, dec: 0.17 }), burst(k, out, t, { type: 'lowpass', f: 650 * p, peak: 0.7, a: 0.001, dec: 0.11, color: 'pink' }), click(k, out, t + 0.012, 1900 * p, 0.42, 0.03), burst(k, out, t + 0.03, { type: 'bandpass', f: 4200, q: 1, peak: 0.07, a: 0.002, dec: 0.1 })),
  crashLight: (a: SfxArgs) => crunch(a, 0.25),
  crashHeavy: (a: SfxArgs) => crunch(a, 1),
  stepConcrete: (a: SfxArgs) => step(a, 'concrete'), stepGrass: (a: SfxArgs) => step(a, 'grass'), stepGravel: (a: SfxArgs) => step(a, 'gravel'),
  stepMetal: (a: SfxArgs) => step(a, 'metal'), stepWood: (a: SfxArgs) => step(a, 'wood'), stepSand: (a: SfxArgs) => step(a, 'sand'),
} satisfies Record<string, Recipe>;
export type Extra2Sfx = keyof typeof EXTRA2_RECIPES;
