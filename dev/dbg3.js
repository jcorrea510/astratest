(async()=>{const g=window.__game; g.stop(); const M=window.__meridian.missions; const F=(n)=>{for(let i=0;i<n;i++) g.frame(1/30,false)};
M.completed.add('m1'); M.start(M.available().find(d=>d.id==='m2')); F(30);
const v=g.vehicles.spawn('coupe',-282,-98,Math.PI/2); v.persistent=true; g.seatPlayer(v); F(30);
const log=[]; for(let k=0;k<50;k++){ F(150); const car=g.traffic.cars.find(c=>c.v.locked); if(!car){log.push('nocar '+M.lastResult);break;} log.push([car.v.position.x.toFixed(0),car.v.position.z.toFixed(0),car.v.speed.toFixed(1),car.lane.id,car.mode,car.stuckT.toFixed(1)].join(',')); g.playerVehicle.phys.teleport(car.v.position.x-40,1,car.v.position.z,0); }
return log;})()
