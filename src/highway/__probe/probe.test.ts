import { test } from 'vitest';
import { getTemplate } from '../../vehicles/models/build';
import { CAR_CHOICES } from '../hud';
test('probe', () => {
  for (const k of CAR_CHOICES) {
    const t = getTemplate(k), gh = t.shape.gh!;
    const g = t.lods[0].glass!; const P = g.getAttribute('position'), N = g.getAttribute('normal');
    const ws: number[] = [], sd: number[] = [];
    for (let i = 0; i < P.count; i++) { if (P.getX(i) < 0) continue; if (N.getZ(i) > 0.35 && Math.abs(N.getX(i)) < 0.6) ws.push(i); else if (N.getX(i) > 0.6) sd.push(i); }
    const ys = ws.map(i => P.getY(i)), y0 = Math.min(...ys), y1 = Math.max(...ys), r = y1 - y0;
    const pick = (list: number[]) => list.reduce((a, i) => P.getX(i) > P.getX(a) ? i : a, list[0]);
    const b = pick(ws.filter(i => P.getY(i) < y0 + 0.2 * r)), tp = pick(ws.filter(i => P.getY(i) > y1 - 0.1 * r));
    const sy = sd.map(i => P.getY(i)), s0 = Math.min(...sy);
    const sb = sd.filter(i => P.getY(i) < s0 + 0.03), szMax = Math.max(...sb.map(i => P.getZ(i))), sxAt = Math.max(...sb.map(i => P.getX(i)));
    const f = (i: number) => `${P.getX(i).toFixed(2)},${P.getY(i).toFixed(2)},${P.getZ(i).toFixed(2)}`;
    console.log(k.padEnd(11), 'ws y', y0.toFixed(2), y1.toFixed(2), 'base', f(b), 'top', f(tp), '| side belt', s0.toFixed(2), 'front z', szMax.toFixed(2), 'x', sxAt.toFixed(2), '| W/2', t.shape.W / 2, 'roofY', t.roofY.toFixed(2), 'zR1', gh.zR1, 'S', t.seats[0].x.toFixed(2), t.seats[0].y.toFixed(2), t.seats[0].z.toFixed(2));
  }
}, 60000);
