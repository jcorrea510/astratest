/** GPU-friendly zero-allocation SoA particles (one Points draw per blend mode) and ring-buffer decals & skid marks. */
import * as THREE from 'three';

export type ImpactKind = 'concrete' | 'metal' | 'body' | 'water' | 'wood' | 'dirt' | 'glass';
const rnd = (lo: number, hi: number) => lo + (hi - lo) * Math.random();

/**
 * Zero-allocation Struct-of-Arrays particle pool.
 * Eliminates thousands of short-lived object allocations & O(N) Array.shift() calls during big firefights,
 * and skips GPU buffer uploads completely when idle.
 */
class Pool {
  points: THREE.Points;
  private n = 0;
  private hadLive = false;
  private cursor = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private maxL: Float32Array;
  private size: Float32Array; private grow: Float32Array;
  private cr: Float32Array; private cg: Float32Array; private cb: Float32Array; private ca: Float32Array;
  private drag: Float32Array; private grav: Float32Array;
  private hold: Float32Array; private floor: Float32Array; private bounce: Float32Array;
  private pos: Float32Array; private col: Float32Array; private siz: Float32Array;

  constructor(private max: number, additive: boolean, tex: THREE.Texture) {
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxL = new Float32Array(max);
    this.size = new Float32Array(max); this.grow = new Float32Array(max);
    this.cr = new Float32Array(max); this.cg = new Float32Array(max); this.cb = new Float32Array(max); this.ca = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.hold = new Float32Array(max); this.floor = new Float32Array(max); this.bounce = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.siz = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(size * scale / max(0.5, -mv.z), 220.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.004) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }

  emit(
    x: number, y: number, z: number,
    vx = 0, vy = 0, vz = 0,
    max = 1, size = 0.3, grow = 0,
    r = 1, g = 1, b = 1, a = 1,
    drag = 1, grav = 0, hold = 0, floor = 0.05, bounce = 0.3,
  ) {
    let idx: number;
    if (this.n < this.max) {
      idx = this.n++;
    } else {
      idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
    }
    this.px[idx] = x; this.py[idx] = y; this.pz[idx] = z;
    this.vx[idx] = vx; this.vy[idx] = vy; this.vz[idx] = vz;
    this.life[idx] = 0; this.maxL[idx] = max;
    this.size[idx] = size; this.grow[idx] = grow;
    this.cr[idx] = r; this.cg[idx] = g; this.cb[idx] = b; this.ca[idx] = a;
    this.drag[idx] = drag; this.grav[idx] = grav;
    this.hold[idx] = hold; this.floor[idx] = floor; this.bounce[idx] = bounce;
  }

  update(dt: number, height: number) {
    if (this.n === 0 && !this.hadLive) return;
    const px = this.px, py = this.py, pz = this.pz;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const life = this.life, maxL = this.maxL, size = this.size, grow = this.grow;
    const cr = this.cr, cg = this.cg, cb = this.cb, ca = this.ca;
    const drag = this.drag, grav = this.grav, hold = this.hold, floor = this.floor, bounce = this.bounce;
    const pos = this.pos, col = this.col, siz = this.siz;

    let w = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const l = life[i] + dt;
      const ml = maxL[i];
      if (l >= ml) continue;
      const dr = drag[i];
      const d = dr > 0 ? Math.exp(-dr * dt) : 1;
      const g = grav[i];
      let nvx = vx[i] * d;
      let nvy = vy[i] * d - g * dt;
      let nvz = vz[i] * d;
      const nx = px[i] + nvx * dt;
      let ny = py[i] + nvy * dt;
      const nz = pz[i] + nvz * dt;
      const fl = floor[i];
      if (ny < fl && g > 0) {
        ny = fl;
        nvy *= -bounce[i];
        nvx *= 0.6;
        nvz *= 0.6;
      }
      // Compact live slot in-place when needed
      if (w !== i) {
        maxL[w] = ml; size[w] = size[i]; grow[w] = grow[i];
        cr[w] = cr[i]; cg[w] = cg[i]; cb[w] = cb[i]; ca[w] = ca[i];
        drag[w] = dr; grav[w] = g; hold[w] = hold[i]; floor[w] = fl; bounce[w] = bounce[i];
      }
      px[w] = nx; py[w] = ny; pz[w] = nz;
      vx[w] = nvx; vy[w] = nvy; vz[w] = nvz;
      life[w] = l;

      const t = l / ml;
      const h = hold[w];
      const fade = h > 0 ? (t < h ? 1 : 1 - (t - h) / (1 - h)) : t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9;
      const w3 = w * 3, w4 = w * 4;
      pos[w3] = nx; pos[w3 + 1] = ny; pos[w3 + 2] = nz;
      col[w4] = cr[w]; col[w4 + 1] = cg[w]; col[w4 + 2] = cb[w]; col[w4 + 3] = ca[w] * fade;
      siz[w] = size[w] * (1 + grow[w] * t);
      w++;
    }
    this.n = w;
    if (this.cursor >= w) this.cursor = 0;
    const g = this.points.geometry;
    g.setDrawRange(0, w);
    if (w > 0 || this.hadLive) {
      (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    }
    this.hadLive = w > 0;
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = height * 0.5;
  }
  get count() { return this.n; }
}

export class Particles {
  add: Pool; normal: Pool;
  /** Small long-lived pool for bullet marks and shell casings, so they never evict smoke or sparks. */
  debris: Pool;
  /** Bullet holes on walls, ground and car bodies. */
  decals: Decals;
  constructor(scene: THREE.Scene, max: number) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    // crisper sprite for hard little things (casings, chips, bullet marks)
    const c2 = document.createElement('canvas'); c2.width = c2.height = 32; const g2 = c2.getContext('2d')!;
    const gr2 = g2.createRadialGradient(16, 16, 0, 16, 16, 16); gr2.addColorStop(0, 'rgba(255,255,255,1)'); gr2.addColorStop(0.55, 'rgba(255,255,255,0.95)'); gr2.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = gr2; g2.fillRect(0, 0, 32, 32);
    const hard = new THREE.CanvasTexture(c2);
    this.add = new Pool(max, true, tex); this.normal = new Pool(max, false, tex);
    this.debris = new Pool(Math.max(96, Math.min(256, Math.round(max / 4))), false, hard);
    scene.add(this.add.points, this.normal.points, this.debris.points);
    this.decals = new Decals(scene);
  }
  /** Bullet hole at a hit point facing the surface normal; `parent` (a moving object such as a car body) carries it. */
  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: ImpactKind, parent?: THREE.Object3D) { this.decals.add(x, y, z, nx, ny, nz, kind, parent); }
  setMax(max: number) { void max; }
  update(dt: number, viewportHeight: number) { this.add.update(dt, viewportHeight); this.normal.update(dt, viewportHeight); this.debris.update(dt, viewportHeight); }

  sparks(x: number, y: number, z: number, n = 10, speed = 6) {
    for (let i = 0; i < n; i++) {
      this.add.emit(
        x, y, z,
        (Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed,
        0.25 + Math.random() * 0.35, 0.08 + Math.random() * 0.06, 0,
        1, 0.75, 0.35, 1, 2, 14,
      );
    }
  }
  /**
   * Muzzle flash: a white-hot core, a short forward cone of flame petals, a side "star" burst and a lingering wisp of
   * smoke. `big` (shotgun) is the old boolean API; `scale` sizes it per weapon. Everything is ~2 frames long.
   */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, big = false, scale = 1) {
    const s = (big ? 1.45 : 1) * scale;
    // core
    this.add.emit(x + dx * 0.04, y + dy * 0.04, z + dz * 0.04, 0, 0, 0, 0.055, 0.42 * s * rnd(0.85, 1.15), 0, 1, 0.93, 0.75, 1, 1, 0, 0.7);
    this.add.emit(x + dx * 0.1 * s, y + dy * 0.1 * s, z + dz * 0.1 * s, 0, 0, 0, 0.05, 0.62 * s * rnd(0.8, 1.2), 0, 1, 0.62, 0.25, 0.8, 1, 0, 0.7);
    // forward flame cone
    const n = big ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n * rnd(0.7, 1.1);
      this.add.emit(x + dx * k * 0.32 * s, y + dy * k * 0.32 * s, z + dz * k * 0.32 * s, dx * 3, dy * 3, dz * 3, 0.045, (0.3 - k * 0.12) * s, 0, 1, 0.7 - k * 0.2, 0.3 - k * 0.15, 0.9, 8, 0, 0.7);
    }
    // side star (perpendicular to the barrel)
    const rx = dz, rz = -dx, rl = Math.hypot(rx, rz) || 1;
    const irx = rx / rl, irz = rz / rl;
    this.add.emit(x - irx * 0.07 * s, y, z - irz * 0.07 * s, -irx * 2.5, 0, -irz * 2.5, 0.04, 0.16 * s, 0, 1, 0.75, 0.4, 0.7, 10, 0, 0.7);
    this.add.emit(x + irx * 0.07 * s, y, z + irz * 0.07 * s, irx * 2.5, 0, irz * 2.5, 0.04, 0.16 * s, 0, 1, 0.75, 0.4, 0.7, 10, 0, 0.7);
    // a few hot embers
    const embers = big ? 6 : 2;
    for (let i = 0; i < embers; i++) {
      this.add.emit(x, y, z, dx * rnd(6, 14) + rnd(-1.5, 1.5), dy * rnd(6, 14) + rnd(-1, 1.5), dz * rnd(6, 14) + rnd(-1.5, 1.5), rnd(0.08, 0.18), 0.045, 0, 1, 0.7, 0.3, 1, 4, 4, 0.3);
    }
    // smoke wisp
    const wisps = big ? 3 : 1;
    for (let i = 0; i < wisps; i++) {
      this.normal.emit(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, dx * rnd(0.8, 2) + rnd(-0.2, 0.2), 0.35 + rnd(0, 0.3), dz * rnd(0.8, 2) + rnd(-0.2, 0.2), rnd(0.7, 1.2) * (big ? 1.4 : 1), 0.16 * s, 4, 0.78, 0.77, 0.75, big ? 0.28 : 0.18, 2.2, -0.15);
    }
  }
  /** Ejected shell casing (brass) or shotgun hull (red plastic). Bounces on `floorY`, lingers briefly. */
  casing(x: number, y: number, z: number, vx: number, vy: number, vz: number, floorY: number, hull = false, rifle = false) {
    const r = hull ? 0.75 : 0.95, g = hull ? 0.16 : 0.72, b = hull ? 0.12 : 0.3;
    this.debris.emit(x, y, z, vx, vy, vz, hull ? 3 : 2.2, hull ? 0.06 : rifle ? 0.05 : 0.04, 0, r, g, b, 1, 0.4, 11, 0.85, floorY + (hull ? 0.03 : 0.02), 0.35);
    if (!hull) this.add.emit(x, y, z, vx, vy, vz, 0.25, 0.05, 0, 1, 0.8, 0.45, 0.6, 0.4, 11, 0.4, floorY + 0.02);
  }
  /**
   * Bullet impact by surface. (nx, ny, nz) points away from the surface (towards the shooter for bodies).
   * `strength` scales the effect (shotgun pellets use ~0.5).
   */
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: ImpactKind, strength = 1) {
    const S = strength;
    if (kind === 'metal') {
      this.add.emit(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 0, 0, 0, 0.05, 0.28 * S, 0, 1, 0.9, 0.7, 1, 1, 0, 0.6);
      const n = Math.round(9 * S);
      for (let i = 0; i < n; i++) {
        const k = rnd(3, 9);
        this.add.emit(x, y, z, nx * k + rnd(-1, 1) * k * 0.6, ny * k + rnd(-0.4, 1) * k * 0.6, nz * k + rnd(-1, 1) * k * 0.6, rnd(0.12, 0.38), rnd(0.035, 0.06), 0, 1, rnd(0.7, 0.9), 0.4, 1, 1.5, 12, 0.5, y - 3, 0.25);
      }
      this.normal.emit(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 0.6 + rnd(-0.36, 0.36), ny * 0.6 + rnd(-0.24, 0.6), nz * 0.6 + rnd(-0.36, 0.36), 0.5, 0.12 * S, 3, 0.6, 0.6, 0.62, 0.25, 3);
      if (S >= 0.4) this.debris.emit(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015, 0, 0, 0, 5 * rnd(0.85, 1.15), 0.05 * rnd(0.85, 1.2), 0, 0.18, 0.18, 0.2, 0.85, 1, 0, 0.8);
    } else if (kind === 'concrete' || kind === 'dirt' || kind === 'wood') {
      const cr = kind === 'concrete' ? 0.74 : kind === 'dirt' ? 0.52 : 0.55;
      const cg = kind === 'concrete' ? 0.7 : kind === 'dirt' ? 0.43 : 0.4;
      const cb = kind === 'concrete' ? 0.64 : kind === 'dirt' ? 0.32 : 0.26;
      if (kind === 'concrete') this.add.emit(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 0, 0, 0, 0.05, 0.18 * S, 0, 1, 0.85, 0.6, 1, 1, 0, 0.6);
      const puffs = Math.max(2, Math.round(4 * S));
      for (let i = 0; i < puffs; i++) {
        const k = rnd(1, 2.6);
        this.normal.emit(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * k + rnd(-1, 1) * k * 0.6, ny * k + rnd(-0.4, 1) * k * 0.6, nz * k + rnd(-1, 1) * k * 0.6, rnd(0.6, 1.1), rnd(0.1, 0.16) * (0.6 + S * 0.4), 3.2, cr, cg, cb, kind === 'dirt' ? 0.55 : 0.5, 4, -0.2);
      }
      const chips = Math.round((kind === 'wood' ? 6 : 5) * S);
      const fl = Math.min(y, 0.2) - 0.1;
      for (let i = 0; i < chips; i++) {
        const k = rnd(2.5, 6);
        this.debris.emit(x, y, z, nx * k + rnd(-1, 1) * k * 0.6, ny * k + rnd(-0.4, 1) * k * 0.6, nz * k + rnd(-1, 1) * k * 0.6, rnd(0.5, 0.9), kind === 'wood' ? rnd(0.03, 0.05) : rnd(0.022, 0.04), 0, cr * 0.8, cg * 0.8, cb * 0.8, 1, 1, 14, 0.7, fl, 0.2);
      }
      if (S >= 0.4) {
        const life = kind === 'dirt' ? 3 : 7;
        const sz = kind === 'dirt' ? 0.08 : 0.055;
        this.debris.emit(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015, 0, 0, 0, life * rnd(0.85, 1.15), sz * rnd(0.85, 1.2), 0, kind === 'wood' ? 0.2 : 0.12, kind === 'wood' ? 0.15 : 0.11, 0.1, 0.85, 1, 0, 0.8);
      }
    } else if (kind === 'glass') {
      this.add.emit(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 0, 0, 0, 0.05, 0.2 * S, 0, 0.9, 0.95, 1, 1, 1, 0, 0.6);
      const shards = Math.round(8 * S);
      for (let i = 0; i < shards; i++) {
        const k = rnd(2, 6);
        this.add.emit(x, y, z, nx * k + rnd(-1, 1) * k * 0.6, ny * k + rnd(-0.4, 1) * k * 0.6, nz * k + rnd(-1, 1) * k * 0.6, rnd(0.3, 0.6), rnd(0.02, 0.04), 0, 0.8, 0.9, 1, 0.8, 1, 14, 0.5);
      }
    } else if (kind === 'water') {
      const colN = Math.round(5 * S);
      for (let i = 0; i < colN; i++) this.normal.emit(x + rnd(-0.05, 0.05), y, z + rnd(-0.05, 0.05), rnd(-0.3, 0.3), rnd(3.5, 6.5), rnd(-0.3, 0.3), rnd(0.45, 0.7), rnd(0.08, 0.14), 1.2, 0.9, 0.96, 1, 0.75, 1, 12, 0.3, y - 1);
      const ringN = Math.round(9 * S);
      for (let i = 0; i < ringN; i++) { const a = Math.random() * Math.PI * 2, sp = rnd(1, 2.5); this.normal.emit(x, y, z, Math.cos(a) * sp, rnd(1.5, 3.5), Math.sin(a) * sp, 0.5, 0.05, 0, 0.92, 0.97, 1, 0.8, 1, 12, 0.3, y - 1); }
      this.normal.emit(x, y + 0.05, z, 0, 0, 0, 0.6, 0.35 * S, 2.5, 0.95, 0.98, 1, 0.35, 2);
    } else {
      const n = Math.round(4 * S);
      for (let i = 0; i < n; i++) {
        const k = rnd(0.8, 2.2);
        this.normal.emit(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, nx * k + rnd(-1, 1) * k * 0.6, ny * k + rnd(-0.4, 1) * k * 0.6, nz * k + rnd(-1, 1) * k * 0.6, rnd(0.18, 0.32), rnd(0.06, 0.1) * (0.6 + 0.4 * S), 2.6, 0.42, 0.05, 0.05, 0.55, 6, 1.5);
      }
      for (let i = 0; i < 2; i++) {
        const k = rnd(0.6, 1.4);
        this.normal.emit(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, nx * k + rnd(-1, 1) * k * 0.6, ny * k + rnd(-0.4, 1) * k * 0.6, nz * k + rnd(-1, 1) * k * 0.6, rnd(0.25, 0.4), rnd(0.07, 0.1) * (0.6 + 0.4 * S), 2.2, 0.78, 0.74, 0.72, 0.4, 5);
      }
    }
  }
  /** Blood spray along `dir` + drops that fall and splat on the ground (gated by Settings "Blood" toggle). */
  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number, strength = 1) {
    const S = Math.min(3, strength);
    const n1 = Math.round(20 * S), n2 = Math.round(6 * S), n3 = Math.round(10 * S);
    const fl = Math.max(0, y - 1.7);
    for (let i = 0; i < n1; i++) this.normal.emit(x, y, z, dx * rnd(1.5, 6) + rnd(-1.2, 1.2), dy * rnd(1.5, 4) + rnd(0.2, 2), dz * rnd(1.5, 6) + rnd(-1.2, 1.2), rnd(0.3, 0.7), rnd(0.04, 0.09), 0, 0.45, 0.03, 0.04, 0.92, 2.2, 7, 0.5);
    for (let i = 0; i < n2; i++) this.normal.emit(x, y, z, -dx * rnd(0.8, 2) + rnd(-0.6, 0.6), rnd(0.2, 1.2), -dz * rnd(0.8, 2) + rnd(-0.6, 0.6), rnd(0.2, 0.4), rnd(0.03, 0.06), 0, 0.42, 0.03, 0.04, 0.9, 2.6, 7, 0.5);
    for (let i = 0; i < n3; i++) this.debris.emit(x, y, z, dx * rnd(1, 4) + rnd(-0.8, 0.8), rnd(0.4, 2.2), dz * rnd(1, 4) + rnd(-0.8, 0.8), rnd(0.5, 1), rnd(0.02, 0.04), 0, 0.35, 0.02, 0.03, 1, 0.8, 12, 0.9, fl);
    this.bloodMist(x, y, z, dx, dz, S);
  }
  bloodMist(x: number, y: number, z: number, dx: number, dz: number, S = 1) {
    const n = Math.round(3 * S);
    for (let i = 0; i < n; i++) this.normal.emit(x, y + rnd(-0.05, 0.1), z, dx * rnd(0.4, 1.4) + rnd(-0.3, 0.3), rnd(0.1, 0.6), dz * rnd(0.4, 1.4) + rnd(-0.3, 0.3), rnd(0.5, 0.9), rnd(0.16, 0.3) * (0.7 + 0.3 * S), 1.6, 0.4, 0.03, 0.04, 0.4, 2.8, 0.5);
  }
  gibs(x: number, y: number, z: number, dx: number, dy: number, dz: number, n: number, brain = false) {
    const fl = Math.max(0, y - 1.7);
    for (let i = 0; i < n; i++) {
      const b = brain && Math.random() < 0.6;
      this.debris.emit(x, y, z, dx * rnd(1.5, 5) + rnd(-1.5, 1.5), dy * 2 + rnd(1, 4), dz * rnd(1.5, 5) + rnd(-1.5, 1.5), rnd(1.2, 2.2), rnd(0.035, 0.07), 0, b ? 0.62 : 0.5, b ? 0.3 : 0.06, b ? 0.33 : 0.07, 1, 0.5, 12, 0.95, fl, 0.18);
    }
  }
  smoke(x: number, y: number, z: number, dark = 0.5, amount = 1) {
    const c = 0.85 - dark * 0.7;
    this.normal.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, 1.6 + Math.random(), 0.6 * amount, 3, c, c, c * 1.02, 0.45, 0.6, -0.3);
  }
  fire(x: number, y: number, z: number, size = 1) {
    this.add.emit(x + (Math.random() - 0.5) * 0.6 * size, y, z + (Math.random() - 0.5) * 0.6 * size, 0, (1.5 + Math.random() * 1.5) * Math.sqrt(size), 0, 0.5 + Math.random() * 0.3, 0.7 * size, -0.6, 1, 0.55 + Math.random() * 0.2, 0.2, 0.9, 1);
  }
  tireSmoke(x: number, y: number, z: number, vx: number, vz: number, intensity = 1) {
    const k = Math.max(0.5, Math.min(2, intensity));
    this.normal.emit(
      x, y + 0.2, z,
      vx * 0.28 + (Math.random() - 0.5) * (0.9 + 0.35 * k),
      0.55 + Math.random() * 0.55 * k,
      vz * 0.28 + (Math.random() - 0.5) * (0.9 + 0.35 * k),
      1.15 + Math.random() * 0.75 * k,
      0.48 + 0.22 * k, 4.2,
      0.88, 0.88, 0.9, Math.min(0.46, 0.24 + 0.1 * k), 1.15,
    );
  }
  /** Performance car exhaust backfire pop: blue-white core, orange flame jet, hot embers and light puff. */
  backfire(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    this.add.emit(x, y, z, dx * 5, dy * 2, dz * 5, 0.075, 0.28 * rnd(0.85, 1.2), 0, 0.55, 0.82, 1, 1, 6, 0, 0.65);
    for (let i = 0; i < 3; i++) {
      const k = (i + 1) / 3;
      this.add.emit(x + dx * k * 0.36, y + dy * k * 0.12, z + dz * k * 0.36, dx * rnd(6, 11), rnd(-0.2, 0.5), dz * rnd(6, 11), 0.08 + k * 0.03, (0.34 - k * 0.09) * rnd(0.85, 1.15), 0, 1, 0.64 - k * 0.24, 0.18, 0.95, 7, 0, 0.55);
    }
    for (let i = 0; i < 4; i++) {
      this.add.emit(x, y, z, dx * rnd(7, 14) + rnd(-1.4, 1.4), rnd(0.2, 1.8), dz * rnd(7, 14) + rnd(-1.4, 1.4), rnd(0.12, 0.24), 0.05, 0, 1, 0.72, 0.28, 0.95, 3.5, 7, 0.4);
    }
    this.normal.emit(x + dx * 0.25, y, z + dz * 0.25, dx * 2.5, 0.3, dz * 2.5, 0.45, 0.22, 2.5, 0.24, 0.24, 0.26, 0.26, 2.5);
  }
  dust(x: number, y: number, z: number) {
    this.normal.emit(x, y, z, (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 1.5, 0.8, 0.35, 2.5, 0.78, 0.7, 0.58, 0.35, 2);
  }
  /** Quick tactical dust burst kicked up on combat rolls and hard landings. */
  rollDust(x: number, y: number, z: number) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd(-0.3, 0.3);
      const sp = rnd(1.2, 2.8);
      this.normal.emit(x + Math.cos(a) * 0.2, y + 0.12, z + Math.sin(a) * 0.2, Math.cos(a) * sp, rnd(0.4, 1.1), Math.sin(a) * sp, rnd(0.45, 0.75), rnd(0.22, 0.34), 2.4, 0.76, 0.7, 0.62, 0.34, 3.2);
    }
  }
  explosion(x: number, y: number, z: number, scale = 1) {
    // White-hot flash core
    this.add.emit(x, y + 0.6 * scale, z, 0, 0.4, 0, 0.14, 3.6 * scale, 1.4, 1, 0.95, 0.8, 1, 3, 0, 0.5);
    // Fireball plumes
    for (let i = 0; i < 38; i++) {
      const a = Math.random() * Math.PI * 2, s = (4 + Math.random() * 8) * scale;
      this.add.emit(x, y, z, Math.cos(a) * s, (2 + Math.random() * 8) * scale, Math.sin(a) * s, 0.5 + Math.random() * 0.5, (1.4 + Math.random()) * scale, 1.2, 1, 0.5 + Math.random() * 0.3, 0.15, 1, 3);
    }
    // Expanding ground shockwave dust ring
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd(-0.15, 0.15);
      const sp = (8 + Math.random() * 5) * scale;
      this.normal.emit(x + Math.cos(a) * 0.8 * scale, y + 0.25, z + Math.sin(a) * 0.8 * scale, Math.cos(a) * sp, 0.6 + Math.random() * 0.7, Math.sin(a) * sp, 0.8 + Math.random() * 0.4, 0.85 * scale, 3.4, 0.74, 0.66, 0.54, 0.52, 2.8, 0.4);
    }
    // Dark blast smoke cloud
    for (let i = 0; i < 24; i++) {
      this.normal.emit(x, y + 0.5, z, (Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6, 2.5 + Math.random() * 1.5, 1.6, 2.5, 0.22, 0.21, 0.22, 0.65, 1.4, -0.4);
    }
    this.sparks(x, y + 0.5, z, 28, 15 * scale);
    // Rising dark smoke column
    for (let i = 0; i < 14; i++) {
      this.normal.emit(x + (Math.random() - 0.5) * 1.2 * scale, y + 0.8 + i * 0.35 * scale, z + (Math.random() - 0.5) * 1.2 * scale, (Math.random() - 0.5) * 1.2, (2.2 + Math.random() * 2.2) * scale, (Math.random() - 0.5) * 1.2, 4 + Math.random() * 2.5, 1.5 * scale, 2.2, 0.12, 0.115, 0.12, 0.6, 0.5, -0.5);
    }
    // Flying debris chunks that tumble and land
    const fl = Math.min(y, 0.2);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, s = (3 + Math.random() * 9) * scale;
      this.debris.emit(x, y + 0.4, z, Math.cos(a) * s, (4 + Math.random() * 9) * scale, Math.sin(a) * s, 2.8, 0.07 + Math.random() * 0.07, 0, 0.1, 0.1, 0.1, 1, 0.3, 12, 0.9, fl, 0.3);
    }
  }
  splash(x: number, y: number, z: number, n = 14) {
    for (let i = 0; i < n; i++) this.normal.emit(x, y, z, (Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4, 0.8, 0.25, 1, 0.9, 0.97, 1, 0.7, 1, 12);
  }
  get count() { return this.add.count + this.normal.count + this.debris.count; }
}

const DECAL_TINT: Partial<Record<ImpactKind, [number, number, number, number]>> = {
  concrete: [0.12, 0.11, 0.1, 0.15], metal: [0.08, 0.08, 0.09, 0.09], wood: [0.14, 0.09, 0.05, 0.13], dirt: [0.16, 0.12, 0.08, 0.2],
};
const _upZ = new THREE.Vector3(0, 0, 1);
const _qSpin = new THREE.Quaternion();
const _mInv = new THREE.Matrix4();

/** Instanced, surface-aligned bullet holes in a ring buffer (one draw call), plus a few per car parented to its body. */
export class Decals {
  mesh: THREE.InstancedMesh;
  private i = 0; private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private n = new THREE.Vector3(); private sc = new THREE.Vector3(); private p = new THREE.Vector3();
  private geo: THREE.PlaneGeometry; private mat: THREE.MeshStandardMaterial;
  constructor(scene: THREE.Scene, private max = 220) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.4;
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + Math.random() * 0.5, r = 10 + Math.random() * 14; g.beginPath(); g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); g.lineTo(32 + Math.cos(a + 0.15) * r, 32 + Math.sin(a + 0.15) * r); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,1)'; g.beginPath(); g.arc(32, 32, 4.5, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, max); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
  }
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: ImpactKind, parent?: THREE.Object3D) {
    const tint = DECAL_TINT[kind]; if (!tint) return;
    this.n.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(_upZ, this.n);
    _qSpin.setFromAxisAngle(_upZ, Math.random() * Math.PI * 2);
    this.q.multiply(_qSpin);
    const s = tint[3] * (0.8 + Math.random() * 0.4); this.sc.set(s, s, s);
    this.p.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004);
    if (parent) {
      const list = (parent.userData.decals ??= []) as THREE.Mesh[];
      const d = list.length >= 10 ? list.shift()! : new THREE.Mesh(this.geo, this.mat);
      d.renderOrder = 2; parent.updateMatrixWorld(true); parent.add(d); list.push(d);
      _mInv.copy(parent.matrixWorld).invert();
      this.m.compose(this.p, this.q, this.sc).premultiply(_mInv);
      this.m.decompose(d.position, d.quaternion, d.scale);
      return;
    }
    this.m.compose(this.p, this.q, this.sc);
    this.mesh.setMatrixAt(this.i, this.m);
    this.mesh.instanceColor!.setXYZ(this.i, tint[0] * 3, tint[1] * 3, tint[2] * 3);
    this.i = (this.i + 1) % this.max; this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true;
  }
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** Removes the bullet holes that sit on / behind a pane (centre x,y,z, facing yaw, w x h) once it is shot out. Returns how many went. */
  clearIn(x: number, y: number, z: number, yaw: number, w: number, h: number, behind = 2.0): number {
    const nx = Math.sin(yaw), nz = Math.cos(yaw); let n = 0; const m = this.m, p = this.p;
    for (let i = 0; i < this.mesh.count; i++) {
      this.mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (m.elements[0] === 0 && m.elements[5] === 0) continue;
      const dx = p.x - x, dz = p.z - z, along = dx * nx + dz * nz, lat = dx * nz - dz * nx;
      if (along > 0.25 || along < -behind || Math.abs(lat) > w / 2 + 0.08 || Math.abs(p.y - y) > h / 2 + 0.08) continue;
      this.mesh.setMatrixAt(i, this.zero); n++;
    }
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
    return n;
  }
}

/** Ring buffer of quads for tyre marks (zero per-step allocations). */
export class SkidMarks {
  mesh: THREE.Mesh;
  private pos: Float32Array; private alpha: Float32Array; private i = 0;
  private last = new Map<number, THREE.Vector3>();
  constructor(scene: THREE.Scene, private max = 1600) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6 * 3); this.alpha = new Float32Array(max * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.06, 0.06, 0.07, vA * 0.55); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  /** id identifies a wheel; call every physics step while it skids; end(id) when it stops. */
  add(id: number, x: number, y: number, z: number, strength: number) {
    const py = y + 0.03;
    const prev = this.last.get(id);
    if (!prev) {
      this.last.set(id, new THREE.Vector3(x, py, z));
      return;
    }
    const dx = x - prev.x, dy = py - prev.y, dz = z - prev.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 9) { prev.set(x, py, z); return; }
    if (d2 < 0.04) return;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * 0.13, nz = (dx / l) * 0.13;
    const px0 = prev.x, py0 = prev.y, pz0 = prev.z;
    const pos = this.pos, o = this.i * 18;
    pos[o] = px0 - nx; pos[o + 1] = py0; pos[o + 2] = pz0 - nz;
    pos[o + 3] = px0 + nx; pos[o + 4] = py0; pos[o + 5] = pz0 + nz;
    pos[o + 6] = x + nx; pos[o + 7] = py; pos[o + 8] = z + nz;
    pos[o + 9] = px0 - nx; pos[o + 10] = py0; pos[o + 11] = pz0 - nz;
    pos[o + 12] = x + nx; pos[o + 13] = py; pos[o + 14] = z + nz;
    pos[o + 15] = x - nx; pos[o + 16] = py; pos[o + 17] = z - nz;
    const a = Math.min(1, strength), ao = this.i * 6;
    const alpha = this.alpha;
    alpha[ao] = a; alpha[ao + 1] = a; alpha[ao + 2] = a;
    alpha[ao + 3] = a; alpha[ao + 4] = a; alpha[ao + 5] = a;
    prev.set(x, py, z);
    this.i = (this.i + 1) % this.max;
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
  end(id: number) { this.last.delete(id); }
}
