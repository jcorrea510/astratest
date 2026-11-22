/**
 * Store extras on top of the basic hold-up (Robberies): clerk knock-out, physical register robbing (hold E, drawer slides out,
 * notes fly), aim reactions (everybody puts their hands up while a gun is pointed inside the store), smash-able jewelry cases
 * and the bank heist (tellers, vault drill, vault door, vault cash).
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI } from '../ui/contracts';
import type { Npc } from '../actors/npc';
import { STORE_W, STORE_D } from './places';
import { newLife } from './storeLife';
import type { Kiosk } from './robbery';

export interface ExState {
  /** seconds the clerk stays knocked out, last health seen */
  koT: number; hp: number;
  /** panic was started by a raised gun only (calms down again), game time of the last shot at that moment */
  aimOnly: boolean; calmT: number; shot0: number;
  /** register robbing (seconds, 0..1), loot grab sound timer */
  pickT: number;
  /** jewelry case being smashed: index and timer */
  smash: { i: number; t: number } | null;
  tellers: Npc[]; tellersSpawned: boolean;
  /** bank heist: 0 = tellers not yet dealt with, 1 = tellers done (vault can be drilled), 2 = drilling, 3 = door open, 4 = looted */
  stage: 0 | 1 | 2 | 3 | 4; drill: number; vaultOpen: number; vaultLoot: number; drillT: number;
}
export const newEx = (): ExState => ({ koT: 0, hp: -1, aimOnly: false, calmT: 0, shot0: 0, pickT: 0, smash: null, tellers: [], tellersSpawned: false, stage: 0, drill: 0, vaultOpen: 0, vaultLoot: 0, drillT: 0 });

/** The parts of Robberies the extras call back into. */
export interface Host {
  kiosks: Kiosk[]; active: Kiosk | null;
  panic(k: Kiosk, aim?: boolean): void; till(k: Kiosk): number; inside(): Kiosk | null; mult(): number;
}
const DRILL_TIME = 22, LOOT_TIME = 5, REG_TIME = 3.4;

export class StoreExtras {
  constructor(private game: Game, private ui: GameUI, private host: Host) {}

  /** Called each frame for every store. */
  update(k: Kiosk, dt: number, dist: number, insideK: Kiosk | null) {
    const sh = k.shell; if (!sh) return;
    if (dist < 45) sh.tick(dt);
    if (dist > 45) return;
    this.clerk(k, dt, dist);
    this.aim(k, dt, insideK);
    this.tellers(k, dt, dist);
    this.register(k, dt);
    this.cases(k, dt);
    this.bank(k, dt);
  }
  /** Hold-up finished (cash handed over): opens the next heist step in banks. */
  holdupDone(k: Kiosk) { if (k.def.kind === 'bank' && k.ex.stage < 1) { k.ex.stage = 1; this.ui.toast('Tellers are down. Get to the vault and drill it.', 'warning'); } }
  holdupStarted(k: Kiosk) {
    if (k.def.kind !== 'bank') return;
    // a bank trips the alarm at once and sends a heavy response
    const g = this.game; g.police.setHeat(Math.max(3, g.police.heat), new THREE.Vector3(k.def.x, 0, k.def.z));
  }
  /** The shop opens again: everything back as it was. */
  reset(k: Kiosk) {
    const ex = k.ex; Object.assign(ex, newEx(), { tellers: ex.tellers, tellersSpawned: ex.tellersSpawned });
    const sh = k.shell; if (!sh) return;
    sh.setDrawer(0); sh.setBills(1); sh.resetExtras();
  }
  prompt(): string | null {
    const g = this.game; if (g.playerVehicle || g.inputBlocked) return null;
    for (const k of this.host.kiosks) {
      if (!k.shell) continue;
      const ex = k.ex;
      if (this.canDrill(k)) return ex.drill > 0 ? `Drilling the vault ${Math.round(ex.drill * 100)}%  ·  keep holding E` : 'Hold E  Drill the vault';
      if (this.canVaultLoot(k)) return 'Hold E  Grab the vault cash';
      if (this.canReg(k)) return k.looting > 0 ? 'Emptying the register...' : 'Hold E  Rob the register';
      const c = this.nearCase(k); if (c >= 0 && !ex.smash) return 'E  Smash the display case';
    }
    return null;
  }

  // ---------- clerk: punches, knock-out, waking up ----------
  private clerk(k: Kiosk, dt: number, dist: number) {
    const n = k.clerk, ex = k.ex; if (!n || !n.alive) { ex.hp = -1; return; }
    const c = n.char, h = c.human, g = this.game;
    if (ex.hp < 0) ex.hp = c.health;
    const hurt = c.health < ex.hp - 0.01; ex.hp = c.health;
    if (ex.koT <= 0 && k.phase === 'open' && (hurt || c.downT > 0)) {
      if (c.health <= c.maxHealth * 0.55 || c.downT > 0) {
        ex.koT = 28; if (c.downT <= 0) c.hitReact(Math.sin(k.def.yaw), Math.cos(k.def.yaw), 2);
        this.host.panic(k); ex.aimOnly = false;
        this.ui.toast('The clerk is out cold. The register is yours.', 'info');
      } else if (n.brain === 'fight') { n.fightT = 0; } // already swinging back
      else if (!g.pcombat.armed && dist < 40 && Math.random() < clerkFightChance(k.def.kind)) {
        // Round 8: punched (not out): most clerks swing back instead of just putting their hands up
        n.brain = 'fight'; n.target = g.player; n.fightT = 0; n.stateT = 0; n.cooldown = 0.25; n.dodgeCool = 0.4; n.playerSwung = false;
        if (h.actionName) h.stopAction(h.actionName); h.setState('loco'); this.host.panic(k);
        this.ui.toast('The clerk is fighting back!', 'warning');
      } else if (n.brain !== 'scripted' && dist < 40) { n.brain = 'scripted'; n.stateT = 0; h.playAction('hands_up', { hold: true }); this.host.panic(k); } // stunned, not out: stays at the till with hands up
    }
    if (ex.koT > 0) {
      ex.koT -= dt; n.brain = 'scripted'; n.persistent = true;
      if (c.downT < 2.4) c.downT = 3; // stay down: never reaches the get-up point while out
      if (ex.koT <= 0) { // wakes up dazed and bolts
        c.downT = 1.3; n.brain = 'flee'; n.fleeFrom.copy(g.player.pos); n.stateT = 0; n.callCops = true; n.persistent = false;
      }
    }
  }

  // ---------- raised gun: everybody reacts, then calms down ----------
  private aim(k: Kiosk, dt: number, insideK: Kiosk | null) {
    const g = this.game, ex = k.ex;
    const aimed = insideK === k && g.pcombat.armed && g.pcombat.threatening && !g.playerVehicle && k.phase !== 'closed';
    const n = k.clerk;
    if (aimed) {
      ex.calmT = 0;
      if (k.panicT < 0 && k.phase === 'open') { ex.aimOnly = true; ex.shot0 = g.pcombat.lastShot; this.host.panic(k, true); }
    } else if (k.panicT >= 0 && ex.aimOnly && k.phase === 'open' && k !== this.host.active) {
      ex.calmT += dt; if (ex.calmT > 3.5) this.calm(k);
    }
    if (ex.aimOnly && g.pcombat.lastShot > ex.shot0 + 0.01) ex.aimOnly = false; // a shot makes it a real panic
    // staff: hands up while the store is in panic and the clerk is not busy being robbed
    if (n?.alive && ex.koT <= 0 && k.panicT >= 0 && k.phase === 'open' && n.brain === 'scripted') {
      const c = n.char; c.faceTowards(Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z), 8, dt);
      if (c.human.actionName !== 'hands_up') c.human.playAction('hands_up', { hold: true });
    }
    for (const t of ex.tellers) if (t.alive && t.brain === 'scripted') {
      if (k.panicT >= 0) { t.char.faceTowards(Math.atan2(g.player.pos.x - t.char.pos.x, g.player.pos.z - t.char.pos.z), 8, dt); if (t.char.human.actionName !== 'hands_up') t.char.human.playAction('hands_up', { hold: true }); }
    }
  }
  private calm(k: Kiosk) {
    const ex = k.ex; ex.aimOnly = false; ex.calmT = 0; k.panicT = -1; k.alarmT = 0; k.called = false;
    for (const s of k.shoppers) if (s.n.alive && (s.act === 'handsUp' || s.act === 'cower')) { s.n.char.human.stopAction('hands_up'); s.n.char.human.setState('loco'); s.act = 'browse'; s.life = newLife('walk', Math.random); }
    if (k.clerk?.alive) k.clerk.char.human.stopAction('hands_up');
    for (const t of ex.tellers) if (t.alive) t.char.human.stopAction('hands_up');
  }

  // ---------- bank tellers ----------
  private tellers(k: Kiosk, dt: number, dist: number) {
    void dt; const ex = k.ex, g = this.game, sh = k.shell!;
    if (k.def.kind !== 'bank') return;
    ex.tellers = ex.tellers.filter(t => g.pop.npcs.includes(t));
    if (dist > 140) { for (const t of ex.tellers) { t.persistent = false; if (t.alive) t.brain = 'wander'; } ex.tellers = []; ex.tellersSpawned = false; return; }
    if (!ex.tellersSpawned && dist < 60 && k.phase === 'open') {
      ex.tellersSpawned = true;
      for (const p of sh.tellers) {
        const w = sh.toWorld(p.x, 0.05, p.z), n = g.pop.spawn('civilian', w.x, w.z, w.y);
        n.persistent = true; n.brain = 'scripted'; n.tag = 'teller'; n.char.yaw = k.def.yaw; n.char.human.setState('talk'); ex.tellers.push(n);
      }
    }
  }

  // ---------- physical register ----------
  private canReg(k: Kiosk): boolean {
    const g = this.game, sh = k.shell; if (!sh || k.phase !== 'open' || k.looted || g.playerVehicle || g.inputBlocked || !g.player.alive) return false;
    if (this.host.active === k) return false; // a hold-up in progress: the clerk is filling the bag
    // staffed by a calm, unhurt clerk: hold them up instead. Round 7: a shot / cowering clerk (or a store in panic) no longer guards the till
    const c = k.clerk; if (c?.alive && k.ex.koT <= 0 && k.panicT < 0 && c.char.health >= c.char.maxHealth) return false;
    const l = k.frame.toLocal(g.player.pos);
    return Math.abs(g.player.pos.y - k.clerkPos.y) < 2.2 && Math.abs(l.x - sh.register.lx) < 1.5 && l.z > k.frame.counterZ - 1.8 && l.z < k.frame.counterZ + 1.6;
  }
  private register(k: Kiosk, dt: number) {
    const g = this.game, sh = k.shell!, ex = k.ex;
    const can = this.canReg(k), held = g.input.held('interact');
    if (can && held) {
      if (k.looting === 0) { k.looting = 0.001; this.host.panic(k); ex.aimOnly = false; sh.setDrawer(1); (g.audio as unknown as { registerDrawer?: (p: THREE.Vector3) => void }).registerDrawer?.(k.pos); ex.pickT = 0; this.ui.toast('Cracking the register...', 'info'); }
      k.looting = Math.min(1, k.looting + dt / REG_TIME);
      ex.pickT -= dt; if (ex.pickT <= 0) { ex.pickT = 1.0; g.player.human.playOnce('PickUp_Table', 'full', 0.12); g.audio.play('money', { pos: k.pos, volume: 0.35 }); }
      sh.setBills(1 - k.looting);
      this.ui.robberyMeter({ label: 'Emptying the register', progress: k.looting, cash: Math.round(this.host.till(k) * 0.8 * k.looting) });
      if (k.looting >= 1) {
        k.looting = 0; k.looted = true; this.ui.robberyMeter(null);
        const amt = Math.round(this.host.till(k) * 0.8); g.addMoney(amt); sh.burst(); g.audio.play('money', { pos: k.pos, volume: 0.8 });
        g.police.alarm('robbery', new THREE.Vector3(k.def.x, 0, k.def.z)); g.pop.danger(k.pos, 20, g.player);
        this.ui.toast(`Register emptied: $${amt}`, 'money');
        k.phase = 'closed'; k.reopenAt = g.time + 240; this.holdupDone(k);
      }
    } else if (k.looting > 0) { k.looting = 0; this.ui.robberyMeter(null); sh.setDrawer(0); sh.setBills(1); }
  }

  // ---------- jewelry cases ----------
  private nearCase(k: Kiosk): number {
    const g = this.game, sh = k.shell; if (!sh || !sh.cases.length || k.phase === 'closed' && k.def.kind !== 'bank') return -1;
    const l = k.frame.toLocal(g.player.pos); if (Math.abs(l.x) > STORE_W / 2 || Math.abs(l.z) > STORE_D / 2 || Math.abs(g.player.pos.y - k.clerkPos.y) > 2) return -1;
    let best = -1, bd = 1.25;
    sh.cases.forEach((c, i) => { if (c.broken) return; const dx = Math.max(0, Math.abs(l.x - c.lx) - c.w / 2), dz = Math.max(0, Math.abs(l.z - c.lz) - c.d / 2), d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  private cases(k: Kiosk, dt: number) {
    const g = this.game, ex = k.ex, sh = k.shell!;
    if (ex.smash) {
      ex.smash.t += dt;
      if (ex.smash.t > 0.38) {
        const c = sh.cases[ex.smash.i]; ex.smash = null;
        if (c && !c.broken) {
          sh.smashCase(sh.cases.indexOf(c));
          const w = sh.toWorld(c.lx, c.ly + 0.4, c.lz); const amt = Math.round(c.value * this.host.mult());
          for (let i = 0; i < 4; i++) g.particles.impact(w.x + (Math.random() - 0.5) * c.w, w.y, w.z + (Math.random() - 0.5) * c.d, 0, 1, 0, 'glass', 1.2);
          (g.audio as unknown as { playExtra?: (n: string, o: object) => void }).playExtra?.('glassShatter', { pos: w, volume: 1 }); g.audio.play('money', { pos: w, volume: 0.6 });
          g.addMoney(amt); this.ui.toast(`Case smashed: $${amt} of jewelry`, 'money');
          this.host.panic(k); ex.aimOnly = false;
          g.police.alarm('robbery', new THREE.Vector3(k.def.x, 0, k.def.z)); g.pop.danger(k.pos, 18, g.player);
        }
      }
      return;
    }
    if (g.input.justPressed('interact') && !g.playerVehicle && !g.inputBlocked) {
      const i = this.nearCase(k);
      if (i >= 0) { ex.smash = { i, t: 0 }; g.player.human.playAction('punch_cross'); }
    }
  }

  // ---------- bank vault ----------
  private vaultPos(k: Kiosk, lx: number, lz: number) { return Math.hypot(k.frame.toLocal(this.game.player.pos).x - lx, k.frame.toLocal(this.game.player.pos).z - lz); }
  private canDrill(k: Kiosk): boolean {
    const v = k.shell?.vault; if (!v || k.def.kind !== 'bank' || k.ex.stage < 1 || k.ex.stage > 2) return false;
    return Math.abs(this.game.player.pos.y - k.clerkPos.y) < 2.2 && this.vaultPos(k, v.lx, v.lz) < 1.5;
  }
  private canVaultLoot(k: Kiosk): boolean {
    const v = k.shell?.vault; if (!v || k.def.kind !== 'bank' || k.ex.stage !== 3 || k.ex.vaultOpen < 0.9) return false;
    return Math.abs(this.game.player.pos.y - k.clerkPos.y) < 2.2 && this.vaultPos(k, v.cashLx, v.cashLz) < 1.9;
  }
  private bank(k: Kiosk, dt: number) {
    const v = k.shell!.vault; if (!v || k.def.kind !== 'bank') return;
    const g = this.game, ex = k.ex, sh = k.shell!;
    // tellers neutralised another way (clerk down / KO'd, register emptied) also opens the vault step
    if (ex.stage === 0 && (k.looted || (k.clerk && (!k.clerk.alive || ex.koT > 0)))) this.holdupDone(k);
    const held = g.input.held('interact');
    if (this.canDrill(k) && held) {
      if (ex.stage === 1) { ex.stage = 2; g.police.setHeat(Math.max(4, g.police.heat), new THREE.Vector3(k.def.x, 0, k.def.z)); this.ui.toast('Drilling the vault: police are on the way.', 'heat'); }
      ex.drill = Math.min(1, ex.drill + dt / DRILL_TIME); sh.drillRig(true);
      ex.drillT -= dt; if (ex.drillT <= 0) { ex.drillT = 0.12; const w = sh.toWorld(v.lx - 0.6, 1.2, v.lz - 0.4); g.particles.impact(w.x, w.y, w.z, 0, 0.5, 1, 'metal', 1.4); }
      this.ui.robberyMeter({ label: 'Drilling the vault', progress: ex.drill, cash: 0 });
      if (ex.drill >= 1) { ex.stage = 3; sh.drillRig(false); this.ui.robberyMeter(null); this.ui.toast('The vault door is giving way...', 'warning'); g.audio.play('heatUp', { pos: k.pos, volume: 0.8 }); }
    } else if (ex.stage === 2) { sh.drillRig(false); if (ex.drill < 1) this.ui.robberyMeter(null); }
    if (ex.stage >= 3) { ex.vaultOpen = Math.min(1, ex.vaultOpen + dt / 2.4); sh.setVault(ex.vaultOpen * ex.vaultOpen * (3 - 2 * ex.vaultOpen)); }
    if (this.canVaultLoot(k)) {
      if (held) {
        ex.vaultLoot = Math.min(1, ex.vaultLoot + dt / LOOT_TIME);
        ex.pickT -= dt; if (ex.pickT <= 0) { ex.pickT = 0.9; g.player.human.playOnce('PickUp_Table', 'full', 0.12); g.audio.play('money', { pos: k.pos, volume: 0.5 }); }
        const amt = Math.round(this.host.till(k) * 2.5);
        this.ui.robberyMeter({ label: 'Stuffing the bags', progress: ex.vaultLoot, cash: Math.round(amt * ex.vaultLoot) });
        if (ex.vaultLoot >= 1) { ex.stage = 4; v.cash.visible = false; this.ui.robberyMeter(null); g.addMoney(amt); sh.burst(); this.ui.toast(`Vault cleaned out: $${amt}. Now get away!`, 'money'); k.phase = 'closed'; k.reopenAt = g.time + 300; }
      } else if (ex.vaultLoot > 0) { this.ui.robberyMeter(null); }
    }
  }
}

/** Round 8: odds that a clerk punched (but not knocked out) fights back with their fists. Pure (tests). */
export function clerkFightChance(kind: string): number { return kind === 'guns' ? 0.8 : kind === 'bank' || kind === 'jewelry' ? 0.35 : 0.55; }
