/**
 * Round 9 gore: dismemberment rules (pure, unit tested) and the glue that finds which joint a hit landed on and
 * severs it through `Blood.severLimb`. Heavy rounds sever a limb in one hit in range; pistols / SMGs wear a limb down
 * (damage accumulates per person and joint) until it comes off. Only with Blood & gore on (`Blood.enabled`).
 */
import * as THREE from 'three';
import type { Character } from '../actors/character';
import type { Blood } from '../render/blood';
import { zoneDamage, type Zone } from './hitzones';
import type { WeaponDef } from './weapons';

export type JointName = 'shoulder' | 'elbow' | 'hip' | 'knee';
export type Side = 'L' | 'R';
export type JointId = `${JointName}${Side}`;
/** live severed pieces in the world (oldest recycled) */
export const MAX_PIECES = 8;
/** limb hit points for accumulated (pistol / SMG) severing */
export const LIMB_HP = 65;

export const jointKind = (id: JointId): 'arm' | 'leg' => (id.startsWith('shoulder') || id.startsWith('elbow') ? 'arm' : 'leg');
export const jointSide = (id: JointId): Side => (id.endsWith('L') ? 'L' : 'R');
/** The joint a hit on `kind` limb part (upper = arm above the elbow / thigh, lower = forearm+hand / shin+foot) comes off at. */
export function jointFor(kind: 'arm' | 'leg', upper: boolean, side: Side): JointId {
  return (kind === 'arm' ? (upper ? 'shoulder' : 'elbow') : upper ? 'hip' : 'knee') + side as JointId;
}

/** Chance that one round / pellet of `w` severs the limb it hits outright at `dist` m (0 = never: it only wears the limb down). */
export function severChance(w: Pick<WeaponDef, 'cat' | 'damage' | 'melee'>, dist: number): number {
  if (w.melee) return 0;
  if (w.cat === 'shotgun') return dist <= 14 ? 1 : 0;
  if (w.damage >= 85) return dist <= 90 ? 1 : 0;
  if (w.cat === 'rifle' || w.cat === 'heavy') return dist <= 60 ? 0.6 : 0;
  return 0;
}

const worn = new WeakMap<object, Partial<Record<JointId, number>>>();
/** Adds limb damage for a person; returns the total on that joint. */
export function addLimbDamage(key: object, id: JointId, amount: number): number {
  let m = worn.get(key); if (!m) worn.set(key, m = {});
  return (m[id] = (m[id] ?? 0) + amount);
}
export const limbDamage = (key: object, id: JointId) => worn.get(key)?.[id] ?? 0;
export function resetLimbs(key: object) { worn.delete(key); }

/** Pure decision: does this hit take the limb off? `total` = accumulated damage on the joint including this hit. */
export function shouldSever(w: Pick<WeaponDef, 'cat' | 'damage' | 'melee'>, dist: number, total: number, roll = Math.random()): boolean {
  if (w.melee) return false;
  const p = severChance(w, dist);
  if (p > 0 && roll < p) return true;
  return total >= LIMB_HP;
}

export interface Seg { id: JointId; ax: number; ay: number; az: number; bx: number; by: number; bz: number }
/** Joint whose limb segment is nearest the hit point (pure). */
export function nearestJoint(px: number, py: number, pz: number, segs: Seg[]): JointId | null {
  let best: JointId | null = null, bd = Infinity;
  for (const s of segs) {
    const abx = s.bx - s.ax, aby = s.by - s.ay, abz = s.bz - s.az, l2 = abx * abx + aby * aby + abz * abz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - s.ax) * abx + (py - s.ay) * aby + (pz - s.az) * abz) / l2));
    const dx = s.ax + abx * t - px, dy = s.ay + aby * t - py, dz = s.az + abz * t - pz, d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}

// ------------------------------------------------------------------ rig glue
const BONE = { shoulder: 'DEF-upper_arm', elbow: 'DEF-forearm', hip: 'DEF-thigh', knee: 'DEF-shin', hand: 'DEF-hand', foot: 'DEF-foot' } as const;
const cache = new WeakMap<THREE.Object3D, Record<string, THREE.Object3D | null>>();
function bone(model: THREE.Object3D, name: string): THREE.Object3D | null {
  let c = cache.get(model); if (!c) cache.set(model, c = {});
  return (c[name] ??= model.getObjectByName(name) ?? null);
}
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
const segs: Seg[] = [];
function limbSegments(model: THREE.Object3D, kind: 'arm' | 'leg'): Seg[] {
  segs.length = 0; model.updateMatrixWorld(true);
  for (const side of ['L', 'R'] as const) {
    const [j0, j1, end] = kind === 'arm' ? ['shoulder', 'elbow', 'hand'] as const : ['hip', 'knee', 'foot'] as const;
    const b0 = bone(model, BONE[j0] + side), b1 = bone(model, BONE[j1] + side), b2 = bone(model, BONE[end] + side);
    if (!b0 || !b1 || !b2) continue;
    b0.getWorldPosition(A); b1.getWorldPosition(B); b2.getWorldPosition(C);
    segs.push({ id: (j0 + side) as JointId, ax: A.x, ay: A.y, az: A.z, bx: B.x, by: B.y, bz: B.z });
    segs.push({ id: (j1 + side) as JointId, ax: B.x, ay: B.y, az: B.z, bx: C.x, by: C.y, bz: C.z });
  }
  return segs;
}
/** Which joint a hit at `at` on an arm / leg zone belongs to, or null (not a limb / no rig). */
export function hitJoint(model: THREE.Object3D, zone: Zone, at: THREE.Vector3): JointId | null {
  if (zone !== 'arm' && zone !== 'leg') return null;
  return nearestJoint(at.x, at.y, at.z, limbSegments(model, zone));
}
export function jointGone(c: Character, id: JointId): boolean { const b = bone(c.human.model, BONE[id.replace(/[LR]$/, '') as JointName] + jointSide(id)); return !b || !!b.userData.gone; }

const skinCol = new THREE.Color();
/**
 * Applies a limb hit: accumulates damage, and if it comes off severs it (hides the distal bones, bloody stump, flying
 * piece). Returns the joint severed, or null. Never touches the player's own body.
 */
export function dismemberHit(blood: Blood, c: Character, at: THREE.Vector3, dir: THREE.Vector3, zone: Zone, w: WeaponDef, dist: number): JointId | null {
  if (!blood.enabled || c.isPlayer || c.team === 'player' || w.melee) return null;
  const id = hitJoint(c.human.model, zone, at); if (!id) return null;
  if (jointGone(c, id)) return null;
  const total = addLimbDamage(c, id, zoneDamage(w, zone, dist, { isPlayer: false, vest: false }).damage);
  if (!shouldSever(w, dist, total)) return null;
  const name = id.replace(/[LR]$/, '') as JointName, side = jointSide(id), model = c.human.model;
  const joint = bone(model, BONE[name] + side), end = bone(model, (jointKind(id) === 'arm' ? BONE.hand : BONE.foot) + side);
  if (!joint || !end) return null;
  const look = c.human.look;
  const arm = jointKind(id) === 'arm', covered = arm ? look.sleeves === 'long' : look.bottomStyle !== 'shorts' && look.bottomStyle !== 'skirt';
  skinCol.set(covered ? (arm ? look.top : look.bottom) : look.skin);
  blood.severLimb(joint, end, c.pos.y, dir, Math.min(2.2, 0.7 + w.damage / 60), skinCol, arm ? 0.05 : 0.075);
  return id;
}
