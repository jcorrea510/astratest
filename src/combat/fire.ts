/**
 * Molotov fire field (R6-X): spreading, flickering ground fire. Each patch is an irregular disc that grows over ~4 s,
 * burns ~8-12 s and dies down. Flames are instanced camera-facing quads with a procedural flame shader (one draw call
 * for all patches); smoke comes from the shared Particles; one shared point light flickers at the nearest patch;
 * a soft scorch decal stays under the patch and fades after it goes out.
 */
import * as THREE from 'three';

export interface FirePatch {
  x: number; y: number; z: number;
  r: number; rMax: number; t: number; life: number;
  lobes: number[];
  owner: unknown;
  /** 0..1 strength: ramps up, plateau, dies down */
  power: number;
  scorch: THREE.Mesh | null;
  flames: Flame[];
  smokeT: number;
}
interface Flame { x: number; z: number; w: number; h: number; t: number; max: number; seed: number }
const MAX_FLAMES = 260;
let scorchTex: THREE.Texture | null = null;
function scorchTexture() {
  if (scorchTex) return scorchTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(8,6,5,0.78)'); gr.addColorStop(0.55, 'rgba(10,8,6,0.5)'); gr.addColorStop(1, 'rgba(10,8,6,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.beginPath(); g.arc(30 + Math.random() * 68, 30 + Math.random() * 68, 2 + Math.random() * 7, 0, 7); g.fill(); }
  scorchTex = new THREE.CanvasTexture(c); return scorchTex;
}

const VERT = /* glsl */`
attribute vec4 aPosScale; // xyz = base position, w = width
attribute vec2 aHeightSeed; // x = height, y = seed
attribute float aLife; // 0..1 envelope
varying vec2 vUv; varying float vSeed; varying float vLife;
void main(){
  vUv = uv; vSeed = aHeightSeed.y; vLife = aLife;
  vec3 base = aPosScale.xyz;
  vec3 toCam = cameraPosition - base; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-5));
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  float w = aPosScale.w * (0.55 + 0.45 * aLife), h = aHeightSeed.x * (0.35 + 0.65 * aLife);
  vec3 p = base + right * (position.x * w) + vec3(0.0, (position.y + 0.5) * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv; varying float vSeed; varying float vLife;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 uv = vUv; float y = uv.y; float x = (uv.x - 0.5) * 2.0;
  // licking tongues: noise scrolls upward, bends the column sideways
  float n1 = vnoise(vec2(uv.x * 3.5 + vSeed * 17.0, y * 3.0 - uTime * 2.6 + vSeed * 9.0));
  float n2 = vnoise(vec2(uv.x * 7.0 - vSeed * 5.0, y * 6.0 - uTime * 4.2));
  float sway = (n1 - 0.5) * 0.55 * y;
  float xs = x + sway;
  float width = mix(0.9, 0.08, pow(y, 0.8)) * (0.75 + 0.5 * n2);
  float body = smoothstep(width, width * 0.35, abs(xs));
  float fall = smoothstep(1.0, 0.25, y + (n1 - 0.5) * 0.35);
  float a = body * fall * vLife;
  if (a < 0.02) discard;
  float core = smoothstep(0.55, 0.0, abs(xs) / max(width, 0.05)) * smoothstep(0.7, 0.0, y);
  vec3 col = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.55, 0.08), smoothstep(0.7, 0.15, y));
  col = mix(col, vec3(1.0, 0.92, 0.55), core * 0.85);
  gl_FragColor = vec4(col * (1.2 + core), a);
}`;

export class FireField {
  patches: FirePatch[] = [];
  readonly light: THREE.PointLight;
  private mesh: THREE.Mesh;
  private aPos: THREE.InstancedBufferAttribute; private aHS: THREE.InstancedBufferAttribute; private aLife: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private time = 0;
  private scorchGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private fading: { m: THREE.Mesh; t: number }[] = [];
  /** extra smoke / ember emitters supplied by the owner (Particles) */
  smoke: ((x: number, y: number, z: number, dark: number, amount: number) => void) | null = null;
  ember: ((x: number, y: number, z: number, size: number) => void) | null = null;
  constructor(private scene: THREE.Object3D) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1); g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aHS = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAMES), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPosScale', this.aPos); g.setAttribute('aHeightSeed', this.aHS); g.setAttribute('aLife', this.aLife);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.light = new THREE.PointLight(0xff8a3a, 0, 18, 1.6); scene.add(this.light);
  }
  get active() { return this.patches.length; }
  /** Starts a fire patch on the ground at `at`. */
  ignite(at: THREE.Vector3, owner: unknown = null, radius = 3.8, life = 8.5 + Math.random() * 3.5): FirePatch {
    const lobes: number[] = []; for (let i = 0; i < 10; i++) lobes.push(0.72 + Math.random() * 0.5);
    const scorch = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }));
    scorch.position.set(at.x, at.y + 0.03, at.z); scorch.scale.setScalar(1); scorch.rotation.y = Math.random() * 6; scorch.renderOrder = 1; this.scene.add(scorch);
    const p: FirePatch = { x: at.x, y: at.y, z: at.z, r: 1.3, rMax: radius * (0.9 + Math.random() * 0.2), t: 0, life, lobes, owner, power: 0, scorch, flames: [], smokeT: 0 };
    this.patches.push(p);
    return p;
  }
  /** Radius of the patch's burning disc towards direction (dx, dz) (the shape is lobed). */
  edge(p: FirePatch, dx: number, dz: number): number {
    const a = (Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2) * p.lobes.length, i = Math.floor(a) % p.lobes.length, f = a - Math.floor(a);
    return p.r * (p.lobes[i] * (1 - f) + p.lobes[(i + 1) % p.lobes.length] * f);
  }
  /** Patch whose burning area covers (x, y, z) (with a margin), or null. */
  inside(x: number, y: number, z: number, margin = 0): FirePatch | null {
    for (const p of this.patches) {
      if (p.power < 0.25 || Math.abs(y - p.y) > 2) continue;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d <= this.edge(p, dx, dz) + margin) return p;
    }
    return null;
  }
  update(dt: number, camPos?: THREE.Vector3) {
    this.time += dt; this.mat.uniforms.uTime.value = this.time;
    let n = 0, lightBest: FirePatch | null = null, lightD = Infinity;
    const cp = camPos;
    for (let pi = this.patches.length - 1; pi >= 0; pi--) {
      const p = this.patches[pi]; p.t += dt;
      const up = Math.min(1, p.t / 0.7), down = Math.min(1, Math.max(0, (p.life - p.t) / 2.8));
      p.power = up * down;
      p.r = 1.3 + (p.rMax - 1.3) * Math.min(1, 1 - (1 - Math.min(1, p.t / 4.5)) ** 2);
      if (p.scorch) { p.scorch.scale.setScalar(p.r * 1.25); (p.scorch.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, p.t / 2) * (p.t > p.life ? 1 : 1); }
      // flames: keep a population proportional to the area and power
      const want = Math.round((10 + p.r * p.r * 1.6) * p.power);
      while (p.flames.length < want && n + p.flames.length < MAX_FLAMES) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * this.edge(p, Math.cos(a), Math.sin(a)) * 0.95;
        const big = 1 - rr / Math.max(0.5, p.r);
        p.flames.push({ x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr, w: 0.9 + Math.random() * 0.9 + big * 0.5, h: 1.2 + Math.random() * 1.3 + big * 0.9, t: Math.random() * 0.4, max: 0.9 + Math.random() * 1.4, seed: Math.random() });
      }
      for (let i = p.flames.length - 1; i >= 0; i--) {
        const f = p.flames[i]; f.t += dt;
        if (f.t >= f.max || (p.flames.length > want + 3 && Math.random() < 0.1)) { p.flames.splice(i, 1); continue; }
      }
      for (const f of p.flames) {
        if (n >= MAX_FLAMES) break;
        const u = f.t / f.max, env = Math.sin(Math.PI * Math.min(1, u)) ** 0.7 * (0.75 + 0.25 * Math.sin(this.time * 14 + f.seed * 40));
        const k = n * 4; this.aPos.array[k] = f.x; this.aPos.array[k + 1] = p.y + 0.02; this.aPos.array[k + 2] = f.z; this.aPos.array[k + 3] = f.w;
        this.aHS.array[n * 2] = f.h * (0.8 + 0.2 * p.power); this.aHS.array[n * 2 + 1] = f.seed; this.aLife.array[n] = env * Math.min(1, p.power * 1.4);
        n++;
      }
      // smoke column + embers + heat
      p.smokeT -= dt;
      if (p.smokeT <= 0 && p.power > 0.2) {
        p.smokeT = 0.09;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * p.r * 0.6;
        this.smoke?.(p.x + Math.cos(a) * rr, p.y + 1.6, p.z + Math.sin(a) * rr, 0.85, 0.9 + p.r * 0.2);
        if (Math.random() < 0.5) this.ember?.(p.x + (Math.random() - 0.5) * p.r, p.y + 0.5, p.z + (Math.random() - 0.5) * p.r, 0.5);
      }
      if (cp) { const d = Math.hypot(p.x - cp.x, p.z - cp.z); if (d < lightD) { lightD = d; lightBest = p; } }
      else if (!lightBest) lightBest = p;
      if (p.t >= p.life) {
        if (p.scorch) this.fading.push({ m: p.scorch, t: 0 });
        this.patches.splice(pi, 1);
      }
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.aPos.needsUpdate = true; this.aHS.needsUpdate = true; this.aLife.needsUpdate = true;
    // shared flicker light
    if (lightBest) {
      const fl = 0.75 + 0.25 * Math.sin(this.time * 23.0) * Math.sin(this.time * 7.3 + 1.3) + (Math.random() - 0.5) * 0.15;
      this.light.position.set(lightBest.x, lightBest.y + 1.3, lightBest.z);
      this.light.intensity = 26 * lightBest.power * Math.min(1, lightBest.r / 3) * fl;
      this.light.color.setHSL(0.07 + 0.02 * Math.random(), 1, 0.55);
    } else this.light.intensity = 0;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i]; f.t += dt; const m = f.m.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 0.9 * (1 - f.t / 25));
      if (f.t >= 25) { f.m.removeFromParent(); m.dispose(); this.fading.splice(i, 1); }
    }
  }
  clear() { for (const p of this.patches) if (p.scorch) { p.scorch.removeFromParent(); (p.scorch.material as THREE.Material).dispose(); } this.patches.length = 0; }
}
