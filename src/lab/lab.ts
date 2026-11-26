/**
 * Dev-only lab (not part of the game build): renders people or guns close up under game-like daylight (or night) so
 * they can be screenshotted and judged. Open /src/lab/index.html?<query> on the dev server; wait for window.__ready.
 *   ?mode=gun&id=rifle&yaw=0.6&pitch=0.15&dist=1     one weapon (ids: see combat/weapons.ts)   &all=1 grid of every gun
 *   ?mode=people&n=5&seed=1&view=body|face|crowd&t=1.3 a row of random people idling (view=face frames the heads)
 *   &night=1  night lighting, &w=1280&h=720 size, &sex=m|f restrict people
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { weaponMesh } from '../combat/weaponModels';
import type { WeaponId } from '../combat/weapons';
import { loadHumanTemplate, Human, randomLook } from '../actors/human';
import { nightUniform } from '../render/materials';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const W = num('w', 1280), H = num('h', 720), night = num('night', 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
nightUniform.value = night;
scene.background = new THREE.Color(night ? 0x0b1020 : 0x9fb8cc);
const env = new THREE.Scene();
env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { n: { value: night } }, vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 p; uniform float n; void main(){ float h = normalize(p).y; vec3 sky = mix(vec3(0.92,0.93,0.9), vec3(0.35,0.55,0.85), smoothstep(0.0, 0.6, h)); vec3 gr = mix(vec3(0.24,0.23,0.22), vec3(0.5,0.5,0.48), smoothstep(-0.4, 0.0, h)); vec3 c = h > 0.0 ? sky : gr; c += vec3(6.0,5.5,4.5) * pow(max(0.0, dot(normalize(p), normalize(vec3(0.5,0.6,0.4)))), 300.0); gl_FragColor = vec4(c * mix(1.0, 0.06, n), 1.0); }' })));
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(env, 0.02).texture; scene.environmentIntensity = night ? 0.3 : 0.45;
scene.add(new THREE.HemisphereLight(0xb7d4ee, 0x6e6354, night ? 0.12 : 0.7));
const sun = new THREE.DirectionalLight(0xfff1dc, night ? 0.08 : 3.0);
sun.position.set(4, 7, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
if (night) { const lamp = new THREE.PointLight(0xffc98a, 30, 12, 2); lamp.position.set(-1.5, 3.5, 2); scene.add(lamp); }
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a6b6d, roughness: 0.9 }));
ground.receiveShadow = true; scene.add(ground);
const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 500);
const win = window as unknown as Record<string, unknown>;
const mode = q.get('mode') ?? 'gun';
let tick: (dt: number) => void = () => {};

if (mode === 'gun') {
  const ALL: WeaponId[] = ['knife', 'bat', 'compact', 'pistol', 'heavyPistol', 'machinePistol', 'revolver', 'compactSmg', 'smg', 'sawnoff', 'shotgun', 'autoShotgun', 'carbine', 'rifle', 'battleRifle', 'marksman', 'sniper', 'lmg', 'grenadeLauncher', 'rpg', 'grenade', 'molotov'];
  const ids = q.has('all') ? ALL : [(q.get('id') ?? 'rifle') as WeaponId];
  const cols = Math.ceil(Math.sqrt(ids.length * 1.6)), gap = 1.2;
  let maxLen = 0;
  ids.forEach((id, i) => {
    const g = weaponMesh(id); g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
    const box = new THREE.Box3().setFromObject(g); const len = box.max.z - box.min.z; maxLen = Math.max(maxLen, len);
    const x = ids.length > 1 ? (i % cols - (cols - 1) / 2) * gap : 0, z = ids.length > 1 ? (Math.floor(i / cols)) * gap * 0.55 : 0;
    g.position.set(x, 0.9, z - (box.min.z + box.max.z) / 2); scene.add(g);
  });
  const yaw = num('yaw', 1.15), pitch = num('pitch', 0.12);
  const tgt = new THREE.Vector3(0, 0.92, ids.length > 1 ? (Math.ceil(ids.length / cols) - 1) * gap * 0.275 : 0);
  const d = (ids.length > 1 ? cols * gap * 1.9 : Math.max(0.25, maxLen) * 2.6) * num('dist', 1);
  cam.position.set(tgt.x + Math.sin(yaw) * Math.cos(pitch) * d, tgt.y + Math.sin(pitch) * d, tgt.z + Math.cos(yaw) * Math.cos(pitch) * d); cam.lookAt(tgt);
  ground.position.y = 0.6;
} else {
  const loader = new GLTFLoader();
  const ual = await loader.loadAsync(import.meta.env.BASE_URL + 'assets/ual/AnimationLibrary_Godot_Standard.gltf');
  const tpl = await loadHumanTemplate(ual);
  const n = num('n', 5), seed = num('seed', 1), view = q.get('view') ?? 'body';
  const people: Human[] = [];
  for (let i = 0, s = seed; people.length < n && i < 500; i++, s++) {
    const look = randomLook(s * 7919 + 13);
    if (q.has('sex') && look.sex !== q.get('sex')) continue;
    const h = new Human(tpl, look); h.setSpeed(0);
    h.model.position.set((people.length - (n - 1) / 2) * (view === 'face' ? 0.55 : 0.8), 0, 0);
    h.model.traverse(o => { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; });
    scene.add(h.model); people.push(h);
  }
  const t = num('t', 1.3);
  for (let k = 0; k < Math.round(t * 30); k++) for (const h of people) h.update(1 / 30);
  tick = dt => { for (const h of people) h.update(dt); };
  const spread = (n - 1) * (view === 'face' ? 0.55 : 0.8);
  const yaw = num('yaw', 0.25), pitch = num('pitch', 0.05);
  const tgt = new THREE.Vector3(0, view === 'face' ? 1.6 : 0.95, 0);
  const d = (view === 'face' ? spread * 0.9 + 1.0 : view === 'crowd' ? spread * 1.6 + 6 : spread * 1.05 + 3.2) * num('dist', 1);
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * d, tgt.y + Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d); cam.lookAt(tgt);
}
cam.updateProjectionMatrix();
function frame(dt = 0) { tick(dt); renderer.render(scene, cam); }
frame();
win.__frame = frame; win.__info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; win.__ready = true;
