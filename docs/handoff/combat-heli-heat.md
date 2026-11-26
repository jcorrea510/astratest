# combat-heli-heat handoff
- combat.spec "head shot / two to the chest": after the first round the wounded civilian bolts 0.25 s (brain flee) and ends side-on, so his near arm is legitimately in front of the chest. Not a stale pose. Fix = test holds the victim facing the shooter inside aimAt (tests/e2e/combat.spec.ts).
- policer5 heli spotlight: heliSpawnPoint picks bearing+distance only; at some camera yaws the spawn (y = player+55) is inside a ~130 m tower, the rotor strike ray wrecks it on step 1 and it respawns every frame (no heli ever arrives). Fix = Dispatch.heliSpawnY / terrainTop: spawn above any rooftop under the rotor disc.
- Tests: dispatch.test.ts (heliSpawnY unit), policer5.spec "survives its entry whichever way the camera faces" (fails without fix: spawns=90).
- Local note: clean(p) in e2e fails here on proxy 403s (environmental); assertions before it pass.
