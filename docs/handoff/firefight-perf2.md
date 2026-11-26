# firefight-perf2 handoff
- Done: sweep LOD coarser (src/actors/sweepLod.ts: every 1/2/3 frames on screen, 2/4/6 off screen; one controller cast per batched step, split only past 1.2 m).
- Done: skeleton rate policy `animEvery` (animLod.ts, tested): every frame within 4 m, 30 Hz to 65 m, 2.5 Hz off screen; random phase per NPC.
- Done: gun IK re-solves only on frames the skeleton was re-posed (`Npc.posed`), forced when a cop comes on screen; gripSolve(fresh) skips redundant skeleton passes.
- Measured (22 cops, ops per frame): skeleton updates 20 -> 11, sweeps 29 -> 20, findLedge 18 -> 11.
- Next if CI still over 1.8x: IK cost per solve (human.ts solveChain), GC from three mixer allocations, physics.step with moving kinematic bodies.
- Probes live outside the repo (/tmp/claude-0/perfprobe/*.mjs).
