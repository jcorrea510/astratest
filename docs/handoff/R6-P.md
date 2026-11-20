# R6-P (pedestrians) — DONE
- Walk/don't-walk heads (src/world/pedsignals.ts, pedSignal() in citymap), npc.ts wander (kerb wait, no jaywalk), fist-fight brain + provoke(), guard/block/hands_up actions, panic/hands-up break on gunfire.
- Verified: crowd sim 60 s = 0 phantom stumbles, 0 off-crosswalk, 0 against-sign; screenshots inspected (signal heads, hands-up front/side, guard). hands_up pose retuned (elbows low: armL [-35,0,34]).
- Tests: src/world/pedsignals.test.ts, tests/e2e/pedsr6p.spec.ts (port 5205). Scratch removed. vitest 331 pass, tsc clean.
- Test note: screenshot spec must not remove army guard NPCs (crash in Character.sweep).
