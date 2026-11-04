import {stepPhysics} from './model.mjs';
const finite3=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?s.length%2?s[m]:(s[m-1]+s[m])/2:null;};
export const REPLAY_PROTOCOL=Object.freeze({version:'causal-rollout-v3',horizon_s:.5,issue_interval_s:.1,min_samples:3,max_samples:5,window_s:.4,gap_factor:1.75,state_fit_iterations:6,diagnostic_threshold_cm:5});
export function observedModel(twin){
  const parameters=twin?.parameters||{},value=k=>parameters[k]?.value;
  if(!Number.isFinite(value('g'))||!Number.isFinite(value('drag')))throw new Error('Replay requires measured gravity and drag (zero drag is valid).');
  const wind=value('wind');if(!finite3(wind))throw new Error('Replay requires an explicit acceleration vector for wind.');
  if(value('g')<0||value('drag')<0)throw new Error('Replay gravity and drag must be non-negative.');
  return {g:value('g'),drag:value('drag'),windAcceleration:[...wind],magnusCoefficient:Number.isFinite(value('magnus'))?value('magnus'):0,collisionEnabled:false,
    geometry:{ballRadius:0.03,floorY:0,hoop:{center:{x:0,y:0,z:0},radius:0.2,tubeRadius:0.01}},
    limitations:['Replay covers the calibrated free-flight family only.','Unmeasured restitution/friction/net parameters remain unsupported, not silently filled.'],
    spin:finite3(value('spin'))?[...value('spin')]:[0,0,0]};
}
export function forecastObservation(frame,twin,horizon=.5){
  if(!finite3(frame.position_m)||!finite3(frame.velocity_m_s)||!Number.isFinite(frame.t)||!Number.isFinite(horizon)||horizon<0)throw new Error('A prediction requires finite position, velocity and time.');
  const p=observedModel(twin),toVec=a=>({x:a[0],y:a[1],z:a[2]}),state={p:toVec(frame.position_m),v:toVec(frame.velocity_m_s),spin:toVec(p.spin)};
  let t=0;const supplied=Number(twin.simulator?.max_step_s),maxStep=Number.isFinite(supplied)&&supplied>0?Math.min(.002,supplied):.002;
  while(t<horizon-1e-12){const h=Math.min(maxStep,horizon-t);stepPhysics(state,p,h);t+=h;}
  return {source_t:frame.t,target_t:frame.t+horizon,position_m:[state.p.x,state.p.y,state.p.z],velocity_m_s:[state.v.x,state.v.y,state.v.z],limitations:p.limitations};
}
function frameReasons(f){const q=f.quality||{},r=[];if(q.missing||!finite3(f.position_m))r.push('missing_position');if(q.fp02_outlier||q.outlier)r.push('flagged_outlier');if(q.contact)r.push('unmodelled_contact');return r;}
const differentTrack=(a,b)=>a.track_id!=null&&b.track_id!=null&&a.track_id!==b.track_id;
function cadenceOf(frames){return median(frames.slice(1).map((f,i)=>f.t-frames[i].t).filter(x=>x>1e-9));}
function solve3(matrix,rhs){
  const a=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let j=0;j<3;j++){let pivot=j;for(let i=j+1;i<3;i++)if(Math.abs(a[i][j])>Math.abs(a[pivot][j]))pivot=i;
    if(Math.abs(a[pivot][j])<1e-14)return null;[a[j],a[pivot]]=[a[pivot],a[j]];
    const divisor=a[j][j];for(let k=j;k<4;k++)a[j][k]/=divisor;
    for(let i=0;i<3;i++)if(i!==j){const factor=a[i][j];for(let k=j;k<4;k++)a[i][k]-=factor*a[j][k];}
  }return a.map(row=>row[3]);
}
/** Only samples with t <= source_t can affect issuance, including cadence/quality/identity. */
export function estimateCausalState(frames,source_t,twin,options={}){
  const o={...REPLAY_PROTOCOL,...options},past=frames.filter(f=>f.t<=source_t+1e-10),last=past.at(-1),reject=(reason,extra={})=>({accepted:false,source_t,reason,...extra});
  if(!last)return reject('no_past_observation');
  const invalid=frameReasons(last);if(invalid.length)return reject(invalid[0],{reasons:invalid});
  const cadence=cadenceOf(past);if(cadence&&source_t-last.t>o.gap_factor*cadence+1e-9)return reject('stale_observation');
  const samples=[];let newer=null,segmentBoundary=null;
  for(let i=past.length-1;i>=0;i--){const f=past[i];if(source_t-f.t>o.window_s+1e-9)break;
    if(frameReasons(f).length){segmentBoundary=frameReasons(f)[0];break;}
    if(newer&&differentTrack(f,newer)){segmentBoundary='track_id_change';break;}
    if(newer&&cadence&&newer.t-f.t>o.gap_factor*cadence+1e-9){segmentBoundary='observation_gap';break;}
    samples.unshift(f);newer=f;if(samples.length===o.max_samples)break;
  }
  if(samples.length<o.min_samples)return reject('insufficient_causal_samples',{sample_count:samples.length,segment_boundary:segmentBoundary});
  const p=observedModel(twin),first=samples[0],second=samples[1],delta=second.t-first.t;
  let velocity=first.position_m.map((x,j)=>(second.position_m[j]-x)/delta);velocity[1]+=.5*p.g*delta;
  const evaluate=v=>{
    const st={p:{x:0,y:0,z:0},v:{x:v[0],y:v[1],z:v[2]},spin:{x:p.spin[0],y:p.spin[1],z:p.spin[2]}};
    let elapsed=0;const supplied=Number(twin.simulator?.max_step_s),step=Number.isFinite(supplied)&&supplied>0?Math.min(.002,supplied):.002;
    const relative=samples.map(f=>{const target=f.t-first.t;while(elapsed<target-1e-12){const h=Math.min(step,target-elapsed);stepPhysics(st,p,h);elapsed+=h;}return [st.p.x,st.p.y,st.p.z];});
    const origin=[0,1,2].map(j=>samples.reduce((sum,f,i)=>sum+f.position_m[j]-relative[i][j],0)/samples.length);
    const residual=relative.flatMap((pos,i)=>pos.map((x,j)=>x+origin[j]-samples[i].position_m[j]));
    return {origin,residual,cost:residual.reduce((sum,x)=>sum+x*x,0)};
  };
  let fitted=evaluate(velocity),damping=1e-4;
  for(let iteration=0;iteration<o.state_fit_iterations;iteration++){
    const epsilon=1e-4,jac=[0,1,2].map(j=>{const v=[...velocity];v[j]+=epsilon;return evaluate(v).residual.map((x,i)=>(x-fitted.residual[i])/epsilon);});
    const normal=jac.map((column,j)=>jac.map((other,k)=>column.reduce((sum,x,i)=>sum+x*other[i],0)+(j===k?damping:0)));
    const gradient=jac.map(column=>-column.reduce((sum,x,i)=>sum+x*fitted.residual[i],0)),step=solve3(normal,gradient);
    if(!step)break;
    const candidate=velocity.map((v,j)=>v+step[j]),trial=evaluate(candidate);
    if(trial.cost<fitted.cost){velocity=candidate;fitted=trial;damping/=3;}else damping*=10;
  }
  const state=forecastObservation({t:first.t,position_m:fitted.origin,velocity_m_s:velocity},twin,source_t-first.t);
  return {accepted:true,t:source_t,source_t,position_m:state.position_m,velocity_m_s:state.velocity_m_s,track_id:last.track_id??null,used_t:samples.map(f=>f.t),last_observation_t:last.t,cadence_s:cadence,fit_residual_mean_m:samples.reduce((sum,f,i)=>sum+Math.hypot(...fitted.residual.slice(i*3,i*3+3)),0)/samples.length,method:'causal prefix rollout least squares; six LM velocity iterations; position offset estimated from past samples only'};
}
/** Retrospective display/scoring interpolation; never used to initialize a forecast. */
export function interpolateObservation(frames,t){
  const i=frames.findIndex(f=>f.t>=t-1e-10);if(i<0||t<frames[0].t-1e-10)return null;
  const b=frames[i],a=Math.abs(b.t-t)<1e-9?b:frames[Math.max(0,i-1)];if(!finite3(a.position_m)||!finite3(b.position_m))return null;
  const f=b.t>a.t?(t-a.t)/(b.t-a.t):0;
  return {t,position_m:a.position_m.map((x,k)=>x+(b.position_m[k]-x)*f),velocity_m_s:null,bracket_t:[a.t,b.t],quality:{retrospective:true}};
}
function supportReasons(frames,forecast,actual,events=[]){
  const reasons=new Set(),sourceIndex=frames.findLastIndex(f=>f.t<=forecast.source_t+1e-10),end=frames.findIndex(f=>f.t>=forecast.target_t-1e-10),span=frames.slice(Math.max(0,sourceIndex),end<0?frames.length:end+1);
  if(!actual)reasons.add('target_not_observed');
  const cadence=forecast.initialization?.cadence_s??cadenceOf(frames.filter(f=>f.t<=forecast.source_t));
  for(let i=0;i<span.length;i++){for(const reason of frameReasons(span[i]))reasons.add(reason);if(i&&differentTrack(span[i-1],span[i]))reasons.add('track_id_change');if(i&&cadence&&span[i].t-span[i-1].t>REPLAY_PROTOCOL.gap_factor*cadence+1e-9)reasons.add('observation_gap');}
  for(const e of events)if(Number.isFinite(e.t)&&e.t>forecast.source_t&&e.t<=forecast.target_t&&/contact|bounce|collision|rim_cross/i.test(e.type||e.event||''))reasons.add('unmodelled_contact_event');
  return [...reasons];
}
export function assessForecast(frames,forecast,{available_t=Infinity,events=[]}={}){
  const actual=interpolateObservation(frames,forecast.target_t);
  if(actual&&actual.bracket_t[1]>available_t+1e-10)return null;
  const reasons=supportReasons(frames,forecast,actual,events),error=actual?Math.hypot(...actual.position_m.map((x,j)=>x-forecast.position_m[j]))*100:null;
  return {...forecast,observed_position_m:actual?.position_m??null,error_cm:error,supported:reasons.length===0,reasons};
}
export function createObservationReplay(frames,twin,options={}){
  if(!Array.isArray(frames)||!frames.length||frames.some((f,i)=>!Number.isFinite(f.t)||(i&&f.t<=frames[i-1].t)))throw new Error('Replay requires strictly increasing finite timestamps.');
  observedModel(twin);
  return {frames,twin,options:{...REPLAY_PROTOCOL,...options},next_issue:0,issued:[],rejected:[],assessed:[],pending:[],complete:false,time:frames[0].t,latest_forecast:null};
}
export function replaySummary(r){
  const scored=r.assessed.filter(f=>Number.isFinite(f.error_cm)),supported=scored.filter(f=>f.supported),mean=a=>a.length?a.reduce((s,f)=>s+f.error_cm,0)/a.length:null,rejections={},unsupported={};
  for(const f of r.rejected)rejections[f.reason]=(rejections[f.reason]||0)+1;
  for(const f of r.assessed)for(const reason of f.reasons)unsupported[reason]=(unsupported[reason]||0)+1;
  return {protocol:r.options.version,independent_test:false,diagnostic_threshold_cm:r.options.diagnostic_threshold_cm,scheduled:r.next_issue,issued:r.issued.length,rejected:r.rejected.length,scored:scored.length,supported:supported.length,pending:r.pending.length,unscorable:r.assessed.length-scored.length,all_issued_mean_cm:mean(scored),supported_mean_cm:mean(supported),issue_coverage:r.next_issue?r.issued.length/r.next_issue:0,scoring_coverage:r.issued.length?scored.length/r.issued.length:0,supported_coverage:r.issued.length?supported.length/r.issued.length:0,rejection_reasons:rejections,unsupported_reasons:unsupported};
}
export function advanceObservationReplay(r,available_t){
  const last=r.frames.at(-1).t,start=r.frames[0].t;r.time=Math.min(last,Math.max(r.time,available_t));
  while(start+r.next_issue*r.options.issue_interval_s<=r.time+1e-10){
    const t=start+r.next_issue*r.options.issue_interval_s;r.next_issue++;
    const state=estimateCausalState(r.frames,t,r.twin,r.options);
    if(!state.accepted){r.rejected.push(state);continue;}
    const forecast={...forecastObservation(state,r.twin,r.options.horizon_s),initialization:state};r.issued.push(forecast);r.pending.push(forecast);r.latest_forecast=forecast;
  }
  const pending=[];
  for(const f of r.pending){if(f.target_t>r.time+1e-10&&r.time<last-1e-10){pending.push(f);continue;}
    const assessment=assessForecast(r.frames,f,{available_t:r.time,events:r.options.events});if(assessment)r.assessed.push(assessment);else pending.push(f);
  }
  r.pending=pending;r.complete=r.time>=last-1e-10;return replaySummary(r);
}
export function benchmarkReplay(frames,twin,options={}){const r=createObservationReplay(frames,twin,options);advanceObservationReplay(r,frames.at(-1).t);return {summary:replaySummary(r),issued:r.issued,rejected:r.rejected,assessed:r.assessed};}
