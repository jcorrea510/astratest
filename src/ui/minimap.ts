/** Rotating circular radar drawn on a canvas, redrawn at ~15 Hz (the static tone + vignette layer is cached). */
import type { MinimapState } from './contracts';
import { worldToMinimap, TRUE_NORTH } from './geometry';
/** Blip kinds that stay on the rim when off the minimap (Round 7: no more ring of shop icons). */
export const RIM_KINDS: ReadonlySet<string> = new Set(['waypoint', 'mission', 'target', 'checkpoint', 'enemy', 'police']);
import { CityPainter, drawBlip, drawPlayerArrow } from './mapdraw';
import { pageA11y } from './blipStyle';
import { h } from './dom';

/** Metres from the player to the top/bottom rim at zoom 1 (the radar is wider than it is tall). */
export const MINIMAP_VIEW_RADIUS = 135;
/** The radar is a circle: the player sits at its centre. */
const PLAYER_Y = 0.5;
/** Vertical squash of the radar: a tilted, 3D-style look consistent with the full map. */
const PITCH = 0.8;

/** Radar redraw interval (ms). */
export const MINIMAP_INTERVAL_MS = 66;
/** True when a throttled redraw is due; pure so it can be unit-tested. */
export function minimapDue(now: number, last: number, interval = MINIMAP_INTERVAL_MS): boolean { return now - last >= interval; }

export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: MinimapState | null = null;
  private lastDraw = -1e9;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private tmp = { x: 0, y: 0 };
  private t0 = performance.now();
  private sizeDirty = true;
  /** tone + vignette pre-rendered once per size (was a gradient + two fillRects every draw) */
  private overlay: HTMLCanvasElement | null = null;

  constructor(private painter: CityPainter) {
    this.el = h('div', 'ma-minimap');
    this.canvas = h('canvas', 'ma-minimap-canvas');
    this.el.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    window.addEventListener('resize', () => { this.sizeDirty = true; });
  }

  /** Whether update() would redraw now; callers skip building the state when false. */
  due(): boolean { return minimapDue(performance.now(), this.lastDraw); }

  update(s: MinimapState) {
    this.state = s;
    const now = performance.now();
    if (!minimapDue(now, this.lastDraw)) return;
    this.lastDraw = now;
    this.draw((now - this.t0) / 1000);
  }

  private measure() {
    this.sizeDirty = false;
    const w = this.el.clientWidth, hh = this.el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.cssW && hh === this.cssH && dpr === this.dpr) return;
    this.cssW = w; this.cssH = hh; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(hh * dpr));
    this.overlay = null;
  }

  private draw(t: number) {
    const s = this.state;
    if (!s) return;
    if (this.sizeDirty) this.measure();
    if (this.cssW <= 0 || this.cssH <= 0) { this.sizeDirty = true; return; }
    const ctx = this.ctx, W = this.cssW, H = this.cssH, dpr = this.dpr;
    const cx = W / 2, cy = H * PLAYER_Y;
    const zoom = s.zoom > 0 ? s.zoom : 1;
    const scale = (H / 2) / (MINIMAP_VIEW_RADIUS / zoom);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // World layer
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, PITCH); ctx.rotate(-s.heading); ctx.scale(scale, scale); ctx.translate(-s.x, -s.z);
    const bk = this.painter.minimapBake();
    if (bk) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low'; ctx.drawImage(bk.canvas, bk.x0, bk.z0, bk.canvas.width / bk.k, bk.canvas.height / bk.k); }
    if (s.heatRadius) {
      const hr = s.heatRadius;
      const pa = pageA11y();
      const pulse = pa.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(hr.x, hr.z, hr.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 80, 70, ${0.14 + pulse * 0.1})`; ctx.fill();
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = `rgba(110, 175, 255, ${0.5 + pulse * 0.4})`;
      if (pa.mode !== 'off') ctx.setLineDash([6 / scale, 4 / scale]); // pattern, not just colour
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (s.route && s.route.length > 1) {
      ctx.beginPath();
      ctx.moveTo(s.route[0].x, s.route[0].z);
      for (let i = 1; i < s.route.length; i++) ctx.lineTo(s.route[i].x, s.route[i].z);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 8 / scale; ctx.strokeStyle = 'rgba(6,18,21,0.85)'; ctx.stroke();
      ctx.lineWidth = 4.5 / scale; ctx.strokeStyle = '#ffc37e'; ctx.stroke();
    }
    ctx.restore();

    const rad = Math.min(W, H) / 2;
    if (!this.overlay) {
      // tone the bake down so glyphs pop + soft vignette toward the rim (blips and the north marker stay legible)
      const o = document.createElement('canvas');
      o.width = this.canvas.width; o.height = this.canvas.height;
      const oc = o.getContext('2d');
      if (oc) {
        oc.setTransform(dpr, 0, 0, dpr, 0, 0);
        oc.fillStyle = 'rgba(4,7,11,0.22)'; oc.fillRect(0, 0, W, H);
        const g = oc.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
        g.addColorStop(0, 'rgba(4,7,11,0)'); g.addColorStop(1, 'rgba(4,7,11,0.62)');
        oc.fillStyle = g; oc.fillRect(0, 0, W, H);
      }
      this.overlay = o;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.overlay, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Blips (upright, clamped to the circular frame)
    const br = Math.max(4.5, H * 0.045);
    const lim = rad - br * 1.35;
    for (const b of s.blips) {
      const p = worldToMinimap(s.x, s.z, s.heading, scale, b.x, b.z, this.tmp);
      p.y *= PITCH;
      const d = Math.hypot(p.x, p.y);
      const clamped = d > lim;
      // Only things that matter right now stay pinned to the rim; shops, stores, garages etc. show only when on the map
      if (clamped && !RIM_KINDS.has(b.kind)) continue;
      if (clamped) { p.x *= lim / d; p.y *= lim / d; }
      if (clamped && (b.kind === 'enemy' || b.kind === 'police' || b.kind === 'vehicle')) ctx.globalAlpha = 0.7;
      drawBlip(ctx, b.kind, cx + p.x, cy + p.y, br, t, !!b.pulse, clamped);
      ctx.globalAlpha = 1;
    }
    drawPlayerArrow(ctx, cx, cy, Math.max(6.5, H * 0.06), 0);

    // North marker on the rim: a small notch with an N
    const n = worldToMinimap(0, 0, s.heading, 1, TRUE_NORTH.x, TRUE_NORTH.z, this.tmp);
    const nl = Math.hypot(n.x, n.y * PITCH) || 1;
    const nr = rad - 9;
    const nx = cx + (n.x / nl) * nr, ny = cy + ((n.y * PITCH) / nl) * nr;
    ctx.beginPath(); ctx.arc(nx, ny, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,10,14,0.88)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
    ctx.fillStyle = '#ff6b5e';
    ctx.font = '800 10px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }
}
