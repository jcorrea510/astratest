/* eslint-disable @typescript-eslint/no-explicit-any */
// Regression (27 Nov): the Round 16 garage halls drew their blade sign as two meshes, which (with the rest of that
// round) took a busy corner past the 450 draw-call budget. Each hall keeps to sign + blade + door.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { BAYS } from '../game/bays';

test('each garage hall adds at most three meshes (sign, two-sided blade, door)', async () => {
  const g: any = globalThis;
  const mkCtx = () => { const o: any = { getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}) };
  return new Proxy(o, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => { t[k] = v; return true; } }); };
  g.document ??= { createElement: () => ({ getContext: mkCtx, width: 256, height: 256, style: {} }) };
  g.OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return mkCtx(); } };
  const noop: any = new Proxy(() => noop, { get: () => noop, apply: () => noop });
  const { buildGarages } = await import('./garageBuild');
  const root = new THREE.Group();
  buildGarages({ root, physics: noop, trim: { at: () => noop } as any, curb: 0.15, nightUniform: { value: 0 } });
  let meshes = 0; root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
  expect(meshes).toBeLessThanOrEqual(BAYS.length * 3);
  expect(root.getObjectByName('garage-blade')).toBeTruthy();
});
