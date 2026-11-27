// CI performance probe (the agents' machine has no browser). Reads docs/shots/perf.json:
//   { "quality": ["medium", "high"], "scenes": [{ "name": "street-day", "hour": 15, "at": 3 }, ...] }
// For each quality and scene: CPU ms per simulated frame (no render), render ms per frame (GPU synced with a 1-px read,
// SwiftShader: software GL, so read the numbers as relative costs), the cost of each render feature (shadow map, AO,
// bloom, grade), the scene's heaviest top-level groups, and a CPU profile (self time by file and by function).
// Writes docs/shots/out/perf.txt. Needs a dev server on PORT (default 5199).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const port = process.env.PORT ?? '5199';
const req = JSON.parse(readFileSync('docs/shots/perf.json', 'utf8'));
mkdirSync('docs/shots/out', { recursive: true });
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const quality of req.quality ?? ['medium']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => log(`pageerror: ${e.message}`));
  try {
    await p.goto(`http://localhost:${port}/astratest/?autostart=1&quality=${quality}`);
    await p.waitForFunction(() => !!window.__meridian, null, { timeout: 300000 });
    await p.evaluate(() => { window.__game.stop(); });
    await p.addStyleTag({ content: '.ma-root { visibility: hidden !important; }' }).catch(() => {});
    const cdp = await p.context().newCDPSession(p);
    for (const sc of req.scenes) {
      log(`\n=== ${quality} / ${sc.name} (hour ${sc.hour}) ===`);
      const r = await p.evaluate((sc) => {
        const g = window.__game, R = g.renderer, gl = R.renderer.getContext(), px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        g.hour = sc.hour; g.clockRunning = false;
        const I = g.city.intersections.filter(i => i.signalized)[sc.at ?? 3];
        g.player.place(I.x + 12, 1, I.z + 12, sc.yaw ?? 0); g.cam.yaw = sc.yaw ?? 0; g.cam.pitch = -0.05;
        if (sc.eval) (new Function('g', 'M', sc.eval))(g, window.__meridian);
        for (let i = 0; i < 120; i++) g.frame(1 / 60, false);
        g.frame(1 / 60, true); sync();
        const now = () => performance.now();
        let t = now(); for (let i = 0; i < 240; i++) g.frame(1 / 60, false); const simMs = (now() - t) / 240;
        const N = sc.renderFrames ?? 6;
        const measure = (fn) => { R.render(); sync(); const t0 = now(); for (let i = 0; i < N; i++) { fn?.(); R.render(); sync(); } return +((now() - t0) / N).toFixed(1); };
        const res = { simMs: +simMs.toFixed(2), px: [R.renderer.domElement.width, R.renderer.domElement.height] };
        const sm = R.renderer.shadowMap;
        res.base = measure(); res.stats = { ...R.stats };
        res.shadowEveryFrame = measure(() => { sm.needsUpdate = true; });
        const se = sm.enabled; sm.enabled = false; res.noShadows = measure(); sm.enabled = se;
        if (R.ao) { const e = R.ao.enabled; R.ao.enabled = false; res.noAO = measure(); R.ao.enabled = e; }
        { const e = R.bloom.enabled; R.bloom.enabled = !e; res[e ? 'noBloom' : 'withBloom'] = measure(); R.bloom.enabled = e; }
        // raw scene only (no composer): the cost of the main pass alone
        { const t0 = now(); for (let i = 0; i < N; i++) { R.renderer.setRenderTarget(null); R.renderer.render(R.scene, R.camera); sync(); } res.sceneOnly = +((now() - t0) / N).toFixed(1); }
        // heaviest top-level groups (visible triangles, ignoring frustum)
        const groups = [];
        for (const c of R.scene.children) {
          if (!c.visible) continue;
          let tris = 0, meshes = 0, skinned = 0;
          c.traverseVisible(o => {
            if (!o.isMesh) return; meshes++; if (o.isSkinnedMesh) skinned++;
            const geo = o.geometry, n = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0;
            tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
          });
          if (meshes) groups.push({ name: c.name || c.type, tris: Math.round(tris), meshes, skinned });
        }
        groups.sort((a, b) => b.tris - a.tris); res.groups = groups.slice(0, 14);
        let objs = 0; R.scene.traverse(() => objs++); res.objects = objs;
        // hide-one-group render cost for the top 6 groups
        res.hideCost = {};
        for (const gr of groups.slice(0, sc.hideTop ?? 3)) {
          const c = R.scene.children.find(x => (x.name || x.type) === gr.name && x.visible); if (!c) continue;
          c.visible = false; const ms = measure(); c.visible = true; res.hideCost[gr.name] = ms;
        }
        return res;
      }, sc);
      log(JSON.stringify(r, null, 0));
      // CPU profile: simulation + render together
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start');
      await p.evaluate((sc) => { const g = window.__game; for (let i = 0; i < (sc.profileFrames ?? 30); i++) g.frame(1 / 60, sc.profileRender ?? true); }, sc);
      const { profile } = await cdp.send('Profiler.stop');
      const byFile = new Map(), byFn = new Map(); let total = 0;
      const dt = profile.timeDeltas ?? []; const self = new Map();
      (profile.samples ?? []).forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
      for (const n of profile.nodes) {
        const us = self.get(n.id) ?? 0; if (!us) continue; total += us;
        const url = (n.callFrame.url || '(native)').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
        const fn = `${n.callFrame.functionName || '(anon)'} ${url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
        byFile.set(url, (byFile.get(url) ?? 0) + us); byFn.set(fn, (byFn.get(fn) ?? 0) + us);
      }
      // inclusive (self + callees) time per src/ function: which game system a cost belongs to
      const kids = new Map(profile.nodes.map(n => [n.id, n.children ?? []])), node = new Map(profile.nodes.map(n => [n.id, n]));
      const incl = new Map(); const keyOf = (n) => { const url = (n.callFrame.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, ''); return url.includes('/src/') ? `${n.callFrame.functionName || '(anon)'} ${url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}` : null; };
      const walk = (id, onStack) => {
        const n = node.get(id); let t = self.get(id) ?? 0; const k = keyOf(n); const fresh = k && !onStack.has(k); if (fresh) onStack.add(k);
        for (const c of kids.get(id)) t += walk(c, onStack);
        if (fresh) { incl.set(k, (incl.get(k) ?? 0) + t); onStack.delete(k); }
        return t;
      };
      walk(profile.nodes[0].id, new Set());
      const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, us]) => `  ${(100 * us / total).toFixed(1)}%  ${n}`).join('\n');
      const pf = sc.profileFrames ?? 30;
      log(`profile (${pf} frames ${(sc.profileRender ?? true) ? 'with' : 'without'} render, ${(total / 1000 / pf).toFixed(2)} ms/frame sampled) by file:\n${top(byFile, 22)}`);
      log(`by function:\n${top(byFn, sc.topFns ?? 30)}`);
      log(`inclusive (game code, self + callees):\n${top(incl, sc.topFns ?? 30)}`);
      writeFileSync('docs/shots/out/perf.txt', out.join('\n') + '\n'); // partial results survive a timeout
    }
  } catch (e) { log(`FAILED ${e.message}`); }
  await p.close();
}
await b.close();
writeFileSync('docs/shots/out/perf.txt', out.join('\n') + '\n');
