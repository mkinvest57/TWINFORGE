import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCalibrationChallenge,fitModel,evaluateModel,predictLevel,planControl,createExperiment,GEOMETRY} from '../../web/process/engine.mjs';

const copy=x=>JSON.parse(JSON.stringify(x));
function linearEpisode(id,initial=0.4){
  // Exact analytic solution of an independently specified linear-outlet tank.
  // The estimator receives no q/k truth fields or numerical plant state.
  const area=.03,q=4.2,k=1.5,observations=[],control_plan=[];let h=initial;
  for(let i=0;i<=80;i++){
    const t=i*.1,u=[.2,.8,.1,1][Math.floor((t+1e-9)/.4)%4];
    observations.push({t,level_m:h+.00025*Math.sin(i*2.7),valve:u});
    if(i%4===0)control_plan.push({t,valve:u});
    const equilibrium=q*u/k;h=equilibrium+(h-equilibrium)*Math.exp(-k*.1/(area*1000));
  }
  return {id,source_kind:'synthetic',geometry:{area_m2:area},observations,control_plan};
}

test('integral identification recovers independently generated coefficients without truth access',()=>{
  const train=[linearEpisode('analytic-a'),linearEpisode('analytic-b',.9)];
  Object.defineProperty(train[0],'truth',{get(){throw new Error('Forbidden evaluator access');}});
  const before=copy(train),model=fitModel(train,{family:'linear_outflow'});
  assert.equal(model.status,'fitted');assert.ok(Math.abs(model.parameters.qin_lps-4.2)<.02);assert.ok(Math.abs(model.parameters.kout-1.5)<.02);
  assert.deepEqual(copy(train),before);assert.ok(model.uncertainty.qin_lps>0);assert.equal(model.source,'estimated_from_level_and_valve_observations');
});

test('future levels, commands and quality cannot influence a fit restricted to its causal prefix',()=>{
  const dataset=linearEpisode('causal'),original=fitModel(dataset,{family:'linear_outflow',maxTime:4}),modified=copy(dataset);
  for(const o of modified.observations)if(o.t>4){o.level_m=NaN;o.valve=1e9;o.hidden_future_quality='bad';}
  assert.deepEqual(fitModel(modified,{family:'linear_outflow',maxTime:4}),original);
});

test('challenge has distinct training/validation/test episodes and no producer coefficients',()=>{
  const a=buildCalibrationChallenge({seed:118}),b=buildCalibrationChallenge({seed:118});assert.deepEqual(a,b);
  assert.equal(a.train.length,3);assert.equal(a.validation.length,2);assert.equal(a.test.length,3);
  const ids=[...a.train,...a.validation,...a.test].map(d=>d.id);assert.equal(new Set(ids).size,8);
  assert.equal(a.protocol.hidden_parameters_excluded,true);assert.equal(a.real_world_validation,false);
  for(const dataset of [...a.train,...a.validation,...a.test]){
    assert.equal(dataset.parameters,undefined);assert.equal(dataset.truth,undefined);
    assert.ok(dataset.control_plan.length>0);
    assert.ok(dataset.observations.every(o=>Object.keys(o).sort().join(',')==='level_m,t,valve'));
  }
});

test('frozen train-only model outperforms the no-outlet family on held-out noisy episodes',()=>{
  const challenge=buildCalibrationChallenge(),models=challenge.families.map(family=>fitModel(challenge.train,{family}));
  const selected=models.reduce((best,m)=>evaluateModel(m,challenge.validation).mean_error_cm<evaluateModel(best,challenge.validation).mean_error_cm?m:best);
  assert.equal(selected.family,'sqrt_outflow');const frozen=copy(selected),score=evaluateModel(selected,challenge.test);
  assert.ok(score.mean_error_cm<challenge.protocol.threshold_mean_error_cm,JSON.stringify(score));
  assert.ok(evaluateModel(models[0],challenge.test).mean_error_cm>score.mean_error_cm*3);
  assert.deepEqual(selected,frozen);
  const changed=copy(challenge.test);for(const d of changed)for(const o of d.observations)if(o.t>.2)o.level_m+=100;
  const changedScore=evaluateModel(selected,changed);
  assert.deepEqual(changedScore.shots.map(s=>s.errors.map(e=>e.predicted_level_m)),score.shots.map(s=>s.errors.map(e=>e.predicted_level_m)));
  assert.deepEqual(selected,frozen);assert.ok(changedScore.mean_error_cm>9000);
});

test('held-valve forecast has explicit horizon, uncertainty and crossing assumption',()=>{
  const c=buildCalibrationChallenge(),m=fitModel(c.train),prediction=predictLevel(m,{levelM:.8,valve:1,t:2,horizonS:5});
  assert.equal(prediction.targetTime,7);assert.equal(prediction.scenario,'hold_current_valve');assert.equal(prediction.uses_future_observations,false);
  assert.ok(prediction.predictedLevelM>.8);assert.ok(prediction.intervalM[0]<=prediction.predictedLevelM);assert.ok(prediction.intervalM[1]>=prediction.predictedLevelM);
  assert.ok(prediction.timeToAlertS>0);assert.equal(predictLevel(m,{levelM:.8,valve:0,horizonS:5}).timeToAlertS,null);
  assert.throws(()=>predictLevel(m,{levelM:.8,valve:1,horizonS:6}),/horizon/);
});

test('MPC evaluates bounded sequences and only proposes an admissible first command',()=>{
  const c=buildCalibrationChallenge(),m=fitModel(c.train),decision=planControl(m,{levelM:1.1,valve:.6,targetM:1.05});
  assert.ok(decision.evaluated>=8&&decision.evaluated<=27);assert.equal(decision.onlyFirstActionApplied,true);
  assert.ok(Math.abs(decision.valve-.6)<=.20000001);
  let previous=.6;for(const u of decision.plannedSequence){assert.ok(u>=0&&u<=1);assert.ok(Math.abs(u-previous)<=.20000001);previous=u;}
  const unsafe=planControl(m,{levelM:1.49,valve:1,targetM:1.05});assert.equal(unsafe.feasible,false);assert.equal(unsafe.valve,.8);
  assert.equal(unsafe.reason,'no_safe_candidate_bounded_closure');
});

test('fixed physical clock produces identical evidence for different rendering tick partitions',()=>{
  const a=createExperiment({seed:9,controlEnabled:true}),b=createExperiment({seed:9,controlEnabled:true});
  a.tick(12);for(let i=0;i<120;i++)b.tick(.1);
  assert.deepEqual(a.exportEvidence(),b.exportEvidence());
  assert.equal(a.snapshot().observationCount,121);assert.equal(a.snapshot().observations.length,80);
  const times=a.exportEvidence().decisions.map(d=>d.t);
  assert.ok(times.length>10);for(let i=1;i<times.length;i++)assert.ok(Math.abs(times[i]-times[i-1]-.2)<1e-8);
});

test('same-plant same-clock comparison preserves volume and avoids overflow with bounded control after a shared perturbation',()=>{
  const closed=createExperiment({controlEnabled:true}),open=createExperiment({controlEnabled:false});let peak=0;
  for(let i=0;i<350;i++){
    if(i===180){closed.dispatch({type:'inflow_perturbation',factor:1.35});open.dispatch({type:'inflow_perturbation',factor:1.35});}
    const a=closed.tick(.1),b=open.tick(.1);peak=Math.max(peak,a.levelM);
    assert.deepEqual(a.baseline,b.baseline);assert.ok(Math.abs(b.levelM-b.baseline.levelM)<1e-12);
    assert.ok(Math.abs(a.volumeBalance.residualLitres)<1e-9);assert.ok(Math.abs(a.baseline.volumeBalance.residualLitres)<1e-9);
  }
  const a=closed.snapshot(),b=open.snapshot();assert.ok(peak<a.alertM);assert.equal(a.overflowLitres,0);assert.ok(b.overflowLitres>10);
  assert.ok(Math.abs(a.levelM-a.targetM)<.08);assert.equal(a.comparisonStartS,4);assert.equal(a.baseline.overflowLitres,b.overflowLitres);
  assert.ok(a.baseline.overflowM3S>0);assert.equal(a.overflowM3S,0);
  assert.ok(Math.abs(a.baseline.inflowLps-a.baseline.outflowLps-a.baseline.overflowM3S*1000)<1e-9);
  const event=closed.exportEvidence().actions.find(a=>a.type==='comparison_start');assert.ok(Number.isFinite(event.sameInitialLevelM));
  for(const action of closed.exportEvidence().actions.filter(a=>a.type==='control_command'))assert.ok(Math.abs(action.value-action.from)<=.20000001);
});

test('a perturbation never injects hidden coefficients into the current fitted model',()=>{
  const experiment=createExperiment();experiment.tick(5);const model=experiment.snapshot().model;
  experiment.dispatch({type:'inflow_perturbation',factor:1.35});assert.deepEqual(experiment.snapshot().model,model);
  const report=experiment.exportEvidence();assert.equal(report.evaluation_only,undefined);
  assert.ok(report.observations.every(o=>Object.keys(o).sort().join(',')==='level_m,t,valve'));
  assert.equal(experiment.exportEvidence({includeEvaluationTruth:true}).evaluation_only.access,'never use as fitting input');
});

test('a backend-selected model uses its measured geometry and reports an applied fitted status',()=>{
  const experiment=createExperiment();experiment.tick(4);
  const backendShape={family:'sqrt_outflow',parameters:{qin_lps:4.08,kout:1.345},geometry:{area_m2:.03},
    fit:{method:'nonnegative least squares on integral volume balance',volume_residual_rmse_l:.038},level:'L3',source_kind:'synthetic'};
  const snapshot=experiment.dispatch({type:'apply_model',model:backendShape});
  assert.equal(snapshot.modelOrigin,'external_L3_fit');assert.equal(snapshot.fitQuality.status,'fitted');assert.equal(snapshot.fitQuality.usingLastValidModel,false);
  assert.equal(snapshot.fitQuality.residual_litres,.038);assert.ok(Number.isFinite(experiment.tick(1).predictedLevelM));
  assert.equal(backendShape.id,undefined);
});

test('issued forecasts stay frozen and intervention errors remain in the global scored cohort',()=>{
  const experiment=createExperiment();experiment.tick(5);const issued=copy(experiment.exportEvidence().predictions[0]);
  experiment.dispatch({type:'valve',value:.1});experiment.tick(5);
  const report=experiment.exportEvidence(),same=report.predictions[0];assert.equal(same.predictedLevelM,issued.predictedLevelM);assert.deepEqual(same.model,issued.model);
  assert.ok(same.assessment.errorCm>5);assert.equal(same.assessment.supported,false);assert.ok(same.assessment.interventions.some(a=>a.type==='valve'));
  const mean=report.assessments.reduce((sum,a)=>sum+a.errorCm,0)/report.assessments.length;assert.equal(report.snapshot.meanErrorCm,mean);
  assert.equal(report.snapshot.forecastCounts.issued,report.snapshot.forecastCounts.scored+report.snapshot.forecastCounts.pending);
});

test('late control cannot erase already spilled volume and reset starts a fresh reproducible experiment',()=>{
  const experiment=createExperiment();experiment.tick(25);const spilled=experiment.snapshot().overflowLitres;assert.ok(spilled>0);
  experiment.dispatch({type:'control',enabled:true});experiment.tick(5);assert.ok(experiment.snapshot().overflowLitres>=spilled);
  experiment.reset();assert.equal(experiment.snapshot().overflowLitres,0);assert.equal(experiment.snapshot().t,0);assert.equal(experiment.exportEvidence().predictions.length,0);
  assert.deepEqual(experiment.snapshot(),createExperiment().snapshot());
});

test('unidentifiable data and invalid physical inputs are refused instead of inventing parameters',()=>{
  const noInput=linearEpisode('no-input');noInput.observations.forEach(o=>{o.valve=0;o.level_m=.5;});
  assert.equal(fitModel(noInput).status,'unidentifiable');
  const duplicate=linearEpisode('duplicate');duplicate.observations[3].t=duplicate.observations[2].t;assert.throws(()=>fitModel(duplicate),/ordered/);
  const experiment=createExperiment();assert.throws(()=>experiment.tick(-1));assert.throws(()=>experiment.dispatch({type:'target',levelM:1.4}));
  assert.throws(()=>experiment.dispatch({type:'valve',value:2}));assert.throws(()=>experiment.dispatch({type:'inflow_perturbation',factor:10}));
  assert.throws(()=>experiment.dispatch({type:'apply_model',model:{family:'sqrt_outflow',parameters:{qin_lps:4,kout:1},geometry:{area_m2:GEOMETRY.area_m2*2}}}),/geometry/);
  const model=fitModel(linearEpisode('valid'),{family:'linear_outflow'});
  assert.equal(evaluateModel(model,[]).mean_error_cm,null);
  assert.throws(()=>planControl(model,{levelM:NaN,valve:.5}),/Invalid/);
  assert.throws(()=>predictLevel(model,{levelM:.5,valve:.5,t:NaN}));
});
