# Progress (Meridian Afterglow)

Resume rule: read docs/BRIEF.md and this file, continue the first unfinished item under "Next". Never restart.
Auto-resume: hourly scheduled task `trig_01QHNBHfHX5vN6UurzWLwPga` ("Resume Meridian Afterglow build") fires into this session; delete it when everything is done.

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

## In progress (~11:45 UTC)
- Bug-bash passes (need two consecutive clean passes).

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
