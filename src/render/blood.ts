/**
 * Moderate blood (Teen): small spatter decals on the ground / wall behind a hit, a slowly growing pool under a body, and
 * dark wound marks on the hit zone. Everything is pooled in two InstancedMeshes (ring buffers, one draw call each), so
 * the cost is fixed no matter how many people are shot. `enabled = false` (Settings "Blood") spawns nothing.
 */
import * as THREE from 'three';
import { MAX_PIECES } from '../combat/dismember';

export const BLOOD_SPLAT_MAX = 320;
export const BLOOD_POOL_MAX = 28;
/** wounds bleeding at once (Round 7 gore budget) */
export const BLEED_MAX = 10;
const POOL_FULL = 1.1; // metres of radius when fully grown (Round 8: bigger)
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

/** a severed limb tumbling / lying on the ground */
/** Unit limb: +Y end is the bloody cut, -Y end the hand / foot; tapered, vertex-coloured (instance colour = skin / clothes). */
function limbGeometry(): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(1, 0.72, 1, 9, 1, false).toNonIndexed(); // thick at the cut, narrower at the hand / foot
  const ball = new THREE.SphereGeometry(1, 8, 6).toNonIndexed(); ball.scale(0.95, 0.11, 0.95); ball.translate(0, -0.47, 0); // hand / foot blob (the instance is stretched along Y by the limb length)
  const geos = [cyl, ball]; const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const g of geos) {
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i));
      const cut = g === cyl && P.getY(i) > 0.45 && N.getY(i) > 0.5; // the flat top cap
      if (cut) col.push(0.5, 0.04, 0.05); else if (g === cyl && P.getY(i) > 0.3) col.push(0.78, 0.5, 0.5); else col.push(1, 1, 1);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.userData.shared = true; return out;
}

interface Piece { x: number; y: number; z: number; vx: number; vy: number; vz: number; q: THREE.Quaternion; wx: number; wy: number; wz: number; len: number; r: number; gy: number; rest: boolean; t: number; spurt: number }
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
    // Round 9: severed limbs, one InstancedMesh (one draw call, material built here so it is compiled with the scene)
    this.stumpMat = new THREE.MeshStandardMaterial({ color: 0x2e0407, roughness: 0.3, metalness: 0 });
    this.stumpGeo = new THREE.SphereGeometry(1, 10, 7); this.stumpGeo.userData.shared = true;
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
    this.pieces = new THREE.InstancedMesh(limbGeometry(), pm, MAX_PIECES); this.pieces.frustumCulled = false;
    this.pieces.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PIECES * 3).fill(1), 3);
    this.sc.set(0, 0, 0); this.m.compose(this.p.set(0, -50, 0), this.q.identity(), this.sc);
    for (let i = 0; i < MAX_PIECES; i++) this.pieces.setMatrixAt(i, this.m);
    scene.add(this.pieces);
  }
  readonly pieces: THREE.InstancedMesh;
  private pieceList: Piece[] = []; private pi = 0;
  private stumpMat: THREE.MeshStandardMaterial; private stumpGeo: THREE.SphereGeometry;
  /** wounded people who leave drops behind them as they move */
  private trailers: { p: { x: number; z: number }; y: number; t: number; lx: number; lz: number; acc: number }[] = [];
  get pieceCount() { return this.pieceList.length; }
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
    const s = Math.min(2.2, 0.9 + strength * 0.7); // Round 9: much more spatter, a long fan of drops behind the body
    const n = 3 + Math.round(strength * 3.5);
    for (let i = 0; i < n; i++) {
      const d = 0.4 + i * 0.55 + Math.random() * 0.6, sp = (Math.random() - 0.5) * (0.4 + i * 0.25);
      this.splat(at.x + dir.x * d - dir.z * sp, groundY + 0.01, at.z + dir.z * d + dir.x * sp, 0, 1, 0, Math.max(0.1, (0.4 - i * 0.04) * s) + Math.random() * 0.16);
    }
    this.splat(at.x + (Math.random() - 0.5) * 0.5, groundY + 0.01, at.z + (Math.random() - 0.5) * 0.5, 0, 1, 0, 0.2 + Math.random() * 0.14);
    if (wall) {
      const wn = 2 + Math.round(strength * 1.6);
      for (let i = 0; i < wn; i++) this.splat(wall.x + (Math.random() - 0.5) * 0.7 * s, wall.y + (Math.random() - 0.5) * 0.7 * s - i * 0.12, wall.z + (Math.random() - 0.5) * 0.7 * s, wall.nx, wall.ny, wall.nz, (i === 0 ? 0.62 : 0.3) * s + Math.random() * 0.2);
    }
    if (bone) this.wound(bone, at);
  }
  /** A burst of floor drops around a point (a head or limb coming off). */
  splashFloor(x: number, z: number, groundY: number, radius: number, n: number) {
    if (!this.enabled) return;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = Math.random() * radius; this.splat(x + Math.cos(a) * d, groundY + 0.01, z + Math.sin(a) * d, 0, 1, 0, 0.14 + Math.random() * 0.3); }
  }
  /** Drops behind a wounded person while they move (and stand bleeding): at most 8 people at once. */
  trail(p: { x: number; z: number }, groundY: number, dur: number) {
    if (!this.enabled) return;
    const same = this.trailers.find(t => t.p === p); if (same) { same.t = Math.max(same.t, dur); return; }
    if (this.trailers.length >= 8) this.trailers.shift();
    this.trailers.push({ p, y: groundY, t: dur, lx: p.x, lz: p.z, acc: 0 });
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
  pool(x: number, y: number, z: number, follow?: { x: number; z: number }, size = 1) {
    if (!this.enabled) return;
    if (this.poolList.length >= BLOOD_POOL_MAX) this.poolList.shift();
    this.poolList.push({ x, y: y + 0.012, z, age: 0, rot: Math.random() * Math.PI * 2, grow: (0.8 + Math.random() * 0.4) * size, follow });
    this.sync();
  }
  update(dt: number) {
    if (this.bleeders.length) this.bleedTick(dt);
    if (this.trailers.length) this.trailTick(dt);
    if (this.pieceList.length) this.pieceTick(dt);
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
  bleeders: { bone: THREE.Object3D; t: number; every: number; acc: number; floorAcc: number; groundY: number; s: number; up: boolean; dir?: THREE.Vector3; off?: THREE.Vector3; ph: number }[] = [];
  /** A wound that keeps bleeding for `dur` s (spurts along the bone's up axis when `up`, else drips). At most BLEED_MAX at once. */
  bleed(bone: THREE.Object3D, groundY: number, dur: number, strength: number, up = false, dir?: THREE.Vector3, off?: THREE.Vector3) {
    if (!this.enabled) return;
    const same = this.bleeders.find(b => b.bone === bone); if (same) { same.t = Math.max(same.t, dur); same.s = Math.max(same.s, strength); return; }
    if (this.bleeders.length >= BLEED_MAX) this.bleeders.shift();
    this.bleeders.push({ bone, t: dur, every: up ? 0.05 : 0.12, acc: 0, floorAcc: 0, groundY, s: strength, up, dir, off, ph: Math.random() * 6 });
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
    this.bleed(at, groundY, 7, 1.9, true);
    this.splashFloor(this.p.x, this.p.z, groundY, 1.3, 5);
  }
  private pv = new THREE.Vector3();
  private bleedTick(dt: number) {
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i]; b.t -= dt;
      if (b.t <= 0 || !b.bone.parent) { this.bleeders.splice(i, 1); continue; }
      const fade = Math.min(1, b.t / 2);
      b.acc += dt; b.floorAcc += dt;
      if (b.acc >= b.every) {
        b.acc = 0; b.bone.getWorldPosition(this.p);
        if (b.dir && b.off) { // limb stump: pulsing arterial spurt out of the cut, along the severed direction
          b.ph += 0.9; const pulse = 0.55 + 0.45 * Math.sin(b.ph);
          this.p.copy(b.off); b.bone.localToWorld(this.p); b.bone.getWorldQuaternion(this.q); const u = this.pv.copy(b.dir).applyQuaternion(this.q);
          this.onSpurt?.(this.p.x, this.p.y, this.p.z, u.x * 0.8 + (Math.random() - 0.5) * 0.5, u.y * 0.8 + 0.5 * pulse, u.z * 0.8 + (Math.random() - 0.5) * 0.5, b.s * fade * pulse);
        } else if (b.up) { b.bone.getWorldQuaternion(this.q); const u = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q); this.onSpurt?.(this.p.x, this.p.y + 0.05, this.p.z, u.x + (Math.random() - 0.5) * 0.4, u.y * 1.4 + 0.3, u.z + (Math.random() - 0.5) * 0.4, b.s * fade); }
        else this.onSpurt?.(this.p.x, this.p.y, this.p.z, (Math.random() - 0.5) * 0.3, -0.6, (Math.random() - 0.5) * 0.3, 0.35 * b.s * fade);
      }
      if (b.floorAcc >= (b.up ? 0.35 : 0.7)) { b.floorAcc = 0; b.bone.getWorldPosition(this.p); this.splat(this.p.x + (Math.random() - 0.5) * 0.3, b.groundY + 0.01, this.p.z + (Math.random() - 0.5) * 0.3, 0, 1, 0, 0.1 + Math.random() * 0.12 * b.s); }
    }
  }
  /**
   * Takes a limb off at `joint` (the first bone of the lost part: its scale collapses, which hides it and everything
   * below it, like a head). `end` = last bone of the part (hand / foot), used for the piece's length. The parent bone gets
   * a bloody stump that spurts; a tumbling piece in `color` flies off along `dir` (cap MAX_PIECES, oldest recycled).
   */
  severLimb(joint: THREE.Object3D, end: THREE.Object3D, groundY: number, dir: THREE.Vector3, power: number, color: THREE.Color, radius: number) {
    if (!this.enabled || joint.userData.gone || !joint.parent) return;
    joint.updateWorldMatrix(true, true);
    const J = joint.getWorldPosition(new THREE.Vector3()), E = end.getWorldPosition(new THREE.Vector3());
    const axis = E.clone().sub(J), len = Math.max(0.22, axis.length() + 0.1); if (axis.lengthSq() < 1e-6) axis.set(0, -1, 0); axis.normalize();
    joint.userData.gone = true; joint.scale.setScalar(0.001);
    const parent = joint.parent, localDir = joint.position.clone(); if (localDir.lengthSq() < 1e-8) localDir.set(0, 1, 0); localDir.normalize();
    const stump = new THREE.Mesh(this.stumpGeo, this.stumpMat); stump.userData.wound = true; stump.renderOrder = 3;
    stump.position.copy(joint.position); stump.scale.set(radius * 1.15, radius * 1.15, radius * 0.5);
    stump.quaternion.setFromUnitVectors(this.z, localDir);
    parent.add(stump); this.wounds.push(stump);
    this.bleed(parent, groundY, 8, 2 + power * 0.3, true, localDir, joint.position.clone());
    this.onSpurt?.(J.x, J.y, J.z, dir.x * 1.2, 0.8, dir.z * 1.2, 2.2 * power);
    this.splashFloor(J.x, J.z, groundY, 1.4, 6);
    // the piece
    const i = this.pi; this.pi = (this.pi + 1) % MAX_PIECES;
    const old = this.pieceList.findIndex(q => (q as Piece & { i?: number }).i === i); if (old >= 0) this.pieceList.splice(old, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().negate());
    const c = J.clone().addScaledVector(axis, len / 2), k = 1.6 + power * 2.2;
    const pc = { x: c.x, y: c.y, z: c.z, vx: dir.x * k + (Math.random() - 0.5), vy: 1.6 + Math.random() * 1.6, vz: dir.z * k + (Math.random() - 0.5), q, wx: (Math.random() - 0.5) * 9, wy: (Math.random() - 0.5) * 5, wz: (Math.random() - 0.5) * 9, len, r: radius, gy: groundY, rest: false, t: 0, spurt: 1.2, i } as Piece & { i: number };
    this.pieceList.push(pc);
    this.pieces.setColorAt(i, color); if (this.pieces.instanceColor) this.pieces.instanceColor.needsUpdate = true;
    this.writePiece(i, pc);
  }
  private writePiece(i: number, pc: Piece) {
    this.sc.set(pc.r, pc.len, pc.r); this.m.compose(this.p.set(pc.x, pc.y, pc.z), pc.q, this.sc);
    this.pieces.setMatrixAt(i, this.m); this.pieces.instanceMatrix.needsUpdate = true;
  }
  private pieceTick(dt: number) {
    const up = this.pv, qd = this.qz;
    for (const pc of this.pieceList as (Piece & { i: number })[]) {
      if (pc.rest) continue;
      pc.t += dt;
      pc.vy -= 12 * dt; pc.x += pc.vx * dt; pc.y += pc.vy * dt; pc.z += pc.vz * dt;
      // spin
      const wl = Math.hypot(pc.wx, pc.wy, pc.wz);
      if (wl > 1e-3) { qd.setFromAxisAngle(this.p.set(pc.wx / wl, pc.wy / wl, pc.wz / wl), wl * dt); pc.q.premultiply(qd).normalize(); }
      if (pc.spurt > 0) { pc.spurt -= dt; if (Math.random() < 0.6) this.onSpurt?.(pc.x, pc.y, pc.z, pc.vx * 0.2, 0.2, pc.vz * 0.2, 0.5); }
      // ground: the lowest end of the segment rests on the floor
      up.set(0, 1, 0).applyQuaternion(pc.q); const low = pc.y - Math.abs(up.y) * pc.len / 2 - pc.r;
      if (low < pc.gy) {
        pc.y += pc.gy - low;
        if (pc.vy < -1.2) { this.splat(pc.x, pc.gy + 0.01, pc.z, 0, 1, 0, 0.3 + Math.random() * 0.2); }
        pc.vy = Math.abs(pc.vy) > 1.5 ? -pc.vy * 0.28 : 0; pc.vx *= 0.6; pc.vz *= 0.6; pc.wx *= 0.5; pc.wy *= 0.5; pc.wz *= 0.5;
      }
      if (pc.t > 0.2 && Math.hypot(pc.vx, pc.vz) < 0.35 && Math.abs(pc.vy) < 0.1 && low <= pc.gy + 0.03) {
        // settle lying flat
        const ax = up.set(0, 1, 0).applyQuaternion(pc.q); ax.y = 0; if (ax.lengthSq() < 1e-4) ax.set(1, 0, 0); ax.normalize();
        pc.q.setFromUnitVectors(this.z.set(0, 1, 0), ax); this.z.set(0, 0, 1);
        pc.y = pc.gy + pc.r; pc.rest = true; pc.vx = pc.vy = pc.vz = 0;
        this.pool(pc.x, pc.gy, pc.z, undefined, 0.45);
      }
      this.writePiece(pc.i, pc);
    }
  }
  private trailTick(dt: number) {
    for (let i = this.trailers.length - 1; i >= 0; i--) {
      const t = this.trailers[i]; t.t -= dt; t.acc += dt;
      if (t.t <= 0) { this.trailers.splice(i, 1); continue; }
      const d = Math.hypot(t.p.x - t.lx, t.p.z - t.lz);
      if (d > 0.5) { // smear along the path
        const n = Math.min(3, Math.ceil(d / 0.5));
        for (let k = 1; k <= n; k++) this.splat(t.lx + (t.p.x - t.lx) * k / n, t.y + 0.01, t.lz + (t.p.z - t.lz) * k / n, 0, 1, 0, 0.13 + Math.random() * 0.14);
        t.lx = t.p.x; t.lz = t.p.z; t.acc = 0;
      } else if (t.acc > 0.6) { t.acc = 0; this.splat(t.p.x + (Math.random() - 0.5) * 0.2, t.y + 0.01, t.p.z + (Math.random() - 0.5) * 0.2, 0, 1, 0, 0.1 + Math.random() * 0.1); }
    }
  }
  /** Wipes everything (respawn / sandbox clear). */
  clear() {
    this.bleeders.length = 0; this.trailers.length = 0; this.pieceList.length = 0; this.pi = 0;
    this.sc.set(0, 0, 0); this.m.compose(this.p.set(0, -50, 0), this.q.identity(), this.sc);
    for (let i = 0; i < MAX_PIECES; i++) this.pieces.setMatrixAt(i, this.m);
    this.pieces.instanceMatrix.needsUpdate = true;
    this.splats.count = 0; this.si = 0; this.poolList.length = 0; this.pools.count = 0;
    for (const w of this.wounds) w.removeFromParent(); this.wounds.length = 0;
  }
}
