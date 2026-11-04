#!/usr/bin/env node
/** Reproducible, independent synthetic experiments, never a hardware certificate. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {stepPhysics,rollout,cloneBody,v3,PHYSICS_DT,crossingBetween} from '../web/physics/model.mjs';
import {planMPC,seededRandom} from '../web/physics/control.mjs';
import {stepPendulumState,pendulumAcceleration,stepLiquidState,stepOrbitState,stepSpheres,median,estimateOrbitMu} from '../web/physics/alt-models.mjs';
import {createPlant,SPLIT_OFFSETS} from './fixtures/synthetic-plant.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const THRESHOLDS=JSON.parse(fs.readFileSync(path.join(ROOT,'validation/simulation-thresholds.json')));
const dt=PHYSICS_DT,axes=['x','y','z'],copy=x=>structuredClone(x),hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const vector=a=>v3(...a),distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const checks=(id,value,operator,threshold,unit='')=>({id,value,operator,threshold,unit,passed:Number.isFinite(value)&&(operator==='max'?value<=threshold:value>=threshold)});
function solve(A,b){
  const m=A.map((r,i)=>[...r,b[i]]),n=b.length;
  for(let k=0;k<n;k++){
    let pivot=k;for(let j=k+1;j<n;j++)if(Math.abs(m[j][k])>Math.abs(m[pivot][k]))pivot=j;
    if(Math.abs(m[pivot][k])<1e-14)throw Error('Unidentifiable parameter design matrix');
    [m[k],m[pivot]]=[m[pivot],m[k]];const p=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=p;
    for(let i=0;i<n;i++)if(i!==k){const f=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=f*m[k][j];}
  }return m.map(r=>r[n]);
}
function leastSquares(rows,values){const n=rows[0].length,A=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);for(let k=0;k<rows.length;k++)for(let i=0;i<n;i++){b[i]+=rows[k][i]*values[k];for(let j=0;j<n;j++)A[i][j]+=rows[k][i]*rows[k][j];}return solve(A,b);}
const prefix=(e,seconds=.45)=>({...e,observations:e.observations.filter(o=>o.t<=seconds+1e-9),contacts:e.contacts.filter(o=>o.t<=seconds+1e-9)});
function bodyAt(e,index=6){const a=e.observations[index-1],b=e.observations[index];return {p:vector(b.p),v:vector(b.p.map((p,i)=>(p-a.p[i])/(b.t-a.t))),spin:copy(e.observed_spin||v3()),orientation:{x:0,y:0,z:0,w:1}};}
function multiAt(e,index=6){const a=e.observations[index-1],b=e.observations[index];return b.positions.map((p,j)=>({p:vector(p),v:vector(p.map((x,k)=>(x-a.positions[j][k])/(b.t-a.t))),r:e.geometry.radii[j]}));}
function chaosAt(e,index=6){const a=e.observations[index-1],b=e.observations[index];return{th1:b.angles[0],th2:b.angles[1],w1:(b.angles[0]-a.angles[0])/(b.t-a.t),w2:(b.angles[1]-a.angles[1])/(b.t-a.t)};}
function calibrateHoop(episodes){
  const rows=[],values=[];
  for(const e of episodes){const s=e.observed_spin;for(let i=1;i<e.observations.length-1;i++){
    const a=e.observations[i-1],b=e.observations[i],c=e.observations[i+1],v=b.p.map((p,j)=>(p-a.p[j])/dt),acc=c.p.map((p,j)=>(p-2*b.p[j]+a.p[j])/(dt*dt)),speed=Math.hypot(...v),cross=[s.y*v[2]-s.z*v[1],s.z*v[0]-s.x*v[2],s.x*v[1]-s.y*v[0]];
    rows.push([0,-speed*v[0],1,0,cross[0]],[-1,-speed*v[1],0,0,cross[1]],[0,-speed*v[2],0,1,cross[2]]);values.push(...acc);
  }}
  const [g,drag,wx,wz,magnusCoefficient]=leastSquares(rows,values);
  return{g,drag,windAcceleration:[wx,0,wz],windX:wx/.12,magnusCoefficient,restGround:.7,restBoard:.7,restRim:.7,friction:.05,mass:.62};
}
function fitScalar(initial,key,min,max,score){
  let best=null;for(let refinement=0;refinement<3;refinement++){
    const step=(max-min)/20;for(let i=0;i<=20;i++){const value=min+i*step,cost=score({...initial,[key]:value});if(!best||cost<best.cost)best={value,cost};}
    min=Math.max(key==='friction'?0:.05,best.value-step);max=Math.min(key==='friction'?.5:.99,best.value+step);
  }return best.value;
}
function hoopScore(e,p){const s=bodyAt(e,1),params={...p,geometry:e.geometry};let err=0,n=0;for(let i=2;i<e.observations.length;i++){stepPhysics(s,params,dt);err+=distance(axes.map(a=>s.p[a]),e.observations[i].p)**2;n++;}return err/n;}
function calibrateMulti(free,contact){
  const gs=[];for(const e of free)for(let i=1;i<e.observations.length-1;i++){const o=e.observations;gs.push(-(o[i+1].positions[0][1]-2*o[i].positions[0][1]+o[i-1].positions[0][1])/(dt*dt));}
  const params={g:median(gs),restitution:.7,friction:.1};
  const score=p=>mean(contact.map(e=>{const s=multiAt(e,1);let cost=0,n=0;for(let i=2;i<e.observations.length;i++){stepSpheres(s,p,dt);for(let j=0;j<s.length;j++){cost+=distance(axes.map(a=>s[j].p[a]),e.observations[i].positions[j])**2;n++;}}return cost/n;}));
  for(let n=0;n<3;n++){params.restitution=fitScalar(params,'restitution',.3,.95,score);params.friction=fitScalar(params,'friction',0,.3,score);}return params;
}
function calibrateChaos(episodes){
  const samples=[];for(const e of episodes)for(let i=1;i<e.observations.length-1;i++){const o=e.observations,a=o[i-1],b=o[i],c=o[i+1];samples.push({th1:b.angles[0],th2:b.angles[1],w1:(b.angles[0]-a.angles[0])/dt,w2:(b.angles[1]-a.angles[1])/dt,acc:c.angles.map((v,j)=>(v-2*b.angles[j]+a.angles[j])/(dt*dt))});}
  const geom=episodes[0].geometry;
  function candidate(m2){let num=0,den=0,components=[];for(const s of samples){const a=pendulumAcceleration(s.th1,s.th2,s.w1,s.w2,geom.L1,geom.L2,{g:0,m1:1,m2}),b=pendulumAcceleration(s.th1,s.th2,s.w1,s.w2,geom.L1,geom.L2,{g:1,m1:1,m2});for(let j=0;j<2;j++){const x=b[j]-a[j],y=s.acc[j]-a[j];num+=x*y;den+=x*x;components.push([x,y]);}}
    const g=num/den,cost=mean(components.map(([x,y])=>(y-x*g)**2));return{g,m2,cost,...geom};}
  let lo=.3,hi=2,best;for(let n=0;n<35;n++){const a=candidate(lo+(hi-lo)/3),b=candidate(hi-(hi-lo)/3);if(a.cost<b.cost){hi=b.m2;best=a;}else{lo=a.m2;best=b;}}delete best.cost;return best;
}
function calibrateOrbit(episodes){const mus=[];for(const e of episodes)for(let i=1;i<e.observations.length-1;i++){const a=e.observations[i-1],b=e.observations[i],c=e.observations[i+1],mu=estimateOrbitMu(a,b,c,axes.map(k=>e.geometry.center[k]));if(mu!==null)mus.push(mu);}return{mu:median(mus),center:episodes[0].geometry.center};}
function evaluatePrediction(scene,e,params,horizon){
  const origin=6,end=origin+Math.round(horizon/dt);if(e.observations.length<=end)throw Error('Evaluation horizon exceeds observation record');
  let s=scene==='hoop'||scene==='orbit'?bodyAt(e,origin):scene==='multi'?multiAt(e,origin):scene==='chaos'?chaosAt(e,origin):{level:e.observations[origin].level,spilled:e.observations[origin].spilled};
  const errors=[],contacts=[];
  for(let i=origin+1;i<=end;i++){
    let actual,pred;
    if(scene==='hoop'){stepPhysics(s,{...params,geometry:e.geometry},dt);actual=e.observations[i].p;pred=axes.map(a=>s.p[a]);for(const type of s.lastContacts)contacts.push({t:e.observations[i].t,type});}
    else if(scene==='orbit'){stepOrbitState(s,params.center,params.mu,dt);actual=e.observations[i].p;pred=axes.map(a=>s.p[a]);}
    else if(scene==='multi'){contacts.push(...stepSpheres(s,params,dt).map(c=>({...c,t:e.observations[i].t})));actual=e.observations[i].positions.flat();pred=s.flatMap(b=>axes.map(a=>b.p[a]));}
    else if(scene==='chaos'){stepPendulumState(s,params,dt);actual=e.observations[i].angles;pred=[s.th1,s.th2];}
    else {stepLiquidState(s,params,dt);actual=[e.observations[i].level];pred=[s.level];}
    errors.push(distance(actual,pred));
  }
  return{episode_id:e.id,origin_seconds:e.observations[origin].t,horizon_seconds:horizon,mean_error:mean(errors),endpoint_error:errors.at(-1),unit:scene==='chaos'?'rad':'m',samples:errors.length,contacts,finite:errors.every(Number.isFinite)};
}
function verdict(e,p){const obs=e.observations;let crossing=null;for(let i=1;i<obs.length&&!crossing;i++)crossing=crossingBetween(vector(obs[i-1].p),vector(obs[i].p),{...p,geometry:e.geometry});return Boolean(crossing?.scored);}
function actualCrossing(e,p){for(let i=1;i<e.observations.length;i++){const q=crossingBetween(vector(e.observations[i-1].p),vector(e.observations[i].p),p);if(q)return q;}return null;}
function runMPC(e,learned,truth,seed){
  const model={...learned,geometry:e.geometry},plant={...truth,geometry:e.geometry},s=bodyAt(e,6),start=e.observations[6].t,logs=[],contacts=[];let crossing=null,actions=0,attempts=0,next=0;
  const baseline=rollout(s,plant,{duration:1.3,stopAtCrossing:true});
  let elapsed=0;
  while(elapsed<1.3-1e-12&&!crossing){
    if(elapsed+1e-9>=next&&attempts<THRESHOLDS.mpc_corrections_max){
      const started=performance.now(),plan=planMPC(cloneBody(s),model,{budget:THRESHOLDS.mpc_corrections_max-actions,candidates:32,horizon:1.3,interval:.12,maxImpulse:1.1,seed:seed+actions}),compute_ms=performance.now()-started;
      const log={t:start+elapsed,compute_ms,deadline_ms:120,deadline_met:compute_ms<=120,feasible:plan.feasible,evaluated:plan.evaluated,rejected:plan.rejected||0,reason:plan.reason||null,J:plan.J??null,J_components:plan.J_components??null,before_error_m:plan.beforeError??null,after_first_action_error_m:plan.afterError??null,candidates:plan.summaries,applied_command:plan.feasible?plan.u:null,planned_sequence:plan.commands||[],only_first_action_executed:true};
      logs.push(log);attempts++;if(plan.feasible){for(const a of axes)s.v[a]+=plan.u[a];actions++;}next+=.12;
    }
    const step=Math.min(dt,1.3-elapsed,attempts<THRESHOLDS.mpc_corrections_max&&next>elapsed+1e-12?next-elapsed:dt);
    const before={...s.p};stepPhysics(s,plant,step);elapsed+=step;contacts.push(...s.lastContacts.map(type=>({t:start+elapsed,type})));crossing=crossingBetween(before,s.p,plant);
  }
  return{episode_id:e.id,baseline_scored:baseline.scored,baseline_forbidden_contacts:baseline.contacts.filter(c=>c.type.startsWith('obstacle:')||c.type==='wall'),scored:Boolean(crossing?.scored),corrections:actions,replans:logs,expected_contacts:contacts.filter(c=>['net','ground','board','rim'].includes(c.type)),forbidden_contacts:contacts.filter(c=>c.type.startsWith('obstacle:')||c.type==='wall'),crossing};
}
export function runBenchmark(seed=20261104){
  const started=new Date().toISOString(),clock=performance.now(),plant=createPlant(seed),observations={},learned={},frozen={},scenes=[];
  // Acquire only training/validation prefixes before any test is requested.
  for(const scene of ['hoop','multi','chaos','liquid','orbit']){
    observations[scene]={train:[],validation:[],test:[]};
    for(let i=0;i<3;i++)observations[scene].train.push(prefix(plant.observe(scene,'train',i,['hoop','multi'].includes(scene)?'free':'default')));
    for(let i=0;i<2;i++)observations[scene].validation.push(plant.observe(scene,'validation',i));
  }
  learned.hoop=calibrateHoop(observations.hoop.train);
  const contactTraining=['ground','board','rim'].map((kind,i)=>prefix(plant.observe('hoop','train',i+10,kind),.7));observations.hoop.contact_train=contactTraining;
  for(let round=0;round<3;round++){
    for(const [kind,key] of [['ground','restGround'],['board','restBoard'],['rim','restRim']]){const e=contactTraining.find(e=>e.id.endsWith('-'+kind));learned.hoop[key]=fitScalar(learned.hoop,key,.3,.95,p=>hoopScore(e,p));}
    learned.hoop.friction=fitScalar(learned.hoop,'friction',0,.2,p=>hoopScore(contactTraining[0],p));
  }
  observations.multi.contact_train=Array.from({length:3},(_,i)=>prefix(plant.observe('multi','train',i+10),1.1));
  learned.multi=calibrateMulti(observations.multi.train,observations.multi.contact_train);
  learned.chaos=calibrateChaos(observations.chaos.train);
  learned.liquid={...observations.liquid.train[0].geometry,rate:median(observations.liquid.train.flatMap(e=>e.observations.slice(1).map((o,i)=>(o.level-e.observations[i].level)/dt)))};
  learned.orbit=calibrateOrbit(observations.orbit.train);
  for(const scene of Object.keys(learned))frozen[scene]={at:new Date().toISOString(),sha256:hash(learned[scene]),train_prefix_sha256:hash(observations[scene].train),parameters:copy(learned[scene])};
  const testRevealAt=new Date().toISOString();
  for(const scene of Object.keys(learned))for(let i=0;i<3;i++)observations[scene].test.push(plant.observe(scene,'test',i));
  const truth=plant.reveal(); // Accessible only after all learned models are frozen.
  for(const scene of Object.keys(learned)){
    const horizon=scene==='orbit'?THRESHOLDS.orbit_prediction_horizon_seconds:THRESHOLDS.prediction_horizon_seconds;
    const test=observations[scene].test.map(e=>evaluatePrediction(scene,e,learned[scene],horizon)),validation=observations[scene].validation.map(e=>evaluatePrediction(scene,e,learned[scene],horizon));
    const key={hoop:'hoop_mean_error_cm_max',multi:'multi_mean_error_cm_max',chaos:'chaos_mean_angle_error_rad_max',liquid:'liquid_mean_level_error_m_max',orbit:'orbit_mean_error_cm_max'}[scene],factor=['hoop','multi','orbit'].includes(scene)?100:1,unit=scene==='chaos'?'rad':scene==='liquid'?'m':'cm';
    const sceneChecks=[checks('held_out_prediction',mean(test.map(t=>t.mean_error))*factor,'max',THRESHOLDS[key],unit),checks('finite_predictions',Number(test.every(t=>t.finite)),'min',1)];
    const estimated=learned[scene],actual=truth[scene],keys={hoop:['g','drag','magnusCoefficient'],multi:['g'],chaos:['g','m2'],liquid:['rate'],orbit:['mu']}[scene];
    const parameterErrors=keys.map(key=>({key,estimated:estimated[key],truth_revealed_after_freeze:actual[key],relative_error:Math.abs(estimated[key]-actual[key])/Math.max(1e-12,Math.abs(actual[key]))}));
    sceneChecks.push(checks('active_parameter_identification',Math.max(...parameterErrors.map(p=>p.relative_error)),'max',THRESHOLDS.active_parameter_relative_error_max));
    const parameter={hoop:'g',multi:'g',chaos:'g',liquid:'rate',orbit:'mu'}[scene],intervention={parameter,factor:1.2},cf=plant.observe(scene,'test',0,'default',undefined,intervention);observations[scene].counterfactual_test=[cf];
    const cfModel={...estimated,[parameter]:estimated[parameter]*1.2},cfResult=evaluatePrediction(scene,cf,cfModel,horizon),baselineObservation=observations[scene].test[0].observations[Math.round(horizon/dt)],cfObservation=cf.observations[Math.round(horizon/dt)];
    const observable=o=>scene==='liquid'?[o.level]:scene==='chaos'?o.angles:scene==='multi'?o.positions.flat():o.p,changedBy=distance(observable(baselineObservation),observable(cfObservation));
    sceneChecks.push(checks('counterfactual_prediction',cfResult.mean_error*factor,'max',THRESHOLDS[key],unit),checks('counterfactual_changes_outcome',changedBy,'min',1e-6));
    const priors={hoop:{...estimated,g:9.81,drag:.025,windAcceleration:[0,0,0],magnusCoefficient:0},multi:{g:9.81,restitution:.8,friction:.1},chaos:{...estimated,g:9.81,m2:1},liquid:{...estimated,rate:.18},orbit:{...estimated,mu:16}};
    const priorResults=observations[scene].test.map(e=>evaluatePrediction(scene,e,priors[scene],horizon));
    scenes.push({id:scene,family:{hoop:'quadratic drag, constant gravity/wind, Magnus; restitution/Coulomb contacts; PBD net with fixed material prior',multi:'equal-mass spheres with restitution and floor friction',chaos:'double pendulum with known measured lengths and estimated gravity/mass ratio',liquid:'uniform tank volume balance, not general fluid simulation',orbit:'central inverse-square acceleration'}[scene],model:frozen[scene],parameter_errors:parameterErrors,validation,test,counterfactual:{intervention,episode_id:cf.id,measured_change:changedBy,prediction:cfResult},ablation:{kind:'identified_vs_fixed_unfitted_prior',prior_parameters:priors[scene],test_episode_ids:observations[scene].test.map(e=>e.id),prior_mean_error:mean(priorResults.map(r=>r.mean_error))*factor,identified_mean_error:mean(test.map(r=>r.mean_error))*factor,unit,prior_selected_before_test_scoring:true},checks:sceneChecks,mean_error:mean(test.map(t=>t.mean_error))*factor,unit});
  }
  const hoop=scenes[0],hp=learned.hoop;
  hoop.verdicts=observations.hoop.test.map((e,i)=>{
    const p={...hp,geometry:e.geometry},initial=bodyAt(e),pred=rollout(initial,p,{duration:1.3,stopAtCrossing:true}),rng=seededRandom(seed+40000+i),mc=[];
    for(let n=0;n<24;n++){const s=cloneBody(initial);for(const a of axes){s.p[a]+=(rng()-.5)*.01;s.v[a]+=(rng()-.5)*.04;}mc.push(Number(rollout(s,p,{duration:1.3,stopAtCrossing:true,retainPath:false}).scored));}
    const probability=mean(mc),actual=actualCrossing(e,p),outcome=Boolean(actual?.scored);return{episode_id:e.id,locked_at_t:e.observations[6].t,predicted_scored:pred.scored,actual_scored:outcome,correct:pred.scored===outcome,monte_carlo_samples:mc.length,monte_carlo_outcomes:mc,probability,brier:(probability-Number(outcome))**2,perturbations:{position_half_width_m:.005,velocity_half_width_m_s:.02},outcome_revealed_after_prediction:true};
  });
  hoop.contact_probes=[];
  for(const [i,kind] of ['ground','board','rim','net','obstacle'].entries()){
    const e=plant.observe('hoop','test',i+20,kind,.9);observations.hoop[`contact_test_${kind}`]=[e];const detected=e.contacts.map(c=>c.type),expected=kind==='obstacle'?'obstacle:forbidden-box':kind;
    hoop.contact_probes.push({episode_id:e.id,requested:kind,expected_contact:expected,observed_contacts:[...new Set(detected)],contact_count:detected.filter(c=>c===expected).length,classification:kind==='obstacle'?'deliberate positive control of forbidden-collision detector':'permitted task contact',passed:detected.includes(expected)});
  }
  hoop.checks.push(checks('contact_parameter_error',Math.max(...['restGround','restBoard','restRim','friction'].map(k=>Math.abs(hp[k]-truth.hoop[k]))),'max',THRESHOLDS.contact_parameter_absolute_error_max),checks('expected_contact_detectors',hoop.contact_probes.filter(c=>c.passed).length,'min',5),checks('verdict_accuracy',mean(hoop.verdicts.map(v=>Number(v.correct))),'min',THRESHOLDS.verdict_accuracy_min),checks('in_out_outcome_coverage',Math.min(hoop.verdicts.filter(v=>v.actual_scored).length,hoop.verdicts.filter(v=>!v.actual_scored).length),'min',THRESHOLDS.minimum_in_and_out_outcomes),checks('monte_carlo_sample_count',Math.min(...hoop.verdicts.map(v=>v.monte_carlo_samples)),'min',THRESHOLDS.monte_carlo_samples_min),checks('monte_carlo_brier',mean(hoop.verdicts.map(v=>v.brier)),'max',THRESHOLDS.monte_carlo_brier_max));
  hoop.control=Array.from({length:3},(_,i)=>{const e=plant.observe('hoop','test',i+40,'control');observations.hoop[`control_test_${i}`]=[e];return runMPC(e,hp,truth.hoop,seed+50000+i*99);});
  const obstructed=plant.observe('hoop','test',91,'control_obstacle');observations.hoop.obstacle_avoidance_test=[obstructed];hoop.obstacle_challenge=runMPC(obstructed,hp,truth.hoop,seed+60000);
  hoop.checks.push(checks('active_avoidance_baseline_collision',hoop.obstacle_challenge.baseline_forbidden_contacts.length,'min',THRESHOLDS.active_avoidance_baseline_contacts_min),checks('active_avoidance_controlled_success',Number(hoop.obstacle_challenge.scored),'min',THRESHOLDS.active_avoidance_controlled_success_min),checks('active_avoidance_forbidden_contacts',hoop.obstacle_challenge.forbidden_contacts.length,'max',THRESHOLDS.forbidden_obstacle_contacts_max));
  const allControls=[...hoop.control,hoop.obstacle_challenge];
  hoop.checks.push(checks('mpc_success_rate',mean(hoop.control.map(c=>Number(c.scored))),'min',THRESHOLDS.mpc_success_rate_min),checks('mpc_max_corrections',Math.max(...allControls.map(c=>c.corrections)),'max',THRESHOLDS.mpc_corrections_max),checks('mpc_forbidden_obstacle_contacts',allControls.reduce((n,c)=>n+c.forbidden_contacts.length,0),'max',THRESHOLDS.forbidden_obstacle_contacts_max),checks('mpc_max_compute_ms',Math.max(...allControls.flatMap(c=>c.replans.map(p=>p.compute_ms))),'max',THRESHOLDS.mpc_deadline_ms,'ms'),checks('mpc_candidate_sequences',Math.min(...allControls.flatMap(c=>c.replans.map(p=>p.evaluated))),'min',THRESHOLDS.mpc_candidate_sequences_min));
  const multi=scenes[1];multi.expected_contacts=[...new Set(observations.multi.test.flatMap(e=>e.contacts.map(c=>c.type)))];multi.checks.push(checks('sphere_and_floor_contacts',Number(multi.expected_contacts.includes('ground'))+Number(multi.expected_contacts.includes('sphere')),'min',2),checks('contact_parameter_error',Math.max(...['restitution','friction'].map(k=>Math.abs(learned.multi[k]-truth.multi[k]))),'max',THRESHOLDS.contact_parameter_absolute_error_max));
  const chaos=scenes[2],base=chaosAt(observations.chaos.test[0]),perturbed={...base,th1:base.th1+.003};let divergence=null,maxDivergence=0;
  for(let i=1;i<=Math.round(15/dt);i++){stepPendulumState(base,learned.chaos,dt);stepPendulumState(perturbed,learned.chaos,dt);const d=Math.hypot(base.th1-perturbed.th1,base.th2-perturbed.th2);maxDivergence=Math.max(maxDivergence,d);if(divergence===null&&d>.4)divergence=i*dt;}
  chaos.perturbation={initial_angle_delta_rad:.003,observation_window_seconds:15,threshold_rad:.4,predictability_horizon_seconds:divergence,censored:divergence===null,max_divergence_rad:maxDivergence};chaos.checks.push(checks('perturbation_integration_finite',Number(Number.isFinite(maxDivergence)),'min',1));
  const liquid=scenes[3],overflow=plant.observe('liquid','test',70,'overflow',2);observations.liquid.overflow_test=[overflow];const first=overflow.observations[0],last=overflow.observations.at(-1),balance=Math.abs(last.volume+last.spilled-first.volume-learned.liquid.rate*learned.liquid.area*last.t);
  liquid.balance={duration_seconds:last.t,initial_volume:first.volume,final_volume:last.volume,spilled_volume:last.spilled,identified_inflow_volume:learned.liquid.rate*learned.liquid.area*last.t,mass_balance_error:balance};liquid.checks.push(checks('mass_balance',balance,'max',THRESHOLDS.tank_mass_balance_error_max),checks('overflow_exercised',last.spilled,'min',.01));
  const orbit=scenes[4],e=observations.orbit.test[0],biased={...learned.orbit,mu:learned.orbit.mu*.965},before=evaluatePrediction('orbit',e,biased,.6),recalibrated=calibrateOrbit([prefix(e,.45)]),newTest=plant.observe('orbit','test',80);observations.orbit.recalibration_test=[newTest];const oldNew=evaluatePrediction('orbit',newTest,biased,.6),after=evaluatePrediction('orbit',newTest,recalibrated,.6),improvement=1-after.mean_error/oldNew.mean_error;
  orbit.recalibration={injected_parameter_bias_factor:.965,trigger_episode:e.id,trigger_error_cm:before.mean_error*100,calibration_prefix_seconds:.45,evaluation_episode:newTest.id,before_cm:oldNew.mean_error*100,after_cm:after.mean_error*100,relative_improvement:improvement,parameters:recalibrated};orbit.checks.push(checks('recalibration_improvement',improvement,'min',THRESHOLDS.orbit_recalibration_improvement_min));
  for(const s of scenes)s.passed=s.checks.every(c=>c.passed);
  const sourceFiles=['validation/simulation_benchmark.mjs','validation/fixtures/synthetic-plant.mjs','validation/simulation-thresholds.json','web/physics/model.mjs','web/physics/control.mjs','web/physics/alt-models.mjs'];
  return{report:{schema_version:'twinforge.simulation-benchmark.v1',mode:'simulation',source_kind:'synthetic',scientifically_validated:false,level:'L3_known_family',started_at:started,completed_at:new Date().toISOString(),runtime_seconds:(performance.now()-clock)/1000,seed,split_seeds:Object.fromEntries(Object.entries(SPLIT_OFFSETS).map(([k,v])=>[k,seed+v])),thresholds:THRESHOLDS,thresholds_sha256:hash(fs.readFileSync(path.join(ROOT,'validation/simulation-thresholds.json'),'utf8')),test_revealed_at:testRevealAt,source_sha256:Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(ROOT,f),'utf8'))])),measurement_contract:{training:'Only first .45s position/angle/level samples; contact calibration uses separate .7s / 1.1s training episodes. Geometry and orientation-derived spin are observable inputs.',validation:'Two distinct episode seeds, never used to revise a frozen model.',test:'Three distinct seeds per scene; test observations requested only after freezing model hashes.',independence:'Separate initial conditions and seed ranges, shared known simulator family. This is not model-family independence or a real-world test.',uncertainty:'24 deterministic initial-state perturbations, +/-5mm and +/-0.02m/s; descriptive confidence conditional on those assumptions, not calibrated sensor uncertainty.',contacts:'Ground, board, rim, net and sphere contacts are permitted task events. Obstacle/planet/wall contacts are forbidden in controlled runs. A deliberate obstacle probe is a positive detector control, excluded from safe-flight counts.',plant_parameters_revealed_only_after_model_freeze:true,physical_measurements:false},scenes,passed:scenes.every(s=>s.passed),failures:scenes.flatMap(s=>s.checks.filter(c=>!c.passed).map(c=>({scene:s.id,...c})))},observations};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);let out,seed=20261104;
  for(let i=0;i<args.length;i++){if(args[i]==='--out')out=args[++i];else if(args[i]==='--seed')seed=Number(args[++i]);else throw Error(`Unknown argument ${args[i]}`);}
  if(!out||!Number.isInteger(seed)||seed<0)throw Error('Usage: node validation/simulation_benchmark.mjs --out report.json --seed 20261104');
  const {report,observations}=runBenchmark(seed),absolute=path.resolve(out),raw=absolute.replace(/\.json$/,'')+'.observations.json';fs.mkdirSync(path.dirname(absolute),{recursive:true});const rawText=JSON.stringify(observations);fs.writeFileSync(raw,rawText+'\n');report.observations={path:path.relative(path.dirname(absolute),raw),sha256:hash(rawText+'\n'),bytes:Buffer.byteLength(rawText+'\n')};fs.writeFileSync(absolute,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out:absolute,passed:report.passed,runtime_seconds:report.runtime_seconds,failures:report.failures}));process.exitCode=report.passed?0:1;
}
