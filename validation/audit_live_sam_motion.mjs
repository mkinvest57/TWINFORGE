/** Reproduce existing v6 targets using past pixels only. No model/API requests. */
import {forecastMotion} from '../web/vision/motion.mjs';

let input='';
for await(const chunk of process.stdin)input+=chunk;
const runs=JSON.parse(input),failures=[],results=[];
for(const run of runs){
  let maxPointDifferencePx=0,shortForecasts=0;
  for(const issued of run.issued){
    const past=run.observations.filter(o=>o.trackId===issued.trackId&&o.t<=issued.sourceTime).slice(-150);
    const options={sourceTime:issued.sourceTime,horizon:issued.horizon,maxAge:.12};
    const replay=forecastMotion(past,options);
    const future=[1,2].map(i=>({...past.at(-1),t:issued.sourceTime+i*.001,
      point:{x:1e8*i,y:-1e8*i},status:'tracking',confidence:1}));
    const contaminated=forecastMotion([...past,...future],options);
    const delta=replay.point?Math.hypot(replay.point.x-issued.point.x,replay.point.y-issued.point.y):Infinity;
    maxPointDifferencePx=Math.max(maxPointDifferencePx,delta);
    if(issued.motionModel?.startsWith('short_'))shortForecasts++;
    if(replay.status!=='predicted'||delta>1e-6||replay.motionModel!==issued.motionModel||
      replay.usedTimes.some(t=>t>issued.issuedAtSourceTimeS)||JSON.stringify(replay)!==JSON.stringify(contaminated)){
      failures.push({prediction_id:issued.id,replayed_status:replay.status,point_difference_px:Number.isFinite(delta)?delta:null,
        issued_model:issued.motionModel,replayed_model:replay.motionModel,future_invariant:JSON.stringify(replay)===JSON.stringify(contaminated)});
    }
  }
  results.push({run_id:run.runId,forecasts_checked:run.issued.length,short_window_forecasts:shortForecasts,
    future_perturbation_checks:run.issued.length,max_point_difference_px:Number.isFinite(maxPointDifferencePx)?maxPointDifferencePx:null});
}
process.stdout.write(JSON.stringify({type:'issued_forecast_causality_reproduction',new_live_calls:0,
  accuracy_metrics_replaced:false,runs:results,failures}));
