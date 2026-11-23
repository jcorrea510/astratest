/** Round 7 garages (pure pricing / palette, used by Activities and tests). Round 9: selling cars. */
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { CAR_PRICES, carValue } from './modes';
export const RESPRAY = 150;
/** Paint colours a garage offers (hex, name). Original names. */
export const GARAGE_PAINTS: [string, string][] = [
  ['#1f2a44', 'Midnight Navy'], ['#e8e2d0', 'Bone White'], ['#3d3d42', 'Graphite'], ['#8a1c1c', 'Brick Red'],
  ['#2fa39a', 'Harbor Teal'], ['#f26b3a', 'Sunset Orange'], ['#ffcc4d', 'Taxi Yellow'], ['#7b2cbf', 'Neon Violet'],
  ['#15171a', 'Gloss Black'], ['#9aa3ab', 'Silver Fog'], ['#2f5d34', 'Racing Green'], ['#c9a227', 'Old Gold'],
];
export const GARAGE_NAMES = ['Glow Garage', 'Fuel Stop service bay'];
/** Repair price from the health fraction (1 = perfect): $0 when nothing to fix, else $60 + up to $440 by the damage. */
export function repairPrice(healthFrac: number, lightsBroken = false): number {
  const dmg = Math.max(0, Math.min(1, 1 - healthFrac));
  if (dmg < 0.01 && !lightsBroken) return 0;
  return Math.round(60 + dmg * 440 + (lightsBroken ? 40 : 0));
}

// ---------------------------------------------------------------- Round 9: selling cars at the garage

/** A garage never buys these: emergency / military / public-transport kinds (and taxis, which carry a fare meter and a licence). */
export const SELL_REFUSED: ReadonlySet<VehicleKind> = new Set<VehicleKind>(['police', 'fbi', 'swat', 'army', 'tank', 'bus', 'taxi']);
/** In-game seconds between two sales at the same garage (3 in-game minutes). */
export const SELL_COOLDOWN = 180;
/** Fence rates on the car's resale value (carValue): a hot street car is a fraction of a legit one, cars you bought pay far more. */
export const FENCE_STOLEN = 0.03, FENCE_OWNED = 0.575;
/** Each further sale of the same kind within one in-game day pays this much less (compounding). */
export const REPEAT_FACTOR = 0.8;
/** Seconds after the heat drops before a hot car is clean enough to sell (the cops were looking for it). */
export const HOT_WINDOW = 120;

export interface SellCtx {
  kind: VehicleKind; healthFrac: number; owned: boolean;
  heat: number;
  /** seconds since the police last had you wanted (Infinity: never) */
  sinceHeat: number;
  /** seconds left on this garage's sale cooldown */
  cooldownLeft: number;
  /** sales of this kind in the last in-game day (all garages) */
  recentSameKind: number;
}
export interface SellQuote { ok: boolean; price: number; reason: string }
/** Pure quote: price = car value x condition x fence rate x repeat-sale discount, with the refusals. */
export function sellQuote(c: SellCtx): SellQuote {
  const no = (reason: string): SellQuote => ({ ok: false, price: 0, reason });
  if (SELL_REFUSED.has(c.kind) || !(c.kind in CAR_PRICES) || !VEHICLES[c.kind]) return no('We do not buy this kind of vehicle.');
  const price = sellPrice(c.kind, c.healthFrac, c.owned, c.recentSameKind);
  if (c.heat > 0) return { ok: false, price, reason: 'Not while the police are after you.' };
  if (!c.owned && c.sinceHeat < HOT_WINDOW) return { ok: false, price, reason: 'Too hot. Somebody saw you take it: come back later.' };
  if (c.cooldownLeft > 0) return { ok: false, price, reason: `The buyer is busy. Next sale in ${fmtWait(c.cooldownLeft)}.` };
  if (price < 1) return { ok: false, price: 0, reason: 'Too wrecked to be worth anything.' };
  return { ok: true, price, reason: c.owned ? 'Your own car: a fair offer.' : 'No papers, no questions. A fence price.' };
}
/** Offer without the refusal checks (used for the label): value x condition (a wreck pays a quarter at most) x rate x repeat discount. */
export function sellPrice(kind: VehicleKind, healthFrac: number, owned: boolean, recentSameKind = 0): number {
  const cond = Math.max(0, Math.min(1, healthFrac)), condF = 0.25 + 0.75 * cond;
  const v = carValue(kind) * (owned ? FENCE_OWNED : FENCE_STOLEN) * condF * Math.pow(REPEAT_FACTOR, Math.max(0, recentSameKind));
  return Math.round(v / 5) * 5;
}
export function fmtWait(s: number): string { const m = Math.floor(s / 60), r = Math.ceil(s % 60); return m > 0 ? `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}` : `${Math.ceil(s)} s`; }

/** Per-garage sale bookkeeping (in-game seconds; persisted in the save as remaining time / age). */
export interface SaleLog { cool: number[]; sold: { kind: VehicleKind; age: number }[] }
export function newSaleLog(garages = 2): SaleLog { return { cool: Array.from({ length: garages }, () => 0), sold: [] }; }
/** Advances the clock (cooldowns count down, sales older than one in-game day drop out). */
export function tickSales(log: SaleLog, dt: number, day = 1440): void {
  log.cool = log.cool.map(c => Math.max(0, c - dt));
  for (const s of log.sold) s.age += dt;
  log.sold = log.sold.filter(s => s.age < day);
}
export function recordSale(log: SaleLog, garage: number, kind: VehicleKind): void { log.cool[garage] = SELL_COOLDOWN; log.sold.push({ kind, age: 0 }); }
export function recentOfKind(log: SaleLog, kind: VehicleKind): number { return log.sold.filter(s => s.kind === kind).length; }
