import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ArmyAir, HeliArms, armyAirWanted, inArmyBase, leadPoint, ROCKET_SPEED, MISSILE_MAGAZINE } from './armyAir';
import { ARMY_BASE } from '../world/citymap';
import { HELIPADS } from './places';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function fakeHeli(x: number, y: number, z: number, yaw = 0) {
  const pos = V(x, y, z);
  return {
    armed: true, destroyed: false, rotor: 1, position: pos, yaw, agl: 50, aiOwned: false, engineOn: false, persistent: false, parked: true, burnTime: 0, playerUsed: false,
    input: { lift: 0, pitch: 0, yaw: 0 }, gunAim: { yaw: 0, pitch: 0 }, phys: { body: {} },
    gunMuzzle(out = new THREE.Vector3()) { return out.copy(pos).add(V(0, -0.7, 2.7)); },
    mountWorld(l: THREE.Vector3, out = new THREE.Vector3()) { return out.copy(pos).add(l); },
  };
}
const fakeCombat = () => { const c = { shots: 0, rockets: 0, lastDir: V(0, 0, 0), shoot(..._a: unknown[]) { c.shots++; return []; }, launch(_o: unknown, _w: unknown, _f: unknown, d: THREE.Vector3) { c.rockets++; c.lastDir.copy(d); } }; return c; };
const fakePhysics = { ray: () => null };

describe('army base layout', () => {
  it('is further from the city than before and reachable by a road end next to the gate', () => {
    expect(ARMY_BASE.z1).toBeLessThan(-400); // old base spanned z -400..-150
    expect(inArmyBase((ARMY_BASE.x0 + ARMY_BASE.x1) / 2, (ARMY_BASE.z0 + ARMY_BASE.z1) / 2)).toBe(true);
    expect(inArmyBase(0, 0)).toBe(false);
  });
  it('has helipads inside the fence (filled by the city build)', () => { for (const p of HELIPADS.filter(h => /Fort Calder/.test(h.name))) expect(inArmyBase(p.x, p.z)).toBe(true); });
});

describe('when army gunships fly', () => {
  it('five stars, trespassing past the warning, or flying a stolen gunship at 3 stars', () => {
    expect(armyAirWanted(5, 0, false)).toBe(true);
    expect(armyAirWanted(4, 0, false)).toBe(false);
    expect(armyAirWanted(0, 3, false)).toBe(false);
    expect(armyAirWanted(0, 6, false)).toBe(true);
    expect(armyAirWanted(3, 0, true)).toBe(true);
    expect(armyAirWanted(2, 0, true)).toBe(false);
  });
});

describe('lead aiming', () => {
  it('a missile aimed at the lead point meets a moving target', () => {
    const from = V(0, 30, 0), tgt = V(100, 0, 0), vel = V(0, 0, 20);
    const aim = leadPoint(from, tgt, vel, ROCKET_SPEED);
    const t = from.distanceTo(aim) / ROCKET_SPEED;
    expect(aim.z).toBeGreaterThan(20); // led ahead of the target
    expect(Math.abs(tgt.z + vel.z * t - aim.z)).toBeLessThan(0.5);
  });
});

describe('player gunship weapons', () => {
  const setup = () => {
    const c = fakeCombat(), h = fakeHeli(0, 30, 0), arms = new HeliArms(c as never, fakePhysics as never);
    return { c, h, arms };
  };
  it('chin gun fires at its rate while the trigger is held and the rotor is up', () => {
    const { c, h, arms } = setup();
    for (let i = 0; i < 60; i++) arms.update(1 / 60, h as never, { fire: true, missile: false }, V(0, 33, -10), V(0, 0, 1), {} as never);
    expect(c.shots).toBeGreaterThanOrEqual(12); expect(c.shots).toBeLessThanOrEqual(16);
    h.rotor = 0.3; const before = c.shots;
    for (let i = 0; i < 30; i++) arms.update(1 / 60, h as never, { fire: true, missile: false }, V(0, 33, -10), V(0, 0, 1), {} as never);
    expect(c.shots).toBe(before);
  });
  it('missiles launch toward the aim point, use up the magazine and are rate limited', () => {
    const { c, h, arms } = setup();
    for (let i = 0; i < 30; i++) arms.update(1 / 60, h as never, { fire: false, missile: true }, V(0, 33, -10), V(0, 0, 1), {} as never);
    expect(c.rockets).toBe(1); expect(arms.missiles).toBe(MISSILE_MAGAZINE - 1);
    expect(c.lastDir.z).toBeGreaterThan(0.9);
    for (let i = 0; i < 60 * 12; i++) arms.update(1 / 60, h as never, { fire: false, missile: true }, V(0, 33, -10), V(0, 0, 1), {} as never);
    expect(c.rockets).toBeGreaterThan(5);
  });
  it('an unarmed helicopter never fires', () => {
    const { c, h, arms } = setup(); h.armed = false;
    for (let i = 0; i < 60; i++) arms.update(1 / 60, h as never, { fire: true, missile: true }, V(0, 33, -10), V(0, 0, 1), {} as never);
    expect(c.shots + c.rockets).toBe(0);
  });
});

describe('hostile army gunships', () => {
  const run = (wanted: boolean, seconds: number) => {
    const c = fakeCombat(); const heli = fakeHeli(0, 30, 0, 0); let removed = 0;
    const air = new ArmyAir({ combat: c as never, physics: fakePhysics as never, takeBaseHeli: () => heli as never, spawn: () => heli as never, remove: () => { removed++; } });
    const tg = { pos: V(0, 0, 90), vel: V(0, 0, 8), vehicle: null, onFoot: true };
    for (let i = 0; i < seconds * 10; i++) air.update(0.1, wanted, tg);
    return { c, air, heli, removed };
  };
  it('does nothing while not wanted', () => { const r = run(false, 30); expect(r.air.units.length).toBe(0); expect(r.c.shots + r.c.rockets).toBe(0); });
  it('launches, spools up, then attacks with bursts and lead-aimed missiles on a cooldown', () => {
    const r = run(true, 40);
    expect(r.air.stats.launched).toBe(1); expect(r.heli.aiOwned).toBe(true); expect(r.heli.engineOn).toBe(true);
    expect(r.c.shots).toBeGreaterThan(10); expect(r.c.rockets).toBeGreaterThanOrEqual(2);
    expect(r.c.rockets).toBeLessThanOrEqual(6); // ~one every 7-10 s over ~30 s of attack: never a stream
  });
  it('flies home and is removed once the heat is off', () => {
    const c = fakeCombat(); const heli = fakeHeli(0, 30, 0, 0); let removed = 0;
    const air = new ArmyAir({ combat: c as never, physics: fakePhysics as never, takeBaseHeli: () => heli as never, spawn: () => heli as never, remove: () => { removed++; } });
    const tg = { pos: V(0, 0, 90), vel: V(0, 0, 0), vehicle: null, onFoot: true };
    for (let i = 0; i < 150; i++) air.update(0.1, true, tg);
    for (let i = 0; i < 600; i++) air.update(0.1, false, tg);
    expect(removed).toBe(1); expect(air.units.length).toBe(0);
  });
  it('a destroyed gunship stops shooting', () => {
    const c = fakeCombat(); const heli = fakeHeli(0, 30, 0, 0);
    const air = new ArmyAir({ combat: c as never, physics: fakePhysics as never, takeBaseHeli: () => heli as never, spawn: () => heli as never, remove: () => { } });
    const tg = { pos: V(0, 0, 90), vel: V(0, 0, 0), vehicle: null, onFoot: true };
    for (let i = 0; i < 200; i++) air.update(0.1, true, tg);
    heli.destroyed = true; const s = c.shots + c.rockets;
    for (let i = 0; i < 100; i++) air.update(0.1, true, tg);
    expect(c.shots + c.rockets).toBe(s);
  });
});
