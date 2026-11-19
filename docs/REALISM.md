# Realism audit (round 4)

Top 10 cartoony / unrealistic things found, in priority order. Status: FIXED (with test), NOTED (not done).

1. Everyday cars did 0-100 km/h in 5-6 s (hatch 6.2, sedan 5.1, pickup 5.2). FIXED: `ENGINE_REALISM` in vehicles/specs.ts -> 8-10 s; sports/super unchanged (handling.test.ts).
2. No fall damage: jumping off any roof was free. FIXED: `fallDamage()` in game/player.ts (0 up to ~3 m, ~25 at 5 m, lethal from rooftops, roll soaks 40%); fall.test.ts.
3. Characters overlapping (teleport onto the clerk, spawn on someone) were ejected 1.5 m straight up through the ceiling. FIXED: actors/character.ts resolves against the world and walks apart horizontally; e2e in regressions.spec.ts.
4. Handbrake flick left alone became an endless donut (174 deg yaw in 3 s). FIXED: self-aligning drift when hands are off (driftLazy) + flick torque fades once sideways; keyboard steer ramp 0.16 s -> ~0.1 s; handling.test.ts (turnIn50, lazyYaw).
5. Tyre grip is ~1.5 g lateral for ordinary sedans (real: 0.8-0.9 g), so corners never feel weighty. NOTED: kept for the owner's "easy turns" request; revisit with a sport/comfort steering assist toggle.
6. Bullets are hitscan with no penetration (thin car doors, glass, drywall stop everything) and no drop/time of flight. NOTED.
7. Gravity is 25 m/s2 with 1.38x fall scale (real 9.8): jumps feel snappy/floaty-short rather than natural. NOTED (changing alters every jump/ledge test).
8. Pedestrian hit by a car takes speed*4 damage (10 m/s = 40 hp) and gets knocked up 4 m/s; real impacts at city speed are usually serious. NOTED.
9. Post grade: teal/apricot split-tone, saturation 1.08, strong vignette 0.32 and night exposure 1.3 give a stylised look; day shadows are very dark-blue. NOTED (a neutral grade option is cheap to add in renderer.ts).
10. Crowd density on medium is low for "Manhattan" (64 near peds / 26 near cars + instanced far crowd); near counts are capped for M1 frame time. NOTED (map agent owns layout).

Already realistic: traffic signals + lane changes with indicators, 4 mph walk / 10 mph jog, zone damage with falloff and vests, 130 km/h-class top speeds, braking distances 28-37 m from 100 km/h.
