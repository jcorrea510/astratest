import { describe, it, expect } from 'vitest';
import { parseSave } from './save';
import { repairPrice, GARAGE_PAINTS, sellQuote, sellPrice, newSaleLog, tickSales, recordSale, recentOfKind, SELL_COOLDOWN, type SellCtx } from './garage';

describe('garages (Round 7)', () => {
  it('repairs cost more the worse the car is; a perfect car costs nothing', () => {
    expect(repairPrice(1)).toBe(0);
    expect(repairPrice(0.9)).toBeLessThan(repairPrice(0.3));
    expect(repairPrice(1, true)).toBeGreaterThan(0);
  });
  it('offers a dozen distinct named colours', () => {
    expect(GARAGE_PAINTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(GARAGE_PAINTS.map(p => p[0])).size).toBe(GARAGE_PAINTS.length);
  });
});

const base: SellCtx = { kind: 'super', healthFrac: 1, owned: false, heat: 0, sinceHeat: Infinity, cooldownLeft: 0, recentSameKind: 0 };
describe('selling cars (Round 9)', () => {
  it('a stolen supercar is worth a few thousand, a cheap car almost nothing, and owned cars pay far more', () => {
    const sup = sellQuote(base), hatch = sellQuote({ ...base, kind: 'hatch' });
    expect(sup.ok && sup.price).toBeGreaterThan(3000); expect(sup.price).toBeLessThan(7000);
    expect(hatch.price).toBeLessThan(250);
    expect(sellPrice('super', 1, true)).toBeGreaterThan(sup.price * 10);
    expect(sellPrice('sedan', 1, true) / sellPrice('sedan', 1, false)).toBeGreaterThan(10);
  });
  it('condition scales the price (a wreck pays a quarter)', () => {
    expect(sellPrice('coupe', 0.5, false)).toBeLessThan(sellPrice('coupe', 1, false));
    expect(sellPrice('coupe', 0, false)).toBeGreaterThan(0);
    expect(sellPrice('coupe', 0, false)).toBeLessThanOrEqual(Math.round(sellPrice('coupe', 1, false) * 0.3));
  });
  it('refuses emergency, military, taxi and bus kinds', () => {
    for (const kind of ['police', 'fbi', 'swat', 'army', 'tank', 'taxi', 'bus'] as const) expect(sellQuote({ ...base, kind }).ok).toBe(false);
  });
  it('refuses while wanted, while the car is still hot, and while the buyer is on cooldown', () => {
    expect(sellQuote({ ...base, heat: 1 }).ok).toBe(false);
    expect(sellQuote({ ...base, sinceHeat: 30 }).ok).toBe(false);
    expect(sellQuote({ ...base, sinceHeat: 400 }).ok).toBe(true);
    const c = sellQuote({ ...base, cooldownLeft: 95 }); expect(c.ok).toBe(false); expect(c.reason).toContain('1:35');
    expect(sellQuote({ ...base, owned: true, sinceHeat: 5 }).ok).toBe(true); // your own car is not hot
  });
  it('cooldown lasts 3 in-game minutes per garage and repeat sales of one kind pay less', () => {
    const log = newSaleLog();
    recordSale(log, 0, 'coupe');
    expect(log.cool[0]).toBe(SELL_COOLDOWN); expect(log.cool[1]).toBe(0);
    tickSales(log, 100); expect(log.cool[0]).toBe(80);
    tickSales(log, 100); expect(log.cool[0]).toBe(0);
    expect(recentOfKind(log, 'coupe')).toBe(1);
    expect(sellPrice('coupe', 1, false, 1)).toBeLessThan(sellPrice('coupe', 1, false, 0));
    tickSales(log, 1500); expect(recentOfKind(log, 'coupe')).toBe(0); // a day later the market has recovered
  });
});

describe('garage sale log in the save (Round 9)', () => {
  it('round-trips cooldowns and drops unknown kinds', () => {
    const raw = JSON.stringify({ version: 2, money: 5, pos: { x: 0, z: 0 }, garage: { cool: [100, -5, 'x'], sold: [{ kind: 'super', age: 3 }, { kind: 'bogus', age: 1 }] } });
    const d = parseSave(raw)!;
    expect(d.garage).toEqual({ cool: [100, 0, 0], sold: [{ kind: 'super', age: 3 }] });
    expect(parseSave(JSON.stringify({ version: 2, money: 5, pos: { x: 0, z: 0 } }))!.garage).toBeUndefined();
  });
});
