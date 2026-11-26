import { describe, it, expect } from 'vitest';
import { barberTabs, clothingTabs, lookCost, lookChanged, appearanceDiff, parseAppearance, dressed, optionPrice } from './grooming';
import { PLAYER_DEFAULT_LOOK } from '../actors/look';
import { parseSave, serialize, type SaveData } from './save';
import { Inventory } from '../combat/weapons';

const base = PLAYER_DEFAULT_LOOK;
describe('grooming catalogue', () => {
  it('offers many cuts, colours and beards, and a full wardrobe', () => {
    const b = barberTabs('m'), c = clothingTabs('m');
    expect(b.find(t => t.id === 'hairStyle')!.options.length).toBeGreaterThanOrEqual(12);
    expect(b.find(t => t.id === 'hair')!.options.length).toBeGreaterThanOrEqual(12);
    expect(b.find(t => t.id === 'facial')!.options.length).toBe(5);
    for (const f of ['topStyle', 'top', 'bottomStyle', 'bottom', 'shoeStyle', 'shoes', 'hatStyle', 'hat']) expect(c.some(t => t.id === f), f).toBe(true);
    expect(clothingTabs('m').find(t => t.id === 'bottomStyle')!.options.some(o => o.id === 'skirt')).toBe(false);
  });
  it('uses US spelling in player-facing labels', () => {
    const all = [...barberTabs('m'), ...clothingTabs('f')];
    for (const t of all) { expect(t.label).not.toMatch(/colour/i); for (const o of t.options) expect(o.label).not.toMatch(/grey|colour/i); }
  });
  it('prices only what changes, and a barber never sells clothes', () => {
    expect(lookCost('barber', base, base)).toBe(0);
    const cut = dressed(base, { hairStyle: 'afro', hair: '#7b3a1e', facial: 'beard' });
    expect(lookCost('barber', base, cut)).toBe(30 + 35 + 18);
    expect(lookCost('clothing', base, cut)).toBe(0);
    const outfit = dressed(base, { topStyle: 'suit', top: '#1f3a5f', hatStyle: 'cap' });
    expect(lookCost('clothing', base, outfit)).toBe(220 + 12 + 30);
    expect(lookCost('barber', base, outfit)).toBe(0);
    expect(lookChanged('barber', base, cut)).toBe(true); expect(lookChanged('barber', base, outfit)).toBe(false);
    expect(optionPrice(barberTabs('m')[0], base.hairStyle, base)).toBe(0);
  });
});
describe('saved appearance', () => {
  it('keeps only changed fields and rejects junk', () => {
    const l = dressed(base, { hairStyle: 'braids', top: '#112233' });
    expect(appearanceDiff(base, l)).toEqual({ hairStyle: 'braids', top: '#112233' });
    expect(appearanceDiff(base, base)).toEqual({});
    expect(parseAppearance({ hairStyle: 'nope', top: 'red', hair: '#abcdef', topStyle: 'hoodie', facial: 7 })).toEqual({ hair: '#abcdef', topStyle: 'hoodie' });
    expect(parseAppearance(null)).toBeUndefined(); expect(parseAppearance({ junk: 1 })).toBeUndefined();
  });
  it('round-trips through the versioned save', () => {
    const d: SaveData = { version: 2, savedAt: 1, mode: 'regular', cars: [], milestones: [], robberies: 0, money: 5, health: 100, armor: 0, weapons: new Inventory().weapons, current: 'fists', medkits: 0, missions: [], collectibles: [], jumps: [], pos: { x: 1, z: 2, yaw: 0 }, hour: 12, stats: { kills: 0, distance: 0, crashes: 0 }, appearance: { hairStyle: 'afro', shoes: '#9c2f35' } };
    expect(parseSave(serialize(d))!.appearance).toEqual({ hairStyle: 'afro', shoes: '#9c2f35' });
    expect(parseSave(serialize({ ...d, appearance: undefined }))!.appearance).toBeUndefined();
    expect(parseSave(serialize({ ...d, appearance: { hairStyle: 'bogus' } as never }))!.appearance).toBeUndefined();
  });
});
