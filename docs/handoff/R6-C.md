# R6-C handoff (police/army) - DONE, verified
- Done: brandish->cops fire (police.brandish/engage), LOS cops always pursue, taser arrest (dispatch.ts TASE_T/arrestStage, 'tased' action, 'taser' sfx), npc holdFire during arrest, reinforcements >=120 m out of view (REINFORCE_MIN), police heli spotter-only spawned 380+ m (heliSpawnPoint), army Gunner (game/gunnery.ts, hit rate ~18%), police.ignoring covers guards/gunships.
- Tests: src/game/gunnery.test.ts, dispatch.test.ts, tests/e2e/police6c.spec.ts (7 pass), police.spec arrest still passes.
- Outside ownership: game.ts (env hooks, armedThreat, ignore wiring), audio/sfx.ts+contracts.ts+audio.test.ts ('taser'), actors/actions.ts ('tased').
