# Prompt for Gemini (Google AI Studio): bring Meridian Afterglow up to GTA V-level gameplay

How to use: paste everything below the line into AI Studio as the first message. Attach the repo (or zip of `src/`,
`tests/e2e/helpers.ts`, `CLAUDE.md`, `package.json`). If you can't attach everything, attach the files named under the
batch you're working on. Send one batch at a time ("Do Batch 1"), apply its changes, run the commands it gives you,
paste back any failures, then move to the next batch.

---

You are a senior gameplay engineer on **Meridian Afterglow**, a browser open-world crime sandbox (original IP, Teen
rating, gore only behind a "Blood & gore" setting). Stack: Vite 7, TypeScript strict, Three.js r182, Rapier 0.19
(physics). It's already a large, working game (~46k lines in `src/`). Your job is to bring **driving, shooting,
walking, the HUD/menus, AI drivers and pedestrians** up to the feel and polish of GTA V. Use GTA V as the bar for
*feel and behaviour* only. Every name, logo, UI graphic, sound and asset must stay original. Don't copy Rockstar
names, fonts, icons or layouts pixel for pixel.

The game is **not** missing basic systems. It already has: ray-cast vehicle physics with a friction circle, drift and
handbrake; a 6-speed gearbox; deformable car damage; 20+ vehicle kinds including police, SWAT, army and tank;
helicopters; on-foot movement with stamina, coyote-time jumps, mantling, swimming and dodge rolls; 18 guns plus melee
and throwables, with bloom, recoil, hit zones, dismemberment and ragdolls; a weapon wheel; a 0-5 heat (wanted)
system with squads that flank and use cover; traffic that obeys signals, changes lanes, makes curbside stops and
yields to sirens; pedestrians with street activities, crosswalk signals and reactions; a circular radar with GPS; and
a 2D/3D city map. **Don't rebuild these systems.** Fix and deepen them. The problems below were measured in the
running game. Each one lists the evidence, where the code lives, and when it counts as done. How you fix it is up to
you, but the fix has to meet the "Done when" line.

## Hard rules (break any of these and the change is rejected)

1. **Performance:** must stay at a steady 60 fps on an M1 MacBook Air and an M4 iPad Air at the default (Medium)
   preset. Busy street corners are already near the draw-call budget (~400). No new per-frame allocations in hot loops
   (the main loop is allocation-free; keep it that way). Use the existing spatial grids for neighbour queries. Merge
   or instance any new meshes. Never `scene.add` a `PointLight`: use `addPooledLight` from `src/render/lightPool.ts`.
   Keep `Game.warmShaders` compiling every new material at load. No runtime `backdrop-filter` on the in-game HUD.
2. **Physics world gravity is 20 m/s²** (see `src/core/physics.ts`, `G = 20` in `vehiclePhysics.ts`). Every vehicle,
   jump and fall is tuned against it. Don't change it globally.
3. **Units:** the player sees US units (mph, ft); the code works in metres and seconds (`src/core/units.ts`).
4. **Every bug fix and behaviour change gets a regression test:** a Vitest unit test next to the source
   (`*.test.ts`), or a Playwright e2e spec in `tests/e2e/` using the helpers in `tests/e2e/helpers.ts` (`boot`, `step`,
   `quietStreets`, `watch`/`clean`). The game exposes `window.__game` (the Game object; `g.frame(dt, false)` steps it
   headless) and `window.__meridian`. Prefer pure functions you can unit-test (the codebase does this already, e.g.
   `src/game/trafficRules.ts`, `src/combat/aimAssist.ts`).
5. **Scope:** only touch files the current batch needs. A one-line hook in another file is fine if you call it out.
   Don't reformat or reorganise code you aren't changing. Don't open or regenerate `public/assets/**`, `dist/`,
   `package-lock.json`.
6. **Controls are rebindable:** new actions go into the `Action` union, `ACTION_LABELS` and `DEFAULT_BINDINGS` in
   `src/core/settings.ts`, with gamepad mapping in `src/core/gamepad.ts` and touch controls in `src/ui/touch.ts`
   where it makes sense.

## How to answer

- You can't run the code, so be exact. For each change, give the **file path** and either the **complete new file**
  or a **unified diff** with enough context to apply cleanly. No "…rest unchanged" inside a function you modified.
- If you need a file I haven't attached, stop and **ask for it by path** before writing code that depends on it.
  Don't guess at APIs. If you do have to assume something, list the assumption at the top of your answer.
- End every batch with the exact commands to verify it:
  `npx tsc --noEmit`, `npx eslint <changed files>`, `npx vitest run <tests>`, and for e2e:
  `npx vite --port 5199 --strictPort &` then `PW_PORT=5199 npx playwright test <spec> --trace off`.
- Then give a ≤10-line summary: what changed, which "Done when" checks it meets, and any risk to frame time.

## Measured baseline (headless Chromium probe, 60 Hz fixed steps)

| What | Measured |
|---|---|
| Sedan (Solano Vista) 0-60 mph | 8.6 s; ~71 mph 3 s later; 71→0 mph in 47.5 m (0.99 g) |
| Muscle (Ardent Vortex 440) 0-60 | 4.3 s; braking 1.2 g |
| Super (Vantor Zephyra) 0-60 | 2.15 s; 115 mph 3 s later; braking **1.93 g** |
| Sports sedan grinding the bridge median at 69 mph | **accelerated to 85-90 mph while scraping**, body rose 0.23-0.32 m up the barrier, lost **42-48 % health** |
| On foot: time to jog speed (4.7 m/s) | **0.25 s** (effectively instant) |
| On foot: sprint (7.3 m/s) | reached within 1 s; **stops from a sprint in 0.38 s / 1.47 m** |
| AI traffic, 60 s at default density near spawn (Brickline) | **40-62 % of 31-43 cars below 1 mph** at every 5 s sample; mean speed **5-11 mph**; longest `jamT` only 2.5 s (so they're "legitimately" waiting, not jammed) |
| Pedestrians, same 60 s | 4 of 18 wandering peds made <0.15 m/s progress for ≥5 s; two pairs **walked in place face to face for 18-22 s** (loco animation playing, same spot) |
| Weapon select | `Digit1`-`Digit9` do nothing: after receiving a pistol, pressing 2 leaves fists equipped |

---

## Batch 1: Driving feel

Files: `src/vehicles/vehiclePhysics.ts`, `src/vehicles/specs.ts`, `src/vehicles/vehicle.ts` (`damage()`,
`deform()`), `src/game/impact.ts`, `src/game/camera.ts`, `src/core/physics.ts` (collision groups only),
`tests/e2e/drivingcam.spec.ts` (example of a driving probe).

**D1. Scraping walls and barriers doesn't slow the car, the car climbs barriers, and glancing hits do huge damage.**
Evidence: at 69 mph, steering into the Cannery Channel bridge median (spawn `g.vehicles.spawn('sportsedan', 400, -478,
Math.PI/2, -1, 7.6)`, set linvel x=31, hold W + A for 0.33-0.75 s), the car kept accelerating to 85-90 mph while
grinding along the barrier. Its body rose 0.23-0.32 m (the wheels ride up the barrier face), and a glancing scrape
took 42-48 % of its health.
Done when: in that test, a sustained scrape costs at least 15-25 % of speed per second of contact; the car stays at
road height (rise < 0.08 m) and stays on its side of the barrier; a glancing scrape (impact angle < 20°) costs
≤ 10 % health while a head-on hit at the same speed still does heavy damage. Damage should scale with the speed
*normal* to the surface, not total speed. Scrapes should throw sparks and play a grind sound for as long as contact
lasts (the particle and audio systems already exist).

**D2. Keyboard steering is digital and twitchy.** `steerIn` ramps at ~9.5/s (full lock in 0.1-0.15 s per the code
comment), and an automatic countersteer adds `0.7 × sideslip`. A light tap on A/D at 60 mph snaps the wheel. GTA V
keyboard steering builds up progressively, and the car visibly leans into the corner.
Done when: on keyboard at 60 mph, a 0.1 s tap gives a small lane-change correction rather than near-full lock; holding
the key reaches full lock in about 0.3-0.45 s; return to centre stays quick. Gamepad analog steering stays 1:1 with
the stick (don't add lag to the pad). Add a unit test on the pure steering-rate function.

**D3. Body weight isn't sold visually.** Under hard braking, acceleration and cornering, the body should pitch (nose
dive, squat) and roll visibly on its springs relative to the wheels, more for SUVs, vans and luxury cars and less for
the super and race cars. Check what `vehicle.ts` "sprung body motion" does today and make it read clearly from the
chase camera without changing the physics collider.
Done when: a recorded sequence of a sedan braking at full force from 60 mph shows ≥ 2.5° of nose-down pitch that
settles with one soft overshoot, and a 0.8 g corner shows ≥ 3° of roll. Cover it with a test on the pure spring
function.

**D4. Supercar numbers are past believable.** 1.93 g braking and 0-60 in 2.15 s. Bring the super class to about
2.6-3.0 s 0-60 and ≤ 1.4 g braking, and keep the class order (super > coupe > muscle > sports sedan > sedan > van).
Done when: a Vitest test computes or asserts these from `specs.ts` (or an e2e probe measures them).

**D5. Crashes don't feel violent enough.** At ≥ 45 mph head-on into a wall: a big camera shake and a short slow
pull-back, glass shattering (`breakGlass` exists), the horn stuck on if the driver is NPC and dead. With
Blood & gore on, an unbelted NPC driver or a player above ~70 mph can be thrown through the windscreen (ragdoll exists).
Keep it under the existing settings for camera shake and gore.

## Batch 2: Walking and on-foot movement

Files: `src/game/player.ts` (`MOVE` constants and controller), `src/actors/character.ts`, `src/actors/human.ts`,
`src/actors/actions.ts`, `src/game/camera.ts`, `src/core/settings.ts`, `src/core/input.ts`.

**F1. No momentum: starts, stops and turns are instant.** Measured: full jog speed after 0.25 s; a sprint stops dead
in 0.38 s / 1.47 m. GTA V characters take a step or two to get going, plant a foot and lean to stop from a sprint, and
play a pivot when reversing direction.
Done when: jog start reaches full speed in 0.4-0.6 s, sprint start in about 1 s; stopping from a sprint takes 0.7-1.0 s
and 2.5-3.5 m with a visible plant-and-lean stop; a 180° reversal while running plays a pivot instead of spinning the
body on the spot; feet don't slide (a planted foot's world speed stays < 0.1 m/s during the plant). Input must still
feel responsive: direction changes under 90° stay quick. Keep the dodge roll and mantle working. If any existing
test depends on the old instant movement (search `tests/e2e/` and `src/game/*.test.ts` for `speed`/`MOVE`), update it
and say why.

**F2. There's no crouch or stealth.** The `crouch` action is bound to C, but its label is "Dodge roll" and that's all
it does. Add GTA V-style stealth: press to toggle a crouched sneak (slower, quieter, lower capsule, crouched
locomotion), which reduces how far pedestrians and police notice you. The dodge roll moves to "jump while aiming"
(already supported) plus its own separate binding.
Done when: crouched walking speed is about 1.4 m/s, the capsule is lower, the camera drops, and an NPC detection test
shows a shorter notice range while crouched.

**F3. The standing pose and hands look wrong.** In the CI render (`docs/shots/out/people-body.jpg`), people stand with
their arms bowed out from the body, fingers clawed, and fingertips rendering dark like black nails. Idle should be
relaxed: arms hang close to the sides, hands are loose, and there's a slow weight shift (breathing and weight shift
already exist).
Done when: a side-by-side render of 5 body types shows arms within about 8-12° of the torso at idle, natural hands
and skin-coloured fingertips.

## Batch 3: Shooting and combat

Files: `src/game/playerCombat.ts`, `src/combat/aimAssist.ts`, `src/combat/weapons.ts` (`Inventory`), `src/combat/combat.ts`,
`src/game/camera.ts`, `src/game/player.ts`, `src/actors/npc.ts` (`findCover` for reference), `src/core/settings.ts`,
`src/core/input.ts`, `src/core/gamepad.ts`, `src/ui/hud.ts`, `src/ui/ui.css`.

**S1. The player has no cover system.** This is GTA V's core gunfight mechanic. There's no `cover` action in
`src/core/settings.ts`; NPCs have `findCover` but the player has nothing. Needed: a cover key (Q, pad RB) that moves
the player to and snaps them against the nearest wall, car or low wall in the direction they're facing or moving;
sliding along cover; aiming up or around corners from cover; blind fire (fire without aiming, much worse accuracy);
moving cover-to-cover with a held key; swapping sides at corners; and the camera shifting to the open side. Low cover
crouches, high cover stands. While the player is in cover, enemy shots that would pass through the cover must be
blocked (this uses the existing trace).
Done when: an e2e test places the player near a parked car and a wall, presses cover, and checks they're attached
within 0.4 s; slides along; peeks and fires; and takes no damage from an NPC shooting at the covered side.

**S2. Aim assist is too weak for a gamepad and there's no target lock.** Today the only help is ADS look friction
(0.65 inside a 3° cone) plus a 0.35 rad/s pad pull. GTA V offers assisted aim: pressing aim near a hostile snaps the
reticle onto them, a flick of the right stick moves to the next target, and the snap goes to the chest (you nudge up
for headshots).
Done when: there's a setting with three modes, `Free`, `Assisted (partial)` and `Assisted (full)`. On by default for
pad and touch, off for mouse. Lock only to visible threats (armed or attacking, and police while wanted); never lock
onto civilians who aren't a threat. Cover the target-selection function with unit tests (line of sight, range, cone,
priority to the closest threat to the reticle).

**S3. Number keys don't select weapons.** Add `Digit1`-`Digit9` bindings for weapon categories (fists/melee, pistol,
SMG, shotgun, rifle, sniper, heavy, throwable, other). Pressing a key again cycles within that category.
Done when: an e2e test gives a pistol and a carbine, presses 2 and then 5, and sees each one equipped.

**S4. Stray HUD line while aiming.** At 1280×720 a thin horizontal line appears at the left screen edge (about
x 0-75 px, y ≈ 292 px) whenever the player aims or fires. Find out which element draws it (probably a damage-direction
or crosshair element with a bad transform) and fix it.
Done when: a screenshot test of the aiming HUD has no non-HUD pixels in that region.

**S5. Hits need more weight.** On a non-lethal torso or leg hit, an NPC should stagger in the direction of the shot,
clutch the hit area, and sometimes go down wounded and crawl or writhe (Blood & gore governs blood only, not the
animation). Arm hits should make them drop their weapon some of the time. Use the existing hit zones and actions. Make
sure gunfights don't devolve into NPCs absorbing rounds standing still.

## Batch 4: AI drivers

Files: `src/game/traffic.ts`, `src/game/trafficRules.ts`, `src/world/citymap.ts` (lanes, `signalState`,
`SIGNAL_CYCLE`), `src/game/population.ts`, `src/actors/npc.ts`, `src/game/spatialGrid.ts`.

**A1. Traffic barely moves.** 40-62 % of cars stand still at any moment and the mean speed is 5-11 mph, even though
no car is "jammed" (`jamT` ≤ 2.5 s). Signals are 13 s green, 3 s amber, 2.2 s all-red per axis. First add
instrumentation: a debug counter for *why* each stopped car is stopped (red signal, queue behind a car, pedestrian,
curb stop, left-turn wait, siren yield, other). Report the breakdown from a 60 s headless run near spawn, then fix the
biggest causes.
Done when: over 60 s at default density around Brickline, at most ~30 % of AI cars are below 1 mph on average, and
moving cars average 18-28 mph on city streets. No new signal violations: `ViolationMonitor` and the existing tests in
`trafficRules*.test.ts`, `leftTurn*.test.ts`, `standingAmber.test.ts` and `traffic*.spec.ts` stay green.

**A2. Every driver behaves the same.** Nothing in `traffic.ts` gives drivers a personality. Add per-driver traits,
seeded from the existing `Rng`: cautious, normal, aggressive and speeder. Traits change cruising speed relative to the
lane limit, following gap, how readily they change lanes and overtake, whether they run a late amber, and how fast
they react to a green.
Done when: unit tests show the trait changes those parameters, and a 60 s run shows a visible spread in speeds without
extra crashes.

**A3. Drivers don't react to being rammed or cut off.** Today the reactions are only a honk, or a 35 % chance to
flee (`Traffic.startle`). GTA V drivers might get out and confront you (shout, shove, fist fight), chase you for a few
blocks, drive off, or freeze, depending on personality and on whether you're armed. Aggressive drivers who get rammed
twice should get out and fight. Any driver facing a drawn gun flees or surrenders.
Done when: an e2e test rams a parked-then-driven AI car twice at 15 mph and sees the driver's brain go to `fight` or
`chase`, or `flee` for a cautious driver.

**A4. Police and AI cars should avoid the player's car reliably, not just stop behind it.** If the player stops in a
lane, cars behind should change lanes or carefully go around within about 3 s when the other lane is clear, instead
of honking in a queue (check `avoid`, `laneChange`, `blockedT`).

## Batch 5: Pedestrians

Files: `src/actors/npc.ts` (`wander` ~line 752, `avoidPeds` ~line 856, `maybeActivity`), `src/game/crowd.ts`,
`src/game/population.ts`, `src/game/storeLife.ts`, `src/game/schedule.ts`, `src/world/citymap.ts` (ped graph),
`src/actors/actions.ts`, `src/audio/sfx.ts`.

**P1. Pedestrians deadlock and walk in place.** Two wanderers meeting head-on can block each other indefinitely, both
playing the walk animation without moving. Seen: two peds at (-353.6, -89.8), both on ped node 13, stuck for 22 s;
another at (-341, -89) on node 54 with `waitT` 19 s. In a 60 s sample, 4 of 18 wanderers made almost no progress
for ≥ 5 s.
Done when: in a 120 s headless run at default density, no wandering pedestrian (no activity, not waiting at a red
crosswalk signal) makes less than 0.15 m/s progress for more than 3 s; head-on pairs pass each other on the right;
and a pedestrian with no progress never plays the walk cycle (use idle instead). Add a crowd regression test that
spawns two peds walking straight at each other on a sidewalk.

**P2. Street life is all loners.** Current activities: phone, smoke, window, film, hail, wait, shop, taxi, sit, board,
queue, all solo. Add the variety that makes GTA V's streets feel alive: pairs and small groups walking together at a
shared pace and chatting (heads turning, gestures); two or three people stopped in conversation; joggers on the
promenade and in parks; people on phone calls *while walking*; and some people noticing and glancing at things
(a sirened car, a crash, a sports car, the player with a gun out). Respect time of day (`streetClock`) and district.
Reuse the existing UAL animations where you can. Keep the people LOD and the population budgets.
Done when: in a 120 s daytime run downtown, at least 25 % of visible pedestrians are in a group or a non-trivial
activity at any sample, with no extra draw calls beyond the existing people budget.

**P3. People are silent.** There are no ambient voice barks for pedestrians or drivers: no reaction to gunfire, being
bumped, near misses or a car on the sidewalk. Add a small, original bark system with a few short clips per type
(scream, "hey!", "watch it!", a gasp, an insult), distance-attenuated and rate-limited. Use only CC0 or self-made
audio in `public/assets/audio/` with the licence noted. If no clips are available, build the system with a
placeholder synth fallback, like `gunsynth` is for guns.

## Batch 6: HUD and menus polish

Files: `src/ui/hud.ts`, `src/ui/ui.ts`, `src/ui/ui.css`, `src/ui/minimap.ts`, `src/ui/wheel.ts`, `src/ui/fullmap.ts`.

**U1. The first-run tip box covers the middle of the view.** It's about 540×120 px at top centre at 1280×720, right
over the skyline and traffic signals. GTA-style help text sits in a compact box in the top-left corner, auto-dismisses
after a few seconds, and never overlaps the reticle or the radar.
Done when: tips render top-left, at most 360 px wide at 1280×720, and fade out after 6-8 s.

**U2. Duplicate wanted feedback.** When heat rises, a "Heat 1" toast appears top-left *and* the stars appear
top-right. Keep the stars (flash them when heat changes, the way GTA V does) and drop the redundant toast for
ordinary heat changes.

**U3. Contextual prompts.** GTA V shows small context prompts ("Press F to enter", "Hold E to rob the register",
"Press Q to take cover") near the bottom-left or above the radar, not floating mid-screen. Make every prompt use one
consistent component, and show the *actual* bound key or pad button (bindings are rebindable and pad-aware:
`src/ui/bindings.ts`).

**U4. Check readability at a glance.** Speed, gear, health/armour, ammo and radar must stay readable over bright sky
and white buildings at noon, and at night. Add a subtle shadow or plate where contrast is weak. Don't use
`backdrop-filter`.

## Optional later (only after Batches 1-6 are green)

- A first-person camera on foot and in vehicles (cycled with the existing `camera` action), with the body visible
  when looking down.
- Motorcycles: a new vehicle class with lean, wheelies and stoppies, and rider ragdoll on crashes.
- Short dynamic radio DJ breaks and news between tracks (original content only).

Start with **Batch 1**. Before writing code, list the files you need that I haven't attached.
