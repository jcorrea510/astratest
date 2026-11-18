# Progress (Meridian Afterglow)

Resume rule: read docs/BRIEF2.md (current overnight brief) and this file; continue the first unfinished item under
"Overnight plan". Never restart. Keep context lean: delegate big chunks to agents with file ownership, commit often.
Auto-resume: hourly scheduled task trig_016PqqKSxtjK4pY12UGrxzTE (":14 every hour") fires into this session; delete it when all done.

## Overnight plan (BRIEF2) — status
- [ ] W0 setup: brief saved, hourly task, story mode removed (sandbox-only game).
- [ ] W1a Vehicles: procedural realistic 2000s cars (10+ original models: compact, sedan, luxury land-yacht, muscle, sports,
      convertible, pickup, SUV, race car, taxi, cop cruiser, FBI SUV, SWAT van, army truck, tank), opening doors, easier steering.
- [ ] W1b People: realistic humans (genders, skin tones, heights, hairstyles, clothes), new walk/run/jump (no stuck jump pose,
      curbs step up), wind-up punch that needs range, NPC voices (hey/screams).
- [ ] W1c Shooting: dot reticle, bullets go to the aim point, hit zones (head kill, 1-2 body), many more guns with detailed
      models and distinct real-sounding gunshots, shoot through car glass and kill occupants.
- [ ] W2a Car entry: walk to door, open, get in; carjack pulls driver out the driver side with animation; parked cars:
      smash window + hotwire. Helicopters (helipad to steal, flyable).
- [ ] W2b Police: foot cops that act, escalation by stars (cruisers, SWAT, FBI SUVs, army + tank, helicopter), handcuff
      arrest animation, WASTED / ARRESTED cards.
- [ ] W2c City: realistic look (PBR-ish procedural textures, detailed buildings, less blocky), expansion (elevation,
      highway/overpass, alleys, more districts), walk-in robbable stores.
- [ ] W2d Main menu/UI: real-game title screen (3D city backdrop, game-style menu), HUD polish.
- Running (started 02:20 UTC): W1a vehicles agent a8d1c0f8913e5446f, W1b people agent aad3c429bd7a6894f,
  W1c combat agent a911474b5708d5a9f (resume with SendMessage if they stopped on a usage limit). Rules: docs/AGENT_RULES.md.
- [ ] W3 Bug-bash x2 clean, tests, soak, deploy, final report.

## Done
- M1 foundation (Codex): Vite + TS + Three.js + Rapier scaffold, lint/typecheck/test tooling.
- Assets (CC0): KayKit City Builder Bits (buildings, cars, props) and Quaternius Universal Animation Library (46 human animations) in public/assets; licences copied alongside.
- City layout (src/world/citymap.ts): 10x9 road grid (~900 x 800 m), districts, lanes + intersection connectors, signals, pedestrian graph. 8 unit tests pass.
- City build (src/world/citybuild.ts): asphalt, sidewalks, markings/crosswalks, KayKit buildings in district palettes, procedural towers/midrises with shader facades (night windows), docks (warehouses, containers, cranes), beach, water, hills, pier + Ferris wheel, street lights, traffic lights with live lamps, trees/palms/props, static colliders.
- Rendering: ACES, bloom, teal/apricot colour grade, sky dome with clouds/stars/sun/moon, time-of-day palette.
- People (src/actors/human.ts): UAL rig, smoothed clothed body, crisp clothing borders, sculpted stylised head (eyes, brows, nose, mouth, ears), 7 hair styles, hats, body variation; two-layer animation with stride-matched locomotion.
- Player on foot: Rapier character controller, sprint/jump/roll/swim, collision-aware camera.

- Vehicles: Rapier ray-cast physics (7 types: sedan, cab, interceptor, hatch, wagon, GT coupe, box van), tuned headlessly (tests print accel/brake/lateral g), paint/glass shader, lights, deformation, fire/explosions, skid marks, enter/exit/carjack.
- Combat: fists + 4 guns (Kestrel P9, Mako Compact, Breaker 12, Longline Carbine), hitscan, recoil, spread, reload, tracers, muzzle flash; inventory wheel with slow-mo.
- NPCs: civilians wander/obey crossings/flee/cower/dodge cars; gang + police AI with LOS, cover, flanking, burst fire, arrests.
- Traffic: lane following with signals, spacing, corner slowdown, honks, panic; parked cars; police pursuit/ramming. Heat 0-5 with search radius and losing heat.
- Missions m1-m5 (delivery, tailing, shootout+escape, steal+lose heat, street race), shops (Tidewater Arms, Pier 9 Snacks), Glow Garage respray, safehouse save, 12 postcards, 3 stunt ramps, autosave.
- UI (agent): title, loading, pause, settings + rebinding, controls, HUD, minimap, map, wheel, shop, death/arrest, mobile gate.
- Audio (agent): 42 synthesized SFX, engine/siren/skid voices, ambience, 3 procedural radio stations, mission moods.
- Tests: 64 unit tests; 7 Playwright e2e tests on the production build at /astratest/ (title->game, walk/drive/crash, combat/wheel/heat, death+arrest, all 5 missions, save/continue/settings, mobile gate). All passing.
- Deploy: gh-pages branch pushed manually -> Pages auto-enabled (has_pages: true, pages-build-deployment succeeded). Workflow .github/workflows/deploy.yml runs tests then publishes dist to gh-pages on push to main.
- Perf (medium, swiftshader measurement): 184-311 draw calls, 0.46-0.89 M triangles per frame.

## Status (~00:00 UTC, 18 Nov): first brief DONE
- Quality round on main (UI overhaul, movement, shooting + gun audio, driving + car glass, store hold-ups, sandbox).
- Bug-bash history: pass 1 (7 bugs), A (6), B (1), C (1), D (clean), E (1: beach ramps into the sea), F CLEAN, G CLEAN.
  Every bug has a regression e2e test. Two consecutive clean passes (F, G) on bb1dfe0.
- Tests: 77 unit, 32 e2e (all green on the production build at /astratest/), soak re-run on the final build.
- CI: run #11 (bb1dfe0) green and deployed to GitHub Pages; earlier failures (#5, #8, #10) were test flakiness
  (random traffic, aborted font prefetch on reload), both fixed in the tests.
- Screenshots: docs/screenshots (in README).
- Remaining: final report to the owner, delete scheduled task trig_01QHNBHfHX5vN6UurzWLwPga.

Bug-bash pass 1 (fixed in 4a1206a, 7 regression tests): open water/swimming/flooding, safe exits, lane-graph routing, traffic passing,
beach ramps, M2 keeps player car, contact respawn cooldown; shoreline-only foam.

## Done since 10:00
- Memory leak fixed (collider tags); soak passes: 20 game-min chaos, 0 issues, heap 108->114 MB flat, no console errors.
- Code-review fixes (11 bugs + minors) with 7 regression e2e tests; playtest fixes (16 items) with 1 more regression test. 15 e2e tests total, all green. CI deploys from main.

## Next
1. Bug-bash pass 1 (scripted tour, all districts/times, menus) -> fix -> pass 2 -> must be clean twice.
2. Final screenshots for the report; final report; delete scheduled task trig_01QHNBHfHX5vN6UurzWLwPga.

## Decisions
- Original game "Meridian Afterglow" in "Port Meridian". Stylised low-poly, apricot/teal grade.
- KayKit scale x5 (1 tile = 10 m). Humans 1.78 m nominal.
- Motorcycles cut (no in-style CC0 model; bike physics risk). Touch controls not built: phones get a desktop-only screen.
- (old note) Motorcycles cut (Kenney bike model clashed with the art style; bike physics not worth the risk).
- Pedestrians are not physically pushed by cars; hits are resolved by game logic.
- Deploy via gh-pages branch (Pages REST API is blocked from this sandbox; github.io not reachable from here, verified via Actions API).

## Known issues
- Not measured on real hardware (M1); budgets measured in software GL.
