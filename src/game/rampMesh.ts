/**
 * Stunt ramp meshes. Every ramp is a wedge with a deck, an amber lip and rails, and two beacon posts: nine meshes each,
 * ninety for the ten ramps, which took a busy corner past the 450 draw-call budget (27 Nov). All ramps are merged into one
 * mesh per material (four draw calls for the whole city).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { flatCopy } from '../core/geom';

export interface RampDef { x: number; z: number; yaw: number; w: number; len: number; h: number }

export function rampMeshes(ramps: readonly RampDef[], groundY: (x: number, z: number) => number): THREE.Mesh[] {
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#5b6067', roughness: 0.82, metalness: 0.12 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#272b30', roughness: 0.72, metalness: 0.08 });
  const amberMat = new THREE.MeshStandardMaterial({ color: '#f5a855', roughness: 0.42, metalness: 0.25 });
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#ffcf78', emissive: new THREE.Color('#ff9d3b'), emissiveIntensity: 1.6, roughness: 0.25 });
  const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 1.45, 8);
  const bulbGeo = new THREE.SphereGeometry(0.18, 10, 8);
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>([[concreteMat, []], [deckMat, []], [amberMat, []], [beaconMat, []]]);
  for (const r of ramps) {
    const w = r.w;
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(r.len, 0); shape.lineTo(r.len, r.h); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }); geo.translate(-r.len / 2, 0, -w / 2); geo.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, concreteMat);
    m.position.set(r.x, groundY(r.x, r.z), r.z); m.rotation.y = r.yaw;
    const ang = Math.atan2(r.h, r.len), hyp = Math.hypot(r.len, r.h);
    // dark asphalt launch surface, high-contrast amber lip and side rails, twin glowing beacon posts at the entry
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w - 0.26, 0.06, hyp), deckMat);
    deck.position.set(0, r.h / 2 + 0.02, 0); deck.rotation.x = -ang; m.add(deck);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.08, 0.36), amberMat);
    edge.position.set(0, r.h + 0.03, r.len / 2 - 0.16); m.add(edge);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, hyp), amberMat);
      rail.position.set(sx * (w / 2 - 0.08), r.h / 2 + 0.08, 0); rail.rotation.x = -ang; m.add(rail);
      const post = new THREE.Mesh(postGeo, deckMat);
      post.position.set(sx * (w / 2 + 0.48), 0.72, -r.len / 2 + 0.25); m.add(post);
      const bulb = new THREE.Mesh(bulbGeo, beaconMat);
      bulb.position.set(sx * (w / 2 + 0.48), 1.54, -r.len / 2 + 0.25); m.add(bulb);
    }
    m.updateMatrixWorld(true);
    m.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const g = flatCopy(mesh.geometry); g.clearGroups(); g.applyMatrix4(mesh.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      parts.get(mesh.material as THREE.Material)!.push(g);
    });
  }
  const out: THREE.Mesh[] = [];
  for (const [mat, list] of parts) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false); if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat); mesh.name = 'stuntRamps';
    mesh.castShadow = mat === concreteMat; mesh.receiveShadow = mat === concreteMat || mat === deckMat;
    out.push(mesh);
  }
  return out;
}
