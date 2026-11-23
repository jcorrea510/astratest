# Round 9 plan (BRIEF9). Lead fixes owner bugs personally; features go to Sonnet agents (handoffs docs/handoff/R9-*.md).
Resume after a limit: first unticked line. Every fix gets a regression test.

Agents (features):
- [ ] R9-G gore: limbs sever (arms/legs) on the right hits, gore with every gun, much more blood.
- [ ] R9-S gun sounds: real recorded CC0 gunshot samples (online sources), credited.
- [ ] R9-W map character: less boxy streets (street life props, varied facades/setbacks, plazas, trees, awnings) at no perf cost.
- [ ] R9-C physical garage (drive in, door, paused menu, fixed UI) + selling cars (balanced).
- [ ] R9-B bank heist: vault not see-through, multi-stage robbery beyond the register.
- [ ] R9-O outfit store: better clothes/items.
Lead (owner bugs):
- [ ] L1 Mac perf: Low not smooth -> profile CPU per system, cut.
- [ ] L2 diagonal streets get signals; cars stop before the crosswalk on red; left turns yield to oncoming.
- [ ] L3 AI turns smoother/slower; player drift recovers (no endless slide).
- [ ] L4 police: lights cast light at night + brighter; no shooting through walls; no shooting an unarmed player; chase harder
      (ignore lights, quick), traffic + peds clear the way; balance (cops stay on you after a robbery).
- [ ] L5 robbery: gun-point hold-up reliable; till after shooting the clerk always works; hands-up only when it makes sense.
- [ ] L6 car-hit ragdoll glitching.
- [ ] Z gate + publish + owner summary.
