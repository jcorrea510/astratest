import { expect, test } from '@playwright/test';

/**
 * R6-A click detector: the mix graph runs on an OfflineAudioContext (same AudioCore as the game) while the test drives it the
 * way the game does (listener, ambience changes, engines promoted / demoted, sirens, one-shot storms). The rendered output is
 * scanned for sample-to-sample jumps: a pop shows up as a large second difference that a smooth signal never has.
 */
type Lab = { AudioCore: new (c: BaseAudioContext, r?: () => number) => any; registerSample: (k: any, n: string, b: AudioBuffer) => void; EngineVoiceImpl: new (c: () => any) => any; SirenVoice: new (c: () => any) => any; SkidVoice: new (c: () => any) => any };

test.describe('audio pops', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => !!(window as unknown as { __audioLab?: unknown }).__audioLab, null, { timeout: 120_000 });
  });

  async function render(page: import('@playwright/test').Page, scenario: 'city' | 'engines' | 'storm', secs: number) {
    return page.evaluate(async ({ scenario, secs }) => {
      const lab = (window as unknown as { __audioLab: Lab }).__audioLab;
      const SR = 44100; const ctx = new OfflineAudioContext(2, SR * secs, SR);
      let seed = 4242; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const c = new lab.AudioCore(ctx, rand);
      const base = new URL('assets/vehicles/audio/', document.baseURI).href;
      for (const [k, f] of [['engine', 'engine.ogg'], ['engineBike', 'engine-motorcycle.ogg'], ['impact', 'impact.ogg'], ['skid', 'skid.ogg']] as const)
        lab.registerSample(c.kit, k, await ctx.decodeAudioData(await (await fetch(base + f)).arrayBuffer()));
      c.warmAll();
      const step = scenario === 'city' ? 0.05 : 0.025;
      let engines = Array.from({ length: scenario === 'engines' ? 10 : 0 }, () => new lab.EngineVoiceImpl(() => c));
      const heli = new lab.EngineVoiceImpl(() => c); const siren = new lab.SirenVoice(() => c); const skid = new lab.SkidVoice(() => c);
      let churn = 0, maxVoices = 0;
      for (let t = step; t < secs; t += step) {
        ctx.suspend(t).then(() => {
          c.setListener({ x: 0, y: 1.5, z: 0 }, { x: Math.sin(t * 0.2), y: 0, z: -Math.cos(t * 0.2) });
          if (scenario === 'city') {
            if (Math.floor(t / 7) !== Math.floor((t - step) / 7)) { const n = Math.floor(t / 7); c.setAmbience({ night: n % 4 < 2 ? 0 : 1, water: (n % 3) / 2, traffic: ((n * 37) % 10) / 10, park: (n % 2) * 0.8, indoors: n % 5 === 0 ? 1 : 0, crowd: n % 5 === 0 ? 1 : 0, altitude: n % 6 === 5 ? 1 : 0 }); }
            heli.update({ rpm: 0.8, throttle: 0.6, pos: { x: 40 * Math.cos(t * 0.3), y: 30, z: 40 * Math.sin(t * 0.3) }, kind: 'heli', damage: 0 });
          } else if (scenario === 'engines') {
            engines.forEach((e, i) => {
              // crowd promote / demote churn: a voice is replaced by a fresh one every ~1.3 s
              if (Math.floor(t / 1.3 + i * 0.37) !== Math.floor((t - step) / 1.3 + i * 0.37)) { e.stop(); engines[i] = new lab.EngineVoiceImpl(() => c); churn++; }
              const d = 10 + i * 9 + 6 * Math.sin(t * 0.5 + i);
              engines[i].update({ rpm: 0.5 + 0.4 * Math.sin(t + i), throttle: 0.6, pos: { x: d, y: 0, z: -d * 0.5 }, kind: i % 3 ? 'car' : 'truck', damage: 0 });
            });
            siren.update({ x: 30 - t * 2, y: 0, z: 10 }, 1); skid.update({ x: 8, y: 0, z: -4 }, Math.max(0, Math.sin(t)));
          } else {
            // one-shot storm: 40 sounds per second of every kind, far and near
            for (let i = 0; i < 2; i++) c.play(['footstep', 'hitBody', 'crash', 'glass', 'horn', 'doorClose', 'tireScreech', 'stepGravel', 'storeBell', 'carDoorClose'][Math.floor(rand() * 10)], { pos: { x: (rand() - 0.5) * 120, y: 1, z: (rand() - 0.5) * 120 } });
          }
          maxVoices = Math.max(maxVoices, c.activeVoices);
          c.tick(0.2); ctx.resume();
        });
      }
      const buf = await ctx.startRendering();
      const worst: { t: number; dd: number }[] = []; let peak = 0;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 2; i < d.length; i++) {
          peak = Math.max(peak, Math.abs(d[i]));
          const dd = Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]);
          if (dd > 0.06 && i / SR > 0.3 && (!worst.length || i / SR - worst[worst.length - 1].t > 0.05)) worst.push({ t: +(i / SR).toFixed(3), dd: +dd.toFixed(3) });
        }
      }
      return { peak, worst: worst.slice(0, 10), count: worst.length, churn, maxVoices, diag: { ...c.diag } };
    }, { scenario, secs });
  }

  test('60 s of city ambience (day/night/crowd/altitude changes, far horns and sirens, helicopter) has no clicks', async ({ page }) => {
    const r = await render(page, 'city', 60);
    expect(r.peak).toBeGreaterThan(0.005); expect(r.peak).toBeLessThan(0.95);
    expect(r.worst, JSON.stringify(r.worst)).toEqual([]);
  });

  test('engines, sirens and skids promoted / demoted every ~1.3 s fade cleanly', async ({ page }) => {
    const r = await render(page, 'engines', 30);
    expect(r.churn).toBeGreaterThan(50);
    expect(r.worst, JSON.stringify(r.worst)).toEqual([]);
  });

  test('a one-shot storm stays under the voice cap and is rate-limited', async ({ page }) => {
    const r = await render(page, 'storm', 12);
    expect(r.maxVoices).toBeLessThanOrEqual(32);
    expect(r.diag.started).toBeGreaterThan(20);
    expect(r.peak).toBeLessThanOrEqual(0.96);
  });
});
