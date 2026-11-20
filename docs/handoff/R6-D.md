# R6-D handoff (driving feel) - code DONE, e2e check pending
highway/player.ts: steer now commands heading (psiMax ~5 m/s lateral, tau 0.24): 3.6 m @70mph in 1.02 s (was 1.15 but tap overshot ~5 m), 0.7 s tap = 1 lane.
vehiclePhysics.ts (player/tyre parts only): hbRelease 3.2/s, drift needs throttle/steer intent (decays 2.5/s), hands-off slide yaw damping branch, countersteer 0.7, turn-in assist 4 with slide fade, power-oversteer drift not entered at full lock.
Tests: src/vehicles/steeringfeel.test.ts, highway/player.test.ts. Remaining: e2e highway/vehicles specs.
