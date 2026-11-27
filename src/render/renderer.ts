/** Renderer, lights, post-processing and the colour grade that holds the art direction together. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { runtime, speedBlurAmount, frameDue } from '../core/runtime';
import { QUALITY, type QualityName, type QualityPreset } from '../core/settings';
import { safeMsaa } from '../core/platform';
import { Sky, sampleSky, type SkyState } from './sky';
import { LightPool } from './lightPool';
import { AOPass, FXAA_PLUS_GLSL, CAS_GLSL, WHITE_TEX } from './post';
import { adaptStep, newDyn, pixelRatioFor, shadowRedrawDue, GpuTimer, type DynState } from './perfPolicy';
import { skyTopUniform, skyHorizonUniform, sunDirUniform, sunColUniform } from './materials';

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
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.26); // filmic S-curve on the display-referred image (AgX rolls highlights smoothly)
      // slow-motion desaturation for the inventory wheel
      col = mix(col, vec3(dot(col, vec3(0.299,0.587,0.114))) * vec3(0.9,1.0,1.05), uSlow * 0.55);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col = mix(col, uFlashColor, uFlash * (1.0 - v * 0.7));
      // fine per-pixel grain (screen-space UV grain read as blocky video compression at high resolutions)
      col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.007;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * Round 11 perf (GPU): tone mapping (ACES), sRGB encoding and the colour grade in ONE full-screen pass. They were two passes
 * (OutputPass, then the grade ShaderPass): a whole extra read + write of the HDR frame every frame.
 */
export const OUTPUT_GRADE_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse, tAO; uniform float uNight, uVignette, uTime, uFlash, uSlow, uSat, uSplit, uFxaa, uAO, uSpeed, uSharp; uniform vec2 uRes; uniform vec3 uFlashColor; varying vec2 vUv;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  ${FXAA_PLUS_GLSL}
  ${CAS_GLSL}
  ${GradeShader.fragmentShader.replace(/uniform sampler2D tDiffuse;[^\n]*\n/, '').replace('vec4 c = texture2D(tDiffuse, vUv);', `vec4 c = texture2D(tDiffuse, vUv);
      if (uFxaa > 0.5) c.rgb = fxaaPlus(vUv, c.rgb);
      // Round 12: speed blur at high speed, radial from just above the centre (5 taps, skipped when still)
      if (uSpeed > 0.01) {
        vec2 rd = (vUv - vec2(0.5, 0.55)) * uSpeed * 0.035 * smoothstep(0.12, 0.6, length(vUv - vec2(0.5, 0.55)));
        vec3 acc = c.rgb;
        for (int i = 1; i <= 4; i++) acc += texture2D(tDiffuse, vUv - rd * float(i)).rgb;
        c.rgb = acc / 5.0;
      }
      if (uSharp > 0.0) c.rgb = casSharpen(tDiffuse, vUv, c.rgb, uSharp);
      // ambient occlusion (half-res, blurred) darkens creases and contact areas cleanly after sharpening
      c.rgb *= mix(1.0, texture2D(tAO, vUv).r, min(uAO, 1.0));
      if (uAO > 1.5) c.rgb = vec3(texture2D(tAO, vUv).r) * 0.6; // debug view (window.__game.renderer.grade.uniforms.uAO.value = 2)
      c.rgb = TONE_MAP(c.rgb);
      c = sRGBTransferOETF(c);`)}`;
/** Round 12: the tone curve (three's GLSL function name). AgX rolls highlights off like film: headlights and lamps keep their colour instead of clipping to flat white. */
export const TONE_MAP_FN = 'AgXToneMapping';
export class OutputGradePass extends Pass {
  uniforms: Record<string, THREE.IUniform>;
  private quad: FullScreenQuad; private material: THREE.RawShaderMaterial;
  constructor() {
    super();
    this.uniforms = THREE.UniformsUtils.merge([GradeShader.uniforms, { toneMappingExposure: { value: 1 }, uSpeed: { value: 0 }, uSharp: { value: 0.3 }, uFxaa: { value: 0 }, uAO: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } }]);
    this.uniforms.tAO = { value: WHITE_TEX };
    this.material = new THREE.RawShaderMaterial({
      name: 'OutputGrade', uniforms: this.uniforms, defines: { SRGB_TRANSFER: '', TONE_MAP: TONE_MAP_FN },
      vertexShader: `precision highp float; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: OUTPUT_GRADE_FRAG,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    (this.uniforms.uRes.value as THREE.Vector2).set(1 / Math.max(1, readBuffer.width), 1 / Math.max(1, readBuffer.height));
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

/** Grade parameters per look; exposed so tests can assert the default is neutral. */
export const LOOK = {
  natural: { sat: 1.08, split: 0.08, vignette: 0.14, nightExposure: 0.84, shadowDesat: 0.55 },
  stylised: { sat: 1.08, split: 1, vignette: 0.32, nightExposure: 1, shadowDesat: 0 },
};

/** Round 13: daytime fog starts earlier (aerial perspective: distance lightens and desaturates towards the haze colour). */
export const DAY_FOG_NEAR = 95;
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/**
 * Stable shadow frame: the sun direction moves in small steps (a continuously turning light re-rasterises every shadow
 * edge each frame = crawling, flickering edges) and the shadow centre snaps to whole texels *in light space* (snapping
 * world x/z does not line up with an oblique light's texel grid, so edges still swam as the player moved).
 */
export function shadowFrame(wantDir: THREE.Vector3, cx: number, cz: number, texel: number, dir: THREE.Vector3, out: THREE.Vector3) {
  if (dir.angleTo(wantDir) > 0.004) dir.copy(wantDir).normalize(); // ~0.23 degree steps
  // the same basis three's shadow camera uses (lookAt from the sun towards the target, world up)
  _r.crossVectors(_up, dir); if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0); _r.normalize();
  _u.crossVectors(dir, _r).normalize();
  const c = out.set(cx, 0, cz);
  const a = Math.round(c.dot(_r) / texel) * texel, b = Math.round(c.dot(_u) / texel) * texel, l = c.dot(dir);
  return out.copy(_r).multiplyScalar(a).addScaledVector(_u, b).addScaledVector(dir, l);
}
/** The size the game should fill. Launched from the home screen the app owns the whole screen, whatever the viewport claims. */
export function viewportSize(): { w: number; h: number; full: boolean } {
  let w = Math.max(window.innerWidth, document.documentElement.clientWidth || 0), h = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
  let standalone = false;
  try { standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || ['standalone', 'fullscreen'].some(m => window.matchMedia(`(display-mode: ${m})`).matches); } catch { standalone = false; }
  if (standalone && screen.width && screen.height) {
    const land = w >= h, a = Math.max(screen.width, screen.height), b = Math.min(screen.width, screen.height);
    w = land ? a : b; h = land ? b : a;
  }
  return { w, h, full: standalone };
}
/** Composer target options. Round 12: Low (no AO) must leave depthTexture out entirely: r182's RenderTarget setter
 *  dereferences an explicit `undefined` and the game never finished loading on Low. */
export function composerTargetOptions(w: number, h: number, samples: number, ao: boolean): THREE.RenderTargetOptions {
  const o: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, samples };
  if (ao) o.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
  return o;
}

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
  ao: AOPass | null = null;
  grade!: OutputGradePass;
  quality!: QualityPreset;
  qualityName: QualityName = 'medium';
  /** 'natural' = neutral photographic grade (default); 'stylised' = teal/apricot split-tone. */
  look: 'natural' | 'stylised' = 'natural';
  setLook(look: 'natural' | 'stylised') {
    this.look = look;
    if (!this.grade) return;
    const u = this.grade.uniforms, n = look === 'natural';
    this.hurtK = 0; u.uSat.value = n ? LOOK.natural.sat : LOOK.stylised.sat; u.uSplit.value = n ? LOOK.natural.split : 1; u.uVignette.value = n ? LOOK.natural.vignette : LOOK.stylised.vignette;
  }
  /** R6-F: low health pulls the colour out of the picture and darkens the edges (k 0..1). */
  setHurt(k: number) {
    if (!this.grade || Math.abs(k - this.hurtK) < 0.004) return;
    this.hurtK = k; const u = this.grade.uniforms, L = LOOK[this.look];
    u.uSat.value = L.sat * (1 - 0.55 * k); u.uVignette.value = L.vignette + 0.3 * k;
  }
  private hurtK = 0;
  private shadowTarget = new THREE.Vector3(); private lightDir = new THREE.Vector3(0, 1, 0);
  private _fwd = new THREE.Vector3(); private _zero = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private envGroundMat!: THREE.MeshBasicMaterial;
  private envCityMat!: THREE.MeshBasicMaterial;
  private envLightsMat!: THREE.MeshBasicMaterial;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envHour = -100;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.autoUpdate = false; // redrawn on our own cadence (render())
    try { this.gpuTimer = new GpuTimer(this.renderer.getContext()); if (!this.gpuTimer.available) this.gpuTimer = null; } catch { this.gpuTimer = null; }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // Round 12: r182 dropped PCFSoft (it fell back to hard 1-texel PCF: stair-stepped, dithered edges)
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.15, 1600);
    this.scene.fog = new THREE.Fog(0x88aabb, 120, 420);
    this.hemi = new THREE.HemisphereLight(0xa7d3ee, 0x7a6656, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.6; // Vogel-disk PCF footprint in texels: a soft ~12 cm penumbra on Medium instead of pixel stairs
    this.scene.add(this.hemi, this.sun, this.sun.target, this.sky.mesh);
    this.scene.updateMatrix();
    this.scene.matrixAutoUpdate = false;
    skipHiddenMatrices(this.scene);
    this.lightPool = new LightPool(this.scene); this.scene.userData.lightPool = this.lightPool;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envSky.mesh.scale.setScalar(50);
    this.envSky.uniforms.uStars.value = 0; // stars in reflections read as noise on glass
    this.envScene.add(this.envSky.mesh);
    // Rich urban reflection ring for PMREM: ground bounce + skyline silhouettes + night warm window ribbons
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x45413e });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 24).rotateX(-Math.PI / 2), this.envGroundMat);
    ground.position.y = -2; this.envScene.add(ground);
    this.envCityMat = new THREE.MeshBasicMaterial({ color: 0x3b4048 });
    this.envLightsMat = new THREE.MeshBasicMaterial({ color: 0xffc685 });
    const skyline = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.envCityMat, 28);
    const skyLights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.envLightsMat, 28);
    const em = new THREE.Matrix4(), eq = new THREE.Quaternion(), ep = new THREE.Vector3(), es = new THREE.Vector3(), eu = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const dist = 34 + (i % 3) * 4;
      const h = 4.5 + ((i * 7 + 3) % 11) * 1.4;
      const w = 5.5 + (i % 4) * 1.5;
      ep.set(Math.cos(a) * dist, h * 0.5 - 2, Math.sin(a) * dist);
      eq.setFromAxisAngle(eu, -a);
      es.set(2.5, h, w);
      em.compose(ep, eq, es); skyline.setMatrixAt(i, em);
      ep.set(Math.cos(a) * (dist - 1.5), h * 0.45 - 1.2, Math.sin(a) * (dist - 1.5));
      es.set(0.3, h * 0.22, w * 0.72);
      em.compose(ep, eq, es); skyLights.setMatrixAt(i, em);
    }
    this.envScene.add(skyline, skyLights);
    this.setQuality('medium');
    window.addEventListener('resize', () => this.resize());
    // iPadOS home-screen apps report a short viewport at launch and settle later; re-measure on rotation / viewport changes
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    window.visualViewport?.addEventListener('resize', () => this.resize());
    for (const ms of [150, 600, 1500]) setTimeout(() => this.resize(), ms);
  }
  setQuality(name: QualityName) {
    this.qualityName = name; const q = this.quality = QUALITY[name];
    this.applyPixelRatio();
    this.lightPool?.setCount(q.lightPool);
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
  /** Pixel ratio = preset cap x the adaptive resolution scale (dynScale drops under load and recovers when there is headroom). */
  private applyPixelRatio() { this.renderer.setPixelRatio(this.effectivePixelRatio()); }
  /** Preset cap (limited by the DPR and a pixel budget) x user scale x adaptive scale. */
  effectivePixelRatio() {
    const { w, h } = viewportSize();
    return pixelRatioFor(w, h, window.devicePixelRatio || 1, this.quality.pixelRatio, this.quality.pixelBudget, runtime.resolutionScale, this.dyn.scale);
  }
  /** Adaptive resolution: 1 = full; falls towards DYN_MIN when frames run long so high graphics stay playable. Off under automation. */
  get dynScale() { return this.dyn.scale; }
  set dynScale(v: number) { this.dyn.scale = v; }
  adaptive = typeof navigator === 'undefined' || !navigator.webdriver;
  private gpuTimer: GpuTimer | null = null;
  private lastRender = 0; private dyn: DynState = newDyn();
  get frameEma() { return this.dyn.ema; }
  private adapt(now: number) {
    const dt = now - this.lastRender; this.lastRender = now;
    if (!adaptStep(this.dyn, dt, now, this.adaptive, this.gpuTimer?.ms ?? 0)) return;
    // Round 8: a resize reallocates every full-screen target (a visible stall); adaptStep allows one at most every 6 s, with
    // hysteresis, so it can no longer chase its own hitch (it used to resize on every crossing of 33 ms: a freeze ~every second)
    this.applyPixelRatio(); this.resize();
  }
  private buildComposer() {
    this.composer?.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    const ao = this.quality.ao > 0;
    // Round 12: the frame keeps its depth as a texture so the AO pass can read it
    const rt = new THREE.WebGLRenderTarget(w, h, composerTargetOptions(w, h, safeMsaa(this.quality.msaa), ao));
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao?.dispose(); this.ao = null;
    if (ao) { this.ao = new AOPass(this.camera, { samples: this.quality.ao }); this.composer.addPass(this.ao); }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.4, 0.9);
    this.bloom.enabled = this.quality.bloom;
    this.composer.addPass(this.bloom);
    this.grade = new OutputGradePass();
    this.grade.uniforms.uFxaa.value = safeMsaa(this.quality.msaa) > 0 ? 0 : 1; // FXAA wherever MSAA is off
    this.grade.uniforms.uAO.value = this.ao ? 1 : 0;
    this.grade.uniforms.tAO.value = this.ao ? this.ao.texture : WHITE_TEX;
    this.composer.addPass(this.grade);
  }
  resize() {
    const { w, h, full } = viewportSize();
    this.renderer.setSize(w, h, full); // home-screen app: size the canvas element itself to the whole screen (no bars)
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    if (this.grade) this.grade.uniforms.uSharp.value = this.renderer.getPixelRatio() < (window.devicePixelRatio || 1) - 0.05 ? 0.5 : 0.3; // upscaled (e.g. iPad at 1.5 of 2): sharpen more
  }
  /** Updates lighting for a given hour and keeps the shadow frustum centred on the focus point. */
  updateEnvironment(hour: number, time: number, focus: THREE.Vector3) {
    const s = sampleSky(hour, this.skyState);
    this.sky.update(s, time, this.camera.position);
    // Sync shared live sky uniforms for water, building glass, and vehicle glass reflections
    skyTopUniform.value.copy(s.top);
    skyHorizonUniform.value.copy(s.horizon);
    sunDirUniform.value.copy(s.sunDir);
    sunColUniform.value.copy(s.sun);
    // Rebuild the reflection environment from the sky every 0.75 game hours (~45 real s). Round 8: it was every 6 game
    // minutes = every 6 real seconds, and each rebuild (a new PMREM target) made every material re-resolve its program: a
    // regular hitch on the Mac
    if (envRebuildDue(hour, this.envHour)) {
      this.envHour = hour;
      this.envSky.update(s, 0, this._zero);
      this.envGroundMat.color.copy(s.hemiGround).multiplyScalar(THREE.MathUtils.lerp(0.65, 0.32, s.night));
      this.envCityMat.color.copy(s.horizon).lerp(s.hemiGround, 0.65).multiplyScalar(THREE.MathUtils.lerp(0.55, 0.16, s.night));
      this.envLightsMat.color.setRGB(
        THREE.MathUtils.lerp(0.45, 1.35, s.night),
        THREE.MathUtils.lerp(0.48, 0.96, s.night),
        THREE.MathUtils.lerp(0.54, 0.56, s.night),
      );
      const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
      this.envRT?.dispose(); this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.56, 0.48, s.night);
    this.sun.color.copy(s.sun); this.sun.intensity = s.sunI;
    const L = LOOK[this.look];
    this.hemi.color.copy(s.hemiSky); this.hemi.groundColor.copy(s.hemiGround); this.hemi.intensity = s.hemiI;
    if (L.shadowDesat > 0) { // softer, less saturated-blue fill so shadows read neutral grey
      const g = this.hemi.color.r * 0.3 + this.hemi.color.g * 0.55 + this.hemi.color.b * 0.15;
      this.hemi.color.r += (g - this.hemi.color.r) * L.shadowDesat; this.hemi.color.g += (g - this.hemi.color.g) * L.shadowDesat; this.hemi.color.b += (g - this.hemi.color.b) * L.shadowDesat;
      this.hemi.intensity *= 1 + 0.12 * (1 - s.night);
    }
    (this.scene.fog as THREE.Fog).color.copy(s.fog);
    (this.scene.fog as THREE.Fog).near = THREE.MathUtils.lerp(DAY_FOG_NEAR, 70, s.night);
    this.renderer.toneMappingExposure = s.exposure * THREE.MathUtils.lerp(1, L.nightExposure, s.night);
    const range = (this.quality.shadowRange || 60) * 1.6, texel = (range * 2) / (this.quality.shadowMap || 1024);
    const fwd = this.camera.getWorldDirection(this._fwd); const fl = Math.hypot(fwd.x, fwd.z) || 1; const ahead = range * 0.45;
    const fx = focus.x + (fwd.x / fl) * ahead, fz = focus.z + (fwd.z / fl) * ahead;
    shadowFrame(s.lightDir, fx, fz, texel, this.lightDir, this.shadowTarget);
    if (
      Math.abs(this.shadowTarget.x - this.lastSx) > 1e-3 ||
      Math.abs(this.shadowTarget.z - this.lastSz) > 1e-3 ||
      Math.abs(this.lightDir.x - this.lastLdx) > 1e-4 ||
      Math.abs(this.lightDir.z - this.lastLdz) > 1e-4
    ) {
      this.lastSx = this.shadowTarget.x; this.lastSz = this.shadowTarget.z;
      this.lastLdx = this.lightDir.x; this.lastLdz = this.lightDir.z;
      this.shadowMoved = true;
    }
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).addScaledVector(this.lightDir, 180);
    // Round 11 perf: in daylight the threshold leaves next to nothing to bloom: skip the pass (bright lights need the dark)
    this.bloom.enabled = this.quality.bloom && s.night > 0.12;
    this.bloom.strength = THREE.MathUtils.lerp(0.14, 0.30, s.night);
    this.bloom.threshold = THREE.MathUtils.lerp(0.95, 0.85, s.night);
    this.grade.uniforms.uNight.value = s.night;
    this.grade.uniforms.uTime.value = time % 100;
  }
  lightPool: LightPool;
  stats = { calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0 };
  private frameNo = 0; private shadowMoved = true;
  private lastSx = NaN; private lastSz = NaN; private lastLdx = NaN; private lastLdz = NaN;
  private lastDrawn = 0; private appliedRes = 1;
  /** Frame-rate cap from Settings (0 = off): true when it is time to draw the next frame. */
  frameDue(now = performance.now()): boolean { return frameDue(now, this.lastDrawn, runtime.fpsCap); }
  render() {
    const t0 = performance.now();
    if (!this.frameDue(t0)) return;
    this.lastDrawn = t0;
    if (this.appliedRes !== runtime.resolutionScale) { this.appliedRes = runtime.resolutionScale; this.applyPixelRatio(); this.resize(); }
    if (runtime.fpsCap > 0) this.lastRender = t0; // a capped frame time is not load: the adaptive resolution stays put
    else this.adapt(t0);
    // Round 11 perf: on Medium the sun's shadow map (half a million triangles) is redrawn every other frame
    if (this.quality.shadowMap > 0 && shadowRedrawDue(this.frameNo++, this.quality.shadowEvery, this.shadowMoved)) { this.renderer.shadowMap.needsUpdate = true; this.shadowMoved = false; }
    this.lightPool.update(this.camera.position);
    const info = this.renderer.info; info.autoReset = false; info.reset();
    this.grade.uniforms.uSpeed.value = speedBlurAmount((this.camera.userData.speedFx as number | undefined) ?? 0);
    this.gpuTimer?.begin(); this.composer.render(); this.gpuTimer?.end();
    this.stats.calls = info.render.calls; this.stats.triangles = info.render.triangles; this.stats.textures = info.memory.textures; this.stats.geometries = info.memory.geometries; this.stats.programs = info.programs?.length ?? 0;
  }
}

/**
 * Round 11 perf (CPU): three.js recomposes the matrix of every object in the scene each frame, hidden or not. About half of
 * the ~10k objects are hidden top-level subtrees (store interiors out of range, pooled people, parked props), so the scene
 * skips hidden top-level children; they are brought up to date the frame they are shown again (before they are drawn).
 * Objects that must keep a live world matrix while hidden set userData.matrixWhenHidden = true.
 */
export function skipHiddenMatrices(scene: THREE.Object3D) {
  scene.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const ch = this.children;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (!c.matrixWorldAutoUpdate && !force) continue;
      if (c.visible || c.userData.matrixWhenHidden) c.updateMatrixWorld(force);
      else c.matrixWorldNeedsUpdate = true;
    }
  };
}

export { adaptStep, newDyn, type DynState };

/** Round 8: rebuild the sky reflection map only after 0.75 game hours (or the first time / after a clock jump). Pure (tests). */
export function envRebuildDue(hour: number, lastHour: number): boolean {
  if (lastHour < -50) return true;
  return Math.abs(((hour - lastHour + 36) % 24) - 12) >= 0.75;
}
