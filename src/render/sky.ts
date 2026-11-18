/** Sky dome, sun/moon, fog and time-of-day palette for the Meridian Afterglow look. */
import * as THREE from 'three';

export interface SkyKey { h: number; top: string; horizon: string; sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; fog: string; exposure: number; night: number; cloud: string }
// Warm apricot daylight, teal shadows, magenta-amber golden hour, deep teal nights.
const KEYS: SkyKey[] = [
  { h: 0, top: '#050b18', horizon: '#123044', sun: '#7fa6d6', sunI: 0.2, hemiSky: '#3f6f9a', hemiGround: '#1a1f2a', hemiI: 0.45, fog: '#10283a', exposure: 1.05, night: 1, cloud: '#1a2c40' },
  { h: 4.6, top: '#081428', horizon: '#1e3c55', sun: '#7fa6d6', sunI: 0.2, hemiSky: '#43709a', hemiGround: '#1d212b', hemiI: 0.45, fog: '#15334a', exposure: 1.05, night: 1, cloud: '#22344c' },
  { h: 5.8, top: '#2a3f6b', horizon: '#e98f6b', sun: '#ffb184', sunI: 0.9, hemiSky: '#7d8fb5', hemiGround: '#4a3a3a', hemiI: 0.72, fog: '#c78a7c', exposure: 1.0, night: 0.55, cloud: '#e7a08a' },
  { h: 7.2, top: '#4f86b8', horizon: '#ffcf9e', sun: '#ffd2a1', sunI: 2.3, hemiSky: '#9cc4e0', hemiGround: '#6d5646', hemiI: 0.85, fog: '#e5c6aa', exposure: 1.0, night: 0, cloud: '#fff0dd' },
  { h: 11, top: '#3f86c9', horizon: '#bfe1ec', sun: '#fff1dc', sunI: 3.0, hemiSky: '#a7d3ee', hemiGround: '#7a6656', hemiI: 0.95, fog: '#bfdbe2', exposure: 0.95, night: 0, cloud: '#ffffff' },
  { h: 15.5, top: '#3d7fc0', horizon: '#c9e2e6', sun: '#ffe7c4', sunI: 2.9, hemiSky: '#a4cde6', hemiGround: '#7e6452', hemiI: 0.92, fog: '#c7dadb', exposure: 0.95, night: 0, cloud: '#fffaf0' },
  { h: 18.2, top: '#4a6fa8', horizon: '#ffb47a', sun: '#ffb070', sunI: 2.6, hemiSky: '#8fb3d4', hemiGround: '#7a5040', hemiI: 0.85, fog: '#f0b48e', exposure: 1.0, night: 0, cloud: '#ffd2a8' },
  { h: 19.4, top: '#3a4f8a', horizon: '#ff8a5c', sun: '#ff8550', sunI: 1.5, hemiSky: '#8a89b8', hemiGround: '#5a3a3c', hemiI: 0.75, fog: '#d9826c', exposure: 1.05, night: 0.3, cloud: '#ff9f7a' },
  { h: 20.4, top: '#141f45', horizon: '#7d4a6e', sun: '#c6a0d8', sunI: 0.45, hemiSky: '#4f5f95', hemiGround: '#2a2230', hemiI: 0.62, fog: '#4b3d5c', exposure: 1.05, night: 0.85, cloud: '#5e4a6e' },
  { h: 21.5, top: '#060d1f', horizon: '#173550', sun: '#7fa6d6', sunI: 0.2, hemiSky: '#3f6f9a', hemiGround: '#1a1f2a', hemiI: 0.45, fog: '#12293c', exposure: 1.05, night: 1, cloud: '#1c2e44' },
  { h: 24, top: '#050b18', horizon: '#123044', sun: '#7fa6d6', sunI: 0.2, hemiSky: '#3f6f9a', hemiGround: '#1a1f2a', hemiI: 0.45, fog: '#10283a', exposure: 1.05, night: 1, cloud: '#1a2c40' },
];

const ca = new THREE.Color(), cb = new THREE.Color();
function mixHex(a: string, b: string, t: number, out: THREE.Color) { return out.copy(ca.set(a)).lerp(cb.set(b), t); }
export interface SkyState { top: THREE.Color; horizon: THREE.Color; sun: THREE.Color; sunI: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number; fog: THREE.Color; exposure: number; night: number; cloud: THREE.Color; sunDir: THREE.Vector3; lightDir: THREE.Vector3 }
export function sampleSky(hour: number, out?: SkyState): SkyState {
  const s: SkyState = out ?? { top: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), sunI: 0, hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiI: 0, fog: new THREE.Color(), exposure: 1, night: 0, cloud: new THREE.Color(), sunDir: new THREE.Vector3(), lightDir: new THREE.Vector3() };
  const h = ((hour % 24) + 24) % 24;
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.smoothstep(h, a.h, b.h);
  mixHex(a.top, b.top, t, s.top); mixHex(a.horizon, b.horizon, t, s.horizon); mixHex(a.sun, b.sun, t, s.sun);
  mixHex(a.hemiSky, b.hemiSky, t, s.hemiSky); mixHex(a.hemiGround, b.hemiGround, t, s.hemiGround); mixHex(a.fog, b.fog, t, s.fog); mixHex(a.cloud, b.cloud, t, s.cloud);
  s.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, t); s.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
  s.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t); s.night = THREE.MathUtils.lerp(a.night, b.night, t);
  // Sun path: rises in the east (+x), sets in the west over the sea to the south-west.
  const dayT = (h - 6) / 13.5; // 0 at sunrise, 1 at sunset
  const elev = Math.sin(Math.PI * THREE.MathUtils.clamp(dayT, -0.2, 1.2)) * 1.05;
  const az = Math.PI * 0.5 - dayT * Math.PI * 1.15;
  s.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) + 0.35).normalize();
  // Light direction: the sun when it is up, the moon at night; never too low so shadows stay readable.
  if (s.sunDir.y > 0.08) s.lightDir.copy(s.sunDir);
  else s.lightDir.set(-0.35, 0.8, 0.45).normalize();
  if (s.sunDir.y > -0.05 && s.sunDir.y < 0.22) s.lightDir.y = Math.max(s.lightDir.y, 0.22);
  s.lightDir.normalize();
  return s;
}

export class Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  constructor() {
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 }, uTime: { value: 0 }, uCloud: { value: new THREE.Color() }, uStars: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uSunCol, uSunDir, uCloud; uniform float uNight, uTime, uStars; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.62, h), 0.75));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(sd, 6.0) * 0.28 + pow(sd, 90.0) * 0.6) * (1.0 - uNight * 0.7);
          float disc = smoothstep(0.9993, 0.9997, sd);
          col = mix(col, uSunCol * 2.2 + 0.4, disc * (1.0 - uNight));
          // moon opposite-ish the sun at night
          vec3 md = normalize(vec3(-0.45, 0.55, -0.7));
          float moon = smoothstep(0.9990, 0.9994, dot(d, md));
          col = mix(col, vec3(0.92, 0.95, 1.0) * 1.4, moon * uNight);
          col += vec3(0.6, 0.75, 1.0) * pow(max(dot(d, md), 0.0), 40.0) * 0.12 * uNight;
          // stars
          vec2 sp = d.xz / (d.y + 0.25) * 140.0;
          float st = step(0.9965, hash(floor(sp))) * smoothstep(0.05, 0.4, d.y);
          col += vec3(st) * uNight * uStars * (0.6 + 0.4 * sin(uTime * 3.0 + hash(floor(sp)) * 40.0));
          // stylised clouds
          vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
          float c = smoothstep(0.52, 0.78, fbm(cp)) * smoothstep(0.02, 0.25, d.y);
          vec3 cc = mix(uCloud, uSunCol, pow(sd, 3.0) * 0.5);
          col = mix(col, cc, c * 0.75);
          // horizon haze below 0
          col = mix(col, uHorizon * 0.9, smoothstep(0.02, -0.15, d.y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.scale.setScalar(1500);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }
  update(state: SkyState, time: number, camPos: THREE.Vector3) {
    this.uniforms.uTop.value.copy(state.top); this.uniforms.uHorizon.value.copy(state.horizon);
    this.uniforms.uSunCol.value.copy(state.sun); this.uniforms.uSunDir.value.copy(state.sunDir);
    this.uniforms.uNight.value = state.night; this.uniforms.uTime.value = time; this.uniforms.uCloud.value.copy(state.cloud);
    this.mesh.position.copy(camPos);
  }
}
