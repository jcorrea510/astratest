/** Highway vehicle look: one shared lightweight car shader (paint per instance, lamp state per instance) and the heavy-vehicle meshes. */
import * as THREE from 'three';
import { Geo, rgb } from './geo';
import { K } from '../vehicles/models/kinds';

export interface CarUniforms { uTailBase: { value: number }; uHeadAmt: { value: number }; uEnv: { value: number }; uCabin: { value: number }; uTrimY: { value: number } }

/** Body material. Reads vertex attributes `color` (vec4) / `aKind` and per-instance `iLamp` (brake, left blinker, right blinker, headlights). */
export function makeCarMaterial(): THREE.MeshStandardMaterial & { userData: { u: CarUniforms } } {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  const u: CarUniforms = { uTailBase: { value: 0.25 }, uHeadAmt: { value: 1 }, uEnv: { value: 1 }, uCabin: { value: 0 }, uTrimY: { value: 0.7 } };
  m.userData.u = u;
  const kinds = Object.entries(K).map(([k, v]) => `#define K_${k} ${v}.0`).join('\n');
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 color; attribute float aKind; attribute vec4 iLamp;
        varying vec4 vCol; varying float vKind; varying vec3 vObj; varying vec4 vLamp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCol = color; vKind = aKind; vObj = position; vLamp = iLamp;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${kinds}
        varying vec4 vCol; varying float vKind; varying vec3 vObj; varying vec4 vLamp;
        uniform float uTailBase, uHeadAmt, uCabin, uTrimY;
        bool isK(float k) { return abs(vKind - k) < 0.5; }
        float gRough = 0.5, gMetal = 0.0; vec3 gEmis = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 inst = diffuseColor.rgb; vec3 col = vCol.rgb;
        bool cabinTrim = uCabin > 0.5 && vObj.y > uTrimY && abs(vObj.x) < 0.95 && abs(vObj.z) < 2.0;
        if (cabinTrim && (isK(K_PAINT) || isK(K_PAINT2) || isK(K_TRIM) || isK(K_SEAM) || isK(K_CHROME))) { col = vec3(0.04, 0.04, 0.045); gRough = 0.8; gMetal = 0.0; } // A/B/C pillars and headliner seen from inside
        else if (isK(K_PAINT)) { col = inst; gRough = 0.3; gMetal = 0.5; }
        else if (isK(K_PAINT2)) { col = vec3(0.8); gRough = 0.45; gMetal = 0.1; }
        else if (isK(K_CHROME)) { col = vec3(0.8, 0.82, 0.85); gRough = 0.12; gMetal = 1.0; }
        else if (isK(K_RUBBER)) { col = vec3(0.03); gRough = 0.9; }
        else if (isK(K_RIM)) { gRough = 0.3; gMetal = 0.85; }
        else if (isK(K_HEAD)) { col = vec3(0.7, 0.72, 0.75); gRough = 0.1; gMetal = 0.9; gEmis = vec3(1.0, 0.93, 0.8) * (vLamp.w * uHeadAmt * 2.0); }
        else if (isK(K_TAIL)) { col = vec3(0.3, 0.012, 0.015); gRough = 0.1; gEmis = vec3(1.0, 0.04, 0.03) * (uTailBase + vLamp.x * 1.9); }
        else if (isK(K_IND)) { col = vec3(0.5, 0.25, 0.04); gRough = 0.1; gEmis = vec3(1.0, 0.45, 0.04) * 2.0 * (vObj.x > 0.0 ? vLamp.y : vLamp.z); }
        else if (isK(K_REV)) { col = vec3(0.7); }
        else if (isK(K_GRILLE)) { col = vec3(0.04); gRough = 0.5; gMetal = 0.4; }
        else if (isK(K_PLATE)) { col = vec3(0.75); }
        else if (isK(K_SEAM)) { col = vec3(0.01); gRough = 0.12; gMetal = 0.5; }
        else if (isK(K_MIRROR)) { col = vec3(0.5); gRough = 0.05; gMetal = 1.0; }
        else if (isK(K_INTERIOR)) { gRough = 0.9; gEmis = col * uCabin * 0.55; }
        else if (isK(K_UNDER)) { col = vec3(0.02); gRough = 0.95; }
        else if (isK(K_PLASTIC) || isK(K_TRIM)) { gRough = 0.6; }
        else if (isK(K_LIGHT)) { gEmis = vCol.rgb * 0.5; }
        if (!gl_FrontFacing) {
          col *= 0.35;
          gEmis = vec3(0.0);
        }
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = gRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = gMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmis;`);
  };
  m.customProgramCacheKey = () => 'highway-car-v1';
  return m as THREE.MeshStandardMaterial & { userData: { u: CarUniforms } };
}
export function makeGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x090d12, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
}

const SHIFT = -0.35; // vehicle models have their ground plane at y = -0.35
function finish(g: Geo): THREE.BufferGeometry {
  g.withKinds = true;
  const geo = g.build();
  geo.translate(0, SHIFT, 0);
  // the shader reads colour as vec4
  const c3 = geo.getAttribute('color') as THREE.BufferAttribute, c4 = new Float32Array((c3.count) * 4);
  for (let i = 0; i < c3.count; i++) { c4[i * 4] = c3.getX(i); c4[i * 4 + 1] = c3.getY(i); c4[i * 4 + 2] = c3.getZ(i); c4[i * 4 + 3] = 1; }
  geo.setAttribute('color', new THREE.BufferAttribute(c4, 4));
  geo.computeBoundingSphere();
  return geo;
}
const AX: [number, number, number] = [1, 0, 0], AY: [number, number, number] = [0, 1, 0], AZ: [number, number, number] = [0, 0, 1];
function part(g: Geo, kind: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: [number, number, number] = [1, 1, 1]) {
  g.curKind = kind; g.box(cx, cy, cz, AX, AY, AZ, hx, hy, hz, color, true);
}
function lights(g: Geo, zFront: number, zRear: number, w: number, yHead: number, yTail: number) {
  for (const sg of [-1, 1]) {
    part(g, K.HEAD, sg * w, yHead, zFront + 0.02, 0.22, 0.12, 0.04);
    part(g, K.IND, sg * (w + 0.3), yHead, zFront + 0.02, 0.1, 0.1, 0.04);
    part(g, K.TAIL, sg * w, yTail, zRear - 0.02, 0.25, 0.12, 0.04);
    part(g, K.IND, sg * (w + 0.35), yTail, zRear - 0.02, 0.1, 0.1, 0.04);
  }
}
function wheels(g: Geo, zs: number[], halfTrack: number, r: number, dual: boolean) {
  g.curKind = K.RUBBER;
  for (const z of zs) for (const sg of [-1, 1]) {
    g.cylX(sg * halfTrack, r, z, r, 0.32, [1, 1, 1], 10);
    if (dual) g.cylX(sg * (halfTrack - 0.36), r, z, r, 0.32, [1, 1, 1], 10);
  }
}

/** 18-wheeler: cab-over tractor and a box trailer. Length 20.5 m. */
export function semiGeometry(): THREE.BufferGeometry {
  const g = new Geo(), black: [number, number, number] = [0.02, 0.02, 0.02];
  part(g, K.PAINT, 0, 2.05, 8.7, 1.25, 1.45, 1.55); // cab
  part(g, K.PAINT, 0, 3.55, 8.2, 1.2, 0.18, 1.1); // roof fairing
  part(g, K.SEAM, 0, 2.75, 10.27, 1.08, 0.55, 0.02, black); // windscreen
  for (const sg of [-1, 1]) part(g, K.SEAM, sg * 1.27, 2.7, 9.0, 0.02, 0.5, 0.7, black);
  part(g, K.UNDER, 0, 0.8, 5.0, 1.0, 0.25, 5.3, black); // chassis
  part(g, K.PAINT2, 0, 2.7, -3.4, 1.3, 1.45, 6.95); // trailer box
  part(g, K.UNDER, 0, 1.12, -3.4, 1.2, 0.08, 6.95, black);
  part(g, K.CHROME, 0, 0.55, -10.0, 1.1, 0.07, 0.07); // underride bar
  for (let i = 0; i < 6; i++) part(g, K.PAINT2, 0, 2.7, -3.4 + (i - 2.5) * 2.5, 1.32, 1.42, 0.02, [0.7, 0.7, 0.72]); // panel seams
  part(g, K.CHROME, 0, 1.0, 10.3, 1.0, 0.14, 0.05); // bumper
  lights(g, 10.27, -10.27, 0.95, 1.05, 1.0);
  for (const sg of [-1, 1]) part(g, K.IND, sg * 1.31, 2.2, 7.4, 0.02, 0.08, 0.2); // markers
  wheels(g, [8.4], 1.1, 0.5, false); wheels(g, [4.9, 3.6], 1.0, 0.5, true); wheels(g, [-7.4, -8.7], 1.0, 0.5, true);
  return finish(g);
}
/** Intercity coach, 12.4 m. */
export function busGeometry(): THREE.BufferGeometry {
  const g = new Geo(), black: [number, number, number] = [0.02, 0.025, 0.03];
  part(g, K.PAINT, 0, 1.95, 0, 1.3, 1.45, 6.2);
  part(g, K.PAINT2, 0, 3.5, 0, 1.2, 0.12, 5.9);
  part(g, K.SEAM, 0, 2.55, 6.22, 1.15, 0.7, 0.02, black);
  for (const sg of [-1, 1]) for (let i = 0; i < 6; i++) part(g, K.SEAM, sg * 1.31, 2.55, -4.9 + i * 1.95, 0.02, 0.55, 0.85, black);
  part(g, K.CHROME, 0, 0.75, 6.25, 1.2, 0.13, 0.05);
  lights(g, 6.22, -6.22, 0.95, 0.95, 1.1);
  wheels(g, [4.3], 1.1, 0.5, false); wheels(g, [-3.6, -4.7], 1.05, 0.5, true);
  return finish(g);
}
export function colorOf(hex: string): THREE.Color { const c = new THREE.Color(hex); return c; }
void rgb;
