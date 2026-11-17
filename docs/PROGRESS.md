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

## In progress
- M2 vertical slice: vehicles (next), combat, then systems.

## Next
1. Vehicles: Rapier ray-cast vehicle, enter/exit, damage, lights, sounds.
2. Combat: weapons (fists, pistol, SMG, shotgun, rifle), hitscan, effects, wheel.
3. Pedestrians + traffic AI, police heat, enemies.
4. Missions (5), economy/shops, HUD/minimap, menus/settings/rebinding, save/load.
5. Audio (agent), UI shell (agent).
6. Tests: unit, e2e scripted playthrough, soak; CI + Pages deploy.

## Decisions
- Original game "Meridian Afterglow" in "Port Meridian". Stylised low-poly, apricot/teal grade.
- KayKit scale x5 (1 tile = 10 m). Humans 1.78 m nominal.
- Pedestrians are not physically pushed by cars; car/ped hits are detected and resolved by game logic.
- Deploy target: GitHub Pages at /astratest/ (repo is public). Pages API is proxy-blocked here: deployment via Actions workflow.

## Known issues
- None verified yet beyond in-progress work.
