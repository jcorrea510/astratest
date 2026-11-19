/**
 * World glass: shop windows and doors as real panes. Rectangles registered with a world position and facing, found by
 * glassAt(point) and shattered by breakGlass(id). Combat calls these from Combat.trace (marked WORLDGLASS hook).
 * Street shopfronts are drawn as two instanced overlays (intact tint / cracked); store shells hand in their own mesh.
 */
import * as THREE from 'three';

export interface Pane {
  id: number; x: number; y: number; z: number; /** facing yaw (normal = sin,cos) */ yaw: number; w: number; h: number;
  /** bullets taken; cracked after 1, shattered at HITS_TO_BREAK */ hits: number; broken: boolean; inst: number; mesh: THREE.Mesh | null;
  /** frame collider behind the pane (walk-in stores): switched off when the pane shatters */
  collider?: { setEnabled(on: boolean): void } | null;
}
const CELL = 16;
export const HITS_TO_BREAK = 3;
/** how far behind a shattered street pane the visible (and bullet-stopping) interior backdrop sits */
export const BACKDROP_DEPTH = 1.5;
let crackTex: THREE.Texture | null = null;
function crackTexture(): THREE.Texture {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(235,245,250,0.9)'; g.lineWidth = 1.2;
  const cx = 64, cy = 64;
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.283; let x = cx, y = cy; const len = 30 + rnd() * 50;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += Math.cos(a + (rnd() - 0.5) * 0.5) * len / 5; y += Math.sin(a + (rnd() - 0.5) * 0.5) * len / 5; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(210,225,232,0.35)'; // jagged shards left in the frame corners
  for (let i = 0; i < 4; i++) { const px = i % 2 ? 128 : 0, py = i < 2 ? 0 : 128; g.beginPath(); g.moveTo(px, py); g.lineTo(px + (i % 2 ? -1 : 1) * (14 + rnd() * 24), py); g.lineTo(px, py + (i < 2 ? 1 : -1) * (14 + rnd() * 24)); g.fill(); }
  return crackTex = new THREE.CanvasTexture(c);
}

export class WorldGlass {
  panes: Pane[] = [];
  private grid = new Map<string, number[]>();
  private intact: THREE.InstancedMesh | null = null;
  private cracked: THREE.InstancedMesh | null = null;
  private backdrop: THREE.InstancedMesh | null = null;
  private n = 0; private cap = 0;
  private dummy = new THREE.Object3D();
  /** fired once per shattered pane (FX / audio in the game layer) */
  onBreak: ((p: Pane) => void) | null = null;

  private key(x: number, z: number) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }
  private index(p: Pane) {
    const k = this.key(p.x, p.z); const l = this.grid.get(k); if (l) l.push(p.id); else this.grid.set(k, [p.id]);
  }
  /** Registers a pane with no visual of its own (the caller owns the mesh, or it is drawn by the instanced overlay). */
  add(x: number, y: number, z: number, yaw: number, w: number, h: number, mesh: THREE.Mesh | null = null): number {
    const p: Pane = { id: this.panes.length, x, y, z, yaw, w, h, hits: 0, broken: false, inst: -1, mesh };
    this.panes.push(p); this.index(p); return p.id;
  }
  /** Street-shopfront pane drawn by the shared overlay (call finishOverlay once after all are added). */
  addOverlay(x: number, y: number, z: number, yaw: number, w: number, h: number): number {
    const id = this.add(x, y, z, yaw, w, h); this.panes[id].inst = this.n++; return id;
  }
  /** Builds the two instanced overlays for every addOverlay pane; returns the group to put in the scene. */
  finishOverlay(): THREE.Group {
    const root = new THREE.Group(); root.name = 'storeGlass';
    this.cap = this.n;
    const geo = new THREE.PlaneGeometry(1, 1);
    const m1 = new THREE.MeshStandardMaterial({ color: '#a9c4cc', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false });
    const m2 = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.intact = new THREE.InstancedMesh(geo, m1, Math.max(1, this.cap)); this.cracked = new THREE.InstancedMesh(geo, m2, Math.max(1, this.cap));
    this.intact.frustumCulled = false; this.cracked.frustumCulled = false; // spread over the whole city; GPU clips the rest
    this.cracked.count = this.cap;
    const d = this.dummy;
    for (const p of this.panes) if (p.inst >= 0) {
      d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0); d.scale.set(p.w, p.h, 1); d.updateMatrix();
      this.intact.setMatrixAt(p.inst, d.matrix);
      d.scale.setScalar(0); d.updateMatrix(); this.cracked.setMatrixAt(p.inst, d.matrix);
    }
    this.intact.count = this.cap;
    // a shallow dark 'interior' behind each shattered street pane, so the hole isn't a flat wall at the glass line
    this.backdrop = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#2b2622' }), Math.max(1, this.cap));
    this.backdrop.frustumCulled = false; this.backdrop.count = this.cap;
    d.scale.setScalar(0); d.updateMatrix(); for (const p of this.panes) if (p.inst >= 0) this.backdrop.setMatrixAt(p.inst, d.matrix);
    root.add(this.intact, this.cracked, this.backdrop);
    return root;
  }
  /** Id of the intact pane at a world point (within `tol` m of the pane plane), else null. */
  glassAt(pt: THREE.Vector3, tol = 0.3, includeBroken = false): number | string | null {
    const cx = Math.floor(pt.x / CELL), cz = Math.floor(pt.z / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const l = this.grid.get(`${i},${j}`); if (!l) continue;
      for (const id of l) {
        const p = this.panes[id]; if (p.broken && !includeBroken) continue;
        const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw);
        const dx = pt.x - p.x, dz = pt.z - p.z, dy = pt.y - p.y;
        if (Math.abs(dx * nx + dz * nz) > tol) continue;
        if (Math.abs(dx * nz - dz * nx) > p.w / 2 || Math.abs(dy) > p.h / 2) continue;
        return id;
      }
    }
    return null;
  }
  isOverlayPane(id: number | string): boolean { const p = this.panes[id as number]; return !!p && p.inst >= 0; }
  isGlassBroken(id: number | string): boolean { const p = this.panes[id as number]; return !p || p.broken; }
  /** A bullet strikes the pane: first hits leave cracks, the HITS_TO_BREAK-th shatters it. Returns true when it shattered. */
  hitGlass(id: number | string): boolean {
    const p = this.panes[id as number]; if (!p || p.broken) return false;
    p.hits++;
    if (p.hits >= HITS_TO_BREAK) return this.breakGlass(id);
    if (p.hits === 1) this.showCracks(p);
    return false;
  }
  private showCracks(p: Pane) {
    if (p.inst >= 0 && this.intact && this.cracked) {
      const d = this.dummy; d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0);
      d.scale.set(p.w, p.h, 1); d.updateMatrix(); this.cracked.setMatrixAt(p.inst, d.matrix); this.cracked.instanceMatrix.needsUpdate = true;
    } else if (p.mesh) {
      const cm = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false });
      p.mesh.userData.glassMat = p.mesh.material; p.mesh.material = cm;
    }
  }
  /** Fully shatters: render pane + cracks vanish, bullets pass afterwards (Combat.trace skips broken panes). */
  breakGlass(id: number | string): boolean {
    const p = this.panes[id as number]; if (!p || p.broken) return false;
    p.broken = true; p.hits = HITS_TO_BREAK;
    p.collider?.setEnabled(false);
    if (p.inst >= 0 && this.intact && this.cracked) {
      const d = this.dummy;
      d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0);
      d.scale.setScalar(0); d.updateMatrix();
      this.intact.setMatrixAt(p.inst, d.matrix); this.intact.instanceMatrix.needsUpdate = true;
      this.cracked.setMatrixAt(p.inst, d.matrix); this.cracked.instanceMatrix.needsUpdate = true;
      if (this.backdrop) { d.position.set(p.x - Math.sin(p.yaw) * BACKDROP_DEPTH, p.y, p.z - Math.cos(p.yaw) * BACKDROP_DEPTH); d.scale.set(p.w, p.h, 1); d.updateMatrix(); this.backdrop.setMatrixAt(p.inst, d.matrix); this.backdrop.instanceMatrix.needsUpdate = true; }
    } else if (p.mesh) {
      p.mesh.visible = false; p.mesh.removeFromParent();
    }
    this.onBreak?.(p);
    return true;
  }
  /** Clears everything (new city build). */
  reset() { this.panes = []; this.grid.clear(); this.n = 0; this.intact = null; this.cracked = null; this.backdrop = null; }
}

/** One registry for the whole world (street shopfronts and walk-in stores register here). */
export const worldGlass = new WorldGlass();
