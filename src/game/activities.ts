/** Free-roam activities: shops, respray garage, snacks, safehouse saving, postcards and stunt jumps. */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, MinimapBlip, ShopItem } from '../ui/contracts';
import { PLACES, POSTCARDS, RAMPS } from './places';
import { Marker, type MissionCtx } from './missions';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from '../combat/weapons';
import { RAPIER, groups, G_STATIC } from '../core/physics';

export class Activities {
  found = new Set<number>();
  jumpsDone = new Set<number>();
  private cards: (THREE.Object3D | null)[] = [];
  private shopMk: Marker; private garageMk: Marker; private snackMk: Marker; private safeMk: Marker;
  private shopOpen: 'arms' | 'snack' | null = null;
  private airborne: { t: number; start: THREE.Vector3; ramp: number } | null = null;
  private lastRamp = -1; private rampT = 0;
  private garageCool = 0;
  onSaveRequested: (() => void) | null = null;
  constructor(private game: Game, private ui: GameUI, private ctx: MissionCtx) {
    this.shopMk = ctx.marker(PLACES.arms, 1.4, '#ffd166');
    this.garageMk = ctx.marker(PLACES.garage, 4.5, '#7ff3ff');
    this.snackMk = ctx.marker(PLACES.snack, 1.3, '#ff8fb1');
    this.safeMk = ctx.marker(PLACES.safehouse, 1.3, '#9be8a6');
    this.buildRamps();
  }
  /** Re-creates postcard pickups after loading a save. */
  spawnCards() {
    for (const c of this.cards) c?.removeFromParent();
    this.cards = POSTCARDS.map((p, i) => {
      if (this.found.has(i)) return null;
      const g = new THREE.Group();
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshStandardMaterial({ color: '#ffe3b8', emissive: new THREE.Color('#ff9f5a'), emissiveIntensity: 0.9, side: THREE.DoubleSide }));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffb37a', transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
      g.add(card, glow);
      g.position.set(p.x, this.ctx.groundY(p.x, p.z, p.y ?? 0.2) + 1.1, p.z);
      this.game.renderer.scene.add(g); return g;
    });
  }
  private buildRamps() {
    const mat = new THREE.MeshStandardMaterial({ color: '#d9822b', roughness: 0.6, flatShading: true });
    const stripe = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.7 });
    for (const r of RAMPS) {
      const w = 4.2;
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(r.len, 0); shape.lineTo(r.len, r.h); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }); geo.translate(-r.len / 2, 0, -w / 2); geo.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      const base = this.ctx.groundY(r.x, r.z);
      m.position.set(r.x, base, r.z); m.rotation.y = r.yaw;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.3), stripe); edge.position.set(0, r.h + 0.02, r.len / 2 - 0.15); m.add(edge);
      this.game.renderer.scene.add(m);
      // inclined collider
      const ang = Math.atan2(r.h, r.len), hyp = Math.hypot(r.len, r.h);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-ang, r.yaw, 0, 'YXZ'));
      const center = new THREE.Vector3(0, r.h / 2 - 0.15 * Math.cos(ang), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw).add(new THREE.Vector3(r.x, base, r.z));
      this.game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 0.15, hyp / 2).setTranslation(center.x, center.y, center.z).setRotation(q).setFriction(0.8).setCollisionGroups(groups(G_STATIC, 0xffff)));
      // vertical back face
      const back = new THREE.Vector3(0, r.h / 2, r.len / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw).add(new THREE.Vector3(r.x, base, r.z));
      this.game.physics.addStaticBox(back.x, back.y, back.z, w / 2, r.h / 2, 0.1, r.yaw);
    }
  }
  blips(): MinimapBlip[] {
    const b: MinimapBlip[] = [
      { x: PLACES.arms.x, z: PLACES.arms.z, kind: 'arms', label: 'Tidewater Arms' }, { x: PLACES.garage.x, z: PLACES.garage.z, kind: 'garage', label: 'Glow Garage' },
      { x: PLACES.snack.x, z: PLACES.snack.z, kind: 'shop', label: 'Pier 9 Snacks' }, { x: PLACES.safehouse.x, z: PLACES.safehouse.z, kind: 'safehouse', label: 'Safehouse' },
    ];
    return b;
  }
  armsItems(): ShopItem[] {
    const g = this.game, inv = g.pcombat.inv;
    const items: ShopItem[] = [];
    for (const id of WEAPON_ORDER) {
      if (id === 'fists') continue;
      const w = WEAPONS[id];
      if (!inv.weapons[id].owned) items.push({ id: `w:${id}`, label: w.name, description: `${w.clip}-round ${id === 'shotgun' ? 'pump shotgun' : id}. Includes ${w.ammoPack} rounds.`, price: w.price, disabled: g.money < w.price });
      else items.push({ id: `a:${id}`, label: `${w.name} ammo`, description: `+${w.ammoPack} rounds (carrying ${inv.weapons[id].reserve + inv.weapons[id].clip}).`, price: w.ammoPrice, disabled: g.money < w.ammoPrice });
    }
    items.push({ id: 'armor', label: 'Body armor', description: 'Full armor plating. Absorbs most incoming damage.', price: 350, disabled: g.money < 350 || g.player.armor >= 100, owned: g.player.armor >= 100 });
    items.push({ id: 'medkit', label: 'First-aid kit', description: `Restores 60 health from the wheel (carrying ${inv.medkits}).`, price: 120, disabled: g.money < 120 || inv.medkits >= 5 });
    return items;
  }
  snackItems(): ShopItem[] {
    const g = this.game;
    return [
      { id: 'snack', label: 'Tidewater taco', description: 'Restores your health right now.', price: 20, disabled: g.money < 20 || g.player.health >= g.player.maxHealth },
      { id: 'medkit', label: 'First-aid kit', description: `For later. Use it from the wheel (carrying ${g.pcombat.inv.medkits}).`, price: 140, disabled: g.money < 140 || g.pcombat.inv.medkits >= 5 },
    ];
  }
  private buy(id: string) {
    const g = this.game, inv = g.pcombat.inv;
    const pay = (n: number) => { if (g.money < n) return false; g.addMoney(-n); g.audio.play('purchase'); return true; };
    if (id.startsWith('w:')) { const w = id.slice(2) as WeaponId; if (pay(WEAPONS[w].price)) { g.pcombat.give(w, WEAPONS[w].ammoPack + WEAPONS[w].clip); inv.select(w); } }
    else if (id.startsWith('a:')) { const w = id.slice(2) as WeaponId; if (pay(WEAPONS[w].ammoPrice)) g.pcombat.give(w, WEAPONS[w].ammoPack); }
    else if (id === 'armor') { if (g.player.armor < 100 && pay(350)) g.player.armor = 100; }
    else if (id === 'medkit') { const price = this.shopOpen === 'snack' ? 140 : 120; if (inv.medkits < 5 && pay(price)) inv.medkits++; }
    else if (id === 'snack') { if (g.player.health < g.player.maxHealth && pay(20)) g.player.health = g.player.maxHealth; }
    this.ui.refreshShop(this.shopOpen === 'snack' ? this.snackItems() : this.armsItems(), g.money);
  }
  private openShop(kind: 'arms' | 'snack') {
    const g = this.game;
    this.shopOpen = kind; g.menuOpen = true; g.input.exitLock();
    this.ui.openShop(kind === 'arms' ? 'Tidewater Arms' : 'Pier 9 Snacks', kind === 'arms' ? this.armsItems() : this.snackItems(), g.money, id => this.buy(id), () => this.closeShop());
  }
  closeShop() { if (!this.shopOpen) return; this.shopOpen = null; this.game.menuOpen = false; this.ui.closeShop(); }
  get shopIsOpen() { return !!this.shopOpen; }
  /** Contextual prompt for the HUD. */
  prompt(): string | null {
    const g = this.game, p = g.player.pos;
    if (g.playerVehicle) return this.garageMk.inside(p) ? 'Stop to respray ($150)' : null;
    const key = (g.settings.bindings.interact[0] ?? 'KeyE').replace('Key', '');
    if (this.shopMk.inside(p, 2.5)) return `${key}  Browse Tidewater Arms`;
    if (this.snackMk.inside(p, 2.5)) return `${key}  Grab a snack`;
    if (this.safeMk.inside(p, 2.5)) return `${key}  Save game`;
    return null;
  }
  update(dt: number) {
    const g = this.game, p = g.player.pos, t = g.time;
    for (const c of this.cards) if (c) { c.rotation.y += dt * 1.5; c.position.y += Math.sin(t * 2) * 0.002; }
    if (g.inputBlocked && !this.shopOpen) return;
    if (this.shopOpen) { if (g.input.justPressed('pause')) this.closeShop(); return; }
    // interactions
    if (!g.playerVehicle && g.input.justPressed('interact')) {
      if (this.shopMk.inside(p, 2.5)) this.openShop('arms');
      else if (this.snackMk.inside(p, 2.5)) this.openShop('snack');
      else if (this.safeMk.inside(p, 2.5)) { this.onSaveRequested?.(); g.player.health = g.player.maxHealth; this.ui.toast('Game saved. Rested to full health.', 'info'); g.audio.play('uiClick'); }
    }
    // Respray garage
    this.garageCool = Math.max(0, this.garageCool - dt);
    const pv = g.playerVehicle;
    if (pv && this.garageMk.inside(p) && Math.abs(pv.speed) < 2 && this.garageCool <= 0 && !pv.destroyed) {
      this.garageCool = 8;
      if (g.money < 150) this.ui.toast('Respray costs $150', 'warning');
      else if (g.police.heat > 0 && g.police.state.seen) this.ui.toast('Not while the police are watching', 'warning');
      else {
        g.addMoney(-150); g.audio.play('purchase');
        pv.health = pv.spec.health; pv.lightsBroken = false; pv.phys.enginePower = 1;
        const paints = ['#2fa39a', '#f26b3a', '#1f2a44', '#e8e2d0', '#7b2cbf', '#ffcc4d', '#3d3d42'];
        pv.material.userData.u.uPaint.value.set(paints[Math.floor(Math.random() * paints.length)]).convertSRGBToLinear(); pv.material.userData.u.uPaintOn.value = pv.kind === 'police' ? 0 : 1;
        // restore the undamaged body shape
        pv.bodyMesh.geometry = pv.tpl.body;
        const hadHeat = g.police.heat > 0; g.police.clear();
        this.ui.toast(hadHeat ? 'Fresh paint. The heat is off.' : 'Fresh paint, good as new.', 'money');
      }
    }
    // Postcards
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i]; if (!c) continue;
      if (Math.hypot(c.position.x - p.x, c.position.z - p.z) < 1.6 && Math.abs(c.position.y - 1.1 - p.y) < 2.5) {
        c.removeFromParent(); this.cards[i] = null; this.found.add(i);
        g.addMoney(100); g.audio.play('pickup');
        this.ui.toast(`Sunset postcard  ${this.found.size}/${POSTCARDS.length}  ·  +$100`, 'money');
        if (this.found.size === POSTCARDS.length) { g.addMoney(1000); this.ui.missionCard('Every postcard found', 'A thousand-dollar bonus from the Port Meridian tourist board.', 'passed'); }
        this.onSaveRequested?.();
      }
    }
    // Stunt jumps: detect leaving a ramp at speed, then landing
    if (pv) {
      for (let i = 0; i < RAMPS.length; i++) { const r = RAMPS[i]; if (Math.hypot(pv.position.x - r.x, pv.position.z - r.z) < r.len * 0.7) { this.lastRamp = i; this.rampT = 0.6; } }
      this.rampT -= dt;
      if (!pv.phys.grounded && !this.airborne && this.rampT > 0 && Math.abs(pv.speed) > 12) this.airborne = { t: 0, start: pv.position.clone(), ramp: this.lastRamp };
      if (this.airborne) {
        this.airborne.t += dt;
        if (pv.phys.grounded && this.airborne.t > 0.25) {
          const dist = pv.position.distanceTo(this.airborne.start), a = this.airborne;
          this.airborne = null;
          if (dist > 18 && a.t > 0.8) {
            const first = !this.jumpsDone.has(a.ramp);
            const reward = first ? 300 : 50;
            this.jumpsDone.add(a.ramp); g.addMoney(reward);
            this.ui.toast(`${RAMPS[a.ramp].name}: ${dist.toFixed(0)} m, ${a.t.toFixed(1)} s air  ·  +$${reward}`, 'money');
            g.audio.play('checkpoint');
          }
        }
        if (this.airborne && this.airborne.t > 8) this.airborne = null;
      }
    } else this.airborne = null;
  }
}
