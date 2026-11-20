/**
 * Pedestrian signal heads ("walking person" / "raised hand") on poles at both ends of every signalized crosswalk.
 * Placement is pure (testable); the builder makes one merged pole mesh plus two instanced icon layers whose colour is
 * switched from the same signal phase the traffic lights and the pedestrian brains use (pedSignal in citymap).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type CityMap, pedSignal, surfaceAt, CURB_HEIGHT } from './citymap';

export interface PedSignalPost { inter: number; /** axis of the road being crossed */ axis: 'x' | 'z'; x: number; z: number; /** yaw of the head's face (looks across the road) */ yaw: number }
/** How far back from the kerb a waiting pedestrian stands (m), and the crosswalk node inset from the kerb. */
export const KERB_WAIT_BACK = 0.7;
export const NODE_INSET = 2.2;
const POLE_H = 2.9;

export function pedSignalPosts(city: CityMap): PedSignalPost[] {
  const out: PedSignalPost[] = [];
  const nodes = city.pedNodes;
  for (const a of nodes) {
    for (const e of a.edges) {
      if (!e.crossing || a.id > e.to) continue;
      const inter = city.intersections[e.crossing.intersection];
      if (!inter?.signalized) continue;
      const c = nodes[e.to];
      const len = Math.hypot(c.x - a.x, c.z - a.z); if (len < 6) continue;
      const dx = (c.x - a.x) / len, dz = (c.z - a.z) / len;
      let wx = -dz, wz = dx; // sideways along the kerb, pointing away from the junction centre
      if ((a.x - inter.x) * wx + (a.z - inter.z) * wz < 0) { wx = -wx; wz = -wz; }
      for (const [n, sx, sz] of [[a, dx, dz], [c, -dx, -dz]] as const) {
        const kerb = NODE_INSET - 0.5;
        const x = n.x + sx * kerb + wx * 1.7, z = n.z + sz * kerb + wz * 1.7;
        if (surfaceAt(city, x, z) === 'road') continue;
        out.push({ inter: inter.id, axis: e.crossing.axis, x, z, yaw: Math.atan2(sx, sz) });
      }
    }
  }
  return out;
}

function iconTexture(draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  draw(g);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const handIcon = (g: CanvasRenderingContext2D) => {
  g.lineWidth = 6;
  for (const [x, y0] of [[22, 30], [30, 26], [38, 26], [46, 30]] as const) { g.beginPath(); g.moveTo(x, 36); g.lineTo(x, y0 - 14); g.stroke(); }
  g.beginPath(); g.moveTo(16, 40); g.lineTo(10, 30); g.stroke();
  g.beginPath(); g.roundRect(14, 34, 38, 22, 8); g.fill();
};
const walkerIcon = (g: CanvasRenderingContext2D) => {
  g.beginPath(); g.arc(32, 11, 6, 0, Math.PI * 2); g.fill();
  g.lineWidth = 7; g.beginPath(); g.moveTo(32, 20); g.lineTo(32, 38); g.stroke();
  g.lineWidth = 5.5;
  g.beginPath(); g.moveTo(32, 24); g.lineTo(21, 34); g.moveTo(32, 24); g.lineTo(43, 31); g.stroke();
  g.beginPath(); g.moveTo(32, 38); g.lineTo(21, 58); g.moveTo(32, 38); g.lineTo(44, 56); g.stroke();
};

export interface PedSignals {
  posts: PedSignalPost[];
  group: THREE.Group;
  /** Re-colours the heads for game time `t` (cheap; only touches heads whose state changed). */
  update(t: number): void;
  /** current icon of post i: 'walk' | 'hand' | 'off' (for tests) */
  shown(i: number): 'walk' | 'hand' | 'off';
}

export function buildPedSignals(city: CityMap, physics: { addStaticCylinder(x: number, y: number, z: number, hh: number, r: number): void } | null): PedSignals {
  const posts = pedSignalPosts(city);
  const group = new THREE.Group(); group.name = 'pedSignals';
  const geos: THREE.BufferGeometry[] = [];
  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const p of posts) {
    const pole = new THREE.CylinderGeometry(0.045, 0.055, POLE_H, 8); pole.translate(0, POLE_H / 2, 0);
    const head = new THREE.BoxGeometry(0.34, 0.42, 0.16); head.translate(0, POLE_H - 0.05, 0.02);
    const visor = new THREE.BoxGeometry(0.36, 0.04, 0.12); visor.translate(0, POLE_H + 0.18, 0.1);
    q.setFromAxisAngle(up, p.yaw); mat4.compose(new THREE.Vector3(p.x, CURB_HEIGHT, p.z), q, new THREE.Vector3(1, 1, 1));
    for (const g of [pole, head, visor]) { g.applyMatrix4(mat4); geos.push(g.index ? g.toNonIndexed() : g); }
    physics?.addStaticCylinder(p.x, CURB_HEIGHT + 1.4, p.z, 1.4, 0.07);
  }
  if (geos.length) {
    const merged = mergeGeometries(geos, false)!; for (const g of geos) g.dispose();
    const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.55, metalness: 0.4 }));
    m.castShadow = false; m.frustumCulled = false; group.add(m);
  }
  const plane = new THREE.PlaneGeometry(0.27, 0.27);
  const mk = (tex: THREE.Texture) => {
    const im = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false }), Math.max(1, posts.length));
    im.frustumCulled = false; im.count = posts.length;
    return im;
  };
  const handM = mk(iconTexture(handIcon)), walkM = mk(iconTexture(walkerIcon));
  const dummy = new THREE.Object3D(), off = new THREE.Color(0, 0, 0);
  posts.forEach((p, i) => {
    dummy.position.set(p.x + Math.sin(p.yaw) * 0.105, CURB_HEIGHT + POLE_H - 0.03, p.z + Math.cos(p.yaw) * 0.105);
    dummy.rotation.set(0, p.yaw, 0); dummy.updateMatrix();
    handM.setMatrixAt(i, dummy.matrix); walkM.setMatrixAt(i, dummy.matrix);
    handM.setColorAt(i, off); walkM.setColorAt(i, off);
  });
  group.add(handM, walkM);
  const HAND = new THREE.Color(9, 3.2, 0.2), WALK = new THREE.Color(5, 6.5, 6.5);
  const last: ('walk' | 'hand' | 'off')[] = posts.map(() => 'off');
  const update = (t: number) => {
    const blink = Math.floor(t * 2) % 2 === 0;
    let dirty = false;
    posts.forEach((p, i) => {
      const s = pedSignal(city.intersections[p.inter], p.axis, t);
      const shown: 'walk' | 'hand' | 'off' = s === 'walk' ? 'walk' : s === 'dont' || blink ? 'hand' : 'off';
      if (shown === last[i]) return;
      last[i] = shown; dirty = true;
      handM.setColorAt(i, shown === 'hand' ? HAND : off); walkM.setColorAt(i, shown === 'walk' ? WALK : off);
    });
    if (dirty) { if (handM.instanceColor) handM.instanceColor.needsUpdate = true; if (walkM.instanceColor) walkM.instanceColor.needsUpdate = true; }
  };
  update(0);
  return { posts, group, update, shown: i => last[i] };
}
