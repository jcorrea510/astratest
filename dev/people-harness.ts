// Standalone people viewer for visual checks (no game, no physics): window.__people exposes the scene.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Renderer } from '../src/render/renderer';
import { loadHumanTemplate, Human, randomLook, PLAYER_DEFAULT_LOOK, type Look } from '../src/actors/human';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new Renderer(canvas);
const ual = await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'assets/ual/AnimationLibrary_Godot_Standard.gltf');
const tpl = await loadHumanTemplate(ual);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#8f8a84', roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; r.scene.add(ground);
const walk = new THREE.Mesh(new THREE.BoxGeometry(40, 0.18, 6), new THREE.MeshStandardMaterial({ color: '#c9c3b8', roughness: 0.85 }));
walk.position.set(0, 0.09, -6); walk.receiveShadow = true; r.scene.add(walk);
const people: Human[] = [];
const api = {
  THREE, tpl, r, people, Human, randomLook, PLAYER_DEFAULT_LOOK,
  clear() { for (const h of people) h.dispose(); people.length = 0; },
  add(look: Look, x: number, z: number, yaw = 0) { const h = new Human(tpl, look); h.root.position.set(x, 0, z); h.root.rotation.y = yaw; r.scene.add(h.root); people.push(h); return h; },
  step(dt: number, n = 1) { for (let i = 0; i < n; i++) for (const h of people) h.update(dt); },
  shot(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number, hour = 13, fov = 50) {
    r.camera.fov = fov; r.camera.updateProjectionMatrix();
    r.camera.position.set(cx, cy, cz); r.camera.lookAt(tx, ty, tz);
    r.updateEnvironment(hour, 10, new THREE.Vector3(tx, 0, tz)); r.render();
  },
};
(window as unknown as { __people: typeof api }).__people = api;
document.title = 'ready';
