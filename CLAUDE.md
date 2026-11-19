# Meridian Afterglow — project map (read this first; don't re-explore the tree)

Browser open-world crime sandbox (original IP, Teen). Vite 7 + TypeScript strict + Three.js r182 + Rapier 0.19.
Live: https://jcorrea510.github.io/astratest/ (GitHub Actions deploys `main` after tests). Work branch: claude/tender-turing-bkf701.
Current brief: docs/BRIEF5.md (earlier: BRIEF4, BRIEF3, BRIEF2). Target: hyper-realistic, not cartoony; M1 Air must stay smooth. Plan/status: docs/PROGRESS.md. Agent rules: docs/AGENT_RULES.md.

## Standing rules from the owner (always apply)
- Usage: delegate coding to Sonnet subagents (`model: sonnet`); use Opus only for architecture or a bug Sonnet failed twice on.
  Lead (main session) stays thin: plan, dispatch, review reports, commit. Agents start from this file, not by exploring.
- Keep MDs tight (this file < 80 lines; PROGRESS short, newest first; old detail gets deleted, git has history).
- Never open big/generated files (list below). Split giant scripts into modules so agents read only what they need.
- No questions to the owner; finish end to end; publish when done (gh-pages via CI, or manual dist push if CI is slow).

## Commands
`npx tsc --noEmit` · `npx eslint <files>` · `npx vitest run` · e2e: start `npx vite --port 5199 --strictPort &`, then
`PW_PORT=5199 npx playwright test <spec> --trace off` (full run builds dist on 4173: `npm run test:e2e`). Soak: `npm run test:soak`.
Debug hooks in the page: `window.__game` (Game), `window.__meridian` (activities, sandbox, ui, save...). `g.frame(dt,false)` steps headless.

## DO NOT open (huge / generated)
public/assets/** (gltf/bin/png), dist/, node_modules/, test-results/, playwright-report/, docs/screenshots/*.jpg (only when judging visuals),
package-lock.json. Read only the part of a big file you need (grep first, then Read with offset/limit).

## Layout (src/)
- core/: input (rebindable actions), physics (Rapier wrapper + collision groups, overlapsCapsule), rng, settings.
- world/: citymap (pure layout: road grid, lanes, routeField, districts, ped graph), citybuild (meshes + colliders),
  buildings/builders/facadeShader/props (procedural architecture), expansion (hills/highway/etc), terrain, interiors (walk-in stores), assets loader.
- render/: renderer (post, grade, shadows), sky (time of day), materials (procedural textures), particles.
- actors/: human (UBC realistic bodies, retargeted UAL anims), humanAssets/humanMaterial/look (appearance), actions
  (`human.playAction(name,{layer,fade,rate,loop,hold,onEvent,onDone})`: punch_*, open_door, enter_car, exit_car, pull_out, pulled_out,
  thrown_out, smash_window, hotwire, handcuffed, cuffing, kneel, hands_up, cower, knockdown, get_up...), character (capsule, health,
  melee strike), npc (civilian/gang/police brains).
- vehicles/: specs (20 kinds incl. police, fbi, swat, army, tank), shapes + models/* (procedural skinned cars), vehicle
  (doors/seats/glass API: setDoor, doorIndex, doorWorldPos, seatWorldPos, seatLocal, glassAt, breakGlass, setTurret), vehiclePhysics
  (ray-cast tyres), helicopter* (flight model, model, manager).
- combat/: weapons (18 guns + melee + throwables), weaponModels, combat (trace, hitPerson zone damage, projectiles, explosions),
  hitzones (bone capsules), aim (camera-ray aim point), wheelSlots.
- game/: game (orchestrator + main loop), player, camera, playerCombat, carEntry (walk-to-door/carjack/hotwire state machine),
  vehicles (manager), traffic, population, police (heat 0-5), robbery (store hold-ups), activities (shops, garage, postcards, jumps),
  places (named spots, HELIPADS), sandbox (tools panel; the game is sandbox-only), save, missions (story — disabled, kept for later).
- ui/: ui.ts (screens/menus), attract (menu flyover), hud, minimap/mapdraw/fullmap, wheel, shop, settingsPanel, sandbox panel, contracts.
- audio/: core/sfx/gunsynth (layered gunshots)/loops (engines, sirens)/music/ambience. (NPC voices removed.)
- highway/: separate Highway game mode (streamed road, IDM/MOBIL traffic). core/units.ts = US units, core/fullscreen.ts.
- tests: unit next to sources (*.test.ts); e2e in tests/e2e/*.spec.ts (helpers.ts: boot, step, quietStreets, watch/clean).

## Conventions
Teen tone, all names/art original (no real brands/GTA assets). Keep draw calls low (merge by material, instancing, LOD).
Every bug fix gets a regression test. Commit trailers: see git log.
