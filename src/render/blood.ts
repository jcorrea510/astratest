/**
 * Moderate blood (Teen): small spatter decals on the ground / wall behind a hit, a slowly growing pool under a body, and
 * dark wound marks on the hit zone. Everything is pooled in two InstancedMeshes (ring buffers, one draw call each), so
 * the cost is fixed no matter how many people are shot. `enabled = false` (Settings "Blood") spawns nothing.
 */
import * as THREE from 'three';

export const BLOOD_SPLAT_MAX = 220;
export const BLOOD_POOL_MAX = 28;
/** wounds bleeding at once (Round 7 gore budget) */
export const BLEED_MAX = 6;
const POOL_FULL = 0.85; // metres of radius when fully grown (Round 8: bigger)
const POOL_GROW_S = 11;

function bloodTexture(kind: 'splat' | 'pool'): THREE.CanvasTexture {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!;
  const blob = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(96,8,10,${a})`); gr.addColorStop(0.7, `rgba(80,6,8,${a * 0.9})`); gr.addColorStop(1, 'rgba(60,4,6,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'pool') {
    for (let i = 0; i < 7; i++) { const a = Math.random() * Math.PI * 2, d = Math.random() * 14; blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 30 + Math.random() * 16, 0.95); }
    blob(S / 2 - 12, S / 2 - 14, 9, 0.35); // slightly lighter wet highlight spot
  } else {
    blob(S / 2, S / 2, 13 + Math.random() * 5, 1);
    for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 38; blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 2 + Math.random() * 5, 0.95); }
    for (let i = 0; i < 4; i++) { // streaks
      const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 30; g.strokeStyle = 'rgba(80,6,8,0.85)'; g.lineWidth = 2 + Math.random() * 2;
      g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

interface PoolRec { x: number; y: number; z: number; age: number; rot: number; grow: number; follow?: { x: number; z: number } }
export class Blood {
  /** Settings "Blood" toggle. */
  enabled = true;
  readonly splats: THREE.InstancedMesh;
  readonly pools: THREE.InstancedMesh;
  private si = 0; private poolList: PoolRec[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private sc = new THREE.Vector3(); private p = new THREE.Vector3();
  private qz = new THREE.Quaternion(); private z = new THREE.Vector3(0, 0, 1); private up = new THREE.Vector3(0, 1, 0);
  /** wound marks pinned to a body bone; capped per character and in total */
  private wounds: THREE.Mesh[] = [];
  private woundGeo = new THREE.PlaneGeometry(1, 1); private woundMat: THREE.MeshBasicMaterial;
  constructor(scene: THREE.Scene) {
    const mk = (kind: 'splat' | 'pool', max: number) => {
      const mat = new THREE.MeshStandardMaterial({ map: bloodTexture(kind), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, roughness: kind === 'pool' ? 0.25 : 0.55, metalness: 0 });
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max); im.count = 0; im.frustumCulled = false; im.renderOrder = 2; im.receiveShadow = true; im.userData.blood = true;
      scene.add(im); return im;
    };
    this.splats = mk('splat', BLOOD_SPLAT_MAX); this.pools = mk('pool', BLOOD_POOL_MAX);
    this.woundMat = new THREE.MeshBasicMaterial({ map: bloodTexture('splat'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.woundGeo.userData.shared = true;
  }
  get splatCount() { return this.splats.count; }
  get poolCount() { return this.poolList.length; }
  get woundCount() { return this.wounds.length; }

  private put(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, rot: number) {
    this.q.setFromUnitVectors(this.z, this.p.set(nx, ny, nz).normalize());
    this.qz.setFromAxisAngle(this.z, rot); this.q.multiply(this.qz);
    this.sc.set(size, size, size);
    this.p.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006);
    this.m.compose(this.p, this.q, this.sc); mesh.setMatrixAt(i, this.m);
    mesh.instanceMatrix.needsUpdate = true;
  }
  /** One spatter quad on a surface (ring buffer: the oldest goes first). */
  splat(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number) {
    if (!this.enabled) return;
    this.put(this.splats, this.si, x, y, z, nx, ny, nz, size, Math.random() * Math.PI * 2);
    this.si = (this.si + 1) % BLOOD_SPLAT_MAX; this.splats.count = Math.min(BLOOD_SPLAT_MAX, this.splats.count + 1);
  }
  /**
   * A bullet hit a person at `at`, travelling along `dir`. Spatters the ground behind them and the wall behind (if any
   * within a few metres: `wall` = point + normal), and pins a small wound mark on the hit bone.
   */
  hit(at: THREE.Vector3, dir: THREE.Vector3, groundY: number, strength: number, wall: { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null, bone?: THREE.Object3D | null) {
    if (!this.enabled) return;
    const s = Math.min(1.8, 0.9 + strength * 0.6); // Round 8: bigger spatter, a trail of drops behind the body
    this.splat(at.x + dir.x * (0.5 + Math.random() * 0.8), groundY + 0.01, at.z + dir.z * (0.5 + Math.random() * 0.8), 0, 1, 0, 0.36 * s + Math.random() * 0.16);
    this.splat(at.x + dir.x * (1.3 + Math.random() * 1.2), groundY + 0.01, at.z + dir.z * (1.3 + Math.random() * 1.2), 0, 1, 0, 0.18 * s + Math.random() * 0.1);
    this.splat(at.x + (Math.random() - 0.5) * 0.5, groundY + 0.01, at.z + (Math.random() - 0.5) * 0.5, 0, 1, 0, 0.16 + Math.random() * 0.12);
    if (wall) { this.splat(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, 0.5 * s + Math.random() * 0.2); this.splat(wall.x, wall.y - 0.25 - Math.random() * 0.3, wall.z, wall.nx, wall.ny, wall.nz, 0.22 * s); }
    if (bone) this.wound(bone, at);
  }
  /** Dark wound mark on the bone nearest the hit (rides with the animation). 3 per bone, 40 in the world. */
  private wound(bone: THREE.Object3D, at: THREE.Vector3) {
    const mine = bone.children.filter(c => c.userData.wound);
    if (mine.length >= 3) { const old = mine[0]; old.removeFromParent(); this.wounds.splice(this.wounds.indexOf(old as THREE.Mesh), 1); }
    if (this.wounds.length >= 40) { const old = this.wounds.shift()!; old.removeFromParent(); }
    const mesh = new THREE.Mesh(this.woundGeo, this.woundMat); mesh.userData.wound = true; mesh.renderOrder = 3;
    bone.updateWorldMatrix(true, false);
    bone.worldToLocal(this.p.copy(at));
    mesh.position.copy(this.p); mesh.scale.setScalar(0.1 + Math.random() * 0.06);
    // face outwards from the bone axis (towards the shooter side): world +Z-ish; good enough for a spot this small
    const out = this.p.clone().normalize(); if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    mesh.quaternion.setFromUnitVectors(this.z, out);
    mesh.position.addScaledVector(out, 0.012);
    bone.add(mesh); this.wounds.push(mesh);
  }
  /** A body went down at (x, y, z): a pool starts under it and grows over ~14 s. */
  pool(x: number, y: number, z: number, follow?: { x: number; z: number }) {
    if (!this.enabled) return;
    if (this.poolList.length >= BLOOD_POOL_MAX) this.poolList.shift();
    this.poolList.push({ x, y: y + 0.012, z, age: 0, rot: Math.random() * Math.PI * 2, grow: 0.8 + Math.random() * 0.4, follow });
    this.sync();
  }
  update(dt: number) {
    if (this.bleeders.length) this.bleedTick(dt);
    if (!this.poolList.length) return;
    let growing = false;
    for (const r of this.poolList) if (r.age < POOL_GROW_S) {
      r.age += dt; growing = true;
      if (r.follow && r.age < 1.6) { r.x = r.follow.x; r.z = r.follow.z; } else r.follow = undefined; // the pool settles under the body once it has stopped sliding
    }
    if (growing) this.sync();
  }
  private sync() {
    const n = this.poolList.length; this.pools.count = n;
    for (let i = 0; i < n; i++) {
      const r = this.poolList[i], k = Math.min(1, r.age / POOL_GROW_S), size = (0.12 + (1 - (1 - k) ** 2) * (POOL_FULL * 2 - 0.12)) * r.grow;
      this.q.setFromAxisAngle(this.up, r.rot).multiply(this.qz.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      this.m.compose(this.p.set(r.x, r.y, r.z), this.q, this.sc.set(size, size, size)); this.pools.setMatrixAt(i, this.m);
    }
    this.pools.instanceMatrix.needsUpdate = true;
  }
  // ---------------- Round 7 gore (cheap: a capped list of bleeding wounds, particles + a few floor splats) ----------------
  /** emits blood particles (wired to Particles.blood by the combat code) */
  onSpurt: ((x: number, y: number, z: number, dx: number, dy: number, dz: number, s: number) => void) | null = null;
  bleeders: { bone: THREE.Object3D; t: number; every: number; acc: number; floorAcc: number; groundY: number; s: number; up: boolean }[] = [];
  /** A wound that keeps bleeding for `dur` s (spurts along the bone's up axis when `up`, else drips). At most BLEED_MAX at once. */
  bleed(bone: THREE.Object3D, groundY: number, dur: number, strength: number, up = false) {
    if (!this.enabled) return;
    const same = this.bleeders.find(b => b.bone === bone); if (same) { same.t = Math.max(same.t, dur); same.s = Math.max(same.s, strength); return; }
    if (this.bleeders.length >= BLEED_MAX) this.bleeders.shift();
    this.bleeders.push({ bone, t: dur, every: up ? 0.06 : 0.16, acc: 0, floorAcc: 0, groundY, s: strength, up });
  }
  /** Head shot off by a heavy round: the head goes, a dark stump caps the neck and it spurts for a few seconds. */
  decapitate(head: THREE.Object3D, neck: THREE.Object3D | null, groundY: number) {
    if (!this.enabled || head.userData.gone) return;
    head.userData.gone = true; head.scale.setScalar(0.001); // children (hair, hats skinned to it) collapse with it
    const at = neck ?? head.parent; if (!at) return;
    const stump = new THREE.Mesh(this.woundGeo, this.woundMat); stump.userData.wound = true; stump.renderOrder = 3;
    stump.position.copy(head.position).multiplyScalar(at === head.parent ? 1 : 0.9); stump.scale.setScalar(0.11);
    stump.quaternion.setFromUnitVectors(this.z, new THREE.Vector3(0, 1, 0));
    at.add(stump); this.wounds.push(stump);
    this.bleed(at, groundY, 5, 1.6, true);
  }
  private bleedTick(dt: number) {
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i]; b.t -= dt;
      if (b.t <= 0 || !b.bone.parent) { this.bleeders.splice(i, 1); continue; }
      const fade = Math.min(1, b.t / 2);
      b.acc += dt; b.floorAcc += dt;
      if (b.acc >= b.every) {
        b.acc = 0; b.bone.getWorldPosition(this.p);
        if (b.up) { b.bone.getWorldQuaternion(this.q); const u = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q); this.onSpurt?.(this.p.x, this.p.y + 0.05, this.p.z, u.x + (Math.random() - 0.5) * 0.4, u.y * 1.4 + 0.3, u.z + (Math.random() - 0.5) * 0.4, b.s * fade); }
        else this.onSpurt?.(this.p.x, this.p.y, this.p.z, (Math.random() - 0.5) * 0.3, -0.6, (Math.random() - 0.5) * 0.3, 0.35 * b.s * fade);
      }
      if (b.floorAcc >= (b.up ? 0.35 : 0.7)) { b.floorAcc = 0; b.bone.getWorldPosition(this.p); this.splat(this.p.x + (Math.random() - 0.5) * 0.3, b.groundY + 0.01, this.p.z + (Math.random() - 0.5) * 0.3, 0, 1, 0, 0.1 + Math.random() * 0.12 * b.s); }
    }
  }
  /** Wipes everything (respawn / sandbox clear). */
  clear() {
    this.bleeders.length = 0;
    this.splats.count = 0; this.si = 0; this.poolList.length = 0; this.pools.count = 0;
    for (const w of this.wounds) w.removeFromParent(); this.wounds.length = 0;
  }
}
