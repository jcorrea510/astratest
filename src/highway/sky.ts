/** Sky dome, lighting presets (night / dusk / day) and the matching material tweaks for the highway scene. */
import * as THREE from 'three';

export type TimeOfDay = 'night' | 'dusk' | 'day';
export interface Preset {
  top: string; mid: string; horizon: string; fog: string; fogNear: number; fogFar: number;
  hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; sunDir: [number, number, number];
  exposure: number; stars: number; head: number; lamps: number; sign: number; tail: number; env: number; hour: number;
}
export const PRESETS: Record<TimeOfDay, Preset> = {
  night: { top: '#02040c', mid: '#091326', horizon: '#232c48', fog: '#161e33', fogNear: 70, fogFar: 640, hemiSky: '#5a6f9c', hemiGround: '#242224', hemi: 1.15, sun: '#8ea3ff', sunI: 0.65, sunDir: [-0.4, 0.8, 0.35], exposure: 1.15, stars: 1, head: 1, lamps: 1, sign: 0.62, tail: 0.4, env: 0.3, hour: 23.2 },
  dusk: { top: '#1c2b57', mid: '#a45a82', horizon: '#ff9c5c', fog: '#8c6a7c', fogNear: 140, fogFar: 900, hemiSky: '#9a92bf', hemiGround: '#40352f', hemi: 1.15, sun: '#ff9d5c', sunI: 2.4, sunDir: [-0.55, 0.22, -0.8], exposure: 1.05, stars: 0.25, head: 1, lamps: 1, sign: 0.85, tail: 0.5, env: 0.55, hour: 19.1 },
  day: { top: '#3874c8', mid: '#86b8e8', horizon: '#d2e4f2', fog: '#bdd2e4', fogNear: 220, fogFar: 1150, hemiSky: '#c3d9f4', hemiGround: '#7a6e58', hemi: 1.5, sun: '#fff2dc', sunI: 3.2, sunDir: [0.5, 0.78, -0.45], exposure: 0.95, stars: 0, head: 0, lamps: 0, sign: 1, tail: 0.1, env: 0.9, hour: 14.2 },
};

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uStars: { value: 1 }, uMoon: { value: new THREE.Vector3(-0.4, 0.8, 0.35).normalize() } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.9999; }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uTop, uMid, uHor, uMoon; uniform float uStars;
        float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 c = mix(uHor, uMid, pow(h, 0.45)); c = mix(c, uTop, smoothstep(0.25, 0.95, h));
          float glow = exp(-abs(vDir.y) * 18.0); c += uHor * glow * 0.35;
          vec3 g = floor(vDir * 700.0); float r = h31(g);
          c += vec3(1.0, 0.95, 0.9) * step(0.9988, r) * smoothstep(0.05, 0.4, vDir.y) * uStars * (0.4 + 0.6 * h31(g + 7.0));
          float m = dot(normalize(vDir), uMoon);
          c += vec3(0.8, 0.85, 1.0) * smoothstep(0.9993, 0.9997, m) * uStars + vec3(0.2, 0.25, 0.4) * pow(max(m, 0.0), 220.0) * uStars;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), this.mat);
    this.mesh.renderOrder = -100; this.mesh.frustumCulled = false;
  }
  apply(p: Preset): void {
    const u = this.mat.uniforms;
    u.uTop.value.set(p.top); u.uMid.value.set(p.mid); u.uHor.value.set(p.horizon); u.uStars.value = p.stars;
    u.uMoon.value.set(p.sunDir[0], Math.max(0.25, p.sunDir[1]), p.sunDir[2]).normalize();
  }
}
