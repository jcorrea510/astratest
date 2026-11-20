/**
 * Instanced far cars: the far crowd's driving and parked cars drawn with each kind's real far model (lod 2: proper body,
 * wheels, lamps and glass, ~1.3k triangles) and its real paint, one draw call per kind in use. The same model is what a
 * real car shows beyond LOD_FAR, so a hand-over between the two is invisible.
 */
import * as THREE from 'three';
import { getTemplate } from './models/build';
import { farCarMaterial } from './models/carMaterial';
import { GROUND } from './shapes';
import { VEHICLES, type VehicleKind } from './specs';
import { VehiclePhysics } from './vehiclePhysics';

interface KindMesh { mesh: THREE.InstancedMesh; paint: THREE.InstancedBufferAttribute; n: number; restY: number; mat: ReturnType<typeof farCarMaterial>; radius: number }
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
const sph = new THREE.Sphere();

/** Linear-space paint of a kind's paint index (what Vehicle uses for the same index). */
export function kindPaint(kind: VehicleKind, index: number, out = new THREE.Color()): THREE.Color {
  const paints = VEHICLES[kind].paints; return out.set(paints[((index % paints.length) + paints.length) % paints.length]).convertSRGBToLinear();
}

export class FarCars {
  private kinds = new Map<VehicleKind, KindMesh>();
  /** instances drawn last frame (tests/stats) */ drawn = 0;
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4();
  constructor(private scene: THREE.Scene, private capPerKind = 480) {}
  private get(kind: VehicleKind): KindMesh {
    let k = this.kinds.get(kind);
    if (k) return k;
    const t = getTemplate(kind), s = t.shape, geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(t.far.attributes)) geo.setAttribute(name, a);
    const paint = new THREE.InstancedBufferAttribute(new Float32Array(this.capPerKind * 4), 4); paint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPaint', paint);
    const mat = farCarMaterial(), u = mat.userData.u;
    u.uMetal.value = s.metallic * 0.8; u.uLivery.value = s.livery; u.uGrille.value = s.grille.style; u.uDirt.value = 0.12;
    const d0 = s.doors[0], dz = s.doors.length ? [Math.min(...s.doors.map(d => d[0])), Math.max(...s.doors.map(d => d[1]))] : [0, 0];
    u.uBody.value.set(s.W / 2, d0 ? t.doors[0].beltY : 1, dz[0], dz[1]);
    u.uBody2.value.set((s.gh ? s.gh.roof : 1.4) + GROUND, t.front, t.rear, 0.5);
    if (kind === 'muscle') u.uPaint2.value.set('#141416').convertSRGBToLinear();
    else if (kind === 'race') u.uPaint2.value.set('#f4f2ee').convertSRGBToLinear();
    else if (kind === 'van' || kind === 'bus') u.uPaint2.value.set('#f3f1ea').convertSRGBToLinear();
    const mesh = new THREE.InstancedMesh(geo, mat, this.capPerKind);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.visible = false;
    mesh.frustumCulled = false; // culled per instance on the CPU below
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = `farCars:${kind}`;
    this.scene.add(mesh);
    k = { mesh, paint, n: 0, mat, restY: VehiclePhysics.restBodyY(VEHICLES[kind], t.layout, 0), radius: t.sphere.radius };
    this.kinds.set(kind, k);
    return k;
  }
  /** Builds (or reuses) the meshes for these kinds now, so the first appearance of a kind never hitches mid-game. */
  warm(kinds: Iterable<VehicleKind>) { for (const k of kinds) this.get(k); }
  /** Start a frame: `camera` (with up-to-date matrices) is used for per-instance culling. */
  begin(camera: THREE.Camera) {
    for (const k of this.kinds.values()) k.n = 0;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm);
    this.drawn = 0;
  }
  /** One car at ground height y, heading yaw, linear paint; lit = drives with its lamps on at night. Returns false when culled. */
  add(kind: VehicleKind, x: number, y: number, z: number, yaw: number, paint: THREE.Color, lit: boolean, culled = true): boolean {
    const k = this.get(kind);
    if (k.n >= this.capPerKind) return false;
    if (culled && !this.frustum.intersectsSphere(sph.set(p.set(x, y + 1, z), k.radius))) return false;
    q.setFromAxisAngle(up, yaw); p.set(x, y + k.restY, z); m4.compose(p, q, one);
    k.mesh.setMatrixAt(k.n, m4); k.paint.setXYZW(k.n, paint.r, paint.g, paint.b, lit ? 1 : 0); k.n++; this.drawn++;
    return true;
  }
  end(night: number) {
    for (const k of this.kinds.values()) {
      k.mesh.count = k.n; k.mesh.visible = k.n > 0;
      if (k.n) { k.mesh.instanceMatrix.needsUpdate = true; k.paint.needsUpdate = true; }
      const u = k.mat.userData.u, on = night > 0.35;
      u.uHead.value = on ? 2.2 : 0; u.uTail.value = on ? 1.2 : 0; u.uLight.value = Math.max(0.6, night * 2.5);
    }
  }
  /** Total instance count per kind (tests). */
  counts(): Record<string, number> { const o: Record<string, number> = {}; for (const [kind, k] of this.kinds) o[kind] = k.n; return o; }
}
