/** Game modes and the money rules. Pure, so it is unit tested. Regular = earn everything; Sandbox = cheats and tools. */
import type { VehicleKind } from '../vehicles/specs';

export type GameMode = 'regular' | 'sandbox';
export const MODE_LABEL: Record<GameMode, string> = { regular: 'Regular', sandbox: 'Sandbox' };
export const START_CASH: Record<GameMode, number> = { regular: 400, sandbox: 2500 };

export function canUseSandbox(mode: GameMode): boolean { return mode === 'sandbox'; }

/** Hospital bill after going down: 10% of cash, at least $500, never more than you have. Sandbox: free. */
export function medicalBill(mode: GameMode, cash: number): number {
  if (mode !== 'regular') return 0;
  const c = Math.max(0, Math.floor(cash));
  return Math.min(c, Math.max(500, Math.floor(c * 0.1)));
}
/** Bail / fine when busted: 8% of cash, at least $300, capped at cash. Sandbox: free. */
export function bustedFine(mode: GameMode, cash: number): number {
  if (mode !== 'regular') return 0;
  const c = Math.max(0, Math.floor(cash));
  return Math.min(c, Math.max(300, Math.floor(c * 0.08)));
}
export interface DownPenalty { fee: number; loseGear: boolean; notice: string }
/** What going down ('down' = dead, 'busted' = arrested) costs. */
export function downPenalty(mode: GameMode, kind: 'down' | 'busted', cash: number): DownPenalty {
  const fee = kind === 'down' ? medicalBill(mode, cash) : bustedFine(mode, cash);
  const loseGear = mode === 'regular';
  const money = `$${fee.toLocaleString('en-US')}`;
  const notice = mode !== 'regular' ? ''
    : kind === 'down' ? `Medical bill ${money}. You lost every weapon and all your ammo: buy new ones at Tidewater Arms.`
      : `Fined ${money}. The police confiscated all your weapons: buy new ones at Tidewater Arms.`;
  return { fee, loseGear, notice };
}

// ---------------------------------------------------------------- dealership
/** Showroom prices (the specs carry none). Emergency, military and bus kinds are not for sale. */
export const CAR_PRICES: Partial<Record<VehicleKind, number>> = {
  hatch: 6500, sedan: 9500, wagon: 12000, minivan: 13500, van: 15000, fullsize: 16500, pickup: 19000, suv: 26000,
  taxi: 8000, coupe: 38000, convertible: 46000, muscle: 54000, luxury: 72000, race: 120000, super: 185000,
  citycar: 4800, crossover: 21000, sportsedan: 31000,
};
export const DEALER_KINDS = (Object.keys(CAR_PRICES) as VehicleKind[]).sort((a, b) => CAR_PRICES[a]! - CAR_PRICES[b]!);
/** What an owned car counts for in net worth (resale). */
export function carValue(kind: VehicleKind): number { return Math.round((CAR_PRICES[kind] ?? 0) * 0.8); }

export interface OwnedCar { kind: VehicleKind; paint: number }
export function netWorth(cash: number, cars: readonly OwnedCar[], property = 0): number {
  return Math.max(0, Math.floor(cash)) + cars.reduce((s, c) => s + carValue(c.kind), 0) + property;
}

// ---------------------------------------------------------------- milestones
export interface MilestoneState { cash: number; worth: number; cars: readonly OwnedCar[]; robberies: number; isSports: (k: VehicleKind) => boolean }
export interface Milestone { id: string; label: string; hint: string; done: (s: MilestoneState) => boolean }
export const MILESTONES: Milestone[] = [
  { id: 'firstHeist', label: 'First score', hint: 'Rob a store.', done: s => s.robberies >= 1 },
  { id: 'cash10k', label: 'First $10,000', hint: 'Have $10,000 in cash.', done: s => s.cash >= 10_000 },
  { id: 'firstCar', label: 'Wheels of your own', hint: 'Buy a car at Redline Motors.', done: s => s.cars.length >= 1 },
  { id: 'sportsCar', label: 'Own a sports car', hint: 'Buy a sports car or better.', done: s => s.cars.some(c => s.isSports(c.kind)) },
  { id: 'worth50k', label: 'Worth $50,000', hint: 'Net worth of $50,000.', done: s => s.worth >= 50_000 },
  { id: 'threeCars', label: 'Collector', hint: 'Own three cars.', done: s => s.cars.length >= 3 },
  { id: 'worth250k', label: 'Quarter million', hint: 'Net worth of $250,000.', done: s => s.worth >= 250_000 },
  { id: 'supercar', label: 'Supercar owner', hint: 'Buy the top-end supercar.', done: s => s.cars.some(c => c.kind === 'super') },
];
/** Milestones newly completed (not in `have`). */
export function newMilestones(s: MilestoneState, have: ReadonlySet<string>): Milestone[] { return MILESTONES.filter(m => !have.has(m.id) && m.done(s)); }
