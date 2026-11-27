/**
 * Architectural & coastal landmarks for Port Meridian.
 * Built directly into the city's chunked TrimBuilder (near-zero extra draw calls) with static Rapier colliders.
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { Chunked, TrimBuilder, T_METAL, T_STONE, T_PAINT, T_NIGHTGLOW } from './builders';

export interface LandmarkSpec {
  x: number;
  z: number;
  name: string;
  subtitle: string;
}

/**
 * Adds iconic landmarks & overhead highway gantries across Port Meridian.
 * All coordinates are verified clear of road lanes, intersections, postcards, and all 7 garage driveways.
 */
export function buildLandmarks(
  trim: Chunked<TrimBuilder>,
  physics: Physics,
  pierStartZ: number,
  groundH: (x: number, z: number) => number,
) {
  buildHarborLighthouse(trim, physics);
  buildJuniperFountain(trim, physics);
  buildPierGatewayArch(trim, physics, pierStartZ);
  buildHighwayGantries(trim, physics, groundH);
}

/** Meridian Harbor Lighthouse at the southeast headland (x=546, z=950). */
function buildHarborLighthouse(trim: Chunked<TrimBuilder>, physics: Physics) {
  const x = 546, z = 950;
  const tb = trim.at(x, z);
  const stone = new THREE.Color('#8e8980');
  const darkStone = new THREE.Color('#5a5752');
  const cream = new THREE.Color('#ebe4d6');
  const crimson = new THREE.Color('#bf3b2e');
  const iron = new THREE.Color('#252a30');
  const copper = new THREE.Color('#2f6e66');
  const beacon = new THREE.Color('#ffdf8a');

  // Stepped coastal seawall & octagonal stone plinth
  tb.cyl(x, -0.4, z, 6.2, 5.6, 1.4, 8, darkStone, T_STONE);
  tb.cyl(x, 1.0, z, 4.6, 4.2, 2.2, 8, stone, T_STONE);

  // Tapered banded masonry tower (6 alternating red/white drums from y=3.2 to y=24.2)
  const bands = 6;
  const segH = 3.5;
  for (let i = 0; i < bands; i++) {
    const y0 = 3.2 + i * segH;
    const r0 = 3.5 - i * 0.25;
    const r1 = 3.5 - (i + 1) * 0.25;
    tb.cyl(x, y0, z, r0, r1, segH + 0.04, 12, i % 2 === 0 ? cream : crimson, T_PAINT);
  }

  // Cantilevered iron gallery deck & guardrail posts at y=24.2
  const deckY = 24.2;
  tb.cyl(x, deckY - 0.35, z, 2.2, 2.95, 0.5, 12, iron, T_METAL);
  tb.cyl(x, deckY + 0.15, z, 2.95, 2.95, 0.18, 12, darkStone, T_STONE);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const px = x + Math.cos(a) * 2.8;
    const pz = z + Math.sin(a) * 2.8;
    tb.cyl(px, deckY + 0.25, pz, 0.05, 0.05, 1.05, 6, iron, T_METAL);
    const na = ((i + 1) / 12) * Math.PI * 2;
    tb.beam(px, deckY + 1.25, pz, x + Math.cos(na) * 2.8, deckY + 1.25, z + Math.sin(na) * 2.8, 0.07, 0.07, iron, T_METAL);
  }

  // Lantern room: glowing Fresnel core + iron mullions + copper cupola + spire
  tb.cyl(x, deckY + 0.3, z, 1.85, 1.85, 0.75, 12, iron, T_METAL);
  tb.cyl(x, deckY + 1.05, z, 1.55, 1.55, 2.4, 12, beacon, T_NIGHTGLOW(6.5));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tb.cyl(x + Math.cos(a) * 1.72, deckY + 1.05, z + Math.sin(a) * 1.72, 0.07, 0.07, 2.45, 6, iron, T_METAL);
  }
  tb.cyl(x, deckY + 3.45, z, 2.15, 0.45, 1.7, 12, copper, T_METAL);
  tb.cyl(x, deckY + 5.15, z, 0.08, 0.03, 2.2, 6, iron, T_METAL);
  tb.sphere(x, deckY + 7.4, z, 0.22, beacon, T_NIGHTGLOW(4.5));

  // Keeper's cottage annex on the west side of the plinth
  tb.box(x - 6.4, 2.2, z - 1.2, 5.2, 3.8, 4.4, 0, cream, T_PAINT);
  tb.box(x - 6.4, 4.3, z - 1.2, 5.8, 0.45, 5.0, 0, crimson, T_PAINT);
  tb.box(x - 6.4, 2.4, z + 1.04, 1.8, 1.1, 0.08, 0, beacon, T_NIGHTGLOW(2.2));

  physics.addStaticCylinder(x, 14, z, 14, 4.1);
  physics.addStaticBox(x - 6.4, 2.2, z - 1.2, 2.6, 2.1, 2.2);
}

/** Juniper Park Grand Fountain & Pergola Plaza (x=0, z=-150; south Juniper block crossroads). */
function buildJuniperFountain(trim: Chunked<TrimBuilder>, physics: Physics) {
  const x = 0, z = -150;
  const tb = trim.at(x, z);
  const stone = new THREE.Color('#c8c1b4');
  const trimStone = new THREE.Color('#e2dbd0');
  const waterCol = new THREE.Color('#2d8da3');
  const sprayCol = new THREE.Color('#cceef5');
  const timber = new THREE.Color('#6b4d35');
  const bronze = new THREE.Color('#425750');
  const lampCol = new THREE.Color('#ffe4a8');

  // Broad travertine plaza step
  tb.cyl(x, 0.14, z, 7.6, 7.4, 0.14, 16, stone, T_STONE);
  // Outer octagonal fountain basin rim + recessed turquoise pool
  tb.cyl(x, 0.28, z, 4.2, 4.1, 0.78, 16, trimStone, T_STONE);
  tb.cyl(x, 0.92, z, 3.72, 3.72, 0.12, 16, waterCol, T_METAL);
  // Sculpted central bronze & stone tiers
  tb.cyl(x, 0.95, z, 0.85, 0.65, 1.35, 10, stone, T_STONE);
  tb.cyl(x, 2.2, z, 0.75, 1.85, 0.38, 12, trimStone, T_STONE);
  tb.cyl(x, 2.52, z, 1.6, 1.6, 0.08, 12, waterCol, T_METAL);
  tb.cyl(x, 2.55, z, 0.42, 0.3, 1.15, 10, bronze, T_METAL);
  tb.cyl(x, 3.65, z, 0.35, 0.85, 0.28, 10, trimStone, T_STONE);
  tb.cyl(x, 3.9, z, 0.14, 0.06, 1.05, 8, sprayCol, T_NIGHTGLOW(1.8));
  // Subtle warm uplight accents around basin rim
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    tb.sphere(x + Math.cos(a) * 3.85, 1.08, z + Math.sin(a) * 3.85, 0.13, lampCol, T_NIGHTGLOW(3.0));
  }

  // Four diagonal park pergolas framing the plaza (completely clear of N-S and E-W walkways)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = x + sx * 9.8, pz = z + sz * 9.8;
      const yaw = Math.atan2(sx, sz) + Math.PI / 4;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const ox of [-2.4, 2.4]) {
        for (const oz of [-1.2, 1.2]) {
          const cx = px + ox * c - oz * s;
          const cz = pz + ox * s + oz * c;
          tb.box(cx, 1.65, cz, 0.24, 3.1, 0.24, yaw, timber, T_PAINT);
        }
      }
      tb.box(px, 3.25, pz, 5.4, 0.22, 2.9, yaw, timber, T_PAINT);
      // Integrated shaded seating bench
      tb.box(px, 0.58, pz, 3.8, 0.16, 0.72, yaw, timber, T_PAINT);
      physics.addStaticBox(px, 1.6, pz, 2.6, 1.6, 1.35, yaw);
    }
  }

  physics.addStaticCylinder(x, 1.2, z, 1.2, 4.15);
}

/** Pier 9 Illuminated Art-Deco Gateway Arch framing the boardwalk & Ferris wheel. */
function buildPierGatewayArch(trim: Chunked<TrimBuilder>, physics: Physics, pierStartZ: number) {
  const x = -50;
  const z = pierStartZ + 2.0;
  const deckY = 1.2;
  const halfSpan = 7.65;
  const tb = trim.at(x, z);
  const cream = new THREE.Color('#eee6d8');
  const teal = new THREE.Color('#277e85');
  const darkIron = new THREE.Color('#242930');
  const glow = new THREE.Color('#ffcf78');
  const neon = new THREE.Color('#ff8a5b');

  // Twin side pylons (outside the 14.5m clear pier lane)
  for (const s of [-1, 1]) {
    const px = x + s * halfSpan;
    tb.box(px, deckY + 0.65, z, 1.35, 1.3, 1.6, 0, teal, T_PAINT);
    tb.box(px, deckY + 3.9, z, 0.96, 5.3, 1.15, 0, cream, T_STONE);
    tb.box(px, deckY + 6.8, z, 1.25, 0.55, 1.35, 0, teal, T_PAINT);
    tb.sphere(px, deckY + 7.55, z, 0.42, glow, T_NIGHTGLOW(5.5));
    // Vertical neon accent stripe on inner face
    tb.box(px - s * 0.5, deckY + 3.8, z, 0.08, 4.4, 0.18, 0, neon, T_NIGHTGLOW(4.2));
    physics.addStaticBox(px, deckY + 3.5, z, 0.65, 3.5, 0.75);
  }

  // Overhead arched steel span & marquee fascia (clearance y >= deckY + 6.3m)
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x0 = x - halfSpan + t0 * halfSpan * 2;
    const x1 = x - halfSpan + t1 * halfSpan * 2;
    const y0 = deckY + 6.55 + Math.sin(t0 * Math.PI) * 2.15;
    const y1 = deckY + 6.55 + Math.sin(t1 * Math.PI) * 2.15;
    tb.beam(x0, y0, z - 0.35, x1, y1, z - 0.35, 0.24, 0.28, darkIron, T_METAL);
    tb.beam(x0, y0, z + 0.35, x1, y1, z + 0.35, 0.24, 0.28, darkIron, T_METAL);
    if (i > 0 && i < segs) {
      tb.sphere(x0, y0 - 0.24, z, 0.15, glow, T_NIGHTGLOW(5.2));
    }
  }
  // Central coastal crown plaque
  tb.box(x, deckY + 7.85, z, 5.8, 1.25, 0.46, 0, teal, T_PAINT);
  tb.box(x, deckY + 7.85, z - 0.25, 5.1, 0.72, 0.06, 0, glow, T_NIGHTGLOW(4.4));
  tb.box(x, deckY + 7.85, z + 0.25, 5.1, 0.72, 0.06, 0, glow, T_NIGHTGLOW(4.4));
}

/** Four galvanized overhead highway sign gantries on major arterial corridors (clearance >= 6.6m). */
function buildHighwayGantries(
  trim: Chunked<TrimBuilder>,
  physics: Physics,
  groundH: (x: number, z: number) => number,
) {
  const spots: { x: number; z: number; rot: number }[] = [
    { x: -50, z: 50, rot: 0 },              // Meridian Blvd midtown
    { x: 100, z: 0, rot: Math.PI / 2 },     // Sunset Blvd downtown
    { x: 100, z: 910, rot: Math.PI / 2 },   // Coastal / Battery Dr strand
    { x: 450, z: 250, rot: 0 },             // Harbor Way docks arterial
  ];
  const steel = new THREE.Color('#7a828a');
  const darkSteel = new THREE.Color('#3b4248');
  const signGreen = new THREE.Color('#1a5c3f');
  const signTrim = new THREE.Color('#e6ece8');
  const lamp = new THREE.Color('#fff1d2');

  for (const sp of spots) {
    const tb = trim.at(sp.x, sp.z);
    const baseY = Math.max(0.18, groundH(sp.x, sp.z));
    const span = 9.8; // sidewalks outside 8m road half-width
    const c = Math.cos(sp.rot), s = Math.sin(sp.rot);
    const toW = (lx: number, lz: number) => ({ wx: sp.x + lx * c - lz * s, wz: sp.z + lx * s + lz * c });

    // Sidewalk truss legs
    for (const side of [-1, 1]) {
      const p1 = toW(side * span, -0.45);
      const p2 = toW(side * span, 0.45);
      tb.cyl(p1.wx, baseY, p1.wz, 0.22, 0.18, 7.9, 8, steel, T_METAL);
      tb.cyl(p2.wx, baseY, p2.wz, 0.22, 0.18, 7.9, 8, steel, T_METAL);
      const baseP = toW(side * span, 0);
      tb.box(baseP.wx, baseY + 0.45, baseP.wz, 0.85, 0.9, 1.35, sp.rot, darkSteel, T_STONE);
      physics.addStaticBox(baseP.wx, baseY + 3.8, baseP.wz, 0.42, 3.8, 0.65, sp.rot);
    }

    // Overhead bridge truss at y = baseY + 6.9..7.8
    const lA = toW(-span, 0), rA = toW(span, 0);
    tb.beam(lA.wx, baseY + 6.9, lA.wz, rA.wx, baseY + 6.9, rA.wz, 0.22, 0.22, steel, T_METAL);
    tb.beam(lA.wx, baseY + 7.75, lA.wz, rA.wx, baseY + 7.75, rA.wz, 0.22, 0.22, steel, T_METAL);

    // Two overhead highway directional boards + downlight strips
    for (const bx of [-4.1, 4.1]) {
      const bp = toW(bx, 0);
      tb.box(bp.wx, baseY + 7.3, bp.wz, 6.2, 1.65, 0.24, sp.rot, signGreen, T_PAINT);
      tb.box(bp.wx, baseY + 7.3, bp.wz, 6.32, 0.1, 0.28, sp.rot, signTrim, T_PAINT);
      const lpF = toW(bx, 0.55), lpB = toW(bx, -0.55);
      tb.box(lpF.wx, baseY + 6.42, lpF.wz, 3.2, 0.1, 0.16, sp.rot, lamp, T_NIGHTGLOW(3.6));
      tb.box(lpB.wx, baseY + 6.42, lpB.wz, 3.2, 0.1, 0.16, sp.rot, lamp, T_NIGHTGLOW(3.6));
    }
  }
}
