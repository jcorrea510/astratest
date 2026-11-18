/**
 * Helicopters in the world: helipads (pier heliport, downtown rooftop, police roof), the parked choppers on them
 * (respawned when gone), rooftop elevators, rotor audio, wreck fires and explosions.
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { groups, G_STATIC, G_PROP } from '../core/physics';
import * as places from '../game/places';
import type { Particles } from '../render/particles';
import type { EngineVoice, GameAudio } from '../ui/contracts';
import { Helicopter } from './helicopter';
import type { HeliVariant } from './helicopterModel';

export interface Helipad { x: number; z: number; y?: number; yaw: number; name: string; variant: HeliVariant; roof?: boolean }
/** Fallback pads (the city layer may export its own HELIPADS from game/places; those win). */
export const FALLBACK_HELIPADS: Helipad[] = [
  { x: -50, z: 534, y: 1.2, yaw: Math.PI, name: 'Pier 9 Heliport', variant: 'news' },
  { x: 95, z: -150, yaw: Math.PI / 2, name: 'Heights Tower Helipad', variant: 'civilian', roof: true },
  { x: 40, z: 108, yaw: 0, name: 'Meridian PD Air Unit', variant: 'police', roof: true },
];
export function helipadList(): Helipad[] {
  const ext = (places as Record<string, unknown>).HELIPADS as Helipad[] | undefined;
  return Array.isArray(ext) && ext.length ? ext.map((p, i) => ({ ...p, variant: p.variant ?? (['civilian', 'news', 'police'] as const)[i % 3], yaw: p.yaw ?? 0 })) : FALLBACK_HELIPADS;
}
/** A resolved pad: where it actually is (rooftops are found by ray casts) and its elevator stops. */
export interface PadState { def: Helipad; pos: THREE.Vector3; heli: Helicopter | null; respawnT: number; lift: { bottom: THREE.Vector3; top: THREE.Vector3 } | null; mesh: THREE.Object3D }

let padTex: THREE.Texture | null = null;
function padTexture() {
  if (padTex || typeof document === 'undefined') return padTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#2b2d30'; g.beginPath(); g.arc(128, 128, 127, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#eceae4'; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#eceae4'; g.fillRect(84, 66, 22, 124); g.fillRect(150, 66, 22, 124); g.fillRect(84, 117, 88, 22);
  padTex = new THREE.CanvasTexture(c); padTex.colorSpace = THREE.SRGBColorSpace; padTex.anisotropy = 4;
  return padTex;
}

export class HeliManager {
  list: Helicopter[] = [];
  pads: PadState[] = [];
  onExplode: ((h: Helicopter, at: THREE.Vector3) => void) | null = null;
  onCrash: ((h: Helicopter, impact: number) => void) | null = null;
  private engines = new Map<number, EngineVoice>();
  constructor(private scene: THREE.Scene, private physics: Physics, private particles: Particles, private audio: GameAudio) { }

  spawn(variant: HeliVariant, x: number, y: number, z: number, yaw: number, paint = -1): Helicopter {
    const h = new Helicopter(this.physics, variant, x, y, z, yaw, paint);
    this.scene.add(h.group); this.list.push(h);
    return h;
  }
  remove(h: Helicopter) {
    const i = this.list.indexOf(h); if (i >= 0) this.list.splice(i, 1);
    this.engines.get(h.id)?.stop(); this.engines.delete(h.id);
    for (const p of this.pads) if (p.heli === h) p.heli = null;
    h.dispose();
  }
  nearest(p: THREE.Vector3, maxDist: number, filter?: (h: Helicopter) => boolean): Helicopter | null {
    let best: Helicopter | null = null, bd = maxDist;
    for (const h of this.list) { if (filter && !filter(h)) continue; const d = h.position.distanceTo(p); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  /** Resolves the helipads against the built city and parks a chopper on each. */
  init() {
    for (const def of helipadList()) {
      const pos = def.roof ? this.findRoof(def.x, def.z) : this.groundAt(def.x, def.z, def.y);
      if (!pos) continue;
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      mesh.position.set(pos.x, pos.y + 0.03, pos.z); mesh.receiveShadow = true; this.scene.add(mesh);
      const st: PadState = { def, pos, heli: null, respawnT: 0, lift: def.roof ? this.findLift(pos) : null, mesh };
      if (st.lift) for (const p of [st.lift.bottom, st.lift.top]) this.scene.add(this.liftMarker(p));
      this.pads.push(st);
      st.heli = this.spawn(def.variant, pos.x, pos.y, pos.z, def.yaw);
    }
  }
  private groundAt(x: number, z: number, y = 0): THREE.Vector3 | null {
    const hit = this.physics.ray(x, y + 30, z, 0, -1, 0, 60, groups(0xffff, G_STATIC | G_PROP));
    return new THREE.Vector3(x, hit ? y + 30 - hit.toi : y, z);
  }
  /** Highest flat roof (> 12 m, room for the rotor) near (x, z). */
  findRoof(x: number, z: number, radius = 90): THREE.Vector3 | null {
    const solid = groups(0xffff, G_STATIC);
    const top = (px: number, pz: number) => { const h = this.physics.ray(px, 400, pz, 0, -1, 0, 420, solid); return h ? 400 - h.toi : -99; };
    let best: THREE.Vector3 | null = null, bs = Infinity;
    for (let gx = -radius; gx <= radius; gx += 5) for (let gz = -radius; gz <= radius; gz += 5) {
      const px = x + gx, pz = z + gz, y = top(px, pz);
      if (y < 12) continue;
      const score = Math.hypot(gx, gz) - y * 0.3;
      if (score >= bs) continue;
      let flat = true;
      for (let k = 0; k < 8 && flat; k++) { const a = k * Math.PI / 4; if (Math.abs(top(px + Math.cos(a) * 5.5, pz + Math.sin(a) * 5.5) - y) > 0.3) flat = false; }
      // nothing above the roof where the rotor turns
      for (let k = 0; k < 8 && flat; k++) { const a = k * Math.PI / 4; if (this.physics.ray(px, y + 2.6, pz, Math.cos(a), 0, Math.sin(a), 6.2, solid)) flat = false; }
      if (!flat) continue;
      bs = score; best = new THREE.Vector3(px, y, pz);
    }
    return best;
  }
  /** Elevator stops: on the roof next to the pad, and on the street at the foot of the building. */
  private findLift(pad: THREE.Vector3): { bottom: THREE.Vector3; top: THREE.Vector3 } | null {
    const solid = groups(0xffff, G_STATIC);
    const yAt = (px: number, pz: number) => { const h = this.physics.ray(px, 400, pz, 0, -1, 0, 420, solid); return h ? 400 - h.toi : -99; };
    let top: THREE.Vector3 | null = null, dir = 0;
    for (let k = 0; k < 8 && !top; k++) { const a = k * Math.PI / 4; const px = pad.x + Math.cos(a) * 7.5, pz = pad.z + Math.sin(a) * 7.5; if (Math.abs(yAt(px, pz) - pad.y) < 0.3) { top = new THREE.Vector3(px, pad.y, pz); dir = a; } }
    if (!top) top = pad.clone().add(new THREE.Vector3(6.5, 0, 0));
    // walk outward until the street
    for (const a of [dir, dir + Math.PI / 2, dir - Math.PI / 2, dir + Math.PI]) {
      for (let r = 4; r < 70; r += 1.5) {
        const px = pad.x + Math.cos(a) * r, pz = pad.z + Math.sin(a) * r, y = yAt(px, pz);
        if (y < 1.5) { return { top, bottom: new THREE.Vector3(px + Math.cos(a) * 1.5, Math.max(0, yAt(px + Math.cos(a) * 1.5, pz + Math.sin(a) * 1.5)), pz + Math.sin(a) * 1.5) }; }
      }
    }
    return null;
  }
  private liftMarker(p: THREE.Vector3) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.75, depthWrite: false }));
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    glow.position.y = 0.8; g.add(ring, glow); g.position.set(p.x, p.y + 0.04, p.z);
    return g;
  }
  /** The elevator stop within reach of `p`, if any: where it takes you. */
  liftNear(p: THREE.Vector3): { to: THREE.Vector3; up: boolean; pad: PadState } | null {
    for (const s of this.pads) {
      if (!s.lift) continue;
      if (p.distanceTo(s.lift.bottom) < 1.4) return { to: s.lift.top, up: true, pad: s };
      if (p.distanceTo(s.lift.top) < 1.4) return { to: s.lift.bottom, up: false, pad: s };
    }
    return null;
  }

  fixedUpdate(dt: number) { for (const h of this.list) h.fixedUpdate(dt); }
  postStep() {
    for (const h of this.list) {
      const r = h.postStep();
      if (r) {
        const p = h.position;
        this.particles.sparks(p.x, p.y, p.z, 24, 8);
        this.audio.play('crash', { pos: p, volume: Math.min(1, h.impact / 12 + 0.3) });
        this.onCrash?.(h, h.impact);
      }
    }
  }
  update(dt: number, time: number, night: number, listener: THREE.Vector3, playerHeli: Helicopter | null, focus: THREE.Vector3) {
    for (const h of [...this.list]) {
      h.update(dt, time, night);
      const dist = h.position.distanceTo(listener);
      h.group.visible = dist < 450 || h === playerHeli;
      // rotor + turbine sound
      let ev = this.engines.get(h.id);
      if (h.rotor > 0.02 && dist < 160) {
        if (!ev) { ev = this.audio.engine(); this.engines.set(h.id, ev); }
        ev.update({ rpm: 0.15 + h.rotor * 0.55, throttle: Math.min(1, 0.35 + Math.abs(h.input.lift) * 0.5 + Math.abs(h.input.pitch) * 0.2), pos: h.position, kind: 'truck', damage: 1 - h.health / h.maxHealth });
      } else if (ev) { ev.stop(); this.engines.delete(h.id); }
      // smoking when hurt, burning and falling when destroyed, then the blast
      const frac = h.health / h.maxHealth;
      if (!h.destroyed && frac < 0.45 && Math.random() < (0.45 - frac) * 1.5 && dist < 200) { const p = h.group.localToWorld(new THREE.Vector3(0, 1.0, -1.2)); this.particles.smoke(p.x, p.y, p.z, 0.8, 0.8); }
      if (h.destroyed && h.burnTime > 0) {
        h.burnTime += dt;
        const p = h.group.localToWorld(new THREE.Vector3(0, 0.9, -0.8));
        if (dist < 300) { this.particles.fire(p.x, p.y, p.z, 1.2); if (Math.random() < 0.5) this.particles.smoke(p.x, p.y + 0.6, p.z, 0.95, 1.5); }
        if ((h.agl < 0.6 && h.burnTime > 0.6) || h.burnTime > 7) { h.burnTime = -1; this.explode(h); }
      }
      // tidy wrecks and choppers left far away
      if (h !== playerHeli && !h.driver && h.position.distanceTo(focus) > 380 && !this.pads.some(s => s.heli === h)) this.remove(h);
    }
    // parked choppers come back to their pads once you are away
    for (const s of this.pads) {
      if (s.heli && this.list.includes(s.heli) && !s.heli.destroyed && s.heli.position.distanceTo(s.pos) < 8) continue;
      if (s.heli && (s.heli.destroyed || s.heli.position.distanceTo(s.pos) >= 8)) s.heli = null;
      s.respawnT += dt;
      if (s.respawnT > 30 && focus.distanceTo(s.pos) > 160 && !this.list.some(h => h.position.distanceTo(s.pos) < 9)) {
        s.respawnT = 0; s.heli = this.spawn(s.def.variant, s.pos.x, s.pos.y, s.pos.z, s.def.yaw);
      }
    }
  }
  explode(h: Helicopter) {
    const p = h.position.clone();
    this.particles.explosion(p.x, p.y + 0.5, p.z, 1.4);
    this.audio.play('explosion', { pos: p, volume: 1 });
    h.phys.body.applyImpulse({ x: 0, y: h.phys.body.mass() * 6, z: 0 }, true);
    this.onExplode?.(h, p);
  }
  stopAllSounds() { for (const e of this.engines.values()) e.stop(); this.engines.clear(); }
}
