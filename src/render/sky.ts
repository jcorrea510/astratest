/** Sky dome, sun/moon, fog and time-of-day palette for the Meridian Afterglow look. */
import * as THREE from 'three';

export interface SkyKey { h: number; top: string; horizon: string; sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; fog: string; exposure: number; night: number; cloud: string }
// Round 13 (W4): photographic daylight: warm near-white sun (~6x the sky fill), desaturated sky ambient with a warm neutral ground bounce (no blue-black shadows), hazy pale horizon; amber golden hour; deep blue nights with lifted ground bounce (no crushed blacks).
// Round 12: less sky fill and more sun by day (contrast: shadows read as shadows, with AO for the contact detail); darker nights (moon 0.38, sky fill 0.5: street lamps and headlights make the light pools).

/** Blackbody colour temperature (Kelvin) to a hex colour (Tanner Helland fit), used to key sun colour by elevation. */
export function kelvinHex(k: number): string {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305.0;
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** Approximate colour temperature of direct sun by key hour: low sun is warm (reddened path), midday ~5800K. */
const K = kelvinHex;
const KEYS: SkyKey[] = [
  { h: 0, top: '#0a1730', horizon: '#1d4562', sun: '#7fa6d6', sunI: 0.38, hemiSky: '#5a86b4', hemiGround: '#2e3240', hemiI: 0.5, fog: '#24394d', exposure: 1.3, night: 1, cloud: '#1a2c40' },
  { h: 4.6, top: '#081428', horizon: '#1e3c55', sun: '#7fa6d6', sunI: 0.38, hemiSky: '#5a86b4', hemiGround: '#2e3240', hemiI: 0.5, fog: '#213548', exposure: 1.3, night: 1, cloud: '#22344c' },
  { h: 5.8, top: '#2a3f6b', horizon: '#e98f6b', sun: K(2400), sunI: 0.9, hemiSky: '#7d8fb5', hemiGround: '#4a3a3a', hemiI: 0.56, fog: '#c78a7c', exposure: 1.0, night: 0.55, cloud: '#e7a08a' },
  { h: 7.2, top: '#5b8dbb', horizon: '#f2d2b0', sun: K(3900), sunI: 2.8, hemiSky: '#a9c2d6', hemiGround: '#7a6250', hemiI: 0.58, fog: '#e6cdb4', exposure: 1.0, night: 0, cloud: '#fff0dd' },
  { h: 11, top: '#3a7fc4', horizon: '#cfe3ee', sun: K(5800), sunI: 3.7, hemiSky: '#bccfdd', hemiGround: '#8a7b6b', hemiI: 0.62, fog: '#cfdde6', exposure: 0.95, night: 0, cloud: '#ffffff' },
  { h: 15.5, top: '#3d7cbc', horizon: '#d4e2e8', sun: K(5500), sunI: 3.5, hemiSky: '#b6cadb', hemiGround: '#86705c', hemiI: 0.62, fog: '#d2dde0', exposure: 0.95, night: 0, cloud: '#fffaf0' },
  { h: 18.2, top: '#4a6fa8', horizon: '#ffb47a', sun: K(3600), sunI: 3.0, hemiSky: '#a3b6cc', hemiGround: '#7a5848', hemiI: 0.58, fog: '#ecbb98', exposure: 1.0, night: 0, cloud: '#ffd2a8' },
  { h: 19.4, top: '#3a4f8a', horizon: '#ff8a5c', sun: K(2300), sunI: 1.72, hemiSky: '#8a89b8', hemiGround: '#5a3a3c', hemiI: 0.54, fog: '#d9826c', exposure: 1.05, night: 0.3, cloud: '#ff9f7a' },
  { h: 20.4, top: '#141f45', horizon: '#7d4a6e', sun: '#c6a0d8', sunI: 0.38, hemiSky: '#4f5f95', hemiGround: '#2a2230', hemiI: 0.52, fog: '#4b3d5c', exposure: 1.15, night: 0.85, cloud: '#5e4a6e' },
  { h: 21.5, top: '#060d1f', horizon: '#173550', sun: '#7fa6d6', sunI: 0.38, hemiSky: '#5a86b4', hemiGround: '#2e3240', hemiI: 0.5, fog: '#1d3144', exposure: 1.3, night: 1, cloud: '#1c2e44' },
  { h: 24, top: '#0a1730', horizon: '#1d4562', sun: '#7fa6d6', sunI: 0.38, hemiSky: '#5a86b4', hemiGround: '#2e3240', hemiI: 0.5, fog: '#24394d', exposure: 1.3, night: 1, cloud: '#1a2c40' },
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
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+vec2(17.3,9.1); a*=0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          // photographic atmospheric gradient with subtle horizon mist band
          vec3 haze = mix(uHorizon, vec3(dot(uHorizon, vec3(0.333))), 0.22);
          vec3 col = mix(haze, uTop, pow(smoothstep(-0.02, 0.72, h), 0.62));
          col = mix(col, haze, (1.0 - smoothstep(0.0, 0.18, h)) * 0.36 * (1.0 - uNight));
          vec3 sDir = normalize(uSunDir);
          float sd = max(dot(d, sDir), 0.0);
          // Rayleigh + Mie: warm forward scattering toward the sun, cool crisp sky opposite
          float hz = 1.0 - smoothstep(0.0, 0.38, max(d.y, 0.0));
          col += uSunCol * hz * (pow(sd, 2.0) * 0.12 + pow(sd, 8.0) * 0.10) * (1.0 - uNight);
          col = mix(col, col * vec3(0.93, 0.97, 1.04), hz * (1.0 - sd) * 0.42 * (1.0 - uNight));
          // night: coastal city sodium/LED light dome hugging the horizon
          float glow = pow(1.0 - smoothstep(0.0, 0.34, max(d.y, 0.0)), 2.1);
          col += vec3(0.56, 0.31, 0.15) * glow * 0.22 * uNight * (0.76 + 0.24 * noise(d.xz * 9.0));
          // Mie solar aureole & crisp sun disc
          col += uSunCol * (pow(sd, 4.0) * 0.16 + pow(sd, 28.0) * 0.26 + pow(sd, 360.0) * 0.85) * (1.0 - uNight * 0.72);
          float disc = smoothstep(0.99935, 0.99972, sd);
          col = mix(col, uSunCol * 2.3 + 0.4, disc * (1.0 - uNight));
          // moon with subtle atmospheric halo at night
          vec3 md = normalize(vec3(-0.45, 0.55, -0.7));
          float mdot = max(dot(d, md), 0.0);
          float moon = smoothstep(0.99905, 0.99942, mdot);
          col = mix(col, vec3(0.92, 0.95, 1.0) * 1.45, moon * uNight);
          col += vec3(0.58, 0.74, 1.0) * (pow(mdot, 45.0) * 0.14 + pow(mdot, 6.0) * 0.03) * uNight;
          // stars with colour-temperature variation and subtle scintillation
          vec2 sp = d.xz / (d.y + 0.25) * 140.0;
          vec2 sid = floor(sp);
          float st = step(0.9964, hash(sid)) * smoothstep(0.05, 0.4, d.y);
          float sb = hash(sid + 7.3);
          col += mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.86, 1.0), sb) * st * (0.35 + 0.9 * sb * sb) * uNight * uStars * (0.78 + 0.22 * sin(uTime * 2.8 + hash(sid) * 40.0));
          // high-altitude wispy cirrus streaks
          if (d.y > 0.01) {
            vec2 cirP = d.xz / (d.y + 0.24) * vec2(1.1, 2.7) + vec2(uTime * 0.0022, uTime * 0.0008);
            float cir = smoothstep(0.56, 0.86, fbm(cirP)) * smoothstep(0.01, 0.24, d.y) * (1.0 - smoothstep(0.65, 1.0, d.y) * 0.4);
            vec3 cirC = mix(uCloud, uSunCol * 1.1, pow(sd, 3.0) * 0.45);
            col = mix(col, cirC, cir * mix(0.28, 0.12, uNight));
            // lower sculpted cumulus layer: directional self-shadow + silver lining near the sun
            vec2 cp = d.xz / (d.y + 0.13) * 1.55 + vec2(uTime * 0.004, uTime * 0.002);
            float fb = fbm(cp);
            float c = smoothstep(0.47, 0.84, fb) * smoothstep(0.0, 0.22, d.y);
            vec2 sunStep = normalize(sDir.xz + vec2(0.001)) * 0.24;
            float fbSun = fbm(cp + sunStep);
            float litEdge = clamp((fb - fbSun) * 2.2 + 0.52, 0.0, 1.0);
            vec3 shadowC = mix(uTop * 0.62, uHorizon * 0.78, 0.55);
            vec3 cc = mix(shadowC, uCloud, mix(0.45, 1.0, litEdge) * (1.0 - uNight * 0.35));
            // golden/silver lining when backlit by the sun
            float silver = pow(sd, 5.0) * (1.0 - c * 0.55) * (1.0 - uNight * 0.85);
            cc += uSunCol * silver * 0.55;
            cc = mix(cc, uSunCol, pow(sd, 3.0) * 0.28 * (1.0 - uNight));
            col = mix(col, cc, c * 0.82);
            col = mix(col, haze, (1.0 - smoothstep(0.0, 0.12, d.y)) * c * 0.55);
          }
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
