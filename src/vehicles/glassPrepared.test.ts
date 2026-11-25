import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../core/physics';
import { Vehicle } from './vehicle';

let phys: Physics;
beforeAll(async () => { await initPhysics(); phys = new Physics(); });

describe('prepared glass queries (aim trace perf)', () => {
  it('finds the windshield at its centre, nothing far away, and matches glassAt on a grid', () => {
    const v = new Vehicle(phys, 'sedan', null, 0, 1, 0, 0);
    v.group.updateMatrixWorld(true);
    const ws = v.panes.find(p => p.name === 'windshield')!;
    const tp = v.tpl.panes.find(p => p.id === ws.id)!;
    const c = new THREE.Vector3();
    for (let i = 0; i < tp.tris.length; i += 3) { c.x += tp.tris[i]; c.y += tp.tris[i + 1]; c.z += tp.tris[i + 2]; }
    c.multiplyScalar(3 / tp.tris.length);
    const world = c.clone().applyMatrix4(v.visual.matrixWorld);
    v.glassPrepare();
    expect(v.glassAtPrepared(world, 0.3)).toBe(ws.id);
    expect(v.glassAtPrepared(new THREE.Vector3(50, 5, 50), 0.3)).toBeNull();
    let hits = 0;
    const p = new THREE.Vector3();
    for (let x = -1.2; x <= 1.2; x += 0.3) for (let y = 0.2; y <= 2.2; y += 0.3) for (let z = -2.5; z <= 2.5; z += 0.3) {
      p.set(x, y, z);
      const a = v.glassAtPrepared(p, 0.4), b = v.glassAt(p, 0.4);
      expect(a).toBe(b);
      if (a !== null) hits++;
    }
    expect(hits).toBeGreaterThan(0);
    v.breakGlass(ws.id); v.glassPrepare();
    expect(v.glassAtPrepared(world, 0.05)).not.toBe(ws.id);
    expect(v.glassAtPrepared(world, 0.05, true)).toBe(ws.id);
  }, 30_000);
});
