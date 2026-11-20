# R6-P (pedestrians) — handoff
- Done: pedSignal()/PED_WALK_TIME in citymap; src/world/pedsignals.ts (poles+walk/hand heads, wired in citybuild + game.updateSignals); npc.ts wander (commit-to-edge, kerb wait, no jaywalk, nearestNode, avoidPeds), fist-fight brain 'fight' + provoke(), guard/block/hands_up actions, Character.blockT; population danger/panic/reactToPlayer/dodge fixes; robbery hands-up breaks on gunfire.
- Tests: src/world/pedsignals.test.ts, tests/e2e/pedsr6p.spec.ts (port 5205, dist /tmp/dist-R6P). Scratch: zz_r6p_probe/zz_r6p_hands specs + `__ACTIONS` hook at end of actions.ts (REMOVE).
- Next: inspect screenshots (pedsignal-*.png, hands-*.png, guard-front.png in PED_SHOTS), tune pose numbers in actions.ts.
- Files outside ownership: game.ts (onHit->provoke, updateSignals), population.ts, robbery.ts, citybuild.ts (pedSignals), character.ts (blockT).
