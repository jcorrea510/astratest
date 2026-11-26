/**
 * Far pedestrians: the real person body, decimated (~1.8k triangles, the real lod 2) and vertex-animated. A walk cycle and an idle pose are
 * baked from the real retargeted clips into a float texture (positions + normals per vertex per frame); each instance
 * plays it at its own phase/rate, so a far crowd of hundreds is one draw call per sex but walks like real people. Clothes,
 * skin, hair and shoes come from the person's actual look (the same parameters the full-detail shader uses), so when a far
 * pedestrian is handed over to a real one up close, the same person carries on walking.
 */
import * as THREE from 'three';
import { uploadUsed } from '../vehicles/farCars';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { lowBody, type HumanTemplate } from './human';
import type { BodyBase } from './humanAssets';
import { personMaterial, applyLookUniforms, type PersonUniforms } from './humanMaterial';
import type { FullLook, Sex } from './look';

/** Walk frames baked per cycle (+ 1 idle frame after them). */
export const VAT_FRAMES = 16;
const LOW_TRIS = 600; // = real lod 3 (same geometry: the hand-over at the promote radius is seamless)

/** Per-person instance data: 6 x vec4 (see the shader). */
export type CrowdLook = Float32Array;
const dummy = new Map<Sex, THREE.MeshStandardMaterial>();
/** Packs a look into the far-body instance data (colours linear, cut lines as in the full shader). */
export function packLook(base: BodyBase, look: FullLook, tplMap: THREE.Texture, out: CrowdLook = new Float32Array(24)): CrowdLook {
  let m = dummy.get(look.sex);
  if (!m) { m = personMaterial(base, tplMap, tplMap); dummy.set(look.sex, m); }
  applyLookUniforms(m, base, look);
  const u = m.userData.uniforms as PersonUniforms, C = u.uC.value;
  const put = (i: number, c: THREE.Color, w: number) => { out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b; out[i * 4 + 3] = w; };
  put(0, C[0], u.uPat.value.y); // skin, hair paint mode (0 = bald)
  put(1, C[1], u.uTop.value.x); // top, sleeve end
  put(2, C[3], u.uBottom.value.x); // bottom, leg end
  put(3, C[4], u.uBottom.value.z); // shoes, shoe top
  put(4, C[6], u.uTop.value.y); // hair, top hem
  out[20] = 0; out[21] = 1; out[22] = 1; out[23] = u.uBottom.value.w; // phase, rate, walking, waistband
  return out;
}

interface SexMesh { mesh: THREE.InstancedMesh; data: THREE.InstancedBufferAttribute[]; n: number; base: BodyBase; cycle: number; speed: number }

function bake(base: BodyBase, low: THREE.BufferGeometry, sex: Sex): { tex: THREE.DataTexture; cycle: number } {
  const model = SkeletonUtils.clone(base.scene);
  model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.set(1, 1, 1);
  const meshes: THREE.SkinnedMesh[] = []; model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
  const sm = meshes[0];
  // same everyday proportions as Human (slimmer athlete limbs)
  for (const s of ['L', 'R']) {
    const arm = model.getObjectByName('DEF-upper_arm' + s), thigh = model.getObjectByName('DEF-thigh' + s);
    if (arm) { arm.scale.set(sex === 'm' ? 0.86 : 0.93, 1, sex === 'm' ? 0.86 : 0.93); if (sex === 'm') arm.position.multiplyScalar(0.9); }
    if (thigh) thigh.scale.set(sex === 'm' ? 0.95 : 1, 1, sex === 'm' ? 0.95 : 1);
  }
  const mixer = new THREE.AnimationMixer(model);
  const walk = base.clips.get('Walk_Loop')!, idle = base.clips.get('Idle_Loop')!;
  const V = low.attributes.position.count, F = VAT_FRAMES + 1;
  const data = new Float32Array(V * F * 2 * 4);
  const P = low.attributes.position as THREE.BufferAttribute, N = low.attributes.normal as THREE.BufferAttribute;
  const SI = low.attributes.skinIndex as THREE.BufferAttribute, SW = low.attributes.skinWeight as THREE.BufferAttribute;
  const skin = new THREE.Matrix4(), tmp = new THREE.Matrix4(), toModel = new THREE.Matrix4(), v = new THREE.Vector3(), nrm = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (let f = 0; f < F; f++) {
    mixer.stopAllAction();
    const clip = f < VAT_FRAMES ? walk : idle, a = mixer.clipAction(clip);
    a.reset(); a.play(); a.time = f < VAT_FRAMES ? (f / VAT_FRAMES) * clip.duration : 0; mixer.update(0);
    model.updateMatrixWorld(true); sm.skeleton.update();
    toModel.copy(sm.matrixWorld); // model is at the identity: mesh world = model space
    const bm = sm.skeleton.boneMatrices!;
    for (let i = 0; i < V; i++) {
      skin.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = SW.getComponent(i, k); if (w === 0) continue;
        tmp.fromArray(bm, SI.getComponent(i, k) * 16);
        for (let e = 0; e < 16; e++) skin.elements[e] += tmp.elements[e] * w;
      }
      skin.premultiply(sm.bindMatrixInverse).multiply(sm.bindMatrix).premultiply(toModel);
      v.fromBufferAttribute(P, i).applyMatrix4(skin);
      nrm.fromBufferAttribute(N, i).applyMatrix3(nm.getNormalMatrix(skin)).normalize();
      const o = ((f * 2) * V + i) * 4, o2 = ((f * 2 + 1) * V + i) * 4;
      data[o] = v.x; data[o + 1] = v.y; data[o + 2] = v.z; data[o + 3] = 1;
      data[o2] = nrm.x; data[o2 + 1] = nrm.y; data[o2 + 2] = nrm.z; data[o2 + 3] = 0;
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(model); sm.skeleton.dispose();
  const tex = new THREE.DataTexture(data, V, F * 2, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  void sex;
  return { tex, cycle: walk.duration };
}

function crowdMaterial(tex: THREE.DataTexture, base: BodyBase): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  const uni = { uVat: { value: tex }, uTime: { value: 0 }, uNeck: { value: new THREE.Vector4(base.J.neck.x, base.J.neck.z, 0.085, 0) }, uGround: { value: base.groundY } };
  m.userData.uniforms = uni;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uVat; uniform float uTime;
attribute float region; attribute float cloth; attribute vec3 hpos;
attribute vec4 aC0; attribute vec4 aC1; attribute vec4 aC2; attribute vec4 aC3; attribute vec4 aC4; attribute vec4 aAnim;
flat varying float vRegion; varying float vCloth; varying vec3 vHn; varying vec3 vBind;
flat varying vec4 vC0; flat varying vec4 vC1; flat varying vec4 vC2; flat varying vec4 vC3; flat varying vec4 vC4; flat varying float vWaist;
vec3 vatFetch(int frame, int which) { return texelFetch(uVat, ivec2(gl_VertexID, frame * 2 + which), 0).xyz; }`)
      .replace('#include <beginnormal_vertex>', `
float cyc = fract(uTime * aAnim.y + aAnim.x) * ${VAT_FRAMES}.0;
int f0 = int(floor(cyc)); int f1 = (f0 + 1) % ${VAT_FRAMES}; float fw = fract(cyc);
if (aAnim.z < 0.5) { f0 = ${VAT_FRAMES}; f1 = ${VAT_FRAMES}; fw = 0.0; }
vec3 objectNormal = normalize(mix(vatFetch(f0, 1), vatFetch(f1, 1), fw));
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = mix(vatFetch(f0, 0), vatFetch(f1, 0), fw);
vRegion = region; vCloth = cloth; vHn = hpos; vBind = position; vC0 = aC0; vC1 = aC1; vC2 = aC2; vC3 = aC3; vC4 = aC4; vWaist = aAnim.w;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec4 uNeck; uniform float uGround;
flat varying float vRegion; varying float vCloth; varying vec3 vHn; varying vec3 vBind;
flat varying vec4 vC0; flat varying vec4 vC1; flat varying vec4 vC2; flat varying vec4 vC3; flat varying vec4 vC4; flat varying float vWaist;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
int ri = int(vRegion + 0.5);
vec3 skinC = vC0.rgb, topC = vC1.rgb, botC = vC2.rgb, shoeC = vC3.rgb, hairC = vC4.rgb;
vec3 col = skinC;
if (ri == 1) {
  float nd = length((vBind.xz - uNeck.xy) * vec2(1.0, 1.2));
  if (vCloth > 0.97 && nd < uNeck.z) col = skinC;
  else if (vCloth >= vC4.w) col = topC;
  else if (vCloth < vWaist) col = botC;
} else if (ri == 2) { col = (vCloth < vC1.w && vCloth < 1.05) ? topC : skinC; }
else if (ri == 3) { col = vCloth > vC3.w ? shoeC : (vCloth < vC2.w ? botC : skinC); if (vCloth > vC3.w && vBind.y < uGround + 0.028) col = vec3(0.85); }
else if (ri == 4 || ri == 5 || ri == 8) col = hairC;
else if (ri == 6) col = topC; else if (ri == 7) col = botC; else if (ri == 9) col = vec3(0.05); else if (ri == 12) col = vec3(0.8);
if (ri == 0 && vHn.y > -1.5 && vC0.w > 0.5) {
  float front = smoothstep(0.15, 0.8, vHn.z); float h = -0.42 + 0.84 * front;
  col = mix(col, hairC, smoothstep(h - 0.04, h + 0.05, vHn.y));
}
diffuseColor.rgb = col;`);
  };
  m.customProgramCacheKey = () => 'crowd-body-v1';
  return m;
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), sph = new THREE.Sphere();
export class CrowdPeople {
  private sexes = new Map<Sex, SexMesh>();
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4(); private camPos = new THREE.Vector3();
  drawn = 0;
  constructor(scene: THREE.Scene, private tpl: HumanTemplate, private cap = 700) {
    for (const sex of ['m', 'f'] as Sex[]) {
      const base = tpl.assets.bodies[sex];
      const low = lowBody(base.geo, LOW_TRIS);
      const { tex, cycle } = bake(base, low, sex);
      const geo = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'region', 'cloth', 'hpos']) geo.setAttribute(k, low.attributes[k]);
      const data = ['aC0', 'aC1', 'aC2', 'aC3', 'aC4', 'aAnim'].map(k => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); return a; });
      const mesh = new THREE.InstancedMesh(geo, crowdMaterial(tex, base), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.name = 'crowdPeople:' + sex;
      scene.add(mesh);
      const loco = base.loco.find(l => l.name === 'Walk_Loop');
      this.sexes.set(sex, { mesh, data, n: 0, base, cycle, speed: loco?.speed ?? 1.4 });
    }
  }
  /** Look data for a person (cache it on the crowd member). */
  pack(look: FullLook): CrowdLook { return packLook(this.tpl.assets.bodies[look.sex], look, this.tpl.assets.map); }
  begin(camera: THREE.Camera | null, time: number) {
    for (const s of this.sexes.values()) { s.n = 0; (s.mesh.material as THREE.MeshStandardMaterial).userData.uniforms.uTime.value = time; }
    if (camera) { this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm); this.camPos.copy(camera.position); }
    this.drawn = 0;
  }
  /** One person at (x, y, z) facing yaw; `speed` m/s (0 = standing). Returns false when culled. */
  add(look: FullLook, data: CrowdLook, x: number, y: number, z: number, yaw: number, speed: number, phase: number, culled = true): boolean {
    const s = this.sexes.get(look.sex)!;
    if (s.n >= this.cap) return false;
    if (culled) { const d = Math.hypot(x - this.camPos.x, z - this.camPos.z); if (!this.frustum.intersectsSphere(sph.set(p.set(x, y + 0.9, z), 1.2 + d * 0.08))) return false; }
    const k = look.height * (1.78 / s.base.height), b = look.build;
    q.setFromAxisAngle(up, yaw); p.set(x, y, z); sc.set(k * b, k, k * (0.55 + b * 0.45)); m4.compose(p, q, sc);
    const i = s.n++; s.mesh.setMatrixAt(i, m4);
    for (let j = 0; j < 5; j++) s.data[j].setXYZW(i, data[j * 4], data[j * 4 + 1], data[j * 4 + 2], data[j * 4 + 3]);
    // cycle rate so the feet don't slide: clip speed scales with body size
    const rate = speed > 0.05 ? speed / (s.speed * k) / s.cycle : 0;
    s.data[5].setXYZW(i, phase, rate, speed > 0.05 ? 1 : 0, data[23]);
    this.drawn++;
    return true;
  }
  end() {
    for (const s of this.sexes.values()) {
      s.mesh.count = s.n; s.mesh.visible = s.n > 0;
      if (s.n) { uploadUsed(s.mesh.instanceMatrix, s.n); for (const a of s.data) uploadUsed(a, s.n); } // Round 7 perf: used instances only
    }
  }
}
