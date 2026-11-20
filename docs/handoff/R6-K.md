# R6-K handoff (car theft / drive-by / bullet holes)
Done: sleeping parked body now wakes on throttle/steer (vehiclePhysics.fixedUpdate); feet IK onto cabin floor (human.plantSeatedFeet, vehicle.visual.userData.floorY);
broken driver glass skips smash (carEntry.arrive); RMB drive-by (playerCombat.driveAim, camera opts.free, game hud crosshair); no bullet-hole decals on window openings (Vehicle.overGlass, combat.ts).
Tests: tests/e2e/curbsteal.spec.ts (4 pass). Next: none. Files: vehiclePhysics, vehicle, human, carEntry, playerCombat, camera, game(2 lines), combat(2 lines).
