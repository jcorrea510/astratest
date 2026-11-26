/**
 * Shop preview art: each weapon's real 3D model (combat/weaponModels) rendered once, in a three-quarter view with a
 * key/rim light, into a cached PNG data URL. One small shared WebGL context does all the renders and is released a few
 * seconds after the last one, so there is never a context per item.
 */
import * as THREE from 'three';
import { weaponMesh } from '../combat/weaponModels';
import { WEAPONS, type WeaponId } from '../combat/weapons';

const W = 640, H = 300;
const CACHE = new Map<string, string>();
let gl: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera } | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

/** Weapon id behind a shop item id ("w:pistol:pistol", "a:smg:smg"), or null for armor, food, cars and the like. */
export function shopItemWeapon(itemId: string): WeaponId | null {
  const m = /^[wa]:([^:]+):/.exec(itemId);
  return m && m[1] in WEAPONS ? (m[1] as WeaponId) : null;
}

function context() {
  if (gl) return gl;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf2f5fb, 0x6a625a, 2.0));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.8); key.position.set(-3, 4, -3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb27a, 2.2); rim.position.set(3, 2, 3); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xaecbff, 1.0); fill.position.set(-2, -1, 3); scene.add(fill);
  gl = { renderer, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 60) };
  return gl;
}

function release() {
  idle = null;
  if (!gl) return;
  gl.renderer.dispose(); gl.renderer.forceContextLoss();
  gl = null;
}

/** Cached image (PNG data URL) of the weapon, or null when WebGL is unavailable or the id has no model. */
export function weaponPreviewUrl(id: WeaponId): string | null {
  const hit = CACHE.get(id);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  try {
    const { renderer, scene, cam } = context();
    const m = weaponMesh(id);
    const pale = new THREE.Color('#d4d8de');
    const saved: [THREE.MeshStandardMaterial, number, number, THREE.Color][] = [];
    m.traverse(o => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && 'metalness' in mat && !saved.some(s => s[0] === mat)) { saved.push([mat, mat.metalness, mat.roughness, mat.color.clone()]); mat.metalness = Math.min(mat.metalness, 0.25); mat.roughness = Math.max(mat.roughness, 0.4); mat.color.lerp(pale, 0.35); }
    });
    m.rotation.y = 0.5; // a little yaw reveals the far side
    m.updateMatrixWorld(true);
    scene.add(m);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    if (!isFinite(sz.x) || sz.length() < 1e-4) { scene.remove(m); return null; }
    const span = Math.max(sz.x, sz.z) * 1.1, aspect = W / H;
    let hw = span / 2, hh = hw / aspect;
    const need = sz.y * 0.62 + Math.max(sz.x, sz.z) * 0.14; if (hh < need) { hh = need; hw = hh * aspect; }
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.updateProjectionMatrix();
    cam.position.set(c.x - 4, c.y + 1.4, c.z - 1); cam.up.set(0, 1, 0); cam.lookAt(c);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(m);
    for (const [mat, me, ro, col] of saved) { mat.metalness = me; mat.roughness = ro; mat.color.copy(col); }
    CACHE.set(id, url);
    if (idle) clearTimeout(idle);
    idle = setTimeout(release, 4000);
    return url;
  } catch { return null; }
}
