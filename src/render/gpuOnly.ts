/**
 * Round 11 (memory): static world geometry keeps its vertex arrays in JavaScript after the GPU has them. The city and the
 * store interiors held ~690 MB that way (the JS heap stood at ~990 MB at start; iPad Safari kills a tab near 1.4 GB, and a
 * big heap means long GC pauses). After its first upload each big attribute of a static mesh drops its CPU copy.
 *
 * Only for geometry nothing reads or rewrites after building (no raycasts against it, no vertex edits): bounding volumes
 * are computed first (culling keeps working), draw counts live in attribute.count, and instance matrices / colours (which
 * do get updated) are left alone. Skinned meshes are skipped.
 */
import * as THREE from 'three';

const MIN_BYTES = 4096;
function drop(this: THREE.BufferAttribute) {
  const C = this.array.constructor as { new (n: number): THREE.TypedArray };
  this.array = new C(0);
}
/** Marks every static mesh under `root` to free its CPU vertex arrays once uploaded. Returns the bytes that will be freed. */
export function gpuOnlyAfterUpload(root: THREE.Object3D): number {
  const done = new Set<THREE.BufferGeometry>(); let bytes = 0;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.geometry || done.has(m.geometry)) return;
    const g = m.geometry; done.add(g);
    if (g.userData.keepCpu) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    const attrs: THREE.BufferAttribute[] = [];
    for (const k in g.attributes) attrs.push(g.attributes[k] as THREE.BufferAttribute);
    if (g.index) attrs.push(g.index);
    for (const a of attrs) {
      if (!a || (a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) continue;
      if (!a.array || a.array.byteLength < MIN_BYTES || a.onUploadCallback === drop) continue;
      bytes += a.array.byteLength; a.onUpload(drop);
    }
  });
  return bytes;
}
