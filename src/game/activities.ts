/** Free-roam activities: shops, respray garage, snacks, safehouse saving, postcards and stunt jumps. */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, MinimapBlip, ShopItem } from '../ui/contracts';
import { PLACES, POSTCARDS, RAMPS, LANDMARKS, GARAGE_SLOTS } from './places';
import { RESPRAY, GARAGE_PAINTS, repairPrice, sellQuote, newSaleLog, recordSale, recentOfKind, SELL_COOLDOWN, type SaleLog } from './garage';
import { BAYS, bayPark } from './bays';
import { GarageBays } from './garageBay';
import type { GarageView } from '../ui/garageMenu';
import { CAR_PRICES, DEALER_KINDS, MILESTONES, carValue, netWorth, newMilestones, type OwnedCar } from './modes';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import type { Vehicle } from '../vehicles/vehicle';
import { Marker, type MissionCtx } from './missions';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from '../combat/weapons';
import { RAPIER, groups, G_STATIC } from '../core/physics';
import { Robberies } from './robbery';
import { GunStore } from './gunStore';
import { Salon } from './salon';
import { rampMeshes } from './rampMesh';

/** R11-M: 0..1 bars for the store detail pane (guns by their numbers, cars by their tune). */
function shopStats(id: string): ShopItem['stats'] {
  const [kind, key] = id.split(':');
  const c = (v: number) => Math.max(0, Math.min(1, v));
  if (kind === 'w' || kind === 'a') {
    const w = WEAPONS[key as WeaponId];
    if (!w || w.melee || w.cat === 'throw') return w?.melee ? [{ label: 'Damage', value: c(w.damage / 80) }, { label: 'Speed', value: c(0.5 / w.interval) }] : undefined;
    return [
      { label: 'Damage', value: c((w.damage * Math.min(w.pellets, 4)) / 120) }, { label: 'Fire rate', value: c(0.14 / w.interval) },
      { label: 'Range', value: c(w.range / 260) }, { label: 'Magazine', value: c(w.clip / 60) },
    ];
  }
  if (kind === 'car') {
    const s = VEHICLES[key as VehicleKind];
    if (!s) return undefined;
    return [
      { label: 'Top speed', value: c(s.topSpeed / 70) }, { label: 'Power', value: c(s.engine / s.mass / 14) },
      { label: 'Grip', value: c(s.grip) }, { label: 'Toughness', value: c(s.health / 1800) },
    ];
  }
  return undefined;
}

export class Activities {
  found = new Set<number>();
  jumpsDone = new Set<number>();
  private cards: (THREE.Object3D | null)[] = [];
  private bayMk: Marker[] = []; private snackMk: Marker; private safeMk: Marker;
  private shopOpen: 'arms' | 'snack' | 'dealer' | 'goals' | null = null;
  /** Round 9: the physical garages (door, camera, pause) and their sale cooldowns / repeat-sale log (persisted in the save) */
  garage: GarageBays;
  sales: SaleLog = newSaleLog(BAYS.length);
  /** seconds since the player last had a wanted level (a car taken with the cops watching stays too hot to sell for a while) */
  private sinceHeat = Infinity;
  private dealerMk: Marker;
  /** Cars you bought (persisted in the save); they are parked in the garage row and come back there if lost. */
  ownedCars: OwnedCar[] = [];
  private ownedVeh: (Vehicle | null)[] = [];
  milestones = new Set<string>();
  robberyBase = 0;
  private goalT = 0; private garageT = 0;
  private airborne: { t: number; start: THREE.Vector3; ramp: number } | null = null;
  private lastRamp = -1; private rampT = 0;
  private driftT = 0; private driftDist = 0; private driftCool = 0; private driftStartCrashes = 0;
  private garageArmed = true;
  missionActive: () => boolean = () => false;
  /** Called when a mission ends: a delivery into the garage must not turn into a paid respray. */
  disarmGarage() { this.garageArmed = false; }
  onSaveRequested: (() => boolean) | null = null;
  robberies: Robberies;
  /** Round 7: Tidewater Arms is a walk-in store (guns on the wall) */
  guns: GunStore;
  salon: Salon;
  constructor(private game: Game, private ui: GameUI, private ctx: MissionCtx) {
    this.bayMk = BAYS.map(b => ctx.marker(bayPark(b), 2.7, b.accent, `${b.name.toUpperCase()}  ·  REPAIR, PAINT, SELL`));
    this.garage = new GarageBays(game, ui, { view: i => this.garageView(i), repair: () => this.garageRepair(), paint: hex => this.garagePaint(hex), sell: i => this.garageSell(i) });
    this.garage.onDone = () => { this.garageArmed = false; this.onSaveRequested?.(); }; // not again until you drive out and back in
    this.dealerMk = ctx.marker(PLACES.dealer, 1.4, '#ff6b5e', 'REDLINE MOTORS');
    this.snackMk = ctx.marker(PLACES.snack, 1.3, '#ff8fb1', 'PIER 9 SNACKS');
    this.safeMk = ctx.marker(PLACES.safehouse, 1.3, '#9be8a6', 'SAFEHOUSE  ·  SAVE');
    this.buildRamps();
    this.robberies = new Robberies(game, ui, (x, z) => ctx.groundY(x, z));
    this.salon = new Salon(game, ui, () => this.robberies.kiosks);
    this.guns = new GunStore(game, () => this.robberies.kiosks);
    this.salon.onChanged = () => { this.onSaveRequested?.(); };
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
    for (const m of rampMeshes(RAMPS, (x, z) => this.ctx.groundY(x, z))) this.game.renderer.scene.add(m);
    for (const r of RAMPS) {
      const w = r.w, base = this.ctx.groundY(r.x, r.z);
      const ang = Math.atan2(r.h, r.len), hyp = Math.hypot(r.len, r.h);
      // inclined collider
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
      ...BAYS.map(bb => ({ x: bb.cx, z: bb.zf + bb.d / 2, kind: 'garage' as const, label: bb.name })),
      { x: PLACES.dealer.x, z: PLACES.dealer.z, kind: 'garage', label: 'Redline Motors' },
      { x: PLACES.snack.x, z: PLACES.snack.z, kind: 'shop', label: 'Pier 9 Snacks' }, { x: PLACES.safehouse.x, z: PLACES.safehouse.z, kind: 'safehouse', label: 'Safehouse' },
      ...RAMPS.map((r, i) => ({ x: r.x, z: r.z, kind: 'ramp' as const, label: this.jumpsDone.has(i) ? `${r.name} ✓` : r.name })),
      ...LANDMARKS.map(l => ({ x: l.x, z: l.z, kind: 'landmark' as const, label: l.name })),
      ...this.robberies.blips(),
    ];
    return b;
  }
  armsItems(): ShopItem[] {
    const g = this.game, inv = g.pcombat.inv;
    const items: ShopItem[] = [];
    for (const id of WEAPON_ORDER) { // COMBAT: full Tidewater Arms catalogue, grouped by category
      if (id === 'fists') continue;
      const w = WEAPONS[id], st = inv.weapons[id];
      const kind = w.melee ? 'Melee' : w.cat === 'throw' ? `Pack of ${w.ammoPack + w.clip}` : `${w.clip}-round ${w.mode === 'burst' ? 'burst' : w.mode}${w.scope ? ', scoped' : ''}`;
      if (!st.owned || (w.cat === 'throw' && inv.total(id) === 0)) items.push({ id: `w:${id}:${w.icon}`, label: w.name, description: `${w.blurb} ${kind}.`, price: w.price, disabled: g.money < w.price });
      else if (!w.melee) items.push({ id: `a:${id}:${w.icon}`, label: w.cat === 'throw' ? `${w.name} x${w.ammoPack}` : `${w.name} ammo`, description: `+${w.ammoPack} ${w.cat === 'throw' ? '' : 'rounds '}(carrying ${st.reserve + st.clip}).`, price: w.ammoPrice, disabled: g.money < w.ammoPrice });
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
  private shopItems(): ShopItem[] {
    const items = this.shopOpen === 'snack' ? this.snackItems() : this.shopOpen === 'dealer' ? this.dealerItems() : this.armsItems();
    for (const it of items) it.stats = shopStats(it.id); // R11-M: bars for the store detail pane
    return items;
  }
  // ---------------------------------------------------------------- dealership, garage, net worth, milestones
  dealerItems(): ShopItem[] {
    const g = this.game, full = this.ownedCars.length >= GARAGE_SLOTS.length;
    return DEALER_KINDS.map(k => {
      const s = VEHICLES[k], price = CAR_PRICES[k]!, n = this.ownedCars.filter(c => c.kind === k).length;
      return { id: `car:${k}`, label: s.name, description: `${s.cls[0].toUpperCase()}${s.cls.slice(1)}, top speed ${Math.round(s.topSpeed * 2.237)} mph. Parked in your garage row; resells for $${carValue(k).toLocaleString('en-US')}.${n ? ` You own ${n}.` : ''}${full ? ' Garage full.' : ''}`, price, disabled: g.money < price || full };
    });
  }
  /** Buys a car: it is paid for, parked in the next free garage slot and kept in the save. */
  buyCar(kind: VehicleKind): boolean {
    const g = this.game, price = CAR_PRICES[kind];
    if (price === undefined || g.money < price || this.ownedCars.length >= GARAGE_SLOTS.length) return false;
    g.addMoney(-price); g.audio.play('purchase');
    this.ownedCars.push({ kind, paint: Math.floor(Math.random() * VEHICLES[kind].paints.length) });
    this.ownedVeh.push(null);
    this.parkOwned();
    this.ui.toast(`${VEHICLES[kind].name} bought. It is parked in your garage row on 1st St`, 'money');
    this.checkMilestones(); this.onSaveRequested?.();
    return true;
  }
  /** Loads owned cars from a save (their vehicles appear when parkOwned runs). */
  loadOwned(cars: OwnedCar[], milestones: string[], robberies: number) {
    for (const v of this.ownedVeh) if (v && this.game.vehicles.list.includes(v)) this.game.vehicles.remove(v);
    this.ownedCars = cars.map(c => ({ ...c })); this.ownedVeh = this.ownedCars.map(() => null);
    this.milestones = new Set(milestones); this.robberyBase = robberies;
  }
  get robberiesTotal() { return this.robberyBase + this.robberies.completed; }
  /** Parks every owned car that is missing (new purchase, lost or destroyed) in its slot, if the slot is clear. */
  parkOwned() {
    const g = this.game;
    this.ownedCars.forEach((c, i) => {
      const v = this.ownedVeh[i];
      if (v && !v.destroyed && g.vehicles.list.includes(v)) return;
      if (v && g.vehicles.list.includes(v)) g.vehicles.remove(v);
      this.ownedVeh[i] = null;
      const s = GARAGE_SLOTS[i];
      if (g.vehicles.list.some(o => Math.hypot(o.position.x - s.x, o.position.z - s.z) < 3.2)) return; // slot busy: try later
      const nv = g.vehicles.spawn(c.kind, s.x, s.z, s.yaw, c.paint, this.ctx.groundY(s.x, s.z) + 0.4);
      nv.persistent = true; nv.playerUsed = true; // yours: never cleaned up as traffic, doors open for you
      this.ownedVeh[i] = nv;
    });
  }
  netWorth() { return netWorth(this.game.money, this.ownedCars); }
  checkMilestones() {
    const g = this.game;
    if (g.mode !== 'regular') return;
    const st = { cash: g.money, worth: this.netWorth(), cars: this.ownedCars, robberies: this.robberiesTotal, isSports: (k: VehicleKind) => ['sports', 'super'].includes(VEHICLES[k].cls) };
    for (const m of newMilestones(st, this.milestones)) {
      this.milestones.add(m.id);
      this.ui.toast(`Goal reached: ${m.label}`, 'mission'); g.audio.play('checkpoint');
    }
  }
  /** Index of the garage hall the point is in (-1: none). */
  garageAt(p: THREE.Vector3): number { return BAYS.findIndex(b => Math.abs(p.x - b.cx) < b.w / 2 && p.z > b.zf && p.z < b.zf + b.d); }
  private ownedIndex(v: Vehicle | null): number { return v ? this.ownedVeh.indexOf(v) : -1; }
  /** What the garage panel shows for the car in the bay. */
  garageView(bay: number): GarageView | null {
    const g = this.game, v = g.playerVehicle; if (!v) return null;
    const frac = v.health / v.spec.health, rep = repairPrice(frac, v.lightsBroken), seen = g.police.heat > 0 && g.police.state.seen;
    const q = this.sellOffer(bay, v);
    const need = (n: number) => `Need $${(n - g.money).toLocaleString('en-US')} more.`;
    const curHex = '#' + v.paint.getHexString(THREE.SRGBColorSpace);
    const baySpec = BAYS[bay];
    return {
      title: baySpec?.name ?? 'Garage', accent: baySpec?.accent ?? '#f5a855', money: g.money,
      car: v.spec.name, carClass: v.spec.cls.toUpperCase(), healthPct: Math.max(0, Math.min(1, frac)) * 100,
      currentHex: curHex,
      paintName: GARAGE_PAINTS.find(p => p[0].toLowerCase() === curHex.toLowerCase())?.[1] ?? 'Factory Finish',
      repair: { price: rep, enabled: rep > 0 && g.money >= rep, note: !rep ? 'Vehicle is in pristine condition.' : g.money < rep ? need(rep) : 'Full chassis, bodywork, glazing & lighting restoration.' },
      paints: GARAGE_PAINTS.map(([hex, name]) => ({ hex, name })), paintPrice: RESPRAY,
      paintEnabled: !seen && g.money >= RESPRAY,
      paintNote: seen ? 'Cannot respray while police have visual.' : g.money < RESPRAY ? need(RESPRAY) : g.police.heat > 0 ? 'Respray clears active wanted level immediately.' : 'Preview any finish live in the bay before purchasing.',
      sell: { price: q.price, ok: q.ok, note: q.reason },
    };
  }
  /** The buyer's offer (or refusal) for a car at a garage. */
  sellOffer(bay: number, v: Vehicle) {
    const owned = this.ownedIndex(v) >= 0;
    return sellQuote({ kind: v.kind, healthFrac: v.health / v.spec.health, owned, heat: this.game.police.heat, sinceHeat: this.sinceHeat, cooldownLeft: this.sales.cool[bay] ?? 0, recentSameKind: recentOfKind(this.sales, v.kind) });
  }
  private garageRepair() {
    const g = this.game, pv = g.playerVehicle; if (!pv) return;
    const rep = repairPrice(pv.health / pv.spec.health, pv.lightsBroken);
    if (!rep || g.money < rep) return;
    g.addMoney(-rep); g.audio.play('purchase');
    pv.health = pv.spec.health; pv.lightsBroken = false; pv.phys.enginePower = 1; pv.resetBody(); this.ui.toast('Good as new.', 'money');
  }
  private garagePaint(hex: string): boolean {
    const g = this.game, pv = g.playerVehicle; if (!pv) return false;
    if (g.police.heat > 0 && g.police.state.seen) { this.ui.toast('Not while the police are watching', 'warning'); return false; }
    if (g.money < RESPRAY) return false;
    g.addMoney(-RESPRAY); g.audio.play('purchase');
    pv.respray(hex); const hadHeat = g.police.heat > 0; g.police.clear();
    this.ui.toast(hadHeat ? 'Fresh paint. The heat is off.' : 'Fresh paint.', 'money');
    return true;
  }
  /** Sells the player's car: pays, logs the sale (cooldown, repeat discount) and drops it from your garage row. Returns the car to remove. */
  private garageSell(bay: number): Vehicle | null {
    const g = this.game, pv = g.playerVehicle; if (!pv) return null;
    const q = this.sellOffer(bay, pv);
    if (!q.ok) { this.ui.toast(q.reason, 'warning'); return null; }
    const i = this.ownedIndex(pv);
    if (i >= 0) { this.ownedCars.splice(i, 1); this.ownedVeh.splice(i, 1); }
    g.addMoney(q.price); g.audio.play('money');
    recordSale(this.sales, bay, pv.kind);
    this.ui.toast(`${pv.spec.name} sold  ·  +$${q.price.toLocaleString('en-US')}`, 'money');
    return pv;
  }
  /** Sale cooldowns and the repeat-sale log for the save (in-game seconds). */
  salesState(): SaleLog { return { cool: [...this.sales.cool], sold: this.sales.sold.map(s => ({ ...s })) }; }
  loadSales(s: SaleLog | undefined) { this.sales = s ? { cool: BAYS.map((_, i) => Math.min(SELL_COOLDOWN, s.cool[i] ?? 0)), sold: s.sold.map(x => ({ ...x })) } : newSaleLog(BAYS.length); }
  /** Net worth and goals, shown in the shop panel (read-only). */
  goalItems(): ShopItem[] {
    const g = this.game, f = (n: number) => `$${n.toLocaleString('en-US')}`;
    const items: ShopItem[] = [
      { id: 'worth', label: 'Net worth', description: `Cash ${f(g.money)} plus ${this.ownedCars.length} car${this.ownedCars.length === 1 ? '' : 's'} at resale ${f(this.ownedCars.reduce((s, c) => s + carValue(c.kind), 0))}.`, price: 0, info: { value: f(this.netWorth()) } },
      { id: 'robs', label: 'Holdups pulled off', description: 'Stores, banks and jewelers are the fast money. The police are not fond of it.', price: 0, info: { value: String(this.robberiesTotal) } },
    ];
    for (const m of MILESTONES) items.push({ id: `m:${m.id}`, label: m.label, description: this.milestones.has(m.id) ? 'Done.' : m.hint, price: 0, info: {}, owned: this.milestones.has(m.id) });
    return items;
  }
  openGoals() { this.ui.openShop('Net worth and goals', this.goalItems(), this.game.money, () => {}, () => {}); }
  private buy(id: string) {
    const g = this.game, inv = g.pcombat.inv;
    const pay = (n: number) => { if (g.money < n) return false; g.addMoney(-n); g.audio.play('purchase'); return true; };
    if (id.startsWith('car:')) this.buyCar(id.slice(4) as VehicleKind);
    else if (id.startsWith('w:')) { const w = id.split(':')[1] as WeaponId; if (pay(WEAPONS[w].price)) { g.pcombat.give(w, WEAPONS[w].ammoPack + WEAPONS[w].clip); inv.select(w); } }
    else if (id.startsWith('a:')) { const w = id.split(':')[1] as WeaponId; if (pay(WEAPONS[w].ammoPrice)) g.pcombat.give(w, WEAPONS[w].ammoPack); }
    else if (id === 'armor') { if (g.player.armor < 100 && pay(350)) g.player.armor = 100; }
    else if (id === 'medkit') { const price = this.shopOpen === 'snack' ? 140 : 120; if (inv.medkits < 5 && pay(price)) inv.medkits++; }
    else if (id === 'snack') { if (g.player.health < g.player.maxHealth && pay(20)) g.player.health = g.player.maxHealth; }
    this.ui.refreshShop(this.shopItems(), g.money);
  }
  private openShop(kind: 'arms' | 'snack' | 'dealer') {
    const g = this.game;
    this.shopOpen = kind; g.menuOpen = true; g.input.exitLock();
    this.ui.openShop(kind === 'arms' ? (this.guns.kiosk?.def.name ?? 'Tidewater Arms') : kind === 'dealer' ? 'Redline Motors' : 'Pier 9 Snacks', this.shopItems(), g.money, id => this.buy(id), () => this.closeShop());
  }
  closeShop() { this.salon.close(); this.garage.abort(); if (!this.shopOpen) return; this.shopOpen = null; this.game.menuOpen = false; this.ui.closeShop(); }
  get shopIsOpen() { return !!this.shopOpen || this.salon.isOpen || this.garage.active; }
  /** Contextual prompt for the HUD. */
  prompt(): string | null {
    const g = this.game, p = g.player.pos;
    if (g.playerVehicle) return this.garageAt(g.playerVehicle.position) >= 0 && !this.missionActive() && this.garageArmed ? 'Stop inside: repair, respray, sell' : (this.missionActive() ? null : g.taxiJob?.prompt() ?? null); // not again until you drive out and back in
    const key = (g.settings.bindings.interact[0] ?? 'KeyE').replace('Key', '');
    if (g.taxi?.riding) return g.taxi.prompt(key);
    if (!this.robberies.robbing && this.guns.atCounter(p)) return `${key}  Browse Tidewater Arms`;
    { const f = this.robberies.robbing ? null : this.guns.facing(p, g.player.yaw); if (f) return f.ammo ? `${key}  ${f.name} ammo  $${f.price}` : `${key}  Buy ${f.name}  $${f.price}`; }
    if (this.snackMk.inside(p, 2.5)) return `${key}  Grab a snack`;
    if (this.dealerMk.inside(p, 2.5)) return `${key}  Browse Redline Motors`;
    if (this.safeMk.inside(p, 2.5)) return `${key}  Save game`;
    { const sp = this.salon.prompt(key); if (sp && !this.robberies.robbing) return sp; }
    return (this.missionActive() ? null : this.robberies.prompt()) ?? g.taxi?.prompt(key) ?? null;
  }
  update(dt: number) {
    const g = this.game, p = g.player.pos, t = g.time;
    Marker.updateAll(t, g.renderer.camera.position); // Round 11: the safehouse marker at spawn washed the screen green (never faded)
    for (const c of this.cards) if (c) { c.rotation.y += dt * 1.5; c.position.y += Math.sin(t * 2) * 0.002; }
    if (!g.paused) this.robberies.update(dt, this.missionActive());
    this.guns.update(); // hang the guns once the store interior is built
    if (!g.paused) {
      this.goalT -= dt; this.garageT -= dt;
      for (let i = 0; i < this.sales.cool.length; i++) this.sales.cool[i] = Math.max(0, this.sales.cool[i] - dt);
      for (const sl of this.sales.sold) sl.age += dt;
      this.sales.sold = this.sales.sold.filter(sl => sl.age < g.dayLength);
      this.sinceHeat = g.police.heat > 0 ? 0 : this.sinceHeat + dt;
      if (this.goalT <= 0) { this.goalT = 1.5; this.checkMilestones(); }
      if (this.garageT <= 0) { this.garageT = 4; if (g.deathT < 0) this.parkOwned(); }
    }
    this.salon.update(dt);
    if (this.salon.isOpen) return;
    if (g.inputBlocked && !this.shopOpen) return;
    if (this.shopOpen) { if (g.input.justPressed('pause')) this.closeShop(); return; }
    // interactions
    if (!g.playerVehicle && g.input.justPressed('interact')) {
      if (g.taxi?.riding) g.taxi.interact();
      else if (this.salon.inside() && !this.robberies.robbing) this.salon.open();
      else if (!this.robberies.robbing && this.guns.atCounter(p)) this.openShop('arms');
      else if (!this.robberies.robbing && this.guns.facing(p, g.player.yaw)) { const f = this.guns.facing(p, g.player.yaw)!; this.shopOpen = 'arms'; this.buy(`${f.ammo ? 'a' : 'w'}:${f.id}:${WEAPONS[f.id].icon}`); this.shopOpen = null; }
      else if (this.snackMk.inside(p, 2.5)) this.openShop('snack');
      else if (this.dealerMk.inside(p, 2.5)) this.openShop('dealer');
      else if (this.safeMk.inside(p, 2.5)) { const saved = this.onSaveRequested?.() ?? false; g.player.health = g.player.maxHealth; this.ui.toast(saved ? 'Game saved. Rested to full health.' : 'Rested to full health. (Free Roam games are not saved.)', 'info'); g.audio.play('uiClick'); }
      else if (!this.robberies.robbing && !this.missionActive()) g.taxi?.interact(); // hail a cab
    }
    // Garage halls: stop inside and the visit starts (door, camera, pause: see garageBay.ts)
    const pv = g.playerVehicle;
    const bay = pv ? this.garage.bayFor(pv) : -1;
    if (!pv || this.garageAt(pv.position) < 0) this.garageArmed = true; // (the car's own position: the player's is only synced on a fixed step)
    else if (this.missionActive()) this.garageArmed = false; // a mission drop-off here is not a visit
    if (pv && bay >= 0 && this.garageArmed && !pv.destroyed && !this.missionActive() && this.garage.begin(bay)) this.garageArmed = false;
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
      if (!pv.phys.grounded && !this.airborne && this.rampT > 0 && Math.abs(pv.speed) > 9) this.airborne = { t: 0, start: pv.position.clone(), ramp: this.lastRamp };
      if (this.airborne) {
        this.airborne.t += dt;
        if (pv.phys.grounded && this.airborne.t > 0.25) {
          const dist = pv.position.distanceTo(this.airborne.start), a = this.airborne;
          this.airborne = null;
          if (dist > RAMPS[a.ramp].minDist && a.t > RAMPS[a.ramp].minAir) {
            const first = !this.jumpsDone.has(a.ramp);
            const reward = first ? 300 : 50;
            this.jumpsDone.add(a.ramp); g.addMoney(reward);
            g.renderer.pulseImpact(0.28);
            this.ui.toast(`Stunt jump ${this.jumpsDone.size}/${RAMPS.length}  ·  ${RAMPS[a.ramp].name}  ${Math.round(dist * 3.28084)} ft  ·  +$${reward}`, 'money');
            if (first && this.jumpsDone.size === RAMPS.length) { g.addMoney(1500); this.ui.missionCard('Every stunt jump cleared', 'A $1,500 stunt master bonus across Port Meridian.', 'passed'); }
            g.audio.play('checkpoint');
          }
        }
        if (this.airborne && this.airborne.t > 8) this.airborne = null;
      }
      // Clean street drift cash bonus (rewards sustained powerslides without crashing)
      if (this.driftCool > 0) this.driftCool = Math.max(0, this.driftCool - dt);
      const lv = pv.phys.body.linvel(), fwd = pv.phys.forward();
      const latSpeed = Math.abs(lv.x * -fwd.z + lv.z * fwd.x);
      const sp = Math.abs(pv.speed);
      const drifting = pv.phys.grounded && !pv.destroyed && sp > 9.5 && latSpeed > 3.6;
      if (drifting) {
        if (this.driftT === 0) this.driftStartCrashes = g.stats.crashes;
        this.driftT += dt;
        this.driftDist += sp * dt;
        if (g.stats.crashes > this.driftStartCrashes) { this.driftT = 0; this.driftDist = 0; }
      } else if (this.driftT > 0) {
        if (this.driftT >= 1.15 && this.driftDist >= 16 && g.stats.crashes === this.driftStartCrashes && this.driftCool <= 0) {
          const bonus = Math.min(250, Math.max(25, Math.round(((this.driftDist / 16) * 25) / 5) * 5));
          g.addMoney(bonus);
          g.audio.play('money');
          this.ui.toast(`Drift bonus  ·  ${Math.round(this.driftDist * 3.28084)} ft  ·  +$${bonus}`, 'money');
          this.driftCool = 3.5;
        }
        this.driftT = 0; this.driftDist = 0;
      }
    } else { this.airborne = null; this.driftT = 0; this.driftDist = 0; }
  }
}
