/** Model: rpg "Comet RPG" (see combat/weapons.ts). Shoulder-fired launcher; the visible rocket warhead is the 'mag' group. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.1;
  const disc = (r: number, z: number, y: number, x: number, flip: boolean) => { const g = new THREE.CircleGeometry(r, 14); if (flip) g.rotateY(Math.PI); g.translate(x, y, z); k.push(g, 'lens'); };
  // ---- launch tube with muzzle collar
  k.lathe([[0.04, -0.34], [0.046, -0.3], [0.046, 0.3], [0.05, 0.31], [0.052, 0.335], [0.052, 0.37], [0.046, 0.372], [0.04, 0.372]], by, 'olive', 20);
  k.lathe([[0.04, 0.372], [0.034, 0.372], [0.034, 0.34]], by, 'bore', 14);
  // ---- rear venturi: hollow flared nozzle, outer surface rear-to-front then the inner surface back out
  k.lathe([[0.07, -0.49], [0.058, -0.44], [0.046, -0.37], [0.04, -0.34], [0.034, -0.34], [0.05, -0.44], [0.066, -0.485]], by, 'steel', 22);
  k.lathe([[0.03, -0.34], [0.034, -0.4]], by, 'bore', 14);
  for (const z of [-0.43, -0.48]) k.cyl(z < -0.45 ? 0.0705 : 0.0595, z - 0.005, z + 0.005, by, 'steel', 20);
  k.cyl(0.049, -0.31, -0.29, by, 'steel', 18); k.cyl(0.054, 0.28, 0.3, by, 'steel', 18);
  // ---- wooden heat shield wrap, steel clamp bands, seams
  k.lathe([[0.046, -0.06], [0.054, -0.052], [0.056, -0.03], [0.056, 0.24], [0.054, 0.262], [0.046, 0.27]], by, 'wood', 20);
  for (const z of [-0.045, 0.255]) k.cyl(0.058, z - 0.007, z + 0.007, by, 'steel', 20);
  for (let i = 0; i < 5; i++) k.cyl(0.0575, -0.01 + i * 0.05, -0.006 + i * 0.05, by, 'steel', 20);
  // ---- rocket (moving group): neck, bulbous warhead, fuze nose, folded fins, bands
  k.in('mag', () => {
    k.lathe([[0.0, 0.34], [0.022, 0.34], [0.024, 0.4], [0.03, 0.42], [0.05, 0.455], [0.058, 0.495], [0.057, 0.53], [0.048, 0.575], [0.034, 0.612], [0.02, 0.64], [0.014, 0.655], [0.0, 0.662]], by, 'olive', 22);
    k.lathe([[0.0145, 0.65], [0.0155, 0.655], [0.0, 0.667]], by, 'steel', 12);
    k.lathe([[0.0575, 0.49], [0.0585, 0.497], [0.0585, 0.505], [0.0575, 0.512]], by, 'steel', 22);
    k.lathe([[0.0495, 0.565], [0.0505, 0.57], [0.0505, 0.576], [0.0495, 0.581]], by, 'steel', 22);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.box(Math.sin(a) * 0.032, by + Math.cos(a) * 0.032, 0.375, 0.003, 0.026, 0.05, 'steel'); }
    k.cyl(0.026, 0.34, 0.375, by, 'steel', 12);
  });
  // ---- grips: rear pistol grip with guard + trigger, forward grip, mounting plates
  k.prof([[0.02, 0.06], [0.034, 0.055], [-0.005, -0.1], [-0.045, -0.098], [-0.032, -0.06], [-0.022, 0.06]], 0.034, 'polymer', 0.006);
  k.prof([[0.02, 0.05], [0.07, 0.05], [0.072, 0.02], [0.055, 0.005], [0.03, 0.005], [0.02, 0.02]], 0.012, 'steel', 0.002);
  k.box(0, 0.03, 0.04, 0.01, 0.026, 0.008, 'steel', -0.2);
  k.box(0, 0.058, 0.0, 0.05, 0.016, 0.1, 'steel');
  k.prof([[0.19, 0.06], [0.235, 0.06], [0.225, -0.075], [0.19, -0.072]], 0.032, 'polymer', 0.006);
  for (let i = 0; i < 4; i++) k.box(0, -0.0 - i * 0.015, 0.2125, 0.034, 0.003, 0.046, 'steel');
  k.box(0, 0.055, 0.21, 0.05, 0.016, 0.07, 'steel');
  k.box(0.03, 0.04, -0.012, 0.006, 0.014, 0.024, 'steel');
  // ---- left optical sight on a bracket, iron sights on top, sling bracket
  const ox = -0.066, oy = by + 0.044;
  k.box(-0.05, by + 0.01, 0.07, 0.022, 0.012, 0.09, 'steel'); k.box(ox, oy - 0.018, 0.07, 0.014, 0.032, 0.06, 'steel');
  k.lathe([[0.0, 0.0], [0.017, 0.0], [0.019, 0.011], [0.016, 0.035], [0.016, 0.105], [0.022, 0.13], [0.023, 0.145], [0.0, 0.145]], oy, 'steel', 14, ox);
  disc(0.019, 0.1455, oy, ox, false); disc(0.014, -0.0005, oy, ox, true);
  k.cylX(0.007, 0.02, ox - 0.02, oy, 0.07, 'steel', 8); k.cylX(0.007, 0.02, ox, oy + 0.02, 0.1, 'steel', 8);
  k.irons(0.33, -0.2, by + 0.046);
  k.box(0, by + 0.05, -0.27, 0.03, 0.01, 0.05, 'steel'); k.cylX(0.006, 0.04, 0, by - 0.05, 0.16, 'steel', 8);
  return { muzzle: new THREE.Vector3(0, by, 0.4), eject: new THREE.Vector3(), butt: new THREE.Vector3(0, by, -0.3), support: new THREE.Vector3(0, -0.01, 0.207) };
}
