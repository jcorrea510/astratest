# R6-K handoff (car theft / drive-by / bullet holes) - DONE
Fixed: sleeping parked body wakes on input (vehiclePhysics); seated feet IK (human.plantSeatedFeet, visual.userData.floorY); broken driver glass skips smash + prompt "Reach in and open" (carEntry, game.interactPrompt);
RMB drive-by (playerCombat.driveAim): pistol/SMG one-hand, rifle/shotgun two-hand lean-out, throwables, heavy excluded; aimed-side window rolled down (Vehicle.rollWindow), gun grip pulled to the window, driver leans (far side reaches over dash);
bullet-hole decals snapped to visible paint via Vehicle.surfaceRay (combat.carDecal), never on window openings.
Tests: tests/e2e/curbsteal.spec.ts (5). Files: vehiclePhysics, vehicle, human, carEntry, playerCombat, camera, game, combat.
