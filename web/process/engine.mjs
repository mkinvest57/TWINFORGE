/** Civil process test bench: a single well-mixed tank and bounded inlet valve.
 * Conservation of volume in litres, metres and seconds; not a CFD model.
 * The private synthetic plant is never passed to identification or planning.
 */
export const FAMILIES=Object.freeze(['constant_inflow','sqrt_outflow','linear_outflow']);
export const GEOMETRY=Object.freeze({widthM:.3,depthM:.1,heightM:1.5,bottomM:0,area_m2:.03});
const STEP=.02,SENSOR_DT=.1,CALIBRATION_S=4,FORECAST_HORIZON=5,CONTROL_DT=.2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0;};
const clone=x=>JSON.parse(JSON.stringify(x));
function random(seed){let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};}
function normal(rng){return Math.sqrt(-2*Math.log(Math.max(rng(),1e-12)))*Math.cos(2*Math.PI*rng());}
function privatePlant(seed){const rng=random(seed);return {qin:3.8+.6*rng(),kout:1.1+.35*rng(),area:GEOMETRY.area_m2};}
function drainBasis(level,family){return family==='constant_inflow'?0:family==='linear_outflow'?Math.max(0,level):Math.sqrt(Math.max(0,level));}
function derivative(level,valve,qin,kout,area,family='sqrt_outflow'){return (qin*valve-kout*drainBasis(level,family))/(area*1000);}
function plantStep(level,valve,plant,dt,maxM=GEOMETRY.heightM){
  const f=h=>derivative(h,valve,plant.qin,plant.kout,plant.area);
  const a=f(level),b=f(level+a*dt/2),c=f(level+b*dt/2),d=f(level+c*dt);
  const unconstrained=level+dt*(a+2*b+2*c+d)/6;
  const overflowLitres=Math.max(0,unconstrained-maxM)*plant.area*1000;
  const inletLitres=plant.qin*valve*dt;
  const outletLitres=Math.min(inletLitres+level*plant.area*1000,Math.max(0,inletLitres-(unconstrained-level)*plant.area*1000));
  return {levelM:clamp(unconstrained,0,maxM),overflowLitres,
    inletLitres,outletLitres,inflowLps:plant.qin*valve,outflowLps:outletLitres/dt};
}
function modelValues(model){
  if(!model||!FAMILIES.includes(model.family))throw new TypeError('A supported process model is required.');
  const p=model.parameters||{},area=model.geometry?.area_m2;
  if(!Number.isFinite(p.qin_lps)||p.qin_lps<0||!Number.isFinite(p.kout)||p.kout<0||!Number.isFinite(area)||area<=0)throw new TypeError('Finite nonnegative flow coefficients and measured tank area are required.');
  return {qin:p.qin_lps,kout:model.family==='constant_inflow'?0:p.kout,area};
}
function advanceModel(level,valve,model,duration,maxM=GEOMETRY.heightM){
  const p=modelValues(model);let t=0,h=level;
  while(t<duration-1e-10){const dt=Math.min(.05,duration-t),a=derivative(h,valve,p.qin,p.kout,p.area,model.family);
    h=clamp(h+dt*derivative(h+a*dt/2,valve,p.qin,p.kout,p.area,model.family),0,maxM);t+=dt;}
  return h;
}
function constrainedLeastSquares(rows,weights,family){
  let aa=0,ab=0,bb=0,ay=0,by=0;
  rows.forEach((r,i)=>{const w=weights[i];aa+=w*r.a*r.a;ab+=w*r.a*r.b;bb+=w*r.b*r.b;ay+=w*r.a*r.y;by+=w*r.b*r.y;});
  if(aa<1e-10)return null;
  if(family==='constant_inflow')return {qin:Math.max(0,ay/aa),kout:0,aa,ab:0,bb:0,det:aa,condition:1};
  const det=aa*bb-ab*ab,condition=det/Math.max(aa*bb,1e-12);
  if(condition<1e-5)return null;
  let qin=(ay*bb-by*ab)/det,kout=(by*aa-ay*ab)/det;
  if(kout<0){kout=0;qin=Math.max(0,ay/aa);}else if(qin<0){qin=0;kout=Math.max(0,by/bb);}
  return {qin,kout,aa,ab,bb,det,condition};
}

/** Identification sees only measured levels, known valve commands and area.
 * maxTime filters before any fit statistic is computed. Test data are never
 * accessed implicitly: callers explicitly supply their training episodes.
 */
export function fitModel(datasets,{family='sqrt_outflow',maxTime=Infinity,windowS=.4}={}){
  if(!FAMILIES.includes(family))throw new TypeError('Unknown process family.');
  const list=Array.isArray(datasets)?datasets:[datasets],rows=[],ids=[];let area=null;
  for(const dataset of list){
    const a=dataset.geometry?.area_m2;if(!Number.isFinite(a)||a<=0)throw new TypeError('Measured area_m2 is required.');
    if(area!==null&&Math.abs(a-area)>1e-12)throw new TypeError('Training episodes must use the same measured tank geometry.');area=a;
    const obs=(dataset.observations||[]).filter(o=>Number.isFinite(o.t)&&o.t<=maxTime+1e-10);
    if(obs.some((o,i)=>!Number.isFinite(o.level_m)||!Number.isFinite(o.valve)||o.valve<0||o.valve>1||(i&&o.t<=obs[i-1].t)))throw new TypeError('Training observations need ordered times, finite levels and bounded valve commands.');
    ids.push(dataset.id||dataset.shot_id||'unnamed');
    for(let begin=0;begin<obs.length-1;){
      let end=begin+1;while(end<obs.length&&obs[end].t-obs[begin].t<windowS-1e-9)end++;
      if(end>=obs.length)break;
      let inlet=0,outlet=0;
      for(let i=begin;i<end;i++){
        const dt=obs[i+1].t-obs[i].t;inlet+=obs[i].valve*dt;
        outlet+=(drainBasis(obs[i].level_m,family)+drainBasis(obs[i+1].level_m,family))*.5*dt;
      }
      rows.push({a:inlet,b:-outlet,y:(obs[end].level_m-obs[begin].level_m)*area*1000,start:obs[begin].t,end:obs[end].t});begin=end;
    }
  }
  const base={family,geometry:{area_m2:area},parameters:null,uncertainty:null,source:'estimated_from_level_and_valve_observations',trainIds:ids,
    units:{qin_lps:'L/s',kout:family==='sqrt_outflow'?'L/s/sqrt(m)':family==='linear_outflow'?'L/s/m':'fixed zero'},
    fit:{status:'insufficient_data',windows:rows.length,window_s:windowS,method:'nonnegative integral volume-balance fit; three Huber iterations'}};
  if(rows.length<4)return {...base,status:'insufficient_data'};
  let weights=rows.map(()=>1),fitted=null,residuals=[];
  for(let iteration=0;iteration<3;iteration++){
    fitted=constrainedLeastSquares(rows,weights,family);if(!fitted)return {...base,status:'unidentifiable',fit:{...base.fit,status:'unidentifiable'}};
    residuals=rows.map(r=>r.a*fitted.qin+r.b*fitted.kout-r.y);
    const delta=1.345*Math.max(.03,1.4826*median(residuals.map(Math.abs)));
    weights=residuals.map(r=>Math.min(1,delta/Math.max(Math.abs(r),1e-12)));
  }
  const variance=Math.max(.03**2,residuals.reduce((sum,r)=>sum+r*r,0)/Math.max(1,rows.length-(family==='constant_inflow'?1:2)));
  const uncertainty={qin_lps:Math.sqrt(variance*(family==='constant_inflow'?1/fitted.aa:fitted.bb/fitted.det)),
    kout:family==='constant_inflow'?0:Math.sqrt(variance*fitted.aa/fitted.det)};
  return {...base,status:'fitted',parameters:{qin_lps:fitted.qin,kout:fitted.kout},uncertainty,
    fit:{...base.fit,status:'fitted',residual_litres:Math.sqrt(residuals.reduce((sum,r)=>sum+r*r,0)/rows.length),
      normalized_design_determinant:fitted.condition,latest_observation_t:Math.max(...rows.map(r=>r.end))},
    limitations:['Known model family, not autonomous discovery of new fluid equations.','Conditional least-squares uncertainty excludes camera/calibration bias.']};
}

export function predictLevel(model,{levelM,valve,t=0,horizonS=FORECAST_HORIZON,alertM=1.35,maxM=GEOMETRY.heightM}={}){
  if(![levelM,valve,t,horizonS,alertM,maxM].every(Number.isFinite)||levelM<0||levelM>maxM||valve<0||valve>1||horizonS<=0||horizonS>5||alertM<=0||alertM>maxM)throw new TypeError('Prediction requires observed level, bounded valve and horizon in (0,5] seconds.');
  modelValues(model);
  const predictedLevelM=advanceModel(levelM,valve,model,horizonS,maxM);
  let timeToAlertS=levelM>=alertM?0:null,h=levelM;
  for(let elapsed=.1;timeToAlertS===null&&elapsed<=60+1e-9;elapsed+=.1){h=advanceModel(h,valve,model,.1,maxM);if(h>=alertM)timeToAlertS=Math.round(elapsed*10)/10;}
  const uncertainty=model.uncertainty;
  let intervalM=null;
  if(uncertainty&&Number.isFinite(uncertainty.qin_lps)&&Number.isFinite(uncertainty.kout)){
    const high={...model,parameters:{qin_lps:model.parameters.qin_lps+2*uncertainty.qin_lps,kout:Math.max(0,model.parameters.kout-2*uncertainty.kout)}};
    const low={...model,parameters:{qin_lps:Math.max(0,model.parameters.qin_lps-2*uncertainty.qin_lps),kout:model.parameters.kout+2*uncertainty.kout}};
    intervalM=[advanceModel(Math.max(0,levelM-.002),valve,low,horizonS,maxM),advanceModel(levelM+.002,valve,high,horizonS,maxM)];
  }
  return {status:'predicted',sourceTime:t,targetTime:t+horizonS,horizonS,predictedLevelM,timeToAlertS,intervalM,
    scenario:'hold_current_valve',valve,units:'m',model:clone(model),uses_future_observations:false};
}

/** A finite, bounded receding-horizon search. Only the first command is applied. */
export function planControl(model,{levelM,valve,targetM=1.05,alertM=1.35,maxM=1.5,maxDelta=.2,horizonS=3,intervalS=CONTROL_DT}={}){
  if(![levelM,valve,targetM,alertM,maxM,maxDelta,horizonS,intervalS].every(Number.isFinite)||levelM<0||levelM>maxM||valve<0||valve>1||targetM<0||targetM>=alertM||alertM>maxM||maxDelta<=0||maxDelta>1||horizonS<=0||horizonS>5||intervalS<=0||intervalS>horizonS)throw new TypeError('Invalid level, valve, target, or control limits.');
  modelValues(model);let best=null,evaluated=0,rejected=0;
  const options=u=>[...new Set([clamp(u-maxDelta,0,1),u,clamp(u+maxDelta,0,1)])];
  for(const a of options(valve))for(const b of options(a))for(const c of options(b)){
    const commands=[a,b,c];let h=levelM,cost=0,peak=levelM,previous=valve;
    commands.forEach(u=>{cost+=.025*(u-previous)**2;previous=u;});
    for(let elapsed=0;elapsed<horizonS-1e-9;elapsed+=.1){
      const u=commands[Math.min(2,Math.floor((elapsed+1e-9)/intervalS))];h=advanceModel(h,u,model,Math.min(.1,horizonS-elapsed),maxM);
      peak=Math.max(peak,h);cost+=.1*(h-targetM)**2+100*Math.max(0,h-alertM+.05)**2;
    }
    cost+=3*(h-targetM)**2;evaluated++;
    if(peak>Math.max(alertM,levelM)+1e-6){rejected++;continue;}
    if(!best||cost<best.cost)best={valve:a,plannedSequence:commands,cost,predictedTerminalM:h,predictedPeakM:peak};
  }
  return {...(best||{valve:clamp(valve-maxDelta,0,1),plannedSequence:[],cost:null,predictedTerminalM:null}),
    feasible:!!best,reason:best?'minimum_cost_feasible_sequence':'no_safe_candidate_bounded_closure',evaluated,rejected,
    maxDelta,intervalS,horizonS,onlyFirstActionApplied:true};
}

function commandAt(plan,t){let valve=plan[0]?.valve??0;for(const item of plan){if(item.t>t+1e-9)break;valve=item.valve;}return valve;}
function generateEpisode(plant,{seed,id,initialLevelM,durationS=6}){
  const rng=random(seed),plan=Array.from({length:13},(_,i)=>({t:i*.5,valve:[.15,.85,.35,.65][Math.floor(rng()*4)]}));
  let h=initialLevelM,t=0,nextSensor=0;const observations=[];
  while(t<=durationS+1e-9){
    if(t>=nextSensor-1e-9){observations.push({t:Number(t.toFixed(6)),level_m:h+.001*normal(rng),valve:commandAt(plan,t)});nextSensor+=SENSOR_DT;}
    if(t>=durationS-1e-9)break;
    h=plantStep(h,commandAt(plan,t),plant,STEP).levelM;t+=STEP;
  }
  return {id,shot_id:id,source_kind:'synthetic',geometry:{area_m2:plant.area},observations,control_plan:plan,
    provenance:{seed,source:'independent initial conditions and noise stream; private RK4 tank plant',sensor_noise_std_m:.001,
      valve_convention:'sample hold from timestamp until next command; control_plan is declared before the episode',real_world_validation:false}};
}

/** Public challenge has measured geometry/commands/noisy levels, never true coefficients. */
export function buildCalibrationChallenge({seed=20261104}={}){
  if(!Number.isFinite(seed))throw new TypeError('Finite challenge seed required.');
  const plant=privatePlant(seed),sets={train:[.22,.62,1.05],validation:[.38,.83],test:[.31,.73,1.1]},result={};
  let group=0;
  for(const [split,initials] of Object.entries(sets)){
    group++;result[split]=initials.map((initialLevelM,i)=>generateEpisode(plant,{seed:seed+group*10007+i*997,id:`tank-${seed}-${split}-${i+1}`,initialLevelM}));
  }
  return {schema_version:'twinforge.process-challenge.v1',source_kind:'synthetic',real_world_validation:false,families:[...FAMILIES],...result,
    protocol:{train_shots:3,validation_shots:2,test_shots:3,sensor_noise_std_m:.001,initial_prefix_s:.2,evaluation_horizon_s:3,
      threshold_mean_error_cm:1,planned_future_commands_available:true,hidden_parameters_excluded:true,
      limitations:['Known one-compartment balance equations; not CFD or a real sensor benchmark.','Independent episodes share one hidden plant coefficient set.']}};
}

export function evaluateModel(model,datasets,{initialPrefixS=.2,horizonS=3}={}){
  modelValues(model);const shots=[];
  if(!Array.isArray(datasets)||!datasets.length)return {mean_error_cm:null,shots:[],status:'no_evaluation_data'};
  for(const dataset of datasets){
    const obs=dataset.observations||[],prefix=obs.filter(o=>o.t<=initialPrefixS+1e-9),initial=prefix.at(-1);
    if(!initial||!dataset.control_plan)throw new TypeError('Evaluation needs an initial observed prefix and an ex-ante control_plan.');
    let level=initial.level_m,t=initial.t;const errors=[];
    for(const actual of obs.filter(o=>o.t>initial.t&&o.t<=initial.t+horizonS+1e-9)){
      while(t<actual.t-1e-9){const dt=Math.min(STEP,actual.t-t);level=advanceModel(level,commandAt(dataset.control_plan,t),model,dt);t+=dt;}
      errors.push({t:actual.t,error_cm:Math.abs(level-actual.level_m)*100,predicted_level_m:level,observed_level_m:actual.level_m});
    }
    if(!errors.length)throw new TypeError('Evaluation episode has no observed targets after the initialization prefix.');
    shots.push({id:dataset.id,samples:errors.length,mean_error_cm:errors.reduce((sum,r)=>sum+r.error_cm,0)/errors.length,errors});
  }
  return {mean_error_cm:shots.reduce((sum,s)=>sum+s.mean_error_cm,0)/Math.max(1,shots.length),shots,
    protocol:'initial measured level only; model frozen; future valve plan declared before acquisition; no future levels used for forecast'};
}

export function createExperiment({seed=20261104,controlEnabled=false,targetM=1.05}={}){
  if(!Number.isFinite(seed)||!Number.isFinite(targetM)||targetM<.4||targetM>1.25)throw new TypeError('Finite seed and a target between .4 and 1.25 m are required.');
  let s,plant,rng,accumulator;const original=privatePlant(seed);
  function reset(){
    plant={...original};rng=random(seed^0x5b61);accumulator=0;
    s={t:0,levelM:.28,observedLevelM:.28,targetM,alertM:1.35,maxM:1.5,valve:.85,controlEnabled,
      phase:'calibrating',model:null,modelOrigin:null,externalModel:false,comparisonStartS:null,comparisonInitialLevelM:.28,lastFitStatus:{status:'insufficient_data'},
      baseline:{levelM:.28,observedLevelM:.28,valve:.85,overflowLitres:0,inletLitres:0,outletLitres:0,inflowLps:0,outflowLps:0,overflowM3S:0},overflowLitres:0,overflowM3S:0,inletLitres:0,outletLitres:0,
      inflowLps:0,outflowLps:0,observations:[],baselineObservations:[],predictions:[],assessments:[],decisions:[],actions:[],models:[],
      latestDecision:null,lastControl:-Infinity,lastFit:-Infinity,lastIssue:-Infinity,lastSensor:-Infinity,errorCm:null,nextModelId:1};
    sample();return snapshot();
  }
  function observationDataset(){return {id:`tank-live-${seed}`,source_kind:'synthetic',geometry:{area_m2:GEOMETRY.area_m2},observations:s.observations};}
  function sample(){
    const noise=.001*normal(rng);s.observedLevelM=clamp(s.levelM+noise,0,s.maxM);s.baseline.observedLevelM=clamp(s.baseline.levelM+noise,0,s.maxM);
    s.observations.push({t:Number(s.t.toFixed(6)),level_m:s.observedLevelM,valve:s.valve});
    s.baselineObservations.push({t:Number(s.t.toFixed(6)),level_m:s.baseline.observedLevelM,valve:s.baseline.valve});s.lastSensor=s.t;
    for(const p of s.predictions){
      if(p.assessment||p.targetTime>s.t+1e-8)continue;
      const interventions=s.actions.filter(a=>a.t>p.sourceTime+1e-8&&a.t<=p.targetTime+1e-8&&['control_command','valve','inflow_perturbation'].includes(a.type));
      const assessment={sourceTime:p.sourceTime,targetTime:p.targetTime,observedAt:s.t,predictedLevelM:p.predictedLevelM,observedLevelM:s.observedLevelM,
        errorCm:Math.abs(p.predictedLevelM-s.observedLevelM)*100,supported:interventions.length===0,interventions:interventions.map(a=>({t:a.t,type:a.type})),
        measurement:'synthetic noisy level sensor',modelId:p.modelId};
      p.assessment=assessment;s.assessments.push(assessment);s.errorCm=assessment.errorCm;
    }
  }
  function setValve(value,type='control_command'){
    const next=clamp(value,0,1);
    if(Math.abs(next-s.valve)>1e-9)s.actions.push({t:s.t,type,from:s.valve,value:next});
    s.valve=next;
    // The command at a sensor timestamp applies to its following interval.
    if(Math.abs(s.observations.at(-1)?.t-s.t)<1e-7)s.observations.at(-1).valve=next;
  }
  function oneStep(){
    if(s.phase==='calibrating')setValve([.85,.2,.7,.1][Math.floor(s.t/.5+1e-9)%4],'calibration_command');
    const p=plantStep(s.levelM,s.valve,plant,STEP,s.maxM);s.levelM=p.levelM;s.overflowLitres+=p.overflowLitres;s.overflowM3S=p.overflowLitres/1000/STEP;
    s.inletLitres+=p.inletLitres;s.outletLitres+=p.outletLitres;
    s.inflowLps=p.inflowLps;s.outflowLps=p.outflowLps;
    s.baseline.valve=s.phase==='calibrating'?s.valve:1;
    const b=plantStep(s.baseline.levelM,s.baseline.valve,plant,STEP,s.maxM);s.baseline.levelM=b.levelM;s.baseline.overflowLitres+=b.overflowLitres;s.baseline.inletLitres+=b.inletLitres;s.baseline.outletLitres+=b.outletLitres;
    s.baseline.inflowLps=b.inflowLps;s.baseline.outflowLps=b.outflowLps;s.baseline.overflowM3S=b.overflowLitres/1000/STEP;
    s.t=Number((s.t+STEP).toFixed(8));
    if(s.t-s.lastSensor>=SENSOR_DT-1e-8)sample();
    if(s.phase==='calibrating'&&s.t>=CALIBRATION_S-1e-8){
      s.phase='running';s.comparisonStartS=s.t;s.comparisonInitialLevelM=s.levelM;s.baseline.levelM=s.levelM;s.baseline.observedLevelM=s.observedLevelM;s.baseline.overflowLitres=0;s.overflowLitres=0;
      s.inletLitres=s.outletLitres=s.baseline.inletLitres=s.baseline.outletLitres=0;s.baseline.valve=1;s.baselineObservations.at(-1).valve=1;
      setValve(1,'comparison_valve_open');s.actions.push({t:s.t,type:'comparison_start',sameInitialLevelM:s.levelM,baselineValve:1});
    }
    if(s.phase==='running'&&!s.externalModel&&s.t-s.lastFit>=.5-1e-9){
      const data=observationDataset();data.observations=data.observations.filter(o=>o.t>=Math.max(0,s.t-8));
      const candidate=fitModel(data,{family:'sqrt_outflow',maxTime:s.t});s.lastFit=s.t;s.lastFitStatus=clone(candidate.fit);
      if(candidate.status==='fitted'){
        candidate.id=`local-${s.nextModelId++}`;s.model=candidate;s.modelOrigin='local_known_family_fit';s.models.push({t:s.t,model:clone(candidate)});
      }
    }
    if(s.phase==='running'&&s.controlEnabled&&s.model&&s.t-s.lastControl>=CONTROL_DT-1e-9){
      const decision=planControl(s.model,{levelM:s.observedLevelM,valve:s.valve,targetM:s.targetM,alertM:s.alertM,maxM:s.maxM});
      s.latestDecision={t:s.t,...decision,modelId:s.model.id};s.decisions.push(clone(s.latestDecision));setValve(decision.valve);s.lastControl=s.t;
    }
    if(s.phase==='running'&&s.model&&s.t-s.lastIssue>=.5-1e-9&&Math.abs(s.t-s.lastSensor)<1e-8){
      const p=predictLevel(s.model,{levelM:s.observedLevelM,valve:s.valve,t:s.t,horizonS:FORECAST_HORIZON,alertM:s.alertM,maxM:s.maxM});
      p.modelId=s.model.id;s.predictions.push(p);s.lastIssue=s.t;
    }
  }
  function tick(dtS){
    if(!Number.isFinite(dtS)||dtS<0||dtS>60)throw new TypeError('tick accepts 0–60 seconds of simulated elapsed time.');
    accumulator+=dtS;while(accumulator>=STEP-1e-10){oneStep();accumulator-=STEP;}
    return snapshot();
  }
  function dispatch(action){
    if(action.type==='control'){s.controlEnabled=!!action.enabled;s.actions.push({t:s.t,type:'control_mode',enabled:s.controlEnabled});}
    else if(action.type==='valve'){
      if(!Number.isFinite(action.value)||action.value<0||action.value>1)throw new TypeError('Valve command must be in [0,1].');
      s.controlEnabled=false;setValve(action.value,'valve');
    }else if(action.type==='inflow_perturbation'){
      if(!Number.isFinite(action.factor)||action.factor<.5||action.factor>1.5)throw new TypeError('Inlet perturbation factor must be in [.5,1.5].');
      plant.qin=original.qin*action.factor;s.actions.push({t:s.t,type:action.type,factor:action.factor,appliesTo:'both_branches'});
    }else if(action.type==='target'){
      if(!Number.isFinite(action.levelM)||action.levelM<.4||action.levelM>s.alertM-.1)throw new TypeError('Target must retain at least 10 cm below the alert.');
      s.targetM=action.levelM;s.actions.push({t:s.t,type:'target',levelM:s.targetM});
    }else if(action.type==='apply_model'){
      modelValues(action.model);if(Math.abs(action.model.geometry.area_m2-GEOMETRY.area_m2)>1e-9)throw new TypeError('Model geometry differs from measured tank.');
      s.model=clone(action.model);s.model.id=s.model.id||`external-${s.nextModelId++}`;s.externalModel=true;s.modelOrigin='external_L3_fit';
      s.lastFitStatus={status:'fitted',...clone(s.model.fit||{}),
        residual_litres:s.model.fit?.residual_litres??s.model.fit?.volume_residual_rmse_l??null};
      s.models.push({t:s.t,model:clone(s.model)});s.actions.push({t:s.t,type:'apply_model',modelId:s.model.id});
    }else if(action.type==='reset')return reset();
    else throw new TypeError('Unsupported process action.');
    return snapshot();
  }
  function snapshot(){
    const latest=s.predictions.at(-1),scored=s.assessments;
    const balance=branch=>({initialLitres:s.comparisonInitialLevelM*GEOMETRY.area_m2*1000,inletLitres:branch.inletLitres,outletLitres:branch.outletLitres,
      storedLitres:branch.levelM*GEOMETRY.area_m2*1000,overflowLitres:branch.overflowLitres,
      residualLitres:s.comparisonInitialLevelM*GEOMETRY.area_m2*1000+branch.inletLitres-branch.outletLitres-branch.levelM*GEOMETRY.area_m2*1000-branch.overflowLitres});
    return {t:s.t,timeS:s.t,levelM:s.levelM,observedLevelM:s.observedLevelM,targetM:s.targetM,alertM:s.alertM,maxM:s.maxM,valve:s.valve,
      controlEnabled:s.controlEnabled,phase:s.phase,geometry:{...GEOMETRY},model:s.model?clone(s.model):null,modelOrigin:s.modelOrigin,
      fitQuality:{...s.lastFitStatus,usingLastValidModel:!!s.model&&s.lastFitStatus.status!=='fitted'},predictedLevelM:latest?.predictedLevelM??null,forecastLevelM:latest?.predictedLevelM??null,
      forecastSourceTime:latest?.sourceTime??null,forecastTargetTime:latest?.targetTime??null,forecastScenario:'hold_current_valve',timeToAlertS:latest?.timeToAlertS??null,
      errorCm:s.errorCm,meanErrorCm:scored.length?scored.reduce((a,b)=>a+b.errorCm,0)/scored.length:null,forecastCounts:{issued:s.predictions.length,scored:scored.length,supported:scored.filter(a=>a.supported).length,pending:s.predictions.length-scored.length},
      inflowLps:s.inflowLps,outflowLps:s.outflowLps,inflowM3S:s.inflowLps/1000,pumpOn:s.valve>0,overflowLitres:s.overflowLitres,
      overflowM3S:s.overflowM3S,overflowVolumeM3:s.overflowLitres/1000,baseline:{...clone(s.baseline),volumeBalance:balance(s.baseline)},comparisonStartS:s.comparisonStartS,volumeBalance:balance(s),
      observationCount:s.observations.length,observations:clone(s.observations.slice(-80)),latestDecision:s.latestDecision?clone(s.latestDecision):null,
      sourceKind:'synthetic',realWorldValidation:false,flowDisplaySource:'private synthetic plant flows; never supplied to identification',
      limitations:['One-compartment volume balance, not CFD.','Forecast assumes current valve remains unchanged; later interventions are marked in every score.','No physical actuator or real-world validation.']};
  }
  function exportEvidence({includeEvaluationTruth=false}={}){
    const report={schema_version:'twinforge.process-experiment.v1',source_kind:'synthetic',real_world_validation:false,seed,geometry:{...GEOMETRY},
      protocol:{step_s:STEP,sensor_dt_s:SENSOR_DT,sensor_noise_std_m:.001,calibration_seconds:CALIBRATION_S,forecast_horizon_s:FORECAST_HORIZON,control_interval_s:CONTROL_DT,
        common_noise_for_baseline_and_control:true,baseline_initial_state_matched:true,fit_inputs:['observed level_m','known valve command','timestamp','measured area_m2']},
      snapshot:snapshot(),observations:clone(s.observations),baselineObservations:clone(s.baselineObservations),predictions:clone(s.predictions),assessments:clone(s.assessments),
      actions:clone(s.actions),decisions:clone(s.decisions),modelHistory:clone(s.models)};
    if(includeEvaluationTruth)report.evaluation_only={access:'never use as fitting input',initial_plant:{qin_lps:original.qin,kout:original.kout},current_plant:{qin_lps:plant.qin,kout:plant.kout}};
    return report;
  }
  reset();return {tick,dispatch,snapshot,exportEvidence,reset};
}
