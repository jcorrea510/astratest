/** Canvas painting of Port Meridian for the minimap and the full map, plus blip glyphs. */
import { AVENUES, COAST_Z, DISTRICT_INFO, HARBOR_X, STREETS, type CityMap, type District } from '../world/citymap';
import type { MinimapBlip } from './contracts';
import { WEAPON_PATHS } from './icons';

const BASE = '#173a3e';
const BLOCK_BASE = '#21474b';

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function mixColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

interface FillGroup { color: string; path: Path2D }

/** Precomputed Path2D geometry of the city in world metres; painting is a handful of fills. */
export class CityPainter {
  readonly base: FillGroup[] = [];
  readonly blocks: FillGroup[] = [];
  readonly lots: FillGroup[] = [];
  readonly roads: Path2D;
  readonly majorRoads: Path2D;
  readonly coastline: Path2D;
  readonly districtLabels: { name: string; x: number; z: number }[] = [];
  readonly bounds = { minX: AVENUES[0] - 60, maxX: HARBOR_X + 60, minZ: STREETS[0] - 60, maxZ: COAST_Z + 70 };

  constructor(city: CityMap) {
    const big = 4000;
    const land = new Path2D();
    land.rect(-big, -big, big * 2, big * 2);
    const hills = new Path2D();
    hills.rect(-big, -big, big * 2, big + STREETS[0] - 30);
    hills.rect(-big, STREETS[0] - 30, big + AVENUES[0] - 30, big * 2);
    const water = new Path2D();
    water.rect(-big, COAST_Z, big * 2, big);
    water.rect(HARBOR_X, -60, big, big);
    water.rect(HARBOR_X + 40, -big, big, big);
    const beach = new Path2D();
    beach.rect(AVENUES[0] - 30, STREETS[STREETS.length - 1] + 9, HARBOR_X - AVENUES[0] + 30, COAST_Z - STREETS[STREETS.length - 1] - 9);
    const quay = new Path2D();
    quay.rect(AVENUES[AVENUES.length - 1] + 9, STREETS[0] - 30, HARBOR_X - AVENUES[AVENUES.length - 1] - 9, COAST_Z - STREETS[0] + 30);
    this.base.push({ color: BASE, path: land });
    this.base.push({ color: '#1b4038', path: hills });
    this.base.push({ color: mixColor('#d9b380', BASE, 0.45), path: beach });
    this.base.push({ color: mixColor('#7a7268', BASE, 0.45), path: quay });
    this.base.push({ color: '#0b2630', path: water });

    this.coastline = new Path2D();
    this.coastline.moveTo(-big, COAST_Z); this.coastline.lineTo(HARBOR_X, COAST_Z);
    this.coastline.lineTo(HARBOR_X, -60); this.coastline.lineTo(HARBOR_X + 40, -60); this.coastline.lineTo(HARBOR_X + 40, -big);

    const blockPaths = new Map<string, Path2D>();
    const lotPaths = new Map<string, Path2D>();
    const dsum = new Map<District, { x: number; z: number; n: number }>();
    for (const b of city.blocks) {
      const tint = b.kind === 'park' ? '#4f8a52' : DISTRICT_INFO[b.district].color;
      const color = mixColor(BLOCK_BASE, tint, b.kind === 'park' ? 0.62 : 0.26);
      let p = blockPaths.get(color);
      if (!p) { p = new Path2D(); blockPaths.set(color, p); }
      p.rect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
      const s = dsum.get(b.district) ?? { x: 0, z: 0, n: 0 };
      s.x += (b.x0 + b.x1) / 2; s.z += (b.z0 + b.z1) / 2; s.n++;
      dsum.set(b.district, s);
    }
    for (const [color, path] of blockPaths) this.blocks.push({ color, path });
    const blockById = new Map(city.blocks.map(b => [b.id, b]));
    for (const l of city.lots) {
      const b = blockById.get(l.blockId);
      const tint = b ? DISTRICT_INFO[b.district].color : '#888888';
      const color = mixColor(BLOCK_BASE, tint, 0.45);
      let p = lotPaths.get(color);
      if (!p) { p = new Path2D(); lotPaths.set(color, p); }
      const swap = Math.abs(Math.sin(l.rot)) > 0.7;
      const w = (swap ? l.d : l.w) * 0.92, d = (swap ? l.w : l.d) * 0.92;
      p.rect(l.x - w / 2, l.z - d / 2, w, d);
    }
    for (const [color, path] of lotPaths) this.lots.push({ color, path });

    this.roads = new Path2D();
    this.majorRoads = new Path2D();
    for (const r of city.roads) {
      const p = r.lanes === 2 ? this.majorRoads : this.roads;
      if (r.axis === 'z') p.rect(r.coord - r.half, r.from - 0.5, r.half * 2, r.to - r.from + 1);
      else p.rect(r.from - 0.5, r.coord - r.half, r.to - r.from + 1, r.half * 2);
    }
    for (const i of city.intersections) {
      const major = i.halfX > 6 || i.halfZ > 6;
      (major ? this.majorRoads : this.roads).rect(i.x - i.halfX, i.z - i.halfZ, i.halfX * 2, i.halfZ * 2);
    }
    for (const [d, s] of dsum) this.districtLabels.push({ name: DISTRICT_INFO[d].name, x: s.x / s.n, z: s.z / s.n });
  }

  /** Paints in world coordinates; the caller sets the transform. */
  paint(ctx: CanvasRenderingContext2D, detail: 'mini' | 'full') {
    for (const g of this.base) { ctx.fillStyle = g.color; ctx.fill(g.path); }
    for (const g of this.blocks) { ctx.fillStyle = g.color; ctx.fill(g.path); }
    ctx.globalAlpha = detail === 'mini' ? 0.75 : 1;
    for (const g of this.lots) { ctx.fillStyle = g.color; ctx.fill(g.path); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(236, 220, 186, 0.42)';
    ctx.fill(this.roads);
    ctx.fillStyle = 'rgba(255, 205, 140, 0.62)';
    ctx.fill(this.majorRoads);
  }
}

let glyphs: Record<string, Path2D> | null = null;
function glyph(name: string): Path2D {
  if (!glyphs) {
    glyphs = {
      house: new Path2D('M12 3.5L2.5 11.5H5.5V20.5H10V15H14V20.5H18.5V11.5H21.5Z'),
      wrench: new Path2D('M16.8 2.6a5.4 5.4 0 0 0-5.3 7L3.4 17.7a2.1 2.1 0 0 0 3 3l8.1-8.1a5.4 5.4 0 0 0 7-5.3l-3.2 3.2-2.9-.6-.6-2.9z'),
      pistol: new Path2D(WEAPON_PATHS.pistol),
      car: new Path2D('M8 3h8q3 0 3 3v12q0 3-3 3H8q-3 0-3-3V6q0-3 3-3z'),
      pin: new Path2D('M12 23C12 23 4 14.5 4 9.5A8 8 0 0 1 20 9.5C20 14.5 12 23 12 23Z'),
      diamond: new Path2D('M12 2L22 12L12 22L2 12Z'),
      bag: new Path2D('M6 8h12l1.4 13H4.6zM9 8V6.5a3 3 0 0 1 6 0V8h-1.6V6.5a1.4 1.4 0 0 0-2.8 0V8z'),
    };
  }
  return glyphs[name];
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke = 'rgba(8,24,27,0.9)') {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.22); ctx.strokeStyle = stroke; ctx.stroke();
}
function drawGlyph(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string, box = 24, boxH = 24) {
  ctx.save();
  const k = size / Math.max(box, boxH);
  ctx.translate(x - (box * k) / 2, y - (boxH * k) / 2);
  ctx.scale(k, k);
  ctx.fillStyle = color; ctx.fill(glyph(name), 'evenodd');
  ctx.restore();
}

export const BLIP_COLORS: Record<MinimapBlip['kind'], string> = {
  mission: '#ffc37e', target: '#ff6f5e', checkpoint: '#ffe08a', waypoint: '#ffb066', safehouse: '#fcf2d9', shop: '#7fcf9a',
  arms: '#f08a5d', garage: '#8fb8d8', vehicle: '#e8dcc0', collectible: '#f7d5a1', enemy: '#ff5a4e', police: '#6fb6ff',
};

/** Draws a blip glyph centred at (x, y) in pixel space. r is the base radius in pixels, t is time in seconds. */
export function drawBlip(ctx: CanvasRenderingContext2D, kind: MinimapBlip['kind'], x: number, y: number, r: number, t: number, pulse = false, edge = false) {
  const col = BLIP_COLORS[kind];
  if (pulse && !edge) {
    const k = (t * 1.1) % 1;
    ctx.beginPath(); ctx.arc(x, y, r * (1.1 + k * 1.6), 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.85 * (1 - k); ctx.lineWidth = Math.max(1.2, r * 0.22); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (edge) r *= 0.82;
  switch (kind) {
    case 'mission':
      disc(ctx, x, y, r, col);
      drawGlyph(ctx, 'diamond', x, y, r * 0.95, '#173a3e');
      break;
    case 'target':
      ctx.beginPath(); ctx.arc(x, y, r * 0.95, 0, Math.PI * 2);
      ctx.lineWidth = r * 0.42; ctx.strokeStyle = 'rgba(8,24,27,0.9)'; ctx.stroke();
      ctx.lineWidth = r * 0.24; ctx.strokeStyle = col; ctx.stroke();
      disc(ctx, x, y, r * 0.36, col, 'rgba(8,24,27,0.6)');
      break;
    case 'checkpoint':
      ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
      ctx.lineWidth = r * 0.55; ctx.strokeStyle = 'rgba(8,24,27,0.85)'; ctx.stroke();
      ctx.lineWidth = r * 0.32; ctx.strokeStyle = col; ctx.stroke();
      break;
    case 'waypoint':
      drawGlyph(ctx, 'pin', x, y - r * 0.6, r * 2.5, 'rgba(8,24,27,0.9)');
      drawGlyph(ctx, 'pin', x, y - r * 0.6, r * 2.1, col);
      disc(ctx, x, y - r * 0.9, r * 0.32, '#173a3e', '#173a3e');
      break;
    case 'safehouse':
      disc(ctx, x, y, r, '#27545a', col);
      drawGlyph(ctx, 'house', x, y, r * 1.25, col);
      break;
    case 'shop':
      disc(ctx, x, y, r, col);
      drawGlyph(ctx, 'bag', x, y + r * 0.04, r * 1.15, '#12363a');
      break;
    case 'arms':
      disc(ctx, x, y, r, col);
      drawGlyph(ctx, 'pistol', x + r * 0.08, y + r * 0.06, r * 1.55, '#12363a', 64, 32);
      break;
    case 'garage':
      disc(ctx, x, y, r, col);
      drawGlyph(ctx, 'wrench', x, y, r * 1.1, '#12363a');
      break;
    case 'vehicle':
      drawGlyph(ctx, 'car', x, y, r * 1.7, 'rgba(8,24,27,0.85)');
      drawGlyph(ctx, 'car', x, y, r * 1.35, col);
      break;
    case 'collectible':
      drawGlyph(ctx, 'diamond', x, y, r * 1.6, 'rgba(8,24,27,0.85)');
      drawGlyph(ctx, 'diamond', x, y, r * 1.15, col);
      break;
    case 'enemy':
      disc(ctx, x, y, r * 0.62, col);
      break;
    case 'police': {
      const on = Math.floor(t * 4) % 2 === 0;
      disc(ctx, x, y, r * 0.66, on ? col : '#ff5a4e');
      break;
    }
  }
}

/** The player arrow, pointing up at angle 0 (rotate by heading to point elsewhere). */
export function drawPlayerArrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * 0.72, size * 0.78); ctx.lineTo(0, size * 0.38); ctx.lineTo(-size * 0.72, size * 0.78); ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.3); ctx.strokeStyle = 'rgba(8,24,27,0.9)'; ctx.stroke();
  ctx.fillStyle = '#fcf2d9'; ctx.fill();
  ctx.restore();
}

/** Nearest avenue/street names to a point, for the full-map cursor readout. */
export function nearestStreets(x: number, z: number, avenueNames: string[], streetNames: string[]): string {
  let ai = 0, si = 0;
  for (let i = 1; i < AVENUES.length; i++) if (Math.abs(AVENUES[i] - x) < Math.abs(AVENUES[ai] - x)) ai = i;
  for (let j = 1; j < STREETS.length; j++) if (Math.abs(STREETS[j] - z) < Math.abs(STREETS[si] - z)) si = j;
  return `${avenueNames[ai]} & ${streetNames[si]}`;
}
