/** GPU-friendly particles (one Points draw per blend mode) and a ring-buffer skid mark mesh. */
import * as THREE from 'three';

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; r: number; g: number; b: number; a: number; drag: number; grav: number }
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
      if (p.y < 0.05 && p.grav > 0) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      ps[w++] = p;
    }
    ps.length = w;
    for (let i = 0; i < w; i++) {
      const p = ps[i], t = p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
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
  constructor(scene: THREE.Scene, max: number) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.add = new Pool(max, true, tex); this.normal = new Pool(max, false, tex);
    scene.add(this.add.points, this.normal.points);
  }
  setMax(max: number) { void max; }
  update(dt: number, viewportHeight: number) { this.add.update(dt, viewportHeight); this.normal.update(dt, viewportHeight); }
  private p(x: number, y: number, z: number, o: Partial<P>): P {
    return { x, y, z, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.3, grow: 0, r: 1, g: 1, b: 1, a: 1, drag: 1, grav: 0, ...o };
  }
  sparks(x: number, y: number, z: number, n = 10, speed = 6) {
    for (let i = 0; i < n; i++) this.add.emit(this.p(x, y, z, { vx: (Math.random() - 0.5) * speed, vy: Math.random() * speed * 0.8, vz: (Math.random() - 0.5) * speed, max: 0.25 + Math.random() * 0.35, size: 0.08 + Math.random() * 0.06, r: 1, g: 0.75, b: 0.35, a: 1, drag: 2, grav: 14 }));
  }
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, big = false) {
    this.add.emit(this.p(x, y, z, { max: 0.06, size: big ? 0.9 : 0.55, r: 1, g: 0.8, b: 0.45, a: 1 }));
    for (let i = 0; i < (big ? 6 : 3); i++) this.add.emit(this.p(x, y, z, { vx: dx * 8 + (Math.random() - 0.5) * 2, vy: dy * 8 + (Math.random() - 0.5) * 2, vz: dz * 8 + (Math.random() - 0.5) * 2, max: 0.07, size: 0.25, r: 1, g: 0.65, b: 0.3, drag: 6 }));
    this.normal.emit(this.p(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, { vx: dx * 1.5, vy: 0.6, vz: dz * 1.5, max: 0.8, size: 0.25, grow: 3, r: 0.75, g: 0.75, b: 0.75, a: 0.25, drag: 2 }));
  }
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: 'concrete' | 'metal' | 'body' | 'water') {
    if (kind === 'metal') this.sparks(x, y, z, 6, 5);
    const col = kind === 'concrete' ? [0.75, 0.7, 0.62] : kind === 'water' ? [0.85, 0.95, 1] : kind === 'body' ? [0.9, 0.85, 0.8] : [0.5, 0.5, 0.5];
    for (let i = 0; i < (kind === 'water' ? 10 : 5); i++) this.normal.emit(this.p(x, y, z, { vx: nx * 2 + (Math.random() - 0.5) * 2, vy: ny * 2 + Math.random() * (kind === 'water' ? 4 : 1.5), vz: nz * 2 + (Math.random() - 0.5) * 2, max: 0.5 + Math.random() * 0.4, size: kind === 'body' ? 0.12 : 0.18, grow: 2, r: col[0], g: col[1], b: col[2], a: kind === 'body' ? 0.5 : 0.6, drag: 3, grav: kind === 'water' ? 9 : 1 }));
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
  get count() { return this.add.count + this.normal.count; }
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
