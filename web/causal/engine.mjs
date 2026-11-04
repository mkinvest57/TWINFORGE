/**
 * Twinforge causal laboratory — planar, rigid circular cargo carriers.
 * Supplied initial conditions and contact law, deterministic counterfactuals.
 * This is a simulation study, not a learned real-world dynamics model.
 */
const EPS = 1e-10;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const clone = value => JSON.parse(JSON.stringify(value));
const finite = (value, name) => { if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`); return value; };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
function random(seed) { let state = seed >>> 0; return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const SCENARIOS = freeze([
  {id:'cascade',title:'Réaction en chaîne',description:'Un chariot percute une file de charges. Le dernier transporteur porte un équipement fragile.',challenge:'Couper la chaîne avant le premier contact.'},
  {id:'crossing',title:'Intersection aveugle',description:'Deux transporteurs convergent. Le choc peut dévier une charge vers un équipement fragile.',challenge:'Choisir entre freiner et dévier, avant le croisement.'},
  {id:'bottleneck',title:'Passage critique',description:'Une charge en mouvement traverse un passage entre deux équipements. Une déviation trop forte crée un autre impact.',challenge:'Trouver la plus petite correction qui protège la charge.'},
]);

function body(id,kind,label,x,z,vx,vz,radius,mass,color) { return {id,kind,label,x,z,vx,vz,radius,mass,color}; }
export function createScenario(id='cascade',{seed=20261104,perturbation=1}={}) {
  const meta=SCENARIOS.find(item=>item.id===id); if(!meta) throw new RangeError('Unknown scenario');
  finite(perturbation,'perturbation'); if(perturbation<.6||perturbation>1.4) throw new RangeError('perturbation must be between .6 and 1.4');
  if(!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  const rng=random(seed); const offset=()=> (rng()-.5)*.035;
  let bodies;
  if(id==='cascade') bodies=[
    body('carrier','carrier','A · transporteur',-6,-.12,4.4,0,.58,45,'#f6a66a'),
    body('relay-a','cargo','B · charge',-2.65,-.08,0,0,.62,28,'#8b9dad'),
    body('relay-b','cargo','C · charge',.45,.12,0,0,.62,24,'#91a69c'),
    body('protected','fragile','D · équipement fragile',3.6,.22,0,0,.70,15,'#72ddca'),
    body('parked','cargo','E · charge arrêtée',1.8,-2.7,0,0,.65,35,'#667381'),
  ];
  if(id==='crossing') bodies=[
    body('carrier','carrier','A · transporteur',-6,-1.2,4.2,.12,.58,38,'#f6a66a'),
    body('crossing','cargo','B · charge transversale',-.8,-3.8,0,2.65,.62,32,'#8b9dad'),
    body('protected','fragile','C · équipement fragile',3.9,1.2,0,0,.72,16,'#72ddca'),
    body('parked','cargo','D · charge arrêtée',3.4,-2.4,0,0,.64,30,'#667381'),
  ];
  if(id==='bottleneck') bodies=[
    body('carrier','carrier','A · transporteur',-6,.58,4.2,0,.59,40,'#f6a66a'),
    body('gate-a','cargo','B · charge arrêtée',-1,-1.12,0,0,.72,65,'#667381'),
    body('gate-b','cargo','C · charge arrêtée',-.8,2.12,0,0,.72,65,'#8b9dad'),
    body('protected','fragile','D · équipement fragile',3.6,.85,0,0,.72,14,'#72ddca'),
  ];
  for(const item of bodies){ item.z+=offset(); if(item.id==='carrier'){item.vx*=perturbation;item.vz*=perturbation;} }
  return freeze({...meta,seed,perturbation,horizonS:12,arena:{width:16,depth:10},bodies,controlBodyId:'carrier',protectedBodyId:'protected',physics:{dragPerS:.035,restitution:.72,wallRestitution:.3},dangerThresholdJ:8,
    modelDisclosure:{source:'supplied_initial_state_and_contact_law',geometry:'planar circular collision envelopes',integrator:'exact linear-drag free flight + discrete frictionless impulses, fixed 240 Hz',intervention:'one instantaneous bounded velocity change; actuator dynamics not modeled',realWorldValidation:false,metaPoweredPhysics:false}});
}

function validateScenario(scenario) {
  if(!scenario||!Array.isArray(scenario.bodies)||scenario.bodies.length<1||scenario.bodies.length>12) throw new TypeError('Invalid bodies');
  const width=finite(scenario.arena?.width,'width'),depth=finite(scenario.arena?.depth,'depth'); if(width<=0||depth<=0) throw new RangeError('Arena must be positive');
  if(finite(scenario.horizonS,'horizon')<=0||scenario.horizonS>30) throw new RangeError('horizon outside (0,30]');
  if(finite(scenario.physics?.dragPerS,'drag')<0||scenario.physics.dragPerS>2) throw new RangeError('Invalid drag');
  for(const name of ['restitution','wallRestitution']) if(finite(scenario.physics[name],name)<0||scenario.physics[name]>1) throw new RangeError('Invalid restitution');
  const ids=new Set(); for(const item of scenario.bodies) {
    if(typeof item.id!=='string'||ids.has(item.id)) throw new TypeError('Body IDs must be unique'); ids.add(item.id);
    for(const name of ['x','z','vx','vz','radius','mass']) finite(item[name],name);
    if(item.mass<=0||item.radius<=0||item.radius>=Math.min(width,depth)/2||Math.hypot(item.vx,item.vz)>30) throw new RangeError('Invalid body dimensions or velocity');
    if(Math.abs(item.x)>width/2-item.radius+EPS||Math.abs(item.z)>depth/2-item.radius+EPS) throw new RangeError('Body outside arena');
  }
  if(!ids.has(scenario.controlBodyId)||!ids.has(scenario.protectedBodyId)) throw new TypeError('Missing controlled or protected body');
  if(finite(scenario.dangerThresholdJ,'threshold')<0) throw new RangeError('Negative threshold');
}

export function normalizeIntervention(scenario,action=null) {
  if(action===null||action.kind==='none') return freeze({id:'none',kind:'none',bodyId:scenario.controlBodyId,atS:0,amount:0});
  if(!action||!['brake','steer'].includes(action.kind)) throw new TypeError('Intervention must be brake, steer or none');
  if(action.bodyId!==undefined&&action.bodyId!==scenario.controlBodyId) throw new RangeError('Only the lead carrier can be controlled');
  const atS=finite(action.atS,'atS'),amount=finite(action.amount,'amount');
  if(atS<0||atS>Math.min(2,scenario.horizonS)) throw new RangeError('Action delay outside [0,2] seconds');
  if(action.kind==='brake'&&(amount<0||amount>.9)) throw new RangeError('Brake amount outside [0,.9]');
  if(action.kind==='steer'&&Math.abs(amount)>.36+EPS) throw new RangeError('Steering angle outside [-.36,.36] radians');
  return freeze({id:`${action.kind}:${amount.toFixed(2)}@${atS.toFixed(2)}`,kind:action.kind,bodyId:scenario.controlBodyId,atS,amount});
}

export function candidateInterventions(scenario,{actionDelayS=.25}={}) {
  const result=[normalizeIntervention(scenario)];
  for(let level=1;level<=18;level++) result.push(normalizeIntervention(scenario,{kind:'brake',bodyId:scenario.controlBodyId,atS:actionDelayS,amount:level*.05}));
  for(let level=-9;level<=9;level++) if(level!==0) result.push(normalizeIntervention(scenario,{kind:'steer',bodyId:scenario.controlBodyId,atS:actionDelayS,amount:level*.04}));
  return freeze(result);
}

const totalKineticEnergy = bodies=>bodies.reduce((sum,b)=>sum+.5*b.mass*(b.vx*b.vx+b.vz*b.vz),0);
const totalMomentum = bodies=>bodies.reduce((sum,b)=>({x:sum.x+b.mass*b.vx,z:sum.z+b.mass*b.vz}),{x:0,z:0});

/** Resolves one contact. Returned energy is pre-impact relative normal kinetic energy. */
export function resolveContact(a,b,restitution=.72) {
  const dx=b.x-a.x,dz=b.z-a.z,distance=Math.hypot(dx,dz),sumRadius=a.radius+b.radius;
  if(distance>=sumRadius) return null;
  let nx=distance>EPS?dx/distance:1,nz=distance>EPS?dz/distance:0;
  const inverseMass=1/a.mass+1/b.mass;
  // Full mass-weighted positional projection keeps persistent contacts stable.
  const correction=Math.max(0,sumRadius-distance+1e-9)/inverseMass;
  a.x-=correction/a.mass*nx;a.z-=correction/a.mass*nz;b.x+=correction/b.mass*nx;b.z+=correction/b.mass*nz;
  const normalVelocity=(b.vx-a.vx)*nx+(b.vz-a.vz)*nz;
  if(normalVelocity>=-EPS) return null;
  const impulse=-(1+restitution)*normalVelocity/inverseMass;
  a.vx-=impulse/a.mass*nx;a.vz-=impulse/a.mass*nz;b.vx+=impulse/b.mass*nx;b.vz+=impulse/b.mass*nz;
  return {type:'collision',bodyIds:[a.id,b.id],impulseNs:impulse,energyJ:.5/inverseMass*normalVelocity*normalVelocity,x:(a.x+b.x)/2,z:(a.z+b.z)/2};
}

export function runScenario(scenario,{intervention=null,dt=1/240,sampleHz=30,includeFrames=true}={}) {
  validateScenario(scenario);finite(dt,'dt');finite(sampleHz,'sampleHz');if(dt<=0||dt>1/120||sampleHz<1||sampleHz>120) throw new RangeError('Invalid simulation or sample step');
  const action=normalizeIntervention(scenario,intervention),bodies=clone(scenario.bodies),events=[],frames=[],paths=Object.fromEntries(bodies.map(b=>[b.id,[]]));
  const initialEnergyJ=totalKineticEnergy(bodies),initialMomentum=totalMomentum(bodies);let timeS=0,nextSample=0,applied=false,controlImpulseNs=0,controlEnergyChangeJ=0;
  let protectedImpactEnergyJ=0,protectedImpactSumJ=0,maxProtectedImpulseNs=0,protectedCollisionCount=0,totalCollisions=0,firstProtectedImpactS=null;
  const recordFrame=()=>{if(!includeFrames)return;const frame={timeS,bodies:clone(bodies)};frames.push(frame);for(const b of bodies)paths[b.id].push({timeS,x:b.x,z:b.z});};
  const recordEvent=event=>{
    event.timeS=timeS;events.push(event); if(event.type==='intervention')return;totalCollisions++;
    if(event.bodyIds.includes(scenario.protectedBodyId)) {protectedImpactEnergyJ=Math.max(protectedImpactEnergyJ,event.energyJ);protectedImpactSumJ+=event.energyJ;maxProtectedImpulseNs=Math.max(maxProtectedImpulseNs,event.impulseNs);protectedCollisionCount++;if(firstProtectedImpactS===null)firstProtectedImpactS=timeS;}
  };
  const applyAction=()=>{
    applied=true;if(action.kind==='none')return;const b=bodies.find(item=>item.id===action.bodyId),before={vx:b.vx,vz:b.vz};
    if(action.kind==='brake'){b.vx*=1-action.amount;b.vz*=1-action.amount;}
    else{const c=Math.cos(action.amount),s=Math.sin(action.amount);b.vx=before.vx*c-before.vz*s;b.vz=before.vx*s+before.vz*c;}
    controlImpulseNs=b.mass*Math.hypot(b.vx-before.vx,b.vz-before.vz);
    controlEnergyChangeJ=.5*b.mass*(b.vx*b.vx+b.vz*b.vz-before.vx*before.vx-before.vz*before.vz);
    recordEvent({type:'intervention',bodyIds:[b.id],kind:action.kind,amount:action.amount,impulseNs:controlImpulseNs,energyJ:controlEnergyChangeJ,x:b.x,z:b.z});
  };
  if(action.atS<=EPS)applyAction();recordFrame();nextSample=1/sampleHz;
  while(timeS<scenario.horizonS-EPS){
    if(!applied&&timeS>=action.atS-EPS)applyAction();
    let step=Math.min(dt,scenario.horizonS-timeS,nextSample-timeS);
    if(!applied&&action.atS>timeS+EPS)step=Math.min(step,action.atS-timeS);
    if(step<EPS){timeS=nextSample;recordFrame();nextSample+=1/sampleHz;continue;}
    const drag=scenario.physics.dragPerS,damping=Math.exp(-drag*step),travel=drag>EPS?-Math.expm1(-drag*step)/drag:step;
    for(const b of bodies){b.x+=b.vx*travel;b.z+=b.vz*travel;b.vx*=damping;b.vz*=damping;}
    timeS+=step;
    // Repeated positional/velocity passes resolve chains without retaining overlaps.
    for(let pass=0;pass<3;pass++){
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){const event=resolveContact(bodies[i],bodies[j],scenario.physics.restitution);if(event)recordEvent(event);}
      for(const b of bodies)for(const axis of ['x','z']){
        const bound=(axis==='x'?scenario.arena.width:scenario.arena.depth)/2-b.radius,velocity=axis==='x'?'vx':'vz';
        if(Math.abs(b[axis])<=bound)continue;const sign=Math.sign(b[axis]);b[axis]=sign*bound;
        if(b[velocity]*sign<=0)continue;const speed=Math.abs(b[velocity]);b[velocity]*=-scenario.physics.wallRestitution;
        recordEvent({type:'wall',bodyIds:[b.id],impulseNs:b.mass*(1+scenario.physics.wallRestitution)*speed,energyJ:.5*b.mass*speed*speed,x:b.x,z:b.z});
      }
    }
    if(timeS>=nextSample-EPS){recordFrame();nextSample+=1/sampleHz;}
  }
  if(includeFrames&&frames.at(-1).timeS<scenario.horizonS-EPS)recordFrame();
  return freeze({schema:'twinforge.causal.run.v1',scenarioId:scenario.id,intervention:action,horizonS:scenario.horizonS,dt,sampleHz,frames,paths,events,
    metrics:{protectedImpactEnergyJ,protectedImpactSumJ,maxProtectedImpulseNs,protectedCollisionCount,totalCollisions,firstProtectedImpactS,controlImpulseNs,controlEnergyChangeJ,thresholdJ:scenario.dangerThresholdJ,safe:protectedImpactEnergyJ<=scenario.dangerThresholdJ+EPS,initialEnergyJ,finalEnergyJ:totalKineticEnergy(bodies),initialMomentum,finalMomentum:totalMomentum(bodies)},finalState:{timeS,bodies:clone(bodies)},
    assumptions:scenario.modelDisclosure||{source:'supplied_initial_state_and_contact_law',realWorldValidation:false}});
}

export function evaluateIntervention(scenario,action,options={}) { return runScenario(scenario,{...options,intervention:normalizeIntervention(scenario,action)}); }

function compareCandidates(a,b) {
  if(a.metrics.safe!==b.metrics.safe)return a.metrics.safe?-1:1;
  if(!a.metrics.safe){const risk=a.metrics.protectedImpactEnergyJ-b.metrics.protectedImpactEnergyJ;if(Math.abs(risk)>1e-9)return risk;}
  const effort=a.metrics.controlImpulseNs-b.metrics.controlImpulseNs;if(Math.abs(effort)>1e-9)return effort;
  const risk=a.metrics.protectedImpactEnergyJ-b.metrics.protectedImpactEnergyJ;if(Math.abs(risk)>1e-9)return risk;
  return a.id.localeCompare(b.id);
}
function evaluateCandidates(scenario,actionDelayS) {
  return candidateInterventions(scenario,{actionDelayS}).map(action=>{const run=evaluateIntervention(scenario,action,{includeFrames:false});return {id:action.id,action,metrics:run.metrics};}).sort(compareCandidates);
}

export function planIntervention(scenario,{actionDelayS=.25,scanDeadline=false,robustness=true}={}) {
  const started=clock(),candidates=evaluateCandidates(scenario,actionDelayS),selected=candidates[0];
  const baseline=runScenario(scenario),best=selected.id==='none'?baseline:evaluateIntervention(scenario,selected.action);
  let deadline=null;
  if(scanDeadline){const rows=[];for(let index=0;index<=8;index++){const delayS=index*.25;const winner=Math.abs(delayS-actionDelayS)<EPS?selected:evaluateCandidates(scenario,delayS)[0];rows.push({delayS,safe:winner.metrics.safe,bestCandidateId:winner.id,protectedImpactEnergyJ:winner.metrics.protectedImpactEnergyJ,controlImpulseNs:winner.metrics.controlImpulseNs});}
    const safeRows=rows.filter(row=>row.safe);deadline={stepS:.25,maxDelayS:2,lastSafeDelayS:safeRows.length?safeRows.at(-1).delayS:null,rows,scope:'Last safe delay among a 0.25-second grid and the stated discrete intervention set; not a continuous guarantee.'};
  }
  let sensitivity=null;
  if(robustness){const checks=[.95,1,1.05].map(speedFactor=>{const changed=clone(scenario),b=changed.bodies.find(b=>b.id===scenario.controlBodyId);b.vx*=speedFactor;b.vz*=speedFactor;const run=evaluateIntervention(changed,selected.action,{includeFrames:false});return {speedFactor,safe:run.metrics.safe,protectedImpactEnergyJ:run.metrics.protectedImpactEnergyJ};});sensitivity={kind:'lead_carrier_speed_only',checks,safeCount:checks.filter(row=>row.safe).length,total:checks.length,scope:'Three simulated speed checks only; no probabilistic or physical guarantee.'};}
  return freeze({schema:'twinforge.causal.plan.v1',scenario,actionDelayS,baseline,best,bestAction:selected.action,candidates,safe:selected.metrics.safe,deadline,robustness:sensitivity,planningMs:clock()-started,
    objective:'Among evaluated actions below the protected-impact energy threshold, minimize applied impulse. If none succeeds, minimize protected-impact energy, then impulse.',
    scope:'All trajectories are frozen before playback using one supplied simulation model. Same-model counterfactual comparison, not held-out prediction accuracy.',
    frozenAtSimulationTimeS:0});
}

/** Only reads previously frozen frames; it does not regenerate or move a prediction. */
export function sampleRun(run,timeS) {
  finite(timeS,'timeS');if(!run.frames?.length)throw new TypeError('Run has no frames');const clamped=clamp(timeS,0,run.horizonS);
  let low=0,high=run.frames.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(run.frames[mid].timeS<=clamped+EPS)low=mid;else high=mid-1;}
  const left=run.frames[low],right=run.frames[Math.min(low+1,run.frames.length-1)],span=right.timeS-left.timeS,fraction=span>EPS?(clamped-left.timeS)/span:0;
  return {timeS:clamped,bodies:left.bodies.map((b,index)=>{const next=right.bodies[index];return {...b,x:b.x+(next.x-b.x)*fraction,z:b.z+(next.z-b.z)*fraction,vx:b.vx+(next.vx-b.vx)*fraction,vz:b.vz+(next.vz-b.vz)*fraction};})};
}

export function createExperiment({scenarioId='cascade',seed=20261104,perturbation=1,actionDelayS=.25}={}) {
  let scenario=createScenario(scenarioId,{seed,perturbation}),plan=null,timeS=0;
  const snapshot=()=>({scenario,timeS,planned:Boolean(plan),finished:timeS>=scenario.horizonS-EPS,baseline:plan?sampleRun(plan.baseline,timeS):{timeS:0,bodies:clone(scenario.bodies)},intervention:plan?sampleRun(plan.best,timeS):{timeS:0,bodies:clone(scenario.bodies)},plan});
  return {
    plan(options={}){plan=planIntervention(scenario,{actionDelayS,...options});timeS=0;return plan;},
    tick(deltaS){finite(deltaS,'deltaS');if(deltaS<0)throw new RangeError('Negative tick');if(plan)timeS=Math.min(scenario.horizonS,timeS+deltaS);return snapshot();},
    seek(value){timeS=clamp(finite(value,'timeS'),0,scenario.horizonS);return snapshot();},
    snapshot,
    reset(options={}){scenarioId=options.scenarioId??scenarioId;seed=options.seed??seed;perturbation=options.perturbation??perturbation;actionDelayS=options.actionDelayS??actionDelayS;scenario=createScenario(scenarioId,{seed,perturbation});plan=null;timeS=0;return snapshot();},
    exportEvidence(){return clone({schema:'twinforge.causal.evidence.v1',scenario,plan,playbackTimeS:timeS,realWorldValidation:false,modelSource:'supplied_initial_state_and_contact_law'});},
  };
}
