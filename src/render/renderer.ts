/** Renderer, lights, post-processing and the colour grade that holds the art direction together. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { QUALITY, type QualityName, type QualityPreset } from '../core/settings';
import { Sky, sampleSky, type SkyState } from './sky';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uNight: { value: 0 }, uVignette: { value: 0.14 }, uTime: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 0.2, 0.2) }, uSlow: { value: 0 }, uSat: { value: 0.95 }, uSplit: { value: 0.2 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uNight, uVignette, uTime, uFlash, uSlow, uSat, uSplit; uniform vec3 uFlashColor; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // split tone: teal shadows, apricot highlights
      vec3 shadowTint = mix(vec3(0.86, 1.0, 1.04), vec3(0.8, 0.95, 1.12), uNight);
      vec3 highTint = mix(vec3(1.06, 1.0, 0.92), vec3(1.04, 0.98, 0.94), uNight);
      col *= mix(vec3(1.0), mix(shadowTint, highTint, smoothstep(0.15, 0.75, l)), uSplit);
      // gentle S-curve and saturation
      col = mix(vec3(l), col, uSat);
      col = col * (1.0 + 0.08 * (col - 0.5));
      // slow-motion desaturation for the inventory wheel
      col = mix(col, vec3(dot(col, vec3(0.299,0.587,0.114))) * vec3(0.9,1.0,1.05), uSlow * 0.55);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col = mix(col, uFlashColor, uFlash * (1.0 - v * 0.7));
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/** Grade parameters per look; exposed so tests can assert the default is neutral. */
export const LOOK = {
  natural: { sat: 0.95, split: 0.2, vignette: 0.14, nightExposure: 0.84, shadowDesat: 0.35 },
  stylised: { sat: 1.08, split: 1, vignette: 0.32, nightExposure: 1, shadowDesat: 0 },
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky = new Sky();
  skyState: SkyState = sampleSky(18);
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  grade!: ShaderPass;
  quality!: QualityPreset;
  qualityName: QualityName = 'medium';
  /** 'natural' = neutral photographic grade (default); 'stylised' = teal/apricot split-tone. */
  look: 'natural' | 'stylised' = 'natural';
  setLook(look: 'natural' | 'stylised') {
    this.look = look;
    if (!this.grade) return;
    const u = this.grade.uniforms, n = look === 'natural';
    u.uSat.value = n ? LOOK.natural.sat : LOOK.stylised.sat; u.uSplit.value = n ? LOOK.natural.split : 1; u.uVignette.value = n ? LOOK.natural.vignette : LOOK.stylised.vignette;
  }
  private shadowTarget = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envHour = -100;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.15, 1600);
    this.scene.fog = new THREE.Fog(0x88aabb, 120, 420);
    this.hemi = new THREE.HemisphereLight(0xa7d3ee, 0x7a6656, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.sky.mesh);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envSky.mesh.scale.setScalar(50);
    this.envSky.uniforms.uStars.value = 0; // stars in reflections read as noise on glass
    this.envScene.add(this.envSky.mesh);
    // ground bounce for the lower hemisphere of reflections
    const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3634 }));
    ground.position.y = -2; this.envScene.add(ground);
    this.setQuality('medium');
    window.addEventListener('resize', () => this.resize());
  }
  setQuality(name: QualityName) {
    this.qualityName = name; const q = this.quality = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadowMap > 0;
    this.sun.castShadow = q.shadowMap > 0;
    if (q.shadowMap > 0) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      const R = q.shadowRange * 1.6; const c = this.sun.shadow.camera; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 400; c.updateProjectionMatrix();
    }
    this.renderer.shadowMap.needsUpdate = true;
    // Force materials to recompile for the new shadow configuration.
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach(mm => (mm.needsUpdate = true)); });
    this.buildComposer();
    (this.scene.fog as THREE.Fog).far = q.drawDistance * 1.9; this.camera.far = q.drawDistance + 1200; this.camera.updateProjectionMatrix();
    this.resize();
  }
  private buildComposer() {
    this.composer?.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.4, 0.9);
    this.bloom.enabled = this.quality.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }
  /** Updates lighting for a given hour and keeps the shadow frustum centred on the focus point. */
  updateEnvironment(hour: number, time: number, focus: THREE.Vector3) {
    const s = sampleSky(hour, this.skyState);
    this.sky.update(s, time, this.camera.position);
    // Rebuild the reflection environment from the sky every ~6 game minutes.
    const dh = Math.abs(((hour - this.envHour + 36) % 24) - 12);
    if (dh > 0.1 || this.envHour < -50) {
      this.envHour = hour;
      this.envSky.update(s, 0, new THREE.Vector3());
      const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
      this.envRT?.dispose(); this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.42, 0.4, s.night);
    this.sun.color.copy(s.sun); this.sun.intensity = s.sunI;
    const L = LOOK[this.look];
    this.hemi.color.copy(s.hemiSky); this.hemi.groundColor.copy(s.hemiGround); this.hemi.intensity = s.hemiI;
    if (L.shadowDesat > 0) { // softer, less saturated-blue fill so shadows read neutral grey
      const g = this.hemi.color.r * 0.3 + this.hemi.color.g * 0.55 + this.hemi.color.b * 0.15;
      this.hemi.color.r += (g - this.hemi.color.r) * L.shadowDesat; this.hemi.color.g += (g - this.hemi.color.g) * L.shadowDesat; this.hemi.color.b += (g - this.hemi.color.b) * L.shadowDesat;
      this.hemi.intensity *= 1 + 0.12 * (1 - s.night);
    }
    (this.scene.fog as THREE.Fog).color.copy(s.fog);
    (this.scene.fog as THREE.Fog).near = THREE.MathUtils.lerp(150, 70, s.night);
    this.renderer.toneMappingExposure = s.exposure * THREE.MathUtils.lerp(1, L.nightExposure, s.night);
    // Snap the shadow camera to texels to avoid shimmering.
    const range = (this.quality.shadowRange || 60) * 1.6, texel = (range * 2) / (this.quality.shadowMap || 1024);
    const fwd = this.camera.getWorldDirection(this._fwd); const fl = Math.hypot(fwd.x, fwd.z) || 1; const ahead = range * 0.45;
    const fx = focus.x + (fwd.x / fl) * ahead, fz = focus.z + (fwd.z / fl) * ahead;
    this.shadowTarget.set(Math.round(fx / texel) * texel, 0, Math.round(fz / texel) * texel);
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).addScaledVector(s.lightDir, 180);
    this.bloom.strength = THREE.MathUtils.lerp(0.12, 0.26, s.night);
    this.bloom.threshold = THREE.MathUtils.lerp(0.95, 0.88, s.night);
    this.grade.uniforms.uNight.value = s.night;
    this.grade.uniforms.uTime.value = time % 100;
  }
  stats = { calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0 };
  render() {
    const info = this.renderer.info; info.autoReset = false; info.reset();
    this.composer.render();
    this.stats.calls = info.render.calls; this.stats.triangles = info.render.triangles; this.stats.textures = info.memory.textures; this.stats.geometries = info.memory.geometries; this.stats.programs = info.programs?.length ?? 0;
  }
}
