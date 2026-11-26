# pkgD handoff (world/art)
- attract.ts: 6 re-authored shots (hillside golden hour, avenue, East River bridge, skyline, Saltwater Strand/Pier 9, park); attract.test.ts checks no building in first 18 m of view.
- terrain.ts buildUnderlay (called in citybuild): one merged skirt+plane mesh under the world; no clear-colour void. The audit "navy band" was the camera dipping under terrain (camera clipping is package C).
- ui/weaponPreview.ts: cached 3/4-view PNG per weapon from weaponModels, one shared GL context released after 4 s; shop.ts uses it; menus.css no longer clamps .ma-shop-desc.
- Scripts used: scratchpad/shots/{title,edge,under,shop}.mjs (vite port 5291, temp vite.pkgd.config.ts + node_modules symlink: delete before merge).
