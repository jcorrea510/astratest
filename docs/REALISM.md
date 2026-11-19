# Realism audit (round 4)

Top 10 cartoony / unrealistic things found, in priority order. Status: FIXED (with test), NOTED (not done).

1. Everyday cars did 0-100 km/h in 5-6 s (hatch 6.2, sedan 5.1, pickup 5.2). FIXED: `ENGINE_REALISM` in vehicles/specs.ts -> 8-10 s; sports/super unchanged (handling.test.ts).
2. No fall damage: jumping off any roof was free. FIXED: `fallDamage()` in game/player.ts (0 up to ~3 m, ~25 at 5 m, lethal from rooftops, roll soaks 40%); fall.test.ts.
3. Characters overlapping (teleport onto the clerk, spawn on someone) were ejected 1.5 m straight up through the ceiling. FIXED: actors/character.ts resolves against the world and walks apart horizontally; e2e in regressions.spec.ts.
4. Handbrake flick left alone became an endless donut (174 deg yaw in 3 s). FIXED: self-aligning drift when hands are off (driftLazy) + flick torque fades once sideways; keyboard steer ramp 0.16 s -> ~0.1 s; handling.test.ts (turnIn50, lazyYaw).
5. Tyre grip was ~1.5 g lateral for sedans (real 0.8-0.9 g). FIXED as an option: Settings > Input > "Realistic driving" (`setRealisticDriving`, grip x0.58 ~0.9 g + longitudinal load transfer); default stays arcade (realisticDriving.test.ts).
6. Bullets were hitscan with no penetration or drop. FIXED (combat/ballistics.ts + Combat.trace/shoot): rounds pass through car panels and thin walls at reduced damage (not masonry), rifle/sniper drop beyond 60 m and long hits arrive after flight time, shallow hits on metal/concrete ricochet with sparks (ballistics.test.ts, realism2.spec.ts).
7. Gravity was 25 m/s2 x1.38 fall. FIXED partly: 16 x1.3 with jump ~0.6 m (jumpSpeed 4.3); fall damage thresholds renormalised so drops hurt the same (fall.test.ts); also fixed: gentle take-offs on rising slopes no longer cancel the jump (Character snap-to-ground off while rising). Not full 9.81: ledge/mantle/vehicle-exit timing is tuned around the snappier arc.
8. Pedestrian hit by a car took speed*4 hp. FIXED: game/impact.ts `pedImpact` (damage ~speed^2, lethal from ~25 mph, brush/aside/hood/over launch, knockdown + death reactions, car dents); impact.test.ts, realism2.spec.ts.
9. Post grade was teal/apricot split-tone with a heavy vignette. FIXED: default is a neutral filmic grade (sat 0.95, split 0.2, vignette 0.14, softer shadow fill, night exposure x0.84, sodium-orange lamp pools); Settings > Display "Stylised colour grade" restores the old look (look.test.ts).
10. Crowd density on medium is low for "Manhattan" (64 near peds / 26 near cars + instanced far crowd); near counts are capped for M1 frame time. NOTED (map agent owns layout).

Already realistic: traffic signals + lane changes with indicators, 4 mph walk / 10 mph jog, zone damage with falloff and vests, 130 km/h-class top speeds, braking distances 28-37 m from 100 km/h.
