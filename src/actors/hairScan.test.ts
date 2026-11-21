import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SCAN_HAIR, SCAN_FACIAL, TIE_Y, bob, gather, keepVertex } from './hairScan';
import { SHELL_HAIR } from './hairShells';
import { barberTabs } from '../game/grooming';
import type { FacialHair, HairStyle } from './look';

describe('hair styles', () => {
  it('every cut and beard sold at the barber has a renderer (scanned mesh, shell, or bald / clean shaven)', () => {
    for (const sex of ['m', 'f'] as const) {
      const [cuts, , facial] = barberTabs(sex);
      for (const o of cuts.options) expect(o.id === 'bald' || !!SCAN_HAIR[o.id as HairStyle] || SHELL_HAIR.has(o.id as HairStyle), o.id).toBe(true);
      for (const o of facial.options) expect(['none', 'stubble'].includes(o.id) || !!SCAN_FACIAL[o.id as FacialHair], o.id).toBe(true);
      expect(cuts.options.map(o => o.id)).not.toContain('braids'); // drawn as cornrows; not sold as its own cut
    }
  });
  it('scanned styles are not also grown as shells, except the ponytail (shell top + scanned tail)', () => {
    for (const s of Object.keys(SCAN_HAIR) as HairStyle[]) expect(SHELL_HAIR.has(s), s).toBe(s === 'ponytail');
  });
  it('bob shortens the long hair to the jaw without moving the hair above it', () => {
    const top = new THREE.Vector3(0.5, 0.3, -0.8); bob(top); expect(top.y).toBeCloseTo(0.3);
    const tip = new THREE.Vector3(0, -3, -1.1); bob(tip); expect(tip.y).toBeGreaterThan(-1.1); expect(tip.y).toBeLessThan(-0.7);
  });
  it('ponytail keeps only the back of the long hair and gathers it narrow behind the head, hanging from the tie', () => {
    expect(keepVertex('ponytail', new THREE.Vector3(0.9, -0.5, 0.3))).toBe(false); // face-framing strand
    expect(keepVertex('ponytail', new THREE.Vector3(0, 0.6, -0.9))).toBe(false); // crown (the shell draws it)
    const p = new THREE.Vector3(0.8, -1.5, -0.6); expect(keepVertex('ponytail', p)).toBe(true);
    gather(p);
    expect(Math.abs(p.x)).toBeLessThan(0.3); expect(p.z).toBeLessThan(-1.15); expect(p.y).toBeLessThan(TIE_Y);
  });
  it('moustache and goatee are parts of the beard mesh', () => {
    expect(keepVertex('moustache', new THREE.Vector3(0.1, -0.5, 0.8))).toBe(true);
    expect(keepVertex('moustache', new THREE.Vector3(0.1, -0.9, 0.6))).toBe(false); // chin
    expect(keepVertex('goatee', new THREE.Vector3(0.1, -0.9, 0.6))).toBe(true);
    expect(keepVertex('goatee', new THREE.Vector3(0.8, -0.5, 0.3))).toBe(false); // cheek
  });
});
