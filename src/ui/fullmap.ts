/** Full-screen city map: pan (drag / arrows / stick), zoom (wheel / +-), click or Enter to set a waypoint. */
import { AVENUE_NAMES, STREET_NAMES, districtAt, DISTRICT_INFO, type CityMap } from '../world/citymap';
import type { MinimapBlip, MinimapState } from './contracts';
import { mapScreenToWorld, mapWorldToScreen, type MapView } from './geometry';
import { BLIP_KINDS, BLIP_LABELS } from './icons';
import { CityPainter, drawBlip, drawPlayerArrow, nearestStreets } from './mapdraw';
import { h, backButton } from './dom';
import { fmtDistance } from '../core/units';

export class FullMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLDivElement;
  private readout: HTMLDivElement;
  private state: MinimapState | null = null;
  private view: MapView = { cx: 0, cz: 0, scale: 1, w: 1, h: 1 };
  private fitScale = 1;
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private open = false;
  private drag: { id: number; x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private cursor: { x: number; y: number } | null = null;
  private keyboardCursor = false;
  private localWaypoint: { x: number; z: number } | null = null;
  private t0 = performance.now();
  private legendCanvases: { kind: MinimapBlip['kind']; c: HTMLCanvasElement; row: HTMLElement }[] = [];

  constructor(private city: CityMap, private painter: CityPainter, private onWaypoint: (x: number, z: number) => void, private onClose: () => void, private sound: (k: 'click' | 'hover' | 'back') => void) {
    this.el = h('div', 'ma-layer ma-map');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'City map');
    const head = h('div', 'ma-map-head');
    const titles = h('div', 'ma-map-titles');
    titles.appendChild(h('div', 'ma-map-title', 'City map'));
    head.appendChild(titles);
    this.readout = h('div', 'ma-map-readout');
    head.appendChild(this.readout);
    head.appendChild(backButton(() => { this.sound('back'); this.onClose(); }));
    this.el.appendChild(head);

    const body = h('div', 'ma-map-body');
    this.stage = h('div', 'ma-map-stage');
    this.canvas = h('canvas', 'ma-map-canvas');
    this.canvas.tabIndex = -1;
    this.stage.appendChild(this.canvas);
    body.appendChild(this.stage);
    const legend = h('div', 'ma-map-legend');
    legend.appendChild(h('div', 'ma-label', 'Legend'));
    const list = h('div', 'ma-legend-list');
    for (const kind of BLIP_KINDS) {
      const row = h('div', 'ma-legend-row');
      const c = h('canvas', 'ma-legend-icon');
      c.width = 44; c.height = 44;
      row.appendChild(c);
      row.appendChild(h('span', '', BLIP_LABELS[kind]));
      list.appendChild(row);
      this.legendCanvases.push({ kind, c, row });
    }
    legend.appendChild(list);
    const districts = h('div', 'ma-legend-districts');
    districts.appendChild(h('div', 'ma-label', 'Districts'));
    for (const d of Object.values(DISTRICT_INFO)) {
      const row = h('div', 'ma-legend-row');
      const sw = h('span', 'ma-swatch');
      sw.style.background = d.color;
      row.appendChild(sw); row.appendChild(h('span', '', d.name));
      districts.appendChild(row);
    }
    legend.appendChild(districts);
    body.appendChild(legend);
    this.el.appendChild(body);

    const foot = h('div', 'ma-map-foot');
    for (const [k, t] of [['Click', 'Set waypoint'], ['Drag', 'Pan'], ['Wheel', 'Zoom'], ['Arrows', 'Pan'], ['Enter', 'Waypoint at centre'], ['Esc', 'Close']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      foot.appendChild(s);
    }
    this.el.appendChild(foot);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;

    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
    });
    this.canvas.addEventListener('pointermove', e => {
      const r = this.canvas.getBoundingClientRect();
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.keyboardCursor = false;
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
        if (this.drag.moved) { this.view.cx = this.drag.cx - dx / this.view.scale; this.view.cz = this.drag.cz - dy / this.view.scale; this.clampView(); }
      }
      this.dirty = true;
    });
    this.canvas.addEventListener('pointerup', e => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (!moved) {
        const r = this.canvas.getBoundingClientRect();
        const w = mapScreenToWorld(this.view, e.clientX - r.left, e.clientY - r.top);
        this.setWaypoint(w.x, w.z);
      }
    });
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('pointerleave', () => { this.cursor = null; this.dirty = true; });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.open) this.resize(false); });
  }

  private setWaypoint(x: number, z: number) {
    const b = this.painter.bounds;
    x = Math.min(b.maxX, Math.max(b.minX, x)); z = Math.min(b.maxZ, Math.max(b.minZ, z));
    this.localWaypoint = { x, z };
    this.sound('click');
    this.onWaypoint(x, z);
    this.dirty = true;
  }

  show(s: MinimapState) {
    this.state = s;
    this.open = true;
    this.el.classList.add('is-open');
    this.localWaypoint = s.blips.find(b => b.kind === 'waypoint') ?? null;
    this.resize(true);
    const present = new Set(s.blips.map(b => b.kind));
    for (const l of this.legendCanvases) {
      const ctx = l.c.getContext('2d');
      if (ctx) { ctx.clearRect(0, 0, 44, 44); drawBlip(ctx, l.kind, 22, l.kind === 'waypoint' ? 26 : 22, 11, 0); }
      l.row.classList.toggle('is-present', present.has(l.kind));
    }
    cancelAnimationFrame(this.raf);
    const loop = () => { if (!this.open) return; this.render(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  update(s: MinimapState) { if (this.open) { this.state = s; this.dirty = true; } }
  hide() {
    this.open = false;
    this.el.classList.remove('is-open');
    cancelAnimationFrame(this.raf);
    this.drag = null;
  }
  isOpen() { return this.open; }

  /** Keyboard / gamepad: returns true if handled. */
  action(a: 'up' | 'down' | 'left' | 'right' | 'select' | 'zoomIn' | 'zoomOut'): boolean {
    const step = 90 / this.view.scale;
    this.keyboardCursor = true;
    if (a === 'up') this.view.cz -= step;
    else if (a === 'down') this.view.cz += step;
    else if (a === 'left') this.view.cx -= step;
    else if (a === 'right') this.view.cx += step;
    else if (a === 'zoomIn') this.zoomAt(1.25, this.view.w / 2, this.view.h / 2);
    else if (a === 'zoomOut') this.zoomAt(1 / 1.25, this.view.w / 2, this.view.h / 2);
    else if (a === 'select') { this.setWaypoint(this.view.cx, this.view.cz); return true; }
    this.clampView();
    this.dirty = true;
    return true;
  }
  /** Continuous pan from an analog stick (-1..1), dt seconds. */
  pan(x: number, y: number, dt: number) {
    if (Math.abs(x) < 0.2 && Math.abs(y) < 0.2) return;
    this.keyboardCursor = true;
    this.view.cx += (x * 520 * dt) / this.view.scale;
    this.view.cz += (y * 520 * dt) / this.view.scale;
    this.clampView(); this.dirty = true;
  }

  private zoomAt(f: number, sx: number, sy: number) {
    const before = mapScreenToWorld(this.view, sx, sy);
    this.view.scale = Math.min(this.fitScale * 5, Math.max(this.fitScale * 0.9, this.view.scale * f));
    const after = mapScreenToWorld(this.view, sx, sy);
    this.view.cx += before.x - after.x; this.view.cz += before.z - after.z;
    this.clampView(); this.dirty = true;
  }
  private clampView() {
    const b = this.painter.bounds;
    this.view.cx = Math.min(b.maxX, Math.max(b.minX, this.view.cx));
    this.view.cz = Math.min(b.maxZ, Math.max(b.minZ, this.view.cz));
  }
  private resize(refit: boolean) {
    const w = Math.max(1, this.stage.clientWidth), hgt = Math.max(1, this.stage.clientHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(hgt * this.dpr);
    const b = this.painter.bounds;
    const prevFit = this.fitScale;
    this.fitScale = Math.min(w / (b.maxX - b.minX), hgt / (b.maxZ - b.minZ));
    this.view.w = w; this.view.h = hgt;
    if (refit) {
      this.view.scale = this.fitScale;
      this.view.cx = (b.minX + b.maxX) / 2;
      this.view.cz = (b.minZ + b.maxZ) / 2;
    } else if (prevFit > 0) this.view.scale *= this.fitScale / prevFit;
    this.clampView();
    this.dirty = true;
  }

  private render() {
    const t = (performance.now() - this.t0) / 1000;
    const animated = !!this.state?.blips.some(b => b.pulse || b.kind === 'police');
    if (!this.dirty && !animated) return;
    this.dirty = false;
    const ctx = this.ctx, v = this.view, s = this.state;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.save();
    ctx.translate(v.w / 2, v.h / 2); ctx.scale(v.scale, v.scale); ctx.translate(-v.cx, -v.cz);
    this.painter.paint(ctx, 'full');
    ctx.lineWidth = 1.5 / v.scale; ctx.strokeStyle = 'rgba(255,195,126,0.35)'; ctx.stroke(this.painter.coastline);
    if (s?.heatRadius) {
      ctx.beginPath(); ctx.arc(s.heatRadius.x, s.heatRadius.z, s.heatRadius.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 96, 78, 0.16)'; ctx.fill();
      ctx.lineWidth = 2 / v.scale; ctx.strokeStyle = 'rgba(120,180,255,0.7)'; ctx.stroke();
    }
    if (s?.route && s.route.length > 1) {
      ctx.beginPath(); ctx.moveTo(s.route[0].x, s.route[0].z);
      for (let i = 1; i < s.route.length; i++) ctx.lineTo(s.route[i].x, s.route[i].z);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 7 / v.scale; ctx.strokeStyle = 'rgba(8,24,27,0.7)'; ctx.stroke();
      ctx.lineWidth = 4 / v.scale; ctx.strokeStyle = '#ffc37e'; ctx.stroke();
    }
    ctx.restore();

    // District names
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.max(10, Math.min(15, v.scale * 22));
    ctx.font = `700 ${fs}px Inter, "Helvetica Neue", Arial, sans-serif`;
    for (const d of this.painter.districtLabels) {
      const p = mapWorldToScreen(v, d.x, d.z);
      const text = d.name.toUpperCase().split('').join(' ');
      ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,30,34,0.65)'; ctx.strokeText(text, p.x, p.y);
      ctx.fillStyle = 'rgba(252,242,217,0.78)'; ctx.fillText(text, p.x, p.y);
    }

    if (s) {
      const br = 8.5;
      for (const b of s.blips) {
        if (b.kind === 'waypoint') continue;
        const p = mapWorldToScreen(v, b.x, b.z);
        if (p.x < -20 || p.y < -20 || p.x > v.w + 20 || p.y > v.h + 20) continue;
        drawBlip(ctx, b.kind, p.x, p.y, br, t, !!b.pulse);
      }
      ctx.font = '700 14px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'left';
      for (const b of s.blips) {
        if (!b.label || b.kind === 'waypoint') continue;
        if (b.kind === 'shop' && this.view.scale < this.fitScale * 1.9) continue; // ~50 shop names only when zoomed in
        const p = mapWorldToScreen(v, b.x, b.z);
        if (p.x < -20 || p.y < -20 || p.x > v.w + 20 || p.y > v.h + 20) continue;
        ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(6,18,21,0.9)'; ctx.strokeText(b.label, p.x + br + 5, p.y);
        ctx.fillStyle = '#fff3dc'; ctx.fillText(b.label, p.x + br + 5, p.y);
      }
      ctx.textAlign = 'center';
      const wp = this.localWaypoint;
      if (wp) { const p = mapWorldToScreen(v, wp.x, wp.z); drawBlip(ctx, 'waypoint', p.x, p.y, 10, t); }
      const pp = mapWorldToScreen(v, s.x, s.z);
      drawPlayerArrow(ctx, pp.x, pp.y, 11, s.heading);
    }

    // Cursor readout and keyboard reticle
    let focus: { x: number; y: number } | null = this.cursor;
    if (this.keyboardCursor || !focus) {
      focus = this.keyboardCursor ? { x: v.w / 2, y: v.h / 2 } : null;
      if (focus) {
        ctx.strokeStyle = 'rgba(255,195,126,0.95)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(focus.x - 14, focus.y); ctx.lineTo(focus.x - 5, focus.y); ctx.moveTo(focus.x + 5, focus.y); ctx.lineTo(focus.x + 14, focus.y);
        ctx.moveTo(focus.x, focus.y - 14); ctx.lineTo(focus.x, focus.y - 5); ctx.moveTo(focus.x, focus.y + 5); ctx.lineTo(focus.x, focus.y + 14);
        ctx.stroke();
      }
    }
    if (focus) {
      const w = mapScreenToWorld(v, focus.x, focus.y);
      const away = s ? Math.hypot(w.x - s.x, w.z - s.z) : 0;
      this.readout.textContent = `${DISTRICT_INFO[districtAt(this.city, w.x, w.z)].name} · ${nearestStreets(w.x, w.z, AVENUE_NAMES, STREET_NAMES)} · ${fmtDistance(away)}`;
    } else this.readout.textContent = '';
  }
}
