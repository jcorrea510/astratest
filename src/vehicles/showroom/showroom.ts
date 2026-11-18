/**
 * Dev-only showroom (not part of the game build): renders vehicle models under game-like daylight so they can be
 * screenshotted and judged. Query: ?kind=sedan&yaw=0.7&doors=1&grid=1&night=0&dist=1&pitch=0.18&lod=0
 */
import * as THREE from 'three';
import { initPhysics, Physics, RAPIER } from '../../core/physics';
import { Vehicle } from '../vehicle';
import { VEHICLES, type VehicleKind } from '../specs';
import { nightUniform } from '../../render/materials';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
await initPhysics();
const W = num('w', 1280), H = num('h', 720);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const night = num('night', 0); nightUniform.value = night;
scene.background = new THREE.Color(night ? 0x0b1020 : 0x9fb8cc);
// sky-like reflection environment: gradient dome + dark ground
const env = new THREE.Scene();
const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { n: { value: night } }, vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 p; uniform float n; void main(){ float h = normalize(p).y; vec3 sky = mix(vec3(0.92,0.93,0.9), vec3(0.35,0.55,0.85), smoothstep(0.0, 0.6, h)); vec3 gr = mix(vec3(0.24,0.23,0.22), vec3(0.5,0.5,0.48), smoothstep(-0.4, 0.0, h)); vec3 c = h > 0.0 ? sky : gr; c += vec3(6.0,5.5,4.5) * pow(max(0.0, dot(normalize(p), normalize(vec3(0.5,0.6,0.4)))), 300.0); gl_FragColor = vec4(c * mix(1.0, 0.06, n), 1.0); }' }));
env.add(dome);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(env, 0.02).texture; scene.environmentIntensity = night ? 0.3 : 0.55;
scene.add(new THREE.HemisphereLight(0xb7d4ee, 0x6e6354, night ? 0.15 : 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, night ? 0.1 : 2.6);
sun.position.set(6, 9, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.85 }));
ground.receiveShadow = true; scene.add(ground);
const physics = new Physics();
physics.world.createCollider(RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0));

const kinds = (q.has('kinds') ? q.get('kinds')!.split(',') : q.get('kind') === 'all' || q.has('grid') ? Object.keys(VEHICLES) : [q.get('kind') ?? 'sedan']) as VehicleKind[];
const cars: Vehicle[] = [];
const grid = q.has('grid') || q.has('kinds');
const cols = num('cols', q.has('kinds') ? 2 : 5), gap = 12;
kinds.forEach((k, i) => {
  const x = grid ? (i % cols) * gap : 0, z = grid ? Math.floor(i / cols) * gap : 0;
  const v = new Vehicle(physics, k, null, x, 0.2, z, 0, null, num('paint', -1));
  v.persistent = q.has('lights'); v.headlights = q.has('lights'); v.siren = q.has('siren');
  scene.add(v.group); cars.push(v);
  if (q.has('doors')) v.doors.forEach((_, j) => v.setDoor(j, 1));
  if (q.has('break')) v.breakGlass(2);
  if (k === 'tank') v.setTurret(num('turret', 0.6), 0.1);
});
for (let i = 0; i < 180; i++) { for (const v of cars) v.phys.fixedUpdate(1 / 60, { throttle: 0, steer: 0, handbrake: true }); physics.step(1 / 60); for (const v of cars) { v.phys.postStep(); v.update(1 / 60, night, i / 60, false); } }
for (const v of cars) v.setLod(num('lod', 0));
const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 500);
const views: { v: Vehicle; vp: [number, number, number, number]; yaw?: number; pitch?: number }[] = [];
if (grid) {
  const cw = W / cols, rows = Math.ceil(cars.length / cols), ch = H / rows;
  cars.forEach((v, i) => views.push({ v, vp: [(i % cols) * cw, H - (Math.floor(i / cols) + 1) * ch, cw, ch] }));
} else if (q.has('quad')) {
  for (let i = 0; i < 4; i++) views.push({ v: cars[0], vp: [(i % 2) * W / 2, H / 2 - Math.floor(i / 2) * H / 2, W / 2, H / 2], yaw: [0.75, Math.PI / 2, 2.45, -0.6][i], pitch: [0.16, 0.02, 0.28, 0.5][i] });
} else views.push({ v: cars[0], vp: [0, 0, W, H] });
renderer.setScissorTest(true);
function frame() {
  for (const { v, vp, yaw: vy, pitch: vpch } of views) {
    const yaw = vy ?? num('yaw', 0.75), pitch = vpch ?? num('pitch', 0.16), len = v.tpl.front - v.tpl.rear;
    const d = (len * 1.25 + 2.2) * num('dist', 1) * (grid ? 0.95 : 1);
    cam.aspect = vp[2] / vp[3]; cam.updateProjectionMatrix();
    const c = v.position.clone(); c.y = v.tpl.roofY * 0.45 + v.position.y * 0;
    const tgt = new THREE.Vector3(c.x, v.position.y + (v.tpl.bbox.min.y + v.tpl.bbox.max.y) * 0.45, c.z);
    cam.position.set(tgt.x + Math.sin(yaw) * Math.cos(pitch) * d, tgt.y + Math.sin(pitch) * d, tgt.z + Math.cos(yaw) * Math.cos(pitch) * d);
    cam.lookAt(tgt);
    sun.position.set(tgt.x + 6, 9, tgt.z + 5); sun.target.position.copy(tgt); sun.target.updateMatrixWorld();
    renderer.setViewport(...vp); renderer.setScissor(...vp);
    renderer.render(scene, cam);
  }
  (window as unknown as { __ready: boolean }).__ready = true;
  (window as unknown as { __info: unknown }).__info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}
frame();
(window as unknown as { __frame: () => void }).__frame = frame;
