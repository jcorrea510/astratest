/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression (27 Nov): street furniture colliders (bike racks, benches) stood in front of shop doors, so walking
// straight at the door from the kerb stopped dead (e2e stores.spec "Harbor Liquor enterable" failed). Every shop's
// door lane must stay walkable with the real city colliders and the real player controller.
import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('../actors/human', () => {
  class Human { root = new THREE.Object3D(); busy = false; constructor() { return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : () => undefined) }); } }
  return { Human };
});
import { generateCity, CURB_HEIGHT } from './citymap';
import { STORES, nearStoreDoor } from '../game/places';

describe('shop doors', () => {
  test('nearStoreDoor covers the walk-up lane only', () => {
    generateCity();
    for (const s of STORES.slice(0, 5)) {
      const at = (lx: number, lz: number) => ({ x: s.x + lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw), z: s.z - lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw) });
      const lane = at(3.1, 7.5), inside = at(0, 0);
      expect(nearStoreDoor(lane.x, lane.z)).toBe(true);
      expect(nearStoreDoor(inside.x, inside.z)).toBe(false);
    }
  });

  test('every shop can be walked into head on from the kerb', { timeout: 300000 }, async () => {
    const g: any = globalThis;
  const mkCtx = () => { const o: any = { getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}) };
    return new Proxy(o, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => { t[k] = v; return true; } }); };
    g.document ??= { createElement: () => ({ getContext: mkCtx, width: 256, height: 256, style: {} }) };
    g.OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return mkCtx(); } };
    const { initPhysics, Physics } = await import('../core/physics');
    await initPhysics(); const ph: any = new Physics();
    const { buildCity } = await import('./citybuild');
    const scene = new THREE.Scene();
    buildCity(scene, ph, {} as any, generateCity());
    const { buildStoreShell, storeFrame } = await import('./interiors');
    const { Character } = await import('../actors/character');
    const { PlayerController } = await import('../game/player');
    const stuck: string[] = [];
    for (const def of STORES) {
      const sh: any = buildStoreShell(scene, ph, def, CURB_HEIGHT); sh.setDoor?.(1);
      const f = storeFrame(def, CURB_HEIGHT);
      const out = f.toWorld(3.1, 0.3, 8.9), inn = f.toWorld(3.1, 0.3, 0.5);
      const c: any = new Character(ph, null as any, null as any, 'player', out.x, out.z, out.y);
      const input: any = new Proxy({}, { get: (_t, k) => k === 'moveAxes' ? () => ({ x: 0, y: 1 }) : () => false });
      const cam: any = new Proxy({ yaw: 0 }, { get: (t: any, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
      const pc: any = new PlayerController(c, input, cam);
      let entered = false;
      for (let s = 0; s < 240 && !entered; s++) {
        ph.streamStatics(c.pos.x, c.pos.z);
        cam.yaw = Math.atan2(-(inn.x - c.pos.x), -(inn.z - c.pos.z));
        pc.fixedUpdate(1 / 60, { canAim: true, blocked: false });
        ph.world.step();
        const l = f.toLocal(c.pos);
        entered = Math.abs(l.x) < 5.2 && Math.abs(l.z) < 4.9;
      }
      if (!entered) stuck.push(def.name);
    }
    expect(stuck).toEqual([]);
  });
});
