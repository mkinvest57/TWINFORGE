import {createScenario,planIntervention,evaluateIntervention} from './engine.mjs';
self.onmessage=({data})=>{
  try{
    const scenario=createScenario(data.options.scenarioId,{seed:data.options.seed,perturbation:data.options.perturbation});
    if(data.action){
      const run=evaluateIntervention(scenario,data.action);
      const checks=[.95,1,1.05].map(speedFactor=>{
        const changed=JSON.parse(JSON.stringify(scenario));
        const body=changed.bodies.find(b=>b.id===scenario.controlBodyId);body.vx*=speedFactor;body.vz*=speedFactor;
        const measured=evaluateIntervention(changed,data.action,{includeFrames:false});
        return {speedFactor,safe:measured.metrics.safe,protectedImpactEnergyJ:measured.metrics.protectedImpactEnergyJ};
      });
      self.postMessage({id:data.id,run,robustness:{checks,safeCount:checks.filter(c=>c.safe).length,total:checks.length}});
    }else{
      const plan=planIntervention(scenario,{actionDelayS:data.options.actionDelayS,scanDeadline:true});
      self.postMessage({id:data.id,plan});
    }
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
