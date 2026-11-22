# Round 7 plan (BRIEF7) — lead works alone, one group at a time; tick + commit after each group
Resume here after a limit/compaction: first unticked group, read its notes. Every fix gets a regression test.

- [x] G1 Traffic (c684121; junction probe: 0 wrong-lane turns, 1 crash/90 s): turns only from the correct lane (right from kerb lane, left from inner lane; lane change early), left turns yield to oncoming + right turns yield to peds/crossing, intersection crashes, pile-ups clear fast (reverse/route around, despawn wrecks out of view), taxis work (hail/ride).
- [~] G2 Performance. Done: static chunk matrices frozen, cull every 3rd frame, off-screen people animate at 4 Hz and seated people
  throttled (fast-drive sim 17.4 -> 14.4 ms avg, p95 35 -> 25), Mac app on Metal, no App Nap.
  Why we trail a pro engine (measured, headless profile of a 63 mph drive): everything runs on ONE JS thread - Rapier physics with
  ray-cast tyres for ~65 cars, ~90 CPU-animated skeletons, traffic/crowd AI, scene-graph matrices; plus hitches from geometry built at
  runtime (hair shells ~94k verts built the first time a style appears: 100 ms-1 s spikes) and full-res post passes (bloom + output + grade).
  Pro engines spread this over worker threads, bake assets offline, GPU-skin/instance crowds and cull per frame with LOD budgets.
  Next, in order: (1) DONE: hitches were emergency-car models + body LODs built during play (0.6-0.75 s each) -> built at load;
  looks warmed ahead from the far crowd (perf7.spec: worst frame 758 -> ~60-90 ms); (2) DONE differently (the profile pointed at
  people, not cars): civilians past 28 m think + sweep at 30/20 Hz, parked cars asleep skip their tyre update; (3) skipped for now: bloom already starts at quarter res; merging grade into output risks double tone mapping (needs an M1 check);
  (4) physics + traffic in a Web Worker (big job: needs a message-passing car state); (5) measure on the M1 with ?showFps and the
  renderer stats before/after each step.
- [x] G3 Stores/robbery (c684121; early money = taxi job): register faces the cashier side, grab cash yourself after cashier is down, store peds browse + leave (no piles at register/door), shuttered windows don't crack, minimap rob icons only inside the visible map (no edge clamp), early-game money source.
- [x] G4 NPC reactions (sliding car registered no hit -> body shoved into street; now ground-speed hits + unsink): hands up wrists-first (not elbows), "come here" — they don't flee before the order lands, walk briskly with hands still up, car side-hit ragdoll doesn't sink/jitter through the floor.
- [ ] G5 Gore (cheap): headshot can remove the head (blood spurt), limb hits show a wound decal + blood spray/drip; budgeted particles; settings toggle.
- [ ] G6 Walk-in gun store (wall arsenal, look at a gun to select/buy), garages (repair + repaint), more car variety.
- [x] G7 World/visuals (Broadway ribbon/lamps/ped graph fixed; spot headlights 1/2/4 by preset; Low signal colours; pools on ground): cross-street intersections — sidewalks/lamp posts out of the road, peds walk clean lines; headlights light the world (cheap spot lights on nearest cars); low-quality traffic lights coloured; street-light pool flat on the ground.
- [x] G8 Controls (click-to-aim default on Mac + trackpad swipe aims; car wheel + aim draws last gun): KBM aim in the Mac app (pointer lock), in a car hold Tab = sidearm wheel, hold RMB = last weapon.
- Published checkpoint 2 after G2 part 1 (see git log). Remaining after reset: G2 rest, G5 gore, G6 gun store/garages/cars.
- [ ] Z: tsc, vitest, key e2e, publish gh-pages, rebuild Mac app, owner summary.

## Overnight (owner, 22 Nov 00:15): wake up to a game that plays for hours
- [ ] O1 AI driving: long soak with the player ramming / blocking: 0 AI-vs-AI crashes from bad turns, cars recover from player chaos, no lasting pile-ups.
- [ ] O2 Peds: walk the sidewalks/crossings cleanly; shoppers browse, pay, leave (no piles).
- [ ] O3 Only what you can see costs anything: per-instance culling of far cars/peds (instanced meshes are drawn whole today), shadow casters, off-screen updates.
- [ ] O4 Long-session stability: 30+ min soak (memory, object counts, no leaks/stalls).
- [ ] O5 Map polish found along the way.
- [ ] Morning note: native rendering (Mac app = Electron/WebGL-on-Metal; iPad sideload options, WebGPU) - discuss, don't build blind.
