# tour-heli-heat handoff
- policer5 heat test: police heli spawns 380-700 m out and needs ~18 s to get within 200 m; the 19 s search timer nearly ran out first. Fix: police.ts heliHold keeps the timer held while heli is inbound (unit test in policeheli.test.ts).
- tour 'rob a walk-in store': step started with 3 stars, 4 cars, 10 officers, hp 33 left from earlier steps (cops can arrest/kill mid hold-up, not reproducible locally: passes); fix = g.police.clear() + heal in the step.
- Local run needs vite.local.config.ts (fs.strict off, untracked) because node_modules is outside the worktree; do not commit it or playwright.config.ts tweaks.
