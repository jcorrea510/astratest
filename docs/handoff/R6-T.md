# R6-T traffic — handoff
- Found: traffic.ts already has signalCap/stopSignCap/left-turn yield/jam watchdog (WIP snapshot); tests/e2e/traffic6.spec.ts written (reds, rolled stops, idle, far idle, moving>=parked).
- In progress: running traffic6.spec on own build (/tmp/dist-R6T, port 5203); fixing whatever it reports.
- Next: unit tests for trafficRules, jam despawn check (~l.558), vitest/tsc/eslint.
- Done: yellowLeft dilemma fix (trafficRules/citymap/traffic/crowd), parked slots 0.42->0.3 + settings parked caps lowered; unit tests added. Next: rebuild+rerun traffic6 x2, final report.
- Added spawnSafeAtSignal (no spawn in dilemma zone) to crowd+traffic; verifying traffic6 e2e (flaky far reds were spawn-in-dilemma).
- DONE: traffic6 passes 3/3 runs; vitest ok. Report sent.
