import { test } from '@playwright/test';
import { boot } from './helpers';
test('probe stumbles', async ({ page }) => {
  test.setTimeout(900_000);
  page.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.clockRunning = false; g.hour = 13; g.pedCap = 90; g.trafficCap = +(new URLSearchParams(location.search).get('tc') ?? 0);
    const H = g.player.human.constructor.prototype; const orig = H.playAction;
    const log: any[] = [];
    const BAD = new Set(['stagger', 'knockdown', 'hit_light', 'hit_head', 'Roll', 'Hit_Chest', 'Hit_Head']);
    H.playAction = function (name: string, o: any) {
      if (BAD.has(name)) {
        const n = g.pop.npcs.find((q: any) => q.char.human === this);
        if (n) { let nd = 99; for (const m of g.pop.npcs) if (m !== n) nd = Math.min(nd, m.pos.distanceTo(n.pos)); let vd = 99, vs = 0, vk = ''; for (const v of g.vehicles.list) { const d = v.position.distanceTo(n.pos); if (d < vd) { vd = d; vs = v.speed; vk = `${v.kind}|drv=${!!v.driver}|pers=${!!v.persistent}|half=${v.tpl.layout.half.map((x:number)=>+x.toFixed(2))}|yaw=${v.yaw.toFixed(2)}|dx=${(n.pos.x-v.position.x).toFixed(2)},dz=${(n.pos.z-v.position.z).toFixed(2)}|vy=${v.position.y.toFixed(2)} py=${n.pos.y.toFixed(2)}`; } }
          log.push({ name, id: n.id, brain: n.brain, nearPed: +nd.toFixed(2), nearVeh: +vd.toFixed(1), vehSpd: +vs.toFixed(1), vk, pl: +n.pos.distanceTo(g.player.pos).toFixed(1), far: n.far, stack: (new Error().stack ?? '').split('\n').slice(2, 6).map(s => s.trim().replace(/\(.*\//, '(')).join(' < ') }); }
      }
      return orig.call(this, name, o);
    };
    g.player.place(-41, 0.25, 9, 0);
    g.prewarm?.();
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    log.length = 0;
    for (let i = 0; i < 60 * 30; i++) g.frame(1 / 30, false);
    return { npcs: g.pop.npcs.length, cars: g.traffic.cars.length, log };
  });
  console.log('DBG', r.npcs, r.cars, r.log.length);
  for (const l of r.log.slice(0, 12)) console.log('DBG', JSON.stringify(l));
});
