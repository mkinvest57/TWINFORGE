// Fixed subprocess boundary: stdin data only, never executable model output.
import { createScenario, candidateInterventions, planIntervention, evaluateIntervention } from '../web/causal/engine.mjs';
let input='';for await (const chunk of process.stdin)input+=chunk;
const {options,action_id:actionId}=JSON.parse(input);
const scenario=createScenario(options.scenario_id,{seed:options.seed,perturbation:options.perturbation});
const actions=candidateInterventions(scenario,{actionDelayS:options.action_delay_s});
if(actionId!==null&&actionId!==undefined){
  const action=actions.find(row=>row.id===actionId);
  if(!action)throw new Error('Unknown bounded action');
  const run=evaluateIntervention(scenario,action,{includeFrames:false});
  process.stdout.write(JSON.stringify({verification:{action,metrics:run.metrics,events:run.events}}));
}else{
  const plan=planIntervention(scenario,{actionDelayS:options.action_delay_s});
  process.stdout.write(JSON.stringify({
    context:{scenario_id:scenario.id,description:scenario.description,arena:scenario.arena,
      bodies:scenario.bodies,physics:scenario.physics,horizon_s:scenario.horizonS,
      control_body_id:scenario.controlBodyId,protected_body_id:scenario.protectedBodyId,
      damage_threshold_j:scenario.dangerThresholdJ,available_actions:actions,
      objective:'Keep maximum protected-cargo relative normal contact energy <= threshold, then minimize applied control impulse (N.s).',
      scope:scenario.modelDisclosure},
    baseline:{metrics:plan.baseline.metrics,events:plan.baseline.events},
    reference:{action:plan.bestAction,metrics:plan.best.metrics,candidates_tested:plan.candidates.length,robustness:plan.robustness}
  }));
}
