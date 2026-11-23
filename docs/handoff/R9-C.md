# R9-C garage + car selling: DONE (lead to commit)
Pause = game.paused (pause-menu switch) + game.camOverride; flow in src/game/garageBay.ts, hall in src/world/garageBuild.ts + game/bays.ts, panel src/ui/garageMenu.ts(+css), sell rules src/game/garage.ts.
Repro'd glitch: old shop menu never paused the world (car coasted 14 m under it), no pointer re-lock, re-arm used stale player.pos.
Hooks outside ownership: game.ts camOverride; main.ts tick/save/load; citybuild.ts buildGarages + tree skip; ui.ts/contracts.ts openGarage; save.ts `garage` field; regressions.spec.ts garage test rewritten.
Tests: garage.test.ts, e2e garage9/garage7/regressions(garage) all pass on /tmp/dist-r9c.
