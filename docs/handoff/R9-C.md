# R9-C garage + car selling
Done: garage.ts sell pricing/cooldown (+tests), bays.ts (2 halls), world/garageBuild.ts (hall + roll-up door), game/garageBay.ts (door/camera/pause flow via game.paused + game.camOverride),
 ui/garageMenu.ts+css (docked panel, ui.openGarage), activities.ts host (view/repair/paint/sell, sales log), save.ts `garage` field, main.ts tick/save hooks, tests/e2e/garage9.spec.ts, garage7 rewritten.
Old bug (repro'd): shop menu did not pause the world (car coasted 14 m under the menu), pointer lock not re-requested.
Next: screenshots (1280x720) + polish hall look; run full verify (tsc, eslint, vitest, e2e on /tmp/dist-r9c port 5213).
Hooks outside ownership: game.ts camOverride (+1 line), main.ts (3 lines), citybuild.ts (buildGarages + tree skip), ui.ts/contracts.ts (openGarage), save.ts.
