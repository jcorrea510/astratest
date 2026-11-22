# Round 7 plan (BRIEF7) — lead works alone, one group at a time; tick + commit after each group
Resume here after a limit/compaction: first unticked group, read its notes. Every fix gets a regression test.

- [x] G1 Traffic (c684121; junction probe: 0 wrong-lane turns, 1 crash/90 s): turns only from the correct lane (right from kerb lane, left from inner lane; lane change early), left turns yield to oncoming + right turns yield to peds/crossing, intersection crashes, pile-ups clear fast (reverse/route around, despawn wrecks out of view), taxis work (hail/ride).
- [ ] G2 Performance: M1 Air medium 60 fps incl. fast driving, High selectable on Mac, Electron throttling (background/GPU flags, rAF), iPad PWA. Don't reintroduce the old rendering bug (verify screenshots).
- [x] G3 Stores/robbery (c684121; early money = taxi job): register faces the cashier side, grab cash yourself after cashier is down, store peds browse + leave (no piles at register/door), shuttered windows don't crack, minimap rob icons only inside the visible map (no edge clamp), early-game money source.
- [x] G4 NPC reactions (sliding car registered no hit -> body shoved into street; now ground-speed hits + unsink): hands up wrists-first (not elbows), "come here" — they don't flee before the order lands, walk briskly with hands still up, car side-hit ragdoll doesn't sink/jitter through the floor.
- [ ] G5 Gore (cheap): headshot can remove the head (blood spurt), limb hits show a wound decal + blood spray/drip; budgeted particles; settings toggle.
- [ ] G6 Walk-in gun store (wall arsenal, look at a gun to select/buy), garages (repair + repaint), more car variety.
- [ ] G7 World/visuals: cross-street intersections — sidewalks/lamp posts out of the road, peds walk clean lines; headlights light the world (cheap spot lights on nearest cars); low-quality traffic lights coloured; street-light pool flat on the ground.
- [ ] G8 Controls: KBM aim in the Mac app (pointer lock), in a car hold Tab = sidearm wheel, hold RMB = last weapon.
- [ ] Z: tsc, vitest, key e2e, publish gh-pages, rebuild Mac app, owner summary.
