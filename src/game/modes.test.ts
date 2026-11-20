import { describe, expect, it, vi } from 'vitest';
import { CAR_PRICES, DEALER_KINDS, MILESTONES, bustedFine, canUseSandbox, downPenalty, medicalBill, netWorth, newMilestones } from './modes';
import { parseSave, saveSummary, serialize, type SaveData } from './save';
import { Inventory } from '../combat/weapons';
import { Sandbox } from './sandbox';
import { GARAGE_SLOTS, PLACES } from './places';
import { generateCity, surfaceAt } from '../world/citymap';
import { VEHICLES } from '../vehicles/specs';
import type { Game } from './game';
import type { GameUI } from '../ui/contracts';

describe('death penalty', () => {
  it('regular: medical bill is 10% of cash, min $500, never more than you have', () => {
    expect(medicalBill('regular', 20_000)).toBe(2000);
    expect(medicalBill('regular', 1000)).toBe(500);
    expect(medicalBill('regular', 120)).toBe(120);
    expect(medicalBill('regular', 0)).toBe(0);
  });
  it('regular: busted fine is capped at cash', () => { expect(bustedFine('regular', 100_000)).toBe(8000); expect(bustedFine('regular', 90)).toBe(90); });
  it('regular: going down loses all gear and explains it; sandbox loses nothing', () => {
    const r = downPenalty('regular', 'down', 5000);
    expect(r).toMatchObject({ fee: 500, loseGear: true });
    expect(r.notice).toContain('$500');
    expect(downPenalty('regular', 'busted', 5000).loseGear).toBe(true);
    expect(downPenalty('sandbox', 'down', 5000)).toEqual({ fee: 0, loseGear: false, notice: '' });
    expect(downPenalty('sandbox', 'busted', 5000).fee).toBe(0);
  });
  it('inventory strip empties every weapon, ammo and medkit and holsters', () => {
    const inv = new Inventory();
    inv.give('pistol', 60); inv.give('rifle', 90); inv.give('bat', 1); inv.medkits = 3; inv.select('rifle');
    inv.strip();
    expect(inv.current).toBe('fists');
    expect(inv.owned()).toEqual(['fists']);
    expect(inv.medkits).toBe(0);
    expect(inv.total('pistol') + inv.total('rifle')).toBe(0);
  });
  it('holster puts the gun away but keeps it', () => {
    const inv = new Inventory(); inv.give('pistol', 30); inv.select('pistol'); inv.holster();
    expect(inv.current).toBe('fists'); expect(inv.weapons.pistol.owned).toBe(true);
  });
});

describe('mode gating', () => {
  const mk = (mode: 'regular' | 'sandbox') => {
    const game = { mode, money: 100, hour: 12, addMoney: vi.fn(), police: { ignoring: false, clear: vi.fn(), setHeat: vi.fn() }, pcombat: { give: vi.fn(), inv: { medkits: 0 } }, player: { health: 1, maxHealth: 100, armor: 0, alive: true } };
    const ui = { openSandbox: vi.fn() };
    return { game, ui, sb: new Sandbox(game as unknown as Game, ui as unknown as GameUI) };
  };
  it('regular: tools panel does not open, cheats do nothing, toggles stay off', () => {
    const { game, ui, sb } = mk('regular');
    const closed = vi.fn(); sb.openPanel(closed);
    expect(ui.openSandbox).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalled(); expect(sb.open).toBe(false);
    sb.act('cash'); sb.act('arsenal'); sb.act('god', true); sb.act('never', true); sb.act('heal');
    expect(game.addMoney).not.toHaveBeenCalled(); expect(game.pcombat.give).not.toHaveBeenCalled();
    expect(sb.god).toBe(false); expect(sb.neverWanted).toBe(false); expect(game.player.health).toBe(1);
    sb.loadTools({ god: true, ammo: true, never: true, clock: true }); expect(sb.god).toBe(false);
  });
  it('sandbox: everything works as before', () => {
    const { game, ui, sb } = mk('sandbox');
    sb.openPanel(() => {}); expect(ui.openSandbox).toHaveBeenCalled();
    sb.act('cash'); expect(game.addMoney).toHaveBeenCalledWith(10000);
    sb.act('god', true); expect(sb.god).toBe(true);
    expect(canUseSandbox('sandbox')).toBe(true); expect(canUseSandbox('regular')).toBe(false);
  });
});

describe('save migration', () => {
  const v1 = { version: 1, savedAt: 5, money: 900, health: 70, armor: 0, weapons: new Inventory().weapons, current: 'fists', medkits: 0, missions: [], collectibles: [], jumps: [], pos: { x: -300, z: -106, yaw: 1 }, hour: 18, stats: { kills: 0, distance: 0, crashes: 0 } };
  it('v1 saves load as Sandbox games with no cars', () => {
    const s = parseSave(JSON.stringify(v1))!;
    expect(s.version).toBe(2); expect(s.mode).toBe('sandbox'); expect(s.cars).toEqual([]); expect(s.milestones).toEqual([]); expect(s.robberies).toBe(0); expect(s.money).toBe(900);
  });
  it('v2 keeps mode, cars (valid kinds only, max 8) and milestones', () => {
    const cars = Array.from({ length: 10 }, () => ({ kind: 'coupe', paint: 1 }));
    const raw = { ...v1, version: 2, mode: 'regular', cars: [{ kind: 'nope' }, { kind: 'constructor' }, ...cars], milestones: ['cash10k', 5], robberies: 3 };
    const s = parseSave(JSON.stringify(raw))!;
    expect(s.mode).toBe('regular'); expect(s.cars.length).toBe(8); expect(s.cars.every(c => c.kind === 'coupe')).toBe(true); expect(s.milestones).toEqual(['cash10k']); expect(s.robberies).toBe(3);
    expect(parseSave(serialize(s))).toEqual(s);
  });
  it('unknown mode falls back to sandbox; Continue summary names mode and cash', () => {
    expect(parseSave(JSON.stringify({ ...v1, version: 2, mode: 'weird' }))!.mode).toBe('sandbox');
    const s = { ...parseSave(JSON.stringify({ ...v1, version: 2, mode: 'regular', money: 12345 }))!, savedAt: Date.now() - 5 * 60000 } as SaveData;
    expect(saveSummary(s)).toBe('Regular, $12,345, 5 min ago');
  });
});

describe('dealership and goals', () => {
  it('every car for sale is priced and a real, non-service model; supercar costs most', () => {
    for (const k of DEALER_KINDS) { expect(VEHICLES[k]).toBeTruthy(); expect(CAR_PRICES[k]).toBeGreaterThan(1000); expect(['emergency', 'military']).not.toContain(VEHICLES[k].cls); }
    expect(DEALER_KINDS[DEALER_KINDS.length - 1]).toBe('super');
  });
  it('net worth counts cash plus resale of owned cars', () => {
    expect(netWorth(1000, [])).toBe(1000);
    expect(netWorth(1000, [{ kind: 'coupe', paint: 0 }])).toBe(1000 + Math.round(CAR_PRICES.coupe! * 0.8));
  });
  it('milestones fire once as their conditions are met', () => {
    const base = { cash: 0, worth: 0, cars: [], robberies: 0, isSports: () => false };
    const have = new Set<string>();
    expect(newMilestones(base, have)).toEqual([]);
    const got = newMilestones({ ...base, cash: 12_000, worth: 12_000, robberies: 1 }, have).map(m => m.id);
    expect(got).toEqual(['firstHeist', 'cash10k']);
    for (const id of got) have.add(id);
    expect(newMilestones({ ...base, cash: 12_000, worth: 12_000, robberies: 1 }, have)).toEqual([]);
    const sports = newMilestones({ ...base, cars: [{ kind: 'coupe', paint: 0 }], worth: 30_000, isSports: () => true }, have).map(m => m.id);
    expect(sports).toEqual(expect.arrayContaining(['firstCar', 'sportsCar']));
    expect(new Set(MILESTONES.map(m => m.id)).size).toBe(MILESTONES.length);
  });
  it('the showroom and the garage row are on walkable ground', () => {
    const city = generateCity();
    expect(['sidewalk', 'road']).toContain(surfaceAt(city, PLACES.dealer.x, PLACES.dealer.z));
    for (const s of GARAGE_SLOTS) expect(['sidewalk', 'road'], `${s.x},${s.z}`).toContain(surfaceAt(city, s.x, s.z));
  });
});
