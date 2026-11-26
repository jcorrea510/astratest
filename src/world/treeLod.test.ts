import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { treeGeos, treeFarGeos, treeLodNear, treeCastsShadow, TreeLodField, TREE_LOD_NEAR, TREE_LOD_HYST } from './props';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe('tree LOD (R14 W2b)', () => {
  it('far tree is a small fraction of the near tree', () => {
    const n = treeGeos(100), f = treeFarGeos(150);
    expect(tris(f.trunk) + tris(f.leaves)).toBeLessThanOrEqual(80);
    expect(tris(f.leaves)).toBeLessThan(tris(n.leaves) * 0.2);
    expect(tris(n.trunk) + tris(n.leaves)).toBeLessThanOrEqual(600);
  });
  it('LOD choice has hysteresis', () => {
    expect(treeLodNear(TREE_LOD_NEAR - TREE_LOD_HYST - 1, false)).toBe(true);
    expect(treeLodNear(TREE_LOD_NEAR, false)).toBe(false);
    expect(treeLodNear(TREE_LOD_NEAR, true)).toBe(true);
    expect(treeLodNear(TREE_LOD_NEAR + TREE_LOD_HYST + 1, true)).toBe(false);
  });
  it('only trees inside the shadow range cast', () => {
    expect(treeCastsShadow(30, 90)).toBe(true); expect(treeCastsShadow(120, 90)).toBe(false);
  });
  it('field swaps near/far meshes per cell and drops shadows out of range', () => {
    const mat = new THREE.MeshBasicMaterial();
    const f = new TreeLodField([treeGeos(100)], treeFarGeos(150), mat, mat);
    f.add(0, 10, 0, 10, 0, 1); f.add(0, 500, 0, 10, 0, 1);
    const root = new THREE.Group(); const ms = f.build(root);
    expect(ms.length).toBe(8); // 2 cells x (trunk, leaf, far trunk, far leaf)
    f.update(10, 30, 10, 30, 140, 90);
    const pick = (cell: string, far: boolean) => ms.filter(m => m.name.endsWith(cell) && (m.name.startsWith('f') === far));
    expect(pick('@0,0', false).every(m => m.visible && m.castShadow)).toBe(true);
    expect(pick('@0,0', true).every(m => !m.visible)).toBe(true);
    expect(ms.filter(m => m.name.endsWith('@12,0')).every(m => !m.visible && !m.castShadow)).toBe(true);
    f.update(10, 100, 10, 100, 140, 90); // ~70 m away: far LOD, within reach
    expect(pick('@0,0', false).every(m => !m.visible)).toBe(true);
    expect(pick('@0,0', true).every(m => m.visible)).toBe(true);
  });
});
