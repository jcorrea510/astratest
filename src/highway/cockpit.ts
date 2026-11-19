/**
 * First-person cabin for the highway player's car, laid out around the driver's eye: a lofted soft-touch dash that meets the
 * windshield base, thin dark A-pillars from the windshield corners, a header + headliner (only a sliver shows at the top of the
 * view), door sills with a door mirror on its sail, a recessed instrument cluster seen through the top of a three-spoke wheel
 * (needles move, the wheel turns with the front wheels), an infotainment screen and a rear-view mirror. The body shell's own
 * greenhouse is cut away (cabinshell.ts), so only this geometry frames the view. Built once in car-local coordinates (x left,
 * y up, z forward) and merged per material: about twenty draw calls.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getTemplate } from '../vehicles/models/build';
import type { VehicleKind } from '../vehicles/specs';
import { MirrorRT, CROP, cropUv, sideMirrorsLive, type MirrorQuality } from './mirrors';
import { cabinFrame, type CabinFrame } from './cabinshell';
import { clockText, nextExit, tripText } from './infotext';
import { canvas, tex, grainBump, leatherMap, carpetMap, clusterFace, drawInfotainment, dashSkin, pebbleBump, needleAngle, FONT, SCREEN_PERIOD, type ScreenState } from './cockpitTex';

export { needleAngle, SCREEN_PERIOD };
const D2R = Math.PI / 180;
/** Steering wheel travel shown for full road-wheel lock: 2.5 turns lock to lock = +-450 degrees. */
export const WHEEL_LOCK_RAD = 450 * D2R;
/** Wheel turn shown (-1..1 of +-450 deg): the real road-wheel lock fraction, but never less than 20% of the key input so the wheel is always clearly seen turning at speed. */
export const wheelFrac = (lockFrac: number, input: number): number => Math.abs(lockFrac) > Math.abs(input) * 0.2 ? lockFrac : input * 0.2;
/** First-person view: vertical field of view (deg) and how far the view is pitched below the horizon (rad). */
export const COCKPIT_FOV = 58, COCKPIT_PITCH = 6 * D2R;
/** Steering wheel: centre this far below the eye's horizon (rad) at this distance (m), rim radius, column tilt from vertical. */
const WHEEL_DOWN = 28 * D2R, WHEEL_DIST = 0.6, WHEEL_R = 0.185, WHEEL_TILT = 24 * D2R;

export interface CockpitDims { eye: THREE.Vector3; wheelZ: number; dashY: number; belt: number; pitch: number; fov: number }

/**
 * Eye point (car frame) for a cabin: on the driver seat, ~62 cm above the cushion but always well under the windshield header and
 * clear over the beltline, a little ahead of the seat so the A-pillar bases sit out toward the window corners.
 */
export function eyePoint(S: { x: number; y: number; z: number }, fr: CabinFrame, roofY: number): THREE.Vector3 {
  const T = fr.top;
  const y = Math.max(fr.belt + 0.12, Math.min(S.y + 0.62, T.y - 0.17, roofY - 0.2));
  const z = Math.min(S.z + 0.06, Math.max(S.z - 0.05, T.z - (T.y - y) / Math.tan(24 * D2R))); // move up to 5 cm forward on low roofs so the header stays above the view
  return new THREE.Vector3(S.x, y, z);
}

/** Lofted surface: rows of points (one row per x station) -> indexed grid with uv = (u along rows in metres, v along each row in metres). */
function loft(rows: THREE.Vector3[][], uScale = 1, vScale = 1): THREE.BufferGeometry {
  const nr = rows.length, nc = rows[0].length, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const u: number[] = [0];
  for (let i = 1; i < nr; i++) u.push(u[i - 1] + rows[i][0].distanceTo(rows[i - 1][0]));
  for (let i = 0; i < nr; i++) {
    let v = 0;
    for (let j = 0; j < nc; j++) {
      if (j) v += rows[i][j].distanceTo(rows[i][j - 1]);
      const p = rows[i][j]; pos.push(p.x, p.y, p.z); uv.push(u[i] * uScale, v * vScale);
    }
  }
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class Cockpit {
  readonly group = new THREE.Group();
  readonly dims: CockpitDims;
  readonly frame: CabinFrame;
  private wheelSpin = new THREE.Group();
  private needleSpeed = new THREE.Group(); private needleRpm = new THREE.Group();
  private digital: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; t: THREE.CanvasTexture; mph: number };
  private disposables: { dispose(): void }[] = [];
  private maxMph: number; private wheel = 0; private spd = -1;
  private screenCtx!: CanvasRenderingContext2D; private screenTex!: THREE.CanvasTexture; private screenAcc = 1; private st: ScreenState = { hour: 12.8, meters: 0, mph: 0, time: 0 };
  private tripCtx!: CanvasRenderingContext2D; private tripTex!: THREE.CanvasTexture;
  private emissive: THREE.MeshStandardMaterial[] = [];
  /** what the screens last showed and how many times they were repainted (tests read this) */
  readonly screenLog = { clock: '', exit: '', trip: '', redraws: 0 };
  /** world-independent positions of the mirror glasses (car frame), for tests and tuning */
  readonly mirrorSpots: { rear: THREE.Vector3; side: THREE.Vector3[] } = { rear: new THREE.Vector3(), side: [] };

  /** shared live-reflection target for the rear-view and side mirrors */
  readonly mirror: MirrorRT;
  constructor(kind: VehicleKind, quality: MirrorQuality = 'medium') {
    const tp = getTemplate(kind), S = tp.seats[0], fr = cabinFrame(kind), W = tp.shape.W;
    this.frame = fr; this.maxMph = 160;
    const belt = fr.belt, B = fr.base, T = fr.top, E = eyePoint(S, fr, tp.roofY);
    // steering wheel centre on a ray 28 degrees under the eye's horizon
    const wc = new THREE.Vector3(S.x, E.y - WHEEL_DIST * Math.sin(WHEEL_DOWN), E.z + WHEEL_DIST * Math.cos(WHEEL_DOWN));
    // rear edge (brow) of the dash top: just ahead of the wheel's top rim, never closer than 7 cm to the windshield base
    const zBrow = Math.min(wc.z + 0.12, B.z - 0.1);
    // brow height: seen 13 degrees under the eye's horizon whatever the car, so the cluster always shows through the top of the
    // wheel; on tall cabins (SUVs, trucks) the dash rises from the windshield base to a raised brow
    const yBrow = Math.max(belt, E.y - (zBrow - E.z) * Math.tan(13 * D2R)), lift = yBrow - belt;
    this.dims = { eye: E, wheelZ: wc.z, dashY: belt - 0.09, belt, pitch: COCKPIT_PITCH, fov: COCKPIT_FOV };

    const pebble = pebbleBump(), skin = dashSkin(), bump = grainBump(), leather = leatherMap('#2b2622'), carpet = carpetMap();
    this.disposables.push(pebble, skin, bump, leather, carpet);
    const std = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ envMapIntensity: 0.6, ...o }); this.disposables.push(m); this.emissive.push(m); return m; };
    const mats = {
      dash: std({ color: 0xffffff, map: skin, roughness: 0.82, metalness: 0, bumpMap: pebble, bumpScale: 0.6, emissive: 0x060607, envMapIntensity: 0.35 }),
      plastic: std({ color: 0x1a1b1d, roughness: 0.7, metalness: 0, bumpMap: bump, bumpScale: 0.4, emissive: 0x060607 }),
      fabric: std({ color: 0x222224, roughness: 0.96, metalness: 0, bumpMap: bump, bumpScale: 0.25, emissive: 0x070708, envMapIntensity: 0.15, side: THREE.DoubleSide }),
      leather: std({ color: 0xffffff, map: leather, roughness: 0.6, metalness: 0, envMapIntensity: 0.45, emissive: 0x0b0a09 }),
      trim: std({ color: 0x9aa1aa, roughness: 0.28, metalness: 1, emissive: 0x050505 }),
      gloss: std({ color: 0x08090b, roughness: 0.16, metalness: 0.25, envMapIntensity: 0.7 }),
      carpet: std({ color: 0xffffff, map: carpet, roughness: 1, metalness: 0, emissive: 0x040404 }),
    };
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const put = (m: THREE.Material, geo: THREE.BufferGeometry) => { (buckets.get(m) ?? buckets.set(m, []).get(m)!).push(geo); };
    const add = (m: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1)));
      put(m, geo);
    };
    const rb = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // ---- dashboard: one lofted skin across the car - tucked under the windshield base, a gently crowned top, a rounded brow
    // over the cluster, then the fascia falling away toward the floor
    const xD = B.x + 0.07, bz = B.z - 0.03;
    const zf = (x: number) => { const k = Math.min(1, Math.abs(x) / B.x); return Math.max(zBrow + 0.09, fr.baseCz - (fr.baseCz - bz) * Math.pow(k, 2.2)); };
    const rows: THREE.Vector3[][] = [];
    for (let i = 0; i <= 44; i++) {
      const x = -xD + (2 * xD * i) / 44, f = zf(x), crown = 0.012 * (1 - Math.pow(Math.abs(x) / xD, 4)), lt = lift * (1 - Math.pow(Math.abs(x) / xD, 5)), yr = belt + lt; // a raised dash rolls down to the doors
      rows.push([
        V(x, belt - 0.035, f + 0.03), V(x, belt - 0.004, f), V(x, belt + 0.006 + crown * 0.5 + lt * 0.15, f - 0.04),
        V(x, belt + 0.01 + crown + lt * 0.7, f + (zBrow - f) * 0.55), V(x, yr + 0.006 + crown * 0.6, zBrow + 0.035),
        V(x, yr - 0.012, zBrow + 0.008), V(x, yr - 0.04, zBrow), V(x, yr - 0.075, zBrow + 0.012),
        V(x, yr - 0.16, zBrow + 0.035), V(x, yr - 0.3, zBrow + 0.08), V(x, Math.min(yr - 0.46, belt - 0.5), zBrow + 0.15),
      ]);
    }
    put(mats.dash, loft(rows, 1.6, 1.6));
    // cluster binnacle: a small hood over the gauges and a dark surround they sit in
    const clW = 0.3, clH = 0.107, clZ = zBrow - 0.012, clY = yBrow - 0.075;
    const clTilt = Math.atan2(E.y - clY, clZ - E.z) * 0.8;
    add(mats.plastic, rb(clW + 0.05, 0.016, 0.045, 0.007), S.x, yBrow - 0.012, zBrow - 0.014, -0.06);
    add(mats.gloss, rb(clW + 0.03, clH + 0.03, 0.03, 0.012), S.x, clY, clZ + 0.018, clTilt);
    // centre air vents and outboard vents, set into the fascia
    for (const vx of [0.075, -0.075, B.x - 0.11, -(B.x - 0.11)]) {
      const yv = belt + lift * (1 - Math.pow(Math.abs(vx) / xD, 5)) - 0.048;
      add(mats.gloss, rb(0.11, 0.032, 0.02, 0.008), vx, yv, zBrow + 0.002);
      for (let s = 0; s < 3; s++) add(mats.plastic, rb(0.105, 0.0025, 0.004, 0.001), vx, yv - 0.01 + s * 0.01, zBrow - 0.009);
    }
    // centre stack under the screen, climate keys, console between the seats
    add(mats.plastic, rb(0.27, 0.26 + lift, 0.16, 0.04), 0, yBrow - 0.33 - lift / 2, zBrow + 0.1);
    add(mats.plastic, rb(0.3, 0.3, 1.0, 0.07), 0, S.y - 0.06, S.z + 0.05);
    add(mats.gloss, rb(0.24, 0.02, 0.5, 0.008), 0, S.y + 0.1, S.z + 0.22);
    add(mats.leather, rb(0.25, 0.06, 0.36, 0.03), 0, S.y + 0.12, S.z - 0.34);
    add(mats.gloss, new THREE.SphereGeometry(0.028, 12, 8), 0, S.y + 0.16, S.z + 0.35);
    add(mats.trim, new THREE.CylinderGeometry(0.01, 0.012, 0.05, 8), 0, S.y + 0.13, S.z + 0.35);
    add(mats.carpet, new THREE.PlaneGeometry(xD * 2, 3.4).rotateX(-Math.PI / 2), 0, S.y - 0.34, zBrow - 1.6);

    // ---- A-pillars (thin trim strips bulging into the cabin), the sail panels and door mirrors, door sills and cards
    const sideMirrors: { pos: THREE.Vector3; yaw: number; sx: number }[] = [];
    for (const sx of [1, -1]) {
      const bi = V(sx * (B.x + 0.02), belt + 0.004, bz), bo = V(sx * (B.x + 0.068), belt + 0.004, B.z - 0.09);
      const ti = V(sx * (T.x + 0.072), T.y + 0.012, T.z + 0.008), to = V(sx * (T.x + 0.1), T.y - 0.015, T.z - 0.04);
      const prow: THREE.Vector3[][] = [], mid = V(0, (belt + T.y) / 2, (bz + T.z) / 2 - 0.4);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, a = bi.clone().lerp(ti, t), b = bo.clone().lerp(to, t), axis = ti.clone().sub(bi), e = b.clone().sub(a);
        const n = axis.cross(e).normalize(); if (n.dot(mid.clone().sub(a)) < 0) n.negate();
        const row: THREE.Vector3[] = [];
        for (let j = 0; j <= 6; j++) { const s = j / 6; row.push(a.clone().lerp(b, s).addScaledVector(n, 0.018 * Math.sin(Math.PI * s))); }
        prow.push(row);
      }
      put(mats.fabric, loft(prow, 2, 2));
      // sail: triangle panel between the pillar foot and the sill that the mirror is mounted on
      const sailTop = bo.clone().lerp(to, 0.24), sailBack = V(sx * (B.x + 0.07), belt + 0.006, B.z - 0.3);
      const sail = new THREE.BufferGeometry().setFromPoints([bi, bo, sailTop, bo, sailBack, sailTop]); sail.computeVertexNormals();
      sail.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2)); put(mats.fabric, sail);
      // door sill (rounded top of the door card at the beltline), door card, armrest, pull, switch pack
      const z0 = bz, z1 = E.z - 0.95, len = z0 - z1, zc = (z0 + z1) / 2;
      const sillW = Math.max(0.1, W / 2 + 0.02 - (B.x + 0.02));   // reaches the outer door skin so no body paint shows past it
      add(mats.plastic, rb(sillW, 0.05, len, 0.02), sx * (B.x + 0.02 + sillW / 2), belt + 0.002, zc);   // sill top sits ~2.5 cm over the beltline, hiding the fender
      add(mats.dash, rb(0.06, 0.5, len, 0.02), sx * (B.x + 0.06), belt - 0.255, zc);
      add(mats.leather, rb(0.09, 0.06, 0.42, 0.03), sx * (B.x - 0.0), belt - 0.22, E.z + 0.05);
      add(mats.gloss, rb(0.03, 0.022, 0.18, 0.01), sx * (B.x + 0.02), belt - 0.13, E.z + 0.32);
      add(mats.gloss, rb(0.05, 0.025, 0.14, 0.01), sx * (B.x - 0.005), belt - 0.185, E.z + 0.12);
      // door mirror: housing just outboard of the sail, glass turned to the driver (half way between facing the eye and facing back)
      const M = V(sx * (B.x + 0.13), belt + 0.062, B.z - 0.08);
      const toEye = Math.atan2(E.x - M.x, E.z - M.z);
      const back = Math.PI * (toEye >= 0 ? 1 : -1), myaw = (toEye + back) / 2;
      add(mats.plastic, rb(0.195, 0.115, 0.075, 0.03), M.x, M.y, M.z, 0, myaw);
      add(mats.plastic, rb(0.08, 0.045, 0.07, 0.015), sx * (B.x + 0.05), belt + 0.03, B.z - 0.1);   // foot on the sail
      sideMirrors.push({ pos: M, yaw: myaw, sx });
    }
    // windshield header, headliner and folded sun visors (a hardtop only)
    const hx = T.x + 0.1;
    add(mats.fabric, fr.open ? rb(hx * 2, 0.035, 0.07, 0.015) : rb(hx * 2, 0.06, 0.12, 0.03), 0, T.y + (fr.open ? 0.012 : 0.02), T.z - (fr.open ? 0.02 : 0.035));
    if (!fr.open) {
      const zh0 = T.z - 0.05, zh1 = Math.min(E.z - 0.8, (tp.shape.gh?.zR2 ?? E.z - 1.1) + 0.04);
      add(mats.fabric, rb(hx * 2 + 0.1, 0.02, zh0 - zh1, 0.01), 0, fr.roofIn, (zh0 + zh1) / 2);
      for (const sx of [1, -1]) add(mats.fabric, rb(0.36, 0.024, 0.17, 0.011), sx * 0.36, Math.min(fr.roofIn, T.y + 0.04) - 0.022, T.z - 0.13);
    }

    // ---- seats (cushion, back, bolsters, headrest) for the front pair and a rear bench
    const seat = (x: number, y: number, z: number, w: number) => {
      add(mats.leather, rb(w, 0.13, 0.52, 0.06), x, y - 0.05, z + 0.02, 0.05);
      add(mats.leather, rb(w, 0.62, 0.17, 0.07), x, y + 0.27, z - 0.26, -0.2);
      add(mats.leather, rb(0.07, 0.4, 0.2, 0.03), x - w / 2 + 0.02, y + 0.2, z - 0.2, -0.2);
      add(mats.leather, rb(0.07, 0.4, 0.2, 0.03), x + w / 2 - 0.02, y + 0.2, z - 0.2, -0.2);
      add(mats.leather, rb(0.27, 0.19, 0.1, 0.05), x, y + 0.66, z - 0.36, -0.2);
    };
    for (const st of tp.seats.slice(0, 2)) seat(st.x, st.y, st.z, 0.5);
    const rear = tp.seats[2];
    if (rear) { add(mats.leather, rb(xD * 2 - 0.1, 0.14, 0.52, 0.06), 0, rear.y - 0.05, rear.z + 0.02); add(mats.leather, rb(xD * 2 - 0.1, 0.6, 0.17, 0.07), 0, rear.y + 0.26, rear.z - 0.26, -0.2); }

    // ---- rear-view mirror: 20 deg right of and 10 deg above the eye's line of sight, as far out as the windshield allows (it hangs
    // from a short stalk on the glass); its size scales with the distance so it always looks the same size from the seat
    const glassZ = (y: number) => fr.baseCz + ((y - belt) / Math.max(0.05, T.y - belt)) * (T.z - fr.baseCz); // windshield centre line
    const ry0 = 20 * D2R, el = 10 * D2R;
    let d = 0.6, R = V(0, 0, 0);
    for (; d > 0.3; d -= 0.01) { R = V(E.x - d * Math.cos(el) * Math.sin(ry0), E.y + d * Math.sin(el), E.z + d * Math.cos(el) * Math.cos(ry0)); if (R.z + 0.02 <= glassZ(R.y + 0.13 * d)) break; }
    const mW = 0.37 * d, mH = mW * 0.3, rToEye = Math.atan2(E.x - R.x, E.z - R.z), rYaw = (rToEye + Math.PI * (rToEye >= 0 ? 1 : -1)) / 2 * 0.25 + rToEye * 0.75;
    const yMount = Math.max(R.y + mH / 2 + 0.012, belt + ((R.z + 0.01 - fr.baseCz) / (T.z - fr.baseCz)) * (T.y - belt));
    const glassTilt = Math.atan2(T.y - belt, fr.baseCz - T.z);   // windshield rake from horizontal
    add(mats.plastic, rb(0.016, yMount - R.y - mH / 2 + 0.01, 0.016, 0.006), R.x, (yMount + R.y + mH / 2) / 2, R.z + 0.012);
    add(mats.plastic, rb(0.04, 0.012, 0.055, 0.005), R.x, yMount, R.z + 0.012, -glassTilt);
    add(mats.gloss, rb(mW, mH, 0.034, mH * 0.33), R.x, R.y, R.z, 0, rYaw);
    // tinted shade band across the top of the windshield with the black frit patch behind the mirror mount
    // its lower edge sits 17 degrees above the eye's horizon (a thin strip at the top of the view on every car)
    let yb = T.y - 0.03;
    for (let y = T.y - 0.03; y > belt + 0.05; y -= 0.005) { yb = y; if ((y - E.y) / Math.max(0.05, glassZ(y) - E.z) < Math.tan(17 * D2R)) break; }
    const xw = T.x + 0.07, bandGeo = new THREE.BufferGeometry(), bp: number[] = [], buv: number[] = [], bix: number[] = [];
    const pillarAt = (y: number) => { const t = Math.min(1, Math.max(0, (y - belt) / (T.y + 0.012 - belt))); return { x: B.x + 0.02 + (T.x + 0.072 - B.x - 0.02) * t, z: bz + (T.z + 0.008 - bz) * t }; };
    for (let r = 0; r < 2; r++) {
      const y = r ? yb : T.y, pe = pillarAt(y), zc = glassZ(y);
      for (let c = 0; c <= 8; c++) { const u = c / 8, xx = pe.x * (1 - 2 * u), k = (xx / pe.x) ** 2; bp.push(xx, y, zc + (pe.z - zc) * k - 0.004); buv.push(u, 1 - r); }
    }
    for (let c = 0; c < 8; c++) bix.push(c, 9 + c, c + 1, c + 1, 9 + c, 10 + c);
    bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bandGeo.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2)); bandGeo.setIndex(bix);
    void xw;
    const [bc, bg] = canvas(512, 64), grad = bg.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(6,8,10,0.97)'); grad.addColorStop(0.3, 'rgba(10,14,20,0.8)'); grad.addColorStop(1, 'rgba(14,20,28,0)');
    bg.fillStyle = grad; bg.fillRect(0, 0, 512, 64);
    const xt = (pillarAt(T.y).x + pillarAt(yb).x) / 2, fu = ((xt - R.x) / (2 * xt)) * 512, fw = (0.1 / (2 * xt)) * 512, fy = Math.min(60, ((T.y - yMount) / (T.y - yb)) * 64 + 6);
    bg.fillStyle = 'rgba(5,6,8,0.98)'; bg.beginPath(); bg.moveTo(fu - fw * 0.5, 0); bg.lineTo(fu + fw * 0.5, 0); bg.lineTo(fu + fw * 0.4, fy); bg.lineTo(fu - fw * 0.4, fy); bg.closePath(); bg.fill();
    for (let yy = 2; yy < fy + 10; yy += 3) for (let xx = -fw * 0.75; xx <= fw * 0.75; xx += 3) { const r = Math.abs(xx) / (fw * 0.75); if (r > 0.6 || yy > fy) { bg.globalAlpha = 0.85; bg.beginPath(); bg.arc(fu + xx, yy, 1.1 * (1 - r * 0.6), 0, 7); bg.fill(); } }
    bg.globalAlpha = 1;
    const bandTex = tex(bc, true, 0, 4), bandMat = new THREE.MeshBasicMaterial({ map: bandTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const band = new THREE.Mesh(bandGeo, bandMat); band.frustumCulled = false; band.renderOrder = 2; this.group.add(band);
    this.disposables.push(bandGeo, bandTex, bandMat);
    this.mirrorSpots.rear.copy(R);
    const [mc, mg] = canvas(256, 64); const mirrorTex = tex(mc, true); this.disposables.push(mirrorTex);
    mg.fillStyle = '#3a4048'; mg.fillRect(0, 0, 256, 32); mg.fillStyle = '#2a2a2c'; mg.fillRect(0, 32, 256, 32); mirrorTex.needsUpdate = true;
    this.mirror = new MirrorRT(quality); this.disposables.push(this.mirror);
    const liveMat = new THREE.MeshBasicMaterial({ map: this.mirror.texture, fog: false }); this.disposables.push(liveMat);
    const paintMat = new THREE.MeshBasicMaterial({ map: mirrorTex, toneMapped: false, fog: false, color: 0x9aa4b0 }); this.disposables.push(paintMat);
    const glassAt = (mat: THREE.Material, w: number, h: number, crop: readonly [number, number, number, number], p: THREE.Vector3, ry: number, out: number) => {
      const geo = new THREE.PlaneGeometry(w, h); cropUv(geo, crop); this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.position.set(p.x + Math.sin(ry) * out, p.y, p.z + Math.cos(ry) * out); m.rotation.set(0, ry, 0); this.group.add(m); return m;
    };
    glassAt(liveMat, mW * 0.91, mH * 0.78, CROP.rear, R, rYaw, 0.018);
    this.mirror.cam.position.copy(R); this.group.add(this.mirror.cam);
    for (const sm of sideMirrors) {
      const live = sideMirrorsLive(quality), crop = sm.sx > 0 ? CROP.left : CROP.right;
      glassAt(live ? liveMat : paintMat, 0.175, 0.092, live ? crop : [0, 1, 0, 1], sm.pos, sm.yaw, 0.039);
      this.mirrorSpots.side.push(sm.pos.clone());
    }

    // merge every material bucket into one mesh
    for (const [m, parts] of buckets) {
      const geos = parts.map(p => {
        const g = p.index ? p.toNonIndexed() : p, c = new THREE.BufferGeometry();
        c.setAttribute('position', g.getAttribute('position')); c.setAttribute('normal', g.getAttribute('normal'));
        c.setAttribute('uv', g.getAttribute('uv') ?? new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        return c;
      });
      const merged = mergeGeometries(geos, false);
      for (const p of parts) p.dispose();
      if (!merged) continue;
      this.disposables.push(merged);
      const mesh = new THREE.Mesh(merged, m); mesh.frustumCulled = false; this.group.add(mesh);
    }

    // ---- cluster face, needles, digital speed (basic materials so they glow regardless of exposure)
    const face = clusterFace(); this.disposables.push(face);
    const clusterMat = new THREE.MeshBasicMaterial({ map: face, toneMapped: false }); this.disposables.push(clusterMat);
    const cluster = new THREE.Group(); cluster.position.set(S.x, clY, clZ); cluster.rotation.set(0, Math.PI, 0, 'YXZ'); cluster.rotateX(-clTilt);
    const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(clW, clH), clusterMat); facePlane.frustumCulled = false; cluster.add(facePlane);
    this.disposables.push(facePlane.geometry);
    const needleMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false }); this.disposables.push(needleMat);
    const k = clW / 720; // face is 720x256 px; dial centres at x = 176 / 544 px, y = 130 px
    const mkNeedle = (g: THREE.Group, x: number) => {
      const len = 92 * k, geo = new THREE.PlaneGeometry(7 * k, len).translate(0, len / 2 - 12 * k, 0); this.disposables.push(geo);
      const m = new THREE.Mesh(geo, needleMat); m.frustumCulled = false; m.position.z = 0.0008; g.add(m);
      const hubG = new THREE.CircleGeometry(12 * k, 12); this.disposables.push(hubG);
      const hub = new THREE.Mesh(hubG, needleMat); hub.position.z = 0.001; g.add(hub);
      g.position.set(x, clH * (0.5 - 130 / 256), 0.0009); cluster.add(g); g.rotation.z = needleAngle(0);
    };
    mkNeedle(this.needleRpm, (176 - 360) * k); mkNeedle(this.needleSpeed, (544 - 360) * k);
    const [dc, dg] = canvas(128, 56); const dt = tex(dc, true, 0, 4); this.disposables.push(dt);
    this.digital = { c: dc, g: dg, t: dt, mph: -1 };
    const dMat = new THREE.MeshBasicMaterial({ map: dt, transparent: true, toneMapped: false }); this.disposables.push(dMat);
    const dGeo = new THREE.PlaneGeometry(64 * k, 28 * k); this.disposables.push(dGeo);
    const dPlane = new THREE.Mesh(dGeo, dMat); dPlane.position.set((544 - 360) * k, clH * (0.5 - 130 / 256) - 34 * k, 0.0007); dPlane.frustumCulled = false; cluster.add(dPlane);
    const [tc, tg] = canvas(220, 64); this.tripCtx = tg; this.tripTex = tex(tc, true, 0, 4); this.disposables.push(this.tripTex);
    const tMat = new THREE.MeshBasicMaterial({ map: this.tripTex, transparent: true, toneMapped: false }); this.disposables.push(tMat);
    const tGeo = new THREE.PlaneGeometry(220 * k, 64 * k); this.disposables.push(tGeo);
    const tPlane = new THREE.Mesh(tGeo, tMat); tPlane.position.set(0, clH * (0.5 - 208 / 256), 0.0007); tPlane.frustumCulled = false; cluster.add(tPlane);
    this.group.add(cluster);
    this.drawDigital(0);

    // ---- infotainment screen in the fascia, turned toward the driver
    const [sc, sg] = canvas(640, 360); this.screenCtx = sg; const scr = tex(sc, true, 0, 8); this.screenTex = scr; this.disposables.push(scr);
    this.paintScreen();
    const scrMat = new THREE.MeshBasicMaterial({ map: scr, toneMapped: false, color: 0xa8b0b8 }); this.disposables.push(scrMat);
    const sP = V(0, yBrow - 0.105, zBrow - 0.012), sYaw = Math.atan2(E.x - sP.x, E.z - sP.z) - Math.PI, sTilt = Math.atan2(E.y - sP.y, sP.z - E.z) * 0.6;
    const scrGeo = new THREE.PlaneGeometry(0.24, 0.135); this.disposables.push(scrGeo);
    const screen = new THREE.Mesh(scrGeo, scrMat); screen.frustumCulled = false;
    screen.position.copy(sP); screen.rotation.set(0, Math.PI + sYaw * 0.3, 0, 'YXZ'); screen.rotateX(-sTilt);
    const bezelGeo = rb(0.256, 0.15, 0.022, 0.01); this.disposables.push(bezelGeo);
    const bezel = new THREE.Mesh(bezelGeo, mats.gloss); bezel.frustumCulled = false; bezel.position.copy(sP); bezel.rotation.copy(screen.rotation); bezel.translateZ(-0.0115);
    this.group.add(bezel, screen);

    // ---- steering wheel: tilted column group; the spin group turns with the front wheels
    const column = new THREE.Group(); column.position.copy(wc); column.rotation.x = WHEEL_TILT; this.group.add(column);
    column.add(this.wheelSpin);
    const rimMat = std({ color: 0x9a9a9a, map: leather, roughness: 0.48, metalness: 0, emissive: 0x0a0908 });
    const rimGeo = new THREE.TorusGeometry(WHEEL_R, 0.019, 14, 64); rimGeo.scale(1, 1, 1.15);
    const rim = new THREE.Mesh(rimGeo, rimMat); rim.frustumCulled = false; this.wheelSpin.add(rim);
    const spokeGeos: THREE.BufferGeometry[] = [];
    const plain = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g, c = new THREE.BufferGeometry(); c.setAttribute('position', n.getAttribute('position')); c.setAttribute('normal', n.getAttribute('normal')); return c; };
    for (const a of [0, Math.PI]) {   // horizontal spokes (slightly below centre) and the lower twin spoke
      const g = rb(WHEEL_R - 0.045, 0.034, 0.016, 0.008); g.translate((WHEEL_R - 0.045) / 2 + 0.04, -0.012, 0.012); g.rotateZ(a); spokeGeos.push(plain(g));
    }
    for (const dx of [-0.022, 0.022]) { const g = rb(0.016, WHEEL_R - 0.05, 0.014, 0.006); g.translate(dx, -(WHEEL_R - 0.05) / 2 - 0.045, 0.014); spokeGeos.push(plain(g)); }
    const badge = new THREE.CircleGeometry(0.011, 18).rotateY(Math.PI); badge.translate(0, -0.006, -0.0305); spokeGeos.push(plain(badge));
    const spokeGeo = mergeGeometries(spokeGeos, false)!;
    const spokeMat = std({ color: 0x50545b, roughness: 0.36, metalness: 0.7, emissive: 0x060607, envMapIntensity: 0.5 });   // satin metal spokes + badge
    const spokes = new THREE.Mesh(spokeGeo, spokeMat); spokes.frustumCulled = false; this.wheelSpin.add(spokes);
    // airbag cover (dark, slightly domed) over the hub
    const hubG = new THREE.SphereGeometry(1, 24, 12); hubG.scale(0.074, 0.06, 0.03); hubG.translate(0, -0.006, 0.0);
    const accGeo = new THREE.BufferGeometry().copy(plain(hubG)); hubG.dispose();
    const accent = new THREE.Mesh(accGeo, mats.plastic); accent.frustumCulled = false; this.wheelSpin.add(accent);
    this.disposables.push(rimGeo, spokeGeo, accGeo);
    // column shroud running into the dash
    const shroudGeo = new THREE.CylinderGeometry(0.042, 0.055, 0.24, 16).rotateX(Math.PI / 2); this.disposables.push(shroudGeo);
    const shroud = new THREE.Mesh(shroudGeo, mats.plastic); shroud.position.set(0, -0.0, 0.15); shroud.frustumCulled = false; column.add(shroud);

    this.applyPreset(1);
    this.group.traverse(o => o.layers.set(1)); this.mirror.cam.layers.set(0); // cockpit = layer 1 (main camera only); the mirror camera sees layer 0
    this.group.matrixAutoUpdate = false; this.group.frustumCulled = false;
  }

  /** Repaints the infotainment map / next-exit card and the cluster's trip readout from the current state. */
  private paintScreen(): void {
    drawInfotainment(this.screenCtx, this.st); this.screenTex.needsUpdate = true;
    const g = this.tripCtx; g.clearRect(0, 0, 220, 64); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#9fb3c6'; g.font = `600 26px ${FONT}`; g.fillText(`TRIP ${tripText(this.st.meters)}`, 110, 18);
    g.fillStyle = '#6b7e92'; g.font = `600 24px ${FONT}`; g.fillText(`${clockText(this.st.hour)}   72 F`, 110, 46); this.tripTex.needsUpdate = true;
    this.screenLog.clock = clockText(this.st.hour); this.screenLog.exit = nextExit(this.st.meters).dist; this.screenLog.trip = tripText(this.st.meters); this.screenLog.redraws++;
  }
  private drawDigital(mph: number): void {
    const d = this.digital, g = d.g;
    g.clearRect(0, 0, 128, 56); g.fillStyle = '#eaf4ff'; g.font = `700 46px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.round(mph)), 64, 30); d.t.needsUpdate = true; d.mph = Math.round(mph);
  }
  /** Time of day: `light` 0 (night) .. 1 (day). At night the cabin trim picks up a faint glow from the screens. */
  applyPreset(light: number): void {
    for (const m of this.emissive) m.emissiveIntensity = 1 + (1 - light) * 3;
  }
  /** Rough 6-speed rpm from road speed (visual only). */
  static rpmFor(v: number): number {
    const tops = [9, 16.5, 25, 35, 46, 60]; let lo = 0, g = 0;
    while (g < tops.length - 1 && v > tops[g] * 0.93) { lo = tops[g] * 0.55; g++; }
    return 900 + Math.min(1, Math.max(0, (v - lo) / (tops[g] - lo))) * 4600 * (g === 0 ? 0.9 : 0.78);
  }
  /** Per-frame: needles, digital speed and the steering wheel (steerFrac = road-wheel angle / its full lock, -1..1). */
  update(mph: number, v: number, steerFrac: number, dt: number, info?: { hour: number; meters: number; time: number }): void {
    if (info) {
      this.st.hour = info.hour; this.st.meters = info.meters; this.st.time = info.time; this.st.mph = mph;
      this.screenAcc += dt; if (this.screenAcc >= SCREEN_PERIOD) { this.screenAcc = 0; this.paintScreen(); } // a few times a second is plenty
    }
    this.spd = this.spd < 0 ? mph : this.spd + (mph - this.spd) * Math.min(1, dt * 12);
    this.needleSpeed.rotation.z = needleAngle(this.spd / this.maxMph);
    this.needleRpm.rotation.z = needleAngle(Cockpit.rpmFor(v) / 8000);
    if (Math.round(mph) !== this.digital.mph) this.drawDigital(mph);
    this.wheel += (steerFrac * WHEEL_LOCK_RAD - this.wheel) * Math.min(1, dt * 24);
    this.wheelSpin.rotation.z = this.wheel;
  }
  get wheelAngle(): number { return this.wheelSpin.rotation.z; }
  /** Pose the cabin like the car instance: basis = (left, up, forward) in world space. */
  setPose(p: { x: number; y: number; z: number; lx: number; ly: number; lz: number; ux: number; uy: number; uz: number; fx: number; fy: number; fz: number }): void {
    this.group.matrix.makeBasis(new THREE.Vector3(p.lx, p.ly, p.lz), new THREE.Vector3(p.ux, p.uy, p.uz), new THREE.Vector3(p.fx, p.fy, p.fz)).setPosition(p.x, p.y, p.z);
    this.group.matrixWorldNeedsUpdate = true;
  }
  dispose(): void { this.group.removeFromParent(); this.mirror.dispose(); for (const d of this.disposables) d.dispose(); }
}
