/** Rotating circular minimap drawn on a canvas, throttled to ~30 fps. */
import type { MinimapState } from './contracts';
import { clampToRadius, worldToMinimap } from './geometry';
import { CityPainter, drawBlip, drawPlayerArrow } from './mapdraw';
import { h } from './dom';

/** Metres from centre to rim at zoom 1. */
export const MINIMAP_VIEW_RADIUS = 135;

export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: MinimapState | null = null;
  private lastDraw = -1e9;
  private cssSize = 0;
  private dpr = 1;
  private tmp = { x: 0, y: 0 };
  private t0 = performance.now();
  private sizeDirty = true;

  constructor(private painter: CityPainter) {
    this.el = h('div', 'ma-minimap');
    this.canvas = h('canvas', 'ma-minimap-canvas');
    this.el.appendChild(this.canvas);
    this.el.appendChild(h('div', 'ma-minimap-rim'));
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    window.addEventListener('resize', () => { this.sizeDirty = true; });
  }

  update(s: MinimapState) {
    this.state = s;
    const now = performance.now();
    if (now - this.lastDraw < 32) return;
    this.lastDraw = now;
    this.draw((now - this.t0) / 1000);
  }

  private measure() {
    this.sizeDirty = false;
    const size = this.el.clientWidth;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (size === this.cssSize && dpr === this.dpr) return;
    this.cssSize = size; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(size * dpr));
    this.canvas.height = Math.max(1, Math.round(size * dpr));
  }

  private draw(t: number) {
    const s = this.state;
    if (!s) return;
    if (this.sizeDirty) this.measure();
    if (this.cssSize <= 0) { this.sizeDirty = true; return; }
    const ctx = this.ctx, S = this.cssSize, R = S / 2, dpr = this.dpr;
    const zoom = s.zoom > 0 ? s.zoom : 1;
    const scale = R / (MINIMAP_VIEW_RADIUS / zoom);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();

    // World layer
    ctx.save();
    ctx.translate(R, R); ctx.rotate(-s.heading); ctx.scale(scale, scale); ctx.translate(-s.x, -s.z);
    this.painter.paint(ctx, 'mini');
    if (s.heatRadius) {
      const hr = s.heatRadius;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(hr.x, hr.z, hr.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 96, 78, ${0.12 + pulse * 0.08})`; ctx.fill();
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = `rgba(120, 180, 255, ${0.45 + pulse * 0.35})`; ctx.stroke();
    }
    if (s.route && s.route.length > 1) {
      ctx.beginPath();
      ctx.moveTo(s.route[0].x, s.route[0].z);
      for (let i = 1; i < s.route.length; i++) ctx.lineTo(s.route[i].x, s.route[i].z);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 7 / scale; ctx.strokeStyle = 'rgba(8,24,27,0.75)'; ctx.stroke();
      ctx.lineWidth = 4 / scale; ctx.strokeStyle = '#ffc37e'; ctx.stroke();
    }
    ctx.restore();

    // Inner vignette
    const g = ctx.createRadialGradient(R, R, R * 0.55, R, R, R);
    g.addColorStop(0, 'rgba(10,30,34,0)'); g.addColorStop(1, 'rgba(10,30,34,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

    // Blips (upright, clamped to the rim)
    const br = Math.max(4.5, S * 0.032);
    const rim = R - br * 1.25;
    for (const b of s.blips) {
      const p = worldToMinimap(s.x, s.z, s.heading, scale, b.x, b.z, this.tmp);
      const clamped = clampToRadius(p, rim);
      if (clamped && b.kind === 'collectible') continue;
      if (clamped && (b.kind === 'enemy' || b.kind === 'police' || b.kind === 'vehicle')) ctx.globalAlpha = 0.7;
      drawBlip(ctx, b.kind, R + p.x, R + p.y, br, t, !!b.pulse, clamped);
      ctx.globalAlpha = 1;
    }
    drawPlayerArrow(ctx, R, R, Math.max(6, S * 0.042), 0);
    ctx.restore();

    // North marker on the rim
    const n = worldToMinimap(0, 0, s.heading, 1, 0, -1, this.tmp);
    const nx = R + n.x * (R - 9), ny = R + n.y * (R - 9);
    ctx.beginPath(); ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#12363a'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,195,126,0.9)'; ctx.stroke();
    ctx.fillStyle = '#ffc37e';
    ctx.font = '800 9px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }
}
