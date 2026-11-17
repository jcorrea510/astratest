/** GPU-friendly particles (one Points draw per blend mode) and a ring-buffer skid mark mesh. */
import * as THREE from 'three';

/**
 * One particle. `hold` = fraction of the lifetime spent at full opacity before fading (short flashes must survive the
 * frame they are born in); `floor` = height it bounces on (casings land on kerbs, not at y = 0); `bounce` = restitution.
 */
interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; r: number; g: number; b: number; a: number; drag: number; grav: number; hold: number; floor: number; bounce: number }
export type ImpactKind = 'concrete' | 'metal' | 'body' | 'water' | 'wood' | 'dirt' | 'glass';
const rnd = (lo: number, hi: number) => lo + (hi - lo) * Math.random();
class Pool {
  points: THREE.Points;
  private ps: P[] = [];
  private pos: Float32Array; private col: Float32Array; private siz: Float32Array;
  constructor(private max: number, additive: boolean, tex: THREE.Texture) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.siz = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(size * scale / max(0.5, -mv.z), 220.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.004) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }
  emit(p: P) { if (this.ps.length >= this.max) this.ps.shift(); this.ps.push(p); }
  update(dt: number, height: number) {
    const ps = this.ps;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]; p.life += dt; if (p.life >= p.max) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d - p.grav * dt; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor && p.grav > 0) { p.y = p.floor; p.vy *= -p.bounce; p.vx *= 0.6; p.vz *= 0.6; }
      ps[w++] = p;
    }
    ps.length = w;
    for (let i = 0; i < w; i++) {
      const p = ps[i], t = p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const fade = p.hold > 0 ? (t < p.hold ? 1 : 1 - (t - p.hold) / (1 - p.hold)) : t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = p.r; this.col[i * 4 + 1] = p.g; this.col[i * 4 + 2] = p.b; this.col[i * 4 + 3] = p.a * fade;
      this.siz[i] = p.size * (1 + p.grow * t);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, w);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.color as THREE.BufferAttribute).needsUpdate = true; (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = height * 0.5;
  }
  get count() { return this.ps.length; }
}

export class Particles {
  add: Pool; normal: Pool;
  /** Small long-lived pool for bullet marks and shell casings, so they never evict smoke or sparks. */
  debris: Pool;
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
  }
  setMax(max: number) { void max; }
  update(dt: number, viewportHeight: number) { this.add.update(dt, viewportHeight); this.normal.update(dt, viewportHeight); this.debris.update(dt, viewportHeight); }
  private p(x: number, y: number, z: number, o: Partial<P>): P {
    return { x, y, z, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.3, grow: 0, r: 1, g: 1, b: 1, a: 1, drag: 1, grav: 0, hold: 0, floor: 0.05, bounce: 0.3, ...o };
  }
  sparks(x: number, y: number, z: number, n = 10, speed = 6) {
    for (let i = 0; i < n; i++) this.add.emit(this.p(x, y, z, { vx: (Math.random() - 0.5) * speed, vy: Math.random() * speed * 0.8, vz: (Math.random() - 0.5) * speed, max: 0.25 + Math.random() * 0.35, size: 0.08 + Math.random() * 0.06, r: 1, g: 0.75, b: 0.35, a: 1, drag: 2, grav: 14 }));
  }
  /**
   * Muzzle flash: a white-hot core, a short forward cone of flame petals, a side "star" burst and a lingering wisp of
   * smoke. `big` (shotgun) is the old boolean API; `scale` sizes it per weapon. Everything is ~2 frames long.
   */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, big = false, scale = 1) {
    const s = (big ? 1.45 : 1) * scale;
    const hold = { hold: 0.7 };
    // core
    this.add.emit(this.p(x + dx * 0.04, y + dy * 0.04, z + dz * 0.04, { max: 0.055, size: 0.42 * s * rnd(0.85, 1.15), r: 1, g: 0.93, b: 0.75, a: 1, ...hold }));
    this.add.emit(this.p(x + dx * 0.1 * s, y + dy * 0.1 * s, z + dz * 0.1 * s, { max: 0.05, size: 0.62 * s * rnd(0.8, 1.2), r: 1, g: 0.62, b: 0.25, a: 0.8, ...hold }));
    // forward flame cone
    const n = big ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n * rnd(0.7, 1.1);
      this.add.emit(this.p(x + dx * k * 0.32 * s, y + dy * k * 0.32 * s, z + dz * k * 0.32 * s, { vx: dx * 3, vy: dy * 3, vz: dz * 3, max: 0.045, size: (0.3 - k * 0.12) * s, r: 1, g: 0.7 - k * 0.2, b: 0.3 - k * 0.15, a: 0.9, drag: 8, ...hold }));
    }
    // side star (perpendicular to the barrel)
    const rx = dz, rz = -dx, rl = Math.hypot(rx, rz) || 1;
    for (const sg of [-1, 1]) this.add.emit(this.p(x + rx / rl * 0.07 * sg * s, y, z + rz / rl * 0.07 * sg * s, { vx: rx / rl * sg * 2.5, vz: rz / rl * sg * 2.5, max: 0.04, size: 0.16 * s, r: 1, g: 0.75, b: 0.4, a: 0.7, drag: 10, ...hold }));
    // a few hot embers
    for (let i = 0; i < (big ? 6 : 2); i++) this.add.emit(this.p(x, y, z, { vx: dx * rnd(6, 14) + rnd(-1.5, 1.5), vy: dy * rnd(6, 14) + rnd(-1, 1.5), vz: dz * rnd(6, 14) + rnd(-1.5, 1.5), max: rnd(0.08, 0.18), size: 0.045, r: 1, g: 0.7, b: 0.3, drag: 4, grav: 4, hold: 0.3 }));
    // smoke wisp
    for (let i = 0; i < (big ? 3 : 1); i++) this.normal.emit(this.p(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, { vx: dx * rnd(0.8, 2) + rnd(-0.2, 0.2), vy: 0.35 + rnd(0, 0.3), vz: dz * rnd(0.8, 2) + rnd(-0.2, 0.2), max: rnd(0.7, 1.2) * (big ? 1.4 : 1), size: 0.16 * s, grow: 4, r: 0.78, g: 0.77, b: 0.75, a: big ? 0.28 : 0.18, drag: 2.2, grav: -0.15 }));
  }
  /** Ejected shell casing (brass) or shotgun hull (red plastic). Bounces on `floorY`, lingers briefly. */
  casing(x: number, y: number, z: number, vx: number, vy: number, vz: number, floorY: number, hull = false) {
    const col = hull ? [0.75, 0.16, 0.12] : [0.95, 0.72, 0.3];
    this.debris.emit(this.p(x, y, z, { vx, vy, vz, max: hull ? 3 : 2.2, size: hull ? 0.06 : 0.04, r: col[0], g: col[1], b: col[2], a: 1, drag: 0.4, grav: 11, hold: 0.85, floor: floorY + (hull ? 0.03 : 0.02), bounce: 0.35 }));
    if (!hull) this.add.emit(this.p(x, y, z, { vx, vy, vz, max: 0.25, size: 0.05, r: 1, g: 0.8, b: 0.45, a: 0.6, drag: 0.4, grav: 11, hold: 0.4, floor: floorY + 0.02 }));
  }
  /**
   * Bullet impact by surface. (nx, ny, nz) points away from the surface (towards the shooter for bodies).
   * `strength` scales the effect (shotgun pellets use ~0.5). Body hits are a small cloth-dust puff (Teen rating: no gore).
   */
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: ImpactKind, strength = 1) {
    const S = strength, lift = (k: number) => ({ vx: nx * k + rnd(-1, 1) * k * 0.6, vy: ny * k + rnd(-0.4, 1) * k * 0.6, vz: nz * k + rnd(-1, 1) * k * 0.6 });
    const flash = (r: number, g: number, b: number, size: number) => this.add.emit(this.p(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, { max: 0.05, size: size * S, r, g, b, a: 1, hold: 0.6 }));
    const mark = (r: number, g: number, b: number, size: number, life = 7) => { if (S >= 0.4) this.debris.emit(this.p(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015, { max: life * rnd(0.85, 1.15), size: size * rnd(0.85, 1.2), r, g, b, a: 0.85, hold: 0.8 })); };
    if (kind === 'metal') {
      flash(1, 0.9, 0.7, 0.28);
      const n = Math.round(9 * S);
      for (let i = 0; i < n; i++) this.add.emit(this.p(x, y, z, { ...lift(rnd(3, 9)), max: rnd(0.12, 0.38), size: rnd(0.035, 0.06), r: 1, g: rnd(0.7, 0.9), b: 0.4, a: 1, drag: 1.5, grav: 12, hold: 0.5, floor: y - 3, bounce: 0.25 }));
      this.normal.emit(this.p(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, { ...lift(0.6), max: 0.5, size: 0.12 * S, grow: 3, r: 0.6, g: 0.6, b: 0.62, a: 0.25, drag: 3 }));
      mark(0.18, 0.18, 0.2, 0.05, 5);
    } else if (kind === 'concrete' || kind === 'dirt' || kind === 'wood') {
      const col = kind === 'concrete' ? [0.74, 0.7, 0.64] : kind === 'dirt' ? [0.52, 0.43, 0.32] : [0.55, 0.4, 0.26];
      if (kind === 'concrete') flash(1, 0.85, 0.6, 0.18);
      // dust puff that billows out of the hole
      for (let i = 0; i < Math.max(2, Math.round(4 * S)); i++) this.normal.emit(this.p(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, { ...lift(rnd(1, 2.6)), max: rnd(0.6, 1.1), size: rnd(0.1, 0.16) * (0.6 + S * 0.4), grow: 3.2, r: col[0], g: col[1], b: col[2], a: kind === 'dirt' ? 0.55 : 0.5, drag: 4, grav: -0.2 }));
      // chips / splinters / clods with gravity
      for (let i = 0; i < Math.round((kind === 'wood' ? 6 : 5) * S); i++) this.debris.emit(this.p(x, y, z, { ...lift(rnd(2.5, 6)), max: rnd(0.5, 0.9), size: kind === 'wood' ? rnd(0.03, 0.05) : rnd(0.022, 0.04), r: col[0] * 0.8, g: col[1] * 0.8, b: col[2] * 0.8, a: 1, drag: 1, grav: 14, hold: 0.7, floor: Math.min(y, 0.2) - 0.1, bounce: 0.2 }));
      mark(kind === 'wood' ? 0.2 : 0.12, kind === 'wood' ? 0.15 : 0.11, 0.1, kind === 'dirt' ? 0.08 : 0.055, kind === 'dirt' ? 3 : 7);
    } else if (kind === 'glass') {
      flash(0.9, 0.95, 1, 0.2);
      for (let i = 0; i < Math.round(8 * S); i++) this.add.emit(this.p(x, y, z, { ...lift(rnd(2, 6)), max: rnd(0.3, 0.6), size: rnd(0.02, 0.04), r: 0.8, g: 0.9, b: 1, a: 0.8, drag: 1, grav: 14, hold: 0.5 }));
    } else if (kind === 'water') {
      // a thin column plus a crown of droplets
      for (let i = 0; i < Math.round(5 * S); i++) this.normal.emit(this.p(x + rnd(-0.05, 0.05), y, z + rnd(-0.05, 0.05), { vx: rnd(-0.3, 0.3), vy: rnd(3.5, 6.5), vz: rnd(-0.3, 0.3), max: rnd(0.45, 0.7), size: rnd(0.08, 0.14), grow: 1.2, r: 0.9, g: 0.96, b: 1, a: 0.75, drag: 1, grav: 12, hold: 0.3, floor: y - 1 }));
      for (let i = 0; i < Math.round(9 * S); i++) { const a = Math.random() * Math.PI * 2, sp = rnd(1, 2.5); this.normal.emit(this.p(x, y, z, { vx: Math.cos(a) * sp, vy: rnd(1.5, 3.5), vz: Math.sin(a) * sp, max: 0.5, size: 0.05, r: 0.92, g: 0.97, b: 1, a: 0.8, drag: 1, grav: 12, hold: 0.3, floor: y - 1 })); }
      this.normal.emit(this.p(x, y + 0.05, z, { max: 0.6, size: 0.35 * S, grow: 2.5, r: 0.95, g: 0.98, b: 1, a: 0.35, drag: 2 }));
    } else {
      // body: a small, quick puff of cloth dust (no blood: Teen rating)
      for (let i = 0; i < 3; i++) this.normal.emit(this.p(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, { ...lift(rnd(0.6, 1.4)), max: rnd(0.25, 0.4), size: rnd(0.07, 0.1) * (0.6 + 0.4 * S), grow: 2.2, r: 0.78, g: 0.74, b: 0.72, a: 0.4, drag: 5 }));
    }
  }
  smoke(x: number, y: number, z: number, dark = 0.5, amount = 1) {
    const c = 0.85 - dark * 0.7;
    this.normal.emit(this.p(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, { vx: (Math.random() - 0.5) * 0.6, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 0.6, max: 1.6 + Math.random(), size: 0.6 * amount, grow: 3, r: c, g: c, b: c * 1.02, a: 0.45, drag: 0.6, grav: -0.3 }));
  }
  fire(x: number, y: number, z: number) {
    this.add.emit(this.p(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, { vy: 1.5 + Math.random() * 1.5, max: 0.5 + Math.random() * 0.3, size: 0.7, grow: -0.6, r: 1, g: 0.55 + Math.random() * 0.2, b: 0.2, a: 0.9, drag: 1 }));
  }
  tireSmoke(x: number, y: number, z: number, vx: number, vz: number) {
    this.normal.emit(this.p(x, y + 0.2, z, { vx: vx * 0.3 + (Math.random() - 0.5), vy: 0.6 + Math.random() * 0.5, vz: vz * 0.3 + (Math.random() - 0.5), max: 1.2 + Math.random() * 0.6, size: 0.5, grow: 4, r: 0.86, g: 0.86, b: 0.88, a: 0.28, drag: 1.2 }));
  }
  dust(x: number, y: number, z: number) {
    this.normal.emit(this.p(x, y, z, { vx: (Math.random() - 0.5) * 1.5, vy: 0.4 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 1.5, max: 0.8, size: 0.35, grow: 2.5, r: 0.78, g: 0.7, b: 0.58, a: 0.35, drag: 2 }));
  }
  explosion(x: number, y: number, z: number) {
    for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 8; this.add.emit(this.p(x, y, z, { vx: Math.cos(a) * s, vy: 2 + Math.random() * 8, vz: Math.sin(a) * s, max: 0.5 + Math.random() * 0.5, size: 1.4 + Math.random(), grow: 1.2, r: 1, g: 0.5 + Math.random() * 0.3, b: 0.15, a: 1, drag: 3 })); }
    for (let i = 0; i < 26; i++) this.normal.emit(this.p(x, y + 0.5, z, { vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 6, max: 2.5 + Math.random() * 1.5, size: 1.6, grow: 2.5, r: 0.22, g: 0.21, b: 0.22, a: 0.65, drag: 1.4, grav: -0.4 }));
    this.sparks(x, y + 0.5, z, 30, 14);
  }
  splash(x: number, y: number, z: number, n = 14) { for (let i = 0; i < n; i++) this.normal.emit(this.p(x, y, z, { vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 4, max: 0.8, size: 0.25, grow: 1, r: 0.9, g: 0.97, b: 1, a: 0.7, drag: 1, grav: 12 })); }
  get count() { return this.add.count + this.normal.count + this.debris.count; }
}

/** Ring buffer of quads for tyre marks. */
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
    const p = new THREE.Vector3(x, y + 0.03, z);
    const prev = this.last.get(id);
    this.last.set(id, p);
    if (!prev || prev.distanceToSquared(p) > 9) return;
    if (prev.distanceToSquared(p) < 0.04) { this.last.set(id, prev); return; }
    const dx = p.x - prev.x, dz = p.z - prev.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * 0.13, nz = dx / l * 0.13;
    const v = [prev.x - nx, prev.y, prev.z - nz, prev.x + nx, prev.y, prev.z + nz, p.x + nx, p.y, p.z + nz, prev.x - nx, prev.y, prev.z - nz, p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz];
    const o = this.i * 18;
    for (let k = 0; k < 18; k++) this.pos[o + k] = v[k];
    for (let k = 0; k < 6; k++) this.alpha[this.i * 6 + k] = Math.min(1, strength);
    this.i = (this.i + 1) % this.max;
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
  end(id: number) { this.last.delete(id); }
}
