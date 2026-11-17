(async()=>{const g=window.__game; g.stop(); const out=[]; const F=n=>{for(let i=0;i<n;i++) g.frame(1/30,false)};
const spots=[[-300,-96],[0,-100],[-200,300],[400,150],[100,-350],[-50,412]];
for(let m=0;m<8;m++){ for(let k=0;k<6;k++){ const s=spots[(m*6+k)%spots.length]; g.player.place(s[0],0.4,s[1],0); F(300);} window.gc&&window.gc(); out.push({m, heap:(performance.memory.usedJSHeapSize/1048576).toFixed(0), tags:g.physics.tags.size, bodies:g.physics.world.bodies.len(), colliders:g.physics.world.colliders.len(), npcs:g.pop.npcs.length, veh:g.vehicles.list.length, geos:g.renderer.renderer.info.memory.geometries}); }
return out;})()
