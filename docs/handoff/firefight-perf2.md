# firefight-perf2 handoff
- Done: sweep LOD coarser (src/actors/sweepLod.ts: every 1/2/3 frames on screen, 2/4/6 off screen; one controller cast per batched step, split only past 1.2 m).
- Done: skeleton rate policy `animEvery` (animLod.ts, tested): every frame within 2.5 m, 30 Hz to 65 m (20 Hz when standing still), 2.5 Hz off screen; random phase per NPC; inView sphere override only within 3 m.
- Done: gun IK re-solves only on frames the skeleton was re-posed (`Npc.posed`), forced when a cop comes on screen; IK reads fresh matrixWorld directly (no per-call ancestor recompose); gripSolve(fresh) skips redundant skeleton passes.
- Measured (22 cops, ops per frame): skeleton updates 20 -> ~10, sweeps 29 -> ~20, findLedge 18 -> ~11. Local test: idle ~3.3-4 ms, fight ~5-7 ms (was 6.3-8 at the same idle); CI margin still thin.
- Next if CI still over 1.8x: the cops' shape-cast sweeps (computeColliderMovement ~0.6 ms: try excluding G_CHAR for cop-vs-cop, or skipping sweeps for cops ringed round the suspect), physics.step with moving kinematic bodies, GC from three mixer allocations.
- Probes live outside the repo (/tmp/claude-0/perfprobe/*.mjs: cpu.mjs, ablate.mjs, prof2.mjs). Local box is shared/noisy: compare CPU-time quartiles, not wall ms.
