import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/**
 * Round 9 (owner): "The repair and respray UI is glitched and should be a physical garage. Game should pause while you're in it."
 * and "Selling expensive cars should be a way to make money but balance it out."
 * Drive into the Glow Garage hall -> the door rolls down -> the world is frozen -> repair -> respray (preview) -> sell -> door up -> resume.
 */
test('garage hall: drive in, door closes, world pauses, repair, respray, sell, resume', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page); await quietStreets(page);
  // 1. drive in through the open door; a second car rolling in the street is the "world" that must freeze
  const a = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities;
    g.money = 3000; g.police.clear();
    const other = g.vehicles.spawn('sedan', -150, 60, 0, -1, 0.4); other.persistent = true; (window as any).__other = other;
    const car = g.vehicles.spawn('coupe', -182, 100, 0, -1, 0.4); car.persistent = true; g.seatPlayer(car);
    car.health = car.spec.health * 0.4; (window as any).__car = car;
    other.phys.setVelocity(0, 0, 12);
    const o0 = other.position.z;
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const movedFree = other.position.z - o0; // control: the street is alive before the visit
    let n = 0;
    while (A.garage.state === 'idle' && n++ < 400) {
      if (car.position.z < 119) g.input.press('KeyW'); else { g.input.release('KeyW'); g.input.press('KeyS'); }
      g.frame(1 / 30, false);
    }
    g.input.release('KeyW'); g.input.release('KeyS');
    return { movedFree, state: A.garage.state, paused: g.paused, z: car.position.z, speedOk: Math.abs(car.speed) < 3 };
  });
  console.log('drive-in', JSON.stringify(a));
  expect(a.movedFree).toBeGreaterThan(3);
  expect(a.state).toBe('closing');
  expect(a.paused).toBe(true);
  expect(a.z).toBeGreaterThan(116); expect(a.z).toBeLessThan(127);

  // 2. the door closes (real time) and the menu opens; the world does not advance
  const b = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities, other = (window as any).__other;
    const t0 = g.time, hour0 = g.hour, oz = other.position.z, door = g.renderer.scene.getObjectByName('bayDoor:Glow Garage');
    const open0 = door.scale.y;
    for (let i = 0; i < 70; i++) g.frame(1 / 30, false);
    const car = (window as any).__car;
    return { state: A.garage.state, menu: !!document.querySelector('.ma-garage.is-open'), dTime: g.time - t0, dHour: g.hour - hour0, otherMoved: Math.abs(other.position.z - oz), open0, doorNow: door.scale.y, doorVisible: door.visible, carX: car.position.x, carZ: car.position.z, shopOpen: A.shopIsOpen };
  });
  console.log('closed', JSON.stringify(b));
  expect(b.state).toBe('menu'); expect(b.menu).toBe(true); expect(b.shopOpen).toBe(true);
  expect(b.dTime).toBe(0); expect(b.dHour).toBe(0); expect(b.otherMoved).toBe(0);
  expect(b.doorNow).toBeGreaterThan(0.95); expect(b.doorVisible).toBe(true);
  expect(Math.abs(b.carX + 182)).toBeLessThan(0.2); expect(Math.abs(b.carZ - 120.4)).toBeLessThan(0.3);

  // 3. the menu content, then repair (priced by damage)
  const c = await page.evaluate(() => {
    const g = (window as any).__game, car = (window as any).__car;
    const txt = (s: string) => document.querySelector(s)?.textContent ?? '';
    const m0 = g.money, rep = document.querySelector('[data-act="repair"]') as HTMLElement;
    const price = txt('[data-act="repair"] .ma-garage-price');
    rep.click();
    return { m0, m1: g.money, price, health: car.health / car.spec.health, wallet: txt('.ma-garage .ma-wallet-value'), cond: txt('.ma-garage-condtxt') };
  });
  console.log('repair', JSON.stringify(c));
  expect(c.m0 - c.m1).toBeGreaterThan(100);
  expect(c.health).toBeGreaterThan(0.99);
  expect(c.wallet).toContain(String(c.m1).slice(0, 1));
  expect(c.cond).toBe('100%');

  // 4. respray: focusing a swatch previews the colour (no charge); Respray buys it; leaving after another preview restores it
  const d = await page.evaluate(() => {
    const g = (window as any).__game, car = (window as any).__car;
    const sw = Array.from(document.querySelectorAll('.ma-garage-sw')) as HTMLElement[];
    const hexOf = () => car.paint.getHexString();
    const before = hexOf(), m0 = g.money;
    sw[3].focus(); const previewed = hexOf(); const mPreview = g.money;
    (document.querySelector('[data-act="paint"]') as HTMLElement).click();
    const bought = hexOf(), m1 = g.money, picked = sw[3].dataset.hex, name = document.querySelector('.ma-garage-pick')?.textContent;
    sw[7].focus(); const second = hexOf();
    return { n: sw.length, before, previewed, bought, second, spent: m0 - m1, mPreview: m0 - mPreview, picked, name, nameCount: new Set(sw.map(s => s.getAttribute('aria-label'))).size };
  });
  console.log('respray', JSON.stringify(d));
  expect(d.n).toBeGreaterThanOrEqual(10); expect(d.nameCount).toBe(d.n);
  expect(d.previewed).not.toBe(d.before); expect(d.mPreview).toBe(0);
  expect(d.bought).toBe(d.previewed); expect(d.spent).toBe(150);
  expect(d.second).not.toBe(d.bought);

  // 5. sell: the offer is shown; selling pays, removes the car, the player is on foot outside, the door goes up and the game resumes
  const e = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities, car = (window as any).__car;
    const note = document.querySelector('.ma-garage-sell + .ma-garage-note')?.textContent ?? '';
    const priceTxt = document.querySelector('.ma-garage-sell .ma-garage-price')?.textContent ?? '';
    const m0 = g.money;
    (document.querySelector('[data-act="sell"]') as HTMLElement).click();
    return { note, priceTxt, gain: g.money - m0, inCar: !!g.playerVehicle, listed: g.vehicles.list.includes(car), state: A.garage.state, cool: A.sales.cool.slice(), paused: g.paused };
  });
  console.log('sell', JSON.stringify(e));
  expect(e.priceTxt).toMatch(/^\+\$/);
  expect(e.gain).toBeGreaterThan(50); expect(e.gain).toBeLessThan(1000); // a stolen mid-price coupe is a few hundred, not thousands
  expect(e.inCar).toBe(false); expect(e.listed).toBe(false);
  expect(e.state).toBe('opening'); expect(e.cool[0]).toBe(180);
  const f = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities, other = (window as any).__other;
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    const oz = other.position.z, t0 = g.time;
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    return { state: A.garage.state, paused: g.paused, menuOpen: g.menuOpen, resumedTime: g.time - t0, otherMoved: Math.abs(other.position.z - oz), layer: !!document.querySelector('.ma-garage.is-open'), onFoot: !g.playerVehicle, pz: g.player.pos.z };
  });
  console.log('resume', JSON.stringify(f));
  expect(f.state).toBe('idle'); expect(f.paused).toBe(false); expect(f.menuOpen).toBe(false); expect(f.layer).toBe(false);
  expect(f.resumedTime).toBeGreaterThan(0.5); expect(f.onFoot).toBe(true);
});

test('garage sale rules: refusals, cooldown, repeat discount, owned cars pay more (engine)', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities;
    const mk = (k: string, x = -300) => { const v = g.vehicles.spawn(k, x, 20, 0, -1, 0.4); v.persistent = true; return v; };
    const out: Record<string, any> = {};
    g.police.clear();
    for (const k of ['police', 'fbi', 'swat', 'army', 'tank', 'taxi', 'bus']) out[k] = A.sellOffer(0, mk(k)).ok;
    const sup = mk('super'), hatch = mk('hatch');
    out.super = A.sellOffer(0, sup); out.hatch = A.sellOffer(0, hatch);
    g.police.setHeat(1, g.player.pos);
    out.wanted = A.sellOffer(0, sup);
    g.police.clear();
    A.sinceHeat = 0; // just lost the cops: the car is still hot
    out.hot = A.sellOffer(0, sup);
    A.sinceHeat = Infinity;
    A.sales.cool[0] = 120; out.cool0 = A.sellOffer(0, sup); out.cool1 = A.sellOffer(1, sup); A.sales.cool[0] = 0;
    A.sales.sold.push({ kind: 'super', age: 10 }); out.repeat = A.sellOffer(0, sup);
    A.sales.sold.length = 0;
    // a car you bought: parked in the row, pays far more
    A.ownedCars.push({ kind: 'sedan', paint: 0 }); A.ownedVeh.push(null); A.parkOwned();
    const own = A.ownedVeh[A.ownedVeh.length - 1]; out.own = A.sellOffer(0, own); out.stolenSedan = A.sellOffer(0, mk('sedan'));
    return out;
  });
  console.log('rules', JSON.stringify(r));
  for (const k of ['police', 'fbi', 'swat', 'army', 'tank', 'taxi', 'bus']) expect(r[k], k).toBe(false);
  expect(r.super.ok).toBe(true); expect(r.super.price).toBeGreaterThan(3000); expect(r.super.price).toBeLessThan(7000);
  expect(r.hatch.price).toBeLessThan(250);
  expect(r.wanted.ok).toBe(false); expect(r.hot.ok).toBe(false);
  expect(r.cool0.ok).toBe(false); expect(r.cool0.reason).toContain('2:00'); expect(r.cool1.ok).toBe(true);
  expect(r.repeat.price).toBeLessThan(r.super.price);
  expect(r.own.price).toBeGreaterThan(r.stolenSedan.price * 10);
});
