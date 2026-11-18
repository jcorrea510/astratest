import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Inventory, WEAPONS } from '../combat/weapons';
import { parseSave, serialize, type SaveData } from './save';
import { HeatState } from './police';
import { generateCity, surfaceAt } from '../world/citymap';
import { PLACES, POSTCARDS } from './places';
import { MISSIONS, RACE_ROUTE } from './missions';

describe('inventory', () => {
  it('fires, empties the clip and auto-reloads from reserve', () => {
    const inv = new Inventory();
    inv.give('pistol', 30);
    expect(inv.select('pistol')).toBe(true);
    inv.cooldown = 0;
    let shots = 0;
    for (let i = 0; i < 100; i++) { if (inv.fire()) shots++; inv.tick(WEAPONS.pistol.interval + 0.01); }
    expect(shots).toBe(30);
    expect(inv.state.clip + inv.state.reserve).toBe(0);
  });
  it('reload moves ammo from reserve to clip', () => {
    const inv = new Inventory(); inv.give('smg', 50); inv.select('smg'); inv.cooldown = 0;
    for (let i = 0; i < 5; i++) { inv.fire(); inv.cooldown = 0; }
    expect(inv.startReload()).toBe(true);
    inv.tick(WEAPONS.smg.reload + 0.1);
    expect(inv.state.clip).toBe(30);
    expect(inv.state.clip + inv.state.reserve).toBe(45);
  });
  it('cannot select weapons it does not own; cycles through owned ones', () => {
    const inv = new Inventory();
    expect(inv.select('rifle')).toBe(false);
    inv.give('shotgun', 12); inv.cycle(1); expect(inv.current).toBe('shotgun'); inv.cycle(1); expect(inv.current).toBe('fists');
  });
});
describe('save data', () => {
  const base: SaveData = { version: 1, savedAt: 1, money: 1234, health: 80, armor: 10, weapons: new Inventory().weapons, current: 'fists', medkits: 2, missions: ['m1'], collectibles: [1, 3], jumps: [0], pos: { x: -300, z: -106, yaw: 1 }, hour: 18, stats: { kills: 1, distance: 2, crashes: 3 } };
  it('round-trips', () => { expect(parseSave(serialize(base))).toEqual(base); });
  it('keeps sandbox tool toggles', () => { const t = { ...base, tools: { god: true, ammo: false, never: true, clock: false } }; expect(parseSave(serialize(t))).toEqual(t); });
  it('rejects corrupt or foreign data', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave(JSON.stringify({ ...base, version: 2 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...base, pos: { x: NaN, z: 0 } }))).toBeNull();
  });
  it('clamps values', () => { const p = parseSave(JSON.stringify({ ...base, money: -5, health: 999 }))!; expect(p.money).toBe(0); expect(p.health).toBe(100); });
});
describe('heat', () => {
  it('escalates by crime and is lost after breaking line of sight', () => {
    const h = new HeatState();
    h.add('shooting'); expect(h.heat).toBe(1);
    h.add('kill'); expect(h.heat).toBe(2);
    h.add('copKill'); expect(h.heat).toBe(4);
    const p = new THREE.Vector3(0, 0, 0);
    h.tick(0.1, true, p);
    let lost = false; const far = new THREE.Vector3(1000, 0, 0);
    for (let t = 0; t < 60 && !lost; t += 0.1) lost = h.tick(0.1, false, far);
    expect(lost).toBe(true); expect(h.heat).toBe(0);
  });
  it('is not lost while officers can see you', () => {
    const h = new HeatState(); h.add('kill');
    const p = new THREE.Vector3();
    for (let t = 0; t < 120; t += 0.1) expect(h.tick(0.1, true, p)).toBe(false);
    expect(h.heat).toBe(2);
  });
  it('caps at five', () => { const h = new HeatState(); for (let i = 0; i < 10; i++) h.add('copKill'); expect(h.heat).toBe(5); });
});
describe('places', () => {
  const city = generateCity();
  it('puts shops, contacts and respawns on walkable ground, not inside lots', () => {
    for (const [k, p] of Object.entries(PLACES)) {
      if (k === 'snack' || k === 'vesna') continue; // pier / promenade
      const s = surfaceAt(city, p.x, p.z);
      expect(['sidewalk', 'road'], `${k} on ${s}`).toContain(s);
    }
  });
  it('has 12 postcards and five missions in order', () => {
    expect(POSTCARDS.length).toBe(12);
    expect(MISSIONS.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    for (const m of MISSIONS.slice(1)) expect(MISSIONS.findIndex(x => x.id === m.requires)).toBeGreaterThanOrEqual(0);
  });
  it('race checkpoints are on roads', () => { for (const c of RACE_ROUTE.slice(0, -1)) expect(surfaceAt(city, c.x, c.z), `${c.x},${c.z}`).toBe('road'); });
});
