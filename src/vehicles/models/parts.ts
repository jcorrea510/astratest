/** Car parts: tyres and several rim styles, superellipsoid blobs, interior, plates, lights and accessories. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Soup, gridSurface, spow, dropDegenerate, type Paint } from './soup';
import { K } from './kinds';
import type { CarShape, RimStyle } from '../shapes';

const M = () => new THREE.Matrix4();
export const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  M().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** Superellipsoid (p = 2 ellipsoid, higher = boxier). */
export function blob(rx: number, ry: number, rz: number, p: number, paint: Paint, m?: THREE.Matrix4, na = 16, nt = 10): Soup {
  const e = 2 / p;
  const fn = (a: number, t: number, o: number[]) => {
    const ph = -Math.PI / 2 + Math.PI * t, c = spow(Math.cos(ph), e);
    o[0] = rx * c * spow(Math.cos(a), e); o[1] = ry * spow(Math.sin(ph), e); o[2] = rz * c * spow(Math.sin(a), e);
  };
  const as = Array.from({ length: na + 1 }, (_, i) => (i / na) * Math.PI * 2);
  const ts = Array.from({ length: nt + 1 }, (_, i) => i / nt);
  const s = dropDegenerate(gridSurface(fn, as, ts, paint, (x, y, z) => [x / rx, y / ry, z / rz]));
  if (m) s.applyMatrix(m);
  return s;
}
export function rbox(w: number, h: number, d: number, r: number, paint: Paint, m?: THREE.Matrix4, seg = 1): Soup {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const s = new Soup().addGeometry(g, paint, m); g.dispose(); return s;
}
export function cyl(r0: number, r1: number, len: number, paint: Paint, m?: THREE.Matrix4, seg = 12, open = false): Soup {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  const s = new Soup().addGeometry(g, paint, m); g.dispose(); return s;
}
/** Tube along a polyline (roll cages, push bars, rails). */
export function tube(pts: THREE.Vector3[], r: number, paint: Paint, seg = 8): Soup {
  const s = new Soup();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    s.append(cyl(r, r, len, paint, M().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), seg, true));
    s.append(blob(r, r, r, 2, paint, at(b.x, b.y, b.z), 8, 5));
  }
  return s;
}

// ---------------------------------------------------------------------------------------------- wheels
/** One wheel at the origin, axle along x, outer face towards +x. */
export function wheelSoup(s: CarShape, lod: number): Soup {
  const R = s.R, hw = s.tw / 2;
  const side = s.type === 'car' ? (s.rim === 'race' || s.rim === 'mesh' || s.rim === 'spoke5' && s.R >= 0.33 ? 0.26 : 0.33) : 0.36;
  const Rr = R * (1 - side);
  const out = new Soup();
  // tyre: lathe profile from the inner bead to the outer bead
  const pr: [number, number][] = [[Rr - 0.006, -hw + 0.014], [Rr + 0.012, -hw], [R - 0.055, -hw - 0.007], [R - 0.02, -hw + 0.008], [R - 0.005, -hw + 0.03], [R, -hw + 0.055],
    [R, hw - 0.055], [R - 0.005, hw - 0.03], [R - 0.02, hw - 0.008], [R - 0.055, hw + 0.007], [Rr + 0.012, hw], [Rr - 0.006, hw - 0.014]];
  const lathe = new THREE.LatheGeometry(pr.map(([r, h]) => new THREE.Vector2(r, h)), lod ? 16 : 34).rotateZ(-Math.PI / 2);
  const tyre = new Soup().addGeometry(lathe, { kind: K.RUBBER, color: '#1a1a1b' }); lathe.dispose();
  for (let i = 0; i < tyre.d.length; i += 14) {
    const x = tyre.d[i], r = Math.hypot(tyre.d[i + 1], tyre.d[i + 2]);
    tyre.d[i + 6] = (Math.atan2(tyre.d[i + 1], tyre.d[i + 2]) / (Math.PI * 2) + 1) % 1;
    tyre.d[i + 7] = r > R - 0.004 ? (x + hw) / (2 * hw) : 2 + x / hw;
  }
  // the lathe seam: fix u wrap so the tread pattern doesn't smear across one quad
  for (let t = 0; t < tyre.d.length; t += 42) {
    const u = [tyre.d[t + 6], tyre.d[t + 20], tyre.d[t + 34]];
    if (Math.max(...u) - Math.min(...u) > 0.5) for (let k = 0; k < 3; k++) if (u[k] < 0.5) tyre.d[t + k * 14 + 6] += 1;
  }
  out.append(tyre);
  const style = s.rim;
  const rimPaint: Paint = { kind: style === 'chrome' ? K.CHROME : K.RIM, color: s.rimColor };
  const faceX = hw - 0.03;
  if (lod) {
    const disc = new THREE.CircleGeometry(Rr - 0.004, 14).rotateY(Math.PI / 2).translate(faceX, 0, 0);
    out.addGeometry(disc, rimPaint); disc.dispose();
    out.append(cyl(0.05, 0.05, 0.01, { kind: K.METAL, color: '#3a3b3d' }, at(faceX + 0.006, 0, 0, 0, 0, -Math.PI / 2), 8));
    return out;
  }
  // barrel + brake disc behind the spokes
  out.append(cyl(Rr - 0.006, Rr - 0.006, s.tw - 0.04, { kind: K.METAL, color: '#4a4c50' }, at(0, 0, 0, 0, 0, Math.PI / 2), 20, true));
  out.append(cyl(Rr * 0.74, Rr * 0.74, 0.026, { kind: K.METAL, color: '#6d6f73' }, at(hw * 0.1, 0, 0, 0, 0, Math.PI / 2), 20));
  out.append(cyl(Rr * 0.32, Rr * 0.32, 0.04, { kind: K.METAL, color: '#2a2b2d' }, at(hw * 0.25, 0, 0, 0, 0, Math.PI / 2), 16));
  // face: disc with windows between spokes, extruded and dished
  const ro = Rr - 0.004;
  const shape = new THREE.Shape(); shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
  const win = (n: number, r0: number, r1: number, spokeHalf: number, phase = 0) => {
    for (let i = 0; i < n; i++) {
      const c = phase + (i + 0.5) * Math.PI * 2 / n;
      const hs = (r: number) => Math.max(0.01, Math.PI / n - spokeHalf / r);
      const path = new THREE.Path(); const pts: THREE.Vector2[] = [];
      for (let k = 0; k <= 6; k++) { const a = c - hs(r1) + (2 * hs(r1)) * k / 6; pts.push(new THREE.Vector2(Math.cos(a) * r1, Math.sin(a) * r1)); }
      const in0 = hs(r0);
      if (in0 > 0.03) for (let k = 0; k <= 3; k++) { const a = c + in0 - (2 * in0) * k / 3; pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
      else pts.push(new THREE.Vector2(Math.cos(c) * r0, Math.sin(c) * r0));
      path.setFromPoints(pts.reverse()); shape.holes.push(path);
    }
  };
  const roundHoles = (n: number, rc: number, rh: number, phase = 0) => { for (let i = 0; i < n; i++) { const a = phase + i * Math.PI * 2 / n; const p = new THREE.Path(); p.absarc(Math.cos(a) * rc, Math.sin(a) * rc, rh, 0, Math.PI * 2, true); shape.holes.push(p); } };
  let dish = 0.02;
  const styleOf: Record<RimStyle, () => void> = {
    spoke5: () => { win(5, ro * 0.32, ro * 0.86, 0.042); dish = 0.028; },
    multi: () => { win(10, ro * 0.33, ro * 0.86, 0.016); dish = 0.018; },
    chrome: () => { win(15, ro * 0.3, ro * 0.88, 0.01); dish = 0.012; },
    race: () => { win(6, ro * 0.22, ro * 0.9, 0.02); dish = 0.035; },
    mesh: () => { win(10, ro * 0.6, ro * 0.88, 0.012); win(10, ro * 0.3, ro * 0.55, 0.012, Math.PI / 10); dish = 0.03; },
    twin: () => { win(10, ro * 0.3, ro * 0.86, 0.012); dish = 0.02; },
    steel: () => { roundHoles(8, ro * 0.62, ro * 0.075); dish = 0.035; },
    hubcap: () => { win(8, ro * 0.56, ro * 0.82, 0.05); dish = -0.025; },
    truck: () => { win(6, ro * 0.45, ro * 0.72, 0.075); dish = 0.06; },
  };
  styleOf[style]();
  const ex = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1, curveSegments: style === 'steel' ? 10 : 18 });
  const pos = ex.attributes.position;
  for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)) / ro; pos.setZ(i, pos.getZ(i) + dish * (r - 1)); }
  ex.computeVertexNormals();
  ex.rotateY(Math.PI / 2).translate(faceX - 0.016, 0, 0);
  out.addGeometry(ex, rimPaint); ex.dispose();
  // lip, centre cap, lug nuts
  const lip = new THREE.TorusGeometry(ro, 0.011, 5, 34).rotateY(Math.PI / 2).translate(faceX - 0.004, 0, 0);
  out.addGeometry(lip, rimPaint); lip.dispose();
  const cx = faceX - (dish > 0 ? dish * 0.95 : 0) + 0.004;
  if (style === 'race') out.append(cyl(0.038, 0.03, 0.05, { kind: K.CHROME }, at(cx + 0.02, 0, 0, 0, 0, -Math.PI / 2), 6));
  else {
    out.append(cyl(ro * 0.17, ro * 0.15, 0.022, style === 'hubcap' ? rimPaint : { kind: K.CHROME }, at(cx + 0.006, 0, 0, 0, 0, -Math.PI / 2), 18));
    const nl = style === 'truck' ? 8 : 5;
    for (let i = 0; i < nl; i++) { const a = i * Math.PI * 2 / nl; out.append(cyl(0.011, 0.011, 0.022, { kind: K.CHROME }, at(cx, Math.cos(a) * ro * 0.27, Math.sin(a) * ro * 0.27, 0, 0, -Math.PI / 2), 6)); }
  }
  if (style === 'hubcap' || style === 'steel') {
    // steel wheel rim edge behind the cap
    const ring = new THREE.RingGeometry(ro * 0.82, ro, 36).rotateY(Math.PI / 2).translate(faceX - 0.02, 0, 0);
    out.addGeometry(ring, { kind: K.RIM, color: '#2c2d30' }); ring.dispose();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- plates & decals
/** Number plate quad facing +z (front) or -z, uv into the decal atlas row of plates. */
export function plate(x: number, y: number, z: number, front: boolean, variant: number, tiltX = 0): Soup {
  const g = new THREE.PlaneGeometry(0.52, 0.12);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (variant + uv.getX(i)) / 8, 0.75 + uv.getY(i) * 0.125);
  const s = new Soup().addGeometry(g, { kind: K.PLATE }, at(x, y, z, tiltX, front ? 0 : Math.PI, 0));
  g.dispose();
  s.append(rbox(0.55, 0.15, 0.012, 0.004, { kind: K.TRIM, color: '#18181a' }, at(x, y, z - (front ? 0.008 : -0.008), tiltX, 0, 0)));
  return s;
}
/** Text panel (decal atlas cell) facing +x. cell: [u0, v0, u1, v1] */
export function decalQuad(w: number, h: number, cell: [number, number, number, number], kind: number, m: THREE.Matrix4): Soup {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cell[0] + (cell[2] - cell[0]) * uv.getX(i), cell[1] + (cell[3] - cell[1]) * uv.getY(i));
  const s = new Soup().addGeometry(g, { kind, color: '#ffffff' }, m); g.dispose(); return s;
}

// ---------------------------------------------------------------------------------------------- interior
export interface SeatG { x: number; y: number; z: number }
/** Seats, dashboard, steering wheel, console, carpet; positions in the ground frame. */
export function interiorSoup(s: CarShape, seats: SeatG[], cabin: { zA: number; zC: number; hw: number; floor: number; dashY: number }, lod: number): Soup {
  const out = new Soup();
  const trim: Paint = { kind: K.INTERIOR, color: s.interior };
  const dark: Paint = { kind: K.INTERIOR, color: '#1c1c1e' };
  const carpet: Paint = { kind: K.INTERIOR, color: '#202022' };
  const L = cabin.zA - cabin.zC;
  if (lod) {
    for (const st of seats.slice(0, 2)) out.append(rbox(0.46, 0.62, 0.16, 0.05, trim, at(st.x, st.y + 0.3, st.z - 0.22, -0.2)));
    if (seats.length > 2) out.append(rbox(cabin.hw * 1.7, 0.58, 0.16, 0.05, trim, at(0, seats[2].y + 0.28, seats[2].z - 0.2, -0.15)));
    out.append(rbox(cabin.hw * 1.9, 0.2, 0.4, 0.05, dark, at(0, cabin.dashY - 0.08, cabin.zA - 0.15)));
    return out;
  }
  out.append(rbox(cabin.hw * 2 - 0.04, 0.04, L + 0.3, 0.02, carpet, at(0, cabin.floor, (cabin.zA + cabin.zC) / 2)));
  // dashboard with a cluster hood, centre stack and console
  out.append(rbox(cabin.hw * 2 - 0.02, 0.24, 0.5, 0.09, dark, at(0, cabin.dashY - 0.12, cabin.zA - 0.12)));
  out.append(rbox(cabin.hw * 2 - 0.1, 0.06, 0.18, 0.03, trim, at(0, cabin.dashY - 0.26, cabin.zA - 0.38)));
  const d = seats[0];
  out.append(blob(0.2, 0.06, 0.12, 3, dark, at(d.x, cabin.dashY + 0.0, cabin.zA - 0.33)));
  for (const gx of [-0.07, 0.07]) out.append(cyl(0.05, 0.05, 0.01, { kind: K.LIGHT, color: '#9fc6ff' }, at(d.x + gx, cabin.dashY - 0.03, cabin.zA - 0.43, Math.PI / 2 - 0.3), 14));
  out.append(rbox(0.26, 0.34, 0.34, 0.04, dark, at(0, cabin.dashY - 0.32, cabin.zA - 0.42)));
  out.append(rbox(0.22, 0.12, Math.max(0.3, L * 0.32), 0.04, dark, at(0, cabin.floor + 0.12, seats[0].z + 0.15)));
  // steering wheel: rim, spokes, column
  const wz = d.z + 0.47, wy = d.y + 0.36, tilt = 1.1;
  const rimG = new THREE.TorusGeometry(0.175, 0.02, 6, 28).rotateX(tilt).translate(d.x, wy, wz);
  out.addGeometry(rimG, dark); rimG.dispose();
  const wq = at(d.x, wy, wz, tilt - Math.PI / 2);
  out.append(blob(0.07, 0.025, 0.055, 2.5, dark, wq.clone().multiply(at(0, 0, 0))));
  for (const a of [0, 2.4, -2.4]) out.append(rbox(0.16, 0.02, 0.035, 0.008, dark, wq.clone().multiply(at(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08 * 0, 0, a, 0)).multiply(at(0.06, 0, 0))));
  out.append(cyl(0.025, 0.035, 0.4, dark, at(d.x, wy + 0.08, wz + 0.2, tilt - Math.PI / 2 + 0.25)));
  // seats
  const seat = (x: number, y: number, z: number, w: number) => {
    out.append(rbox(w, 0.13, 0.5, 0.05, trim, at(x, y - 0.06, z + 0.03, -0.08)));
    out.append(rbox(w, 0.62, 0.15, 0.06, trim, at(x, y + 0.27, z - 0.24, -0.22)));
    for (const bx of [-1, 1]) out.append(rbox(0.07, 0.5, 0.13, 0.03, trim, at(x + bx * (w / 2 - 0.02), y + 0.25, z - 0.2, -0.22)));
  };
  const head = (x: number, y: number, z: number) => out.append(rbox(0.25, 0.17, 0.09, 0.04, trim, at(x, y + 0.66, z - 0.33, -0.22)));
  for (const st of seats.slice(0, 2)) { seat(st.x, st.y, st.z, 0.5); head(st.x, st.y, st.z); }
  if (seats.length > 2) {
    const r = seats[2];
    out.append(rbox(cabin.hw * 2 - 0.12, 0.14, 0.5, 0.05, trim, at(0, r.y - 0.05, r.z + 0.05, -0.06)));
    out.append(rbox(cabin.hw * 2 - 0.12, 0.58, 0.15, 0.06, trim, at(0, r.y + 0.26, r.z - 0.24, -0.18)));
    if (s.doors.length > 1) for (const st of seats.slice(2)) head(st.x, st.y - 0.03, st.z + 0.02);
    // parcel shelf
    if (s.gh && !s.gh.open && s.type === 'car' && s.gh.zC > r.z - 1.0 && s.gh.zC - (s.zOff - s.L / 2) > 0.6) out.append(rbox(cabin.hw * 2 - 0.1, 0.03, Math.max(0.1, (r.z - 0.32) - s.gh.zC), 0.01, dark, at(0, r.y + 0.52, (r.z - 0.32 + s.gh.zC) / 2)));
  } else if (s.type !== 'car') {
    // bulkhead behind the seats
    const bh = Math.min(1.0, (s.gh ? s.gh.roof : 2) - cabin.floor - 0.12);
    out.append(rbox(cabin.hw * 2 - 0.04, bh, 0.04, 0.02, dark, at(0, cabin.floor + bh / 2, seats[0].z - 0.42)));
  }
  if (s.extras.includes('cage')) {
    const y0 = cabin.floor, y1 = (s.gh?.roof ?? 1.2) - 0.08, z0 = seats[0].z - 0.36, w = cabin.hw - 0.06;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const p: Paint = { kind: K.METAL, color: '#d8d8d8' };
    out.append(tube([V(w, y0, z0), V(w, y1, z0), V(-w, y1, z0), V(-w, y0, z0)], 0.022, p));
    out.append(tube([V(w, y1, z0), V(w * 0.9, y1 - 0.05, z0 + 0.95), V(w * 0.9, cabin.dashY, cabin.zA - 0.1)], 0.02, p));
    out.append(tube([V(-w, y1, z0), V(-w * 0.9, y1 - 0.05, z0 + 0.95), V(-w * 0.9, cabin.dashY, cabin.zA - 0.1)], 0.02, p));
    out.append(tube([V(w, y1, z0), V(-w, y0 + 0.2, z0)], 0.02, p));
  }
  return out;
}
