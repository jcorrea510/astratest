/**
 * Procedural weapon models. Metres; muzzle along +z, the firing hand's grip at the origin (y up).
 *
 * Every part is built from side-profile extrusions (bevelled), lathes and cylinders, then merged per material, so a
 * detailed gun costs a handful of draw calls. Moving parts (magazine, slide / pump / bolt) stay separate meshes so the
 * reload and firing animations can move them. Geometry is cached per weapon id and materials are shared, so NPCs holding
 * the same gun share everything.
 */
import * as THREE from 'three';
import type { WeaponId } from './weapons';
import { Kit } from './guns/kit';
import { BUILDERS } from './guns';


interface ModelInfo { group: THREE.Group; muzzle: THREE.Vector3; eject: THREE.Vector3 }
type Cached = { proto: THREE.Group; muzzle: THREE.Vector3; eject: THREE.Vector3; butt: THREE.Vector3 | null; support: THREE.Vector3 | null; grip: THREE.Vector3 };
const CACHE = new Map<WeaponId, Cached>();
function proto(id: WeaponId) {
  let c = CACHE.get(id);
  if (!c) {
    const b = BUILDERS[id];
    if (!b) { c = { proto: new THREE.Group(), muzzle: new THREE.Vector3(), eject: new THREE.Vector3(), butt: null, support: null, grip: new THREE.Vector3(0, -0.045, 0) }; }
    else { const k = new Kit(); const r = b(k); c = { proto: k.build(id), muzzle: r.muzzle, eject: r.eject, butt: r.butt ?? null, support: r.support ?? null, grip: r.grip ?? new THREE.Vector3(0, -0.045, 0) }; }
    CACHE.set(id, c);
  }
  return c;
}

/** A new instance of the weapon model (shared geometry and materials). Empty group for fists. */
export function weaponMesh(id: WeaponId): THREE.Group {
  const c = proto(id);
  const g = c.proto.clone(true);
  g.userData.muzzle = c.muzzle.clone(); g.userData.eject = c.eject.clone(); g.userData.weapon = id;
  g.userData.anchors = { grip: c.grip.clone(), butt: c.butt?.clone() ?? null, support: c.support?.clone() ?? null } satisfies WeaponAnchors;
  g.traverse(o => { o.userData.rest = o.position.clone(); o.userData.restRot = o.rotation.clone(); });
  return g;
}
/** Muzzle distance along +z (legacy: the muzzle is at (0, 0.07, MUZZLE[id]) roughly; prefer userData.muzzle). */
export const MUZZLE = new Proxy({} as Record<WeaponId, number>, { get: (_t, id: string) => proto(id as WeaponId).muzzle.z });
export interface WeaponParts { mag: THREE.Object3D | null; slide: THREE.Object3D | null; pump: THREE.Object3D | null; bolt: THREE.Object3D | null; muzzle: THREE.Vector3; eject: THREE.Vector3 }
/** Moving parts of a model instance for the firing / reload animations. */
export function weaponParts(g: THREE.Group): WeaponParts {
  const f = (n: string) => g.getObjectByName(n) ?? null;
  return { mag: f('mag'), slide: f('slide'), pump: f('pump'), bolt: f('bolt'), muzzle: g.userData.muzzle ?? new THREE.Vector3(0, 0.06, 0.3), eject: g.userData.eject ?? new THREE.Vector3() };
}
/** Muzzle point of a placed model instance in world space. */
export function muzzleWorld(g: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.copy((g.userData.muzzle as THREE.Vector3) ?? new THREE.Vector3(0, 0.06, 0.3)).applyMatrix4(g.matrixWorld);
}
/** Where hands and shoulder meet a model (gun space): grip = firing-hand palm centre, butt = stock end, support = fore-hand palm centre. */
export interface WeaponAnchors { grip: THREE.Vector3; butt: THREE.Vector3 | null; support: THREE.Vector3 | null }
export function weaponAnchors(g: THREE.Object3D): WeaponAnchors {
  return (g.userData.anchors as WeaponAnchors | undefined) ?? { grip: new THREE.Vector3(0, -0.045, 0), butt: null, support: null };
}
export type { ModelInfo };
