/**
 * Real rear-view / side-mirror reflections for the cockpit: ONE low-resolution render target filled by a rear-facing camera that sits
 * at the interior mirror and sees only layer 0 (road, scenery, traffic - not the cockpit or the player's own shell, which live on
 * layer 1). The three mirrors are plain planes that sample different UV crops of that single texture, so the cost is one extra
 * small scene pass every 2nd / 3rd frame (and no side-mirror pass on low quality).
 */
import * as THREE from 'three';

export type MirrorQuality = 'low' | 'medium' | 'high';
export const MIRROR_W = 256, MIRROR_H = 96;
/** Render the reflection every Nth frame: every 2nd on high, every 3rd otherwise. */
export const mirrorEvery = (q: MirrorQuality): number => (q === 'high' ? 2 : 3);
export const mirrorDue = (frame: number, every: number): boolean => frame % Math.max(1, every) === 0;
/** Side mirrors get a live reflection on medium and high only. */
export const sideMirrorsLive = (q: MirrorQuality): boolean => q !== 'low';

/** UV crop windows (u0, u1, v0, v1) inside the rear camera image (cropUv flips them the way a mirror does): whole-frame width is ~75 degrees, 32 degrees tall. */
export const CROP = {
  rear: [0.2, 0.8, 0.29, 0.71] as const,
  left: [0.68, 1.0, 0.22, 0.78] as const,   // the car's left is the right edge of a camera that looks backward
  right: [0.0, 0.32, 0.22, 0.78] as const,
};

/** Rewrites a plane's UVs to show `crop` of the mirror texture, flipped left-right the way a mirror shows it. */
export function cropUv(geo: THREE.BufferGeometry, crop: readonly [number, number, number, number]): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const x = uv.getX(i), y = uv.getY(i);
    uv.setXY(i, crop[1] + (crop[0] - crop[1]) * x, crop[2] + (crop[3] - crop[2]) * y);
  }
  uv.needsUpdate = true;
}

export class MirrorRT {
  readonly rt: THREE.WebGLRenderTarget;
  readonly cam = new THREE.PerspectiveCamera(32, MIRROR_W / MIRROR_H, 0.35, 1300);
  frame = 0;
  /** number of reflection passes actually rendered (tests read this) */
  renders = 0;
  constructor(public quality: MirrorQuality) {
    this.rt = new THREE.WebGLRenderTarget(MIRROR_W, MIRROR_H, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.cam.layers.set(0);
    this.cam.rotation.order = 'YXZ';
  }
  get texture(): THREE.Texture { return this.rt.texture; }
  /** Called once per frame before the main pass; renders only when due. Returns true when it drew. */
  tick(renderer: THREE.WebGLRenderer, scene: THREE.Scene): boolean {
    const due = mirrorDue(this.frame++, mirrorEvery(this.quality));
    if (!due) return false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.cam);
    renderer.setRenderTarget(prev);
    this.renders++;
    return true;
  }
  dispose(): void { this.rt.dispose(); }
}
