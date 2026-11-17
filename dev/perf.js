(async()=>{const g=window.__game; g.stop(); const out=[];
const views=[[-300,-107,0],[0,-150,1.2],[100,250,2.5],[400,150,4],[-50,420,3]];
for(const [x,z,yaw] of views){ g.player.place(x,0.3,z,yaw); g.cam.snapBehind(yaw+Math.PI); for(let i=0;i<90;i++) g.frame(1/30,false); g.frame(1/30); out.push({x,z, ...g.renderer.stats, npcs:g.pop.npcs.length, cars:g.vehicles.list.length}); }
return out;})()
