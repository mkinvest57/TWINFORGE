import {cloneBody, rollout, v3} from './model.mjs';
export function seededRandom(seed=1){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const length=v=>Math.hypot(v.x,v.y,v.z);
function bounded(v,cap){const l=length(v);return l>cap?{x:v.x*cap/l,y:v.y*cap/l,z:v.z*cap/l}:v;}
/** Random-shooting MPC. Every candidate is integrated by the same model as the plant. */
export function planMPC(observed,p,{budget=3,candidates=48,horizon=1.8,interval=0.12,maxImpulse=1.1,seed=1}={}){
  if(budget<=0)return {feasible:false,reason:'correction budget exhausted',evaluated:0};
  const rng=seededRandom(seed),baseline=rollout(observed,p,{duration:horizon,stopAtCrossing:true,retainPath:false});
  const target=p.geometry.hoop.center,cross=baseline.crossing?.point||baseline.state.p;
  const h=Math.max(0.18,baseline.t),center=bounded(v3((target.x-cross.x)/h,0,(target.z-cross.z)/h),maxImpulse);
  let best=null,rejected=0;const summaries=[];
  for(let i=0;i<candidates;i++){
    const commands=Array.from({length:budget},(_,step)=>{
      if(i===0)return v3();
      if(i===1)return step===0?center:v3();
      const spread=i<candidates/2?0.35:1;
      return bounded(v3((step===0?center.x:0)+(rng()*2-1)*maxImpulse*spread,(rng()*2-1)*0.2*maxImpulse*spread,(step===0?center.z:0)+(rng()*2-1)*maxImpulse*spread),maxImpulse);
    });
    const result=rollout(observed,p,{duration:horizon,stopAtCrossing:true,stopOnForbiddenContact:true,commands,commandInterval:interval,retainPath:false});
    const forbidden=result.contacts.filter(c=>c.type!=='net');
    if(forbidden.length){rejected++;summaries.push({candidate:i,feasible:false,contacts:forbidden});continue;}
    const end=result.crossing?.point||result.state.p,terminal=(end.x-target.x)**2+(end.y-target.y)**2+(end.z-target.z)**2;
    const effort=commands.reduce((n,u)=>n+length(u)**2,0),J=result.cost+terminal*12+effort*0.08+result.proximityCost;
    summaries.push({candidate:i,feasible:true,J,terminal_error:Math.sqrt(terminal)});
    if(!best||J<best.J)best={J,commands,result,candidate:i,terminalError:Math.sqrt(terminal),components:{path_distance:result.cost,terminal_distance:terminal*12,impulse_effort:effort*0.08,obstacle_proximity:result.proximityCost}};
  }
  if(!best)return {feasible:false,reason:'all candidates collide before the target',evaluated:candidates,rejected,summaries,horizon};
  const firstOnly=cloneBody(observed);firstOnly.v.x+=best.commands[0].x;firstOnly.v.y+=best.commands[0].y;firstOnly.v.z+=best.commands[0].z;
  const after=rollout(firstOnly,p,{duration:horizon,stopAtCrossing:true,retainPath:false});
  const err=r=>{const q=r.crossing?.point||r.state.p;return Math.hypot(q.x-target.x,q.y-target.y,q.z-target.z);};
  return {feasible:true,u:{...best.commands[0]},commands:best.commands,J:best.J,J_components:best.components,horizon:baseline.t,beforeError:err(baseline),afterError:err(after),evaluated:candidates,rejected,summaries,candidate:best.candidate};
}
