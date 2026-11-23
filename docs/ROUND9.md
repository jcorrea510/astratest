# Round 9 plan (BRIEF9). Lead fixed owner bugs personally; features went to Sonnet agents (handoffs docs/handoff/R9-*.md).
Resume after a limit: first unticked line. Every fix has a regression test.

- [x] R9-G gore: limbs sever (dismember.ts), every gun gores harder, mist/gibs/wall splats/trails (e2e gore9).
- [x] R9-S gun sounds: 42 recorded CC0 takes (gunSamples.ts, public/assets/audio/guns, CREDITS.md); synth fallback.
- [x] R9-W map character: tower setbacks/crowns/belt courses, streetscape.ts dressing baked into trim chunks (+2% calls).
- [x] R9-C physical garage halls (garageBay.ts, garageMenu.ts; game pauses), car selling (stolen 5%, owned 57.5%, cooldowns).
- [x] Bank: vault door covers its opening; job = guard, set-and-defend drill (jams), deposit boxes, bag paid after getaway (e2e bank9).
- [x] Outfit store: 3 new prints, 8 colours, cloth folds/AO, per-fabric sheen.
- [x] L1 Mac perf: every shader compiled at load (store interiors prebuilt, car/person materials not disposed): 14 -> ~2 mid-game compiles per tour.
- [x] L2 Broadway signal phase + heads (diagSignals.test), stop bar behind the zebra, left-turn yield (5.5 s gap, re-check in the turn), 2.2 s all-red, no parking near junctions; Broadway lanes start past the cross streets.
- [x] L3 AI turn speed from radius (calm 2.4 m/s^2), gentle braking into turns; drift bends the path and recovers ~1 s after straightening (drift9.test).
- [x] L4 police: bar light pools + red/blue point light (Medium+), brighter bar; no shooting the unarmed (<5 stars), rounds start at the shoulder (no shooting through walls); pursuit speed matches the suspect, overtakes, leads the target; peds clear for sirens / a fast car; robbery = 2 stars, heat lasts longer.
- [x] L5 robbery: facing the clerk with a gun drawn counts as covering; 4 s grace; till reachable from both sides, meter pauses instead of resetting; hands-up pose.
- [x] L6 car-hit ragdoll: spin cap, waist spring, spine bend limit, rate-limited root.
- [ ] Z gate (tsc, vitest, key e2e) + publish + owner summary.
