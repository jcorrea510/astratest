# R6-H handoff (hair/beards/barber) — DONE (verify-only left if restarted)
Scanned meshes back (src/actors/hairScan.ts): long, buns, parted + variants bob (soft-clamped), ponytail (shell top + gathered scanned tail + tie), pixie (mirrored part); beard/goatee/moustache.
Shells (hairShells.ts) only for short/crew/fade/buzz/slick/curly/afro/cornrows(/braids)/bun; start inside the painted scalp (soft hairline); far LOD = 2 solid layers.
humanMaterial: hair material gets atlas map, mode 3 = scanned (atlas shading + strands + KK), hairline raised, stubble = even fine shadow, paint mode 6 under scanned hair.
Barber: braids dropped (renders as cornrows). Tests: hairScan.test.ts, e2e hair6bw (mesh counts) + groom6bw. Lab files deleted.
