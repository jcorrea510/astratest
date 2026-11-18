import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rayCapsule, rayBody, zoneDamage, bodyCapsules, type Capsule } from './hitzones';
import { WEAPONS } from './weapons';
import { aimSearchStart, shotDirection, coneSample, angleBetween } from './aim';

const npc = { isPlayer: false, vest: false }, cop = { isPlayer: false, vest: true }, player = { isPlayer: true, vest: false };
const shotsToKill = (dmg: number, hp = 100) => Math.ceil(hp / dmg);
describe('damage zones', () => {
  it('head is an instant kill for every gun', () => {
    for (const w of Object.values(WEAPONS)) if (!w.melee && w.cat !== 'throw') expect(zoneDamage(w, 'head', 10, npc).instantKill).toBe(true);
  });
  it('pistols drop a person in two torso hits; rifles and shotguns in one or two; limbs take more', () => {
    for (const id of ['compact', 'pistol', 'heavyPistol'] as const) expect(shotsToKill(zoneDamage(WEAPONS[id], 'torso', 8, npc, 0.97).damage)).toBe(2);
    expect(shotsToKill(zoneDamage(WEAPONS.revolver, 'torso', 8, npc, 0.97).damage)).toBe(1);
    for (const id of ['rifle', 'carbine', 'battleRifle'] as const) expect(shotsToKill(zoneDamage(WEAPONS[id], 'torso', 10, npc, 0.97).damage)).toBeLessThanOrEqual(2);
    const sg = zoneDamage(WEAPONS.shotgun, 'torso', 4, npc, 0.97).damage * WEAPONS.shotgun.pellets; expect(sg).toBeGreaterThan(100);
    expect(shotsToKill(zoneDamage(WEAPONS.sniper, 'torso', 100, npc, 0.97).damage)).toBe(1);
    expect(zoneDamage(WEAPONS.pistol, 'leg', 8, npc).damage).toBeLessThan(zoneDamage(WEAPONS.pistol, 'torso', 8, npc).damage);
    expect(zoneDamage(WEAPONS.pistol, 'arm', 8, npc).damage).toBeLessThan(zoneDamage(WEAPONS.pistol, 'leg', 8, npc).damage);
  });
  it('police vests soak torso rounds unless armour-piercing; the player takes scaled damage and no instant kills', () => {
    expect(shotsToKill(zoneDamage(WEAPONS.pistol, 'torso', 8, cop, 1).damage)).toBe(3);
    expect(zoneDamage(WEAPONS.rifle, 'torso', 8, cop).damage).toBe(zoneDamage(WEAPONS.rifle, 'torso', 8, npc).damage);
    const p = zoneDamage(WEAPONS.pistol, 'head', 8, player); expect(p.instantKill).toBe(false); expect(p.damage).toBeLessThan(20);
    expect(zoneDamage(WEAPONS.rifle, 'torso', 8, player).damage).toBeLessThan(15);
  });
});
describe('ray vs capsule', () => {
  const c: Capsule = { ax: 0, ay: 1, az: 0, bx: 0, by: 2, bz: 0, r: 0.2, zone: 'torso' };
  it('hits the side, the caps, and misses beside', () => {
    expect(rayCapsule(-5, 1.5, 0, 1, 0, 0, c)).toBeCloseTo(4.8, 5);
    expect(rayCapsule(0, 5, 0, 0, -1, 0, c)).toBeCloseTo(2.8, 5);
    expect(rayCapsule(-5, 1.5, 0.25, 1, 0, 0, c)).toBe(-1);
    expect(rayCapsule(-5, 2.1, 0, 1, 0, 0, c)).toBeGreaterThan(4.8);
  });
  it('picks the nearest zone and respects the max distance', () => {
    const head: Capsule = { ax: 0, ay: 1.6, az: 0, bx: 0, by: 1.75, bz: 0, r: 0.1, zone: 'head' };
    const torso: Capsule = { ax: 0, ay: 1, az: 0.3, bx: 0, by: 1.4, bz: 0.3, r: 0.15, zone: 'torso' };
    expect(rayBody(-5, 1.65, 0, 1, 0, 0, [torso, head], 100)?.zone).toBe('head');
    expect(rayBody(-5, 1.65, 0, 1, 0, 0, [torso, head], 3)).toBeNull();
  });
  it('fallback skeleton has a head above the torso', () => {
    const caps = bodyCapsules(new THREE.Group(), new THREE.Vector3(0, 0, 0), 0);
    const head = caps.find(c => c.zone === 'head')!, torso = caps.find(c => c.zone === 'torso')!;
    expect(Math.min(head.ay, head.by)).toBeGreaterThan(Math.max(torso.ay, torso.by));
    expect(rayBody(-5, 1.65, 0, 1, 0, 0, caps, 100)?.zone).toBe('head');
    expect(rayBody(0, 1.2, 5, 0, 0, -1, caps, 100)?.zone).toBe('torso');
    expect(rayBody(-5, 1.2, 0, 1, 0, 0, caps, 100)?.zone).toBe('arm'); // from the side the arm covers the ribs
    expect(rayBody(0.11, 0.3, 5, 0, 0, -1, caps, 100)?.zone).toBe('leg');
  });
});
describe('aim math', () => {
  it('shots leave the muzzle towards the reticle point, even with shoulder-camera parallax', () => {
    const cam = new THREE.Vector3(0.7, 1.7, -2), dir = new THREE.Vector3(0, 0, 1);
    const aim = cam.clone().addScaledVector(dir, 20);
    const muzzle = new THREE.Vector3(0.25, 1.4, 0.5);
    const d = shotDirection(muzzle, aim, dir, new THREE.Vector3()) as THREE.Vector3;
    const land = muzzle.clone().addScaledVector(d, aim.distanceTo(muzzle));
    expect(land.distanceTo(aim)).toBeLessThan(1e-6);
  });
  it('falls back to the camera direction when the aim point is behind or at the muzzle', () => {
    const d = shotDirection({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0.9 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 });
    expect(d).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('aim search starts just past the shooter, never behind the camera', () => {
    expect(aimSearchStart({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.5, y: 0, z: 3 })).toBeCloseTo(2.4);
    expect(aimSearchStart({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -3 })).toBe(0);
  });
  it('spread cone stays centred and bounded', () => {
    const dir = new THREE.Vector3(0.3, -0.2, 0.9).normalize(); const o = new THREE.Vector3(); const sum = new THREE.Vector3();
    for (let i = 0; i < 400; i++) { const s = coneSample(dir, 0.05, Math.random(), Math.random(), o); expect(angleBetween(s, dir)).toBeLessThanOrEqual(0.0501); sum.add(o); }
    expect(angleBetween(sum.normalize(), dir)).toBeLessThan(0.01);
  });
});
