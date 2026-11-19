import { test, expect } from '@playwright/test';
import { watch, boot, clean, quietStreets } from './helpers';

/** Owner (3 playtests): the gun dropped to the hip while moving/firing. It must sit on the camera aim line every frame. */
for (const mode of ['aim+fire', 'hip fire (no aim button)', 'hip fire sprint']) {
  test(`gun stays raised on the aim line while moving and firing: ${mode}`, async ({ page }) => {
    test.setTimeout(600_000);
    const p = watch(page);
    await boot(page); await quietStreets(page);
    const res = await page.evaluate((mode) => {
      const g = (window as any).__game;
      g.pcombat.give('pistol', 200); g.pcombat.inv.select('pistol');
      const keys = ['KeyW']; if (mode.includes('sprint')) keys.push('ShiftLeft'); if (mode === 'aim+fire') keys.push('Mouse2');
      keys.push('Mouse0');
      for (const k of keys) g.input.press(k);
      const worst: number[] = []; let raised = 0, n = 0, t = 0;
      const tmp = new g.player.pos.constructor();
      for (let i = 0; i < 110; i++) {
        t += 1 / 60;
        // sweep the camera around while running so the body has to keep turning
        g.cam.yaw += 0.02 * Math.sin(i / 25);
        g.pcombat.inv.state.clip = 12; // never run dry
        g.frame(1 / 60, false);
        if (t < 0.4) continue;
        const camDir = Math.atan2(Math.sin(g.cam.yaw + Math.PI), Math.cos(g.cam.yaw + Math.PI));
        g.pcombat.muzzleWorld(tmp);
        const hand = g.player.human.rightHand.getWorldPosition(new g.player.pos.constructor());
        const a = Math.atan2(tmp.x - hand.x, tmp.z - hand.z); // barrel line: grip -> muzzle
        let d = Math.abs(a - Math.atan2(Math.sin(g.cam.yaw + Math.PI), Math.cos(g.cam.yaw + Math.PI)));
        d = Math.min(d, Math.PI * 2 - d); void camDir;
        worst.push(d); n++; if (d < 0.5) raised++;
      }
      for (const k of keys) g.input.release(k);
      return { frac: raised / n, max: Math.max(...worst), moved: g.player.speed };
    }, mode);
    expect(res.frac, JSON.stringify(res)).toBeGreaterThan(0.97);
    clean(p);
  });
}
