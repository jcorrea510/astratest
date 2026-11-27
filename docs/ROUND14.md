# Round 14: smooth and real (owner, 26 Nov, from an M4 iPad Air)

Owner: "even on strong devices it doesn't run well and also looks like an itch game." Goal: steady 60 fps on an M4
iPad / M1 Air on the default preset, and a clearly more realistic picture. Every change must pay for itself in frames.

## Rules for helpers
- Start from CLAUDE.md and this file; don't explore the tree. Only edit the files your package owns; a one-line hook
  elsewhere is fine if listed in your report.
- No local browser here. Verify with `npx tsc --noEmit`, `npx eslint <your files>`, `npx vitest run <your tests>`.
  Add a unit test for each behaviour change (e.g. a budget or a pure LOD/selection function).
- Commit WIP in your worktree often; keep docs/handoff/r14-<pkg>.md (<= 8 lines).
- Report <= 20 lines: what changed, expected frame saving (triangles, draw calls, passes, shader cost), files touched.
- Measurements come from docs/shots/out/perf.txt (CI probe, scripts/perf.mjs: SwiftShader, so relative costs).

## Known numbers (Round 13 CI, 1280x720, medium)
Street views: ~120-140 draw calls, 760-890k triangles. One person ~22k tris (a crowd of 8: 180k). High-LOD cars
are allowed 52k tris. 139 shader programs. Medium: pixel ratio 1.0 (an iPad draws at half its native resolution and
looks soft), shadow map 2048 redrawn every 2nd frame, SSAO 8 samples full-res, bloom at night, FXAA.

## Packages (owner files; others only via a one-line hook listed in the report)
| id | focus | owns |
|----|-------|------|
| R1 | pipeline, presets, adaptive res, shadows, iPad/Mac defaults | render/renderer.ts, core/settings.ts, render/shadowFrame* |
| R2 | post: cheaper AO, sharpening, anti-aliasing | render/post.ts (+ new render/post*.ts) |
| HP | people GPU cost: body LODs, skinning, crowd | actors/human.ts, humanAssets.ts, animLod.ts, sweepLod.ts, crowdBody.ts |
| VP | vehicle LODs and budgets | vehicles/vehicle.ts, models/build.ts, models/soup.ts, models/body.ts, farCars.ts, game/vehicles.ts |
| CW | city geometry: chunks, culling, building LOD, draw calls | world/citybuild.ts, builders.ts, buildings.ts, expansion.ts, game/farLod.ts |
| SH | fragment cost + look of facades, ground, local lights | world/facadeShader.ts, render/materials.ts, render/lightPool.ts |
| CS | CPU simulation | game/traffic.ts, game/population.ts, actors/npc.ts, actors/character.ts, core/physics.ts |
| LK | daylight, sky, reflections look | render/sky.ts (+ new render/look*.ts) |
| PL | people look (hoodie collar, skin, hair, cloth) | actors/shade/*, humanMaterial.ts, look.ts, hairShells.ts, hairScan.ts |
| CL | car look (paint, glass, tyres, lights) | vehicles/models/carMaterial.ts, parts.ts, kinds.ts |
| ST | street dressing look and cost (props, trees, benches) | world/props.ts, streetscape.ts, benches.ts |
| ML | main-loop CPU: per-frame work, HUD/minimap redraws, camera, allocations | game/game.ts, game/camera.ts, ui/hud.ts, ui/minimap.ts, ui/mapdraw.ts |
