/**
 * Round 12 post effects: screen-space ambient occlusion (half resolution) and the shader code for FXAA, which runs inside the
 * final tone-map + grade pass (no extra full-screen pass).
 *
 * AO is the scalable-ambient-obscurance estimator (McGuire et al. 2012): a handful of depth taps on a rotated spiral around
 * each pixel, reconstructing view-space positions from the depth buffer. It gives the contact shadows that hold a scene
 * together (kerbs, car undersides, window reveals, the base of every wall) and it is what made the city look flat without it.
 * Cost: one half-resolution pass of N depth taps + one 9-tap depth-aware blur, all at half resolution.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface AOSettings { samples: number; radius: number; intensity: number; fadeNear: number; fadeFar: number }
export const AO_DEFAULT: AOSettings = { samples: 8, radius: 1.2, intensity: 1.7, fadeNear: 55, fadeFar: 150 };

/** Projected size in pixels of a world-space length `r` at view depth `z` (pure, for tests and the shader's radius). */
export function projectedRadiusPx(r: number, z: number, projScaleY: number, heightPx: number): number {
  return (r * projScaleY * heightPx * 0.5) / Math.max(1e-3, Math.abs(z));
}

const AO_FRAG = /* glsl */`
  #include <packing>
  uniform sampler2D tDepth; uniform vec2 uTexel; uniform mat4 uProjInv; uniform float uNear, uFar, uRadius, uIntensity, uProjScale, uFadeNear, uFadeFar;
  varying vec2 vUv0;
  float viewZ(vec2 uv){ return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
  vec3 viewPos(vec2 uv, float z){
    vec4 c = uProjInv * vec4(uv * 2.0 - 1.0, 0.0, 1.0); // ray through the pixel on the near plane
    return c.xyz / c.w * (z / (c.z / c.w));
  }
  void main(){
    // snap to a full-resolution depth texel centre: half-res pixel centres fall between texels, and nearest sampling then
    // flips between rows, which drew horizontal stripes across flat ground
    vec2 vUv = (floor(vUv0 / uTexel) + 0.5) * uTexel;
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    float z = perspectiveDepthToViewZ(d, uNear, uFar);
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, -z);
    if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
    vec3 P = viewPos(vUv, z);
    // normal from depth: pick the smaller difference on each axis so silhouettes don't smear
    vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
    vec3 Px1 = viewPos(vUv + ox, viewZ(vUv + ox)), Px0 = viewPos(vUv - ox, viewZ(vUv - ox));
    vec3 Py1 = viewPos(vUv + oy, viewZ(vUv + oy)), Py0 = viewPos(vUv - oy, viewZ(vUv - oy));
    vec3 dx = abs(Px1.z - P.z) < abs(P.z - Px0.z) ? Px1 - P : P - Px0;
    vec3 dy = abs(Py1.z - P.z) < abs(P.z - Py0.z) ? Py1 - P : P - Py0;
    vec3 N = normalize(cross(dx, dy));
    float rPx = uRadius * uProjScale / -z; // radius in UV units (height-normalised)
    rPx = min(rPx, 0.12);
    // per-pixel rotation (interleaved gradient noise) hides the low sample count; the blur pass removes the pattern
    float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float sum = 0.0;
    float r2 = uRadius * uRadius;
    for (int i = 0; i < AO_SAMPLES; i++) {
      float a = (float(i) + 0.5) / float(AO_SAMPLES);
      float ang = a * 6.2831853 * 2.618 + rot; // golden-angle-ish spiral (several turns)
      vec2 off = vec2(cos(ang), sin(ang)) * rPx * a;
      off.x *= uTexel.x / uTexel.y; // keep the disc round on screen (UV x spans the wider side)
      vec2 suv = vUv + off;
      vec3 Q = viewPos(suv, viewZ(suv));
      vec3 v = Q - P;
      float vv = dot(v, v), vn = dot(v, N);
      float f = max(r2 - vv, 0.0);
      sum += f * f * f * max((vn - (0.02 + 0.004 * -z)) / (vv + 0.01), 0.0);
    }
    float ao = max(0.0, 1.0 - sum * uIntensity * 5.0 / (r2 * r2 * r2 * float(AO_SAMPLES)));
    ao = mix(1.0, ao, fade);
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }`;

const BLUR_FRAG = /* glsl */`
  #include <packing>
  uniform sampler2D tAO, tDepth; uniform vec2 uTexel; uniform float uNear, uFar; varying vec2 vUv;
  float lin(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
  void main(){
    float zc = lin(vUv);
    float sum = 0.0, wsum = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * 1.5;
      float w = 1.0 / (1.0 + abs(lin(uv) - zc) * 8.0 / max(zc, 1.0) * 10.0);
      sum += texture2D(tAO, uv).r * w; wsum += w;
    }
    float ao = sum / wsum;
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }`;

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const AO_VERT = /* glsl */`varying vec2 vUv0; void main(){ vUv0 = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Renders AO from the scene's depth (the composer's read buffer must carry a depthTexture) into a half-resolution target and
 * blurs it. It writes nothing to the frame itself: the final pass multiplies the colour by `texture`.
 */
export class AOPass extends Pass {
  private rt: THREE.WebGLRenderTarget; private blurRT: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial; private blurMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  settings: AOSettings;
  constructor(private camera: THREE.PerspectiveCamera, settings: Partial<AOSettings> = {}) {
    super();
    this.needsSwap = false;
    this.settings = { ...AO_DEFAULT, ...settings };
    const opts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rt = new THREE.WebGLRenderTarget(1, 1, opts); this.blurRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.aoMat = new THREE.ShaderMaterial({
      name: 'SSAO', defines: { AO_SAMPLES: this.settings.samples },
      uniforms: { tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uRadius: { value: this.settings.radius }, uIntensity: { value: this.settings.intensity }, uProjScale: { value: 1 }, uFadeNear: { value: this.settings.fadeNear }, uFadeFar: { value: this.settings.fadeFar } },
      vertexShader: AO_VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      name: 'SSAOBlur', uniforms: { tAO: { value: this.rt.texture }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 } },
      vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    });
  }
  get texture() { return this.blurRT.texture; }
  setSize(w: number, h: number) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.rt.setSize(hw, hh); this.blurRT.setSize(hw, hh);
    // depth taps step over full-resolution texels for the normal; the blur steps over half-resolution texels
    (this.aoMat.uniforms.uTexel.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
    (this.blurMat.uniforms.uTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const depth = read.depthTexture; if (!depth) return;
    const cam = this.camera, u = this.aoMat.uniforms;
    u.tDepth.value = depth; u.uNear.value = cam.near; u.uFar.value = cam.far;
    (u.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    u.uProjScale.value = cam.projectionMatrix.elements[5] * 0.5; // radius (m) -> UV units at unit depth
    u.uRadius.value = this.settings.radius; u.uIntensity.value = this.settings.intensity;
    const b = this.blurMat.uniforms; b.tDepth.value = depth; b.uNear.value = cam.near; b.uFar.value = cam.far;
    const prev = renderer.getRenderTarget();
    this.quad.material = this.aoMat; renderer.setRenderTarget(this.rt); this.quad.render(renderer);
    this.quad.material = this.blurMat; renderer.setRenderTarget(this.blurRT); this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }
  dispose() { this.rt.dispose(); this.blurRT.dispose(); this.aoMat.dispose(); this.blurMat.dispose(); this.quad.dispose(); }
}

/** A 1x1 white texture: the final pass samples it when AO is off, so the shader needs no variant. */
export const WHITE_TEX = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();

/**
 * FXAA (the compact "reduce" variant: 5 luma taps, 2-4 colour taps) on the HDR buffer. Edge luma uses a Reinhard-compressed
 * luminance so bright lights don't swamp the edge test; the blended HDR colour is tone mapped afterwards by the caller.
 * Expects `tDiffuse`, `uRes` (1/size) and a `hdrLuma` helper in scope.
 */
export const FXAA_GLSL = /* glsl */`
  float hdrLuma(vec3 c){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return l / (1.0 + l); }
  vec3 fxaa(vec2 uv, vec3 rgbM){
    vec3 rgbNW = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * uRes).rgb;
    vec3 rgbNE = texture2D(tDiffuse, uv + vec2( 1.0, -1.0) * uRes).rgb;
    vec3 rgbSW = texture2D(tDiffuse, uv + vec2(-1.0,  1.0) * uRes).rgb;
    vec3 rgbSE = texture2D(tDiffuse, uv + vec2( 1.0,  1.0) * uRes).rgb;
    float lNW = hdrLuma(rgbNW), lNE = hdrLuma(rgbNE), lSW = hdrLuma(rgbSW), lSE = hdrLuma(rgbSE), lM = hdrLuma(rgbM);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * (0.25 * 0.125), 1.0 / 128.0);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
    dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uRes;
    vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv + dir * -0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
    float lb = hdrLuma(b);
    return (lb < lMin || lb > lMax) ? a : b;
  }`;
