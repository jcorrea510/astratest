import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTerrain, TERRAIN } from '../world/terrain';
import { skipHiddenMatrices } from './renderer';
import { AO_DEFAULT, AO_FRAG } from './post';
import { assignLights, LightPool } from './lightPool';
import { skyTopUniform, skyHorizonUniform, sunDirUniform, sunColUniform } from './materials';
import { initPhysics, Physics } from '../core/physics';

describe('graphics and performance upgrades', () => {
  it('splits terrain into 32 frozen, culled spatial tiles covering the full footprint', async () => {
    await initPhysics();
    const physics = new Physics();
    const root = new THREE.Group();
    const chunks: THREE.Object3D[] = [];
    const mat = new THREE.MeshStandardMaterial();
    const group = buildTerrain(root, physics, (x, z) => Math.sin(x * 0.01) * 4 + Math.cos(z * 0.01) * 3, mat, chunks);

    expect(group.name).toBe('terrain');
    expect(group.children.length).toBe(32);
    expect(chunks.length).toBe(32);
    expect(group.matrixAutoUpdate).toBe(false);
    expect(group.matrixWorldAutoUpdate).toBe(false);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const obj of chunks) {
      const mesh = obj as THREE.Mesh;
      expect(mesh.matrixAutoUpdate).toBe(false);
      expect(mesh.matrixWorldAutoUpdate).toBe(false);
      expect(mesh.userData.farScale).toBeGreaterThanOrEqual(2);
      const bb = mesh.geometry.boundingBox!;
      expect(bb).toBeTruthy();
      expect(mesh.geometry.boundingSphere).toBeTruthy();
      // Each tile is a small slice, far narrower than the entire terrain
      expect(bb.max.x - bb.min.x).toBeLessThan((TERRAIN.x1 - TERRAIN.x0) * 0.25);
      expect(bb.max.z - bb.min.z).toBeLessThan((TERRAIN.z1 - TERRAIN.z0) * 0.4);
      minX = Math.min(minX, bb.min.x);
      maxX = Math.max(maxX, bb.max.x);
      minZ = Math.min(minZ, bb.min.z);
      maxZ = Math.max(maxZ, bb.max.z);
    }
    expect(minX).toBe(TERRAIN.x0);
    expect(maxX).toBe(TERRAIN.x1);
    expect(minZ).toBe(TERRAIN.z0);
    expect(maxZ).toBe(TERRAIN.z1);
  });

  it('skipHiddenMatrices skips frozen static children and hidden dynamic children while updating visible ones', () => {
    const parent = new THREE.Group();
    const root = new THREE.Group();
    parent.add(root);
    skipHiddenMatrices(root);

    let frozenCalls = 0, hiddenCalls = 0, visibleCalls = 0;
    const frozen = new THREE.Object3D();
    frozen.matrixAutoUpdate = false;
    frozen.matrixWorldAutoUpdate = false;
    frozen.updateMatrixWorld = () => { frozenCalls++; };

    const hidden = new THREE.Object3D();
    hidden.visible = false;
    hidden.updateMatrixWorld = () => { hiddenCalls++; };

    const vis = new THREE.Object3D();
    vis.visible = true;
    vis.updateMatrixWorld = () => { visibleCalls++; };

    root.add(frozen, hidden, vis);
    root.updateMatrix();
    root.matrixAutoUpdate = false;
    root.matrixWorldNeedsUpdate = false;
    root.updateMatrixWorld(false);

    expect(frozenCalls).toBe(0);
    expect(hiddenCalls).toBe(0);
    expect(visibleCalls).toBe(1);
    expect(hidden.matrixWorldNeedsUpdate).toBe(true);
  });

  it('calibrates SSAO with range attenuation to avoid dark character foot halos', () => {
    expect(AO_DEFAULT.radius).toBeLessThanOrEqual(1.1);
    expect(AO_DEFAULT.intensity).toBeLessThanOrEqual(1.5);
    expect(AO_FRAG).toContain('rangeW');
    expect(AO_FRAG).toContain('0.085');
  });

  it('exports live sky/sun uniforms and LightPool matches assignLights without allocations', () => {
    for (const u of [skyTopUniform, skyHorizonUniform, sunColUniform]) {
      expect(u.value).toBeInstanceOf(THREE.Color);
      expect(Number.isFinite(u.value.r)).toBe(true);
    }
    expect(sunDirUniform.value).toBeInstanceOf(THREE.Vector3);
    expect(Number.isFinite(sunDirUniform.value.x)).toBe(true);
    const scene = new THREE.Scene();
    const pool = new LightPool(scene);
    pool.setCount(2);
    const l0 = new THREE.PointLight(0xffffff, 20, 20); l0.position.set(2, 1, 0);
    const l1 = new THREE.PointLight(0xffffff, 20, 20); l1.position.set(10, 1, 0);
    const l2 = new THREE.PointLight(0xffffff, 20, 20); l2.position.set(4, 1, 0);
    pool.add(l0); pool.add(l1); pool.add(l2);
    pool.update(new THREE.Vector3(0, 1, 0));
    expect(pool.real.filter(l => l.intensity > 0).length).toBe(2);
    expect(assignLights([10, 1, 5], [-1, -1])).toEqual([0, 2]);
  });
});
