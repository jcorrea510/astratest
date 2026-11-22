# Round 8 plan (BRIEF8) — lead works alone, one group at a time; tick + commit after each group
Resume here after a limit/compaction: first unticked group. Every fix gets a regression test. Mac first, iPad second.

- [~] A (558ec14+) found: adaptive resolution resized on every 33 ms crossing and chased its own stalls (freeze ~1/s) -> hysteresis,
  one change per 6 s; lights added mid-game (salon, heli searchlight) recompiled every shader -> created at load; camera follows the
  drawn car heading; version label. Open: measure M1 fps; physics thread only if still CPU-bound.
  Mac driving: freezes every ~1 s, car jitters back and forth, laggy even on Low; 40 fps walking on Medium. Measure with
  rendering on (shader compiles, light-count changes, uploads), fix hitches, then decide on the physics thread. Version number on screen.
- [~] B Visual glitches (iPad MSAA off, headlight beams stick + fade, no pop-in spawns; 2-door wheels / pistol / overpass poles not reproduced): High = green bar flashing (iPad); headlight reflections flicker at night; sky glitch on the map; store chains
  vanish up close; pistol jitters in hands; 2-door cars' tyres above the rims; peds popping in in front of you (even mid-crosswalk);
  overpass pillars in the middle of the road.
- [x] C Controls (pad RT taps, iOS audio session, aim+move verified, drive-by leans out of the window, 2-door seat, brakes measured fine): pad right trigger doesn't fire; volume (iPad); can't move while holding right click; in a car, right click + gun =
  arm out the window; 2-door cars seat you in the back; 2-door brakes oddly weak; truck drives sideways like a crab.
- [~] D Traffic + peds (progressive AI braking, no kerb parking on 1-lane streets, abandoned cars towed, keep-right walkers, no spawn in view; junction probe 3-4 crashes / 90-180 s remain): no pile-ups (keep the amount), no phantom braking, no two cars in one lane, parked cars in the road,
  cars phased into each other at crosswalks, peds colliding at crossings, peds running into the street, random hands-up.
- [x] E (558ec14) Stores: no smash case in the gun store, more gun stores, robbed store still sells later, can rob the till after the clerk is
  shot, clerk fights back harder, a knocked-out clerk stays down, closed store's door can't be walked through, all stores reopen
  on death, bank easy to find on the map.
- [~] F (558ec14) Combat + gore (corpses shootable, denser blood, car-hit blood, panic, cop bursts, quicker arrest; e2e pending): much more gore, shoot corpses (more blood, holes, body moves), peds flee hard from gunfire, cops shoot
  faster, windshield shots always register, arrest is quick and clean.
- [x] G (558ec14) Orders: hold G; passengers walk to and get in the passenger seat; order them out again.
- [x] H (558ec14) Remove Highway mode.
- [x] Z Published (site + Mac app), version shown on the title, pause menu and FPS counter.
