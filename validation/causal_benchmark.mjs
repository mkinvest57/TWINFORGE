#!/usr/bin/env node
/** Reproducible synthetic counterfactual benchmark. No provider calls. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SCENARIOS,createScenario,planIntervention,runScenario} from '../web/causal/engine.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2];
if(!output)throw new Error('Usage: node validation/causal_benchmark.mjs /absolute/output.json');
const sourceFiles=['web/causal/engine.mjs','tests/js/causal-engine.test.mjs','validation/causal_benchmark.mjs'];
const hashes=()=>Object.fromEntries(sourceFiles.map(relative=>[relative,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex')]));
const before=hashes(),startedAt=new Date().toISOString(),results=[];
for(const {id} of SCENARIOS){
  const scenario=createScenario(id),plan=planIntervention(scenario,{scanDeadline:true}),fineBaseline=runScenario(scenario,{dt:1/480,includeFrames:false}),fineAction=runScenario(scenario,{dt:1/480,intervention:plan.bestAction,includeFrames:false});
  results.push({scenario,action_delay_s:plan.actionDelayS,candidate_count:plan.candidates.length,objective:plan.objective,best_action:plan.bestAction,baseline:{metrics:plan.baseline.metrics,events:plan.baseline.events},intervention:{metrics:plan.best.metrics,events:plan.best.events},candidates:plan.candidates,deadline:plan.deadline,speed_sensitivity:plan.robustness,
    integration_convergence:{coarse_dt_s:1/240,fine_dt_s:1/480,fine_baseline_metrics:fineBaseline.metrics,fine_intervention_metrics:fineAction.metrics,relative_baseline_peak_energy_change:Math.abs(fineBaseline.metrics.protectedImpactEnergyJ-plan.baseline.metrics.protectedImpactEnergyJ)/Math.max(1e-12,fineBaseline.metrics.protectedImpactEnergyJ)}});
}
const after=hashes(),unchanged=JSON.stringify(before)===JSON.stringify(after);
const report={schema:'twinforge.causal.benchmark.v1',started_at:startedAt,completed_at:new Date().toISOString(),source_sha256:before,source_changed_during_run:!unchanged,passed:unchanged&&results.every(row=>!row.baseline.metrics.safe&&row.intervention.metrics.safe&&row.integration_convergence.fine_intervention_metrics.safe&&row.integration_convergence.relative_baseline_peak_energy_change<.03),
  scope:'Synthetic, same-model causal planning. These results are not real-video validation, learned physics, held-out forecast accuracy, or safety certification. Initial positions, masses and contact coefficients are supplied. Each intervention is a single idealized instantaneous velocity change.',
  prediction_protocol:'Every counterfactual trajectory is computed and frozen at simulation time zero, before any playback. Both worlds use identical initial conditions except for the stated action. The displayed playback is a visualization of these frozen trajectories.',
  robustness_protocol:'Diagnostic evaluation of the chosen nominal action with lead-carrier speed scaled by 0.95, 1 and 1.05. The nominal optimizer does not optimize these extra checks. A failure remains visible.',
  deadline_protocol:'Search at nine delays from 0 to 2 seconds in 0.25-second increments. Last successful tested delay is not a continuous feasibility boundary.',results};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,passed:report.passed,source_changed_during_run:report.source_changed_during_run,scenarios:results.map(row=>({id:row.scenario.id,baseline_peak_j:row.baseline.metrics.protectedImpactEnergyJ,selected_peak_j:row.intervention.metrics.protectedImpactEnergyJ,action:row.best_action.id,last_tested_safe_delay_s:row.deadline.lastSafeDelayS,speed_checks:`${row.speed_sensitivity.safeCount}/${row.speed_sensitivity.total}`}))},null,2));
