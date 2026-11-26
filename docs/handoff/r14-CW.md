# r14-CW
- farLod.ts: boxDistXZ/chunkCull (footprint-box visibility + shadow casting; small chunks cast 0.7x range; tall chunks +margin)
- game.ts cullChunks hook uses it (one hook outside ownership)
- citybuild.ts: trim chunks 125->80 m, facade 250->150 m (shadow pass no longer redraws whole 250 m chunks)
- no node city-mesh triangle count test (needs textures); measure via CI perf.txt
