/** Builds Port Meridian's meshes and static colliders from the pure city layout. */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Physics } from '../core/physics';
import type { Assets, KayKitName } from './assets';
import {
  type CityMap, type Lot, AVENUES, STREETS, CURB_HEIGHT, SIDEWALK, LANE_WIDTH, COAST_Z, HARBOR_X, WATER_LEVEL, halfWidth,
} from './citymap';
import { bakeModel, ChunkInstancer, colorize, mergeColored, treeGeometry, palmGeometry } from './geometry';
import { asphaltTexture, pavementTexture, grassTexture, sandTexture, facadeMaterial, atlasVariant, atlasEmissive, kaykitMaterial, signAtlas, billboardAtlas, glowTexture, nightUniform, timeUniform, BRANDS } from '../render/materials';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface SignalHead { inter: number; axis: 'x' | 'z'; lamps: [number, number, number] }
export interface CityVisuals {
  root: THREE.Group;
  lampHeads: THREE.Vector3[];
  signalHeads: SignalHead[];
  signalLamps: THREE.InstancedMesh;
  chunkMeshes: THREE.Object3D[];
  ferris: THREE.Object3D | null;
  water: THREE.Mesh;
}

const BUILDINGS: KayKitName[] = ['building_A_withoutBase', 'building_B_withoutBase', 'building_C_withoutBase', 'building_D_withoutBase', 'building_E_withoutBase', 'building_F_withoutBase', 'building_G_withoutBase', 'building_H_withoutBase'];
const MIDRISE_COLORS = ['#b5654a', '#c9a27a', '#7f9c96', '#d9c7a7', '#a35a4a', '#8a7a6a', '#c48a5a'];
const TOWER_COLORS = ['#cfc6b8', '#9fb3b8', '#c2b29b', '#e2dbcf', '#8fa3a8', '#d2c1a6'];

/** Non-indexed geometry builder with metre-space UVs and per-vertex colour + facade parameters. */
class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; fac: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvs: number[], color: THREE.Color, facade: [number, number, number, number] = [0, 0, 1, 1]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const vs = [a, b, c, a, c, d];
    const us = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      this.pos.push(vs[i].x, vs[i].y, vs[i].z); this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[us[i] * 2], uvs[us[i] * 2 + 1]); this.col.push(color.r, color.g, color.b); this.fac.push(...facade);
    }
  }
  /** Axis-aligned box rotated by yaw around (cx,cz); facade applied to walls, roof gets style 0. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, color: THREE.Color, facade: [number, number, number, number], roofColor?: THREE.Color, uOffset = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, y: number, lz: number) => new THREE.Vector3(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
    const hw = w / 2, hd = d / 2;
    const corners = [P(-hw, 0, hd), P(hw, 0, hd), P(hw, 0, -hd), P(-hw, 0, -hd)];
    const lens = [w, d, w, d];
    let u = uOffset;
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const A = new THREE.Vector3(a.x, y0, a.z), B = new THREE.Vector3(b.x, y0, b.z), C = new THREE.Vector3(b.x, y1, b.z), D = new THREE.Vector3(a.x, y1, a.z);
      this.quad(A, B, C, D, [u, y0, u + lens[i], y0, u + lens[i], y1, u, y1], color, facade);
      u += lens[i];
    }
    const top = [P(-hw, 0, hd), P(hw, 0, hd), P(hw, 0, -hd), P(-hw, 0, -hd)].map(v => new THREE.Vector3(v.x, y1, v.z));
    this.quad(top[0], top[1], top[2], top[3], [0, 0, w, 0, w, d, 0, d], roofColor ?? color, [0, 0, 1, 1]);
  }
  build(withFacade = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withFacade) g.setAttribute('facade', new THREE.Float32BufferAttribute(this.fac, 4));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  get empty() { return this.pos.length === 0; }
}

function slab(gb: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, top: THREE.Color, side: THREE.Color, uvScale = 1) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  gb.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), [x0 / uvScale, z1 / uvScale, x1 / uvScale, z1 / uvScale, x1 / uvScale, z0 / uvScale, x0 / uvScale, z0 / uvScale], top);
  if (y1 - y0 > 0.001) {
    gb.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), [0, 0, 1, 0, 1, 0.05, 0, 0.05], side);
    gb.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), [0, 0, 1, 0, 1, 0.05, 0, 0.05], side);
    gb.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), [0, 0, 1, 0, 1, 0.05, 0, 0.05], side);
    gb.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), [0, 0, 1, 0, 1, 0.05, 0, 0.05], side);
  }
}

export function buildCity(scene: THREE.Scene, physics: Physics, assets: Assets, city: CityMap): CityVisuals {
  const root = new THREE.Group(); root.name = 'city'; scene.add(root);
  const C = (h: string) => new THREE.Color(h);
  const chunkMeshes: THREE.Object3D[] = [];
  const minX = AVENUES[0] - halfWidth(1) - 6, maxX = AVENUES[AVENUES.length - 1] + halfWidth(2) + 2;
  const minZ = STREETS[0] - halfWidth(1) - 6, maxZ = STREETS[STREETS.length - 1] + halfWidth(2) + 0.5;

  // ---------- Ground: grass land, asphalt, water ----------
  const grassTex = grassTexture(); grassTex.repeat.set(1, 1);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 });
  const land = new GeoBuilder();
  slab(land, -1400, -1400, maxX + 2, maxZ + 8, -0.05, -0.05, C('#ffffff'), C('#ffffff'), 6);
  slab(land, maxX, -1400, 1400, -70, -0.05, -0.05, C('#ffffff'), C('#ffffff'), 6);
  const landMesh = new THREE.Mesh(land.build(false), grassMat); landMesh.receiveShadow = true; root.add(landMesh);
  // Ground as 200 m tiles: one huge box loses contact precision for the character controller.
  for (let gx = -1500; gx < 1500; gx += 200) for (let gz = -1500; gz < 1500; gz += 200) physics.addStaticBox(gx + 100, -0.55, gz + 100, 100, 0.5, 100);

  const asphalt = asphaltTexture();
  const asphaltMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, color: '#ffffff' });
  const road = new GeoBuilder();
  slab(road, minX, minZ, maxX, maxZ, 0, 0, C('#ffffff'), C('#ffffff'), 9);
  const roadMesh = new THREE.Mesh(road.build(false), asphaltMat); roadMesh.receiveShadow = true; root.add(roadMesh);

  // Water with gentle animated waves and shoreline foam.
  const waterMat = new THREE.MeshStandardMaterial({ color: '#1f6f80', roughness: 0.28, metalness: 0.1, transparent: true, opacity: 0.94 });
  waterMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeUniform; sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime, uNight; varying vec3 vW;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // several non-aligned wave directions avoid stripe banding; fade the ripples with distance
        float fadeW = 1.0 - smoothstep(60.0, 420.0, length(vViewPosition));
        float w1 = sin(dot(vW.xz, vec2(0.19, 0.07)) + uTime * 1.1) + sin(dot(vW.xz, vec2(-0.05, 0.23)) - uTime * 0.9) + 0.5 * sin(dot(vW.xz, vec2(0.31, -0.27)) + uTime * 1.7) + 0.35 * sin(dot(vW.xz, vec2(-0.6, -0.41)) + uTime * 2.3);
        float w2 = cos(dot(vW.xz, vec2(0.29, -0.13)) - uTime * 1.3) + cos(dot(vW.xz, vec2(0.08, 0.31)) + uTime * 0.7) + 0.35 * cos(dot(vW.xz, vec2(0.52, 0.47)) - uTime * 2.1);
        normal = normalize(normal + vec3(w1 * 0.022, 0.0, w2 * 0.022) * fadeW);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float shoreS = smoothstep(${(COAST_Z + 8).toFixed(1)}, ${(COAST_Z - 2).toFixed(1)}, vW.z);
        float shoreE = smoothstep(${(HARBOR_X + 6).toFixed(1)}, ${(HARBOR_X).toFixed(1)}, vW.x) * step(-60.0, vW.z);
        float foamBand = max(shoreS, shoreE);
        float foam = foamBand * step(0.55, 0.5 + 0.5 * sin(vW.x * 0.6 + vW.z * 0.4 + uTime * 2.0 + foamBand * 9.0));
        float deep = smoothstep(0.0, 160.0, vW.z - ${COAST_Z.toFixed(1)});
        diffuseColor.rgb = mix(vec3(0.17, 0.55, 0.58), vec3(0.06, 0.24, 0.36), deep);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 0.95), foam * 0.75 + foamBand * 0.15);`);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), waterMat);
  water.position.y = WATER_LEVEL; water.receiveShadow = true; root.add(water);

  // ---------- Sidewalks / block slabs / lot interiors ----------
  const pave = pavementTexture();
  const paveMat = new THREE.MeshStandardMaterial({ map: pave, vertexColors: true, roughness: 0.88 });
  const walks = new GeoBuilder();
  const inner = new GeoBuilder();
  const grassInner = new GeoBuilder();
  for (const b of city.blocks) {
    const top = b.district === 'strand' ? C('#f1e2c9') : b.district === 'heights' ? C('#d9d4cc') : b.district === 'cannery' ? C('#b8b4ab') : C('#ffffff');
    slab(walks, b.x0, b.z0, b.x1, b.z1, 0, CURB_HEIGHT, top, C('#d0ccc4'), 3.2);
    physics.addStaticBox((b.x0 + b.x1) / 2, CURB_HEIGHT / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, CURB_HEIGHT / 2, (b.z1 - b.z0) / 2, 0, 0.8);
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    if (b.kind === 'park') slab(grassInner, ix0, iz0, ix1, iz1, CURB_HEIGHT + 0.01, CURB_HEIGHT + 0.01, C('#ffffff'), C('#ffffff'), 6);
    else if (b.district === 'hillside') slab(grassInner, ix0, iz0, ix1, iz1, CURB_HEIGHT + 0.01, CURB_HEIGHT + 0.01, C('#ffffff'), C('#ffffff'), 6);
    else if (b.kind === 'buildings' && b.district !== 'heights') slab(inner, ix0 + 10, iz0 + 10, ix1 - 10, iz1 - 10, CURB_HEIGHT + 0.01, CURB_HEIGHT + 0.01, C('#8d8a86'), C('#8d8a86'), 9);
  }
  // promenade along the coast and the dock quay
  slab(walks, minX, maxZ, maxX, maxZ + 7, 0, CURB_HEIGHT, C('#efdcc0'), C('#d0ccc4'), 3.2);
  physics.addStaticBox((minX + maxX) / 2, CURB_HEIGHT / 2, maxZ + 3.5, (maxX - minX) / 2, CURB_HEIGHT / 2, 3.5);
  slab(walks, maxX, -62, HARBOR_X, maxZ + 7, -3, CURB_HEIGHT, C('#bdb7ad'), C('#8d8780'), 3.2);
  physics.addStaticBox((maxX + HARBOR_X) / 2, (CURB_HEIGHT - 3) / 2, (maxZ + 7 - 62) / 2, (HARBOR_X - maxX) / 2, (CURB_HEIGHT + 3) / 2, (maxZ + 7 + 62) / 2);
  const walkMesh = new THREE.Mesh(walks.build(false), paveMat); walkMesh.receiveShadow = true; root.add(walkMesh);
  const innerMat = new THREE.MeshStandardMaterial({ map: asphalt, vertexColors: true, roughness: 0.9 });
  const innerMesh = new THREE.Mesh(inner.build(false), innerMat); innerMesh.receiveShadow = true; root.add(innerMesh);
  const gi = new THREE.Mesh(grassInner.build(false), grassMat); gi.receiveShadow = true; root.add(gi);

  // Beach: sloping sand from the promenade into the sea.
  const sand = sandTexture();
  const beachGeo = new THREE.PlaneGeometry(maxX - minX + 600, 90, 120, 18).rotateX(-Math.PI / 2);
  const bp = beachGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i) + (minX + maxX) / 2 - 300, z = bp.getZ(i) + maxZ + 7 + 45;
    const t = (z - (maxZ + 7)) / 90;
    const y = CURB_HEIGHT - 0.05 - t * 5.2 + Math.sin(x * 0.05) * 0.15 * t;
    bp.setXYZ(i, x, Math.min(y, CURB_HEIGHT - 0.02), z);
  }
  beachGeo.computeVertexNormals();
  const beach = new THREE.Mesh(beachGeo, new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }));
  (beach.material as THREE.MeshStandardMaterial).map!.repeat.set(60, 6);
  beach.receiveShadow = true; root.add(beach);
  // beach collider: an inclined slab
  {
    const len = 90, drop = 5.2, ang = Math.atan2(drop, len);
    const cz = maxZ + 7 + len / 2, cy = CURB_HEIGHT - 0.05 - drop / 2 - 0.5 / Math.cos(ang);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    physicsSlope(physics, (minX + maxX) / 2, cy, cz, (maxX - minX) / 2 + 300, 0.5, Math.hypot(len, drop) / 2, q);
  }

  // Hills to the north and west close the map visually.
  const hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const hillParts: THREE.BufferGeometry[] = [];
  const mkHill = (cx: number, cz: number, w: number, d: number, yaw: number, height: number, seed: number) => {
    const g = new THREE.PlaneGeometry(w, d, 40, 12).rotateX(-Math.PI / 2);
    const p = g.attributes.position; const r = new Rng(seed);
    const phase = r.range(0, 10);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i);
      const t = (lz + d / 2) / d; // 0 at city edge -> 1 far
      const h = Math.pow(1 - t, 0.9) * height * (0.65 + 0.35 * Math.sin(lx * 0.012 + phase) * Math.cos(lx * 0.031 + phase));
      p.setY(i, Math.max(0, h + r.range(-1.2, 1.2) * (1 - t)) - 0.2);
    }
    g.rotateY(yaw); g.translate(cx, 0, cz);
    const col = colorize(g, '#7d9a55', 0.12, r);
    const cp = col.attributes.position, cc = col.attributes.color;
    for (let i = 0; i < cp.count; i++) { const y = cp.getY(i); if (y > height * 0.55) { cc.setXYZ(i, 0.62, 0.58, 0.42); } }
    hillParts.push(col);
  };
  mkHill(0, minZ - 120, 1700, 220, Math.PI, 70, 1);
  mkHill(minX - 120, 0, 1500, 220, -Math.PI / 2, 60, 2);
  mkHill(maxX + 200, -280, 700, 400, Math.PI, 45, 3);
  const hills = new THREE.Mesh(mergeColored(hillParts), hillMat); hills.receiveShadow = true; root.add(hills);
  physics.addStaticBox(minX - 6, 6, 0, 1, 12, 900);
  physics.addStaticBox(0, 6, minZ - 6, 900, 12, 1);
  physics.addStaticBox(maxX + 60, 6, -66, 60, 12, 1);
  physics.addStaticBox(HARBOR_X + 1, 0.6, (-62 + maxZ + 7) / 2, 1, 0.8, (maxZ + 69) / 2); // low quay wall

  // ---------- Road markings ----------
  const mk = new GeoBuilder();
  const white = C('#e9e6dc'), yellow = C('#e8b84a');
  const Y = 0.012;
  const rect = (x0: number, z0: number, x1: number, z1: number, color: THREE.Color) => {
    const V = (x: number, z: number) => new THREE.Vector3(x, Y, z);
    mk.quad(V(Math.min(x0, x1), Math.max(z0, z1)), V(Math.max(x0, x1), Math.max(z0, z1)), V(Math.max(x0, x1), Math.min(z0, z1)), V(Math.min(x0, x1), Math.min(z0, z1)), [0, 0, 1, 0, 1, 1, 0, 1], color);
  };
  const along = (road: (typeof city.roads)[number], s0: number, s1: number, o0: number, o1: number, color: THREE.Color) => {
    if (road.axis === 'x') rect(s0, road.coord + o0, s1, road.coord + o1, color);
    else rect(road.coord + o0, s0, road.coord + o1, s1, color);
  };
  for (const r of city.roads) {
    const a = r.from, b = r.to, len = b - a;
    if (r.lanes === 2) { along(r, a + 4.5, b - 4.5, -0.22, -0.1, yellow); along(r, a + 4.5, b - 4.5, 0.1, 0.22, yellow); }
    else { for (let s = a + 6; s < b - 6; s += 6) along(r, s, Math.min(s + 3, b - 6), -0.07, 0.07, yellow); }
    if (r.lanes === 2) for (const sg of [-1, 1]) for (let s = a + 6; s < b - 6; s += 9) along(r, s, Math.min(s + 3.5, b - 6), sg * (0.2 + LANE_WIDTH) - 0.07, sg * (0.2 + LANE_WIDTH) + 0.07, white);
    for (const sg of [-1, 1]) along(r, a + 4.5, b - 4.5, sg * (r.half - 0.55) - 0.07, sg * (r.half - 0.55) + 0.07, white);
    // stop lines (right side of each direction) and zebra crossings at both ends
    const span = r.lanes * LANE_WIDTH + 0.2;
    along(r, b - 4.6, b - 4.15, 0.2, span, white); // traffic heading +axis travels on +offset side
    along(r, a + 4.15, a + 4.6, -span, -0.2, white);
    for (const end of [a, b]) {
      const s0 = end === a ? a + 0.7 : b - 3.7;
      for (let o = -r.half + 0.6; o < r.half - 0.6; o += 1.2) along(r, s0, s0 + 3, o, o + 0.6, white);
    }
    void len;
  }
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // parking bays along the long edges of courtyard lots
  for (const b of city.blocks) {
    if (b.kind !== 'buildings' || b.district === 'heights' || b.district === 'hillside') continue;
    const x0 = b.x0 + SIDEWALK + 10, x1 = b.x1 - SIDEWALK - 10, z0 = b.z0 + SIDEWALK + 10, z1 = b.z1 - SIDEWALK - 10;
    const yy = CURB_HEIGHT + 0.025;
    const V = (x: number, z: number) => new THREE.Vector3(x, yy, z);
    const line = (ax: number, az: number, bx: number, bz: number, wdt = 0.12) => { const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * wdt / 2, nz = dx / l * wdt / 2; mk.quad(V(ax - nx, az - nz), V(bx - nx, bz - nz), V(bx + nx, bz + nz), V(ax + nx, az + nz), [0, 0, 1, 0, 1, 1, 0, 1], white); };
    for (let x = x0 + 2; x <= x1 - 2; x += 3) { line(x, z0 + 0.3, x, z0 + 5.3); line(x, z1 - 5.3, x, z1 - 0.3); }
    line(x0 + 2, z0 + 5.3, x1 - 2 - ((x1 - x0 - 4) % 3), z0 + 5.3); line(x0 + 2, z1 - 5.3, x1 - 2 - ((x1 - x0 - 4) % 3), z1 - 5.3);
  }
  const marks = new THREE.Mesh(mk.build(false), markMat); marks.receiveShadow = true; root.add(marks);

  // ---------- Buildings ----------
  const inst = new ChunkInstancer(125);
  const props = new ChunkInstancer(300);
  const atlas = assets.atlas;
  const emis = atlasEmissive(atlas);
  const palettes = { original: kaykitMaterial(atlas, emis), pastel: kaykitMaterial(atlasVariant(atlas, 'pastel'), emis), muted: kaykitMaterial(atlasVariant(atlas, 'muted'), emis) };
  const propMat = kaykitMaterial(atlas, null);
  const baked = new Map<KayKitName, THREE.BufferGeometry>();
  const bake = (n: KayKitName) => { let g = baked.get(n); if (!g) { g = bakeModel(assets.kaykit[n]); baked.set(n, g); } return g; };
  for (const n of BUILDINGS) for (const [pk, pm] of Object.entries(palettes)) inst.register(`${n}:${pk}`, bake(n), pm);

  const facade = facadeMaterial();
  const towersByChunk = new Map<string, GeoBuilder>();
  const towerGB = (x: number, z: number) => { const k = `${Math.floor(x / 125)},${Math.floor(z / 125)}`; let g = towersByChunk.get(k); if (!g) { g = new GeoBuilder(); towersByChunk.set(k, g); } return g; };
  const signs: { x: number; y: number; z: number; yaw: number; idx: number; w: number }[] = [];
  const billboards: { x: number; y: number; z: number; yaw: number; idx: number }[] = [];
  const rooftop: { x: number; y: number; z: number; s: number }[] = [];

  const placeKayKit = (lot: Lot, palette: keyof typeof palettes) => {
    const r = new Rng(lot.seed);
    const name = BUILDINGS[r.int(0, BUILDINGS.length - 1)];
    const geo = bake(name); const bb = geo.boundingBox!;
    const cxL = -(bb.min.x + bb.max.x) / 2, czL = lot.d / 2 - bb.max.z - 0.3;
    const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
    const wx = lot.x + cxL * c + czL * s, wz = lot.z - cxL * s + czL * c;
    inst.add(`${name}:${palette}`, wx, CURB_HEIGHT - bb.min.y - 0.02, wz, lot.rot);
    const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y;
    const ccx = wx + ((bb.min.x + bb.max.x) / 2) * c + ((bb.min.z + bb.max.z) / 2) * s;
    const ccz = wz - ((bb.min.x + bb.max.x) / 2) * s + ((bb.min.z + bb.max.z) / 2) * c;
    physics.addStaticBox(ccx, h / 2, ccz, w / 2 * 0.96, h / 2, d / 2 * 0.96, lot.rot);
    {
      // KayKit backs are bare: dress them with a windowed back facade so courtyards don't look unfinished.
      const backOff = (bb.min.z + bb.max.z) / 2 - bb.min.z + 0.04; // from centre to just behind the back wall
      const bx = ccx - backOff * s, bz = ccz - backOff * c;
      const gbk = towerGB(bx, bz);
      gbk.box(bx, bz, w * 0.94, 0.08, CURB_HEIGHT + 0.2, CURB_HEIGHT + h * 0.86, lot.rot, C(r.pick(['#8c5a46', '#6f7a78', '#9a7b5f', '#5f6b7a'])), [2, lot.seed % 991, 2.4, 3.3], C('#6f6c66'));
    }
    if (r.chance(0.18)) rooftop.push({ x: ccx + r.range(-1.5, 1.5), y: h + CURB_HEIGHT - 0.7, z: ccz + r.range(-1.5, 1.5), s: r.range(0.9, 1.1) });
  };
  const placeMidrise = (lot: Lot) => {
    const r = new Rng(lot.seed);
    const floors = r.int(3, 6), fh = 3.4, h = floors * fh + 0.6;
    const w = lot.w - 0.6, d = lot.d - 0.5;
    const ox = 0, oz = 0;
    const gb = towerGB(lot.x, lot.z);
    const col = C(r.pick(MIDRISE_COLORS));
    gb.box(lot.x + ox, lot.z + oz, w, d, CURB_HEIGHT, h, lot.rot, col, [2, r.int(0, 999), 2.6, fh], C('#7d7a74'), r.range(0, 5));
    gb.box(lot.x, lot.z, w + 0.5, d + 0.5, h, h + 0.6, lot.rot, col.clone().multiplyScalar(1.15), [0, 0, 1, 1], C('#6f6c66'));
    physics.addStaticBox(lot.x, h / 2, lot.z, w / 2, h / 2, d / 2, lot.rot);
    if (r.chance(0.35)) {
      const fz = d / 2 + 0.12; const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      signs.push({ x: lot.x + fz * s, y: 4.0, z: lot.z + fz * c, yaw: lot.rot, idx: r.int(0, BRANDS.length - 1), w: 6.5 });
    }
  };
  const placeTower = (lot: Lot) => {
    const r = new Rng(lot.seed);
    const gb = towerGB(lot.x, lot.z);
    const col = C(r.pick(TOWER_COLORS));
    const style: 1 | 2 = r.chance(0.65) ? 1 : 2;
    const podium = 7.6;
    gb.box(lot.x, lot.z, lot.w, lot.d, CURB_HEIGHT, podium, 0, col.clone().multiplyScalar(0.85), [style, lot.seed % 997, 3.4, 3.8], C('#6d6a66'));
    const sh = lot.height; const inset = r.range(0.5, 2);
    const setback = r.chance(0.5) ? sh * r.range(0.6, 0.78) : sh;
    gb.box(lot.x, lot.z, lot.w - inset * 2, lot.d - inset * 2, podium, setback, 0, col, [style, lot.seed % 991, 3.2, 3.6], C('#77736d'), 0.37);
    let topW = lot.w - inset * 2, topD = lot.d - inset * 2, topY = setback;
    if (setback < sh) { topW *= 0.72; topD *= 0.72; gb.box(lot.x, lot.z, topW, topD, setback, sh, 0, col.clone().multiplyScalar(1.05), [style, lot.seed % 983, 3.2, 3.6], C('#77736d'), 0.73); topY = sh; }
    gb.box(lot.x, lot.z, topW + 0.4, topD + 0.4, topY, topY + 1.1, 0, col.clone().multiplyScalar(0.9), [0, 0, 1, 1], C('#5f5c58'));
    for (let k = 0; k < r.int(1, 3); k++) gb.box(lot.x + r.range(-topW / 4, topW / 4), lot.z + r.range(-topD / 4, topD / 4), r.range(2, 4), r.range(2, 4), topY + 1.1, topY + r.range(2.2, 3.4), 0, C('#a9a59e'), [0, 0, 1, 1]);
    physics.addStaticBox(lot.x, sh / 2, lot.z, lot.w / 2, sh / 2, lot.d / 2);
    if (r.chance(0.3) && topW > 10) billboards.push({ x: lot.x, y: topY + 1.1, z: lot.z, yaw: r.int(0, 3) * Math.PI / 2, idx: r.int(0, 3) });
  };
  for (const lot of city.lots) {
    const b = city.blocks[lot.blockId];
    if (lot.kind === 'tower') placeTower(lot);
    else if (lot.kind === 'midrise') placeMidrise(lot);
    else placeKayKit(lot, lot.kind === 'pastel' ? 'pastel' : b.district === 'midtown' ? 'muted' : 'original');
  }

  // ---------- Docks: warehouses, containers, cranes ----------
  const containerColors = ['#c0452f', '#2f6f8f', '#d89a2b', '#3f7f5a', '#7a3f6f', '#d0d0c8'];
  for (const b of city.blocks.filter(bb => bb.kind === 'docks')) {
    const r = new Rng(b.id * 77);
    const gb = towerGB((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    const ix0 = b.x0 + SIDEWALK + 2, ix1 = b.x1 - SIDEWALK - 2, iz0 = b.z0 + SIDEWALK + 2, iz1 = b.z1 - SIDEWALK - 2;
    const wh = r.chance(0.6);
    if (wh) {
      const w = ix1 - ix0, d = (iz1 - iz0) * 0.55, h = r.range(9, 13);
      const cz = iz0 + d / 2, cx = (ix0 + ix1) / 2;
      gb.box(cx, cz, w, d, CURB_HEIGHT, h, 0, C(r.pick(['#8f9a9c', '#b7a48a', '#7f8f84'])), [3, b.id, 4.5, 3.5], C('#6f6f6a'));
      physics.addStaticBox(cx, h / 2, cz, w / 2, h / 2, d / 2);
    }
    const startZ = wh ? iz0 + (iz1 - iz0) * 0.6 : iz0;
    let row = 0;
    for (let z = startZ + 2; z < iz1 - 3; z += (row++ % 2 === 0 ? 2.75 : 7.5)) for (let x = ix0 + 7; x < ix1 - 6; x += 17) {
      if (r.chance(0.3)) continue;
      const stack = r.int(1, 3);
      for (let k = 0; k < stack; k++) gb.box(x, z, 12.2, 2.6, CURB_HEIGHT + k * 2.6, CURB_HEIGHT + (k + 1) * 2.6, 0, C(r.pick(containerColors)), [3, 1, 2.4, 2.6]);
      physics.addStaticBox(x, CURB_HEIGHT + stack * 1.3, z, 6.1, stack * 1.3, 1.3);
    }
  }
  // Gantry cranes along the quay
  for (const cz of [40, 150, 290]) {
    const gb = towerGB(475, cz);
    const col = C('#d9772b'), x = 476;
    for (const dx of [-7, 7]) for (const dz of [-6, 6]) { gb.box(x + dx, cz + dz, 1.2, 1.2, CURB_HEIGHT, 34, 0, col, [0, 0, 1, 1]); physics.addStaticBox(x + dx, 17, cz + dz, 0.6, 17, 0.6); }
    gb.box(x, cz, 16, 13.5, 32, 35, 0, col, [0, 0, 1, 1]);
    gb.box(x + 22, cz, 66, 2.4, 33, 35, 0, col, [0, 0, 1, 1]);
    gb.box(x - 2, cz, 6, 5, 35, 39, 0, C('#e8e2d0'), [2, 3, 2, 2]);
  }

  // Build facade meshes per chunk
  for (const [, gb] of towersByChunk) {
    const m = new THREE.Mesh(gb.build(true), facade); m.castShadow = true; m.receiveShadow = true; root.add(m); chunkMeshes.push(m);
  }

  // ---------- Signs and billboards ----------
  const signTex = signAtlas();
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.25, roughness: 0.6 });
  signMat.onBeforeCompile = sh => { sh.uniforms.uNight = nightUniform; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.15 + uNight * 4.0;'); };
  const sg: THREE.BufferGeometry[] = [];
  for (const s of signs) {
    const g = new THREE.PlaneGeometry(s.w, s.w * 0.25);
    const u = (s.idx % 4) / 4, v = 1 - (Math.floor(s.idx / 4) + 1) / 4;
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u + uv.getX(i) * 0.25, v + uv.getY(i) * 0.25);
    g.rotateY(s.yaw); g.translate(s.x, s.y, s.z); sg.push(g);
  }
  // shop signs on KayKit storefronts too
  if (sg.length) { const sm = new THREE.Mesh(mergeGeometries(sg)!, signMat); root.add(sm); }
  const bbTex = billboardAtlas();
  const bbMat = new THREE.MeshStandardMaterial({ map: bbTex, emissiveMap: bbTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.1, roughness: 0.5 });
  bbMat.onBeforeCompile = signMat.onBeforeCompile;
  const bg: THREE.BufferGeometry[] = []; const frame = new GeoBuilder();
  for (const b of billboards) {
    const g = new THREE.PlaneGeometry(12, 6);
    const u = (b.idx % 2) / 2, v = 1 - (Math.floor(b.idx / 2) + 1) / 2;
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u + uv.getX(i) * 0.5, v + uv.getY(i) * 0.5);
    g.rotateY(b.yaw); g.translate(b.x + Math.sin(b.yaw) * 0.2, b.y + 6, b.z + Math.cos(b.yaw) * 0.2); bg.push(g);
    frame.box(b.x, b.z, 12.4, 0.3, b.y + 2.6, b.y + 9.2, b.yaw, C('#3a3a3a'), [0, 0, 1, 1]);
    for (const dx of [-4, 4]) frame.box(b.x - Math.cos(b.yaw) * dx, b.z + Math.sin(b.yaw) * dx, 0.4, 0.4, b.y, b.y + 3, b.yaw, C('#2e2e2e'), [0, 0, 1, 1]);
  }
  if (bg.length) { root.add(new THREE.Mesh(mergeGeometries(bg)!, bbMat)); const fm = new THREE.Mesh(frame.build(true), facade); fm.castShadow = true; root.add(fm); }

  // ---------- Street furniture ----------
  props.register('streetlight', bake('streetlight'), propMat);
  props.register('trafficlight', bake('trafficlight_A'), propMat);
  props.register('hydrant', bake('firehydrant'), propMat);
  props.register('bench', bake('bench'), propMat);
  props.register('trash', bake('trash_A'), propMat);
  props.register('dumpster', bake('dumpster'), propMat);
  props.register('bush', bake('bush'), propMat);
  props.register('watertower', bake('watertower'), propMat);
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  for (let t = 0; t < 3; t++) props.register(`tree${t}`, treeGeometry(100 + t), vcMat);
  for (let t = 0; t < 3; t++) props.register(`palm${t}`, palmGeometry(200 + t), vcMat);
  for (const r of rooftop) props.add('watertower', r.x, r.y, r.z, 0, 0.55 * r.s);

  const lampHeads: THREE.Vector3[] = [];
  const lampBB = bake('streetlight').boundingBox!;
  const armReach = -lampBB.min.x - 0.3, lampY = lampBB.max.y - 0.25;
  for (const r of city.roads) {
    const len = r.to - r.from;
    const n = Math.max(1, Math.round(len / 30));
    for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
      const s = r.from + (len / n) * (k + 0.5) + (side > 0 ? 7 : -7);
      if (s < r.from + 6 || s > r.to - 6) continue;
      const off = side * (r.half + 0.8);
      const x = r.axis === 'x' ? s : r.coord + off, z = r.axis === 'x' ? r.coord + off : s;
      const dx = r.axis === 'x' ? 0 : -side, dz = r.axis === 'x' ? -side : 0;
      const yaw = Math.atan2(dz, -dx);
      props.add('streetlight', x, CURB_HEIGHT, z, yaw);
      physics.addStaticCylinder(x, 2.5, z, 2.5, 0.14);
      lampHeads.push(new THREE.Vector3(x + dx * armReach, lampY, z + dz * armReach));
    }
  }
  // Traffic lights: one per approach on the near-right corner, facing oncoming traffic.
  const signalHeads: SignalHead[] = [];
  const tlBB = bake('trafficlight_A').boundingBox!;
  const lampPositions: THREE.Vector3[] = [];
  for (const inter of city.intersections) {
    if (!inter.signalized) continue;
    const approaches: { axis: 'x' | 'z'; dx: number; dz: number }[] = [{ axis: 'z', dx: 0, dz: -1 }, { axis: 'z', dx: 0, dz: 1 }, { axis: 'x', dx: 1, dz: 0 }, { axis: 'x', dx: -1, dz: 0 }];
    for (const ap of approaches) {
      // vehicles travel in (dx,dz); their right is (-dz, dx). Corner is behind the stop line on the right.
      const rx = -ap.dz, rz = ap.dx;
      const along = ap.axis === 'z' ? inter.halfZ : inter.halfX;
      const across = ap.axis === 'z' ? inter.halfX : inter.halfZ;
      const exists = ap.axis === 'z' ? city.intersectionAt(inter.ix, inter.iz - ap.dz) : city.intersectionAt(inter.ix - ap.dx, inter.iz);
      if (!exists) continue;
      const x = inter.x - ap.dx * (along + 1.2) + rx * (across + 1.0);
      const z = inter.z - ap.dz * (along + 1.2) + rz * (across + 1.0);
      const yaw = Math.atan2(-ap.dx, -ap.dz); // model front (+z) faces oncoming traffic
      props.add('trafficlight', x, CURB_HEIGHT, z, yaw);
      physics.addStaticCylinder(x, 2, z, 2, 0.15);
      const head: SignalHead = { inter: inter.id, axis: ap.axis, lamps: [0, 0, 0] };
      const fx = -ap.dx, fz = -ap.dz;
      const top = tlBB.max.y + CURB_HEIGHT;
      for (let k = 0; k < 3; k++) {
        head.lamps[k] = lampPositions.length;
        lampPositions.push(new THREE.Vector3(x + fx * (tlBB.max.z + 0.02), top - 0.32 - k * 0.36, z + fz * (tlBB.max.z + 0.02)));
      }
      signalHeads.push(head);
    }
  }
  const lampGeo = new THREE.CircleGeometry(0.13, 10);
  const signalLamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), lampPositions.length);
  const dummy = new THREE.Object3D();
  signalHeads.forEach(h => h.lamps.forEach((li) => {
    const p = lampPositions[li]; dummy.position.copy(p);
    const inter = city.intersections[h.inter];
    dummy.lookAt(p.x + (p.x - inter.x) * 10, p.y, p.z + (p.z - inter.z) * 10);
    dummy.updateMatrix(); signalLamps.setMatrixAt(li, dummy.matrix); signalLamps.setColorAt(li, new THREE.Color(0.1, 0.1, 0.1));
  }));
  signalLamps.frustumCulled = false; root.add(signalLamps);

  // Sidewalk furniture and greenery by district.
  for (const lot of city.lots) {
    if (lot.kind === 'tower') continue;
    const r = new Rng(lot.seed + 5);
    const b = city.blocks[lot.blockId];
    const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
    const front = lot.d / 2 + 1.6;
    const at = (lateral: number, f: number) => ({ x: lot.x + lateral * c + f * s, z: lot.z - lateral * s + f * c });
    const roll = r.next();
    if (b.district === 'strand' && roll < 0.45) { const p = at(r.range(-3, 3), front + 1.2); props.add(`palm${r.int(0, 2)}`, p.x, CURB_HEIGHT, p.z, r.range(0, 6.28)); physics.addStaticCylinder(p.x, 2, p.z, 2, 0.25); }
    else if ((b.district === 'brickline' || b.district === 'midtown') && roll < 0.22) { const p = at(r.range(-3, 3), front + 1.5); props.add(`tree${r.int(0, 2)}`, p.x, CURB_HEIGHT, p.z, r.range(0, 6.28), r.range(0.75, 0.95)); physics.addStaticCylinder(p.x, 2, p.z, 2, 0.25); }
    else if (roll < 0.34) { const p = at(r.range(-3, 3), front); props.add('hydrant', p.x, CURB_HEIGHT, p.z, lot.rot); physics.addStaticCylinder(p.x, 0.5, p.z, 0.5, 0.25); }
    else if (roll < 0.46) { const p = at(r.range(-2, 2), front - 0.6); props.add('bench', p.x, CURB_HEIGHT, p.z, lot.rot + Math.PI); physics.addStaticBox(p.x, 0.5, p.z, 1, 0.5, 0.4, lot.rot); }
    else if (roll < 0.56) { const p = at(r.range(-3, 3), front - 0.4); props.add('trash', p.x, CURB_HEIGHT, p.z, r.range(0, 6)); physics.addStaticCylinder(p.x, 0.5, p.z, 0.5, 0.35); }
    if (b.district === 'hillside' && r.chance(0.6)) { const p = at(r.range(-3.5, 3.5), -lot.d / 2 - 4); props.add(`tree${r.int(0, 2)}`, p.x, CURB_HEIGHT, p.z, r.range(0, 6.28), r.range(0.8, 1.15)); physics.addStaticCylinder(p.x, 2, p.z, 2, 0.25); }
    if (r.chance(0.08) && b.district !== 'hillside') { const p = at(r.range(-3, 3), -lot.d / 2 - 2.5); props.add('dumpster', p.x, CURB_HEIGHT, p.z, lot.rot); physics.addStaticBox(p.x, 0.8, p.z, 1.4, 0.8, 0.9, lot.rot); }
  }
  // Parks and plazas
  for (const b of city.blocks) {
    const r = new Rng(b.id * 31 + 7);
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    if (b.kind === 'park') {
      for (let i = 0; i < 46; i++) {
        const x = r.range(ix0 + 3, ix1 - 3), z = r.range(iz0 + 3, iz1 - 3);
        if (Math.abs(x - (ix0 + ix1) / 2) < 5 || Math.abs(z - (iz0 + iz1) / 2) < 5) continue;
        props.add(`tree${r.int(0, 2)}`, x, CURB_HEIGHT, z, r.range(0, 6.28), r.range(0.9, 1.4));
        physics.addStaticCylinder(x, 2, z, 2, 0.3);
      }
      for (let i = 0; i < 10; i++) { const x = r.range(ix0 + 4, ix1 - 4); props.add('bench', x, CURB_HEIGHT, (iz0 + iz1) / 2 + 3.6, 0); physics.addStaticBox(x, 0.5, (iz0 + iz1) / 2 + 3.6, 1, 0.5, 0.4); }
      for (let i = 0; i < 18; i++) props.add('bush', r.range(ix0 + 2, ix1 - 2), CURB_HEIGHT, r.range(iz0 + 2, iz1 - 2), r.range(0, 6), r.range(0.8, 1.3));
    } else if (b.kind === 'plaza' || b.district === 'heights') {
      for (let i = 0; i < (b.kind === 'plaza' ? 14 : 4); i++) {
        const x = r.range(ix0 + 4, ix1 - 4), z = r.range(iz0 + 4, iz1 - 4);
        if (city.lots.some(l => l.blockId === b.id && Math.abs(l.x - x) < l.w / 2 + 3 && Math.abs(l.z - z) < l.d / 2 + 3)) continue;
        props.add(`tree${r.int(0, 2)}`, x, CURB_HEIGHT, z, r.range(0, 6.28), 1.1); physics.addStaticCylinder(x, 2, z, 2, 0.3);
      }
    } else if (b.district === 'strand') {
      // beach palms along the promenade
    }
  }
  for (let x = minX + 12; x < maxX - 8; x += 26) { const z = maxZ + 12 + Math.sin(x) * 3; props.add(`palm${Math.abs(Math.round(x)) % 3}`, x, CURB_HEIGHT - 0.3 - (z - maxZ - 7) * 0.058, z, x); }

  // Visible city edge: guardrail along the boundary walls with a tree line beyond.
  {
    const rail = new GeoBuilder();
    const railC = C('#d8d2c4'), postC = C('#5e5a55');
    const edgeX = minX - 5.2, edgeZ = minZ - 5.2;
    for (let z = edgeZ; z < maxZ + 7; z += 3) rail.box(edgeX, z, 0.18, 0.18, 0, 0.9, 0, postC, [0, 0, 1, 1]);
    rail.box(edgeX + 0.1, (edgeZ + maxZ + 7) / 2, 0.1, maxZ + 7 - edgeZ, 0.55, 0.85, 0, railC, [0, 0, 1, 1]);
    for (let x = edgeX; x < maxX + 2; x += 3) rail.box(x, edgeZ, 0.18, 0.18, 0, 0.9, 0, postC, [0, 0, 1, 1]);
    rail.box((edgeX + maxX + 2) / 2, edgeZ + 0.1, maxX + 2 - edgeX, 0.1, 0.55, 0.85, 0, railC, [0, 0, 1, 1]);
    const rm = new THREE.Mesh(rail.build(true), facade); rm.castShadow = true; rm.receiveShadow = true; root.add(rm);
    const tr = new Rng(77);
    for (let z = edgeZ + 4; z < maxZ; z += tr.range(5, 9)) props.add(`tree${tr.int(0, 2)}`, edgeX - tr.range(6, 22), 0, z, tr.range(0, 6.28), tr.range(1.1, 1.7));
    for (let x = edgeX + 4; x < maxX; x += tr.range(5, 9)) props.add(`tree${tr.int(0, 2)}`, x, 0, edgeZ - tr.range(6, 22), tr.range(0, 6.28), tr.range(1.1, 1.7));
  }
  chunkMeshes.push(...inst.build(root));
  for (const m of props.build(root)) { m.userData.small = true; chunkMeshes.push(m); }

  // ---------- Pier and Ferris wheel landmark ----------
  const ferris = buildPier(root, physics, facade, maxZ + 7);

  return { root, lampHeads, signalHeads, signalLamps, chunkMeshes, ferris, water };
}

function physicsSlope(physics: Physics, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, q: THREE.Quaternion) {
  const c = physics.addStaticBox(cx, cy, cz, hx, hy, hz);
  c.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
}

function buildPier(root: THREE.Group, physics: Physics, facade: THREE.Material, startZ: number): THREE.Object3D {
  const gb = new GeoBuilder();
  const x = -50, w = 16, len = 150, deckY = 1.2;
  const wood = new THREE.Color('#9a7656');
  gb.box(x, startZ + len / 2, w, len, deckY - 0.5, deckY, 0, wood, [0, 0, 1, 1], new THREE.Color('#a8825f'));
  physics.addStaticBox(x, deckY - 0.25, startZ + len / 2, w / 2, 0.25, len / 2);
  // ramp across the promenade up to the deck (rises towards +z)
  const rampLen = 7, rampZ0 = startZ - rampLen, rise = deckY - CURB_HEIGHT;
  const rampAng = Math.atan2(rise, rampLen), rampHyp = Math.hypot(rampLen, rise);
  const ramp = physics.addStaticBox(x, (CURB_HEIGHT + deckY) / 2 - 0.25 / Math.cos(rampAng), rampZ0 + rampLen / 2, w / 2, 0.25, rampHyp / 2 + 0.05);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -rampAng);
  ramp.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  for (let z = startZ + 4; z < startZ + len; z += 8) for (const dx of [-w / 2 + 0.5, w / 2 - 0.5]) gb.box(x + dx, z, 0.6, 0.6, -4, deckY - 0.5, 0, new THREE.Color('#5d4632'), [0, 0, 1, 1]);
  const railCol = new THREE.Color('#ece4d4');
  for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) {
    gb.box(x + dx, startZ + len / 2 + 2, 0.12, len - 4, deckY + 0.98, deckY + 1.08, 0, railCol, [0, 0, 1, 1]);
    gb.box(x + dx, startZ + len / 2 + 2, 0.06, len - 4, deckY + 0.5, deckY + 0.56, 0, railCol, [0, 0, 1, 1]);
    for (let z = startZ + 2; z <= startZ + len - 0.2; z += 2.5) gb.box(x + dx, z, 0.12, 0.12, deckY, deckY + 1.08, 0, railCol, [0, 0, 1, 1]);
    physics.addStaticBox(x + dx, deckY + 0.5, startZ + len / 2 + 2, 0.1, 0.55, (len - 4) / 2);
  }
  gb.box(x, startZ + len - 0.15, w, 0.12, deckY + 0.98, deckY + 1.08, 0, railCol, [0, 0, 1, 1]);
  for (let xx = x - w / 2 + 0.15; xx <= x + w / 2; xx += 2.5) gb.box(xx, startZ + len - 0.15, 0.12, 0.12, deckY, deckY + 1.08, 0, railCol, [0, 0, 1, 1]);
  physics.addStaticBox(x, deckY + 0.5, startZ + len - 0.15, w / 2, 0.55, 0.1);
  // food kiosk on the pier
  gb.box(x - 3, startZ + 40, 6, 5, deckY, deckY + 3.2, 0, new THREE.Color('#2f8f8a'), [2, 5, 2.8, 3.2], new THREE.Color('#e9d9b8'));
  physics.addStaticBox(x - 3, deckY + 1.6, startZ + 40, 3, 1.6, 2.5);
  const pier = new THREE.Mesh(gb.build(true), facade); pier.castShadow = true; pier.receiveShadow = true; root.add(pier);
  // plank deck surface
  const pc = document.createElement('canvas'); pc.width = 256; pc.height = 256; const g2 = pc.getContext('2d')!;
  for (let i = 0; i < 16; i++) { const v = 150 + ((i * 37) % 23) - 11; g2.fillStyle = `rgb(${v},${Math.round(v * 0.76)},${Math.round(v * 0.55)})`; g2.fillRect(0, i * 16, 256, 15); g2.fillStyle = 'rgba(40,25,15,0.55)'; g2.fillRect(0, i * 16 + 15, 256, 1); g2.fillRect((i * 97) % 256, i * 16, 1, 15); }
  for (let i = 0; i < 400; i++) { g2.fillStyle = `rgba(60,40,25,${0.05 + (i % 5) * 0.02})`; g2.fillRect((i * 53) % 256, (i * 29) % 256, 6 + (i % 9), 1); }
  const ptex = new THREE.CanvasTexture(pc); ptex.wrapS = ptex.wrapT = THREE.RepeatWrapping; ptex.colorSpace = THREE.SRGBColorSpace; ptex.repeat.set(w / 4, len / 4); ptex.anisotropy = 8;
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.85 }));
  deck.position.set(x, deckY + 0.006, startZ + len / 2); deck.receiveShadow = true; root.add(deck);
  const rampMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, rampHyp).rotateX(-Math.PI / 2), deck.material);
  rampMesh.position.set(x, (CURB_HEIGHT + deckY) / 2 + 0.01, rampZ0 + rampLen / 2); rampMesh.rotation.x = -rampAng; rampMesh.receiveShadow = true; root.add(rampMesh);
  const rampSides = new GeoBuilder();
  for (const sx of [-1, 1]) rampSides.box(x + sx * (w / 2 - 0.1), rampZ0 + rampLen / 2, 0.2, rampLen, 0, deckY * 0.6, 0, new THREE.Color('#7a5c40'), [0, 0, 1, 1]);
  root.add(new THREE.Mesh(rampSides.build(true), facade));
  rampMesh.rotation.x = 0; rampMesh.position.set(x, (deckY + CURB_HEIGHT) / 2 + 0.01, startZ - 2); rampMesh.rotateX(-Math.atan2(deckY - CURB_HEIGHT, 12)); rampMesh.receiveShadow = true; root.add(rampMesh);
  // Ferris wheel
  const wheel = new THREE.Group();
  const radius = 22, cy = deckY + radius + 3, cz = startZ + len - 26;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.35, 6, 64), new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.5, metalness: 0.3, emissive: new THREE.Color('#ff9a6a'), emissiveIntensity: 0 }));
  const ring2 = ring.clone(); ring.position.z = -1.6; ring2.position.z = 1.6;
  wheel.add(ring, ring2);
  const spokeMat = new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.6 });
  const gondMat = new THREE.MeshStandardMaterial({ color: '#e05a4f', roughness: 0.6 });
  const gondolas: THREE.Object3D[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, radius, 0.2), spokeMat);
    spoke.position.set(Math.cos(a) * radius / 2, Math.sin(a) * radius / 2, 0); spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
    const g = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 2.2, 8), i % 2 ? gondMat : new THREE.MeshStandardMaterial({ color: '#2f8f9a', roughness: 0.6 }));
    g.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0); g.userData.angle = a;
    wheel.add(g); gondolas.push(g);
  }
  wheel.position.set(x + 2, cy, cz);
  const supportMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.6 });
  for (const s of [-1, 1]) for (const dz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, cy - deckY + 1, 8), supportMat);
    leg.position.set(x + 2 + dz * 6.2, (cy + deckY) / 2, cz + s * 3); leg.rotation.z = dz * 0.26; leg.rotation.x = s * 0.06; leg.castShadow = true; root.add(leg);
    physics.addStaticCylinder(x + 2 + dz * 6.2 * 1.5, deckY + 2, cz + s * 3, 2, 0.6);
  }
  wheel.traverse(o => { o.castShadow = true; });
  wheel.userData.gondolas = gondolas; wheel.userData.ringMat = ring.material;
  root.add(wheel);
  void glowTexture;
  return wheel;
}
