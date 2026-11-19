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

/** Builds the terrain mesh (vertex-coloured: grass, dry grass, rock on steep slopes) and its trimesh collider. */
export function buildTerrain(root: THREE.Object3D, physics: Physics, height: (x: number, z: number) => number, mat: THREE.Material): THREE.Mesh {
  const { x0, x1, z0, z1, step } = TERRAIN;
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * nx + i;
    pos[k * 3] = x; pos[k * 3 + 1] = height(x, z); pos[k * 3 + 2] = z; uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  for (let k = 0; k < nx * nz; k++) {
    const ny = nor.getY(k), y = pos[k * 3 + 1], x = pos[k * 3], z = pos[k * 3 + 2];
    const rock = smooth(0.86, 0.7, ny), dry = vnoise(x * 0.01, z * 0.01) * 0.6 + smooth(10, 50, y) * 0.4, wet = y < -1 ? 1 : 0;
    let r = 1 + dry * 0.35, gg = 1 - dry * 0.05, b = 0.95 - dry * 0.2;
    r = r * (1 - rock) + 1.25 * rock; gg = gg * (1 - rock) + 1.05 * rock; b = b * (1 - rock) + 1.0 * rock;
    if (wet) { r = 0.9; gg = 0.85; b = 0.8; }
    col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'terrain';
  root.add(mesh);
  const desc = RAPIER.ColliderDesc.trimesh(pos, new Uint32Array(idx)).setFriction(0.8).setCollisionGroups(groups(G_STATIC, ALL));
  physics.tag(physics.world.createCollider(desc), { kind: 'static' });
  return mesh;
}
