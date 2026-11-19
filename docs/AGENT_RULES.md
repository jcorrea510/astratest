# Rules for build agents (overnight quality push)

- Read CLAUDE.md (project map) instead of exploring the tree. Never open public/assets, dist, node_modules, lockfiles or
  screenshots unless judging visuals. grep before reading; read big files with offset/limit. Keep reports short.
- Read docs/BRIEF5.md (the owner's latest verbatim notes) first. Quality bar: "an actual high-quality game", GTA-genre, realistic
  look, but ALL names/art/UI original (no real brands, no GTA assets/fonts/logos). Teen tone.
- Work in /home/user/astratest (shared checkout; other agents edit other files at the same time). Only edit files you own;
  for a needed change elsewhere keep it minimal and localized (small hook/one-liner) and list it in your report.
  Never run `git commit`, `git stash`, `git checkout -- <file>` or anything that rewrites others' work. The lead commits.
- Network: only GitHub (raw.githubusercontent.com, codeload) and npm registry are reachable. Prefer procedural
  geometry/textures/audio. Any downloaded asset must be CC0 and recorded in CREDITS.md.
- Perf: must run in a browser on an M1 laptop at 60 fps on medium. Merge static geometry, reuse materials/geometries,
  instancing for repeated meshes, LODs for detailed models. Keep draw calls in check (renderer has info counters).
- Verify before reporting: `npx tsc --noEmit`, `npx eslint <your files>`, `npx vitest run`, and the e2e specs that touch
  your area (`PW_PORT=5199 npx playwright test <spec> --trace off` with a dev server on 5199 started by you via
  `npx vite --port 5199 --strictPort &` if none is up; if another agent's dev server is on 5199, reuse it).
  Add unit/e2e tests for new behaviour. Look at your visual work: render screenshots with Playwright (chromium,
  deviceScaleFactor 1, window.__game / window.__meridian debug hooks exist) and actually inspect them; iterate until good.
- Be economical with tokens: don't dump huge files into context; read the parts you need; keep screenshots small (1280x720).
- If you hit a usage limit, just stop; you'll be resumed. Leave the code compiling at natural checkpoints.
- Final report (<= 25 lines): what changed, files touched outside ownership, new APIs others should use, tests run with
  results, known gaps.
