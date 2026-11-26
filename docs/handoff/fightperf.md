# fightperf handoff
- Goal: cut police-firefight CPU/GC (perf guard policerealism.spec.ts:67), no visual change.
- Done: human.ts solveChain no clones/closure, no redundant matrix updates (bit-exact vs old, 20 cases); gripSolve(worldFresh) skips redundant root/hand updates (gunRig passes true); npc.ts gun-fix quat hoisted; police.ts units/foot filtered in place.
- Verified: tsc, eslint, vitest, policerealism + gun e2e, A/B PERF numbers in the commit report.
- Left: nothing required.
- Round 12b: holdOnHuman refreshes only arm-chain bones via updateWorldMatrix(false,false) (updateMatrixWorld(false) still recurses!); rotBone/gripSolve non-recursive; finger curl cached; redundant gun matrix update dropped. Local ratio ~1.9 -> ~1.5. Left: mixer in Human.update (~0.5 ms).
