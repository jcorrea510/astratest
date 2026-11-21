# R6-H handoff (hair/beards/barber) — IN PROGRESS
Plan: scanned meshes back (new src/actors/hairScan.ts: long, buns, parted + variants bob/ponytail/pixie(mirror); beard/goatee/moustache),
drawn by hairMaterialFor (humanMaterial mode 3: atlas shading + strands + KK highlight); shells (hairShells.ts) only for short/crew/fade/buzz/slick/curly/afro/cornrows/bun.
Done: scan styles render well (lab). In progress: short/crew/fade look (bangs), ponytail tail, braids->cornrows, stubble paint.
Lab: npx vite --port 5215; node scratchpad lab.mjs jobs.json outdir (renders zz_hairlab.html). Delete src/zz_hairlab.ts + zz_hairlab.html at end.
Next: tests (hair6bw/groom6bw e2e, unit for hairScan), crowd shot vs 178a853 (worktree /tmp/r6h_old on :5235), remove worktree.
