/** Story missions (five, each a different kind of play), mission markers and the shared mission framework. */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, MinimapBlip } from '../ui/contracts';
import { PLACES, type Place } from './places';
import type { Npc } from '../actors/npc';
import type { Vehicle } from '../vehicles/vehicle';
import type { AiCar } from './traffic';
import { nearestLane, samplePath } from '../world/citymap';
import type { WeaponId } from '../combat/weapons';
import type { Look } from '../actors/human';
import { groups, G_STATIC, RAPIER } from '../core/physics';

export type MissionStatus = 'running' | 'passed' | 'failed';
export interface MissionRun { objective: string; timer: number | null; blips(): MinimapBlip[]; update(dt: number): MissionStatus; failReason: string; cleanup(): void;
  /** race only: checkpoints each rival has passed (for tests and debugging) */
  rivalProgress?(): number[] }
export interface MissionDef { id: string; title: string; tagline: string; contact: Place; reward: number; requires: string | null; hour?: number; create(ctx: MissionCtx): MissionRun }

const CONTACT_LOOKS: Record<string, Look> = {
  Juno: { skin: '#8a5a3b', top: '#e76f51', bottom: '#264653', shoes: '#f8f9fa', hair: '#1f1a17', hat: '#264653', detail: '#3a2e26', sleeves: 'long', legs: 'pants', hairStyle: 'bun', hatStyle: 'none', height: 0.97, build: 0.95 },
  Marlo: { skin: '#f1c9a5', top: '#3d405b', bottom: '#2b2d42', shoes: '#212529', hair: '#5a3d28', hat: '#1d3557', detail: '#d9b44a', sleeves: 'long', legs: 'pants', hairStyle: 'buzz', hatStyle: 'beanie', height: 1.04, build: 1.05 },
  Vesna: { skin: '#e0ac85', top: '#f4f1de', bottom: '#b56576', shoes: '#e63946', hair: '#7b2cbf', hat: '#264653', detail: '#1f1f1f', sleeves: 'short', legs: 'shorts', hairStyle: 'long', hatStyle: 'none', height: 0.98, build: 0.93 },
};
const GANG_LOOK = (i: number): Look => ({ skin: ['#c68c63', '#8a5a3b', '#f1c9a5', '#a8714c'][i % 4], top: ['#1f6f6a', '#2a2a2e', '#1f6f6a'][i % 3], bottom: '#1d1f24', shoes: '#e9e4d8', hair: '#1f1a17', hat: '#1f6f6a', detail: '#d9b44a', sleeves: i % 2 ? 'long' : 'short', legs: 'pants', hairStyle: (['buzz', 'short', 'bald', 'curly'] as const)[i % 4], hatStyle: i % 3 === 0 ? 'beanie' : 'none', height: 0.98 + (i % 3) * 0.03, build: 1.02 });

/** Ring markers for objectives (shared look). */
export class Marker {
  static all = new Set<Marker>();
  group = new THREE.Group();
  private colMat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, public pos: THREE.Vector3, public radius: number, color: string, tall = 0, label?: string) {
    const h = tall || Math.min(7, 2.2 + radius * 0.9);
    this.colMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uFade, uTime; varying vec2 vUv;
        void main(){ float a = pow(1.0 - vUv.y, 1.6) * 0.42 * uFade; a *= 0.85 + 0.15 * sin(vUv.y * 18.0 - uTime * 3.0); gl_FragColor = vec4(uColor * 1.6, a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 40, 1, true), this.colMat);
    cyl.position.y = h / 2;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.9, radius, 48).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
    inner.position.y = 0.04;
    this.group.add(cyl, ring, inner);
    if (label) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
      g.font = '700 38px Inter, "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = Math.min(500, g.measureText(label).width + 48);
      g.fillStyle = 'rgba(13,38,41,0.82)'; g.beginPath(); g.roundRect(256 - w / 2, 14, w, 68, 34); g.fill();
      g.strokeStyle = color; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#fcf2d9'; g.fillText(label, 256, 49);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      sprite.scale.set(3.6, 0.675, 1); sprite.position.y = h + 0.9; sprite.renderOrder = 4;
      this.group.add(sprite);
    }
    this.group.position.copy(pos);
    scene.add(this.group);
    Marker.all.add(this);
  }
  update(t: number, camPos?: THREE.Vector3) {
    this.colMat.uniforms.uTime.value = t;
    if (camPos) { const d = Math.hypot(camPos.x - this.pos.x, camPos.z - this.pos.z); this.colMat.uniforms.uFade.value = THREE.MathUtils.smoothstep(d, this.radius + 0.5, this.radius + 6); }
  }
  inside(p: THREE.Vector3, yTol = 3) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < this.radius && Math.abs(p.y - this.pos.y) < yTol; }
  dispose() { this.group.removeFromParent(); Marker.all.delete(this); this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.Sprite).isSprite) { m.geometry?.dispose(); const mat = m.material as THREE.MeshBasicMaterial; mat.map?.dispose(); mat.dispose(); } }); }
}

export class MissionCtx {
  private lines: { text: string; speaker: string; t: number }[] = [];
  private lineT = 0;
  constructor(public game: Game, public ui: GameUI) { }
  get player() { return this.game.player; }
  get playerPos() { return this.game.player.pos; }
  say(lines: [string, string][]) { for (const [speaker, text] of lines) this.lines.push({ speaker, text, t: Math.max(2.6, text.length * 0.055) }); }
  tickDialogue(dt: number) {
    if (!this.lines.length) return;
    if (this.lineT === 0) this.ui.subtitle(this.lines[0].text, this.lines[0].speaker);
    this.lineT += dt;
    if (this.lineT > this.lines[0].t) { this.lines.shift(); this.lineT = 0; if (!this.lines.length) this.ui.subtitle(null); }
  }
  clearDialogue() { this.lines = []; this.lineT = 0; this.ui.subtitle(null); }
  marker(p: { x: number; z: number; y?: number }, r = 4, color = '#ffc37e', label?: string) { return new Marker(this.game.renderer.scene, new THREE.Vector3(p.x, this.groundY(p.x, p.z, p.y), p.z), r, color, 0, label); }
  groundY(x: number, z: number, hint = 0.2) {
    const hit = this.game.physics.ray(x, 40, z, 0, -1, 0, 80, groups(0xffff, G_STATIC));
    return hit ? 40 - hit.toi : hint;
  }
  gang(x: number, z: number, weapon: WeaponId, i: number, hostile = false): Npc {
    const p = this.freeSpot(x, z);
    const n = this.game.pop.spawn('gang', p.x, p.z, p.y + 0.05, GANG_LOOK(i), weapon);
    n.persistent = true; n.hostile = hostile; n.brain = 'idle'; n.accuracy = 1.15; n.char.maxHealth = n.char.health = 70; n.dropMoney = 40;
    n.char.human.setState(i % 3 === 0 ? 'talk' : 'loco');
    return n;
  }
  car(kind: Parameters<Game['vehicles']['spawn']>[0], x: number, z: number, yaw: number, paint = 0): Vehicle {
    const v = this.game.vehicles.spawn(kind, x, z, yaw, paint, this.groundY(x, z) + 0.2); v.persistent = true; return v;
  }
  inVehicle() { return this.game.playerVehicle; }
  /** Finds open ground near a point (no static geometry within ~0.6 m), searching outward. */
  freeSpot(x: number, z: number, maxR = 30): THREE.Vector3 {
    const ball = new RAPIER.Ball(0.6);
    for (let i = 0; i < 160; i++) {
      const a = i * 2.399, r = i === 0 ? 0 : Math.min(maxR, 0.8 + i * 0.25);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const y = this.groundY(px, pz);
      if (y > 0.6) continue; // on top of something
      let blocked = false;
      this.game.physics.world.intersectionsWithShape({ x: px, y: y + 1, z: pz }, { x: 0, y: 0, z: 0, w: 1 }, ball, () => { blocked = true; return false; }, undefined, groups(0xffff, G_STATIC));
      if (!blocked) return new THREE.Vector3(px, y, pz);
    }
    return new THREE.Vector3(x, this.groundY(x, z), z);
  }
  near(p: { x: number; z: number }, r: number) { return Math.hypot(this.playerPos.x - p.x, this.playerPos.z - p.z) < r; }
}

// ---------------------------------------------------------------- Mission 1: delivery against the clock
const m1: MissionDef = {
  id: 'm1', title: 'Warm Welcome', tagline: 'A package, a deadline, a city you barely know.', contact: PLACES.juno, reward: 600, requires: null,
  create(ctx) {
    const pickup = { x: 470, z: 120 }, drop = PLACES.garage;
    let stage = 0; let timer: number | null = null; let mk: Marker | null = null; let crate: THREE.Mesh | null = null;
    ctx.say([['Juno', 'Rae! Back in Port Meridian and already broke, huh?'], ['Juno', 'Easy money: a package at the Cannery Docks gate. Grab any car.'], ['Juno', 'Bring it to the Glow Garage on 5th. The buyer leaves in two and a half minutes.']]);
    ctx.ui.showControlsHint('Walk up to a car and press F to get in. W/S to drive and brake, Space for the handbrake.', 8);
    const run: MissionRun = {
      objective: 'Get a car', timer: null, failReason: '',
      blips: () => stage === 0 ? [] : [{ x: stage === 1 ? pickup.x : drop.x, z: stage === 1 ? pickup.z : drop.z, kind: 'target', label: stage === 1 ? 'Package' : 'Glow Garage', pulse: true }],
      update: dt => {
        if (stage === 0) { if (ctx.inVehicle()) { stage = 1; mk = ctx.marker(pickup, 5); timer = 150; run.objective = 'Drive to the Cannery Docks gate'; crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: '#b98a52', roughness: 0.8 })); crate.position.set(pickup.x + 2.5, ctx.groundY(pickup.x + 2.5, pickup.z) + 0.3, pickup.z); crate.castShadow = true; ctx.game.renderer.scene.add(crate); } }
        else if (stage === 1) {
          if (mk && mk.inside(ctx.playerPos)) { mk.dispose(); stage = 2; if (crate) { crate.removeFromParent(); crate.geometry.dispose(); (crate.material as THREE.Material).dispose(); crate = null; } mk = ctx.marker(drop, 4.5, '#7ff3ff'); run.objective = 'Drive into the Glow Garage on 5th St and stop'; ctx.game.audio.play('checkpoint'); ctx.say([['Juno', 'Got it? Good. Now don\'t scratch the paint. Or do. Just hurry.']]); }
        } else if (stage === 2) {
          if (mk && mk.inside(ctx.playerPos) && ctx.inVehicle() && Math.abs(ctx.inVehicle()!.speed) < 7) return 'passed';
          if (mk && mk.inside(ctx.playerPos) && !ctx.inVehicle()) return 'passed';
        }
        if (timer !== null) { timer -= dt; run.timer = Math.max(0, timer); if (timer <= 0) { run.failReason = 'The buyer walked.'; return 'failed'; } }
        return 'running';
      },
      cleanup: () => { mk?.dispose(); if (crate) { crate.removeFromParent(); crate = null; } },
    };
    return run;
  },
};

// ---------------------------------------------------------------- Mission 2: tail a car without being spotted
const m2: MissionDef = {
  id: 'm2', title: 'Tail Light', tagline: 'Follow the courier. Not too close.', contact: PLACES.juno, reward: 900, requires: 'm1',
  create(ctx) {
    const g = ctx.game;
    const start = nearestLane(g.city, -236, -98)!;
    let car: AiCar | null = null; let stage = 0; let closeT = 0; let farT = 0; let started = 0; void started;
    const dest = new THREE.Vector3(345, 0, 300);
    ctx.say([['Juno', 'The buyer paid with a marked card. Their courier van is parked right there on 3rd Street.'], ['Juno', 'Grab a car and follow it to the drop. Close enough to see it, far enough not to be seen.']]);
    const run: MissionRun = {
      objective: 'Get in a car and find the courier', timer: null, failReason: '',
      blips: () => car ? [{ x: car.v.position.x, z: car.v.position.z, kind: 'target', label: 'Courier', pulse: true }] : [],
      update: dt => {
        if (!car) {
          // spawn the courier on a lane near Marrow Ave when the player is ready
          const lane = start.lane; samplePath(lane, Math.min(lane.length - 5, start.s), { x: 0, z: 0, dx: 0, dz: 0 });
          // the van's spot on the lane: skip past the player's own car rather than removing it
          const sp0 = { x: 0, z: 0, dx: 0, dz: 0 };
          const mine = (o: Vehicle) => o.persistent || !!o.driver?.isPlayer || o === g.lastPlayerVehicle;
          let s0 = Math.min(lane.length - 10, Math.max(5, start.s));
          for (const cand of [s0, s0 + 16, s0 - 16, s0 + 32, s0 - 32]) {
            const sc = Math.min(lane.length - 10, Math.max(5, cand)); samplePath(lane, sc, sp0);
            if (!g.vehicles.list.some(o => mine(o) && Math.hypot(o.position.x - sp0.x, o.position.z - sp0.z) < 9)) { s0 = sc; break; }
          }
          samplePath(lane, s0, sp0);
          for (const o of [...g.vehicles.list]) if (!mine(o) && Math.hypot(o.position.x - sp0.x, o.position.z - sp0.z) < 9) { const c = g.traffic.carOf(o); if (c) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); } if (!o.driver) g.vehicles.remove(o); }
          car = g.traffic.spawnOnLane('van', lane, s0, 'goto');
          car.persistent = true; car.v.persistent = true; car.target = dest.clone(); car.arriveDist = 6;
          car.v.locked = true; car.driver.persistent = true; car.maxSpeed = 0;
          return 'running';
        }
        const v = car.v;
        if (v.destroyed || !car.driver.alive) { run.failReason = 'The courier is out of action. The trail is cold.'; return 'failed'; }
        const d = v.position.distanceTo(ctx.playerPos);
        if (stage === 0) { run.objective = ctx.inVehicle() ? 'Follow the courier van' : 'Get in a car to follow the courier'; if (ctx.inVehicle() && d < 120) { stage = 1; started = g.time; car.maxSpeed = 11; } }
        if (stage === 1) {
          run.objective = d < 14 ? 'Too close! Back off' : d > 80 ? 'Don\'t lose the courier' : 'Follow the courier van';
          if (d < 14) closeT += dt; else closeT = Math.max(0, closeT - dt * 0.5);
          if (d > 95) farT += dt; else farT = 0;
          if (closeT > 3.5) { run.failReason = 'The courier spotted you.'; return 'failed'; }
          if (farT > 6) { run.failReason = 'You lost the courier.'; return 'failed'; }
          if (v.position.distanceTo(dest) < 14 && Math.abs(v.speed) < 1.5) { ctx.say([['Juno', 'A boathouse on the Strand. Now we know where they keep it. Nice driving.']]); return 'passed'; }
          // keep the courier's lane routing towards the destination; obey signals for a natural drive
          car.mode = v.position.distanceTo(dest) < 40 ? 'goto' : 'goto';
        }
        return 'running';
      },
      cleanup: () => { if (car) { car.persistent = false; car.v.persistent = false; car.v.locked = false; car.driver.persistent = false; car.mode = 'cruise'; car.target = null; car.maxSpeed = undefined; car.arriveDist = 8; } },
    };
    return run;
  },
};

// ---------------------------------------------------------------- Mission 3: shootout at the docks, then escape the heat
const m3: MissionDef = {
  id: 'm3', title: 'Breakwater', tagline: 'The Tidecutters crew stole the shipment. Take it back.', contact: PLACES.marlo, reward: 1500, requires: 'm2',
  create(ctx) {
    const g = ctx.game;
    const site = new THREE.Vector3(398, 0, 160);
    const enemies: Npc[] = []; let stage = 0; let caseMk: Marker | null = null; let siteMk: Marker | null = null; const caseSpot = new THREE.Vector3(site.x, 0, site.z + 4);
    if (!g.pcombat.inv.weapons.pistol.owned) g.pcombat.give('pistol', 60); else g.pcombat.give('pistol', 36);
    ctx.say([['Marlo', 'So you\'re the driver Juno keeps bragging about.'], ['Marlo', 'The Tidecutters hit our shipment. It\'s sitting in a container yard at the Cannery Docks.'], ['Marlo', 'Here, take this pistol. Get the case back. The police will come running, so lose them after.']]);
    ctx.ui.showControlsHint('Hold Right Mouse to aim, Left Mouse to fire, R to reload. Hold Tab for the weapon wheel.', 8);
    siteMk = ctx.marker(site, 10, '#ff8a6a');
    const run: MissionRun = {
      objective: 'Go to the container yard at the Cannery Docks', timer: null, failReason: '',
      blips: () => {
        if (stage === 0) return [{ x: site.x, z: site.z, kind: 'target', label: 'Container yard', pulse: true }];
        if (stage === 1) return enemies.filter(e => e.alive).map(e => ({ x: e.pos.x, z: e.pos.z, kind: 'enemy' as const }));
        if (stage === 2) return [{ x: caseSpot.x, z: caseSpot.z, kind: 'target', label: 'Case', pulse: true }];
        return [];
      },
      update: () => {
        if (stage === 0 && ctx.near(site, 110)) {
          siteMk?.dispose(); siteMk = null;
          const spots: [number, number, WeaponId][] = [[388, 162, 'pistol'], [404, 166, 'smg'], [395, 172, 'pistol'], [410, 178, 'pistol'], [380, 184, 'shotgun'], [418, 160, 'smg'], [372, 166, 'pistol'], [402, 190, 'pistol']];
          spots.forEach(([x, z, w], i) => enemies.push(ctx.gang(x, z, w, i)));
          stage = 1; run.objective = 'Take out the Tidecutters';
        }
        if (stage === 1) {
          for (const e of enemies) if (e.alive && !e.hostile && (ctx.near(e.pos, 40) || e.char.health < e.char.maxHealth)) { for (const o of enemies) { o.hostile = true; if (o.brain === 'idle') o.brain = 'chase'; o.lastSeen.copy(ctx.playerPos); } break; }
          const left = enemies.filter(e => e.alive).length;
          run.objective = left ? `Take out the Tidecutters (${left} left)` : '';
          if (!left) { stage = 2; const cs = ctx.freeSpot(site.x, site.z + 4); caseSpot.copy(cs); caseMk = ctx.marker({ x: cs.x, z: cs.z }, 1.6, '#7ff3ff'); run.objective = 'Grab the case'; g.audio.setMusicMood('tension'); }
        }
        if (stage === 2 && caseMk && caseMk.inside(ctx.playerPos)) {
          caseMk.dispose(); caseMk = null; stage = 3; g.audio.play('pickup');
          g.police.state.add('kill'); g.police.state.lastSeen.copy(ctx.playerPos); g.police.onHeatChange?.(g.police.heat, false);
          ctx.say([['Marlo', 'Sirens. Of course. Lose them and I\'ll call it a good night.']]);
        }
        if (stage === 3) { run.objective = 'Lose the heat'; if (g.police.heat === 0) { g.audio.setMusicMood('none'); return 'passed'; } }
        return 'running';
      },
      cleanup: () => { siteMk?.dispose(); caseMk?.dispose(); for (const e of enemies) { e.persistent = false; if (e.alive) { e.hostile = false; e.brain = 'wander'; e.node = -1; } } g.audio.setMusicMood('none'); },
    };
    return run;
  },
};

// ---------------------------------------------------------------- Mission 4: steal a guarded car, shake 3 heat, deliver it intact
const m4: MissionDef = {
  id: 'm4', title: 'Night Market', tagline: 'One very particular car. Delivered spotless.', contact: PLACES.marlo, reward: 2500, requires: 'm3', hour: 21.5,
  create(ctx) {
    const g = ctx.game;
    const lot = new THREE.Vector3(100, 0, -150);
    let target: Vehicle | null = null; const guards: Npc[] = []; let stage = 0; let mk: Marker | null = null;
    ctx.say([['Marlo', 'A collector wants a Pipit GT. Orange. There\'s one parked in the Heights plaza.'], ['Marlo', 'It\'s guarded, and the moment it moves the city will notice. Lose the heat before you bring it to the Glow Garage.'], ['Marlo', 'And keep it in one piece. Collectors are picky.']]);
    const run: MissionRun = {
      objective: 'Find the Pipit GT in the Meridian Heights plaza', timer: null, failReason: '',
      blips: () => {
        if (stage <= 1 && target) return [{ x: target.position.x, z: target.position.z, kind: 'target', label: 'Pipit GT', pulse: true }];
        if (stage <= 1) return [{ x: lot.x, z: lot.z, kind: 'target', label: 'Heights plaza', pulse: true }];
        if (stage === 2 && target && g.playerVehicle !== target) return [{ x: target.position.x, z: target.position.z, kind: 'target', label: 'Pipit GT' }];
        return [{ x: PLACES.garage.x, z: PLACES.garage.z, kind: 'garage', label: 'Glow Garage', pulse: true }];
      },
      update: () => {
        if (!target) {
          target = ctx.car('coupe', lot.x, lot.z, Math.PI / 2, 0);
          target.material.userData.u.uPaint.value.set('#f26b3a').convertSRGBToLinear();
          const pts: [number, number, WeaponId][] = [[94, -146, 'pistol'], [106, -156, 'smg'], [108, -143, 'pistol']];
          pts.forEach(([x, z, w], i) => guards.push(ctx.gang(x, z, w, i + 4)));
        }
        if (target.destroyed) { run.failReason = 'The Pipit GT was destroyed.'; return 'failed'; }
        if (stage === 0 && ctx.near(lot, 30)) { for (const gd of guards) { gd.hostile = true; } stage = 1; run.objective = 'Steal the Pipit GT'; }
        if (stage <= 1 && g.playerVehicle === target) {
          stage = 2; for (const gd of guards) gd.hostile = true;
          g.police.state.add('copKill'); g.police.state.lastSeen.copy(ctx.playerPos); g.police.onHeatChange?.(g.police.heat, false);
          run.objective = 'Lose the heat'; g.audio.setMusicMood('action');
        }
        if (stage === 2) {
          run.objective = g.playerVehicle !== target ? 'Get back in the Pipit GT' : g.police.heat > 0 ? 'Lose the heat' : 'Deliver the Pipit GT: stop in the Glow Garage on 5th St';
          if (g.police.heat === 0 && !mk) mk = ctx.marker(PLACES.garage, 4.5, '#7ff3ff');
          if (mk && g.police.heat > 0) { mk.dispose(); mk = null; }
          const health = target.health / target.spec.health;
          if (health < 0.3) { run.failReason = 'The collector won\'t take a wreck.'; return 'failed'; }
          if (mk && g.playerVehicle === target && mk.inside(ctx.playerPos) && Math.abs(target.speed) < 6) { g.audio.setMusicMood('none'); return 'passed'; }
        }
        return 'running';
      },
      cleanup: () => { mk?.dispose(); if (target) target.persistent = false; for (const gd of guards) { gd.persistent = false; if (gd.alive) { gd.hostile = false; gd.brain = 'wander'; gd.node = -1; } } g.audio.setMusicMood('none'); },
    };
    return run;
  },
};

// ---------------------------------------------------------------- Mission 5: checkpoint street race at sunset
export const RACE_ROUTE: { x: number; z: number }[] = [
  { x: -350, z: 403 }, { x: -150, z: 403 }, { x: -50, z: 300 }, { x: 50, z: 200 }, { x: 150, z: 100 }, { x: 250, z: 2 }, { x: 350, z: -100 }, { x: 446, z: 0 }, { x: 446, z: 200 }, { x: 250, z: 396 }, { x: 52, z: 404 },
];
const m5: MissionDef = {
  id: 'm5', title: 'Afterglow Run', tagline: 'Sunset. Three rivals. One city-wide race.', contact: PLACES.vesna, reward: 5000, requires: 'm4', hour: 18.4,
  create(ctx) {
    const g = ctx.game;
    const startPos = { x: -436, z: 403.5 }; // eastbound side of Coastal Drive
    let stage = 0; let cp = 0; let mk: Marker | null = null; let rivals: AiCar[] = []; let countdown = 0; let myCar: Vehicle | null = null;
    const rivalCp: number[] = [];
    const raceSpeed: number[] = [];
    ctx.say([['Vesna', 'Everyone in this town knows Juno\'s new driver now. The Coastline crew want a race.'], ['Vesna', 'Coastal Drive to the docks and back to the pier. Win, and you\'ll never pay for a drink on the Strand again.']]);
    const place = () => 1 + rivals.filter((r, i) => rivalCp[i] > cp || (rivalCp[i] === cp && r.v.position.distanceTo(new THREE.Vector3(RACE_ROUTE[Math.min(cp, RACE_ROUTE.length - 1)].x, 0, RACE_ROUTE[Math.min(cp, RACE_ROUTE.length - 1)].z)) < ctx.playerPos.distanceTo(new THREE.Vector3(RACE_ROUTE[Math.min(cp, RACE_ROUTE.length - 1)].x, 0, RACE_ROUTE[Math.min(cp, RACE_ROUTE.length - 1)].z)))).length;
    const run: MissionRun = {
      objective: 'Get to the start line on Coastal Drive', timer: null, failReason: '',
      rivalProgress: () => [...rivalCp],
      blips: () => stage < 2 ? [{ x: startPos.x, z: startPos.z, kind: 'checkpoint', label: 'Start', pulse: true }] : [{ ...RACE_ROUTE[Math.min(cp, RACE_ROUTE.length - 1)], kind: 'checkpoint', pulse: true }, ...(cp + 1 < RACE_ROUTE.length ? [{ ...RACE_ROUTE[cp + 1], kind: 'checkpoint' as const }] : []), ...rivals.map(r => ({ x: r.v.position.x, z: r.v.position.z, kind: 'vehicle' as const }))],
      update: dt => {
        if (stage === 0) {
          if (!mk) { mk = ctx.marker(startPos, 6, '#ffc37e'); myCar = ctx.car('coupe', startPos.x - 7.5, startPos.z + 3.2, Math.PI / 2, 3); myCar.persistent = true; }
          run.objective = g.playerVehicle ? 'Drive into the start marker' : 'Take the Pipit GT waiting at the start line';
          if (g.playerVehicle && mk.inside(ctx.playerPos) && g.police.heat === 0) {
            mk.dispose(); mk = null; stage = 1; countdown = 3.5;
            const pv = g.playerVehicle;
            pv.phys.teleport(startPos.x, pv.position.y + 0.2, startPos.z, Math.PI / 2);
            const lane = nearestLane(g.city, startPos.x + 20, startPos.z)!;
            const grid = [[0, -3.4], [0, 3.2], [-7.5, -3.4]];
            rivals = [0, 1, 2].map(i => { const r = g.traffic.spawnOnLane('coupe', lane.lane, Math.max(4, lane.s - 4 + i * 0.1), 'goto'); r.persistent = true; r.v.persistent = true; r.driver.persistent = true; r.v.phys.teleport(startPos.x + grid[i][0], 0.6, startPos.z + grid[i][1], Math.PI / 2); r.v.health = r.v.spec.health * 2.5; /* race-prepped */ r.target = new THREE.Vector3(RACE_ROUTE[0].x, 0, RACE_ROUTE[0].z); r.arriveDist = -10; r.mode = 'goto'; r.maxSpeed = 31 - i * 1.5; return r; });
            rivals.forEach((r, i) => { rivalCp[i] = 0; raceSpeed[i] = r.maxSpeed ?? 30; r.maxSpeed = 0; });
            g.blockedInput = true;
          } else if (g.playerVehicle && mk.inside(ctx.playerPos) && g.police.heat > 0) run.objective = 'Lose the heat before the race';
        } else if (stage === 1) {
          countdown -= dt;
          run.objective = countdown > 0.5 ? `Get ready… ${Math.ceil(countdown - 0.5)}` : 'GO!';
          if (countdown <= 0.5) { rivals.forEach((r, i) => { r.maxSpeed = raceSpeed[i]; }); stage = 2; g.blockedInput = false; mk = ctx.marker(RACE_ROUTE[0], 9, '#7ff3ff'); g.audio.play('checkpoint'); g.audio.setMusicMood('action'); }
        } else if (stage === 2) {
          const pos = place();
          run.objective = `Race: checkpoint ${cp + 1}/${RACE_ROUTE.length}  ·  Position ${pos}/4`;
          // rivals chase their own checkpoints
          rivals.forEach((r, i) => {
            if (!g.traffic.cars.includes(r)) return;
            const c = RACE_ROUTE[Math.min(rivalCp[i], RACE_ROUTE.length - 1)];
            r.target = new THREE.Vector3(c.x, 0, c.z); r.mode = 'goto'; r.ram = false;
            if (r.v.position.distanceTo(r.target) < 14 && rivalCp[i] < RACE_ROUTE.length) rivalCp[i]++;
          });
          if (mk && mk.inside(ctx.playerPos, 5)) {
            mk.dispose(); mk = null; cp++; g.audio.play('checkpoint');
            if (cp >= RACE_ROUTE.length) {
              const rank = 1 + rivalCp.filter(c => c >= RACE_ROUTE.length).length;
              g.audio.setMusicMood('none');
              if (rank === 1) { ctx.say([['Vesna', 'First across the line! Port Meridian is yours tonight.'], ['Juno', 'Told you. Best driver this side of the breakwater.']]); return 'passed'; }
              run.failReason = `You finished ${rank === 2 ? '2nd' : rank === 3 ? '3rd' : '4th'}. Only first place counts.`; return 'failed';
            }
            mk = ctx.marker(RACE_ROUTE[cp], 9, '#7ff3ff');
          }
          if (!g.playerVehicle) run.objective = 'Get back in a car!';
        }
        return 'running';
      },
      cleanup: () => {
        mk?.dispose(); g.blockedInput = false; g.audio.setMusicMood('none');
        for (const r of rivals) { r.persistent = false; r.v.persistent = false; r.driver.persistent = false; r.mode = 'cruise'; r.target = null; r.maxSpeed = undefined; r.arriveDist = 8; }
        if (myCar) myCar.persistent = false;
      },
    };
    return run;
  },
};

export const MISSIONS: MissionDef[] = [m1, m2, m3, m4, m5];

/** Mission flow: markers at contacts, start/finish, rewards, failure and retry. */
export class Missions {
  completed = new Set<string>();
  active: { def: MissionDef; run: MissionRun } | null = null;
  private markers = new Map<string, Marker>();
  private contacts = new Map<string, Npc>();
  private contactAway = new Map<string, number>();
  private cooldown = 0;
  onPassed: ((def: MissionDef) => void) | null = null;
  constructor(public ctx: MissionCtx) { }
  available(): MissionDef[] { return MISSIONS.filter(m => !this.completed.has(m.id) && (!m.requires || this.completed.has(m.requires))); }
  get allDone() { return MISSIONS.every(m => this.completed.has(m.id)); }
  blips(): MinimapBlip[] {
    if (this.active) return this.active.run.blips();
    return this.available().map(m => ({ x: m.contact.x, z: m.contact.z, kind: 'mission', label: `${m.contact.name}: ${m.title}` }));
  }
  get objective() {
    if (this.active) return this.active.run.objective || null;
    const next = this.available()[0];
    return next ? `Meet ${next.contact.name} at the amber marker (${next.title})` : null;
  }
  get timer() { return this.active?.run.timer ?? null; }
  start(def: MissionDef) {
    const g = this.ctx.game;
    if (def.hour !== undefined) g.hour = def.hour;
    this.ctx.ui.missionCard(def.title, def.tagline, 'start');
    g.audio.play('missionStart');
    this.active = { def, run: def.create(this.ctx) };
    for (const m of this.markers.values()) m.dispose();
    this.markers.clear();
  }
  lastResult = '';
  finish(status: 'passed' | 'failed', reason = '') {
    const a = this.active; if (!a) return;
    this.lastResult = `${a.def.id}:${status}:${reason}`;
    a.run.cleanup();
    this.active = null;
    const g = this.ctx.game;
    if (status === 'passed') {
      this.completed.add(a.def.id);
      g.addMoney(a.def.reward);
      if (a.def.id === 'm1') g.pcombat.give('pistol', 36);
      if (a.def.id === 'm3') g.pcombat.give('smg', 90);
      if (a.def.id === 'm4') g.pcombat.give('rifle', 75);
      this.ctx.ui.missionCard('Mission passed', `${a.def.title}  ·  +$${a.def.reward.toLocaleString()}`, 'passed');
      g.audio.play('missionPass');
      this.onPassed?.(a.def);
      if (this.allDone) setTimeout(() => this.ctx.ui.missionCard('Port Meridian is yours', 'All missions complete. The city is still open: explore, collect, cause trouble.', 'passed'), 4500);
    } else {
      this.ctx.clearDialogue();
      this.ctx.ui.missionCard('Mission failed', reason || 'Try again from the marker.', 'failed');
      g.audio.play('missionFail');
    }
    this.cooldown = 4;
  }
  update(dt: number) {
    const g = this.ctx.game;
    this.ctx.tickDialogue(dt);
    for (const mk of Marker.all) mk.update(g.time, g.renderer.camera.position);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.active) {
      const st = this.active.run.update(dt);
      if (st !== 'running') this.finish(st, this.active.run.failReason);
      return;
    }
    // markers for available missions
    const avail = this.available();
    for (const [id, mk] of this.markers) if (!avail.some(m => m.id === id)) { mk.dispose(); this.markers.delete(id); }
    // Contacts stand beside their marker while they have work for you.
    for (const [name, npc] of this.contacts) if (!avail.some(m => m.contact.name === name) || !npc.alive) { if (!npc.alive) this.contactAway.set(name, g.time + 120); npc.persistent = false; if (npc.alive) { npc.brain = 'wander'; npc.node = -1; npc.char.human.setState('loco'); } this.contacts.delete(name); }
    for (const m of avail) if (!this.contacts.has(m.contact.name)) {
      // a contact who was hurt stays away for a while, and never pops back in while you watch
      const away = this.contactAway.get(m.contact.name);
      if (away !== undefined && (g.time < away || Math.hypot(g.player.pos.x - m.contact.x, g.player.pos.z - m.contact.z) < 70)) continue;
      this.contactAway.delete(m.contact.name);
      const look = CONTACT_LOOKS[m.contact.name]; if (!look) continue;
      const x = m.contact.x + 1.9, z = m.contact.z;
      const n = g.pop.spawn('civilian', x, z, this.ctx.groundY(x, z) + 0.05, look);
      n.persistent = true; n.brain = 'scripted'; n.char.yaw = -Math.PI / 2; n.char.human.setState('talk');
      this.contacts.set(m.contact.name, n);
    }
    for (const m of avail) if (!this.markers.has(m.id)) this.markers.set(m.id, this.ctx.marker(m.contact, 1.6, '#ffc37e', `${m.contact.name.toUpperCase()}  ·  ${m.title}`));
    
    if (this.cooldown > 0 || g.deathT >= 0) return;
    for (const m of avail) {
      const mk = this.markers.get(m.id);
      if (mk && mk.inside(g.player.pos, 2.5) && !g.playerVehicle) { this.start(m); break; }
    }
  }
  /** Player went down / got arrested: fail the active mission. */
  onPlayerDown(kind: 'down' | 'busted') { if (this.active) this.finish('failed', kind === 'down' ? 'You were taken out.' : 'You were arrested.'); }
  abort() { if (this.active) { this.active.run.cleanup(); this.active = null; } for (const m of this.markers.values()) m.dispose(); this.markers.clear(); this.ctx.clearDialogue(); }
}
