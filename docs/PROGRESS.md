# Progress (newest first; keep short — git has history)

Resume: read CLAUDE.md, this file. Continue unfinished items. Owner rules in CLAUDE.md.

## Round 14 (owner 26 Nov: "sell cars sooner; 10+ helpers on looks and performance") — docs/ROUND14.md
- Car sale cooldown 180 s -> 15 s (garage SELL_COOLDOWN; saved cooldowns clamped on load).
- 12 helpers: perfPolicy (iPad/Mac default Medium, pixel budget, adaptive res v2 to 16.7 ms, GPU timer), CAS sharpen + FXAA+,
  sky/fog, car paint/glass, facade/ground shader cost, people LODs, car screen-size LODs, tree far LOD, building fine-trim LOD,
  wheel triangle diet, spatial grids (traffic/population), main loop (120 Hz skip, no per-frame allocations).
- Lead: fingertip leaf bones were unmapped (painted as clothes = dark nails), hoodie neckline/hood/hem cleaned, AO blur 9 taps.
- CI (shots.yml + scripts/perf.mjs, SwiftShader, medium 1280x720): street day 928k -> 758k tris, 189 -> 172 calls; night
  1.36M -> 1.10M, 280 -> 269; skyline 1.0M -> 752k. ms numbers there are software-GL noise; iPad GPU time unmeasured here.
- Open: 128k-tri single "Mesh" (likely terrain) not yet split; night shop interiors read too white.

## Round 13 (owner 26 Nov, iPad: "looks like an itch game, make it look like real life") — docs/ROUND13.md
- Touch controls (mobile). ~20 parallel helpers: people shader split into src/actors/shade (skin, face/eyes, tops, bottoms+shoes,
  hair) + realistic palettes (look.ts); every gun rebuilt in src/combat/guns (one file each, procedural materials.ts).
- World: car paint/glass/tyres (carMaterial), wheels/brakes/mirrors (parts), asphalt/sidewalk/grass (materials), facades
  (real-city palettes, weathering, glass Fresnel), trees, daylight/sky/grade (sky.ts, renderer LOOK.natural).
- Owner bugs (lead): headlights glare (lower intensity/decay/lens), daytime signals (lens texture, hue-safe colours, visors,
  smaller heads), left-lane cars stuck (left turners take the amber once oncoming stops: trafficRules mayClearLeft).
- Visual checks run in CI (.github/workflows/shots.yml: edit docs/shots/request.json, images land in docs/shots/out).

## Round 12 (owner 25 Nov: "graphics and performance are bad; make it a high quality game, UI included") — PR #1
- Graphics: half-res SAO ambient occlusion (Medium/High, render/post.ts), FXAA in the grade pass when MSAA is off, AgX tone
  curve + S-curve, more sun / less sky fill by day, darker nights (lamps make the pools), softer PCF sun shadows, speed blur
  in cars, night roads no longer glitter (smoothed height field). Facade shader keeps window rows far out, lit towers at night.
- UI: circular dark radar minimap, desaturated map palette, boxless HUD type, thin POI glyphs, pause header fit.
- Perf: static collider streaming (core/staticStream), far logic LOD (game/farLod), prepared vehicle-glass hit tests, pose
  cache. CPU/frame (CDP, SwiftShader A/B): drive 9.8 -> 6.4 ms, foot 8.7 -> ~6.8 ms.
- CI: lint skips root probe scripts (deploys had failed since Nov 16); e2e in 6 shards. Stale e2e refreshed (sea coast,
  Round 9 hold-up rules). Fixed: Low quality never finished loading (composer depthTexture: undefined). Shots docs/screenshots/r12-*.
- Gameplay/realism fixes this round: police helicopter stops holding the heat once outrun; firefight IK allocations cut
  (fight frame ~25 -> ~17 ms headless); walkers stranded in the road step square back onto the kerb (peds7 road share
  4.5-6 % -> 0-0.2 %); far car vs bus junction deadlock breaker; 30 mph car hits ride the hood.
- CI: perfbench runs in its own browser (its GPU backlog timed out the next file's context).
- Headless only: no real GPU here, so GPU cost of AO/FXAA on the M1 is unmeasured (Low turns AO off).

## Round 11 (owner notes 24 Nov night) — see docs/ROUND11.md
- All done and published (4218ff6). Flaky under load only: traffic7 taxi job (passes alone). Probes: .perfprobe/.rcpu/.rprof/.memprobe/.redprobe.
- Can't measure the M1 GPU here: owner's FPS readout now shows CPU ms to tell which side limits.

## Round 10 (owner notes 24 Nov): left turns on red, goals panel
- [x] Left turners ran reds: the pedal lags ~2.4 m/s behind a stop curve, so cars rolled over the bar and the "across and
  rolling" rule let them in; amber "go" ignored the slow-down for the turn. Fix: lag-compensated stop (lineStop), stop on
  the zebra if still short of the box, left turners stop on amber (sneak only from the line), cross traffic waits for a car
  crossing the box, gap check sees 90 m + far-crowd cars, no stopping across oncoming lanes. .redprobe.mjs (3 junctions x
  180 s): red entries ~20 -> 0-3 (amber sneaks), crashes 3-11 -> 0-1. Tests: leftTurn10.test.ts.
- [x] Goals panel text overlapped: icon-less lists put the text in the 70 px icon column and the list squeezed rows. CSS fix; e2e goals10.
- [x] Also fixed (were failing before this round): buses arrived rolling and their door never opened; drivers crawl past a
  standing wreck after the 5 s crash stop; traffic6's red-light check used a stale signal cycle (now __meridian.signal).
- Owner asked about an Xcode/iPad build: answered (WKWebView = same WebKit as Safari; Add to Home Screen already works).

## Round 9 (owner notes 23 Nov) — see docs/ROUND9.md (all items done; gate + publish last)
- Junction probe (.jprobe-style, 120 s): grid 14 -> 3 bumps, Broadway 14 -> 7 (then lanes moved past cross streets).
- Known: mid-game shader compiles ~2 per tour (quality switch); Mac M1 fps not measurable here (no GPU).

## Round 8 (owner play-test 22 Nov on iPad + Mac) — see docs/ROUND8.md
- [x] Mac freezes ~1/s: adaptive resolution thrash (resize on every 33 ms crossing) + lights added mid-game (full shader recompile) + sky env rebuilt every 6 s. All fixed with tests.

Older rounds: see git history of this file.
