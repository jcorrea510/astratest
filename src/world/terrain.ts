/**
 * Terrain north of the city grid: rolling hills that rise away from the freeway corridor, a flat airfield plain
 * in the north-east, the Cannery Channel cut into it, and flattened beds for the ground-level roads (Vista Drive,
 * Airfield Road), cul-de-sacs and house pads. Pure functions + one mesh/trimesh builder.
 */
import * as THREE from 'three';
import { RAPIER, groups, G_STATIC, ALL, type Physics } from '../core/physics';
import { type CityMap, type PathRoad, pathHeightAt, CHANNEL, WEST_RIVER, SEABED_Y, STREETS, CUL_DE_SAC_R, AIRFIELD } from './citymap';

export const TERRAIN = { x0: -1104, x1: 1104, z0: -1304, z1: -408, step: 8 };
/** Southern edge of the terrain (meets the flat city ground). */
export const NORTH_EDGE = STREETS[0] - 8;
export const CHANNEL_END_Z = -700;

function hash(x: number, z: number) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface Pad { x: number; z: number; r: number; y: number }
/** Natural hill height before roads are cut in. */
export function baseHeight(x: number, z: number): number {
  if (z > NORTH_EDGE) return 0;
  const s = Math.max(0, Math.min(1, (-z - 505) / 360));
  const n = vnoise(x * 0.006, z * 0.006) * 0.65 + vnoise(x * 0.017 + 4, z * 0.017) * 0.35;
  let h = Math.pow(s, 1.3) * (34 + 36 * n) + s * (vnoise(x * 0.05, z * 0.05) - 0.5) * 4;
  // the north-east plain for the airfield and Fort Calder
  const plain = smooth(530, 590, x) * smooth(AIRFIELD.z0 - 90, AIRFIELD.z0 + 10, z);
  h *= 1 - plain;
  return h;
}

/** Final terrain height: hills with road beds, pads and the channel. */
export function makeTerrainHeight(city: CityMap, pads: Pad[]) {
  const ground = city.paths.filter(p => !p.elevated);
  const deadEnds = city.intersections.filter(i => i.ix < 0 && city.paths.filter(p => p.from === i.id || p.to === i.id).length === 1 && i.z < NORTH_EDGE);
  return (x: number, z: number): number => {
    if (z > NORTH_EDGE + 4) return 0;
    let h = baseHeight(x, z);
    for (const p of ground) {
      const r = pathHeightAt(p, x, z); if (r.d > p.half + 30) continue;
      const w = 1 - smooth(p.half + 1.5, p.half + 22, r.d);
      h = h * (1 - w) + (r.y - 0.04) * w;
    }
    for (const j of deadEnds) {
      const p = ground.find(pp => pp.from === j.id || pp.to === j.id) as PathRoad | undefined; if (!p) continue;
      const y = p.to === j.id ? p.pts[p.pts.length - 1].y : p.pts[0].y;
      const d = Math.hypot(x - j.x, z - j.z); const w = 1 - smooth(CUL_DE_SAC_R, CUL_DE_SAC_R + 18, d);
      h = h * (1 - w) + (y - 0.04) * w;
    }
    for (const pad of pads) { const d = Math.hypot(x - pad.x, z - pad.z); const w = 1 - smooth(pad.r, pad.r + 14, d); h = h * (1 - w) + pad.y * w; }
    if (x > CHANNEL.x0 + 1 && x < CHANNEL.x1 - 1 && z > CHANNEL_END_Z) h = SEABED_Y;
    if (x > WEST_RIVER.x0 + 1 && x < WEST_RIVER.x1 - 1 && z > WEST_RIVER.z0) h = SEABED_Y; // the western river's valley
    return h;
  };
}

const TERRAIN_TILES_X = 8, TERRAIN_TILES_Z = 4;

/** Builds the terrain as an 8x4 grid of spatial tiles (for frustum/distance culling) and one shared Rapier trimesh collider. */
export function buildTerrain(
  root: THREE.Object3D,
  physics: Physics,
  height: (x: number, z: number) => number,
  mat: THREE.Material,
  chunkOut?: THREE.Object3D[],
): THREE.Group {
  const { x0, x1, z0, z1, step } = TERRAIN;
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * nx + i;
    pos[k * 3] = x; pos[k * 3 + 1] = height(x, z); pos[k * 3 + 2] = z; uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let ii = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
    idx[ii++] = b; idx[ii++] = c; idx[ii++] = d;
  }
  // Compute seamless normals across the whole terrain once before slicing into culled visual tiles.
  const tmpGeo = new THREE.BufferGeometry();
  tmpGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tmpGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tmpGeo.computeVertexNormals();
  const norArr = tmpGeo.attributes.normal.array as Float32Array;
  for (let k = 0; k < nx * nz; k++) {
    const ny = norArr[k * 3 + 1], y = pos[k * 3 + 1], x = pos[k * 3], z = pos[k * 3 + 2];
    const rock = smooth(0.87, 0.68, ny);
    const strata = 0.88 + 0.2 * vnoise(x * 0.018 + y * 0.12, z * 0.018);
    const nLarge = vnoise(x * 0.0085, z * 0.0085);
    const nMed = vnoise(x * 0.028 + 13.4, z * 0.028 - 7.1);
    const dry = smooth(14, 58, y) * 0.52 + nLarge * 0.34 + nMed * 0.14;
    const lush = smooth(12, 0, y) * (0.4 + 0.6 * nLarge);
    const wet = y < -1 ? 1 : 0;
    // Coastal hillside palette: deep coastal sage/olive valleys, warm sunlit golden-tan ridges, weathered granite rock faces
    let r = 0.86 + dry * 0.28 - lush * 0.07;
    let gg = 0.94 + dry * 0.04 + lush * 0.04;
    let b = 0.82 - dry * 0.12 - lush * 0.04;
    const rockR = 1.06 * strata, rockG = 1.02 * strata, rockB = 0.96 * strata;
    r = r * (1 - rock) + rockR * rock;
    gg = gg * (1 - rock) + rockG * rock;
    b = b * (1 - rock) + rockB * rock;
    if (wet) { r = 0.78; gg = 0.76; b = 0.72; }
    col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
  }
  const group = new THREE.Group();
  group.name = 'terrain';
  group.matrixAutoUpdate = false;
  group.matrixWorldAutoUpdate = false;
  for (let tz = 0; tz < TERRAIN_TILES_Z; tz++) {
    const iz0 = Math.floor((tz * (nz - 1)) / TERRAIN_TILES_Z);
    const iz1 = Math.floor(((tz + 1) * (nz - 1)) / TERRAIN_TILES_Z);
    const th = iz1 - iz0 + 1;
    for (let tx = 0; tx < TERRAIN_TILES_X; tx++) {
      const ix0 = Math.floor((tx * (nx - 1)) / TERRAIN_TILES_X);
      const ix1 = Math.floor(((tx + 1) * (nx - 1)) / TERRAIN_TILES_X);
      const tw = ix1 - ix0 + 1;
      const vCount = tw * th;
      const tPos = new Float32Array(vCount * 3);
      const tNor = new Float32Array(vCount * 3);
      const tUv = new Float32Array(vCount * 2);
      const tCol = new Float32Array(vCount * 3);
      for (let lj = 0; lj < th; lj++) {
        const gj = iz0 + lj;
        for (let li = 0; li < tw; li++) {
          const gi = ix0 + li;
          const gk = gj * nx + gi, lk = lj * tw + li;
          tPos[lk * 3] = pos[gk * 3]; tPos[lk * 3 + 1] = pos[gk * 3 + 1]; tPos[lk * 3 + 2] = pos[gk * 3 + 2];
          tNor[lk * 3] = norArr[gk * 3]; tNor[lk * 3 + 1] = norArr[gk * 3 + 1]; tNor[lk * 3 + 2] = norArr[gk * 3 + 2];
          tUv[lk * 2] = uv[gk * 2]; tUv[lk * 2 + 1] = uv[gk * 2 + 1];
          tCol[lk * 3] = col[gk * 3]; tCol[lk * 3 + 1] = col[gk * 3 + 1]; tCol[lk * 3 + 2] = col[gk * 3 + 2];
        }
      }
      const tIdx = new Uint16Array((tw - 1) * (th - 1) * 6);
      let ti = 0;
      for (let lj = 0; lj < th - 1; lj++) for (let li = 0; li < tw - 1; li++) {
        const a = lj * tw + li, b = a + 1, c = a + tw, d = c + 1;
        tIdx[ti++] = a; tIdx[ti++] = c; tIdx[ti++] = b;
        tIdx[ti++] = b; tIdx[ti++] = c; tIdx[ti++] = d;
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
      tg.setAttribute('normal', new THREE.BufferAttribute(tNor, 3));
      tg.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
      tg.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
      tg.setIndex(new THREE.BufferAttribute(tIdx, 1));
      tg.computeBoundingBox();
      tg.computeBoundingSphere();
      const tile = new THREE.Mesh(tg, mat);
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.name = `terrain@${tx},${tz}`;
      tile.userData.farScale = 2.6;
      tile.updateMatrix();
      tile.updateMatrixWorld(true);
      tile.matrixAutoUpdate = false;
      tile.matrixWorldAutoUpdate = false;
      group.add(tile);
      if (chunkOut) chunkOut.push(tile);
    }
  }
  tmpGeo.dispose();
  group.updateMatrix();
  group.updateMatrixWorld(true);
  root.add(group);
  const desc = RAPIER.ColliderDesc.trimesh(pos, idx).setFriction(0.8).setCollisionGroups(groups(G_STATIC, ALL));
  physics.tag(physics.world.createCollider(desc), { kind: 'static' });
  return group;
}

/** Depth of the underlay plane and skirts (below the seabed at SEABED_Y). */
export const UNDERLAY_Y = -9.5;
/**
 * One merged mesh that closes the world's edge: skirts hang from the terrain's west, east and north rims down to a huge
 * ground-coloured plane under everything. A camera that dips under the surface, or looks past the rim, sees earth
 * instead of the clear colour. Lit and fogged like the rest of the ground; one draw call, a few hundred triangles.
 */
export function buildUnderlayGeometry(height: (x: number, z: number) => number): THREE.BufferGeometry {
  const { x0, x1, z0, z1, step } = TERRAIN;
  const pos: number[] = [], idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const R = 9000;
  quad([-R, UNDERLAY_Y, -R], [-R, UNDERLAY_Y, R], [R, UNDERLAY_Y, R], [R, UNDERLAY_Y, -R]);
  const strip = (pt: (t: number) => [number, number], n: number) => {
    for (let i = 0; i < n; i++) {
      const [ax, az] = pt(i / n), [bx, bz] = pt((i + 1) / n);
      quad([ax, height(ax, az), az], [bx, height(bx, bz), bz], [bx, UNDERLAY_Y, bz], [ax, UNDERLAY_Y, az]);
    }
  };
  const nz = Math.round((z1 - z0) / step), nx = Math.round((x1 - x0) / step);
  strip(t => [x0, z0 + (z1 - z0) * t], nz);
  strip(t => [x1, z0 + (z1 - z0) * t], nz);
  strip(t => [x0 + (x1 - x0) * t, z0], nx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildUnderlay(root: THREE.Object3D, height: (x: number, z: number) => number): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color: '#4a5236', side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(buildUnderlayGeometry(height), mat);
  mesh.name = 'worldUnderlay'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  root.add(mesh);
  return mesh;
}
