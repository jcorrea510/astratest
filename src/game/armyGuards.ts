/**
 * Fort Calder's soldiers on foot: gate sentries, tower watchmen at the foot of the towers and two roving patrol pairs.
 * They are ordinary 'gang' NPCs in army kit (so combat, perception and hit reactions are the existing brains). Posted guards stand
 * and face the player when he trespasses; patrols walk their loops (scripted movement) until alerted. They open fire when the player
 * is wanted near the base or has been inside the fence for a few seconds, or as soon as one of them is shot. Teen tone: no gore.
 */
import * as THREE from 'three';
import type { Look } from '../actors/look';
import type { Npc } from '../actors/npc';
import type { WeaponId } from '../combat/weapons';
import { ARMY_BASE } from '../world/citymap';
import { armyLayout } from '../world/armybase';
import { inArmyBase } from './armyAir';
import { skipFarTick } from './farLod';

const ARMY: Look = { skin: '#c68c63', hair: '#2a2420', shoes: '#151515', sleeves: 'long', legs: 'pants', hairStyle: 'buzz', height: 1, top: '#5b6340', bottom: '#4e5636', hat: '#454c2f', detail: '#2f3520', hatStyle: 'cap', topStyle: 'jacket', shoeStyle: 'boots', build: 1.1 };
const SKINS = ['#c68c63', '#8a5a3b', '#f1c9a5', '#a8714c', '#6a4430'];

export interface GuardPop { spawn(role: 'gang', x: number, z: number, y?: number, look?: Look, weapon?: WeaponId): Npc; npcs: Npc[] }
interface Guard { npc: Npc; post: THREE.Vector3; face: number; route: THREE.Vector3[] | null; wp: number; acc?: number }

/** Alert rule: wanted near the base, or trespassing past the warning. */
export function guardsHostile(heat: number, playerX: number, playerZ: number, trespassSeconds: number) {
  return (heat > 0 && inArmyBase(playerX, playerZ, 70)) || trespassSeconds >= 4;
}

export class ArmyGuards {
  guards: Guard[] = [];
  alerted = false; private tick = 0;
  constructor(private pop: GuardPop) { }

  /** Posts and patrol loops (world coordinates). */
  static layout() {
    const B = ARMY_BASE, gz = B.gateZ, L = armyLayout(), E = Math.PI / 2;
    const posts = [
      { x: B.x1 - 4, z: gz - 5, face: E, w: 'rifle' as WeaponId }, { x: B.x1 - 4, z: gz + 5.5, face: E, w: 'rifle' as WeaponId },
      { x: B.x1 - 8.5, z: gz - 30, face: E, w: 'rifle' as WeaponId }, { x: B.x1 - 8.5, z: gz + 30, face: E, w: 'rifle' as WeaponId }, // tower watch
      { x: B.x0 + 9, z: B.z0 + 9, face: -E, w: 'rifle' as WeaponId }, { x: B.x1 - 9, z: B.z0 + 9, face: 0, w: 'rifle' as WeaponId },
    ];
    const loopA = [[B.x0 + 62, B.z0 + 10], [L.spineX - 6, B.z0 + 10], [L.spineX - 6, gz - 12], [B.x0 + 62, gz - 12]].map(([x, z]) => new THREE.Vector3(x, 0.25, z));
    const loopB = [[L.spineX + 6, gz + 12], [B.x1 - 10, gz + 12], [B.x1 - 10, B.z1 - 10], [L.spineX + 6, B.z1 - 10]].map(([x, z]) => new THREE.Vector3(x, 0.25, z));
    return { posts, loops: [loopA, loopB] };
  }

  init() {
    const { posts, loops } = ArmyGuards.layout();
    let i = 0;
    const make = (x: number, z: number, w: WeaponId) => {
      const n = this.pop.spawn('gang', x, z, 0.3, { ...ARMY, skin: SKINS[i++ % SKINS.length], build: 1.06 + (i % 3) * 0.03 }, w);
      n.persistent = true; n.hostile = false; n.brain = 'idle'; n.accuracy = 1.1; n.dropMoney = 0;
      n.char.maxHealth = n.char.health = 90; n.char.armor = 40; n.char.human.setState('loco');
      return n;
    };
    for (const p of posts) { const n = make(p.x, p.z, p.w); n.char.yaw = p.face; this.guards.push({ npc: n, post: new THREE.Vector3(p.x, 0.3, p.z), face: p.face, route: null, wp: 0 }); }
    for (const loop of loops) for (let k = 0; k < 2; k++) {
      const s = loop[k * 2 % loop.length], n = make(s.x + k, s.z, 'smg'); n.brain = 'scripted';
      this.guards.push({ npc: n, post: s.clone(), face: 0, route: loop, wp: (k * 2 + 1) % loop.length });
    }
  }

  /** Per frame / fixed step. `hostile` comes from guardsHostile(). */
  update(dt: number, hostile: boolean, player: THREE.Vector3, ignore = false) {
    if (ignore) { // sandbox 'Police ignore you': sentries and patrols treat the player as a civilian
      this.alerted = false; hostile = false;
      for (const g of this.guards) {
        const n = g.npc; if (!n.alive) continue;
        n.hostile = false; n.losT = 0;
        if (n.brain === 'combat' || n.brain === 'chase') { n.brain = g.route ? 'scripted' : 'idle'; n.target = null; n.goal = null; n.coverPoint = null; }
      }
    }
    if (hostile && !this.alerted) this.alerted = true;
    if (!hostile && this.alerted && !this.guards.some(g => g.npc.alive && g.npc.hostile && g.npc.brain === 'combat')) this.alerted = false;
    this.tick++;
    for (let gi = 0; gi < this.guards.length; gi++) {
      const g = this.guards[gi];
      const n = g.npc; if (!n.alive) continue;
      // Round 12 perf: calm sentries and patrols far from the player (the base is ~1 km out) think every 4th frame with the accumulated dt
      if (!this.alerted && !n.hostile) {
        const ddx = n.char.pos.x - player.x, ddz = n.char.pos.z - player.z;
        if (skipFarTick(ddx * ddx + ddz * ddz, 300, 4, this.tick, gi)) { g.acc = (g.acc ?? 0) + dt; continue; }
        if (g.acc) { dt += g.acc; g.acc = 0; }
      }
      if (this.alerted) { if (!n.hostile) { n.hostile = true; if (n.brain === 'scripted') n.brain = 'idle'; } continue; }
      if (n.hostile && n.brain === 'idle' && g.route) { n.hostile = false; n.brain = 'scripted'; } // calmed down: back on patrol
      else if (n.hostile && n.brain === 'idle') n.hostile = false;
      const c = n.char;
      if (g.route && n.brain === 'scripted') {
        const t = g.route[g.wp], dx = t.x - c.pos.x, dz = t.z - c.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.5) g.wp = (g.wp + 1) % g.route.length;
        else { c.move(new THREE.Vector3(dx / d * 1.0, 0, dz / d * 1.0), dt, false); c.faceTowards(Math.atan2(dx, dz), 5, dt); }
      } else if (n.brain === 'idle') {
        // posted guards watch the intruder, else their sector
        const dx = player.x - c.pos.x, dz = player.z - c.pos.z, d = Math.hypot(dx, dz);
        c.faceTowards(d < 45 && inArmyBase(player.x, player.z, 12) ? Math.atan2(dx, dz) : g.face, 4, dt);
      }
    }
  }
}
