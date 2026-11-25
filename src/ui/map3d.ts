/** Extruded building footprints for the 3D-style maps: projected on the fly (full map) or baked once (minimap). */
import { DISTRICT_INFO, type CityMap } from '../world/citymap';

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c: [number, number, number], k = 1): string {
  return `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;
}

export interface Building3D {
  cx: number; cz: number;
  /** footprint corners (x,z) x4 */
  p: Float32Array;
  h: number;
  roof: string; wallL: string; wallR: string; edge: string;
}

/** sqrt(1 - 0.64^2): the default map pitch, where HEIGHT_K applies unscaled */
const PITCH_REF = 0.768;
export const HEIGHT_K = 0.8; // screen pixels of rise per metre-of-height per pixel-per-metre of scale

export class Buildings3D {
  readonly list: Building3D[] = [];
  private order: Building3D[] = [];
  private orderTilt = NaN;
  private keys = new Float64Array(0);

  constructor(city: CityMap) {
    const blockById = new Map(city.blocks.map(b => [b.id, b]));
    const base = rgb('#7c828b');
    for (const l of city.lots) {
      const b = blockById.get(l.blockId);
      const dist = b ? b.district : l.district;
      const tint = rgb(dist ? DISTRICT_INFO[dist].color : '#888888');
      const h = Math.max(5, l.height || 8);
      const hk = Math.min(1, h / 90);
      const v = 0.9 + ((l.seed % 997) / 997) * 0.22; // per-building brightness variation
      const warm = (l.seed >> 7) % 3 === 0 ? [150, 134, 122] as [number, number, number] : base;
      const roof = mix(mix(warm, tint, 0.18), [214, 218, 224], 0.06 + hk * 0.26).map(x => x * v) as [number, number, number];
      const wall = mix(mix([98, 100, 106], tint, 0.14), [52, 60, 74], 0.2 + hk * 0.15).map(x => x * v) as [number, number, number];
      const p = new Float32Array(8);
      let hw: number, hd: number, c = 1, s = 0;
      if (l.blockId < 0) { c = Math.cos(l.rot); s = Math.sin(l.rot); hw = l.w * 0.46; hd = l.d * 0.46; }
      else { const swap = Math.abs(Math.sin(l.rot)) > 0.7; hw = (swap ? l.d : l.w) * 0.46; hd = (swap ? l.w : l.d) * 0.46; }
      const corners: [number, number][] = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
      corners.forEach(([lx, lz], i) => { p[i * 2] = l.x + lx * c + lz * s; p[i * 2 + 1] = l.z - lx * s + lz * c; });
      this.list.push({ cx: l.x, cz: l.z, p, h, roof: css(roof), wallL: css(wall, 1.12), wallR: css(wall, 0.68), edge: css(roof, 1.14) });
    }
  }

  /** Back-to-front order for a map rotation (depth = coordinate along the view's vertical axis). */
  sorted(tilt: number): Building3D[] {
    if (tilt !== this.orderTilt) {
      const s = Math.sin(tilt), c = Math.cos(tilt), n = this.list.length;
      if (this.keys.length !== n) this.keys = new Float64Array(n);
      for (let i = 0; i < n; i++) this.keys[i] = this.list[i].cx * s + this.list[i].cz * c;
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.keys[a] - this.keys[b]);
      this.order = idx.map(i => this.list[i]);
      this.orderTilt = tilt;
    }
    return this.order;
  }

  /** Extruded draw for the pitched full map. Screen mapping: x' = dx*c - dz*s, y' = (dx*s + dz*c)*pitch. */
  drawExtruded(ctx: CanvasRenderingContext2D, cx: number, cz: number, scale: number, tilt: number, pitch: number, w: number, hgt: number, fast = false) {
    const c = Math.cos(tilt), s = Math.sin(tilt), hw = w / 2, hh = hgt / 2;
    // wall rise follows the camera angle: full at the default pitch, none when looking straight down
    const lf = Math.sqrt(Math.max(0, 1 - pitch * pitch)) / PITCH_REF;
    const lift = scale * HEIGHT_K * lf;
    const flat = Math.max(0, 1 - lf);
    const sx = new Float32Array(4), sy = new Float32Array(4);
    const order = this.sorted(tilt);
    // pass 1: cast shadows, one path, one fill
    const shadow = new Path2D();
    const vis: Building3D[] = [];
    for (const b of order) {
      const dx = b.cx - cx, dz = b.cz - cz;
      const px = (dx * c - dz * s) * scale + hw, py = (dx * s + dz * c) * scale * pitch + hh;
      const rise = Math.min(b.h, 140) * lift;
      if (px < -60 - rise || px > w + 60 + rise || py < -60 || py > hgt + 80 + rise) continue;
      vis.push(b);
      if (b.h < 14 && scale < 0.5) continue;
      const hs = Math.min(b.h, 100) * scale;
      const ox = rise * 0.45 + flat * hs * 0.14, oy = rise * 0.12 + flat * hs * 0.1;
      for (let i = 0; i < 4; i++) {
        const ex = b.p[i * 2] - cx, ez = b.p[i * 2 + 1] - cz;
        const X = (ex * c - ez * s) * scale + hw + ox, Y = (ex * s + ez * c) * scale * pitch + hh + oy;
        if (i) shadow.lineTo(X, Y); else shadow.moveTo(X, Y);
      }
      shadow.closePath();
    }
    ctx.fillStyle = 'rgba(4,14,18,0.34)'; ctx.fill(shadow);
    // pass 2: walls + roofs, far to near
    for (const b of vis) {
      const rise = Math.min(b.h, 140) * lift;
      let mx = 0, my = 0;
      for (let i = 0; i < 4; i++) {
        const ex = b.p[i * 2] - cx, ez = b.p[i * 2 + 1] - cz;
        sx[i] = (ex * c - ez * s) * scale + hw; sy[i] = (ex * s + ez * c) * scale * pitch + hh;
        mx += sx[i]; my += sy[i];
      }
      mx /= 4; my /= 4;
      for (let i = 0; rise > 0.4 && i < 4; i++) {
        const j = (i + 1) & 3;
        let nx = sy[j] - sy[i], ny = -(sx[j] - sx[i]);
        if (nx * ((sx[i] + sx[j]) / 2 - mx) + ny * ((sy[i] + sy[j]) / 2 - my) < 0) { nx = -nx; ny = -ny; }
        if (ny <= 0.001) continue; // faces away from the camera
        ctx.fillStyle = nx < 0 ? b.wallL : b.wallR;
        ctx.beginPath();
        ctx.moveTo(sx[i], sy[i]); ctx.lineTo(sx[j], sy[j]); ctx.lineTo(sx[j], sy[j] - rise); ctx.lineTo(sx[i], sy[i] - rise);
        ctx.closePath(); ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(sx[0], sy[0] - rise);
      for (let i = 1; i < 4; i++) ctx.lineTo(sx[i], sy[i] - rise);
      ctx.closePath();
      ctx.fillStyle = b.roof; ctx.fill();
      if (scale > 0.45 && !fast) { ctx.lineWidth = 1; ctx.strokeStyle = b.edge; ctx.stroke(); }
    }
  }

  /** Top-down shaded footprints (soft shadow to the south-east, roofs lighter with height) for the baked minimap. */
  drawFlat(ctx: CanvasRenderingContext2D) {
    const shadow = new Path2D();
    for (const b of this.list) {
      const o = Math.min(b.h, 100) * 0.16;
      for (let i = 0; i < 4; i++) {
        const X = b.p[i * 2] + o, Z = b.p[i * 2 + 1] + o * 0.8;
        if (i) shadow.lineTo(X, Z); else shadow.moveTo(X, Z);
      }
      shadow.closePath();
    }
    ctx.fillStyle = 'rgba(3,12,16,0.4)'; ctx.fill(shadow);
    for (const b of this.list) {
      ctx.beginPath();
      ctx.moveTo(b.p[0], b.p[1]); for (let i = 1; i < 4; i++) ctx.lineTo(b.p[i * 2], b.p[i * 2 + 1]);
      ctx.closePath();
      ctx.fillStyle = b.roof; ctx.fill();
      ctx.lineWidth = 0.6; ctx.strokeStyle = b.edge; ctx.stroke();
    }
  }
}
