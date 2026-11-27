/** Car parts: tyres and several rim styles, superellipsoid blobs, interior, plates, lights and accessories. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Soup, gridSurface, spow, dropDegenerate, type Paint } from './soup';
import { K } from './kinds';
import type { CarShape, RimStyle } from '../shapes';
import { flatCopy } from '../../core/geom';

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
/** Deterministic design variant (0..2) so one rim style shows several alloy designs across the fleet. */
const variantOf = (s: CarShape) => Math.round(s.R * 1000 + s.tw * 1000 + s.W * 100) % 3;
/** Sidewall height as a fraction of the tyre radius (aspect ratio): sporty low profile, trucks tall. */
function sideFrac(s: CarShape): number {
  return s.type === 'car' ? (s.rim === 'race' || s.rim === 'mesh' || s.rim === 'spoke5' && s.R >= 0.33 ? 0.26 : 0.33) : 0.36;
}
/** One wheel at the origin, axle along x, outer face towards +x. */
export function wheelSoup(s: CarShape, lod: number): Soup {
  const R = s.R, hw = s.tw / 2;
  const Rr = R * (1 - sideFrac(s));
  const out = new Soup();
  // tyre: lathe profile from the inner bead over the rim protector, sidewall belly and rounded shoulder to the tread (mirrored)
  const mid = (Rr + R) / 2, side: [number, number][] = [
    // 7-point half profile (was 10): bead, protector, belly, shoulder and tread edge are enough for a round silhouette
    [Rr - 0.008, -hw + 0.014], [Rr + 0.017, -hw - 0.004], [Rr + (mid - Rr) * 0.8, -hw - 0.007], [mid + (R - mid) * 0.35, -hw - 0.009],
    [R - 0.045, -hw - 0.003], [R - 0.012, -hw + 0.016], [R - 0.001, -hw + 0.048]];
  const pr: [number, number][] = [...side, ...side.slice().reverse().map(([r, h]) => [r, -h] as [number, number])];
  // far lods: a 6-point profile (beads, shoulders, tread) keeps the tyre round when the body is clustered separately (R6-V)
  const prLo: [number, number][] = [[Rr, -hw], [R - 0.04, -hw], [R, -hw + 0.05], [R, hw - 0.05], [R - 0.04, hw], [Rr, hw]];
  const lathe = new THREE.LatheGeometry((lod ? prLo : pr).map(([r, h]) => new THREE.Vector2(r, h)), lod > 1 ? 12 : lod ? 18 : 28).rotateZ(-Math.PI / 2);
  const tyre = new Soup().addGeometry(lathe, { kind: K.RUBBER, color: '#1a1a1b' }); lathe.dispose();
  // material contract: u = angle, v = tread span (0..1) on the tread, 2 + x/hw on the sidewalls
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
  const style = s.rim, v = variantOf(s);
  const rimPaint: Paint = { kind: style === 'chrome' ? K.CHROME : K.RIM, color: s.rimColor };
  const faceX = hw - 0.03;
  if (lod) {
    const disc = new THREE.CircleGeometry(Rr - 0.004, lod > 1 ? 8 : 14).rotateY(Math.PI / 2).translate(faceX, 0, 0);
    out.addGeometry(disc, rimPaint); disc.dispose();
    if (lod === 1) out.append(cyl(0.05, 0.05, 0.01, { kind: K.METAL, color: '#3a3b3d' }, at(faceX + 0.006, 0, 0, 0, 0, -Math.PI / 2), 8));
    return out;
  }
  const dark: Paint = { kind: K.METAL, color: '#2a2b2d' };
  // barrel (rim well), vented brake disc with its hat and a hub, all visible between the spokes
  out.append(cyl(Rr - 0.006, Rr - 0.006, s.tw - 0.04, { kind: K.METAL, color: '#3c3e42' }, at(0, 0, 0, 0, 0, Math.PI / 2), 16, true));
  const disc = discR(s);
  out.append(cyl(disc, disc, 0.026, { kind: K.METAL, color: '#74767a' }, at(hw * 0.1, 0, 0, 0, 0, Math.PI / 2), 14));
  out.append(cyl(disc * 0.86, disc * 0.86, 0.034, { kind: K.METAL, color: '#4f5155' }, at(hw * 0.1, 0, 0, 0, 0, Math.PI / 2), 14));
  out.append(cyl(Rr * 0.34, Rr * 0.3, 0.05, dark, at(hw * 0.2, 0, 0, 0, 0, Math.PI / 2), 12));
  // face: disc with windows between spokes (straight, tapered or swirled), extruded and dished
  const ro = Rr - 0.004;
  const shape = new THREE.Shape(); shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
  /** n windows between n spokes; spokeHalf = spoke half-width (m), taper widens spokes at the hub, swirl twists them (rad). */
  const win = (n: number, r0: number, r1: number, spokeHalf: number, phase = 0, swirl = 0, taper = 0) => {
    const hs = (r: number) => Math.max(0.01, Math.PI / n - spokeHalf * (1 + taper * (1 - (r - r0) / (r1 - r0))) / r);
    const sw = (r: number) => swirl * (r - r0) / (r1 - r0);
    for (let i = 0; i < n; i++) {
      const c = phase + (i + 0.5) * Math.PI * 2 / n, pts: THREE.Vector2[] = [];
      const P = (r: number, a: number) => new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
      for (let k = 0; k <= 5; k++) pts.push(P(r1, c - hs(r1) + sw(r1) + 2 * hs(r1) * k / 5));
      const E = swirl === 0 ? (taper === 0 ? 1 : 2) : 4;
      for (let k = 1; k <= E; k++) { const r = r1 + (r0 - r1) * k / E; pts.push(P(r, c + hs(r) + sw(r))); }
      const in0 = hs(r0);
      if (in0 > 0.03) { for (let k = 1; k <= 2; k++) pts.push(P(r0, c + in0 + sw(r0) - 2 * in0 * k / 3)); }
      for (let k = E - 1; k >= 1; k--) { const r = r1 + (r0 - r1) * k / E; pts.push(P(r, c - hs(r) + sw(r))); }
      shape.holes.push(new THREE.Path().setFromPoints(pts.reverse()));
    }
  };
  const roundHoles = (n: number, rc: number, rh: number, phase = 0) => { for (let i = 0; i < n; i++) { const a = phase + i * Math.PI * 2 / n; const p = new THREE.Path(); p.absarc(Math.cos(a) * rc, Math.sin(a) * rc, rh, 0, Math.PI * 2, true); shape.holes.push(p); } };
  let dish = 0.02;
  const styleOf: Record<RimStyle, () => void> = {
    spoke5: () => { if (v === 0) win(5, ro * 0.3, ro * 0.88, 0.04, 0, 0, 0.5); else if (v === 1) win(5, ro * 0.3, ro * 0.88, 0.036, 0, 0.5, 0.35); else win(7, ro * 0.3, ro * 0.88, 0.026, 0, -0.3, 0.4); dish = 0.03; },
    multi: () => { if (v === 0) win(10, ro * 0.32, ro * 0.88, 0.016, 0, 0, 0.4); else if (v === 1) win(5, ro * 0.32, ro * 0.88, 0.05, 0, 0.35, 0.2); else win(9, ro * 0.32, ro * 0.88, 0.02, 0, 0.45, 0.3); dish = 0.02; },
    chrome: () => { win(15, ro * 0.3, ro * 0.88, 0.01); dish = 0.012; },
    race: () => { if (v === 1) win(5, ro * 0.22, ro * 0.9, 0.034, 0, 0, 0.5); else win(6, ro * 0.22, ro * 0.9, 0.02, 0, v ? 0.2 : 0, 0.4); dish = 0.035; },
    mesh: () => { win(10, ro * 0.6, ro * 0.88, 0.012, 0, 0.12); win(10, ro * 0.3, ro * 0.55, 0.012, Math.PI / 10, 0.12); dish = 0.03; },
    twin: () => { win(v === 1 ? 7 : 10, ro * 0.3, ro * 0.86, v === 1 ? 0.022 : 0.012, 0, v === 2 ? 0.3 : 0, 0.3); dish = 0.02; },
    steel: () => { roundHoles(8, ro * 0.62, ro * 0.075); dish = 0.035; },
    hubcap: () => { win(8, ro * 0.56, ro * 0.82, 0.05); dish = -0.025; },
    truck: () => { win(6, ro * 0.45, ro * 0.72, 0.075); dish = 0.06; },
  };
  styleOf[style]();
  const ex0 = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: false, curveSegments: style === 'steel' ? 6 : 10 });
  // drop the back cap (never visible behind the barrel): non-indexed copy without -z facing triangles
  const exn = flatCopy(ex0); ex0.dispose();
  { const a = exn.attributes.position, keep: number[] = [];
    for (let i = 0; i < a.count; i += 3) if (!(a.getZ(i) < 1e-6 && a.getZ(i + 1) < 1e-6 && a.getZ(i + 2) < 1e-6)) for (let k = 0; k < 3; k++) keep.push(a.getX(i + k), a.getY(i + k), a.getZ(i + k));
    exn.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); exn.deleteAttribute('normal'); exn.deleteAttribute('uv'); }
  const ex = exn;
  const pos = ex.attributes.position;
  for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)) / ro; pos.setZ(i, pos.getZ(i) + dish * (r - 1)); }
  ex.computeVertexNormals();
  ex.rotateY(Math.PI / 2).translate(faceX - 0.016, 0, 0);
  out.addGeometry(ex, rimPaint); ex.dispose();
  // polished lip, centre cap with a dark insert, hex lug nuts on the bolt circle, valve stem
  const lip = new THREE.TorusGeometry(ro, 0.011, 3, 28).rotateY(Math.PI / 2).translate(faceX - 0.004, 0, 0);
  out.addGeometry(lip, rimPaint); lip.dispose();
  const cx = faceX - (dish > 0 ? dish * 0.95 : 0) + 0.004;
  if (style === 'race') {
    out.append(cyl(0.04, 0.032, 0.05, { kind: K.CHROME }, at(cx + 0.02, 0, 0, 0, 0, -Math.PI / 2), 8));
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; out.append(cyl(0.007, 0.007, 0.03, { kind: K.CHROME }, at(cx + 0.012, Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0, 0, -Math.PI / 2), 5)); }
  } else {
    out.append(cyl(ro * 0.17, ro * 0.15, 0.022, style === 'hubcap' ? rimPaint : { kind: K.CHROME }, at(cx + 0.006, 0, 0, 0, 0, -Math.PI / 2), 14));
    out.append(cyl(ro * 0.08, ro * 0.08, 0.004, dark, at(cx + 0.018, 0, 0, 0, 0, -Math.PI / 2), 10));
    const nl = style === 'truck' ? 8 : s.R < 0.3 ? 4 : 5;
    for (let i = 0; i < nl; i++) { const a = i * Math.PI * 2 / nl + Math.PI / 2; out.append(cyl(0.012, 0.012, 0.024, { kind: K.CHROME }, at(cx, Math.cos(a) * ro * 0.27, Math.sin(a) * ro * 0.27, 0, 0, -Math.PI / 2), 5)); }
  }
  out.append(cyl(0.005, 0.005, 0.03, dark, at(faceX - 0.01, ro * 0.93, 0, 0, 0, -Math.PI / 2), 5));
  if (style === 'hubcap' || style === 'steel') {
    // steel wheel rim edge behind the cap
    const ring = new THREE.RingGeometry(ro * 0.82, ro, 24).rotateY(Math.PI / 2).translate(faceX - 0.02, 0, 0);
    out.addGeometry(ring, { kind: K.RIM, color: '#2c2d30' }); ring.dispose();
  }
  return out;
}
const discR = (s: CarShape) => s.R * (1 - sideFrac(s)) * (s.rim === 'race' || s.rim === 'mesh' || s.rim === 'twin' ? 0.8 : 0.74);

/** Brake caliper for one wheel (same frame as wheelSoup, outer face +x). It must ride the body/axle, not the rolling wheel bone.
 *  Only alloy styles show it between the spokes; hubcap / steel / truck wheels hide the brake. */
export function caliperSoup(s: CarShape): Soup {
  const out = new Soup();
  if (s.type === 'tank' || s.rim === 'hubcap' || s.rim === 'steel' || s.rim === 'truck') return out;
  const hw = s.tw / 2, dx = hw * 0.1, disc = discR(s);
  const colour = s.rim === 'race' ? '#d8b44a' : s.rim === 'mesh' || s.rim === 'twin' ? '#b3201c' : s.rim === 'chrome' ? '#8a8d91' : variantOf(s) === 1 ? '#b3201c' : '#4a4d52';
  const p: Paint = { kind: K.METAL, color: colour };
  const bx = (w: number, h: number, d: number, m: THREE.Matrix4) => { const g = new THREE.BoxGeometry(w, h, d); const r = new Soup().addGeometry(g, p, m); g.dispose(); return r; };
  const a = 0.5, ca = Math.cos(a), sa = Math.sin(a); // above the axle, on the trailing (rear) side
  const rc = disc * 0.8, y = ca * rc, z = -sa * rc, rot = -a;
  out.append(bx(0.032, disc * 0.34, 0.15,  at(dx + 0.032, y, z, rot)));  // outboard piston housing
  out.append(bx(0.032, disc * 0.34, 0.15,  at(dx - 0.032, y, z, rot)));  // inboard housing
  out.append(bx(0.088, 0.03, 0.15,  at(dx, ca * disc * 0.97, -sa * disc * 0.97, rot))); // bridge over the disc edge
  out.append(cyl(0.011, 0.011, 0.02, { kind: K.METAL, color: '#9a9ca0' }, at(dx + 0.05, y + 0.04 * ca, z - 0.04 * sa, 0, 0, -Math.PI / 2), 6)); // bleed nipple
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
  // two mounting screws on the frame's top edge
  const dz = front ? 1 : -1;
  for (const sx of [-0.2, 0.2]) s.append(cyl(0.008, 0.008, 0.008, { kind: K.CHROME }, at(x + sx, y + 0.062, z + dz * 0.001, Math.PI / 2 + tiltX * 0), 6));
  return s;
}

// ---------------------------------------------------------------------------------------------- small exterior parts
/** Side mirror for the +x side at (x, y, z) = the glass centre line; mirror with sg: -1 by the caller. Local x points outward.
 *  Housing shell, a stalk to the door, a recessed glass pane and a dark inner rim. Paint it onto the door bone. */
export function mirrorSoup(sg: number, mx: number, my: number, mz: number, shell: Paint, trim: Paint): Soup {
  const out = new Soup(), X = sg * (mx + 0.11);
  out.append(blob(0.095, 0.062, 0.058, 2.6, shell, at(X, my, mz), 14, 9));
  out.append(rbox(0.13, 0.03, 0.05, 0.012, trim, at(sg * (mx + 0.03), my - 0.035, mz + 0.012, 0, 0, sg * 0.18)));      // stalk
  out.append(rbox(0.05, 0.022, 0.06, 0.008, trim, at(sg * (mx + 0.005), my - 0.045, mz + 0.02)));                        // base pad on the door
  out.append(blob(0.088, 0.054, 0.012, 3, { kind: K.TRIM, color: '#0e0e10' }, at(X, my, mz - 0.044), 12, 6));           // rim around the glass
  out.append(blob(0.08, 0.048, 0.009, 3, { kind: K.MIRROR, color: '#ffffff' }, at(X, my, mz - 0.05), 12, 6));           // glass, set into the rim
  return out;
}
/** Flush door handle: a dark recess pocket with a lever inside it. Faces +x (mirror via sg). */
export function handleSoup(sg: number, hx: number, hy: number, hz: number, lever: Paint): Soup {
  const out = new Soup();
  out.append(rbox(0.014, 0.05, 0.2, 0.008, { kind: K.TRIM, color: '#0d0d0f' }, at(sg * (hx - 0.002), hy, hz)));         // pocket
  out.append(rbox(0.022, 0.026, 0.15, 0.011, lever, at(sg * (hx + 0.008), hy + 0.002, hz + 0.004)));                    // lever
  out.append(rbox(0.012, 0.03, 0.03, 0.006, { kind: K.TRIM, color: '#161618' }, at(sg * (hx + 0.004), hy + 0.002, hz - 0.085))); // key cylinder end
  return out;
}
/** Windscreen wiper parked at the base of the glass: pivot, arm and a blade with a rubber edge (blade centred at cx; the
 *  pivot sits 0.23 m towards +x). ry / rz follow the screen's slope. */
export function wiperSoup(cx: number, y: number, z: number, ry: number, rz: number, trim: Paint): Soup {
  const out = new Soup();
  out.append(cyl(0.013, 0.013, 0.03, trim, at(cx + 0.23, y - 0.004, z - 0.03), 6));
  out.append(rbox(0.5, 0.012, 0.02, 0.005, trim, at(cx, y, z, 0, ry, rz)));
  out.append(rbox(0.5, 0.006, 0.012, 0.003, { kind: K.RUBBER, color: '#0c0c0d' }, at(cx, y - 0.007, z + 0.004, 0, ry, rz)));
  out.append(rbox(0.3, 0.008, 0.012, 0.004, trim, at(cx + 0.1, y + 0.004, z - 0.025, 0, ry, rz)));
  return out;
}
/** Exhaust tailpipe tip: chrome rolled lip, open throat and a dark inner tube, axis along z, opening towards -z. */
export function exhaustTip(x: number, y: number, z: number, r = 0.037, chromeTip = true): Soup {
  const out = new Soup();
  const shell: Paint = chromeTip ? { kind: K.CHROME } : { kind: K.METAL, color: '#5a5c60' };
  out.append(cyl(r, r, 0.16, shell, at(x, y, z + 0.08, Math.PI / 2), 14, true));
  out.append(cyl(r * 0.86, r * 0.86, 0.14, { kind: K.METAL, color: '#0b0b0c' }, at(x, y, z + 0.075, Math.PI / 2), 12, true));
  const lip = new THREE.TorusGeometry(r, 0.006, 5, 16).translate(x, y, z);
  out.addGeometry(lip, shell); lip.dispose();
  out.append(cyl(r * 0.5, r * 0.5, 0.02, { kind: K.METAL, color: '#050505' }, at(x, y, z + 0.1, Math.PI / 2), 10));
  return out;
}
/** Whip antenna: a base mount, a tapering stalk and a ball tip. */
export function antennaSoup(x: number, y: number, z: number, len = 0.7): Soup {
  const out = new Soup(), trim: Paint = { kind: K.TRIM, color: '#141416' };
  out.append(cyl(0.02, 0.026, 0.03, trim, at(x, y + 0.012, z), 10));
  out.append(cyl(0.0035, 0.007, len, trim, at(x, y + len / 2 + 0.02, z), 5));
  out.append(blob(0.008, 0.008, 0.008, 2, trim, at(x, y + len + 0.02, z), 6, 4));
  return out;
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
