/** Round 14 (R1): pure render-performance policy: device classes, pixel-ratio budget, adaptive resolution, shadow cadence, GPU timer. */

export type DeviceClass = 'ipad' | 'iphone' | 'apple-mac' | 'other';
export interface DeviceInfo { ua: string; platform: string; maxTouchPoints: number; cores: number; memory?: number; dpr: number }
/** iPadOS 13+ reports as a Mac with touch; Safari hides the chip, so a Retina Mac with 8+ cores is treated as Apple Silicon. */
export function classifyDevice(d: DeviceInfo): DeviceClass {
  if (/iPhone|iPod/.test(d.ua)) return 'iphone';
  if (/iPad/.test(d.ua) || (/Mac/.test(d.platform || d.ua) && d.maxTouchPoints > 1)) return 'ipad';
  if (/Mac/.test(d.platform || d.ua) && d.dpr >= 2 && d.cores >= 8) return 'apple-mac';
  return 'other';
}
/** Default preset: M-series iPads (Safari may report only 4 cores / no memory there) and Apple Silicon Macs get Medium; weak or small devices Low. */
export function defaultQualityFor(d: DeviceInfo): 'low' | 'medium' {
  const k = classifyDevice(d);
  if (k === 'ipad' || k === 'apple-mac') return 'medium';
  if (k === 'iphone') return 'low';
  if ((d.memory ?? 8) <= 4 || d.cores <= 4) return 'low';
  return 'medium';
}
/**
 * Final render pixel ratio: the preset cap (never above the screen's DPR), the user's resolution scale and the adaptive scale,
 * limited so the frame stays within a pixel budget (a 2880x1620 Retina frame costs 2x a 1080p one).
 */
export function pixelRatioFor(cssW: number, cssH: number, dpr: number, cap: number, budgetPx: number, userScale: number, dynScale: number, minRatio = 0.7): number {
  const base = Math.min(dpr || 1, cap) * userScale;
  const fit = Math.sqrt(budgetPx / Math.max(1, cssW * cssH));
  const top = Math.min(base, Math.max(fit, minRatio));
  return Math.max(top * dynScale, Math.min(minRatio, top));
}

/** Adaptive-resolution state. ema = frame interval (ms); gpu = GPU frame time (ms, 0 when unknown). */
export interface DynState { ema: number; gpu: number; scale: number; slowT: number; fastT: number; lastResize: number; ceil: number; ceilUntil: number; lastUp: number }
export const newDyn = (): DynState => ({ ema: 16.7, gpu: 0, scale: 1, slowT: 0, fastT: 0, lastResize: -1e9, ceil: 1, ceilUntil: 0, lastUp: -1e9 });
export const DYN_MIN = 0.55; export const TARGET_MS = 16.7;
/**
 * One frame of adaptive resolution (aims at 60 fps). Returns true when the pixel ratio must be re-applied. Reacts after ~1 s
 * of sustained slowness (a step sized from the overshoot, so ~2 steps reach the target); a single hitch is clipped. After a
 * resize nothing changes for 2 s (the reallocation stall must not feed back). Going up needs sustained headroom, a
 * predicted cost (area ~ scale^2) inside the budget, and respects a ceiling set when an earlier up-step failed (no ping-pong).
 * With a GPU timer (gpuMs > 0) only GPU-bound slowness lowers resolution; CPU-bound frames leave it alone.
 */
export function adaptStep(s: DynState, dt: number, now: number, adaptive: boolean, gpuMs = 0): boolean {
  if (dt <= 0 || dt > 250) return false; // first frame / tab was hidden
  s.ema += (Math.min(dt, 50) - s.ema) * 0.1;
  if (gpuMs > 0) s.gpu = s.gpu > 0 ? s.gpu + (Math.min(gpuMs, 50) - s.gpu) * 0.1 : gpuMs;
  if (!adaptive) return false;
  if (now - s.lastResize < 2000) { s.slowT = 0; s.fastT = 0; return false; }
  const haveGpu = s.gpu > 0;
  const cost = haveGpu ? s.gpu : s.ema; // what resolution can influence
  const slow = haveGpu ? s.gpu > 14.5 && s.ema > TARGET_MS * 1.08 : s.ema > TARGET_MS * 1.12;
  const next = Math.min(s.ceilUntil > now ? s.ceil : 1, +(s.scale + 0.1).toFixed(2));
  const predicted = cost * (next / s.scale) ** 2; // cost after the step up
  const headroom = s.scale < 1 && next > s.scale && predicted < (haveGpu ? 13 : TARGET_MS * 0.95) && s.ema < TARGET_MS * 1.1;
  if (slow) { s.slowT += dt; s.fastT = 0; } else if (headroom) { s.fastT += dt; s.slowT = 0; } else { s.slowT = 0; s.fastT = 0; }
  if (s.slowT > 1000 && s.scale > DYN_MIN) {
    const k = Math.min(0.9, Math.max(0.75, Math.sqrt((haveGpu ? 14 : TARGET_MS) / Math.max(1, cost)))); // area ~ scale^2
    const before = s.scale;
    s.scale = Math.max(DYN_MIN, +(s.scale * k).toFixed(2));
    if (now - s.lastUp < 20000) { s.ceil = before; s.ceilUntil = now + 60000; } // the last step up did not hold: stay below it for a minute
    s.slowT = 0; s.lastResize = now; return true;
  }
  if (s.fastT > 5000) { s.scale = next; s.fastT = 0; s.lastResize = now; s.lastUp = now; return true; }
  return false;
}

/** Shadow map redraw cadence: `every` frames while the light frame moves, twice as sparse (max every 4) when the camera is still. */
export function shadowRedrawDue(frameNo: number, every: number, moved: boolean): boolean {
  const n = Math.max(1, every), step = moved ? n : Math.min(4, n * 2);
  return frameNo % step === 0;
}
/** Cheap caster cull rule (renderers/world can call it per object): beyond the shadow range, or tiny relative to distance, casts nothing visible. */
export function shadowCasterWanted(radius: number, dist: number, range: number): boolean {
  if (dist - radius > range * 1.25) return false;
  return radius >= dist * 0.012 || dist < range * 0.35;
}

/** GPU frame timer (EXT_disjoint_timer_query_webgl2); `ms` is 0 when unavailable. Results arrive a few frames late. */
export class GpuTimer {
  ms = 0; private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null; private q: WebGLQuery[] = []; private active: WebGLQuery | null = null; private gl: WebGL2RenderingContext | null = null;
  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) { this.gl = gl; this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
  }
  get available() { return !!this.ext; }
  begin() {
    const gl = this.gl, e = this.ext; if (!gl || !e || this.active || this.q.length > 4) return;
    const q = gl.createQuery(); if (!q) return; gl.beginQuery(e.TIME_ELAPSED_EXT, q); this.active = q;
  }
  end() {
    const gl = this.gl, e = this.ext; if (!gl || !e || !this.active) return;
    gl.endQuery(e.TIME_ELAPSED_EXT); this.q.push(this.active); this.active = null;
    const head = this.q[0];
    if (head && gl.getQueryParameter(head, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(e.GPU_DISJOINT_EXT)) this.ms = Number(gl.getQueryParameter(head, gl.QUERY_RESULT)) / 1e6;
      gl.deleteQuery(head); this.q.shift();
    }
  }
}
