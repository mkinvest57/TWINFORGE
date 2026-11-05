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
function continuousPast(observations,sourceTime,window=3.65){
  const past=observations.filter(o=>Number.isFinite(o.t)&&o.t<=sourceTime+1e-10&&o.t>=sourceTime-window);
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

function shortForecastMotion(observations,options={}){
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

const vectorDistance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length>>1;return !sorted.length?0:sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.min(sorted.length-1,Math.floor(q*(sorted.length-1)))]:0;};
const plus=(a,b,scale=1)=>({x:a.x+b.x*scale,y:a.y+b.y*scale});

/** Huber reweighted moving-window state estimate. The window is measured in
 * seconds, not frame counts, so 15/30/60 fps sources have the same time scale.
 * Coefficients use normalized time to avoid an ill-conditioned tiny window. */
function robustMotionFit(past,sourceTime,window,degree=1){
  const samples=past.filter(p=>p.t>=sourceTime-window-1e-9&&p.t<=sourceTime+1e-10);
  if(samples.length<(degree===1?4:6))return null;
  const span=sourceTime-samples[0].t;if(span<.16)return null;
  const design=samples.map(p=>{const t=(p.t-sourceTime)/span;return degree===1?[1,t]:[1,t,t*t];});
  let weights=samples.map(p=>Math.max(.1,Math.min(1,p.confidence??1))),coefficients,residuals;
  for(let iteration=0;iteration<3;iteration++){
    const n=degree+1,normal=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>design.reduce((sum,row,k)=>sum+weights[k]*row[i]*row[j],0)));
    coefficients={};
    for(const axis of ['x','y']){
      coefficients[axis]=solve(normal,Array.from({length:n},(_,i)=>design.reduce((sum,row,k)=>sum+weights[k]*row[i]*samples[k].point[axis],0)));
      if(!coefficients[axis])return null;
    }
    residuals=design.map((row,i)=>Math.hypot(...['x','y'].map(axis=>row.reduce((sum,v,j)=>sum+v*coefficients[axis][j],0)-samples[i].point[axis])));
    const scale=Math.max(.35,1.4826*median(residuals)),threshold=1.5*scale;
    weights=samples.map((p,i)=>Math.max(.1,Math.min(1,p.confidence??1))*Math.min(1,threshold/Math.max(threshold,residuals[i])));
  }
  const origin={x:coefficients.x[0],y:coefficients.y[0]},velocity={x:coefficients.x[1]/span,y:coefficients.y[1]/span},acceleration={x:2*(coefficients.x[2]??0)/span**2,y:2*(coefficients.y[2]??0)/span**2};
  const noise=Math.max(.35,1.4826*median(residuals));
  // Extrapolate the estimated state rather than copying the latest centroid
  // noise into every future point. The displayed trajectory starts at the
  // actual last observation separately, with its own measurement uncertainty.
  return {origin,velocity,acceleration,noise,span,samples,residual:Math.sqrt(residuals.reduce((s,r,i)=>s+weights[i]*r*r,0)/weights.reduce((s,w)=>s+w,0))};
}
const LONG_MODELS=['velocity_recent','velocity_smooth','velocity_long','acceleration','damped_acceleration','turn','harmonic','learned_contacts'];
/** Contact planes are inferred only from abrupt reversals already visible in
 * the measured image. Smooth turning points are rejected. They are merely a
 * candidate explanation and still face the same past-target validation. */
function learnedContactCandidate(past,sourceTime){
  const points=past.filter(p=>p.t<=sourceTime+1e-10);if(points.length<10)return null;
  const segments=points.slice(1).map((p,i)=>({t:(p.t+points[i].t)/2,dt:p.t-points[i].t,x:(p.point.x-points[i].point.x)/(p.t-points[i].t),y:(p.point.y-points[i].point.y)/(p.t-points[i].t)}));
  const acceleration={},planes={x:{},y:{}},events=[];
  for(const axis of ['x','y']){
    const changes=segments.slice(1).map((v,i)=>v[axis]-segments[i][axis]);
    const ordinaryChange=Math.max(2,median(changes.map(Math.abs)));
    acceleration[axis]=median(segments.slice(1).map((v,i)=>(v[axis]-segments[i][axis])/(v.t-segments[i].t)));
    const lower=[],upper=[];
    for(let i=2;i<segments.length-1;i++){
      if(segments[i-1][axis]*segments[i][axis]>=0)continue;
      const before=segments[i-2][axis],after=segments[i+1][axis];
      if(before*after>=0||Math.min(Math.abs(before),Math.abs(after))<18||Math.abs(after-before)<Math.max(55,8*ordinaryChange))continue;
      const a=points[i-1],b=points[i+1],acc=acceleration[axis],gap=b.t-a.t;
      const beforeAtA=before+acc*(a.t-segments[i-2].t),afterAtB=after+acc*(b.t-segments[i+1].t);
      const afterAtA=afterAtB-acc*gap,backPosition=b.point[axis]-afterAtB*gap+.5*acc*gap*gap;
      const delta=(backPosition-a.point[axis])/(beforeAtA-afterAtA),time=a.t+delta;
      if(time<a.t-.03||time>b.t+.03)continue;
      const position=a.point[axis]+beforeAtA*delta+.5*acc*delta*delta;
      const restitution=Math.abs((afterAtA+acc*delta)/(beforeAtA+acc*delta));
      const event={axis,time,position,restitution:Math.max(.45,Math.min(1.05,restitution))};
      (before>0?upper:lower).push(event);events.push(event);
    }
    for(const [kind,items] of [['lower',lower],['upper',upper]]){
      if(!items.length)continue;
      // Prefer a repeated spatial cluster. An arbitrary collision in the
      // middle of the image must not move an established wall estimate.
      const groups=items.map(item=>items.filter(other=>Math.abs(item.position-other.position)<10)).sort((a,b)=>b.length-a.length);
      const group=groups[0],position=median(group.map(e=>e.position));
      const current=points.at(-1).point[axis];
      if(kind==='lower'&&current<position-5||kind==='upper'&&current>position+5)continue;
      planes[axis][kind]={position,restitution:median(group.map(e=>e.restitution)),count:group.length};
    }
  }
  if(!['x','y'].some(axis=>planes[axis].lower||planes[axis].upper))return null;
  const lastEvent=events.length?Math.max(...events.map(e=>e.time)):-Infinity;
  const recent=points.filter(p=>p.t>=Math.max(sourceTime-.28,lastEvent+.02));
  if(recent.length<3)return null;
  const first=recent[0],last=recent.at(-1),span=last.t-first.t;
  const origin={...last.point},velocity={};
  for(const axis of ['x','y'])velocity[axis]=(last.point[axis]-first.point[axis])/span+acceleration[axis]*span/2;
  const at=duration=>{
    const p={...origin},v={...velocity},steps=Math.max(1,Math.ceil(duration*120)),dt=duration/steps;
    for(let i=0;i<steps;i++)for(const axis of ['x','y']){
      p[axis]+=v[axis]*dt+.5*acceleration[axis]*dt*dt;v[axis]+=acceleration[axis]*dt;
      const low=planes[axis].lower,high=planes[axis].upper;
      if(low&&p[axis]<low.position&&v[axis]<0){p[axis]=2*low.position-p[axis];v[axis]*=-low.restitution;}
      if(high&&p[axis]>high.position&&v[axis]>0){p[axis]=2*high.position-p[axis];v[axis]*=-high.restitution;}
    }
    return p;
  };
  return {name:'learned_contacts',at,origin,velocity,acceleration,noise:1.5,residual:1.5,span,learnedPlanes:planes,contactEvents:events.length};
}

// Sufficient-statistic harmonic fit avoids allocating a design matrix and
// evaluating the same trigonometric basis again for every residual.
function fastHarmonicFit(samples,sourceTime,omega){
  let ss=0,cc=0,sc=0,s=0,c=0,x=0,y=0,xs=0,xc=0,ys=0,yc=0,squares=0;
  for(const row of samples){const sn=Math.sin(omega*(row.t-sourceTime)),cs=Math.cos(omega*(row.t-sourceTime)),px=row.point.x,py=row.point.y;
    s+=sn;c+=cs;ss+=sn*sn;cc+=cs*cs;sc+=sn*cs;x+=px;y+=py;xs+=px*sn;xc+=px*cs;ys+=py*sn;yc+=py*cs;squares+=px*px+py*py;}
  const matrix=[[samples.length,s,c],[s,ss,sc],[c,sc,cc]],rx=[x,xs,xc],ry=[y,ys,yc],cx=solve(matrix,rx),cy=solve(matrix,ry);
  if(!cx||!cy)return null;
  const error=Math.max(0,(squares-cx.reduce((v,k,i)=>v+k*rx[i],0)-cy.reduce((v,k,i)=>v+k*ry[i],0))/samples.length);
  return {error,at:t=>{const sn=Math.sin(omega*(t-sourceTime)),cs=Math.cos(omega*(t-sourceTime));return{x:cx[0]+cx[1]*sn+cx[2]*cs,y:cy[0]+cy[1]*sn+cy[2]*cs};}};
}
function longCandidate(past,sourceTime,name){
  if(name==='learned_contacts')return learnedContactCandidate(past,sourceTime);
  if(name==='harmonic'){
    const samples=past.filter(o=>o.t<=sourceTime+1e-10&&o.t>=sourceTime-2.6);
    if(samples.length<12||sourceTime-samples[0].t<.85)return null;
    let best=null;
    for(let omega=1.2;omega<=12;omega+=.2){
      const f=fastHarmonicFit(samples,sourceTime,omega);
      if(f&&(!best||f.error<best.error))best=f;
    }
    if(!best)return null;
    const noise=Math.max(.35,Math.sqrt(best.error));
    return {name,at:dt=>best.at(sourceTime+dt),noise,residual:Math.sqrt(best.error),span:sourceTime-samples[0].t};
  }
  const window=name==='velocity_recent'?.32:name==='velocity_long'?1.2:name==='velocity_smooth'?.7:name==='acceleration'?1.0:.6;
  const f=robustMotionFit(past,sourceTime,window,name.startsWith('velocity')?1:2);if(!f)return null;
  const {origin,velocity:v,acceleration:a}=f;
  let at;
  if(name.startsWith('velocity'))at=dt=>plus(origin,v,dt);
  else if(name==='acceleration')at=dt=>plus(plus(origin,v,dt),a,.5*dt*dt);
  else if(name==='damped_acceleration'){
    // Acceleration is an observed short-term tendency, not a promise that a
    // hand will keep accelerating for a whole second. Exponential decay is an
    // explicit candidate, tested on past targets alongside constant motion.
    const tau=.28;
    at=dt=>plus(plus(origin,v,dt),a,tau*(dt-tau*(1-Math.exp(-dt/tau))));
  }else{
    const omega=Math.max(-10,Math.min(10,(v.x*a.y-v.y*a.x)/Math.max(16,v.x*v.x+v.y*v.y)));
    at=dt=>Math.abs(omega)<.03?plus(origin,v,dt):({x:origin.x+(v.x*Math.sin(omega*dt)+v.y*(Math.cos(omega*dt)-1))/omega,
      y:origin.y+(v.x*(1-Math.cos(omega*dt))+v.y*Math.sin(omega*dt))/omega});
  }
  return {...f,name,at};
}
function validateLongCandidate(past,sourceTime,horizon,name){
  const targetErrors=[],recentErrors=[];
  for(const offset of [0,.15,.3,.5,.8]){
    const origin=past.findLast(o=>o.t<=sourceTime-horizon-offset+1e-10);if(!origin)continue;
    const actual=observedTarget(past,origin.t+horizon),f=longCandidate(past,origin.t,name);
    if(actual&&f)targetErrors.push(vectorDistance(f.at(horizon),actual));
  }
  // Short validation adapts promptly to a direction change; long validation
  // alone would keep favoring the model of the previous movement.
  const short=Math.min(.24,horizon);
  for(const offset of [0,.12,.28]){
    const origin=past.findLast(o=>o.t<=sourceTime-short-offset+1e-10);if(!origin)continue;
    const actual=observedTarget(past,origin.t+short),f=longCandidate(past,origin.t,name);
    if(actual&&f)recentErrors.push(vectorDistance(f.at(short),actual));
  }
  return {targetErrors,recentErrors};
}
function longHorizonForecast(observations,options){
  // Reuse chronology, selection, gap and confidence checks, but do not reject
  // a well-tracked stationary object or simply hide an uncertain long future.
  const baseline=kinematicForecast(observations,{...options,minMotionPx:0,maxUncertaintyPx:Infinity});
  if(baseline.status!=='predicted')return baseline;
  const {sourceTime,horizon}=baseline,past=continuousPast(observations,sourceTime,12),current=past.at(-1);
  const candidates=[],losses={},counts={},recentLosses={};
  for(const name of LONG_MODELS){
    const candidate=longCandidate(past,sourceTime,name);if(!candidate)continue;
    const check=validateLongCandidate(past,sourceTime,horizon,name);
    const longLoss=check.targetErrors.length>=2?median(check.targetErrors):null;
    const recentLoss=check.recentErrors.length>=2?median(check.recentErrors):null;
    losses[name]=longLoss;counts[name]=check.targetErrors.length;recentLosses[name]=recentLoss;
    // Flexible models must show a real out-of-sample advantage. Merely fitting
    // six past noisy centroids well does not justify extrapolating their bend.
    const complexity=name==='harmonic'?2:name==='acceleration'?1.2:name==='turn'?.9:name==='damped_acceleration'?.5:0;
    const score=longLoss===null?Infinity:longLoss+.55*(recentLoss??0)*horizon/.24+candidate.residual*.4+complexity;
    candidates.push({...candidate,...check,longLoss,recentLoss,score});
  }
  if(!candidates.length)return baseline;
  const smooth=candidates.find(c=>c.name==='velocity_smooth')||candidates.find(c=>c.name==='velocity_recent')||candidates[0];
  let selected=smooth;
  const validated=candidates.filter(c=>Number.isFinite(c.score));
  if(validated.length){
    selected=validated.reduce((a,b)=>a.score<=b.score?a:b);
    const simple=validated.filter(c=>c.name.startsWith('velocity')).sort((a,b)=>a.score-b.score)[0];
    if(simple&&!selected.name.startsWith('velocity')&&!(selected.score<simple.score*.88))selected=simple;
  }
  const recent=candidates.find(c=>c.name==='velocity_recent');
  // During a new movement, prefer the recent measured velocity when the old
  // smooth state is contradicted by the latest *observed* short targets.
  if(recent&&recent.recentLoss!==null&&selected.recentLoss!==null&&recent.recentLoss<selected.recentLoss*.45&&
    (selected.name!=='harmonic'||selected.residual>Math.max(2,recent.residual*3)))selected=recent;
  const contact=candidates.find(c=>c.name==='learned_contacts');
  if(contact&&contact.targetErrors.length>=2&&selected!==contact){
    // Repeated observed rebounds provide evidence of a boundary even during a
    // recent interval of straight motion. Penalize a model that crosses that
    // learned boundary, while retaining its out-of-sample error comparison.
    const end=selected.at(horizon);let contradiction=0;
    for(const axis of ['x','y']){
      const low=contact.learnedPlanes[axis].lower,high=contact.learnedPlanes[axis].upper;
      if(low?.count>=2)contradiction=Math.max(contradiction,low.position-end[axis]);
      if(high?.count>=2)contradiction=Math.max(contradiction,end[axis]-high.position);
    }
    if(contradiction>6&&contact.score<=selected.score+contradiction*.75)selected=contact;
  }
  const speed=selected.velocity?Math.hypot(selected.velocity.x,selected.velocity.y):vectorDistance(selected.at(.1),selected.at(0))*10;
  const motionSpread=Math.max(...past.filter(p=>p.t>=sourceTime-.6).map(p=>vectorDistance(p.point,current.point)));
  const stationary=motionSpread<Math.min(4,Math.max(1.5,smooth.noise*3))&&Math.hypot(smooth.velocity?.x??0,smooth.velocity?.y??0)<4;
  if(stationary)selected={...smooth,name:'hold',at:()=>({...smooth.origin}),targetErrors:smooth.targetErrors,recentErrors:smooth.recentErrors};
  const disagreementModels=candidates.filter(c=>Number.isFinite(c.score)&&c.score<selected.score*1.35+3);
  const empirical=selected.targetErrors.length>=2?quantile(selected.targetErrors,.8):null;
  const noise=Math.max(.5,selected.noise),velocityDisagreement=recent&&smooth.velocity?vectorDistance(recent.velocity,smooth.velocity):0;
  const confidence=past.slice(-10).reduce((sum,p)=>sum+(p.confidence??1),0)/Math.min(10,past.length);
  const radius=dt=>{
    if(dt===0)return noise;
    const modelSpread=disagreementModels.length?median(disagreementModels.map(c=>vectorDistance(c.at(dt),selected.at(dt)))):0;
    const initialTendency=empirical===null?speed*.15*dt:empirical*dt/horizon;
    return noise*(1+dt/Math.max(.2,selected.span))+initialTendency+velocityDisagreement*.25*dt+modelSpread;
  };
  const offsets=[0,.25,.5,.75,1].filter(dt=>dt<horizon-1e-9);offsets.push(horizon);
  let priorRadius=0;
  const trajectory=offsets.map(dt=>{const uncertaintyPx=Math.max(priorRadius,radius(dt));priorRadius=uncertaintyPx;return {dt,t:sourceTime+dt,point:dt===0?{...current.point}:selected.at(dt),uncertaintyPx};});
  const point=trajectory.at(-1).point,uncertaintyPx=trajectory.at(-1).uncertaintyPx;
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return {...baseline,status:'refused',point:null,reason:'ill_conditioned_long_forecast'};
  const usedTimes=past.map(p=>p.t),{velocityPxS,accelerationPxS2,...metadata}=baseline;
  return {...metadata,point,originPoint:trajectory[0].point,model:'image_plane_rolling_motion',motionModel:selected.name,
    reason:stationary?'observed_stationary':'causal_long_horizon_forecast',confidence:Math.max(0,Math.min(1,confidence*Math.exp(-horizon/2)/(1+uncertaintyPx/15))),
    uncertaintyPx,trajectory,usedTimes,validationState:empirical===null?'learning':'past_targets_checked',
    uncertainty:{kind:'empirical_motion_envelope',calibrated:false,radiusPx:uncertaintyPx,includesUnknownIntent:false},
    diagnostics:{...baseline.diagnostics,usedTimes,motionModel:selected.name,pastTargetErrorsPx:losses,pastTargetCounts:counts,recentTargetErrorsPx:recentLosses,
      modelFitResidualPx:selected.residual,selectionUsesOnlyObservedTargets:true,requestedHorizonS:horizon,learnedContactPlanes:selected.learnedPlanes??null},
    limitations:['A causal image-motion forecast, not a model-predictive controller or a SAM capability.',
      'The envelope summarizes recent noise and model disagreement; it is not a calibrated probability or a guaranteed bound.',
      'Unseen impacts, new hand intentions, occlusion and camera motion may change the future.']};
}

export function forecastMotion(observations,options={}){
  const horizon=options.horizon??.5;
  return horizon>=.5?longHorizonForecast(observations,{...options,horizon}):shortForecastMotion(observations,options);
}
