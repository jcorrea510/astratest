/**
 * Hit zones: a person is a set of capsules along their skeleton's bones (head, neck, torso, arms, legs). A shot ray is
 * tested against those capsules (not the fat physics capsule), so a bullet that passes between an arm and the body
 * misses, and the zone it does hit decides the damage. Pure math is unit tested; `bodyCapsules` reads a live skeleton.
 */
import * as THREE from 'three';
import type { WeaponDef } from './weapons';
import { falloffAt } from './weapons';

export type Zone = 'head' | 'neck' | 'torso' | 'arm' | 'leg';
export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; zone: Zone }

/** Damage multiplier per zone on people (the head is an instant kill and handled separately). */
export const ZONE_MUL: Record<Zone, number> = { head: 1, neck: 1.6, torso: 1, arm: 0.6, leg: 0.7 };
/** Same for shots that hit the player (no instant kills; armour and the per-second cap still apply in Character). */
export const PLAYER_ZONE_MUL: Record<Zone, number> = { head: 1.5, neck: 1.25, torso: 1, arm: 0.65, leg: 0.75 };
/** Torso damage factor for vest-wearing targets (police / army) unless the round is armour-piercing. */
export const VEST = 0.68;

export interface ZoneTarget { isPlayer: boolean; vest: boolean }
export interface ZoneDamage { damage: number; instantKill: boolean }
/**
 * Damage one round (or pellet) does at distance `dist` to a zone. `jitter` is a 0.96..1.04-style factor so repeated
 * shots are not identical, but small enough that "two pistol rounds to the chest" always holds.
 */
export function zoneDamage(w: WeaponDef, zone: Zone, dist: number, t: ZoneTarget, jitter = 1): ZoneDamage {
  const fall = falloffAt(w, dist);
  if (t.isPlayer) return { damage: w.playerDamage * PLAYER_ZONE_MUL[zone] * fall * jitter, instantKill: false };
  if (zone === 'head' && !w.melee) return { damage: Math.max(1000, w.damage * 4), instantKill: true };
  let m = ZONE_MUL[zone];
  if (t.vest && zone === 'torso' && !w.pierce) m *= VEST;
  return { damage: w.damage * m * fall * jitter, instantKill: false };
}

/**
 * Ray vs capsule (segment a-b, radius r). Returns the distance along the (unit) ray to the first intersection, or -1.
 * (Inigo Quilez's capsule intersector.)
 */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, c: Capsule): number {
  const bax = c.bx - c.ax, bay = c.by - c.ay, baz = c.bz - c.az;
  const oax = ox - c.ax, oay = oy - c.ay, oaz = oz - c.az;
  const baba = bax * bax + bay * bay + baz * baz, bard = bax * dx + bay * dy + baz * dz, baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  const r = c.r;
  if (baba < 1e-10) { // degenerate: sphere
    const h = rdoa * rdoa - oaoa + r * r; if (h < 0) return -1; return -rdoa - Math.sqrt(h);
  }
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, cc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * cc;
  if (h >= 0 && a > 1e-12) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    // caps
    const ocx = y <= 0 ? oax : ox - c.bx, ocy = y <= 0 ? oay : oy - c.by, ocz = y <= 0 ? oaz : oz - c.bz;
    const bb = dx * ocx + dy * ocy + dz * ocz, c2 = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = bb * bb - c2;
    if (h > 0) return -bb - Math.sqrt(h);
  } else if (a <= 1e-12) {
    // ray parallel to the axis: test both end spheres
    let best = -1;
    for (const [px, py, pz] of [[c.ax, c.ay, c.az], [c.bx, c.by, c.bz]]) {
      const qx = ox - px, qy = oy - py, qz = oz - pz; const bb = dx * qx + dy * qy + dz * qz, c2 = qx * qx + qy * qy + qz * qz - r * r; const hh = bb * bb - c2;
      if (hh > 0) { const t = -bb - Math.sqrt(hh); if (t >= 0 && (best < 0 || t < best)) best = t; }
    }
    return best;
  }
  return -1;
}

/** Closest capsule hit along a ray within [0, maxT]: the hit distance and zone, or null. */
export function rayBody(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, caps: Capsule[], maxT: number, inflate = 0): { t: number; zone: Zone } | null {
  let best: { t: number; zone: Zone } | null = null;
  for (const c0 of caps) {
    const c = inflate ? { ...c0, r: c0.r + inflate } : c0;
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, c);
    if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { t, zone: c.zone };
  }
  return best;
}

// ---------------------------------------------------------------- live skeleton -> capsules
/** Bone names of the rig (UAL / Rigify DEF- names), with fallbacks for other common naming. */
const BONES = {
  hips: ['DEF-hips', 'DEF-spine', 'Hips', 'hips', 'pelvis'], chest: ['DEF-spine003', 'DEF-spine002', 'Spine2', 'spine_03', 'chest'], neck: ['DEF-neck', 'Neck', 'neck_01', 'neck'], head: ['DEF-head', 'Head', 'head'],
  shL: ['DEF-upper_armL', 'LeftArm', 'upperarm_l'], elL: ['DEF-forearmL', 'LeftForeArm', 'lowerarm_l'], wrL: ['DEF-handL', 'LeftHand', 'hand_l'],
  shR: ['DEF-upper_armR', 'RightArm', 'upperarm_r'], elR: ['DEF-forearmR', 'RightForeArm', 'lowerarm_r'], wrR: ['DEF-handR', 'RightHand', 'hand_r'],
  hipL: ['DEF-thighL', 'LeftUpLeg', 'thigh_l'], knL: ['DEF-shinL', 'LeftLeg', 'calf_l'], anL: ['DEF-footL', 'LeftFoot', 'foot_l'],
  hipR: ['DEF-thighR', 'RightUpLeg', 'thigh_r'], knR: ['DEF-shinR', 'RightLeg', 'calf_r'], anR: ['DEF-footR', 'RightFoot', 'foot_r'],
} as const;
type BoneKey = keyof typeof BONES;
const boneCache = new WeakMap<THREE.Object3D, Partial<Record<BoneKey, THREE.Object3D>> | null>();
function findBones(model: THREE.Object3D) {
  let b = boneCache.get(model);
  if (b === undefined) {
    const found: Partial<Record<BoneKey, THREE.Object3D>> = {};
    for (const k of Object.keys(BONES) as BoneKey[]) for (const n of BONES[k]) { const o = model.getObjectByName(n); if (o) { found[k] = o; break; } }
    b = found.head && found.hips && found.neck ? found : null;
    boneCache.set(model, b);
  }
  return b;
}
const P: Record<string, THREE.Vector3> = {};
const v = (k: string) => (P[k] ??= new THREE.Vector3());
/**
 * Capsules for a person in world space. `model` is the skinned rig root (Human.model or Human.root); `height` the
 * person's height scale (1 = 1.78 m) and `build` their width scale. Falls back to an upright standing body built from
 * `pos` / `yaw` when the rig has no recognisable bones.
 */
export function bodyCapsules(model: THREE.Object3D, pos: THREE.Vector3, yaw: number, height = 1, build = 1, out: Capsule[] = []): Capsule[] {
  out.length = 0;
  const s = height, wsc = Math.sqrt(Math.max(0.6, build));
  const cap = (a: THREE.Vector3, b: THREE.Vector3, r: number, zone: Zone) => out.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, r: r * s * wsc, zone });
  const bones = findBones(model);
  if (bones) {
    model.updateMatrixWorld(true);
    const W = (k: BoneKey) => { const o = bones[k]; return o ? o.getWorldPosition(v(k)) : null; };
    const hips = W('hips')!, neck = W('neck')!, head = W('head')!, chest = W('chest') ?? v('chestF').lerpVectors(hips, neck, 0.6);
    const up = v('up').subVectors(head, neck); const ul = up.length() || 0.1; up.multiplyScalar(1 / ul);
    // the head bone sits at the base of the skull: the skull runs ~0.2 m (scaled) up from there
    const headTop = v('headTop').copy(head).addScaledVector(up, 0.16 * s), headC = v('headC').copy(head).addScaledVector(up, 0.06 * s);
    cap(headC, headTop, 0.1, 'head');
    cap(neck, v('neckT').copy(head).addScaledVector(up, -0.005), 0.065, 'neck');
    cap(chest, v('chestT').copy(neck).addScaledVector(up, -0.06 * s), 0.15, 'torso');
    cap(hips, chest, 0.145, 'torso');
    for (const side of ['L', 'R'] as const) {
      const sh = W(`sh${side}`), el = W(`el${side}`), wr = W(`wr${side}`);
      if (sh && el) cap(sh, el, 0.055, 'arm');
      if (el && wr) { cap(el, wr, 0.045, 'arm'); cap(wr, v(`hand${side}`).copy(wr).addScaledVector(v(`fa${side}`).subVectors(wr, el).normalize(), 0.09 * s), 0.045, 'arm'); }
      const hp = W(`hip${side}`), kn = W(`kn${side}`), an = W(`an${side}`);
      if (hp && kn) cap(hp, kn, 0.085, 'leg');
      if (kn && an) cap(kn, an, 0.06, 'leg');
      if (an) cap(an, v(`toe${side}`).set(an.x + Math.sin(yaw) * 0.14 * s, an.y - 0.05 * s, an.z + Math.cos(yaw) * 0.14 * s), 0.045, 'leg');
    }
    return out;
  }
  // analytic fallback: standing person facing yaw
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const at = (k: string, side: number, y: number, fwd = 0) => v(k).set(pos.x + rx * side * s + fx * fwd * s, pos.y + y * s, pos.z + rz * side * s + fz * fwd * s);
  cap(at('h0', 0, 1.6), at('h1', 0, 1.72), 0.1, 'head');
  cap(at('n0', 0, 1.46), at('n1', 0, 1.58), 0.065, 'neck');
  cap(at('t0', 0, 0.98), at('t1', 0, 1.4), 0.16, 'torso');
  for (const sd of [-1, 1]) {
    cap(at(`s${sd}`, sd * 0.2, 1.4), at(`e${sd}`, sd * 0.24, 1.12), 0.055, 'arm');
    cap(at(`e2${sd}`, sd * 0.24, 1.12), at(`w${sd}`, sd * 0.25, 0.86), 0.045, 'arm');
    cap(at(`hp${sd}`, sd * 0.1, 0.92), at(`k${sd}`, sd * 0.11, 0.5), 0.085, 'leg');
    cap(at(`k2${sd}`, sd * 0.11, 0.5), at(`a${sd}`, sd * 0.11, 0.08), 0.06, 'leg');
  }
  return out;
}
