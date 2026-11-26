import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../core/physics';
import { Vehicle, barStrobe } from './vehicle';
import { VehicleManager } from '../game/vehicles';
import { DEFAULT_BINDINGS } from '../core/settings';
import { findConflicts } from '../ui/bindings';

let phys: Physics;
beforeAll(async () => { await initPhysics(); phys = new Physics(); });

describe('windows crack before they shatter', () => {
  it('hits crack the windshield twice, the third shatters it; a hard crash shatters at once', () => {
    const v = new Vehicle(phys, 'sedan', null, 0, 1, 0, 0);
    const ws = v.panes.find(p => p.name === 'windshield')!;
    expect(ws.crack).toBe(0);
    const at = new THREE.Vector3(0, 1.2, 0.8);
    expect(v.hitGlass(ws.id, at)).toBe(true);
    expect(ws.crack).toBe(1); expect(v.isGlassBroken(ws.id)).toBe(false);
    expect(v.glassMat!.userData.crack.value[ws.id].w).toBe(1);
    v.hitGlass(ws.id, at);
    expect(ws.crack).toBe(2); expect(v.isGlassBroken(ws.id)).toBe(false);
    v.hitGlass(ws.id, at);
    expect(v.isGlassBroken(ws.id)).toBe(true);
    const w2 = new Vehicle(phys, 'sedan', null, 10, 1, 0, 0);
    const pane = w2.panes[0];
    w2.hitGlass(pane.id, at, 3);
    expect(w2.isGlassBroken(pane.id)).toBe(true);
  }, 30_000);
});

describe('police siren and light bar', () => {
  it('J/K/L pick tones, press again to silence, U toggles the bar, sirenOn is exposed', () => {
    const v = new Vehicle(phys, 'police', null, 20, 1, 0, 0);
    const mgr = Object.create(VehicleManager.prototype) as VehicleManager;
    const press = (a: string) => mgr.sirenKeys(v, x => x === a);
    expect(v.sirenOn).toBe(false);
    press('sirenWail'); expect(v.sirenTone).toBe(1); expect(v.sirenOn).toBe(true); expect(v.barOn).toBe(true);
    press('sirenYelp'); expect(v.sirenTone).toBe(2);
    press('sirenPhaser'); expect(v.sirenTone).toBe(3);
    press('sirenPhaser'); expect(v.sirenTone).toBe(0); expect(v.sirenOn).toBe(false); expect(v.barOn).toBe(true);
    press('lightBar'); expect(v.barOn).toBe(false);
    const civ = new Vehicle(phys, 'sedan', null, 30, 1, 0, 0);
    mgr.sirenKeys(civ, () => true); expect(civ.sirenOn).toBe(false);
  }, 30_000); // builds two full vehicle models: ~2 s alone, past the 5 s default on a loaded CI box
  it('strobe alternates red then blue in bursts of three', () => {
    let reds = 0, blues = 0, both = 0;
    for (let t = 0; t < 2; t += 1 / 90) { const [r, b] = barStrobe(t); reds += r; blues += b; if (r && b) both++; }
    expect(both).toBe(0); expect(reds).toBeGreaterThan(10); expect(blues).toBeGreaterThan(10);
  });
  it('siren keys do not clash with other driving keys', () => {
    const c = findConflicts(DEFAULT_BINDINGS);
    expect([...c.keys()]).toEqual([]);
    expect(DEFAULT_BINDINGS.sirenWail).toEqual(['KeyJ']); expect(DEFAULT_BINDINGS.lightBar.length).toBe(1);
  });
});
