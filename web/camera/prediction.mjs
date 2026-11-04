/** Causal image-plane forecasts. Pixels are never converted to metres or 3D. */
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):null;};
const norm=p=>Math.hypot(p.x,p.y);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const PREDICTION_DEFAULTS=Object.freeze({horizon:.5,window:.7,minSamples:6,maxSamples:30,minSpan:.18,
  maxAge:.12,maxGap:.25,gapFactor:3,minConfidence:.2,noiseFloorPx:.35,maxUncertaintyPx:20,minMotionPx:1.5});

function solve(matrix,rhs){
  const n=rhs.length,a=matrix.map((r,i)=>[...r,rhs[i]]);
  for(let j=0;j<n;j++){
    let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(a[i][j])>Math.abs(a[pivot][j]))pivot=i;
    if(Math.abs(a[pivot][j])<1e-12)return null;
    [a[j],a[pivot]]=[a[pivot],a[j]];const d=a[j][j];for(let k=j;k<=n;k++)a[j][k]/=d;
    for(let i=0;i<n;i++)if(i!==j){const f=a[i][j];for(let k=j;k<=n;k++)a[i][k]-=f*a[j][k];}
  }return a.map(r=>r[n]);
}
function fit(samples,source,span,degree,noiseFloor){
  const design=samples.map(s=>{const t=(s.t-source)/span;return degree===2?[1,t,t*t]:[1,t];});
  let weights=samples.map(s=>clamp(s.confidence??1,.05,1)),coefficients=null,normal=null,residuals=[];
  for(let iteration=0;iteration<3;iteration++){
    normal=Array.from({length:degree+1},(_,i)=>Array.from({length:degree+1},(_,j)=>design.reduce((sum,row,k)=>sum+weights[k]*row[i]*row[j],0)));
    const rhs=axis=>Array.from({length:degree+1},(_,j)=>samples.reduce((sum,s,k)=>sum+weights[k]*design[k][j]*s.point[axis],0));
    const x=solve(normal,rhs('x')),y=solve(normal,rhs('y'));if(!x||!y)return null;coefficients={x,y};
    residuals=samples.map((s,k)=>Math.hypot(design[k].reduce((sum,v,j)=>sum+v*x[j],0)-s.point.x,design[k].reduce((sum,v,j)=>sum+v*y[j],0)-s.point.y));
    const delta=1.345*Math.max(noiseFloor,1.4826*median(residuals));
    weights=weights.map((_,i)=>clamp(samples[i].confidence??1,.05,1)*Math.min(1,delta/Math.max(residuals[i],1e-12)));
  }
  const inverse=Array.from({length:degree+1},(_,j)=>solve(normal,Array.from({length:degree+1},(_,i)=>i===j?1:0)));
  if(inverse.some(r=>!r))return null;
  const sigma=Math.max(noiseFloor,Math.sqrt(residuals.reduce((sum,r)=>sum+r*r,0)/Math.max(1,2*(samples.length-degree-1))));
  return {coefficients,inverse,sigma,residualRms:Math.sqrt(residuals.reduce((sum,r)=>sum+r*r,0)/samples.length),degree};
}
function invalid(o){return o.status&&o.status!=='tracking'?'tracking_interrupted':!finitePoint(o.point)?'missing_position':(o.confidence??1)<.2?'low_tracking_confidence':null;}

export function forecast(observations,options={}){
  const o={...PREDICTION_DEFAULTS,...options};
  const sourceTime=options.sourceTime??observations.at(-1)?.t;
  const base={status:'refused',point:null,confidence:0,sourceTime,targetTime:sourceTime+o.horizon,horizon:o.horizon,units:'px',model:'image_plane_kinematics',identityGuaranteed:false};
  const refuse=(reason,diagnostics={})=>({...base,reason,diagnostics});
  if(!Number.isFinite(sourceTime)||!Number.isFinite(o.horizon)||o.horizon<=0||o.horizon>.75)return refuse('invalid_time_or_horizon');
  const past=observations.filter(s=>Number.isFinite(s.t)&&s.t<=sourceTime+1e-10),last=past.at(-1);
  if(!last)return refuse('no_past_observation');
  base.trackId=last.trackId??null;
  if(invalid(last))return refuse(invalid(last));
  const age=sourceTime-last.t;if(age>o.maxAge)return refuse('stale_observation',{age});
  const recent=past.filter(s=>sourceTime-s.t<=o.window+1e-10);
  if(recent.some((s,i)=>i&&s.t<=recent[i-1].t))return refuse('non_increasing_timestamps');
  const cadence=median(recent.slice(1).map((s,i)=>s.t-recent[i].t).filter(dt=>dt>0));
  const gap=Math.min(o.maxGap,Math.max(.1,(cadence??.03)*o.gapFactor));
  const samples=[];let newer=null,boundary=null;
  for(let i=recent.length-1;i>=0;i--){
    const s=recent[i];
    if(invalid(s)||(s.confidence??1)<o.minConfidence){boundary=invalid(s)||'low_tracking_confidence';break;}
    if(newer&&newer.t-s.t>gap+1e-10){boundary='observation_gap';break;}
    if(newer&&newer.trackId!=null&&s.trackId!=null&&newer.trackId!==s.trackId){boundary='selection_changed';break;}
    samples.unshift(s);newer=s;if(samples.length>=o.maxSamples)break;
  }
  const diagnostics={sampleCount:samples.length,usedTimes:samples.map(s=>s.t),age,cadence,boundary};
  if(samples.length<o.minSamples)return refuse('insufficient_samples',diagnostics);
  const span=last.t-samples[0].t;if(span<o.minSpan)return refuse('insufficient_time_span',diagnostics);
  const mean={x:samples.reduce((sum,s)=>sum+s.point.x,0)/samples.length,y:samples.reduce((sum,s)=>sum+s.point.y,0)/samples.length};
  if(Math.max(...samples.map(s=>Math.hypot(s.point.x-mean.x,s.point.y-mean.y)))<o.minMotionPx)return refuse('stationary_or_low_motion',diagnostics);
  const linear=fit(samples,sourceTime,span,1,o.noiseFloorPx),quadratic=fit(samples,sourceTime,span,2,o.noiseFloorPx);
  if(!linear||!quadratic)return refuse('ill_conditioned_fit',diagnostics);
  const curvature=Math.hypot(quadratic.coefficients.x[2],quadratic.coefficients.y[2]);
  const curvatureStd=quadratic.sigma*Math.sqrt(Math.max(0,quadratic.inverse[2][2]));
  const selected=curvature>2.5*curvatureStd&&quadratic.residualRms<linear.residualRms*.8?quadratic:linear;
  const z=o.horizon/span,basis=selected.degree===2?[1,z,z*z]:[1,z];
  const value=axis=>basis.reduce((sum,b,i)=>sum+b*selected.coefficients[axis][i],0);
  const variance=basis.reduce((sum,b,i)=>sum+b*basis.reduce((sum2,c,j)=>sum2+c*selected.inverse[i][j],0),0);
  const uncertaintyPx=selected.sigma*Math.sqrt(Math.max(0,variance));
  const point={x:value('x'),y:value('y')};
  const velocityPxS={x:selected.coefficients.x[1]/span,y:selected.coefficients.y[1]/span};
  const accelerationPxS2={x:(selected.coefficients.x[2]??0)*2/span**2,y:(selected.coefficients.y[2]??0)*2/span**2};
  Object.assign(diagnostics,{span,fitResidualPx:selected.residualRms,degree:selected.degree,curvatureSignificance:curvature/Math.max(curvatureStd,1e-12)});
  if(!finitePoint(point)||uncertaintyPx>o.maxUncertaintyPx)return refuse('forecast_uncertain',{...diagnostics,uncertaintyPx});
  if(norm(velocityPxS)<3&&Math.hypot(point.x-last.point.x,point.y-last.point.y)<o.minMotionPx)return refuse('stationary_or_low_motion',diagnostics);
  const quality=samples.reduce((sum,s)=>sum+(s.confidence??1),0)/samples.length;
  const confidence=clamp(quality*Math.exp(-age/.12)*Math.exp(-o.horizon/.8)/(1+uncertaintyPx/4),0,1);
  return {...base,status:'predicted',reason:'causal_past_fit',point,velocityPxS,accelerationPxS2,uncertaintyPx,confidence,
    usedTimes:diagnostics.usedTimes,diagnostics,limitations:['Image-plane extrapolation assumes the observed motion and stationary camera continue.',
      'Confidence and pixel uncertainty are conditional diagnostics, not calibrated probabilities.','Contacts, occlusion and changing perspective are not inferred.']};
}

/** Retrospective scoring only; null means the target has not yet been observed. */
export function assessForecast(prediction,observations,{availableTime=Infinity,maxBracketGap=.18}={}){
  if(prediction?.status!=='predicted')return {status:'unscorable',reason:'prediction_was_refused',errorPx:null};
  const base={targetTime:prediction.targetTime,sourceTime:prediction.sourceTime,units:'px',errorPx:null,actual:null};
  const available=observations.filter(s=>Number.isFinite(s.t)&&s.t<=availableTime+1e-10);
  if(!available.length||available.at(-1).t<prediction.targetTime-1e-10)return null;
  const i=available.findIndex(s=>s.t>=prediction.targetTime-1e-10),b=available[i];
  const a=Math.abs(b.t-prediction.targetTime)<1e-9?b:available[i-1];
  if(!a||b.t-a.t>maxBracketGap||invalid(a)||invalid(b))return {...base,status:'unscorable',reason:'missing_target_bracket'};
  const between=available.filter(s=>s.t>prediction.sourceTime&&s.t<=b.t);
  if(between.some(invalid))return {...base,status:'unscorable',reason:'tracking_interrupted'};
  if(between.some(s=>prediction.trackId!=null&&s.trackId!=null&&s.trackId!==prediction.trackId))return {...base,status:'unscorable',reason:'selection_changed'};
  const source=available.findLast(s=>s.t<=prediction.sourceTime),sequence=source?[source,...between]:between;
  if(sequence.some((s,j)=>j&&(s.t<=sequence[j-1].t||s.t-sequence[j-1].t>maxBracketGap)))return {...base,status:'unscorable',reason:'observation_gap'};
  const f=b.t>a.t?(prediction.targetTime-a.t)/(b.t-a.t):0,actual={x:a.point.x+(b.point.x-a.point.x)*f,y:a.point.y+(b.point.y-a.point.y)*f};
  return {...base,status:'scored',reason:'target_observed',actual,errorPx:Math.hypot(prediction.point.x-actual.x,prediction.point.y-actual.y),bracketTimes:[a.t,b.t]};
}
