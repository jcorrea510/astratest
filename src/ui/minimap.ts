/** Rotating rectangular radar drawn on a canvas, throttled to ~30 fps. */
import type { MinimapState } from './contracts';
import { clampToBox, worldToMinimap, TRUE_NORTH } from './geometry';
import { CityPainter, drawBlip, drawPlayerArrow } from './mapdraw';
import { h } from './dom';

/** Metres from the player to the top/bottom rim at zoom 1 (the radar is wider than it is tall). */
export const MINIMAP_VIEW_RADIUS = 135;
/** The player sits below centre so more of the road ahead is visible. */
const PLAYER_Y = 0.6;

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

  constructor(private painter: CityPainter) {
    this.el = h('div', 'ma-minimap');
    this.canvas = h('canvas', 'ma-minimap-canvas');
    this.el.appendChild(this.canvas);
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
    const w = this.el.clientWidth, hh = this.el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.cssW && hh === this.cssH && dpr === this.dpr) return;
    this.cssW = w; this.cssH = hh; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(hh * dpr));
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
    ctx.translate(cx, cy); ctx.rotate(-s.heading); ctx.scale(scale, scale); ctx.translate(-s.x, -s.z);
    this.painter.paint(ctx, 'mini');
    if (s.heatRadius) {
      const hr = s.heatRadius;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(hr.x, hr.z, hr.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 80, 70, ${0.14 + pulse * 0.1})`; ctx.fill();
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = `rgba(110, 175, 255, ${0.5 + pulse * 0.4})`; ctx.stroke();
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

    // Edge shading so blips on the rim read clearly
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(6,18,21,0.45)'); g.addColorStop(0.18, 'rgba(6,18,21,0)'); g.addColorStop(0.85, 'rgba(6,18,21,0)'); g.addColorStop(1, 'rgba(6,18,21,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Blips (upright, clamped to the frame)
    const br = Math.max(4.5, H * 0.042);
    const m = br * 1.25;
    const minX = -cx + m, maxX = W - cx - m, minY = -cy + m, maxY = H - cy - m;
    for (const b of s.blips) {
      const p = worldToMinimap(s.x, s.z, s.heading, scale, b.x, b.z, this.tmp);
      const clamped = clampToBox(p, minX, maxX, minY, maxY);
      if (clamped && b.kind === 'collectible') continue;
      if (clamped && (b.kind === 'enemy' || b.kind === 'police' || b.kind === 'vehicle')) ctx.globalAlpha = 0.7;
      drawBlip(ctx, b.kind, cx + p.x, cy + p.y, br, t, !!b.pulse, clamped);
      ctx.globalAlpha = 1;
    }
    drawPlayerArrow(ctx, cx, cy, Math.max(6.5, H * 0.06), 0);

    // North marker on the frame
    const n = worldToMinimap(0, 0, s.heading, 1, TRUE_NORTH.x, TRUE_NORTH.z, this.tmp);
    n.x *= 1e4; n.y *= 1e4;
    const nm = 10;
    clampToBox(n, -cx + nm, W - cx - nm, -cy + nm, H - cy - nm);
    const nx = cx + n.x, ny = cy + n.y;
    ctx.beginPath(); ctx.arc(nx, ny, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = '#081a1d'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffc37e'; ctx.stroke();
    ctx.fillStyle = '#fff3dc';
    ctx.font = '800 11px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }
}
