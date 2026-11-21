// TEMP R6-H hair lab (deleted before hand-off): renders one person's head from several views.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Human, loadHumanTemplate, PLAYER_DEFAULT_LOOK, type Look } from './actors/human';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: false });
r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#9fb4c8');
const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
const sun = new THREE.DirectionalLight('#fff3e0', 3.2); sun.position.set(2.5, 5, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5; sun.shadow.camera.right = sun.shadow.camera.top = 1.5; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight('#bcd4f0', '#6b5a48', 0.9));
const gl = new GLTFLoader();
const ual = await gl.loadAsync(import.meta.env.BASE_URL + 'assets/ual/AnimationLibrary_Godot_Standard.gltf');
const tpl = await loadHumanTemplate(ual);
let people: Human[] = [];
const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
const W = canvas.width, H = canvas.height;
function clear() { for (const p of people) scene.remove(p.root); people = []; }
function make(look: Partial<Look>, x = 0, z = 0, yaw = 0) {
  const h = new Human(tpl, { ...PLAYER_DEFAULT_LOOK, ...look } as Look);
  h.root.position.set(x, 0, z); h.root.rotation.y = yaw; scene.add(h.root); h.update(0.016); h.root.updateMatrixWorld(true); people.push(h); return h;
}
const headPos = (h: Human) => h.head.getWorldPosition(new THREE.Vector3());
/** Views: [yaw around head (0 = front), pitch, dist] laid out in a row. */
function shoot(h: Human, views: [number, number, number][]) {
  const hp = headPos(h); hp.y += 0.07;
  const w = Math.floor(W / views.length);
  r.setScissorTest(true);
  views.forEach(([a, p, d], i) => {
    cam.aspect = w / H; cam.updateProjectionMatrix();
    cam.position.set(hp.x + Math.sin(a) * Math.cos(p) * d, hp.y + Math.sin(p) * d, hp.z + Math.cos(a) * Math.cos(p) * d); cam.lookAt(hp);
    r.setViewport(i * w, 0, w, H); r.setScissor(i * w, 0, w, H); r.render(scene, cam);
  });
  r.setScissorTest(false);
}
(window as any).lab = {
  head(look: Partial<Look>, views?: [number, number, number][], dbg?: number) {
    (globalThis as any).__beardDbg = dbg;
    clear(); const h = make(look); for (let i = 0; i < 3; i++) h.update(0.016);
    shoot(h, views ?? [[0.6, 0.05, 0.75], [0, 0.02, 0.75], [Math.PI * 0.5, 0.05, 0.75], [Math.PI - 0.5, 0.1, 0.8]]);
  },
  crowd(looks: Partial<Look>[], dist: number, fov = 35) {
    clear(); looks.forEach((l, i) => make(l, (i - (looks.length - 1) / 2) * 0.8, 0, 0));
    for (const p of people) for (let k = 0; k < 3; k++) p.update(0.016);
    Human.lodFrom = cam.position;
    cam.fov = fov; cam.aspect = W / H; cam.position.set(0, 1.6, dist); cam.lookAt(0, 1.45, 0); cam.updateProjectionMatrix();
    for (const p of people) { (p as any).lodT = 0; p.update(0.016); }
    r.setViewport(0, 0, W, H); r.render(scene, cam); cam.fov = 28;
  },
};
(window as any).labPeople = () => people;
(window as any).labReady = true;
