# fightperf handoff
- Goal: cut police-firefight CPU/GC (perf guard policerealism.spec.ts:67), no visual change.
- Done: human.ts solveChain no clones/closure, no redundant matrix updates (bit-exact vs old, 20 cases); gripSolve(worldFresh) skips redundant root/hand updates (gunRig passes true); npc.ts gun-fix quat hoisted; police.ts units/foot filtered in place.
- Verified: tsc, eslint, vitest, policerealism + gun e2e, A/B PERF numbers in the commit report.
- Left: nothing required.
