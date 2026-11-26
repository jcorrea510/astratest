/** Model: revolver (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    const by = 0.072;
    k.prof([[-0.055, 0.03], [0.07, 0.04], [0.07, by + 0.026], [-0.03, by + 0.03], [-0.062, by + 0.012]], 0.028, 'chrome', 0.003);
    k.cyl(0.011, 0.06, 0.24, by, 'chrome', 14).bore(0.0055, 0.24, by);
    k.prof([[0.06, by + 0.008], [0.235, by + 0.008], [0.235, by + 0.025], [0.06, by + 0.025]], 0.018, 'chrome', 0.003); // vent rib / lug
    k.prof([[0.08, by - 0.006], [0.23, by - 0.008], [0.23, by - 0.026], [0.09, by - 0.02]], 0.016, 'chrome', 0.003); // ejector shroud
    k.box(0, by + 0.036, 0.228, 0.006, 0.014, 0.012, 'chrome'); k.box(0, by + 0.034, -0.03, 0.016, 0.01, 0.012, 'steel');
    k.prof([[-0.06, by + 0.012], [-0.08, by + 0.035], [-0.068, by + 0.04], [-0.05, by + 0.02]], 0.008, 'steel', 0.002); // hammer
    k.in('slide', () => { // cylinder (named slide so the reload swings it)
      k.cyl(0.024, -0.005, 0.055, by - 0.006, 'chrome', 6);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; k.box(Math.cos(a) * 0.022, by - 0.006 + Math.sin(a) * 0.022, 0.025, 0.004, 0.004, 0.04, 'steel'); }
      k.cyl(0.004, 0.055, 0.075, by - 0.006, 'steel', 8);
    });
    k.prof([[0.0, 0.035], [0.05, 0.033], [0.052, 0.005], [0.04, -0.008], [0.012, -0.008], [0.012, -0.002], [0.04, 0.0], [0.045, 0.026], [0.0, 0.028]], 0.008, 'chrome', 0.0015);
    k.prof([[0.02, 0.03], [0.026, 0.027], [0.024, 0.005], [0.018, 0.004]], 0.005, 'steel', 0.001);
    k.prof([[-0.055, 0.035], [-0.0, 0.03], [-0.03, -0.075], [-0.07, -0.08], [-0.078, -0.05], [-0.062, 0.0]], 0.034, 'wood', 0.008);
    return { muzzle: new THREE.Vector3(0, by, 0.243), eject: new THREE.Vector3(0.02, by, 0.03) };
  }
