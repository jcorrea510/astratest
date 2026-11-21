# R6-X (ragdoll / crumple / breakable props / molotov) — IN PROGRESS
- Code written+compiling: actors/ragdoll.ts (+Character.ragdoll/beginRagdoll/endRagdoll, population.ragHit, G_RAG/G_VRAG, vehicles/ragHull.ts proxies),
  vehicles/crumple.ts (+Vehicle.crumple, vehicles.ts postStep contact), game/breakables.ts (+citybuild brk(), geometry InstHandle, game.setLamp),
  combat/fire.ts (+combat.ts molotov bottle/ignite/burning/car heat). Unit: vehicles/crumple.test.ts.
- Next: tune ragdoll on hood (scratchpad t5/t7), screenshots, e2e tests/e2e/crash6x.spec.ts (port 5211), perf, lint.
- Outside own files: population.ts, character.ts, game.ts, combat.ts, vehicle.ts, vehiclePhysics.ts, vehicles.ts, citybuild.ts, geometry.ts, physics.ts
