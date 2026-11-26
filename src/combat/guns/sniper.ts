/**
 * Model: sniper = "Longreach .338" (see combat/weapons.ts for stats). Bespoke build: olive aluminium chassis, adjustable
 * cheek riser + butt pad, heavy fluted barrel with a baffled muzzle brake, tubular action with top rail, bolt (group
 * 'bolt': body + swept handle + knob), detachable box magazine (group 'mag'), 5-25x scope with turrets / parallax knob /
 * sunshade / rings, folded bipod. Gun space metres, +z muzzle, y up, bore axis at y = 0.06, firing grip near the origin.
 */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.06;
  const circle = (rr: number, z: number, y: number, mat: 'lens' | 'bore' = 'lens') => {
    const a = new THREE.CircleGeometry(rr, 16); a.translate(0, y, z); k.push(a, mat);
    const b = new THREE.CircleGeometry(rr, 16); b.rotateY(Math.PI); b.translate(0, y, z); k.push(b, mat);
  };

  // ---- action: tubular receiver, ejection port, top rail
  k.lathe([[0.0, -0.115], [0.0215, -0.115], [0.0235, -0.108], [0.0235, 0.185], [0.0205, 0.195], [0.0165, 0.2], [0.0, 0.2]], by, 'steel', 18);
  k.box(0.0238, by + 0.004, 0.03, 0.001, 0.016, 0.07, 'bore');
  k.box(0.0, by - 0.0225, -0.02, 0.012, 0.004, 0.03, 'bore'); // bolt-release slot
  k.rail(-0.09, 0.24, 0.0805, 0.024);
  k.box(0.0, by - 0.002, 0.2, 0.034, 0.034, 0.012, 'steel'); // recoil lug / barrel nut collar

  // ---- chassis: mid section with magwell, grip, trigger guard, rear stock with LOP spine + cheek riser + butt pad
  k.prof([[-0.12, 0.045], [0.2, 0.045], [0.2, -0.035], [0.08, -0.05], [-0.1, -0.045]], 0.038, 'olive', 0.005);
  k.box(0, -0.052, 0.065, 0.044, 0.016, 0.1, 'olive');
  k.prof([[0.02, 0.012], [0.03, 0.005], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.012]], 0.032, 'olive', 0.005);
  for (let i = 0; i < 4; i++) { const t = i / 3; k.box(0.0165, -0.01 - t * 0.07, -0.016 - t * 0.014, 0.002, 0.008, 0.026, 'polymer'); k.box(-0.0165, -0.01 - t * 0.07, -0.016 - t * 0.014, 0.002, 0.008, 0.026, 'polymer'); }
  k.prof([[0.025, 0.012], [0.085, 0.012], [0.09, -0.014], [0.03, -0.02], [0.03, -0.012], [0.08, -0.008], [0.078, 0.006], [0.025, 0.006]], 0.008, 'olive', 0.0015);
  k.prof([[0.045, 0.014], [0.053, 0.012], [0.05, -0.006], [0.046, -0.008]], 0.005, 'steel', 0.001);
  k.prof([[-0.12, 0.045], [-0.4, 0.04], [-0.4, -0.075], [-0.34, -0.082], [-0.2, -0.052], [-0.12, -0.05]], 0.032, 'olive', 0.006);
  for (const s of [-1, 1]) { k.box(s * 0.0165, -0.01, -0.28, 0.002, 0.05, 0.16, 'bore'); k.cylY(0.005, 0.02, s * 0.008, 0.052, -0.3, 'steel', 8); }
  k.box(0, 0.063, -0.3, 0.03, 0.026, 0.15, 'polymer'); // cheek riser
  k.box(0, -0.016, -0.43, 0.038, 0.13, 0.03, 'polymer'); // butt pad
  k.box(0, -0.016, -0.446, 0.036, 0.12, 0.004, 'polymer');
  k.box(0, -0.082, -0.405, 0.03, 0.016, 0.04, 'steel'); // butt hook
  for (let i = 0; i < 3; i++) k.box(0, 0.02 - i * 0.03, -0.4, 0.04, 0.003, 0.012, 'steel'); // LOP spacer rings

  // ---- forend with M-LOK slots, folded bipod
  k.prof([[0.18, 0.045], [0.44, 0.04], [0.44, -0.03], [0.18, -0.05]], 0.044, 'olive', 0.006);
  for (const s of [-1, 1]) for (let z = 0.23; z < 0.42; z += 0.04) k.box(s * 0.0223, -0.003, z, 0.001, 0.014, 0.026, 'bore');
  k.box(0, -0.038, 0.41, 0.032, 0.018, 0.03, 'steel');
  for (const s of [-1, 1]) { k.cyl(0.0055, 0.42, 0.5, -0.056, 'steel', 6, s * 0.017); k.cyl(0.0042, 0.5, 0.58, -0.056, 'steel', 6, s * 0.017); k.cyl(0.0075, 0.58, 0.592, -0.056, 'polymer', 6, s * 0.017); }

  // ---- heavy fluted barrel + muzzle brake
  k.lathe([[0.0, 0.18], [0.0165, 0.18], [0.0165, 0.22], [0.0145, 0.232], [0.0145, 0.35], [0.0125, 0.92], [0.0, 0.92]], by, 'steel', 14);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; k.box(Math.cos(a) * 0.0139, by + Math.sin(a) * 0.0139, 0.53, 0.0032, 0.0032, 0.3, 'bore'); }
  k.lathe([[0.0, 0.915], [0.0165, 0.915], [0.0195, 0.922], [0.0195, 0.94], [0.015, 0.942], [0.015, 0.948], [0.0195, 0.95], [0.0195, 0.965], [0.015, 0.967], [0.015, 0.973], [0.0195, 0.975], [0.0195, 0.992], [0.0175, 1.0], [0.0, 1.0]], by, 'steel', 14);
  for (const s of [-1, 1]) for (const z of [0.945, 0.97]) k.box(s * 0.0197, by, z, 0.001, 0.012, 0.016, 'bore');
  for (const z of [0.945, 0.97]) k.box(0, by + 0.0195, z, 0.012, 0.001, 0.016, 'bore');
  k.bore(0.0065, 1.0, by);

  // ---- scope: variable power, turrets, parallax knob, sunshade, rings on the rail
  const Y0 = 0.125;
  k.lathe([[0.0, -0.07], [0.02, -0.07], [0.0255, -0.058], [0.0245, -0.04], [0.0215, -0.03], [0.0215, -0.018], [0.0248, -0.014], [0.0248, 0.035], [0.0215, 0.04], [0.0215, 0.11], [0.0262, 0.114], [0.0262, 0.172], [0.0215, 0.176], [0.0215, 0.245], [0.0295, 0.262], [0.0345, 0.29], [0.0348, 0.33], [0.0, 0.33]], Y0, 'steel', 20);
  k.lathe([[0.0372, 0.33], [0.0395, 0.33], [0.0395, 0.405], [0.0372, 0.405]], Y0, 'polymer', 20);
  circle(0.0322, 0.322, Y0); circle(0.0175, -0.0706, Y0);
  for (const z of [0.02, 0.2]) { k.cyl(0.0268, z - 0.01, z + 0.01, Y0, 'steel', 16); k.box(0, Y0 - 0.0215, z, 0.03, 0.026, 0.026, 'steel'); k.cylX(0.004, 0.036, 0, Y0 - 0.026, z, 'steel', 6); }
  k.cylY(0.0095, 0.03, 0, Y0 + 0.0295, 0.143, 'steel', 14); k.cylY(0.0105, 0.008, 0, Y0 + 0.0455, 0.143, 'polymer', 14); // elevation turret
  k.cylX(0.0095, 0.03, 0.0402, Y0, 0.143, 'steel', 14); k.cylX(0.0105, 0.008, 0.0558, Y0, 0.143, 'polymer', 14); // windage turret
  k.cylX(0.011, 0.02, -0.0365, Y0, 0.246, 'polymer', 14); k.cylX(0.0075, 0.012, -0.0495, Y0, 0.246, 'steel', 10); // parallax knob
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; k.box(-0.0365, Y0 + Math.cos(a) * 0.0112, 0.246 + Math.sin(a) * 0.0112, 0.019, 0.002, 0.002, 'steel'); }

  // ---- bolt (moving group): body, shroud, swept handle and knob
  k.in('bolt', () => {
    k.lathe([[0.0, -0.17], [0.011, -0.17], [0.0135, -0.16], [0.0135, -0.12], [0.0115, -0.115], [0.0115, 0.0], [0.0, 0.0]], by, 'steel', 12);
    k.cylX(0.0048, 0.044, 0.034, by + 0.002, -0.048, 'steel', 8);
    const arm = new THREE.CylinderGeometry(0.0042, 0.0042, 0.05, 8); arm.rotateZ(Math.PI / 2 + 0.55); arm.translate(0.062, by - 0.012, -0.048); k.push(arm, 'steel');
    const knob = new THREE.SphereGeometry(0.0125, 12, 10); knob.scale(1.15, 1, 1); knob.translate(0.085, by - 0.026, -0.048); k.push(knob, 'steel');
  });

  // ---- detachable box magazine
  k.in('mag', () => {
    k.prof([[0.014, 0.034], [0.106, 0.034], [0.11, -0.096], [0.02, -0.096]], 0.028, 'steel', 0.003);
    k.box(0, -0.1, 0.065, 0.032, 0.008, 0.098, 'steel');
  });

  return { muzzle: new THREE.Vector3(0, by, 1.003), eject: new THREE.Vector3(0.03, by + 0.004, 0.03), butt: new THREE.Vector3(0, -0.016, -0.447), support: new THREE.Vector3(0, -0.02, 0.3), grip: new THREE.Vector3(0, -0.048, -0.008) };
}
