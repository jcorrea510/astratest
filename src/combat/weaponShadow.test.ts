import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh, setWeaponShadow } from './weaponModels';
import { gunCastsShadow } from '../game/population';

/** 27 Nov (busy-corner draw-call budget): guns carried by people off screen kept casting sun shadows. */
describe('carried gun shadows', () => {
  it('turn off and back on, lenses and bores never cast', () => {
    const g = weaponMesh('sniper');
    const meshes: THREE.Mesh[] = []; g.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const never = meshes.filter(m => /:(lens|bore)$/.test(m.name));
    setWeaponShadow(g, false);
    expect(meshes.every(m => !m.castShadow)).toBe(true);
    setWeaponShadow(g, true);
    expect(meshes.filter(m => !/:(lens|bore)$/.test(m.name)).every(m => m.castShadow)).toBe(true);
    expect(never.every(m => !m.castShadow)).toBe(true);
  });
  it('follow the holder: no shadow off screen, past the budget or in a car', () => {
    expect(gunCastsShadow(true, true, false)).toBe(true);
    expect(gunCastsShadow(true, false, false)).toBe(false);
    expect(gunCastsShadow(false, true, false)).toBe(false);
    expect(gunCastsShadow(true, true, true)).toBe(false);
  });
});
