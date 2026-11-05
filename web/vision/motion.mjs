/** Generic pixel-motion models selected by predictions of already-observed
 * past targets. No scene type, simulator state or future observations enter. */
import {forecast as kinematicForecast} from '../camera/prediction.mjs';

function solve(matrix,rhs){
  const a=matrix.map((r,i)=>[...r,rhs[i]]),n=rhs.length;
  for(let c=0;c<n;c++){
    let pivot=c;for(let i=c+1;i<n;i++)if(Math.abs(a[i][c])>Math.abs(a[pivot][c]))pivot=i;
    [a[c],a[pivot]]=[a[pivot],a[c]];if(Math.abs(a[c][c])<1e-9)return null;
    const d=a[c][c];for(let j=c;j<=n;j++)a[c][j]/=d;
    for(let i=0;i<n;i++)if(i!==c){const f=a[i][c];for(let j=c;j<=n;j++)a[i][j]-=f*a[c][j];}
  }return a.map(r=>r[n]);
}
function fit(samples,basis){
  const design=samples.map(o=>basis(o.t)),n=design[0].length;
  const matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>design.reduce((sum,r)=>sum+r[i]*r[j],0)));
  const coefficients={};
  for(const axis of ['x','y']){
    coefficients[axis]=solve(matrix,Array.from({length:n},(_,i)=>design.reduce((sum,r,k)=>sum+r[i]*samples[k].point[axis],0)));
    if(!coefficients[axis])return null;
  }
  const at=t=>{const b=basis(t);return Object.fromEntries(['x','y'].map(axis=>[axis,b.reduce((sum,v,j)=>sum+v*coefficients[axis][j],0)]));};
  const error=samples.reduce((sum,o)=>{const p=at(o.t);return sum+(p.x-o.point.x)**2+(p.y-o.point.y)**2;},0)/samples.length;
  return {coefficients,at,error};
}
function candidate(observations,sourceTime,horizon,name){
  const short=name.startsWith('short_');
  const window=name==='short_linear'?Math.max(.2,horizon):name==='short_turn'?Math.max(.32,horizon*1.6):name==='harmonic'?2.6:.65;
  if(short)name=name.slice(6);
  const samples=observations.filter(o=>o.t<=sourceTime+1e-10&&o.t>=sourceTime-window);
  if(samples.length<(short?(name==='linear'?3:4):6))return null;
  if(name==='harmonic'){
    if(samples.length<12||sourceTime-samples[0].t<.85)return null;
    let best=null;
    // The frequency is learned anew from observed image positions. It is not
    // supplied by the renderer or associated with a particular scene family.
    for(let omega=1.2;omega<=12;omega+=.2){
      const f=fit(samples,t=>[1,Math.sin(omega*(t-sourceTime)),Math.cos(omega*(t-sourceTime))]);
      if(f&&(!best||f.error<best.error))best=f;
    }
    return best?{point:best.at(sourceTime+horizon),residualPx:Math.sqrt(best.error)}:null;
  }
  const f=fit(samples,t=>name==='linear'?[1,t-sourceTime]:[1,t-sourceTime,(t-sourceTime)**2]);
  if(!f)return null;
  if(name!=='turn')return {point:f.at(sourceTime+horizon),residualPx:Math.sqrt(f.error)};
  const vx=f.coefficients.x[1],vy=f.coefficients.y[1],ax=2*f.coefficients.x[2],ay=2*f.coefficients.y[2];
  let omega=(vx*ay-vy*ax)/Math.max(1,vx*vx+vy*vy),point;
  if(Math.abs(omega)<.05)point={x:f.coefficients.x[0]+vx*horizon,y:f.coefficients.y[0]+vy*horizon};
  else{
    omega=Math.max(-12,Math.min(12,omega));const angle=omega*horizon;
    point={x:f.coefficients.x[0]+(vx*Math.sin(angle)+vy*(Math.cos(angle)-1))/omega,
      y:f.coefficients.y[0]+(vx*(1-Math.cos(angle))+vy*Math.sin(angle))/omega};
  }
  return {point,residualPx:Math.sqrt(f.error)};
}
function continuousPast(observations,sourceTime){
  const past=observations.filter(o=>Number.isFinite(o.t)&&o.t<=sourceTime+1e-10&&o.t>=sourceTime-3.65);
  const out=[];let newer=null;
  for(let i=past.length-1;i>=0;i--){
    const o=past[i];
    if(o.status&&o.status!=='tracking'||!Number.isFinite(o.point?.x)||!Number.isFinite(o.point?.y)||(o.confidence??1)<.2)break;
    if(newer&&(newer.t<=o.t||newer.t-o.t>.25||newer.trackId!==o.trackId))break;
    out.unshift(o);newer=o;
  }
  return out;
}
function observedTarget(past,time){
  const i=past.findIndex(o=>o.t>=time-1e-10);if(i<1)return null;
  const a=past[i-1],b=past[i];if(b.t-a.t>.25)return null;
  const f=(time-a.t)/(b.t-a.t);return {x:a.point.x+(b.point.x-a.point.x)*f,y:a.point.y+(b.point.y-a.point.y)*f};
}

export function forecastMotion(observations,options={}){
  // Preserve the existing tracker-quality, sample-count, stationary-camera,
  // chronology and conditioning requirements before trying alternate motion.
  const baseline=kinematicForecast(observations,options);
  if(baseline.status!=='predicted')return baseline;
  const {sourceTime,horizon}=baseline,past=continuousPast(observations,sourceTime);
  const losses={},counts={};let selected='linear',bestLoss=Infinity;
  // Brief horizons also test recent velocity/curvature. A long smoothing
  // window can lag a changing direction even when tracking itself is exact.
  const models=horizon<=.3?['linear','quad','turn','harmonic','short_linear','short_turn']:['linear','quad','turn','harmonic'];
  for(const name of models){
    const errors=[];
    for(const lag of [horizon,horizon+.15,horizon+.3,horizon+.5]){
      const origin=past.findLast(o=>o.t<=sourceTime-lag+.01);if(!origin)continue;
      if(origin.t+horizon>sourceTime+1e-10)continue;
      const prediction=candidate(past,origin.t,horizon,name),actual=observedTarget(past,origin.t+horizon);
      if(prediction&&actual)errors.push(Math.hypot(prediction.point.x-actual.x,prediction.point.y-actual.y));
    }
    if(errors.length>=2){
      const mean=errors.reduce((a,b)=>a+b,0)/errors.length;losses[name]=mean;counts[name]=errors.length;
      if(mean<bestLoss){bestLoss=mean;selected=name;}
    }
  }
  // A more flexible model must demonstrate a material past-target advantage.
  // This keeps near-linear motion from being mistaken for a periodic arc.
  // During initial warm-up, short models can already have two observed
  // validation targets while the long linear window has none. An undefined
  // linear loss must not veto those validated candidates.
  if(selected!=='linear'&&Number.isFinite(losses.linear)&&!(bestLoss<losses.linear*(selected==='harmonic'?.6:.8)))selected='linear';
  const result=candidate(past,sourceTime,horizon,selected)||candidate(past,sourceTime,horizon,'linear');
  if(!result||!Number.isFinite(result.point.x)||!Number.isFinite(result.point.y))return baseline;
  const {velocityPxS,accelerationPxS2,...metadata}=baseline;
  const uncertaintyPx=Math.max(result.residualPx,losses[selected]??baseline.uncertaintyPx);
  return {...metadata,point:result.point,model:'image_plane_adaptive_motion',reason:'past_target_model_selection',uncertaintyPx,
    usedTimes:past.map(o=>o.t),motionModel:selected,
    diagnostics:{...baseline.diagnostics,usedTimes:past.map(o=>o.t),motionModel:selected,pastTargetErrorsPx:losses,pastTargetCounts:counts,
      modelFitResidualPx:result.residualPx,selectionUsesOnlyObservedTargets:true},
    limitations:[...baseline.limitations,'Motion model selection uses past targets only. Unexpected contacts and chaotic changes remain unpredictable.']};
}
