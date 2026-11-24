import { it, expect } from 'vitest';
import * as THREE from 'three';
import { gpuOnlyAfterUpload } from './gpuOnly';

// Round 11: the static world kept ~690 MB of vertex arrays in the JS heap after upload (heap ~990 MB at start)
it('static meshes drop their CPU vertex arrays once uploaded; counts and bounds survive; instanced/skinned data stays', () => {
  const root = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 30, 30, 30), new THREE.MeshBasicMaterial()); root.add(box);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1, 30, 30, 30), new THREE.MeshBasicMaterial(), 4); root.add(inst);
  const pos = box.geometry.attributes.position as THREE.BufferAttribute, count = pos.count, idx = box.geometry.index!, icount = idx.count;
  expect(gpuOnlyAfterUpload(root)).toBeGreaterThan(0);
  expect(box.geometry.boundingSphere).not.toBeNull();
  pos.onUploadCallback(); idx.onUploadCallback(); // what WebGLAttributes does after the upload
  expect(pos.array.length).toBe(0); expect(pos.count).toBe(count); expect(idx.count).toBe(icount);
  expect(pos.array).toBeInstanceOf(Float32Array);
  inst.instanceMatrix.onUploadCallback(); expect(inst.instanceMatrix.array.length).toBe(16 * 4); // instance data is updated later: kept
});
