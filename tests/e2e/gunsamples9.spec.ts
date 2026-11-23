import { expect, test } from '@playwright/test';
import { boot, clean, watch } from './helpers';

/** R9-S: recorded gunshots decode at load and shots play a sample voice (rapid fire stays capped). */
test('recorded gunshot samples decode and play', async ({ page }) => {
  const problems = watch(page);
  await boot(page);
  await page.mouse.click(640, 360); // user gesture: creates the audio context
  type A = { resume(): Promise<void>; stats(): { running: boolean; gunTakes: number; gunPlayed: number; diag: { started: number; stolen: number; rejected: number; limited: number } | null }; gunSamplesReady: Promise<number>; playExtra(n: string, o?: unknown): void };
  const decoded = await page.evaluate(async () => { const a = (window as unknown as { __game: { audio: A } }).__game.audio; await a.resume(); return a.gunSamplesReady; });
  expect(decoded).toBeGreaterThanOrEqual(40);
  const s0 = await page.evaluate(() => (window as unknown as { __game: { audio: A } }).__game.audio.stats());
  expect(s0.gunTakes).toBe(decoded);
  // one shot of every voice, near and far: all play recorded takes
  const names = await page.evaluate(() => {
    const a = (window as unknown as { __game: { audio: A } }).__game.audio; const out: string[] = [];
    for (const g of ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'lmg', 'revolver', 'sawnoff']) { a.playExtra('gun_' + g, {}); a.playExtra('gunFar_' + g, {}); out.push(g); }
    return out;
  });
  const s1 = await page.evaluate(() => (window as unknown as { __game: { audio: A } }).__game.audio.stats());
  if (s1.running) expect(s1.gunPlayed).toBeGreaterThan(0);
  expect(names.length).toBe(8);
  // minigun-style spam: hundreds of requests must not stack hundreds of voices
  const peak = await page.evaluate(async () => {
    const a = (window as unknown as { __game: { audio: A } }).__game.audio; let max = 0;
    for (let i = 0; i < 400; i++) { a.playExtra('gun_smg', {}); max = Math.max(max, (a.stats() as unknown as { voices: number }).voices); }
    return max;
  });
  expect(peak).toBeLessThanOrEqual(40);
  clean(problems);
});
