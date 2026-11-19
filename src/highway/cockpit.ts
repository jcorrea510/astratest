/**
 * First-person cabin for the highway player's car: sculpted dashboard with a lit instrument cluster (needles move),
 * infotainment screen, centre console, door cards, leather seats, a steering wheel that turns with the front wheels
 * and a rear-view mirror. Everything is built once in car-local coordinates (x left, y up, z forward, the same frame
 * as the car instance) and merged per material, so the whole cabin costs about a dozen draw calls.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getTemplate } from '../vehicles/models/build';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { K } from '../vehicles/models/kinds';
import { MirrorRT, CROP, cropUv, sideMirrorsLive, type MirrorQuality } from './mirrors';
import { clockText, nextExit, tripText } from './infotext';

const D2R = Math.PI / 180;
/** Steering wheel travel shown for full road-wheel lock: 2.5 turns lock to lock = +-450 degrees. */
export const WHEEL_LOCK_RAD = 450 * D2R;
/** Dial layout shared by the cluster paint and the needles (angles ccw from straight up). */
const DIAL_START = 135 * D2R, DIAL_SWEEP = 270 * D2R;
/** Wheel turn shown (-1..1 of +-450 deg): the real road-wheel lock fraction, but never less than 20% of the key input so the wheel is always clearly seen turning at speed. */
export const wheelFrac = (lockFrac: number, input: number): number => Math.abs(lockFrac) > Math.abs(input) * 0.2 ? lockFrac : input * 0.2;
export const needleAngle = (frac: number): number => DIAL_START - Math.min(1, Math.max(0, frac)) * DIAL_SWEEP;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, srgb = true, rep = 0, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); }
  t.anisotropy = aniso; return t;
}
/** Tiny deterministic noise so the grain is stable between runs. */
function noise(seed: number): () => number { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Fine pebbled plastic grain (bump) for dash and door skins. */
function grainBump(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128), r = noise(7);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) { const v = 90 + r() * 90; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * 128, r() * 128, 1 + r() * 1.6, 1 + r() * 1.6); }
  return tex(c, false, 6);
}
/** Perforated, stitched leather colour map. */
function leatherMap(base: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256), r = noise(21);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) { const a = r() * 0.12; g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  g.strokeStyle = 'rgba(190,175,150,0.22)'; g.setLineDash([5, 4]);
  for (let i = 4; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  return tex(c, true, 2);
}
function carpetMap(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128), r = noise(3);
  g.fillStyle = '#1d1d20'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3000; i++) { const v = 20 + r() * 26; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(r() * 128, r() * 128, 1, 2); }
  return tex(c, true, 8);
}

/** Instrument cluster face: two dials, warning-light strip and trip display, lit from within (drawn bright on black). */
function clusterFace(): THREE.CanvasTexture {
  const W = 720, H = 256, [c, g] = canvas(W, H);
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(60,90,120,0.16)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const dial = (cx: number, cy: number, R: number, max: number, step: number, label: string, unit: string, redFrom: number, labelDiv: number) => {
    g.save(); g.translate(cx, cy);
    const ring = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R); ring.addColorStop(0, '#0b1118'); ring.addColorStop(1, '#10161e');
    g.fillStyle = ring; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a3440'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R - 2, 0, Math.PI * 2); g.stroke();
    const pt = (rot: number, rr: number): [number, number] => [-Math.sin(rot) * rr, -Math.cos(rot) * rr];
    for (let v = 0; v <= max; v += step / 2) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6, rot = needleAngle(v / max);
      const [x0, y0] = pt(rot, R - 8), [x1, y1] = pt(rot, R - (major ? 28 : 18));
      g.strokeStyle = v >= redFrom ? '#ff4a3a' : (major ? '#eaf4ff' : '#7f93a8'); g.lineWidth = major ? 3.5 : 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (major) {
        const [tx, ty] = pt(rot, R - 46);
        g.fillStyle = v >= redFrom ? '#ff6a5a' : '#dcecff'; g.font = `600 ${Math.round(R * 0.17)}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(Math.round(v / labelDiv)), tx, ty);
      }
    }
    g.fillStyle = '#7fb4ff'; g.font = `600 ${Math.round(R * 0.13)}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center';
    g.fillText(label, 0, R * 0.52); g.fillStyle = '#6b7e92'; g.fillText(unit, 0, R * 0.7);
    g.restore();
  };
  dial(176, 130, 112, 8000, 1000, 'RPM', 'x1000', 6500, 1000);
  dial(544, 130, 112, 160, 20, 'MPH', '', 140, 1);
  // centre: fuel / temp bars, gear, trip
  g.fillStyle = '#9fd0ff'; g.font = '600 20px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center';
  g.fillText('FUEL', 300, 54); g.fillText('TEMP', 420, 54);
  for (const [x, f, col] of [[270, 0.62, '#59d78a'], [390, 0.5, '#59a8ff']] as [number, number, string][]) {
    g.fillStyle = '#18222c'; g.fillRect(x, 66, 60, 8);
    g.fillStyle = col; g.fillRect(x, 66, 60 * f, 8);
  }
  g.fillStyle = '#e8f3ff'; g.font = '700 44px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('D', 360, 150);
  // warning lights strip (dim, ready)
  const lamps: [string, number][] = [['#3cff7a', 296], ['#2f88ff', 328], ['#3cff7a', 392], ['#ffb02e', 424]];
  for (const [col, x] of lamps) { g.fillStyle = col; g.globalAlpha = 0.8; g.beginPath(); g.arc(x, 232, 5, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  return tex(c, true, 0, 8);
}

/** seconds between repaints of the live screens */
export const SCREEN_PERIOD = 0.25;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
export interface ScreenState { hour: number; meters: number; mph: number; time: number }
/** Infotainment screen: moving map (roads scroll with the distance driven), next-exit countdown, clock, trip and a media bar. Cheap enough to repaint a few times a second. */
function drawInfotainment(g: CanvasRenderingContext2D, st: ScreenState): void {
  const W = 640, H = 360, ex = nextExit(st.meters);
  g.fillStyle = '#0b1219'; g.fillRect(0, 0, W, H);
  // map viewport (clipped): blocks and roads scroll toward the bottom as the car drives
  g.save(); g.beginPath(); g.rect(0, 40, 430, 282); g.clip();
  g.fillStyle = '#121d27'; g.fillRect(0, 40, 430, 282);
  const scroll = (st.meters * 0.09) % 120, row0 = Math.floor((st.meters * 0.09) / 120);
  for (let r = -1; r < 4; r++) {
    const y = 40 + r * 120 + scroll, rr = noise(row0 * 7 - r * 7 + 1000);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${30 + rr() * 20},${46 + rr() * 24},${60 + rr() * 26},1)`; g.fillRect(rr() * 400, y + rr() * 90, 18 + rr() * 50, 12 + rr() * 40); }
    g.strokeStyle = '#26394a'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, y + 112); g.lineTo(430, y + 112); g.stroke();
  }
  g.strokeStyle = '#26394a'; g.lineWidth = 12; g.beginPath(); g.moveTo(190, 40); g.lineTo(190, 322); g.stroke();
  g.strokeStyle = '#2f465a'; g.lineWidth = 2; g.setLineDash([10, 12]); g.lineDashOffset = -(st.meters * 0.09) % 22; g.beginPath(); g.moveTo(190, 40); g.lineTo(190, 322); g.stroke(); g.setLineDash([]);
  // route: straight up the highway, then peeling off at the exit that gets nearer as the trip counter climbs
  const by = 70 + (1 - ex.frac) * 200;
  g.strokeStyle = '#3d9bff'; g.lineWidth = 8; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(190, 296); g.lineTo(190, by); g.lineTo(300, by - 50); g.lineTo(330, 48); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(190, 262); g.lineTo(177, 292); g.lineTo(203, 292); g.closePath(); g.fill();
  g.restore();
  // header
  g.fillStyle = '#0f1822'; g.fillRect(0, 0, W, 40);
  g.fillStyle = '#cfe6ff'; g.font = `600 24px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(clockText(st.hour), 16, 21); g.textAlign = 'right'; g.fillText('72 F   LTE', W - 16, 21);
  // side card: next exit + media
  g.fillStyle = '#101b26'; g.fillRect(430, 40, 210, 320);
  g.textAlign = 'left'; g.fillStyle = '#7fb4ff'; g.font = `600 20px ${FONT}`; g.fillText('NEXT EXIT', 446, 70);
  g.fillStyle = '#ffffff'; g.font = `700 46px ${FONT}`; g.fillText(ex.dist, 446, 110);
  g.fillStyle = '#9fb3c6'; g.font = `600 22px ${FONT}`; g.fillText(`${ex.exit}  ${ex.road}`, 446, 142);
  g.fillStyle = '#9fb3c6'; g.font = `600 18px ${FONT}`; g.fillText(`TRIP ${tripText(st.meters)}   ${Math.round(st.mph)} mph`, 446, 166);
  g.fillStyle = '#1b2a39'; g.fillRect(446, 180, 178, 1);
  g.fillStyle = '#7fb4ff'; g.font = `600 20px ${FONT}`; g.fillText('NOW PLAYING', 446, 204);
  const track = Math.floor(st.time / 210) % 3;
  g.fillStyle = '#ffffff'; g.font = `600 26px ${FONT}`; g.fillText(['Afterglow Drive', 'Long Way Home', 'Neon Overpass'][track], 446, 234);
  g.fillStyle = '#9fb3c6'; g.font = `500 20px ${FONT}`; g.fillText('Night Shift Radio', 446, 260);
  g.fillStyle = '#233446'; g.fillRect(446, 284, 178, 5); g.fillStyle = '#3d9bff'; g.fillRect(446, 284, 178 * ((st.time % 210) / 210), 5);
  // dock
  g.fillStyle = '#0f1822'; g.fillRect(0, 322, 430, 38);
  g.fillStyle = '#9fb3c6'; g.font = `600 18px ${FONT}`; g.textAlign = 'center';
  ['NAV', 'MEDIA', 'PHONE', 'CLIMATE', 'CAR'].forEach((t, i) => g.fillText(t, 43 + i * 86, 342));
}

type Part = { geo: THREE.BufferGeometry };
/** Mirror plates (kind MIRROR) found in the car body mesh: centre of the rear-facing face and its size, one per side. */
export function sideMirrorPlates(kind: VehicleKind): { x: number; y: number; z: number; w: number; h: number }[] {
  const g = getTemplate(kind).lods[0].body, P = g.getAttribute('position'), A = g.getAttribute('aKind'), out: { x: number; y: number; z: number; w: number; h: number }[] = [];
  if (!P || !A) return out;
  for (const side of [1, -1]) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let n = 0, zMin = Infinity;
    for (let i = 0; i < P.count; i++) if (Math.round(A.getX(i)) === K.MIRROR && Math.sign(P.getX(i)) === side) zMin = Math.min(zMin, P.getZ(i));
    for (let i = 0; i < P.count; i++) {   // the rear-facing face only (not the arm that joins it to the door)
      if (Math.round(A.getX(i)) !== K.MIRROR || Math.sign(P.getX(i)) !== side || P.getZ(i) > zMin + 0.03) continue;
      n++; for (let c = 0; c < 3; c++) { const v = c === 0 ? P.getX(i) : c === 1 ? P.getY(i) : P.getZ(i); lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v); }
    }
    if (n) out.push({ x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: lo[2], w: (hi[0] - lo[0]) * 0.88, h: (hi[1] - lo[1]) * 0.86 });
  }
  return out;
}
export interface CockpitDims { eye: THREE.Vector3; wheelZ: number; dashY: number }

export class Cockpit {
  readonly group = new THREE.Group();
  readonly dims: CockpitDims;
  private wheelSpin = new THREE.Group();
  private needleSpeed = new THREE.Group(); private needleRpm = new THREE.Group();
  private digital: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; t: THREE.CanvasTexture; mph: number };
  private disposables: { dispose(): void }[] = [];
  private mirrorCtx!: CanvasRenderingContext2D; private mirrorTex!: THREE.CanvasTexture;
  private maxMph: number; private wheel = 0; private spd = -1;
  private screenCtx!: CanvasRenderingContext2D; private screenTex!: THREE.CanvasTexture; private screenAcc = 1; private st: ScreenState = { hour: 12.8, meters: 0, mph: 0, time: 0 };
  private tripCtx!: CanvasRenderingContext2D; private tripTex!: THREE.CanvasTexture;
  /** what the screens last showed and how many times they were repainted (tests read this) */
  readonly screenLog = { clock: '', exit: '', trip: '', redraws: 0 };

  /** shared live-reflection target for the rear-view and side mirrors */
  readonly mirror: MirrorRT;
  constructor(kind: VehicleKind, quality: MirrorQuality = 'medium') {
    const tp = getTemplate(kind), S = tp.seats[0], gh = tp.shape.gh, W = tp.shape.W;
    this.maxMph = 160;
    const zA = gh?.zA ?? S.z + 1.0, zR1 = gh?.zR1 ?? S.z + 0.2, roofY = tp.roofY;
    const hwI = W / 2 - 0.16;                      // inner face of the door cards
    const yD = S.y + 0.4;                          // top of the dash pad
    const zW = Math.min(S.z + 0.5, zA - 0.38);     // steering wheel plane
    const yW = S.y + 0.235;
    this.dims = { eye: new THREE.Vector3(S.x, Math.min(S.y + 0.66, roofY - 0.2), S.z - 0.22), wheelZ: zW, dashY: yD };

    const bump = grainBump(), leather = leatherMap('#2b2622'), carpet = carpetMap();
    this.disposables.push(bump, leather, carpet);
    const std = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ envMapIntensity: 0.8, ...o }); this.disposables.push(m); return m; };
    const mats = {
      plastic: std({ color: 0x17181a, roughness: 0.74, metalness: 0, bumpMap: bump, bumpScale: 0.5, emissive: 0x08090a }),
      soft: std({ color: 0x1d1e21, roughness: 0.85, metalness: 0, bumpMap: bump, bumpScale: 0.7, emissive: 0x0a0b0c }),
      leather: std({ color: 0xffffff, map: leather, roughness: 0.6, metalness: 0, envMapIntensity: 0.45, emissive: 0x0f0d0b }),
      trim: std({ color: 0xaab0b8, roughness: 0.3, metalness: 1, emissive: 0x050505 }),
      gloss: std({ color: 0x07080a, roughness: 0.18, metalness: 0.2, envMapIntensity: 0.6 }),
      carpet: std({ color: 0xffffff, map: carpet, roughness: 1, metalness: 0, emissive: 0x040404 }),
      mirror: std({ color: 0xcfd6dc, roughness: 0.04, metalness: 1, envMapIntensity: 1.4 }),
    };
    const buckets = new Map<THREE.Material, Part[]>();
    const add = (m: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mt = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(mt); (buckets.get(m) ?? buckets.set(m, []).get(m)!).push({ geo });
    };
    const addUv = add;
    const rb = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    const bumpMats = new Set<THREE.Material>([mats.plastic, mats.soft, mats.leather, mats.carpet]); // these need uv

    // ---- floor, door cards, dashboard
    addUv(mats.carpet, new THREE.PlaneGeometry(hwI * 2, 3.4).rotateX(-Math.PI / 2), 0, S.y - 0.34, zA - 1.9);
    const dashZ0 = zW + 0.27, dashD = zA + 0.03 - dashZ0;
    addUv(mats.soft, rb(hwI * 2, 0.2, dashD, 0.09), 0, yD - 0.1, dashZ0 + dashD / 2);           // upper pad
    addUv(mats.plastic, rb(hwI * 2 - 0.04, 0.36, 0.14, 0.05), 0, yD - 0.36, zW + 0.24);       // lower fascia / knee panel
    addUv(mats.soft, rb(0.46, 0.14, 0.26, 0.05), S.x, yD + 0.02, zW + 0.31);                              // binnacle behind the cluster
    addUv(mats.soft, rb(0.46, 0.014, 0.27, 0.007), S.x, yD + 0.092, zW + 0.31);                      // hood
    // instrument cluster: dark bezel, lit face and moving needles
    const clZ = zW + 0.18, clY = yD + 0.025;
    // door cards: skin, armrest pad, handle
    for (const sx of [1, -1]) {
      const xs = sx * (hwI - 0.02), z0 = zA - 0.25, z1 = S.z - 0.7, len = z0 - z1, zc = (z0 + z1) / 2;
      addUv(mats.plastic, rb(0.07, 0.62, len, 0.03), xs, yD - 0.24, zc);
      addUv(mats.soft, rb(0.1, 0.09, len * 0.7, 0.04), xs - sx * 0.01, yD - 0.14, zc - 0.05);       // upper roll
      addUv(mats.leather, rb(0.1, 0.07, 0.42, 0.035), xs - sx * 0.02, yD - 0.3, S.z - 0.18);       // armrest
      add(mats.trim, rb(0.04, 0.025, 0.2, 0.012), xs - sx * 0.04, yD - 0.22, S.z - 0.18 + 0.38);   // door pull
      add(mats.gloss, rb(0.05, 0.03, 0.14, 0.01), xs - sx * 0.03, yD - 0.33, S.z + 0.15);          // switch pack (driver side faces)
    }
    // A-pillar / sill trim strip at the dash edge
    for (const sx of [1, -1]) addUv(mats.soft, rb(0.1, 0.07, 0.5, 0.03), sx * (hwI - 0.03), yD + 0.0, zA - 0.2);

    // ---- centre stack, screen, vents, console
    add(mats.gloss, rb(0.3, 0.14, 0.1, 0.03), 0, yD - 0.17, zA - 0.3);                            // stack body
    
    for (let i = 0; i < 6; i++) add(mats.trim, rb(0.012, 0.03, 0.02, 0.004), -0.07 + i * 0.028, yD - 0.2, zA - 0.245); // climate keys
    // vents (flush slats) - left, right and driver
    for (const vx of [S.x - 0.0, -S.x, 0.0]) {
      if (vx === 0) continue;
      add(mats.gloss, rb(0.16, 0.05, 0.03, 0.012), vx, yD - 0.115, zW + 0.4);
      add(mats.trim, rb(0.17, 0.004, 0.032, 0.001), vx, yD - 0.115, zW + 0.4);
    }
    // console between the seats
    addUv(mats.plastic, rb(0.3, 0.3, 1.0, 0.07), 0, S.y - 0.06, S.z - 0.05 + 0.1);
    add(mats.plastic, rb(0.24, 0.02, 0.5, 0.008), 0, S.y + 0.1, S.z + 0.22);                       // gloss deck
    addUv(mats.leather, rb(0.25, 0.06, 0.36, 0.03), 0, S.y + 0.12, S.z - 0.34);                  // armrest lid
    add(mats.gloss, new THREE.SphereGeometry(0.028, 12, 8), 0, S.y + 0.16, S.z + 0.35);          // shifter knob
    add(mats.trim, new THREE.CylinderGeometry(0.01, 0.012, 0.05, 8), 0, S.y + 0.13, S.z + 0.35);
    for (const dz of [0.12, 0.3]) add(mats.trim, new THREE.TorusGeometry(0.036, 0.004, 5, 18).rotateX(Math.PI / 2), 0, S.y + 0.112, S.z + dz); // cup rims

    // ---- seats (cushion, back, headrest) for the front pair and a rear bench
    const seat = (x: number, y: number, z: number, w: number) => {
      addUv(mats.leather, rb(w, 0.13, 0.52, 0.06), x, y - 0.05, z + 0.02, 0.05);
      addUv(mats.leather, rb(w, 0.62, 0.17, 0.07), x, y + 0.27, z - 0.26, -0.2);
      addUv(mats.leather, rb(0.07, 0.4, 0.2, 0.03), x - w / 2 + 0.02, y + 0.2, z - 0.2, -0.2);   // bolsters
      addUv(mats.leather, rb(0.07, 0.4, 0.2, 0.03), x + w / 2 - 0.02, y + 0.2, z - 0.2, -0.2);
      addUv(mats.leather, rb(0.27, 0.19, 0.1, 0.05), x, y + 0.66, z - 0.36, -0.2);
      addUv(mats.plastic, rb(0.02, 0.1, 0.02, 0.008), x - 0.07, y + 0.52, z - 0.34, -0.2);
      addUv(mats.plastic, rb(0.02, 0.1, 0.02, 0.008), x + 0.07, y + 0.52, z - 0.34, -0.2);
    };
    for (const st of tp.seats.slice(0, 2)) seat(st.x, st.y, st.z, 0.5);
    const rear = tp.seats[2];
    if (rear) { addUv(mats.leather, rb(hwI * 2 - 0.1, 0.14, 0.52, 0.06), 0, rear.y - 0.05, rear.z + 0.02); addUv(mats.leather, rb(hwI * 2 - 0.1, 0.6, 0.17, 0.07), 0, rear.y + 0.26, rear.z - 0.26, -0.2); }

    // ---- rear-view mirror (stalk, housing, reflective glass)
    const mx = Math.max(0.08, S.x * 0.35), my = Math.min(roofY - 0.13, this.dims.eye.y + 0.17), mz = zR1 + 0.28, yawToDriver = Math.atan2(S.x - mx, mz - this.dims.eye.z) * 0.9;
    add(mats.plastic, rb(0.03, 0.06, 0.03, 0.01), mx, my + 0.05, mz + 0.03);
    add(mats.plastic, rb(0.25, 0.08, 0.03, 0.02), mx, my, mz, 0, Math.PI - yawToDriver, 0);
    // painted fallback (also used for the side mirrors on low quality), and the shared live reflection
    const [mc, mg] = canvas(256, 64); this.mirrorCtx = mg; this.mirrorTex = tex(mc, true); this.disposables.push(this.mirrorTex);
    this.mirror = new MirrorRT(quality); this.disposables.push(this.mirror);
    const liveMat = new THREE.MeshBasicMaterial({ map: this.mirror.texture, fog: false }); this.disposables.push(liveMat);
    const paintMat = new THREE.MeshBasicMaterial({ map: this.mirrorTex, toneMapped: false, fog: false }); this.disposables.push(paintMat);
    const glassAt = (mat: THREE.Material, w: number, h: number, crop: readonly [number, number, number, number], x: number, y: number, z: number, ry: number) => {
      const geo = new THREE.PlaneGeometry(w, h); cropUv(geo, crop); this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.position.set(x, y, z); m.rotation.set(0, ry, 0); this.group.add(m); return m;
    };
    const ry = Math.PI - yawToDriver;
    glassAt(liveMat, 0.232, 0.066, CROP.rear, mx + Math.sin(ry) * 0.018, my, mz + Math.cos(ry) * 0.018, ry);
    this.mirror.cam.position.set(mx, my, mz); this.group.add(this.mirror.cam);
    // side mirrors: a plane just behind the body's mirror plates (the car body is drawn by the fleet; plates found in its mesh)
    for (const pl of sideMirrorPlates(kind)) {
      const live = sideMirrorsLive(quality), crop = pl.x > 0 ? CROP.left : CROP.right;
      glassAt(live ? liveMat : paintMat, pl.w, pl.h, live ? crop : [0, 1, 0, 1], pl.x, pl.y, pl.z - 0.004, Math.PI);
    }
    this.applyPreset('#3874c8', '#bdd2e4', '#7a6e58', 1);
    // sun visors folded up at the headliner
    for (const sx of [1, -1]) add(mats.soft, rb(0.34, 0.015, 0.16, 0.007), sx * 0.36, roofY - 0.035, zR1 + 0.15);

    // merge every material bucket into one mesh
    for (const [m, parts] of buckets) {
      const wantUv = bumpMats.has(m);
      const geos = parts.map(p => {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo, c = new THREE.BufferGeometry();
        c.setAttribute('position', g.getAttribute('position')); c.setAttribute('normal', g.getAttribute('normal'));
        if (wantUv) c.setAttribute('uv', g.getAttribute('uv') ?? new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        return c;
      });
      const merged = mergeGeometries(geos, false);
      for (const p of parts) p.geo.dispose();
      if (!merged) continue;
      this.disposables.push(merged);
      const mesh = new THREE.Mesh(merged, m); mesh.frustumCulled = false; this.group.add(mesh);
    }

    // ---- cluster face, needles, digital speed (basic materials so they glow regardless of exposure)
    const face = clusterFace(); this.disposables.push(face);
    const clusterMat = new THREE.MeshBasicMaterial({ map: face, toneMapped: false }); this.disposables.push(clusterMat);
    const cluster = new THREE.Group(); cluster.position.set(S.x, clY, clZ - 0.022); cluster.rotation.set(0.22, Math.PI, 0, 'XYZ');
    const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.128), clusterMat); facePlane.frustumCulled = false; cluster.add(facePlane);
    const needleMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false }); this.disposables.push(needleMat);
    const mkNeedle = (g: THREE.Group, x: number) => {
      const len = 0.043, geo = new THREE.PlaneGeometry(0.0034, len).translate(0, len / 2 - 0.006, 0); this.disposables.push(geo);
      const m = new THREE.Mesh(geo, needleMat); m.frustumCulled = false; m.position.z = 0.0008; g.add(m);
      const hub = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 12), needleMat); hub.position.z = 0.001; g.add(hub);
      g.position.set(x, 0.128 * (0.5 - 130 / 256), 0.0009); cluster.add(g); g.rotation.z = needleAngle(0);
    };
    // face is 720x256 over 0.36x0.128 m: 2000 px per metre; dial centres at x=176 / 544 px, y=130 px
    mkNeedle(this.needleRpm, (176 - 360) / 2000); mkNeedle(this.needleSpeed, (544 - 360) / 2000);
    const [dc, dg] = canvas(128, 56); const dt = tex(dc, true, 0, 4); this.disposables.push(dt);
    this.digital = { c: dc, g: dg, t: dt, mph: -1 };
    const dMat = new THREE.MeshBasicMaterial({ map: dt, transparent: true, toneMapped: false }); this.disposables.push(dMat);
    const dPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.013), dMat); dPlane.position.set((544 - 360) / 2000, 0.128 * (0.5 - 130 / 256) - 0.016, 0.0007); dPlane.frustumCulled = false; cluster.add(dPlane);
    const [tc, tg] = canvas(220, 64); this.tripCtx = tg; this.tripTex = tex(tc, true, 0, 4); this.disposables.push(this.tripTex);
    const tMat = new THREE.MeshBasicMaterial({ map: this.tripTex, transparent: true, toneMapped: false }); this.disposables.push(tMat);
    const tPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.032), tMat); tPlane.position.set(0, 0.128 * (0.5 - 208 / 256), 0.0007); tPlane.frustumCulled = false; cluster.add(tPlane);
    this.group.add(cluster);
    this.drawDigital(0);

    // ---- infotainment screen in the centre stack (faces the driver)
    const [sc, sg] = canvas(640, 360); this.screenCtx = sg; const scr = tex(sc, true, 0, 8); this.screenTex = scr; this.disposables.push(scr);
    this.paintScreen();
    const scrMat = new THREE.MeshBasicMaterial({ map: scr, toneMapped: false, color: 0xb0b8c0 }); this.disposables.push(scrMat);
    const scrYaw = Math.atan2(S.x, zA - 0.3 - this.dims.eye.z) ;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.13), scrMat); screen.frustumCulled = false;
    screen.position.set(0, yD + 0.02, zA - 0.355); screen.rotation.set(-0.22, Math.PI - scrYaw * 0.8, 0, 'YXZ');
    const bezel = new THREE.Mesh(rb(0.25, 0.15, 0.025, 0.012), mats.gloss); bezel.position.copy(screen.position).add(new THREE.Vector3(0, 0, 0.028)); bezel.rotation.copy(screen.rotation); bezel.frustumCulled = false;
    this.group.add(bezel, screen); this.disposables.push(bezel.geometry);

    // ---- steering wheel: tilted column group; the spin group turns with the front wheels
    const wheelTilt = 0.42, wy = yW, wr = 0.168;
    const column = new THREE.Group(); column.position.set(S.x, wy, zW); column.rotation.x = wheelTilt; this.group.add(column);
    column.add(this.wheelSpin);
    const rimMat = std({ color: 0xffffff, map: leather, roughness: 0.5, metalness: 0, emissive: 0x0c0a09 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(wr, 0.0175, 12, 48), rimMat); rim.frustumCulled = false; this.wheelSpin.add(rim);
    const hubMat = mats.gloss;
    const spokeGeos: THREE.BufferGeometry[] = [];
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const len = wr - 0.02, g = rb(len, 0.028, 0.012, 0.005); g.translate(len / 2, 0, 0); g.rotateZ(a); spokeGeos.push(g.toNonIndexed());
    }
    const hubG = rb(0.085, 0.07, 0.03, 0.03).toNonIndexed(); spokeGeos.push(hubG);
    const spokes = new THREE.Mesh(mergeGeometries(spokeGeos.map(g => { const c = new THREE.BufferGeometry(); c.setAttribute('position', g.getAttribute('position')); c.setAttribute('normal', g.getAttribute('normal')); return c; }), false), hubMat);
    spokes.frustumCulled = false; this.wheelSpin.add(spokes);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.6 })); logo.position.z = -0.016; logo.rotation.y = Math.PI; this.wheelSpin.add(logo);
    this.disposables.push(rim.geometry, rimMat, spokes.geometry, logo.geometry, logo.material as THREE.Material);
    // steering column shroud
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.2, 14).rotateX(Math.PI / 2), mats.plastic); shroud.position.set(0, 0, 0.12); column.add(shroud); this.disposables.push(shroud.geometry);

    this.group.traverse(o => o.layers.set(1)); this.mirror.cam.layers.set(0); // cockpit = layer 1 (main camera only); the mirror camera sees layer 0
    this.group.matrixAutoUpdate = false; this.group.frustumCulled = false;
    void VEHICLES;
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
    g.clearRect(0, 0, 128, 56); g.fillStyle = '#eaf4ff'; g.font = '700 46px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.round(mph)), 64, 30); d.t.needsUpdate = true; d.mph = Math.round(mph);
  }
  /** Repaints the rear-view mirror (what is behind: sky, fog-tinted horizon, road with lane dashes) for the time of day. */
  applyPreset(sky: string, horizon: string, ground: string, light: number): void {
    const g = this.mirrorCtx, W = 256, H = 64, k = Math.min(1, 0.35 + light * 0.5);
    const gr = g.createLinearGradient(0, 0, 0, H * 0.5); gr.addColorStop(0, sky); gr.addColorStop(1, horizon);
    g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.5);
    g.fillStyle = ground; g.fillRect(0, H * 0.5, W, H * 0.5);
    g.fillStyle = 'rgba(20,30,20,0.45)'; g.fillRect(0, H * 0.5, W, H * 0.5);
    g.fillStyle = '#34363b'; g.beginPath(); g.moveTo(W * 0.5 - 6, H * 0.5); g.lineTo(W * 0.5 + 6, H * 0.5); g.lineTo(W * 0.92, H); g.lineTo(W * 0.08, H); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(230,230,220,0.8)'; g.lineWidth = 2;
    for (const f of [0.35, 0.65]) { g.beginPath(); g.moveTo(W * (0.5 + (f - 0.5) * 0.05), H * 0.5); g.lineTo(W * (0.5 + (f - 0.5) * 1.5), H); g.setLineDash([6, 8]); g.stroke(); }
    g.setLineDash([]); g.fillStyle = '#1c2a22'; g.fillRect(0, H * 0.5 - 4, W * 0.4, 4); g.fillRect(W * 0.62, H * 0.5 - 3, W * 0.38, 3);
    g.fillStyle = `rgba(0,0,0,${1 - k})`; g.fillRect(0, 0, W, H);
    this.mirrorTex.needsUpdate = true;
    for (const m of this.disposables) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) (m as THREE.MeshStandardMaterial).emissiveIntensity = 1 + (1 - light) * 3; // a little cabin glow at night
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
