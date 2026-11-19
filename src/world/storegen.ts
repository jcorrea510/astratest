/** Picks street-facing lots for the generated walk-in stores (kinds, names, tills) so every district has shops to rob. */
import type { Rng } from '../core/rng';
import type { Lot, Block } from './citymap';
import { STORES, STORE_W, STORE_D, POLICE_STATION, GAS_STATION, type Store, type StoreKind } from '../game/places';

const ROSTER: { kind: StoreKind; color: string; cash: [number, number]; names: string[] }[] = [
  { kind: 'convenience', color: '#d1495b', cash: [250, 450], names: ['Night Owl Mart', 'Quick Harbor 24/7', 'Corner Moon Market', 'Dime Store 24', 'Brightside Mini Mart', 'Lantern Stop', 'Blue Heron Mart', 'Anchor Row Mini Mart', 'Ferry Slip Convenience', 'Midnight Hydrant 24'] },
  { kind: 'liquor', color: '#29335c', cash: [450, 700], names: ['Anchor Spirits', 'Velvet Cork Liquor', 'Salt & Barrel', 'Rooster Wine & Spirits', 'Brass Bell Spirits', 'Wharf Street Wines'] },
  { kind: 'gas', color: '#0f7b4f', cash: [300, 500], names: ['Dust Road Fuel', 'Coastline Petrol', 'Rust Belt Gas & Go', 'Mile Marker Fuel'] },
  { kind: 'diner', color: '#8c1c22', cash: [350, 550], names: ['Blue Plate Diner', 'Sunny Side Griddle', 'Twin Anchors Cafe', 'Late Light Diner', 'Biscuit Barn', 'Ticker Tape Diner', 'Pier Light Cafe'] },
  { kind: 'pawn', color: '#141414', cash: [800, 1300], names: ['Second Chance Pawn', 'Gold Standard Pawn', 'Brass Key Jewelers', 'Mercantile Loan & Pawn'] },
  { kind: 'pharmacy', color: '#1d8f6a', cash: [400, 600], names: ['Greenleaf Pharmacy', 'Tidewell Drug', 'Remedy Corner', 'Harbor Health Pharmacy', 'Willow Apothecary', 'Battery Drug', 'Counting House Pharmacy'] },
  { kind: 'clothing', color: '#8a4f9e', cash: [350, 600], names: ['Threadbare', 'Loom & Lace', 'Salt Stripe Outfitters', 'Velour Boutique', 'Off-Cut Denim', 'Pinstripe Outfitters', 'Fifth Fold Tailors'] },
  { kind: 'electronics', color: '#1f6fb5', cash: [700, 1000], names: ['Volt Hut', 'Circuit Alley', 'Pixel Depot', 'Static & Signal', 'Ticker Electronics'] },
  { kind: 'barber', color: '#b5322e', cash: [200, 350], names: ['Sharp Edge Barbers', 'Clip Joint', 'Old Town Barber', 'Fade Factory', 'Wall Clock Barbers'] },
  { kind: 'bank', color: '#1d3a5c', cash: [1800, 3000], names: ['Meridian Savings Branch', 'Anchor Trust Bank', 'Harbor Credit Union', 'Cobalt Savings', 'Anchor Row Savings', 'Exchange Place Trust'] },
];
export const GENERATED_STORE_TARGET = ROSTER.reduce((n, r) => n + r.names.length, 0);

export function genStores(lots: Lot[], blocks: Block[], rng: Rng): Store[] {
  const base = STORES.filter(s => !s.generated);
  const eligible = lots.filter(l => {
    if (l.kind !== 'brownstone' && l.kind !== 'pastel' && l.kind !== 'midrise') return false;
    if (l.street === false || l.w < 8.5 || l.d < 9.5) return false;
    const dist = l.blockId >= 0 ? blocks[l.blockId].district : l.district;
    if (dist === 'hillside') return false;
    if (Math.hypot(l.x - POLICE_STATION.x, l.z - POLICE_STATION.z) < 40 || Math.hypot(l.x - GAS_STATION.x, l.z - GAS_STATION.z) < 34) return false;
    return true;
  });
  // shuffle (Fisher-Yates with the seeded rng)
  for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  // queue interleaves the kinds so a district sees a mix
  const queue: { kind: StoreKind; color: string; cash: [number, number]; name: string }[] = [];
  const left = ROSTER.map(r => ({ ...r, names: [...r.names] }));
  while (left.some(r => r.names.length)) for (const r of left) { const n = r.names.shift(); if (n) queue.push({ kind: r.kind, color: r.color, cash: r.cash, name: n }); }
  const out: Store[] = [];
  const taken = [...base.map(b => ({ x: b.x, z: b.z }))];
  // every third shop goes to the new west districts, the rest to the grid (falling back to the other pool when one is full)
  const pools = { west: eligible.filter(l => l.blockId < 0), grid: eligible.filter(l => l.blockId >= 0) };
  let n = 0;
  while (queue.length) {
    const first = n++ % 3 === 0 ? 'west' : 'grid', second = first === 'west' ? 'grid' : 'west';
    let lot: Lot | undefined;
    for (const key of [first, second] as const) {
      const pool = pools[key];
      while (pool.length) { const c = pool.shift()!; if (!taken.some(t => Math.hypot(t.x - c.x, t.z - c.z) < 42)) { lot = c; break; } }
      if (lot) break;
    }
    if (!lot) break;
    const q = queue.shift()!;
    // shrink to the shop footprint, keeping the front flush with the street
    const fx = Math.sin(lot.rot), fz = Math.cos(lot.rot), dd = (lot.d - STORE_D) / 2;
    lot.x += fx * dd; lot.z += fz * dd; lot.w = STORE_W + 0.1; lot.d = STORE_D;
    lot.kind = 'brownstone';
    taken.push({ x: lot.x, z: lot.z });
    out.push({ x: lot.x, z: lot.z, yaw: lot.rot, name: q.name, color: q.color, cash: Math.round(rng.range(q.cash[0], q.cash[1]) / 10) * 10, kind: q.kind, generated: true });
  }
  return out;
}
