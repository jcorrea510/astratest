/** Builds Port Meridian's meshes and static colliders from the pure city layout. */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { RAMPS, HELIPADS, GAS_STATION, POLICE_STATION, storeAt, STORE_H } from '../game/places';
import { buildTerrain, makeTerrainHeight, NORTH_EDGE } from './terrain';
import { buildExpansion, expansionPads, helipadPad } from './expansion';
import { CHANNEL, pathHeightAt } from './citymap';
import type { Physics } from '../core/physics';
import type { Assets } from './assets';
import {
  type CityMap, type Lot, type Block, AVENUES, STREETS, CURB_HEIGHT, SIDEWALK, LANE_WIDTH, COAST_Z, HARBOR_X, WATER_LEVEL, SEABED_Y, SEA_EDGE_X, SEA_EDGE_Z, halfWidth,
} from './citymap';
import { ChunkInstancer, colorize, mergeColored } from './geometry';
import {
  asphaltSurface, pavementSurface, grassSurface, sandSurface, buildingMaterial, trimMaterial, signAtlas, billboardAtlas, paintWearTexture, leafTexture, addMacroVariation,
  nightUniform, timeUniform, BRANDS, type Surface,
} from '../render/materials';
import { Chunked, FacadeBuilder, TrimBuilder, SOLID, T_METAL, T_STONE, T_PAINT, T_NIGHTGLOW, T_GLOW } from './builders';
import {
  type BuildCtx, type Helipad, type SignSpec, type BillboardSpec, streetBuilding, tower, house, warehouse,
  BRICK_COLORS, PLASTER_COLORS, PASTEL_COLORS, CONCRETE_COLORS, STONE_COLORS,
} from './buildings';
import {
  LAMP, streetLightGeo, signalGeo, hydrantGeo, benchGeo, binGeo, busStopGeo, phoneGeo, newsBoxesGeo, meterGeo, mailboxGeo, dumpsterGeo, bollardGeo,
  powerPoleGeo, WIRE, billboardFrameGeo, treeGeos, palmGeos, shrubGeos, leafMaterial,
} from './props';

export interface SignalHead { inter: number; axis: 'x' | 'z'; lamps: [number, number, number] }
export interface CityVisuals {
  root: THREE.Group;
  lampHeads: THREE.Vector3[];
  signalHeads: SignalHead[];
  signalLamps: THREE.InstancedMesh;
  chunkMeshes: THREE.Object3D[];
  ferris: THREE.Object3D | null;
  water: THREE.Mesh;
  helipads: Helipad[];
}

/** Non-indexed geometry builder with metre-space UVs and per-vertex colour (ground slabs, markings). */
class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvs: number[], color: THREE.Color) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const vs = [a, b, c, a, c, d], us = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) { this.pos.push(vs[i].x, vs[i].y, vs[i].z); this.nor.push(n.x, n.y, n.z); this.uv.push(uvs[us[i] * 2], uvs[us[i] * 2 + 1]); this.col.push(color.r, color.g, color.b); }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
function slab(gb: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, top: THREE.Color, side: THREE.Color, uvScale = 1) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  gb.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), [x0 / uvScale, z1 / uvScale, x1 / uvScale, z1 / uvScale, x1 / uvScale, z0 / uvScale, x0 / uvScale, z0 / uvScale], top);
  if (y1 - y0 > 0.001) {
    const h = (y1 - y0) / uvScale;
    gb.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), [x0 / uvScale, 0, x1 / uvScale, 0, x1 / uvScale, h, x0 / uvScale, h], side);
    gb.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), [x1 / uvScale, 0, x0 / uvScale, 0, x0 / uvScale, h, x1 / uvScale, h], side);
    gb.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), [z1 / uvScale, 0, z0 / uvScale, 0, z0 / uvScale, h, z1 / uvScale, h], side);
    gb.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), [z0 / uvScale, 0, z1 / uvScale, 0, z1 / uvScale, h, z0 / uvScale, h], side);
  }
}
function surfaceMat(s: Surface, repeat: number, opts: THREE.MeshStandardMaterialParameters = {}, macro = 0.16, key = 'ground') {
  for (const t of [s.map, s.normalMap, s.roughnessMap]) t.repeat.set(repeat, repeat);
  const m = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8), ...opts });
  return addMacroVariation(m, macro, 0.011, key);
}

export function buildCity(scene: THREE.Scene, physics: Physics, _assets: Assets, city: CityMap): CityVisuals {
  const root = new THREE.Group(); root.name = 'city'; scene.add(root);
  const C = (h: string) => new THREE.Color(h);
  const chunkMeshes: THREE.Object3D[] = [];
  const minX = AVENUES[0] - halfWidth(1) - 6, maxX = AVENUES[AVENUES.length - 1] + halfWidth(2) + 2;
  const minZ = STREETS[0] - halfWidth(1) - 6, maxZ = STREETS[STREETS.length - 1] + halfWidth(2) + 0.5;

  // ---------- Ground: grass land, asphalt, water ----------
  const grassMat = surfaceMat(grassSurface(), 1, {}, 0.3, 'grass');
  const land = new GeoBuilder();
  slab(land, -1400, NORTH_EDGE, maxX + 2, maxZ + 8, -0.05, -0.05, C('#ffffff'), C('#ffffff'), 7);
  slab(land, maxX, NORTH_EDGE, CHANNEL.x0, -62, -0.05, -0.05, C('#ffffff'), C('#ffffff'), 7);
  slab(land, CHANNEL.x1, NORTH_EDGE, 1400, -62, -0.05, -0.05, C('#ffffff'), C('#ffffff'), 7);
  slab(land, -1400, -1400, -1104, NORTH_EDGE, -0.05, -0.05, C('#ffffff'), C('#ffffff'), 7);
  const landMesh = new THREE.Mesh(land.build(), grassMat); landMesh.receiveShadow = true; root.add(landMesh);
  // Ground as 200 m tiles: one huge box loses contact precision for the character controller.
  // Only land gets ground: the sea and harbor are open water down to a seabed (swim, sink).
  const tileRect = (x0: number, z0: number, x1: number, z1: number, top: number) => {
    for (let gx = x0; gx < x1; gx += 200) for (let gz = z0; gz < z1; gz += 200) {
      const ex = Math.min(gx + 200, x1), ez = Math.min(gz + 200, z1);
      physics.addStaticBox((gx + ex) / 2, top - 0.5, (gz + ez) / 2, (ex - gx) / 2, 0.5, (ez - gz) / 2);
    }
  };
  tileRect(-1500, NORTH_EDGE, maxX + 2, maxZ + 7, -0.05); // city and the land around it (the hills to the north are terrain)
  tileRect(maxX + 2, NORTH_EDGE, CHANNEL.x0, -62, -0.05); // north of the docks
  tileRect(CHANNEL.x1, NORTH_EDGE, 1500, -62, -0.05); // east of the Cannery Channel
  tileRect(CHANNEL.x0, -1500, CHANNEL.x1, -62, SEABED_Y); // channel bed
  // outer limits beyond the terrain
  physics.addStaticBox(-1090, 20, -850, 2, 60, 460); physics.addStaticBox(1090, 20, -700, 2, 60, 640); physics.addStaticBox(0, 20, -1290, 1100, 60, 2);
  tileRect(-1500, maxZ + 7, 1500, SEA_EDGE_Z, SEABED_Y); // seabed south of the coast
  tileRect(maxX + 2, -62, SEA_EDGE_X, maxZ + 7, SEABED_Y); // harbor floor
  physics.addStaticBox(0, -2, SEA_EDGE_Z, 1500, 8, 1);
  physics.addStaticBox(SEA_EDGE_X, -2, (SEA_EDGE_Z - 62) / 2, 1, 8, (SEA_EDGE_Z + 62) / 2);

  const asphaltS = asphaltSurface();
  const asphaltMat = surfaceMat(asphaltS, 1, {}, 0.2, 'asphalt');
  const road = new GeoBuilder();
  slab(road, minX, minZ, maxX, maxZ, 0, 0, C('#ffffff'), C('#ffffff'), 12);
  const roadMesh = new THREE.Mesh(road.build(), asphaltMat); roadMesh.receiveShadow = true; root.add(roadMesh);

  // Water with gentle animated waves and shoreline foam.
  const waterMat = new THREE.MeshStandardMaterial({ color: '#1f6f80', roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.94 });
  waterMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeUniform; sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime, uNight; varying vec3 vW;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float fadeW = 1.0 - smoothstep(60.0, 420.0, length(vViewPosition));
        float w1 = sin(dot(vW.xz, vec2(0.19, 0.07)) + uTime * 1.1) + sin(dot(vW.xz, vec2(-0.05, 0.23)) - uTime * 0.9) + 0.5 * sin(dot(vW.xz, vec2(0.31, -0.27)) + uTime * 1.7) + 0.35 * sin(dot(vW.xz, vec2(-0.6, -0.41)) + uTime * 2.3) + 0.25 * sin(dot(vW.xz, vec2(1.3, 0.9)) + uTime * 3.1);
        float w2 = cos(dot(vW.xz, vec2(0.29, -0.13)) - uTime * 1.3) + cos(dot(vW.xz, vec2(0.08, 0.31)) + uTime * 0.7) + 0.35 * cos(dot(vW.xz, vec2(0.52, 0.47)) - uTime * 2.1) + 0.25 * cos(dot(vW.xz, vec2(-1.1, 1.4)) - uTime * 2.9);
        normal = normalize(normal + (viewMatrix * vec4(w1 * 0.03, 0.0, w2 * 0.03, 0.0)).xyz * fadeW);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float shoreS = smoothstep(${(COAST_Z - 5).toFixed(1)}, ${(COAST_Z - 13).toFixed(1)}, vW.z) * step(${(COAST_Z - 20).toFixed(1)}, vW.z) * step(vW.x, ${(HARBOR_X - 2).toFixed(1)});
        float shoreE = smoothstep(${(HARBOR_X + 6).toFixed(1)}, ${(HARBOR_X).toFixed(1)}, vW.x) * step(${(HARBOR_X - 1).toFixed(1)}, vW.x) * step(-60.0, vW.z) * step(vW.z, ${(COAST_Z - 30).toFixed(1)});
        float foamBand = max(shoreS, shoreE);
        float foam = foamBand * step(0.5, 0.5 + 0.5 * sin(vW.x * 1.7 + sin(vW.x * 0.21) * 4.0 + uTime * 1.6 + foamBand * 7.0)) * step(0.35, 0.5 + 0.5 * sin(vW.x * 0.37 + vW.z * 0.9 - uTime * 0.8));
        float deep = smoothstep(0.0, 160.0, vW.z - ${COAST_Z.toFixed(1)});
        diffuseColor.rgb = mix(vec3(0.07, 0.24, 0.26), vec3(0.025, 0.09, 0.14), deep);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 0.95), foam * 0.75 + foamBand * 0.15);`);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), waterMat);
  water.position.y = WATER_LEVEL; water.receiveShadow = true; root.add(water);

  // ---------- Sidewalks / block slabs / lot interiors ----------
  const paveMat = surfaceMat(pavementSurface(), 1, { vertexColors: true }, 0.14, 'pave');
  const walks = new GeoBuilder();
  const inner = new GeoBuilder();
  const grassInner = new GeoBuilder();
  const trim = new Chunked(125, () => new TrimBuilder());
  for (const b of city.blocks) {
    const top = b.district === 'strand' ? C('#f4ead8') : b.district === 'heights' ? C('#e4e1dc') : b.district === 'cannery' ? C('#c9c6bf') : C('#ffffff');
    slab(walks, b.x0, b.z0, b.x1, b.z1, 0, CURB_HEIGHT, top, C('#c8c4bb'), 6);
    physics.addStaticBox((b.x0 + b.x1) / 2, CURB_HEIGHT / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, CURB_HEIGHT / 2, (b.z1 - b.z0) / 2, 0, 0.8);
    // granite curbs
    const cc = C('#b9b5ad'), ch = CURB_HEIGHT + 0.012;
    const tb = trim.at((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    tb.box((b.x0 + b.x1) / 2, ch / 2, b.z0 + 0.14, b.x1 - b.x0, ch, 0.3, 0, cc, T_STONE); tb.box((b.x0 + b.x1) / 2, ch / 2, b.z1 - 0.14, b.x1 - b.x0, ch, 0.3, 0, cc, T_STONE);
    tb.box(b.x0 + 0.14, ch / 2, (b.z0 + b.z1) / 2, 0.3, ch, b.z1 - b.z0, 0, cc, T_STONE); tb.box(b.x1 - 0.14, ch / 2, (b.z0 + b.z1) / 2, 0.3, ch, b.z1 - b.z0, 0, cc, T_STONE);
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    if (b.kind === 'park' || b.district === 'hillside') slab(grassInner, ix0, iz0, ix1, iz1, CURB_HEIGHT + 0.01, CURB_HEIGHT + 0.01, C('#ffffff'), C('#ffffff'), 7);
    else if (b.kind === 'buildings' && b.district !== 'heights') slab(inner, ix0 + 10, iz0 + 10, ix1 - 10, iz1 - 10, CURB_HEIGHT + 0.01, CURB_HEIGHT + 0.01, C('#9a9894'), C('#9a9894'), 12);
  }
  // promenade along the coast and the dock quay
  slab(walks, minX, maxZ, maxX, maxZ + 7, 0, CURB_HEIGHT, C('#f2e4cc'), C('#c8c4bb'), 6);
  physics.addStaticBox((minX + maxX) / 2, CURB_HEIGHT / 2, maxZ + 3.5, (maxX - minX) / 2, CURB_HEIGHT / 2, 3.5);
  slab(walks, maxX, -62, HARBOR_X, maxZ + 7, -3, CURB_HEIGHT, C('#c4beb4'), C('#8d8780'), 6);
  physics.addStaticBox((maxX + HARBOR_X) / 2, (CURB_HEIGHT - 3) / 2, (maxZ + 7 - 62) / 2, (HARBOR_X - maxX) / 2, (CURB_HEIGHT + 3) / 2, (maxZ + 7 + 62) / 2);
  const walkMesh = new THREE.Mesh(walks.build(), paveMat); walkMesh.receiveShadow = true; root.add(walkMesh);
  const innerMat = surfaceMat(asphaltS, 1, { vertexColors: true }, 0.2, 'asphalt-inner');
  const innerMesh = new THREE.Mesh(inner.build(), innerMat); innerMesh.receiveShadow = true; root.add(innerMesh);
  const gi = new THREE.Mesh(grassInner.build(), grassMat); gi.receiveShadow = true; root.add(gi);

  // Beach: sloping sand from the promenade into the sea.
  const sandS = sandSurface();
  const beachGeo = new THREE.PlaneGeometry(maxX - minX + 600, 90, 120, 18).rotateX(-Math.PI / 2);
  const bp = beachGeo.attributes.position, buv = beachGeo.attributes.uv;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i) + (minX + maxX) / 2 - 300, z = bp.getZ(i) + maxZ + 7 + 45;
    const t = (z - (maxZ + 7)) / 90;
    const y = CURB_HEIGHT - 0.05 - t * 5.2 + Math.sin(x * 0.05) * 0.15 * t;
    bp.setXYZ(i, x, Math.min(y, CURB_HEIGHT - 0.02), z); buv.setXY(i, x / 8, z / 8);
  }
  beachGeo.computeVertexNormals();
  const beach = new THREE.Mesh(beachGeo, surfaceMat(sandS, 1, {}, 0.2, 'sand'));
  beach.receiveShadow = true; root.add(beach);
  {
    const len = 90, drop = 5.2, ang = Math.atan2(drop, len);
    const cz = maxZ + 7 + len / 2, cy = CURB_HEIGHT - 0.05 - drop / 2 - 0.5 / Math.cos(ang);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    physicsSlope(physics, (minX + maxX) / 2 - 300, cy, cz, (maxX - minX) / 2 + 300, 0.5, Math.hypot(len, drop) / 2, q);
  }

  // Hills to the north and west close the map visually.
  const hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const hillParts: THREE.BufferGeometry[] = [];
  const mkHill = (cx: number, cz: number, w: number, d: number, yaw: number, height: number, seed: number) => {
    const g = new THREE.PlaneGeometry(w, d, 60, 18).rotateX(-Math.PI / 2);
    const p = g.attributes.position; const r = new Rng(seed);
    const phase = r.range(0, 10);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i);
      const t = (lz + d / 2) / d;
      const h = Math.pow(1 - t, 0.9) * height * (0.65 + 0.35 * Math.sin(lx * 0.012 + phase) * Math.cos(lx * 0.031 + phase));
      p.setY(i, Math.max(0, h + r.range(-1.2, 1.2) * (1 - t)) - 0.2);
    }
    g.rotateY(yaw); g.translate(cx, 0, cz);
    const col = colorize(g, '#5f7a3f', 0.1, r);
    const cp = col.attributes.position, cc = col.attributes.color;
    for (let i = 0; i < cp.count; i++) { const y = cp.getY(i); if (y > height * 0.55) cc.setXYZ(i, 0.5, 0.47, 0.36); }
    hillParts.push(col);
  };
  mkHill(minX - 120, 170, 1150, 220, -Math.PI / 2, 60, 2);
  const hills = new THREE.Mesh(mergeColored(hillParts), hillMat); hills.receiveShadow = true; root.add(hills);
  physics.addStaticBox(minX - 6, 6, 200, 1, 12, 610);
  // north terrain: hills, road beds, channel, house pads
  const terrainH = makeTerrainHeight(city, expansionPads(city));
  const terrainMat = surfaceMat(grassSurface(), 1, { vertexColors: true }, 0.3, 'terrain');
  buildTerrain(root, physics, terrainH, terrainMat);
  // channel quay walls south of the freeway
  { const tb0 = new TrimBuilder(); for (const x of [CHANNEL.x0, CHANNEL.x1]) for (let z = -62; z > NORTH_EDGE - 4; z -= 40) tb0.box(x + (x === CHANNEL.x0 ? -0.4 : 0.4), -3.4, z - 20, 0.8, 7, 40, 0, C('#7d7870'), T_STONE); const qm = new THREE.Mesh(tb0.build(), trimMaterial()); qm.receiveShadow = true; root.add(qm); for (const x of [CHANNEL.x0, CHANNEL.x1]) physics.addStaticBox(x + (x === CHANNEL.x0 ? -0.4 : 0.4), -3.4, (-62 + NORTH_EDGE) / 2, 0.4, 3.5, (NORTH_EDGE + 62) / -2); }
  physics.addStaticBox(HARBOR_X + 1, 0.6, (-62 + maxZ + 7) / 2, 1, 0.8, (maxZ + 69) / 2);

  // ---------- Road markings (worn paint) ----------
  const mk = new GeoBuilder();
  const white = C('#e4e1d6'), yellow = C('#e2b043');
  const Y = 0.012;
  const rect = (x0: number, z0: number, x1: number, z1: number, color: THREE.Color, y = Y) => {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    const V = (x: number, z: number) => new THREE.Vector3(x, y, z);
    mk.quad(V(ax, bz), V(bx, bz), V(bx, az), V(ax, az), [ax / 2.5, bz / 2.5, bx / 2.5, bz / 2.5, bx / 2.5, az / 2.5, ax / 2.5, az / 2.5], color);
  };
  const along = (road: (typeof city.roads)[number], s0: number, s1: number, o0: number, o1: number, color: THREE.Color) => {
    if (road.axis === 'x') rect(s0, road.coord + o0, s1, road.coord + o1, color);
    else rect(road.coord + o0, s0, road.coord + o1, s1, color);
  };
  for (const r of city.roads) {
    const a = r.from, b = r.to;
    if (r.lanes === 2) { along(r, a + 4.5, b - 4.5, -0.22, -0.1, yellow); along(r, a + 4.5, b - 4.5, 0.1, 0.22, yellow); }
    else { for (let s = a + 6; s < b - 6; s += 6) along(r, s, Math.min(s + 3, b - 6), -0.07, 0.07, yellow); }
    if (r.lanes === 2) for (const sg of [-1, 1]) for (let s = a + 6; s < b - 6; s += 9) along(r, s, Math.min(s + 3.5, b - 6), sg * (0.2 + LANE_WIDTH) - 0.07, sg * (0.2 + LANE_WIDTH) + 0.07, white);
    for (const sg of [-1, 1]) along(r, a + 4.5, b - 4.5, sg * (r.half - 0.55) - 0.07, sg * (r.half - 0.55) + 0.07, white);
    const span = r.lanes * LANE_WIDTH + 0.2;
    along(r, b - 4.6, b - 4.15, 0.2, span, white);
    along(r, a + 4.15, a + 4.6, -span, -0.2, white);
    for (const end of [a, b]) {
      const s0 = end === a ? a + 0.7 : b - 3.7;
      for (let o = -r.half + 0.6; o < r.half - 0.6; o += 1.2) along(r, s0, s0 + 3, o, o + 0.6, white);
    }
  }
  // parking bays in courtyard lots
  for (const b of city.blocks) {
    if (b.kind !== 'buildings' || b.district === 'heights' || b.district === 'hillside') continue;
    const x0 = b.x0 + SIDEWALK + 10, x1 = b.x1 - SIDEWALK - 10, z0 = b.z0 + SIDEWALK + 10, z1 = b.z1 - SIDEWALK - 10;
    const yy = CURB_HEIGHT + 0.025;
    const line = (ax: number, az: number, bx: number, bz: number, wdt = 0.12) => rect(ax - (az === bz ? 0 : wdt / 2), az - (az === bz ? wdt / 2 : 0), bx + (az === bz ? 0 : wdt / 2), bz + (az === bz ? wdt / 2 : 0), white, yy);
    for (let x = x0 + 2; x <= x1 - 2; x += 3) { line(x, z0 + 0.3, x, z0 + 5.3); line(x, z1 - 5.3, x, z1 - 0.3); }
    line(x0 + 2, z0 + 5.3, x1 - 2 - ((x1 - x0 - 4) % 3), z0 + 5.3); line(x0 + 2, z1 - 5.3, x1 - 2 - ((x1 - x0 - 4) % 3), z1 - 5.3);
  }
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: paintWearTexture(), alphaTest: 0.5, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const marks = new THREE.Mesh(mk.build(), markMat); marks.receiveShadow = true; root.add(marks);

  // ---------- Buildings ----------
  const fac = new Chunked(250, () => new FacadeBuilder());
  const signs: SignSpec[] = [], billboards: BillboardSpec[] = [], helipads: Helipad[] = [];
  const merged = mergeLots(city);
  const occ = merged.map(m => { const swap = Math.abs(Math.sin(m.rot)) > 0.7; return { x: m.x, z: m.z, hw: (swap ? m.d : m.w) / 2, hd: (swap ? m.w : m.d) / 2 }; });
  const occupied = (x: number, z: number) => occ.some(o => Math.abs(x - o.x) < o.hw && Math.abs(z - o.z) < o.hd);
  const ctx: BuildCtx = { fac, trim, physics, signs, billboards, helipads, exposed: (x, z) => !occupied(x, z) };
  const towerLots = merged.filter(l => l.kind === 'tower').sort((a, b) => b.height - a.height);
  const padNames = ['Meridian Tower helipad', 'Heights Plaza helipad', 'Cobalt Center helipad'];
  const PS = POLICE_STATION;
  const policeLot = (l: Lot) => Math.abs(l.x - PS.x) < PS.w / 2 && Math.abs(l.z - PS.z) < 3;
  for (const lot of merged) {
    const b = city.blocks[lot.blockId];
    const r = new Rng(lot.seed);
    if (policeLot(lot)) continue;
    if (lot.kind === 'tower') {
      const rank = towerLots.indexOf(lot);
      tower(ctx, { cx: lot.x, cz: lot.z, w: lot.w, d: lot.d, base: CURB_HEIGHT, height: lot.height * 1.45, seed: lot.seed, helipad: rank >= 0 && rank < 3 ? padNames[rank] : null });
      continue;
    }
    if (b.district === 'hillside') {
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      const off = -0.9;
      house(ctx, { cx: lot.x + off * s, cz: lot.z + off * c, yaw: lot.rot, w: lot.w - r.range(2.2, 3.4), d: lot.d - 3.6, base: CURB_HEIGHT, seed: lot.seed, lotW: lot.w, lotD: lot.d });
      continue;
    }
    const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
    const hw = lot.w / 2, hd = lot.d / 2;
    const faceOut = (lx: number, lz: number) => ctx.exposed(lot.x + lx * c + lz * s, lot.z - lx * s + lz * c);
    const exposed: [boolean, boolean, boolean, boolean] = [true, faceOut(hw + 1.2, 0), faceOut(0, -hd - 1.2), faceOut(-hw - 1.2, 0)];
    const brick = b.district === 'brickline' || (lot.kind === 'brownstone' && b.district === 'midtown');
    const beach = b.district === 'strand';
    const store = storeAt(lot.x, lot.z);
    const common = { cx: lot.x, cz: lot.z, yaw: lot.rot, w: lot.w - 0.06, d: lot.d, base: CURB_HEIGHT, seed: lot.seed, exposed, brand: r.int(0, BRANDS.length - 1), hollow: !!store };
    if (store) {
      streetBuilding(ctx, { ...common, floors: r.int(2, 3), floorH: 3.25, groundH: STORE_H, mat: 0, color: C(r.pick(BRICK_COLORS)), ground: 'blank', winW: 1.15, winH: 1.85, sill: 0.8, cellW: 2.6, cornice: 'heavy', fireEscape: r.chance(0.4), lit: 0.42, roofItems: r.int(1, 3), awning: false, balconies: false, trimColor: C('#d9d2c3') });
      continue;
    }
    if (beach) {
      const floors = r.int(2, 4);
      streetBuilding(ctx, { ...common, floors, floorH: 3.2, groundH: 4.0, mat: 1, color: C(r.pick(PASTEL_COLORS)), ground: r.chance(0.6) ? 'shop' : 'lobby', winW: 1.6, winH: 1.6, sill: 0.9, cellW: 2.8, cornice: 'bands', fireEscape: false, lit: 0.4, roofItems: r.int(1, 3), awning: r.chance(0.6), balconies: r.chance(0.5), trimColor: C('#f4efe6') });
    } else if (brick) {
      const floors = lot.w > 15 ? r.int(4, 6) : r.int(2, 5);
      const painted = r.chance(0.18);
      streetBuilding(ctx, { ...common, floors, floorH: 3.25, groundH: 4.2, mat: painted ? 6 : 0, color: painted ? C(r.pick(PLASTER_COLORS)) : C(r.pick(BRICK_COLORS)), ground: r.chance(0.6) ? 'shop' : 'resi', winW: 1.15, winH: 1.85, sill: 0.8, cellW: 2.6, cornice: r.chance(0.75) ? 'heavy' : 'simple', fireEscape: r.chance(0.45), lit: 0.42, roofItems: r.int(1, 4), awning: r.chance(0.5), balconies: false, trimColor: C(r.pick(['#d9d2c3', '#c9c1b0', '#e8e2d4', '#8f8a80', '#3a3a3a'])) });
    } else {
      const mat = r.pick([1, 2, 3, 3, 2, 7]);
      const floors = r.int(5, 10);
      const color = C(mat === 1 ? r.pick(PLASTER_COLORS) : mat === 2 ? r.pick(CONCRETE_COLORS) : mat === 3 ? r.pick(STONE_COLORS) : r.pick(['#8a9298', '#6f7880', '#a7a29a']));
      streetBuilding(ctx, { ...common, floors, floorH: 3.4, groundH: 4.6, mat, color, ground: r.chance(0.7) ? 'shop' : 'lobby', winW: mat === 7 ? 2.2 : 1.5, winH: 2.0, sill: 0.85, cellW: mat === 7 ? 2.6 : 2.8, cornice: r.chance(0.5) ? 'simple' : 'bands', fireEscape: false, lit: 0.45, roofItems: r.int(2, 4), awning: r.chance(0.35), balconies: mat === 1 && r.chance(0.5), trimColor: C(r.pick(['#d5d0c6', '#9a958c', '#5a5c5e'])) });
    }
  }

  // ---------- Docks: warehouses, containers, cranes ----------
  const containerColors = ['#a8402c', '#2f5f7f', '#c48a2b', '#3f6f4a', '#6a3a5f', '#c8c8c0', '#7f2f2a', '#2a4d6a'];
  for (const b of city.blocks.filter(bb => bb.kind === 'docks')) {
    const r = new Rng(b.id * 77);
    const ix0 = b.x0 + SIDEWALK + 2, ix1 = b.x1 - SIDEWALK - 2, iz0 = b.z0 + SIDEWALK + 2, iz1 = b.z1 - SIDEWALK - 2;
    const wh = r.chance(0.6);
    if (wh) {
      const w = ix1 - ix0, d = (iz1 - iz0) * 0.5, h = r.range(9, 12);
      warehouse(ctx, { cx: (ix0 + ix1) / 2, cz: iz0 + d / 2, w, d, base: CURB_HEIGHT, h, seed: b.id * 31 + 5, yaw: Math.PI });
    }
    const startZ = wh ? iz0 + (iz1 - iz0) * 0.6 : iz0;
    let row = 0;
    for (let z = startZ + 2; z < iz1 - 3; z += (row++ % 2 === 0 ? 2.75 : 7.5)) for (let x = ix0 + 7; x < ix1 - 6; x += 17) {
      if (r.chance(0.3)) continue;
      const stack = r.int(1, 3);
      const fb = fac.at(x, z), tb = trim.at(x, z);
      for (let k = 0; k < stack; k++) {
        const y0 = CURB_HEIGHT + k * 2.6;
        fb.box(x, z, 12.2, 2.45, y0, y0 + 2.55, 0, C(r.pick(containerColors)), [{ ...SOLID(5, k + x, y0), cellW: 1 }], { ...SOLID(5, 3, y0), kind: 3 }, C('#8a8a86'));
        for (const ex of [-6.1, 6.1]) tb.box(x + ex, y0 + 1.28, z, 0.06, 2.55, 2.5, 0, C('#5a5a58'), T_METAL);
      }
      physics.addStaticBox(x, CURB_HEIGHT + stack * 1.3, z, 6.1, stack * 1.3, 1.3);
    }
  }
  // Gantry cranes along the quay
  for (const cz of [40, 150, 290]) {
    const tb = trim.at(476, cz);
    const col = C('#c9622a'), x = 476;
    for (const dx of [-7, 7]) for (const dz of [-6, 6]) { tb.box(x + dx, 17.1, cz + dz, 1.2, 34, 1.2, 0, col, T_PAINT); physics.addStaticBox(x + dx, 17, cz + dz, 0.6, 17, 0.6); }
    for (const dz of [-6, 6]) for (let y = 6; y < 32; y += 6.5) tb.beam(x - 7, y, cz + dz, x + 7, y + 6, cz + dz, 0.3, 0.3, col, T_PAINT);
    tb.box(x, 33.5, cz, 16, 3, 13.5, 0, col, T_PAINT);
    tb.box(x + 22, 34, cz, 66, 2.4, 2.4, 0, col, T_PAINT);
    tb.box(x - 2, 37, cz, 6, 4, 5, 0, C('#e8e2d0'), T_PAINT);
    tb.box(x + 1.05, 37.3, cz, 0.05, 1.4, 4.2, 0, C('#2a3438'), [0.1, 0.3, 0, 0]);
    for (const dz of [-6, 6]) tb.box(x + dz, 0.6, cz, 2.2, 1.0, 14, 0, C('#3a3a3a'), T_METAL);
    tb.sphere(x + 55, 35.4, cz, 0.25, C('#ff3020'), T_GLOW(3));
  }

  // ---------- Metro Police precinct ----------
  {
    const exposedPS: [boolean, boolean, boolean, boolean] = [true, true, true, true];
    streetBuilding(ctx, { cx: PS.x, cz: PS.z, yaw: PS.yaw, w: PS.w, d: PS.d, base: CURB_HEIGHT, seed: 4242, exposed: exposedPS, brand: 11, floors: 3, floorH: 3.6, groundH: 4.6, mat: 3, color: C('#c9c1ae'), ground: 'lobby', winW: 1.6, winH: 2.0, sill: 0.9, cellW: 3.0, cornice: 'simple', fireEscape: false, lit: 0.8, roofItems: 0, awning: false, balconies: false, trimColor: C('#e2ddd0') });
    const H = CURB_HEIGHT + 4.6 + 3 * 3.6;
    const tb = trim.at(PS.x, PS.z);
    // rooftop helipad on a steel deck over the parapet
    tb.box(PS.x + 6, H + 1.05, PS.z, 10.4, 0.25, 9.6, 0, C('#55595c'), T_METAL);
    for (const dx of [-4.5, 4.5]) for (const dz of [-4, 4]) tb.box(PS.x + 6 + dx, H + 0.5, PS.z + dz, 0.25, 1, 0.25, 0, C('#55595c'), T_METAL);
    physics.addStaticBox(PS.x + 6, H + 1.05, PS.z, 5.2, 0.13, 4.8);
    helipadPad(tb, physics, PS.x + 6, H + 1.18, PS.z, 'Metro Police roof helipad', helipads, 4.7);
    // entrance: blue lamps, flag pole, badge sign
    const fz = PS.z - PS.d / 2;
    for (const dx of [-2.2, 2.2]) { tb.cyl(PS.x + dx, CURB_HEIGHT, fz - 0.6, 0.06, 0.06, 2.4, 6, C('#222'), T_METAL); tb.box(PS.x + dx, CURB_HEIGHT + 2.6, fz - 0.6, 0.35, 0.45, 0.35, 0, C('#3a7bff'), T_GLOW(3)); }
    tb.cyl(PS.x - 12, CURB_HEIGHT, fz - 2.6, 0.08, 0.05, 11, 8, C('#ddd'), T_METAL); tb.box(PS.x - 11, CURB_HEIGHT + 10, fz - 2.6, 2.2, 1.3, 0.03, 0, C('#2a4a6b'), T_PAINT);
    physics.addStaticCylinder(PS.x - 12, 5, fz - 2.6, 5, 0.1);
    const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
    g.fillStyle = '#16233a'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#e8eef8'; g.font = '800 46px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('METRO POLICE  ·  PRECINCT 4', 256, 50, 480);
    const st = new THREE.CanvasTexture(c); st.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), new THREE.MeshStandardMaterial({ map: st, emissiveMap: st, emissive: new THREE.Color(0.6, 0.6, 0.6), roughness: 0.5 }));
    sm.position.set(PS.x, CURB_HEIGHT + 4.0, fz - 0.12); sm.rotation.y = Math.PI; root.add(sm);
  }
  // ---------- Freeway, bridge, Vista Drive, airfield, Fort Calder ----------
  const propsX = new ChunkInstancer(300);
  propsX.register('streetlight', streetLightGeo(), trimMaterial());
  const exp = buildExpansion(root, physics, city, ctx, propsX, asphaltMat, markMat, terrainH);
  chunkMeshes.push(...propsX.build(root).map(m => { m.userData.small = true; return m; }));

  // ---------- Signs and billboards ----------
  const signTex = signAtlas();
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.25, roughness: 0.5 });
  signMat.onBeforeCompile = sh => { sh.uniforms.uNight = nightUniform; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.12 + uNight * 3.0;'); };
  const sg: THREE.BufferGeometry[] = [];
  const signPlane = (s: SignSpec, flip: boolean) => {
    const g = new THREE.PlaneGeometry(s.w, s.h);
    const u = (s.idx % 4) / 4, v = 1 - (Math.floor(s.idx / 4) % 8 + 1) / 8;
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u + uv.getX(i) * 0.25, v + uv.getY(i) * 0.125);
    if (flip) g.rotateY(Math.PI);
    g.rotateY(s.yaw); g.translate(s.x, s.y, s.z); return g;
  };
  for (const s of signs) {
    if (s.blade) { const off = 0.03; const fx = Math.sin(s.yaw) * off, fz = Math.cos(s.yaw) * off; sg.push(signPlane({ ...s, x: s.x + fx, z: s.z + fz }, false), signPlane({ ...s, x: s.x - fx, z: s.z - fz }, true)); const tb = trim.at(s.x, s.z); tb.box(s.x, s.y, s.z, s.w + 0.1, s.h + 0.1, 0.05, s.yaw, C('#222'), T_METAL); }
    else sg.push(signPlane(s, false));
  }
  if (sg.length) { const sm = new THREE.Mesh(mergeGeoms(sg), signMat); root.add(sm); chunkMeshes.push(sm); sm.userData.small = true; }
  const bbTex = billboardAtlas();
  const bbMat = new THREE.MeshStandardMaterial({ map: bbTex, emissiveMap: bbTex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.1, roughness: 0.55 });
  bbMat.onBeforeCompile = signMat.onBeforeCompile;
  const bg: THREE.BufferGeometry[] = [];
  const props = new ChunkInstancer(300);
  const tmat = trimMaterial();
  props.register('bbframe', billboardFrameGeo(12), tmat);
  const addBillboard = (b: BillboardSpec) => {
    const g = new THREE.PlaneGeometry(b.w, b.w * 0.5);
    const col = b.idx % 4, row = Math.floor(b.idx / 4) % 2;
    const u0 = col / 4, v0 = 1 - (row * 512 + 384) / 1024, v1 = 1 - (row * 512 + 128) / 1024;
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.25, v0 + uv.getY(i) * (v1 - v0));
    g.rotateY(b.yaw); g.translate(b.x + Math.sin(b.yaw) * 0.01, b.y + 3.3 + b.w * 0.25, b.z + Math.cos(b.yaw) * 0.01); bg.push(g);
    props.add('bbframe', b.x - Math.sin(b.yaw) * 0.0, b.y, b.z, b.yaw, new THREE.Vector3(b.w / 12, 1, 1));
  };
  for (const b of billboards) addBillboard(b);

  // ---------- Street furniture ----------

  props.register('streetlight', streetLightGeo(), tmat);
  props.register('hydrant', hydrantGeo(), tmat);
  props.register('bench', benchGeo(), tmat);
  props.register('bin', binGeo(), tmat);
  props.register('busstop', busStopGeo(), tmat);
  props.register('phone', phoneGeo(), tmat);
  for (let k = 0; k < 3; k++) props.register(`news${k}`, newsBoxesGeo(k * 7 + 1), tmat);
  props.register('meter', meterGeo(), tmat);
  props.register('mailbox', mailboxGeo(), tmat);
  for (let k = 0; k < 2; k++) props.register(`dumpster${k}`, dumpsterGeo(k), tmat);
  props.register('bollard', bollardGeo(), tmat);
  props.register('pole', powerPoleGeo(false), tmat); props.register('poleT', powerPoleGeo(true), tmat);
  const leafMat = leafMaterial(leafTexture('broad'));
  const palmMat = leafMaterial(leafTexture('palm'));
  for (let t = 0; t < 4; t++) { const g = treeGeos(100 + t); props.register(`tree${t}`, g.trunk, tmat); props.register(`leaf${t}`, g.leaves, leafMat); }
  for (let t = 0; t < 3; t++) { const g = palmGeos(200 + t); props.register(`palm${t}`, g.trunk, tmat); props.register(`frond${t}`, g.leaves, palmMat); }
  for (let t = 0; t < 2; t++) props.register(`shrub${t}`, shrubGeos(300 + t).leaves, leafMat);
  const addTree = (x: number, y: number, z: number, yaw: number, s: number, rr: Rng) => { const k = rr.int(0, 3); props.add(`tree${k}`, x, y, z, yaw, s); props.add(`leaf${k}`, x, y, z, yaw, s); physics.addStaticCylinder(x, y + 2, z, 2, 0.22 * s); };
  const addPalm = (x: number, y: number, z: number, yaw: number, rr: Rng, collide = true) => { const k = rr.int(0, 2); props.add(`palm${k}`, x, y, z, yaw); props.add(`frond${k}`, x, y, z, yaw); if (collide) physics.addStaticCylinder(x, y + 2, z, 2, 0.25); };

  // Kerbside furniture along each block edge: street lights, trees, hydrants, meters, benches, bins, bus stops...
  const lampHeads: THREE.Vector3[] = [];
  const nearPath = (x: number, z: number, m: number) => city.paths.some(p => pathHeightAt(p, x, z).d < p.half + m);
  const kerb = (b: Block) => {
    const r = new Rng(b.id * 97 + 3);
    const edges = [
      { ax: 'x' as const, fixed: b.z0, from: b.x0, to: b.x1, nx: 0, nz: -1 }, { ax: 'x' as const, fixed: b.z1, from: b.x0, to: b.x1, nx: 0, nz: 1 },
      { ax: 'z' as const, fixed: b.x0, from: b.z0, to: b.z1, nx: -1, nz: 0 }, { ax: 'z' as const, fixed: b.x1, from: b.z0, to: b.z1, nx: 1, nz: 0 },
    ];
    for (const e of edges) {
      const P = (s: number, inset: number) => e.ax === 'x' ? { x: s, z: e.fixed - e.nz * inset } : { x: e.fixed - e.nx * inset, z: s };
      const yawRoad = Math.atan2(e.nx, e.nz); // local +z towards the road
      const len = e.to - e.from;
      const major = (e.ax === 'x' && (Math.abs(e.fixed - STREETS[4]) < 12 || Math.abs(e.fixed - STREETS[8]) < 12)) || (e.ax === 'z' && (Math.abs(e.fixed - AVENUES[4]) < 12 || Math.abs(e.fixed - AVENUES[9]) < 12));
      const nL = Math.max(1, Math.round(len / 32));
      const used: number[] = [];
      for (let k = 0; k < nL; k++) {
        const s = e.from + (len / nL) * (k + 0.5);
        const p = P(s, 0.75);
        props.add('streetlight', p.x, CURB_HEIGHT, p.z, yawRoad);
        physics.addStaticCylinder(p.x, 2.5, p.z, 2.5, 0.14);
        lampHeads.push(new THREE.Vector3(p.x + e.nx * LAMP.reach, LAMP.height + CURB_HEIGHT - 0.1, p.z + e.nz * LAMP.reach));
        used.push(s);
      }
      const free = (s: number, m = 3) => s > e.from + 8 && s < e.to - 8 && used.every(u => Math.abs(u - s) > m);
      // trees / palms in pits
      if (b.district !== 'cannery' && b.kind !== 'park') {
        for (let s = e.from + 10; s < e.to - 10; s += r.range(9, 14)) {
          if (!free(s, 4) || r.chance(b.district === 'heights' ? 0.2 : 0.35)) continue;
          const p = P(s, 1.1); used.push(s);
          if (b.district === 'strand') addPalm(p.x, CURB_HEIGHT, p.z, r.range(0, 6.28), r);
          else { addTree(p.x, CURB_HEIGHT, p.z, r.range(0, 6.28), r.range(0.85, 1.1), r); trim.at(p.x, p.z).box(p.x, CURB_HEIGHT + 0.01, p.z, 1.3, 0.03, 1.3, 0, C('#3e352c'), [0.95, 0, 2, 0]); }
        }
      }
      // hydrants, meters, bins, benches, news boxes, phones, mailboxes, bus stops
      const items = Math.floor(len / 22);
      for (let k = 0; k < items; k++) {
        const s = r.range(e.from + 9, e.to - 9); if (!free(s, 2.5)) continue; used.push(s);
        const roll = r.next();
        if (roll < 0.18) { const p = P(s, 0.7); props.add('hydrant', p.x, CURB_HEIGHT, p.z, yawRoad); physics.addStaticCylinder(p.x, 0.45, p.z, 0.45, 0.2); }
        else if (roll < 0.38 && (b.district === 'midtown' || b.district === 'brickline' || b.district === 'heights')) { for (let m = 0; m < 3; m++) { const ps = s + m * 6 - 6; if (ps < e.from + 8 || ps > e.to - 8) continue; const p = P(ps, 0.6); props.add('meter', p.x, CURB_HEIGHT, p.z, yawRoad + Math.PI); physics.addStaticCylinder(p.x, 0.7, p.z, 0.7, 0.08); } }
        else if (roll < 0.5) { const p = P(s, 1.2); props.add('bin', p.x, CURB_HEIGHT, p.z, r.range(0, 6)); physics.addStaticCylinder(p.x, 0.5, p.z, 0.5, 0.3); }
        else if (roll < 0.62) { const p = P(s, 2.0); props.add('bench', p.x, CURB_HEIGHT, p.z, yawRoad + Math.PI); physics.addStaticBox(p.x, 0.45, p.z, e.ax === 'x' ? 0.95 : 0.35, 0.45, e.ax === 'x' ? 0.35 : 0.95); }
        else if (roll < 0.72) { const p = P(s, 1.0); props.add(`news${r.int(0, 2)}`, p.x, CURB_HEIGHT, p.z, yawRoad + Math.PI); physics.addStaticBox(p.x, 0.5, p.z, e.ax === 'x' ? 0.85 : 0.25, 0.5, e.ax === 'x' ? 0.25 : 0.85); }
        else if (roll < 0.8) { const p = P(s, 1.0); props.add('phone', p.x, CURB_HEIGHT, p.z, yawRoad + Math.PI); physics.addStaticCylinder(p.x, 1, p.z, 1, 0.2); }
        else if (roll < 0.88) { const p = P(s, 1.0); props.add('mailbox', p.x, CURB_HEIGHT, p.z, yawRoad + Math.PI); physics.addStaticBox(p.x, 0.7, p.z, 0.3, 0.7, 0.3); }
        else if (major && free(s, 5)) { const p = P(s, 1.4); props.add('busstop', p.x, CURB_HEIGHT, p.z, yawRoad); physics.addStaticBox(p.x - e.nx * 0.62, 1.3, p.z - e.nz * 0.62, e.ax === 'x' ? 1.9 : 0.1, 1.3, e.ax === 'x' ? 0.1 : 1.9); }
      }
      // bollards at plaza / tower frontage
      if (b.district === 'heights') for (let s = e.from + 12; s < e.to - 12; s += 2.2) { if (!free(s, 1.5)) continue; const p = P(s, 0.45); props.add('bollard', p.x, CURB_HEIGHT, p.z, 0); }
      // power poles + overhead wires on residential hill streets
      if (b.district === 'hillside') {
        let prev: { x: number; z: number } | null = null;
        for (let s = e.from + 6; s < e.to - 4; s += 28) {
          const p = P(s, 3.9); const kind = r.chance(0.3) ? 'poleT' : 'pole';
          props.add(kind, p.x, CURB_HEIGHT, p.z, yawRoad + Math.PI / 2); physics.addStaticCylinder(p.x, 4, p.z, 4, 0.16);
          if (prev) wires(trim.at(p.x, p.z), prev, p, e.ax === 'x' ? 'x' : 'z');
          prev = p;
        }
      }
    }
  };
  const wires = (tb: TrimBuilder, a: { x: number; z: number }, b: { x: number; z: number }, ax: 'x' | 'z') => {
    for (const off of [-WIRE.dx, 0, WIRE.dx]) {
      const ox = ax === 'x' ? 0 : off, oz = ax === 'x' ? off : 0;
      const y = CURB_HEIGHT + WIRE.y; const seg = 6; let px = a.x + ox, pz = a.z + oz, py = y;
      for (let i = 1; i <= seg; i++) { const t = i / seg; const nx = a.x + (b.x - a.x) * t + ox, nz = a.z + (b.z - a.z) * t + oz, ny = y - Math.sin(t * Math.PI) * 0.7; tb.beam(px, py, pz, nx, ny, nz, 0.025, 0.025, C('#1b1b1b'), T_METAL); px = nx; pz = nz; py = ny; }
    }
  };
  for (const b of city.blocks) kerb(b);

  // Traffic lights: one mast arm per approach on the near-right corner, head over the lanes facing traffic.
  const signalHeads: SignalHead[] = [];
  const lampPositions: { p: THREE.Vector3; f: THREE.Vector3 }[] = [];
  const armGeos = new Map<number, ReturnType<typeof signalGeo>>();
  for (const inter of city.intersections) {
    if (!inter.signalized) continue;
    const approaches: { axis: 'x' | 'z'; dx: number; dz: number }[] = [{ axis: 'z', dx: 0, dz: -1 }, { axis: 'z', dx: 0, dz: 1 }, { axis: 'x', dx: 1, dz: 0 }, { axis: 'x', dx: -1, dz: 0 }];
    for (const ap of approaches) {
      const rx = -ap.dz, rz = ap.dx;
      const along = ap.axis === 'z' ? inter.halfZ : inter.halfX;
      const across = ap.axis === 'z' ? inter.halfX : inter.halfZ;
      const exists = ap.axis === 'z' ? city.intersectionAt(inter.ix, inter.iz - ap.dz) : city.intersectionAt(inter.ix - ap.dx, inter.iz);
      if (!exists) continue;
      const x = inter.x - ap.dx * (along + 1.2) + rx * (across + 1.0);
      const z = inter.z - ap.dz * (along + 1.2) + rz * (across + 1.0);
      const yaw = Math.atan2(-ap.dx, -ap.dz);
      const arm = Math.round(Math.min(6.5, across + 1.0 - LANE_WIDTH * 0.5 - 0.2));
      let sgeo = armGeos.get(arm); if (!sgeo) { sgeo = signalGeo(arm); armGeos.set(arm, sgeo); props.register(`signal${arm}`, sgeo.geo, tmat); }
      props.add(`signal${arm}`, x, CURB_HEIGHT, z, yaw);
      physics.addStaticCylinder(x, 2, z, 2, 0.17);
      const head: SignalHead = { inter: inter.id, axis: ap.axis, lamps: [0, 0, 0] };
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const hp = sgeo.head;
      for (let k = 0; k < 3; k++) {
        head.lamps[k] = lampPositions.length;
        const lx = hp.x, ly = hp.y + 0.34 - k * 0.34, lz = hp.z;
        lampPositions.push({ p: new THREE.Vector3(x + lx * c + lz * s, CURB_HEIGHT + ly, z - lx * s + lz * c), f: new THREE.Vector3(-ap.dx, 0, -ap.dz) });
      }
      signalHeads.push(head);
    }
  }
  const lampGeo = new THREE.CircleGeometry(0.12, 12);
  const signalLamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), lampPositions.length);
  const dummy = new THREE.Object3D();
  lampPositions.forEach((lp, i) => {
    dummy.position.copy(lp.p); dummy.lookAt(lp.p.x + lp.f.x, lp.p.y, lp.p.z + lp.f.z);
    dummy.updateMatrix(); signalLamps.setMatrixAt(i, dummy.matrix); signalLamps.setColorAt(i, new THREE.Color(0.1, 0.1, 0.1));
  });
  signalLamps.frustumCulled = false; root.add(signalLamps);

  // Parks, plazas, backyards
  for (const b of city.blocks) {
    const r = new Rng(b.id * 31 + 7);
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    if (b.kind === 'park') {
      for (let i = 0; i < 46; i++) {
        const x = r.range(ix0 + 3, ix1 - 3), z = r.range(iz0 + 3, iz1 - 3);
        if (Math.abs(x - (ix0 + ix1) / 2) < 5 || Math.abs(z - (iz0 + iz1) / 2) < 5) continue;
        addTree(x, CURB_HEIGHT, z, r.range(0, 6.28), r.range(1.0, 1.5), r);
      }
      for (let i = 0; i < 10; i++) { const x = r.range(ix0 + 4, ix1 - 4); props.add('bench', x, CURB_HEIGHT, (iz0 + iz1) / 2 + 3.6, Math.PI); physics.addStaticBox(x, 0.45, (iz0 + iz1) / 2 + 3.6, 0.95, 0.45, 0.35); }
      for (let i = 0; i < 26; i++) props.add(`shrub${r.int(0, 1)}`, r.range(ix0 + 2, ix1 - 2), CURB_HEIGHT, r.range(iz0 + 2, iz1 - 2), r.range(0, 6), r.range(0.8, 1.5));
      // paths through the park
      const tb = trim.at((ix0 + ix1) / 2, (iz0 + iz1) / 2);
      tb.box((ix0 + ix1) / 2, CURB_HEIGHT + 0.02, (iz0 + iz1) / 2, ix1 - ix0, 0.04, 4.2, 0, C('#b7ab95'), T_STONE);
      tb.box((ix0 + ix1) / 2, CURB_HEIGHT + 0.02, (iz0 + iz1) / 2, 4.2, 0.04, iz1 - iz0, 0, C('#b7ab95'), T_STONE);
      for (let i = 0; i < 8; i++) { const x = ix0 + (ix1 - ix0) * (i + 0.5) / 8; const p = { x, z: (iz0 + iz1) / 2 - 2.8 }; props.add('streetlight', p.x, CURB_HEIGHT, p.z, 0); }
    } else if (b.kind === 'plaza' || b.district === 'heights') {
      for (let i = 0; i < (b.kind === 'plaza' ? 14 : 5); i++) {
        const x = r.range(ix0 + 4, ix1 - 4), z = r.range(iz0 + 4, iz1 - 4);
        if (merged.some(l => l.blockId === b.id && Math.abs(l.x - x) < l.w / 2 + 3 && Math.abs(l.z - z) < l.d / 2 + 3)) continue;
        if (x < GAS_STATION.x + 25 && x > GAS_STATION.x - 20 && z > GAS_STATION.z - 40 && z < GAS_STATION.z + 16) continue;
        addTree(x, CURB_HEIGHT, z, r.range(0, 6.28), 1.1, r);
        trim.at(x, z).box(x, CURB_HEIGHT + 0.25, z, 2.6, 0.5, 2.6, 0, C('#a8a296'), T_STONE);
      }
    } else if (b.district === 'hillside') {
      for (let i = 0; i < 14; i++) { const x = r.range(ix0 + 12, ix1 - 12), z = r.range(iz0 + 12, iz1 - 12); addTree(x, CURB_HEIGHT, z, r.range(0, 6.28), r.range(1.0, 1.4), r); }
      for (let i = 0; i < 16; i++) props.add(`shrub${r.int(0, 1)}`, r.range(ix0 + 11, ix1 - 11), CURB_HEIGHT, r.range(iz0 + 11, iz1 - 11), r.range(0, 6), r.range(0.9, 1.6));
    } else if (b.kind === 'buildings') {
      // courtyard clutter: dumpsters behind the buildings
      for (let i = 0; i < 3; i++) {
        const x = r.range(ix0 + 12, ix1 - 12), z = r.chance(0.5) ? iz0 + 10.9 : iz1 - 10.9;
        props.add(`dumpster${r.int(0, 1)}`, x, CURB_HEIGHT, z, z < (iz0 + iz1) / 2 ? Math.PI : 0); physics.addStaticBox(x, 0.75, z, 1.05, 0.75, 0.7);
      }
    }
  }
  // woods on the northern hills (clear of roads, the freeway corridor, the channel, the airfield plain and pads)
  { const hr = new Rng(404); let placed = 0;
    for (let k = 0; k < 2600 && placed < 520; k++) {
      const x = hr.range(-1000, 1000), z = hr.range(-1150, -505);
      if (x > CHANNEL.x0 - 40 && (z > -790 || x < CHANNEL.x1 + 20)) continue;
      if (nearPath(x, z, 10) || Math.hypot(x - (-40), z - (-868)) < 45) continue;
      const y = terrainH(x, z); if (y < 1) continue;
      const k2 = hr.int(0, 3), sc = hr.range(1.0, 1.6), yaw = hr.range(0, 6.28);
      props.add(`tree${k2}`, x, y - 0.2, z, yaw, sc); props.add(`leaf${k2}`, x, y - 0.2, z, yaw, sc); placed++;
    } }
  // beach palms (kept clear of the landing strip in front of each beach ramp)
  { const pr = new Rng(91); for (let x = minX + 12; x < maxX - 8; x += 26) { if (RAMPS.some(r => r.z < maxZ + 10 && x > r.x - 9 && x < r.x + 80)) continue; const z = maxZ + 12 + Math.sin(x) * 3; addPalm(x, CURB_HEIGHT - 0.3 - (z - maxZ - 7) * 0.058, z, x, pr, false); } }
  // billboards on poles along the edge of the city
  { const br = new Rng(5); for (let k = 0; k < 6; k++) { const x = -380 + k * 150 + br.range(-20, 20); if (nearPath(x, minZ - 14, 14)) continue; addBillboard({ x, y: 0, z: minZ - 14, yaw: 0, idx: k % 8, w: 12 }); } }

  // Visible city edge: guardrail along the boundary walls with a tree line beyond.
  {
    const tb = trim.at(minX, minZ);
    const railC = C('#c8c2b4'), postC = C('#5e5a55');
    const edgeX = minX - 5.2, edgeZ = minZ - 5.2;
    for (let z = edgeZ; z < maxZ + 7; z += 3) trim.at(edgeX, z).box(edgeX, 0.45, z, 0.16, 0.9, 0.16, 0, postC, T_METAL);
    for (let z = edgeZ; z < maxZ + 7; z += 60) trim.at(edgeX, z).box(edgeX + 0.1, 0.7, Math.min(z + 30, maxZ + 7 - 30), 0.08, 0.3, 60, 0, railC, T_METAL);
    for (let x = edgeX; x < maxX + 2; x += 3) if (!nearPath(x, edgeZ, 2)) trim.at(x, edgeZ).box(x, 0.45, edgeZ, 0.16, 0.9, 0.16, 0, postC, T_METAL);
    for (let x = edgeX; x < maxX + 2; x += 6) if (!nearPath(x, edgeZ, 4) && !nearPath(x + 6, edgeZ, 4)) trim.at(x, edgeZ).box(x + 3, 0.7, edgeZ + 0.1, 6, 0.3, 0.08, 0, railC, T_METAL);
    void tb;
    const tr = new Rng(77);
    for (let z = edgeZ + 4; z < maxZ; z += tr.range(5, 9)) { const k = tr.int(0, 3), x = edgeX - tr.range(6, 22), s = tr.range(1.1, 1.7); props.add(`tree${k}`, x, 0, z, tr.range(0, 6.28), s); props.add(`leaf${k}`, x, 0, z, tr.range(0, 6.28), s); }
    for (let x = edgeX + 4; x < maxX; x += tr.range(5, 9)) { const k = tr.int(0, 3), z = edgeZ - tr.range(6, 22), s = tr.range(1.1, 1.7); if (nearPath(x, z, 7)) continue; props.add(`tree${k}`, x, 0, z, 0, s); props.add(`leaf${k}`, x, 0, z, 0, s); }
  }

  // ---------- Gas station forecourt ----------
  {
    const G = GAS_STATION; const tb = trim.at(G.x, G.z);
    const conc = C('#a9a69f');
    tb.box(G.x, CURB_HEIGHT + 0.01, G.z, G.w + 6, 0.03, G.d + 6, 0, conc, T_STONE);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = G.x + dx * (G.w / 2 - 1.5), z = G.z + dz * (G.d / 2 - 2); tb.box(x, CURB_HEIGHT + 2.6, z, 0.5, 5.2, 0.5, 0, C('#e8e6e0'), T_PAINT); physics.addStaticBox(x, 2.6, z, 0.25, 2.6, 0.25); }
    tb.box(G.x, CURB_HEIGHT + 5.6, G.z, G.w, 0.8, G.d, 0, C('#f2f0ea'), T_PAINT);
    tb.box(G.x, CURB_HEIGHT + 5.6, G.z, G.w + 0.08, 0.5, G.d + 0.08, 0, C('#0f7b4f'), T_PAINT);
    for (let i = 0; i < 6; i++) tb.box(G.x + (i % 2 ? 3 : -3), CURB_HEIGHT + 5.17, G.z - 7 + Math.floor(i / 2) * 7, 1.6, 0.05, 1.6, 0, C('#fffbf0'), T_GLOW(2.5));
    for (const dz of [-6, 0, 6]) {
      const z = G.z + dz;
      tb.box(G.x, CURB_HEIGHT + 0.12, z, 1.4, 0.24, 5.2, 0, C('#d9d6cf'), T_STONE);
      for (const sz of [-1.3, 1.3]) { tb.box(G.x, CURB_HEIGHT + 1.15, z + sz, 0.8, 1.8, 0.5, 0, C('#e9e7e1'), T_PAINT); tb.box(G.x, CURB_HEIGHT + 1.75, z + sz, 0.82, 0.4, 0.52, 0, C('#0f7b4f'), T_PAINT); tb.box(G.x + 0.42, CURB_HEIGHT + 1.35, z + sz, 0.02, 0.3, 0.3, 0, C('#9fe6c0'), T_GLOW(0.8)); }
      physics.addStaticBox(G.x, 1.0, z, 0.7, 1.0, 2.6);
    }
    // price sign on a pylon by the avenue
    tb.box(G.x - G.w / 2 - 2, CURB_HEIGHT + 3.5, G.z + G.d / 2 + 1, 0.4, 7, 0.4, 0, C('#3a3a3a'), T_METAL);
    tb.box(G.x - G.w / 2 - 2, CURB_HEIGHT + 6.2, G.z + G.d / 2 + 1, 0.3, 2.2, 2.6, 0, C('#0f7b4f'), T_PAINT);
    tb.box(G.x - G.w / 2 - 2.17, CURB_HEIGHT + 6.0, G.z + G.d / 2 + 1, 0.02, 1.4, 2.2, 0, C('#ffe9a8'), T_NIGHTGLOW(2));
    physics.addStaticCylinder(G.x - G.w / 2 - 2, 3.5, G.z + G.d / 2 + 1, 3.5, 0.3);
  }
  HELIPADS.length = 0; HELIPADS.push(...helipads, ...exp.helipads);
  lampHeads.push(...exp.lampHeads);

  // ---------- Pier and Ferris wheel landmark ----------
  const ferris = buildPier(root, physics, trim, maxZ + 7);

  // ---------- Emit meshes ----------
  const bmat = buildingMaterial();
  chunkMeshes.push(...fac.meshes(bmat, root, { name: 'facade' }).map(m => { m.userData.farScale = 1.9; return m; }));
  chunkMeshes.push(...trim.meshes(tmat, root, { name: 'trim', small: true }));
  if (bg.length) { const bm = new THREE.Mesh(mergeGeoms(bg), bbMat); root.add(bm); }
  chunkMeshes.push(...props.build(root).map(m => { m.userData.small = true; return m; }));
  void T_PAINT; void T_NIGHTGLOW;
  return { root, lampHeads, signalHeads, signalLamps, chunkMeshes, ferris, water, helipads };
}

function mergeGeoms(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const g0 of gs) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...(g.attributes.position.array as Float32Array)); nor.push(...(g.attributes.normal.array as Float32Array)); uv.push(...(g.attributes.uv.array as Float32Array)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere(); return g;
}

/** Merges runs of adjacent lots on the same block side into wider buildings (mid-rises, some walk-ups). */
function mergeLots(city: CityMap): Lot[] {
  const out: Lot[] = [];
  const lots = city.lots;
  let i = 0;
  while (i < lots.length) {
    const a = lots[i]; const r = new Rng(a.seed + 1);
    const b = city.blocks[a.blockId];
    const want = storeAt(a.x, a.z) ? 1 : a.kind === 'midrise' ? r.int(1, 3) : a.kind === 'brownstone' && b.district !== 'hillside' && r.chance(0.25) ? 2 : 1;
    let j = i + 1;
    while (j < lots.length && j - i < want) {
      const n = lots[j], p = lots[j - 1];
      if (storeAt(n.x, n.z) || n.blockId !== a.blockId || n.rot !== a.rot || n.kind !== a.kind || Math.abs(Math.hypot(n.x - p.x, n.z - p.z) - p.w) > 0.2) break;
      j++;
    }
    const run = lots.slice(i, j);
    if (run.length === 1) out.push(a);
    else {
      const x = run.reduce((s, l) => s + l.x, 0) / run.length, z = run.reduce((s, l) => s + l.z, 0) / run.length;
      out.push({ ...a, x, z, w: a.w * run.length });
    }
    i = j;
  }
  return out;
}

function physicsSlope(physics: Physics, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, q: THREE.Quaternion) {
  const c = physics.addStaticBox(cx, cy, cz, hx, hy, hz);
  c.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
}

function buildPier(root: THREE.Group, physics: Physics, trim: Chunked<TrimBuilder>, startZ: number): THREE.Object3D {
  const x = -50, w = 16, len = 150, deckY = 1.2;
  const wood = new THREE.Color('#7a5a40'), dark = new THREE.Color('#4d3a2a');
  const T = (zz: number) => trim.at(x, zz);
  T(startZ + len / 2).box(x, deckY - 0.3, startZ + len / 2, w, 0.4, len, 0, dark, [0.9, 0, 2, 0]);
  physics.addStaticBox(x, deckY - 0.25, startZ + len / 2, w / 2, 0.25, len / 2);
  const rampLen = 7, rampZ0 = startZ - rampLen, rise = deckY - CURB_HEIGHT;
  const rampAng = Math.atan2(rise, rampLen), rampHyp = Math.hypot(rampLen, rise);
  const ramp = physics.addStaticBox(x, (CURB_HEIGHT + deckY) / 2 - 0.25 / Math.cos(rampAng), rampZ0 + rampLen / 2, w / 2, 0.25, rampHyp / 2 + 0.05);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -rampAng);
  ramp.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  for (let z = startZ + 4; z < startZ + len; z += 8) for (const dx of [-w / 2 + 0.5, w / 2 - 0.5, 0]) T(z).cyl(x + dx, -6, z, 0.3, 0.3, deckY - 0.4 + 6, 8, new THREE.Color('#3f3226'), [0.95, 0, 2, 0]);
  const railCol = new THREE.Color('#e4dccb');
  for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) {
    for (let z = startZ + 2; z < startZ + len - 2; z += 30) { const zz = Math.min(z + 15, startZ + len - 17); T(zz).box(x + dx, deckY + 1.03, zz, 0.12, 0.1, 30, 0, railCol, T_PAINT); T(zz).box(x + dx, deckY + 0.53, zz, 0.06, 0.06, 30, 0, railCol, T_PAINT); }
    for (let z = startZ + 2; z <= startZ + len - 0.2; z += 2.5) T(z).box(x + dx, deckY + 0.54, z, 0.12, 1.08, 0.12, 0, railCol, T_PAINT);
    physics.addStaticBox(x + dx, deckY + 0.5, startZ + len / 2 + 2, 0.1, 0.55, (len - 4) / 2);
  }
  T(startZ + len).box(x, deckY + 1.03, startZ + len - 0.15, w, 0.1, 0.12, 0, railCol, T_PAINT);
  for (let xx = x - w / 2 + 0.15; xx <= x + w / 2; xx += 2.5) T(startZ + len).box(xx, deckY + 0.54, startZ + len - 0.15, 0.12, 1.08, 0.12, 0, railCol, T_PAINT);
  physics.addStaticBox(x, deckY + 0.5, startZ + len - 0.15, w / 2, 0.55, 0.1);
  // food kiosk on the pier
  { const tb = T(startZ + 40); tb.box(x - 3, deckY + 1.6, startZ + 40, 6, 3.2, 5, 0, new THREE.Color('#2f8f8a'), T_PAINT); tb.box(x - 3, deckY + 3.3, startZ + 40.6, 6.8, 0.15, 6.4, 0, new THREE.Color('#e9d9b8'), [0.85, 0, 1, 0], 0.06); tb.box(x - 3, deckY + 2.0, startZ + 42.52, 4.6, 1.2, 0.04, 0, new THREE.Color('#fff0c8'), T_NIGHTGLOW(1.5)); }
  physics.addStaticBox(x - 3, deckY + 1.6, startZ + 40, 3, 1.6, 2.5);
  // lamp posts along the pier
  for (let z = startZ + 12; z < startZ + len - 10; z += 24) for (const dx of [-w / 2 + 0.6, w / 2 - 0.6]) { const tb = T(z); tb.cyl(x + dx, deckY, z, 0.08, 0.06, 3.6, 8, new THREE.Color('#2d3033'), T_METAL); tb.sphere(x + dx, deckY + 3.75, z, 0.22, new THREE.Color('#fff1d6'), T_NIGHTGLOW(5)); }
  // plank deck surface
  const pc = document.createElement('canvas'); pc.width = 256; pc.height = 256; const g2 = pc.getContext('2d')!;
  for (let i = 0; i < 16; i++) { const v = 128 + ((i * 37) % 23) - 11; g2.fillStyle = `rgb(${v},${Math.round(v * 0.8)},${Math.round(v * 0.62)})`; g2.fillRect(0, i * 16, 256, 15); g2.fillStyle = 'rgba(30,20,12,0.65)'; g2.fillRect(0, i * 16 + 15, 256, 1); g2.fillRect((i * 97) % 256, i * 16, 1, 15); }
  for (let i = 0; i < 600; i++) { g2.fillStyle = `rgba(50,35,22,${0.05 + (i % 5) * 0.03})`; g2.fillRect((i * 53) % 256, (i * 29) % 256, 6 + (i % 9), 1); }
  const ptex = new THREE.CanvasTexture(pc); ptex.wrapS = ptex.wrapT = THREE.RepeatWrapping; ptex.colorSpace = THREE.SRGBColorSpace; ptex.repeat.set(w / 4, len / 4); ptex.anisotropy = 8;
  const deckMat = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.85 });
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), deckMat);
  deck.position.set(x, deckY + 0.006, startZ + len / 2); deck.receiveShadow = true; root.add(deck);
  const rampMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, rampHyp + 5).rotateX(-Math.PI / 2), deckMat);
  rampMesh.position.set(x, (deckY + CURB_HEIGHT) / 2 + 0.01, startZ - 2); rampMesh.rotateX(-Math.atan2(deckY - CURB_HEIGHT, 12)); rampMesh.receiveShadow = true; root.add(rampMesh);
  for (const sx of [-1, 1]) T(rampZ0).box(x + sx * (w / 2 - 0.1), deckY * 0.3, rampZ0 + rampLen / 2, 0.2, deckY * 0.6, rampLen, 0, wood, T_PAINT);
  // Ferris wheel: merged frame + instanced gondolas that stay level
  const wheel = new THREE.Group();
  const radius = 22, cy = deckY + radius + 3, cz = startZ + len - 26;
  const ringMat = new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.5, metalness: 0.3, emissive: new THREE.Color('#ff9a6a'), emissiveIntensity: 0 });
  const frame = new TrimBuilder();
  const fc = new THREE.Color('#e8e2d6');
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; for (const zz of [-1.6, 1.6]) frame.beam(0, 0, zz, Math.cos(a) * radius, Math.sin(a) * radius, zz, 0.18, 0.18, fc, T_PAINT); frame.beam(Math.cos(a) * radius, Math.sin(a) * radius, -1.6, Math.cos(a) * radius, Math.sin(a) * radius, 1.6, 0.14, 0.14, fc, T_PAINT); }
  frame.cyl(0, -2, 0, 1.2, 1.2, 4, 12, new THREE.Color('#9a958a'), T_METAL, 0, Math.PI / 2);
  const ringG = new THREE.TorusGeometry(radius, 0.35, 6, 64);
  const ring = new THREE.Mesh(ringG, ringMat); ring.position.z = -1.6; const ring2 = new THREE.Mesh(ringG, ringMat); ring2.position.z = 1.6;
  const frameMesh = new THREE.Mesh(frame.build(), trimMaterial());
  wheel.add(ring, ring2, frameMesh);
  const gondMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
  const gondGeo = new THREE.CylinderGeometry(1.1, 1.3, 2.2, 10);
  const gondInst = new THREE.InstancedMesh(gondGeo, gondMat, 16);
  const gondolas: THREE.Object3D[] = [];
  const gcol = [new THREE.Color('#e05a4f'), new THREE.Color('#2f8f9a'), new THREE.Color('#f2c14e'), new THREE.Color('#6a4c93')];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const g = new THREE.Object3D(); g.position.set(Math.cos(a) * radius, Math.sin(a) * radius - 1.6, 0); g.userData.angle = a; wheel.add(g); gondolas.push(g); gondInst.setColorAt(i, gcol[i % 4]); }
  gondInst.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  gondInst.onBeforeRender = () => { gondolas.forEach((g, i) => { g.updateMatrix(); m4.copy(g.matrix); gondInst.setMatrixAt(i, m4); }); gondInst.instanceMatrix.needsUpdate = true; };
  wheel.add(gondInst);
  wheel.position.set(x + 2, cy, cz);
  for (const s of [-1, 1]) for (const dz of [-1, 1]) {
    const tb = T(cz);
    tb.beam(x + 2, cy, cz + s * 3, x + 2 + dz * 12, deckY, cz + s * 3.6, 0.6, 0.6, new THREE.Color('#d8d2c4'), T_PAINT);
    physics.addStaticCylinder(x + 2 + dz * 6.2 * 1.5, deckY + 2, cz + s * 3, 2, 0.6);
  }
  wheel.traverse(o => { o.castShadow = true; });
  wheel.userData.gondolas = gondolas; wheel.userData.ringMat = ringMat;
  root.add(wheel);
  return wheel;
}
