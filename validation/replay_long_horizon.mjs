/** Deterministic, prefix-only image-motion evaluation. No API or renderer calls.
 * Run: node validation/replay_long_horizon.mjs [output.json]
 * The old implementation is loaded from Git, with only its 0.75 s input cap
 * raised to 1 s so its underlying extrapolation can be compared at that target.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve,relative} from 'node:path';
import {forecastMotion} from '../web/vision/motion.mjs';
import {assessForecast} from '../web/camera/prediction.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baselineCommit='fdeadfdb87842f9540c60c402caf0722ccfd766a';
const hash=text=>createHash('sha256').update(text).digest('hex');
const moduleURL=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const oldCamera=execFileSync('git',['show',`${baselineCommit}:web/camera/prediction.mjs`],{cwd:root,encoding:'utf8'}).replace('o.horizon>.75','o.horizon>1');
const oldMotion=execFileSync('git',['show',`${baselineCommit}:web/vision/motion.mjs`],{cwd:root,encoding:'utf8'}).replace("'../camera/prediction.mjs'",JSON.stringify(moduleURL(oldCamera)));
const {forecastMotion:previousForecast}=await import(moduleURL(oldMotion));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const stats=values=>values.length?{count:values.length,meanPx:values.reduce((a,b)=>a+b,0)/values.length,p90Px:[...values].sort((a,b)=>a-b)[Math.floor(.9*(values.length-1))],maxPx:Math.max(...values)}:{count:0};
const reports=[];
function evaluate(name,horizon,cases,details={}){
  const ledger=[];
  for(const {observations,index,target} of cases){
    const prefix=observations.slice(0,index+1),sourceTime=prefix.at(-1).t;
    const current=forecastMotion(prefix,{sourceTime,horizon}),previous=previousForecast(prefix,{sourceTime,horizon});
    const score=prediction=>target?(prediction.status==='predicted'?{status:'scored',errorPx:distance(prediction.point,target)}:{status:'unscorable',reason:prediction.reason}):assessForecast(prediction,observations,{availableTime:sourceTime+horizon+.25,maxBracketGap:.3});
    const a=score(current),b=score(previous);
    ledger.push({trackId:prefix.at(-1).trackId,sourceTime,targetTime:sourceTime+horizon,current:{status:current.status,reason:current.reason,model:current.motionModel,point:current.point,errorPx:a?.errorPx??null,scoreStatus:a?.status??'target_not_yet_available',uncertaintyPx:current.uncertaintyPx??null},previous:{status:previous.status,reason:previous.reason,point:previous.point,errorPx:b?.errorPx??null,scoreStatus:b?.status??'target_not_yet_available'}});
  }
  const currentErrors=ledger.filter(r=>r.current.errorPx!==null),oldErrors=ledger.filter(r=>r.previous.errorPx!==null),paired=ledger.filter(r=>r.current.errorPx!==null&&r.previous.errorPx!==null);
  const envelopes=currentErrors.filter(r=>Number.isFinite(r.current.uncertaintyPx));
  const report={name,horizonS:horizon,...details,attempted:ledger.length,currentForecasts:ledger.filter(r=>r.current.status==='predicted').length,previousForecasts:ledger.filter(r=>r.previous.status==='predicted').length,current:stats(currentErrors.map(r=>r.current.errorPx)),previous:stats(oldErrors.map(r=>r.previous.errorPx)),paired:{count:paired.length,current:stats(paired.map(r=>r.current.errorPx)),previous:stats(paired.map(r=>r.previous.errorPx))},empiricalEnvelope:{count:envelopes.length,contained:envelopes.filter(r=>r.current.errorPx<=r.current.uncertaintyPx).length,calibrated:false},ledger};
  reports.push(report);
  console.log(`${name} +${horizon}s: new ${report.current.count}/${report.attempted} mean ${report.current.meanPx?.toFixed(2)??'n/a'} px; old ${report.previous.count}/${report.attempted} mean ${report.previous.meanPx?.toFixed(2)??'n/a'} px; paired ${paired.length}`);
}

// These six fixed variations were written after the implementation was frozen.
// They exercise different coefficients/frequencies, including nonstationary
// human-like motion and an unseen reversal. They are synthetic, not camera data.
const families={
  linear:(t,k)=>({x:35+(18+k*3.7)*t,y:120-(6+k*.9)*t}),
  accelerated:(t,k)=>({x:70+(12+k*2)*t+(4+k*.7)*t*t,y:190-(15+k)*t+(2+k*.3)*t*t}),
  periodic:(t,k)=>({x:220+(40+k*4)*Math.sin((1.45+k*.27)*t+.3*k),y:160+(25+k*2)*Math.cos((1.45+k*.27)*t+.3*k)}),
  irregular_gesture:(t,k)=>({x:220+(42+k*2)*Math.sin((1.2+k*.17)*t)+9*Math.sin((3.7+k*.23)*t),y:150+30*Math.cos((1.2+k*.17)*t)+11*Math.sin((3.1+k*.19)*t)}),
  unexpected_reversal:(t,k)=>({x:70+(26+k*2)*(t<3.15?t:6.3-t),y:140+7*t+(t>3.15?12*(t-3.15):0)})
};
for(const [name,path] of Object.entries(families))for(const horizon of [.5,.75,1]){
  const cases=[];
  for(let seed=1;seed<=6;seed++){
    const observations=Array.from({length:161},(_,i)=>{const t=i*.05,p=path(t,seed);return{t,point:{x:p.x+1.5*Math.sin(i*2.71+seed*.37),y:p.y+1.2*Math.sin(i*1.93+seed*.43)},confidence:.95,status:'tracking',trackId:`synthetic-${seed}`};});
    for(let index=36;index<=132;index+=16)cases.push({observations,index,target:path(observations[index].t+horizon,seed)});
  }
  evaluate(`synthetic_holdout/${name}`,horizon,cases,{source:'synthetic analytically scored paths; six fixed parameter variations, seven origins each'});
}

const inputs=[];
for(const file of ['collision-v8-final.json','flight-after-tracker-fix.json','pendulum-ticket.json']){
  const path=resolve(root,'validation/runs/studio-2026-11-05',file),raw=await readFile(path,'utf8'),data=JSON.parse(raw),byTrack=new Map();
  inputs.push({path:relative(root,path),sha256:hash(raw)});
  for(const observation of data.current.observations){if(!byTrack.has(observation.trackId))byTrack.set(observation.trackId,[]);byTrack.get(observation.trackId).push(observation);}
  for(const horizon of [.5,.75,1]){
    const cases=[];
    for(const observations of byTrack.values())for(let index=6;index<observations.length;index+=3){if(observations[index].t+horizon<=observations.at(-1).t)cases.push({observations,index});}
    evaluate(`saved_pixel_replay/${file}`,horizon,cases,{source:'previously saved synthetic-scene visual observations; development replay, not unseen physical camera footage'});
  }
}

const sourceHashes={};
for(const file of ['web/vision/motion.mjs','web/camera/prediction.mjs'])sourceHashes[file]=hash(await readFile(resolve(root,file),'utf8'));
const result={schema:'twinforge.long-horizon-evaluation.v1',generatedAt:new Date().toISOString(),baselineCommit,baselineModification:'Only old camera horizon input cap raised from 0.75 to 1.0 s. All other old forecasting/refusal behavior preserved.',sourceHashes,inputs,method:{observedInputsOnly:true,futureObservationsExcludedFromForecast:true,origins:'Every eligible origin in each fixed schedule, including refused and unscorable cases.',scores:'Pixel distance at exact future target, using analytic truth for synthetic paths or interpolated later visual observations for saved replays.',selection:'Models use previously observed validation targets only. No withheld target, world state, object class or renderer physics enters forecasting.',comparison:'Read paired means for same-origin improvement; total scored coverage and all-case means are also reported.',uncertainty:'Empirical envelope is not calibrated. Containment is measured, not promised.',limitations:['No physical camera/hand accuracy claim follows from these data.','Saved replay files were inspected during development and are not an independent holdout.','Synthetic holdout coefficients were created after implementation; it is still a small artificial suite, not a representative real-world benchmark.','Intentional human changes and first unseen impacts are not inferable from prior centroids alone.']},reports};
const output=resolve(process.argv[2]??resolve(root,'validation/runs/long-horizon-camera-2026-11-05.json'));
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(`Evidence: ${pathToFileURL(output).href}`);
