# R6-M handoff (game modes / death penalty / dealership / goals)
- Done: modes.ts (pure rules, prices, milestones), save v2 (mode, cars, milestones, robberies; v1 migrates to sandbox), Game.mode + downPenalty/strip/holster, Sandbox gated by mode, Redline Motors dealer + garage row (activities.ts, places.ts), goals panel (pause tab 'Goals' in regular), title New game -> Regular/Sandbox + Continue summary, HUD mode badge, regular till x1.6.
- Tests: src/game/modes.test.ts, tests/e2e/modes.spec.ts (autostart: ?mode=regular, default sandbox).
- Outside files touched: combat/weapons.ts (strip/holster), robbery.ts (till, completed), game.ts, main.ts, ui/ui.ts+contracts+css, logic.test.ts, game.spec/tour.spec (New game -> Sandbox clicks).
- Verified (continuation): tsc, eslint, vitest 348 ok; modes.spec 6/6 gameplay tests pass on own preview (:5206); title Continue test split (seeded save, one boot).
- Polish: Continue is now 2-line (label + "Regular, $x, n min ago"); title menu tightened to fit 7 rows at 720p; shop panel has read-only `info` rows (Goals shows value / Done / To do, no Buy hint); icon-less lists collapse the blank icon column (dealership).
- Remaining: confirm game.spec/tour.spec full runs (see final report). Screenshots in /tmp/claude-0/shots/r6m-*.png.
