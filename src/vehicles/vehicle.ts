/** Vehicle visuals and state: paint, glass, lights, body roll, deformable damage, fire. */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../core/physics';
import { VehiclePhysics, type DriveInput, type VehicleLayout } from './vehiclePhysics';
import { VEHICLES, type VehicleKind, type VehicleSpec } from './specs';
import type { Character } from '../actors/character';
import { nightUniform } from '../render/materials';

const S = 5;
const PAINT_CELL: Record<string, [number, number]> = { car_sedan: [2, 1], car_taxi: [3, 1], car_police: [-1, -1], car_hatchback: [4, 1], car_stationwagon: [2, 2] };

export interface VehicleTemplate {
  body: THREE.BufferGeometry; wheel: THREE.BufferGeometry; layout: VehicleLayout; bbox: THREE.Box3; model: string; atlas: boolean;
  /** transparent window panes (shared by every car of this model) */
  glass: THREE.BufferGeometry;
}
/** Per-vertex surface kind (attribute aKind): lamps glow, interior stays matte. */
const K_BODY = 0, K_HEAD = 1, K_TAIL = 2, K_IND = 3, K_INTERIOR = 4;
const cellUV = (cx: number, cy: number): [number, number] => [(cx + 0.5) / 8, (cy + 0.5) / 4];
function bakeNode(obj: THREE.Object3D, scale: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale).multiply(inv).multiply(m.matrixWorld));
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  return mergeGeometries(geos)!;
}
/** Non-indexed part with a constant atlas cell (or vertex colour) and surface kind, ready to merge. */
function part(g: THREE.BufferGeometry, kind: number, uv: [number, number] | null, color?: THREE.Color, paint = 0): THREE.BufferGeometry {
  const p = g.index ? g.toNonIndexed() : g;
  const n = p.attributes.position.count;
  for (const k of Object.keys(p.attributes)) if (!['position', 'normal', ...(uv ? [] : ['uv'])].includes(k)) p.deleteAttribute(k);
  if (uv) { const a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[i * 2] = uv[0]; a[i * 2 + 1] = uv[1]; } p.setAttribute('uv', new THREE.BufferAttribute(a, 2)); }
  if (color) { const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) { a[i * 4] = color.r; a[i * 4 + 1] = color.g; a[i * 4 + 2] = color.b; a[i * 4 + 3] = paint; } p.setAttribute('color', new THREE.BufferAttribute(a, 4)); }
  p.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  return p;
}
interface Cabin { belt: number; roof: number; front: number; rearTop: number; half: number; driverX: number; rows: number }
/** Seats with headrests, dashboard and steering wheel so the glass never looks into an empty shell. */
function interior(c: Cabin, mk: (g: THREE.BufferGeometry, tone: 'seat' | 'dark') => THREE.BufferGeometry): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx: number, tone: 'seat' | 'dark') => out.push(mk(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), tone));
  const h = c.roof - c.belt;
  const sx = c.half * 0.48, cushionZ = c.front - 0.85, backZ = cushionZ - 0.3, backH = h * 0.78;
  for (const s of [-1, 1]) {
    box(0.5, 0.14, 0.5, s * sx, c.belt - 0.16, cushionZ, 0, 'seat');
    box(0.5, backH, 0.13, s * sx, c.belt - 0.1 + backH / 2, backZ, -0.16, 'seat');
    box(0.27, 0.17, 0.11, s * sx, c.belt - 0.04 + backH + 0.08, backZ - 0.09, -0.16, 'seat');
  }
  if (c.rows > 1) {
    const rz = c.rearTop + 0.16, w = c.half * 1.6;
    box(w, backH * 0.92, 0.13, 0, c.belt - 0.1 + backH * 0.46, rz, -0.1, 'seat');
    box(w, 0.14, 0.45, 0, c.belt - 0.16, rz + 0.32, 0, 'seat');
    for (const s of [-1, 1]) box(0.25, 0.15, 0.1, s * sx, c.belt - 0.06 + backH * 0.92 + 0.07, rz - 0.04, -0.1, 'seat');
  }
  box(c.half * 1.84, 0.2, 0.3, 0, c.belt + 0.04, c.front - 0.27, 0, 'dark');
  out.push(mk(new THREE.TorusGeometry(0.155, 0.026, 4, 12).rotateX(0.45).translate(c.driverX, c.belt + 0.2, c.front - 0.5), 'dark'));
  out.push(mk(new THREE.BoxGeometry(0.06, 0.06, 0.28).rotateX(0.45).translate(c.driverX, c.belt + 0.14, c.front - 0.38), 'dark'));
  return out;
}
/** Alloy rim, hub and spoke gaps on the outer face (+x) of the shared tyre. */
function rimParts(radius: number, outer: number, mk: (g: THREE.BufferGeometry, tone: 'rim' | 'dark') => THREE.BufferGeometry): THREE.BufferGeometry[] {
  const out = [mk(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 0.02, 14).rotateZ(-Math.PI / 2).translate(outer, 0, 0), 'rim'),
    mk(new THREE.CylinderGeometry(radius * 0.17, radius * 0.2, 0.05, 8).rotateZ(-Math.PI / 2).translate(outer + 0.02, 0, 0), 'dark')];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    out.push(mk(new THREE.CircleGeometry(radius * 0.13, 7).rotateY(Math.PI / 2).translate(outer + 0.012, Math.cos(a) * radius * 0.36, Math.sin(a) * radius * 0.36), 'dark'));
  }
  return out;
}
export function makeKayKitTemplate(gltf: GLTF, model: string, bodyScale: [number, number, number] = [1, 1, 1]): VehicleTemplate {
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const bodyNode = scene.getObjectByName(model)!;
  const wheelNodes = ['front_left', 'front_right', 'rear_left', 'rear_right'].map(n => scene.getObjectByName(`${model}_wheel_${n}`)!);
  const raw = bakeNode(new THREE.Group().add((bodyNode as THREE.Mesh).clone(false)), S);
  raw.scale(bodyScale[0], bodyScale[1], bodyScale[2]);
  raw.computeBoundingBox(); const bb = raw.boundingBox!.clone();
  // Split the shell: window triangles become the glass panes, lamp triangles get a kind so they can glow.
  const pos = raw.attributes.position, nor = raw.attributes.normal, uv = raw.attributes.uv;
  const keep: number[] = [], glassIdx: number[] = [];
  const kind = new Float32Array(pos.count);
  for (let t = 0; t < pos.count; t += 3) {
    let u = 0, v = 0, z = 0, nz = 0;
    for (let k = 0; k < 3; k++) { u += uv.getX(t + k) / 3; v += uv.getY(t + k) / 3; z += pos.getZ(t + k) / 3; nz += nor.getZ(t + k) / 3; }
    const cx = Math.floor(u * 8), cy = Math.floor(v * 4);
    if (cy === 3 && cx <= 1) { glassIdx.push(t); continue; }
    let kd = K_BODY;
    if (cx === 1 && cy === 0 && z > bb.max.z - 0.35 && nz > 0.2) kd = K_HEAD;
    else if (cx === 6 && cy === 2 && z < bb.min.z + 0.35) kd = K_TAIL;
    else if (cx === 2 && cy === 3) kd = K_IND;
    for (let k = 0; k < 3; k++) kind[t + k] = kd;
    keep.push(t);
  }
  const pick = (tris: number[], withKind: boolean) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries({ position: pos, normal: nor, uv, ...(withKind ? { aKind: new THREE.BufferAttribute(kind, 1) } : {}) })) {
      const a = attr as THREE.BufferAttribute, arr = new Float32Array(tris.length * 3 * a.itemSize);
      tris.forEach((t, j) => { for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) arr[(j * 3 + k) * a.itemSize + c] = a.array[(t + k) * a.itemSize + c]; });
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return g;
  };
  const shell = pick(keep, true), glass = pick(glassIdx, false);
  glass.computeBoundingBox(); const gb = glass.boundingBox!;
  // rear window top edge: highest z among backward-facing glass vertices
  let rearTop = gb.min.z;
  { const gp = glass.attributes.position, gn = glass.attributes.normal; let best = -Infinity; for (let i = 0; i < gp.count; i++) if (gn.getZ(i) < -0.5) best = Math.max(best, gp.getZ(i)); if (best > -Infinity) rearTop = best; }
  const cabin: Cabin = { belt: gb.min.y, roof: gb.max.y, front: gb.max.z, rearTop, half: gb.max.x, driverX: gb.max.x * 0.48, rows: 2 };
  const inner = interior(cabin, (g, tone) => part(g, K_INTERIOR, tone === 'seat' ? cellUV(6, 0) : cellUV(0, 0)));
  const body = mergeGeometries([shell, ...inner])!;
  const wheelRaw = bakeNode(new THREE.Group().add((wheelNodes[0] as THREE.Mesh).clone(false)), S);
  wheelRaw.computeBoundingBox();
  const wb = wheelRaw.boundingBox!; const c = wb.getCenter(new THREE.Vector3()); wheelRaw.translate(-c.x, -c.y, -c.z);
  const radius = (wb.max.y - wb.min.y) / 2;
  const wheelGeo = mergeGeometries([part(wheelRaw, K_BODY, null), ...rimParts(radius, (wb.max.x - wb.min.x) / 2 + 0.004, (g, tone) => part(g, K_BODY, tone === 'rim' ? cellUV(2, 0) : cellUV(0, 0)))])!;
  const wheels = wheelNodes.map((w, i) => ({ x: w.position.x * S * bodyScale[0], y: w.position.y * S, z: w.position.z * S * bodyScale[2], front: i < 2, left: i % 2 === 0 }));
  const hy = (bb.max.y - Math.max(bb.min.y, 0.05)) / 2 * 0.86;
  const layout: VehicleLayout = { half: [(bb.max.x - bb.min.x) / 2 * 0.96, hy, (bb.max.z - bb.min.z) / 2 * 0.97], centerY: Math.max(bb.min.y, 0.05) + hy + 0.05, wheels, radius };
  return { body, wheel: wheelGeo, layout, bbox: bb, model, atlas: true, glass };
}
/** Procedural box van in the same flat style (vertex colours; alpha 1 = paint). */
export function makeVanTemplate(wheelFrom: VehicleTemplate): VehicleTemplate {
  const parts: THREE.BufferGeometry[] = [], panes: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: string, paint = 0, kind = K_BODY) =>
    parts.push(part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), kind, null, new THREE.Color(col), paint));
  const pane = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); g.deleteAttribute('uv'); panes.push(g); };
  box(2.3, 2.3, 3.9, 0, 1.72, -0.95, '#ffffff', 1); // cargo box (paint)
  box(2.2, 1.35, 1.9, 0, 1.1, 1.95, '#ffffff', 1); // cab lower
  // cab upper: roof and pillars; the cab is open behind the glass
  box(2.12, 0.1, 1.38, 0, 2.39, 1.7, '#ffffff', 1);
  for (const sx of [-1, 1]) { box(0.1, 0.62, 0.1, sx * 1.0, 2.06, 2.34, '#ffffff', 1); box(0.1, 0.62, 0.12, sx * 1.0, 2.06, 1.07, '#ffffff', 1); }
  box(2.0, 0.62, 0.04, 0, 2.06, 1.04, '#1c1f22'); box(2.0, 0.02, 1.25, 0, 1.785, 1.7, '#1c1f22');
  pane(1.92, 0.6, 0.02, 0, 2.06, 2.37); for (const sx of [-1, 1]) pane(0.02, 0.6, 1.18, sx * 1.04, 2.06, 1.7);
  const cab: Cabin = { belt: 1.78, roof: 2.36, front: 2.4, rearTop: 1.0, half: 1.0, driverX: 0.48, rows: 1 };
  for (const g of interior(cab, (geo, tone) => part(geo, K_INTERIOR, null, new THREE.Color(tone === 'seat' ? '#5a3a2e' : '#16191b')))) parts.push(g);
  box(2.3, 0.3, 0.25, 0, 0.55, 2.95, '#9aa0a4'); box(2.3, 0.3, 0.25, 0, 0.55, -2.95, '#9aa0a4');
  box(2.24, 0.35, 6.0, 0, 0.55, 0, '#2b2f33');
  box(2.32, 0.08, 3.92, 0, 2.86, -0.95, '#d8d4c8');
  for (const sx of [-1, 1]) {
    box(0.36, 0.2, 0.04, sx * 0.78, 0.98, 2.91, '#e8e2cf', 0, K_HEAD);
    box(0.16, 0.12, 0.04, sx * 1.0, 0.98, 2.91, '#e8962e', 0, K_IND);
    box(0.22, 0.34, 0.04, sx * 0.95, 1.05, -2.91, '#b5241e', 0, K_TAIL);
  }
  const body = mergeGeometries(parts)!; body.computeBoundingBox();
  const glass = mergeGeometries(panes)!;
  const bb = body.boundingBox!;
  const r = wheelFrom.layout.radius;
  const wheels = [{ x: 0.98, y: r - 0.3 + 0.36, z: 1.95, front: true, left: true }, { x: -0.98, y: r - 0.3 + 0.36, z: 1.95, front: true, left: false }, { x: 0.98, y: r - 0.3 + 0.36, z: -1.9, front: false, left: true }, { x: -0.98, y: r - 0.3 + 0.36, z: -1.9, front: false, left: false }];
  const layout: VehicleLayout = { half: [1.12, 1.15, 2.95], centerY: 1.55, wheels, radius: r * 1.1 };
  return { body, wheel: wheelFrom.wheel.clone().scale(1.1, 1.1, 1.1), layout, bbox: bb, model: 'van', atlas: false, glass };
}

/** Car body: atlas or vertex colours, paint with a clearcoat, chrome trim, matte dark interior/back faces, glowing lamps, grime. */
function carMaterial(atlas: THREE.Texture | null, paintCell: [number, number]): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ map: atlas, roughness: 0.55, metalness: 0.1, vertexColors: !atlas, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, shadowSide: THREE.FrontSide });
  const u = { uPaint: { value: new THREE.Color(1, 1, 1) }, uPaintOn: { value: 0 }, uPaintCell: { value: new THREE.Vector2(...paintCell) }, uBurn: { value: 0 }, uFlash: { value: 0 },
    uHead: { value: 0 }, uTail: { value: 0 }, uInd: { value: 0 }, uDirt: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u); sh.uniforms.uNight = nightUniform;
    const hasMap = !!atlas;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute float aKind; varying vec2 vCell; varying float vKind; varying vec3 vObj;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${hasMap ? 'vCell = floor(uv * vec2(8.0, 4.0));' : 'vCell = vec2(-5.0);'} vKind = aKind; vObj = position;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCell; varying float vKind; varying vec3 vObj; uniform vec3 uPaint; uniform float uPaintOn, uBurn, uNight, uFlash, uHead, uTail, uInd, uDirt; uniform vec2 uPaintCell;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float inside = step(3.5, vKind) + (gl_FrontFacing ? 0.0 : 1.0);
        inside = min(inside, 1.0);
        float isPaint = ${hasMap ? 'step(distance(vCell, uPaintCell), 0.1)' : 'step(0.5, vColor.a)'} * uPaintOn * (1.0 - inside);
        float isChrome = ${hasMap ? 'step(distance(vCell, vec2(2.0, 0.0)), 0.1)' : '0.0'} * (1.0 - inside);
        float isTrim = ${hasMap ? 'step(distance(vCell, vec2(4.0, 0.0)), 0.1)' : '0.0'};
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (0.55 + lum * ${hasMap ? '0.9' : '0.45'}), isPaint);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.7), isChrome * 0.6);
        diffuseColor.rgb *= 1.0 - isTrim * 0.45;
        // back faces seen through the windows read as dark trim
        diffuseColor.rgb = gl_FrontFacing ? diffuseColor.rgb : vec3(0.03, 0.03, 0.032);
        // road grime: low on the body, more with damage
        float grime = uDirt * smoothstep(0.95, 0.05, vObj.y) * (1.0 - inside);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.13, 0.1), grime * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.05), uBurn);
        diffuseColor.rgb += uFlash * 0.3;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(mix(roughnessFactor, 0.36, isPaint), 0.22, isChrome), 0.9, max(inside, isTrim * 0.6));
        roughnessFactor = mix(roughnessFactor, 0.95, max(uBurn, grime * 0.8));`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(mix(metalnessFactor, 0.15, isPaint), 0.9, isChrome) * (1.0 - uBurn) * (1.0 - inside);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= isPaint * (1.0 - grime) * (1.0 - uBurn);\n#endif')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lampHead = step(0.5, vKind) * step(vKind, 1.5), lampTail = step(1.5, vKind) * step(vKind, 2.5), lampInd = step(2.5, vKind) * step(vKind, 3.5);
        totalEmissiveRadiance += (vec3(1.0, 0.9, 0.74) * uHead * lampHead + vec3(1.0, 0.05, 0.03) * uTail * lampTail + vec3(1.0, 0.45, 0.05) * uInd * lampInd) * (gl_FrontFacing ? 1.0 : 0.0);`);
  };
  m.customProgramCacheKey = () => (atlas ? 'car2-atlas' : 'car2-vc');
  return m;
}
/** Window glass shared by every car: tinted, reflective, fresnel-bright at grazing angles, with stylised streaks. */
let glassMat: THREE.MeshStandardMaterial | null = null;
function getGlassMaterial() {
  if (glassMat) return glassMat;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.09, 0.11), roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 2.2 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; uniform float uNight;')
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
        float band = fract((vObj.x * 0.35 + vObj.y * 1.1 + vObj.z * 0.55) * 1.6);
        float streak = smoothstep(0.0, 0.04, band) * (1.0 - smoothstep(0.1, 0.16, band)) + 0.6 * smoothstep(0.3, 0.33, band) * (1.0 - smoothstep(0.36, 0.4, band));
        outgoingLight += vec3(0.6, 0.72, 0.8) * (fres * 0.55 + streak * 0.12) * (1.0 - uNight * 0.75);
        diffuseColor.a = clamp(0.42 + fres * 0.5 + streak * 0.12, 0.0, 0.95);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'car-glass';
  glassMat = m;
  return m;
}

const beamTex = (() => {
  // soft elliptical pool of light (fades to zero at every edge of the quad)
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 2, 0, 0);
  const gr = g.createRadialGradient(32, 50, 2, 32, 40, 30); gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.6, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();

let VEH_ID = 0;
let wheelMat: THREE.MeshStandardMaterial | null = null;
export class Vehicle {
  id = VEH_ID++;
  phys: VehiclePhysics;
  spec: VehicleSpec;
  group = new THREE.Group();
  visual = new THREE.Group();
  bodyMesh: THREE.Mesh;
  wheels: THREE.Mesh[] = [];
  material: THREE.MeshStandardMaterial;
  health: number;
  destroyed = false;
  /** sank in deep water: dead, no fire */
  flooded = false;
  burnTime = 0;
  driver: Character | null = null;
  input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
  headlights = false;
  siren = false;
  lightsBroken = false;
  glassMesh: THREE.Mesh;
  private beam: THREE.Mesh;
  private barRed?: THREE.Mesh; private barBlue?: THREE.Mesh;
  private ownGeo = false;
  private roll = 0; private pitch = 0; private rollV = 0; private pitchV = 0; private heave = 0; private heaveV = 0;
  private baseDirt = 0;
  private lastVel = new THREE.Vector3();
  paint = new THREE.Color();
  parked = false;
  lastDriverTime = 0;
  locked = false;
  flashT = 0;
  persistent = false;
  lastDamagedBy: unknown = null;
  /** hazard lights (indicators blink) */
  hazard = false;

  constructor(physics: Physics, public kind: VehicleKind, public tpl: VehicleTemplate, x: number, y: number, z: number, yaw: number, atlas: THREE.Texture | null, paintIndex = -1) {
    this.spec = VEHICLES[kind];
    this.health = this.spec.health;
    this.phys = new VehiclePhysics(physics, this.spec, tpl.layout, x, y + 0.6, z, yaw);
    physics.tag(this.phys.collider, { kind: 'vehicle', ref: this });
    this.material = carMaterial(tpl.atlas ? atlas : null, PAINT_CELL[tpl.model] ?? [-1, -1]);
    const paints = this.spec.paints;
    if (paints[0]) { this.paint.set(paints[paintIndex >= 0 ? paintIndex % paints.length : Math.floor(Math.random() * paints.length)]).convertSRGBToLinear(); this.material.userData.u.uPaint.value.copy(this.paint); this.material.userData.u.uPaintOn.value = 1; }
    this.bodyMesh = new THREE.Mesh(tpl.body, this.material);
    this.bodyMesh.userData.shared = true;
    this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true;
    this.visual.add(this.bodyMesh);
    for (const w of tpl.layout.wheels) {
      if (!wheelMat && atlas) wheelMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.75 });
      const m = new THREE.Mesh(tpl.wheel, tpl.atlas ? this.material : wheelMat!); m.castShadow = false; m.userData.shared = true;
      m.position.set(w.x, w.y, w.z); this.group.add(m); this.wheels.push(m);
    }
    // Window panes (shared geometry + material) over the modelled interior
    this.glassMesh = new THREE.Mesh(tpl.glass, getGlassMaterial());
    this.glassMesh.renderOrder = 1; this.glassMesh.userData.shared = true; this.visual.add(this.glassMesh);
    // a little road grime on every car so they don't all look showroom-new
    this.baseDirt = Math.random() * 0.35;
    const bb = tpl.bbox;
    const fz = bb.max.z + 0.02, rz = bb.min.z - 0.02;
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 9).rotateX(-Math.PI / 2).translate(0, 0.04, fz + 4.4), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
    this.beam.renderOrder = 2; this.visual.add(this.beam);
    if (kind === 'police') {
      const barY = bb.max.y + 0.02;
      this.barRed = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.02, 0.02), toneMapped: false }));
      this.barBlue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.05, 0.3), toneMapped: false }));
      this.barRed.position.set(0.3, barY, -0.2); this.barBlue.position.set(-0.3, barY, -0.2);
      this.visual.add(this.barRed, this.barBlue);
    }
    if (kind === 'coupe') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.5 }));
      spoiler.position.set(0, bb.max.y - 0.25, rz + 0.35); spoiler.castShadow = true; this.visual.add(spoiler);
    }
    this.group.add(this.visual);
    this.syncTransform();
  }
  get position() { return this.group.position; }
  get speed() { return this.phys.speed; }
  get yaw() { return this.phys.yaw; }
  get name() { return this.spec.name; }
  get size() { return this.tpl.model === 'van' ? 1.25 : 1; }
  /** World position of the driver door (left side). */
  doorPoint(side: 1 | -1 = 1, out = new THREE.Vector3()) {
    const b = this.tpl.bbox;
    out.set(side * (b.max.x + 0.7), 0, 0.25).applyQuaternion(this.group.quaternion).add(this.group.position);
    return out;
  }
  seatOffset(): THREE.Vector3 { return this.tpl.model === 'van' ? new THREE.Vector3(0.48, 0.55, 1.75) : new THREE.Vector3(0.42, 0.12, 0.05); }
  syncTransform() {
    const p = this.phys.body.translation(), q = this.phys.body.rotation();
    this.group.position.set(p.x, p.y, p.z); this.group.quaternion.set(q.x, q.y, q.z, q.w);
  }
  update(dt: number, night: number, time: number, braking: boolean) {
    this.syncTransform();
    const c = this.phys.ctrl;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i], wd = this.tpl.layout.wheels[i];
      const sl = c.wheelSuspensionLength(i) ?? this.spec.suspRest;
      w.position.y = wd.y + this.spec.suspRest * 0.8 - sl;
      w.rotation.set(0, 0, 0);
      w.rotateY(c.wheelSteering(i) ?? 0);
      w.rotateX(this.phys.wheelRot[i]);
      if (!wd.left) w.rotateY(Math.PI);
    }
    // Body roll / pitch / heave from acceleration: a sprung, slightly underdamped body reads as weight transfer.
    const v = this.phys.body.linvel();
    if (dt > 0) {
      const ax = (v.x - this.lastVel.x) / dt, az = (v.z - this.lastVel.z) / dt, ay = (v.y - this.lastVel.y) / dt;
      this.lastVel.set(v.x, v.y, v.z);
      const f = this.phys.forward();
      const lon = THREE.MathUtils.clamp(ax * f.x + az * f.z, -40, 40), lat = THREE.MathUtils.clamp(ax * f.z - az * f.x, -40, 40);
      const g = this.phys.grounded ? 1 : 0.2;
      const tRoll = THREE.MathUtils.clamp(lat * 0.0085, -0.085, 0.085) * g, tPitch = THREE.MathUtils.clamp(-lon * 0.0065, -0.06, 0.06) * g;
      const k = 70, c = 9, h = Math.min(dt, 1 / 30);
      this.rollV += ((tRoll - this.roll) * k - this.rollV * c) * h; this.roll += this.rollV * h;
      this.pitchV += ((tPitch - this.pitch) * k - this.pitchV * c) * h; this.pitch += this.pitchV * h;
      const tHeave = this.phys.grounded ? THREE.MathUtils.clamp(-ay * 0.004, -0.08, 0.05) : 0;
      this.heaveV += ((tHeave - this.heave) * 90 - this.heaveV * 10) * h; this.heave += this.heaveV * h;
      this.visual.rotation.set(this.pitch, 0, this.roll);
      this.visual.position.y = this.heave;
    }
    // Lights: real lamp geometry glows (bloom does the halo); brake lights flare, night tail lights glow softly.
    const u = this.material.userData.u;
    const on = (this.headlights || night > 0.35) && !this.destroyed && !this.lightsBroken && (!!this.driver || this.persistent);
    u.uHead.value = on ? 3.6 : 0;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.28 * Math.max(night, 0.2) : 0;
    this.beam.visible = on;
    const lit = !this.destroyed && (!!this.driver || this.persistent);
    u.uTail.value = this.destroyed ? 0 : braking && lit ? 7 : on ? 2.2 : 0;
    u.uInd.value = this.destroyed || !(this.siren || (lit && this.hazard)) ? 0 : (Math.floor(time * 2.6) % 2 ? 3.5 : 0);
    u.uDirt.value = Math.min(1, this.baseDirt + (1 - this.health / this.spec.health) * 0.8);
    this.glassMesh.visible = !this.destroyed;
    if (this.barRed && this.barBlue) {
      const ph = Math.floor(time * 6) % 2;
      const s = this.siren && !this.destroyed;
      (this.barRed.material as THREE.MeshBasicMaterial).color.setRGB(s && ph ? 5 : 0.3, 0.05, 0.05);
      (this.barBlue.material as THREE.MeshBasicMaterial).color.setRGB(0.05, 0.1, s && !ph ? 5 : 0.3);
    }
    if (this.flashT > 0) { this.flashT -= dt; this.material.userData.u.uFlash.value = Math.max(0, this.flashT * 4); }
  }
  /** Applies damage; deforms the body near the impact point (local space). Returns true when this destroyed it. */
  damage(amount: number, worldPoint?: THREE.Vector3, worldDir?: THREE.Vector3, by?: unknown): boolean {
    if (this.destroyed) return false;
    if (by !== undefined) this.lastDamagedBy = by;
    this.health -= amount;
    if (worldPoint && amount > 25) this.deform(worldPoint, worldDir, Math.min(1, amount / 300));
    const frac = this.health / this.spec.health;
    this.phys.enginePower = frac < 0.25 ? 0.6 : 1;
    if (this.health <= 0) { this.health = 0; this.destroyed = true; this.burnTime = 0.001; this.siren = false; this.material.userData.u.uBurn.value = 0.85; this.material.userData.u.uPaintOn.value = 0; return true; }
    return false;
  }
  private deform(worldPoint: THREE.Vector3, worldDir: THREE.Vector3 | undefined, severity: number) {
    if (!this.ownGeo) { this.bodyMesh.geometry = this.bodyMesh.geometry.clone(); this.ownGeo = true; }
    const g = this.bodyMesh.geometry; const pos = g.attributes.position as THREE.BufferAttribute;
    const inv = new THREE.Matrix4().copy(this.visual.matrixWorld).invert();
    const lp = worldPoint.clone().applyMatrix4(inv);
    const center = new THREE.Vector3(0, (this.tpl.bbox.min.y + this.tpl.bbox.max.y) / 2, 0);
    const dir = worldDir ? worldDir.clone().transformDirection(inv) : center.clone().sub(lp).normalize();
    // snap the impact point to the body surface along the direction from the centre
    const radius = 1.3, push = 0.28 * severity;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const d = Math.hypot(vx - lp.x, (vy - lp.y) * 1.4, vz - lp.z);
      if (d > radius) continue;
      const k = (1 - d / radius) ** 2 * push;
      pos.setXYZ(i, vx + dir.x * k + (Math.random() - 0.5) * k * 0.3, vy + dir.y * k * 0.5 - k * 0.15, vz + dir.z * k);
    }
    pos.needsUpdate = true; g.computeVertexNormals();
    if (lp.z > this.tpl.bbox.max.z - 0.8 && severity > 0.4) this.lightsBroken = true;
  }
  /** Restores the undamaged shared body (respray). */
  resetBody() {
    if (this.ownGeo) { this.bodyMesh.geometry.dispose(); this.ownGeo = false; }
    this.bodyMesh.geometry = this.tpl.body; this.lightsBroken = false;
  }
  private disposed = false;
  dispose() { if (this.disposed) return; this.disposed = true; this.phys.dispose(); this.group.removeFromParent(); if (this.ownGeo) this.bodyMesh.geometry.dispose(); this.material.dispose();
    this.phys.physics.untag(this.phys.collider);
    this.visual.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.shared && !(m as THREE.SkinnedMesh).isSkinnedMesh) { m.geometry.dispose(); const mat = m.material as THREE.Material; if (mat !== this.material && mat !== wheelMat) mat.dispose(); } });
    this.driver = null;
  }
}
