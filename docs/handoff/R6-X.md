# R6-X (ragdoll / crumple / breakable props / molotov) — DONE, verified
- Code: actors/ragdoll.ts, vehicles/crumple.ts + ragHull.ts, game/breakables.ts, combat/fire.ts (+hooks in population/character/game/combat/vehicle/vehicles/citybuild/geometry/physics).
- e2e tests/e2e/crash6x.spec.ts (6 tests, one shared boot; R6X_SHOTS=<dir> renders screenshots): ped hood ride, wall crumple, lamp fall, molotov, perf. All pass on static build (port 5211).
- Crash sound: single path in vehicles.ts postStep (R6-A); crumple adds no sound.
- Remaining (optional): nothing known.
- R6-X fix: Vehicles.removeListeners drops traffic cars of a removed vehicle (freed body trapped in traffic.eject); regression test in crash6x.
