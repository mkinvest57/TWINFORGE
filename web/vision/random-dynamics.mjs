/**
 * PRIVATE SIMULATOR SIDE ONLY.
 * Generates the hidden plant; no observation/prediction module may import this.
 * The parent receives rendered pixels and a clock, never this state or seed.
 */
import {stepPendulumRK4} from '../physics/alt-models.mjs';

export const FAMILIES = Object.freeze(['pendulum','collisions','flight']);
export const FIXED_STEP = 1 / 240;
const PALETTE = ['#ff7940','#3c9bff','#c96cf5','#f4ca48','#36cf9c'];
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
export function seededRandom(seed){
  let state=seed>>>0;
  return ()=>{
    state+=0x6D2B79F5;let t=state;
    t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

export function createHiddenWorld(seed,family='random'){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('A uint32 simulator seed is required.');
  const rand=seededRandom(seed),between=(lo,hi)=>lo+(hi-lo)*rand();
  if(family==='random')family=FAMILIES[Math.floor(rand()*FAMILIES.length)];
  if(!FAMILIES.includes(family))throw new TypeError('Unknown scene family.');
  const colorOffset=Math.floor(rand()*PALETTE.length);
  const world={family,time:0,gravity:9.81,bodies:[],contacts:0};
  if(family==='pendulum'){
    world.pivot={x:between(-.18,.18),y:3.0,z:0};
    world.params={g:9.81,L1:between(1.05,1.28),L2:between(1.05,1.28),m1:between(.7,1.8),m2:between(.7,1.8)};
    world.pendulum={th1:between(-2.1,2.1),th2:between(-2.1,2.1),w1:between(-1.35,1.35),w2:between(-1.35,1.35)};
    world.damping=between(.003,.018);
    world.bodies=[0,1].map(i=>({radius:between(.33,.38),mass:world.params[i?'m2':'m1'],color:PALETTE[(colorOffset+i*2)%PALETTE.length],p:{x:0,y:0,z:0}}));
    updatePendulumPositions(world);
    return world;
  }
  world.bounds={x:3.85,z:family==='collisions'?2.3:1.0,...(family==='flight'?{y:5.1}:{})};
  world.restitution=family==='flight'?between(.94,.985):between(.88,.97);
  world.drag=between(.008,.025);
  const count=family==='collisions'?3+Math.floor(rand()*3):1+Math.floor(rand()*2);
  for(let i=0;i<count;i++){
    const radius=between(.36,.44),mass=between(.65,2.4);
    let p;
    if(family==='collisions'){
      for(let attempt=0;attempt<200;attempt++){
        p={x:between(-3.2,3.2),y:radius,z:between(-1.7,1.7)};
        if(world.bodies.every(b=>Math.hypot(p.x-b.p.x,p.z-b.p.z)>radius+b.radius+.4))break;
      }
    }else{
      p={x:-2.9+i*1.25,y:between(1.2,2.0)+i*.8,z:between(-.45,.45)};
    }
    const v=family==='collisions'
      ?{x:between(-2.7,2.7),y:0,z:between(-1.9,1.9)}
      :{x:between(2.5,4.7),y:between(3.2,5.4),z:between(-.75,.75)};
    // Avoid a visually static initial trial, while retaining a continuous range.
    if(family==='collisions'&&Math.hypot(v.x,v.z)<1){v.x+=v.x<0?-1:1;}
    world.bodies.push({radius,mass,color:PALETTE[(colorOffset+i)%PALETTE.length],p,v});
  }
  return world;
}

/**
 * A new force is selected inside the plant, after any previous forecasts.
 * The caller supplies fresh private entropy, never a force from the observer.
 * It changes neither the source clock nor the already observed positions.
 */
export function applyHiddenImpulse(world,seed){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('A uint32 impulse seed is required.');
  const rand=seededRandom(seed),between=(lo,hi)=>lo+(hi-lo)*rand();
  if(world.family==='pendulum'){
    world.pendulum.w1=clamp(world.pendulum.w1+between(1.25,2.4)*(rand()<.5?-1:1),-5.5,5.5);
    world.pendulum.w2=clamp(world.pendulum.w2+between(1.6,2.8)*(rand()<.5?-1:1),-6,6);
  }else{
    const body=world.bodies[Math.floor(rand()*world.bodies.length)];
    body.v.x=between(2.7,4.9)*(rand()<.5?-1:1);
    body.v.z=between(1.1,2.4)*(rand()<.5?-1:1);
    if(world.family==='flight')body.v.y=between(4.2,6.2);
  }
  return world;
}

function updatePendulumPositions(world){
  const {th1,th2}=world.pendulum,{L1,L2}=world.params,p=world.pivot;
  const a=world.bodies[0].p,b=world.bodies[1].p;
  a.x=p.x+L1*Math.sin(th1);a.y=p.y-L1*Math.cos(th1);a.z=0;
  b.x=a.x+L2*Math.sin(th2);b.y=a.y-L2*Math.cos(th2);b.z=0;
}

function contact(a,b,restitution,planar){
  const dx=b.p.x-a.p.x,dy=planar?0:b.p.y-a.p.y,dz=b.p.z-a.p.z;
  const distance=Math.hypot(dx,dy,dz),radius=a.radius+b.radius;
  if(distance>=radius)return false;
  const n=distance>1e-9?{x:dx/distance,y:dy/distance,z:dz/distance}:{x:1,y:0,z:0};
  const invA=1/a.mass,invB=1/b.mass,inv=invA+invB;
  const overlap=radius-distance+1e-8;
  for(const axis of ['x','y','z']){
    a.p[axis]-=n[axis]*overlap*invA/inv;b.p[axis]+=n[axis]*overlap*invB/inv;
  }
  const speed=(b.v.x-a.v.x)*n.x+(b.v.y-a.v.y)*n.y+(b.v.z-a.v.z)*n.z;
  if(speed>=0)return false;
  const impulse=-(1+restitution)*speed/inv;
  for(const axis of ['x','y','z']){a.v[axis]-=impulse*invA*n[axis];b.v[axis]+=impulse*invB*n[axis];}
  return true;
}

export function stepHiddenWorld(world,dt=FIXED_STEP){
  if(!Number.isFinite(dt)||dt<=0||dt>1/120)throw new RangeError('Use a positive fixed simulator step at 120 Hz or faster.');
  if(world.family==='pendulum'){
    stepPendulumRK4(world.pendulum,world.params,dt);
    const decay=Math.exp(-world.damping*dt);
    world.pendulum.w1*=decay;world.pendulum.w2*=decay;
    updatePendulumPositions(world);
  }else{
    const planar=world.family==='collisions',decay=Math.exp(-world.drag*dt);
    for(const body of world.bodies){
      if(!planar){body.p.y+=body.v.y*dt-.5*world.gravity*dt*dt;body.v.y-=world.gravity*dt;}
      body.p.x+=body.v.x*dt;body.p.z+=body.v.z*dt;
      body.v.x*=decay;body.v.z*=decay;
      if(body.p.y<body.radius){
        body.p.y=body.radius;
        if(body.v.y<-.12){body.v.y=-body.v.y*world.restitution;world.contacts++;}
        else body.v.y=0;
      }
      if(!planar&&body.p.y>world.bounds.y-body.radius){
        body.p.y=world.bounds.y-body.radius;
        if(body.v.y>0){body.v.y*=-world.restitution;world.contacts++;}
      }
      for(const axis of ['x','z']){
        const bound=world.bounds[axis]-body.radius;
        if(Math.abs(body.p[axis])>bound){
          const sign=Math.sign(body.p[axis]);body.p[axis]=clamp(body.p[axis],-bound,bound);
          if(body.v[axis]*sign>0){body.v[axis]*=-world.restitution;world.contacts++;}
        }
      }
    }
    for(let pass=0;pass<2;pass++){
      for(let i=0;i<world.bodies.length;i++)for(let j=i+1;j<world.bodies.length;j++){
        if(contact(world.bodies[i],world.bodies[j],world.restitution,planar))world.contacts++;
      }
    }
  }
  world.time+=dt;
  return world;
}
