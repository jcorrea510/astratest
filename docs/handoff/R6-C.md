# R6-C handoff (police/army)
- Done: brandish->fire, engage LOS cops, taser arrest (dispatch.ts TASE_T, 'tased' action, 'taser' sfx), holdFire during arrest, reinforcement spawn >=120 m out of view, police heli = spotter spawned 380+ m, army Gunner (gunnery.ts), police.ignoring wiring (police/armyGuards/game/sandbox).
- Tests: src/game/gunnery.test.ts, dispatch.test.ts, tests/e2e/police6c.spec.ts (port 5204, dist /tmp/dist-r6c).
- Next: run e2e, fix failures. Files outside ownership: game.ts (env hooks, armedThreat, ignore), audio/sfx.ts+contracts.ts ('taser'), actors/actions.ts ('tased').
