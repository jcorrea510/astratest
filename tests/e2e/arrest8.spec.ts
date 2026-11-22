import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 8 (owner): "the arresting animation is so glitchy, it takes so long": tased -> stays down (no stand-up, kneel again) -> cuffed, quickly. */
test('arrest: once down the suspect stays down, and it is over in a few seconds', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, pl = g.player, D = g.police.dispatch;
    g.police.setHeat(1, pl.pos);
    const cop = g.pop.spawn('police', pl.pos.x + 5, pl.pos.z, pl.pos.y); cop.persistent = true;
    D.arm(cop, 'police', 1, false); g.police.foot.push(cop); cop.target = pl; cop.lastSeen.copy(pl.pos);
    let t = 0, started = -1, ended = -1, downAt = -1, stoodUp = 0; const states: string[] = [];
    for (let i = 0; i < 30 * 25 && ended < 0; i++) {
      g.frame(1 / 30, false); t += 1 / 30;
      const st = D.arrestStage;
      if (st !== 'none' && started < 0) started = t;
      const s = pl.human.currentState + '/' + (pl.human.actionName ?? '');
      if (started >= 0 && states[states.length - 1] !== s) states.push(s);
      const down = pl.human.currentState === 'crouch';
      if (down && downAt < 0) downAt = t;
      if (downAt >= 0 && !down && st !== 'none') stoodUp++;
      if (started >= 0 && st === 'none') ended = t;
      if (started >= 0 && D.arrest?.finished && ended < 0) ended = t;
    }
    return { started, dur: ended > 0 ? +(ended - started).toFixed(1) : -1, stoodUp, states: states.slice(0, 12) };
  });
  console.log('arrest', JSON.stringify(r));
  expect(r.started).toBeGreaterThanOrEqual(0);
  expect(r.dur).toBeGreaterThan(0);
  expect(r.dur).toBeLessThan(6.5);
  expect(r.stoodUp).toBe(0);
});
