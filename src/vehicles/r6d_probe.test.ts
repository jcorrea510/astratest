import { it, beforeAll } from 'vitest';
import { Physics, RAPIER, initPhysics } from '../core/physics';
import { VehiclePhysics, type DriveInput } from './vehiclePhysics';
import { layoutFor } from './shapes';
import { VEHICLES, type VehicleKind } from './specs';
const DT=1/60, MPH=0.44704;
beforeAll(async()=>{await initPhysics();});
function setup(kind: VehicleKind){const p=new Physics();p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000,1,4000).setTranslation(0,-1,0).setFriction(0.7));
 const car=new VehiclePhysics(p,VEHICLES[kind],layoutFor(kind),0,1.2,0,0);const step=(i:DriveInput)=>{car.fixedUpdate(DT,i);p.step(DT);car.postStep();};
 for(let i=0;i<90;i++)step({throttle:0,steer:0,handbrake:false});return{car,step};}
const hold=(c:VehiclePhysics,t:number)=>Math.max(-1,Math.min(1,(t-c.speed)*0.6));
it('probe',()=>{const out:string[]=[];
 for(const k of ['sedan','coupe','muscle','pickup','van'] as VehicleKind[]){
  let row=k.padEnd(7);
  for(const mph of [20,35,50,65]){const v0=mph*MPH; if(v0>VEHICLES[k].topSpeed*0.92){row+=` | ${mph}: n/a`;continue;}
   const {car,step}=setup(k); for(let i=0;i<6000&&car.speed<v0;i++)step({throttle:1,steer:0,handbrake:false});
   let tfull=-1; let g=0,n=0,mb=0;
   for(let i=0;i<300;i++){step({throttle:hold(car,v0),steer:1,handbrake:false}); if(tfull<0&&Math.abs(car.steer)>=Math.abs(car.steerLimit(Math.abs(car.speed)))*0.97)tfull=i*DT; if(i>150){const v=car.body.linvel();g+=Math.hypot(v.x,v.z)*Math.abs(car.body.angvel().y)/9.81;n++;} mb=Math.max(mb,Math.abs(car.beta));}
   row+=` | ${mph}: ramp ${tfull.toFixed(2)} g ${(g/n).toFixed(2)} ang ${car.steer.toFixed(2)} beta ${mb.toFixed(2)} v ${car.speed.toFixed(0)}`;}
  out.push(row);}
 // (c) 90deg at 35 mph, lift-off + full lock
 for(const k of ['sedan','coupe','muscle','pickup','van'] as VehicleKind[]){const v0=35*MPH;const {car,step}=setup(k);for(let i=0;i<6000&&car.speed<v0;i++)step({throttle:1,steer:0,handbrake:false});
  let ang=0,prev=car.yaw,t90=-1,mb=0,lat=0;const x0=car.position.x,z0=car.position.z;
  for(let i=0;i<240;i++){step({throttle:0,steer:1,handbrake:false});ang+=Math.atan2(Math.sin(car.yaw-prev),Math.cos(car.yaw-prev));prev=car.yaw;mb=Math.max(mb,Math.abs(car.beta));if(t90<0&&Math.abs(ang)>=Math.PI/2){t90=i*DT;lat=Math.hypot(car.position.x-x0,car.position.z-z0);break;}}
  out.push(`C90 ${k} t=${t90.toFixed(2)} dist ${lat.toFixed(1)} maxBeta ${mb.toFixed(2)} v ${car.speed.toFixed(1)}`);}
 process.stdout.write(out.map(l=>'PR '+l).join('\n')+'\n');});
