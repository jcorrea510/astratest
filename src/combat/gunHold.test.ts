import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveHold, makeHoldOut, handQuat, onFootUpperMode, supportGripWeight } from './gunHold';
import type { WeaponAnchors } from './weaponModels';
import { WorldGlass, HITS_TO_BREAK } from '../world/glass';
import { aisleWaypoint, AISLE, queueSpot } from '../game/storeLife';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rifle: WeaponAnchors = { grip: V(0, -0.048, -0.008), butt: V(0, 0.03, -0.35), support: V(0, 0.03, 0.3) };
const pistol: WeaponAnchors = { grip: V(0, -0.046, -0.028), butt: null, support: null };
// shoulders of a body facing +x (right shoulder at +z... right = forward x up: facing +x, right is -z? use explicit points)
const shR = V(0, 1.45, 0.2), shL = V(0, 1.45, -0.2);

describe('gun hold', () => {
  it('rifle: butt sits at the right shoulder, barrel along aim, left palm under the handguard', () => {
    const dir = V(1, 0.1, 0).normalize(); const o = makeHoldOut();
    solveHold({ shR, shL, armLen: 0.6, dir, anchors: rifle, supportHand: true, raise: 1 }, o);
    const butt = rifle.butt!.clone().applyQuaternion(o.quat).add(o.pos);
    expect(butt.distanceTo(shR)).toBeLessThan(0.16);
    const fwd = V(0, 0, 1).applyQuaternion(o.quat);
    expect(fwd.dot(dir)).toBeGreaterThan(0.999);
    expect(o.hasLeft).toBe(true);
    const sup = rifle.support!.clone().applyQuaternion(o.quat).add(o.pos);
    expect(o.lPalm.distanceTo(sup)).toBeLessThan(1e-6);
    // left hand is in front of the right one along the barrel
    expect(o.lPalm.clone().sub(o.rPalm).dot(dir)).toBeGreaterThan(0.2);
  });
  it('pistol: held out at arm length; left hand only when raised; hand frames are proper rotations', () => {
    const dir = V(1, 0, 0); const o = makeHoldOut();
    solveHold({ shR, shL, armLen: 0.6, dir, anchors: pistol, supportHand: false, raise: 1 }, o);
    expect(o.hasLeft).toBe(false);
    const d = o.rPalm.distanceTo(shR); expect(d).toBeGreaterThan(0.3); expect(d).toBeLessThan(0.62);
    solveHold({ shR, shL, armLen: 0.6, dir, anchors: pistol, supportHand: true, raise: 1 }, o);
    expect(o.hasLeft).toBe(true); expect(o.lPalm.distanceTo(o.rPalm)).toBeLessThan(0.08);
    const q = handQuat('R', V(0, -0.5, 0.87), V(1, 0, 0), new THREE.Quaternion(), new THREE.Quaternion());
    expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6);
  });
});

describe('world glass', () => {
  it('cracks on early hits, shatters on the last, and broken panes stay findable for the bullet pass-through', () => {
    const w = new WorldGlass(); const id = w.add(0, 1.5, 0, 0, 2, 2);
    for (let i = 0; i < HITS_TO_BREAK - 1; i++) expect(w.hitGlass(id)).toBe(false);
    expect(w.isGlassBroken(id)).toBe(false);
    expect(w.hitGlass(id)).toBe(true); expect(w.isGlassBroken(id)).toBe(true);
    expect(w.glassAt(V(0, 1.5, 0))).toBeNull();
    expect(w.glassAt(V(0, 1.5, 0), 0.3, true)).toBe(id);
  });
});

describe('store life', () => {
  it('aisle waypoints stay in the aisle; queue spots line up', () => {
    let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 50; i++) { const p = aisleWaypoint(r); expect(p.x).toBeGreaterThanOrEqual(AISLE.x0); expect(p.z).toBeLessThanOrEqual(AISLE.z1); }
    expect(queueSpot(2).z).toBeGreaterThan(queueSpot(0).z);
  });
});

describe('one-hand guns leave the left arm alone (R6-BW)', () => {
  it('not aiming: a one-hand gun keeps the normal locomotion arm swing, a long gun is carried', () => {
    expect(onFootUpperMode(true, false, false)).toBe('loco');
    expect(onFootUpperMode(true, false, true)).toBe('carry');
    expect(onFootUpperMode(false, false, false)).toBe('loco');
    expect(onFootUpperMode(true, true, false)).toBe('pistol');
    expect(onFootUpperMode(true, true, true)).toBe('rifle');
  });
  it('the left-hand grip IK weight is zero for a lowered one-hand gun (no blend leftovers) and full for long guns', () => {
    for (const raise of [0, 0.1, 0.2, 0.34]) expect(supportGripWeight(false, raise)).toBe(0);
    expect(supportGripWeight(false, 1)).toBeCloseTo(1, 5);
    for (const raise of [0, 0.5, 1]) expect(supportGripWeight(true, raise)).toBe(1);
    expect(supportGripWeight(false, 0.6)).toBeGreaterThan(0);
  });
  it('a lowered pistol asks for no support hand at all', () => {
    const o = makeHoldOut();
    solveHold({ shR, shL, armLen: 0.6, dir: V(1, -0.3, 0).normalize(), anchors: pistol, supportHand: false, raise: 0 }, o);
    expect(o.hasLeft).toBe(false);
  });
});
