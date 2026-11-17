import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(1600, 900); r.shadowMap.enabled = true; r.toneMapping = THREE.ACESFilmicToneMapping; document.body.appendChild(r.domElement);
const s = new THREE.Scene(); s.background = new THREE.Color('#9cc7d6');
const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
s.add(new THREE.HemisphereLight('#cfe8ff', '#6b5040', 1.2)); const sun = new THREE.DirectionalLight('#ffe2c0', 2.5); sun.position.set(20, 30, 10); sun.castShadow = true; sun.shadow.camera.left = -40; sun.shadow.camera.right = 40; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40; sun.shadow.mapSize.set(2048, 2048); s.add(sun);
const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#888' })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; s.add(g);
const L = new GLTFLoader(); const base = import.meta.env.BASE_URL + 'assets/';
const info: Record<string, unknown> = {};
const names = new URLSearchParams(location.search).get('n')!.split(',');
const scale = Number(new URLSearchParams(location.search).get('s') || 1);
let x = 0; const mixers: THREE.AnimationMixer[] = [];
for (const n of names) {
  const gl = await L.loadAsync(base + n);
  const o = gl.scene; o.scale.setScalar(scale); o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const b = new THREE.Box3().setFromObject(o); const sz = b.getSize(new THREE.Vector3());
  info[n] = { size: sz.toArray().map(v => +v.toFixed(2)), min: b.min.toArray().map(v => +v.toFixed(2)), anims: gl.animations.length };
  o.position.x = x - b.min.x; x += sz.x + 0.5; s.add(o);
  if (gl.animations.length) { const m = new THREE.AnimationMixer(o); const a = gl.animations.find(a => a.name === (new URLSearchParams(location.search).get('a') || 'Walk_Loop'))!; m.clipAction(a).play(); m.update(0.4); mixers.push(m); }
}
const c = x / 2; const d = Math.max(x * 0.9, 6);
cam.position.set(c, d * 0.45, d); cam.lookAt(c, d * 0.12, 0);
r.render(s, cam);
(window as unknown as { info: unknown }).info = info;
document.title = 'ready';
