# R6-T traffic — handoff
- Found: traffic.ts already has signalCap/stopSignCap/left-turn yield/jam watchdog (WIP snapshot); tests/e2e/traffic6.spec.ts written (reds, rolled stops, idle, far idle, moving>=parked).
- In progress: running traffic6.spec on own build (/tmp/dist-R6T, port 5203); fixing whatever it reports.
- Next: unit tests for trafficRules, jam despawn check (~l.558), vitest/tsc/eslint.
