# Round 13 (owner 26 Nov, played on an M4 iPad Air): "make it look like real life"

Owner's words: "Headlights shine too bright when reflecting it's hard to see and people graphics stink. Have a subagent work
on the graphics or maybe even like five subagents in graphics dividing up the work just to make the people look real then
like five subagents on each gun to make it look good. This looks like an itch game and I need it to look like real life.
Also cars aren't going on green lights the ones that are in the left lane. Traffic lights look bad in the day time. Overall
so much work to be done. Make this amazing." Earlier: "Add touch controls for mobile testing, don't run unnecessary tests,
just get it published."

## Rules for every helper agent this round (read all)
1. Setup: you are in your own git worktree. First run `ln -s /home/user/astratest/node_modules node_modules` in its root.
   Read CLAUDE.md (project map). Do not explore the tree beyond what your package needs; grep first, read with offsets.
2. Edit ONLY the files your package owns (listed in your brief). Need a one-line hook elsewhere? Keep it minimal and say so.
   Never edit src/lab, scripts/, .github/, docs/ (except docs/handoff/R13-<pkg>.md).
3. NO BROWSER on this machine and no GLSL compiler: you cannot screenshot or compile shaders. So:
   - GLSL ES 3.00 strictly: float literals with a dot (1.0), no int/float mixing, declare before use, no recursion, no
     implicit vec size changes, only three r182 chunk names. Re-read every GLSL line you write. A shader error turns every
     person/gun/car using it black or invisible, so keep shader changes careful and self-contained.
   - Check geometry numerically (node/vitest: bounding boxes, triangle counts, anchor points).
   - The lead renders screenshots in CI (src/lab/index.html?mode=gun&id=<id> / ?mode=people&view=face|body, and in-game
     views) and will message you with feedback. Suggest in your report which views to look at.
4. Look target: photographic real life, not stylized/low-poly. Original IP only: no real brands, logos or trademarks.
5. Performance: must stay smooth on an M1 MacBook Air and an iPad (medium/low quality). No new per-frame allocations, no new
   lights added at runtime (lightPool rule), keep draw calls flat (merge by material), prefer procedural detail in
   shaders/textures over geometry, keep texture generation one-off and small (<= 1024^2, shared).
6. Verify: `npx tsc --noEmit`, `npx eslint <your files>`, `npx vitest run <tests near your files>`. Add a unit test for
   something your change guarantees (e.g. gun anchors/size/tri budget, palette ranges). Don't run the e2e suite.
7. Commit on your worktree branch (`git add <your files>; git commit -m ...` ending with the line
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Commit WIP often. Never push, never touch other branches.
8. Keep docs/handoff/R13-<pkg>.md (<= 8 lines: done / in progress / next / files) current so a fresh agent can resume.
9. Don't use any mcp__hearthbot__ tool. Final report <= 15 lines: what changed, files, tests run + results, views to check.
