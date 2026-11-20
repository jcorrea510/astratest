# R6-X (ragdoll / crumple / breakable props / molotov) — IN PROGRESS
- Plan: src/actors/ragdoll.ts (2-body Rapier ragdoll, G_RAG group) + population.vehicleHits hook; src/vehicles/crumple.ts (spatial-grid dents, hood/bumper/door) used by Vehicle.deform;
  src/game/breakables.ts (lamp/hydrant/bin tip over, ChunkInstancer handles); src/combat/fire.ts (molotov fire field) + Combat hooks.
- Tests: tests/e2e/crash6x.spec.ts (port 5211), unit tests next to modules. Done: (nothing yet)
- Files touched outside own: population.ts, character.ts, human.ts, vehicle.ts, citybuild.ts, geometry.ts, game.ts, combat.ts, physics.ts (G_RAG), particles.ts(add only)
