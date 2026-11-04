import {SCENARIOS,sampleRun} from './engine.mjs';
import {SCENARIO_COPY,proposalCopy,defaultMetaAction} from './copy.mjs';

const $=id=>document.getElementById(id);
const put=(id,value)=>{if($(id))$(id).textContent=value;};
const number=(value,digits=1)=>Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const options={scenarioId:'cascade',seed:20261104,perturbation:1,actionDelayS:.25};
const scenarioSelector=$('scenario-select');scenarioSelector.replaceChildren();
for(const scenario of SCENARIOS){const choice=document.createElement('option');choice.value=scenario.id;choice.textContent=SCENARIO_COPY[scenario.id].title;scenarioSelector.append(choice);}
scenarioSelector.value=options.scenarioId;put('scenario-description',SCENARIO_COPY.cascade.description);
let plan=null,selectedRun=null,selectedRobustness=null,selectedOrigin='Local search',timeS=0,playing=false;
let worker=null,taskId=0,scene=null,dirty=true,lastPaint=0,lastFrame=0,report=null,metaRecorded=true,localBackend=false,metaBusy=false,disposed=false;
let generatedAt=null,metaEngineMatches=false,metaProviderAvailable=false,computing=false;
let comparisonMeta=null;

function actionLabel(action){
  if(!action||action.kind==='none')return 'No intervention';
  return `${action.kind==='brake'?`Brake ${number(action.amount*100,0)}%`:`Steer ${number(action.amount*180/Math.PI,1)}°`} at ${number(action.atS,2)} s`;
}
function activateTab(name){
  for(const id of ['controls-dialog','meta-dialog','evidence-dialog']){
    const dialog=$(id);if(dialog?.open)dialog.close();
  }
  if(name!=='experience'){
    playing=false;
    const dialog=$(`${name}-dialog`);if(dialog?.showModal)dialog.showModal();
    updateButtons();
  }
  dirty=true;scene?.resize();
}
for(const opener of document.querySelectorAll('[data-open-dialog]')){
  opener.addEventListener('click',()=>activateTab(opener.dataset.openDialog));
}
for(const closer of document.querySelectorAll('[data-close-dialog]')){
  closer.addEventListener('click',()=>closer.closest('dialog')?.close());
}
for(const id of ['controls-dialog','meta-dialog','evidence-dialog']){
  const dialog=$(id);dialog?.addEventListener('close',()=>{dirty=true;});
  dialog?.addEventListener('click',event=>{
    if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  });
}

function updateButtons(busy=computing){
  for(const button of document.querySelectorAll('.candidate-choice'))button.disabled=busy||!plan;
  for(const button of document.querySelectorAll('[data-meta-attempt]'))button.disabled=busy;
  for(const id of ['replay-button','pause-button','reset-button','candidate-select','time-scrubber','export-evidence','export-evidence-secondary'])if($(id))$(id).disabled=busy||!plan;
  if($('pause-button'))$('pause-button').disabled=busy||!playing;
  if($('search-button'))$('search-button').disabled=busy;
  if($('meta-apply-button'))$('meta-apply-button').disabled=busy||!report?.selected?.action||!metaEngineMatches;
}
function refreshMetrics(){
  if(!plan||!selectedRun)return;
  const before=plan.baseline.metrics,after=selectedRun.metrics;
  put('candidate-count',`${plan.candidates.length} actions`);
  put('impact-before',`${number(before.protectedImpactEnergyJ)} J`);put('impact-after',`${number(after.protectedImpactEnergyJ)} J`);
  put('baseline-impact',`${number(before.protectedImpactEnergyJ)} J`);put('intervention-impact',`${number(after.protectedImpactEnergyJ)} J`);
  put('effort-value',`${number(after.controlImpulseNs)} N·s`);
  put('baseline-result',before.safe?'Within threshold':'Threshold exceeded');
  put('intervention-result',after.safe?'Within threshold':'Threshold exceeded');
  $('intervention-result')?.classList.toggle('unsafe',!after.safe);
  $('baseline-result')?.classList.toggle('unsafe',!before.safe);
  $('impact-after')?.classList.toggle('unsafe',!after.safe);
  $('intervention-impact')?.classList.toggle('unsafe',!after.safe);
  put('decision-title',actionLabel(selectedRun.intervention));
  refreshMetaSummary();
  put('decision-explanation',`${selectedOrigin}. ${after.safe?`Peak contact energy on the fragile cargo stays at or below the ${number(after.thresholdJ,0)} J experiment threshold.`:`This action exceeds the ${number(after.thresholdJ,0)} J threshold. ${plan.safe?'Another tested action passes.':'No tested action passes at this delay.'}`}`);
  const deadline=plan.deadline;
  put('deadline-value',deadline?.lastSafeDelayS==null?'No passing delay':`${number(deadline.lastSafeDelayS,2)} s${deadline.lastSafeDelayS===deadline.maxDelayS?' (tested limit)':''}`);
  put('robustness-value',selectedRobustness?`${selectedRobustness.safeCount} / ${selectedRobustness.total}`:'—');
  put('outcome-explanation',selectedRobustness?.safeCount<selectedRobustness?.total?'This command fails at least one ±5% speed variation. A nominal success is not a robust result.':'This command passes the three tested speeds: −5%, nominal and +5%. These checks are not a real-world guarantee.');
  put('deadline-statement',`Latest passing delay on a 0.25 s grid, among ${plan.candidates.length} commands. The ${plan.scenario.dangerThresholdJ} J threshold is a criterion for this experiment.`);
  put('evidence-summary',`${plan.candidates.length} commands compared over ${plan.scenario.horizonS} seconds, computed before playback. Threshold: ${plan.scenario.dangerThresholdJ} J. Both branches use the same known model; this is not an independent real-world accuracy measurement.`);
  const list=$('candidate-list');
  if(list){list.replaceChildren();for(const candidate of plan.candidates.slice(0,6)){
    const li=document.createElement('li');const button=document.createElement('button');button.type='button';button.className='candidate-choice';
    button.setAttribute('aria-pressed',String(candidate.id===selectedRun.intervention.id));
    const label=document.createElement('strong');label.textContent=actionLabel(candidate.action);const value=document.createElement('span');value.textContent=`${number(candidate.metrics.protectedImpactEnergyJ)} J · ${number(candidate.metrics.controlImpulseNs)} N·s`;
    button.append(label,value);button.addEventListener('click',()=>runWorker(candidate.action));li.append(button);list.append(li);
  }}
  if($('candidate-select'))$('candidate-select').value=selectedRun.intervention.id;
  updateButtons();dirty=true;
}
function fillCandidates(){
  const select=$('candidate-select');if(!select)return;select.replaceChildren();
  for(const c of plan.candidates){const option=document.createElement('option');option.value=c.id;option.textContent=`${actionLabel(c.action)} · ${number(c.metrics.protectedImpactEnergyJ)} J`;select.append(option);}
}
function runWorker(action=null,{autoPlay=false,thenAction=null,origin='Local search',metaRun=null}={}){
  playing=false;computing=true;timeS=0;worker?.terminate();const id=++taskId;
  if(!action){plan=null;selectedRun=null;put('experiment-status','Computing future paths, commands and intervention windows…');$('scene-loading').hidden=false;}
  else put('experiment-status','Verifying this command at three initial speeds…');
  updateButtons(true);dirty=true;
  try{worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});}catch(error){fail(error.message);return;}
  worker.onerror=()=>fail('The calculation could not start. Reload in a current browser.');
  worker.onmessage=({data})=>{
    if(data.id!==taskId)return;if(data.error){fail(data.error);return;}
    if(data.plan){plan=data.plan;selectedRun=plan.best;selectedRobustness=plan.robustness;generatedAt=new Date().toISOString();fillCandidates();}
    else{selectedRun=data.run;selectedRobustness=data.robustness;}
    selectedOrigin=origin;comparisonMeta=metaRun;timeS=0;$('scene-loading').hidden=true;
    if(thenAction){runWorker(thenAction,{autoPlay,origin,metaRun});return;}
    computing=false;playing=autoPlay;refreshMetrics();
    put('experiment-status',`Futures computed. ${plan.safe?'Replay the two branches or try another command.':'No tested command protects the cargo at this delay.'}`);
  };
  worker.postMessage({id,options:{...options},action});
}
function fail(message){playing=false;computing=false;$('scene-loading').hidden=true;put('experiment-status',message);updateButtons();dirty=true;}
function exportEvidence(){
  if(!plan)return;
  save({schema:'twinforge.causal.interface.v1',generatedAt,exportedAt:new Date().toISOString(),options:{...options},
    plan,selectedRun,selectedRobustness,selectedOrigin,playbackTimeS:timeS,
    disclosures:{sourceKind:'synthetic',knownInitialState:true,knownPhysics:true,independentPredictionAccuracy:false,
      physicalControl:false,metaUsedForLocalSearch:false,instantaneousActuation:true}},`twinforge-${options.scenarioId}-evidence.json`);
}
function save(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

$('scenario-select').addEventListener('change',event=>{options.scenarioId=event.target.value;put('scenario-description',SCENARIO_COPY[options.scenarioId].description);runWorker();});
$('action-delay').addEventListener('input',event=>{put('action-delay-value',`${number(Number(event.target.value),2)} s`);});
$('action-delay').addEventListener('change',event=>{options.actionDelayS=Number(event.target.value);runWorker();});
$('speed-factor').addEventListener('input',event=>{put('speed-factor-value',`${number(Number(event.target.value)*100,0)} %`);});
$('speed-factor').addEventListener('change',event=>{options.perturbation=Number(event.target.value);runWorker();});
$('search-button').addEventListener('click',()=>runWorker());
$('candidate-select').addEventListener('change',event=>{const candidate=plan?.candidates.find(c=>c.id===event.target.value);if(candidate)runWorker(candidate.action,{origin:'Your selected command'});});
$('replay-button').addEventListener('click',()=>{if(!plan)return;activateTab('experience');timeS=0;playing=true;dirty=true;updateButtons();});
$('pause-button').addEventListener('click',()=>{playing=false;dirty=true;updateButtons();});
$('reset-button').addEventListener('click',()=>{playing=false;timeS=0;dirty=true;updateButtons();});
$('time-scrubber').addEventListener('input',event=>{playing=false;timeS=Number(event.target.value);dirty=true;updateButtons();});
$('show-predictions').addEventListener('change',()=>{dirty=true;});
$('export-evidence').addEventListener('click',exportEvidence);
$('export-evidence-secondary')?.addEventListener('click',exportEvidence);

function render(){
  if(!plan||!selectedRun)return;
  $('time-scrubber').value=String(timeS);put('time-value',`${number(timeS,2)} / ${plan.scenario.horizonS} s`);
  put('scene-phase',playing?'Synchronized playback':timeS===0?'Futures computed · ready':timeS>=plan.scenario.horizonS?'Playback complete':'Paused');
  scene?.render({scenario:plan.scenario,baseline:sampleRun(plan.baseline,timeS),intervention:sampleRun(selectedRun,timeS),
    baselinePrediction:plan.baseline.paths,interventionPrediction:selectedRun.paths,
    baselineEvents:plan.baseline.events,interventionEvents:selectedRun.events,timeS,showPredictions:$('show-predictions').checked});
}
function frame(now){
  if(disposed)return;const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
  if(playing&&!document.hidden){timeS=Math.min(plan.scenario.horizonS,timeS+dt);dirty=true;if(timeS>=plan.scenario.horizonS){playing=false;updateButtons();}}
  if(dirty&&!document.hidden&&now-lastPaint>1000/30){render();dirty=false;lastPaint=now;}
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();dirty=true;});
window.addEventListener('resize',()=>{dirty=true;});
$('causal-scene').addEventListener('causal-context-lost',()=>{if($('scene-fallback'))$('scene-fallback').hidden=false;playing=false;updateButtons();});
window.addEventListener('pagehide',event=>{if(!event.persisted){disposed=true;worker?.terminate();scene?.dispose();}});

function showMeta(value,recorded){
  if(value?.schema_version!=='twinforge.causal.meta.v1'||!Array.isArray(value.journal))throw new Error('Unrecognized run format');
  report=value;metaRecorded=recorded;
  put('meta-source',value.provider_calls?`${recorded?'Recorded':'New run'} · Muse Spark 1.3`:'Local search');
  put('meta-apply-button',value.provider_calls?'Replay Meta’s decision':'Replay the local reference');
  put('meta-compatibility',metaEngineMatches?'Verified against the same engine version. The recorded command can be replayed.':'The engine differs from this report. Replay is disabled.');
  const timeline=$('meta-timeline');timeline.replaceChildren();
  let translatedRows=0;
  for(const row of value.journal){
    const li=document.createElement('li');const head=document.createElement('strong');head.textContent=`${row.iteration}. ${row.verification?actionLabel(row.verification.action):'Proposal not applied'}`;
    const copy=proposalCopy(value,row);if(copy.translated)translatedRows++;
    const reason=document.createElement('p');reason.textContent=copy.reason;
    const result=document.createElement('p');result.className='step-result';const m=row.verification?.metrics;
    result.textContent=m?`Measured: ${number(m.protectedImpactEnergyJ)} J · ${m.safe?'passes':'rejected'} · ${number(m.controlImpulseNs)} N·s`:'No outcome was calculated for this proposal.';
    li.append(head,reason,result);timeline.append(li);
  }
  if(!value.journal.length){const li=document.createElement('li');li.textContent='Local search completed. No Meta model was called.';timeline.append(li);}
  put('meta-translation',translatedRows?'English translation · original provider responses are preserved in the export.':'Original provider responses.');
  const m=value.selected?.metrics;
  put('meta-status',`${recorded?'Recorded run':'New run'} · ${value.status==='complete'?'complete':'incomplete'} · ${value.provider_calls} Meta call(s) · $${number(value.charged_usd,5)}${value.error?` · ${value.error}`:''}`);
  put('meta-selection',value.selected?actionLabel(value.selected.action):'No action selected');
  put('meta-result',m?`${number(m.protectedImpactEnergyJ)} J · ${m.safe?'passes the threshold':'exceeds the threshold'}`:'No selected result');
  put('meta-reference',value.exhaustive_reference?`Local search: ${number(value.exhaustive_reference.metrics.protectedImpactEnergyJ)} J with ${number(value.exhaustive_reference.metrics.controlImpulseNs)} N·s. Meta proposal: ${m?`${number(m.controlImpulseNs)} N·s`:'—'}.`:'');
  if($('meta-export'))$('meta-export').disabled=false;
  refreshMetaSummary();
  updateButtons();
}
function refreshMetaSummary(){
  const comparingMeta=Boolean(comparisonMeta?.provider_calls);
  const summaryRun=comparisonMeta||report;
  put('meta-inline-model',summaryRun?.provider_calls?`Muse Spark 1.3 · ${comparingMeta?(comparisonMeta.recorded?'recorded decision':'this run'):(metaRecorded?'recorded run available':'verified run available')}`:'Local physics search');
  const rejected=summaryRun?.journal?.filter(row=>row.verification?.metrics?.safe===false).length||0;
  put('meta-inline-summary',summaryRun?.provider_calls?`${summaryRun.provider_calls} real model calls · ${rejected} rejected proposals${comparingMeta?'':' in the recorded example'}`:'Meta proposes a command. The physics engine checks its consequences.');
  put('meta-inline-action',selectedRun?`${comparingMeta?'Meta’s command':'Comparing a local command'}: ${actionLabel(selectedRun.intervention)}`:'Loading the recorded Meta decision…');
  put('selection-source',selectedOrigin);
  put('intervention-title',comparingMeta?'Meta’s decision':'Selected action');
  const steps=$('meta-inline-steps');
  if(steps){
    steps.replaceChildren();
    for(const row of report?.journal||[]){
      const button=document.createElement('button');button.type='button';button.className='meta-attempt';button.dataset.metaAttempt=String(row.iteration);
      const metrics=row.verification?.metrics,action=row.verification?.action;
      const selected=Boolean(comparisonMeta&&comparisonMeta.report_sha256===report.report_sha256&&action?.id===selectedRun?.intervention?.id);
      button.setAttribute('aria-pressed',String(selected));button.classList.toggle('rejected',metrics?.safe===false);
      const attempt=document.createElement('span');attempt.className='attempt-number';attempt.textContent=`Attempt ${row.iteration}`;
      const energy=document.createElement('strong');energy.textContent=metrics?`${number(metrics.protectedImpactEnergyJ)} J`:'—';
      const outcome=document.createElement('span');outcome.className='attempt-outcome';outcome.textContent=metrics?(metrics.safe?'Within threshold':'Rejected'):'Not verified';
      button.append(attempt,energy,outcome);
      button.setAttribute('aria-label',`Replay Meta attempt ${row.iteration}: ${metrics?`${number(metrics.protectedImpactEnergyJ)} joules, ${metrics.safe?'within the experiment threshold':'rejected'}`:'not verified'}`);
      button.addEventListener('click',()=>{if(metaEngineMatches&&action)applyReportAction(action,row.iteration);else activateTab('meta');});
      steps.append(button);
    }
  }
}
async function checkEngine(reportValue){
  const bytes=await(await fetch('./web/causal/engine.mjs')).arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  return hash===reportValue.source_sha256?.['web/causal/engine.mjs'];
}
async function loadMeta(){
  try{const response=await fetch('./assets/causal-meta-session.json');if(!response.ok)throw new Error('Recorded run unavailable');const value=await response.json();metaEngineMatches=await checkEngine(value);showMeta(value,true);if(!metaEngineMatches)put('meta-compatibility','Historical run: engine mismatch, replay disabled.');}
  catch{put('meta-status','No recorded Meta run is available. Local search is still available.');}
  if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){
    try{const response=await fetch('/api/status');if(!response.ok)throw new Error();const data=await response.json();localBackend=true;metaProviderAvailable=Boolean(data.meta);$('meta-run-button').disabled=false;$('meta-use-models').disabled=!metaProviderAvailable;put('meta-run-button','Run local search · free');put('backend-status',data.meta?'Local server connected. Meta calls require an explicit request, capped at $0.12 per run.':'Local server connected. Free local search is available; no Meta key is configured.');}
    catch{put('backend-status','Start the local Python server to run a new study.');}
  }else put('backend-status','This public demo replays a recorded Meta run. New model calls require the local Python server and your private Meta key.');
}
$('meta-use-models').addEventListener('change',()=>{put('meta-run-button',$('meta-use-models').checked?'Run 3 Meta proposals':'Run local search · free');});
$('meta-export').addEventListener('click',()=>{if(report)save(report,'twinforge-causal-meta.json');});
$('meta-apply-button').addEventListener('click',()=>{
  if(report?.selected?.action)applyReportAction(report.selected.action);
});
function applyReportAction(action,iteration=null){
  if(!report?.options||!metaEngineMatches){activateTab('meta');return;}
  Object.assign(options,{scenarioId:report.options.scenario_id,seed:report.options.seed,perturbation:report.options.perturbation,actionDelayS:report.options.action_delay_s});
  $('scenario-select').value=options.scenarioId;$('action-delay').value=String(options.actionDelayS);$('speed-factor').value=String(options.perturbation);
  put('action-delay-value',`${number(options.actionDelayS,2)} s`);put('speed-factor-value',`${number(options.perturbation*100,0)} %`);
  put('scenario-description',SCENARIO_COPY[options.scenarioId].description);
  const origin=report.provider_calls?`${metaRecorded?'Recorded Muse Spark':'Muse Spark'} ${iteration?`attempt ${iteration}`:'proposal'}`:'Local reference from this run';
  activateTab('experience');runWorker(null,{thenAction:action,autoPlay:true,origin,metaRun:report.provider_calls?{...report,recorded:metaRecorded}:null});
}
$('meta-run-button').addEventListener('click',async()=>{
  if(!localBackend||metaBusy)return;metaBusy=true;$('meta-run-button').disabled=true;$('meta-use-models').disabled=true;put('meta-status','Run in progress…');
  try{
    const response=await fetch('/api/jobs/causal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario_id:options.scenarioId,seed:options.seed,perturbation:options.perturbation,action_delay_s:options.actionDelayS,use_models:$('meta-use-models').checked,max_iterations:3,budget_cap_usd:.12})});
    const job=await response.json();if(!response.ok)throw new Error(job.error||'Run rejected');
    let result;for(let i=0;i<180;i++){
      await new Promise(resolve=>setTimeout(resolve,1000));result=await(await fetch(`/api/jobs/${job.id}`)).json();
      if(['failed','interrupted'].includes(result.status))throw new Error(result.error||'Run interrupted');
      if(result.status==='complete')break;
    }
    if(result.status!=='complete')throw new Error('The run is still in progress on the server. No automatic retry was started.');
    metaEngineMatches=await checkEngine(result.result.report);showMeta(result.result.report,false);
  }catch(error){put('meta-status',`Run not completed: ${error.message}`);}
  finally{metaBusy=false;$('meta-run-button').disabled=false;$('meta-use-models').disabled=!metaProviderAvailable;}
});

try{const {createCausalScene}=await import('./scene.mjs');scene=createCausalScene($('causal-scene'));}
catch{if($('scene-fallback'))$('scene-fallback').hidden=false;put('experiment-status','3D rendering is unavailable. Calculations, comparison and exports remain accessible.');}
activateTab('experience');requestAnimationFrame(frame);
const bootTaskId=taskId;
await loadMeta();
if(taskId===bootTaskId&&!plan){
  const initialMetaAction=defaultMetaAction(report,metaEngineMatches);
  runWorker(null,initialMetaAction?{thenAction:initialMetaAction,origin:'Recorded Muse Spark proposal',metaRun:{...report,recorded:true}}:{});
}
