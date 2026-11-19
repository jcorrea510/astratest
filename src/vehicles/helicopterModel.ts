/**
 * Procedural light helicopter (original design, a 2000s-style 4-blade light utility chopper): teardrop cabin with a
 * glass canopy, tapered tail boom, fin and stabiliser, engine fairing, skids, hinged cabin doors, main and tail rotors
 * with motion-blur discs. Three liveries: civilian, news, police.
 *
 * Body frame like the cars: +z forward, +x = LEFT, y up; origin at the cabin centre, skid soles at y = HELI_GROUND.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type HeliVariant = 'civilian' | 'news' | 'police' | 'army';
export const HELI_GROUND = -1.05;
export const ROTOR_R = 5.1;
export const MAST = new THREE.Vector3(0, 1.38, 0.35);
export const TAIL_ROTOR = new THREE.Vector3(0.3, 0.72, -5.55);
/** Doors: left/right front cabin doors, hinged at the front edge. */
export const HELI_DOOR = { outX: 0.8, z0: 0.12, z1: 1.38, belt: -0.05 };
/** Door swing: rotation.y of a front-hinged door pivot. Doors open OUTWARD (away from the hull centre) on both sides. */
export const HELI_DOOR_MAX = 1.2;
export function heliDoorAngle(side: 'left' | 'right', amount: number) { return -(side === 'left' ? 1 : -1) * amount * HELI_DOOR_MAX; }
/** Attack helicopter hardpoints (model space): chin gun muzzle, rocket pod tubes, missile rails. */
export const ARMY_MOUNTS = {
  gun: new THREE.Vector3(0, -0.72, 2.75),
  rockets: [new THREE.Vector3(1.55, 0.0, 1.7), new THREE.Vector3(-1.55, 0.0, 1.7)],
  missiles: [new THREE.Vector3(2.35, 0.08, 1.2), new THREE.Vector3(-2.35, 0.08, 1.2)],
};
export const HELI_SEATS = [{ x: 0.36, y: -0.2, z: 0.95 }, { x: -0.36, y: -0.2, z: 0.95 }, { x: 0.36, y: -0.15, z: -0.25 }, { x: -0.36, y: -0.15, z: -0.25 }];

export interface HeliModel {
  root: THREE.Group;
  /** pivots of the two doors (index 0 left, 1 right) */
  doors: THREE.Object3D[];
  mainRotor: THREE.Object3D; tailRotor: THREE.Object3D;
  blades: THREE.Mesh; tailBlades: THREE.Mesh; disc: THREE.Mesh; tailDisc: THREE.Mesh;
  beacon: THREE.Mesh; strobes: THREE.Mesh[];
  materials: THREE.Material[];
  paint: THREE.MeshPhysicalMaterial;
  /** army variant: the chin turret (yaw pivot; its first child pitches the barrels) */
  turret?: THREE.Object3D;
}

const LIVERY: Record<HeliVariant, { base: string[]; stripe: string; belly: string; name: string }> = {
  civilian: { base: ['#b31b24', '#f2f0ea', '#1d3c6e', '#e3a21a', '#2b2d31'], stripe: '#f2f0ea', belly: '#2a2c30', name: 'Corsair H4 Kestrel' },
  news: { base: ['#f4f3ef'], stripe: '#1f5fbf', belly: '#c8262c', name: 'SkyEye 6 News' },
  police: { base: ['#121418'], stripe: '#f4f3ef', belly: '#121418', name: 'PMPD Air Unit' },
  army: { base: ['#4b5233', '#454c31'], stripe: '#2f3622', belly: '#383d29', name: 'Gorman AH-7 Ravager' },
};
export const heliName = (v: HeliVariant) => LIVERY[v].name;

let discTex: THREE.Texture | null = null;
function rotorDiscTexture() {
  if (discTex || typeof document === 'undefined') return discTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(20,20,22,0.0)'); gr.addColorStop(0.12, 'rgba(20,20,22,0.55)'); gr.addColorStop(0.75, 'rgba(25,25,28,0.35)');
  gr.addColorStop(0.93, 'rgba(40,40,44,0.5)'); gr.addColorStop(1, 'rgba(40,40,44,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // faint blade sweep streaks
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 4; i++) { g.save(); g.translate(64, 64); g.rotate(i * Math.PI / 2 + 0.4); g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 64, 0, 0.9); g.fill(); g.restore(); }
  discTex = new THREE.CanvasTexture(c); discTex.colorSpace = THREE.SRGBColorSpace;
  return discTex;
}

/** Cabin surface: a deformed sphere (teardrop pod, flat belly, nose tucked down). Returns the body-frame point. */
function podPoint(x: number, y: number, z: number, out: THREE.Vector3) {
  // z in -1..1 along the pod
  const taper = z < 0 ? 1 - 0.5 * z * z : 1 - 0.18 * z * z;
  const X = x * 0.84 * taper;
  let Y = y * (y > 0 ? 0.92 : 0.7) * (z < 0 ? 1 - 0.35 * z * z : 1) + (z > 0 ? -0.22 * z * z : 0.12 * z * z);
  if (y < 0) Y = Math.max(Y, -0.62);
  const Z = z * 2.05 + 0.55;
  return out.set(X, Y, Z);
}

type Cat = 'paint' | 'glass' | 'door' | 'doorGlass';
function classify(c: THREE.Vector3, n: THREE.Vector3): { cat: Cat; side: number } {
  const side = c.x > 0 ? 0 : 1;
  const doorZ = c.z > HELI_DOOR.z0 && c.z < HELI_DOOR.z1;
  const sideFace = Math.abs(n.x) > 0.55;
  // doors are painted skin with a window only in their upper part
  if (doorZ && sideFace && c.y > -0.58) return { cat: c.y > HELI_DOOR.belt + 0.12 && c.y < 0.5 ? 'doorGlass' : 'door', side };
  // glass is only the cockpit canopy: the windscreen up front and a small chin window; everything else is opaque paint
  if (c.z > 1.55 && c.y > -0.12) return { cat: 'glass', side };
  if (c.z > 1.75 && c.y > -0.4 && Math.abs(c.x) < 0.36) return { cat: 'glass', side };
  return { cat: 'paint', side };
}

function colorize(g: THREE.BufferGeometry, base: THREE.Color, stripe: THREE.Color, belly: THREE.Color) {
  const p = g.attributes.position as THREE.BufferAttribute; const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    const c = y < -0.42 ? belly : (y > -0.2 && y < -0.05 && z > -5.6) || (z < -4.6 && y > 0.6) ? stripe : base;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function buildHeliModel(variant: HeliVariant, paintIndex = -1): HeliModel {
  const L = LIVERY[variant];
  const baseHex = L.base[paintIndex >= 0 ? paintIndex % L.base.length : Math.floor(Math.random() * L.base.length)];
  const base = new THREE.Color(baseHex).convertSRGBToLinear(), stripe = new THREE.Color(L.stripe).convertSRGBToLinear(), belly = new THREE.Color(L.belly).convertSRGBToLinear();
  const paint = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.12 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#1b2630', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  const dark = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.6, metalness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.35, metalness: 0.85 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.5, metalness: 0.3, transparent: true });
  const discMat = new THREE.MeshBasicMaterial({ map: rotorDiscTexture(), transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
  const lightRed = new THREE.MeshBasicMaterial({ color: '#b81a10', toneMapped: false });
  const lightGreen = new THREE.MeshBasicMaterial({ color: '#10b83a', toneMapped: false });
  const lightWhite = new THREE.MeshBasicMaterial({ color: '#c8c8c8', toneMapped: false });
  const root = new THREE.Group();

  // ---- cabin pod, split into paint / canopy / door panels
  const sph = new THREE.SphereGeometry(1, 56, 36).toNonIndexed();
  const sp = sph.attributes.position as THREE.BufferAttribute;
  const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3();
  const buckets: Record<string, number[]> = {};
  const push = (k: string, ...v: THREE.Vector3[]) => { (buckets[k] ??= []).push(...v.flatMap(q => [q.x, q.y, q.z])); };
  for (let i = 0; i < sp.count; i += 3) {
    podPoint(sp.getX(i), sp.getY(i), sp.getZ(i), a); podPoint(sp.getX(i + 1), sp.getY(i + 1), sp.getZ(i + 1), b); podPoint(sp.getX(i + 2), sp.getY(i + 2), sp.getZ(i + 2), c);
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    n.subVectors(c, b).cross(tmp.subVectors(a, b)).normalize();
    const { cat, side } = classify(cen, n);
    push(cat === 'door' || cat === 'doorGlass' ? `${cat}${side}` : cat, a.clone(), b.clone(), c.clone());
  }
  sph.dispose();
  const geo = (arr: number[] | undefined) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr ?? [], 3)); g.computeVertexNormals(); return g; };

  // ---- tail boom, fin, stabiliser, engine fairing, skids (paint / dark / metal parts merged per material)
  const paintParts: THREE.BufferGeometry[] = [geo(buckets.paint)];
  const boom = new THREE.CylinderGeometry(0.13, 0.36, 4.6, 18, 1).rotateX(Math.PI / 2).translate(0, 0.42, -3.35);
  paintParts.push(boom);
  const fin = new THREE.BoxGeometry(0.08, 1.15, 0.75); fin.translate(0, 0.95, -5.5);
  { const p = fin.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) if (p.getY(i) > 1.2) p.setZ(i, p.getZ(i) - 0.32); }
  paintParts.push(fin);
  const ventral = new THREE.BoxGeometry(0.07, 0.5, 0.45).translate(0, 0.18, -5.45); paintParts.push(ventral);
  const stab = new THREE.BoxGeometry(1.7, 0.05, 0.42).translate(0, 0.45, -4.55); paintParts.push(stab);
  const fairing = new THREE.SphereGeometry(1, 20, 12).scale(0.5, 0.32, 1.25).translate(0, 0.95, -0.15); paintParts.push(fairing);
  const paintGeo = colorize(mergeGeometries(paintParts.map(g => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; }))!, base, stripe, belly);
  paintParts.forEach(g => g.dispose());
  const body = new THREE.Mesh(paintGeo, paint); body.castShadow = true; body.receiveShadow = true; root.add(body);
  const canopy = new THREE.Mesh(geo(buckets.glass), glass); canopy.renderOrder = 1; root.add(canopy);

  const darkParts: THREE.BufferGeometry[] = [];
  const mast = new THREE.CylinderGeometry(0.09, 0.12, 0.4, 10).translate(MAST.x, MAST.y - 0.12, MAST.z); darkParts.push(mast);
  const exhaust = new THREE.CylinderGeometry(0.11, 0.13, 0.35, 10).rotateX(Math.PI / 2 + 0.3).translate(0, 0.98, -1.25); darkParts.push(exhaust);
  const intake = new THREE.BoxGeometry(0.62, 0.16, 0.3).translate(0, 1.07, 0.55); darkParts.push(intake);
  // interior: floor, seats, panel (seen through the glass)
  darkParts.push(new THREE.BoxGeometry(1.35, 0.06, 2.6).translate(0, -0.55, 0.5));
  for (const s of HELI_SEATS) { darkParts.push(new THREE.BoxGeometry(0.5, 0.1, 0.5).translate(s.x, s.y - 0.08, s.z - 0.05)); darkParts.push(new THREE.BoxGeometry(0.5, 0.65, 0.1).translate(s.x, s.y + 0.25, s.z - 0.32)); }
  darkParts.push(new THREE.BoxGeometry(1.05, 0.3, 0.25).rotateX(-0.5).translate(0, 0.05, 1.82));
  darkParts.push(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).rotateX(-0.35).translate(0.36, -0.3, 1.38)); // cyclic sticks
  darkParts.push(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).rotateX(-0.35).translate(-0.36, -0.3, 1.38));
  // tail rotor gearbox, antenna
  darkParts.push(new THREE.BoxGeometry(0.22, 0.22, 0.3).translate(0.15, TAIL_ROTOR.y, TAIL_ROTOR.z));
  darkParts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 5).translate(0, -0.85, -0.6));
  if (variant === 'news') { // gyro-stabilised camera ball under the nose
    darkParts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8).translate(0, -0.66, 2.05));
    darkParts.push(new THREE.SphereGeometry(0.24, 16, 12).translate(0, -0.86, 2.05));
  }
  if (variant === 'police') { // searchlight + FLIR pod
    darkParts.push(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 14).rotateX(Math.PI / 2).translate(-0.55, -0.68, 1.55));
    darkParts.push(new THREE.SphereGeometry(0.19, 14, 10).translate(0.5, -0.78, 1.85));
  }
  const armyParts: THREE.BufferGeometry[] = []; // olive hardware: stub wings, rocket pods, missile rails, rear canopy hump, exhausts
  if (variant === 'army') {
    armyParts.push(new THREE.BoxGeometry(4.9, 0.09, 0.85).translate(0, 0.05, 0.55)); // stub wing
    for (const sx of [1, -1]) {
      const pod = new THREE.CylinderGeometry(0.2, 0.2, 1.7, 14).rotateX(Math.PI / 2).translate(sx * 1.55, -0.12, 0.85); armyParts.push(pod);
      armyParts.push(new THREE.ConeGeometry(0.2, 0.3, 14).rotateX(Math.PI / 2).translate(sx * 1.55, -0.12, 1.85)); // nose cone
      armyParts.push(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).rotateX(Math.PI / 2).translate(sx * 2.3, 0.0, 0.75)); // rail
      for (const dy of [0, 0.17]) armyParts.push(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8).rotateX(Math.PI / 2).translate(sx * 2.35, 0.1 - dy, 0.95)); // missiles
      armyParts.push(new THREE.ConeGeometry(0.06, 0.2, 8).rotateX(Math.PI / 2).translate(sx * 2.35, 0.1, 1.7));
      armyParts.push(new THREE.ConeGeometry(0.06, 0.2, 8).rotateX(Math.PI / 2).translate(sx * 2.35, -0.07, 1.7));
      armyParts.push(new THREE.BoxGeometry(0.34, 0.5, 0.5).translate(sx * 0.7, 0.62, -0.5)); // engine cowl
      armyParts.push(new THREE.CylinderGeometry(0.14, 0.12, 0.5, 10).rotateX(Math.PI / 2 + 0.2).translate(sx * 0.62, 0.72, -1.4)); // IR-suppressed exhaust
      armyParts.push(new THREE.BoxGeometry(0.05, 0.5, 0.5).translate(sx * 0.86, -0.1, 0.8)); // door armour plate
    }
    armyParts.push(new THREE.SphereGeometry(0.28, 12, 10).scale(1, 0.8, 1.5).translate(0, -0.72, 2.3)); // chin sensor ball
    armyParts.push(new THREE.BoxGeometry(0.5, 0.34, 0.8).translate(0, 0.55, -0.15)); // rear canopy spine
  }
  const darkGeo = mergeGeometries(darkParts.map(g => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; }))!; darkParts.forEach(g => g.dispose());
  const darkMesh = new THREE.Mesh(darkGeo, dark); darkMesh.castShadow = true; root.add(darkMesh);
  const extra: THREE.Material[] = [];
  let turret: THREE.Object3D | undefined;
  if (variant === 'army') {
    const armGeo = mergeGeometries(armyParts.map(g => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; }))!; armyParts.forEach(g => g.dispose());
    const armMat = new THREE.MeshStandardMaterial({ color: '#4a5133', roughness: 0.55, metalness: 0.25 }); extra.push(armMat);
    const armMesh = new THREE.Mesh(armGeo, armMat); armMesh.castShadow = true; root.add(armMesh);
    // chin turret: yaw pivot, pitching barrel group, three-barrel cannon
    turret = new THREE.Group(); turret.position.set(0, -0.66, 2.35);
    const barrels = new THREE.Group(); turret.add(barrels);
    barrels.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.34), dark));
    for (const a of [0, 2.094, 4.188]) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.65, 6).rotateX(Math.PI / 2), metal); br.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05 - 0.03, 0.45); barrels.add(br); }
    root.add(turret);
  }

  const metalParts: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const skid = new THREE.CylinderGeometry(0.05, 0.05, 3.2, 10).rotateX(Math.PI / 2).translate(sx * 1.0, HELI_GROUND + 0.05, 0.35);
    metalParts.push(skid);
    // upturned toe
    metalParts.push(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10).rotateX(Math.PI / 2 - 0.75).translate(sx * 1.0, HELI_GROUND + 0.18, 2.08));
    for (const z of [-0.45, 1.15]) {
      const strut = new THREE.CylinderGeometry(0.045, 0.045, 0.82, 8);
      strut.rotateZ(sx * 0.62); strut.translate(sx * 0.78, HELI_GROUND + 0.38, z); metalParts.push(strut);
    }
  }
  if (variant === 'police') metalParts.push(new THREE.CylinderGeometry(0.13, 0.11, 0.06, 14).rotateX(Math.PI / 2).translate(-0.55, -0.68, 1.77));
  const metalGeo = mergeGeometries(metalParts.map(g => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; }))!; metalParts.forEach(g => g.dispose());
  const metalMesh = new THREE.Mesh(metalGeo, metal); metalMesh.castShadow = true; root.add(metalMesh);

  // ---- doors: panels cut from the pod, hinged at their front edge
  const doors: THREE.Object3D[] = [];
  for (const side of [0, 1]) {
    const sg = side === 0 ? 1 : -1;
    const hinge = new THREE.Vector3(sg * (HELI_DOOR.outX - 0.04), 0, HELI_DOOR.z1);
    const pivot = new THREE.Object3D(); pivot.position.copy(hinge); root.add(pivot);
    const shift = (g: THREE.BufferGeometry) => g.translate(-hinge.x, -hinge.y, -hinge.z);
    const panel = shift(colorize(geo(buckets[`door${side}`]), base, stripe, belly));
    const dm = new THREE.Mesh(panel, paint); dm.castShadow = true; pivot.add(dm);
    const dg = new THREE.Mesh(shift(geo(buckets[`doorGlass${side}`])), glass); dg.renderOrder = 1; pivot.add(dg);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), metal); handle.position.set(sg * 0.07, -0.18, HELI_DOOR.z0 + 0.12 - HELI_DOOR.z1); pivot.add(handle);
    doors.push(pivot);
  }

  // ---- rotors
  const mainRotor = new THREE.Group(); mainRotor.position.copy(MAST); root.add(mainRotor);
  const bladeGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const bl = new THREE.BoxGeometry(0.3, 0.035, ROTOR_R - 0.2); bl.translate(0, 0, (ROTOR_R - 0.2) / 2 + 0.2);
    // slight droop and twist
    const p = bl.attributes.position as THREE.BufferAttribute; for (let k = 0; k < p.count; k++) { const z = p.getZ(k); p.setY(k, p.getY(k) - z * z * 0.004 + p.getX(k) * 0.06); }
    bl.rotateY(i * Math.PI / 2); bladeGeos.push(bl);
  }
  bladeGeos.push(new THREE.CylinderGeometry(0.22, 0.26, 0.18, 14));
  const blades = new THREE.Mesh(mergeGeometries(bladeGeos.map(g => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; }))!, bladeMat); blades.castShadow = true; mainRotor.add(blades);
  bladeGeos.forEach(g => g.dispose());
  const disc = new THREE.Mesh(new THREE.CircleGeometry(ROTOR_R, 48).rotateX(-Math.PI / 2), discMat); disc.renderOrder = 2; disc.visible = false;
  disc.position.copy(MAST); disc.position.y += 0.01; root.add(disc);
  const tailRotor = new THREE.Group(); tailRotor.position.copy(TAIL_ROTOR); root.add(tailRotor);
  const tb = new THREE.BoxGeometry(0.03, 1.3, 0.12);
  const tailBlades = new THREE.Mesh(mergeGeometries([tb.toNonIndexed(), tb.clone().rotateX(Math.PI / 2).toNonIndexed()].map(g => { g.deleteAttribute('uv'); return g; }))!, bladeMat); tailRotor.add(tailBlades);
  const tailDisc = new THREE.Mesh(new THREE.CircleGeometry(0.66, 24).rotateY(Math.PI / 2), discMat); tailDisc.position.copy(TAIL_ROTOR); tailDisc.position.x += 0.02; tailDisc.visible = false; root.add(tailDisc);

  // ---- lights: nav (red left/port... body +x is left), green right, white tail, red beacon, police strobes
  const bulb = new THREE.SphereGeometry(0.03, 8, 6);
  const nl = new THREE.Mesh(bulb, lightRed); nl.position.set(0.85, 0.45, -4.55); root.add(nl);
  const nr = new THREE.Mesh(bulb, lightGreen); nr.position.set(-0.85, 0.45, -4.55); root.add(nr);
  const tail = new THREE.Mesh(bulb, lightWhite); tail.position.set(0, 0.6, -5.95); root.add(tail);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), lightRed.clone()); beacon.position.set(0, 1.15, -0.85); root.add(beacon);
  const strobes: THREE.Mesh[] = [];
  if (variant === 'police') for (const sx of [1, -1]) { const s = new THREE.Mesh(bulb, new THREE.MeshBasicMaterial({ color: sx > 0 ? '#ff2020' : '#2050ff', toneMapped: false })); s.position.set(sx * 0.35, -0.6, -0.9); root.add(s); strobes.push(s); }

  const materials: THREE.Material[] = [paint, glass, dark, metal, bladeMat, discMat, lightRed, lightGreen, lightWhite, beacon.material as THREE.Material, ...strobes.map(s => s.material as THREE.Material), ...extra];
  return { root, doors, mainRotor, tailRotor, blades, tailBlades, disc, tailDisc, beacon, strobes, materials, paint, turret };
}
