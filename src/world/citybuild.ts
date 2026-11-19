/** Builds Port Meridian's meshes and static colliders from the pure city layout. */
import { worldGlass } from './glass';
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { RAMPS, HELIPADS, GAS_STATION, POLICE_STATION, storeAt, STORE_H } from '../game/places';
import { buildIsland } from './islandbuild';
import { buildFlatiron } from './flatiron';
import { diagTriangles } from './broadway';
import { RAPIER, groups, G_STATIC, ALL } from '../core/physics';
import { buildTerrain, makeTerrainHeight, NORTH_EDGE } from './terrain';
import { buildExpansion, expansionPads } from './expansion';
import { buildWest } from './westbuild';
import { buildEast } from './eastbuild';
import { buildQuay } from './quaybuild';
import { CHANNEL, EAST_SHORE, pathHeightAt } from './citymap';
import { signalPosts } from './signals';
import { buildPrecinct, precinctFootprint } from './precinct';
import type { Physics } from '../core/physics';
import type { Assets } from './assets';
import {
  type CityMap, type Lot, type Block, AVENUES, STREETS, ISLAND_LEFT, WEST_RIVER, MAINLAND_Z1, lanesForStreet, CURB_HEIGHT, SIDEWALK, LANE_WIDTH, COAST_Z, HARBOR_X, WATER_LEVEL, SEABED_Y, SEA_EDGE_X, SEA_EDGE_Z, halfWidth,
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
  LAMP, streetLightGeo, signalGeo, SIGNAL_LENS_R, SIGNAL_LENS_DY, hydrantGeo, benchGeo, binGeo, busStopGeo, phoneGeo, newsBoxesGeo, meterGeo, mailboxGeo, dumpsterGeo, bollardGeo,
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
  release() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
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
    this.release();
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
  const wht = C("#ffffff");
  // island ground: one strip per block row (the grid tapers toward the south tip), the mainland across the river, the shores north and east
  const strips: [number, number, number, number][] = []; // x0, z0, x1, z1
  for (let j = 0; j < ISLAND_LEFT.length; j++) strips.push([AVENUES[ISLAND_LEFT[j]] - 14, j === 0 ? NORTH_EDGE : STREETS[j] - 8, maxX + 2, STREETS[j + 1] + 8]);
  strips.push([-1400, NORTH_EDGE, WEST_RIVER.x0, MAINLAND_Z1]);
  strips.push([maxX, NORTH_EDGE, CHANNEL.x0, -62], [CHANNEL.x1, NORTH_EDGE, 1400, -62], [-1400, -1400, -1104, NORTH_EDGE]);
  strips.push([EAST_SHORE.x0, EAST_SHORE.z0, EAST_SHORE.x1, EAST_SHORE.z1]); // Eastbank across the East River
  for (const [x0, z0, x1, z1] of strips) slab(land, x0, z0, x1, z1, -0.05, -0.05, wht, wht, 7);
  const landMesh = new THREE.Mesh(land.build(), grassMat); landMesh.receiveShadow = true; root.add(landMesh);
  // Ground as 200 m tiles: one huge box loses contact precision for the character controller.
  // Only land gets ground; everything else is open water down to a seabed (swim, sink).
  const tileRect = (x0: number, z0: number, x1: number, z1: number, top: number) => {
    for (let gx = x0; gx < x1; gx += 200) for (let gz = z0; gz < z1; gz += 200) {
      const ex = Math.min(gx + 200, x1), ez = Math.min(gz + 200, z1);
      physics.addStaticBox((gx + ex) / 2, top - 0.5, (gz + ez) / 2, (ex - gx) / 2, 0.5, (ez - gz) / 2);
    }
  };
  for (const [x0, z0, x1, z1] of [...strips.slice(0, ISLAND_LEFT.length + 3), strips[strips.length - 1]]) tileRect(Math.max(x0, -1500), z0, x1, z1, -0.05);
  tileRect(CHANNEL.x0, -1500, CHANNEL.x1, -62, SEABED_Y); // channel bed
  tileRect(WEST_RIVER.x0, -700, WEST_RIVER.x1, NORTH_EDGE, SEABED_Y); // river bed up the carved valley
  // outer limits beyond the terrain
  physics.addStaticBox(-1090, 20, -850, 2, 60, 460); physics.addStaticBox(1090, 20, -700, 2, 60, 640); physics.addStaticBox(0, 20, -1290, 1100, 60, 2);
  tileRect(-1500, NORTH_EDGE, maxX + 2, SEA_EDGE_Z, SEABED_Y); // seabed under the island, the river and the sea
  tileRect(maxX + 2, -62, SEA_EDGE_X, SEA_EDGE_Z, SEABED_Y); // harbor, East River and sea floor
  physics.addStaticBox(0, -2, SEA_EDGE_Z, 1500, 8, 1);
  physics.addStaticBox(SEA_EDGE_X, 6, (SEA_EDGE_Z - 62) / 2, 1, 14, (SEA_EDGE_Z + 62) / 2);

  const asphaltS = asphaltSurface();
  const asphaltMat = surfaceMat(asphaltS, 1, {}, 0.2, 'asphalt');
  const road = new GeoBuilder();
  for (let j = 0; j < ISLAND_LEFT.length; j++) slab(road, AVENUES[ISLAND_LEFT[j]] - halfWidth(2), j === 0 ? minZ : STREETS[j] - halfWidth(lanesForStreet(j)), maxX, j === ISLAND_LEFT.length - 1 ? maxZ : STREETS[j + 1] + halfWidth(lanesForStreet(j + 1)), 0, 0, C('#ffffff'), C('#ffffff'), 12);
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
        float shoreS = smoothstep(${(COAST_Z - 5).toFixed(1)}, ${(COAST_Z - 13).toFixed(1)}, vW.z) * step(${(COAST_Z - 20).toFixed(1)}, vW.z) * step(vW.x, ${(HARBOR_X - 2).toFixed(1)}) * step(${(AVENUES[ISLAND_LEFT[ISLAND_LEFT.length - 1]] - 14).toFixed(1)}, vW.x);
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
  // Broadway cuts three blocks into triangles: raised pavement triangles either side of a street-level channel
  const triPrism = (gb: GeoBuilder, t0: { x: number; z: number }[], y0: number, y1: number, top: THREE.Color, side: THREE.Color) => {
    let t = t0;
    if ((t[1].x - t[0].x) * (t[2].z - t[0].z) - (t[1].z - t[0].z) * (t[2].x - t[0].x) < 0) t = [t[0], t[2], t[1]];
    const V = (p: { x: number; z: number }, y: number) => new THREE.Vector3(p.x, y, p.z);
    gb.quad(V(t[0], y1), V(t[1], y1), V(t[2], y1), V(t[2], y1), [t[0].x / 6, t[0].z / 6, t[1].x / 6, t[1].z / 6, t[2].x / 6, t[2].z / 6, t[2].x / 6, t[2].z / 6], top);
    const h = (y1 - y0) / 6;
    for (let i = 0; i < 3; i++) { const a = t[i], b = t[(i + 1) % 3], len = Math.hypot(b.x - a.x, b.z - a.z) / 6; gb.quad(V(a, y0), V(b, y0), V(b, y1), V(a, y1), [0, 0, len, 0, len, h, 0, h], side); }
  };
  const buildDiagBlock = (b: Block) => {
    const cc = C('#b9b5ad'), ch = CURB_HEIGHT + 0.012, tri = diagTriangles(b.x0, b.z0, b.x1, b.z1);
    for (const t of [tri.ne, tri.sw]) {
      triPrism(walks, t, 0, CURB_HEIGHT, C('#ffffff'), C('#c8c4bb'));
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(t.flatMap(p => [p.x, -0.3, p.z, p.x, CURB_HEIGHT, p.z])));
      if (desc) physics.tag(physics.world.createCollider(desc.setFriction(0.8).setCollisionGroups(groups(G_STATIC, ALL))), { kind: 'static' });
      for (let i = 0; i < 3; i++) {
        const a = t[i], e = t[(i + 1) % 3], len = Math.hypot(e.x - a.x, e.z - a.z), mx = (a.x + e.x) / 2, mz = (a.z + e.z) / 2;
        trim.at(mx, mz).box(mx, ch / 2, mz, len, ch, 0.3, -Math.atan2(e.z - a.z, e.x - a.x), cc, T_STONE);
      }
    }
  };
  for (const b of city.blocks) {
    if (b.diag) { buildDiagBlock(b); continue; }
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
  const tipX = AVENUES[ISLAND_LEFT[ISLAND_LEFT.length - 1]] - 14; // west end of the south tip
  slab(walks, tipX, maxZ, maxX, maxZ + 7, CURB_HEIGHT, CURB_HEIGHT, C('#f2e4cc'), C('#c8c4bb'), 6); // flat, kerbed like every other sidewalk (it used to ramp up from road level)
  {
    // proper kerb, painted road edge, and a planter/lamp/bollard buffer so the promenade does not start right at the asphalt
    const stoneC = C('#bdb8ac'), potC = C('#6c6a64'), lampC = C('#2b2e31');
    for (let x0 = tipX; x0 < maxX; x0 += 60) {
      const l = Math.min(60, maxX - x0), cx = x0 + l / 2, tb = trim.at(cx, maxZ);
      tb.box(cx, CURB_HEIGHT / 2, maxZ + 0.17, l, CURB_HEIGHT, 0.34, 0, stoneC, T_STONE);
      tb.box(cx, 0.012, maxZ - 0.55, l, 0.01, 0.14, 0, C('#f2f0e6'), T_PAINT);
    }
    for (let x = tipX + 8; x < maxX - 6; x += 15) {
      const tb = trim.at(x, maxZ + 1.7);
      if (RAMPS.some(r => r.z < maxZ + 10 && x > r.x - 12 && x < r.x + 82) || (x + 9 > -68 && x - 3 < -32)) continue; // keep the pier approach (x -50, 16 wide) and ramps clear
      tb.box(x, CURB_HEIGHT + 0.4, maxZ + 1.9, 1.5, 0.8, 0.9, 0, potC, T_STONE); tb.sphere(x, CURB_HEIGHT + 1.0, maxZ + 1.9, 0.55, C('#3d6a3c'), [0.9, 0, 1, 0], 0.8);
      tb.cyl(x + 7.5, CURB_HEIGHT, maxZ + 1.5, 0.07, 0.05, 4.2, 8, lampC, T_METAL); tb.sphere(x + 7.5, CURB_HEIGHT + 4.3, maxZ + 1.5, 0.22, C('#fff1d6'), T_NIGHTGLOW(5));
      physics.addStaticCylinder(x + 7.5, CURB_HEIGHT + 2, maxZ + 1.5, 2, 0.1);
    }
  }
  physics.addStaticBox((tipX + maxX) / 2, CURB_HEIGHT / 2, maxZ + 3.5, (maxX - tipX) / 2, CURB_HEIGHT / 2, 3.5);
  slab(walks, maxX, -62, HARBOR_X, maxZ + 7, -3, CURB_HEIGHT, C('#c4beb4'), C('#8d8780'), 6);
  physics.addStaticBox((maxX + HARBOR_X) / 2, (CURB_HEIGHT - 3) / 2, (maxZ + 7 - 62) / 2, (HARBOR_X - maxX) / 2, (CURB_HEIGHT + 3) / 2, (maxZ + 7 + 62) / 2);
  const walkMesh = new THREE.Mesh(walks.build(), paveMat); walkMesh.receiveShadow = true; root.add(walkMesh);
  const innerMat = surfaceMat(asphaltS, 1, { vertexColors: true }, 0.2, 'asphalt-inner');
  const innerMesh = new THREE.Mesh(inner.build(), innerMat); innerMesh.receiveShadow = true; root.add(innerMesh);
  const gi = new THREE.Mesh(grassInner.build(), grassMat); gi.receiveShadow = true; root.add(gi);

  // Beach: sloping sand from the promenade into the sea.
  const sandS = sandSurface();
  const beachGeo = new THREE.PlaneGeometry(maxX + 300 - tipX, 90, 120, 18).rotateX(-Math.PI / 2);
  const bp = beachGeo.attributes.position, buv = beachGeo.attributes.uv;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i) + (tipX + maxX + 300) / 2, z = bp.getZ(i) + maxZ + 7 + 45;
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
    physicsSlope(physics, (tipX + maxX + 300) / 2, cy, cz, (maxX + 300 - tipX) / 2, 0.5, Math.hypot(len, drop) / 2, q);
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
  mkHill(-1215, 170, 1150, 220, -Math.PI / 2, 60, 2); // far west, behind the Old Town extension
  const hills = new THREE.Mesh(mergeColored(hillParts), hillMat); hills.receiveShadow = true; root.add(hills);
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
    if (b.kind !== 'buildings' || b.district === 'heights' || b.district === 'hillside' || b.diag) continue;
    const x0 = b.x0 + SIDEWALK + 10, x1 = b.x1 - SIDEWALK - 10, z0 = b.z0 + SIDEWALK + 10, z1 = b.z1 - SIDEWALK - 10;
    const yy = CURB_HEIGHT + 0.025;
    const line = (ax: number, az: number, bx: number, bz: number, wdt = 0.12) => rect(ax - (az === bz ? 0 : wdt / 2), az - (az === bz ? wdt / 2 : 0), bx + (az === bz ? 0 : wdt / 2), bz + (az === bz ? wdt / 2 : 0), white, yy);
    for (let x = x0 + 2; x <= x1 - 2; x += 3) { line(x, z0 + 0.3, x, z0 + 5.3); line(x, z1 - 5.3, x, z1 - 0.3); }
    line(x0 + 2, z0 + 5.3, x1 - 2 - ((x1 - x0 - 4) % 3), z0 + 5.3); line(x0 + 2, z1 - 5.3, x1 - 2 - ((x1 - x0 - 4) % 3), z1 - 5.3);
  }
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: paintWearTexture(), alphaTest: 0.5, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const marks = new THREE.Mesh(mk.build(), markMat); marks.receiveShadow = true; root.add(marks);

  // ---------- Buildings ----------
  worldGlass.reset();
  const fac = new Chunked(250, () => new FacadeBuilder());
  const signs: SignSpec[] = [], billboards: BillboardSpec[] = [], helipads: Helipad[] = [];
  const merged = mergeLots(city);
  const occ = merged.map(m => { const swap = Math.abs(Math.sin(m.rot)) > 0.7; return { x: m.x, z: m.z, hw: (swap ? m.d : m.w) / 2, hd: (swap ? m.w : m.d) / 2 }; });
  const occupied = (x: number, z: number) => occ.some(o => Math.abs(x - o.x) < o.hw && Math.abs(z - o.z) < o.hd);
  const ctx: BuildCtx = { fac, trim, physics, signs, billboards, helipads, exposed: (x, z) => !occupied(x, z) };
  const towerLots = merged.filter(l => l.kind === 'tower' && l.blockId >= 0 && city.blocks[l.blockId].district === 'heights').sort((a, b) => b.height - a.height);
  const padNames = ['Meridian Tower helipad', 'Heights Plaza helipad', 'Cobalt Center helipad'];
  const pf = precinctFootprint();
  const policeLot = (l: Lot) => { const sw = Math.abs(Math.sin(l.rot)) > 0.7, hw = (sw ? l.d : l.w) / 2, hd = (sw ? l.w : l.d) / 2; return l.x + hw > pf.x0 && l.x - hw < pf.x1 && l.z + hd > pf.z0 && l.z - hd < pf.z1; };
  for (const lot of merged) {
    const b = lot.blockId >= 0 ? city.blocks[lot.blockId] : { district: lot.district ?? 'oldtown' };
    const r = new Rng(lot.seed);
    if (policeLot(lot)) continue;
    if (lot.kind === 'tower') {
      const rank = towerLots.indexOf(lot);
      tower(ctx, { cx: lot.x, cz: lot.z, w: lot.w, d: lot.d, base: CURB_HEIGHT, height: lot.height * 1.45, seed: lot.seed, helipad: rank >= 0 && rank < 3 ? padNames[rank] : null, yaw: lot.blockId >= 0 && city.blocks[lot.blockId].district !== 'heights' ? lot.rot + Math.PI : 0 });
      continue;
    }
    if (lot.kind === 'warehouse') {
      warehouse(ctx, { cx: lot.x, cz: lot.z, w: lot.w - 0.5, d: lot.d, base: CURB_HEIGHT, h: lot.height || 9, seed: lot.seed, yaw: lot.rot });
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
    const brick = b.district === 'brickline' || b.district === 'oldtown' || b.district === 'eastbank' || (lot.kind === 'brownstone' && b.district === 'midtown');
    const beach = b.district === 'strand' || b.district === 'seacliff';
    const store = storeAt(lot.x, lot.z);
    const common = { cx: lot.x, cz: lot.z, yaw: lot.rot, w: lot.w - 0.06, d: lot.d, base: CURB_HEIGHT, seed: lot.seed, exposed, brand: r.int(0, BRANDS.length - 1), hollow: !!store };
    if (store) {
      streetBuilding(ctx, { ...common, floors: r.int(2, 3), floorH: 3.25, groundH: STORE_H, mat: 0, color: C(r.pick(BRICK_COLORS)), ground: 'blank', winW: 1.15, winH: 1.85, sill: 0.8, cellW: 2.6, cornice: 'heavy', fireEscape: r.chance(0.4), lit: 0.42, roofItems: r.int(1, 3), awning: false, balconies: false, trimColor: C('#d9d2c3') });
      continue;
    }
    if (beach) {
      const floors = lot.height > 0 ? Math.max(2, Math.round((lot.height - 4) / 3.2)) : r.int(2, 4);
      streetBuilding(ctx, { ...common, floors, floorH: 3.2, groundH: 4.0, mat: 1, color: C(r.pick(PASTEL_COLORS)), ground: r.chance(0.6) ? 'shop' : 'lobby', winW: 1.6, winH: 1.6, sill: 0.9, cellW: 2.8, cornice: 'bands', fireEscape: false, lit: 0.4, roofItems: r.int(1, 3), awning: r.chance(0.6), balconies: r.chance(0.5), trimColor: C('#f4efe6') });
    } else if (brick) {
      const floors = lot.height > 0 ? Math.max(2, Math.round((lot.height - 4.2) / 3.25)) : lot.w > 15 ? r.int(4, 6) : r.int(2, 5);
      const painted = r.chance(0.18);
      streetBuilding(ctx, { ...common, floors, floorH: 3.25, groundH: 4.2, mat: painted ? 6 : 0, color: painted ? C(r.pick(PLASTER_COLORS)) : C(r.pick(BRICK_COLORS)), ground: r.chance(0.6) ? 'shop' : 'resi', stoop: lot.w < 11 && r.chance(0.7), winW: 1.15, winH: 1.85, sill: 0.8, cellW: 2.6, cornice: r.chance(0.75) ? 'heavy' : 'simple', fireEscape: r.chance(0.45), lit: 0.42, roofItems: r.int(1, 4), awning: r.chance(0.5), balconies: false, trimColor: C(r.pick(['#d9d2c3', '#c9c1b0', '#e8e2d4', '#8f8a80', '#3a3a3a'])) });
    } else {
      const mat = r.pick([1, 2, 3, 3, 2, 7]);
      const floors = lot.height > 0 ? Math.max(3, Math.round((lot.height - 4.6) / 3.4)) : r.int(5, 10);
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
  buildPrecinct({ root, physics, trim, helipads, curb: CURB_HEIGHT, nightUniform });
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

  // Traffic lights: one mast arm per approach on the far-right corner (sidewalk), heads over the lanes facing traffic.
  const signalHeads: SignalHead[] = [];
  const lampPositions: { p: THREE.Vector3; f: THREE.Vector3 }[] = [];
  const armGeos = new Map<number, ReturnType<typeof signalGeo>>();
  for (const sp of signalPosts(city)) {
    const { x, z, yaw, arm } = sp;
    let sgeo = armGeos.get(arm); if (!sgeo) { sgeo = signalGeo(arm); armGeos.set(arm, sgeo); props.register(`signal${arm}`, sgeo.geo, tmat); }
    props.add(`signal${arm}`, x, CURB_HEIGHT, z, yaw);
    physics.addStaticCylinder(x, 2, z, 2, 0.17);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const hp of sgeo.heads) {
      const head: SignalHead = { inter: sp.inter, axis: sp.axis, lamps: [0, 0, 0] };
      for (let k = 0; k < 3; k++) {
        head.lamps[k] = lampPositions.length;
        const lx = hp.x, ly = hp.y + SIGNAL_LENS_DY - k * SIGNAL_LENS_DY, lz = hp.z + 0.1;
        lampPositions.push({ p: new THREE.Vector3(x + lx * c + lz * s, CURB_HEIGHT + ly, z - lx * s + lz * c), f: new THREE.Vector3(-sp.dx, 0, -sp.dz) });
      }
      signalHeads.push(head);
    }
  }
  const lampGeo = new THREE.CircleGeometry(SIGNAL_LENS_R, 16);
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
      const lake = b.ix === 4 && b.iz === 1;
      const lcx = (ix0 + ix1) / 2, lcz = (iz0 + iz1) / 2;
      if (lake) { // the park lake: three overlapping pools, shore stones, a footbridge-width path skirting it
        const wc = C('#2f6d7c');
        for (const [dx, dz, rr] of [[0, 0, 24], [16, 12, 15], [-17, -9, 14]]) trim.at(lcx + dx, lcz + dz).cyl(lcx + dx, CURB_HEIGHT + 0.005, lcz + dz, rr, rr, 0.04, 28, wc, [0.1, 0, 0, 0]);
      }
      for (let i = 0; i < (lake ? 70 : 46); i++) {
        const x = r.range(ix0 + 3, ix1 - 3), z = r.range(iz0 + 3, iz1 - 3);
        if (lake && Math.hypot(x - lcx, z - lcz) < 34) continue;
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
    } else if (b.kind === 'buildings' && !b.diag) {
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
  { const pr = new Rng(91); for (let x = tipX + 12; x < maxX - 8; x += 26) { if (RAMPS.some(r => r.z < maxZ + 10 && x > r.x - 9 && x < r.x + 80)) continue; const z = maxZ + 12 + Math.sin(x) * 3; addPalm(x, CURB_HEIGHT - 0.3 - (z - maxZ - 7) * 0.058, z, x, pr, false); } }
  // billboards on poles along the edge of the city
  { const br = new Rng(5); for (let k = 0; k < 6; k++) { const x = -380 + k * 150 + br.range(-20, 20); if (nearPath(x, minZ - 14, 14)) continue; addBillboard({ x, y: 0, z: minZ - 14, yaw: 0, idx: k % 8, w: 12 }); } }

  // Old Town + Seacliff: sidewalks, plazas, landmarks, trees for the western extension
  buildWest({ root, physics, city, trim, props, paveMat, grassMat, addTree, addPalm });
  buildFlatiron(ctx);
  buildIsland({ physics, city, trim, northEdge: NORTH_EDGE, southEdge: maxZ + 8 });
  buildEast({ root, physics, city, trim, paveMat, grassMat, addTree, addPalm });
  buildQuay({ ctx, physics, city, trim, addTree });

  // Visible city edge: guardrail along the boundary walls with a tree line beyond.
  {
    const tb = trim.at(minX, minZ);
    const railC = C('#c8c2b4'), postC = C('#5e5a55');
    const edgeX = minX - 5.2, edgeZ = minZ - 5.2;
    for (let x = edgeX; x < maxX + 2; x += 3) if (!nearPath(x, edgeZ, 2)) trim.at(x, edgeZ).box(x, 0.45, edgeZ, 0.16, 0.9, 0.16, 0, postC, T_METAL);
    for (let x = edgeX; x < maxX + 2; x += 6) if (!nearPath(x, edgeZ, 4) && !nearPath(x + 6, edgeZ, 4)) trim.at(x, edgeZ).box(x + 3, 0.7, edgeZ + 0.1, 6, 0.3, 0.08, 0, railC, T_METAL);
    void tb;
    const tr = new Rng(77);
    for (let x = edgeX + 4; x < maxX; x += tr.range(5, 9)) { const k = tr.int(0, 3), z = edgeZ - tr.range(6, 22), s = tr.range(1.1, 1.7); if (nearPath(x, z, 7)) continue; props.add(`tree${k}`, x, 0, z, 0, s); props.add(`leaf${k}`, x, 0, z, 0, s); }
  }

  // ---------- Elevated rail along Tidewell Ave (x=250) and subway entrances ----------
  {
    const RX = AVENUES[7], RY = 7.4, z0 = STREETS[3], z1 = STREETS[12];
    const conc = C('#8b8984'), steelC = C('#4f5459'), railC2 = C('#2c2d2f');
    const crossRoad = (z: number) => STREETS.some((sz, j) => Math.abs(z - sz) < halfWidth(lanesForStreet(j)) + 1.4);
    for (let z = z0 + 6; z < z1; z += 30) {
      const ze = Math.min(z + 30, z1), zm = (z + ze) / 2, tb = trim.at(RX, zm);
      tb.box(RX, RY, zm, 8.4, 0.9, ze - z, 0, conc, T_STONE); // deck
      tb.box(RX, RY - 0.65, zm, 1.4, 0.5, ze - z, 0, steelC, T_METAL);
      for (const sg of [-1, 1]) { tb.box(RX + sg * 4, RY + 0.9, zm, 0.14, 1.1, ze - z, 0, steelC, T_METAL); tb.box(RX + sg * 0.72, RY + 0.55, zm, 0.12, 0.2, ze - z, 0, railC2, T_METAL); }
      for (const sg of [-1, 1]) {
        const cz = z + 6;
        if (crossRoad(cz) || crossRoad(cz + 2)) continue;
        const cx = RX + sg * (halfWidth(2) + 0.7);
        tb.box(cx, RY / 2, cz, 0.9, RY, 0.9, 0, steelC, T_METAL);
        tb.box((cx + RX) / 2, RY - 0.55, cz, Math.abs(cx - RX), 0.7, 0.7, 0, steelC, T_METAL);
        physics.addStaticBox(cx, RY / 2, cz, 0.45, RY / 2, 0.45);
      }
    }
    // subway entrances: green-lamp stair kiosks on corner sidewalks
    const sr = new Rng(4242);
    for (let i = 1; i < AVENUES.length - 1; i += 2) for (let j = 2; j < STREETS.length - 2; j += 3) {
      const ex = AVENUES[i] + halfWidth(2) + 2.2, ez = STREETS[j] + halfWidth(lanesForStreet(j)) + 2.2;
      if (sr.chance(0.35) || city.blocks.some(b => b.kind !== 'buildings' && ex > b.x0 && ex < b.x1 && ez > b.z0 && ez < b.z1)) continue;
      if (Math.hypot(ex - POLICE_STATION.x, ez - POLICE_STATION.z) < 30) continue;
      const tb = trim.at(ex, ez);
      tb.box(ex, CURB_HEIGHT + 0.55, ez, 2.2, 1.1, 3.4, 0, steelC, T_METAL);
      tb.box(ex, CURB_HEIGHT + 1.15, ez, 2.5, 0.1, 3.7, 0, conc, T_STONE);
      for (const sg of [-1, 1]) { tb.cyl(ex + sg * 1.25, CURB_HEIGHT + 1.4, ez - 1.7, 0.05, 0.05, 2.8, 6, steelC, T_METAL); tb.sphere(ex + sg * 1.25, CURB_HEIGHT + 2.9, ez - 1.7, 0.2, C('#37d17a'), T_GLOW(2)); }
      physics.addStaticBox(ex, CURB_HEIGHT + 0.6, ez, 1.2, 0.6, 1.8);
    }
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
  root.add(worldGlass.finishOverlay());
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
    const b = a.blockId >= 0 ? city.blocks[a.blockId] : { district: a.district ?? 'oldtown' };
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
